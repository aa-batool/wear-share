// backend/routes/util.js
// ------------------------------------------------------------
// Small helpers shared across route files. Kept intentionally
// tiny — this is not the place for business logic specific to
// one resource, just generic bits like ID generation.
// ------------------------------------------------------------

const crypto = require("node:crypto");

function randomId(prefix) {
  return `${prefix}-${crypto.randomInt(100000, 999999)}`;
}

// Like randomId, but checks the table so a (rare) collision can never
// surface as a failed insert. `table` must be a hard-coded name from
// our own code, never user input.
function uniqueId(db, table, prefix) {
  for (let i = 0; i < 20; i++) {
    const id = randomId(prefix);
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) return id;
  }
  throw new Error(`Could not generate a unique ${table} id.`);
}

// Runs several writes as one unit: either all of them land or none do.
// (node:sqlite is synchronous, so nothing can interleave between the
// availability check and the insert inside one of these.)
function transaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

module.exports = { randomId, uniqueId, transaction, isValidEmail, isValidDate };
