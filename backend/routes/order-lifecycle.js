// backend/routes/order-lifecycle.js
// ------------------------------------------------------------
// What happens at the end of an order's life: cancelling, refunds,
// getting a rental back, late fees and damage charges, and the
// reminders about rentals that are due or overdue.
//
// The rules in one place:
//   * A customer can cancel on their own until the order ships: status
//     "pending" or "confirmed", and no outbound shipment booked yet. After
//     that they have to contact the shop (409 not_cancellable).
//   * Cancelling an order that was already paid marks a refund as DUE. The
//     shop sends the money back by hand and marks it SENT.
//   * A rental is OVERDUE when it's with the customer (shipped, delivered
//     or return_due) and its end date has passed (in the shop's time zone).
//   * Recording the return fixes the late fee: days late x the daily rate.
//     The rate is the item's daily rent price (a late day costs another day's
//     rent), or a flat LATE_FEE_PER_DAY from .env if that's set. The shop can
//     add a damage charge and edit or waive either amount afterwards.
//   * Late and damage charges are "due" until the shop marks them collected.
// ------------------------------------------------------------

const { randomId, transaction } = require("./util");
const mailer = require("../mailer");

const WITH_CUSTOMER = ["shipped", "delivered", "return_due"]; // a rental is out in the customer's hands
const CANCELLABLE = ["pending", "confirmed"];
const NOTE_MAX = 500;

// "Today" as a YYYY-MM-DD in the shop's time zone (default Pakistan), not the
// server's, so a host in another country doesn't flip days at the wrong hour.
function shopToday() {
  if (process.env.SHOP_TODAY) return process.env.SHOP_TODAY; // for tests
  const zone = process.env.SHOP_TIMEZONE || "Asia/Karachi";
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: zone });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function daysBetween(fromISO, toISO) {
  return Math.round((new Date(toISO) - new Date(fromISO)) / 86400000);
}

function lateRate(rentPerDay) {
  const flat = Number(process.env.LATE_FEE_PER_DAY);
  return Number.isFinite(flat) && flat > 0 ? flat : Number(rentPerDay) || 0;
}

// How late is this rental right now? (0 when it isn't late or isn't out.)
function lateness(order, rentPerDay, today = shopToday()) {
  const out = order.type === "rent" && WITH_CUSTOMER.includes(order.status) && order.rent_end_date;
  const days = out && today > order.rent_end_date ? daysBetween(order.rent_end_date, today) : 0;
  return { overdue: days > 0, days_late: days, late_fee_accruing: days * lateRate(rentPerDay) };
}

const charges = (o) => ({ late_fee: o.late_fee || 0, damage_fee: o.damage_fee || 0, total: (o.late_fee || 0) + (o.damage_fee || 0), status: o.charges_status || null });

function history(db, orderId, status, note) {
  db.prepare("INSERT INTO order_status_history (id, order_id, status, note) VALUES (?, ?, ?, ?)").run(randomId("hist"), orderId, status, note);
}

function infoFor(db, orderId) {
  const row = db
    .prepare(
      `SELECT o.*, i.name AS item_name, i.rent_price_per_day, c.name AS cname, c.email AS cemail
       FROM orders o JOIN items i ON i.id = o.item_id JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`
    )
    .get(orderId);
  if (!row) return null;
  return { row, order: row, itemName: row.item_name, customer: { name: row.cname, email: row.cemail } };
}

// ---- the item's own status follows its orders -------------------------------
// listed -> in_transit (a rental is on its way) -> rented (it's with the renter)
// -> returned (back with us, waiting for you to inspect / clean it and relist it)
// A delivered purchase makes the item sold. "intake" and "retired" are never touched
// (they're your decisions), and "sold" is never undone. Note that "returned" and
// "sold" take the piece off the shop; "returned" is the one you have to relist by hand.
const HANDS_OFF = ["intake", "retired", "sold"];

function setItemStatus(db, itemId, status) {
  const item = db.prepare("SELECT status FROM items WHERE id = ?").get(itemId);
  if (!item || HANDS_OFF.includes(item.status) || item.status === status) return false;
  db.prepare("UPDATE items SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, itemId);
  return true;
}

// Is another rental of this item still out (excluding the order we're talking about)?
function otherRentalOut(db, itemId, exceptOrderId) {
  return db
    .prepare("SELECT status FROM orders WHERE item_id = ? AND type = 'rent' AND id != ? AND status IN ('shipped','delivered','return_due')")
    .all(itemId, exceptOrderId);
}

// Called after an order changes. Does nothing for events that don't move the item.
function syncItemStatus(db, orderId, event) {
  const o = db.prepare("SELECT id, item_id, type FROM orders WHERE id = ?").get(orderId);
  if (!o) return;
  const others = o.type === "rent" ? otherRentalOut(db, o.item_id, o.id) : [];
  const othersWithRenter = others.some((x) => x.status !== "shipped");

  if (event === "shipped" && o.type === "rent") setItemStatus(db, o.item_id, othersWithRenter ? "rented" : "in_transit");
  else if (event === "delivered" && o.type === "rent") setItemStatus(db, o.item_id, "rented");
  else if ((event === "delivered" || event === "completed") && o.type === "buy") setItemStatus(db, o.item_id, "sold");
  else if ((event === "returned" || event === "cancelled") && o.type === "rent") {
    // Back with us (or a shipped rental was called off): once no other rental is out, it needs a look.
    if (others.length === 0) setItemStatus(db, o.item_id, "returned");
  }
}

// ---- cancelling -------------------------------------------------------------

// Shared by the customer and the admin. Frees the dates / the piece (the shop
// views only count orders that aren't cancelled) and flags a refund if money came in.
function markCancelled(db, order, by, note) {
  const refundDue = order.payment_status === "paid";
  transaction(db, () => {
    db.prepare("UPDATE orders SET status = 'cancelled', cancelled_by = ?, refund_status = ?, updated_at = datetime('now') WHERE id = ?").run(
      by,
      refundDue ? "due" : null,
      order.id
    );
    history(db, order.id, "cancelled", note + (refundDue ? ` Refund of Rs ${Number(order.price_total).toLocaleString("en-PK")} is due.` : ""));
    withdrawPendingPayout(db, order.id);
  });
  // Cancelling a rental that had already shipped means the piece is out there, not on the shelf.
  if (WITH_CUSTOMER.includes(order.status)) syncItemStatus(db, order.id, "cancelled");
  return refundDue;
}

function cancelByCustomer(db, id, body) {
  const email = body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const info = email ? infoFor(db, id) : null;
  // Same answer whether the order doesn't exist or the email is wrong, as in the tracking lookup.
  if (!info || info.row.cemail.toLowerCase() !== email) {
    return { status: 404, error: { code: "order_not_found", message: "No order matches that reference and email." } };
  }
  const { row } = info;
  if (row.status === "cancelled") return { status: 409, error: { code: "already_cancelled", message: "This order is already cancelled." } };
  const shipped = db.prepare("SELECT 1 FROM shipments WHERE order_id = ? AND direction = 'outbound'").get(row.id);
  if (!CANCELLABLE.includes(row.status) || shipped) {
    return {
      status: 409,
      error: { code: "not_cancellable", message: "This order is already on its way, so it can't be cancelled here. Please contact us and we'll help." },
    };
  }

  const refundDue = markCancelled(db, row, "customer", "Cancelled by the customer.");
  mailer.notifyOrderCancelledByCustomer({ orderId: row.id, itemName: row.item_name, refundDue, amount: row.price_total, method: row.payment_method });
  mailer.customerCancelled({ order: row, itemName: row.item_name, customer: info.customer, by: "customer", refundDue });
  return { status: 200, body: { order_id: row.id, status: "cancelled", refund_status: refundDue ? "due" : null, refund_amount: refundDue ? row.price_total : null } };
}

// ---- refunds ----------------------------------------------------------------

function updateRefund(db, id, body) {
  const info = infoFor(db, id);
  if (!info) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };
  const to = body && body.refund_status;
  if (to !== "sent" && to !== "due") {
    return { status: 422, error: { code: "invalid_refund_status", message: "refund_status must be 'sent' or 'due'." } };
  }
  if (!info.row.refund_status) {
    return { status: 409, error: { code: "no_refund", message: "Only a cancelled order that was paid has a refund." } };
  }
  db.prepare("UPDATE orders SET refund_status = ?, updated_at = datetime('now') WHERE id = ?").run(to, id);
  history(db, id, info.row.status, to === "sent" ? "Refund sent." : "Refund marked as not yet sent.");
  if (to === "sent") mailer.customerRefundSent({ order: info.row, itemName: info.itemName, customer: info.customer });
  return { status: 200, body: db.prepare("SELECT * FROM orders WHERE id = ?").get(id) };
}

// ---- getting a rental back --------------------------------------------------

function cleanNote(v) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX) : "";
}
const money = (v) => Number.isFinite(v) && v >= 0;

// Records that a rental is back: sets "returned", fixes the late fee, stores the
// condition note and any damage charge. Called by the "Record return" form and
// when an admin simply sets the status to "returned".
function applyReturn(db, id, body = {}) {
  const info = infoFor(db, id);
  if (!info) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };
  const { row } = info;
  if (row.type !== "rent") return { status: 409, error: { code: "not_a_rental", message: "Only rentals are returned." } };
  if (!WITH_CUSTOMER.includes(row.status)) {
    return { status: 409, error: { code: "not_returnable", message: "This rental isn't out with the customer, so there's nothing to record a return for." } };
  }
  if (body.damage_fee !== undefined && body.damage_fee !== null && !money(body.damage_fee)) {
    return { status: 422, error: { code: "invalid_amount", message: "damage_fee must be a number, zero or higher." } };
  }

  const today = shopToday();
  const days = row.rent_end_date && today > row.rent_end_date ? daysBetween(row.rent_end_date, today) : 0;
  const lateFee = body.waive_late_fee ? 0 : days * lateRate(row.rent_price_per_day);
  const damageFee = Number(body.damage_fee) || 0;
  const condition = cleanNote(body.condition_note);
  const total = lateFee + damageFee;

  const bits = [
    condition ? `Condition: ${condition}.` : null,
    days > 0 ? (body.waive_late_fee ? `${days} day${days === 1 ? "" : "s"} late, late fee waived.` : `${days} day${days === 1 ? "" : "s"} late, late fee Rs ${lateFee.toLocaleString("en-PK")}.`) : null,
    damageFee > 0 ? `Damage charge Rs ${damageFee.toLocaleString("en-PK")}.` : null,
  ].filter(Boolean);
  if (bits.length === 0) bits.push("Rental came back on time, no charges.");

  transaction(db, () => {
    db.prepare(
      `UPDATE orders SET status = 'returned', returned_on = ?, return_note = ?, late_fee = ?, damage_fee = ?, charges_status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(today, condition || null, lateFee, damageFee, total > 0 ? "due" : null, id);
    history(db, id, "returned", bits.join(" "));
  });

  ensurePayout(db, id);
  syncItemStatus(db, id, "returned");
  mailer.customerReturned({ order: row, itemName: info.itemName, customer: info.customer, lateFee, damageFee, daysLate: days });
  mailer.notifyReturned({ orderId: id, itemName: info.itemName, daysLate: days, lateFee, damageFee, condition });
  return { status: 200, body: db.prepare("SELECT * FROM orders WHERE id = ?").get(id) };
}

// Edit the amounts (set to 0 to waive) and/or mark them collected.
function updateCharges(db, id, body) {
  const info = infoFor(db, id);
  if (!info) return { status: 404, error: { code: "order_not_found", message: "No order exists with that id." } };
  const { row } = info;
  if (!body || typeof body !== "object") return { status: 400, error: { code: "invalid_body", message: "Request body is required." } };
  if (row.type !== "rent" || !["returned", "completed"].includes(row.status)) {
    return { status: 409, error: { code: "not_returned", message: "Charges are set when a rental is returned. Record the return first." } };
  }
  for (const f of ["late_fee", "damage_fee"]) {
    if (body[f] !== undefined && !money(body[f])) return { status: 422, error: { code: "invalid_amount", message: `${f} must be a number, zero or higher.` } };
  }
  if (body.charges_status !== undefined && body.charges_status !== "due" && body.charges_status !== "collected") {
    return { status: 422, error: { code: "invalid_charges_status", message: "charges_status must be 'due' or 'collected'." } };
  }

  const late = body.late_fee !== undefined ? body.late_fee : row.late_fee || 0;
  const damage = body.damage_fee !== undefined ? body.damage_fee : row.damage_fee || 0;
  let status = body.charges_status !== undefined ? body.charges_status : row.charges_status;
  const changedAmount = late !== (row.late_fee || 0) || damage !== (row.damage_fee || 0);
  if (late + damage === 0) status = null; // nothing (left) to collect
  else if (!status) status = "due";
  else if (body.charges_status === undefined && status === "collected" && late + damage > (row.late_fee || 0) + (row.damage_fee || 0)) status = "due"; // raised after collecting: the extra is owed

  db.prepare("UPDATE orders SET late_fee = ?, damage_fee = ?, charges_status = ?, updated_at = datetime('now') WHERE id = ?").run(late, damage, status, id);
  const parts = [];
  if (changedAmount) parts.push(`Charges changed: late fee Rs ${late.toLocaleString("en-PK")}, damage Rs ${damage.toLocaleString("en-PK")}.`);
  if (status === "collected" && row.charges_status !== "collected") parts.push(`Charges of Rs ${(late + damage).toLocaleString("en-PK")} collected.`);
  if (status === "due" && row.charges_status === "collected") parts.push("Charges marked as not yet collected.");
  if (parts.length) history(db, id, row.status, parts.join(" "));
  return { status: 200, body: db.prepare("SELECT * FROM orders WHERE id = ?").get(id) };
}

// ---- provider payouts -------------------------------------------------------
// The provider's share of an order is owed once the customer has paid AND the
// order has run its course: a rental that's come back, or a purchase that's been
// delivered ("completed" counts for both). The share is PROVIDER_SHARE_PERCENT of
// the items total (default 50), never the delivery fee, late fees or damage charges,
// which stay with the shop. One payout per order; it appears in Payouts as pending.
function providerSharePercent() {
  const n = Number(process.env.PROVIDER_SHARE_PERCENT);
  return Number.isFinite(n) && n >= 0 && n <= 100 && process.env.PROVIDER_SHARE_PERCENT !== "" && process.env.PROVIDER_SHARE_PERCENT !== undefined ? n : 50;
}

function ensurePayout(db, orderId) {
  const o = db
    .prepare(
      `SELECT o.id, o.type, o.status, o.payment_status, o.price_total, o.delivery_fee, i.provider_id, i.name AS item_name, p.name AS provider_name
       FROM orders o JOIN items i ON i.id = o.item_id JOIN providers p ON p.id = i.provider_id WHERE o.id = ?`
    )
    .get(orderId);
  if (!o || o.payment_status !== "paid") return null;
  const finished = o.type === "rent" ? ["returned", "completed"] : ["delivered", "completed"];
  if (!finished.includes(o.status)) return null;
  if (db.prepare("SELECT 1 FROM payouts WHERE order_id = ?").get(orderId)) return null;

  // Delivery money is the shop's, so the provider's share is of the items alone.
  const amount = Math.round(((Number(o.price_total) - Number(o.delivery_fee || 0)) * providerSharePercent()) / 100);
  if (!(amount > 0)) return null;
  const id = randomId("pay");
  db.prepare("INSERT INTO payouts (id, provider_id, order_id, amount, status) VALUES (?, ?, ?, ?, 'pending')").run(id, o.provider_id, orderId, amount);
  history(db, orderId, o.status, `Provider payout of Rs ${amount.toLocaleString("en-PK")} is now owed.`);
  mailer.notifyPayoutOwed({ payoutId: id, providerName: o.provider_name, itemName: o.item_name, amount, orderId });
  return id;
}

// A payout that hasn't been paid yet is withdrawn if the order is cancelled or its
// payment turns out not to have been received. (A paid one is left alone.)
function withdrawPendingPayout(db, orderId) {
  return db.prepare("DELETE FROM payouts WHERE order_id = ? AND status = 'pending'").run(orderId).changes > 0;
}

// ---- reminders --------------------------------------------------------------

// Emails the customer when a rental is due back today, and again (every third day)
// while it's late; tells the owner the first time a rental turns late. Each is
// recorded on the order, so running this often never repeats itself.
function runReminders(db, today = shopToday()) {
  const rows = db
    .prepare(
      `SELECT o.*, i.name AS item_name, i.rent_price_per_day, c.name AS cname, c.email AS cemail
       FROM orders o JOIN items i ON i.id = o.item_id JOIN customers c ON c.id = o.customer_id
       WHERE o.type = 'rent' AND o.status IN ('shipped','delivered','return_due') AND o.rent_end_date <= ?`
    )
    .all(today);

  let due = 0;
  let late = 0;
  for (const o of rows) {
    const customer = { name: o.cname, email: o.cemail };
    if (o.rent_end_date === today) {
      if (o.due_reminder_on) continue;
      db.prepare("UPDATE orders SET due_reminder_on = ? WHERE id = ?").run(today, o.id);
      mailer.customerDueBack({ order: o, itemName: o.item_name, customer, lateFeePerDay: lateRate(o.rent_price_per_day) });
      due++;
    } else {
      if (o.late_reminder_on && daysBetween(o.late_reminder_on, today) < 3) continue;
      const first = !o.late_reminder_on;
      db.prepare("UPDATE orders SET late_reminder_on = ? WHERE id = ?").run(today, o.id);
      const { days_late, late_fee_accruing } = lateness(o, o.rent_price_per_day, today);
      mailer.customerLate({ order: o, itemName: o.item_name, customer, daysLate: days_late, feeSoFar: late_fee_accruing });
      if (first) mailer.notifyOverdue({ orderId: o.id, itemName: o.item_name, daysLate: days_late, feeSoFar: late_fee_accruing });
      late++;
    }
  }
  return { due_reminders_sent: due, late_reminders_sent: late };
}

// Tell the provider their piece has been booked / bought, once, the first time its
// order moves past "pending". Carries the item, the type, the rental dates and the
// provider's expected share; nothing about the customer.
function notifyProviderBooked(db, orderId) {
  const o = db
    .prepare(
      `SELECT o.type, o.status, o.price_total, o.delivery_fee, o.rent_start_date, o.rent_end_date, o.provider_notified,
              i.name AS item_name, pr.name AS provider_name, pr.email AS provider_email
       FROM orders o JOIN items i ON i.id = o.item_id JOIN providers pr ON pr.id = i.provider_id WHERE o.id = ?`
    )
    .get(orderId);
  if (!o || o.provider_notified || o.status === "pending" || o.status === "cancelled") return;
  db.prepare("UPDATE orders SET provider_notified = 1 WHERE id = ?").run(orderId);
  const share = Math.round(((o.price_total - (o.delivery_fee || 0)) * providerSharePercent()) / 100);
  require("../mailer").providerItemBooked({
    provider: { name: o.provider_name, email: o.provider_email },
    itemName: o.item_name, type: o.type, startDate: o.rent_start_date, endDate: o.rent_end_date, share,
  });
}

module.exports = {
  notifyProviderBooked, syncItemStatus, ensurePayout, withdrawPendingPayout, providerSharePercent, shopToday, lateness, charges, lateRate, markCancelled, cancelByCustomer, updateRefund, applyReturn, updateCharges, runReminders, WITH_CUSTOMER, CANCELLABLE };