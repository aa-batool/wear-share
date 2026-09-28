// backend/routes/admin-providers.js
// ------------------------------------------------------------
// Provider intake (API spec Section 3.2). Every route here is
// admin-only — providers are never customer-facing, and nothing
// in this file should ever be reachable from a public route.
// ------------------------------------------------------------

const { randomId, isValidEmail } = require("./util");

function createProvider(db, body) {
  if (!body || !body.name || !body.email) {
    return { status: 400, error: { code: "invalid_body", message: "name and email are required." } };
  }
  if (!isValidEmail(body.email)) {
    return { status: 422, error: { code: "invalid_body", message: "email is not valid." } };
  }

  const id = randomId("prov");
  try {
    db.prepare(
      `INSERT INTO providers (id, name, email, phone, address) VALUES (?, ?, ?, ?, ?)`
    ).run(id, body.name, body.email, body.phone || null, body.address || null);
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return { status: 409, error: { code: "duplicate_email", message: "A provider with that email already exists." } };
    }
    throw e;
  }

  return { status: 201, body: getProvider(db, id).body };
}

function listProviders(db) {
  const rows = db.prepare("SELECT id, name, email, phone, created_at FROM providers ORDER BY created_at DESC").all();
  return { status: 200, body: { providers: rows } };
}

function getProvider(db, id) {
  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(id);
  if (!provider) return { status: 404, error: { code: "provider_not_found", message: "No provider exists with that id." } };

  const items = db
    .prepare("SELECT id, name, status, category, size FROM items WHERE provider_id = ? ORDER BY created_at DESC")
    .all(id);

  return { status: 200, body: { ...provider, items } };
}

// Logs a newly received item for a provider — starts at status
// "intake" until an admin photographs and lists it (matches the
// items table default in schema.js).
function createProviderItem(db, providerId, body) {
  const provider = db.prepare("SELECT id FROM providers WHERE id = ?").get(providerId);
  if (!provider) return { status: 404, error: { code: "provider_not_found", message: "No provider exists with that id." } };

  if (!body || !body.name || !body.category || !body.size || !body.condition) {
    return { status: 400, error: { code: "invalid_body", message: "name, category, size, and condition are required." } };
  }

  const id = randomId("item");
  db.prepare(
    `INSERT INTO items (id, provider_id, name, category, size, condition, color, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'intake')`
  ).run(id, providerId, body.name, body.category, body.size, body.condition, body.color || null);

  return { status: 201, body: db.prepare("SELECT * FROM items WHERE id = ?").get(id) };
}

module.exports = { createProvider, listProviders, getProvider, createProviderItem };