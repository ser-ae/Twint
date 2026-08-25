"use strict";
/**
 * The four endpoints the widget calls. Shapes are fixed by README.md and by
 * what app.js actually parses — see the table in the plan before changing one.
 */
const express = require("express");
const availability = require("../services/availability");
const booking = require("../services/booking");
const payments = require("../services/payments/mock");

module.exports = function publicRoutes(db, config) {
  const router = express.Router();

  // 1. Config — the server is the authority on money, limits and legal links.
  router.get("/v1/restaurants/:id/config", (req, res) => {
    const restaurant = availability.getRestaurant(db, req.params.id);
    if (!restaurant) {
      return res.status(404).json({ code: "unknown_restaurant", message: "No such restaurant" });
    }
    res.json({
      name: restaurant.name,
      fee_minor: restaurant.fee_minor,
      currency: restaurant.currency,
      min_party: restaurant.min_party,
      max_party: restaurant.max_party,
      lead_minutes: restaurant.lead_minutes,
      booking_window_days: restaurant.booking_window_days,
      policy_url: restaurant.policy_url,
      privacy_url: restaurant.privacy_url,
    });
  });

  // 2. Availability.
  router.get("/v1/restaurants/:id/availability", (req, res) => {
    const restaurant = availability.getRestaurant(db, req.params.id);
    if (!restaurant) {
      return res.status(404).json({ code: "unknown_restaurant", message: "No such restaurant" });
    }
    const date = String(req.query.date || "");
    if (!availability.parseISODate(date)) {
      return res.status(400).json({ code: "invalid_request", message: "date must be YYYY-MM-DD" });
    }
    const partySize = Number(req.query.party_size || restaurant.min_party);
    res.json({ slots: availability.availability(db, restaurant, date, partySize) });
  });

  // 3. Create a reservation and open the hold.
  router.post("/v1/reservations", (req, res, next) => {
    try {
      const idempotencyKey = req.get("Idempotency-Key") || "";
      const result = booking.createReservation(db, {
        body: req.body || {},
        idempotencyKey,
        config,
      });

      const reservation = result.reservation;

      // A replay of an already-confirmed booking should look confirmed again,
      // not send the guest back through payment.
      if (result.replayed) {
        if (reservation.status === "confirmed") {
          return res.status(200).json({
            status: "confirmed",
            reservation_id: reservation.id,
            reservation: booking.toPublicReservation(reservation, config.publicBase),
          });
        }
        return res.status(200).json({
          status: "pending",
          reservation_id: reservation.id,
        });
      }

      res.status(201).json({
        status: "requires_redirect",
        reservation_id: reservation.id,
        redirect_url: result.auth.redirectUrl,
      });
    } catch (err) {
      next(err);
    }
  });

  // 4. Polled after the redirect until the hold really exists.
  router.get("/v1/reservations/:id", (req, res) => {
    const reservation = booking.getReservation(db, req.params.id);
    if (!reservation) {
      return res.status(404).json({ code: "not_found", message: "No such reservation" });
    }
    res.json({
      status: reservation.status === "pending_payment" ? "pending" : reservation.status,
      reservation: booking.toPublicReservation(reservation, config.publicBase),
    });
  });

  // ------------------------------------------------------------------
  // The simulated TWINT app. Not part of the API contract — it stands in
  // for the provider-hosted page the guest would really be sent to.
  // ------------------------------------------------------------------

  router.get("/pay/mock/:paymentId", (req, res) => {
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.paymentId);
    if (!payment) return res.status(404).send("Unknown payment");
    const reservation = booking.getReservation(db, payment.reservation_id);
    if (!reservation) return res.status(404).send("Unknown reservation");

    const amount = (payment.amount_minor / 100).toFixed(2);
    const decided = payment.status !== "created";

    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock payment</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0d0f12;color:#f4f4f5;
       display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
  .card{background:#17191d;border:1px solid #2a2d34;border-radius:14px;
        padding:28px;max-width:380px;width:100%}
  .tag{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#f59e0b;
       border:1px solid #f59e0b;border-radius:4px;padding:3px 7px;display:inline-block}
  h1{font-size:19px;margin:16px 0 4px}
  dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px;margin:18px 0 24px}
  dt{color:#9ca3af} dd{margin:0;text-align:right}
  .amount{font-size:30px;font-weight:700;margin:6px 0 0}
  form{display:flex;gap:10px} button{flex:1;padding:12px;border-radius:9px;
       border:0;font-size:15px;font-weight:600;cursor:pointer}
  .ok{background:#16a34a;color:#fff} .no{background:#27272a;color:#e4e4e7}
  p.note{font-size:12px;color:#71717a;margin-top:18px;line-height:1.5}
</style></head><body>
<div class="card">
  <span class="tag">Simulation</span>
  <h1>Approve the hold</h1>
  <p class="amount">${payment.currency} ${amount}</p>
  <dl>
    <dt>Restaurant</dt><dd>${escapeHtml(reservation.restaurant_id)}</dd>
    <dt>Reference</dt><dd>${escapeHtml(reservation.reference)}</dd>
    <dt>When</dt><dd>${escapeHtml(reservation.date)} ${escapeHtml(reservation.time)}</dd>
    <dt>Guests</dt><dd>${reservation.party_size}</dd>
    <dt>Method</dt><dd>${escapeHtml(payment.method)}</dd>
  </dl>
  ${
    decided
      ? `<p class="note">This payment is already <strong>${escapeHtml(
          payment.status
        )}</strong>. Nothing further to do.</p>`
      : `<form method="POST" action="/pay/mock/${encodeURIComponent(payment.id)}">
           <button class="no" name="decision" value="decline">Decline</button>
           <button class="ok" name="decision" value="approve">Approve</button>
         </form>`
  }
  <p class="note">This page replaces the TWINT app. No money moves — the hold
  is recorded in the local database only.</p>
</div></body></html>`);
  });

  router.post("/pay/mock/:paymentId", (req, res) => {
    const approved = String((req.body && req.body.decision) || "") === "approve";
    const payment = payments.resolveAuthorization(db, req.params.paymentId, approved);
    if (!payment) return res.status(404).send("Unknown payment");

    if (approved) booking.markConfirmed(db, payment.reservation_id);
    else booking.markFailed(db, payment.reservation_id);

    const reservation = booking.getReservation(db, payment.reservation_id);

    // Send the guest back where they came from. app.js reads rw_reservation
    // off the query string in resumeAfterRedirect().
    if (reservation && reservation.return_url) {
      try {
        const back = new URL(reservation.return_url);
        back.searchParams.set("rw_reservation", reservation.id);
        return res.redirect(303, back.toString());
      } catch (e) {
        /* fall through to the plain page below */
      }
    }
    res
      .type("html")
      .send(
        `<p>Payment ${approved ? "approved" : "declined"}. You can close this window.</p>`
      );
  });

  return router;
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
