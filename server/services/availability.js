"use strict";
/**
 * Which times are genuinely bookable for a party of a given size.
 *
 * Capacity model: one booking occupies one table for turn_minutes. A slot is
 * available to a party of N if some table with seats >= N is free for a window
 * of turn_minutes around it. Tables are never combined, so max_party should be
 * set to the largest single table.
 */
const { BLOCKING_STATUSES } = require("../db");

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function toHHMM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** Local calendar date as YYYY-MM-DD — never toISOString(), which is UTC. */
function toISODate(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function getRestaurant(db, restaurantId) {
  return db.prepare("SELECT * FROM restaurants WHERE id = ?").get(restaurantId) || null;
}

/** Every slot the opening hours define for that weekday, ignoring bookings. */
function slotGrid(db, restaurant, dateStr) {
  const date = parseISODate(dateStr);
  if (!date) return [];

  const closed = db
    .prepare("SELECT 1 FROM closures WHERE restaurant_id = ? AND date = ?")
    .get(restaurant.id, dateStr);
  if (closed) return [];

  const hours = db
    .prepare("SELECT * FROM opening_hours WHERE restaurant_id = ? AND weekday = ?")
    .get(restaurant.id, date.getDay());
  if (!hours) return [];

  const start = toMinutes(hours.opens);
  const last = toMinutes(hours.last_seating);
  if (start == null || last == null || last < start) return [];

  const out = [];
  for (let m = start; m <= last; m += hours.slot_minutes) out.push(toHHMM(m));
  return out;
}

/**
 * Tables that are free for the whole turn around `time`.
 *
 * Two bookings clash when their turn windows overlap, so this compares
 * intervals rather than exact start times — otherwise a 19:00 booking would
 * look compatible with 19:30 on the same table.
 */
function freeTables(db, restaurant, dateStr, time, opts) {
  const excludeReservationId = (opts && opts.excludeReservationId) || null;
  const startsAt = toMinutes(time);
  if (startsAt == null) return [];
  const endsAt = startsAt + restaurant.turn_minutes;

  const tables = db
    .prepare("SELECT * FROM tables_ WHERE restaurant_id = ? ORDER BY seats ASC, id ASC")
    .all(restaurant.id);

  const placeholders = BLOCKING_STATUSES.map(() => "?").join(",");
  const taken = db
    .prepare(
      "SELECT table_id, time FROM reservations " +
        " WHERE restaurant_id = ? AND date = ? AND table_id IS NOT NULL" +
        "   AND status IN (" +
        placeholders +
        ")" +
        (excludeReservationId ? " AND id <> ?" : "")
    )
    .all(
      ...[restaurant.id, dateStr, ...BLOCKING_STATUSES].concat(
        excludeReservationId ? [excludeReservationId] : []
      )
    );

  const busy = new Set();
  for (const row of taken) {
    const otherStart = toMinutes(row.time);
    if (otherStart == null) continue;
    const otherEnd = otherStart + restaurant.turn_minutes;
    if (startsAt < otherEnd && otherStart < endsAt) busy.add(row.table_id);
  }

  return tables.filter((t) => !busy.has(t.id));
}

/** The smallest table that fits the party, or null. Smallest-first keeps the
 *  big tables available for the groups that actually need them. */
function pickTable(db, restaurant, dateStr, time, partySize, opts) {
  const fits = freeTables(db, restaurant, dateStr, time, opts).filter(
    (t) => t.seats >= partySize
  );
  return fits.length ? fits[0] : null;
}

/** Is `time` far enough in the future to be offered? */
function respectsLeadTime(restaurant, dateStr, time, now) {
  const date = parseISODate(dateStr);
  const minutes = toMinutes(time);
  if (!date || minutes == null) return false;
  const slotAt = new Date(date.getTime());
  slotAt.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return slotAt.getTime() - now.getTime() >= restaurant.lead_minutes * 60000;
}

function withinBookingWindow(restaurant, dateStr, now) {
  const date = parseISODate(dateStr);
  if (!date) return false;
  const today = parseISODate(toISODate(now));
  if (date < today) return false;
  const max = new Date(today.getTime());
  max.setDate(max.getDate() + restaurant.booking_window_days);
  return date <= max;
}

/**
 * The availability payload for the widget: every slot in the grid, each marked
 * available or not. Sending the unavailable ones too lets the guest see that
 * 19:00 exists but is gone, rather than wondering why it vanished.
 */
function availability(db, restaurant, dateStr, partySize, now) {
  const when = now || new Date();
  if (!withinBookingWindow(restaurant, dateStr, when)) return [];

  const size = Math.max(restaurant.min_party, Math.min(restaurant.max_party, partySize || 1));

  return slotGrid(db, restaurant, dateStr)
    .filter((time) => respectsLeadTime(restaurant, dateStr, time, when))
    .map((time) => ({
      time,
      available: !!pickTable(db, restaurant, dateStr, time, size),
    }));
}

module.exports = {
  availability,
  slotGrid,
  freeTables,
  pickTable,
  respectsLeadTime,
  withinBookingWindow,
  getRestaurant,
  toISODate,
  parseISODate,
  toMinutes,
  toHHMM,
};
