"use strict";
/**
 * Puts a demo restaurant in the database so the Testumgebung has something to
 * book. Safe to run repeatedly — it upserts rather than duplicating.
 */
const { config } = require("./config");
const dbModule = require("./db");

const TABLES = [
  { label: "T1", seats: 2 },
  { label: "T2", seats: 2 },
  { label: "T3", seats: 4 },
  { label: "T4", seats: 4 },
  { label: "T5", seats: 6 },
];

function seed(db, restaurantId) {
  const id = restaurantId || config.seedRestaurantId;

  db.prepare(
    "INSERT INTO restaurants (id, name, currency, fee_minor, min_party, max_party," +
      " lead_minutes, booking_window_days, turn_minutes, policy_url, privacy_url, timezone)" +
      " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)" +
      " ON CONFLICT(id) DO UPDATE SET name=excluded.name, fee_minor=excluded.fee_minor," +
      " max_party=excluded.max_party"
  ).run(
    id,
    "Kronenhalle (Demo)",
    "CHF",
    3000,
    1,
    6, // the largest single table — parties above this need a phone call
    60,
    90,
    90,
    "https://example.ch/cancellation",
    "https://example.ch/privacy",
    "Europe/Zurich"
  );

  const existingTables = db
    .prepare("SELECT COUNT(*) AS c FROM tables_ WHERE restaurant_id = ?")
    .get(id).c;
  if (!existingTables) {
    const ins = db.prepare("INSERT INTO tables_ (restaurant_id, label, seats) VALUES (?,?,?)");
    for (const t of TABLES) ins.run(id, t.label, t.seats);
  }

  // Open every day, 18:00 with a last seating at 21:30, half-hour slots.
  const hours = db.prepare(
    "INSERT INTO opening_hours (restaurant_id, weekday, opens, last_seating, slot_minutes)" +
      " VALUES (?,?,?,?,?)" +
      " ON CONFLICT(restaurant_id, weekday) DO UPDATE SET opens=excluded.opens," +
      " last_seating=excluded.last_seating, slot_minutes=excluded.slot_minutes"
  );
  for (let weekday = 0; weekday < 7; weekday++) {
    hours.run(id, weekday, "18:00", "21:30", 30);
  }

  return id;
}

if (require.main === module) {
  const db = dbModule.open(config.dbPath);
  const id = seed(db);
  const tables = db.prepare("SELECT COUNT(*) c FROM tables_ WHERE restaurant_id = ?").get(id).c;
  console.log("Seeded restaurant '" + id + "' with " + tables + " tables into " + config.dbPath);
  console.log("Set data-restaurant-id=\"" + id + "\" on the widget to use it.");
}

module.exports = { seed, TABLES };
