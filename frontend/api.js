/* ------------------------------------------------------------
   Shared helpers — loaded on every page (before the page's own
   script). Replaces the old mock data files: pages now read from
   the real backend through api() below.
--------------------------------------------------------------- */

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Wraps fetch for our JSON API. Throws ApiError with a message that's
// safe to show to the user. Cookies (the admin session) are sent
// automatically because everything is same-origin.
async function api(path, options = {}) {
  const init = {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(
      0,
      "network",
      "Couldn't reach the server. Start it with `node backend/server.js` and open the site at http://localhost:3000."
    );
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Not JSON — usually means we're being served by something that
    // isn't the WearShare backend (a plain static host, for example).
    throw new ApiError(
      res.status,
      "not_api",
      "This page isn't connected to the WearShare backend. Run `node backend/server.js` and open http://localhost:3000."
    );
  }

  if (!res.ok) {
    const err = data && data.error ? data.error : {};
    throw new ApiError(res.status, err.code || "error", err.message || "Something went wrong.");
  }
  return data;
}

// Escapes a value for safe use inside HTML text or a quoted attribute.
// Everything that comes from the API (names, notes, addresses...) goes
// through this before being put in a template string — those values
// originate from public forms, so they can't be trusted as markup.
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only lets through image data URLs and same-site paths for <img src>,
// so a stored value can never smuggle in a javascript: URL.
function safeImageSrc(url) {
  if (typeof url !== "string") return "";
  return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url) || /^\/[^/]/.test(url) ? url : "";
}

// Converts an item from the API's shape into the shape the page
// scripts use (camelCase, with photo/booking fields flattened).
function normalizeItem(i) {
  return {
    id: i.id,
    name: i.name,
    category: i.category,
    size: i.size,
    condition: i.condition,
    color: i.color || "#8a7350",
    silhouette: i.silhouette || "wrap",
    rentPerDay: i.rent_per_day,
    buyPrice: i.buy_price,
    rentOnly: !!i.rent_only,
    buyOnly: !!i.buy_only,
    description: i.description || "",
    photoUrl: safeImageSrc(i.thumbnail_url || (i.photos && i.photos[0] && i.photos[0].url) || ""),
    photos: (i.photos || []).map((p) => safeImageSrc(p.url)).filter(Boolean),
    bookedRanges: (i.booked_ranges || []).map((r) => ({ start: r.start_date, end: r.end_date })),
    // Can it be bought right now? { available, availableFrom } — availableFrom is
    // null when the piece is out on rental and has no fixed return date to wait for.
    buyAvailability: i.buy_availability
      ? { available: !!i.buy_availability.available, availableFrom: i.buy_availability.available_from || null }
      : { available: true, availableFrom: null },
  };
}

// "2026-11-18" -> "Nov 18" (local time, so the day never shifts)
function formatDay(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Every price on the site goes through this, so the currency lives in one
// place. 12775 -> "Rs 12,775". Prices are whole rupees in practice; any paisa
// are kept (up to 2 digits) rather than silently rounded away.
function formatMoney(amount) {
  const n = Number(amount);
  if (amount === null || amount === undefined || !Number.isFinite(n)) return "—";
  return "Rs " + n.toLocaleString("en-PK", { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------
// Payment + checkout helpers (shared by the item page, the payment
// page and the tracking page)
// ---------------------------------------------------------------

const PAYMENT_METHOD_LABELS = { cod: "Cash on delivery", online: "Online payment" };
function paymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] || "Not recorded";
}

// Whole days in a rental, counting both the first and the last day — the
// same rule the server prices with.
function rentalDays(startISO, endISO) {
  const [sy, sm, sd] = startISO.split("-").map(Number);
  const [ey, em, ed] = endISO.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
}

// "2026-11-18" -> "2026-11-17"
function dayBeforeISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// The message a buyer sees when the piece they're buying is still booked for
// rental: delivery has to wait. Built only from formatted dates (never raw API
// text), so it's safe to drop straight into the page. `availableFrom` is the
// first day it can leave us, or null when it's out with a renter and has no
// fixed return date yet.
function delayedDeliveryNoticeHtml(availableFrom) {
  if (availableFrom) {
    return `<strong>Delivery will be after the current rental.</strong> This piece is booked for rental until ${esc(formatDay(dayBeforeISO(availableFrom)))}, so it can't leave us before ${esc(formatDay(availableFrom))} — then add shipping time. If you need it sooner, don't buy it.`;
  }
  return "<strong>Delivery will be after the current rental.</strong> This piece is out on rental right now. We'll send it once it's back, and we can't give an exact date yet. If you need it soon, don't buy it.";
}

// The checkout form (item page) hands its details to the payment page through
// sessionStorage: it lives in this browser tab only and disappears when the tab
// closes. Nothing is sent to the server until the order is placed on the payment
// page. All three calls swallow storage errors (private mode, blocked storage).
const CHECKOUT_DRAFT_KEY = "wearshare.checkoutDraft";
function saveCheckoutDraft(draft) {
  try {
    sessionStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
function loadCheckoutDraft() {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_DRAFT_KEY);
    const draft = raw ? JSON.parse(raw) : null;
    return draft && typeof draft === "object" ? draft : null;
  } catch {
    return null;
  }
}
function clearCheckoutDraft() {
  try {
    sessionStorage.removeItem(CHECKOUT_DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
}

// ---- Shop details (contact, late-fee rule), shared by every shopper page ----
let siteInfoPromise = null;
function loadSiteInfo() {
  if (!siteInfoPromise) siteInfoPromise = api("/api/site").catch(() => null);
  return siteInfoPromise;
}

function contactHtml(info) {
  if (!info || !info.contact) return "";
  const c = info.contact;
  const bits = [`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`];
  if (c.whatsapp) {
    const digits = c.whatsapp.replace(/\D/g, "");
    bits.push(digits ? `WhatsApp <a href="https://wa.me/${esc(digits)}">${esc(c.whatsapp)}</a>` : `WhatsApp ${esc(c.whatsapp)}`);
  }
  if (c.phone) bits.push(`<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a>`);
  return bits.join(" · ");
}

// What delivery will cost for items worth `itemsTotal`, as the shop is set up right now.
// (The server works it out again when the order is placed; this is for showing it first.)
function deliveryFeeFor(info, itemsTotal) {
  const d = info && info.delivery;
  if (!d || !d.fee) return 0;
  return d.free_over && itemsTotal >= d.free_over ? 0 : d.fee;
}

// "Rs 1,400 for each late day" or "the item's daily rent for each late day"
function lateFeeText(info) {
  const lf = info && info.late_fee;
  return lf && lf.mode === "flat" ? `${formatMoney(lf.per_day)} for each day late` : "one more day's rent for each day late";
}

// Every shopper page: put the contact details and a Policies link in the footer.
document.addEventListener("DOMContentLoaded", async () => {
  const footer = document.querySelector(".site-footer");
  if (!footer || location.pathname.includes("/admin/")) return;
  const info = await loadSiteInfo();
  const line = document.createElement("span");
  line.className = "footer-contact";
  line.innerHTML = `${info ? `Contact us: ${contactHtml(info)} · ` : ""}<a href="policies.html">Policies</a>`;
  footer.appendChild(line);
});

// "shipped" -> "Shipped", "return_due" -> "Return due"
function statusLabel(status) {
  const s = String(status).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function showLoadError(container, err) {
  container.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
}