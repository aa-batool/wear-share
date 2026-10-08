// backend/test/browser-ship-backup.js
// ------------------------------------------------------------
// Real-browser run of the admin "Book a shipment" form, the dashboard
// backup buttons and the spreadsheet export buttons. Needs Playwright:
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node backend/test/browser-ship-backup.js
// Boots its own server on a spare port with a temporary database and backup folder.
// ------------------------------------------------------------
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

let chromium;
for (const id of [process.env.PLAYWRIGHT_PATH, "playwright"].filter(Boolean)) {
  try { ({ chromium } = require(id)); break; } catch {}
}
if (!chromium) { console.error("Playwright isn't installed. See the instructions at the top of this file."); process.exit(2); }
const PORT = 4000 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `wearshare-shipbk-${process.pid}.sqlite`);
const BK = path.join(os.tmpdir(), `wearshare-shipbk-dir-${process.pid}`);
const results = [];
const pageErrors = [];
async function step(name, fn) {
  try { await fn(); results.push(true); console.log("PASS  " + name); }
  catch (e) { results.push(false); console.log("FAIL  " + name + "\n      -> " + String(e.message).split("\n")[0]); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const squash = (t) => t.replace(/\s+/g, " ").trim();
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, BACKUP_DIR: BK, BACKUP_EVERY: "off", CUSTOMER_EMAILS: "off", RATE_LIMIT_SCALE: "20" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + "/api/health")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch();
  const login = await fetch(BASE + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "changeme123" }) });
  const cookie = login.headers.getSetCookie()[0].split(";")[0];
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1100 }, acceptDownloads: true });
  await ctx.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=")[1], url: BASE }]);
  const a = await ctx.newPage();
  a.on("pageerror", (e) => pageErrors.push(e.message));
  a.on("console", (m) => { if (m.type() === "error" && !/net::ERR_/.test(m.text())) pageErrors.push(m.text()); }); // external fonts can be blocked offline

  const o = await (await fetch(BASE + "/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_id: "blouse-01", type: "rent", rent_start_date: dayOffset(60), rent_end_date: dayOffset(61), payment_method: "cod", customer: { name: "Ship Browser", email: "ship.browser@example.com", phone: "1", shipping_address: "x" } }) })).json();

  await step("Book a shipment: needs both courier and tracking number", async () => {
    await a.goto(BASE + "/admin/orders.html");
    await a.waitForSelector(".order-row:not(.head)");
    await a.locator(".order-row:not(.head)", { hasText: "Ship Browser" }).locator("[data-detail]").click();
    await a.waitForSelector(".order-detail-panel.open [data-ship-open]");
    await a.click(".order-detail-panel.open [data-ship-open]");
    await a.fill(".order-detail-panel.open [data-ship-courier]", "TCS");
    await a.click(".order-detail-panel.open [data-ship-confirm]");
    const err = squash(await a.textContent(".order-detail-panel.open [data-ship-error]"));
    expect(err.includes("courier and the tracking number"), err);
  });
  await step("saving records the shipment, sets the order to Shipped and shows it in the details", async () => {
    await a.fill(".order-detail-panel.open [data-ship-tracking]", "TCS-445566");
    await a.click(".order-detail-panel.open [data-ship-confirm]");
    await a.waitForFunction(() => /TCS-445566/.test(document.body.innerText), null, { timeout: 5000 });
    const t = squash(await a.textContent(".order-detail-panel.open"));
    expect(t.includes("Outbound shipment") && t.includes("TCS") && t.includes("TCS-445566"), t.slice(0, 300));
    const ord = await (await fetch(`${BASE}/api/orders/${o.order_id}?email=ship.browser@example.com`)).json();
    expect(ord.status === "shipped" && ord.tracking?.tracking_number === "TCS-445566", JSON.stringify(ord).slice(0, 300));
  });
  await step("the customer's tracking page shows the courier and number", async () => {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/track-order.html?ref=${o.order_id}`);
    await p.fill("#track-email", "ship.browser@example.com");
    await p.click("#track-form button[type=submit]");
    await p.waitForSelector(".track-result");
    const t = squash(await p.textContent(".track-result"));
    expect(t.includes("TCS-445566") && !t.includes("Cancel this order"), t);
    await p.close();
  });
  await step("a cancelled order offers no shipment form", async () => {
    await fetch(`${BASE}/api/admin/orders/${o.order_id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ status: "cancelled" }) });
    await a.goto(BASE + "/admin/orders.html");
    await a.waitForSelector(".order-row:not(.head)");
    await a.locator(".order-row:not(.head)", { hasText: "Ship Browser" }).locator("[data-detail]").click();
    await a.waitForSelector(".order-detail-panel.open");
    expect((await a.locator(".order-detail-panel.open [data-ship-open]").count()) === 0, "form offered");
  });

  await step("dashboard: 'Save a copy on the server now' adds a file to the list", async () => {
    await a.goto(BASE + "/admin/dashboard.html");
    await a.waitForSelector("#backup-list li");
    expect(squash(await a.textContent("#backup-list")).includes("No copies saved"), squash(await a.textContent("#backup-list")));
    await a.click("#backup-now");
    await a.waitForFunction(() => /KB|MB/.test(document.getElementById("backup-list").innerText), null, { timeout: 5000 });
    expect(fs.readdirSync(BK).filter((f) => f.endsWith(".sqlite")).length === 1, "no file on disk");
  });
  await step("dashboard: 'Download a backup' saves a SQLite file", async () => {
    const [dl] = await Promise.all([a.waitForEvent("download"), a.click("#backup-download")]);
    expect(/^wearshare-backup-.*\.sqlite$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const f = await dl.path();
    expect(fs.readFileSync(f).subarray(0, 15).toString() === "SQLite format 3", "not sqlite");
  });

  for (const page of ["orders", "payouts", "listings"]) {
    await step(`${page} page: 'Export all to spreadsheet' downloads a CSV`, async () => {
      await a.goto(`${BASE}/admin/${page}.html`);
      await a.waitForSelector(".export-link");
      const [dl] = await Promise.all([a.waitForEvent("download"), a.click(".export-link")]);
      expect(new RegExp(`^wearshare-${page}-\\d{4}-\\d{2}-\\d{2}\\.csv$`).test(dl.suggestedFilename()), dl.suggestedFilename());
      const text = fs.readFileSync(await dl.path(), "utf8");
      expect(text.charCodeAt(0) === 0xfeff && text.split("\r\n").length > 2, text.slice(0, 120));
    });
  }

  await browser.close();
  server.kill();
  fs.rmSync(BK, { recursive: true, force: true });
  console.log("\nunexpected browser errors: " + (pageErrors.length ? pageErrors.join(" | ") : "none"));
  const ok = results.filter(Boolean).length;
  console.log(`${ok}/${results.length} browser checks passed`);
  process.exit(ok === results.length && pageErrors.length === 0 ? 0 : 1);
})();