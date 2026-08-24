/* Headless smoke test for the ReserveHold widget. */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const SRC = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
const i18nSrc = fs.readFileSync(path.join(SRC, "i18n.js"), "utf8");
const appSrc = fs.readFileSync(path.join(SRC, "app.js"), "utf8");

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function iso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

async function makeWidget({ fetchImpl, url } = {}) {
  const stripped = html.replace(/<script[^>]*><\/script>/g, "");
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  const dom = new JSDOM(stripped, {
    virtualConsole: vc,
    runScripts: "dangerously",
    url: url || "https://restaurant.example/book",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = fetchImpl || (() => Promise.reject(new TypeError("offline")));
  const errors = [];
  w.addEventListener("error", (e) => errors.push(e.message));
  const origError = w.console.error;
  w.console.error = (...a) => errors.push(String(a[0]));
  w.console.warn = () => {};
  w.eval(i18nSrc);
  w.eval(appSrc);
  await sleep(120);
  return { dom, w, doc: w.document, errors };
}

const visiblePanels = (doc) =>
  [...doc.querySelectorAll("[data-step-panel]")].filter((p) => !p.hidden);

function setVal(w, el, value) {
  el.value = value;
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
  el.dispatchEvent(new w.Event("change", { bubbles: true }));
}

/** Step 1 holds date, time, party size and guest details on one page, so all
 *  of them must be valid before Continue will advance to the payment step. */
async function fillDetails(w, doc, opts = {}) {
  const date = opts.date || iso(new Date(Date.now() + 5 * 864e5));
  setVal(w, doc.querySelector("#rw-date"), date);
  await sleep(80);
  const time = doc.querySelector("#rw-time");
  if (opts.time) time.value = opts.time;
  else if (time.options.length > 1) time.value = time.options[1].value;
  setVal(w, doc.querySelector("#rw-name"), opts.name || "Anna Muster");
  setVal(w, doc.querySelector("#rw-email"), opts.email || "anna@example.ch");
  setVal(w, doc.querySelector("#rw-phone"), opts.phone || "+41 79 123 45 67");
  return date;
}

/** Fill step 1 and cross into the payment step. */
async function advanceToPayment(w, doc, opts) {
  const date = await fillDetails(w, doc, opts);
  doc.querySelector('[data-nav="next"]').click();
  await sleep(30);
  return date;
}

(async () => {
  console.log("\n=== 1. Boot + progressive disclosure ===");
  {
    const { w, doc, errors } = await makeWidget();
    ok("boots with no uncaught errors", errors.length === 0, errors.join(" | "));
    ok("exactly one panel visible on load", visiblePanels(doc).length === 1);
    ok("the visible panel is step 1", visiblePanels(doc)[0]?.dataset.stepPanel === "1");
    ok(
      "step 1 carries the is-visible class",
      doc.querySelector('[data-step-panel="1"]').classList.contains("is-visible")
    );

    // The whole booking is entered on one page now.
    ok("there are exactly two steps", doc.querySelectorAll("[data-step-panel]").length === 2);
    ok(
      "date, time, party and details all sit on step 1",
      ["#rw-date", "#rw-time", "#rw-party", "#rw-name", "#rw-email", "#rw-phone"].every((s) =>
        doc.querySelector('[data-step-panel="1"]').querySelector(s)
      )
    );
    ok(
      "payment method sits on step 2",
      !!doc.querySelector('[data-step-panel="2"]').querySelector('input[name="payment_method"]')
    );

    // One Continue press takes the guest to payment.
    await advanceToPayment(w, doc);
    const vis = visiblePanels(doc);
    ok("after Continue, still exactly one panel visible", vis.length === 1, "got " + vis.length);
    ok("one press reaches the payment step", vis[0]?.dataset.stepPanel === "2");
    ok(
      "step 1 no longer has is-visible",
      !doc.querySelector('[data-step-panel="1"]').classList.contains("is-visible")
    );
    ok("Back button revealed on step 2", doc.querySelector('[data-nav="back"]').hidden === false);
    ok(
      "step 1 indicator marked done",
      doc.querySelector('.rw-steps__item[data-step="1"]').classList.contains("is-done")
    );
    ok(
      "step 2 indicator has aria-current",
      doc.querySelector('.rw-steps__item[data-step="2"]').getAttribute("aria-current") === "step"
    );
    ok(
      "completed step 1 is now a clickable button",
      doc.querySelector('.rw-steps__item[data-step="1"] .rw-steps__btn').disabled === false
    );
    ok(
      "the payment step is the last one, so the button confirms",
      doc.querySelector('[data-nav="next"]').getAttribute("data-final") === "true"
    );
  }

  console.log("\n=== 2. Date limits and validation ===");
  {
    const { w, doc } = await makeWidget();
    const date = doc.querySelector("#rw-date");
    ok("date min is today", date.min === iso(new Date()));
    ok("date max is set (booking window)", !!date.max && date.max > date.min);

    // Empty form must not advance.
    doc.querySelector('[data-nav="next"]').click();
    await sleep(20);
    ok("cannot advance with an empty date", visiblePanels(doc)[0].dataset.stepPanel === "1");
    const err = doc.querySelector("#rw-date").closest(".rw-field").querySelector(".rw-field__error");
    ok("an inline error is shown for the date", err && !err.hidden && err.textContent.length > 0);
    ok("date field marked aria-invalid", date.getAttribute("aria-invalid") === "true");

    // Past date must be rejected.
    setVal(w, date, iso(new Date(Date.now() - 864e5)));
    await sleep(40);
    doc.querySelector('[data-nav="next"]').click();
    await sleep(20);
    ok("past date rejected", visiblePanels(doc)[0].dataset.stepPanel === "1");

    // Far-future date must be rejected.
    setVal(w, date, iso(new Date(Date.now() + 400 * 864e5)));
    await sleep(40);
    doc.querySelector('[data-nav="next"]').click();
    await sleep(20);
    ok("date beyond booking window rejected", visiblePanels(doc)[0].dataset.stepPanel === "1");
  }

  console.log("\n=== 3. Availability ===");
  {
    // Server offline -> fallback slots, minus any already in the past.
    const { w, doc } = await makeWidget();
    setVal(w, doc.querySelector("#rw-date"), iso(new Date(Date.now() + 2 * 864e5)));
    await sleep(80);
    const opts = [...doc.querySelector("#rw-time").options].filter((o) => o.value);
    ok("fallback slots offered when availability API is down", opts.length === 7, "got " + opts.length);
    const status = doc.querySelector("#rw-slot-status");
    ok("guest is warned the times are not guaranteed", !status.hidden && status.classList.contains("is-warn"));
  }
  {
    // Server online -> real slots, respecting `available:false`.
    const fetchImpl = (url) => {
      if (String(url).includes("/availability")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            slots: [
              { time: "19:00", available: true },
              { time: "19:30", available: false },
              { time: "20:00", available: true },
            ],
          }),
        });
      }
      return Promise.reject(new TypeError("offline"));
    };
    const { w, doc } = await makeWidget({ fetchImpl });
    setVal(w, doc.querySelector("#rw-date"), iso(new Date(Date.now() + 2 * 864e5)));
    await sleep(80);
    const opts = [...doc.querySelector("#rw-time").options].filter((o) => o.value);
    ok("server slots replace the fallback list", opts.length === 3, "got " + opts.length);
    ok("a taken slot is disabled", opts.find((o) => o.value === "19:30")?.disabled === true);
    ok("slot warning hidden when the server answered", doc.querySelector("#rw-slot-status").hidden);
  }
  {
    // Today: slots already past must be filtered out of the fallback.
    const { w, doc } = await makeWidget();
    setVal(w, doc.querySelector("#rw-date"), iso(new Date()));
    await sleep(80);
    const opts = [...doc.querySelector("#rw-time").options].filter((o) => o.value);
    const now = new Date();
    const stillPossible = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"].filter((tm) => {
      const [h, m] = tm.split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d.getTime() - now.getTime() >= 60 * 60000;
    });
    ok(
      "today's already-past slots are filtered out",
      opts.length === stillPossible.length,
      "got " + opts.length + " expected " + stillPossible.length
    );
  }

  console.log("\n=== 4. Party-size stepper ===");
  {
    const { w, doc } = await makeWidget();
    const party = doc.querySelector("#rw-party");
    const dec = doc.querySelector('[data-action="decrement"]');
    const inc = doc.querySelector('[data-action="increment"]');
    ok("starts at 2", party.value === "2");
    for (let i = 0; i < 20; i++) inc.click();
    ok("cannot exceed the maximum", party.value === "9", "got " + party.value);
    ok("plus button disabled at the maximum", inc.disabled === true);
    for (let i = 0; i < 20; i++) dec.click();
    ok("cannot go below the minimum", party.value === "1", "got " + party.value);
    ok("minus button disabled at the minimum", dec.disabled === true);
    ok("displayed value tracks the input", doc.querySelector("#rw-party-value").textContent === "1");
  }

  console.log("\n=== 5. Enter key must not submit a half-empty booking ===");
  {
    let posted = 0;
    const fetchImpl = (url, opts) => {
      if (opts && opts.method === "POST") posted++;
      return Promise.reject(new TypeError("offline"));
    };
    const { w, doc } = await makeWidget({ fetchImpl });
    const enter = () =>
      doc
        .querySelector("#rw-reservation-form")
        .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));

    // Date and time alone no longer complete step 1 — the guest details are
    // on the same page now, so Enter must hold position and show errors.
    setVal(w, doc.querySelector("#rw-date"), iso(new Date(Date.now() + 2 * 864e5)));
    await sleep(80);
    const time = doc.querySelector("#rw-time");
    time.value = [...time.options].find((o) => o.value).value;
    enter();
    await sleep(40);
    ok("no reservation POSTed from step 1", posted === 0, "posted " + posted);
    ok("Enter does not advance past missing details", visiblePanels(doc)[0].dataset.stepPanel === "1");
    ok(
      "the missing name is flagged inline",
      doc.querySelector("#rw-name").getAttribute("aria-invalid") === "true"
    );

    // Once the page is complete, Enter advances rather than booking.
    setVal(w, doc.querySelector("#rw-name"), "Anna Muster");
    setVal(w, doc.querySelector("#rw-email"), "anna@example.ch");
    setVal(w, doc.querySelector("#rw-phone"), "+41 79 123 45 67");
    enter();
    await sleep(40);
    ok("Enter advances to payment once step 1 is complete", visiblePanels(doc)[0].dataset.stepPanel === "2");
    ok("still no reservation POSTed", posted === 0, "posted " + posted);
  }

  console.log("\n=== 6. Full booking — confirmed ===");
  {
    const seen = { headers: null, body: null, posts: 0 };
    const fetchImpl = (url, opts) => {
      const u = String(url);
      if (u.includes("/availability")) {
        return Promise.resolve({ ok: true, json: async () => ({ slots: ["19:00", "20:00"] }) });
      }
      if (u.includes("/config")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ fee_minor: 2500, currency: "CHF", name: "Kronenhalle", max_party: 9 }),
        });
      }
      if (opts && opts.method === "POST") {
        seen.posts++;
        seen.headers = opts.headers;
        seen.body = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "confirmed",
            reservation: {
              reference: "RH-4K92",
              date: seen.body.date,
              time: seen.body.time,
              party_size: seen.body.party_size,
              guest_email: seen.body.guest_email,
              manage_url: "https://api.example-reservehold.com/r/RH-4K92",
            },
          }),
        });
      }
      return Promise.reject(new TypeError("offline"));
    };

    const { w, doc } = await makeWidget({ fetchImpl });
    await sleep(60);
    ok("restaurant name comes from the server config", doc.querySelector(".rw-brand__name").textContent === "Kronenhalle");
    ok(
      "fee comes from the server config, not the markup",
      doc.querySelector("#rw-fee-amount").textContent.includes("25"),
      doc.querySelector("#rw-fee-amount").textContent
    );

    const target = await fillDetails(w, doc, { time: "19:00" });
    // Party stepper is on the same page now, so bump it before continuing.
    doc.querySelector('[data-action="increment"]').click();
    doc.querySelector('[data-nav="next"]').click();
    await sleep(30);
    ok("reached the payment step", visiblePanels(doc)[0].dataset.stepPanel === "2");
    ok("payment slot explains the TWINT redirect", doc.querySelector("#rw-payment-slot").textContent.length > 10);

    // Pretend enough time passed to clear the bot-timing check.
    await sleep(3000);
    doc.querySelector("#rw-reservation-form").dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true })
    );
    await sleep(120);

    ok("exactly one POST", seen.posts === 1, "posts " + seen.posts);
    ok("Idempotency-Key header sent", !!(seen.headers && seen.headers["Idempotency-Key"]));
    ok("payload carries the date", seen.body.date === target);
    ok("payload carries the time", seen.body.time === "19:00");
    ok("payload carries party size as a number", seen.body.party_size === 3);
    ok("payload carries the guest email", seen.body.guest_email === "anna@example.ch");
    ok("payload carries a return_url", /rw_return=1/.test(seen.body.return_url || ""));
    ok("payload carries the locale", !!seen.body.locale);

    ok("confirmation is shown", doc.querySelector("#rw-confirmation").hidden === false);
    ok("form is hidden", doc.querySelector("#rw-reservation-form").hidden === true);
    ok("step list is hidden", doc.querySelector("#rw-steps").hidden === true);
    const summary = doc.querySelector("#rw-confirmation-summary").textContent;
    ok("summary shows the booking reference", summary.includes("RH-4K92"), summary);
    ok("summary shows the time", summary.includes("19:00"), summary);
    ok("summary shows the party size", /3/.test(summary), summary);
    ok(
      "confirmation body names the guest email",
      doc.querySelector("#rw-confirmation-body").textContent.includes("anna@example.ch")
    );
    const manage = doc.querySelector("#rw-manage-link");
    ok("a cancel/manage link is offered", manage.hidden === false && manage.href.includes("RH-4K92"));
  }

  console.log("\n=== 7. TWINT redirect must NOT show a fake confirmation ===");
  {
    let assigned = null;
    const fetchImpl = (url, opts) => {
      const u = String(url);
      if (u.includes("/availability")) return Promise.resolve({ ok: true, json: async () => ({ slots: ["19:00"] }) });
      if (u.includes("/config")) return Promise.reject(new TypeError("offline"));
      if (opts && opts.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "requires_redirect",
            reservation_id: "res_123",
            redirect_url: "https://pay.datatrans.com/twint/abc",
          }),
        });
      }
      return Promise.reject(new TypeError("offline"));
    };
    const { w, doc } = await makeWidget({ fetchImpl });

    const target = await advanceToPayment(w, doc, { time: "19:00" });
    await sleep(3000);
    doc.querySelector("#rw-reservation-form").dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true })
    );
    await sleep(120);

    ok("redirect accepted: pending id stored before navigating", w.sessionStorage.getItem("rw:pending") === "res_123", String(w.sessionStorage.getItem("rw:pending")));
    ok("confirmation NOT shown before payment", doc.querySelector("#rw-confirmation").hidden === true);
  }

  console.log("\n=== 8. Rejects a non-https redirect (open-redirect guard) ===");
  {
    let assigned = null;
    const fetchImpl = (url, opts) => {
      const u = String(url);
      if (u.includes("/availability")) return Promise.resolve({ ok: true, json: async () => ({ slots: ["19:00"] }) });
      if (u.includes("/config")) return Promise.reject(new TypeError("offline"));
      if (opts && opts.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "requires_redirect",
            reservation_id: "res_1",
            redirect_url: "http://evil.example/steal",
          }),
        });
      }
      return Promise.reject(new TypeError("offline"));
    };
    const { w, doc } = await makeWidget({ fetchImpl });

    await advanceToPayment(w, doc, { time: "19:00" });
    await sleep(3000);
    doc.querySelector("#rw-reservation-form").dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true })
    );
    await sleep(150);
    ok("insecure redirect refused: nothing stored, no navigation", w.sessionStorage.getItem("rw:pending") === null, String(w.sessionStorage.getItem("rw:pending")));
    ok("form is brought back after the failure", doc.querySelector("#rw-reservation-form").hidden === false);
    const fe = doc.querySelector("#rw-form-error");
    ok("an error is shown inline (not via alert)", !fe.hidden && fe.textContent.length > 0);
  }

  console.log("\n=== 9. Slot taken while filling in the form ===");
  {
    const fetchImpl = (url, opts) => {
      const u = String(url);
      if (u.includes("/availability")) return Promise.resolve({ ok: true, json: async () => ({ slots: ["19:00"] }) });
      if (u.includes("/config")) return Promise.reject(new TypeError("offline"));
      if (opts && opts.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ code: "slot_unavailable", message: "taken" }),
        });
      }
      return Promise.reject(new TypeError("offline"));
    };
    const { w, doc } = await makeWidget({ fetchImpl });
    await advanceToPayment(w, doc, { time: "19:00" });
    await sleep(3000);
    doc.querySelector("#rw-reservation-form").dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true })
    );
    await sleep(150);
    ok("sent back to step 1 to pick another time", visiblePanels(doc)[0].dataset.stepPanel === "1");
    const fe = doc.querySelector("#rw-form-error");
    ok("told the slot was taken", !fe.hidden && fe.textContent.length > 0, fe.textContent);
    ok("button re-enabled for a retry", doc.querySelector('[data-nav="next"]').disabled === false);
    ok("confirmation NOT shown", doc.querySelector("#rw-confirmation").hidden === true);
  }

  console.log("\n=== 10. Honeypot ===");
  {
    let posted = 0;
    const fetchImpl = (url, opts) => {
      const u = String(url);
      if (u.includes("/availability")) return Promise.resolve({ ok: true, json: async () => ({ slots: ["19:00"] }) });
      if (u.includes("/config")) return Promise.reject(new TypeError("offline"));
      if (opts && opts.method === "POST") {
        posted++;
        return Promise.resolve({ ok: true, json: async () => ({ status: "confirmed", reservation: {} }) });
      }
      return Promise.reject(new TypeError("offline"));
    };
    const { w, doc } = await makeWidget({ fetchImpl });
    setVal(w, doc.querySelector("#rw-date"), iso(new Date(Date.now() + 5 * 864e5)));
    await sleep(80);
    doc.querySelector("#rw-time").value = "19:00";
    doc.querySelector('[data-nav="next"]').click();
    await sleep(20);
    doc.querySelector('[data-nav="next"]').click();
    await sleep(20);
    setVal(w, doc.querySelector("#rw-name"), "Bot");
    setVal(w, doc.querySelector("#rw-email"), "bot@example.ch");
    setVal(w, doc.querySelector("#rw-phone"), "+41 79 123 45 67");
    doc.querySelector("#rw-website").value = "http://spam.example";
    doc.querySelector('[data-nav="next"]').click();
    await sleep(3000);
    doc.querySelector("#rw-reservation-form").dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true })
    );
    await sleep(120);
    ok("honeypot submission dropped", posted === 0, "posted " + posted);
  }

  console.log("\n=== 11. Returning from the TWINT redirect ===");
  {
    let polls = 0;
    const fetchImpl = (url) => {
      const u = String(url);
      if (u.includes("/reservations/res_777")) {
        polls++;
        if (polls < 2) return Promise.resolve({ ok: true, json: async () => ({ status: "pending" }) });
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "confirmed",
            reservation: { reference: "RH-777", date: "2026-09-01", time: "19:00", party_size: 2, guest_email: "a@b.ch" },
          }),
        });
      }
      return Promise.reject(new TypeError("offline"));
    };
    const { doc } = await makeWidget({
      fetchImpl,
      url: "https://restaurant.example/book?rw_return=1&rw_reservation=res_777",
    });
    await sleep(200);
    ok("pending screen was used while polling", polls >= 1, "polls " + polls);
    await sleep(4000);
    ok("polled until the server confirmed", polls >= 2, "polls " + polls);
    ok("confirmation shown after the redirect", doc.querySelector("#rw-confirmation").hidden === false);
    ok("pending screen hidden again", doc.querySelector("#rw-pending").hidden === true);
    ok("reference from the server is shown", doc.querySelector("#rw-confirmation-summary").textContent.includes("RH-777"));
  }

  console.log("\n=== 12. Languages ===");
  {
    const { w, doc } = await makeWidget();
    const sel = doc.querySelector("#rw-lang");
    ok("language switcher is populated", sel.options.length === 4, "got " + sel.options.length);
    const setLang = (code) => {
      sel.value = code;
      sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    };
    const navLabel = () => doc.querySelector("[data-nav-label]").textContent;

    setLang("de");
    ok("German applied", doc.querySelector(".rw-header__sub").textContent === "Tisch reservieren");
    ok("widget lang attribute updated", doc.querySelector(".rw-widget").getAttribute("lang") === "de");
    // The nav button label is written from state, not a data-i18n attribute,
    // so it used to keep the old language until the next step navigation.
    ok("German nav button", navLabel() === "Weiter", navLabel());
    setLang("fr");
    ok("French applied", doc.querySelector(".rw-header__sub").textContent === "Réserver une table");
    ok("French nav button", navLabel() === "Continuer", navLabel());
    setLang("it");
    ok("Italian applied", doc.querySelector(".rw-header__sub").textContent === "Prenota un tavolo");
    ok("Italian nav button", navLabel() === "Continua", navLabel());
    setLang("en");
    ok("English applied", doc.querySelector(".rw-header__sub").textContent === "Reserve a table");
    ok("English nav button, without pressing Continue", navLabel() === "Continue", navLabel());
    ok("legal text rendered with the fee", /30/.test(doc.querySelector("#rw-legal").textContent));
    ok("guests hint interpolated", /10/.test(doc.querySelector(".rw-hint").textContent), doc.querySelector(".rw-hint").textContent);

    // Every language must define every key.
    const keys = Object.keys(w.RW_I18N.en);
    let missing = [];
    for (const code of Object.keys(w.RW_I18N)) {
      for (const k of keys) if (!(k in w.RW_I18N[code])) missing.push(code + "." + k);
    }
    ok("no missing translation keys", missing.length === 0, missing.join(", "));

    // The check above compares languages against each other, so a key that is
    // absent from *all* of them passes it — and then renders on screen as the
    // raw key ("step_reservation"). Check the markup's keys really exist.
    const used = new Set([
      ...[...doc.querySelectorAll("[data-i18n]")].map((el) => el.dataset.i18n),
      ...["placeholder", "aria-label", "title"].flatMap((a) =>
        [...doc.querySelectorAll("[data-i18n-" + a + "]")].map((el) =>
          el.getAttribute("data-i18n-" + a)
        )
      ),
    ]);
    const unknown = [...used].filter((k) => !(k in w.RW_I18N.en));
    ok("every key used in the markup exists in the dictionary", unknown.length === 0, unknown.join(", "));
  }

  console.log("\n=== 12b. Switching language on later screens ===");
  {
    // On the final step the same button shows btn_confirm, not btn_continue.
    const { w, doc } = await makeWidget();
    const navLabel = () => doc.querySelector("[data-nav-label]").textContent;
    const setLang = (code) => {
      const sel = doc.querySelector("#rw-lang");
      sel.value = code;
      sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    };

    setLang("en");
    await advanceToPayment(w, doc, { time: "19:00" });

    ok("final step shows the confirm label", navLabel() === "Confirm & place hold", navLabel());
    setLang("de");
    ok(
      "language switch keeps the confirm label, not continue",
      navLabel() === "Bestätigen & sichern",
      navLabel()
    );
  }

  console.log("\n=== 12c. Switching language on the confirmation screen ===");
  {
    // The confirmation is built once from the server response; a language
    // switch there has no step navigation left to trigger a redraw.
    const fetchImpl = (url, opts) => {
      if (/\/availability/.test(url)) return Promise.reject(new TypeError("offline"));
      if (/\/reservations$/.test(url) && opts && opts.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              status: "confirmed",
              reference: "RH-555",
              date: iso(new Date(Date.now() + 5 * 864e5)),
              time: "19:00",
              party_size: 2,
              guest_email: "anna@example.ch",
            }),
        });
      }
      return Promise.reject(new TypeError("offline"));
    };
    const { w, doc } = await makeWidget({ fetchImpl });
    const setLang = (code) => {
      const sel = doc.querySelector("#rw-lang");
      sel.value = code;
      sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    };

    setLang("en");
    await advanceToPayment(w, doc, { time: "19:00" });
    await sleep(3000);
    doc.querySelector("#rw-reservation-form").dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true })
    );
    await sleep(150);

    const summary = () => doc.querySelector("#rw-confirmation-summary").textContent;
    ok("confirmation shown", doc.querySelector("#rw-confirmation").hidden === false);
    ok("English summary labels", /Guests/.test(summary()), summary());

    setLang("de");
    ok("summary re-translated to German", /Gäste/.test(summary()), summary());
    ok("reference survives the re-render", /RH-555/.test(summary()), summary());
    ok(
      "confirmation body re-translated",
      /gesendet/.test(doc.querySelector("#rw-confirmation-body").textContent),
      doc.querySelector("#rw-confirmation-body").textContent
    );
  }

  console.log("\n=== 13. Stale markup must not crash the script ===");
  {
    const old = fs.readFileSync(path.join(SRC, "index (1).html.old-backup"), "utf8").replace(/<script[^>]*><\/script>/g, "");
    const dom = new JSDOM(old, { runScripts: "dangerously", url: "https://x.example/" });
    const w = dom.window;
    w.fetch = () => Promise.reject(new TypeError("offline"));
    const errs = [];
    w.console.error = (...a) => errs.push(String(a[0]));
    w.console.warn = () => {};
    let threw = null;
    try {
      w.eval(i18nSrc);
      w.eval(appSrc);
    } catch (e) {
      threw = e;
    }
    await sleep(60);
    ok("old markup does not throw", threw === null, threw && threw.message);
    ok("it logs a clear diagnostic instead", errs.some((e) => /outdated copy|Required markup/.test(e)), errs.join(" | "));
  }

  console.log("\n=== 14. Draft survives a reload ===");
  {
    const { w, doc } = await makeWidget();
    const target = iso(new Date(Date.now() + 6 * 864e5));
    setVal(w, doc.querySelector("#rw-date"), target);
    await sleep(80);
    setVal(w, doc.querySelector("#rw-name"), "Anna Muster");
    setVal(w, doc.querySelector("#rw-email"), "anna@example.ch");
    await sleep(30);
    const saved = w.sessionStorage.getItem("rw:draft:REPLACE_WITH_RESTAURANT_ID");
    ok("draft written to sessionStorage", !!saved, String(saved));
    const parsed = JSON.parse(saved || "{}");
    ok("draft holds the name", parsed.data?.guest_name === "Anna Muster");
    ok("draft holds the date", parsed.data?.date === target);
  }

  console.log("\n=========================================");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("=========================================\n");
  process.exit(fail ? 1 : 0);
})();
