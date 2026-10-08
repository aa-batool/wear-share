// backend/server.js
// ------------------------------------------------------------
// Entry point. Serves the static frontend and the JSON API from
// one process, and initializes the database on boot.
//
// Run with: node backend/server.js
// ------------------------------------------------------------

// .env has to be loaded before anything else reads process.env
// (the database module reads DATABASE_PATH when it's first required).
require("./env").loadEnv();

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { init, db, DB_PATH } = require("./db");
const BACKUP_DIR = process.env.BACKUP_DIR || require("node:path").join(require("node:path").dirname(DB_PATH), "backups");
const { rateLimit } = require("./rate-limit");
const photosRoutes = require("./routes/photos");
const backup = require("./routes/backup");
const adminExport = require("./routes/admin-export");
const itemsRoutes = require("./routes/items");
const ordersRoutes = require("./routes/orders");
const adminAuth = require("./routes/admin-auth");
const adminProviders = require("./routes/admin-providers");
const adminItems = require("./routes/admin-items");
const adminOrders = require("./routes/admin-orders");
const adminPayouts = require("./routes/admin-payouts");
const adminDashboard = require("./routes/admin-dashboard");
const intakeRoutes = require("./routes/intake");
const lifecycle = require("./routes/order-lifecycle");
const siteRoutes = require("./routes/site");

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function sendJSON(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJSON(res, status, { error: { code, message } });
}

// Public endpoints keep a small cap (they're open to anyone); admin
// endpoints get a bigger one since that's where photo uploads land.
const PUBLIC_BODY_LIMIT = 1_000_000; // 1 MB
const ADMIN_BODY_LIMIT = 12_000_000; // 12 MB

function readJSONBody(req, limit = PUBLIC_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      raw += chunk;
      if (raw.length > limit) {
        tooLarge = true;
        raw = "";
        reject(new Error("too_large"));
      }
    });
    req.on("end", () => {
      if (tooLarge) return;
      if (!raw.trim()) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

// Turns a body-reading failure into the right HTTP response.
function sendBodyError(res, err) {
  if (err && err.message === "too_large") {
    return sendError(res, 413, "payload_too_large", "That request is too large.");
  }
  return sendError(res, 400, "invalid_json", "Request body must be valid JSON.");
}

// Per-IP limits. The login limit is the important one — it's what stops
// someone from guessing the admin password. Behind a reverse proxy the
// socket address is the proxy's, so if this is ever deployed behind one,
// key on the forwarded client address instead.
// RATE_LIMIT_SCALE multiplies the public limits (never the login one); the test
// suite uses it because it places far more orders than a person would in an hour.
const scale = Number(process.env.RATE_LIMIT_SCALE) > 0 ? Number(process.env.RATE_LIMIT_SCALE) : 1;
const LIMITS = {
  login: { max: 10, windowMs: 15 * 60 * 1000 },
  orders: { max: 20 * scale, windowMs: 60 * 60 * 1000 },
  intake: { max: 10 * scale, windowMs: 60 * 60 * 1000 },
  lookup: { max: 30 * scale, windowMs: 15 * 60 * 1000 },
};

// Who is calling? On your own computer that's the connection's address. Behind a host's
// proxy (Render, Cloudflare, ...) every request comes from the proxy, so the real visitor is
// in X-Forwarded-For. A visitor can put anything they like in that header, and proxies add
// their own view at the END of it, so only the entry that many places from the right is
// believed: TRUST_PROXY_HOPS=1 means "the last entry was added by my one proxy".
// Left unset (0) the header is ignored completely.
function clientIp(req) {
  const hops = Number(process.env.TRUST_PROXY_HOPS) || 0;
  if (hops > 0) {
    const parts = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.length >= hops) return parts[parts.length - hops];
  }
  return req.socket.remoteAddress || "unknown";
}

// Returns true (after sending a 429) if this caller is over the limit.
function isRateLimited(req, res, name) {
  const { max, windowMs } = LIMITS[name];
  const ip = clientIp(req);
  const result = rateLimit(`${name}:${ip}`, max, windowMs);
  if (result.allowed) return false;

  res.setHeader("Retry-After", String(result.retryAfterSec));
  const minutes = Math.ceil(result.retryAfterSec / 60);
  sendError(res, 429, "rate_limited", `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  return true;
}

function serveStatic(req, res, pathname) {
  // Convenience: "/admin" goes to the admin sign-in page.
  if (pathname === "/admin" || pathname === "/admin/") {
    res.writeHead(302, { Location: "/admin/login.html" });
    return res.end();
  }

  let filePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.normalize(path.join(FRONTEND_DIR, filePath));

  // Guard against path traversal outside the frontend directory.
  if (!fullPath.startsWith(FRONTEND_DIR)) {
    return sendError(res, 400, "bad_request", "Invalid path.");
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function handleAPI(req, res, pathname, query) {
  const method = req.method;

  // GET /api/items
  if (method === "GET" && pathname === "/api/items") {
    return sendJSON(res, 200, itemsRoutes.listItems(db, query));
  }

  // GET /api/items/:id/availability  (checked before the plain :id route below)
  let m = pathname.match(/^\/api\/items\/([^/]+)\/availability$/);
  if (method === "GET" && m) {
    const { start_date, end_date } = query;
    if (!start_date || !end_date) {
      return sendError(res, 422, "invalid_date_range", "start_date and end_date query params are required.");
    }
    const item = itemsRoutes.getItemDetail(db, m[1]);
    if (!item) return sendError(res, 404, "item_not_found", "No item exists with that id.");
    return sendJSON(res, 200, itemsRoutes.checkAvailability(db, m[1], start_date, end_date));
  }

  // GET /api/items/:id
  m = pathname.match(/^\/api\/items\/([^/]+)$/);
  if (method === "GET" && m) {
    const item = itemsRoutes.getItemDetail(db, m[1]);
    if (!item) return sendError(res, 404, "item_not_found", "No item exists with that id.");
    return sendJSON(res, 200, item);
  }

  // GET /api/photos/:id  — real image bytes (see routes/photos.js)
  m = pathname.match(/^\/api\/photos\/([^/]+)$/);
  if (method === "GET" && m) {
    const isAdmin = !!adminAuth.verifySession(getSessionToken(req));
    const photo = photosRoutes.getPhoto(db, m[1], isAdmin);
    if (!photo) return sendError(res, 404, "photo_not_found", "No photo exists with that id.");
    res.writeHead(200, {
      "Content-Type": photo.contentType,
      "Content-Length": photo.buffer.length,
      "Cache-Control": isAdmin ? "private, max-age=300" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
    return res.end(photo.buffer);
  }

  // POST /api/orders
  if (method === "POST" && pathname === "/api/orders") {
    if (isRateLimited(req, res, "orders")) return;
    let body;
    try {
      body = await readJSONBody(req);
    } catch (err) {
      return sendBodyError(res, err);
    }
    const result = ordersRoutes.createOrder(db, body);
    if (result.error && !result.status) return sendError(res, 422, result.error.code, result.error.message);
    if (result.status && result.status !== 201) return sendError(res, result.status, result.error.code, result.error.message);
    return sendJSON(res, 201, result.body);
  }

  // POST /api/intake  (provider-facing "Send us your clothes" form)
  if (method === "POST" && pathname === "/api/intake") {
    if (isRateLimited(req, res, "intake")) return;
    let body;
    try {
      body = await readJSONBody(req);
    } catch (err) {
      return sendBodyError(res, err);
    }
    return sendResult(res, intakeRoutes.submitIntake(db, body));
  }

  // POST /api/orders/:id/cancel  (the customer cancels their own order, until it ships)
  m = pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (method === "POST" && m) {
    if (isRateLimited(req, res, "lookup")) return;
    let body;
    try {
      body = await readJSONBody(req);
    } catch (err) {
      return sendBodyError(res, err);
    }
    return sendResult(res, lifecycle.cancelByCustomer(db, m[1], body));
  }

  // GET /api/orders/:id
  m = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (method === "GET" && m) {
    if (isRateLimited(req, res, "lookup")) return;
    const order = ordersRoutes.getOrder(db, m[1], query.email);
    if (!order) return sendError(res, 404, "order_not_found", "No order matches that reference and email.");
    return sendJSON(res, 200, order);
  }

  // GET /api/site  (contact details and late-fee rule, for footers, the policies page and checkout)
  if (method === "GET" && pathname === "/api/site") return sendResult(res, siteRoutes.getSite());

  if (pathname === "/api/health") {
    return sendJSON(res, 200, { status: "ok" });
  }

  // --- Admin: auth ---

  if (method === "POST" && pathname === "/api/admin/login") {
    if (isRateLimited(req, res, "login")) return;
    let body;
    try {
      body = await readJSONBody(req);
    } catch (err) {
      return sendBodyError(res, err);
    }
    const result = adminAuth.login(db, body);
    if (result.status !== 200) return sendError(res, result.status, result.error.code, result.error.message);
    // The token is also returned in the body (handy for curl/testing),
    // but the browser frontend relies on the cookie so no token ever
    // has to live in JavaScript-readable storage.
    return sendJSON(res, 200, result.body, { "Set-Cookie": sessionCookie(result.body.session_token) });
  }

  if (method === "POST" && pathname === "/api/admin/logout") {
    adminAuth.logout(getSessionToken(req));
    return sendJSON(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", true) });
  }

  // --- Admin: everything else requires a valid session ---
  if (pathname.startsWith("/api/admin/")) {
    const session = adminAuth.verifySession(getSessionToken(req));
    if (!session) {
      return sendError(res, 401, "unauthorized", "Sign in required.");
    }

    let body = null;
    if (method === "POST" || method === "PATCH") {
      try {
        body = await readJSONBody(req, ADMIN_BODY_LIMIT);
      } catch (err) {
        return sendBodyError(res, err);
      }
    }

    const result = routeAdmin(method, pathname, query, body, req);
    if (result) return sendResult(res, result);

    return sendError(res, 404, "not_found", "That admin endpoint doesn't exist.");
  }

  return sendError(res, 404, "not_found", "That endpoint doesn't exist.");
}

function sendResult(res, result) {
  if (result.error) return sendError(res, result.status, result.error.code, result.error.message);
  if (result.file) {
    // a file download (the database backup): never cached, always saved rather than shown
    res.writeHead(result.status, {
      "Content-Type": result.file.contentType,
      "Content-Length": result.file.buffer.length,
      "Content-Disposition": `attachment; filename="${result.file.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return res.end(result.file.buffer);
  }
  return sendJSON(res, result.status, result.body);
}

// Returns a {status, body} or {status, error} result for a matched
// admin route, or null if nothing matched (caller sends the 404).
// Kept as one dispatcher, since the admin surface is a lot of small
// routes across a handful of resources — the resource files
// themselves (admin-providers.js etc.) hold the actual logic.
function routeAdmin(method, pathname, query, body, req) {
  let m;

  // Which address the server believes the caller has (to check TRUST_PROXY_HOPS after deploying)
  if (method === "GET" && pathname === "/api/admin/client-ip") {
    return { status: 200, body: { seen_as: clientIp(req), connection: req.socket.remoteAddress || null, x_forwarded_for: req.headers["x-forwarded-for"] || null, trust_proxy_hops: Number(process.env.TRUST_PROXY_HOPS) || 0 } };
  }

  // Spreadsheet exports (CSV)
  if (method === "GET" && pathname === "/api/admin/export/orders") return adminExport.exportOrders(db);
  if (method === "GET" && pathname === "/api/admin/export/payouts") return adminExport.exportPayouts(db);
  if (method === "GET" && pathname === "/api/admin/export/listings") return adminExport.exportListings(db);

  // Backups
  if (method === "GET" && pathname === "/api/admin/backup") return { status: 200, file: backup.downloadCopy(db) };
  if (method === "GET" && pathname === "/api/admin/backups") return { status: 200, body: { backups: backup.listBackups(BACKUP_DIR), keep: Number(process.env.BACKUP_KEEP) >= 1 ? Number(process.env.BACKUP_KEEP) : 14 } };
  if (method === "POST" && pathname === "/api/admin/backups") return { status: 201, body: backup.makeBackup(db, BACKUP_DIR) };

  // Dashboard
  if (method === "GET" && pathname === "/api/admin/dashboard") return adminDashboard.getDashboard(db);

  // Providers
  if (method === "POST" && pathname === "/api/admin/providers") return adminProviders.createProvider(db, body);
  if (method === "GET" && pathname === "/api/admin/providers") return adminProviders.listProviders(db);
  m = pathname.match(/^\/api\/admin\/providers\/([^/]+)$/);
  if (method === "GET" && m) return adminProviders.getProvider(db, m[1]);
  m = pathname.match(/^\/api\/admin\/providers\/([^/]+)\/items$/);
  if (method === "POST" && m) return adminProviders.createProviderItem(db, m[1], body);

  // Listings
  if (method === "GET" && pathname === "/api/admin/items") return adminItems.listItemsAdmin(db, query);
  m = pathname.match(/^\/api\/admin\/items\/([^/]+)\/photos$/);
  if (method === "POST" && m) return adminItems.addPhoto(db, m[1], body);
  m = pathname.match(/^\/api\/admin\/items\/([^/]+)\/photos\/([^/]+)$/);
  if (method === "DELETE" && m) return adminItems.deletePhoto(db, m[1], m[2]);
  if (method === "PATCH" && m) return adminItems.reorderPhoto(db, m[1], m[2], body);
  m = pathname.match(/^\/api\/admin\/items\/([^/]+)$/);
  if (method === "PATCH" && m) return adminItems.updateItem(db, m[1], body);

  // Orders + shipments
  if (method === "GET" && pathname === "/api/admin/orders") return adminOrders.listOrdersAdmin(db, query);
  m = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
  if (method === "PATCH" && m) return adminOrders.updateOrderStatus(db, m[1], body);
  m = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/return$/);
  if (method === "POST" && m) return adminOrders.recordReturn(db, m[1], body);
  m = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/refund$/);
  if (method === "PATCH" && m) return adminOrders.updateRefund(db, m[1], body);
  m = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/charges$/);
  if (method === "PATCH" && m) return adminOrders.updateCharges(db, m[1], body);
  if (method === "POST" && pathname === "/api/admin/reminders/run") return adminOrders.runReminders(db);
  m = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/payment$/);
  if (method === "PATCH" && m) return adminOrders.updateOrderPayment(db, m[1], body);
  m = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/shipments$/);
  if (method === "POST" && m) return adminOrders.createShipment(db, m[1], body);
  if (method === "GET" && m) return adminOrders.listShipments(db, m[1]);
  m = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (method === "GET" && m) return adminOrders.getOrderAdmin(db, m[1]);

  // Payouts
  if (method === "GET" && pathname === "/api/admin/payouts") return adminPayouts.listPayouts(db, query);
  m = pathname.match(/^\/api\/admin\/payouts\/([^/]+)\/mark-paid$/);
  if (method === "POST" && m) return adminPayouts.markPaid(db, m[1], body);

  return null;
}

const SESSION_COOKIE = "ws_session";

// The browser frontend authenticates with an HttpOnly cookie (JavaScript
// can't read it, which limits what an XSS bug could steal). A Bearer
// header is still accepted so the API stays easy to test with curl.
function getSessionToken(req) {
  const header = req.headers["authorization"] || "";
  const bearer = header.match(/^Bearer (.+)$/);
  if (bearer) return bearer[1];

  const cookies = req.headers["cookie"] || "";
  const match = cookies.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return match ? match.slice(SESSION_COOKIE.length + 1) : null;
}

// SameSite=Strict means the browser won't send this cookie on requests
// started from other sites, which is what blocks cross-site request
// forgery against the admin endpoints. "Secure" is added in production
// so the cookie only travels over HTTPS.
function sessionCookie(token, clear = false) {
  const parts = [`${SESSION_COOKIE}=${clear ? "" : token}`, "HttpOnly", "SameSite=Strict", "Path=/"];
  parts.push(clear ? "Max-Age=0" : "Max-Age=86400");
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

// SITE_PASSWORD puts a browser password prompt in front of the WHOLE site (shoppers' pages,
// the API and admin), for a private preview. The username can be anything. Only /api/health
// stays open, so the host can check the site is up. Admin sign-in still applies on top.
function passwordGate(req, res, pathname) {
  const wanted = process.env.SITE_PASSWORD;
  if (!wanted || pathname === "/api/health") return false;
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || "");
  if (m) {
    const given = Buffer.from(m[1], "base64").toString("utf8");
    const pass = given.slice(given.indexOf(":") + 1);
    const a = crypto.createHash("sha256").update(pass).digest();
    const b = crypto.createHash("sha256").update(wanted).digest();
    if (crypto.timingSafeEqual(a, b)) return false;
  }
  res.writeHead(401, { "WWW-Authenticate": 'Basic realm="WearShare preview", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end("This is a private preview. Enter the password you were given.");
  return true;
}

// Headers every response gets when the site is live (NODE_ENV=production), and the
// "don't list this in search engines" header for a password-protected preview.
function commonHeaders(req, res) {
  if (process.env.SITE_PASSWORD || String(process.env.NOINDEX || "").toLowerCase() === "on") res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (process.env.NODE_ENV !== "production") return;
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  if (String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https") res.setHeader("Strict-Transport-Security", "max-age=15552000");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams);

  commonHeaders(req, res);
  if (passwordGate(req, res, pathname)) return;
  if (pathname === "/robots.txt" && (process.env.SITE_PASSWORD || String(process.env.NOINDEX || "").toLowerCase() === "on")) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("User-agent: *\nDisallow: /\n");
  }

  if (pathname.startsWith("/api/")) {
    return handleAPI(req, res, pathname, query).catch((err) => {
      console.error(err);
      sendError(res, 500, "internal_error", "Something went wrong.");
    });
  }

  // Everything else: serve the static frontend
  return serveStatic(req, res, pathname);
});

const { seeded } = init();
// Reminder emails for rentals that are due back or late. Once shortly after start,
// then every few hours; each reminder is recorded, so repeats are harmless.
const reminderTimer = setInterval(() => {
  try {
    lifecycle.runReminders(db);
  } catch (err) {
    console.error("reminder check failed:", err.message);
  }
}, 3 * 60 * 60 * 1000);
reminderTimer.unref();
setTimeout(() => {
  try {
    lifecycle.runReminders(db);
  } catch (err) {
    console.error("reminder check failed:", err.message);
  }
}, 15000).unref();

// Automatic backups: one shortly after start if the newest is over ~20 hours old, then
// checked every 3 hours. BACKUP_EVERY=off turns the schedule off (the button still works).
function autoBackup() {
  if (String(process.env.BACKUP_EVERY || "").toLowerCase() === "off") return;
  try {
    const made = backup.backupIfStale(db, BACKUP_DIR);
    if (made) console.log(`[backup] saved ${made.name} in ${BACKUP_DIR}`);
  } catch (err) {
    console.error("[backup] FAILED:", err.message);
  }
}
setInterval(autoBackup, 3 * 60 * 60 * 1000).unref();
setTimeout(autoBackup, 30000).unref();

server.listen(PORT, () => {
  console.log(`WearShare backend running at http://localhost:${PORT}`);
  console.log(seeded ? "Database seeded with starter data." : "Database already had data — skipped seeding.");
});