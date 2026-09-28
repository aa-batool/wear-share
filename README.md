# WearShare

An anonymous clothes rental & resale platform. People send in clothes they no longer wear; the platform owner photographs, lists, and ships every item; renters and buyers never learn who originally owned a piece, and providers never learn who ends up with it.

This repository is being built from scratch, following the planning documents listed in [Documentation](#documentation) below. This README will grow alongside the actual code.

---

## Status

🚧 **In progress.** Full frontend built on mock data (shopper-facing pages + admin panel). Backend has a working server, database schema, and seed data — API endpoints are being built next. See the build log below for exact status.

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
│   ├── app.js              # Catalog, item detail, and checkout flow
│   ├── intake.js
│   ├── track-order.js
│   ├── data.js
│   └── admin/             # Owner-facing admin panel (protected, separate from shopper pages)
│       ├── login.html
│       ├── dashboard.html
│       ├── listings.html
│       ├── orders.html
│       ├── payouts.html
│       ├── admin.js
│       ├── listings.js
│       ├── orders.js
│       ├── payouts.js
│       └── admin-data.js
│
├── backend/
│   ├── server.js          # Entry point — serves the frontend + API, boots the database
│   ├── env.js             # Tiny .env loader (no dependency needed)
│   ├── db/
│   │   ├── index.js       # Opens the SQLite file, runs schema + seed on boot
│   │   ├── schema.js      # CREATE TABLE statements + public_items view
│   │   └── seed.js        # Starter data (matches what the frontend mocks used)
│   └── routes/            # API route handlers, one per resource
│       ├── items.js       # Public: catalog, item detail, availability
│       ├── orders.js      # Public: checkout, order tracking lookup
│       ├── admin-auth.js  # Admin login, session verification
│       ├── admin-providers.js  # Admin: providers + intake
│       ├── admin-items.js      # Admin: listings + photos
│       ├── admin-orders.js     # Admin: orders, status, shipments
│       ├── admin-payouts.js    # Admin: payouts
│       └── util.js        # Shared helpers (ID generation, validation)
│
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
3. Run the backend:
   ```
   node backend/server.js
   ```
   First run creates and seeds `data.sqlite` automatically (git-ignored — each environment gets its own). You'll see a console message confirming whether it seeded or found existing data.
4. Open `http://localhost:3000` in a browser — this now serves the real frontend through the real server. `http://localhost:3000/api/health` should return `{"status":"ok"}`.

Note: only the health check and static file serving are live so far. The actual API endpoints (catalog, orders, admin) are the next thing being built — see the build log below for current status. Until they exist, the frontend still runs on its own mock data files, unaffected by the backend running alongside it.

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
- [ ] Backend: webhook stubs (Stripe, courier)
- [ ] Wire frontend to real backend (replace all mock data.js / admin-data.js reads)
- [ ] Re-test everything against the real backend
- [ ] Backend server serving static frontend
- [ ] Public API: browse catalog, item detail
- [ ] Public API: order creation
- [ ] Admin API: login, listing management
- [ ] Stripe integration
- [ ] Courier integration

---

## License

Not yet decided — add before making this repository public, if it ever is.