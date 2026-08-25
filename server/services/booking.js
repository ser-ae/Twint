"use strict";
/**
 * Creating, confirming, cancelling and settling reservations.
 *
 * Everything that decides whether a table is taken happens inside one
 * transaction, because two guests can submit the last table in the same
 * second.
 */
const crypto = require("crypto");
const { transaction } = require("../db");
const availability = require("./availability");
const payments = require("./payments/mock");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(9).toString("hex");
}

/** Short, unambiguous, readable over the phone: no O/0/I/1. */
function newReference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return "RH-" + out;
}

function hashRequest(body) {
  return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/**
 * return_url comes from the browser. Reflecting it back as a redirect target
 * without checking would turn this server into an open redirect.
 */
function assertAllowedReturnUrl(returnUrl, allowedOrigins) {
  if (!returnUrl) return "";
  let parsed;
  try {
    parsed = new URL(returnUrl);
  } catch (e) {
    throw new ApiError(400, "invalid_return_url", "return_url is not a valid URL");
  }
  if (!allowedOrigins.includes(parsed.origin)) {
    throw new ApiError(400, "invalid_return_url", "return_url origin is not allowed");
  }
  return parsed.toString();
}

function validateBooking(body, restaurant) {
  const errors = [];
  const str = (v) => String(v == null ? "" : v).trim();

  if (!availability.parseISODate(str(body.date))) errors.push("date");
  if (availability.toMinutes(str(body.time)) == null) errors.push("time");

  const size = Number(body.party_size);
  if (!Number.isInteger(size) || size < restaurant.min_party || size > restaurant.max_party) {
    errors.push("party_size");
  }
  if (str(body.guest_name).length < 2) errors.push("guest_name");
  if (!EMAIL_RE.test(str(body.guest_email))) errors.push("guest_email");
  if (str(body.guest_phone).replace(/\D/g, "").length < 7) errors.push("guest_phone");
  if (!["twint", "card"].includes(str(body.payment_method))) errors.push("payment_method");
  if (str(body.notes).length > 500) errors.push("notes");

  if (errors.length) {
    throw new ApiError(400, "invalid_request", "Invalid fields: " + errors.join(", "));
  }
  return size;
}

/** The shape the widget expects on a confirmed reservation. */
function toPublicReservation(reservation, publicBase) {
  return {
    id: reservation.id,
    reference: reservation.reference,
    date: reservation.date,
    time: reservation.time,
    party_size: reservation.party_size,
    guest_email: reservation.guest_email,
    status: reservation.status,
    manage_url:
      reservation.manage_token && reservation.status === "confirmed"
        ? publicBase.replace(/\/+$/, "") + "/r/" + reservation.manage_token
        : undefined,
  };
}

/**
 * Create a reservation and open the payment hold.
 *
 * The slot re-check, the table assignment and the insert are one transaction:
 * checking availability and then inserting in two steps would let two guests
 * both pass the check before either row existed.
 */
function createReservation(db, { body, idempotencyKey, config }) {
  const restaurant = availability.getRestaurant(db, String(body.restaurant_id || ""));
  if (!restaurant) throw new ApiError(404, "unknown_restaurant", "No such restaurant");

  const partySize = validateBooking(body, restaurant);
  const returnUrl = assertAllowedReturnUrl(body.return_url, config.allowedOrigins);
  const requestHash = hashRequest(body);

  // The fee is recalculated here. quoted_fee_minor is only ever checked
  // against the real figure, never used as the amount.
  if (
    body.quoted_fee_minor != null &&
    Number(body.quoted_fee_minor) !== restaurant.fee_minor
  ) {
    throw new ApiError(409, "fee_mismatch", "The fee changed — reload and try again");
  }

  const now = Date.now();

  const created = transaction(db, () => {
    if (idempotencyKey) {
      const seen = db
        .prepare("SELECT * FROM idempotency_keys WHERE key = ?")
        .get(idempotencyKey);
      if (seen) {
        if (seen.request_hash !== requestHash) {
          throw new ApiError(
            409,
            "idempotency_key_reuse",
            "This Idempotency-Key was already used for a different booking"
          );
        }
        const existing = db
          .prepare("SELECT * FROM reservations WHERE id = ?")
          .get(seen.reservation_id);
        if (existing) return { reservation: existing, replayed: true };
      }
    }

    if (!availability.withinBookingWindow(restaurant, body.date, new Date(now))) {
      throw new ApiError(400, "date_out_of_range", "That date cannot be booked");
    }
    if (!availability.respectsLeadTime(restaurant, body.date, body.time, new Date(now))) {
      throw new ApiError(409, "slot_unavailable", "That time is no longer bookable");
    }

    const table = availability.pickTable(db, restaurant, body.date, body.time, partySize);
    if (!table) {
      throw new ApiError(409, "slot_unavailable", "That time was just taken");
    }

    const reservation = {
      id: newId("res"),
      reference: newReference(),
      restaurant_id: restaurant.id,
      date: String(body.date),
      time: String(body.time),
      party_size: partySize,
      table_id: table.id,
      guest_name: String(body.guest_name).trim(),
      guest_email: String(body.guest_email).trim(),
      guest_phone: String(body.guest_phone).trim(),
      notes: String(body.notes || "").trim(),
      payment_method: String(body.payment_method),
      locale: String(body.locale || "de").slice(0, 5),
      status: "pending_payment",
      fee_minor: restaurant.fee_minor,
      currency: restaurant.currency,
      manage_token: crypto.randomBytes(24).toString("hex"),
      return_url: returnUrl,
      hold_expires_at: now + config.holdMinutes * 60000,
      created_at: now,
      updated_at: now,
    };

    db.prepare(
      "INSERT INTO reservations (id, reference, restaurant_id, date, time, party_size, table_id," +
        " guest_name, guest_email, guest_phone, notes, payment_method, locale, status," +
        " fee_minor, currency, manage_token, return_url, hold_expires_at, created_at, updated_at)" +
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(
      reservation.id,
      reservation.reference,
      reservation.restaurant_id,
      reservation.date,
      reservation.time,
      reservation.party_size,
      reservation.table_id,
      reservation.guest_name,
      reservation.guest_email,
      reservation.guest_phone,
      reservation.notes,
      reservation.payment_method,
      reservation.locale,
      reservation.status,
      reservation.fee_minor,
      reservation.currency,
      reservation.manage_token,
      reservation.return_url,
      reservation.hold_expires_at,
      reservation.created_at,
      reservation.updated_at
    );

    if (idempotencyKey) {
      db.prepare(
        "INSERT INTO idempotency_keys (key, request_hash, reservation_id, created_at) VALUES (?,?,?,?)"
      ).run(idempotencyKey, requestHash, reservation.id, now);
    }

    return { reservation, replayed: false };
  });

  // A replay must not open a second hold — that is the whole point of the key.
  if (created.replayed) {
    const payment = payments.latestForReservation(db, created.reservation.id);
    return { reservation: created.reservation, payment, replayed: true };
  }

  const auth = payments.authorize(db, {
    reservation: created.reservation,
    publicBase: config.publicBase,
  });
  return { reservation: created.reservation, auth, replayed: false };
}

function getReservation(db, id) {
  return db.prepare("SELECT * FROM reservations WHERE id = ?").get(id) || null;
}

function getByManageToken(db, token) {
  return db.prepare("SELECT * FROM reservations WHERE manage_token = ?").get(token) || null;
}

function setStatus(db, id, status) {
  db.prepare("UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?").run(
    status,
    Date.now(),
    id
  );
  return getReservation(db, id);
}

/** Called when the provider says the hold exists. */
function markConfirmed(db, reservationId) {
  const reservation = getReservation(db, reservationId);
  if (!reservation) return null;
  if (reservation.status === "confirmed") return reservation;
  if (reservation.status !== "pending_payment") return reservation;
  db.prepare(
    "UPDATE reservations SET status = 'confirmed', hold_expires_at = NULL, updated_at = ? WHERE id = ?"
  ).run(Date.now(), reservationId);
  return getReservation(db, reservationId);
}

function markFailed(db, reservationId) {
  const reservation = getReservation(db, reservationId);
  if (!reservation || reservation.status !== "pending_payment") return reservation;
  return setStatus(db, reservationId, "failed");
}

/** Cancel and release the hold. Used by both the guest link and the admin. */
function cancel(db, reservationId) {
  const reservation = getReservation(db, reservationId);
  if (!reservation) throw new ApiError(404, "not_found", "No such reservation");
  if (reservation.status === "cancelled") return reservation;
  if (reservation.status === "no_show") {
    throw new ApiError(409, "already_settled", "That reservation was charged as a no-show");
  }
  const payment = payments.latestForReservation(db, reservationId);
  if (payment) payments.voidHold(db, payment.id);
  return setStatus(db, reservationId, "cancelled");
}

/**
 * Mark a no-show and capture the fee. This takes real money in production, so
 * it is deliberately idempotent — a double-click must not charge twice.
 */
function markNoShow(db, reservationId) {
  const reservation = getReservation(db, reservationId);
  if (!reservation) throw new ApiError(404, "not_found", "No such reservation");
  if (reservation.status === "no_show") return reservation;
  if (reservation.status !== "confirmed") {
    throw new ApiError(
      409,
      "not_confirmed",
      "Only a confirmed reservation can be marked as a no-show"
    );
  }
  const payment = payments.latestForReservation(db, reservationId);
  if (!payment || payment.status !== "authorized") {
    throw new ApiError(409, "no_hold", "There is no active hold to charge");
  }
  payments.capture(db, payment.id);
  return setStatus(db, reservationId, "no_show");
}

/**
 * Release tables held by checkouts that were never completed. Without this an
 * abandoned payment blocks a table until the end of time.
 */
function sweepExpiredHolds(db, nowMs) {
  const now = nowMs || Date.now();
  const stale = db
    .prepare(
      "SELECT id FROM reservations WHERE status = 'pending_payment' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?"
    )
    .all(now);
  for (const row of stale) {
    const payment = payments.latestForReservation(db, row.id);
    if (payment && payment.status === "created") payments.voidHold(db, payment.id);
    setStatus(db, row.id, "expired");
  }
  return stale.length;
}

module.exports = {
  ApiError,
  createReservation,
  getReservation,
  getByManageToken,
  markConfirmed,
  markFailed,
  cancel,
  markNoShow,
  sweepExpiredHolds,
  toPublicReservation,
  newReference,
};
