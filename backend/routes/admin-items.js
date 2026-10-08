// backend/routes/admin-items.js
// ------------------------------------------------------------
// Listing management (API spec Section 3.3) — the admin-side
// counterpart to the public items.js. This file is allowed to
// see provider_id and every item status; nothing it returns
// should ever be routed to a public-facing response.
//
// Photo upload accepts a JSON body with a data URL string
// instead of a real multipart file upload — matches how the
// admin listings page already captures photos client-side via
// FileReader. Swap for real object storage (Cloudflare R2/S3,
// per the tech stack document) when that's built; the shape of
// this endpoint's response shouldn't need to change either way.
// ------------------------------------------------------------

const { randomId } = require("./util");
const mailer = require("../mailer");
const { DATA_URL_RE, photoPath } = require("./photos");

const ITEM_STATUSES = ["intake", "listed", "rented", "sold", "in_transit", "returned", "retired"];

// Statuses that put an item in the public catalog — must match the
// public_items view in db/schema.js.
const PUBLIC_STATUSES = ["listed", "rented", "in_transit"];

function listItemsAdmin(db, query) {
  let sql = `
    SELECT i.*, p.name as provider_name,
           (SELECT o.id FROM orders o
            WHERE o.item_id = i.id AND o.type = 'buy' AND o.status != 'cancelled'
            ORDER BY o.created_at LIMIT 1) AS buy_order_id
    FROM items i
    JOIN providers p ON p.id = i.provider_id
    WHERE 1=1
  `;
  const params = [];

  if (query.status) {
    sql += " AND i.status = ?";
    params.push(query.status);
  }
  if (query.category) {
    sql += " AND i.category = ?";
    params.push(query.category);
  }
  if (query.provider_id) {
    sql += " AND i.provider_id = ?";
    params.push(query.provider_id);
  }
  sql += " ORDER BY i.created_at DESC, i.rowid DESC";

  const rows = db.prepare(sql).all(...params);
  const withPhotos = rows.map((item) => ({
    ...item,
    // Paths, not the stored data URLs — the image itself is fetched
    // from /api/photos/:id (see photos.js).
    photos: db
      .prepare("SELECT id, sort_order FROM item_photos WHERE item_id = ? ORDER BY sort_order")
      .all(item.id)
      .map((p) => ({ id: p.id, url: photoPath(p.id), sort_order: p.sort_order })),
  }));

  return { status: 200, body: { items: withPhotos } };
}

function updateItem(db, id, body) {
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id);
  if (!item) return { status: 404, error: { code: "item_not_found", message: "No item exists with that id." } };

  if (!body) return { status: 400, error: { code: "invalid_body", message: "Request body is required." } };

  if (body.status && !ITEM_STATUSES.includes(body.status)) {
    return { status: 422, error: { code: "invalid_status", message: `status must be one of: ${ITEM_STATUSES.join(", ")}` } };
  }

  for (const f of ["rent_price_per_day", "buy_price"]) {
    if (body[f] !== undefined && body[f] !== null && !(Number.isFinite(body[f]) && body[f] >= 0)) {
      return { status: 422, error: { code: "invalid_price", message: `${f} must be a number, zero or higher.` } };
    }
  }

  // An item visible in the public catalog has to be priced for every way
  // it can be acquired — otherwise a shopper would see "Rs null" on the card.
  const next = (f) => (body[f] !== undefined ? body[f] : item[f]);
  if (PUBLIC_STATUSES.includes(next("status"))) {
    const rentOnly = !!next("rent_only");
    const buyOnly = !!next("buy_only");
    if (rentOnly && buyOnly) {
      return { status: 422, error: { code: "invalid_mode", message: "An item can't be both rent-only and buy-only." } };
    }
    if (!buyOnly && !(next("rent_price_per_day") > 0)) {
      return { status: 422, error: { code: "price_required", message: "Set a rent price per day before listing this item." } };
    }
    if (!rentOnly && !(next("buy_price") > 0)) {
      return { status: 422, error: { code: "price_required", message: "Set a buy price before listing this item." } };
    }
  }

  const fields = ["name", "description", "category", "size", "condition", "color", "rent_price_per_day", "buy_price", "rent_only", "buy_only", "status"];
  const updates = [];
  const params = [];
  fields.forEach((f) => {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(f === "rent_only" || f === "buy_only" ? (body[f] ? 1 : 0) : body[f]);
    }
  });

  if (updates.length === 0) {
    return { status: 400, error: { code: "invalid_body", message: "No updatable fields were provided." } };
  }

  updates.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE items SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  if (body.status && body.status !== item.status) {
    mailer.notifyItemStatus({ itemId: id, itemName: body.name || item.name, from: item.status, to: body.status });
    if (item.status === "intake" && body.status === "listed") {
      const prov = db.prepare("SELECT name, email FROM providers WHERE id = ?").get(item.provider_id);
      if (prov) mailer.providerItemListed({ provider: prov, itemName: body.name || item.name });
    }
  }

  return { status: 200, body: db.prepare("SELECT * FROM items WHERE id = ?").get(id) };
}

function addPhoto(db, itemId, body) {
  const item = db.prepare("SELECT id FROM items WHERE id = ?").get(itemId);
  if (!item) return { status: 404, error: { code: "item_not_found", message: "No item exists with that id." } };
  if (!body || !body.data_url) {
    return { status: 400, error: { code: "invalid_body", message: "data_url is required." } };
  }
  // Only real raster images — anything else (SVG, HTML, arbitrary text)
  // would be served back out from our own origin.
  if (typeof body.data_url !== "string" || !DATA_URL_RE.test(body.data_url)) {
    return { status: 422, error: { code: "invalid_image", message: "Photos must be PNG, JPEG, WebP, or GIF images." } };
  }

  const { max_sort } = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM item_photos WHERE item_id = ?")
    .get(itemId);

  const id = randomId("photo");
  db.prepare(`INSERT INTO item_photos (id, item_id, url, sort_order) VALUES (?, ?, ?, ?)`).run(
    id,
    itemId,
    body.data_url,
    max_sort + 1
  );

  return { status: 201, body: { id, url: photoPath(id), sort_order: max_sort + 1 } };
}

function deletePhoto(db, itemId, photoId) {
  const photo = db.prepare("SELECT id FROM item_photos WHERE id = ? AND item_id = ?").get(photoId, itemId);
  if (!photo) return { status: 404, error: { code: "photo_not_found", message: "No photo exists with that id on that item." } };

  db.prepare("DELETE FROM item_photos WHERE id = ?").run(photoId);
  return { status: 200, body: { deleted: true } };
}

function reorderPhoto(db, itemId, photoId, body) {
  const photo = db.prepare("SELECT id FROM item_photos WHERE id = ? AND item_id = ?").get(photoId, itemId);
  if (!photo) return { status: 404, error: { code: "photo_not_found", message: "No photo exists with that id on that item." } };
  if (!body || body.sort_order === undefined) {
    return { status: 400, error: { code: "invalid_body", message: "sort_order is required." } };
  }

  db.prepare("UPDATE item_photos SET sort_order = ? WHERE id = ?").run(body.sort_order, photoId);
  return { status: 200, body: { id: photoId, sort_order: body.sort_order } };
}

module.exports = { listItemsAdmin, updateItem, addPhoto, deletePhoto, reorderPhoto, ITEM_STATUSES };