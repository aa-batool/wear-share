// backend/routes/items.js
// ------------------------------------------------------------
// Public-facing item endpoints (API spec Section 2.1–2.3).
// Everything here reads from the `public_items` view, never the
// raw `items` table — that's what keeps provider_id from ever
// reaching a response, per the anonymity boundary described in
// the database schema and security notes documents.
//
// color/silhouette are returned even though they're not in the
// formal API spec — they're the placeholder-art fields the
// frontend still uses until real photography exists (see the
// comment in schema.js). Drop them from responses once photo
// uploads are real.
// ------------------------------------------------------------

const crypto = require("node:crypto");
const { photoPath } = require("./photos");

// Statuses that count as "currently booking-blocking" for a rental —
// a cancelled order shouldn't hold a date hostage.
const ACTIVE_RENT_STATUSES = ["pending", "confirmed", "shipped", "delivered", "return_due"];

function toItemJSON(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    size: row.size,
    condition: row.condition,
    color: row.color,
    silhouette: row.silhouette,
    rent_per_day: row.rent_price_per_day,
    buy_price: row.buy_price,
    rent_only: !!row.rent_only,
    buy_only: !!row.buy_only,
  };
}

function firstPhotoUrl(db, itemId) {
  const photo = db
    .prepare("SELECT id FROM item_photos WHERE item_id = ? ORDER BY sort_order LIMIT 1")
    .get(itemId);
  return photo ? photoPath(photo.id) : null;
}

function listItems(db, query) {
  let sql = "SELECT * FROM public_items WHERE 1=1";
  const params = [];

  if (query.category) {
    sql += " AND category = ?";
    params.push(query.category);
  }
  if (query.size) {
    sql += " AND size = ?";
    params.push(query.size);
  }
  if (query.mode === "rent") sql += " AND buy_only = 0";
  if (query.mode === "buy") sql += " AND rent_only = 0";

  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params);
  return {
    items: rows.map((row) => ({ ...toItemJSON(row), thumbnail_url: firstPhotoUrl(db, row.id) })),
    total_count: rows.length,
  };
}

function getActiveBookings(db, itemId) {
  const placeholders = ACTIVE_RENT_STATUSES.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT rent_start_date, rent_end_date FROM orders
       WHERE item_id = ? AND type = 'rent' AND status IN (${placeholders})
       AND rent_start_date IS NOT NULL`
    )
    .all(itemId, ...ACTIVE_RENT_STATUSES);
}

// Can this item be bought right now? A sale hands the garment over for
// good, so it can't happen while a rental is still ahead of it or the
// piece is out with a renter. Returns { available: true }, or
// { available: false, available_from } where available_from is the first
// day after the last blocking rental ends (null when that day has already
// passed — i.e. it's out and just hasn't come back yet).
const OUT_WITH_CUSTOMER = ["shipped", "delivered", "return_due"];

function getBuyAvailability(db, itemId) {
  const today = todayISO();
  const blocking = getActiveBookingsWithStatus(db, itemId).filter(
    (b) => b.rent_end_date >= today || OUT_WITH_CUSTOMER.includes(b.status)
  );
  if (blocking.length === 0) return { available: true };

  const lastEnd = blocking.reduce((max, b) => (b.rent_end_date > max ? b.rent_end_date : max), "");
  const from = addDaysISO(lastEnd, 1);
  return { available: false, available_from: from > today ? from : null };
}

function getActiveBookingsWithStatus(db, itemId) {
  const placeholders = ACTIVE_RENT_STATUSES.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT rent_start_date, rent_end_date, status FROM orders
       WHERE item_id = ? AND type = 'rent' AND status IN (${placeholders})
       AND rent_start_date IS NOT NULL`
    )
    .all(itemId, ...ACTIVE_RENT_STATUSES);
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function computeNextAvailable(db, itemId) {
  const bookings = getActiveBookings(db, itemId);
  if (bookings.length === 0) return todayISO();

  let candidate = todayISO();
  // Walk forward day by day (bounded) until we find a day with no
  // overlapping booking. Simple and correct; fine at this data volume.
  for (let i = 0; i < 365; i++) {
    const blocked = bookings.some((b) => candidate >= b.rent_start_date && candidate <= b.rent_end_date);
    if (!blocked) return candidate;
    candidate = addDaysISO(candidate, 1);
  }
  return candidate;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function getItemDetail(db, id) {
  const item = db.prepare("SELECT * FROM public_items WHERE id = ?").get(id);
  if (!item) return null;

  const photos = db
    .prepare("SELECT id, sort_order FROM item_photos WHERE item_id = ? ORDER BY sort_order")
    .all(id);

  // Dates only — enough to draw the availability calendar, and nothing
  // that identifies who booked them. Past bookings are dropped since the
  // calendar can't select past dates anyway.
  const today = todayISO();
  const bookedRanges = getActiveBookings(db, id)
    .filter((b) => b.rent_end_date >= today)
    .map((b) => ({ start_date: b.rent_start_date, end_date: b.rent_end_date }));

  return {
    ...toItemJSON(item),
    description: item.description,
    photos: photos.map((p) => ({ url: photoPath(p.id), sort_order: p.sort_order })),
    booked_ranges: bookedRanges,
    availability: {
      next_available_date: computeNextAvailable(db, id),
    },
    buy_availability: item.rent_only ? null : getBuyAvailability(db, id),
  };
}

function checkAvailability(db, id, startDate, endDate) {
  const bookings = getActiveBookings(db, id);
  const conflict = bookings.find((b) => rangesOverlap(startDate, endDate, b.rent_start_date, b.rent_end_date));

  if (!conflict) return { available: true };
  return {
    available: false,
    conflicting_range: { start_date: conflict.rent_start_date, end_date: conflict.rent_end_date },
  };
}

module.exports = {
  listItems,
  getItemDetail,
  checkAvailability,
  getActiveBookings,
  getBuyAvailability,
  rangesOverlap,
  ACTIVE_RENT_STATUSES,
};