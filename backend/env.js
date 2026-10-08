// backend/env.js
// ------------------------------------------------------------
// A tiny .env loader so we don't need the "dotenv" npm package
// just for this. Reads KEY=VALUE lines from .env at the project
// root into process.env, skipping blank lines and comments.
// Does nothing (silently) if .env doesn't exist yet — see
// .env.example for what to copy it from.
// ------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

// KEY=VALUE lines -> { KEY: "VALUE" }. Blank lines and #-comment lines are skipped;
// ADMIN_PASSWORD="my password" and 'my password' both work (the quotes aren't part of the value).
function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(envPath, "utf8")))) {
    if (!(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadEnv, parseEnv };