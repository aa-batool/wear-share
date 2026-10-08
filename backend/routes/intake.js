// backend/routes/intake.js
// ------------------------------------------------------------
// Public intake submission — what the "Send us your clothes"
// form posts to. This wasn't in the original API specification
// (which only described admin-side provider creation), but the
// provider-facing form needs *some* unauthenticated way in, so
// it's added here as its own narrow endpoint.
//
// What it can do is deliberately limited: it creates (or reuses)
// a provider record and logs one item at status "intake". It can't
// read anything back, and an intake item never appears in the public
// catalog until an admin publishes it (see public_items in schema.js).
// ------------------------------------------------------------

const { uniqueId, transaction, isValidEmail } = require("./util");
const mailer = require("../mailer");

const OUTCOMES = ["rent", "sell", "either"];
const HANDOFFS = ["pickup", "dropoff"];

function submitIntake(db, body) {
  const error = validate(body);
  if (error) return { status: 422, error };

  const { item, contact } = body;

  const email = contact.email.trim();

  // "rent" -> only offered for rent; "sell" -> only for sale; "either" -> admin decides.
  const rentOnly = body.outcome === "rent" ? 1 : 0;
  const buyOnly = body.outcome === "sell" ? 1 : 0;

  const notes = [
    item.brand ? `Brand: ${item.brand}` : null,
    item.notes ? `Provider notes: ${item.notes}` : null,
    `Wants to: ${body.outcome}`,
    body.estimated_value ? `Estimated value: ${Number.isFinite(Number(body.estimated_value)) ? "Rs " + Number(body.estimated_value).toLocaleString("en-PK") : body.estimated_value}` : null,
    `Handoff: ${body.handoff}${body.handoff === "pickup" ? ` from ${body.address}` : ""}`,
    body.preferred_date ? `Preferred date: ${body.preferred_date}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Provider (found or created) and item are written together or not at all.
  const itemId = transaction(db, () => {
    // Reuse the provider if this email has sent things in before.
    let provider = db.prepare("SELECT id FROM providers WHERE lower(email) = lower(?)").get(email);
    if (!provider) {
      const providerId = uniqueId(db, "providers", "prov");
      db.prepare(
        `INSERT INTO providers (id, name, email, phone, address) VALUES (?, ?, ?, ?, ?)`
      ).run(providerId, contact.name, email, contact.phone, body.handoff === "pickup" ? body.address : null);
      provider = { id: providerId };
    }

    const newItemId = uniqueId(db, "items", "item");
    db.prepare(
      `INSERT INTO items (id, provider_id, name, category, size, condition, rent_only, buy_only, status, intake_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'intake', ?)`
    ).run(newItemId, provider.id, item.name, item.category, item.size, item.condition, rentOnly, buyOnly, notes);
    return newItemId;
  });

  const reference = itemId.replace("item-", "WS-");
  mailer.notifyNewIntake({ reference, provider: contact, item, notes });

  return { status: 201, body: { reference } };
}

function validate(body) {
  const bad = (message) => ({ code: "invalid_body", message });
  if (!body || typeof body !== "object") return bad("Request body must be JSON.");

  const { item, contact } = body;
  if (!item || !item.name || !item.category || !item.size || !item.condition) {
    return bad("item.name, item.category, item.size, and item.condition are required.");
  }
  if (!contact || !contact.name || !contact.email || !contact.phone) {
    return bad("contact.name, contact.email, and contact.phone are required.");
  }
  if (!isValidEmail(contact.email)) return bad("contact.email is not a valid email.");
  if (!OUTCOMES.includes(body.outcome)) return bad("outcome must be 'rent', 'sell', or 'either'.");
  if (!HANDOFFS.includes(body.handoff)) return bad("handoff must be 'pickup' or 'dropoff'.");
  if (body.handoff === "pickup" && !body.address) return bad("address is required for pickup.");

  // Everything we store from this form is text; reject anything else (an
  // object or array would otherwise blow up inside the database layer).
  const required = [item.name, item.category, item.size, item.condition, contact.name, contact.email, contact.phone];
  const optional = [item.brand, item.notes, body.address, body.preferred_date];
  if (required.some((v) => typeof v !== "string") || optional.some((v) => v != null && typeof v !== "string")) {
    return bad("All item and contact fields must be text.");
  }

  // This endpoint is open to anyone, so cap how much text it will accept.
  const limits = [
    [item.name, 200, "item.name"], [item.category, 100, "item.category"], [item.size, 50, "item.size"],
    [item.condition, 50, "item.condition"], [item.brand, 100, "item.brand"], [item.notes, 2000, "item.notes"],
    [contact.name, 200, "contact.name"], [contact.email, 200, "contact.email"], [contact.phone, 50, "contact.phone"],
    [body.address, 500, "address"], [body.preferred_date, 30, "preferred_date"], [body.estimated_value, 30, "estimated_value"],
  ];
  for (const [value, max, field] of limits) {
    if (value !== undefined && value !== null && String(value).length > max) return bad(`${field} is too long.`);
  }
  return null;
}

module.exports = { submitIntake };