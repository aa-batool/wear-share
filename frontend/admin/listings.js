/* ------------------------------------------------------------
   Listings management (admin)
   ------------------------------------------------------------
   Reads from GET /api/admin/items and writes with:
     status dropdown  -> PATCH /api/admin/items/:id  { status }
     "Save changes"   -> PATCH /api/admin/items/:id  { fields... }
                         then photo changes:
                         POST   /api/admin/items/:id/photos
                         DELETE /api/admin/items/:id/photos/:photoId
                         PATCH  /api/admin/items/:id/photos/:photoId
   Photos are edited as a local draft while the panel is open and only
   sent to the server when "Save changes" is pressed.
--------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", initListings);

const ITEM_STATUSES = ["intake", "listed", "rented", "sold", "in_transit", "returned", "retired"];
const CONDITIONS = ["Excellent", "Like new", "Very good", "Good", "Fair"];

// Phone photos are often 3-8 MB. Shrinking them in the browser first keeps
// uploads fast and well under the server's size limit, and a listing photo
// doesn't need more than this many pixels anyway.
function fileToResizedDataURL(file, maxDim = 1400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`"${file.name}" doesn't look like an image this browser can open.`));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // JPEG has no transparency
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function initListings() {
  const ledger = document.getElementById("listings-ledger");
  if (!ledger) return;

  const statusSelect = document.getElementById("f-status");
  const categorySelect = document.getElementById("f-category");
  const searchInput = document.getElementById("f-search");
  const countEl = document.getElementById("result-count");

  ITEM_STATUSES.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = statusLabel(s);
    statusSelect.appendChild(opt);
  });
  const presetStatus = new URLSearchParams(location.search).get("status");
  if (presetStatus && ITEM_STATUSES.includes(presetStatus)) statusSelect.value = presetStatus;

  let items = [];
  let openEditId = null;
  const photoDrafts = {}; // itemId -> [{ id|null, url, sort_order, dataUrl? }]
  // Text typed into the open edit panel but not saved yet. render() rebuilds
  // the whole table (e.g. after adding a photo), so without this, anything
  // typed so far would be wiped by the re-render.
  const fieldDrafts = {}; // itemId -> { name, category, size, condition, rent, buy, desc }

  const draftFromItem = (item) => item.photos.map((p) => ({ id: p.id, url: p.url, sort_order: p.sort_order }));

  async function load() {
    items = (await adminApi("/api/admin/items")).items;
    refreshCategoryFilter();
  }

  function categories() {
    return [...new Set(items.map((i) => i.category))].sort();
  }

  function refreshCategoryFilter() {
    const current = categorySelect.value;
    categorySelect.innerHTML = `<option value="">All</option>`;
    categories().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      categorySelect.appendChild(opt);
    });
    categorySelect.value = categories().includes(current) ? current : "";
  }

  function matches(item) {
    if (statusSelect.value && item.status !== statusSelect.value) return false;
    if (categorySelect.value && item.category !== categorySelect.value) return false;
    const q = searchInput.value.trim().toLowerCase();
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return true;
  }

  function priceCell(item) {
    const lines = [];
    if (!item.buy_only) lines.push(`<div>${item.rent_price_per_day != null ? `${esc(formatMoney(item.rent_price_per_day))}/day` : "— /day"}</div>`);
    if (!item.rent_only) lines.push(`<div>${item.buy_price != null ? `${esc(formatMoney(item.buy_price))}` : "— buy"}</div>`);
    return lines.join("");
  }

  function captureOpenPanel() {
    if (!openEditId) return;
    const get = (suffix) => document.getElementById(`edit-${suffix}-${openEditId}`);
    if (!get("name")) return; // panel isn't in the page (yet)
    fieldDrafts[openEditId] = {
      name: get("name").value,
      category: get("category").value,
      size: get("size").value,
      condition: get("condition").value,
      rent: get("rent").value,
      buy: get("buy").value,
      desc: get("desc").value,
    };
  }

  function optionsHtml(values, current) {
    return values.map((v) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(v)}</option>`).join("");
  }

  function photoThumbsHtml(id) {
    const photos = photoDrafts[id] || [];
    if (photos.length === 0) {
      return `<div class="photo-empty-note">No photos yet — add at least one before publishing.</div>`;
    }
    return photos
      .map(
        (p, i) => `
        <div class="photo-thumb">
          <img src="${esc(safeImageSrc(p.url))}" alt="Listing photo ${i + 1}" />
          <button type="button" class="remove-btn" data-remove-photo="${esc(id)}" data-index="${i}" title="Remove">&times;</button>
          <div class="move-btns">
            <button type="button" data-move-photo="${esc(id)}" data-index="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="Move left">&larr;</button>
            <button type="button" data-move-photo="${esc(id)}" data-index="${i}" data-dir="1" ${i === photos.length - 1 ? "disabled" : ""} title="Move right">&rarr;</button>
          </div>
        </div>`
      )
      .join("");
  }

  function editPanelHtml(item) {
    const isOpen = openEditId === item.id;
    if (!isOpen) return `<div class="edit-panel tag" id="panel-${esc(item.id)}"></div>`;

    const id = esc(item.id);
    const f = fieldDrafts[item.id] || {}; // unsaved edits win over the server's values
    const cond = f.condition ?? item.condition;
    const conditions = CONDITIONS.includes(cond) ? CONDITIONS : [cond, ...CONDITIONS];
    return `
      <div class="edit-panel tag open" id="panel-${id}">
        ${
          item.intake_notes
            ? `<div class="intake-notes"><div class="intake-notes-label">From the provider's intake form</div>${esc(item.intake_notes)}</div>`
            : ""
        }
        <div class="form-row">
          <div class="form-group">
            <label for="edit-name-${id}">Name</label>
            <input type="text" id="edit-name-${id}" value="${esc(f.name ?? item.name)}" />
          </div>
          <div class="form-group">
            <label for="edit-category-${id}">Category</label>
            <select id="edit-category-${id}">${optionsHtml(categories(), f.category ?? item.category)}</select>
          </div>
          <div class="form-group">
            <label for="edit-size-${id}">Size</label>
            <input type="text" id="edit-size-${id}" value="${esc(f.size ?? item.size)}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="edit-condition-${id}">Condition</label>
            <select id="edit-condition-${id}">${optionsHtml(conditions, cond)}</select>
          </div>
          <div class="form-group">
            <label for="edit-rent-${id}">Rent / day (Rs)</label>
            <input type="number" min="0" step="any" id="edit-rent-${id}" value="${esc(f.rent ?? item.rent_price_per_day ?? "")}" ${item.buy_only ? "disabled" : ""} />
          </div>
          <div class="form-group">
            <label for="edit-buy-${id}">Buy price (Rs)</label>
            <input type="number" min="0" step="any" id="edit-buy-${id}" value="${esc(f.buy ?? item.buy_price ?? "")}" ${item.rent_only ? "disabled" : ""} />
          </div>
        </div>
        <div class="form-group">
          <label for="edit-desc-${id}">Description</label>
          <textarea id="edit-desc-${id}">${esc(f.desc ?? item.description ?? "")}</textarea>
        </div>
        <div class="form-group">
          <label>Photos</label>
          <div class="photo-grid" id="photo-grid-${id}">${photoThumbsHtml(item.id)}</div>
          <input type="file" accept="image/*" multiple id="photo-input-${id}" style="display:none" />
          <button type="button" class="edit-btn" data-add-photo="${id}">+ Add photo</button>
        </div>
        <div class="save-row">
          <button type="button" class="cta" data-save="${id}">Save changes</button>
          <button type="button" class="edit-btn" data-cancel="${id}">Cancel</button>
        </div>
      </div>`;
  }

  function render() {
    captureOpenPanel();
    const results = items.filter(matches);
    countEl.textContent = `${results.length} listing${results.length === 1 ? "" : "s"}`;

    if (results.length === 0) {
      ledger.innerHTML = `<div class="empty-row">${items.length === 0 ? "No listings yet." : "Nothing matches those filters."}</div>`;
      return;
    }

    const head = `
      <div class="ledger-row listing-row head">
        <span>Item</span><span>Category</span><span>Size</span><span>Status</span><span>Price</span><span>Actions</span>
      </div>`;

    const rows = results
      .map(
        (item) => `
        <div class="ledger-row listing-row">
          <span data-label="Item">${esc(item.name)}<br><span style="color:var(--ink-soft); font-size:0.78rem;">${esc(item.provider_name)}</span>${
            item.buy_order_id
              ? `<br><span class="purchase-tag" title="Cancel the purchase order to show it in the shop again">Purchase ${esc(item.buy_order_id)} — hidden from the shop</span>`
              : ""
          }</span>
          <span data-label="Category">${esc(item.category)}</span>
          <span data-label="Size">${esc(item.size)}</span>
          <span data-label="Status">
            <select class="status-select" data-status-for="${esc(item.id)}">${ITEM_STATUSES.map(
              (s) => `<option value="${s}" ${s === item.status ? "selected" : ""}>${esc(statusLabel(s))}</option>`
            ).join("")}</select>
          </span>
          <span data-label="Price">${priceCell(item)}</span>
          <span data-label="Actions"><button type="button" class="edit-btn" data-edit="${esc(item.id)}">${openEditId === item.id ? "Close" : "Edit"}</button></span>
        </div>
        ${editPanelHtml(item)}`
      )
      .join("");

    ledger.innerHTML = head + rows;
    bindEvents();
  }

  // ---- saving ----

  const priceValue = (el) => {
    const v = el.value.trim();
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };

  // Makes the server's photos for this item match the draft: delete what was
  // removed, upload what's new, then set every photo's position.
  async function syncPhotos(itemId, item) {
    const draft = photoDrafts[itemId];
    if (!draft) return;
    const base = `/api/admin/items/${encodeURIComponent(itemId)}/photos`;

    const keep = new Set(draft.filter((p) => p.id).map((p) => p.id));
    for (const original of item.photos) {
      if (!keep.has(original.id)) await adminApi(`${base}/${encodeURIComponent(original.id)}`, { method: "DELETE" });
    }
    for (const p of draft) {
      if (!p.id) {
        const created = await adminApi(base, { method: "POST", body: { data_url: p.dataUrl } });
        p.id = created.id;
        p.sort_order = created.sort_order;
      }
    }
    for (let i = 0; i < draft.length; i++) {
      if (draft[i].sort_order !== i) {
        await adminApi(`${base}/${encodeURIComponent(draft[i].id)}`, { method: "PATCH", body: { sort_order: i } });
      }
    }
  }

  async function saveItem(id, button) {
    const item = items.find((i) => i.id === id);
    const val = (suffix) => document.getElementById(`edit-${suffix}-${id}`);

    const name = val("name").value.trim();
    if (!name) return adminMessage("The item needs a name.");

    const payload = {
      name,
      category: val("category").value,
      size: val("size").value.trim() || item.size,
      condition: val("condition").value,
      description: val("desc").value.trim(),
    };
    if (!item.buy_only) payload.rent_price_per_day = priceValue(val("rent"));
    if (!item.rent_only) payload.buy_price = priceValue(val("buy"));
    if ([payload.rent_price_per_day, payload.buy_price].some((n) => Number.isNaN(n))) {
      return adminMessage("Prices must be numbers, zero or higher.");
    }

    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await adminApi(`/api/admin/items/${encodeURIComponent(id)}`, { method: "PATCH", body: payload });
      await syncPhotos(id, item);
      delete photoDrafts[id];
      delete fieldDrafts[id];
      openEditId = null;
      await load();
      render();
      adminMessage("Saved.", "success");
    } catch (err) {
      adminMessage(err.message);
      // Show what the server actually has now, and keep the panel open to retry.
      await load();
      const fresh = items.find((i) => i.id === id);
      if (fresh) photoDrafts[id] = draftFromItem(fresh);
      render();
    }
  }

  // ---- events ----

  function bindEvents() {
    ledger.querySelectorAll("[data-status-for]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        try {
          await adminApi(`/api/admin/items/${encodeURIComponent(sel.dataset.statusFor)}`, {
            method: "PATCH",
            body: { status: sel.value },
          });
          await load();
          adminMessage("Status updated.", "success");
        } catch (err) {
          adminMessage(err.message); // e.g. "Set a rent price per day before listing this item."
          await load();
        }
        render();
      });
    });

    ledger.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.edit;
        if (openEditId === id) {
          delete photoDrafts[id];
          delete fieldDrafts[id];
          openEditId = null;
        } else {
          openEditId = id;
          delete fieldDrafts[id];
          photoDrafts[id] = draftFromItem(items.find((i) => i.id === id));
        }
        render();
      });
    });

    ledger.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        delete photoDrafts[btn.dataset.cancel];
        delete fieldDrafts[btn.dataset.cancel];
        openEditId = null;
        render();
      });
    });

    ledger.querySelectorAll("[data-save]").forEach((btn) => {
      btn.addEventListener("click", () => saveItem(btn.dataset.save, btn));
    });

    ledger.querySelectorAll("[data-add-photo]").forEach((btn) => {
      btn.addEventListener("click", () => document.getElementById(`photo-input-${btn.dataset.addPhoto}`).click());
    });

    ledger.querySelectorAll('input[type="file"]').forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.id.replace("photo-input-", "");
        const files = Array.from(input.files || []);
        for (const file of files) {
          try {
            const dataUrl = await fileToResizedDataURL(file);
            (photoDrafts[id] ||= []).push({ id: null, url: dataUrl, dataUrl });
          } catch (err) {
            adminMessage(err.message);
          }
        }
        render();
      });
    });

    ledger.querySelectorAll("[data-remove-photo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        photoDrafts[btn.dataset.removePhoto].splice(Number(btn.dataset.index), 1);
        render();
      });
    });

    ledger.querySelectorAll("[data-move-photo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const arr = photoDrafts[btn.dataset.movePhoto];
        const index = Number(btn.dataset.index);
        const target = index + Number(btn.dataset.dir);
        if (target < 0 || target >= arr.length) return;
        [arr[index], arr[target]] = [arr[target], arr[index]];
        render();
      });
    });
  }

  [statusSelect, categorySelect].forEach((el) => el.addEventListener("change", render));
  searchInput.addEventListener("input", render);

  ledger.innerHTML = `<div class="empty-row">Loading listings…</div>`;
  try {
    await load();
  } catch (err) {
    showLoadError(ledger, err);
    return;
  }
  render();
}