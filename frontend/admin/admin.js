/* ------------------------------------------------------------
   Admin panel — shared helpers, plus the login and dashboard pages.
   Loaded on every admin page after ../api.js.

   Authentication: signing in makes the server set an HttpOnly
   session cookie, so there's no token for this code (or any
   injected script) to read or store. Every admin request just
   rides along with that cookie; if it's missing or expired the
   API answers 401 and adminApi() sends the user to the sign-in page.
--------------------------------------------------------------- */

// Like api(), but a 401 means "sign in again" rather than an error to show.
async function adminApi(path, options) {
  try {
    return await api(path, options);
  } catch (err) {
    if (err.status === 401) {
      window.location.href = "login.html";
      return new Promise(() => {}); // never resolves: the page is navigating away
    }
    throw err;
  }
}

// "2026-09-13" or "2026-09-13 08:16:00" -> "Sep 13"
function fmtISO(str) {
  if (!str) return "—";
  const [y, m, d] = String(str).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A banner under the page heading, for errors and confirmations. Uses
// textContent so message text can never be interpreted as markup.
function adminMessage(text, kind = "error") {
  let el = document.getElementById("page-message");
  if (!el) {
    el = document.createElement("div");
    el.id = "page-message";
    const anchor = document.querySelector(".admin-subheading");
    if (anchor) anchor.insertAdjacentElement("afterend", el);
    else document.querySelector(".admin-main .wrap")?.prepend(el);
  }
  el.className = `page-message ${kind}`;
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(el._hideTimer);
  if (kind === "success") el._hideTimer = setTimeout(() => (el.style.display = "none"), 3000);
}

document.addEventListener("DOMContentLoaded", () => {
  initSignOut();
  initLogin();
  initDashboard();
  initBackups();
});

/* ------------------------------------------------------------
   Backups (dashboard)
--------------------------------------------------------------- */
async function initBackups() {
  const list = document.getElementById("backup-list");
  if (!list) return;
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  async function load() {
    try {
      const data = await adminApi("/api/admin/backups");
      list.innerHTML = data.backups.length
        ? `<li>Copies kept on the server (the newest ${data.keep}; one is saved automatically each day):</li>` +
          data.backups.slice(0, 5).map((b) => `<li>${esc(new Date(b.created).toLocaleString())} — ${esc(kb(b.size))}</li>`).join("")
        : `<li>No copies saved on the server yet. One is saved automatically each day.</li>`;
    } catch (err) {
      list.innerHTML = `<li>${esc(err.message)}</li>`;
    }
  }
  document.getElementById("backup-now").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await adminApi("/api/admin/backups", { method: "POST", body: {} });
      adminMessage("A copy was saved on the server.", "success");
    } catch (err) {
      adminMessage(err.message);
    }
    e.target.disabled = false;
    load();
  });
  load();
}

function initSignOut() {
  document.querySelectorAll(".admin-signout").forEach((link) => {
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await api("/api/admin/logout", { method: "POST" });
      } catch {
        // Even if the server can't be reached, leave the page.
      }
      window.location.href = "login.html";
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
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.remove("show");
    submitBtn.disabled = true;

    try {
      await api("/api/admin/login", {
        method: "POST",
        body: { email: emailInput.value.trim(), password: passwordInput.value },
      });
      window.location.href = "dashboard.html";
    } catch (err) {
      // 401 gets the generic wording on purpose (never say which half was wrong);
      // anything else (rate limit, server down) carries its own explanation.
      errorEl.textContent = err.status === 401 ? "That email or password doesn't match our records." : err.message;
      errorEl.classList.add("show");
      submitBtn.disabled = false;
    }
  });

  [emailInput, passwordInput].forEach((input) => input.addEventListener("input", () => errorEl.classList.remove("show")));
}

/* ------------------------------------------------------------
   Dashboard page
--------------------------------------------------------------- */
async function initDashboard() {
  const statGrid = document.getElementById("stat-grid");
  if (!statGrid) return;
  const ledger = document.getElementById("activity-ledger");

  let data;
  try {
    data = await adminApi("/api/admin/dashboard");
  } catch (err) {
    showLoadError(statGrid, err);
    return;
  }

  const s = data.stats;
  const tiles = [
    { label: "Intake queue", value: s.intake_queue, note: "Awaiting photography & listing", href: "listings.html?status=intake" },
    { label: "Active orders", value: s.active_orders, note: "Pending, confirmed, shipped, or out with a customer", href: "orders.html" },
    { label: "Upcoming returns", value: s.upcoming_returns, note: "Rentals marked as due back", href: "orders.html?status=return_due", flag: s.upcoming_returns > 0 },
    { label: "Overdue returns", value: s.overdue_returns, note: "Rentals past their end date, still out", href: "orders.html?show=overdue", flag: s.overdue_returns > 0 },
    { label: "To inspect & relist", value: s.items_to_inspect, note: "Returned pieces, hidden from the shop until you relist", href: "listings.html?status=returned", flag: s.items_to_inspect > 0 },
    { label: "Refunds due", value: s.refunds_due, note: "Cancelled orders you've been paid for", href: "orders.html?show=refunds", flag: s.refunds_due > 0 },
    { label: "Charges to collect", value: s.charges_due, note: "Late fees and damage charges owed", href: "orders.html?show=charges", flag: s.charges_due > 0 },
    { label: "Pending payouts", value: s.pending_payouts, note: "Owed to providers, not yet paid", href: "payouts.html?status=pending" },
  ];

  statGrid.innerHTML = tiles
    .map(
      (t) => `
      <a class="stat-tag tag" href="${esc(t.href)}">
        <div class="stat-label">${esc(t.label)}</div>
        <div class="stat-value${t.flag ? " flag" : ""}">${esc(t.value)}</div>
        <div class="stat-note">${esc(t.note)}</div>
      </a>`
    )
    .join("");

  if (data.recent_activity.length === 0) {
    ledger.innerHTML = `<div class="empty-row">No orders yet.</div>`;
    return;
  }

  const head = `
    <div class="ledger-row head">
      <span>Item</span><span>Type</span><span>Customer</span><span>Status</span><span>Date</span>
    </div>`;
  const rows = data.recent_activity
    .map(
      (a) => `
      <div class="ledger-row">
        <span data-label="Item">${esc(a.item_name)}</span>
        <span data-label="Type">${a.type === "rent" ? "Rent" : "Buy"}</span>
        <span data-label="Customer">${esc(a.customer_name)}</span>
        <span data-label="Status"><span class="status-pill ${esc(a.status)}">${esc(statusLabel(a.status))}</span></span>
        <span data-label="Date">${esc(fmtISO(a.created_at))}</span>
      </div>`
    )
    .join("");
  ledger.innerHTML = head + rows;
}