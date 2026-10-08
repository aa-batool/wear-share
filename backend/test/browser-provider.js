// backend/test/browser-provider.js
// ------------------------------------------------------------
// Real-browser run of the provider side: the private payout-details box on the
// intake form, and how it shows up (only) in admin Payouts. Needs Playwright:
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node backend/test/browser-provider.js
// Boots its own server on a spare port with provider emails off.
// ------------------------------------------------------------
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");

let chromium;
for (const id of [process.env.PLAYWRIGHT_PATH, "playwright"].filter(Boolean)) {
  try { ({ chromium } = require(id)); break; } catch {}
}
if (!chromium) { console.error("Playwright isn't installed. See the instructions at the top of this file."); process.exit(2); }
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `wearshare-provider-${process.pid}.sqlite`);
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
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, PROVIDER_EMAILS: "off", RATE_LIMIT_SCALE: "20" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + "/api/health")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  p.on("pageerror", (e) => pageErrors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/net::ERR_/.test(m.text())) pageErrors.push(m.text()); }); // external fonts can be blocked offline

  const login = await fetch(BASE + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "changeme123" }) });
  const cookie = login.headers.getSetCookie()[0].split(";")[0];
  const api = async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    return r.json().catch(() => ({}));
  };

  await step("the intake form has an optional, private payout box and submits with it", async () => {
    await p.goto(BASE + "/intake.html");
    expect((await p.locator("#payout-details").count()) === 1, "no payout box");
    expect(squash(await p.textContent("#payout-details + .hint")).includes("never shown"), "no privacy hint");
    await p.fill("#item-name", "Browser Payout Gown");
    await p.selectOption("#category", { index: 1 });
    await p.fill("#size", "M");
    await p.selectOption("#condition", { index: 1 });
    await p.fill("#contact-name", "Bea Provider");
    await p.fill("#contact-email", "bea@provider.example.com");
    await p.fill("#contact-phone", "0300 1234567");
    await p.fill("#address", "House 1, Street 2");
    await p.fill("#payout-details", "Meezan Bank 0099-887766 Bea Provider");
    await p.click("#submit-btn");
    await p.waitForFunction(() => /WS-\d+/.test(document.body.innerText), null, { timeout: 5000 });
  });

  await step("it works left empty, too", async () => {
    await p.goto(BASE + "/intake.html");
    await p.fill("#item-name", "No Payout Gown");
    await p.selectOption("#category", { index: 1 });
    await p.fill("#size", "L");
    await p.selectOption("#condition", { index: 1 });
    await p.fill("#contact-name", "Cy Provider");
    await p.fill("#contact-email", "cy@provider.example.com");
    await p.fill("#contact-phone", "0300 7654321");
    await p.fill("#address", "Flat 5");
    await p.click("#submit-btn");
    await p.waitForFunction(() => /WS-\d+/.test(document.body.innerText), null, { timeout: 5000 });
  });

  // run both pieces through to a payout
  const items = (await api("GET", "/api/admin/items")).items;
  const orders = {};
  for (const name of ["Browser Payout Gown", "No Payout Gown"]) {
    const it = items.find((i) => i.name === name);
    await api("PATCH", `/api/admin/items/${it.id}`, { status: "listed", rent_price_per_day: 1000, buy_price: 9000 });
    const o = await api("POST", "/api/orders", { item_id: it.id, type: "rent", rent_start_date: dayOffset(40), rent_end_date: dayOffset(41), payment_method: "cod", customer: { name: "Buyer", email: `b${Date.now()}@example.com`, phone: "1", shipping_address: "x" } });
    orders[name] = o.order_id;
    await api("PATCH", `/api/admin/orders/${o.order_id}/payment`, { payment_status: "paid" });
    await api("PATCH", `/api/admin/orders/${o.order_id}/status`, { status: "delivered" });
    await api("POST", `/api/admin/orders/${o.order_id}/return`, {});
  }

  await step("admin Payouts shows each provider's email and payout details (or says none yet)", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
    await ctx.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=")[1], url: BASE }]);
    const a = await ctx.newPage();
    a.on("pageerror", (e) => pageErrors.push(e.message));
    await a.goto(BASE + "/admin/payouts.html");
    await a.waitForSelector(".payout-row:not(.head)");
    const rowA = squash(await a.locator(".payout-row:not(.head)", { hasText: "Browser Payout Gown" }).textContent());
    const rowB = squash(await a.locator(".payout-row:not(.head)", { hasText: "No Payout Gown" }).textContent());
    expect(rowA.includes("bea@provider.example.com") && rowA.includes("Pay to: Meezan Bank 0099-887766 Bea Provider"), rowA);
    expect(rowB.includes("cy@provider.example.com") && rowB.includes("No payout details yet"), rowB);
  });

  await step("a shopper's pages never show payout details", async () => {
    await p.goto(BASE + "/index.html");
    await p.waitForTimeout(500);
    const html = await p.content();
    expect(!html.includes("Meezan") && !html.includes("provider.example.com"), "leaked");
  });

  await browser.close();
  server.kill();
  console.log("\nunexpected browser errors: " + (pageErrors.length ? pageErrors.join(" | ") : "none"));
  const ok = results.filter(Boolean).length;
  console.log(`${ok}/${results.length} browser checks passed`);
  process.exit(ok === results.length && pageErrors.length === 0 ? 0 : 1);
})();