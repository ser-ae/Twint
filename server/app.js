"use strict";
/**
 * Builds the express app. Kept separate from index.js so the tests can start
 * it on a random port over plain http, while the dev server runs it over https
 * (which the widget's redirect guard requires).
 */
const path = require("path");
const express = require("express");
const { ROOT } = require("./config");
const dbModule = require("./db");
const publicRoutes = require("./routes/public");
const adminRoutes = require("./routes/admin");
const manageRoutes = require("./routes/manage");
const booking = require("./services/booking");

function corsFor(config) {
  return function (req, res, next) {
    const origin = req.get("Origin");
    // Reflect only known origins — never "*", since these endpoints create
    // payment holds and the admin ones move money.
    if (origin && config.allowedOrigins.includes(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Credentials", "true");
    }
    res.set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, Accept, Authorization");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Max-Age", "600");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  };
}

/**
 * @param {object} config
 * @param {object} [deps.db]  an already-open database (tests pass :memory:)
 */
function createApp(config, deps = {}) {
  const db = deps.db || dbModule.open(config.dbPath);
  const app = express();

  app.disable("x-powered-by");
  app.use(corsFor(config));
  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false }));

  app.get("/health", (req, res) => res.json({ ok: true, env: config.env }));

  app.use(publicRoutes(db, config));
  app.use(manageRoutes(db));
  app.use(adminRoutes(db, config)); // guards only its own routes, not static files

  // Serve the widget itself, so the Testumgebung is same-origin and the
  // whole flow can be driven from one host.
  app.use(express.static(ROOT, { index: "index.html", extensions: ["html"] }));

  // Errors: booking.ApiError carries the code the widget looks for. Anything
  // else is a bug here, so it is logged and reported as a generic failure
  // rather than leaking a stack trace to the guest.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof booking.ApiError) {
      return res.status(err.status).json({ code: err.code, message: err.message });
    }
    console.error("[reservehold]", err);
    res.status(500).json({ code: "server_error", message: "Something went wrong" });
  });

  app.locals.db = db;
  return { app, db };
}

/** Periodically release tables whose checkout was abandoned. */
function startSweeper(db, config) {
  const timer = setInterval(() => {
    try {
      const n = booking.sweepExpiredHolds(db);
      if (n) console.log("[reservehold] released " + n + " expired hold(s)");
    } catch (err) {
      console.error("[reservehold] sweep failed", err);
    }
  }, config.sweepSeconds * 1000);
  timer.unref(); // never keep the process alive just for the sweeper
  return timer;
}

module.exports = { createApp, startSweeper };
