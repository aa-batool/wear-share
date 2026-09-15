/* ------------------------------------------------------------
   Admin panel logic
   ------------------------------------------------------------
   No backend yet. Login is a hardcoded check against the demo
   credentials shown on the login page (matching the seed admin
   account described in the database schema document). Once the
   backend exists, swap this for a real POST /admin/login call
   and a session token — see the API specification document.
--------------------------------------------------------------- */

const DEMO_EMAIL = "owner@example.com";
const DEMO_PASSWORD = "changeme123";

document.addEventListener("DOMContentLoaded", () => {
  initLogin();
  initDashboard();
  initStubLinks();
});

function initStubLinks() {
  document.querySelectorAll("[data-stub]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      alert(`${el.dataset.stub} — built in a later step.`);
    });
  });
}

/* ------------------------------------------------------------
   Login page
--------------------------------------------------------------- */
function initLogin() {
  const form = document.getElementById("login-form");
  if (!form) return;

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const errorEl = document.getElementById("login-error");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const ok = emailInput.value.trim() === DEMO_EMAIL && passwordInput.value === DEMO_PASSWORD;

    if (ok) {
      window.location.href = "dashboard.html";
    } else {
      errorEl.classList.add("show");
    }
  });

  [emailInput, passwordInput].forEach((input) =>
    input.addEventListener("input", () => errorEl.classList.remove("show"))
  );
}

/* ------------------------------------------------------------
   Dashboard page
--------------------------------------------------------------- */
function initDashboard() {
  const statGrid = document.getElementById("stat-grid");
  if (!statGrid) return;

  const stats = [
    { label: "Intake queue", value: ADMIN_STATS.intakeQueue, note: "Awaiting photography & listing", href: "listings.html?status=intake" },
    { label: "Active orders", value: ADMIN_STATS.activeOrders, note: "Confirmed, shipped, or in transit", href: "orders.html" },
    { label: "Upcoming returns", value: ADMIN_STATS.upcomingReturns, note: "Rentals due back within a week", flag: true, href: "orders.html?status=return_due" },
    { label: "Pending payouts", value: ADMIN_STATS.pendingPayouts, note: "Owed to providers, not yet paid", href: "payouts.html?status=pending" },
  ];

  statGrid.innerHTML = stats
    .map((s) => {
      const inner = `
        <div class="stat-label">${s.label}</div>
        <div class="stat-value${s.flag ? " flag" : ""}">${s.value}</div>
        <div class="stat-note">${s.note}</div>`;
      return s.href
        ? `<a class="stat-tag tag" href="${s.href}">${inner}</a>`
        : `<div class="stat-tag tag" data-stub="${s.stub}">${inner}</div>`;
    })
    .join("");

  const ledger = document.getElementById("activity-ledger");
  if (RECENT_ACTIVITY.length === 0) {
    ledger.innerHTML = `<div class="empty-row">No activity yet.</div>`;
  } else {
    const head = `
      <div class="ledger-row head">
        <span>Item</span><span>Type</span><span>Customer</span><span>Status</span><span>Date</span>
      </div>`;
    const rows = RECENT_ACTIVITY.map(
      (a) => `
      <div class="ledger-row">
        <span data-label="Item">${a.item}</span>
        <span data-label="Type">${a.type}</span>
        <span data-label="Customer">${a.customer}</span>
        <span data-label="Status"><span class="status-pill ${a.status}">${a.status}</span></span>
        <span data-label="Date">${a.date}</span>
      </div>`
    ).join("");
    ledger.innerHTML = head + rows;
  }

  // re-bind stub handlers for the stat tags rendered above
  initStubLinks();
}