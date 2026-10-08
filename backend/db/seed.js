// backend/db/seed.js
// ------------------------------------------------------------
// Populates an empty database with the same catalog, orders,
// and payouts the frontend has been using as mock data all
// along — so once the frontend is wired to real endpoints,
// nothing shopper-visible should change out from under it.
//
// Only runs if the items table is empty (see index.js), so it's
// safe to boot the server repeatedly without duplicating data.
// ------------------------------------------------------------

const { hashPassword } = require("../routes/admin-auth");

const PROVIDERS = [
  { id: "prov-a12", name: "Provider #A12", email: "provider-a12@example.com" },
  { id: "prov-b04", name: "Provider #B04", email: "provider-b04@example.com" },
  { id: "prov-c09", name: "Provider #C09", email: "provider-c09@example.com" },
  { id: "prov-d21", name: "Provider #D21", email: "provider-d21@example.com" },
];

// Matches frontend/data.js (public catalog) + the 9th admin-only
// item (Sage Linen Shirt) that was always intake-only and never
// public. bookedRanges from the old frontend mock become real
// orders below instead of a field on the item itself.
const ITEMS = [
  { id: "gown-01", provider: "prov-a12", name: "Deep Plum Velvet Gown", category: "Dresses", size: "M", condition: "Excellent", color: "#4a3550", silhouette: "gown", rent: 3650, buy: 42000, status: "rented", desc: "Floor-length velvet gown with a fitted waist. Worn once, professionally cleaned since." },
  { id: "wrap-01", provider: "prov-b04", name: "Terracotta Wrap Dress", category: "Dresses", size: "S", condition: "Like new", color: "#8a4a3a", silhouette: "wrap", rent: 2250, buy: 16200, status: "sold", desc: "A-line wrap in a warm terracotta. Easy to dress up or down." },
  { id: "coat-01", provider: "prov-a12", name: "Fawn Wool Overcoat", category: "Outerwear", size: "M", condition: "Very good", color: "#7c6a4f", silhouette: "coat", rent: 2800, buy: 25800, status: "listed", desc: "Double-breasted wool coat, a couple of winters in. Structurally sound, recently pressed." },
  { id: "coat-02", provider: "prov-a12", name: "Camel Wool Overcoat", category: "Outerwear", size: "M", condition: "Very good", color: "#a08660", silhouette: "coat", rent: 2800, buy: 25800, status: "sold", desc: "Double-breasted wool coat, a couple of winters in. Structurally sound, recently pressed." },
  { id: "blazer-01", provider: "prov-c09", name: "Bottle Green Velvet Blazer", category: "Outerwear", size: "L", condition: "Excellent", color: "#22392f", silhouette: "blazer", rent: 2500, buy: 21800, status: "in_transit", desc: "Covered-button velvet blazer with a bit of drama. Good for evening events." },
  { id: "gown-02", provider: "prov-b04", name: "Blush Tulle Gown", category: "Dresses", size: "S", condition: "Excellent", color: "#9c6067", silhouette: "gown", rent: 3900, buy: 44200, status: "returned", desc: "Layered tulle skirt, sweetheart bodice. Worn once as a wedding guest." },
  { id: "blouse-01", provider: "prov-c09", name: "Ivory Silk Blouse", category: "Tops", size: "M", condition: "Good", color: "#d3c7ab", silhouette: "blouse", rent: 1400, buy: null, rentOnly: true, status: "listed", desc: "Simple, well-cut silk blouse. Light wear at the cuffs, otherwise in good shape." },
  { id: "skirt-01", provider: "prov-a12", name: "Charcoal Pleated Midi", category: "Skirts", size: "S", condition: "Very good", color: "#3c3a35", silhouette: "skirt", rent: 1700, buy: 9200, status: "intake", desc: "Knife-pleated midi skirt. Not yet photographed." },
  { id: "gown-03", provider: "prov-b04", name: "Ink Blue Satin Gown", category: "Dresses", size: "L", condition: "Excellent", color: "#293a52", silhouette: "gown", rent: null, buy: 41700, buyOnly: true, status: "retired", desc: "Deep satin gown with a slit and open back. Worn through, retired from rotation." },
  { id: "top-02", provider: "prov-d21", name: "Sage Linen Shirt", category: "Tops", size: "L", condition: "Good", color: "#8a9a7a", silhouette: "blouse", rent: 1100, buy: 5600, status: "intake", desc: "Just arrived, awaiting photography." },
];

// Matches the admin mock's ADMIN_ORDERS — same IDs, customers, dates,
// statuses, and totals, so the admin panel's existing UI expectations
// keep lining up once it reads from the real API instead of the mock.
const ORDERS = [
  { id: "ord-1001", item: "gown-01", type: "rent", customer: { name: "Jamila R.", email: "jamila.r@example.com", address: "Block 4, Clifton, Karachi" }, status: "shipped", start: "2026-09-12", end: "2026-09-19", total: 25550, createdAt: "2026-09-10", pay: "online", paid: true },
  { id: "ord-1002", item: "coat-02", type: "buy", customer: { name: "Ahmed K.", email: "ahmed.k@example.com", address: "DHA Phase 5, Karachi" }, status: "confirmed", start: null, end: null, total: 25800, createdAt: "2026-09-13", pay: "online", paid: true },
  { id: "ord-1003", item: "blazer-01", type: "rent", customer: { name: "Sara M.", email: "sara.m@example.com", address: "Gulshan-e-Iqbal, Karachi" }, status: "pending", start: "2026-09-18", end: "2026-09-23", total: 12500, createdAt: "2026-09-12", pay: "cod", paid: false },
  { id: "ord-1004", item: "gown-02", type: "rent", customer: { name: "Noor H.", email: "noor.h@example.com", address: "F-7, Islamabad" }, status: "return_due", start: "2026-09-03", end: "2026-09-10", total: 27300, createdAt: "2026-09-01", pay: "cod", paid: true },
  { id: "ord-1005", item: "wrap-01", type: "buy", customer: { name: "Fatima Q.", email: "fatima.q@example.com", address: "Model Town, Lahore" }, status: "completed", start: null, end: null, total: 16200, createdAt: "2026-09-05", pay: "online", paid: true },
  { id: "ord-1006", item: "blouse-01", type: "rent", customer: { name: "Zainab T.", email: "zainab.t@example.com", address: "Bahria Town, Lahore" }, status: "returned", start: "2026-08-28", end: "2026-09-02", total: 7000, createdAt: "2026-08-26", pay: "cod", paid: true },
  { id: "ord-1007", item: "skirt-01", type: "rent", customer: { name: "Hina S.", email: "hina.s@example.com", address: "North Nazimabad, Karachi" }, status: "cancelled", start: "2026-09-08", end: "2026-09-11", total: 5100, createdAt: "2026-09-06", pay: "online", paid: false },
  // An extra upcoming rental on the gown, so the availability calendar
  // still has a second booked range to show (matching the old
  // frontend mock's bookedRanges for gown-01).
  { id: "ord-1008", item: "gown-01", type: "rent", customer: { name: "Reema A.", email: "reema.a@example.com", address: "PECHS, Karachi" }, status: "confirmed", start: "2026-09-25", end: "2026-09-29", total: 14600, createdAt: "2026-09-14", pay: "cod", paid: false },
];

// Matches the admin mock's ADMIN_PAYOUTS.
const PAYOUTS = [
  { id: "pay-01", provider: "prov-a12", order: "ord-1001", amount: 12775, status: "pending" },
  { id: "pay-02", provider: "prov-a12", order: "ord-1002", amount: 12900, status: "pending" },
  { id: "pay-03", provider: "prov-c09", order: "ord-1003", amount: 6250, status: "pending" },
  { id: "pay-04", provider: "prov-b04", order: "ord-1004", amount: 13650, status: "pending" },
  { id: "pay-05", provider: "prov-b04", order: "ord-1005", amount: 8100, status: "paid", paidAt: "2026-09-07" },
  { id: "pay-06", provider: "prov-c09", order: "ord-1006", amount: 3500, status: "paid", paidAt: "2026-08-29" },
];

// Outbound shipments for orders that have actually shipped — without
// these, an order can sit at status "shipped" with no tracking info
// to show, which the tracking page and admin order details both
// expect to be there.
const SHIPMENTS = [
  { id: "ship-1001-out", order: "ord-1001", courier: "TCS", tracking: "TCS-88213754", status: "in_transit" },
  { id: "ship-1006-out", order: "ord-1006", courier: "Leopards", tracking: "LCS-40218855", status: "delivered" },
];

// Demo data (fake items, orders, customers and the demo admin login) is for trying the site
// out. It is on by default on your own computer, and OFF by default when NODE_ENV=production
// (a live site must start clean). SEED_DEMO=on / off overrides either way.
function demoSeedAllowed() {
  const v = String(process.env.SEED_DEMO || "").trim().toLowerCase();
  if (["on", "1", "true", "yes"].includes(v)) return true;
  if (["off", "0", "false", "no"].includes(v)) return false;
  return process.env.NODE_ENV !== "production";
}

function seedIfEmpty(db) {
  if (!demoSeedAllowed()) return false;
  const { count } = db.prepare("SELECT COUNT(*) as count FROM items").get();
  if (count > 0) return false;

  const insertProvider = db.prepare(
    `INSERT INTO providers (id, name, email) VALUES (?, ?, ?)`
  );
  PROVIDERS.forEach((p) => insertProvider.run(p.id, p.name, p.email));

  db.prepare(
    `INSERT INTO admin_users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`
  ).run("admin-owner", "Owner", "owner@example.com", hashPassword("changeme123"));

  const insertItem = db.prepare(`
    INSERT INTO items (id, provider_id, name, description, category, size, condition,
      color, silhouette, rent_price_per_day, buy_price, rent_only, buy_only, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  ITEMS.forEach((it) =>
    insertItem.run(
      it.id,
      it.provider,
      it.name,
      it.desc,
      it.category,
      it.size,
      it.condition,
      it.color,
      it.silhouette,
      it.rent,
      it.buy,
      it.rentOnly ? 1 : 0,
      it.buyOnly ? 1 : 0,
      it.status
    )
  );

  const insertCustomer = db.prepare(
    `INSERT INTO customers (id, name, email, shipping_address) VALUES (?, ?, ?, ?)`
  );
  const insertOrder = db.prepare(`
    INSERT INTO orders (id, item_id, customer_id, type, status, rent_start_date,
      rent_end_date, price_total, payment_status, payment_method, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertHistory = db.prepare(
    `INSERT INTO order_status_history (id, order_id, status, changed_at) VALUES (?, ?, ?, ?)`
  );

  ORDERS.forEach((o, i) => {
    const customerId = `cust-${String(i + 1).padStart(3, "0")}`;
    insertCustomer.run(customerId, o.customer.name, o.customer.email, o.customer.address);
    insertOrder.run(o.id, o.item, customerId, o.type, o.status, o.start, o.end, o.total, o.paid ? "paid" : "unpaid", o.pay, o.createdAt);
    insertHistory.run(`hist-${o.id}`, o.id, o.status, o.createdAt);
  });

  const insertPayout = db.prepare(`
    INSERT INTO payouts (id, provider_id, order_id, amount, status, paid_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  PAYOUTS.forEach((p) => insertPayout.run(p.id, p.provider, p.order, p.amount, p.status, p.paidAt || null));

  const insertShipment = db.prepare(`
    INSERT INTO shipments (id, order_id, direction, courier, tracking_number, status)
    VALUES (?, ?, 'outbound', ?, ?, ?)
  `);
  SHIPMENTS.forEach((s) => insertShipment.run(s.id, s.order, s.courier, s.tracking, s.status));

  return true;
}

module.exports = { seedIfEmpty, hashPassword, demoSeedAllowed };