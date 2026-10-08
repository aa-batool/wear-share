// backend/test/smoke.js
// ------------------------------------------------------------
// End-to-end API smoke test. Boots a real server on a spare port
// with a throwaway database, then exercises the public and admin
// endpoints over HTTP and checks the behavior that matters most:
// anonymity (no provider data in public responses), availability
// conflicts, validation, auth, and photo visibility.
//
// Run with:  npm test     (or: node backend/test/smoke.js)
// Needs no dependencies — just Node 22.5+.
// ------------------------------------------------------------

const { spawn } = require("node:child_process");
const net = require("node:net");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const PORT = 3400 + Math.floor(Math.random() * 400);
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `wearshare-smoke-${process.pid}.sqlite`);

const PAY_INFO = "Bank: Test Bank\nAccount title: WearShare\nIBAN: PK00TEST0000000000";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
}

async function call(method, urlPath, { body, cookie, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : null;
  return { status: res.status, data, res };
}

const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SVG = "data:image/svg+xml;base64,PHN2Zy8+";


// A tiny fake mail server, so the owner-notification emails can be checked
// without a real account. Remembers every message it is given.
const mailbox = [];
function startFakeSmtp() {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let inData = false;
      let data = "";
      let acc = "";
      let rcpt = null;
      let auth = [];
      sock.write("220 fake ready\r\n");
      sock.on("data", (chunk) => {
        acc += chunk.toString("utf8");
        let i;
        while ((i = acc.indexOf("\r\n")) !== -1) {
          const line = acc.slice(0, i);
          acc = acc.slice(i + 2);
          if (inData) {
            if (line === ".") {
              inData = false;
              const [head, ...rest] = data.split("\r\n\r\n");
              const subject = (/^Subject: (.*)$/m.exec(head) || [])[1];
              const to = (/^To: (.*)$/m.exec(head) || [])[1];
              const text = Buffer.from(rest.join("").replace(/\s+/g, ""), "base64").toString("utf8");
              mailbox.push({ subject, to, rcpt, text, auth, head });
              data = "";
              sock.write("250 queued\r\n");
            } else data += line + "\r\n";
          } else if (/^EHLO/.test(line)) sock.write("250-fake\r\n250 AUTH LOGIN\r\n");
          else if (line === "AUTH LOGIN") sock.write("334 VXNlcm5hbWU6\r\n");
          else if (/^[A-Za-z0-9+/=]+$/.test(line) && auth.length < 2) {
            auth.push(Buffer.from(line, "base64").toString());
            sock.write(auth.length === 1 ? "334 UGFzc3dvcmQ6\r\n" : "235 ok\r\n");
          } else if (/^MAIL FROM/.test(line)) sock.write("250 ok\r\n");
          else if (/^RCPT TO:<(.*)>/.test(line)) {
            rcpt = /^RCPT TO:<(.*)>/.exec(line)[1];
            sock.write("250 ok\r\n");
          } else if (line === "DATA") {
            inData = true;
            sock.write("354 go\r\n");
          } else if (line === "QUIT") sock.end("221 bye\r\n");
        }
      });
      sock.on("error", () => {});
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForMail(n, ms = 4000) {
  const end = Date.now() + ms;
  while (mailbox.length < n && Date.now() < end) await sleep(50);
}

async function main() {
  const smtp = await startFakeSmtp();
  // ---------------- Admin login from .env (in-process, on a throwaway in-memory database) ----------------
  {
    const { createSchema } = require("../db/schema");
    const { seedIfEmpty } = require("../db/seed");
    const { syncAdminFromEnv } = require("../db/admin-account");
    const { verifyPassword, hashPassword } = require("../routes/admin-auth");
    const quiet = { log() {}, warn: (m) => warnings.push(m), error: (m) => errors.push(m) };
    const warnings = [];
    const errors = [];
    const fresh = () => {
      const mem = new DatabaseSync(":memory:");
      createSchema(mem);
      return mem;
    };
    const setEnv = (email, password) => {
      if (email === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = email;
      if (password === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = password;
    };
    const admins = (mem) => mem.prepare("SELECT * FROM admin_users").all();

    check("passwords are stored salted and slow (scrypt), not as plain SHA-256", /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(hashPassword("x")) && hashPassword("x") !== hashPassword("x"));
    check("the old unsalted hashes still verify (so existing databases keep working)", verifyPassword("changeme123", require("node:crypto").createHash("sha256").update("changeme123").digest("hex")));
    check("a wrong password doesn't verify", !verifyPassword("nope", hashPassword("changeme123")) && !verifyPassword("x", undefined));

    let mem = fresh();
    setEnv(undefined, undefined);
    seedIfEmpty(mem);
    syncAdminFromEnv(mem, quiet);
    check("with nothing set, the demo login exists and the server warns about it", admins(mem).length === 1 && admins(mem)[0].email === "owner@example.com" && warnings.some((w) => /still the demo one/.test(w)));

    setEnv("owner.real@example.com", "a-long-private-password");
    let res = syncAdminFromEnv(mem, quiet);
    check("ADMIN_EMAIL / ADMIN_PASSWORD replace the demo login", res.action === "updated" && admins(mem).length === 1 && admins(mem)[0].email === "owner.real@example.com" && verifyPassword("a-long-private-password", admins(mem)[0].password_hash) && !verifyPassword("changeme123", admins(mem)[0].password_hash));
    const hashBefore = admins(mem)[0].password_hash;
    res = syncAdminFromEnv(mem, quiet);
    check("starting again with the same settings changes nothing", res.action === "unchanged" && admins(mem)[0].password_hash === hashBefore);
    setEnv("owner.real@example.com", "another-long-password!");
    res = syncAdminFromEnv(mem, quiet);
    check("changing the password in .env changes the login", res.action === "updated" && verifyPassword("another-long-password!", admins(mem)[0].password_hash));
    setEnv(undefined, undefined);
    syncAdminFromEnv(mem, quiet);
    check("removing the settings keeps the last login (it isn't reset to the demo one)", admins(mem)[0].email === "owner.real@example.com" && verifyPassword("another-long-password!", admins(mem)[0].password_hash));

    mem = fresh();
    setEnv("brand.new@example.com", "a-long-private-password");
    res = syncAdminFromEnv(mem, quiet);
    check("on an empty database it creates the account", res.action === "created" && admins(mem).length === 1 && admins(mem)[0].email === "brand.new@example.com");

    mem = fresh();
    seedIfEmpty(mem);
    for (const [e, p, why] of [["not-an-email", "a-long-private-password", "email"], ["x@example.com", "short", "short"], ["x@example.com", "changeme123", "demo"]]) {
      setEnv(e, p);
      res = syncAdminFromEnv(mem, quiet);
      check(`a bad ADMIN_${why === "email" ? "EMAIL" : "PASSWORD"} (${why}) is refused and the existing login is left alone`, res.action === "rejected" && res.reason === why && admins(mem)[0].email === "owner@example.com" && verifyPassword("changeme123", admins(mem)[0].password_hash));
    }
    check("the server says why in its log", errors.length === 3);
    setEnv(undefined, undefined);

    // .env values may be wrapped in quotes; Windows line endings and comments are fine
    const parsed = require("../env").parseEnv('# a comment\r\nA="two words #1"\r\nB=\'single\'\r\nC=plain # kept as-is\r\n\r\nD=\r\nnot a line\r\n');
    check("the .env reader strips quotes, ignores comment lines and handles Windows line endings",
      parsed.A === "two words #1" && parsed.B === "single" && parsed.C === "plain # kept as-is" && parsed.D === "" && Object.keys(parsed).join() === "A,B,C,D", JSON.stringify(parsed));
  }

  const server = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")],
    { env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB_PATH, ONLINE_PAYMENT_INSTRUCTIONS: PAY_INFO, RATE_LIMIT_SCALE: "20", CONTACT_EMAIL: "help@example.com", CONTACT_WHATSAPP: "+92 300 0000000", ALLOW_RESERVED_EMAIL_DOMAINS: "1", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.address().port), SMTP_SECURE: "false", SMTP_USER: "sender@example.com", SMTP_PASS: "app pass 1234", NOTIFY_EMAIL: "owner-inbox@example.com" }, stdio: "ignore" }
  );

  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }

    // ---------------- Public: catalog ----------------
    let r = await call("GET", "/api/items");
    const ids = (r.data?.items || []).map((i) => i.id).sort();
    check("catalog lists only public items", JSON.stringify(ids) === JSON.stringify(["blazer-01", "blouse-01", "coat-01", "gown-01"]), ids.join(","));
    check("catalog leaks no provider data", !JSON.stringify(r.data).includes("provider") && !JSON.stringify(r.data).includes("intake_notes"));

    r = await call("GET", "/api/items?category=Outerwear");
    check("category filter", (r.data?.items || []).map((i) => i.id).sort().join() === "blazer-01,coat-01");
    r = await call("GET", "/api/items?mode=buy");
    check("buy filter excludes rent-only items", !(r.data?.items || []).some((i) => i.id === "blouse-01"));

    r = await call("GET", "/api/items/gown-01");
    check("item detail has booked_ranges array", Array.isArray(r.data?.booked_ranges), JSON.stringify(r.data));
    check("item detail leaks no provider data", !JSON.stringify(r.data).includes("provider"));
    // Seed: gown-01 has a shipped rental (out with a customer), so it can't be bought yet.
    check("an item out with a renter can't be bought (and any reopening date is in the future)",
      r.data?.buy_availability?.available === false && (r.data.buy_availability.available_from === null || r.data.buy_availability.available_from > isoDay(0)),
      JSON.stringify(r.data?.buy_availability));
    r = await call("GET", "/api/items/skirt-01");
    check("intake item is hidden from public detail (404)", r.status === 404);

    // ---------------- Public: orders ----------------
    const start = isoDay(60), end = isoDay(63);
    const customer = { name: "Smoke Tester", email: "Smoke.Tester@example.com", phone: "+92 300 0000000", shipping_address: "1 Test Street" };
    r = await call("POST", "/api/orders", { body: { item_id: "gown-01", payment_method: "cod", type: "rent", rent_start_date: start, rent_end_date: end, customer } });
    const orderId = r.data?.order_id;
    check("rental order created (4 days x Rs 3,650 = Rs 14,600)", r.status === 201 && r.data?.price_total === 14600, JSON.stringify(r.data));

    r = await call("POST", "/api/orders", { body: { item_id: "gown-01", payment_method: "cod", type: "rent", rent_start_date: isoDay(62), rent_end_date: isoDay(65), customer } });
    check("overlapping rental rejected with 409", r.status === 409 && r.data?.error?.code === "item_unavailable", JSON.stringify(r.data));

    r = await call("GET", `/api/items/gown-01`);
    check("new booking appears in booked_ranges", (r.data?.booked_ranges || []).some((b) => b.start_date === start && b.end_date === end));
    r = await call("GET", `/api/items/gown-01/availability?start_date=${isoDay(61)}&end_date=${isoDay(62)}`);
    check("availability reports the conflict", r.data?.available === false);
    r = await call("GET", `/api/items/gown-01/availability?start_date=${isoDay(70)}&end_date=${isoDay(72)}`);
    check("availability reports open dates", r.data?.available === true);

    r = await call("POST", "/api/orders", { body: { item_id: "gown-01", payment_method: "cod", type: "rent" } });
    check("order with missing fields -> 422", r.status === 422, String(r.status));
    r = await call("POST", "/api/orders", { body: { item_id: "blouse-01", payment_method: "cod", type: "buy", customer } });
    check("buying a rent-only item -> 422", r.status === 422, String(r.status));
    r = await call("POST", "/api/orders", { body: { item_id: "skirt-01", payment_method: "cod", type: "rent", rent_start_date: start, rent_end_date: end, customer } });
    check("ordering an unpublished item -> 404", r.status === 404, String(r.status));
    r = await call("POST", "/api/orders", { body: `{"item_id":"x","pad":"${"a".repeat(1_200_000)}"}`, raw: true });
    check("oversized public body -> 413", r.status === 413, String(r.status));

    // ---------------- Public: tracking ----------------
    r = await call("GET", `/api/orders/${orderId.toUpperCase()}?email=SMOKE.TESTER@EXAMPLE.COM`);
    check("tracking lookup is case-insensitive", r.status === 200 && r.data?.item_name === "Deep Plum Velvet Gown", JSON.stringify(r.data));
    r = await call("GET", `/api/orders/${orderId}?email=someone.else@example.com`);
    const wrongEmail = r.status;
    r = await call("GET", `/api/orders/does-not-exist?email=someone.else@example.com`);
    check("wrong email and unknown order look identical (404)", wrongEmail === 404 && r.status === 404);
    r = await call("GET", "/api/orders/ord-1001?email=jamila.r@example.com");
    check("seeded shipped order shows tracking", r.data?.tracking?.carrier === "TCS", JSON.stringify(r.data));

    // ---------------- Public: intake ----------------
    const intake = {
      item: { name: "Smoke Test Dress", category: "Dresses", size: "M", condition: "Good", brand: "Acme", notes: "<b>bold</b> notes" },
      outcome: "rent", estimated_value: "50",
      contact: { name: "Provider Person", email: "provider.person@example.com", phone: "+92 300 1111111" },
      handoff: "pickup", address: "9 Pickup Lane",
    };
    r = await call("POST", "/api/intake", { body: intake });
    check("intake submission accepted", r.status === 201 && /^WS-\d+$/.test(r.data?.reference || ""), JSON.stringify(r.data));
    r = await call("POST", "/api/intake", { body: { ...intake, handoff: "pickup", address: "" } });
    check("pickup without address -> 422", r.status === 422);
    r = await call("POST", "/api/intake", { body: { ...intake, item: { ...intake.item, name: { $x: 1 } } } });
    check("non-text intake field -> 422", r.status === 422);
    r = await call("POST", "/api/intake", { body: { ...intake, item: { ...intake.item, notes: "n".repeat(2500) } } });
    check("overlong intake notes -> 422", r.status === 422);

    // ---------------- Admin: auth ----------------
    r = await call("GET", "/api/admin/dashboard");
    check("admin endpoint without session -> 401", r.status === 401);
    r = await call("POST", "/api/admin/login", { body: { email: "owner@example.com", password: "wrong" } });
    check("wrong password -> 401", r.status === 401);
    r = await call("POST", "/api/admin/login", { body: { email: "owner@example.com", password: "changeme123" } });
    const setCookie = r.res.headers.getSetCookie().join(";");
    check("login sets an HttpOnly, SameSite=Strict cookie", r.status === 200 && /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie), setCookie);
    const cookie = setCookie.split(";")[0];

    r = await call("GET", "/api/admin/dashboard", { cookie });
    check("dashboard stats via cookie", r.status === 200 && r.data?.stats?.intake_queue >= 3 && Array.isArray(r.data?.recent_activity), JSON.stringify(r.data?.stats));

    // ---------------- Payment method: cash on delivery or online ----------------
    const payCustomer = { name: "Pay Tester", email: "pay.tester@example.com", phone: "+92 300 2222222", shipping_address: "5 Payment Road" };
    const payBody = (extra) => ({ item_id: "blouse-01", type: "rent", rent_start_date: isoDay(200), rent_end_date: isoDay(201), customer: payCustomer, ...extra });

    r = await call("POST", "/api/orders", { body: payBody({}) });
    check("an order with no payment method is refused (422 invalid_payment_method)", r.status === 422 && r.data?.error?.code === "invalid_payment_method", JSON.stringify(r.data));
    r = await call("POST", "/api/orders", { body: payBody({ payment_method: "card" }) });
    check("an unknown payment method is refused (422)", r.status === 422 && r.data?.error?.code === "invalid_payment_method", JSON.stringify(r.data));

    r = await call("POST", "/api/orders", { body: payBody({ payment_method: "cod" }) });
    const codId = r.data?.order_id;
    check("cash on delivery order: recorded as cod, unpaid, no transfer instructions",
      r.status === 201 && r.data?.payment_method === "cod" && r.data?.payment_status === "unpaid" && r.data?.payment_instructions === null, JSON.stringify(r.data));

    r = await call("POST", "/api/orders", { body: payBody({ payment_method: "online", rent_start_date: isoDay(210), rent_end_date: isoDay(212) }) });
    const onlineId = r.data?.order_id;
    check("online order: recorded as online, unpaid, and returns the shop's payment instructions",
      r.status === 201 && r.data?.payment_method === "online" && r.data?.payment_status === "unpaid" && r.data?.payment_instructions === PAY_INFO, JSON.stringify(r.data));

    r = await call("GET", `/api/orders/${onlineId}?email=${payCustomer.email}`);
    check("tracking an unpaid online order shows the method, amount due and instructions",
      r.data?.payment_method === "online" && r.data?.payment_status === "unpaid" && r.data?.price_total === 4200 && r.data?.payment_instructions === PAY_INFO, JSON.stringify(r.data));
    r = await call("GET", `/api/orders/${codId}?email=${payCustomer.email}`);
    check("tracking a cash-on-delivery order shows cod and no instructions", r.data?.payment_method === "cod" && r.data?.payment_instructions === null, JSON.stringify(r.data));
    r = await call("GET", "/api/orders/ord-1001?email=jamila.r@example.com");
    check("a seeded paid order shows its method and paid status", r.data?.payment_method === "online" && r.data?.payment_status === "paid" && r.data?.payment_instructions === null, JSON.stringify(r.data));

    r = await call("GET", `/api/admin/orders/${onlineId}`, { cookie });
    check("admin order detail carries the payment method and status", r.data?.payment_method === "online" && r.data?.payment_status === "unpaid", JSON.stringify(r.data));
    check("...and the order history says how the customer chose to pay", (r.data?.history?.[0]?.note || "").includes("pay online"), JSON.stringify(r.data?.history));
    r = await call("GET", "/api/admin/orders", { cookie });
    check("admin order list carries payment fields", (r.data?.orders || []).find((o) => o.id === codId)?.payment_method === "cod");

    r = await call("PATCH", `/api/admin/orders/${onlineId}/payment`, { body: { payment_status: "paid" } });
    check("marking payment without an admin session is refused (401)", r.status === 401, String(r.status));
    r = await call("PATCH", `/api/admin/orders/${onlineId}/payment`, { cookie, body: { payment_status: "refunded" } });
    check("an invalid payment status is refused (422)", r.status === 422 && r.data?.error?.code === "invalid_payment_status", JSON.stringify(r.data));
    r = await call("PATCH", "/api/admin/orders/nope-123/payment", { cookie, body: { payment_status: "paid" } });
    check("marking payment on an unknown order -> 404", r.status === 404, String(r.status));
    r = await call("PATCH", `/api/admin/orders/${onlineId}/payment`, { cookie, body: { payment_status: "paid" } });
    check("admin marks the online order paid", r.status === 200 && r.data?.payment_status === "paid", JSON.stringify(r.data));
    r = await call("GET", `/api/admin/orders/${onlineId}`, { cookie });
    const lastNote = r.data?.history?.[r.data.history.length - 1]?.note || "";
    check("...and the history records it", lastNote.includes("Payment received") && lastNote.includes("online"), JSON.stringify(r.data?.history));
    r = await call("GET", `/api/orders/${onlineId}?email=${payCustomer.email}`);
    check("a paid online order no longer shows transfer instructions to the customer", r.data?.payment_status === "paid" && r.data?.payment_instructions === null, JSON.stringify(r.data));
    r = await call("PATCH", `/api/admin/orders/${onlineId}/payment`, { cookie, body: { payment_status: "unpaid" } });
    check("payment can be put back to unpaid if it was marked by mistake", r.status === 200 && r.data?.payment_status === "unpaid");

    // ---------------- Admin: listings ----------------
    r = await call("GET", "/api/admin/items", { cookie });
    const all = r.data?.items || [];
    const newItem = all.find((i) => i.name === "Smoke Test Dress");
    check("admin list includes provider name", all.every((i) => typeof i.provider_name === "string"));
    check("intake item carries the provider's notes", newItem?.intake_notes?.includes("Wants to: rent") && newItem?.status === "intake" && newItem?.rent_only === 1, JSON.stringify(newItem));

    r = await call("PATCH", `/api/admin/items/${newItem.id}`, { cookie, body: { status: "listed" } });
    check("can't publish an unpriced item (422)", r.status === 422 && r.data?.error?.code === "price_required", JSON.stringify(r.data));
    r = await call("PATCH", `/api/admin/items/${newItem.id}`, { cookie, body: { rent_price_per_day: 1500 } });
    check("set price", r.status === 200);
    r = await call("PATCH", `/api/admin/items/${newItem.id}`, { cookie, body: { status: "listed" } });
    check("publish once priced", r.status === 200 && r.data?.status === "listed", JSON.stringify(r.data));
    r = await call("GET", "/api/items");
    check("published item appears in the public catalog", (r.data?.items || []).some((i) => i.id === newItem.id));

    // ---------------- Admin: photos ----------------
    r = await call("POST", `/api/admin/items/${newItem.id}/photos`, { cookie, body: { data_url: SVG } });
    check("SVG upload rejected (422)", r.status === 422 && r.data?.error?.code === "invalid_image", JSON.stringify(r.data));
    r = await call("POST", `/api/admin/items/${newItem.id}/photos`, { cookie, body: { data_url: PNG } });
    const photoUrl = r.data?.url;
    check("PNG upload accepted, returns a path", r.status === 201 && /^\/api\/photos\/photo-\d+$/.test(photoUrl || ""), JSON.stringify(r.data));

    let img = await fetch(BASE + photoUrl);
    const bytes = Buffer.from(await img.arrayBuffer());
    check("public can fetch a listed item's photo as image/png", img.status === 200 && img.headers.get("content-type") === "image/png" && bytes.length > 20 && bytes[1] === 0x50);
    r = await call("GET", `/api/items/${newItem.id}`);
    check("detail + list reference the photo by path (no base64 in JSON)", r.data?.photos?.[0]?.url === photoUrl && !JSON.stringify(r.data).includes("base64"));
    r = await call("GET", "/api/items");
    check("catalog thumbnail is a path", (r.data?.items || []).find((i) => i.id === newItem.id)?.thumbnail_url === photoUrl);

    r = await call("POST", "/api/admin/items/skirt-01/photos", { cookie, body: { data_url: PNG } });
    const hiddenUrl = r.data?.url;
    img = await fetch(BASE + hiddenUrl);
    check("unpublished item's photo is hidden from the public (404)", img.status === 404);
    img = await fetch(BASE + hiddenUrl, { headers: { Cookie: cookie } });
    check("...but visible to an admin session", img.status === 200);

    // ---------------- Admin: orders, payouts ----------------
    r = await call("GET", "/api/admin/orders", { cookie });
    check("admin order list", r.status === 200 && r.data.orders.some((o) => o.id === orderId));
    r = await call("PATCH", `/api/admin/orders/${orderId}/status`, { cookie, body: { status: "confirmed", note: "smoke" } });
    check("order status update", r.status === 200 && r.data?.status === "confirmed");
    r = await call("GET", `/api/admin/orders/${orderId}`, { cookie });
    check("order detail has customer contact + status history", r.data?.customer_phone && r.data?.history?.length === 2, JSON.stringify(r.data?.history));
    r = await call("GET", `/api/orders/${orderId}?email=smoke.tester@example.com`);
    check("customer tracking reflects the admin's status change", r.data?.status === "confirmed");

    // ---------------- Rental dates vs. buying ----------------
    // A piece still booked for rental CAN be bought, but only if the buyer
    // acknowledges that delivery comes after the rental ends.
    r = await call("GET", "/api/items/coat-01");
    check("an item with no rentals can be bought straight away", r.data?.buy_availability?.available === true, JSON.stringify(r.data?.buy_availability));
    r = await call("GET", "/api/items/blouse-01");
    check("rent-only item reports no buy availability", r.data?.buy_availability === null, JSON.stringify(r.data?.buy_availability));

    const rentStart = isoDay(40), rentEnd = isoDay(44);
    r = await call("POST", "/api/orders", { body: { item_id: "coat-01", payment_method: "cod", type: "rent", rent_start_date: rentStart, rent_end_date: rentEnd, customer } });
    const coatRentId = r.data?.order_id;
    check("rental booked for next month on the coat", r.status === 201, JSON.stringify(r.data));

    r = await call("GET", "/api/items/coat-01");
    check("detail reports delivery would wait until the day after the rental ends",
      r.data?.buy_availability?.available === false && r.data?.buy_availability?.available_from === isoDay(45), JSON.stringify(r.data?.buy_availability));

    r = await call("POST", "/api/orders", { body: { item_id: "coat-01", payment_method: "cod", type: "buy", customer } });
    check("buying without acknowledging the delay is refused (409 delivery_delayed)", r.status === 409 && r.data?.error?.code === "delivery_delayed", JSON.stringify(r.data));
    check("...and the message names the date", (r.data?.error?.message || "").includes(isoDay(45)), r.data?.error?.message);
    r = await call("POST", "/api/orders", { body: { item_id: "coat-01", payment_method: "cod", type: "buy", acknowledge_delayed_delivery: "yes", customer } });
    check("a truthy-but-not-true acknowledgement doesn't count", r.status === 409, String(r.status));

    r = await call("POST", "/api/orders", { body: { item_id: "coat-01", payment_method: "cod", type: "buy", acknowledge_delayed_delivery: true, customer } });
    const delayedBuyId = r.data?.order_id;
    check("buying with the acknowledgement is accepted, flagged as delayed, with the date",
      r.status === 201 && r.data?.delivery_delayed === true && r.data?.deliver_after === isoDay(45) && r.data?.price_total === 25800, JSON.stringify(r.data));

    r = await call("GET", `/api/orders/${delayedBuyId}?email=${customer.email}`);
    check("the buyer's tracking lookup shows the delayed delivery", r.data?.delivery_delayed === true && r.data?.deliver_after === isoDay(45), JSON.stringify(r.data));
    r = await call("GET", `/api/admin/orders/${delayedBuyId}`, { cookie });
    check("admin order detail flags it to hold the shipment, with a note in the history",
      r.data?.delivery_held === 1 && r.data?.deliver_after === isoDay(45) && (r.data?.history?.[0]?.note || "").includes("do not ship before"), JSON.stringify(r.data?.history));
    r = await call("GET", "/api/admin/orders", { cookie });
    check("admin order list carries the hold flag", (r.data?.orders || []).find((o) => o.id === delayedBuyId)?.delivery_held === 1);

    // ---- A purchased piece disappears from the shop ----
    r = await call("GET", "/api/items");
    check("a purchased piece is gone from the catalog", !(r.data?.items || []).some((i) => i.id === "coat-01"), (r.data?.items || []).map((i) => i.id).join());
    r = await call("GET", "/api/items/coat-01");
    check("...its page is a 404 for the public", r.status === 404, String(r.status));
    r = await call("GET", `/api/items/coat-01/availability?start_date=${isoDay(70)}&end_date=${isoDay(72)}`);
    check("...and so is its availability lookup", r.status === 404, String(r.status));
    r = await call("GET", `/api/orders/${delayedBuyId}?email=${customer.email}`);
    check("...but the buyer can still track their order", r.status === 200 && r.data?.item_name === "Fawn Wool Overcoat", JSON.stringify(r.data));
    r = await call("POST", "/api/orders", { body: { item_id: "coat-01", payment_method: "cod", type: "buy", acknowledge_delayed_delivery: true, customer: { ...customer, email: "second.buyer@example.com" } } });
    check("a second buyer is told it was just bought (409 item_sold) and no order is made", r.status === 409 && r.data?.error?.code === "item_sold", JSON.stringify(r.data));
    r = await call("POST", "/api/orders", { body: { item_id: "coat-01", payment_method: "cod", type: "rent", rent_start_date: isoDay(80), rent_end_date: isoDay(82), customer } });
    check("nobody can start a new rental on a purchased piece", r.status === 409 && r.data?.error?.code === "item_sold", JSON.stringify(r.data));
    r = await call("GET", "/api/admin/items", { cookie });
    const coatRow = (r.data?.items || []).find((i) => i.id === "coat-01");
    check("admin still sees it, flagged with the purchase that hid it", coatRow?.buy_order_id === delayedBuyId, JSON.stringify(coatRow?.buy_order_id));
    r = await call("PATCH", `/api/admin/orders/${delayedBuyId}/status`, { cookie, body: { status: "cancelled" } });
    check("cancelling the purchase", r.status === 200);
    r = await call("GET", "/api/items/coat-01");
    check("...puts the piece straight back in the shop", r.status === 200 && r.data?.name === "Fawn Wool Overcoat", String(r.status));

    r = await call("GET", "/api/items/gown-01");
    check("an unreturned rental (no fixed date) gives a delayed-delivery notice without a date",
      r.data?.buy_availability?.available === false, JSON.stringify(r.data?.buy_availability));

    r = await call("PATCH", `/api/admin/orders/${coatRentId}/status`, { cookie, body: { status: "cancelled" } });
    check("cancel the rental", r.status === 200);
    r = await call("POST", "/api/orders", { body: { item_id: "coat-01", payment_method: "cod", type: "buy", customer } });
    check("with the rental gone, a purchase needs no acknowledgement and isn't flagged",
      r.status === 201 && r.data?.delivery_delayed === false && r.data?.deliver_after === null, JSON.stringify(r.data));
    r = await call("GET", "/api/items");
    check("...and that purchase hides it again", !(r.data?.items || []).some((i) => i.id === "coat-01"));

    r = await call("GET", "/api/admin/payouts", { cookie });
    check("payouts include item names", r.status === 200 && r.data.payouts.every((p) => p.item_name) && r.data.pending_total === 45575, JSON.stringify(r.data?.pending_total));
    r = await call("POST", "/api/admin/payouts/pay-01/mark-paid", { cookie, body: {} });
    check("mark payout paid", r.status === 200 && r.data?.status === "paid");

    // ---------------- Owner notification emails ----------------
    // The server was started with a fake mail server as its SMTP host, so
    // everything above has already been emailing it; start from a clean slate.
    for (let seen = -1; seen !== mailbox.length; ) { seen = mailbox.length; await sleep(500); } // let earlier emails land first
    mailbox.length = 0;
    const mailIntake = { ...intake, item: { ...intake.item, name: "Mail Test Dress" } };
    r = await call("POST", "/api/intake", { body: mailIntake });
    await waitForMail(1);
    const intakeMail = mailbox.find((m) => /intake/i.test(m.subject || ""));
    check("a new intake emails the owner's address, and only that address",
      !!intakeMail && intakeMail.rcpt === "owner-inbox@example.com" && intakeMail.to === "owner-inbox@example.com" && mailbox.every((m) => m.rcpt === "owner-inbox@example.com"), JSON.stringify(mailbox.map((m) => m.subject)));
    check("...it logs in with the configured account and says what came in",
      intakeMail?.auth?.[0] === "sender@example.com" && intakeMail?.auth?.[1] === "apppass1234" && intakeMail.text.includes("Mail Test Dress") && intakeMail.text.includes("provider.person@example.com"), intakeMail?.text);

    const hostile = { name: "Mallory\r\nBcc: attacker@example.com", email: "mallory@example.com", phone: "+92 300 3333333", shipping_address: "1 Road\n.\nQUIT" };
    r = await call("POST", "/api/orders", { body: { item_id: "blouse-01", type: "rent", rent_start_date: isoDay(300), rent_end_date: isoDay(302), payment_method: "cod", customer: hostile } });
    const mailOrderId = r.data?.order_id;
    await waitForMail(2);
    const orderMail = mailbox.find((m) => (m.subject || "").includes(mailOrderId || "nope"));
    check("a new order emails the owner the order, item, total, payment method and customer",
      !!orderMail && orderMail.text.includes("Ivory Silk Blouse") && orderMail.text.includes("Rs 4,200") && /Cash on delivery/.test(orderMail.text) && orderMail.text.includes("mallory@example.com"), orderMail?.text);
    check("text a customer typed can't add email headers or end the message early",
      !!orderMail && !/^Bcc:/mi.test(orderMail.head) && orderMail.rcpt === "owner-inbox@example.com" && orderMail.text.includes("QUIT"), orderMail?.head);

    await waitForMail(3);
    const toCustomer = (m) => m.rcpt === "mallory@example.com";
    const confirmMail = mailbox.find((m) => toCustomer(m) && (m.subject || "").includes(mailOrderId));
    check("the customer gets an order confirmation at the address they gave, and only they see it",
      !!confirmMail && confirmMail.to === "mallory@example.com" && confirmMail.text.includes(mailOrderId) && confirmMail.text.includes("Ivory Silk Blouse") && confirmMail.text.includes("Rs 4,200") && /cash on delivery/i.test(confirmMail.text) && !/Bcc:/i.test(confirmMail.head), confirmMail?.text);
    check("the owner's copy still goes only to the owner",
      mailbox.filter((m) => !toCustomer(m)).every((m) => m.rcpt === "owner-inbox@example.com"), JSON.stringify(mailbox.map((m) => m.rcpt)));
    check("customer emails say nothing about providers", !mailbox.filter(toCustomer).some((m) => /provider/i.test(m.text) || m.text.includes("provider.person")));

    const sentBefore = mailbox.length;
    r = await call("PATCH", `/api/admin/orders/${mailOrderId}/status`, { cookie: null, body: { status: "confirmed" } });
    check("an order status change without a session is refused and sends nothing", r.status === 401 && mailbox.length === sentBefore, String(mailbox.length));
    r = await call("PATCH", `/api/admin/orders/${mailOrderId}/status`, { cookie, body: { status: "confirmed", note: "Packed" } });
    r = await call("PATCH", `/api/admin/orders/${mailOrderId}/payment`, { cookie, body: { payment_status: "paid" } });
    r = await call("POST", `/api/admin/orders/${mailOrderId}/shipments`, { cookie, body: { direction: "outbound", courier: "TCS" } });
    r = await call("PATCH", "/api/admin/items/gown-01", { cookie, body: { status: "retired" } });
    await waitForMail(sentBefore + 8);
    const subjects = mailbox.filter((m) => !toCustomer(m)).map((m) => m.subject || "");
    check("order status, payment, shipment and listing changes each email the owner",
      subjects.some((x) => /is now confirmed/.test(x)) && subjects.some((x) => /payment received/.test(x)) && subjects.some((x) => /shipment booked/.test(x)) && subjects.some((x) => /Deep Plum Velvet Gown is now retired/.test(x)), JSON.stringify(subjects));
    const customerMails = mailbox.filter(toCustomer);
    const statusMail = customerMails.find((m) => /: confirmed/.test(m.subject));
    check("the customer is emailed when the order is confirmed, without the owner's private note",
      !!statusMail && statusMail.text.includes(mailOrderId) && !statusMail.text.includes("Packed"), statusMail?.text);
    check("the customer is told when payment arrives",
      customerMails.some((m) => /Payment received/.test(m.subject) && m.text.includes("Rs 4,200")));
    const shipMail = customerMails.find((m) => /shipping details/.test(m.subject));
    check("the customer gets the courier and tracking number when a shipment is booked", !!shipMail && /Courier: TCS/.test(shipMail.text) && /Tracking number: TCS-\d+/.test(shipMail.text), shipMail?.text);

    // online order: the confirmation carries the bank details; an unusable address is skipped, not mailed
    r = await call("POST", "/api/orders", { body: { item_id: "blouse-01", type: "rent", rent_start_date: isoDay(310), rent_end_date: isoDay(311), payment_method: "online", customer: { name: "Olivia", email: "olivia@example.com", phone: "1", shipping_address: "2 Road" } } });
    r = await call("POST", "/api/orders", { body: { item_id: "blouse-01", type: "rent", rent_start_date: isoDay(320), rent_end_date: isoDay(321), payment_method: "cod", customer: { name: "Eve", email: "eve@example.com>,<victim@example.com", phone: "1", shipping_address: "3 Road" } } });
    await sleep(1200);
    const onlineMail = mailbox.find((m) => m.rcpt === "olivia@example.com");
    check("an online order's confirmation includes the shop's payment instructions and the reference",
      !!onlineMail && onlineMail.text.includes("IBAN: PK00TEST0000000000") && /online/i.test(onlineMail.text), onlineMail?.text);
    check("a malformed customer address is never used as a recipient", !mailbox.some((m) => /victim/.test(m.rcpt || "") || /victim/.test(m.head || "")));

    const before = mailbox.length;
    await call("PATCH", "/api/admin/items/gown-01", { cookie, body: { status: "retired" } });
    await sleep(300);
    check("saving a listing without changing its status sends nothing", mailbox.length === before);
    await call("PATCH", "/api/admin/items/gown-01", { cookie, body: { status: "listed" } });

    // ---------------- Public site info ----------------
    r = await call("GET", "/api/site");
    check("the public site info gives the contact details and the late-fee rule, and nothing else",
      r.status === 200 && r.data?.contact?.email === "help@example.com" && r.data?.contact?.whatsapp === "+92 300 0000000" && r.data?.contact?.phone === null &&
      r.data?.late_fee?.mode === "daily_rent" && Object.keys(r.data).sort().join() === "contact,late_fee", JSON.stringify(r.data));
    check("customer emails end with the contact details", /Questions\? Write to help@example\.com or WhatsApp \+92 300 0000000/.test(mailbox.find((m) => m.rcpt === "mallory@example.com")?.text || ""));

    // ---------------- Cancelling, refunds, returns, late fees ----------------
    const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    const dayOffset = (n) => { const d = new Date(todayISO + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const lifeDb = new DatabaseSync(DB_PATH);
    lifeDb.exec("PRAGMA busy_timeout = 5000");
    const place = async (name, email, offset, extra = {}) => {
      await call("PATCH", "/api/admin/items/blouse-01", { cookie, body: { status: "listed" } }); // a returned piece is hidden until the owner relists it
      const rr = await call("POST", "/api/orders", { body: { item_id: "blouse-01", type: "rent", rent_start_date: isoDay(offset), rent_end_date: isoDay(offset + 1), payment_method: "cod", customer: { name, email, phone: "1", shipping_address: "9 Road" }, ...extra } });
      return rr.data?.order_id;
    };
    const mailTo = async (rcpt, re, ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = mailbox.find((m) => m.rcpt === rcpt && re.test(m.subject || ""));
        if (hit) return hit;
        await sleep(60);
      }
      return null;
    };
    const lookup = async (id, email) => (await call("GET", `/api/orders/${id}?email=${email}`)).data;
    const pastRental = async (id, endOffset, status) => {
      lifeDb.prepare("UPDATE orders SET rent_start_date = ?, rent_end_date = ? WHERE id = ?").run(dayOffset(endOffset - 1), dayOffset(endOffset), id);
      await call("PATCH", `/api/admin/orders/${id}/status`, { cookie, body: { status } });
    };

    r = await call("POST", "/api/orders", { body: { item_id: "blouse-01", type: "rent", rent_start_date: dayOffset(-3), rent_end_date: dayOffset(-2), payment_method: "cod", customer: { name: "Past", email: "past@example.com", phone: "1", shipping_address: "x" } } });
    check("a rental can't start in the past (422)", r.status === 422 && r.data?.error?.code === "invalid_date_range", JSON.stringify(r.data));

    // -- customer cancels an unpaid order --
    const c1 = await place("Cancel One", "cancel.one@example.com", 400);
    r = await call("POST", `/api/orders/${c1}/cancel`, { body: { email: "wrong@example.com" } });
    check("cancelling with the wrong email looks like an unknown order (404)", r.status === 404 && r.data?.error?.code === "order_not_found");
    check("a fresh order says it can be cancelled", (await lookup(c1, "cancel.one@example.com"))?.cancellable === true);
    r = await call("POST", `/api/orders/${c1}/cancel`, { body: { email: "Cancel.One@example.com" } });
    check("the customer cancels their own unpaid order (no refund needed)", r.status === 200 && r.data?.status === "cancelled" && r.data?.refund_status === null, JSON.stringify(r.data));
    let o = await lookup(c1, "cancel.one@example.com");
    check("tracking shows it cancelled by the customer and no longer cancellable", o?.status === "cancelled" && o?.cancelled_by === "customer" && o?.cancellable === false && o?.refund_status === null, JSON.stringify(o));
    r = await call("POST", `/api/orders/${c1}/cancel`, { body: { email: "cancel.one@example.com" } });
    check("cancelling twice is refused (409 already_cancelled)", r.status === 409 && r.data?.error?.code === "already_cancelled");
    check("the cancelled dates are free again", (await place("Cancel Again", "cancel.again@example.com", 400)) !== undefined);
    check("the owner and the customer are both emailed about the cancellation",
      !!(await mailTo("owner-inbox@example.com", /Customer cancelled order/)) && !!(await mailTo("cancel.one@example.com", /is cancelled/)));

    // -- cancelling a paid order creates a refund to send --
    const c2 = await place("Paid Cancel", "paid.cancel@example.com", 410, { payment_method: "online" });
    await call("PATCH", `/api/admin/orders/${c2}/payment`, { cookie, body: { payment_status: "paid" } });
    r = await call("POST", `/api/orders/${c2}/cancel`, { body: { email: "paid.cancel@example.com" } });
    check("cancelling a paid order flags a refund as due", r.status === 200 && r.data?.refund_status === "due" && r.data?.refund_amount === 2800, JSON.stringify(r.data));
    o = await lookup(c2, "paid.cancel@example.com");
    check("the customer's tracking page shows the refund due", o?.refund_status === "due" && o?.refund_amount === 2800);
    check("the customer's cancellation email mentions the refund", /refund Rs 2,800/.test((await mailTo("paid.cancel@example.com", /is cancelled/))?.text || ""));
    check("the owner's cancellation email says REFUND DUE", /REFUND DUE Rs 2,800/.test((await mailTo("owner-inbox@example.com", new RegExp("Customer cancelled order " + c2)))?.text || ""));
    r = await call("PATCH", `/api/admin/orders/${c2}/refund`, { body: { refund_status: "sent" } });
    check("marking a refund without a session is refused (401)", r.status === 401);
    r = await call("PATCH", `/api/admin/orders/${c2}/refund`, { cookie, body: { refund_status: "maybe" } });
    check("an invalid refund status is refused (422)", r.status === 422);
    r = await call("PATCH", `/api/admin/orders/${c1}/refund`, { cookie, body: { refund_status: "sent" } });
    check("an order with nothing to refund can't be marked refunded (409)", r.status === 409 && r.data?.error?.code === "no_refund");
    r = await call("PATCH", `/api/admin/orders/${c2}/refund`, { cookie, body: { refund_status: "sent" } });
    check("the shop marks the refund sent", r.status === 200 && r.data?.refund_status === "sent");
    check("...the customer is told, and tracking shows it sent", !!(await mailTo("paid.cancel@example.com", /Refund sent/)) && (await lookup(c2, "paid.cancel@example.com"))?.refund_status === "sent");

    // -- the shop cancelling a paid order does the same --
    const c3 = await place("Shop Cancel", "shop.cancel@example.com", 420);
    await call("PATCH", `/api/admin/orders/${c3}/payment`, { cookie, body: { payment_status: "paid" } });
    r = await call("PATCH", `/api/admin/orders/${c3}/status`, { cookie, body: { status: "cancelled", note: "Out of stock" } });
    o = await lookup(c3, "shop.cancel@example.com");
    check("the shop cancelling a paid order also flags the refund", r.status === 200 && o?.status === "cancelled" && o?.cancelled_by === "admin" && o?.refund_status === "due", JSON.stringify(o));
    r = await call("GET", "/api/admin/dashboard", { cookie });
    check("the dashboard counts refunds due", r.data?.stats?.refunds_due >= 1, JSON.stringify(r.data?.stats));

    // -- no cancelling once it ships --
    const c4 = await place("Shipped One", "shipped.one@example.com", 430);
    await call("POST", `/api/admin/orders/${c4}/shipments`, { cookie, body: { direction: "outbound", courier: "TCS" } });
    r = await call("POST", `/api/orders/${c4}/cancel`, { body: { email: "shipped.one@example.com" } });
    check("once a shipment is booked the customer can't cancel (409 not_cancellable)", r.status === 409 && r.data?.error?.code === "not_cancellable" && (await lookup(c4, "shipped.one@example.com"))?.cancellable === false, JSON.stringify(r.data));
    const c5 = await place("Shipped Two", "shipped.two@example.com", 440);
    await call("PATCH", `/api/admin/orders/${c5}/status`, { cookie, body: { status: "shipped" } });
    r = await call("POST", `/api/orders/${c5}/cancel`, { body: { email: "shipped.two@example.com" } });
    check("a shipped order can't be cancelled either", r.status === 409 && r.data?.error?.code === "not_cancellable");

    // -- an overdue rental --
    const late1 = await place("Late Larry", "late.larry@example.com", 450);
    await pastRental(late1, -3, "delivered");
    r = await call("GET", `/api/admin/orders/${late1}`, { cookie });
    check("admin sees a rental 3 days past its end date as overdue, with the fee so far (3 x Rs 1,400)", r.data?.overdue === true && r.data?.days_late === 3 && r.data?.late_fee_accruing === 4200, JSON.stringify([r.data?.overdue, r.data?.days_late, r.data?.late_fee_accruing]));
    r = await call("GET", "/api/admin/orders", { cookie });
    check("...and the orders list carries the same flags", (r.data?.orders || []).find((x) => x.id === late1)?.days_late === 3);
    o = await lookup(late1, "late.larry@example.com");
    check("the customer's tracking page shows it overdue with the fee so far", o?.overdue === true && o?.days_late === 3 && o?.late_fee_accruing === 4200 && o?.cancellable === false, JSON.stringify(o));
    r = await call("GET", "/api/admin/dashboard", { cookie });
    check("the dashboard counts overdue returns", r.data?.stats?.overdue_returns >= 1);
    r = await call("POST", "/api/admin/reminders/run", { body: {} });
    check("running the late check without a session is refused (401)", r.status === 401);
    r = await call("POST", "/api/admin/reminders/run", { cookie, body: {} });
    check("the late check sends one reminder for the overdue rental", r.status === 200 && r.data?.late_reminders_sent >= 1, JSON.stringify(r.data));
    const lateMail = await mailTo("late.larry@example.com", /overdue/);
    check("the customer's reminder says how late it is and the fee so far", !!lateMail && /3 days late/.test(lateMail.text) && /Rs 4,200/.test(lateMail.text), lateMail?.text);
    check("the owner is told it's overdue", !!(await mailTo("owner-inbox@example.com", new RegExp(late1 + " is overdue"))));
    const lateCountBefore = mailbox.filter((m) => m.rcpt === "late.larry@example.com").length;
    r = await call("POST", "/api/admin/reminders/run", { cookie, body: {} });
    await sleep(300);
    check("running it again the same day sends nothing new", mailbox.filter((m) => m.rcpt === "late.larry@example.com").length === lateCountBefore);
    lifeDb.prepare("UPDATE orders SET late_reminder_on = ? WHERE id = ?").run(dayOffset(-4), late1);
    await call("POST", "/api/admin/reminders/run", { cookie, body: {} });
    await sleep(500);
    check("...but it nudges again once three days have passed", mailbox.filter((m) => m.rcpt === "late.larry@example.com" && /overdue/.test(m.subject || "")).length === 2);

    // -- recording the return --
    r = await call("POST", `/api/admin/orders/${late1}/return`, { cookie, body: { condition_note: "Small stain on the hem", damage_fee: -5 } });
    check("a negative damage charge is refused (422)", r.status === 422 && r.data?.error?.code === "invalid_amount");
    r = await call("POST", `/api/admin/orders/${late1}/return`, { body: { damage_fee: 0 } });
    check("recording a return without a session is refused (401)", r.status === 401);
    r = await call("POST", `/api/admin/orders/${late1}/return`, { cookie, body: { condition_note: "Small stain on the hem", damage_fee: 500 } });
    check("recording the return sets returned, 3 days late = Rs 4,200 late fee, plus the Rs 500 damage charge",
      r.status === 200 && r.data?.status === "returned" && r.data?.late_fee === 4200 && r.data?.damage_fee === 500 && r.data?.charges_status === "due" && r.data?.return_note === "Small stain on the hem", JSON.stringify(r.data));
    r = await call("GET", `/api/admin/orders/${late1}`, { cookie });
    check("the order history records the condition, the days late and the charges", /Small stain/.test(r.data?.history?.at(-1)?.note || "") && /3 days late, late fee Rs 4,200/.test(r.data?.history?.at(-1)?.note || "") && /Damage charge Rs 500/.test(r.data?.history?.at(-1)?.note || ""), JSON.stringify(r.data?.history?.at(-1)));
    check("...and it's no longer shown as overdue", r.data?.overdue === false && r.data?.charges_total === 4700);
    check("the customer is emailed the charges", /Total to pay: Rs 4,700/.test((await mailTo("late.larry@example.com", /received your rental back/))?.text || ""));
    o = await lookup(late1, "late.larry@example.com");
    check("the customer's tracking page shows the charges and that they're due", o?.charges?.total === 4700 && o?.charges?.status === "due" && o?.overdue === false, JSON.stringify(o?.charges));
    check("the condition note stays private (not in the customer's lookup)", !JSON.stringify(o).includes("stain"));
    r = await call("POST", `/api/admin/orders/${late1}/return`, { cookie, body: {} });
    check("a rental that's already returned can't be returned again (409)", r.status === 409 && r.data?.error?.code === "not_returnable");
    r = await call("POST", `/api/admin/orders/${c3}/return`, { cookie, body: {} });
    check("a cancelled order can't be returned (409)", r.status === 409);

    r = await call("PATCH", `/api/admin/orders/${late1}/charges`, { cookie, body: { late_fee: 1400 } });
    check("the shop can reduce the late fee (a goodwill discount)", r.status === 200 && r.data?.late_fee === 1400 && r.data?.charges_status === "due");
    r = await call("PATCH", `/api/admin/orders/${late1}/charges`, { cookie, body: { charges_status: "collected" } });
    check("...and mark the charges collected", r.status === 200 && r.data?.charges_status === "collected");
    r = await call("PATCH", `/api/admin/orders/${late1}/charges`, { cookie, body: { late_fee: 0, damage_fee: 0 } });
    check("setting both amounts to zero clears the charges", r.status === 200 && r.data?.charges_status === null);
    r = await call("PATCH", `/api/admin/orders/${late1}/charges`, { cookie, body: { late_fee: "lots" } });
    check("a non-numeric charge is refused (422)", r.status === 422);
    r = await call("PATCH", `/api/admin/orders/${c5}/charges`, { cookie, body: { late_fee: 10 } });
    check("charges can't be set on an order that hasn't been returned (409)", r.status === 409 && r.data?.error?.code === "not_returned");

    // -- due today / returned via the plain status control / waived fee --
    const dueToday = await place("Due Today", "due.today@example.com", 460);
    await pastRental(dueToday, 0, "delivered");
    r = await call("POST", "/api/admin/reminders/run", { cookie, body: {} });
    check("a rental due back today gets a due-today reminder, once", r.data?.due_reminders_sent >= 1 && !!(await mailTo("due.today@example.com", /due back today/)));
    const dueCount = mailbox.filter((m) => m.rcpt === "due.today@example.com").length;
    await call("POST", "/api/admin/reminders/run", { cookie, body: {} });
    await sleep(300);
    check("...and not again", mailbox.filter((m) => m.rcpt === "due.today@example.com").length === dueCount);
    r = await call("GET", `/api/admin/orders/${dueToday}`, { cookie });
    check("a rental due today is not overdue yet", r.data?.overdue === false && r.data?.days_late === 0);

    const late2 = await place("Late Two", "late.two@example.com", 470);
    await pastRental(late2, -2, "return_due");
    r = await call("PATCH", `/api/admin/orders/${late2}/status`, { cookie, body: { status: "returned" } });
    check("setting a late rental to 'returned' with the status control also fixes its late fee", r.status === 200 && r.data?.late_fee === 2800 && r.data?.charges_status === "due", JSON.stringify(r.data));
    const late3 = await place("Late Three", "late.three@example.com", 480);
    await pastRental(late3, -2, "delivered");
    r = await call("POST", `/api/admin/orders/${late3}/return`, { cookie, body: { waive_late_fee: true } });
    check("the late fee can be waived when recording the return", r.status === 200 && r.data?.late_fee === 0 && r.data?.charges_status === null, JSON.stringify(r.data));
    const onTime = await place("On Time", "on.time@example.com", 490);
    await pastRental(onTime, 3, "delivered");
    r = await call("POST", `/api/admin/orders/${onTime}/return`, { cookie, body: {} });
    check("an on-time return has no charges", r.status === 200 && r.data?.late_fee === 0 && r.data?.charges_status === null);
    // -- provider payouts appear by themselves --
    const payoutsFor = async (orderId) => ((await call("GET", "/api/admin/payouts", { cookie })).data?.payouts || []).filter((x) => x.order_id === orderId);
    const po1 = await place("Payout One", "payout.one@example.com", 500);
    await call("PATCH", `/api/admin/orders/${po1}/status`, { cookie, body: { status: "delivered" } });
    await call("PATCH", `/api/admin/orders/${po1}/status`, { cookie, body: { status: "returned" } });
    check("a returned rental that hasn't been paid for creates no payout yet", (await payoutsFor(po1)).length === 0);
    r = await call("PATCH", `/api/admin/orders/${po1}/payment`, { cookie, body: { payment_status: "paid" } });
    let pays = await payoutsFor(po1);
    check("...marking it paid creates the provider's payout: 50% of Rs 2,800, pending, with the provider and item named",
      pays.length === 1 && pays[0].amount === 1400 && pays[0].status === "pending" && !!pays[0].provider_name && pays[0].item_name === "Ivory Silk Blouse", JSON.stringify(pays));
    r = await call("PATCH", `/api/admin/orders/${po1}/status`, { cookie, body: { status: "completed" } });
    check("completing it afterwards doesn't create a second payout", (await payoutsFor(po1)).length === 1);
    r = await call("GET", `/api/admin/orders/${po1}`, { cookie });
    check("the order history notes the payout", r.data?.history?.some((h) => /payout of Rs 1,400 is now owed/.test(h.note || "")), JSON.stringify(r.data?.history));
    check("the owner is emailed that a payout is owed", /Rs 1,400/.test((await mailTo("owner-inbox@example.com", /Payout owed/))?.text || ""));
    r = await call("POST", `/api/admin/payouts/${pays[0]?.id}/mark-paid`, { cookie, body: {} });
    check("the payout can be marked paid like any other", r.status === 200 && r.data?.status === "paid");
    r = await call("PATCH", `/api/admin/orders/${po1}/payment`, { cookie, body: { payment_status: "unpaid" } });
    check("a payout that's already been paid is left alone if the payment is later unmarked", (await payoutsFor(po1)).length === 1);

    const po2 = await place("Payout Two", "payout.two@example.com", 510);
    await call("PATCH", `/api/admin/orders/${po2}/payment`, { cookie, body: { payment_status: "paid" } });
    await call("PATCH", `/api/admin/orders/${po2}/status`, { cookie, body: { status: "delivered" } });
    check("a paid rental still out with the customer has no payout yet", (await payoutsFor(po2)).length === 0);
    await call("POST", `/api/admin/orders/${po2}/return`, { cookie, body: { damage_fee: 900 } });
    pays = await payoutsFor(po2);
    check("recording the return creates it, and damage charges stay with the shop (still 50% of the order total)", pays.length === 1 && pays[0].amount === 1400, JSON.stringify(pays));
    await call("PATCH", `/api/admin/orders/${po2}/payment`, { cookie, body: { payment_status: "unpaid" } });
    check("un-marking the payment withdraws a payout that hasn't been paid yet", (await payoutsFor(po2)).length === 0);

    const po3 = await place("Payout Three", "payout.three@example.com", 520);
    await call("PATCH", `/api/admin/orders/${po3}/payment`, { cookie, body: { payment_status: "paid" } });
    await call("PATCH", `/api/admin/orders/${po3}/status`, { cookie, body: { status: "cancelled" } });
    r = await call("PATCH", `/api/admin/orders/${po3}/status`, { cookie, body: { status: "completed" } });
    check("a cancelled order can't be reopened (409)", r.status === 409 && r.data?.error?.code === "order_cancelled", JSON.stringify(r.data));
    check("a cancelled order never produces a payout", (await payoutsFor(po3)).length === 0);
    // -- the item's own status follows its orders --
    const freshItem = async (name) => {
      await call("POST", "/api/intake", { body: { item: { name, category: "Dresses", size: "M", condition: "Good" }, outcome: "either", contact: { name: "Prov", email: "prov.status@example.com", phone: "1" }, handoff: "dropoff" } });
      const found = ((await call("GET", "/api/admin/items", { cookie })).data?.items || []).find((i) => i.name === name);
      await call("PATCH", `/api/admin/items/${found.id}`, { cookie, body: { status: "listed", rent_price_per_day: 1000, buy_price: 8000 } });
      return found.id;
    };
    const itemStatus = async (id) => ((await call("GET", "/api/admin/items", { cookie })).data?.items || []).find((i) => i.id === id)?.status;
    const rentOf = async (itemId, name, email, offset) => {
      const rr = await call("POST", "/api/orders", { body: { item_id: itemId, type: "rent", rent_start_date: isoDay(offset), rent_end_date: isoDay(offset + 1), payment_method: "cod", customer: { name, email, phone: "1", shipping_address: "x" } } });
      return rr.data?.order_id;
    };

    const itA = await freshItem("Status Dress A");
    const oA = await rentOf(itA, "Status A", "status.a@example.com", 600);
    check("placing a rental doesn't change the item's status", (await itemStatus(itA)) === "listed");
    await call("POST", `/api/admin/orders/${oA}/shipments`, { cookie, body: { direction: "outbound", courier: "TCS" } });
    check("booking the outbound shipment marks the item in transit", (await itemStatus(itA)) === "in_transit");
    r = await call("GET", `/api/items/${itA}`);
    check("...and an in-transit piece is still in the shop (future dates stay bookable)", r.status === 200);
    await call("PATCH", `/api/admin/orders/${oA}/status`, { cookie, body: { status: "delivered" } });
    check("delivered: the item is rented", (await itemStatus(itA)) === "rented");
    await call("POST", `/api/admin/orders/${oA}/return`, { cookie, body: {} });
    check("recording the return marks the item returned (waiting to be inspected)", (await itemStatus(itA)) === "returned");
    r = await call("GET", `/api/items/${itA}`);
    check("...which takes it off the shop until it's relisted", r.status === 404);
    r = await call("GET", "/api/admin/dashboard", { cookie });
    check("the dashboard counts pieces waiting to be inspected", r.data?.stats?.items_to_inspect >= 1, JSON.stringify(r.data?.stats));
    await call("PATCH", `/api/admin/items/${itA}`, { cookie, body: { status: "listed" } });
    r = await call("GET", `/api/items/${itA}`);
    check("relisting puts it back in the shop", r.status === 200);

    const itB = await freshItem("Status Dress B");
    const b1 = await rentOf(itB, "Status B1", "status.b1@example.com", 610);
    const b2 = await rentOf(itB, "Status B2", "status.b2@example.com", 620);
    await call("PATCH", `/api/admin/orders/${b1}/status`, { cookie, body: { status: "delivered" } });
    await call("PATCH", `/api/admin/orders/${b2}/status`, { cookie, body: { status: "shipped" } });
    check("with one rental at the renter and another shipped, the item is rented", (await itemStatus(itB)) === "rented");
    await call("POST", `/api/admin/orders/${b1}/return`, { cookie, body: {} });
    check("a return doesn't mark the item returned while another rental of it is still out", (await itemStatus(itB)) === "rented");
    await call("PATCH", `/api/admin/orders/${b2}/status`, { cookie, body: { status: "delivered" } });
    await call("PATCH", `/api/admin/orders/${b2}/status`, { cookie, body: { status: "cancelled" } });
    check("calling off a rental that was already out marks the piece returned (needs a look)", (await itemStatus(itB)) === "returned");

    const itC = await freshItem("Status Dress C");
    r = await call("POST", "/api/orders", { body: { item_id: itC, type: "buy", payment_method: "cod", customer: { name: "Buyer C", email: "status.c@example.com", phone: "1", shipping_address: "x" } } });
    const cOrder = r.data?.order_id;
    check("placing a purchase leaves the status alone (the shop already hides bought pieces)", (await itemStatus(itC)) === "listed");
    await call("PATCH", `/api/admin/orders/${cOrder}/status`, { cookie, body: { status: "delivered" } });
    check("a delivered purchase makes the item sold", (await itemStatus(itC)) === "sold");
    await call("PATCH", `/api/admin/items/${itC}`, { cookie, body: { status: "retired" } });
    check("the owner's own status choices stick (retired stays retired through order changes)", (await itemStatus(itC)) === "retired" && (await call("PATCH", `/api/admin/orders/${cOrder}/status`, { cookie, body: { status: "completed" } })).status === 200 && (await itemStatus(itC)) === "retired");
    lifeDb.close();

    // ---------------- Session end + rate limiting ----------------
    r = await call("POST", "/api/admin/logout", { cookie });
    check("logout clears the cookie", r.status === 200 && /Max-Age=0/.test(r.res.headers.getSetCookie().join(";")));
    r = await call("GET", "/api/admin/dashboard", { cookie });
    check("old session no longer works (401)", r.status === 401);

    let limited = null;
    for (let i = 0; i < 15 && !limited; i++) {
      const attempt = await call("POST", "/api/admin/login", { body: { email: "owner@example.com", password: `guess-${i}` } });
      if (attempt.status === 429) limited = attempt;
    }
    check("repeated login attempts get rate limited (429 + Retry-After)", !!limited && !!limited.res.headers.get("retry-after"));
  } finally {
    server.kill();
    smtp.close();
    for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(DB_PATH + suffix, { force: true });
  }

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});