// backend/routes/photos.js
// ------------------------------------------------------------
// Serves item photos as real image responses instead of shipping
// them around as giant base64 strings inside JSON. Without this, a
// catalog of 20 photographed items would be a multi-megabyte JSON
// response; with it, JSON carries a short path and the browser
// fetches (and caches) each image on its own.
//
// Photos are still stored as data URLs in the item_photos table for
// now (see the note in admin-items.js). Nothing outside this file
// needs to know that: when photos move to real object storage
// (R2/S3, per the tech stack document), only getPhoto() changes.
//
// Visibility rule: the public can only fetch photos of items that
// are in the public catalog (the public_items view). An admin
// session can fetch any photo, so the listings page can preview
// items that haven't been published yet.
// ------------------------------------------------------------

// Only these formats are accepted and served. SVG is left out on
// purpose — an SVG can carry script, and we'd be serving it from our
// own origin.
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

function photoPath(id) {
  return `/api/photos/${id}`;
}

function getPhoto(db, id, isAdmin) {
  const sql = isAdmin
    ? "SELECT url FROM item_photos WHERE id = ?"
    : "SELECT p.url FROM item_photos p JOIN public_items i ON i.id = p.item_id WHERE p.id = ?";
  const row = db.prepare(sql).get(id);
  if (!row) return null;

  const match = row.url.match(DATA_URL_RE);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
}

module.exports = { DATA_URL_RE, photoPath, getPhoto };
