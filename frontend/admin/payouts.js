/* ------------------------------------------------------------
   Payouts (admin)
   ------------------------------------------------------------
   List:      GET  /api/admin/payouts        (also returns pending_total)
   Mark paid: POST /api/admin/payouts/:id/mark-paid
--------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", initPayouts);

async function initPayouts() {
  const ledger = document.getElementById("payouts-ledger");
  if (!ledger) return;

  const statusSelect = document.getElementById("f-status");
  const countEl = document.getElementById("result-count");
  const summaryEl = document.getElementById("payout-summary");

  const preset = new URLSearchParams(location.search).get("status");
  if (preset === "pending" || preset === "paid") statusSelect.value = preset;

  let payouts = [];
  let pendingTotal = 0;

  async function load() {
    const data = await adminApi("/api/admin/payouts");
    payouts = data.payouts;
    pendingTotal = data.pending_total; // computed by the server across ALL payouts, whatever the filter
  }

  function render() {
    summaryEl.innerHTML = `
      <div class="stat-label">Total owed, not yet paid</div>
      <div class="stat-value">${esc(formatMoney(pendingTotal))}</div>
    `;

    const results = payouts.filter((p) => !statusSelect.value || p.status === statusSelect.value);
    countEl.textContent = `${results.length} payout${results.length === 1 ? "" : "s"}`;

    if (results.length === 0) {
      ledger.innerHTML = `<div class="empty-row">${payouts.length === 0 ? "No payouts yet." : "Nothing matches that filter."}</div>`;
      return;
    }

    const head = `
      <div class="ledger-row payout-row head">
        <span>Provider</span><span>Item</span><span>Order</span><span>Amount</span><span>Status</span><span>Action</span>
      </div>`;

    const rows = results
      .map(
        (p) => `
        <div class="ledger-row payout-row">
          <span data-label="Provider">${esc(p.provider_name)}
            <small class="payout-detail">${esc(p.provider_email || "")}</small>
            <small class="payout-detail">${p.payout_details ? "Pay to: " + esc(p.payout_details) : "No payout details yet, ask them by email"}</small></span>
          <span data-label="Item">${esc(p.item_name)}</span>
          <span data-label="Order">${esc(p.order_id)}</span>
          <span data-label="Amount">${esc(formatMoney(p.amount))}</span>
          <span data-label="Status"><span class="status-pill ${esc(p.status)}">${esc(p.status)}</span></span>
          <span data-label="Action">
            ${
              p.status === "pending"
                ? `<button type="button" class="pay-btn" data-pay="${esc(p.id)}">Mark as paid</button>`
                : `<span class="paid-note">Paid ${esc(fmtISO(p.paid_at))}</span>`
            }
          </span>
        </div>`
      )
      .join("");

    ledger.innerHTML = head + rows;

    ledger.querySelectorAll("[data-pay]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await adminApi(`/api/admin/payouts/${encodeURIComponent(btn.dataset.pay)}/mark-paid`, { method: "POST", body: {} });
          adminMessage("Marked as paid.", "success");
        } catch (err) {
          adminMessage(err.message);
        }
        await load();
        render();
      });
    });
  }

  statusSelect.addEventListener("change", render);

  ledger.innerHTML = `<div class="empty-row">Loading payouts…</div>`;
  try {
    await load();
  } catch (err) {
    showLoadError(ledger, err);
    return;
  }
  render();
}