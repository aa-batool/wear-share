/* ------------------------------------------------------------
   Payouts
   ------------------------------------------------------------
   Reads/writes ADMIN_PAYOUTS in memory only. Once the backend
   exists: initial load becomes GET /admin/payouts, and "Mark as
   paid" becomes POST /admin/payouts/:id/mark-paid (see the API
   specification document).
--------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", initPayouts);

function initPayouts() {
  const ledger = document.getElementById("payouts-ledger");
  if (!ledger) return;

  const statusSelect = document.getElementById("f-status");
  const countEl = document.getElementById("result-count");
  const summaryEl = document.getElementById("payout-summary");

  const preset = new URLSearchParams(location.search).get("status");
  if (preset === "pending" || preset === "paid") statusSelect.value = preset;

  function matches(payout) {
    if (statusSelect.value && payout.status !== statusSelect.value) return false;
    return true;
  }

  function renderSummary() {
    const pendingTotal = ADMIN_PAYOUTS.filter((p) => p.status === "pending").reduce((sum, p) => sum + p.amount, 0);
    summaryEl.innerHTML = `
      <div class="stat-label">Total owed, not yet paid</div>
      <div class="stat-value">$${pendingTotal}</div>
    `;
  }

  function render() {
    const results = ADMIN_PAYOUTS.filter(matches);
    countEl.textContent = `${results.length} payout${results.length === 1 ? "" : "s"}`;
    renderSummary();

    if (results.length === 0) {
      ledger.innerHTML = `<div class="empty-row">Nothing matches that filter.</div>`;
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
          <span data-label="Provider">${p.provider}</span>
          <span data-label="Item">${p.item}</span>
          <span data-label="Order">${p.orderId}</span>
          <span data-label="Amount">$${p.amount}</span>
          <span data-label="Status"><span class="status-pill ${p.status}">${p.status}</span></span>
          <span data-label="Action">
            ${
              p.status === "pending"
                ? `<button type="button" class="pay-btn" data-pay="${p.id}">Mark as paid</button>`
                : `<span class="paid-note">Paid ${p.paidAt}</span>`
            }
          </span>
        </div>`
      )
      .join("");

    ledger.innerHTML = head + rows;

    ledger.querySelectorAll("[data-pay]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const payout = ADMIN_PAYOUTS.find((p) => p.id === btn.dataset.pay);
        payout.status = "paid";
        payout.paidAt = "today";
        render();
      });
    });
  }

  statusSelect.addEventListener("change", render);
  render();
}