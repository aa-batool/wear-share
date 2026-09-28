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

  const rows = db.prepare(sql).all(...params);
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

  return { status: 200, body: { ...order, history, shipments } };
}

function updateOrderStatus(db, id, body) {
  const order = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
  if (!order) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };
  if (!body || !body.status || !ORDER_STATUSES.includes(body.status)) {
    return { status: 422, error: { code: "invalid_status", message: `status must be one of: ${ORDER_STATUSES.join(", ")}` } };
  }

  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(body.status, id);
  db.prepare("INSERT INTO order_status_history (id, order_id, status, note) VALUES (?, ?, ?, ?)").run(
    randomId("hist"),
    id,
    body.status,
    body.note || null
  );

  return { status: 200, body: db.prepare("SELECT * FROM orders WHERE id = ?").get(id) };
}

// Mock label generation — no real courier API is wired up yet (see
// the README build log). Produces a plausible tracking number so the
// rest of the flow (admin UI, customer tracking lookup) has something
// real to display in the meantime.
function createShipment(db, orderId, body) {
  const order = db.prepare("SELECT id FROM orders WHERE id = ?").get(orderId);
  if (!order) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };
  if (!body || !body.direction || !body.courier) {
    return { status: 400, error: { code: "invalid_body", message: "direction and courier are required." } };
  }
  if (body.direction !== "outbound" && body.direction !== "return") {
    return { status: 422, error: { code: "invalid_body", message: "direction must be 'outbound' or 'return'." } };
  }

  const id = randomId("ship");
  const trackingNumber = `${body.courier.slice(0, 3).toUpperCase()}-${Math.floor(10000000 + Math.random() * 90000000)}`;
  const labelUrl = `https://labels.wearshare.example/${id}.pdf`; // placeholder until real courier integration

  db.prepare(
    `INSERT INTO shipments (id, order_id, direction, courier, tracking_number, label_url, status)
     VALUES (?, ?, ?, ?, ?, ?, 'booked')`
  ).run(id, orderId, body.direction, body.courier, trackingNumber, labelUrl);

  return { status: 201, body: { shipment_id: id, tracking_number: trackingNumber, label_url: labelUrl } };
}

function listShipments(db, orderId) {
  const order = db.prepare("SELECT id FROM orders WHERE id = ?").get(orderId);
  if (!order) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };

  const shipments = db.prepare("SELECT * FROM shipments WHERE order_id = ?").all(orderId);
  return { status: 200, body: { shipments } };
}

module.exports = { listOrdersAdmin, getOrderAdmin, updateOrderStatus, createShipment, listShipments, ORDER_STATUSES };