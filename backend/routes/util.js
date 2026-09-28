// backend/routes/util.js
// ------------------------------------------------------------
// Small helpers shared across route files. Kept intentionally
// tiny — this is not the place for business logic specific to
// one resource, just generic bits like ID generation.
// ------------------------------------------------------------

const crypto = require("node:crypto");

function randomId(prefix) {
  return `${prefix}-${crypto.randomInt(100000, 999999)}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

module.exports = { randomId, isValidEmail, isValidDate };