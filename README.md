# ReserveHold — table reservation widget

A small reservation form for restaurants. The guest picks a date, a time, how
many people, enters their details, and approves a **hold** (TWINT or card) that
is only charged if they never show up.

Plain HTML, CSS and JavaScript. No build step, no framework.

```
index.html    the widget markup
styles.css    all styling (scoped under .rw-widget)
i18n.js       all text, in German / French / Italian / English
app.js        all behaviour
server/       the backend: API, booking overview, simulated payments
test/         headless tests (183 checks)
```

## Running it

```
npm install          # once
npm run seed         # create the demo restaurant and its tables
npm run dev          # start the server
```

Then open **https://localhost:3443**. Your browser will warn about the
self-signed certificate — accept it once.

| | |
|---|---|
| Widget | https://localhost:3443 |
| Booking overview | https://localhost:3443/admin |
| Overview login | `admin` / `reservehold-dev` (set `ADMIN_PASSWORD` to change) |

**Why https?** The widget refuses a payment `redirect_url` that is not https,
so an API response can never become an open redirect. The dev server therefore
generates a self-signed certificate on first start rather than weakening that
check. Plain http is also served on port 3000 for API work, but the payment
redirect will not complete there.

To run the tests:

```
npm test             # both suites
npm run test:widget  # front end only, no server needed
npm run test:api     # backend, end to end
```

---

## Settings

Everything is set on the `<div class="rw-widget">` tag in `index.html`:

| Attribute | What it does | Default |
|---|---|---|
| `data-restaurant-id` | **Must be set.** Identifies the restaurant. | — |
| `data-restaurant-name` | Name shown in the header | `Restaurant Name` |
| `data-api-base` | Address of your backend | example URL |
| `data-currency` | Currency code | `CHF` |
| `data-fee-minor` | No-show fee **in cents** (3000 = CHF 30.00) | `3000` |
| `data-min-party` / `data-max-party` | Group size limits | `1` / `9` |
| `data-lead-minutes` | Don't offer a slot starting sooner than this | `60` |
| `data-booking-window-days` | How far ahead people may book | `90` |
| `data-policy-url` | Link to the cancellation policy | *(empty)* |
| `data-privacy-url` | Link to the privacy policy | *(empty)* |
| `data-fallback-slots` | Times used when the server is unreachable | 18:00–21:00 |
| `data-lang` | Force a language (`de`/`fr`/`it`/`en`) | auto-detect |
| `data-embedded` | Add this when pasting into another page, so the widget doesn't change the host page's language attribute | — |

Money is handled in **cents** everywhere so it can never pick up a rounding
error on the way to the payment provider.

---

## The API

All of this is implemented in `server/`. The contract is what the widget
actually parses, so changing a shape here breaks the front end silently —
`test/api.test.js` locks each one down.

### 1. `GET /v1/restaurants/{id}/config`

Sent once when the widget loads. The server is the authority on money, limits
and legal links — the values in the HTML are only a first-paint fallback.

```json
{
  "name": "Kronenhalle",
  "fee_minor": 3000,
  "currency": "CHF",
  "min_party": 1,
  "max_party": 9,
  "lead_minutes": 60,
  "booking_window_days": 90,
  "policy_url": "https://…/cancellation",
  "privacy_url": "https://…/privacy"
}
```

### 2. `GET /v1/restaurants/{id}/availability?date=YYYY-MM-DD&party_size=N`

**This is the important one.** It must take opening hours, table sizes and
existing bookings into account and answer with the times that are genuinely
free for a group that size.

```json
{ "slots": [
  { "time": "19:00", "available": true },
  { "time": "19:30", "available": false }
] }
```

A plain `["19:00", "20:00"]` list also works.

### 3. `POST /v1/reservations`

Creates the reservation and starts the payment hold.

Headers include `Idempotency-Key: <uuid>`. **You must honour it**: if the same
key arrives twice, return the original reservation instead of creating a second
one and a second hold. The widget sends the same key on every retry of the same
booking attempt.

Body:

```json
{
  "restaurant_id": "…", "date": "2026-09-01", "time": "19:00",
  "party_size": 3, "guest_name": "…", "guest_email": "…",
  "guest_phone": "…", "notes": "…", "payment_method": "twint",
  "locale": "de", "quoted_fee_minor": 3000, "quoted_currency": "CHF",
  "return_url": "https://…/book?rw_return=1"
}
```

`quoted_fee_minor` is sent so you can **reject a mismatch**, never so you can
trust it. Recalculate the real amount server-side.

Answer with one of:

| `status` | Meaning | What the widget does |
|---|---|---|
| `confirmed` | Hold is in place | Shows the confirmation |
| `requires_redirect` + `redirect_url` | TWINT / 3-D Secure | Sends the guest there, then polls on return |
| `requires_action` + `client_secret` | Provider SDK step | Calls `window.RW_onRequiresAction` (see below) |
| `pending` | Still processing | Polls until resolved |

`redirect_url` **must be https** — the widget refuses anything else, to avoid
turning your API response into an open redirect.

On a confirmed reservation include:

```json
{ "reference": "RH-4K92", "date": "…", "time": "…", "party_size": 3,
  "guest_email": "…", "manage_url": "https://…/r/RH-4K92" }
```

`manage_url` should be a **signed link** that lets the guest view and cancel
without logging in. Without it, the widget hides the cancel link.

### 4. `GET /v1/reservations/{id}`

Polled after a redirect. Return `{ "status": "confirmed" | "pending" |
"failed" | "cancelled" | "expired", "reservation": { … } }`.

### Errors

Return a JSON body with a `code`. The widget handles `slot_unavailable`
specially — it sends the guest back to step 1 with fresh availability:

```json
{ "code": "slot_unavailable", "message": "…" }
```

### The booking overview

`GET /admin`, behind HTTP Basic auth. Bookings for a date with guest details
and hold status, plus the two actions that matter:

- **Cancel** — voids the hold, frees the table, charges nothing.
- **No-show** — captures the fee. This is the only thing that takes money, so
  it is idempotent: clicking twice still captures once.

The API behind it is `GET /v1/admin/reservations?date&status`,
`POST /v1/admin/reservations/:id/cancel` and `.../no-show`.

### How the backend is built

| Piece | Where | Notes |
|---|---|---|
| Slot generation, table fitting | `server/services/availability.js` | One booking holds one table for `turn_minutes`; tables are never combined |
| Booking, idempotency, settlement | `server/services/booking.js` | Slot re-check, table pick and insert are one transaction |
| Payment hold | `server/services/payments/mock.js` | `authorize` / `capture` / `void` — swap this file for a real provider |
| Storage | `server/db.js` | SQLite via `node:sqlite`, built into Node 22+, no native build |

Things worth knowing:

- **The fee is recalculated server-side.** `quoted_fee_minor` is only ever
  compared against the real figure; a mismatch is rejected.
- **`return_url` is checked against `ALLOWED_ORIGINS`.** It arrives from the
  browser, and reflecting it back unchecked would be an open redirect.
- **Abandoned checkouts expire.** A table is held for `HOLD_MINUTES` while the
  guest pays; a sweeper releases it afterwards, so a closed tab does not block
  a table forever.
- **Two guests, one table.** The last table is decided inside a transaction, so
  the loser gets `slot_unavailable` and the widget sends them back to step 1.

### Configuration

All via environment variables, all with development defaults:

| Variable | Default | |
|---|---|---|
| `PORT` / `HTTPS_PORT` | `3000` / `3443` | |
| `DB_PATH` | `./data/reservehold.db` | |
| `PUBLIC_BASE` | `https://localhost:3443` | Used to build `redirect_url` and `manage_url` |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / `reservehold-dev` | |
| `ALLOWED_ORIGINS` | localhost ports | CORS **and** the `return_url` allowlist |
| `HOLD_MINUTES` | `10` | How long a table is held during payment |

With `NODE_ENV=production` the server refuses to start unless
`ADMIN_PASSWORD`, `ALLOWED_ORIGINS` and `PUBLIC_BASE` are all set explicitly.

### Wiring up a payment SDK

For providers that need an in-page step rather than a redirect, define this
before `app.js` loads:

```js
window.RW_onRequiresAction = async (data, slotElement) => {
  // e.g. Stripe: await stripe.confirmPayment({ clientSecret: data.client_secret })
};
```

---

## What was fixed

**Bugs**

- Step 1 never hid, so every step stacked on top of the previous one. The CSS
  rule excluded step 1 from being hidden at all.
- The confirmation screen appeared as soon as the server accepted the details —
  before any payment happened. With TWINT that is always wrong, since TWINT
  needs a redirect. The widget now only ever shows "Table reserved" after the
  server confirms the hold really exists.
- `index (1).html` was an old copy whose markup crashed `app.js` on line 25 and
  killed the whole script. Renamed to `index (1).html.old-backup`, and `app.js`
  now logs a clear message instead of dying if the markup is wrong.
- A retry after a network timeout could create a second reservation and a
  second CHF 30 hold. Every booking attempt now carries an idempotency key.
- Dates in the past and dates years ahead were both accepted.
- Time slots ignored the date, so at 20:30 you could still book 18:00 tonight.
- Field checking skipped `<textarea>` and the hidden party-size value.
- The payment step crashed if no payment method was pre-selected.
- Errors used `alert()`, which is blocked in the iframes this widget is meant
  to be embedded in. They are now shown inline.

**Added**

- Availability lookup against the server, with a safe fallback and an honest
  "not guaranteed" warning when the server can't be reached.
- German, French, Italian and English, auto-detected from the browser, with a
  switcher in the header. All text lives in `i18n.js`.
- The confirmation now shows the booking reference, date, time and party size,
  plus a cancel link.
- The fee and the restaurant name come from the server instead of being typed
  into the HTML in two places.
- A part-filled form survives an accidental reload.
- Focus moves to each new step and the step list exposes `aria-current`, so
  screen-reader users are told what changed. Completed steps are clickable.
- Stepper buttons grey out at 1 and at the maximum.
- Loading spinner while the server is being contacted.
- Honeypot field and a minimum fill-in time as a first line of defence
  against bots.
- Cancellation and privacy links in the legal text, with a console warning
  when they are not configured.

---

## What is still missing

These cannot be done in the front end. They need a server, an account with a
payment provider, or a decision from you.

1. **A real payment provider.** `server/services/payments/mock.js` simulates
   the hold — it moves no money and asks no bank. Datatrans, Payrexx and Stripe
   all do TWINT + cards in Switzerland; each needs a merchant account. Replace
   that one file, keeping `authorize` / `capture` / `void`, and the booking
   logic does not change.

2. **Hosting.** GitHub Pages serves static files only, so it cannot run this
   server. The deployed widget stays a demo until the API runs somewhere that
   executes Node (Render, Railway and Fly all have free tiers).

3. **Rate limiting and a captcha.** A public endpoint that opens payment holds
   is an attractive target. The honeypot and timing check only stop
   unsophisticated bots; per-IP and per-email limits, plus Cloudflare Turnstile
   or hCaptcha, are still needed.

4. **Confirming the guest's email and phone are real.** Right now anyone can
   type a made-up address. The usual answer is a one-time code by SMS, or
   treating the booking as provisional until the confirmation email is opened.

5. **The actual policy texts.** The demo restaurant points at
   `example.ch` placeholders. Charging someone CHF 30 for a policy they were
   never shown is a weak position, and collecting name, email and phone
   without a privacy notice does not meet the Swiss revDSG or the GDPR.

6. **Check the "released automatically" wording with your provider.** Card
   pre-authorisations typically expire in about a week and the exact behaviour
   depends on the issuing bank; TWINT works differently again. The text
   deliberately no longer promises a specific number of hours — put the real
   figure in only once your provider confirms it in writing.

7. **Timezone handling.** The widget works in the guest's local time, and the
   server stores what it was given. A `timezone` column exists on
   `restaurants` but nothing reads it yet, so a guest booking from abroad can
   still pick a time that means something different in Zurich.

8. **Tables for large groups.** One booking takes one table; tables are never
   combined. `max_party` therefore has to be the largest single table — six in
   the demo data. Anything bigger needs a phone call.
