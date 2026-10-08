// backend/db/index.js
// ------------------------------------------------------------
// Uses Node's built-in node:sqlite (available Node 22.5+) — no
// npm install required, matching the "lightweight, easy to
// maintain" stack decision. Swap this file out for a real
// PostgreSQL connection later without touching schema.js or
// seed.js's logic much, since the SQL here is written to be
// portable (see the tech stack document's SQLite → PostgreSQL
// migration note).
// ------------------------------------------------------------

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const { createSchema } = require("./schema");
const { seedIfEmpty } = require("./seed");
const { syncAdminFromEnv } = require("./admin-account");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "..", "data.sqlite");

const db = new DatabaseSync(DB_PATH);

function init() {
  createSchema(db);
  const seeded = seedIfEmpty(db);
  syncAdminFromEnv(db);
  return { seeded };
}

module.exports = { db, init };