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

const ITEM_STATUSES = ["intake", "listed", "rented", "sold", "in_transit", "returned", "retired"];

function listItemsAdmin(db, query) {
  let sql = "SELECT * FROM items WHERE 1=1";
  const params = [];

  if (query.status) {
    sql += " AND status = ?";
    params.push(query.status);
  }
  if (query.category) {
    sql += " AND category = ?";
    params.push(query.category);
  }
  if (query.provider_id) {
    sql += " AND provider_id = ?";
    params.push(query.provider_id);
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params);
  const withPhotos = rows.map((item) => ({
    ...item,
    photos: db.prepare("SELECT id, url, sort_order FROM item_photos WHERE item_id = ? ORDER BY sort_order").all(item.id),
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

  return { status: 200, body: db.prepare("SELECT * FROM items WHERE id = ?").get(id) };
}

function addPhoto(db, itemId, body) {
  const item = db.prepare("SELECT id FROM items WHERE id = ?").get(itemId);
  if (!item) return { status: 404, error: { code: "item_not_found", message: "No item exists with that id." } };
  if (!body || !body.data_url) {
    return { status: 400, error: { code: "invalid_body", message: "data_url is required." } };
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

  return { status: 201, body: { id, url: body.data_url, sort_order: max_sort + 1 } };
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