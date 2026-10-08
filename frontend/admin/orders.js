/* ------------------------------------------------------------
   Orders management (admin)
   ------------------------------------------------------------
   List:    GET   /api/admin/orders
   Detail:  GET   /api/admin/orders/:id      (loaded when a row is opened)
   Status:  PATCH /api/admin/orders/:id/status
   Every status change is also written to the order's history by
   the server, and shows up immediately on the customer's tracking page.
--------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", initOrders);

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "return_due", "returned", "completed", "cancelled"];

async function initOrders() {
  const ledger = document.getElementById("orders-ledger");
  if (!ledger) return;

  const statusSelect = document.getElementById("f-status");
  const typeSelect = document.getElementById("f-type");
  const showSelect = document.getElementById("f-show");
  const presetShow = new URLSearchParams(location.search).get("show");
  if (["overdue", "refunds", "charges"].includes(presetShow)) showSelect.value = presetShow;
  const countEl = document.getElementById("result-count");

  ORDER_STATUSES.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = statusLabel(s);
    statusSelect.appendChild(opt);
  });
  const presetStatus = new URLSearchParams(location.search).get("status");
  if (presetStatus && ORDER_STATUSES.includes(presetStatus)) statusSelect.value = presetStatus;

  let orders = [];
  const details = {}; // orderId -> full order (customer contact, history, shipments)
  let openDetailId = null;

  async function load() {
    orders = (await adminApi("/api/admin/orders")).orders;
  }

  function matches(order) {
    if (statusSelect.value && order.status !== statusSelect.value) return false;
    if (typeSelect.value && order.type !== typeSelect.value) return false;
    if (showSelect.value === "overdue" && !order.overdue) return false;
    if (showSelect.value === "refunds" && order.refund_status !== "due") return false;
    if (showSelect.value === "charges" && order.charges_status !== "due") return false;
    return true;
  }

  const datesCell = (o) => {
    if (o.type === "rent") return `${fmtISO(o.rent_start_date)} → ${fmtISO(o.rent_end_date)}`;
    if (o.delivery_held) return o.deliver_after ? `Ship after ${fmtISO(o.deliver_after)}` : "Ship after rental returns";
    return "—";
  };

  // "COD · not paid" under the total, so the list shows at a glance which orders still need money.
  function payChip(o) {
    if (!o.payment_method) return "";
    const how = o.payment_method === "cod" ? "COD" : "Online";
    const paid = o.payment_status === "paid";
    return `<br><span class="pay-chip ${paid ? "paid" : "unpaid"}">${how} · ${paid ? "paid" : "not paid"}</span>`;
  }

  // Small flags under the total: overdue, refund still to send, charges still to collect.
  function flagChips(o) {
    const chips = [];
    if (o.overdue) chips.push(`<span class="pay-chip unpaid">${o.days_late} day${o.days_late === 1 ? "" : "s"} late</span>`);
    if (o.refund_status === "due") chips.push(`<span class="pay-chip unpaid">refund due</span>`);
    if (o.refund_status === "sent") chips.push(`<span class="pay-chip paid">refunded</span>`);
    if (o.charges_status === "due") chips.push(`<span class="pay-chip unpaid">charges ${esc(formatMoney(o.charges_total))} due</span>`);
    return chips.length ? `<br>${chips.join(" ")}` : "";
  }

  const WITH_CUSTOMER = ["shipped", "delivered", "return_due"];

  // The part of the detail panel for getting a rental back, refunds and extra charges.
  function lifecycleHtml(d) {
    const parts = [];

    if (d.type === "rent" && WITH_CUSTOMER.includes(d.status)) {
      const lateNote = d.overdue
        ? `<p class="hint late-note">${d.days_late} day${d.days_late === 1 ? "" : "s"} overdue. Late fee if returned today: ${esc(formatMoney(d.late_fee_accruing))} (${esc(formatMoney(d.late_fee_per_day))} a day).</p>`
        : "";
      parts.push(`
        <div class="return-box">
          <div class="intake-notes-label">Rental back with you?</div>
          ${lateNote}
          <div class="return-form" id="return-form-${esc(d.id)}" hidden>
            <label>Condition on return<input type="text" maxlength="500" data-return-note placeholder="e.g. Clean, no marks" /></label>
            <label>Damage charge (Rs)<input type="number" min="0" step="1" value="0" data-return-damage /></label>
            ${d.overdue ? `<label class="ack-row"><input type="checkbox" data-return-waive /> <span>Waive the late fee</span></label>` : ""}
            <button type="button" class="detail-btn" data-return-confirm="${esc(d.id)}">Record return</button>
            <button type="button" class="edit-btn" data-return-cancel="${esc(d.id)}">Not yet</button>
          </div>
          <button type="button" class="detail-btn" data-return-open="${esc(d.id)}">Record return…</button>
        </div>`);
    }

    if (d.type === "rent" && ["returned", "completed"].includes(d.status)) {
      parts.push(`
        <div class="return-box">
          <div class="intake-notes-label">Return &amp; extra charges</div>
          <div class="spec-sheet">
            ${d.returned_on ? `<div class="spec-row"><span class="k">Returned on</span><span class="v">${esc(fmtISO(d.returned_on))}</span></div>` : ""}
            ${d.return_note ? `<div class="spec-row"><span class="k">Condition</span><span class="v">${esc(d.return_note)}</span></div>` : ""}
          </div>
          <div class="return-form" style="display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end;">
            <label>Late fee (Rs)<input type="number" min="0" step="1" value="${esc(d.late_fee || 0)}" data-charge-late /></label>
            <label>Damage charge (Rs)<input type="number" min="0" step="1" value="${esc(d.damage_fee || 0)}" data-charge-damage /></label>
            <button type="button" class="detail-btn" data-charge-save="${esc(d.id)}">Save amounts</button>
          </div>
          <p class="hint">Set an amount to 0 to waive it.</p>
          ${
            d.charges_total > 0
              ? `<button type="button" class="detail-btn" data-charge-status="${esc(d.id)}" data-to="${d.charges_status === "collected" ? "due" : "collected"}">${
                  d.charges_status === "collected" ? `Collected ${esc(formatMoney(d.charges_total))} — mark as not collected` : `Mark ${esc(formatMoney(d.charges_total))} as collected`
                }</button>`
              : `<p class="hint">No extra charges on this rental.</p>`
          }
        </div>`);
    }

    if (d.refund_status) {
      parts.push(`
        <div class="return-box">
          <div class="intake-notes-label">Refund</div>
          <p class="hint">${d.refund_status === "due" ? `This cancelled order was paid. Send ${esc(formatMoney(d.price_total))} back to the customer, then mark it sent. They'll be emailed.` : `Refund of ${esc(formatMoney(d.price_total))} marked as sent.`}</p>
          <button type="button" class="detail-btn" data-refund-toggle="${esc(d.id)}" data-to="${d.refund_status === "due" ? "sent" : "due"}">${d.refund_status === "due" ? "Mark refund sent" : "Mark as not sent"}</button>
        </div>`);
    }
    return parts.join("");
  }

  // Record a parcel you've handed to a courier: which courier and the tracking number
  // they gave you. The customer sees both on their tracking page and is emailed.
  function shipmentFormHtml(d) {
    if (d.status === "cancelled") return "";
    const canMarkShipped = d.status === "pending" || d.status === "confirmed";
    return `
      <div class="return-box shipment-box">
        <div class="intake-notes-label">Ship it</div>
        <button type="button" class="detail-btn" data-ship-open="${esc(d.id)}">Book a shipment…</button>
        <div class="return-form" id="ship-form-${esc(d.id)}" hidden>
          <p class="hint">Hand the parcel to the courier first, then record it here. The customer is emailed the courier and tracking number.</p>
          <label>Which way
            <select data-ship-direction>
              <option value="outbound">To the customer</option>
              ${d.type === "rent" ? `<option value="return">Back from the customer</option>` : ""}
            </select>
          </label>
          <label>Courier <input type="text" data-ship-courier list="couriers" maxlength="60" placeholder="e.g. TCS" /></label>
          <datalist id="couriers"><option value="TCS"></option><option value="Leopards"></option><option value="M&amp;P"></option><option value="PostEx"></option><option value="Trax"></option><option value="BlueEx"></option><option value="Pakistan Post"></option></datalist>
          <label>Tracking number <input type="text" data-ship-tracking maxlength="60" placeholder="From the courier's receipt" /></label>
          ${canMarkShipped ? `<label class="ack-row"><input type="checkbox" data-ship-markshipped checked /> Also set the order to Shipped</label>` : ""}
          <div class="error-text" data-ship-error></div>
          <button type="button" class="detail-btn" data-ship-confirm="${esc(d.id)}">Save shipment</button>
          <button type="button" class="detail-btn" data-ship-cancel>Cancel</button>
        </div>
      </div>`;
  }

  function detailPanelHtml(order) {
    if (openDetailId !== order.id) return `<div class="order-detail-panel edit-panel tag"></div>`;

    const d = details[order.id];
    if (!d) return `<div class="order-detail-panel edit-panel tag open"><p class="hint">Loading…</p></div>`;

    const row = (k, v) => `<div class="spec-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
    const shipments = d.shipments.length
      ? d.shipments.map((s) => row(`${s.direction === "return" ? "Return" : "Outbound"} shipment`, `${s.courier} — ${s.tracking_number || "no tracking yet"} (${statusLabel(s.status)})`)).join("")
      : row("Shipments", "None booked yet");
    const history = d.history.map((h) => row(fmtISO(h.changed_at), `${statusLabel(h.status)}${h.note ? ` — ${h.note}` : ""}`)).join("");

    return `
      <div class="order-detail-panel edit-panel tag open">
        <div class="spec-sheet">
          ${row("Order ID", d.id)}
          ${row("Customer", d.customer_name)}
          ${row("Email", d.customer_email)}
          ${row("Phone", d.customer_phone || "—")}
          ${row("Shipping address", d.customer_address)}
          ${row("Placed", fmtISO(d.created_at))}
          ${row("Payment method", paymentMethodLabel(d.payment_method))}
          ${row("Payment", d.payment_status === "paid" ? "Received" : "Not received yet")}
          ${d.delivery_fee > 0 ? row("Delivery fee (in the total)", formatMoney(d.delivery_fee)) : ""}
          ${row("Total", formatMoney(d.price_total))}
          ${d.delivery_held ? row("Delivery", d.deliver_after ? `Hold until ${fmtISO(d.deliver_after)} — buyer agreed to wait for the current rental` : "Hold until the current rental returns — buyer agreed to wait") : ""}
          ${d.status === "cancelled" ? row("Cancelled by", d.cancelled_by === "customer" ? "The customer" : d.cancelled_by === "admin" ? "You" : "—") : ""}
          ${shipments}
        </div>
        ${shipmentFormHtml(d)}
        <div class="pay-actions">
          <button type="button" class="detail-btn" data-payment-toggle="${esc(d.id)}" data-to="${d.payment_status === "paid" ? "unpaid" : "paid"}">${
            d.payment_status === "paid" ? "Mark as not received" : "Mark payment received"
          }</button>
        </div>
        ${lifecycleHtml(d)}
        <div class="intake-notes-label" style="margin-top:16px;">Status history</div>
        <div class="spec-sheet">${history}</div>
        <p style="color:var(--ink-soft); font-size:0.8rem; margin-top:14px; border-top:1px dashed var(--line); padding-top:14px;">
          This customer's details are visible here because fulfillment requires them — they're never shown to
          whoever originally listed this item.
        </p>
        <button type="button" class="edit-btn" data-close="${esc(order.id)}" style="margin-top:6px;">Close</button>
      </div>`;
  }

  function render() {
    const results = orders.filter(matches);
    countEl.textContent = `${results.length} order${results.length === 1 ? "" : "s"}`;

    if (results.length === 0) {
      ledger.innerHTML = `<div class="empty-row">${orders.length === 0 ? "No orders yet." : "Nothing matches those filters."}</div>`;
      return;
    }

    const head = `
      <div class="ledger-row order-row head">
        <span>Item</span><span>Type</span><span>Customer</span><span>Dates</span><span>Status</span><span>Total</span><span>Actions</span>
      </div>`;

    const rows = results
      .map(
        (o) => `
        <div class="ledger-row order-row">
          <span data-label="Item">${esc(o.item_name)}</span>
          <span data-label="Type">${o.type === "rent" ? "Rent" : "Buy"}</span>
          <span data-label="Customer">${esc(o.customer_name)}</span>
          <span data-label="Dates">${esc(datesCell(o))}</span>
          <span data-label="Status">
            <select class="status-select" data-status-for="${esc(o.id)}" ${o.status === "cancelled" ? 'disabled title="A cancelled order can\'t be reopened"' : ""}>${ORDER_STATUSES.map(
              (s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${esc(statusLabel(s))}</option>`
            ).join("")}</select>
          </span>
          <span data-label="Total">${esc(formatMoney(o.price_total))}${payChip(o)}${flagChips(o)}</span>
          <span data-label="Actions"><button type="button" class="detail-btn" data-detail="${esc(o.id)}">${openDetailId === o.id ? "Hide" : "Details"}</button></span>
        </div>
        ${detailPanelHtml(o)}`
      )
      .join("");

    ledger.innerHTML = head + rows;

    ledger.querySelectorAll("[data-status-for]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const id = sel.dataset.statusFor;
        try {
          await adminApi(`/api/admin/orders/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { status: sel.value } });
          delete details[id]; // its history just changed
          await load();
          adminMessage(`Order updated to "${statusLabel(sel.value)}".`, "success");
        } catch (err) {
          adminMessage(err.message);
          await load();
        }
        render();
        if (openDetailId === id) openDetail(id);
      });
    });

    ledger.querySelectorAll("[data-detail]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.detail;
        if (openDetailId === id) {
          openDetailId = null;
          render();
        } else {
          openDetail(id);
        }
      });
    });

    ledger.querySelectorAll("[data-payment-toggle]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.paymentToggle;
        btn.disabled = true;
        try {
          await adminApi(`/api/admin/orders/${encodeURIComponent(id)}/payment`, { method: "PATCH", body: { payment_status: btn.dataset.to } });
          delete details[id]; // its history just changed
          await load();
          adminMessage(btn.dataset.to === "paid" ? "Payment marked as received." : "Payment marked as not received.", "success");
        } catch (err) {
          adminMessage(err.message);
        }
        render();
        if (openDetailId === id) openDetail(id);
      });
    });

    // Run an admin action, then refresh the list and the open panel.
    async function act(id, call, okText) {
      try {
        await call();
        delete details[id];
        await load();
        adminMessage(okText, "success");
      } catch (err) {
        adminMessage(err.message);
      }
      render();
      if (openDetailId === id) openDetail(id);
    }
    const q = (el, sel) => el.closest(".order-detail-panel").querySelector(sel);

    ledger.querySelectorAll("[data-ship-open]").forEach((btn) =>
      btn.addEventListener("click", () => {
        document.getElementById(`ship-form-${btn.dataset.shipOpen}`).hidden = false;
        btn.hidden = true;
      })
    );
    ledger.querySelectorAll("[data-ship-cancel]").forEach((btn) =>
      btn.addEventListener("click", () => {
        btn.closest(".shipment-box").querySelector("[data-ship-open]").hidden = false;
        btn.closest(".return-form").hidden = true;
      })
    );
    ledger.querySelectorAll("[data-ship-confirm]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.shipConfirm;
        const courier = q(btn, "[data-ship-courier]").value.trim();
        const tracking = q(btn, "[data-ship-tracking]").value.trim();
        const direction = q(btn, "[data-ship-direction]").value;
        const markBox = q(btn, "[data-ship-markshipped]");
        const err = q(btn, "[data-ship-error]");
        err.classList.remove("show");
        if (!courier || !tracking) {
          err.textContent = "Enter the courier and the tracking number.";
          err.classList.add("show");
          return;
        }
        btn.disabled = true;
        act(
          id,
          async () => {
            await adminApi(`/api/admin/orders/${encodeURIComponent(id)}/shipments`, { method: "POST", body: { direction, courier, tracking_number: tracking } });
            if (direction === "outbound" && markBox && markBox.checked) {
              await adminApi(`/api/admin/orders/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { status: "shipped" } });
            }
          },
          "Shipment saved. The customer has been emailed."
        );
      })
    );
    ledger.querySelectorAll("[data-return-open]").forEach((btn) =>
      btn.addEventListener("click", () => {
        document.getElementById(`return-form-${btn.dataset.returnOpen}`).hidden = false;
        btn.hidden = true;
      })
    );
    ledger.querySelectorAll("[data-return-cancel]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const panel = btn.closest(".order-detail-panel");
        btn.closest(".return-form").hidden = true;
        panel.querySelector("[data-return-open]").hidden = false;
      })
    );
    ledger.querySelectorAll("[data-return-confirm]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.returnConfirm;
        const waive = q(btn, "[data-return-waive]");
        btn.disabled = true;
        act(
          id,
          () =>
            adminApi(`/api/admin/orders/${encodeURIComponent(id)}/return`, {
              method: "POST",
              body: { condition_note: q(btn, "[data-return-note]").value, damage_fee: Number(q(btn, "[data-return-damage]").value) || 0, waive_late_fee: !!(waive && waive.checked) },
            }),
          "Return recorded."
        );
      })
    );
    ledger.querySelectorAll("[data-charge-save]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.chargeSave;
        act(
          id,
          () =>
            adminApi(`/api/admin/orders/${encodeURIComponent(id)}/charges`, {
              method: "PATCH",
              body: { late_fee: Number(q(btn, "[data-charge-late]").value) || 0, damage_fee: Number(q(btn, "[data-charge-damage]").value) || 0 },
            }),
          "Charges saved."
        );
      })
    );
    ledger.querySelectorAll("[data-charge-status]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.chargeStatus;
        act(id, () => adminApi(`/api/admin/orders/${encodeURIComponent(id)}/charges`, { method: "PATCH", body: { charges_status: btn.dataset.to } }), btn.dataset.to === "collected" ? "Charges marked as collected." : "Charges marked as not collected.");
      })
    );
    ledger.querySelectorAll("[data-refund-toggle]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.refundToggle;
        act(id, () => adminApi(`/api/admin/orders/${encodeURIComponent(id)}/refund`, { method: "PATCH", body: { refund_status: btn.dataset.to } }), btn.dataset.to === "sent" ? "Refund marked as sent. The customer has been emailed." : "Refund marked as not sent.");
      })
    );

    ledger.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openDetailId = null;
        render();
      });
    });
  }

  async function openDetail(id) {
    openDetailId = id;
    render(); // shows "Loading…" straight away if we don't have it yet
    if (details[id]) return;
    try {
      details[id] = await adminApi(`/api/admin/orders/${encodeURIComponent(id)}`);
    } catch (err) {
      adminMessage(err.message);
      openDetailId = null;
    }
    render();
  }

  [statusSelect, typeSelect, showSelect].forEach((el) => el.addEventListener("change", render));

  document.getElementById("run-reminders").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const r = await adminApi("/api/admin/reminders/run", { method: "POST", body: {} });
      const n = r.due_reminders_sent + r.late_reminders_sent;
      adminMessage(n ? `Sent ${r.due_reminders_sent} due-today and ${r.late_reminders_sent} overdue reminder${n === 1 ? "" : "s"}.` : "Nothing to send right now: no rental is due back or newly late.", "success");
    } catch (err) {
      adminMessage(err.message);
    }
    e.target.disabled = false;
  });

  ledger.innerHTML = `<div class="empty-row">Loading orders…</div>`;
  try {
    await load();
  } catch (err) {
    showLoadError(ledger, err);
    return;
  }
  render();
}