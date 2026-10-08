// backend/routes/backup.js
// ------------------------------------------------------------
// Backups of the whole database (orders, items, providers, payouts and the
// photos, which live inside it). A backup is a consistent copy made by SQLite
// itself (VACUUM INTO), so it is safe to take while the site is running.
//
//   - GET  /api/admin/backup   downloads a fresh copy as a file
//   - GET  /api/admin/backups  lists the copies kept on the server
//   - POST /api/admin/backups  takes one now
//   - the server also takes one by itself about once a day (see server.js)
//
// A backup holds customers' and providers' personal details, so keep the
// files private. They are never served by the website.
// ------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const NAME = /^wearshare-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function keepCount() {
  const n = Number(process.env.BACKUP_KEEP);
  return Number.isInteger(n) && n >= 1 ? n : 14;
}

function copyTo(db, file) {
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

// Write a copy into `dir` and drop the oldest ones beyond BACKUP_KEEP.
function makeBackup(db, dir, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  let name = `wearshare-${stamp(now)}.sqlite`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) {
    // two backups in the same second: nudge the time forward
    name = `wearshare-${stamp(new Date(now.getTime() + n * 1000))}.sqlite`;
  }
  const file = path.join(dir, name);
  copyTo(db, file);
  prune(dir);
  return { name, size: fs.statSync(file).size };
}

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => NAME.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, created: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first
}

function prune(dir) {
  listBackups(dir)
    .slice(keepCount())
    .forEach((b) => {
      try { fs.unlinkSync(path.join(dir, b.name)); } catch {}
    });
}

// Take one only if the newest is older than `hours` (used by the daily timer).
function backupIfStale(db, dir, hours = 20) {
  const newest = listBackups(dir)[0];
  if (newest && Date.now() - new Date(newest.created).getTime() < hours * 3600 * 1000) return null;
  return makeBackup(db, dir);
}

// A one-off copy for the browser to download; the temp file is removed straight away.
function downloadCopy(db) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wearshare-dl-"));
  try {
    const file = path.join(tmp, "copy.sqlite");
    copyTo(db, file);
    return { filename: `wearshare-backup-${stamp()}.sqlite`, buffer: fs.readFileSync(file), contentType: "application/vnd.sqlite3" };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { makeBackup, listBackups, backupIfStale, downloadCopy, prune };