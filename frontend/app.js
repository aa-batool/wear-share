/* ------------------------------------------------------------
   Placeholder garment art
   ------------------------------------------------------------
   Renders a simple line silhouette on a flat color field, standing
   in for a real product photo. Once photography exists, replace
   the call to renderPhoto() with an <img> tag pointing at the
   uploaded photo — everything else stays the same.
--------------------------------------------------------------- */

const SILHOUETTES = {
  gown: "M150 38c-13 0-23 9-23 21 0 7 4 13 9 17-29 13-44 44-48 87l-19 183h162l-19-183c-4-43-19-74-48-87 5-4 9-10 9-17 0-12-10-21-23-21z",
  wrap: "M150 40c-12 0-21 8-21 19 0 6 3 11 7 15-25 10-38 31-40 60l6 202h96l6-202c-2-29-15-50-40-60 4-4 7-9 7-15 0-11-9-19-21-19z",
  coat: "M112 44l-33 25 13 29 20-14v244h76V84l20 14 13-29-33-25c-6 10-17 15-29 15s-23-5-29-15z",
  blazer: "M114 42l-31 23 12 27 21-15 8 19-17 202h88l-17-202 8-19 21 15 12-27-31-23c-6 11-17 19-31 19s-25-8-31-19z",
  blouse: "M120 48l-29 21 12 25 19-13 4 17-13 145h96l-13-145 4-17 19 13 12-25-29-21c-5 9-15 15-26 15s-21-6-26-15z",
  skirt: "M122 58h56l13 38 25 212H84l25-212z",
};

function renderPhoto(item) {
  const path = SILHOUETTES[item.silhouette] || SILHOUETTES.wrap;
  const stroke = shade(item.color, 34);
  return `
    <svg viewBox="0 0 300 380" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${item.name}">
      <rect width="300" height="380" fill="${item.color}"></rect>
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
   Reads item.bookedRanges (mock data — a real backend would
   check this against existing orders for the item; see the
   API specification document, Section 2.3, "Check rental
   availability"). View-only for now: shows what's booked
   alongside the day-count picker, doesn't replace it.
--------------------------------------------------------------- */

function parseISODate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isDateBooked(item, date) {
  const ranges = item.bookedRanges || [];
  return ranges.some((r) => date >= parseISODate(r.start) && date <= parseISODate(r.end));
}

function renderCalendarMonth(item, year, month) {
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const thisIndex = year * 12 + month;
  const todayIndex = today.getFullYear() * 12 + today.getMonth();
  const atMin = thisIndex <= todayIndex;

  let cells = "";
  for (let i = 0; i < startDay; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const isPast = date < today;
    const isToday = date.getTime() === today.getTime();
    const booked = isDateBooked(item, date);
    let cls = "cal-cell";
    if (isPast) cls += " past";
    else if (booked) cls += " booked";
    else cls += " open";
    if (isToday) cls += " today";
    cells += `<div class="${cls}">${d}</div>`;
  }

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
      <span class="legend-item"><span class="legend-swatch booked"></span> Already booked</span>
    </div>
  `;
}

/* ------------------------------------------------------------
   Catalog page
--------------------------------------------------------------- */

function initCatalog() {
  const grid = document.getElementById("catalog-grid");
  if (!grid) return;

  const categorySelect = document.getElementById("f-category");
  const sizeSelect = document.getElementById("f-size");
  const modeSelect = document.getElementById("f-mode");
  const countEl = document.getElementById("result-count");

  const unique = (arr) => [...new Set(arr)].sort();
  const addOptions = (select, values) => {
    values.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
  };
  addOptions(categorySelect, unique(ITEMS.map((i) => i.category)));
  addOptions(sizeSelect, unique(ITEMS.map((i) => i.size)));

  function matches(item) {
    if (categorySelect.value && item.category !== categorySelect.value) return false;
    if (sizeSelect.value && item.size !== sizeSelect.value) return false;
    if (modeSelect.value === "rent" && item.buyOnly) return false;
    if (modeSelect.value === "buy" && item.rentOnly) return false;
    return true;
  }

  function render() {
    const results = ITEMS.filter(matches);
    countEl.textContent = `${results.length} item${results.length === 1 ? "" : "s"} listed`;

    if (results.length === 0) {
      grid.innerHTML = `<div class="empty-state">Nothing matches those filters yet. Try widening your search.</div>`;
      return;
    }

    grid.innerHTML = results
      .map((item) => {
        const rows = [];
        rows.push(`<div class="spec-row"><span class="k">Size</span><span class="v">${item.size}</span></div>`);
        rows.push(`<div class="spec-row"><span class="k">Condition</span><span class="v">${item.condition}</span></div>`);
        if (!item.buyOnly) rows.push(`<div class="spec-row"><span class="k">Rent / day</span><span class="v rent">$${item.rentPerDay}</span></div>`);
        if (!item.rentOnly) rows.push(`<div class="spec-row"><span class="k">Buy</span><span class="v buy">$${item.buyPrice}</span></div>`);

        return `
        <a class="item-card tag" href="item.html?id=${item.id}">
          <div class="item-photo">${renderPhoto(item)}</div>
          <div class="item-info">
            <div class="item-name">${item.name}</div>
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

function initDetail() {
  const root = document.getElementById("detail-root");
  if (!root) return;

  const item = ITEMS.find((i) => i.id === new URLSearchParams(location.search).get("id"));

  if (!item) {
    root.innerHTML = `<div class="empty-state">We couldn't find that listing. <a href="index.html">Back to the closet</a>.</div>`;
    return;
  }

  document.title = `${item.name} — WearShare`;

  const canRent = !item.buyOnly;
  const canBuy = !item.rentOnly;
  let mode = canRent ? "rent" : "buy";
  let days = 3;

  root.innerHTML = `
    <div class="detail-photo tag">${renderPhoto(item)}</div>
    <div>
      <h1 class="detail-name">${item.name}</h1>
      <p class="detail-desc">${item.description}</p>

      <div class="spec-sheet">
        <div class="spec-row"><span class="k">Category</span><span class="v">${item.category}</span></div>
        <div class="spec-row"><span class="k">Size</span><span class="v">${item.size}</span></div>
        <div class="spec-row"><span class="k">Condition</span><span class="v">${item.condition}</span></div>
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

  const panel = document.getElementById("order-panel");
  const tabsWrap = root.querySelector(".mode-tabs");
  const tabs = root.querySelectorAll(".mode-tabs button");

  let calDate = new Date();
  let calYear = calDate.getFullYear();
  let calMonth = calDate.getMonth();

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
    container.innerHTML = renderCalendarMonth(item, calYear, calMonth);
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
  }

  function renderPanel() {
    if (mode === "rent") {
      panel.innerHTML = `
        <div class="availability-block">
          <div class="availability-heading">Availability</div>
          <div id="cal-container"></div>
        </div>
        <div class="order-row">
          <label for="days">Rental length</label>
          <select id="days">
            <option value="3">3 days</option>
            <option value="5">5 days</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
          </select>
        </div>
        <div class="total-row"><span>Total</span><span id="price">$${item.rentPerDay * days}</span></div>
        <button class="cta" id="cta">Request to rent</button>
      `;
      renderCalendarSection();
      const daysSelect = document.getElementById("days");
      daysSelect.value = String(days);
      daysSelect.addEventListener("change", () => {
        days = Number(daysSelect.value);
        document.getElementById("price").textContent = `$${item.rentPerDay * days}`;
      });
    } else {
      panel.innerHTML = `
        <div class="total-row"><span>Total</span><span>$${item.buyPrice}</span></div>
        <button class="cta" id="cta">Request to buy</button>
      `;
    }

    document.getElementById("cta").addEventListener("click", renderCheckout);
  }

  /* ----------------------------------------------------------
     Checkout: collects the shopper's contact & shipping info.
     No backend yet — a valid submit generates a mock order
     reference and shows a confirmation. Once the backend exists,
     replace handleCheckoutSubmit() with a real POST /orders call
     (see the API specification document).
  ---------------------------------------------------------- */
  function total() {
    return mode === "rent" ? item.rentPerDay * days : item.buyPrice;
  }

  function renderCheckout() {
    if (tabsWrap) tabsWrap.style.display = "none";

    const summary =
      mode === "rent"
        ? `<strong>${item.name}</strong> — rent for ${days} days — $${total()}`
        : `<strong>${item.name}</strong> — buy — $${total()}`;

    panel.innerHTML = `
      <span class="checkout-back" id="checkout-back">&larr; Back</span>
      <div class="checkout-summary">${summary}</div>
      <form id="checkout-form" novalidate>
        <div class="form-group">
          <label for="co-name">Your name <span class="req">*</span></label>
          <input type="text" id="co-name" />
          <div class="error-text" id="err-co-name">We need a name for the order.</div>
        </div>
        <div class="form-group">
          <label for="co-email">Email <span class="req">*</span></label>
          <input type="email" id="co-email" />
          <div class="error-text" id="err-co-email">Enter a valid email.</div>
        </div>
        <div class="form-group">
          <label for="co-phone">Phone <span class="req">*</span></label>
          <input type="tel" id="co-phone" placeholder="+92 3xx xxxxxxx" />
          <div class="error-text" id="err-co-phone">We need a number in case of delivery questions.</div>
        </div>
        <div class="form-group">
          <label for="co-address">Shipping address <span class="req">*</span></label>
          <input type="text" id="co-address" placeholder="Street, area, city" />
          <div class="error-text" id="err-co-address">We need an address to ship to.</div>
        </div>
        <button type="submit" class="cta">Confirm ${mode === "rent" ? "rental" : "purchase"}</button>
      </form>
    `;

    document.getElementById("checkout-back").addEventListener("click", () => {
      if (tabsWrap) tabsWrap.style.display = "";
      renderPanel();
    });

    const form = document.getElementById("checkout-form");
    const fields = [
      { input: document.getElementById("co-name"), errorId: "err-co-name" },
      { input: document.getElementById("co-email"), errorId: "err-co-email", isEmail: true },
      { input: document.getElementById("co-phone"), errorId: "err-co-phone" },
      { input: document.getElementById("co-address"), errorId: "err-co-address" },
    ];
    fields.forEach(({ input, errorId }) =>
      input.addEventListener("input", () => {
        input.classList.remove("field-error");
        document.getElementById(errorId).classList.remove("show");
      })
    );

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let valid = true;
      fields.forEach(({ input, errorId, isEmail }) => {
        const value = input.value.trim();
        const bad = !value || (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
        input.classList.toggle("field-error", bad);
        document.getElementById(errorId).classList.toggle("show", bad);
        if (bad) valid = false;
      });
      if (!valid) return;
      renderConfirmation(document.getElementById("co-name").value.trim());
    });
  }

  function renderConfirmation(customerName) {
    const ref = "ORD-" + Math.floor(100000 + Math.random() * 900000);
    panel.innerHTML = `
      <div class="order-confirmation tag">
        <h2>Request sent, ${customerName.split(" ")[0]}.</h2>
        <p>Your order reference is <span class="ref">${ref}</span>. This is a prototype, so nothing was
        actually submitted, but in the real flow we'd confirm availability and send a payment link next.</p>
        <p>You can look up an order's status any time on our
        <a href="track-order.html" style="color: var(--chambray); text-decoration: underline;">order tracking page</a>.</p>
      </div>
    `;
  }

  renderPanel();
}

document.addEventListener("DOMContentLoaded", () => {
  initCatalog();
  initDetail();
});