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
  { id: "gown-01", provider: "prov-a12", name: "Deep Plum Velvet Gown", category: "Dresses", size: "M", condition: "Excellent", color: "#8e2bb5", silhouette: "gown", rent: 3650, buy: 42000, status: "rented", desc: "Floor-length velvet gown with a fitted waist. Worn once, professionally cleaned since." },
  { id: "wrap-01", provider: "prov-b04", name: "Terracotta Wrap Dress", category: "Dresses", size: "S", condition: "Like new", color: "#d9563a", silhouette: "wrap", rent: 2250, buy: 16200, status: "sold", desc: "A-line wrap in a warm terracotta. Easy to dress up or down." },
  { id: "coat-01", provider: "prov-a12", name: "Saffron Wool Overcoat", category: "Outerwear", size: "M", condition: "Very good", color: "#e2822c", silhouette: "coat", rent: 2800, buy: 25800, status: "listed", desc: "Double-breasted wool coat, a couple of winters in. Structurally sound, recently pressed." },
  { id: "coat-02", provider: "prov-a12", name: "Golden Wool Overcoat", category: "Outerwear", size: "M", condition: "Very good", color: "#e9b44c", silhouette: "coat", rent: 2800, buy: 25800, status: "sold", desc: "Double-breasted wool coat, a couple of winters in. Structurally sound, recently pressed." },
  { id: "blazer-01", provider: "prov-c09", name: "Emerald Velvet Blazer", category: "Outerwear", size: "L", condition: "Excellent", color: "#0f9b7a", silhouette: "blazer", rent: 2500, buy: 21800, status: "in_transit", desc: "Covered-button velvet blazer with a bit of drama. Good for evening events." },
  { id: "gown-02", provider: "prov-b04", name: "Blush Tulle Gown", category: "Dresses", size: "S", condition: "Excellent", color: "#f08aa6", silhouette: "gown", rent: 3900, buy: 44200, status: "returned", desc: "Layered tulle skirt, sweetheart bodice. Worn once as a wedding guest." },
  { id: "blouse-01", provider: "prov-c09", name: "Rose Silk Blouse", category: "Tops", size: "M", condition: "Good", color: "#f4a9c8", silhouette: "blouse", rent: 1400, buy: null, rentOnly: true, status: "listed", desc: "Simple, well-cut silk blouse. Light wear at the cuffs, otherwise in good shape." },
  { id: "skirt-01", provider: "prov-a12", name: "Charcoal Pleated Midi", category: "Skirts", size: "S", condition: "Very good", color: "#3c3a35", silhouette: "skirt", rent: 1700, buy: 9200, status: "intake", desc: "Knife-pleated midi skirt. Not yet photographed." },
  { id: "gown-03", provider: "prov-b04", name: "Ink Blue Satin Gown", category: "Dresses", size: "L", condition: "Excellent", color: "#2b4fd1", silhouette: "gown", rent: null, buy: 41700, buyOnly: true, status: "retired", desc: "Deep satin gown with a slit and open back. Worn through, retired from rotation." },
  { id: "top-02", provider: "prov-d21", name: "Sage Linen Shirt", category: "Tops", size: "L", condition: "Good", color: "#8cc084", silhouette: "blouse", rent: 1100, buy: 5600, status: "intake", desc: "Just arrived, awaiting photography." },
  { id: "gown-04", provider: "prov-b04", name: "Ruby Satin Evening Gown", category: "Dresses", size: "M", condition: "Excellent", color: "#c2185b", silhouette: "gown", rent: 3400, buy: 38500, status: "listed", desc: "Bias-cut satin gown with a low back. Worn to one wedding." },
  { id: "gown-05", provider: "prov-d21", name: "Gold Sequin Gown", category: "Dresses", size: "S", condition: "Like new", color: "#d4a017", silhouette: "gown", rent: 4200, buy: 52000, status: "listed", desc: "Fully sequinned column gown, lined and comfortable to move in." },
  { id: "gown-06", provider: "prov-c09", name: "Midnight Navy Gown", category: "Dresses", size: "L", condition: "Very good", color: "#1f3a93", silhouette: "gown", rent: 3300, buy: 36000, status: "listed", desc: "Structured navy gown with a sweeping skirt. Cleaned and pressed." },
  { id: "wrap-02", provider: "prov-a12", name: "Cobalt Wrap Dress", category: "Dresses", size: "M", condition: "Excellent", color: "#1565c0", silhouette: "wrap", rent: 2100, buy: 15200, status: "listed", desc: "Knee-length wrap in a bold cobalt. Easy to wear through the day." },
  { id: "wrap-03", provider: "prov-b04", name: "Lilac Midi Dress", category: "Dresses", size: "S", condition: "Like new", color: "#9575cd", silhouette: "wrap", rent: 1900, buy: 13800, status: "listed", desc: "Soft lilac midi with a tie waist. Worn once to a luncheon." },
  { id: "wrap-04", provider: "prov-d21", name: "Coral Summer Dress", category: "Dresses", size: "M", condition: "Good", color: "#ff6f61", silhouette: "wrap", rent: 1500, buy: 9800, status: "listed", desc: "Light cotton dress in coral, ideal for daytime events." },
  { id: "coat-03", provider: "prov-a12", name: "Teal Wool Coat", category: "Outerwear", size: "L", condition: "Very good", color: "#00838f", silhouette: "coat", rent: 2600, buy: 23800, status: "listed", desc: "Long wool coat in deep teal, warm and well kept." },
  { id: "coat-04", provider: "prov-c09", name: "Mustard Trench Coat", category: "Outerwear", size: "M", condition: "Excellent", color: "#e0a800", silhouette: "coat", rent: 2400, buy: 21500, status: "listed", desc: "Belted trench in mustard cotton. Two seasons of light wear." },
  { id: "blazer-02", provider: "prov-d21", name: "Fuchsia Tailored Blazer", category: "Outerwear", size: "S", condition: "Like new", color: "#d81b60", silhouette: "blazer", rent: 2200, buy: 18900, status: "listed", desc: "Sharp single-breasted blazer in fuchsia. Perfect for events." },
  { id: "blazer-03", provider: "prov-b04", name: "Royal Blue Velvet Blazer", category: "Outerwear", size: "M", condition: "Excellent", color: "#283593", silhouette: "blazer", rent: 2500, buy: 22400, status: "listed", desc: "Rich velvet blazer with satin lapels." },
  { id: "blouse-02", provider: "prov-a12", name: "Mint Chiffon Blouse", category: "Tops", size: "M", condition: "Good", color: "#4db6ac", silhouette: "blouse", rent: 1200, buy: 6400, status: "listed", desc: "Light chiffon blouse with gathered sleeves." },
  { id: "blouse-03", provider: "prov-c09", name: "Sunshine Embroidered Top", category: "Tops", size: "S", condition: "Very good", color: "#fbc02d", silhouette: "blouse", rent: 1300, buy: 7200, status: "listed", desc: "Hand-embroidered top in sunny yellow, light wear at the hem." },
  { id: "skirt-02", provider: "prov-b04", name: "Emerald Pleated Skirt", category: "Skirts", size: "M", condition: "Excellent", color: "#2e7d32", silhouette: "skirt", rent: 1600, buy: 8800, status: "listed", desc: "Flowing pleated midi skirt in emerald." },
  { id: "skirt-03", provider: "prov-d21", name: "Plum Satin Midi Skirt", category: "Skirts", size: "L", condition: "Like new", color: "#7b1fa2", silhouette: "skirt", rent: 1700, buy: 9400, status: "listed", desc: "Satin midi skirt in plum with a soft sheen." },
  { id: "gown-07", provider: "prov-a12", name: "Blush Organza Gown", category: "Dresses", size: "M", condition: "Excellent", color: "#e57399", silhouette: "gown", rent: 3600, buy: 40500, status: "listed", desc: "Layered organza gown in blush with a fitted bodice." },
  { id: "gown-08", provider: "prov-d21", name: "Burgundy Velvet Gown", category: "Dresses", size: "L", condition: "Very good", color: "#880e4f", silhouette: "gown", rent: 3500, buy: 39000, status: "listed", desc: "Deep burgundy velvet with long sleeves. Ideal for winter events." },
  { id: "gown-09", provider: "prov-c09", name: "Silver Beaded Gown", category: "Dresses", size: "S", condition: "Like new", color: "#90a4ae", silhouette: "gown", rent: 4500, buy: 56000, status: "listed", desc: "Beaded silver gown with a sweeping train, worn once." },
  { id: "wrap-05", provider: "prov-a12", name: "Sage Linen Wrap Dress", category: "Dresses", size: "L", condition: "Good", color: "#7cb342", silhouette: "wrap", rent: 1600, buy: 10400, status: "listed", desc: "Breezy linen wrap in soft sage." },
  { id: "wrap-06", provider: "prov-c09", name: "Magenta Party Dress", category: "Dresses", size: "S", condition: "Excellent", color: "#ad1457", silhouette: "wrap", rent: 2300, buy: 16800, status: "listed", desc: "Fitted party dress in magenta with a flared hem." },
  { id: "wrap-07", provider: "prov-b04", name: "Sky Blue Day Dress", category: "Dresses", size: "M", condition: "Like new", color: "#4fc3f7", silhouette: "wrap", rent: 1700, buy: 11200, status: "listed", desc: "Bright sky blue dress, lightly worn once." },
  { id: "coat-05", provider: "prov-d21", name: "Plum Puffer Coat", category: "Outerwear", size: "M", condition: "Very good", color: "#6a1b9a", silhouette: "coat", rent: 2300, buy: 17500, status: "listed", desc: "Warm quilted coat in plum with a hood." },
  { id: "coat-06", provider: "prov-a12", name: "Scarlet Wool Cape", category: "Outerwear", size: "S", condition: "Excellent", color: "#d32f2f", silhouette: "coat", rent: 2900, buy: 27500, status: "listed", desc: "Statement cape in scarlet wool, cleaned and pressed." },
  { id: "blazer-04", provider: "prov-c09", name: "Lime Linen Blazer", category: "Outerwear", size: "L", condition: "Good", color: "#9ccc65", silhouette: "blazer", rent: 1900, buy: 13500, status: "listed", desc: "Unlined linen blazer in lime, easy summer layer." },
  { id: "blazer-05", provider: "prov-d21", name: "Tangerine Check Blazer", category: "Outerwear", size: "M", condition: "Very good", color: "#f57c00", silhouette: "blazer", rent: 2100, buy: 15800, status: "listed", desc: "Checked blazer in tangerine, fully lined." },
  { id: "blouse-04", provider: "prov-b04", name: "Turquoise Silk Top", category: "Tops", size: "M", condition: "Excellent", color: "#26a69a", silhouette: "blouse", rent: 1500, buy: 8200, status: "listed", desc: "Silk top in turquoise with a relaxed fit." },
  { id: "blouse-05", provider: "prov-a12", name: "Orchid Lace Blouse", category: "Tops", size: "S", condition: "Like new", color: "#ba68c8", silhouette: "blouse", rent: 1400, buy: 7600, status: "listed", desc: "Delicate lace blouse in orchid." },
  { id: "skirt-04", provider: "prov-c09", name: "Tangerine Tulle Skirt", category: "Skirts", size: "S", condition: "Excellent", color: "#ff8f00", silhouette: "skirt", rent: 1800, buy: 9900, status: "listed", desc: "Full tulle skirt in tangerine, wears light and airy." },
  { id: "skirt-05", provider: "prov-a12", name: "Teal Satin Maxi Skirt", category: "Skirts", size: "M", condition: "Very good", color: "#00897b", silhouette: "skirt", rent: 1750, buy: 9600, status: "listed", desc: "Floor-length satin skirt in teal." },
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