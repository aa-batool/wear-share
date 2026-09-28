// backend/routes/orders.js
// ------------------------------------------------------------
// Public-facing order endpoints (API spec Section 2.4–2.5).
//
// No payment processor is wired up yet (that's a later step —
// see the README build log), so orders are created with
// status "pending" and payment_url is null. Once Stripe is
// connected, creating an order will return a real checkout link
// and a webhook will move status to "confirmed" on payment
// success, instead of this being a manual/future step.
// ------------------------------------------------------------

const crypto = require("node:crypto");
const { getActiveBookings, rangesOverlap } = require("./items");

function randomId(prefix) {
  return `${prefix}-${crypto.randomInt(100000, 999999)}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

// Item statuses a shopper is allowed to order against — mirrors the
// public_items view's WHERE clause (schema.js), checked again here
// since order creation reads the raw items table for full detail.
const ORDERABLE_STATUSES = ["listed", "rented", "in_transit"];

function createOrder(db, body) {
  const errors = validateOrderInput(body);
  if (errors) return { error: errors };

  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(body.item_id);
  if (!item) return { status: 404, error: { code: "item_not_found", message: "No item exists with that id." } };
  if (!ORDERABLE_STATUSES.includes(item.status)) {
    return { status: 404, error: { code: "item_not_found", message: "That item isn't currently available." } };
  }
  if (body.type === "rent" && item.buy_only) {
    return { status: 422, error: { code: "invalid_type", message: "This item is buy-only." } };
  }
  if (body.type === "buy" && item.rent_only) {
    return { status: 422, error: { code: "invalid_type", message: "This item is rent-only." } };
  }

  let priceTotal;
  if (body.type === "rent") {
    if (body.rent_end_date < body.rent_start_date) {
      return { status: 422, error: { code: "invalid_date_range", message: "End date must be on or after the start date." } };
    }
    const bookings = getActiveBookings(db, item.id);
    const conflict = bookings.find((b) =>
      rangesOverlap(body.rent_start_date, body.rent_end_date, b.rent_start_date, b.rent_end_date)
    );
    if (conflict) {
      return {
        status: 409,
        error: { code: "item_unavailable", message: "Those dates overlap an existing booking." },
      };
    }
    const days = Math.round((new Date(body.rent_end_date) - new Date(body.rent_start_date)) / 86400000) + 1;
    priceTotal = item.rent_price_per_day * days;
  } else {
    priceTotal = item.buy_price;
  }

  const customerId = randomId("cust");
  const orderId = randomId("ord");

  db.prepare(
    `INSERT INTO customers (id, name, email, phone, shipping_address) VALUES (?, ?, ?, ?, ?)`
  ).run(customerId, body.customer.name, body.customer.email, body.customer.phone || null, body.customer.shipping_address);

  db.prepare(
    `INSERT INTO orders (id, item_id, customer_id, type, status, rent_start_date, rent_end_date, price_total, payment_status)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 'unpaid')`
  ).run(orderId, item.id, customerId, body.type, body.rent_start_date || null, body.rent_end_date || null, priceTotal);

  db.prepare(`INSERT INTO order_status_history (id, order_id, status) VALUES (?, ?, 'pending')`).run(
    randomId("hist"),
    orderId
  );

  return {
    status: 201,
    body: {
      order_id: orderId,
      status: "pending",
      price_total: priceTotal,
      deposit_amount: null,
      payment_url: null, // Stripe isn't wired up yet — see README build log
    },
  };
}

function validateOrderInput(body) {
  if (!body || typeof body !== "object") return { code: "invalid_body", message: "Request body must be JSON." };
  if (!body.item_id) return { code: "invalid_body", message: "item_id is required." };
  if (body.type !== "rent" && body.type !== "buy") return { code: "invalid_body", message: "type must be 'rent' or 'buy'." };

  const c = body.customer;
  if (!c || !c.name || !c.email || !c.shipping_address) {
    return { code: "invalid_body", message: "customer.name, customer.email, and customer.shipping_address are required." };
  }
  if (!isValidEmail(c.email)) return { code: "invalid_body", message: "customer.email is not a valid email." };

  if (body.type === "rent") {
    if (!isValidDate(body.rent_start_date) || !isValidDate(body.rent_end_date)) {
      return { code: "invalid_body", message: "rent_start_date and rent_end_date are required (YYYY-MM-DD) for rentals." };
    }
  }
  return null;
}

function getOrder(db, id, email) {
  if (!email) return null;

  const row = db
    .prepare(
      `SELECT o.id, o.type, o.status, o.rent_end_date, i.name as item_name, c.email as customer_email
       FROM orders o
       JOIN items i ON i.id = o.item_id
       JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`
    )
    .get(id);

  // Same response whether the order doesn't exist or the email just
  // doesn't match — an attacker shouldn't be able to tell which.
  if (!row || row.customer_email.toLowerCase() !== email.toLowerCase()) return null;

  const shipment = db
    .prepare(`SELECT courier, tracking_number, status FROM shipments WHERE order_id = ? AND direction = 'outbound'`)
    .get(id);

  return {
    order_id: row.id,
    item_name: row.item_name,
    type: row.type,
    status: row.status,
    rent_end_date: row.rent_end_date,
    tracking: shipment
      ? { carrier: shipment.courier, tracking_number: shipment.tracking_number, status: shipment.status }
      : null,
  };
}

module.exports = { createOrder, getOrder };