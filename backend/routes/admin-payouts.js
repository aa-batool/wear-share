// backend/routes/admin-payouts.js
// ------------------------------------------------------------
// Payouts (API spec Section 3.6) — only meaningful if
// revenue-sharing is part of the business model (project
// document, Section 8). Straightforward: list, and mark paid.
// ------------------------------------------------------------

function listPayouts(db, query) {
  let sql = `
    SELECT p.*, pr.name as provider_name, o.item_id
    FROM payouts p
    JOIN providers pr ON pr.id = p.provider_id
    JOIN orders o ON o.id = p.order_id
    WHERE 1=1
  `;
  const params = [];

  if (query.status) {
    sql += " AND p.status = ?";
    params.push(query.status);
  }
  sql += " ORDER BY p.created_at DESC";

  const rows = db.prepare(sql).all(...params);
  const pendingTotal = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payouts WHERE status = 'pending'")
    .get().total;

  return { status: 200, body: { payouts: rows, pending_total: pendingTotal } };
}

function markPaid(db, id, body) {
  const payout = db.prepare("SELECT id, status FROM payouts WHERE id = ?").get(id);
  if (!payout) return { status: 404, error: { code: "payout_not_found", message: "No payout exists with that id." } };
  if (payout.status === "paid") {
    return { status: 422, error: { code: "already_paid", message: "That payout is already marked paid." } };
  }

  const paidAt = (body && body.paid_at) || new Date().toISOString().slice(0, 10);
  db.prepare("UPDATE payouts SET status = 'paid', paid_at = ? WHERE id = ?").run(paidAt, id);

  return { status: 200, body: db.prepare("SELECT * FROM payouts WHERE id = ?").get(id) };
}

module.exports = { listPayouts, markPaid };