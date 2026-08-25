"use strict";
/**
 * The page behind manage_url — how a guest views and cancels a booking without
 * an account. The token in the URL is the only credential, so it is long and
 * random, and it is the only way to address the reservation here.
 */
const express = require("express");
const booking = require("../services/booking");

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#faf9f7;color:#18181b;
       display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
  .card{background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:28px;
        max-width:420px;width:100%}
  h1{font-size:20px;margin:0 0 6px}
  dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px;margin:18px 0}
  dt{color:#71717a} dd{margin:0;text-align:right;font-weight:600}
  button{width:100%;padding:12px;border-radius:9px;border:0;background:#d7263d;
         color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  .muted{font-size:13px;color:#71717a;line-height:1.5}
  .status{display:inline-block;font-size:12px;padding:3px 9px;border-radius:999px;
          background:#f4f4f5;color:#3f3f46;text-transform:uppercase;letter-spacing:.06em}
</style></head><body><div class="card">${body}</div></body></html>`;
}

module.exports = function manageRoutes(db) {
  const router = express.Router();

  router.get("/r/:token", (req, res) => {
    const reservation = booking.getByManageToken(db, req.params.token);
    if (!reservation) {
      return res.status(404).type("html").send(
        page("Not found", "<h1>Reservation not found</h1><p class='muted'>This link is not valid.</p>")
      );
    }

    const cancellable = reservation.status === "confirmed";
    res.type("html").send(
      page(
        "Your reservation",
        `<h1>Your reservation</h1>
         <span class="status">${escapeHtml(reservation.status.replace(/_/g, " "))}</span>
         <dl>
           <dt>Reference</dt><dd>${escapeHtml(reservation.reference)}</dd>
           <dt>Date</dt><dd>${escapeHtml(reservation.date)}</dd>
           <dt>Time</dt><dd>${escapeHtml(reservation.time)}</dd>
           <dt>Guests</dt><dd>${reservation.party_size}</dd>
           <dt>Name</dt><dd>${escapeHtml(reservation.guest_name)}</dd>
         </dl>
         ${
           cancellable
             ? `<form method="POST" action="/r/${encodeURIComponent(req.params.token)}/cancel">
                  <button type="submit">Cancel this reservation</button>
                </form>
                <p class="muted">Cancelling releases the hold on your card or
                TWINT account. Nothing is charged.</p>`
             : `<p class="muted">This reservation can no longer be cancelled here.
                Please call the restaurant if you need to change it.</p>`
         }`
      )
    );
  });

  router.post("/r/:token/cancel", (req, res, next) => {
    try {
      const reservation = booking.getByManageToken(db, req.params.token);
      if (!reservation) return res.status(404).type("html").send(page("Not found", "<h1>Not found</h1>"));
      booking.cancel(db, reservation.id);
      res.type("html").send(
        page(
          "Cancelled",
          `<h1>Reservation cancelled</h1>
           <p class="muted">The hold has been released. Reference
           ${escapeHtml(reservation.reference)}.</p>`
        )
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
};
