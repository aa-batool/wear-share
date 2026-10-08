// backend/routes/admin-export.js
// ------------------------------------------------------------
// Spreadsheet exports for the owner: orders, payouts and listings as CSV
// files that open in Excel, Google Sheets or Numbers.
//
//   GET /api/admin/export/orders    GET /api/admin/export/payouts    GET /api/admin/export/listings
//
// Admin-only (like everything under /api/admin). The orders and payouts files
// contain customers' and providers' personal details; the listings file has the
// provider's name. Nothing here is reachable without signing in.
// ------------------------------------------------------------

// Text that starts with = + - @ (or a tab / carriage return) can be run as a formula
// when the file is opened in a spreadsheet, and customers choose what goes in these
// fields. Prefix such text with an apostrophe so it stays plain text. Real numbers are
// left alone, and so are ordinary phone numbers like "+92 300 1234567".
function cell(value) {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? String(value) : String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s) && !/^\+[\d\s()-]+$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// A byte-order mark makes Excel read the file as UTF-8 (names with accents stay right).
function toCsv(headers, rows) {
  const lines = [headers.map(cell).join(",")].concat(rows.map((r) => r.map(cell).join(",")));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function csvResult(name, headers, rows) {
  return { status: 200, file: { filename: `wearshare-${name}-${today()}.csv`, buffer: Buffer.from(toCsv(headers, rows), "utf8"), contentType: "text/csv; charset=utf-8" } };
}

const paymentLabel = { cod: "Cash on delivery", online: "Online" };

function exportOrders(db) {
  const rows = db
    .prepare(
      `SELECT o.*, i.name AS item_name, c.name AS cname, c.email AS cemail, c.phone AS cphone, c.shipping_address AS caddress
       FROM orders o JOIN items i ON i.id = o.item_id JOIN customers c ON c.id = o.customer_id
       ORDER BY o.created_at DESC, o.rowid DESC`
    )
    .all();
  return csvResult(
    "orders",
    ["Order", "Placed", "Item", "Type", "Status", "Rent from", "Rent to", "Items total (Rs)", "Delivery fee (Rs)", "Total (Rs)", "Payment method", "Payment", "Late fee (Rs)", "Damage charge (Rs)", "Extra charges", "Refund", "Cancelled by", "Customer", "Email", "Phone", "Address"],
    rows.map((o) => [
      o.id, o.created_at, o.item_name, o.type === "rent" ? "Rent" : "Buy", o.status, o.rent_start_date, o.rent_end_date,
      (o.price_total || 0) - (o.delivery_fee || 0), o.delivery_fee || 0, o.price_total,
      paymentLabel[o.payment_method] || "", o.payment_status === "paid" ? "Received" : "Not received",
      o.late_fee || 0, o.damage_fee || 0, (o.late_fee || 0) + (o.damage_fee || 0) > 0 ? (o.charges_status === "collected" ? "Collected" : "To collect") : "",
      o.refund_status === "due" ? "Due" : o.refund_status === "sent" ? "Sent" : "", o.cancelled_by || "",
      o.cname, o.cemail, o.cphone, o.caddress,
    ])
  );
}

function exportPayouts(db) {
  const rows = db
    .prepare(
      `SELECT p.*, pr.name AS provider_name, pr.email AS provider_email, pr.payout_details, o.id AS oid, i.name AS item_name
       FROM payouts p JOIN providers pr ON pr.id = p.provider_id JOIN orders o ON o.id = p.order_id JOIN items i ON i.id = o.item_id
       ORDER BY p.created_at DESC, p.rowid DESC`
    )
    .all();
  return csvResult(
    "payouts",
    ["Payout", "Created", "Provider", "Provider email", "Pay to", "Item", "Order", "Amount (Rs)", "Status", "Paid on"],
    rows.map((p) => [p.id, p.created_at, p.provider_name, p.provider_email, p.payout_details, p.item_name, p.oid, p.amount, p.status === "paid" ? "Paid" : "Pending", p.paid_at])
  );
}

function exportListings(db) {
  const rows = db
    .prepare(
      `SELECT i.*, p.name AS provider_name FROM items i JOIN providers p ON p.id = i.provider_id ORDER BY i.created_at DESC, i.rowid DESC`
    )
    .all();
  return csvResult(
    "listings",
    ["Item", "Name", "Category", "Size", "Condition", "Status", "Rent per day (Rs)", "Buy price (Rs)", "Offered for", "Provider", "Added"],
    rows.map((i) => [i.id, i.name, i.category, i.size, i.condition, i.status, i.rent_price_per_day, i.buy_price, i.rent_only ? "Rent only" : i.buy_only ? "Sale only" : "Rent or buy", i.provider_name, i.created_at])
  );
}

module.exports = { exportOrders, exportPayouts, exportListings, cell, toCsv };