// backend/routes/admin-dashboard.js
// ------------------------------------------------------------
// One endpoint for the admin dashboard, instead of the page
// making five separate calls and counting rows in the browser.
// Not in the original API specification — the dashboard screen
// was designed after it was written.
//
// Definitions, so the numbers mean the same thing everywhere:
//   intake_queue     items waiting to be photographed and listed
//   active_orders    orders that are still in motion
//   upcoming_returns rentals marked as due back
//   pending_payouts  payouts owed to providers, not yet paid
//   overdue_returns  rentals out with a customer past their end date
//   items_to_inspect pieces that came back and are waiting for you to check and relist them
//   refunds_due      cancelled, already-paid orders whose refund hasn't been sent
//   charges_due      late fees / damage charges not yet collected
// ------------------------------------------------------------

const { shopToday } = require("./order-lifecycle");

const ACTIVE_ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "return_due"];

function getDashboard(db) {
  const count = (sql, ...params) => db.prepare(sql).get(...params).n;

  const placeholders = ACTIVE_ORDER_STATUSES.map(() => "?").join(",");

  const stats = {
    intake_queue: count("SELECT COUNT(*) as n FROM items WHERE status = 'intake'"),
    active_orders: count(`SELECT COUNT(*) as n FROM orders WHERE status IN (${placeholders})`, ...ACTIVE_ORDER_STATUSES),
    upcoming_returns: count("SELECT COUNT(*) as n FROM orders WHERE status = 'return_due'"),
    pending_payouts: count("SELECT COUNT(*) as n FROM payouts WHERE status = 'pending'"),
    overdue_returns: count("SELECT COUNT(*) as n FROM orders WHERE type = 'rent' AND status IN ('shipped','delivered','return_due') AND rent_end_date < ?", shopToday()),
    items_to_inspect: count("SELECT COUNT(*) as n FROM items WHERE status = 'returned'"),
    refunds_due: count("SELECT COUNT(*) as n FROM orders WHERE refund_status = 'due'"),
    charges_due: count("SELECT COUNT(*) as n FROM orders WHERE charges_status = 'due'"),
  };

  const recentActivity = db
    .prepare(
      `SELECT o.id, o.type, o.status, o.created_at, i.name as item_name, c.name as customer_name
       FROM orders o
       JOIN items i ON i.id = o.item_id
       JOIN customers c ON c.id = o.customer_id
       ORDER BY o.updated_at DESC, o.created_at DESC
       LIMIT 5`
    )
    .all();

  return { status: 200, body: { stats, recent_activity: recentActivity } };
}

module.exports = { getDashboard };