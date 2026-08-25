"use strict";
/**
 * All settings come from the environment so nothing secret is committed.
 * The defaults are deliberately development-only — see assertProductionSafe().
 */
const path = require("path");

const ROOT = path.join(__dirname, "..");

function list(value, fallback) {
  return String(value || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  env: process.env.NODE_ENV || "development",

  httpPort: Number(process.env.PORT || 3000),
  httpsPort: Number(process.env.HTTPS_PORT || 3443),

  dbPath: process.env.DB_PATH || path.join(ROOT, "data", "reservehold.db"),

  // The widget refuses a non-https redirect_url, so the test environment has
  // to speak https for the payment redirect to be exercised at all.
  publicBase: process.env.PUBLIC_BASE || "https://localhost:3443",

  adminUser: process.env.ADMIN_USER || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "reservehold-dev",

  // Origins allowed to call the API (CORS) *and* to be redirected back to
  // after payment. return_url is attacker-controlled, so it is checked
  // against this list rather than trusted.
  allowedOrigins: list(
    process.env.ALLOWED_ORIGINS,
    "https://localhost:3443,http://localhost:3000,http://localhost:8080"
  ),

  // How long a table is held while the guest completes payment.
  holdMinutes: Number(process.env.HOLD_MINUTES || 10),
  // How often expired holds are swept back into the pool.
  sweepSeconds: Number(process.env.SWEEP_SECONDS || 60),

  seedRestaurantId: process.env.SEED_RESTAURANT_ID || "demo-restaurant",
};

/** Refuse to boot in production with the development password still in place. */
function assertProductionSafe() {
  if (config.env !== "production") return;
  const problems = [];
  if (!process.env.ADMIN_PASSWORD) problems.push("ADMIN_PASSWORD is not set");
  if (!process.env.ALLOWED_ORIGINS) problems.push("ALLOWED_ORIGINS is not set");
  if (!process.env.PUBLIC_BASE) problems.push("PUBLIC_BASE is not set");
  if (problems.length) {
    throw new Error("Refusing to start in production: " + problems.join("; "));
  }
}

module.exports = { config, assertProductionSafe, ROOT };
