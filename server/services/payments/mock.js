"use strict";
/**
 * Simulated payment provider — stands in for Datatrans / Payrexx / Stripe.
 *
 * It implements the same three operations a real hold needs:
 *   authorize  reserve the money without taking it
 *   capture    actually take it (only on a no-show)
 *   void       release it
 *
 * The interface is what matters: swapping in a real provider should mean
 * writing another module with these three functions, not touching booking.js.
 *
 * NOTHING here talks to a bank. It exists so the whole flow can be exercised
 * without a merchant account.
 */
const crypto = require("crypto");

const PROVIDER = "mock";

function now() {
  return Date.now();
}

function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(9).toString("hex");
}

/**
 * Start a hold. Returns a redirect the guest must visit — mirroring TWINT,
 * where the guest approves in their app before the hold exists.
 */
function authorize(db, { reservation, publicBase }) {
  const id = newId("pay");
  const ts = now();
  db.prepare(
    "INSERT INTO payments (id, reservation_id, provider, method, status, amount_minor, currency, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?)"
  ).run(
    id,
    reservation.id,
    PROVIDER,
    reservation.payment_method,
    reservation.fee_minor,
    reservation.currency,
    ts,
    ts
  );

  return {
    paymentId: id,
    status: "requires_redirect",
    // app.js refuses a non-https redirect_url, so publicBase must be https.
    redirectUrl: publicBase.replace(/\/+$/, "") + "/pay/mock/" + encodeURIComponent(id),
  };
}

/** Called when the guest approves or declines on the mock page. */
function resolveAuthorization(db, paymentId, approved) {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  if (!payment) return null;
  // Already decided: don't let a page refresh flip an authorized hold.
  if (payment.status !== "created") return payment;

  const status = approved ? "authorized" : "failed";
  db.prepare("UPDATE payments SET status = ?, provider_ref = ?, updated_at = ? WHERE id = ?").run(
    status,
    approved ? newId("auth") : null,
    now(),
    paymentId
  );
  return db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
}

/** Take the money. Only ever called for a no-show. */
function capture(db, paymentId) {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  if (!payment) throw new Error("unknown payment " + paymentId);
  // Capturing twice would charge the guest twice — make it a no-op instead.
  if (payment.status === "captured") return payment;
  if (payment.status !== "authorized") {
    throw new Error("cannot capture a payment in state " + payment.status);
  }
  db.prepare("UPDATE payments SET status = 'captured', updated_at = ? WHERE id = ?").run(
    now(),
    paymentId
  );
  return db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
}

/** Release the hold without taking anything. */
function voidHold(db, paymentId) {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  if (!payment) return null;
  if (payment.status === "voided" || payment.status === "failed") return payment;
  if (payment.status === "captured") {
    throw new Error("cannot void a captured payment — that needs a refund");
  }
  db.prepare("UPDATE payments SET status = 'voided', updated_at = ? WHERE id = ?").run(
    now(),
    paymentId
  );
  return db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
}

function latestForReservation(db, reservationId) {
  return (
    db
      .prepare("SELECT * FROM payments WHERE reservation_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(reservationId) || null
  );
}

module.exports = {
  PROVIDER,
  authorize,
  resolveAuthorization,
  capture,
  voidHold,
  latestForReservation,
};
