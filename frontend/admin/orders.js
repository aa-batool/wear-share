/* ------------------------------------------------------------
   Orders management
   ------------------------------------------------------------
   Reads/writes ADMIN_ORDERS in memory only. Once the backend
   exists: initial load becomes GET /admin/orders, and status
   changes become PATCH /admin/orders/:id/status — which should
   also append a row to order_status_history (see database
   schema document, Section 3.6).
--------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", initOrders);

function orderStatusLabel(status) {
  return status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function initOrders() {
  const ledger = document.getElementById("orders-ledger");
  if (!ledger) return;

  const statusSelect = document.getElementById("f-status");
  const typeSelect = document.getElementById("f-type");
  const countEl = document.getElementById("result-count");

  ORDER_STATUSES.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = orderStatusLabel(s);
    statusSelect.appendChild(opt);
  });

  const presetStatus = new URLSearchParams(location.search).get("status");
  if (presetStatus && ORDER_STATUSES.includes(presetStatus)) statusSelect.value = presetStatus;

  let openDetailId = null;

  function matches(order) {
    if (statusSelect.value && order.status !== statusSelect.value) return false;
    if (typeSelect.value && order.type !== typeSelect.value) return false;
    return true;
  }

  function statusOptionsHtml(current) {
    return ORDER_STATUSES.map(
      (s) => `<option value="${s}" ${s === current ? "selected" : ""}>${orderStatusLabel(s)}</option>`
    ).join("");
  }

  function datesCell(order) {
    if (order.type === "buy") return "—";
    return `${order.rentStart} → ${order.rentEnd}`;
  }

  function detailPanelHtml(order) {
    return `
      <div class="order-detail-panel edit-panel tag${openDetailId === order.id ? " open" : ""}" id="detail-${order.id}">
        <div class="spec-sheet">
          <div class="spec-row"><span class="k">Order ID</span><span class="v">${order.id}</span></div>
          <div class="spec-row"><span class="k">Customer</span><span class="v">${order.customer}</span></div>
          <div class="spec-row"><span class="k">Email</span><span class="v">${order.email}</span></div>
          <div class="spec-row"><span class="k">Shipping address</span><span class="v">${order.address}</span></div>
          <div class="spec-row"><span class="k">Placed</span><span class="v">${order.createdAt}</span></div>
          <div class="spec-row"><span class="k">Total</span><span class="v">$${order.total}</span></div>
        </div>
        <p style="color:var(--ink-soft); font-size:0.8rem; margin-top:14px; border-top:1px dashed var(--line); padding-top:14px;">
          This customer's details are visible here because fulfillment requires them — they're never shown to
          whoever originally listed this item.
        </p>
        <button type="button" class="edit-btn" data-close="${order.id}" style="margin-top:6px;">Close</button>
      </div>`;
  }

  function render() {
    const results = ADMIN_ORDERS.filter(matches);
    countEl.textContent = `${results.length} order${results.length === 1 ? "" : "s"}`;

    if (results.length === 0) {
      ledger.innerHTML = `<div class="empty-row">Nothing matches those filters.</div>`;
      return;
    }

    const head = `
      <div class="ledger-row order-row head">
        <span>Item</span><span>Type</span><span>Customer</span><span>Dates</span><span>Status</span><span>Total</span><span>Actions</span>
      </div>`;

    const rows = results
      .map(
        (order) => `
        <div class="ledger-row order-row">
          <span data-label="Item">${order.item}</span>
          <span data-label="Type">${order.type === "rent" ? "Rent" : "Buy"}</span>
          <span data-label="Customer">${order.customer}</span>
          <span data-label="Dates">${datesCell(order)}</span>
          <span data-label="Status">
            <select class="status-select" data-status-for="${order.id}">${statusOptionsHtml(order.status)}</select>
          </span>
          <span data-label="Total">$${order.total}</span>
          <span data-label="Actions"><button type="button" class="detail-btn" data-detail="${order.id}">Details</button></span>
        </div>
        ${detailPanelHtml(order)}`
      )
      .join("");

    ledger.innerHTML = head + rows;

    ledger.querySelectorAll("[data-status-for]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const order = ADMIN_ORDERS.find((o) => o.id === sel.dataset.statusFor);
        order.status = sel.value;
      });
    });

    ledger.querySelectorAll("[data-detail]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openDetailId = openDetailId === btn.dataset.detail ? null : btn.dataset.detail;
        render();
      });
    });

    ledger.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openDetailId = null;
        render();
      });
    });
  }

  [statusSelect, typeSelect].forEach((el) => el.addEventListener("change", render));
  render();
}