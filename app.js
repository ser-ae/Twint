/**
 * ReserveHold widget — vanilla JS, no framework, no build step.
 * Drop into any host page via <script src=".../app.js" defer></script>.
 *
 * Contents
 *   1.  Config              — data-attributes, then overridden by the server
 *   2.  i18n                — DE / FR / IT / EN, see i18n.js
 *   3.  Step machine        — progressive disclosure of the 4 fieldsets
 *   4.  Validation          — inline, per-field, translated
 *   5.  Availability        — real slots from the server, safe fallback
 *   6.  Party-size stepper
 *   7.  Draft persistence   — survives an accidental reload
 *   8.  Payment mount       — provider SDK goes here (see README.md)
 *   9.  Submit + payment continuation (redirect / action / polling)
 *   10. Return from redirect
 *
 * Everything marked "BACKEND" needs a server endpoint that does not exist
 * yet. The widget degrades gracefully when the server is unreachable, but
 * a reservation is only ever shown as confirmed when the server says so.
 */
(function () {
  "use strict";

  var widget = document.querySelector(".rw-widget");
  if (!widget) return;

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------

  function $(sel, root) {
    return (root || widget).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || widget).querySelectorAll(sel));
  }
  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }
  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  /** Local calendar date as YYYY-MM-DD. Never use toISOString() here — that
   *  is UTC and rolls over a day early for anyone east of Greenwich. */
  function toISODate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function parseISODate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  /** Combine a YYYY-MM-DD and an HH:MM into a local Date. */
  function slotDateTime(dateStr, timeStr) {
    var d = parseISODate(dateStr);
    var m = /^(\d{1,2}):(\d{2})$/.exec(timeStr || "");
    if (!d || !m) return null;
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d;
  }
  function addDays(d, n) {
    var c = new Date(d.getTime());
    c.setDate(c.getDate() + n);
    return c;
  }
  /** sessionStorage throws outright in some sandboxed iframes. */
  function safeStorage(kind) {
    try {
      var s = window[kind];
      var k = "__rw_probe__";
      s.setItem(k, "1");
      s.removeItem(k);
      return s;
    } catch (e) {
      return null;
    }
  }
  var sessionStore = safeStorage("sessionStorage");
  var localStore = safeStorage("localStorage");

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    // Fallback for older browsers / insecure contexts.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ---------------------------------------------------------------------
  // 1. Config
  // ---------------------------------------------------------------------

  var d = widget.dataset;
  var cfg = {
    apiBase: (d.apiBase || "https://api.example-reservehold.com").replace(/\/+$/, ""),
    restaurantId: d.restaurantId || "",
    restaurantName: d.restaurantName || "",
    currency: d.currency || "CHF",
    // Money is held in minor units (3000 = CHF 30.00) so it never suffers
    // floating-point rounding on the way to the payment provider.
    feeMinor: Number(d.feeMinor || 3000),
    minParty: Number(d.minParty || 1),
    maxParty: Number(d.maxParty || 9),
    // Don't offer a slot that starts sooner than this many minutes from now.
    leadMinutes: Number(d.leadMinutes || 60),
    bookingWindowDays: Number(d.bookingWindowDays || 90),
    policyUrl: d.policyUrl || "",
    privacyUrl: d.privacyUrl || "",
    fallbackSlots: (d.fallbackSlots || "18:00,18:30,19:00,19:30,20:00,20:30,21:00")
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean),
  };

  if (!cfg.restaurantId || cfg.restaurantId === "REPLACE_WITH_RESTAURANT_ID") {
    console.warn("[ReserveHold] data-restaurant-id is not set — bookings will be rejected.");
  }

  // ---------------------------------------------------------------------
  // 2. i18n
  // ---------------------------------------------------------------------

  var DICT = window.RW_I18N || {};
  var LANGS = (window.RW_LANGS || ["en"]).filter(function (l) {
    return DICT[l];
  });
  var LOCALES = { de: "de-CH", fr: "fr-CH", it: "it-CH", en: "en-CH" };

  function pickInitialLang() {
    var stored = localStore && localStore.getItem("rw:lang");
    if (stored && DICT[stored]) return stored;
    if (d.lang && DICT[d.lang]) return d.lang;
    var nav = (navigator.languages || [navigator.language || "en"]).map(function (l) {
      return String(l).slice(0, 2).toLowerCase();
    });
    for (var i = 0; i < nav.length; i++) {
      if (DICT[nav[i]]) return nav[i];
    }
    return LANGS[0] || "en";
  }

  var lang = pickInitialLang();

  function t(key, vars) {
    var table = DICT[lang] || DICT.en || {};
    var s = table[key];
    if (s == null) s = (DICT.en && DICT.en[key]) || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(vars[k]);
      });
    }
    return s;
  }
  function locale() {
    return LOCALES[lang] || "en-CH";
  }
  function formatMoney(minor) {
    try {
      return new Intl.NumberFormat(locale(), {
        style: "currency",
        currency: cfg.currency,
      }).format(minor / 100);
    } catch (e) {
      return cfg.currency + " " + (minor / 100).toFixed(2);
    }
  }
  function formatDateLong(dateObj) {
    try {
      return new Intl.DateTimeFormat(locale(), {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(dateObj);
    } catch (e) {
      return toISODate(dateObj);
    }
  }

  // ---------------------------------------------------------------------
  // DOM references — every one is optional so a stale copy of the markup
  // degrades instead of throwing and killing the whole script.
  // ---------------------------------------------------------------------

  var form = $("#rw-reservation-form");
  var stepsList = $(".rw-steps");
  var panels = $$("[data-step-panel]").sort(function (a, b) {
    return Number(a.dataset.stepPanel) - Number(b.dataset.stepPanel);
  });
  var backBtn = $('[data-nav="back"]');
  var nextBtn = $('[data-nav="next"]');
  var nextLabel = $("[data-nav-label]");
  var confirmation = $("#rw-confirmation");
  var formError = $("#rw-form-error");
  var dateInput = $("#rw-date");
  var timeSelect = $("#rw-time");
  var slotStatus = $("#rw-slot-status");
  var partyInput = $("#rw-party");
  var partyValue = $("#rw-party-value");
  var honeypot = $("#rw-website");
  var langSelect = $("#rw-lang");

  if (!form || !nextBtn || panels.length === 0) {
    console.error(
      "[ReserveHold] Required markup is missing (form / next button / step panels). " +
        "This page is probably an outdated copy of index.html."
    );
    return;
  }

  var totalSteps = panels.length;
  var currentStep = 1;
  var mountedAt = Date.now();
  var idempotencyKey = uuid();
  var busy = false;
  // Kept so the confirmation screen can be re-rendered on a language change,
  // long after the form fields it was built from have been cleared.
  var lastReservation = null;

  // ---------------------------------------------------------------------
  // Translation application
  // ---------------------------------------------------------------------

  var ATTR_KEYS = ["placeholder", "aria-label", "title"];

  function applyTranslations() {
    widget.setAttribute("lang", lang);
    if (document.documentElement && !document.querySelector(".rw-widget[data-embedded]")) {
      document.documentElement.setAttribute("lang", lang);
    }

    $$("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.dataset.i18n, i18nVars(el));
    });
    ATTR_KEYS.forEach(function (attr) {
      var dataName = "data-i18n-" + attr;
      $$("[" + dataName + "]").forEach(function (el) {
        el.setAttribute(attr, t(el.getAttribute(dataName), i18nVars(el)));
      });
    });

    renderLegal();
    renderFeeAmounts();
    if (timeSelect) updateTimePlaceholder();
    renderPaymentSlot();
    // Both of these write strings whose key depends on runtime state, so they
    // cannot be expressed as static data-i18n attributes and have to be
    // re-run by hand whenever the language changes.
    renderNavLabel();
    renderConfirmation();
    if (langSelect) langSelect.value = lang;
  }

  function i18nVars(el) {
    // Only a couple of strings interpolate, so keep this table tiny.
    var key = el.dataset.i18n || "";
    if (key === "guests_hint") return { max: cfg.maxParty + 1 };
    return null;
  }

  function renderFeeAmounts() {
    $$("[data-fee-amount]").forEach(function (el) {
      el.textContent = formatMoney(cfg.feeMinor);
    });
  }

  function updateTimePlaceholder() {
    var ph = timeSelect.querySelector('option[value=""]');
    if (ph) ph.textContent = t("time_placeholder");
  }

  /** The legal line mixes text with two links, so it is built rather than
   *  translated as one blob. A missing URL renders as plain text and logs a
   *  warning — shipping without a real policy link is a legal risk. */
  function renderLegal() {
    var host = $("#rw-legal");
    if (!host) return;
    host.textContent = "";

    function linkOrText(url, label, what) {
      if (!url) {
        console.warn("[ReserveHold] No " + what + " URL set (data-" + what + "-url). Guests cannot read what they are agreeing to.");
        var strong = document.createElement("strong");
        strong.textContent = label;
        return strong;
      }
      var a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "rw-legal__link";
      a.textContent = label;
      return a;
    }

    var template = t("legal", { fee: formatMoney(cfg.feeMinor) });
    var nodes = {
      "{policy}": linkOrText(cfg.policyUrl, t("legal_policy"), "policy"),
      "{privacy}": linkOrText(cfg.privacyUrl, t("legal_privacy"), "privacy"),
    };

    // Split on the two placeholders, keeping them, then rebuild as nodes.
    template.split(/(\{policy\}|\{privacy\})/).forEach(function (chunk) {
      if (nodes[chunk]) host.appendChild(nodes[chunk]);
      else if (chunk) host.appendChild(document.createTextNode(chunk));
    });
  }

  if (langSelect) {
    LANGS.forEach(function (code) {
      var opt = document.createElement("option");
      opt.value = code;
      opt.textContent = (DICT[code] && DICT[code].lang_name) || code.toUpperCase();
      langSelect.appendChild(opt);
    });
    if (LANGS.length < 2) langSelect.hidden = true;
    langSelect.addEventListener("change", function () {
      if (!DICT[langSelect.value]) return;
      lang = langSelect.value;
      if (localStore) localStore.setItem("rw:lang", lang);
      applyTranslations();
      clearAllFieldErrors();
      renderSlots(lastSlots, lastSlotState);
    });
  }

  // ---------------------------------------------------------------------
  // 3. Step machine
  // ---------------------------------------------------------------------

  /** The primary button cycles through three keys depending on where the
   *  guest is, so it is rendered from state rather than carried in the markup.
   *  Checking `busy` first keeps a language switch mid-submit from replacing
   *  "Processing…" with "Continue". */
  function renderNavLabel() {
    if (!nextLabel) return;
    nextLabel.textContent = busy
      ? t("btn_working")
      : currentStep === totalSteps
      ? t("btn_confirm")
      : t("btn_continue");
  }

  function showStep(n, opts) {
    currentStep = n;

    panels.forEach(function (p) {
      var isCurrent = Number(p.dataset.stepPanel) === n;
      p.classList.toggle("is-visible", isCurrent);
      p.hidden = !isCurrent;
    });

    $$(".rw-steps__item").forEach(function (s) {
      var num = Number(s.dataset.step);
      s.classList.toggle("is-active", num === n);
      s.classList.toggle("is-done", num < n);
      if (num === n) s.setAttribute("aria-current", "step");
      else s.removeAttribute("aria-current");

      var btn = s.querySelector(".rw-steps__btn");
      // Only completed steps are clickable. Jumping forward would skip
      // validation, so those stay disabled rather than looking clickable
      // and then doing nothing.
      if (btn) btn.disabled = num >= n;
    });

    if (backBtn) backBtn.hidden = n === 1;

    var isFinal = n === totalSteps;
    renderNavLabel();
    nextBtn.setAttribute("data-final", isFinal ? "true" : "false");

    if (isFinal) mountPaymentWidget();

    // Move focus into the new panel so screen-reader and keyboard users are
    // told what changed instead of being silently left on the button.
    if (!opts || opts.focus !== false) {
      var panel = panels[n - 1];
      if (panel) {
        panel.setAttribute("tabindex", "-1");
        try {
          panel.focus({ preventScroll: true });
        } catch (e) {
          panel.focus();
        }
      }
    }
    clearFormError();
  }

  function goNext() {
    if (!validateStep(currentStep)) return;
    if (currentStep < totalSteps) showStep(currentStep + 1);
  }

  nextBtn.addEventListener("click", function (e) {
    // The button is type="submit" so that pressing Enter in a text field
    // behaves the same way. On any step but the last we stop the submit and
    // just advance instead.
    if (currentStep < totalSteps) {
      e.preventDefault();
      goNext();
    }
  });

  if (backBtn) {
    backBtn.addEventListener("click", function () {
      if (currentStep > 1) showStep(currentStep - 1);
    });
  }

  if (stepsList) {
    stepsList.addEventListener("click", function (e) {
      var btn = e.target.closest(".rw-steps__btn");
      if (!btn || btn.disabled) return;
      var target = Number(btn.closest(".rw-steps__item").dataset.step);
      if (target < currentStep) showStep(target);
    });
  }

  // ---------------------------------------------------------------------
  // 4. Validation — inline and translated
  // ---------------------------------------------------------------------

  // Deliberately permissive: real addresses are stranger than most regexes
  // allow. The server must still verify by sending the confirmation mail.
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function errorNodeFor(field) {
    var wrap = field.closest(".rw-field") || field.parentElement;
    if (!wrap) return null;
    var node = wrap.querySelector(".rw-field__error");
    if (!node) {
      node = document.createElement("p");
      node.className = "rw-field__error";
      node.id = (field.id || "rw-f" + Math.random().toString(36).slice(2)) + "-error";
      wrap.appendChild(node);
    }
    return node;
  }

  function setFieldError(field, message) {
    var node = errorNodeFor(field);
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
    if (message) {
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", node.id);
      field.classList.add("is-invalid");
    } else {
      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
      field.classList.remove("is-invalid");
    }
  }

  function clearAllFieldErrors() {
    $$(".rw-input").forEach(function (f) {
      setFieldError(f, "");
    });
  }

  function showFormError(message) {
    if (!formError) return;
    formError.textContent = message;
    formError.hidden = !message;
  }
  function clearFormError() {
    showFormError("");
  }

  function maxBookableDate() {
    return addDays(new Date(), cfg.bookingWindowDays);
  }

  /** Returns "" when the field is fine, otherwise a translated message. */
  function fieldProblem(field) {
    var value = (field.value || "").trim();
    var required = field.hasAttribute("required");

    if (required && !value) {
      return field.tagName === "SELECT" && field.id === "rw-time"
        ? t("err_time")
        : t("err_required");
    }
    if (!value) return "";

    if (field.id === "rw-date") {
      var picked = parseISODate(value);
      if (!picked) return t("err_date_past");
      var today = parseISODate(toISODate(new Date()));
      if (picked < today) return t("err_date_past");
      var max = maxBookableDate();
      if (picked > max) return t("err_date_far", { date: formatDateLong(max) });
    }
    if (field.type === "email" && !EMAIL_RE.test(value)) return t("err_email");
    if (field.type === "tel") {
      var digits = value.replace(/\D/g, "");
      if (!/^\+?[\d\s()./-]{7,25}$/.test(value) || digits.length < 7 || digits.length > 15) {
        return t("err_phone");
      }
    }
    if (field.id === "rw-name" && value.length < 2) return t("err_required");
    return "";
  }

  function validateStep(n) {
    var panel = panels[n - 1];
    if (!panel) return true;

    // textarea was missing from the original selector, so a required notes
    // field would have silently passed.
    var fields = $$("input, select, textarea", panel).filter(function (f) {
      return f.type !== "hidden" && f.type !== "radio" && f !== honeypot;
    });

    var firstBad = null;
    fields.forEach(function (f) {
      var problem = fieldProblem(f);
      setFieldError(f, problem);
      if (problem && !firstBad) firstBad = f;
    });

    // Party size is a hidden input, so it is exempt from normal validation.
    // Check it explicitly rather than trusting the DOM.
    if (n === 2 && partyInput) {
      var size = Number(partyInput.value);
      if (!Number.isInteger(size) || size < cfg.minParty || size > cfg.maxParty) {
        partyInput.value = String(clampParty(size));
        renderParty();
      }
    }

    if (firstBad) {
      try {
        firstBad.focus({ preventScroll: false });
      } catch (e) {
        firstBad.focus();
      }
      return false;
    }
    return true;
  }

  // Re-validate as soon as someone fixes a field, but never nag them while
  // they are still mid-typing a field they haven't left yet.
  $$(".rw-input").forEach(function (f) {
    f.addEventListener("blur", function () {
      if (f.value) setFieldError(f, fieldProblem(f));
    });
    f.addEventListener("input", function () {
      if (f.classList.contains("is-invalid")) setFieldError(f, fieldProblem(f));
    });
  });

  // ---------------------------------------------------------------------
  // 5. Availability  (BACKEND: GET /v1/restaurants/:id/availability)
  // ---------------------------------------------------------------------

  var lastSlots = [];
  var lastSlotState = "";
  var availSeq = 0;
  var availAbort = null;

  function bookableFallbackSlots(dateStr) {
    var cutoff = Date.now() + cfg.leadMinutes * 60000;
    return cfg.fallbackSlots.filter(function (time) {
      var when = slotDateTime(dateStr, time);
      return when && when.getTime() >= cutoff;
    });
  }

  function setSlotStatus(message, tone) {
    if (!slotStatus) return;
    slotStatus.textContent = message || "";
    slotStatus.hidden = !message;
    slotStatus.className = "rw-slot-status" + (tone ? " is-" + tone : "");
  }

  function renderSlots(slots, state) {
    lastSlots = slots || [];
    lastSlotState = state || "";
    if (!timeSelect) return;

    var previous = timeSelect.value;
    timeSelect.textContent = "";

    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = t("time_placeholder");
    timeSelect.appendChild(placeholder);

    lastSlots.forEach(function (slot) {
      // Accept both ["18:00"] and [{time:"18:00", available:true}].
      var time = typeof slot === "string" ? slot : slot.time;
      var available = typeof slot === "string" ? true : slot.available !== false;
      if (!time) return;
      var opt = document.createElement("option");
      opt.value = time;
      opt.textContent = time;
      opt.disabled = !available;
      timeSelect.appendChild(opt);
    });

    // Keep the guest's choice if it is still on offer.
    if (previous && lastSlots.some(function (s) {
      var time = typeof s === "string" ? s : s.time;
      var available = typeof s === "string" ? true : s.available !== false;
      return time === previous && available;
    })) {
      timeSelect.value = previous;
    }

    timeSelect.disabled = lastSlots.length === 0;

    if (state === "loading") setSlotStatus(t("slots_loading"), "muted");
    else if (state === "empty") setSlotStatus(t("slots_empty"), "warn");
    else if (state === "offline") setSlotStatus(t("slots_offline"), "warn");
    else setSlotStatus("");
  }

  async function refreshSlots() {
    if (!dateInput || !timeSelect) return;
    var dateStr = dateInput.value;
    if (!dateStr || fieldProblem(dateInput)) {
      renderSlots([], "");
      return;
    }

    var seq = ++availSeq;
    if (availAbort) availAbort.abort();
    availAbort = typeof AbortController !== "undefined" ? new AbortController() : null;

    renderSlots(lastSlots, "loading");

    var partySize = partyInput ? Number(partyInput.value) : cfg.minParty;
    var url =
      cfg.apiBase +
      "/v1/restaurants/" +
      encodeURIComponent(cfg.restaurantId) +
      "/availability?date=" +
      encodeURIComponent(dateStr) +
      "&party_size=" +
      encodeURIComponent(partySize);

    try {
      var res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: availAbort ? availAbort.signal : undefined,
      });
      if (seq !== availSeq) return; // a newer request overtook this one
      if (!res.ok) throw new Error("availability " + res.status);
      var data = await res.json();
      if (seq !== availSeq) return;

      var slots = data.slots || [];
      renderSlots(slots, slots.length ? "" : "empty");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (seq !== availSeq) return;
      // No availability service yet (or it is down). Show the static list,
      // minus anything already in the past, and say it isn't guaranteed.
      console.warn("[ReserveHold] Availability lookup failed, using fallback slots.", err);
      var fallback = bookableFallbackSlots(dateStr);
      renderSlots(fallback, fallback.length ? "offline" : "empty");
    }
  }

  if (dateInput) {
    var today = new Date();
    dateInput.min = toISODate(today);
    dateInput.max = toISODate(maxBookableDate());
    dateInput.addEventListener("change", function () {
      setFieldError(dateInput, fieldProblem(dateInput));
      refreshSlots();
      saveDraft();
    });
  }
  if (timeSelect) {
    timeSelect.addEventListener("change", function () {
      setFieldError(timeSelect, "");
      saveDraft();
    });
  }

  // ---------------------------------------------------------------------
  // 6. Party-size stepper
  // ---------------------------------------------------------------------

  function clampParty(n) {
    if (!Number.isFinite(n)) return cfg.minParty;
    return Math.min(Math.max(Math.round(n), cfg.minParty), cfg.maxParty);
  }

  function renderParty() {
    if (!partyInput) return;
    var n = clampParty(Number(partyInput.value));
    partyInput.value = String(n);
    if (partyValue) partyValue.textContent = String(n);
    $$(".rw-stepper__btn").forEach(function (btn) {
      var atLimit =
        btn.dataset.action === "increment" ? n >= cfg.maxParty : n <= cfg.minParty;
      btn.disabled = atLimit;
    });
  }

  $$(".rw-stepper__btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!partyInput || btn.disabled) return;
      var n = clampParty(Number(partyInput.value));
      partyInput.value = String(clampParty(btn.dataset.action === "increment" ? n + 1 : n - 1));
      renderParty();
      saveDraft();
      // Table availability depends on party size, so re-check the slots.
      refreshSlots();
    });
  });

  // ---------------------------------------------------------------------
  // 7. Draft persistence — an accidental reload should not wipe the form
  // ---------------------------------------------------------------------

  var DRAFT_KEY = "rw:draft:" + cfg.restaurantId;
  var DRAFT_FIELDS = ["date", "time", "party_size", "guest_name", "guest_email", "guest_phone", "notes"];

  function saveDraft() {
    if (!sessionStore) return;
    try {
      var data = {};
      DRAFT_FIELDS.forEach(function (name) {
        var el = form.elements[name];
        if (el && typeof el.value === "string") data[name] = el.value;
      });
      sessionStore.setItem(DRAFT_KEY, JSON.stringify({ v: 1, step: currentStep, data: data }));
    } catch (e) {
      /* quota or privacy mode — not worth interrupting the booking for */
    }
  }

  function restoreDraft() {
    if (!sessionStore) return;
    var raw = sessionStore.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || !parsed.data) return;
      Object.keys(parsed.data).forEach(function (name) {
        var el = form.elements[name];
        if (!el || name === "time") return; // time is restored after slots load
        el.value = parsed.data[name];
      });
      renderParty();
      if (parsed.data.date && dateInput) {
        // Drop a stale draft pointing at a date that has since passed.
        if (fieldProblem(dateInput)) dateInput.value = "";
      }
      pendingTimeRestore = parsed.data.time || "";
    } catch (e) {
      /* corrupt draft — ignore it */
    }
  }

  function clearDraft() {
    if (sessionStore) sessionStore.removeItem(DRAFT_KEY);
  }

  var pendingTimeRestore = "";

  form.addEventListener("input", saveDraft);

  // ---------------------------------------------------------------------
  // 8. Payment mount
  //
  // BACKEND / PROVIDER: this is where the real SDK goes. Pick one:
  //   Stripe    stripe.elements({clientSecret}).create('payment').mount(slot)
  //   Datatrans Datatrans.startPayment({transactionId, ...})
  //   Payrexx   payrexx modal / redirect
  // Until then the slot only explains what is about to happen. It never
  // pretends a hold was placed.
  // ---------------------------------------------------------------------

  function selectedPaymentMethod() {
    var checked = $('input[name="payment_method"]:checked');
    return checked ? checked.value : "twint";
  }

  function renderPaymentSlot() {
    var slot = $("#rw-payment-slot");
    if (!slot) return;
    slot.textContent = selectedPaymentMethod() === "twint" ? t("slot_twint") : t("slot_card");
  }

  function mountPaymentWidget() {
    renderPaymentSlot();
  }

  $$('input[name="payment_method"]').forEach(function (r) {
    r.addEventListener("change", renderPaymentSlot);
  });

  // ---------------------------------------------------------------------
  // 9. Submit
  // ---------------------------------------------------------------------

  function setBusy(state) {
    busy = state;
    nextBtn.disabled = state;
    if (backBtn) backBtn.disabled = state;
    widget.classList.toggle("is-busy", state);
    renderNavLabel();
  }

  async function api(path, options) {
    var opts = options || {};
    var res = await fetch(cfg.apiBase + path, {
      method: opts.method || "GET",
      headers: Object.assign(
        { Accept: "application/json" },
        opts.body ? { "Content-Type": "application/json" } : {},
        opts.headers || {}
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* empty or non-JSON body */
    }

    if (!res.ok) {
      var err = new Error((data && data.message) || "HTTP " + res.status);
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data || {};
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (busy) return;

    // Only the last step actually books. Anything else means the guest hit
    // Enter early — advance instead of submitting a half-empty booking.
    if (currentStep < totalSteps) {
      goNext();
      return;
    }

    // Validate every step, not just the visible one: someone may have gone
    // back and emptied a field after it was first checked.
    for (var n = 1; n <= totalSteps; n++) {
      if (!validateStep(n)) {
        showStep(n);
        return;
      }
    }

    // Cheap bot defences. Neither replaces server-side rate limiting.
    if (honeypot && honeypot.value) {
      console.warn("[ReserveHold] Honeypot filled — dropping submission.");
      return;
    }
    if (Date.now() - mountedAt < 3000) {
      showFormError(t("err_generic"));
      return;
    }

    setBusy(true);
    clearFormError();

    var payload = {
      restaurant_id: cfg.restaurantId,
      date: fieldValue("date"),
      time: fieldValue("time"),
      party_size: partyInput ? Number(partyInput.value) : cfg.minParty,
      guest_name: fieldValue("guest_name"),
      guest_email: fieldValue("guest_email"),
      guest_phone: fieldValue("guest_phone"),
      notes: fieldValue("notes"),
      payment_method: selectedPaymentMethod(),
      locale: lang,
      // The server must re-derive the real amount. This is sent so the
      // server can reject a mismatch, never so it can trust the number.
      quoted_fee_minor: cfg.feeMinor,
      quoted_currency: cfg.currency,
      // Where the provider should send the guest back to after TWINT.
      return_url: returnUrlFor(),
    };

    try {
      var data = await api("/v1/reservations", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: payload,
      });
      await handleReservationResponse(data);
    } catch (err) {
      console.error("[ReserveHold]", err);
      var message = err && err.message;

      if (err && err.code === "slot_unavailable") {
        // Someone booked that table while this guest was filling the form.
        // Send them back to step 1 with fresh availability. showStep()
        // clears the error banner, so set it afterwards.
        backToForm(1);
        showFormError(t("err_slot_gone"));
        refreshSlots();
      } else if (message === "payment_not_completed" || message === "payment_timeout") {
        backToForm(totalSteps);
        showFormError(t("err_payment"));
      } else if (err instanceof TypeError) {
        // fetch() rejects with TypeError when the network is unreachable.
        backToForm(totalSteps);
        showFormError(t("err_network"));
      } else {
        backToForm(totalSteps);
        showFormError(t("err_generic"));
      }
    }
  });

  function fieldValue(name) {
    var el = form.elements[name];
    return el && typeof el.value === "string" ? el.value.trim() : "";
  }

  /** Bring the form back after a failure. pollUntilResolved() hides it to
   *  show the pending spinner, so an error must undo that or the guest is
   *  left staring at an error message with no form under it. */
  function backToForm(step) {
    var pending = $("#rw-pending");
    if (pending) pending.hidden = true;
    if (confirmation) confirmation.hidden = true;
    if (form) form.hidden = false;
    if (stepsList) stepsList.hidden = false;
    setBusy(false);
    showStep(step);
  }

  function returnUrlFor() {
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete("rw_reservation");
      url.searchParams.set("rw_return", "1");
      return url.toString();
    } catch (e) {
      return window.location.href;
    }
  }

  /**
   * A reservation is only "done" when the payment hold actually exists.
   * The old version showed the success screen straight after the POST, which
   * told guests their table was secured before TWINT had been touched.
   */
  async function handleReservationResponse(data) {
    var status = data.status;

    if (status === "confirmed") {
      finishConfirmed(data.reservation || data);
      return;
    }

    if (status === "requires_redirect") {
      var target = data.redirect_url || "";
      // Never follow a non-https redirect: it would be an open redirect
      // straight out of an API response.
      if (!/^https:\/\//i.test(target)) {
        throw new Error("Refusing non-https redirect_url");
      }
      rememberPending(data.reservation_id);
      window.location.assign(target);
      return;
    }

    if (status === "requires_action") {
      // PROVIDER HOOK: hand data.client_secret to the SDK, then poll.
      if (typeof window.RW_onRequiresAction === "function") {
        await window.RW_onRequiresAction(data, $("#rw-payment-slot"));
        await pollUntilResolved(data.reservation_id);
        return;
      }
      throw new Error("requires_action returned but no payment SDK is wired up");
    }

    if (status === "pending") {
      await pollUntilResolved(data.reservation_id);
      return;
    }

    throw new Error("Unexpected reservation status: " + status);
  }

  function rememberPending(id) {
    if (sessionStore && id) sessionStore.setItem("rw:pending", id);
  }

  async function pollUntilResolved(reservationId, timeoutMs) {
    if (!reservationId) throw new Error("No reservation id to poll");
    showPendingState();

    var deadline = Date.now() + (timeoutMs || 90000);
    var delay = 0; // check once immediately, then back off
    var data;

    while (Date.now() < deadline) {
      if (delay) await sleep(delay);
      delay = delay ? Math.min(delay * 1.4, 5000) : 1500;
      try {
        data = await api("/v1/reservations/" + encodeURIComponent(reservationId));
      } catch (err) {
        continue; // transient — keep trying until the deadline
      }
      if (data.status === "confirmed") {
        finishConfirmed(data.reservation || data);
        return;
      }
      if (data.status === "failed" || data.status === "cancelled" || data.status === "expired") {
        throw new Error("payment_not_completed");
      }
    }
    throw new Error("payment_timeout");
  }

  // ---------------------------------------------------------------------
  // Confirmation / pending screens
  // ---------------------------------------------------------------------

  function showPendingState() {
    if (form) form.hidden = true;
    if (stepsList) stepsList.hidden = true;
    var pending = $("#rw-pending");
    if (pending) pending.hidden = false;
    if (confirmation) confirmation.hidden = true;
  }

  function finishConfirmed(reservation) {
    clearDraft();
    if (sessionStore) sessionStore.removeItem("rw:pending");

    var pending = $("#rw-pending");
    if (pending) pending.hidden = true;
    if (form) form.hidden = true;
    if (stepsList) stepsList.hidden = true;
    if (!confirmation) return;

    // Resolve the form fallbacks once, here: the draft has just been cleared
    // and the fields may be reset, so a later re-render cannot re-read them.
    var r = reservation || {};
    lastReservation = {
      date: r.date || (form.elements.date && form.elements.date.value) || "",
      time: r.time || (form.elements.time && form.elements.time.value) || "",
      party_size: r.party_size || (partyInput && Number(partyInput.value)) || 0,
      guest_email:
        r.guest_email || (form.elements.guest_email && form.elements.guest_email.value) || "",
      reference: r.reference,
      manage_url: r.manage_url,
    };

    renderConfirmation();

    confirmation.hidden = false;
    confirmation.setAttribute("tabindex", "-1");
    confirmation.focus();
  }

  /** Rebuilt from `lastReservation` rather than the form, so switching
   *  language on the confirmation screen re-translates it — there is no step
   *  navigation left to trigger a redraw. */
  function renderConfirmation() {
    if (!confirmation || !lastReservation) return;
    var r = lastReservation;

    var body = $("#rw-confirmation-body");
    if (body) body.textContent = t("conf_body", { email: r.guest_email });

    // Show the guest what they actually booked, plus a reference they can
    // quote on the phone. The old screen showed none of this.
    var summary = $("#rw-confirmation-summary");
    if (summary) {
      summary.textContent = "";
      var parsed = parseISODate(r.date);
      var rows = [
        [
          t("conf_when"),
          parsed ? formatDateLong(parsed) + ", " + r.time : r.date + " " + r.time,
        ],
        [t("conf_guests"), t("conf_guests_value", { n: r.party_size })],
      ];
      if (r.reference) rows.unshift([t("conf_ref"), r.reference]);

      rows.forEach(function (row) {
        var dt = document.createElement("dt");
        dt.textContent = row[0];
        var dd = document.createElement("dd");
        dd.textContent = row[1];
        summary.appendChild(dt);
        summary.appendChild(dd);
      });
    }

    var manage = $("#rw-manage-link");
    if (manage) {
      // BACKEND: manage_url should be a signed, single-reservation link so
      // the guest can cancel without logging in.
      if (r.manage_url && /^https:\/\//i.test(r.manage_url)) {
        manage.href = r.manage_url;
        manage.textContent = t("conf_manage");
        manage.hidden = false;
      } else {
        manage.hidden = true;
      }
    }
  }

  // ---------------------------------------------------------------------
  // 10. Coming back from a TWINT / 3-D Secure redirect
  // ---------------------------------------------------------------------

  async function resumeAfterRedirect() {
    var params = new URLSearchParams(window.location.search);
    var id = params.get("rw_reservation") || (sessionStore && sessionStore.getItem("rw:pending"));
    if (!params.has("rw_return") && !params.has("rw_reservation")) return false;
    if (!id) return false;

    try {
      await pollUntilResolved(id, 60000);
    } catch (err) {
      console.error("[ReserveHold]", err);
      backToForm(totalSteps);
      showFormError(t("err_payment"));
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  async function loadRemoteConfig() {
    if (!cfg.restaurantId) return;
    try {
      var data = await api("/v1/restaurants/" + encodeURIComponent(cfg.restaurantId) + "/config");
      // The server is the authority on money, limits and legal links.
      if (typeof data.fee_minor === "number") cfg.feeMinor = data.fee_minor;
      if (data.currency) cfg.currency = data.currency;
      if (typeof data.max_party === "number") cfg.maxParty = data.max_party;
      if (typeof data.min_party === "number") cfg.minParty = data.min_party;
      if (typeof data.lead_minutes === "number") cfg.leadMinutes = data.lead_minutes;
      if (typeof data.booking_window_days === "number") cfg.bookingWindowDays = data.booking_window_days;
      if (data.policy_url) cfg.policyUrl = data.policy_url;
      if (data.privacy_url) cfg.privacyUrl = data.privacy_url;
      if (data.name) cfg.restaurantName = data.name;
    } catch (err) {
      console.warn("[ReserveHold] Config endpoint unavailable, using data-attributes.", err);
    }
  }

  async function boot() {
    applyTranslations();

    var nameEl = $(".rw-brand__name");
    if (nameEl && cfg.restaurantName) nameEl.textContent = cfg.restaurantName;

    renderParty();
    restoreDraft();
    showStep(1, { focus: false });

    // If the guest is arriving back from TWINT, that takes priority over
    // rebuilding the form.
    var resumed = await resumeAfterRedirect();

    await loadRemoteConfig();
    applyTranslations();
    if (nameEl && cfg.restaurantName) nameEl.textContent = cfg.restaurantName;
    if (dateInput) {
      dateInput.min = toISODate(new Date());
      dateInput.max = toISODate(maxBookableDate());
    }
    renderParty();

    if (resumed) return;

    if (dateInput && dateInput.value) {
      await refreshSlots();
      // Put back the time the guest had chosen before the reload, but only
      // if it is still actually on offer.
      if (pendingTimeRestore && timeSelect) {
        timeSelect.value = pendingTimeRestore;
        pendingTimeRestore = "";
      }
    } else {
      // No date chosen yet, so there is nothing to pick a time from.
      renderSlots([], "");
    }
  }

  boot();
})();
