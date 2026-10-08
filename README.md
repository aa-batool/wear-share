# WearShare

An anonymous clothes rental & resale platform. People send in clothes they no longer wear; the platform owner photographs, lists, and ships every item; renters and buyers never learn who originally owned a piece, and providers never learn who ends up with it.

This repository is being built from scratch, following the planning documents listed in [Documentation](#documentation) below. This README will grow alongside the actual code.

---

## Status

🚧 **In progress — frontend and backend are now connected.** Every page reads and writes through the real API and database: browsing, availability, checkout, order tracking, the provider intake form, and the whole admin panel. Not built yet: payments (Stripe), courier integration, and real photo storage. See the build log and "Before going live" below.

---

## Tech Stack (Summary)

| Layer | Choice |
|---|---|
| Frontend | Plain HTML / CSS / JavaScript — no framework, no build step |
| Backend | Node.js (plain `http`, no framework dependency required) |
| Database | SQLite to start (via Node's built-in `node:sqlite`), PostgreSQL later if volume grows |
| Payments | Stripe |
| Photo storage | Cloud object storage (Cloudflare R2 / S3 / Backblaze B2) — added once photo upload is built |
| Delivery | Manual courier booking initially, API integration later |

Full reasoning for each choice is in `docs/tech-stack-document.md`.

---

## Project Structure

```
wear-share/
├── frontend/              # Static pages served to shoppers and providers
│   ├── index.html         # Catalog / browse page
│   ├── item.html          # Item detail page
│   ├── intake.html        # "Send us your clothes" form
│   ├── track-order.html   # Shopper order status lookup
│   ├── styles.css         # Shared design system (used by admin/ too)
│   ├── api.js             # Shared: api() fetch wrapper, esc() HTML-escaper, item normalizer
│   ├── app.js             # Catalog, item detail, calendar, and checkout flow
│   ├── intake.js
│   ├── track-order.js
│   └── admin/             # Owner-facing admin panel (protected, separate from shopper pages)
│       ├── login.html
│       ├── dashboard.html
│       ├── listings.html
│       ├── orders.html
│       ├── payouts.html
│       ├── admin.js
│       ├── listings.js
│       ├── orders.js
│       └── payouts.js
│
├── backend/
│   ├── server.js          # Entry point — serves the frontend + API, boots the database
│   ├── env.js             # Tiny .env loader (no dependency needed)
│   ├── rate-limit.js      # In-memory limiter (admin login, public forms)
│   ├── test/
│   │   └── smoke.js       # End-to-end API test (npm test)
│   ├── db/
│   │   ├── index.js       # Opens the SQLite file, runs schema + seed on boot
│   │   ├── schema.js      # CREATE TABLE statements + public_items view
│   │   └── seed.js        # Demo data: 4 providers, 10 items, 8 orders, 6 payouts
│   └── routes/            # API route handlers, one per resource
│       ├── items.js       # Public: catalog, item detail, availability
│       ├── orders.js      # Public: checkout, order tracking lookup
│       ├── intake.js      # Public: "send us your clothes" submissions
│       ├── photos.js      # Serves item photos as real images (public only if listed)
│       ├── admin-auth.js  # Admin login, session verification
│       ├── admin-providers.js  # Admin: providers + intake
│       ├── admin-items.js      # Admin: listings + photos
│       ├── admin-orders.js     # Admin: orders, status, shipments
│       ├── admin-payouts.js    # Admin: payouts
│       ├── admin-dashboard.js  # Admin: dashboard numbers + recent activity
│       └── util.js        # Shared helpers (ID generation, validation)
│
├── package.json           # npm start / npm test
├── .env.example           # Template for required environment variables
├── .env                   # Your real local config — never committed
├── .gitignore
└── README.md
```

This mirrors the structure agreed in `docs/coding-conventions-document.md`.

---

## Getting Started

### Prerequisites

- **Node.js 22.5+** (for built-in SQLite support without extra installs). Check with:
  ```
  node --version
  ```
- No database server to install for local development — SQLite runs as a single file.

### Setup

1. Clone this repository.
2. Copy the environment template and fill in local/test values:
   ```
   cp .env.example .env
   ```
   See `docs/environment-deployment-guide.md` for what each variable is for and where to get test keys.
3. Run the server:
   ```
   npm start
   ```
   (or `node backend/server.js`). First run creates and seeds `data.sqlite` automatically (git-ignored — each environment gets its own). The console says whether it seeded or found existing data. To start over with fresh demo data, stop the server and delete `data.sqlite`.
4. Open **http://localhost:3000**. The same server serves the pages and the API, so nothing else needs to run.

> **Don't open the pages with VS Code Live Server or by double-clicking the HTML files.** Those serve static files only, so there's no API behind them. The pages will say "isn't connected to the WearShare backend" — that message means exactly this. Always use the address above.

### Trying it out

- **Shopper side:** browse the catalog, pick dates on an item's calendar, place a request, then look it up on the *Track order* page with the reference and email you used. Seeded demo order to try: `ord-1001` / `jamila.r@example.com`.
- **Provider side:** submit the *Send us your clothes* form — it lands in the admin's intake queue.
- **Admin:** http://localhost:3000/admin — demo login `owner@example.com` / `changeme123`. From there: publish the intake item (set a price first), change an order's status, mark a payout paid — and watch the customer-facing pages reflect it.

### Tests

```
npm test
```
Starts a throwaway server on a spare port with a temporary database and runs 251 checks over real HTTP: anonymity (no provider data in any public response), payment method and payment status, booking conflicts, validation, admin auth, photo visibility, rate limiting. It never touches your `data.sqlite`. Needs no dependencies.

There is also a real-browser test of the checkout and payment flow (`backend/test/browser-checkout.js`, 19 checks; `backend/test/browser-lifecycle.js`, 14 checks for cancelling and returns; and `backend/test/browser-delivery.js`, 5 checks for the delivery fee; and `backend/test/browser-provider.js`, 4 checks for the payout box; and `backend/test/browser-ship-backup.js`, 9 checks for the shipment form, backups and spreadsheet export). It needs Playwright, which the project deliberately does not depend on, so it isn't part of `npm test`. Run them with `PLAYWRIGHT_PATH=<path to playwright> node backend/test/browser-checkout.js` (and the same for `browser-lifecycle.js`, `browser-delivery.js`, `browser-provider.js` and `browser-ship-backup.js`).

The browser-level test (22 checks driving the real pages in headless Chromium: booking, tracking, intake, the admin panel, and hostile-input handling) was run with Playwright during development but isn't in the repo yet, since Playwright would be the project's first dependency.

---

## Documentation

All planning documents live alongside this codebase and should be kept up to date as decisions change:

| Document | Covers |
|---|---|
| `project-document.md` | Original concept, problem statement, business model options |
| `feature-document.md` | Full feature breakdown by user role |
| `tech-stack-document.md` | Stack choices and reasoning |
| `timeline-document.md` | Phased build plan |
| `glossary.md` | Plain-language definitions of technical terms used elsewhere |
| `database-schema.md` | Table definitions, relationships, anonymity safeguards |
| `api-specification.md` | Endpoint list, request/response shapes |
| `architecture-document.md` | How components connect; request flow diagrams |
| `environment-deployment-guide.md` | Env vars, local setup, deployment steps |
| `testing-plan.md` | Critical flows and pre-deploy checklist |
| `security-notes.md` | Data handling, access control, incident response |
| `coding-conventions.md` | Naming, file structure, git practices |

*(Not yet in this repo — currently held as standalone documents from planning. Move them into a `/docs` folder here once finalized.)*

---

## Core Design Principle: Anonymity

Providers and customers are never linked directly in the data model or in any public-facing response — see `docs/database-schema.md` (Section 5) and `docs/security-notes.md` (Section 5) for exactly how this is enforced. Any change to routes or queries should be checked against this before merging.

---

## Build Log

A running note of what's actually been built, so this README stays honest about project status:

- [x] Project skeleton (`frontend/`, `backend/`, env template, gitignore)
- [x] Shopper-facing frontend: catalog browse page + item detail page (mock data, no backend yet)
- [x] Provider-facing frontend: "send us your clothes" intake form (mock submit, no backend yet)
- [x] Admin panel: login screen + dashboard overview (mock data, no backend yet)
- [x] Admin panel: listings management — filter, inline status update, edit panel (mock data, no backend yet)
- [x] Admin panel: orders management — filter, inline status update, detail view (mock data, no backend yet)
- [x] Admin panel: payouts — running total, mark-as-paid action (mock data, no backend yet)
- [x] **Admin panel complete** (all four screens built on mock data — dashboard, listings, orders, payouts)
- [x] Checkout flow: real request form (name/email/phone/address) + mock confirmation with order reference
- [x] Shopper order tracking page (mock lookup by order ID + email)
- [x] Admin photo upload UI: add/remove/reorder photos in the listings edit panel (in-memory only, no real storage yet)
- [x] Availability calendar on item detail — click a start date, then an end date directly on the calendar (no length dropdown), conflict detection against booked ranges, month navigation
- [x] Backend: project setup (server entry point, .env loading, router structure)
- [x] Backend: database schema + seed script (`backend/db`) — verified: correct row counts, public_items view filters correctly, admin password hash validates
- [x] Backend: public_items view / anonymity-safe query layer
- [x] Backend: core server (static file serving + health check + consistent JSON error shape) — body parsing and sessions to be added alongside the routes that need them
- [x] Backend: public API endpoints (items, availability, orders, tracking) — verified with real requests: filtering, conflict detection (409), validation (422), no-oracle 404s on order lookup, tracking data
- [x] Backend: admin auth (login + route protection) — verified: wrong credentials rejected, valid login issues a session token, protected routes reject missing/invalid/expired tokens, logout invalidates the session
- [x] Backend: admin API endpoints (providers, items, photos, orders, shipments, payouts) — verified with real requests, including cross-links: publishing an item in admin makes it appear in the public catalog; booking a shipment in admin shows up in the customer tracking lookup; status changes write order history
- [ ] Backend: webhook stubs (Stripe, courier) — deferred until there are real Stripe / courier accounts to point them at
- [x] **Frontend wired to the real backend.** The mock `data.js` / `admin-data.js` files are gone; every page now goes through `frontend/api.js`
  - Shopper pages: catalog + filters, item detail, availability calendar (booked dates come from the server), checkout (`POST /api/orders`, with a clear message if someone else takes the dates first), order tracking, intake form
  - Admin pages: login/logout, dashboard, listings (edit, status, price, photo upload/reorder/delete), orders (status, details with history + shipments), payouts
- [x] Backend additions needed by the wiring (not in the original API spec): public `POST /api/intake`, `GET /api/admin/dashboard`, item photos served from `/api/photos/:id`, `booked_ranges` + `thumbnail_url` on item responses
- [x] Admin sessions moved to an **HttpOnly, SameSite=Strict cookie** — no token in JavaScript-readable storage
- [x] Security hardening done while wiring: all API text is HTML-escaped before rendering (public forms feed the admin panel, so this is a stored-XSS boundary — verified with hostile input); photo uploads accept only PNG/JPEG/WebP/GIF (no SVG); rate limits on login, checkout, intake, and order lookup; request-size limits (413); atomic multi-row writes
- [x] Re-tested everything against the real backend: `npm test` (49/49) and the 22-check browser run (22/22, zero unexpected console errors)
- [x] Bugs found and fixed by that testing: typed-but-unsaved text in the listings edit panel was wiped when a photo was added; "not found" messages fired even when no backend was running (checked HTTP status instead of the API's error code); edit-panel buttons and the footer were unstyled/misaligned
- [x] **Rental dates are checked before a purchase; a booked piece can still be bought, with delivery after the rental.** If a rental is booked ahead of an item (or it's out with a renter), the checkout step shows a clear message — "booked for rental until Nov 17, can't leave us before Nov 18" — and the buyer must tick "I understand it will be delivered after the rental ends" before they can order. The server enforces the same rule (`409 delivery_delayed` unless `acknowledge_delayed_delivery: true`), which covers someone who started checkout before a rental was booked: their form comes back with the notice and their details kept. The order records the delay (`delivery_held`, `deliver_after`, plus a history note), and it appears on the order confirmation, the customer's tracking page, and the admin Orders screen ("Ship after Nov 18"). Existing databases pick up the two new columns automatically on startup. Tested: 64 API checks, plus an 8-check browser run of the flow.
- [x] **A purchased piece disappears from the shop.** The moment a buy order exists, the item is hidden from the catalog, its page, its availability lookup and its photos (one rule, in the `public_items` view), and nobody can rent it or buy it a second time — a shopper who had it open gets "Just missed it" and nothing is ordered (`409 item_sold`). Existing rentals on it are still fulfilled, and the buyer can still track their order. The admin Listings screen still shows the item, flagged "Purchase ord-… — hidden from the shop". Cancelling the purchase order puts the piece back in the shop automatically; nothing else needs to be done. Demo data change: the seeded coat purchase (`ord-1002`) now belongs to a new, already-sold "Camel Wool Overcoat" so the live Fawn Wool Overcoat stays buyable. Tested: 74 API checks plus a 10-check browser run of the buying flow.
- [x] **All prices are in Pakistani rupees (PKR), shown as "Rs 12,775".** Every price on the shopper pages and the admin panel goes through one helper, `formatMoney()` in `frontend/api.js`, so the symbol and number format live in one place. Prices are stored as plain numbers in the database (there's no currency column — the whole site is single-currency). The admin price fields are labelled "(Rs)" and hold the bare number, and the intake form asks for the item's worth in Rs. The demo data was converted at roughly Rs 280 to the dollar, rounded to tidy amounts (for example the Deep Plum Velvet Gown is now Rs 3,650/day or Rs 42,000), and its orders and payouts were recalculated to match (a payout is half the order total). A database created before this change keeps its old dollar-sized numbers until you delete `data.sqlite` and restart, or edit the prices in admin Listings. Tested: the 74 API checks (updated amounts) plus a 9-check browser run covering every place a price appears and a sweep of all pages for stray dollar amounts.
- [x] **Payment page after every rental or purchase: cash on delivery or online.** Clicking "Continue to payment" on the item page saves the shopper's details in the browser tab (`sessionStorage`) and opens `payment.html`, which shows the order summary in rupees and two options: Cash on delivery, or Pay online. The order is only created when they press "Place order" there, so leaving the page leaves nothing behind (no ghost orders blocking dates). The confirmation tells a COD customer to keep the amount ready for the courier, and an online customer where to send it. If the dates were taken, the piece was bought, or a rental was booked ahead of a purchase while they were deciding, the page explains it and nothing is ordered unless they can still proceed. "Edit details" returns to the item page with everything filled in. The order stores `payment_method` (`cod` or `online`); `payment_status` is `unpaid` or `paid`. The customer's tracking page shows the method, the status and, for unpaid online orders, the payment instructions. In admin Orders each order shows a payment chip and a "Mark payment received" / "Mark as not received" button (`PATCH /api/admin/orders/:id/payment`, recorded in the order history). **"Online" is not a card gateway:** it means bank transfer or mobile wallet, with the account details you put in `ONLINE_PAYMENT_INSTRUCTIONS` in `.env` (use `\n` for line breaks; see `.env.example`), and you tick the payment off by hand once the money arrives. Existing databases get the new column automatically; orders made before this change have no payment method. Tested: 91 API checks plus a 16-check browser run.
- [x] **Emails to the owner.** Every new order, new intake and status change is emailed to `wearshare300@gmail.com` (change it with `NOTIFY_EMAIL`): new orders (item, dates, total, payment method, customer details), new intakes (item and provider details), and order status changes, payment received / not received, shipments booked, listing status changes and payouts marked paid. Providers are never emailed, so anonymity is unaffected. It's `backend/mailer.js`, with no npm packages: it talks SMTP itself. Sending happens in the background, so a mail failure never slows or breaks the website; it's just logged (`[email] FAILED ...`) in the server window. **Setup:** the site needs an account to send from. For Gmail, turn on 2-Step Verification, create an App password at https://myaccount.google.com/apppasswords, and put `SMTP_USER` and `SMTP_PASS` in `.env` (see `.env.example`). Without them nothing is sent and the log says so. Tested against a fake mail server (7 checks: only the owner's address is used, the content is right, customer-typed text can't add headers, unchanged saves send nothing); not yet tried against real Gmail.
- [x] **Emails to customers.** From the same account (`wearshare300@gmail.com` by default), a customer is emailed at the address they gave at checkout: an order confirmation straight away (reference, item, dates, total, delivery address, and either "keep Rs X ready for the courier" or the bank details from `ONLINE_PAYMENT_INSTRUCTIONS`, plus the delayed-delivery note if the piece is out on rental), then a short email when the order is confirmed, shipped, delivered, due back, returned, completed or cancelled, when payment is received, and when a shipment is booked (courier and tracking number). They contain only that customer's own order and the item's public name: nothing about the provider, and never your private notes on an order. A recipient address is checked strictly and skipped if it looks odd. Set `CUSTOMER_EMAILS=off` to turn them off, and `PUBLIC_URL` to your site's address so the emails can link to the tracking page. Tested with the fake mail server; not yet tried against real Gmail. Gmail limits a normal account to roughly 500 emails a day, which is plenty at this size.
- [x] **Cancelling, refunds and returns.**
  - **Customers can cancel their own order until it ships.** The tracking page has a "Cancel this order" button (with a confirm step) while the order is pending or confirmed and no shipment has been booked (`POST /api/orders/:id/cancel`, same reference + email check as tracking). Cancelling frees the dates or puts the piece back in the shop. After it ships they're told to contact you. You're emailed when a customer cancels, and the customer gets a confirmation.
  - **Refunds are tracked, not automatic.** Cancelling an order that was already paid (by the customer or by you) marks a refund as due. Orders shows a "refund due" chip, a "Refunds due" filter and a dashboard tile; once you've sent the money back, "Mark refund sent" emails the customer and clears the flag.
  - **Late returns.** A rental that's out with the customer past its end date is flagged "N days late" in Orders, on the dashboard ("Overdue returns") and on the customer's tracking page with the fee so far. The customer gets a reminder email on the day it's due and again, every third day, while it's late; you're told the first time a rental turns late. Reminders run by themselves a few seconds after the server starts and every 3 hours after that (each one is only ever sent once per day), and you can trigger the check yourself with "Send due / late reminders now".
  - **Late fee.** Each late day costs the item's daily rent price, or a flat `LATE_FEE_PER_DAY` Rs amount if you set one in `.env`. The fee is fixed when you record the return.
  - **Recording a return.** For a rental that's out, "Record return..." in the order's details takes a note on its condition, an optional damage charge and a "waive the late fee" tick, then sets the order to Returned, works out the late fee and writes it all to the order history. Choosing "Returned" in the status dropdown does the same without the note. Afterwards you can edit either amount (0 waives it) and mark the charges collected or not collected. The customer sees the late fee, damage charge and whether it's been paid; your condition note stays private.
  - **Smaller changes.** A rental can no longer start in the past (the server refuses it). "Today" is worked out in the shop's time zone (`SHOP_TIMEZONE`, default Asia/Karachi). The demo data includes rentals that are now past their end date, so they show as overdue. Customer emails skip demo addresses on reserved domains such as `example.com`, which can never receive mail. Existing databases get the new order columns automatically. Tested: 158 API checks plus a 13-check browser run.
- [x] **Provider payouts are created automatically.** Once a customer has paid and the order has run its course (a rental that's been returned, or a purchase that's been delivered; "completed" counts for both), the provider's share appears in Payouts as pending, the order history notes it, and you're emailed. The share is 50% of the order total (`PROVIDER_SHARE_PERCENT` in `.env` changes it) and never includes late fees or damage charges. There's one payout per order. A pending payout is withdrawn if the order is cancelled or the payment is un-marked; one you've already paid is left alone. A cancelled order is now final: it can't be reopened from the status dropdown (it would undo the released dates and any refund). Tested in the 170 API checks.
- [x] **Contact details and a Policies page.** Every shopper page's footer shows how to reach you (email, plus WhatsApp and phone if you set them) and a Policies link; the tracking page shows the same under every order, and customer emails end with it. Set them with `CONTACT_EMAIL` (defaults to your notification address), `CONTACT_WHATSAPP` and `CONTACT_PHONE` in `.env`. `policies.html` explains, in plain language, what the site actually does: renting, buying (including waiting for a rental to finish), paying, cancelling and refunds, late returns (the late-fee rule shown there comes from your settings, so it can't disagree with the real charge), damage, and privacy. The payment page tells a renter the late-fee rule and links to the policies just above "Place order". **Read `policies.html` and edit anything that isn't how you want to run things**: it only states rules the site enforces, so things like who pays for return shipping, how long refunds take, or what counts as damage are left for you to add. It's a plain description, not legal advice. The public `GET /api/site` returns only the contact details and late-fee rule. Tested: 172 API checks and 19 browser checks.
- [x] **A piece's status follows its orders.** Listed -> in transit (a rental's outbound shipment is booked, or the order is set to shipped) -> rented (delivered) -> returned (you record the return). A delivered purchase makes the piece sold. If another rental of the same piece is still out, a return doesn't mark it returned; calling off a rental that had already shipped marks it returned too, since the piece needs a look. "Intake" and "retired" are your decisions and are never changed, and "sold" is never undone. **Heads-up:** "returned" takes the piece off the shop (as it always did: it's waiting for you to check and clean it), so after every return you need to set it back to "Listed" in Listings. The dashboard has a "To inspect & relist" tile that counts these and links to them. Tested: 186 API checks and 14 browser checks.
- [x] **Admin login set from `.env`, and safer password storage.** `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` create or update the admin account each time the server starts (a short password, a demo password or a bad email is refused with a message in the server log, leaving the existing login alone). Until they're set, the server warns that the demo login is still active. Passwords were stored as plain SHA-256; they're now salted scrypt hashes compared in constant time, and an older hash is upgraded automatically the next time its owner logs in, so existing databases keep working. Admin email matching is no longer case-sensitive, and `.env` values may be wrapped in quotes. Tested: 200 API checks.
- [x] **Delivery charge.** Set `DELIVERY_FEE` (Rs, flat per order) and optionally `FREE_DELIVERY_OVER` in `.env`. The server works the fee out when the order is created and stores it, so later setting changes don't alter old orders. It's shown on the payment page, confirmation, tracking page, emails and admin Orders. A cancelled paid order refunds the whole total including the fee; the provider's share is worked out on the items only. Tested: 206 API checks and 5 browser checks.
- [x] **Provider payout details.** The intake form has an optional private box ("Where should we send your share?", 300 characters: bank account or JazzCash/Easypaisa number). It's saved on the provider (a returning provider's newest details replace the old ones) and shown only in admin Payouts, next to the provider's email, so you know where to send each payout. It is never on a public page, in any shopper-facing response, or in any email (your own intake email just says "provided"). If a provider left it blank, Payouts says so and their confirmation email asks them to reply with details.
- [x] **Emails to providers.** Providers hear from the site too: (1) their submission arrived (reference, what happens next), (2) their piece is live (the first time it goes from intake to listed), (3) their piece was booked or bought (sent once, when you first move the order past "pending"; item, rental dates and their expected share), and (4) their payout was sent. They never contain anything about the customer, and no bank details. The same safety checks as customer emails apply (strict address check, demo `example.com` addresses skipped), and `PROVIDER_EMAILS=off` turns them off. Tested with the fake mail server (the customer's name, phone and address are checked absent): 221 API checks and 4 browser checks in total.
- [x] **"Book a shipment" in admin Orders.** In an order's details, "Book a shipment..." takes the direction (to the customer, or back from them for a rental), the courier and the tracking number from the courier's receipt. It saves the shipment, emails the customer the courier and number, shows them on the customer's tracking page, and (a tick box, on by default) sets the order to Shipped. Once a shipment is booked the customer can no longer cancel online. Nothing can be shipped for a cancelled order. This records a parcel you've handed to a courier yourself; it doesn't book the courier (that's the courier integration below). The older API call without a tracking number still invents a placeholder one, which the demo data uses. Tested: 238 API checks and 6 browser checks.
- [x] **Backups.** The whole database (orders, listings, photos, payouts) is one file, so a backup is a copy of it. The admin Dashboard has "Download a backup" (a fresh, consistent copy, safe to take while the site is running) and "Save a copy on the server now". The server also saves one itself shortly after it starts if the newest is over 20 hours old, and checks every 3 hours, keeping the newest 14 in a `backups` folder next to `data.sqlite` (`BACKUP_DIR`, `BACKUP_KEEP` and `BACKUP_EVERY=off` change this). Backup files are never served by the website. **Restoring:** stop the server, copy a backup over `data.sqlite` (or over whatever `DATABASE_PATH` points to), start it again. Backups contain customers' and providers' personal details, so keep them private, and copy them somewhere other than this computer now and then (a USB drive or cloud storage), because a copy on the same disk doesn't help if the disk fails. Tested in the 238 API checks and the 6 browser checks.
- [x] **Spreadsheet export.** Orders, Payouts and Listings each have an "Export all to spreadsheet" button that downloads a CSV file (`wearshare-orders-2026-10-08.csv` and so on) which opens in Excel, Google Sheets or Numbers. Orders has the dates, status, items / delivery / total in Rs, payment, late and damage charges, refund state and the customer's name, email, phone and address. Payouts has the provider, their email and "pay to" details, item, order, amount and status. Listings has every item with its prices, status and provider name. They always contain everything, not just what's on screen: filter inside the spreadsheet. Text that a customer typed that starts with `=`, `+`, `-` or `@` gets a leading apostrophe so a spreadsheet can't run it as a formula (ordinary phone numbers such as `+92 300 1234567` are left alone). The files include personal details, so treat them like backups. Tested: 251 API checks and 9 browser checks.
- [x] **Ready for hosting on Render.** `DEPLOY.md` is a step-by-step guide: put the code on GitHub, then (1) a free, password-protected preview for your client and (2) the paid live site with a disk, your domain and email. `render.yaml` (preview) and `render.live.yaml` (live) are the Render settings files. New settings: `SITE_PASSWORD` (a password prompt in front of the whole site, with search engines told to stay away), `SEED_DEMO` (demo data is now off by default when `NODE_ENV=production`, so a live site starts clean and without the demo admin login), `TRUST_PROXY_HOPS` (tells visitors apart behind the host's proxy, so rate limits aren't shared by everyone; ignored unless set), and live-site headers (Secure cookie, HSTS, no framing). The server also prints a loud error if there is no admin account. The admin-only `/api/admin/client-ip` shows what address the server sees, to check `TRUST_PROXY_HOPS`. Why Render and not Vercel: the database is a file and sessions and timers live in the server, which needs an always-on server with a disk. The old "Prototype build" notes were removed from the pages. Tested: `npm run test:hosting` (23 checks, no dependencies).
- [ ] Stripe integration (card payments; would replace the manual online option)
- [ ] Courier integration

## Before Going Live

Things that are fine for local development but must change first:

- **Set your own admin login.** Put `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 10 characters) in `.env`; the server applies them on every start. Until you do, the demo login `owner@example.com` / `changeme123` works and the server warns about it in its log. There's no change-password screen: edit `.env` and restart.
- **Password hashing** is salted scrypt (built into Node), compared in constant time; older SHA-256 hashes are upgraded on login.
- **Photos are stored as base64 inside SQLite.** The API already serves them as normal images, so moving to object storage (R2/S3) only changes `backend/routes/photos.js` and the upload route.
- **No payment gateway.** Customers choose cash on delivery or online; online means a manual bank/wallet transfer. Replace the placeholder text in `ONLINE_PAYMENT_INSTRUCTIONS` with your real account details, and mark payments received by hand in admin Orders until Stripe exists. A pending order blocks its dates until an admin confirms or cancels it.
- **Hosting:** this needs a host that runs Node (Render, Railway, Fly.io, a VPS). **GitHub Pages can't run it** — it only serves static files, and without the API every page shows the "isn't connected" message. Set `NODE_ENV=production` so the session cookie gets the `Secure` flag, and serve over HTTPS.
- **Rate limiting is in memory and keyed on the connecting IP.** Behind a reverse proxy, key on the forwarded address instead, and note it resets on restart.

---

## License

Not yet decided — add before making this repository public, if it ever is.