/* ------------------------------------------------------------
   Item photos
   ------------------------------------------------------------
   Shows the item's real photo when one has been uploaded in the
   admin panel; otherwise falls back to a simple line silhouette on
   a flat color field, so unphotographed items still look intentional.
--------------------------------------------------------------- */

const SILHOUETTES = {
  gown: "M150 38c-13 0-23 9-23 21 0 7 4 13 9 17-29 13-44 44-48 87l-19 183h162l-19-183c-4-43-19-74-48-87 5-4 9-10 9-17 0-12-10-21-23-21z",
  wrap: "M150 40c-12 0-21 8-21 19 0 6 3 11 7 15-25 10-38 31-40 60l6 202h96l6-202c-2-29-15-50-40-60 4-4 7-9 7-15 0-11-9-19-21-19z",
  coat: "M112 44l-33 25 13 29 20-14v244h76V84l20 14 13-29-33-25c-6 10-17 15-29 15s-23-5-29-15z",
  blazer: "M114 42l-31 23 12 27 21-15 8 19-17 202h88l-17-202 8-19 21 15 12-27-31-23c-6 11-17 19-31 19s-25-8-31-19z",
  blouse: "M120 48l-29 21 12 25 19-13 4 17-13 145h96l-13-145 4-17 19 13 12-25-29-21c-5 9-15 15-26 15s-21-6-26-15z",
  skirt: "M122 58h56l13 38 25 212H84l25-212z",
};

// `src` overrides which photo to show (used by the detail page gallery).
function renderPhoto(item, src) {
  const photo = src || item.photoUrl;
  if (photo) {
    return `<img src="${esc(photo)}" alt="${esc(item.name)}" />`;
  }

  const path = SILHOUETTES[item.silhouette] || SILHOUETTES.wrap;
  const color = /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : "#8a7350";
  const stroke = shade(color, 34);
  return `
    <svg viewBox="0 0 300 380" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(item.name)}">
      <rect width="300" height="380" fill="${color}"></rect>
      <path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"></path>
    </svg>`;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

/* ------------------------------------------------------------
   Availability calendar
   ------------------------------------------------------------
   Reads item.bookedRanges, which comes from the backend's item
   detail response (dates only — see booked_ranges in
   backend/routes/items.js). The server re-checks availability
   when the order is actually placed, so this calendar is a
   convenience for the shopper, not the source of truth. The
   shopper picks a start and end date directly on the calendar.
--------------------------------------------------------------- */

function parseISODate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function diffDays(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatShort(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isDateBooked(item, date) {
  const ranges = item.bookedRanges || [];
  return ranges.some((r) => date >= parseISODate(r.start) && date <= parseISODate(r.end));
}

function datesBetween(start, end) {
  const dates = [];
  const count = diffDays(start, end) + 1;
  for (let i = 0; i < count; i++) dates.push(addDays(start, i));
  return dates;
}

function hasConflict(item, start, end) {
  return datesBetween(start, end).some((d) => isDateBooked(item, d));
}

function renderCalendarMonth(item, year, month, rangeStart, rangeEnd) {
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const thisIndex = year * 12 + month;
  const todayIndex = today.getFullYear() * 12 + today.getMonth();
  const atMin = thisIndex <= todayIndex;

  const selectedSet = new Set(
    rangeStart && rangeEnd
      ? datesBetween(rangeStart, rangeEnd).map((d) => d.getTime())
      : rangeStart
      ? [rangeStart.getTime()]
      : []
  );
  const conflict = rangeStart && rangeEnd ? hasConflict(item, rangeStart, rangeEnd) : false;

  let cells = "";
  for (let i = 0; i < startDay; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const isPast = date < today;
    const isToday = date.getTime() === today.getTime();
    const booked = isDateBooked(item, date);
    const isSelected = selectedSet.has(date.getTime());
    const clickable = !isPast && !booked;

    let cls = "cal-cell";
    if (isPast) cls += " past";
    else if (booked) cls += " booked";
    else cls += " open";
    if (isSelected) cls += conflict ? " selected conflict" : " selected";
    if (isToday) cls += " today";
    if (clickable) cls += " clickable";

    cells += `<div class="${cls}" ${clickable ? `data-cal-date="${toISO(date)}"` : ""}>${d}</div>`;
  }

  const hint = !rangeStart
    ? "Click a date to start your rental there."
    : !rangeEnd
    ? "Now click the last day you'll have it."
    : "Click a new date to start over.";

  return `
    <div class="cal-header">
      <button type="button" class="cal-nav" data-cal-nav="-1" ${atMin ? "disabled" : ""}>&larr;</button>
      <span class="cal-month-label">${monthLabel}</span>
      <button type="button" class="cal-nav" data-cal-nav="1">&rarr;</button>
    </div>
    <div class="cal-weekdays">${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">
      <span class="legend-item"><span class="legend-swatch"></span> Open</span>
      <span class="legend-item"><span class="legend-swatch selected"></span> Your dates</span>
      <span class="legend-item"><span class="legend-swatch booked"></span> Already booked</span>
    </div>
    <p class="cal-hint">${hint}</p>
  `;
}

/* ------------------------------------------------------------
   Catalog page
--------------------------------------------------------------- */

async function initCatalog() {
  const grid = document.getElementById("catalog-grid");
  if (!grid) return;

  const categorySelect = document.getElementById("f-category");
  const sizeSelect = document.getElementById("f-size");
  const modeSelect = document.getElementById("f-mode");
  const countEl = document.getElementById("result-count");

  grid.innerHTML = `<div class="empty-state">Loading the closet…</div>`;

  let items;
  try {
    const data = await api("/api/items");
    items = data.items.map(normalizeItem);
  } catch (err) {
    countEl.textContent = "";
    showLoadError(grid, err);
    return;
  }

  const unique = (arr) => [...new Set(arr)].sort();
  const addOptions = (select, values) => {
    values.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
  };
  addOptions(categorySelect, unique(items.map((i) => i.category)));
  addOptions(sizeSelect, unique(items.map((i) => i.size)));

  function matches(item) {
    if (categorySelect.value && item.category !== categorySelect.value) return false;
    if (sizeSelect.value && item.size !== sizeSelect.value) return false;
    if (modeSelect.value === "rent" && item.buyOnly) return false;
    if (modeSelect.value === "buy" && item.rentOnly) return false;
    return true;
  }

  function render() {
    const results = items.filter(matches);
    countEl.textContent = `${results.length} item${results.length === 1 ? "" : "s"} listed`;

    if (results.length === 0) {
      const message = items.length === 0
        ? "Nothing is listed right now — check back soon."
        : "Nothing matches those filters yet. Try widening your search.";
      grid.innerHTML = `<div class="empty-state">${message}</div>`;
      return;
    }

    grid.innerHTML = results
      .map((item) => {
        const rows = [];
        rows.push(`<div class="spec-row"><span class="k">Size</span><span class="v">${esc(item.size)}</span></div>`);
        rows.push(`<div class="spec-row"><span class="k">Condition</span><span class="v">${esc(item.condition)}</span></div>`);
        if (!item.buyOnly) rows.push(`<div class="spec-row"><span class="k">Rent / day</span><span class="v rent">${esc(formatMoney(item.rentPerDay))}</span></div>`);
        if (!item.rentOnly) rows.push(`<div class="spec-row"><span class="k">Buy</span><span class="v buy">${esc(formatMoney(item.buyPrice))}</span></div>`);

        return `
        <a class="item-card tag" href="item.html?id=${encodeURIComponent(item.id)}">
          <div class="item-photo">${renderPhoto(item)}</div>
          <div class="item-info">
            <div class="item-name">${esc(item.name)}</div>
            ${rows.join("")}
          </div>
        </a>`;
      })
      .join("");
  }

  [categorySelect, sizeSelect, modeSelect].forEach((el) => el.addEventListener("change", render));
  render();
}

/* ------------------------------------------------------------
   Item detail page
--------------------------------------------------------------- */

async function initDetail() {
  const root = document.getElementById("detail-root");
  if (!root) return;

  const id = new URLSearchParams(location.search).get("id");
  root.innerHTML = `<div class="empty-state">Loading…</div>`;

  let item;
  try {
    item = normalizeItem(await api(`/api/items/${encodeURIComponent(id || "")}`));
  } catch (err) {
    if (err.code === "item_not_found") {
      root.innerHTML = `<div class="empty-state">We couldn't find that listing. <a href="index.html">Back to the closet</a>.</div>`;
    } else {
      showLoadError(root, err);
    }
    return;
  }

  document.title = `${item.name} — WearShare`;

  const canRent = !item.buyOnly;
  const canBuy = !item.rentOnly;
  let mode = canRent ? "rent" : "buy";

  const thumbs =
    item.photos.length > 1
      ? `<div class="thumb-strip">${item.photos
          .map(
            (src, i) =>
              `<button type="button" class="${i === 0 ? "active" : ""}" data-photo-index="${i}" aria-label="Show photo ${i + 1}"><img src="${esc(src)}" alt="" /></button>`
          )
          .join("")}</div>`
      : "";

  root.innerHTML = `
    <div>
      <div class="detail-photo tag" id="main-photo">${renderPhoto(item, item.photos[0])}</div>
      ${thumbs}
    </div>
    <div>
      <h1 class="detail-name">${esc(item.name)}</h1>
      <p class="detail-desc">${esc(item.description)}</p>

      <div class="spec-sheet">
        <div class="spec-row"><span class="k">Category</span><span class="v">${esc(item.category)}</span></div>
        <div class="spec-row"><span class="k">Size</span><span class="v">${esc(item.size)}</span></div>
        <div class="spec-row"><span class="k">Condition</span><span class="v">${esc(item.condition)}</span></div>
      </div>

      ${
        canRent && canBuy
          ? `<div class="mode-tabs">
               <button data-mode="rent" class="active">Rent it</button>
               <button data-mode="buy">Buy it</button>
             </div>`
          : ""
      }

      <div class="order-panel" id="order-panel"></div>

      <div class="routing-stub">
        <strong>From:</strong> anonymous &nbsp; <strong>To:</strong> you &nbsp; <strong>Handled by:</strong> us, start to finish.
        The person who sent this in never sees who rents or buys it.
      </div>
    </div>
  `;

  root.querySelectorAll("[data-photo-index]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.photoIndex);
      document.getElementById("main-photo").innerHTML = renderPhoto(item, item.photos[index]);
      root.querySelectorAll("[data-photo-index]").forEach((b) => b.classList.toggle("active", b === btn));
    })
  );

  const panel = document.getElementById("order-panel");
  const tabsWrap = root.querySelector(".mode-tabs");
  const tabs = root.querySelectorAll(".mode-tabs button");

  let calDate = new Date();
  let calYear = calDate.getFullYear();
  let calMonth = calDate.getMonth();
  let rangeStart = null; // first click sets this; second click sets rangeEnd
  let rangeEnd = null;

  tabs.forEach((btn) =>
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      tabs.forEach((b) => b.classList.toggle("active", b === btn));
      renderPanel();
    })
  );

  function renderCalendarSection() {
    const container = document.getElementById("cal-container");
    if (!container) return;
    container.innerHTML = renderCalendarMonth(item, calYear, calMonth, rangeStart, rangeEnd);

    container.querySelectorAll("[data-cal-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        calMonth += Number(btn.dataset.calNav);
        if (calMonth < 0) {
          calMonth = 11;
          calYear -= 1;
        } else if (calMonth > 11) {
          calMonth = 0;
          calYear += 1;
        }
        renderCalendarSection();
      });
    });

    container.querySelectorAll("[data-cal-date]").forEach((cell) => {
      cell.addEventListener("click", () => {
        const clicked = parseISODate(cell.dataset.calDate);

        if (!rangeStart || rangeEnd) {
          rangeStart = clicked;
          rangeEnd = null;
        } else if (clicked < rangeStart) {
          rangeStart = clicked;
          rangeEnd = null;
        } else {
          rangeEnd = clicked;
        }

        renderCalendarSection();
        updateRentSummary();
      });
    });
  }

  function updateRentSummary() {
    const dateRangeEl = document.getElementById("date-range");
    const priceEl = document.getElementById("price");
    const warningEl = document.getElementById("conflict-warning");
    const cta = document.getElementById("cta");

    if (!rangeStart) {
      dateRangeEl.textContent = "Pick your start date on the calendar";
      priceEl.textContent = "—";
      warningEl.classList.remove("show");
      cta.disabled = true;
      return;
    }

    if (!rangeEnd) {
      dateRangeEl.textContent = `${formatShort(rangeStart)} → pick your return date`;
      priceEl.textContent = "—";
      warningEl.classList.remove("show");
      cta.disabled = true;
      return;
    }

    const days = diffDays(rangeStart, rangeEnd) + 1;
    const conflict = hasConflict(item, rangeStart, rangeEnd);

    dateRangeEl.textContent = `${formatShort(rangeStart)} → ${formatShort(rangeEnd)} (${days} day${days === 1 ? "" : "s"})`;
    priceEl.textContent = formatMoney(item.rentPerDay * days);

    if (conflict) {
      warningEl.classList.add("show");
      cta.disabled = true;
    } else {
      warningEl.classList.remove("show");
      cta.disabled = false;
    }
  }

  // When a piece is still booked for rental, buying it is allowed but the
  // delivery has to wait. The wording lives in api.js because the payment page
  // shows the same message; a buyer who needs it sooner can walk away here.
  function delayedDeliveryNotice(hold) {
    return delayedDeliveryNoticeHtml(hold.availableFrom);
  }

  function renderPanel() {
    if (mode === "rent") {
      panel.innerHTML = `
        <div class="availability-block">
          <div class="availability-heading">Availability</div>
          <div id="cal-container"></div>
        </div>
        <div class="order-row">
          <label>Your dates</label>
          <span id="date-range"></span>
        </div>
        <div class="conflict-warning" id="conflict-warning">
          Those dates overlap an existing booking — pick a different start or end date.
        </div>
        <div class="total-row"><span>Total</span><span id="price">—</span></div>
        <button class="cta" id="cta">Request to rent</button>
      `;
      renderCalendarSection();
      updateRentSummary();
    } else {
      panel.innerHTML = `
        <div class="total-row"><span>Total</span><span>${esc(formatMoney(item.buyPrice))}</span></div>
        <button class="cta" id="cta">Request to buy</button>
      `;
    }

    document.getElementById("cta").addEventListener("click", () => renderCheckout());
  }

  /* ----------------------------------------------------------
     Checkout: collects the shopper's contact & shipping details, then
     moves on to the payment page (payment.html), where they choose cash on
     delivery or online payment and the order is actually placed. The
     details travel between the two pages in sessionStorage (see api.js);
     nothing is sent to the server from this step.
  ---------------------------------------------------------- */
  function total() {
    return mode === "rent" ? item.rentPerDay * (diffDays(rangeStart, rangeEnd) + 1) : item.buyPrice;
  }

  function renderCheckout(prefill) {
    if (tabsWrap) tabsWrap.style.display = "none";

    // Buying a piece that's still booked for rental: show the delay and ask
    // the buyer to confirm it before they can order.
    const delayed = mode === "buy" && !item.buyAvailability.available;

    const summary =
      mode === "rent"
        ? `<strong>${esc(item.name)}</strong> — ${formatShort(rangeStart)} → ${formatShort(rangeEnd)} — ${esc(formatMoney(total()))}`
        : `<strong>${esc(item.name)}</strong> — buy — ${esc(formatMoney(total()))}`;

    panel.innerHTML = `
      <span class="checkout-back" id="checkout-back">&larr; Back</span>
      <div class="checkout-summary">${summary}</div>
      ${delayed ? `<div class="delivery-notice" id="delivery-notice">${delayedDeliveryNotice(item.buyAvailability)}</div>` : ""}
      <form id="checkout-form" novalidate>
        <div class="form-group">
          <label for="co-name">Your name <span class="req">*</span></label>
          <input type="text" id="co-name" autocomplete="name" />
          <div class="error-text" id="err-co-name">We need a name for the order.</div>
        </div>
        <div class="form-group">
          <label for="co-email">Email <span class="req">*</span></label>
          <input type="email" id="co-email" autocomplete="email" />
          <div class="error-text" id="err-co-email">Enter a valid email.</div>
        </div>
        <div class="form-group">
          <label for="co-phone">Phone <span class="req">*</span></label>
          <input type="tel" id="co-phone" placeholder="+92 3xx xxxxxxx" autocomplete="tel" />
          <div class="error-text" id="err-co-phone">We need a number in case of delivery questions.</div>
        </div>
        <div class="form-group">
          <label for="co-address">Shipping address <span class="req">*</span></label>
          <input type="text" id="co-address" placeholder="Street, area, city" autocomplete="street-address" />
          <div class="error-text" id="err-co-address">We need an address to ship to.</div>
        </div>
        ${
          delayed
            ? `<div class="form-group">
                 <label class="ack-row"><input type="checkbox" id="co-ack" /> <span>I understand it will be delivered after the rental ends.</span></label>
                 <div class="error-text" id="err-co-ack">Please confirm you're happy to wait for delivery, or go back.</div>
               </div>`
            : ""
        }
        <div class="conflict-warning" id="checkout-error"></div>
        <button type="submit" class="cta" id="checkout-submit">Continue to payment</button>
      </form>
    `;

    if (prefill) {
      document.getElementById("co-name").value = prefill.name || "";
      document.getElementById("co-email").value = prefill.email || "";
      document.getElementById("co-phone").value = prefill.phone || "";
      document.getElementById("co-address").value = prefill.shipping_address || "";
    }

    document.getElementById("checkout-back").addEventListener("click", () => {
      if (tabsWrap) tabsWrap.style.display = "";
      renderPanel();
    });

    const form = document.getElementById("checkout-form");
    const errorBox = document.getElementById("checkout-error");
    const fields = [
      { input: document.getElementById("co-name"), errorId: "err-co-name" },
      { input: document.getElementById("co-email"), errorId: "err-co-email", isEmail: true },
      { input: document.getElementById("co-phone"), errorId: "err-co-phone" },
      { input: document.getElementById("co-address"), errorId: "err-co-address" },
    ];
    // Is this field acceptable right now? Always reads the live value, so text put
    // in by the browser's autofill (which doesn't always fire "input") counts too.
    const fieldBad = ({ input, isEmail }) => {
      const value = input.value.trim();
      return !value || (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
    };
    // Only ever clears an error; showing one is the submit handler's job.
    const clearIfFixed = (f) => {
      if (fieldBad(f)) return;
      f.input.classList.remove("field-error");
      document.getElementById(f.errorId).classList.remove("show");
    };
    const clearAllFixed = () => fields.forEach(clearIfFixed);
    // Browser autofill can fill boxes without any event the page hears, so also
    // look every moment while the form is on screen (stops when the form is replaced).
    const watcher = setInterval(() => {
      if (!document.body.contains(form)) return clearInterval(watcher);
      clearAllFixed();
    }, 250);
    fields.forEach((f) => {
      ["input", "change", "blur", "focus", "animationstart"].forEach((ev) => f.input.addEventListener(ev, () => clearIfFixed(f)));
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errorBox.classList.remove("show");

      let valid = true;
      fields.forEach((f) => {
        const { input, errorId } = f;
        const bad = fieldBad(f);
        input.classList.toggle("field-error", bad);
        document.getElementById(errorId).classList.toggle("show", bad);
        if (bad) valid = false;
      });
      const ackBox = document.getElementById("co-ack");
      if (ackBox) {
        const unticked = !ackBox.checked;
        document.getElementById("err-co-ack").classList.toggle("show", unticked);
        if (unticked) valid = false;
      }
      if (!valid) {
        // Autofill can land a moment after the click; drop errors on fields that are now filled.
        setTimeout(clearAllFixed, 150);
        return;
      }
      // Valid: make sure no stale error is left on screen while the next page loads.
      form.querySelectorAll(".error-text.show").forEach((el) => el.classList.remove("show"));
      form.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));

      const draft = {
        item_id: item.id,
        type: mode,
        customer: {
          name: document.getElementById("co-name").value.trim(),
          email: document.getElementById("co-email").value.trim(),
          phone: document.getElementById("co-phone").value.trim(),
          shipping_address: document.getElementById("co-address").value.trim(),
        },
      };
      if (mode === "rent") {
        draft.rent_start_date = toISO(rangeStart);
        draft.rent_end_date = toISO(rangeEnd);
      }
      if (ackBox && ackBox.checked) draft.acknowledge_delayed_delivery = true;

      if (!saveCheckoutDraft(draft)) {
        errorBox.textContent = "Your browser is blocking the temporary storage we use to carry your details to the payment page. Try again outside a private window.";
        errorBox.classList.add("show");
        return;
      }
      window.location.href = `payment.html?item=${encodeURIComponent(item.id)}`;
    });
  }

  // Back from the payment page ("Edit details"): put the shopper exactly where
  // they were — same mode, same dates, details filled in — instead of a blank page.
  const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const resume = new URLSearchParams(location.search).get("resume") === "1" ? loadCheckoutDraft() : null;
  const canResume =
    resume &&
    resume.item_id === item.id &&
    ((resume.type === "rent" && canRent && isDay(resume.rent_start_date) && isDay(resume.rent_end_date)) || (resume.type === "buy" && canBuy));

  if (canResume) {
    mode = resume.type;
    tabs.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    let datesStillFree = true;
    if (mode === "rent") {
      rangeStart = parseISODate(resume.rent_start_date);
      rangeEnd = parseISODate(resume.rent_end_date);
      calYear = rangeStart.getFullYear();
      calMonth = rangeStart.getMonth();
      if (hasConflict(item, rangeStart, rangeEnd)) {
        // Someone booked those dates meanwhile: show the calendar so they can choose again.
        rangeEnd = null;
        datesStillFree = false;
      }
    }
    renderPanel();
    if (datesStillFree) renderCheckout(resume.customer);
  } else {
    renderPanel();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initCatalog();
  initDetail();
});