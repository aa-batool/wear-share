// backend/db/schema.js
// ------------------------------------------------------------
// Creates every table from the database schema document, plus
// the indexes it recommends and the public_items view that
// enforces the anonymity boundary at the query level (Section 5
// of that document): public-facing code should query this view,
// never the raw items table, so provider_id can't leak even by
// accident.
// ------------------------------------------------------------

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      address TEXT,
      payout_method TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id),
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      size TEXT NOT NULL,
      condition TEXT NOT NULL,
      color TEXT,
      silhouette TEXT,
      rent_price_per_day REAL,
      buy_price REAL,
      rent_only INTEGER NOT NULL DEFAULT 0,
      buy_only INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'intake',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS item_photos (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id),
      url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      shipping_address TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      rent_start_date TEXT,
      rent_end_date TEXT,
      price_total REAL NOT NULL,
      deposit_amount REAL,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      status TEXT NOT NULL,
      note TEXT,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      direction TEXT NOT NULL,
      courier TEXT NOT NULL,
      tracking_number TEXT,
      label_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      shipped_at TEXT,
      delivered_at TEXT
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_item ON orders(item_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
  `);

  runMigrations(db);

  db.exec(`
    DROP VIEW IF EXISTS public_items;
    CREATE VIEW public_items AS
      SELECT
        id, name, description, category, size, condition, color, silhouette,
        rent_price_per_day, buy_price, rent_only, buy_only, status,
        created_at, updated_at
      FROM items
      WHERE status IN ('listed', 'rented', 'in_transit')
        -- A piece that someone has bought is gone from the shop the moment the
        -- order exists, whatever its status says. Cancelling that purchase
        -- (the only way a buy order leaves this state) puts it straight back.
        AND NOT EXISTS (
          SELECT 1 FROM orders o
          WHERE o.item_id = items.id AND o.type = 'buy' AND o.status != 'cancelled'
        );
      -- Excluded on purpose: 'intake' (not yet photographed), 'returned'
      -- (awaiting inspection/cleaning before relisting), 'sold', and
      -- 'retired'. 'rented'/'in_transit' stay visible so shoppers can
      -- still book future dates around a current rental — the
      -- availability calendar is what shows which specific dates are
      -- already taken (see Section 2.3 of the API specification doc).
  `);
}

module.exports = { createSchema };

// Small, additive migrations for databases created before a column
// existed. CREATE TABLE IF NOT EXISTS won't add columns to a table
// that's already there, so anything added after the first release of
// the schema goes here. Each step checks before altering, so running
// on every boot is safe.
function runMigrations(db) {
  const itemColumns = db.prepare("PRAGMA table_info(items)").all().map((c) => c.name);

  // Free-text details from the provider's intake form (brand, notes,
  // preferred handoff, estimated value). Admin-only — deliberately not
  // in the public_items view.
  if (!itemColumns.includes("intake_notes")) {
    db.exec("ALTER TABLE items ADD COLUMN intake_notes TEXT");
  }

  // A purchase of a piece that's still booked for rental is accepted, but
  // delivered afterwards. These record that, so fulfilment knows to hold
  // the shipment: delivery_held = 1, and deliver_after = the first day it
  // can leave us (NULL when the piece is out with a renter and has no
  // fixed return date yet).
  const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  if (!orderColumns.includes("delivery_held")) {
    db.exec("ALTER TABLE orders ADD COLUMN delivery_held INTEGER NOT NULL DEFAULT 0");
  }
  if (!orderColumns.includes("deliver_after")) {
    db.exec("ALTER TABLE orders ADD COLUMN deliver_after TEXT");
  }

  // Where to send a provider's money (bank / wallet details they gave on the
  // intake form). Admin-only: shown in Payouts, never public, never emailed.
  const providerColumns = db.prepare("PRAGMA table_info(providers)").all().map((c) => c.name);
  if (!providerColumns.includes("payout_details")) db.exec("ALTER TABLE providers ADD COLUMN payout_details TEXT");

  // Set once the provider has been told their piece was booked / bought.
  if (!orderColumns.includes("provider_notified")) db.exec("ALTER TABLE orders ADD COLUMN provider_notified INTEGER NOT NULL DEFAULT 0");

  // What the customer was charged for delivery and collection (included in price_total).
  if (!orderColumns.includes("delivery_fee")) db.exec("ALTER TABLE orders ADD COLUMN delivery_fee REAL NOT NULL DEFAULT 0");

  // Cancelling, refunds and returns (see routes/order-lifecycle.js):
  //   cancelled_by    'customer' or 'admin'
  //   refund_status   NULL (none), 'due' or 'sent' - set when a PAID order is cancelled
  //   returned_on, return_note   when a rental came back and the shop's note on its condition
  //   late_fee, damage_fee, charges_status   extra charges (NULL / 'due' / 'collected')
  //   due_reminder_on, late_reminder_on      the dates reminder emails last went out
  for (const [name, def] of [
    ["cancelled_by", "TEXT"],
    ["refund_status", "TEXT"],
    ["returned_on", "TEXT"],
    ["return_note", "TEXT"],
    ["late_fee", "REAL NOT NULL DEFAULT 0"],
    ["damage_fee", "REAL NOT NULL DEFAULT 0"],
    ["charges_status", "TEXT"],
    ["due_reminder_on", "TEXT"],
    ["late_reminder_on", "TEXT"],
  ]) {
    if (!orderColumns.includes(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${def}`);
  }

  // How the customer chose to pay: 'cod' (cash on delivery) or 'online'
  // (bank transfer / mobile wallet, confirmed by the admin). NULL on
  // orders placed before the payment step existed.
  if (!orderColumns.includes("payment_method")) {
    db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT");
  }
}