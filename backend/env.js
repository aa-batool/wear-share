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

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadEnv };