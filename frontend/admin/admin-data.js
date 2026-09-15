/* ------------------------------------------------------------
   Mock admin data — stand-in for real database queries until
   the backend exists. Once the API is live, replace the reads
   below with calls to GET /admin/items, GET /admin/orders, etc.
   (see the API specification document).
--------------------------------------------------------------- */

const ADMIN_STATS = {
  intakeQueue: 3,
  activeOrders: 5,
  upcomingReturns: 2,
  pendingPayouts: 4,
};

const RECENT_ACTIVITY = [
  { item: "Deep Plum Velvet Gown", type: "Rent", customer: "J. R.", status: "shipped", date: "Sep 13" },
  { item: "Fawn Wool Overcoat", type: "Buy", customer: "A. K.", status: "confirmed", date: "Sep 13" },
  { item: "Bottle Green Velvet Blazer", type: "Rent", customer: "S. M.", status: "pending", date: "Sep 12" },
  { item: "Blush Tulle Gown", type: "Rent", customer: "N. H.", status: "delivered", date: "Sep 10" },
  { item: "Terracotta Wrap Dress", type: "Buy", customer: "F. Q.", status: "completed", date: "Sep 8" },
];

/* ------------------------------------------------------------
   Admin item records (listings management)
   ------------------------------------------------------------
   Fuller than the public catalog's data.js: includes status,
   the provider it came from, and both prices regardless of
   rent-only/buy-only, since the admin needs the full picture.
   Edits made in the UI update this array in memory only — they
   reset on page reload until the backend exists.
--------------------------------------------------------------- */

const ITEM_STATUSES = ["intake", "listed", "rented", "sold", "in_transit", "returned", "retired"];

const ADMIN_ITEMS = [
  { id: "gown-01", name: "Deep Plum Velvet Gown", category: "Dresses", size: "M", condition: "Excellent", status: "rented", rentPerDay: 13, buyPrice: 150, rentOnly: false, buyOnly: false, provider: "Provider #A12", description: "Floor-length velvet gown with a fitted waist." },
  { id: "wrap-01", name: "Terracotta Wrap Dress", category: "Dresses", size: "S", condition: "Like new", status: "sold", rentPerDay: 8, buyPrice: 58, rentOnly: false, buyOnly: false, provider: "Provider #B04", description: "A-line wrap in a warm terracotta." },
  { id: "coat-01", name: "Fawn Wool Overcoat", category: "Outerwear", size: "M", condition: "Very good", status: "listed", rentPerDay: 10, buyPrice: 92, rentOnly: false, buyOnly: false, provider: "Provider #A12", description: "Double-breasted wool coat, a couple of winters in." },
  { id: "blazer-01", name: "Bottle Green Velvet Blazer", category: "Outerwear", size: "L", condition: "Excellent", status: "in_transit", rentPerDay: 9, buyPrice: 78, rentOnly: false, buyOnly: false, provider: "Provider #C09", description: "Covered-button velvet blazer with a bit of drama." },
  { id: "gown-02", name: "Blush Tulle Gown", category: "Dresses", size: "S", condition: "Excellent", status: "returned", rentPerDay: 14, buyPrice: 158, rentOnly: false, buyOnly: false, provider: "Provider #B04", description: "Layered tulle skirt, sweetheart bodice." },
  { id: "blouse-01", name: "Ivory Silk Blouse", category: "Tops", size: "M", condition: "Good", status: "listed", rentPerDay: 5, buyPrice: 26, rentOnly: true, buyOnly: false, provider: "Provider #C09", description: "Simple, well-cut silk blouse." },
  { id: "skirt-01", name: "Charcoal Pleated Midi", category: "Skirts", size: "S", condition: "Very good", status: "intake", rentPerDay: 6, buyPrice: 33, rentOnly: false, buyOnly: false, provider: "Provider #A12", description: "Knife-pleated midi skirt. Not yet photographed." },
  { id: "gown-03", name: "Ink Blue Satin Gown", category: "Dresses", size: "L", condition: "Excellent", status: "retired", rentPerDay: 13, buyPrice: 149, rentOnly: false, buyOnly: true, provider: "Provider #B04", description: "Deep satin gown with a slit and open back. Worn through, retired from rotation." },
  { id: "top-02", name: "Sage Linen Shirt", category: "Tops", size: "L", condition: "Good", status: "intake", rentPerDay: 4, buyPrice: 20, rentOnly: false, buyOnly: false, provider: "Provider #D21", description: "Just arrived, awaiting photography." },
];

/* ------------------------------------------------------------
   Admin order records (orders management)
   ------------------------------------------------------------
   Status updates here update this array in memory only. Once
   the backend exists, this becomes GET /admin/orders and status
   changes become PATCH /admin/orders/:id/status (which should
   also write to order_status_history — see database schema doc).
--------------------------------------------------------------- */

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "return_due", "returned", "completed", "cancelled"];

const ADMIN_ORDERS = [
  { id: "ord-1001", item: "Deep Plum Velvet Gown", type: "rent", customer: "Jamila R.", email: "jamila.r@example.com", address: "Block 4, Clifton, Karachi", status: "shipped", rentStart: "Sep 12", rentEnd: "Sep 19", total: 91, createdAt: "Sep 10" },
  { id: "ord-1002", item: "Fawn Wool Overcoat", type: "buy", customer: "Ahmed K.", email: "ahmed.k@example.com", address: "DHA Phase 5, Karachi", status: "confirmed", rentStart: null, rentEnd: null, total: 92, createdAt: "Sep 13" },
  { id: "ord-1003", item: "Bottle Green Velvet Blazer", type: "rent", customer: "Sara M.", email: "sara.m@example.com", address: "Gulshan-e-Iqbal, Karachi", status: "pending", rentStart: "Sep 18", rentEnd: "Sep 23", total: 45, createdAt: "Sep 12" },
  { id: "ord-1004", item: "Blush Tulle Gown", type: "rent", customer: "Noor H.", email: "noor.h@example.com", address: "F-7, Islamabad", status: "return_due", rentStart: "Sep 3", rentEnd: "Sep 10", total: 98, createdAt: "Sep 1" },
  { id: "ord-1005", item: "Terracotta Wrap Dress", type: "buy", customer: "Fatima Q.", email: "fatima.q@example.com", address: "Model Town, Lahore", status: "completed", rentStart: null, rentEnd: null, total: 58, createdAt: "Sep 5" },
  { id: "ord-1006", item: "Ivory Silk Blouse", type: "rent", customer: "Zainab T.", email: "zainab.t@example.com", address: "Bahria Town, Lahore", status: "returned", rentStart: "Aug 28", rentEnd: "Sep 2", total: 25, createdAt: "Aug 26" },
  { id: "ord-1007", item: "Charcoal Pleated Midi", type: "rent", customer: "Hina S.", email: "hina.s@example.com", address: "North Nazimabad, Karachi", status: "cancelled", rentStart: "Sep 8", rentEnd: "Sep 11", total: 18, createdAt: "Sep 6" },
];

/* ------------------------------------------------------------
   Admin payout records (payouts screen)
   ------------------------------------------------------------
   Only relevant if revenue-sharing is part of the business
   model (see project document, Section 8). Marking a payout
   paid updates this array in memory only. Once the backend
   exists, this becomes GET /admin/payouts and the action becomes
   POST /admin/payouts/:id/mark-paid.
--------------------------------------------------------------- */

const ADMIN_PAYOUTS = [
  { id: "pay-01", provider: "Provider #A12", item: "Deep Plum Velvet Gown", orderId: "ord-1001", amount: 46, status: "pending", createdAt: "Sep 13" },
  { id: "pay-02", provider: "Provider #A12", item: "Fawn Wool Overcoat", orderId: "ord-1002", amount: 46, status: "pending", createdAt: "Sep 13" },
  { id: "pay-03", provider: "Provider #C09", item: "Bottle Green Velvet Blazer", orderId: "ord-1003", amount: 23, status: "pending", createdAt: "Sep 12" },
  { id: "pay-04", provider: "Provider #B04", item: "Blush Tulle Gown", orderId: "ord-1004", amount: 49, status: "pending", createdAt: "Sep 10" },
  { id: "pay-05", provider: "Provider #B04", item: "Terracotta Wrap Dress", orderId: "ord-1005", amount: 29, status: "paid", createdAt: "Sep 5", paidAt: "Sep 7" },
  { id: "pay-06", provider: "Provider #C09", item: "Ivory Silk Blouse", orderId: "ord-1006", amount: 12, status: "paid", createdAt: "Aug 26", paidAt: "Aug 29" },
];