// backend/routes/admin-auth.js
// ------------------------------------------------------------
// Admin login + session handling (API spec Section 3.1).
//
// Sessions are kept in memory (a plain Map) — fine for a single
// server process at this stage. If the backend ever runs as
// multiple processes/instances, this needs to move to the
// database or a shared store (e.g. Redis) instead, since each
// process would otherwise have its own disconnected session list.
//
// Sessions expire after 24 hours of inactivity (security notes
// document, Section 4.1) — every authenticated request slides
// the expiry forward rather than using one fixed login-time limit.
// ------------------------------------------------------------

const crypto = require("node:crypto");

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// token -> { adminId, email, expiresAt }
const sessions = new Map();

// Passwords are stored as "scrypt$<salt>$<hash>": salted and deliberately slow, so a
// stolen database can't be cracked the way the old plain SHA-256 hashes could.
// Hashes in the old format (64 hex characters) still work and are upgraded the
// next time their owner logs in.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (stored.startsWith("scrypt$")) {
    const [, salt, hash] = stored.split("$");
    if (!salt || !hash) return false;
    return eq(crypto.scryptSync(password, salt, 64).toString("hex"), hash);
  }
  return eq(crypto.createHash("sha256").update(password).digest("hex"), stored); // legacy
}

function login(db, body) {
  if (!body || !body.email || !body.password) {
    return { status: 400, error: { code: "invalid_body", message: "email and password are required." } };
  }

  const admin = db.prepare("SELECT * FROM admin_users WHERE lower(email) = lower(?)").get(String(body.email).trim());
  const valid = admin && verifyPassword(String(body.password), admin.password_hash);

  if (!valid) {
    // Deliberately generic — don't reveal whether the email exists.
    return { status: 401, error: { code: "invalid_credentials", message: "Incorrect email or password." } };
  }

  if (!admin.password_hash.startsWith("scrypt$")) {
    db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(hashPassword(String(body.password)), admin.id);
  }

  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { adminId: admin.id, email: admin.email, expiresAt: Date.now() + SESSION_TTL_MS });

  return { status: 200, body: { session_token: token } };
}

// Returns the session record if the token is valid and unexpired,
// sliding its expiry forward; otherwise returns null. Expired
// sessions are cleaned up lazily here rather than with a timer.
function verifySession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function logout(token) {
  sessions.delete(token);
}

module.exports = { login, verifySession, logout, hashPassword, verifyPassword };