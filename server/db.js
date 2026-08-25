"use strict";
/**
 * SQLite via node:sqlite (built into Node 22+), so there is no native module
 * to compile and no database server to run.
 *
 * Times are stored as plain strings: date "YYYY-MM-DD", time "HH:MM", both in
 * the restaurant's local time. Timestamps are epoch milliseconds.
 * Money is always in minor units (3000 = CHF 30.00).
 */
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS restaurants (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'CHF',
  fee_minor           INTEGER NOT NULL DEFAULT 3000,
  min_party           INTEGER NOT NULL DEFAULT 1,
  max_party           INTEGER NOT NULL DEFAULT 9,
  lead_minutes        INTEGER NOT NULL DEFAULT 60,
  booking_window_days INTEGER NOT NULL DEFAULT 90,
  turn_minutes        INTEGER NOT NULL DEFAULT 90,
  policy_url          TEXT NOT NULL DEFAULT '',
  privacy_url         TEXT NOT NULL DEFAULT '',
  timezone            TEXT NOT NULL DEFAULT 'Europe/Zurich'
);

CREATE TABLE IF NOT EXISTS tables_ (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  label         TEXT NOT NULL,
  seats         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS opening_hours (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  weekday       INTEGER NOT NULL,           -- 0 = Sunday .. 6 = Saturday
  opens         TEXT NOT NULL,              -- 'HH:MM'
  last_seating  TEXT NOT NULL,              -- 'HH:MM', last bookable slot
  slot_minutes  INTEGER NOT NULL DEFAULT 30,
  UNIQUE (restaurant_id, weekday)
);

CREATE TABLE IF NOT EXISTS closures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  date          TEXT NOT NULL,
  reason        TEXT NOT NULL DEFAULT '',
  UNIQUE (restaurant_id, date)
);

CREATE TABLE IF NOT EXISTS reservations (
  id              TEXT PRIMARY KEY,
  reference       TEXT NOT NULL UNIQUE,
  restaurant_id   TEXT NOT NULL REFERENCES restaurants(id),
  date            TEXT NOT NULL,
  time            TEXT NOT NULL,
  party_size      INTEGER NOT NULL,
  table_id        INTEGER REFERENCES tables_(id),
  guest_name      TEXT NOT NULL,
  guest_email     TEXT NOT NULL,
  guest_phone     TEXT NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  payment_method  TEXT NOT NULL,
  locale          TEXT NOT NULL DEFAULT 'de',
  status          TEXT NOT NULL,   -- pending_payment|confirmed|cancelled|no_show|expired|failed
  fee_minor       INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  manage_token    TEXT,
  return_url      TEXT NOT NULL DEFAULT '',
  hold_expires_at INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  provider       TEXT NOT NULL,
  method         TEXT NOT NULL,
  status         TEXT NOT NULL,   -- created|authorized|captured|voided|failed
  amount_minor   INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  provider_ref   TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key            TEXT PRIMARY KEY,
  request_hash   TEXT NOT NULL,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  created_at     INTEGER NOT NULL
);

-- A table can only be taken once per date+time by a booking that still counts.
CREATE INDEX IF NOT EXISTS idx_res_slot
  ON reservations (restaurant_id, date, time, status);
CREATE INDEX IF NOT EXISTS idx_res_lookup
  ON reservations (restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_res_manage
  ON reservations (manage_token);
CREATE INDEX IF NOT EXISTS idx_pay_res
  ON payments (reservation_id);
`;

/** Statuses that still occupy a table. */
const BLOCKING_STATUSES = ["pending_payment", "confirmed", "no_show"];

function open(dbPath) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  // Foreign keys are off by default in SQLite, which quietly permits orphans.
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

/**
 * Run fn inside a transaction. SQLite has no nested transactions, so this is
 * deliberately not reentrant — call it at the outermost level only.
 */
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch (_) {
      /* the transaction was already aborted */
    }
    throw err;
  }
}

module.exports = { open, transaction, BLOCKING_STATUSES, SCHEMA };
