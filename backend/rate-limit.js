// backend/rate-limit.js
// ------------------------------------------------------------
// A tiny in-memory rate limiter (fixed window, per key). Used to
// slow down password guessing on the admin login and to keep the
// public forms from being spammed. In memory means it resets when
// the server restarts and isn't shared between multiple server
// processes — fine for a single small server, and something to
// revisit (Redis, or the hosting platform's own limiter) if the
// app is ever scaled out. See the security notes document.
// ------------------------------------------------------------

const buckets = new Map(); // key -> { count, resetAt }

function rateLimit(key, max, windowMs) {
  const now = Date.now();

  // Occasional cleanup so the map can't grow without bound.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
  }

  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  return {
    allowed: bucket.count <= max,
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

module.exports = { rateLimit };
