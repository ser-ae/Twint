"use strict";
/**
 * Dev entry point.
 *
 * Runs https as well as http, because app.js refuses a non-https
 * redirect_url — that guard stops an API response from becoming an open
 * redirect, so the test environment works around it with a self-signed
 * certificate rather than weakening it.
 */
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { config, assertProductionSafe, ROOT } = require("./config");
const { createApp, startSweeper } = require("./app");

const CERT_DIR = path.join(ROOT, "data", "certs");

/** Generate a self-signed certificate once, so https just works locally. */
function ensureCertificate() {
  const keyPath = path.join(CERT_DIR, "localhost-key.pem");
  const certPath = path.join(CERT_DIR, "localhost-cert.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  let selfsigned;
  try {
    selfsigned = require("selfsigned");
  } catch (e) {
    return null;
  }

  const pems = selfsigned.generate([{ name: "commonName", value: "localhost" }], {
    days: 365,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
        ],
      },
    ],
  });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  console.log("[reservehold] generated a self-signed certificate in " + CERT_DIR);
  return { key: pems.private, cert: pems.cert };
}

function main() {
  assertProductionSafe();

  const { app, db } = createApp(config);
  startSweeper(db, config);

  http.createServer(app).listen(config.httpPort, () => {
    console.log("  http   http://localhost:" + config.httpPort);
  });

  const creds = ensureCertificate();
  if (creds) {
    https.createServer(creds, app).listen(config.httpsPort, () => {
      console.log("  https  https://localhost:" + config.httpsPort + "   <- open this one");
      console.log("  admin  https://localhost:" + config.httpsPort + "/admin");
      console.log("");
      console.log(
        "  Your browser will warn about the self-signed certificate. Accept it once."
      );
      console.log(
        "  Credentials for /admin: " + config.adminUser + " / " + config.adminPassword
      );
    });
  } else {
    console.warn(
      "\n  [!] 'selfsigned' is not installed, so https is unavailable.\n" +
        "      Run: npm install\n" +
        "      Without https the widget will refuse the payment redirect.\n"
    );
  }
}

if (require.main === module) main();

module.exports = { ensureCertificate };
