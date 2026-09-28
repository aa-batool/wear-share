// backend/server.js
// ------------------------------------------------------------
// Entry point. Right now this serves the static frontend and
// initializes the database on boot, plus one health-check route
// so we can confirm the whole thing is wired together correctly
// before building the real API endpoints on top of it (next step
// in the README's build log).
//
// Run with: node backend/server.js
// ------------------------------------------------------------

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { loadEnv } = require("./env");
const { init, db } = require("./db");
const itemsRoutes = require("./routes/items");
const ordersRoutes = require("./routes/orders");
const adminAuth = require("./routes/admin-auth");
const adminProviders = require("./routes/admin-providers");
const adminItems = require("./routes/admin-items");
const adminOrders = require("./routes/admin-orders");
const adminPayouts = require("./routes/admin-payouts");

loadEnv();

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

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJSON(res, status, { error: { code, message } });
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      // crude guard against absurdly large bodies
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
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

function serveStatic(req, res, pathname) {
  // Map "/" to index.html, "/admin" to admin/dashboard.html for convenience.
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

  // POST /api/orders
  if (method === "POST" && pathname === "/api/orders") {
    let body;
    try {
      body = await readJSONBody(req);
    } catch {
      return sendError(res, 400, "invalid_json", "Request body must be valid JSON.");
    }
    const result = ordersRoutes.createOrder(db, body);
    if (result.error && !result.status) return sendError(res, 422, result.error.code, result.error.message);
    if (result.status && result.status !== 201) return sendError(res, result.status, result.error.code, result.error.message);
    return sendJSON(res, 201, result.body);
  }

  // GET /api/orders/:id
  m = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (method === "GET" && m) {
    const order = ordersRoutes.getOrder(db, m[1], query.email);
    if (!order) return sendError(res, 404, "order_not_found", "No order matches that reference and email.");
    return sendJSON(res, 200, order);
  }

  if (pathname === "/api/health") {
    return sendJSON(res, 200, { status: "ok" });
  }

  // --- Admin: auth ---

  if (method === "POST" && pathname === "/api/admin/login") {
    let body;
    try {
      body = await readJSONBody(req);
    } catch {
      return sendError(res, 400, "invalid_json", "Request body must be valid JSON.");
    }
    const result = adminAuth.login(db, body);
    if (result.status !== 200) return sendError(res, result.status, result.error.code, result.error.message);
    return sendJSON(res, 200, result.body);
  }

  if (method === "POST" && pathname === "/api/admin/logout") {
    adminAuth.logout(getBearerToken(req));
    return sendJSON(res, 200, { ok: true });
  }

  // --- Admin: everything else requires a valid session ---
  if (pathname.startsWith("/api/admin/")) {
    const session = adminAuth.verifySession(getBearerToken(req));
    if (!session) {
      return sendError(res, 401, "unauthorized", "Sign in required.");
    }

    let body = null;
    if (method === "POST" || method === "PATCH") {
      try {
        body = await readJSONBody(req);
      } catch {
        return sendError(res, 400, "invalid_json", "Request body must be valid JSON.");
      }
    }

    const result = routeAdmin(method, pathname, query, body);
    if (result) return sendResult(res, result);

    return sendError(res, 404, "not_found", "That admin endpoint doesn't exist.");
  }

  return sendError(res, 404, "not_found", "That endpoint doesn't exist.");
}

function sendResult(res, result) {
  if (result.error) return sendError(res, result.status, result.error.code, result.error.message);
  return sendJSON(res, result.status, result.body);
}

// Returns a {status, body} or {status, error} result for a matched
// admin route, or null if nothing matched (caller sends the 404).
// Kept as one dispatcher, since the admin surface is a lot of small
// routes across a handful of resources — the resource files
// themselves (admin-providers.js etc.) hold the actual logic.
function routeAdmin(method, pathname, query, body) {
  let m;

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

function getBearerToken(req) {
  const header = req.headers["authorization"] || "";
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams);

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
server.listen(PORT, () => {
  console.log(`WearShare backend running at http://localhost:${PORT}`);
  console.log(seeded ? "Database seeded with starter data." : "Database already had data — skipped seeding.");
});