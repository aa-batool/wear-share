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

    DROP VIEW IF EXISTS public_items;
    CREATE VIEW public_items AS
      SELECT
        id, name, description, category, size, condition, color, silhouette,
        rent_price_per_day, buy_price, rent_only, buy_only, status,
        created_at, updated_at
      FROM items
      WHERE status IN ('listed', 'rented', 'in_transit');
      -- Excluded on purpose: 'intake' (not yet photographed), 'returned'
      -- (awaiting inspection/cleaning before relisting), 'sold', and
      -- 'retired'. 'rented'/'in_transit' stay visible so shoppers can
      -- still book future dates around a current rental — the
      -- availability calendar is what shows which specific dates are
      -- already taken (see Section 2.3 of the API specification doc).
  `);
}

module.exports = { createSchema };