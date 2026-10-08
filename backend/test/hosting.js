// backend/test/hosting.js
// ------------------------------------------------------------
// Checks the settings that matter when the site is hosted: the preview password,
// the visitor's real address behind a proxy, a clean production database, and the
// live-site headers and cookie. Starts its own throwaway servers, needs no
// dependencies:   node backend/test/hosting.js      (or: npm run test:hosting)
// ------------------------------------------------------------
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("PASS  " + name); }
  else { failed++; console.log("FAIL  " + name + (detail ? "   -> " + detail : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextPort = 4200 + Math.floor(Math.random() * 300);

async function start(env) {
  const port = nextPort++;
  const db = path.join(os.tmpdir(), `wearshare-hosting-${process.pid}-${port}.sqlite`);
  const clean = { ...process.env };
  for (const k of ["NODE_ENV", "SITE_PASSWORD", "TRUST_PROXY_HOPS", "SEED_DEMO", "ADMIN_EMAIL", "ADMIN_PASSWORD", "NOINDEX", "BACKUP_DIR"]) delete clean[k];
  let log = "";
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    env: { ...clean, PORT: String(port), DATABASE_PATH: db, BACKUP_EVERY: "off", ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  return { base, log: () => log, stop: () => { child.kill(); for (const f of [db, db + "-wal", db + "-shm"]) try { fs.unlinkSync(f); } catch {} } };
}
const basic = (pw) => "Basic " + Buffer.from("preview:" + pw).toString("base64");

(async () => {
  // ---- preview password
  let s = await start({ SITE_PASSWORD: "let-me-in-please" });
  let r = await fetch(s.base + "/");
  check("with SITE_PASSWORD the shop asks for a password (401 + prompt)", r.status === 401 && /Basic/.test(r.headers.get("www-authenticate") || ""));
  r = await fetch(s.base + "/api/items");
  check("...and so does the API", r.status === 401);
  r = await fetch(s.base + "/admin/login.html");
  check("...and the admin pages", r.status === 401);
  r = await fetch(s.base + "/", { headers: { Authorization: basic("wrong-password") } });
  check("a wrong password is refused", r.status === 401);
  r = await fetch(s.base + "/", { headers: { Authorization: basic("let-me-in-please") } });
  check("the right password lets the shop load", r.status === 200 && (await r.text()).includes("<html"));
  r = await fetch(s.base + "/api/items", { headers: { Authorization: basic("let-me-in-please") } });
  check("...and the API", r.status === 200 && Array.isArray((await r.json()).items));
  r = await fetch(s.base + "/api/health");
  check("/api/health stays open for the host's health check", r.status === 200);
  r = await fetch(s.base + "/robots.txt");
  check("the preview asks search engines to stay away (robots.txt answers without a password)", r.status === 401 || /Disallow: \//.test(await r.text()));
  r = await fetch(s.base + "/", { headers: { Authorization: basic("let-me-in-please") } });
  check("...and every response carries a noindex header", /noindex/.test(r.headers.get("x-robots-tag") || ""));
  s.stop();

  // ---- visitor address behind a proxy
  s = await start({ TRUST_PROXY_HOPS: "1" });
  const login = (ip, extra = {}) => fetch(s.base + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, ...extra }, body: JSON.stringify({ email: "nobody@example.com", password: "wrong-wrong" }) });
  let codes = [];
  for (let i = 0; i < 11; i++) codes.push((await login("203.0.113.5")).status);
  check("behind a proxy, one visitor is rate-limited after 10 wrong logins", codes.slice(0, 10).every((c) => c === 401) && codes[10] === 429, codes.join());
  r = await login("203.0.113.99");
  check("...but a different visitor is not (they don't share one limit)", r.status === 401);
  codes = [];
  for (let i = 0; i < 11; i++) codes.push((await login(`198.51.100.${i}, 203.0.113.5`)).status);
  check("a visitor can't dodge the limit by inventing extra addresses at the front of X-Forwarded-For", codes[10] === 429 || codes.every((c) => c === 429), codes.join());
  s.stop();

  s = await start({});
  codes = [];
  for (let i = 0; i < 11; i++) codes.push((await login(`198.51.100.${i}`)).status);
  check("without TRUST_PROXY_HOPS the header is ignored (spoofing it does not help)", codes[10] === 429, codes.join());
  s.stop();

  // ---- a clean production database
  s = await start({ NODE_ENV: "production", ADMIN_EMAIL: "boss@wearshare.test", ADMIN_PASSWORD: "a-long-secret-123" });
  r = await fetch(s.base + "/api/items");
  check("in production the shop starts empty (no demo items)", r.status === 200 && (await r.json()).items.length === 0);
  r = await fetch(s.base + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "changeme123" }) });
  check("...and the demo admin login does not exist", r.status === 401);
  r = await fetch(s.base + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" }, body: JSON.stringify({ email: "boss@wearshare.test", password: "a-long-secret-123" }) });
  const cookie = r.headers.getSetCookie()[0] || "";
  check("...your own ADMIN_EMAIL / ADMIN_PASSWORD sign in", r.status === 200);
  check("...with a Secure, HttpOnly, SameSite=Strict session cookie", /Secure/.test(cookie) && /HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie), cookie);
  check("live-site headers are set, with HSTS when the visitor came in over HTTPS",
    r.headers.get("x-frame-options") === "DENY" && r.headers.get("x-content-type-options") === "nosniff" && !!r.headers.get("strict-transport-security"));
  r = await fetch(s.base + "/api/admin/client-ip", { headers: { Cookie: cookie.split(";")[0] } });
  const who = await r.json();
  check("the admin-only /api/admin/client-ip shows what the server believes", r.status === 200 && "seen_as" in who && "x_forwarded_for" in who, JSON.stringify(who));
  r = await fetch(s.base + "/api/admin/client-ip");
  check("...and needs a sign-in", r.status === 401);
  s.stop();

  s = await start({ NODE_ENV: "production" });
  check("production with no admin settings says loudly that nobody can sign in", /no admin account/i.test(s.log()), s.log());
  s.stop();

  s = await start({ NODE_ENV: "production", SEED_DEMO: "on" });
  r = await fetch(s.base + "/api/items");
  check("SEED_DEMO=on brings the demo data back, even in production (for the client preview)", (await r.json()).items.length > 0);
  s.stop();

  s = await start({ SEED_DEMO: "off", ADMIN_EMAIL: "boss@wearshare.test", ADMIN_PASSWORD: "a-long-secret-123" });
  r = await fetch(s.base + "/api/items");
  check("SEED_DEMO=off gives an empty shop on your own computer too", (await r.json()).items.length === 0);
  s.stop();

  console.log(`\n${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
})();