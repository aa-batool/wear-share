// backend/db/admin-account.js
// ------------------------------------------------------------
// The admin login can be set in .env:
//   ADMIN_EMAIL=you@example.com
//   ADMIN_PASSWORD=a long password only you know
// On every start the server makes the admin account match them: it
// creates the account, or updates its email and password if they've
// changed. Remove the two lines and the account simply keeps whatever
// it had last. Without them, the demo login (owner@example.com /
// changeme123) from the starter data is what you get, so the server
// complains in its log until you change it.
// ------------------------------------------------------------

const { hashPassword, verifyPassword } = require("../routes/admin-auth");

const DEMO_EMAIL = "owner@example.com";
const DEMO_PASSWORD = "changeme123";
const MIN_PASSWORD = 10;

function syncAdminFromEnv(db, log = console) {
  const email = (process.env.ADMIN_EMAIL || "").trim();
  const password = process.env.ADMIN_PASSWORD || "";

  const noAdminYet = () => db.prepare("SELECT COUNT(*) AS n FROM admin_users").get().n === 0;
  const warnNoAdmin = () => {
    if (noAdminYet()) log.error("[admin] ERROR: there is no admin account, so nobody can sign in to the admin panel. Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) and restart.");
  };

  if (!email && !password) {
    warnNoAdmin();
    const demo = db.prepare("SELECT password_hash FROM admin_users WHERE lower(email) = ?").get(DEMO_EMAIL);
    if (demo && verifyPassword(DEMO_PASSWORD, demo.password_hash)) {
      log.warn(
        `[admin] WARNING: the admin login is still the demo one (${DEMO_EMAIL} / ${DEMO_PASSWORD}). Set ADMIN_EMAIL and ADMIN_PASSWORD in .env` +
          (process.env.NODE_ENV === "production" ? " BEFORE letting anyone else reach this site." : ".")
      );
    }
    return { action: "none" };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    log.error("[admin] ADMIN_EMAIL isn't a valid email address, so the admin login was left as it was.");
    warnNoAdmin();
    return { action: "rejected", reason: "email" };
  }
  if (password.length < MIN_PASSWORD) {
    log.error(`[admin] ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters, so the admin login was left as it was.`);
    warnNoAdmin();
    return { action: "rejected", reason: "short" };
  }
  if (password === DEMO_PASSWORD) {
    log.error("[admin] ADMIN_PASSWORD is the demo password. Choose your own, so the admin login was left as it was.");
    warnNoAdmin();
    return { action: "rejected", reason: "demo" };
  }

  const existing = db.prepare("SELECT id, email, password_hash FROM admin_users ORDER BY rowid LIMIT 1").get();
  if (!existing) {
    db.prepare("INSERT INTO admin_users (id, name, email, password_hash) VALUES (?, ?, ?, ?)").run("admin-owner", "Owner", email, hashPassword(password));
    log.log(`[admin] admin login created for ${email}.`);
    return { action: "created" };
  }
  const sameEmail = existing.email.toLowerCase() === email.toLowerCase();
  const samePassword = verifyPassword(password, existing.password_hash);
  if (sameEmail && samePassword) return { action: "unchanged" };

  db.prepare("UPDATE admin_users SET email = ?, password_hash = ? WHERE id = ?").run(email, samePassword ? existing.password_hash : hashPassword(password), existing.id);
  log.log(`[admin] admin login updated: ${email}.`);
  return { action: "updated" };
}

module.exports = { syncAdminFromEnv, DEMO_EMAIL, DEMO_PASSWORD };