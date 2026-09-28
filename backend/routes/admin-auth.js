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

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function login(db, body) {
  if (!body || !body.email || !body.password) {
    return { status: 400, error: { code: "invalid_body", message: "email and password are required." } };
  }

  const admin = db.prepare("SELECT * FROM admin_users WHERE email = ?").get(body.email);
  const valid = admin && admin.password_hash === hashPassword(body.password);

  if (!valid) {
    // Deliberately generic — don't reveal whether the email exists.
    return { status: 401, error: { code: "invalid_credentials", message: "Incorrect email or password." } };
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

module.exports = { login, verifySession, logout, hashPassword };