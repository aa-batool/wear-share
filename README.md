# WearShare

An anonymous clothes rental & resale platform. People send in clothes they no longer wear; the platform owner photographs, lists, and ships every item; renters and buyers never learn who originally owned a piece, and providers never learn who ends up with it.

This repository is being built from scratch, following the planning documents listed in [Documentation](#documentation) below. This README will grow alongside the actual code.

---

## Status

🚧 **Early build.** Project skeleton only — no server or frontend code yet. Structure below reflects where things are headed, per the tech stack and architecture documents; sections will be filled in as each piece is built.

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
│   ├── styles.css         # Shared design system (used by admin/ too)
│   ├── app.js
│   ├── intake.js
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
│   ├── server.js          # Entry point — starts the HTTP server
│   ├── routes/            # One file per resource (items.js, orders.js, admin.js, ...)
│   └── db/                # Schema setup and seed data
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
3. Run the backend (once it exists):
   ```
   node backend/server.js
   ```
4. Open `http://localhost:3000` in a browser.

*(Steps 3–4 will become accurate once the server is actually built — tracked in the build log below.)*

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
- [ ] Database schema created (`backend/db`)
- [ ] Backend server serving static frontend
- [ ] Public API: browse catalog, item detail
- [ ] Public API: order creation
- [ ] Admin API: login, listing management
- [ ] Stripe integration
- [ ] Courier integration

---

## License

Not yet decided — add before making this repository public, if it ever is.