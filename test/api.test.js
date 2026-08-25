/* End-to-end tests against a real server instance.
 *
 * Each block gets a fresh in-memory database and its own http listener on a
 * random port, so nothing leaks between tests and they can run in any order.
 * Plain http is fine here: the https requirement is a browser-side guard in
 * app.js, and there is no browser in this file.
 */
const http = require("http");
const dbModule = require("../server/db");
const { seed } = require("../server/seed");
const { createApp } = require("../server/app");
const booking = require("../server/services/booking");

let pass = 0,
  fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (extra ? "  -> " + extra : ""));
  }
}

const RESTAURANT = "test-restaurant";
const ADMIN = "Basic " + Buffer.from("admin:test-password").toString("base64");

function iso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
/** A date far enough ahead that lead_minutes can never bite. */
const SOON = iso(new Date(Date.now() + 3 * 864e5));

/** Start an isolated server. `tables` lets a test shrink the restaurant. */
async function start(opts = {}) {
  const db = dbModule.open(":memory:");
  seed(db, RESTAURANT);

  if (opts.tables) {
    db.exec("DELETE FROM tables_");
    const ins = db.prepare("INSERT INTO tables_ (restaurant_id, label, seats) VALUES (?,?,?)");
    opts.tables.forEach((seats, i) => ins.run(RESTAURANT, "T" + (i + 1), seats));
  }

  const config = {
    env: "test",
    publicBase: "https://localhost:3443",
    allowedOrigins: ["https://localhost:3443", "http://localhost:3000"],
    adminUser: "admin",
    adminPassword: "test-password",
    holdMinutes: opts.holdMinutes == null ? 10 : opts.holdMinutes,
    sweepSeconds: 3600,
    dbPath: ":memory:",
  };

  const { app } = createApp(config, { db });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  return {
    db,
    config,
    base,
    close: () => new Promise((r) => server.close(r)),
    async get(path, headers) {
      const res = await fetch(base + path, { headers: headers || {} });
      return { res, body: await res.json().catch(() => null) };
    },
    async post(path, body, headers) {
      const res = await fetch(base + path, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { res, body: await res.json().catch(() => null) };
    },
  };
}

function bookingBody(over = {}) {
  return Object.assign(
    {
      restaurant_id: RESTAURANT,
      date: SOON,
      time: "19:00",
      party_size: 2,
      guest_name: "Anna Muster",
      guest_email: "anna@example.ch",
      guest_phone: "+41 79 123 45 67",
      notes: "",
      payment_method: "twint",
      locale: "de",
      quoted_fee_minor: 3000,
      quoted_currency: "CHF",
      return_url: "https://localhost:3443/?rw_return=1",
    },
    over
  );
}

/** Drive the mock provider page the way a browser would. */
async function decide(env, redirectUrl, decision) {
  const paymentId = redirectUrl.split("/pay/mock/")[1];
  const res = await fetch(env.base + "/pay/mock/" + paymentId, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "decision=" + decision,
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location") };
}

(async () => {
  console.log("\n=== A1. Config and availability ===");
  {
    const env = await start();
    const cfg = await env.get("/v1/restaurants/" + RESTAURANT + "/config");
    ok("config returns 200", cfg.res.status === 200);
    ok("fee comes from the database", cfg.body.fee_minor === 3000, String(cfg.body.fee_minor));
    ok("currency is CHF", cfg.body.currency === "CHF");
    ok("max_party matches the largest table", cfg.body.max_party === 6, String(cfg.body.max_party));

    const unknown = await env.get("/v1/restaurants/nope/config");
    ok("unknown restaurant is 404", unknown.res.status === 404);

    const av = await env.get(
      "/v1/restaurants/" + RESTAURANT + "/availability?date=" + SOON + "&party_size=2"
    );
    ok("availability returns slots", Array.isArray(av.body.slots) && av.body.slots.length > 0);
    ok(
      "slots have the {time, available} shape",
      av.body.slots.every((s) => typeof s.time === "string" && typeof s.available === "boolean")
    );
    ok("18:00 to 21:30 in half hours is 8 slots", av.body.slots.length === 8, String(av.body.slots.length));

    const bad = await env.get("/v1/restaurants/" + RESTAURANT + "/availability?date=nonsense");
    ok("a malformed date is rejected", bad.res.status === 400);

    const past = await env.get(
      "/v1/restaurants/" + RESTAURANT + "/availability?date=" + iso(new Date(Date.now() - 864e5))
    );
    ok("a past date offers nothing", past.body.slots.length === 0);

    // A party of 6 only fits the single 6-seat table.
    const big = await env.get(
      "/v1/restaurants/" + RESTAURANT + "/availability?date=" + SOON + "&party_size=6"
    );
    ok("a party of 6 still has options", big.body.slots.some((s) => s.available));
    await env.close();
  }

  console.log("\n=== A2. A booking, end to end ===");
  {
    const env = await start();
    const created = await env.post("/v1/reservations", bookingBody(), {
      "Idempotency-Key": "key-happy-path",
    });
    ok("POST returns 201", created.res.status === 201, String(created.res.status));
    ok("status is requires_redirect", created.body.status === "requires_redirect", created.body.status);
    ok("a redirect_url is given", /\/pay\/mock\//.test(created.body.redirect_url || ""));
    ok(
      "redirect_url is https, as app.js demands",
      /^https:\/\//.test(created.body.redirect_url || ""),
      created.body.redirect_url
    );

    const pending = await env.get("/v1/reservations/" + created.body.reservation_id);
    ok("before payment the status polls as pending", pending.body.status === "pending", pending.body.status);
    ok("no manage_url before confirmation", !pending.body.reservation.manage_url);

    const decided = await decide(env, created.body.redirect_url, "approve");
    ok("approving redirects the guest back", decided.status === 303, String(decided.status));
    ok(
      "the return carries rw_reservation, which resumeAfterRedirect() reads",
      (decided.location || "").includes("rw_reservation=" + created.body.reservation_id),
      decided.location
    );

    const done = await env.get("/v1/reservations/" + created.body.reservation_id);
    ok("polling now returns confirmed", done.body.status === "confirmed", done.body.status);
    ok("a reference is issued", /^RH-[A-Z2-9]{6}$/.test(done.body.reservation.reference || ""), done.body.reservation.reference);
    ok("a manage_url is offered", /\/r\/[a-f0-9]{48}$/.test(done.body.reservation.manage_url || ""), done.body.reservation.manage_url);
    ok("the guest email comes back", done.body.reservation.guest_email === "anna@example.ch");

    const payment = env.db.prepare("SELECT * FROM payments WHERE reservation_id = ?").get(created.body.reservation_id);
    ok("the hold is authorized, not captured", payment.status === "authorized", payment.status);
    await env.close();
  }

  console.log("\n=== A3. Idempotency ===");
  {
    const env = await start();
    const body = bookingBody({ time: "19:30" });
    const first = await env.post("/v1/reservations", body, { "Idempotency-Key": "key-repeat" });
    const second = await env.post("/v1/reservations", body, { "Idempotency-Key": "key-repeat" });

    ok("the replay is accepted", second.res.status === 200, String(second.res.status));
    ok(
      "the same reservation comes back",
      second.body.reservation_id === first.body.reservation_id,
      first.body.reservation_id + " vs " + second.body.reservation_id
    );

    const count = env.db.prepare("SELECT COUNT(*) c FROM reservations").get().c;
    ok("only one reservation exists", count === 1, "got " + count);
    const holds = env.db.prepare("SELECT COUNT(*) c FROM payments").get().c;
    ok("only one hold was opened — no double charge", holds === 1, "got " + holds);

    // Same key, different booking: that is a client bug, not a retry.
    const different = await env.post("/v1/reservations", bookingBody({ time: "20:00" }), {
      "Idempotency-Key": "key-repeat",
    });
    ok("reusing a key for a different booking is refused", different.res.status === 409, String(different.res.status));
    ok("with a machine-readable code", different.body.code === "idempotency_key_reuse", different.body.code);
    await env.close();
  }

  console.log("\n=== A4. The last table ===");
  {
    // One table for two: the second party of 2 must be turned away.
    const env = await start({ tables: [2] });
    const first = await env.post("/v1/reservations", bookingBody(), { "Idempotency-Key": "k1" });
    ok("the first booking is accepted", first.res.status === 201);

    const second = await env.post(
      "/v1/reservations",
      bookingBody({ guest_email: "bob@example.ch", guest_name: "Bob Muster" }),
      { "Idempotency-Key": "k2" }
    );
    ok("the second is refused", second.res.status === 409, String(second.res.status));
    ok(
      "with slot_unavailable, which sends the widget back to step 1",
      second.body.code === "slot_unavailable",
      second.body.code
    );

    const av = await env.get(
      "/v1/restaurants/" + RESTAURANT + "/availability?date=" + SOON + "&party_size=2"
    );
    ok("19:00 now reads as unavailable", av.body.slots.find((s) => s.time === "19:00").available === false);
    ok(
      "a slot beyond the 90-minute turn is still free",
      av.body.slots.find((s) => s.time === "20:30").available === true
    );
    ok(
      "a slot inside the turn is blocked",
      av.body.slots.find((s) => s.time === "19:30").available === false
    );
    await env.close();
  }

  console.log("\n=== A5. Declined payment ===");
  {
    const env = await start({ tables: [2] });
    const created = await env.post("/v1/reservations", bookingBody(), { "Idempotency-Key": "k-decline" });
    await decide(env, created.body.redirect_url, "decline");

    const after = await env.get("/v1/reservations/" + created.body.reservation_id);
    ok("the reservation ends as failed", after.body.status === "failed", after.body.status);

    const av = await env.get(
      "/v1/restaurants/" + RESTAURANT + "/availability?date=" + SOON + "&party_size=2"
    );
    ok("the table is free again", av.body.slots.find((s) => s.time === "19:00").available === true);

    // A refresh of the mock page must not resurrect a declined payment.
    const again = await decide(env, created.body.redirect_url, "approve");
    const still = await env.get("/v1/reservations/" + created.body.reservation_id);
    ok("re-approving a declined payment does nothing", still.body.status === "failed", still.body.status);
    await env.close();
  }

  console.log("\n=== A6. Abandoned checkouts expire ===");
  {
    const env = await start({ tables: [2], holdMinutes: 0 });
    const created = await env.post("/v1/reservations", bookingBody(), { "Idempotency-Key": "k-expire" });
    ok("the table is held while paying", created.res.status === 201);

    let av = await env.get(
      "/v1/restaurants/" + RESTAURANT + "/availability?date=" + SOON + "&party_size=2"
    );
    ok("the slot is blocked before the sweep", av.body.slots.find((s) => s.time === "19:00").available === false);

    const released = booking.sweepExpiredHolds(env.db, Date.now() + 1000);
    ok("the sweep releases one hold", released === 1, String(released));

    const after = await env.get("/v1/reservations/" + created.body.reservation_id);
    ok("the reservation is marked expired", after.body.status === "expired", after.body.status);

    av = await env.get(
      "/v1/restaurants/" + RESTAURANT + "/availability?date=" + SOON + "&party_size=2"
    );
    ok("the table returns to the pool", av.body.slots.find((s) => s.time === "19:00").available === true);
    await env.close();
  }

  console.log("\n=== A7. What the client sends is not trusted ===");
  {
    const env = await start();

    const cheap = await env.post("/v1/reservations", bookingBody({ quoted_fee_minor: 1 }), {
      "Idempotency-Key": "k-fee",
    });
    ok("a forged fee is rejected", cheap.res.status === 409, String(cheap.res.status));
    ok("with fee_mismatch", cheap.body.code === "fee_mismatch", cheap.body.code);

    const evil = await env.post(
      "/v1/reservations",
      bookingBody({ return_url: "https://evil.example/steal" }),
      { "Idempotency-Key": "k-evil" }
    );
    ok("a return_url off the allowlist is rejected", evil.res.status === 400, String(evil.res.status));
    ok("with invalid_return_url", evil.body.code === "invalid_return_url", evil.body.code);

    const junk = await env.post("/v1/reservations", bookingBody({ guest_email: "not-an-email" }), {
      "Idempotency-Key": "k-junk",
    });
    ok("a bad email is rejected", junk.res.status === 400, String(junk.res.status));

    const huge = await env.post("/v1/reservations", bookingBody({ party_size: 99 }), {
      "Idempotency-Key": "k-huge",
    });
    ok("a party larger than any table is rejected", huge.res.status === 400, String(huge.res.status));

    const yesterday = await env.post(
      "/v1/reservations",
      bookingBody({ date: iso(new Date(Date.now() - 864e5)) }),
      { "Idempotency-Key": "k-past" }
    );
    ok("a date in the past is rejected", yesterday.res.status === 400, String(yesterday.res.status));
    ok("no reservation rows were created at all", env.db.prepare("SELECT COUNT(*) c FROM reservations").get().c === 0);
    await env.close();
  }

  console.log("\n=== A8. The booking overview ===");
  {
    const env = await start();
    const created = await env.post("/v1/reservations", bookingBody(), { "Idempotency-Key": "k-admin" });
    await decide(env, created.body.redirect_url, "approve");

    const anon = await env.get("/v1/admin/reservations?date=" + SOON);
    ok("the overview refuses anonymous access", anon.res.status === 401, String(anon.res.status));
    ok("and asks for credentials", !!anon.res.headers.get("www-authenticate"));

    const wrong = await env.get("/v1/admin/reservations", {
      Authorization: "Basic " + Buffer.from("admin:wrong").toString("base64"),
    });
    ok("a wrong password is refused", wrong.res.status === 401);

    const list = await env.get("/v1/admin/reservations?date=" + SOON, { Authorization: ADMIN });
    ok("the overview lists the booking", list.body.reservations.length === 1, String(list.body.reservations.length));
    ok("covers are counted", list.body.totals.covers === 2, String(list.body.totals.covers));
    ok("the guest phone is shown for the restaurant", list.body.reservations[0].guest_phone.length > 5);
    ok("the hold state is shown", list.body.reservations[0].payment_status === "authorized");

    const id = created.body.reservation_id;
    const noShow = await env.post("/v1/admin/reservations/" + id + "/no-show", undefined, {
      Authorization: ADMIN,
    });
    ok("marking a no-show succeeds", noShow.res.status === 200, String(noShow.res.status));

    let payment = env.db.prepare("SELECT * FROM payments WHERE reservation_id = ?").get(id);
    ok("the fee is captured", payment.status === "captured", payment.status);

    // A double click must not charge twice.
    const twice = await env.post("/v1/admin/reservations/" + id + "/no-show", undefined, {
      Authorization: ADMIN,
    });
    ok("marking it again is harmless", twice.res.status === 200, String(twice.res.status));
    const captures = env.db
      .prepare("SELECT COUNT(*) c FROM payments WHERE reservation_id = ? AND status = 'captured'")
      .get(id).c;
    ok("still exactly one capture", captures === 1, String(captures));

    const cancelAfter = await env.post("/v1/admin/reservations/" + id + "/cancel", undefined, {
      Authorization: ADMIN,
    });
    ok("a charged no-show cannot then be cancelled", cancelAfter.res.status === 409, String(cancelAfter.res.status));

    const page = await fetch(env.base + "/admin");
    ok("the overview page needs credentials too", page.status === 401, String(page.status));
    await env.close();
  }

  console.log("\n=== A8b. Admin auth must not leak onto the widget ===");
  {
    // The admin router is mounted at the root, so guarding it with
    // router.use() would 401 every static file the widget needs.
    const env = await start();
    for (const path of ["/", "/index.html", "/app.js", "/styles.css", "/i18n.js"]) {
      const res = await fetch(env.base + path);
      ok("served without admin credentials: " + path, res.status === 200, String(res.status));
    }
    const widget = await (await fetch(env.base + "/")).text();
    ok("the widget markup really is what comes back", widget.includes('class="rw-widget"'));
    await env.close();
  }

  console.log("\n=== A9. Cancelling ===");
  {
    const env = await start({ tables: [2] });
    const created = await env.post("/v1/reservations", bookingBody(), { "Idempotency-Key": "k-cancel" });
    await decide(env, created.body.redirect_url, "approve");
    const id = created.body.reservation_id;

    const res = await env.get("/v1/reservations/" + id);
    const token = res.body.reservation.manage_url.split("/r/")[1];

    const pageRes = await fetch(env.base + "/r/" + token);
    const html = await pageRes.text();
    ok("the manage page loads", pageRes.status === 200);
    ok("it shows the reference", html.includes(res.body.reservation.reference));
    ok("it offers to cancel", html.includes("Cancel this reservation"));

    const cancelRes = await fetch(env.base + "/r/" + token + "/cancel", { method: "POST" });
    ok("cancelling works from the guest link", cancelRes.status === 200);

    const after = await env.get("/v1/reservations/" + id);
    ok("the reservation is cancelled", after.body.status === "cancelled", after.body.status);

    const payment = env.db.prepare("SELECT * FROM payments WHERE reservation_id = ?").get(id);
    ok("the hold is voided, not captured", payment.status === "voided", payment.status);

    const av = await env.get(
      "/v1/restaurants/" + RESTAURANT + "/availability?date=" + SOON + "&party_size=2"
    );
    ok("the table is bookable again", av.body.slots.find((s) => s.time === "19:00").available === true);

    const badToken = await fetch(env.base + "/r/" + "0".repeat(48));
    ok("an unknown token is 404", badToken.status === 404);
    await env.close();
  }

  console.log("\n=== A10. CORS, for the widget on another origin ===");
  {
    const env = await start();
    const preflight = await fetch(env.base + "/v1/reservations", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,idempotency-key",
      },
    });
    ok("preflight is answered", preflight.status === 204, String(preflight.status));
    ok(
      "the allowed origin is reflected",
      preflight.headers.get("access-control-allow-origin") === "http://localhost:3000"
    );
    ok(
      "Idempotency-Key is an allowed header",
      /idempotency-key/i.test(preflight.headers.get("access-control-allow-headers") || "")
    );

    const evil = await fetch(env.base + "/health", { headers: { Origin: "https://evil.example" } });
    ok(
      "an unknown origin is not reflected",
      evil.headers.get("access-control-allow-origin") === null,
      String(evil.headers.get("access-control-allow-origin"))
    );
    await env.close();
  }

  console.log("\n=========================================");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("=========================================\n");
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
