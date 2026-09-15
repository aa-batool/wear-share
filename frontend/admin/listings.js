/* ------------------------------------------------------------
   Listings management
   ------------------------------------------------------------
   Reads/writes ADMIN_ITEMS in memory only — nothing persists
   across a page reload yet. Once the backend exists:
     - initial load becomes GET /admin/items
     - status changes become PATCH /admin/items/:id { status }
     - the edit panel's Save becomes PATCH /admin/items/:id
       with the full set of changed fields
   (see the API specification document).
--------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", initListings);

function statusLabel(status) {
  return status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function initListings() {
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
  [...new Set(ADMIN_ITEMS.map((i) => i.category))].sort().forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    categorySelect.appendChild(opt);
  });

  const presetStatus = new URLSearchParams(location.search).get("status");
  if (presetStatus && ITEM_STATUSES.includes(presetStatus)) statusSelect.value = presetStatus;

  let openEditId = null;
  let photoDrafts = {}; // itemId -> array of data URLs, held only while that item's panel is open

  function matches(item) {
    if (statusSelect.value && item.status !== statusSelect.value) return false;
    if (categorySelect.value && item.category !== categorySelect.value) return false;
    const q = searchInput.value.trim().toLowerCase();
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return true;
  }

  function priceCell(item) {
    const lines = [];
    if (!item.buyOnly) lines.push(`<div>$${item.rentPerDay}/day</div>`);
    if (!item.rentOnly) lines.push(`<div>$${item.buyPrice}</div>`);
    return lines.join("");
  }

  function statusOptionsHtml(current) {
    return ITEM_STATUSES.map(
      (s) => `<option value="${s}" ${s === current ? "selected" : ""}>${statusLabel(s)}</option>`
    ).join("");
  }

  function categoryOptionsHtml(current) {
    const cats = [...new Set(ADMIN_ITEMS.map((i) => i.category))].sort();
    return cats.map((c) => `<option value="${c}" ${c === current ? "selected" : ""}>${c}</option>`).join("");
  }

  function editPanelHtml(item) {
    return `
      <div class="edit-panel tag${openEditId === item.id ? " open" : ""}" id="panel-${item.id}">
        <div class="form-row">
          <div class="form-group">
            <label for="edit-name-${item.id}">Name</label>
            <input type="text" id="edit-name-${item.id}" value="${item.name}" />
          </div>
          <div class="form-group">
            <label for="edit-category-${item.id}">Category</label>
            <select id="edit-category-${item.id}">${categoryOptionsHtml(item.category)}</select>
          </div>
          <div class="form-group">
            <label for="edit-size-${item.id}">Size</label>
            <input type="text" id="edit-size-${item.id}" value="${item.size}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="edit-condition-${item.id}">Condition</label>
            <select id="edit-condition-${item.id}">
              ${["Excellent", "Very good", "Good", "Fair", "Like new"]
                .map((c) => `<option ${c === item.condition ? "selected" : ""}>${c}</option>`)
                .join("")}
            </select>
          </div>
          <div class="form-group">
            <label for="edit-rent-${item.id}">Rent / day ($)</label>
            <input type="number" min="0" id="edit-rent-${item.id}" value="${item.rentPerDay}" ${item.buyOnly ? "disabled" : ""} />
          </div>
          <div class="form-group">
            <label for="edit-buy-${item.id}">Buy price ($)</label>
            <input type="number" min="0" id="edit-buy-${item.id}" value="${item.buyPrice}" ${item.rentOnly ? "disabled" : ""} />
          </div>
        </div>
        <div class="form-group">
          <label for="edit-desc-${item.id}">Description</label>
          <textarea id="edit-desc-${item.id}">${item.description}</textarea>
        </div>
        <div class="form-group">
          <label>Photos</label>
          <div class="photo-grid" id="photo-grid-${item.id}">${renderPhotoThumbs(item.id)}</div>
          <input type="file" accept="image/*" multiple id="photo-input-${item.id}" style="display:none" />
          <button type="button" class="edit-btn" data-add-photo="${item.id}">+ Add photo</button>
        </div>
        <div class="save-row">
          <button type="button" class="cta" data-save="${item.id}">Save changes</button>
          <button type="button" class="edit-btn" data-cancel="${item.id}">Cancel</button>
          <span class="save-confirm" id="confirm-${item.id}">Saved.</span>
        </div>
      </div>`;
  }

  function renderPhotoThumbs(id) {
    const photos = photoDrafts[id] || [];
    if (photos.length === 0) {
      return `<div class="photo-empty-note">No photos yet — add at least one before publishing.</div>`;
    }
    return photos
      .map(
        (src, i) => `
        <div class="photo-thumb">
          <img src="${src}" alt="Listing photo ${i + 1}" />
          <button type="button" class="remove-btn" data-remove-photo="${id}" data-index="${i}" title="Remove">&times;</button>
          <div class="move-btns">
            <button type="button" data-move-photo="${id}" data-index="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="Move left">&larr;</button>
            <button type="button" data-move-photo="${id}" data-index="${i}" data-dir="1" ${i === photos.length - 1 ? "disabled" : ""} title="Move right">&rarr;</button>
          </div>
        </div>`
      )
      .join("");
  }

  function render() {
    const results = ADMIN_ITEMS.filter(matches);
    countEl.textContent = `${results.length} listing${results.length === 1 ? "" : "s"}`;

    if (results.length === 0) {
      ledger.innerHTML = `<div class="empty-row">Nothing matches those filters.</div>`;
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
          <span data-label="Item">${item.name}<br><span style="color:var(--ink-soft); font-size:0.78rem;">${item.provider}</span></span>
          <span data-label="Category">${item.category}</span>
          <span data-label="Size">${item.size}</span>
          <span data-label="Status">
            <select class="status-select" data-status-for="${item.id}">${statusOptionsHtml(item.status)}</select>
          </span>
          <span data-label="Price">${priceCell(item)}</span>
          <span data-label="Actions"><button type="button" class="edit-btn" data-edit="${item.id}">Edit</button></span>
        </div>
        ${editPanelHtml(item)}`
      )
      .join("");

    ledger.innerHTML = head + rows;

    ledger.querySelectorAll("[data-status-for]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const item = ADMIN_ITEMS.find((i) => i.id === sel.dataset.statusFor);
        item.status = sel.value;
      });
    });

    ledger.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.edit;
        if (openEditId === id) {
          delete photoDrafts[id];
          openEditId = null;
        } else {
          const item = ADMIN_ITEMS.find((i) => i.id === id);
          photoDrafts[id] = (item.photos || []).slice();
          openEditId = id;
        }
        render();
      });
    });

    ledger.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        delete photoDrafts[btn.dataset.cancel];
        openEditId = null;
        render();
      });
    });

    ledger.querySelectorAll("[data-save]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.save;
        const item = ADMIN_ITEMS.find((i) => i.id === id);
        item.name = document.getElementById(`edit-name-${id}`).value.trim() || item.name;
        item.category = document.getElementById(`edit-category-${id}`).value;
        item.size = document.getElementById(`edit-size-${id}`).value.trim() || item.size;
        item.condition = document.getElementById(`edit-condition-${id}`).value;
        item.rentPerDay = Number(document.getElementById(`edit-rent-${id}`).value) || item.rentPerDay;
        item.buyPrice = Number(document.getElementById(`edit-buy-${id}`).value) || item.buyPrice;
        item.description = document.getElementById(`edit-desc-${id}`).value.trim();
        item.photos = (photoDrafts[id] || item.photos || []).slice();
        delete photoDrafts[id];
        openEditId = null;
        render();
      });
    });

    ledger.querySelectorAll("[data-add-photo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById(`photo-input-${btn.dataset.addPhoto}`).click();
      });
    });

    ledger.querySelectorAll('input[type="file"]').forEach((input) => {
      input.addEventListener("change", () => {
        const id = input.id.replace("photo-input-", "");
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        let remaining = files.length;
        files.forEach((file) => {
          const reader = new FileReader();
          reader.onload = () => {
            photoDrafts[id] = photoDrafts[id] || [];
            photoDrafts[id].push(reader.result);
            remaining -= 1;
            if (remaining === 0) render();
          };
          reader.readAsDataURL(file);
        });
      });
    });

    ledger.querySelectorAll("[data-remove-photo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.removePhoto;
        const index = Number(btn.dataset.index);
        photoDrafts[id].splice(index, 1);
        render();
      });
    });

    ledger.querySelectorAll("[data-move-photo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.movePhoto;
        const index = Number(btn.dataset.index);
        const dir = Number(btn.dataset.dir);
        const arr = photoDrafts[id];
        const target = index + dir;
        if (target < 0 || target >= arr.length) return;
        [arr[index], arr[target]] = [arr[target], arr[index]];
        render();
      });
    });
  }

  [statusSelect, categorySelect].forEach((el) => el.addEventListener("change", render));
  searchInput.addEventListener("input", render);

  render();
}