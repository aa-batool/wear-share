// backend/test/browser-checkout.js
// ------------------------------------------------------------
// Drives the real pages in a headless browser through the checkout ->
// payment flow: choosing cash on delivery or online, the confirmation,
// order tracking, the admin's "payment received" button, and what happens
// when the world changes while a shopper is on the payment page.
//
// This is NOT part of `npm test` because it needs Playwright, which the
// project otherwise doesn't depend on. To run it:
//   npm i --no-save playwright && npx playwright install chromium
//   node backend/test/browser-checkout.js
// or, if Playwright is installed somewhere else:
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node backend/test/browser-checkout.js
// It boots its own server on a spare port with a throwaway database.
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
  } catch {
    /* try the next one */
  }
}
if (!chromium) {
  console.error("Playwright isn't installed. See the instructions at the top of this file.");
  process.exit(2);
}

const PORT = 3600 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `wearshare-browser-${process.pid}.sqlite`);
const SHOTS = process.env.SHOTS_DIR || null; // set to a folder to save screenshots
const PAY_INFO = "Bank: Test Bank\\nAccount title: WearShare\\nIBAN: PK00TEST0000000000";

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
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const squash = (t) => t.replace(/\s+/g, " ").trim();
const text = async (p, sel) => squash(await p.textContent(sel));

// ---- talking to the API directly (setup, and checking what the server really holds) ----
let cookie = "";
const call = async (method, urlPath, body, admin) => {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(admin ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null), res };
};
const adminLogin = async () => {
  const r = await call("POST", "/api/admin/login", { email: "owner@example.com", password: "changeme123" });
  cookie = r.res.headers.getSetCookie()[0].split(";")[0];
};
const orderCount = async () => (await call("GET", "/api/admin/orders", null, true)).data.orders.length;
const findOrder = async (id) => (await call("GET", `/api/admin/orders/${id}`, null, true)).data;

// A fresh, public, rentable-and-buyable item, so each scenario has a piece nobody else has touched.
async function newItem(name, rent = 1000, buy = 8000) {
  await call("POST", "/api/intake", {
    item: { name, category: "Dresses", size: "M", condition: "Good" },
    outcome: "either",
    contact: { name: "Provider", email: "provider@example.com", phone: "1" },
    handoff: "dropoff",
  });
  const items = (await call("GET", "/api/admin/items", null, true)).data.items;
  const item = items.find((i) => i.name === name);
  const r = await call("PATCH", `/api/admin/items/${item.id}`, { rent_price_per_day: rent, buy_price: buy, status: "listed" }, true);
  if (r.status !== 200) throw new Error("couldn't publish test item: " + JSON.stringify(r.data));
  return item.id;
}

// ---- driving the item page's checkout form ----
async function fillDetails(p, who) {
  await p.fill("#co-name", who.name);
  await p.fill("#co-email", who.email);
  await p.fill("#co-phone", "+92 300 5551234");
  await p.fill("#co-address", "12 Test Road, Karachi");
}
async function startRental(p, itemId, who) {
  await p.goto(`${BASE}/item.html?id=${itemId}`);
  await p.waitForSelector("#cal-container .cal-grid");
  await p.click('[data-cal-nav="1"]');
  await p.locator(".cal-cell.clickable").nth(2).click();
  await p.locator(".cal-cell.clickable").nth(4).click();
  const range = await text(p, "#date-range");
  await p.click("#cta");
  await fillDetails(p, who);
  await p.click("#checkout-submit");
  await p.waitForURL(/payment\.html/);
  await p.waitForSelector("#pay-form");
  return range;
}
async function startPurchase(p, itemId, who, { acknowledge = false } = {}) {
  await p.goto(`${BASE}/item.html?id=${itemId}`);
  await p.waitForSelector(".mode-tabs");
  await p.click('[data-mode="buy"]');
  await p.click("#cta");
  await fillDetails(p, who);
  if (acknowledge) await p.check("#co-ack");
  await p.click("#checkout-submit");
  await p.waitForURL(/payment\.html/);
  await p.waitForSelector("#pay-form");
}
const chooseMethod = (p, method) => p.click(`label.pay-option:has(input[value="${method}"])`);

(async () => {
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, ONLINE_PAYMENT_INSTRUCTIONS: PAY_INFO, CONTACT_EMAIL: "help@example.com", CONTACT_WHATSAPP: "+92 300 0000000" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await adminLogin();

  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  p.on("pageerror", (e) => pageErrors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) pageErrors.push("console: " + m.text());
  });

  const shopper = { name: "Browser Shopper", email: "browser.shopper@example.com" };

  await step("opening the payment page with nothing in progress says there's nothing to pay for", async () => {
    await p.goto(BASE + "/payment.html?item=gown-01");
    await p.waitForSelector(".empty-state");
    expect((await text(p, ".empty-state")).includes("nothing to pay for"), await text(p, ".empty-state"));
  });

  // ------------------------------------------------ rental, cash on delivery
  const rentItem = await newItem("Browser Rent Dress", 1000, 8000);
  let rentRange;
  const before = await orderCount();

  await step("rent: the checkout button reads 'Continue to payment' and leads to the payment page without creating an order", async () => {
    await p.goto(`${BASE}/item.html?id=${rentItem}`);
    await p.waitForSelector("#cal-container .cal-grid");
    await p.click('[data-cal-nav="1"]');
    await p.locator(".cal-cell.clickable").nth(2).click();
    await p.locator(".cal-cell.clickable").nth(4).click();
    await p.click("#cta");
    expect((await text(p, "#checkout-submit")) === "Continue to payment", "button: " + (await text(p, "#checkout-submit")));
    await fillDetails(p, shopper);
    await p.click("#checkout-submit");
    await p.waitForURL(/payment\.html\?item=/);
    await p.waitForSelector("#pay-form");
    expect((await orderCount()) === before, "an order was created before payment was chosen");
  });

  await step("the payment page summarises the order in rupees and offers both methods", async () => {
    const t = await text(p, ".pay-layout");
    expect(t.includes("How would you like to pay?"), t.slice(0, 200));
    expect(t.includes("Browser Rent Dress") && t.includes("Rental") && t.includes("Browser Shopper") && t.includes("12 Test Road"), "summary: " + t.slice(0, 400));
    expect(t.includes("Cash on delivery") && t.includes("Pay online"), "both methods should be offered");
    expect(t.includes("Rs 3,000"), "3 days x Rs 1,000 = Rs 3,000 expected: " + t.slice(0, 500));
    expect(!t.includes("$"), "dollar sign on payment page");
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "payment.png"), fullPage: true });
  });

  await step("placing the order without choosing a method is refused and creates nothing", async () => {
    await p.click("#pay-submit");
    await p.waitForSelector("#err-method.show");
    expect((await orderCount()) === before, "order created without a method");
  });

  let codRef;
  await step("choosing cash on delivery places the order; the confirmation tells them to pay the courier", async () => {
    await chooseMethod(p, "cod");
    await p.click("#pay-submit");
    await p.waitForSelector(".pay-done .ref");
    codRef = (await p.textContent(".pay-done .ref")).trim();
    const t = await text(p, ".pay-done");
    expect(/Order placed, Browser/.test(t) && t.includes("Cash on delivery") && t.includes("Rs 3,000") && t.includes("to the courier"), t.slice(0, 400));
    const order = await findOrder(codRef);
    expect(order.payment_method === "cod" && order.payment_status === "unpaid" && order.price_total === 3000, JSON.stringify(order));
    expect((await orderCount()) === before + 1, "exactly one order expected");
  });

  await step("the finished order is gone from storage: reloading the payment page doesn't order again", async () => {
    await p.goto(`${BASE}/payment.html?item=${rentItem}`);
    await p.waitForSelector(".empty-state");
    expect((await orderCount()) === before + 1, "a reload must not create another order");
  });

  // ------------------------------------------------ editing details from the payment page
  await step("'Edit details' returns to the item page with the same dates and details filled in", async () => {
    const item2 = await newItem("Browser Edit Dress", 1500, 9000);
    const range = await startRental(p, item2, { name: "Edit Person", email: "edit.person@example.com" });
    await p.click(".checkout-back");
    await p.waitForURL(/item\.html/);
    await p.waitForSelector("#checkout-form");
    expect((await p.inputValue("#co-name")) === "Edit Person" && (await p.inputValue("#co-email")) === "edit.person@example.com", "details not restored");
    expect((await text(p, ".checkout-summary")).includes(range.split(" (")[0].split(" → ")[0]), "dates not restored: " + (await text(p, ".checkout-summary")));
    expect((await orderCount()) === before + 1, "editing must not create an order");
  });

  // ------------------------------------------------ purchase, online
  const buyItem = await newItem("Browser Buy Coat", 1200, 8500);
  let onlineRef;
  await step("buy + pay online: confirmation shows the amount, the order reference and the shop's account details", async () => {
    await startPurchase(p, buyItem, shopper);
    expect((await text(p, ".pay-layout")).includes("Purchase") && (await text(p, ".pay-layout")).includes("Rs 8,500"), "summary should show a purchase of Rs 8,500");
    await chooseMethod(p, "online");
    await p.click("#pay-submit");
    await p.waitForSelector(".pay-done .ref");
    onlineRef = (await p.textContent(".pay-done .ref")).trim();
    const t = await text(p, ".pay-done");
    expect(t.includes("Pay online") && t.includes("Rs 8,500") && t.includes("Bank: Test Bank") && t.includes("IBAN: PK00TEST0000000000"), t.slice(0, 500));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "confirmation-online.png"), fullPage: true });
    const order = await findOrder(onlineRef);
    expect(order.payment_method === "online" && order.payment_status === "unpaid", JSON.stringify(order));
  });

  await step("the buyer's tracking page shows 'waiting for your payment' with the account details", async () => {
    await p.goto(`${BASE}/track-order.html?ref=${onlineRef}`);
    await p.fill("#track-email", shopper.email);
    await p.click('#track-form button[type="submit"]');
    await p.waitForSelector(".track-result");
    const t = await text(p, ".track-result");
    expect(t.includes("Rs 8,500") && t.includes("Online — waiting for your payment") && t.includes("Bank: Test Bank"), t);
  });

  await step("admin: orders list shows 'not paid' chips, and 'Mark payment received' flips the order to paid", async () => {
    const admin = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
    const a = await admin.newPage();
    a.on("pageerror", (e) => pageErrors.push("[admin] " + e.message));
    await a.goto(BASE + "/admin/login.html");
    await a.fill("#email", "owner@example.com");
    await a.fill("#password", "changeme123");
    await a.click('#login-form button[type="submit"]');
    await a.waitForURL(/dashboard/);
    await a.goto(BASE + "/admin/orders.html");
    await a.waitForSelector(".order-row:not(.head)");
    const row = a.locator(".order-row:not(.head)", { hasText: "Browser Buy Coat" });
    expect(squash(await row.textContent()).includes("Online · not paid"), "chip: " + squash(await row.textContent()));
    await row.locator("[data-detail]").click();
    await a.waitForSelector(".order-detail-panel.open .spec-row");
    const detail = await text(a, ".order-detail-panel.open");
    expect(detail.includes("Payment methodOnline payment") && detail.includes("PaymentNot received yet"), detail.slice(0, 400));
    await a.click("[data-payment-toggle]");
    await a.waitForSelector("#page-message.success");
    expect(squash(await a.locator(".order-row:not(.head)", { hasText: "Browser Buy Coat" }).textContent()).includes("Online · paid"), "chip should now say paid");
    expect((await findOrder(onlineRef)).payment_status === "paid", "server should say paid");
    if (SHOTS) await a.screenshot({ path: path.join(SHOTS, "admin-orders.png"), fullPage: true });
    await admin.close();
  });

  await step("...and the buyer's tracking page now says paid and no longer shows account details", async () => {
    await p.goto(`${BASE}/track-order.html?ref=${onlineRef}`);
    await p.fill("#track-email", shopper.email);
    await p.click('#track-form button[type="submit"]');
    await p.waitForSelector(".track-result");
    const t = await text(p, ".track-result");
    expect(t.includes("Online payment — paid") && !t.includes("Bank: Test Bank"), t);
  });

  // ------------------------------------------------ purchase of a piece that's out on rental
  await step("buying a piece that's out on rental: delay notice at checkout and on the payment page, delivery line in the confirmation", async () => {
    await p.goto(`${BASE}/item.html?id=gown-01`);
    await p.waitForSelector(".mode-tabs");
    await p.click('[data-mode="buy"]');
    await p.click("#cta");
    await fillDetails(p, { name: "Delayed Buyer", email: "delayed.buyer@example.com" });
    await p.check("#co-ack");
    await p.click("#checkout-submit");
    await p.waitForURL(/payment\.html/);
    await p.waitForSelector("#delivery-notice");
    expect(await p.isChecked("#pay-ack"), "the agreement given at checkout should carry over");
    await chooseMethod(p, "cod");
    await p.click("#pay-submit");
    await p.waitForSelector(".pay-done .ref");
    expect((await text(p, ".pay-done")).includes("Delivery:"), await text(p, ".pay-done"));
  });

  // ------------------------------------------------ the world changing under the shopper
  await step("race: the dates get taken while on the payment page -> clear message, button disabled, nothing ordered", async () => {
    const item = await newItem("Browser Race Dress", 1000, 8000);
    await startRental(p, item, { name: "Slow Shopper", email: "slow@example.com" });
    const draft = await p.evaluate(() => JSON.parse(sessionStorage.getItem("wearshare.checkoutDraft")));
    const n = await orderCount();
    const other = await call("POST", "/api/orders", {
      item_id: item, type: "rent", payment_method: "cod", rent_start_date: draft.rent_start_date, rent_end_date: draft.rent_end_date,
      customer: { name: "Quick", email: "quick@example.com", phone: "1", shipping_address: "x" },
    });
    expect(other.status === 201, "setup booking failed: " + JSON.stringify(other.data));
    await chooseMethod(p, "cod");
    await p.click("#pay-submit");
    await p.waitForSelector("#dates-taken");
    expect(await p.isDisabled("#pay-submit"), "button should be disabled");
    expect((await text(p, "#pay-error")).includes("Someone else just booked"), await text(p, "#pay-error"));
    expect((await orderCount()) === n + 1, "only the other shopper's order should exist");
  });

  await step("race: the piece is bought while on the payment page -> 'Just missed it', nothing ordered", async () => {
    const item = await newItem("Browser Sold Dress", 1000, 8000);
    await startPurchase(p, item, { name: "Late Buyer", email: "late@example.com" });
    const n = await orderCount();
    const other = await call("POST", "/api/orders", {
      item_id: item, type: "buy", payment_method: "cod",
      customer: { name: "Early", email: "early@example.com", phone: "1", shipping_address: "x" },
    });
    expect(other.status === 201, "setup purchase failed");
    await chooseMethod(p, "online");
    await p.click("#pay-submit");
    await p.waitForSelector(".pay-done h2");
    expect((await text(p, ".pay-done")).includes("Just missed it"), await text(p, ".pay-done"));
    expect((await orderCount()) === n + 1, "only the other buyer's order should exist");
  });

  await step("race: a rental is booked ahead of a purchase while on the payment page -> notice appears, method kept, then it can be placed", async () => {
    const item = await newItem("Browser Delay Dress", 1000, 8000);
    await startPurchase(p, item, { name: "Unaware Buyer", email: "unaware@example.com" });
    const start = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 43 * 86400000).toISOString().slice(0, 10);
    const rent = await call("POST", "/api/orders", {
      item_id: item, type: "rent", payment_method: "cod", rent_start_date: start, rent_end_date: end,
      customer: { name: "Renter", email: "renter@example.com", phone: "1", shipping_address: "x" },
    });
    expect(rent.status === 201, "setup rental failed");
    await chooseMethod(p, "online");
    await p.click("#pay-submit");
    await p.waitForSelector("#pay-ack");
    expect(!(await p.isChecked("#pay-ack")), "must not be pre-agreed: they never saw the notice");
    expect(await p.isChecked('input[name="method"][value="online"]'), "the chosen method should be kept");
    expect((await text(p, "#pay-error")).includes("just booked for rental"), await text(p, "#pay-error"));
    await p.click("#pay-submit"); // without agreeing
    await p.waitForSelector("#err-pay-ack.show");
    await p.check("#pay-ack");
    await p.click("#pay-submit");
    await p.waitForSelector(".pay-done .ref");
    const t = await text(p, ".pay-done");
    expect(t.includes("Delivery:") && t.includes("Pay online"), t.slice(0, 400));
  });

  await step("every shopper page's footer has the shop's contact details and a Policies link", async () => {
    for (const page of ["index.html", "track-order.html", "intake.html"]) {
      await p.goto(`${BASE}/${page}`);
      await p.waitForSelector(".footer-contact");
      const t = await text(p, ".site-footer");
      expect(t.includes("help@example.com") && t.includes("+92 300 0000000") && t.includes("Policies"), page + ": " + t);
    }
    expect((await p.getAttribute('.footer-contact a[href^="https://wa.me/"]', "href")) === "https://wa.me/923000000000", "whatsapp link");
  });
  await step("the Policies page covers the rules and shows the live late-fee rule and contact details", async () => {
    await p.goto(BASE + "/policies.html");
    await p.waitForSelector(".policy");
    await p.waitForFunction(() => document.getElementById("policy-contact").innerText.includes("help@example.com"));
    const t = await text(p, ".policy");
    for (const word of ["Renting", "Buying", "Cancelling and refunds", "Late returns", "Damage", "Your privacy", "cash on delivery", "one more day's rent"]) {
      expect(t.includes(word), "missing: " + word);
    }
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "policies.png"), fullPage: true });
  });
  await step("the payment page tells a renter the late-fee rule and links to the policies", async () => {
    const items = (await call("GET", "/api/items")).data.items;
    const id = items.find((i) => i.name === "Browser Rent Dress").id;
    await startRental(p, id, { name: "Terms Check", email: "terms@example.com" });
    const t = await text(p, "#pay-terms");
    expect(t.includes("Late returns cost one more day's rent") && t.includes("cancel") && (await p.locator('#pay-terms a[href="policies.html"]').count()) === 1, t);
  });

  await step("the payment pages never show a dollar amount", async () => {
    const items = (await call("GET", "/api/items")).data.items;
    const id = items.find((i) => i.name === "Browser Rent Dress").id;
    await startRental(p, id, { name: "Dollar Check", email: "dollar@example.com" });
    expect(!/\$\s?\d/.test(await p.evaluate(() => document.body.innerText)), "dollar amount found");
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