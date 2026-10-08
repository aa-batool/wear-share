// backend/routes/admin-orders.js
// ------------------------------------------------------------
// Order management + shipments (API spec Sections 3.4–3.5).
// This is the one place in the system that legitimately needs
// both a provider's item and a customer's shipping details in
// the same operation (to book a shipment) — see the security
// notes document, Section 5, on why that's fine here but
// shouldn't leak back out through any public response.
// ------------------------------------------------------------

const { randomId } = require("./util");
const mailer = require("../mailer");
const life = require("./order-lifecycle");

const itemNameOf = (db, orderId) =>
  (db.prepare("SELECT i.name FROM orders o JOIN items i ON i.id = o.item_id WHERE o.id = ?").get(orderId) || {}).name || "";

// What the customer emails need: the order, the item's public name, and who to write to.
function emailInfo(db, orderId) {
  const row = db
    .prepare(
      `SELECT o.id, o.type, o.rent_start_date, o.rent_end_date, o.price_total, o.payment_method,
              i.name AS item_name, c.name AS cname, c.email AS cemail
       FROM orders o JOIN items i ON i.id = o.item_id JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`
    )
    .get(orderId);
  if (!row) return null;
  return {
    order: { id: row.id, type: row.type, rent_start_date: row.rent_start_date, rent_end_date: row.rent_end_date, price_total: row.price_total, payment_method: row.payment_method },
    itemName: row.item_name,
    customer: { name: row.cname, email: row.cemail },
  };
}

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "return_due", "returned", "completed", "cancelled"];

function listOrdersAdmin(db, query) {
  let sql = `
    SELECT o.*, i.name as item_name, c.name as customer_name, c.email as customer_email
    FROM orders o
    JOIN items i ON i.id = o.item_id
    JOIN customers c ON c.id = o.customer_id
    WHERE 1=1
  `;
  const params = [];

  if (query.status) {
    sql += " AND o.status = ?";
    params.push(query.status);
  }
  if (query.type) {
    sql += " AND o.type = ?";
    params.push(query.type);
  }
  sql += " ORDER BY o.created_at DESC";

  const rentById = Object.fromEntries(db.prepare("SELECT id, rent_price_per_day FROM items").all().map((i) => [i.id, i.rent_price_per_day]));
  const rows = db
    .prepare(sql)
    .all(...params)
    .map((o) => ({ ...o, ...life.lateness(o, rentById[o.item_id]), charges_total: (o.late_fee || 0) + (o.damage_fee || 0) }));
  return { status: 200, body: { orders: rows } };
}

function getOrderAdmin(db, id) {
  const order = db
    .prepare(
      `SELECT o.*, i.name as item_name, i.provider_id, c.name as customer_name, c.email as customer_email,
              c.phone as customer_phone, c.shipping_address as customer_address
       FROM orders o
       JOIN items i ON i.id = o.item_id
       JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`
    )
    .get(id);
  if (!order) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };

  const history = db
    .prepare("SELECT status, note, changed_at FROM order_status_history WHERE order_id = ? ORDER BY changed_at")
    .all(id);
  const shipments = db.prepare("SELECT * FROM shipments WHERE order_id = ?").all(id);

  const rent = (db.prepare("SELECT rent_price_per_day FROM items WHERE id = ?").get(order.item_id) || {}).rent_price_per_day;
  return {
    status: 200,
    body: { ...order, ...life.lateness(order, rent), charges_total: (order.late_fee || 0) + (order.damage_fee || 0), late_fee_per_day: life.lateRate(rent), history, shipments },
  };
}

function updateOrderStatus(db, id, body) {
  const order = db.prepare("SELECT id, status, type, payment_status, price_total FROM orders WHERE id = ?").get(id);
  if (!order) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };
  if (!body || !body.status || !ORDER_STATUSES.includes(body.status)) {
    return { status: 422, error: { code: "invalid_status", message: `status must be one of: ${ORDER_STATUSES.join(", ")}` } };
  }

  // A cancelled order is final: its dates were released, a refund may be owed, and
  // the piece may already be with someone else. Reopening it would quietly undo all that.
  if (order.status === "cancelled" && body.status !== "cancelled") {
    return { status: 409, error: { code: "order_cancelled", message: "This order was cancelled and can't be reopened. Place a new order instead." } };
  }

  // Getting a rental back also fixes its late fee, so it has its own path.
  if (body.status === "returned" && order.type === "rent" && life.WITH_CUSTOMER.includes(order.status)) {
    return life.applyReturn(db, id, { condition_note: body.note });
  }

  // Cancelling frees the dates and, if the customer had paid, flags a refund.
  if (body.status === "cancelled" && order.status !== "cancelled") {
    const refundDue = life.markCancelled(db, order, "admin", body.note ? `Cancelled by the shop. ${body.note}` : "Cancelled by the shop.");
    const info = emailInfo(db, id);
    mailer.notifyOrderStatus({ orderId: id, itemName: itemNameOf(db, id), status: "cancelled", note: body.note });
    if (info) mailer.customerCancelled({ order: info.order, itemName: info.itemName, customer: info.customer, by: "admin", refundDue });
    return { status: 200, body: db.prepare("SELECT * FROM orders WHERE id = ?").get(id) };
  }

  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(body.status, id);
  db.prepare("INSERT INTO order_status_history (id, order_id, status, note) VALUES (?, ?, ?, ?)").run(
    randomId("hist"),
    id,
    body.status,
    body.note || null
  );

  life.ensurePayout(db, id);
  life.syncItemStatus(db, id, body.status);
  life.notifyProviderBooked(db, id);
  mailer.notifyOrderStatus({ orderId: id, itemName: itemNameOf(db, id), status: body.status, note: body.note });
  const info = emailInfo(db, id);
  if (info) mailer.customerStatus({ ...info, status: body.status }); // the admin's note stays private

  return { status: 200, body: db.prepare("SELECT * FROM orders WHERE id = ?").get(id) };
}

// Cash on delivery: the admin marks it paid once the courier has handed
// the money over. Online: once the transfer is seen in the account. Either
// way it's recorded in the order's history so there's a trail.
const PAYMENT_STATUSES = ["unpaid", "paid"];

function updateOrderPayment(db, id, body) {
  const order = db.prepare("SELECT id, status, payment_method FROM orders WHERE id = ?").get(id);
  if (!order) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };
  if (!body || !PAYMENT_STATUSES.includes(body.payment_status)) {
    return { status: 422, error: { code: "invalid_payment_status", message: `payment_status must be one of: ${PAYMENT_STATUSES.join(", ")}` } };
  }

  const how = order.payment_method === "cod" ? " (cash on delivery)" : order.payment_method === "online" ? " (online)" : "";
  const note = body.payment_status === "paid" ? `Payment received${how}.` : "Payment marked as not received.";

  db.prepare("UPDATE orders SET payment_status = ?, updated_at = datetime('now') WHERE id = ?").run(body.payment_status, id);
  // A cancelled order that turns out to be paid needs a refund; one that turns out not to be doesn't.
  if (order.status === "cancelled") {
    db.prepare("UPDATE orders SET refund_status = CASE WHEN ? = 'paid' THEN COALESCE(refund_status, 'due') WHEN refund_status = 'due' THEN NULL ELSE refund_status END WHERE id = ?").run(body.payment_status, id);
  }
  db.prepare("INSERT INTO order_status_history (id, order_id, status, note) VALUES (?, ?, ?, ?)").run(
    randomId("hist"),
    id,
    order.status,
    note
  );

  if (body.payment_status === "paid") life.ensurePayout(db, id);
  else life.withdrawPendingPayout(db, id);
  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  mailer.notifyPayment({ orderId: id, itemName: itemNameOf(db, id), paid: body.payment_status === "paid", method: order.payment_method, total: updated.price_total });
  const info = emailInfo(db, id);
  if (info) mailer.customerPayment({ ...info, paid: body.payment_status === "paid" });
  return { status: 200, body: updated };
}

// Mock label generation — no real courier API is wired up yet (see
// the README build log). Produces a plausible tracking number so the
// rest of the flow (admin UI, customer tracking lookup) has something
// real to display in the meantime.
function createShipment(db, orderId, body) {
  const order = db.prepare("SELECT id, status FROM orders WHERE id = ?").get(orderId);
  if (!order) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };
  if (order.status === "cancelled") return { status: 409, error: { code: "order_cancelled", message: "This order was cancelled, so nothing can be shipped for it." } };
  if (!body || !body.direction || !body.courier) {
    return { status: 400, error: { code: "invalid_body", message: "direction and courier are required." } };
  }
  if (body.direction !== "outbound" && body.direction !== "return") {
    return { status: 422, error: { code: "invalid_body", message: "direction must be 'outbound' or 'return'." } };
  }

  if (typeof body.courier !== "string" || !body.courier.trim() || body.courier.length > 60) {
    return { status: 422, error: { code: "invalid_body", message: "courier must be text, up to 60 characters." } };
  }
  if (body.tracking_number != null && (typeof body.tracking_number !== "string" || body.tracking_number.length > 60)) {
    return { status: 422, error: { code: "invalid_body", message: "tracking_number must be text, up to 60 characters." } };
  }

  const id = randomId("ship");
  // The admin screen passes the courier's real tracking number. Without one (the old
  // API behaviour, still used by the demo data and tests) a placeholder is made up.
  const manual = typeof body.tracking_number === "string" && body.tracking_number.trim() !== "";
  const trackingNumber = manual ? body.tracking_number.trim() : `${body.courier.slice(0, 3).toUpperCase()}-${Math.floor(10000000 + Math.random() * 90000000)}`;
  const labelUrl = manual ? null : `https://labels.wearshare.example/${id}.pdf`; // placeholder until real courier integration

  db.prepare(
    `INSERT INTO shipments (id, order_id, direction, courier, tracking_number, label_url, status)
     VALUES (?, ?, ?, ?, ?, ?, 'booked')`
  ).run(id, orderId, body.direction, body.courier.trim(), trackingNumber, labelUrl);

  mailer.notifyShipment({ orderId, itemName: itemNameOf(db, orderId), direction: body.direction, courier: body.courier, trackingNumber });
  if (body.direction === "outbound") life.syncItemStatus(db, orderId, "shipped");
  const info = emailInfo(db, orderId);
  if (info) mailer.customerShipment({ ...info, direction: body.direction, courier: body.courier, trackingNumber });
  return { status: 201, body: { shipment_id: id, tracking_number: trackingNumber, label_url: labelUrl } };
}

function listShipments(db, orderId) {
  const order = db.prepare("SELECT id FROM orders WHERE id = ?").get(orderId);
  if (!order) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };

  const shipments = db.prepare("SELECT * FROM shipments WHERE order_id = ?").all(orderId);
  return { status: 200, body: { shipments } };
}

module.exports = { recordReturn: (db, id, body) => life.applyReturn(db, id, body || {}), updateRefund: life.updateRefund, updateCharges: life.updateCharges, runReminders: (db) => ({ status: 200, body: life.runReminders(db) }), listOrdersAdmin, getOrderAdmin, updateOrderStatus, updateOrderPayment, createShipment, listShipments, ORDER_STATUSES };