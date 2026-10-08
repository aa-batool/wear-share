// backend/test/browser-lifecycle.js
// ------------------------------------------------------------
// Real-browser run of cancelling, refunds, overdue rentals, recording a
// return and collecting late fees: the customer's tracking page and the
// admin's Orders screen. Like browser-checkout.js it needs Playwright, so
// it isn't part of `npm test`:
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node backend/test/browser-lifecycle.js
// Boots its own server on a spare port with a throwaway database.
// ------------------------------------------------------------

const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

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

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `wearshare-lifecycle-${process.pid}.sqlite`);
const SHOTS = process.env.SHOTS_DIR || null;

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

let cookie = "";
const call = async (method, urlPath, body, admin) => {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(admin ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
const dayOffset = (n) => {
  const d = new Date(todayISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
let nextOffset = 100;
async function place(name, email, extra = {}) {
  await call("PATCH", "/api/admin/items/blouse-01", { status: "listed" }, true); // a returned piece is hidden until relisted
  const o = (nextOffset += 5);
  const r = await call("POST", "/api/orders", {
    item_id: "blouse-01", type: "rent", rent_start_date: dayOffset(o), rent_end_date: dayOffset(o + 1), payment_method: "cod",
    customer: { name, email, phone: "1", shipping_address: "9 Road, Karachi" }, ...extra,
  });
  if (r.status !== 201) throw new Error("setup order failed: " + JSON.stringify(r.data));
  return r.data.order_id;
}

(async () => {
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, RATE_LIMIT_SCALE: "20", ALLOW_RESERVED_EMAIL_DOMAINS: "1" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const login = await fetch(BASE + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "changeme123" }) });
  cookie = login.headers.getSetCookie()[0].split(";")[0];

  const browser = await chromium.launch();
  const watch = (page, tag) => {
    page.on("pageerror", (e) => pageErrors.push(`[${tag}] ` + e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource/.test(m.text())) pageErrors.push(`[${tag}] console: ` + m.text());
    });
  };
  const p = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  watch(p, "shop");
  const admin = await (await browser.newContext({ viewport: { width: 1300, height: 1100 } })).newPage();
  watch(admin, "admin");

  const track = async (id, email) => {
    await p.goto(`${BASE}/track-order.html?ref=${id}`);
    await p.fill("#track-email", email);
    await p.click("#track-form button[type=submit]");
    await p.waitForSelector(".track-result");
  };
  await admin.goto(BASE + "/admin/login.html");
  await admin.fill("#email", "owner@example.com");
  await admin.fill("#password", "changeme123");
  await admin.click('#login-form button[type="submit"]');
  await admin.waitForURL(/dashboard/);
  const adminRow = async (id, who) => {
    await admin.goto(BASE + "/admin/orders.html");
    await admin.waitForSelector(".order-row:not(.head)");
    return admin.locator(".order-row:not(.head)", { hasText: who });
  };

  // ------------------------------------------------ the customer cancels
  const mail1 = "cancel.me@example.com";
  const o1 = await place("Cancel Me", mail1);
  await step("a new order's tracking page offers 'Cancel this order'", async () => {
    await track(o1, mail1);
    expect((await p.locator("#cancel-ask").count()) === 1, "no cancel button");
  });
  await step("it asks first, and 'Keep my order' backs out without cancelling", async () => {
    await p.click("#cancel-ask");
    expect((await text(p, "#cancel-area")).includes("can't be undone"), await text(p, "#cancel-area"));
    await p.click("#cancel-no");
    expect((await p.locator("#cancel-ask").count()) === 1, "button not restored");
    expect((await call("GET", `/api/orders/${o1}?email=${mail1}`)).data.status === "pending", "was cancelled");
  });
  await step("confirming cancels it: status, 'Cancelled by You', no cancel button, notice shown", async () => {
    await p.click("#cancel-ask");
    await p.click("#cancel-yes");
    await p.waitForSelector(".track-notice");
    const t = await text(p, ".track-result");
    expect(/Cancelled/.test(t) && t.includes("Cancelled byYou"), t);
    expect((await p.locator("#cancel-area").count()) === 0, "cancel button still there");
    expect((await text(p, ".track-notice")).includes("cancelled"), "no notice");
  });

  // ------------------------------------------------ paid order -> refund
  const mail2 = "refund.me@example.com";
  const o2 = await place("Refund Me", mail2, { payment_method: "online" });
  await call("PATCH", `/api/admin/orders/${o2}/payment`, { payment_status: "paid" }, true);
  await step("cancelling a paid order shows the refund on the customer's page", async () => {
    await track(o2, mail2);
    await p.click("#cancel-ask");
    expect((await text(p, "#cancel-area")).includes("refund you"), await text(p, "#cancel-area"));
    await p.click("#cancel-yes");
    await p.waitForSelector(".track-notice");
    expect(/Refund.*will be sent back to you/.test(await text(p, ".track-result")), await text(p, ".track-result"));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "track-cancelled-refund.png") });
  });
  await step("admin: the dashboard flags the refund, the filter finds it, and 'Mark refund sent' clears the flag", async () => {
    await admin.goto(BASE + "/admin/dashboard.html");
    await admin.waitForSelector(".stat-tag");
    const tile = squash(await admin.locator(".stat-tag", { hasText: "Refunds due" }).textContent());
    expect(/Refunds due\s*1/.test(tile), tile);
    await admin.goto(BASE + "/admin/orders.html?show=refunds");
    await admin.waitForSelector(".order-row:not(.head)");
    expect((await admin.locator(".order-row:not(.head)").count()) === 1, "filter should list exactly the refund order");
    const row = admin.locator(".order-row:not(.head)", { hasText: "Refund Me" });
    expect(squash(await row.textContent()).includes("refund due"), "no chip");
    await row.locator("[data-detail]").click();
    await admin.waitForSelector("[data-refund-toggle]");
    if (SHOTS) await admin.screenshot({ path: path.join(SHOTS, "admin-refund-due.png") });
    await admin.click("[data-refund-toggle]");
    await admin.waitForFunction(() => document.querySelectorAll(".order-row:not(.head)").length === 0 || !document.body.innerText.includes("refund due"));
    expect((await call("GET", `/api/admin/orders/${o2}`, null, true)).data.refund_status === "sent", "not marked sent");
  });
  await step("the customer's page now says the refund was sent", async () => {
    await track(o2, mail2);
    expect(/sent back to you/.test(await text(p, ".track-result")) && !/will be sent/.test(await text(p, ".track-result")), await text(p, ".track-result"));
  });

  // ------------------------------------------------ shipped: can't cancel
  const mail3 = "shipped.out@example.com";
  const o3 = await place("Shipped Out", mail3);
  await call("POST", `/api/admin/orders/${o3}/shipments`, { direction: "outbound", courier: "TCS" }, true);
  await step("once shipped there is no cancel button", async () => {
    await track(o3, mail3);
    expect((await p.locator("#cancel-area").count()) === 0, "cancel offered after shipping");
  });

  // ------------------------------------------------ overdue rental
  const mail4 = "late.renter@example.com";
  const o4 = await place("Late Renter", mail4);
  const lifeDb = new DatabaseSync(DB);
  lifeDb.exec("PRAGMA busy_timeout = 5000");
  lifeDb.prepare("UPDATE orders SET rent_start_date = ?, rent_end_date = ? WHERE id = ?").run(dayOffset(-4), dayOffset(-3), o4);
  await call("PATCH", `/api/admin/orders/${o4}/status`, { status: "delivered" }, true);
  await step("the customer's page shows the overdue banner with the fee so far", async () => {
    await track(o4, mail4);
    const t = await text(p, ".late-banner");
    expect(t.includes("3 days overdue") && t.includes("Rs 4,200"), t);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "track-overdue.png") });
  });
  await step("admin: the list flags it '3 days late', the dashboard and filter agree", async () => {
    const row = await adminRow(o4, "Late Renter");
    expect(squash(await row.textContent()).includes("3 days late"), squash(await row.textContent()));
    await admin.goto(BASE + "/admin/dashboard.html");
    await admin.waitForSelector(".stat-tag");
    const tile = squash(await admin.locator(".stat-tag", { hasText: "Overdue returns" }).textContent());
    expect(Number(/Overdue returns\s*(\d+)/.exec(tile)?.[1]) >= 1, "tile: " + tile); // the demo data has a couple of its own
    await admin.goto(BASE + "/admin/orders.html?show=overdue");
    await admin.waitForSelector(".order-row:not(.head)");
    const rows = await admin.locator(".order-row:not(.head)").allTextContents();
    expect(rows.length >= 1 && rows.every((r) => /days? late/.test(r)) && rows.some((r) => r.includes("Late Renter")), "overdue filter: " + rows.map(squash).join(" | "));
  });
  await step("admin: 'Send due / late reminders now' reports what it sent", async () => {
    await admin.goto(BASE + "/admin/orders.html");
    await admin.waitForSelector(".order-row:not(.head)");
    await admin.click("#run-reminders");
    await admin.waitForSelector(".admin-message, [class*='message']");
    const msg = squash(await admin.evaluate(() => document.body.innerText));
    expect(/Sent 0 due-today and \d+ overdue reminders?/.test(msg), msg.slice(0, 300));
  });
  await step("admin: 'Record return' with a damage charge sets returned, the late fee and the charges chip", async () => {
    const row = await adminRow(o4, "Late Renter");
    await row.locator("[data-detail]").click();
    await admin.waitForSelector("[data-return-open]");
    expect((await text(admin, ".late-note")).includes("Rs 4,200"), await text(admin, ".late-note"));
    await admin.click("[data-return-open]");
    await admin.fill("[data-return-note]", "Small stain on the hem");
    await admin.fill("[data-return-damage]", "500");
    if (SHOTS) await admin.screenshot({ path: path.join(SHOTS, "admin-record-return.png") });
    await admin.click("[data-return-confirm]");
    await admin.waitForSelector("[data-charge-save]");
    const t = squash(await admin.locator(".order-row:not(.head)", { hasText: "Late Renter" }).textContent());
    expect(/Returned/.test(t) && t.includes("charges Rs 4,700 due") && !t.includes("days late"), t);
    expect((await admin.inputValue("[data-charge-late]")) === "4200" && (await admin.inputValue("[data-charge-damage]")) === "500", "amounts");
    expect((await text(admin, ".order-detail-panel.open")).includes("Small stain on the hem"), "condition note missing");
    if (SHOTS) await admin.screenshot({ path: path.join(SHOTS, "admin-charges.png") });
  });
  await step("the customer sees the charges (but not the shop's condition note)", async () => {
    await track(o4, mail4);
    const t = await text(p, ".track-result");
    expect(t.includes("Late fee") && t.includes("Rs 4,200") && t.includes("Damage charge") && t.includes("Rs 4,700") && t.includes("to be paid"), t);
    expect(!t.includes("stain") && (await p.locator(".late-banner").count()) === 0, "note leaked or banner stuck");
  });
  await step("admin: waiving the late fee and marking the rest collected clears the chip", async () => {
    await admin.fill("[data-charge-late]", "0");
    await admin.click("[data-charge-save]");
    await admin.waitForFunction(() => [...document.querySelectorAll(".order-row:not(.head)")].some((r) => r.innerText.includes("Late Renter") && r.innerText.includes("500")));
    expect(squash(await admin.locator(".order-row:not(.head)", { hasText: "Late Renter" }).textContent()).includes("charges Rs 500 due"), "after waiving");
    await admin.click("[data-charge-status]");
    await admin.waitForFunction(() => {
      const row = [...document.querySelectorAll(".order-row:not(.head)")].find((r) => r.innerText.includes("Late Renter"));
      return row && ![...row.querySelectorAll(".pay-chip")].some((c) => /charges/.test(c.innerText));
    });
    expect((await call("GET", `/api/admin/orders/${o4}`, null, true)).data.charges_status === "collected", "not collected");
    await track(o4, mail4);
    expect((await text(p, ".track-result")).includes("paid, thank you"), await text(p, ".track-result"));
  });

  await step("after a return the piece waits to be inspected: dashboard tile, Listings filter, and relisting puts it back", async () => {
    await admin.goto(BASE + "/admin/dashboard.html");
    await admin.waitForSelector(".stat-tag");
    const tile = squash(await admin.locator(".stat-tag", { hasText: "To inspect" }).textContent());
    expect(Number(/relist\s*(\d+)/.exec(tile)?.[1]) >= 1, "tile: " + tile);
    await admin.locator(".stat-tag", { hasText: "To inspect" }).click();
    await admin.waitForURL(/listings\.html\?status=returned/);
    await admin.waitForSelector(".ledger-row:not(.head)");
    const rows = await admin.locator(".ledger-row:not(.head)").allTextContents();
    expect(rows.some((r) => r.includes("Ivory Silk Blouse")), rows.map(squash).join(" | ").slice(0, 300));
    if (SHOTS) await admin.screenshot({ path: path.join(SHOTS, "admin-to-inspect.png") });
    await call("PATCH", "/api/admin/items/blouse-01", { status: "listed" }, true);
    expect((await call("GET", "/api/items/blouse-01")).status === 200, "relisted piece should be back in the shop");
  });

  console.log("\nunexpected browser errors:", pageErrors.length ? "\n  " + pageErrors.join("\n  ") : "none");
  lifeDb.close();
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