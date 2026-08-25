"use strict";
/**
 * The restaurant's view of its bookings, plus the two actions that matter:
 * cancel (releases the hold) and no-show (captures the fee).
 *
 * Everything here is behind HTTP Basic auth. The guest endpoints are public by
 * necessity; these must never be.
 */
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const booking = require("../services/booking");
const payments = require("../services/payments/mock");
const availability = require("../services/availability");

/** Constant-time compare so the password can't be guessed by timing. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function basicAuth(config) {
  return function (req, res, next) {
    const header = req.get("Authorization") || "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const [user, ...rest] = Buffer.from(encoded, "base64").toString("utf8").split(":");
      const pass = rest.join(":");
      if (safeEqual(user, config.adminUser) && safeEqual(pass, config.adminPassword)) {
        return next();
      }
    }
    res.set("WWW-Authenticate", 'Basic realm="ReserveHold admin", charset="UTF-8"');
    res.status(401).json({ code: "unauthorized", message: "Admin credentials required" });
  };
}

module.exports = function adminRoutes(db, config) {
  const router = express.Router();
  // Applied per route, never with router.use(): this router is mounted at the
  // root, so a blanket guard would also 401 the widget's own static files.
  const auth = basicAuth(config);

  // The overview page itself. Behind auth too — it lists guest phone numbers.
  router.get("/admin", auth, (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
  });

  /** Bookings for one date, with the payment state alongside. */
  router.get("/v1/admin/reservations", auth, (req, res) => {
    const date = String(req.query.date || "");
    const status = String(req.query.status || "");

    const where = [];
    const args = [];
    if (date) {
      if (!availability.parseISODate(date)) {
        return res
          .status(400)
          .json({ code: "invalid_request", message: "date must be YYYY-MM-DD" });
      }
      where.push("r.date = ?");
      args.push(date);
    }
    if (status) {
      where.push("r.status = ?");
      args.push(status);
    }
    if (req.query.restaurant_id) {
      where.push("r.restaurant_id = ?");
      args.push(String(req.query.restaurant_id));
    }

    const rows = db
      .prepare(
        "SELECT r.*, t.label AS table_label, t.seats AS table_seats" +
          " FROM reservations r LEFT JOIN tables_ t ON t.id = r.table_id" +
          (where.length ? " WHERE " + where.join(" AND ") : "") +
          " ORDER BY r.date ASC, r.time ASC, r.created_at ASC"
      )
      .all(...args);

    const reservations = rows.map((r) => {
      const payment = payments.latestForReservation(db, r.id);
      return {
        id: r.id,
        reference: r.reference,
        date: r.date,
        time: r.time,
        party_size: r.party_size,
        table: r.table_label,
        guest_name: r.guest_name,
        guest_email: r.guest_email,
        guest_phone: r.guest_phone,
        notes: r.notes,
        payment_method: r.payment_method,
        status: r.status,
        fee_minor: r.fee_minor,
        currency: r.currency,
        payment_status: payment ? payment.status : null,
        created_at: r.created_at,
      };
    });

    // Only bookings that will actually show up count towards covers.
    const covers = reservations
      .filter((r) => r.status === "confirmed")
      .reduce((sum, r) => sum + r.party_size, 0);

    res.json({
      reservations,
      totals: {
        count: reservations.length,
        confirmed: reservations.filter((r) => r.status === "confirmed").length,
        covers,
        no_shows: reservations.filter((r) => r.status === "no_show").length,
      },
    });
  });

  router.post("/v1/admin/reservations/:id/cancel", auth, (req, res, next) => {
    try {
      res.json({ reservation: booking.cancel(db, req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/v1/admin/reservations/:id/no-show", auth, (req, res, next) => {
    try {
      res.json({ reservation: booking.markNoShow(db, req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

module.exports.basicAuth = basicAuth;
