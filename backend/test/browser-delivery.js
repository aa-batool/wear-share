// backend/test/browser-delivery.js
// ------------------------------------------------------------
// Real-browser run of the delivery charge: it shows on the payment page,
// the confirmation, the tracking page and in admin, and is free over the
// limit. Needs Playwright, so it isn't part of `npm test`:
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node backend/test/browser-delivery.js
// Boots its own server (DELIVERY_FEE=300, FREE_DELIVERY_OVER=5000) on a spare port.
// ------------------------------------------------------------
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

let chromium;
for (const id of [process.env.PLAYWRIGHT_PATH, "playwright"].filter(Boolean)) {
  try {
    ({ chromium } = require(id));
    break;
  } catch {}
}
if (!chromium) {
  console.error("Playwright isn't installed. See the instructions at the top of this file.");
  process.exit(2);
}
const PORT = 3800 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `wearshare-delivery-${process.pid}.sqlite`);
const results = [];
const pageErrors = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log("PASS  " + name);
  } catch (e) {
    results.push(false);
    console.log("FAIL  " + name + "\n      -> " + String(e.message).split("\n")[0]);
  }
}
const expect = (c, m) => {
  if (!c) throw new Error(m);
};
const squash = (t) => t.replace(/\s+/g, " ").trim();
const text = async (p, sel) => squash(await p.textContent(sel));
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, DELIVERY_FEE: "300", FREE_DELIVERY_OVER: "5000", RATE_LIMIT_SCALE: "20" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  p.on("pageerror", (e) => pageErrors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) pageErrors.push("console: " + m.text());
  });

  // Goes through the real checkout form for a rental of blouse-01 (Rs 1,400 a day).
  async function toPayment(days, name, email, offset) {
    await p.goto(`${BASE}/item.html?id=blouse-01`);
    await p.waitForSelector("#cal-container .cal-grid");
    await p.evaluate(() => sessionStorage.clear());
    // pick dates through the API-shaped draft the form would save, then open the payment page
    await p.evaluate(
      ([d]) =>
        sessionStorage.setItem(
          "wearshare.checkoutDraft",
          JSON.stringify({ item_id: "blouse-01", type: "rent", rent_start_date: d[0], rent_end_date: d[1], customer: { name: d[2], email: d[3], phone: "1", shipping_address: "9 Road" } })
        ),
      [[dayOffset(offset), dayOffset(offset + days - 1), name, email]]
    );
    await p.goto(`${BASE}/payment.html?item=blouse-01`);
    await p.waitForSelector("#pay-form");
  }

  await step("a short rental shows items, delivery & collection and a total that includes it", async () => {
    await toPayment(2, "Small Order", "small.order@example.com", 40);
    const t = await text(p, ".pay-summary");
    expect(t.includes("Rs 2,800") && t.includes("Delivery & collection") && t.includes("Rs 300") && t.includes("Total") && t.includes("Rs 3,100"), t);
    expect((await text(p, "#pay-submit")).includes("Rs 3,100"), await text(p, "#pay-submit"));
  });
  let smallId;
  await step("placing it charges the total, and the confirmation says to pay it all", async () => {
    await p.check('input[name="method"][value="cod"]');
    await p.click("#pay-submit");
    await p.waitForSelector(".pay-done .ref");
    const t = await text(p, ".pay-done");
    expect(t.includes("Rs 3,100"), t);
    smallId = await text(p, ".pay-done .ref");
  });
  await step("the tracking page breaks the total into items and delivery", async () => {
    await p.goto(`${BASE}/track-order.html?ref=${smallId}`);
    await p.fill("#track-email", "small.order@example.com");
    await p.click("#track-form button[type=submit]");
    await p.waitForSelector(".track-result");
    const t = await text(p, ".track-result");
    expect(/ItemsRs 2,800/.test(t) && /DeliveryRs 300/.test(t) && /TotalRs 3,100/.test(t), t);
  });
  await step("a longer rental (Rs 7,000) gets free delivery, shown as Free", async () => {
    await toPayment(5, "Big Order", "big.order@example.com", 60);
    const t = await text(p, ".pay-summary");
    expect(t.includes("Free") && t.includes("Rs 7,000") && !t.includes("Rs 7,300"), t);
    expect((await text(p, "#pay-submit")).includes("Rs 7,000"), await text(p, "#pay-submit"));
  });
  await step("admin sees the delivery fee in the order's details", async () => {
    const login = await fetch(BASE + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "changeme123" }) });
    const cookie = login.headers.getSetCookie()[0].split(";")[0];
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=")[1], url: BASE }]);
    const a = await ctx.newPage();
    await a.goto(BASE + "/admin/orders.html");
    await a.waitForSelector(".order-row:not(.head)");
    await a.locator(".order-row:not(.head)", { hasText: "Small Order" }).locator("[data-detail]").click();
    await a.waitForSelector(".order-detail-panel.open .spec-row");
    const t = await text(a, ".order-detail-panel.open");
    expect(t.includes("Delivery fee (in the total)") && t.includes("Rs 300") && t.includes("Rs 3,100"), t.slice(0, 400));
  });

  console.log("\nunexpected browser errors:", pageErrors.length ? "\n  " + pageErrors.join("\n  ") : "none");
  await browser.close();
  server.kill();
  for (const s of ["", "-wal", "-shm", "-journal"]) fs.rmSync(DB + s, { force: true });
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed || pageErrors.length ? 1 : 0);
})().catch((e) => {
  console.error("Browser test crashed:", e);
  process.exit(1);
});