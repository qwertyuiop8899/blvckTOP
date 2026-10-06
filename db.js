import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const COVERS_DIR = path.join(DATA_DIR, "covers");
const ASSETS_DIR = path.join(DATA_DIR, "assets");

// Ensure directories exist
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(COVERS_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, "blvcktop.db");
const db = new Database(dbPath);

// Enable WAL mode for high performance
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS tmdb_mappings (
    raw_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    tmdb_id TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (raw_id, media_type)
  );

  CREATE TABLE IF NOT EXISTS tmdb_images (
    media_type TEXT NOT NULL,
    tmdb_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (media_type, tmdb_id)
  );

  CREATE TABLE IF NOT EXISTS assets (
    url TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS covers (
    cover_key TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS json_cache (
    url TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_json_cache_exp ON json_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_covers_upd ON covers(updated_at);
`);

// Prepared statements for fast execution
const stmts = {
  getMapping: db.prepare("SELECT tmdb_id FROM tmdb_mappings WHERE raw_id = ? AND media_type = ?"),
  setMapping: db.prepare(`
    INSERT INTO tmdb_mappings (raw_id, media_type, tmdb_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(raw_id, media_type) DO UPDATE SET tmdb_id = excluded.tmdb_id, updated_at = excluded.updated_at
  `),

  getTmdbImages: db.prepare("SELECT data_json, updated_at FROM tmdb_images WHERE media_type = ? AND tmdb_id = ?"),
  setTmdbImages: db.prepare(`
    INSERT INTO tmdb_images (media_type, tmdb_id, data_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(media_type, tmdb_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `),

  getAsset: db.prepare("SELECT filename FROM assets WHERE url = ?"),
  setAsset: db.prepare(`
    INSERT INTO assets (url, filename, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET filename = excluded.filename, updated_at = excluded.updated_at
  `),

  getCover: db.prepare("SELECT filename, updated_at FROM covers WHERE cover_key = ?"),
  setCover: db.prepare(`
    INSERT INTO covers (cover_key, filename, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cover_key) DO UPDATE SET filename = excluded.filename, updated_at = excluded.updated_at
  `),
  deleteCover: db.prepare("DELETE FROM covers WHERE cover_key = ?"),

  getJsonCache: db.prepare("SELECT data_json, expires_at FROM json_cache WHERE url = ?"),
  setJsonCache: db.prepare(`
    INSERT INTO json_cache (url, data_json, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET data_json = excluded.data_json, expires_at = excluded.expires_at
  `),
  cleanJsonCache: db.prepare("DELETE FROM json_cache WHERE expires_at <= ?"),

  countCovers: db.prepare("SELECT COUNT(*) as count FROM covers"),
  countAssets: db.prepare("SELECT COUNT(*) as count FROM assets"),
  countMappings: db.prepare("SELECT COUNT(*) as count FROM tmdb_mappings")
};

function hashString(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/* ---------------- TMDB Mappings ---------------- */

export function getTmdbMapping(rawId, mediaType) {
  const row = stmts.getMapping.get(String(rawId), String(mediaType));
  return row ? row.tmdb_id : undefined; // returns undefined if not in DB, null if stored as null
}

export function setTmdbMapping(rawId, mediaType, tmdbId) {
  stmts.setMapping.run(String(rawId), String(mediaType), tmdbId ? String(tmdbId) : null, Date.now());
}

/* ---------------- TMDB Images Data ---------------- */

export function getTmdbImagesDb(mediaType, tmdbId, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const row = stmts.getTmdbImages.get(String(mediaType), String(tmdbId));
  if (!row) return null;
  if (Date.now() - row.updated_at > maxAgeMs) return null;

  try {
    return JSON.parse(row.data_json);
  } catch {
    return null;
  }
}

export function setTmdbImagesDb(mediaType, tmdbId, data) {
  stmts.setTmdbImages.run(
    String(mediaType),
    String(tmdbId),
    JSON.stringify(data),
    Date.now()
  );
}

/* ---------------- Image Assets (Downloaded backdrops / logos) ---------------- */

export function getAssetBuffer(url) {
  const row = stmts.getAsset.get(url);
  if (!row) return null;

  const filePath = path.join(ASSETS_DIR, row.filename);
  if (!fs.existsSync(filePath)) return null;

  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

export function saveAssetBuffer(url, buffer) {
  const ext = url.toLowerCase().includes(".png") ? ".png" : ".jpg";
  const filename = `${hashString(url)}${ext}`;
  const filePath = path.join(ASSETS_DIR, filename);

  fs.writeFileSync(filePath, buffer);
  stmts.setAsset.run(url, filename, Date.now());
  return filePath;
}

/* ---------------- Generated Covers (Final PNGs) ---------------- */

export function getCoverFilePath(coverKey) {
  const row = stmts.getCover.get(coverKey);
  if (!row) return null;

  const filePath = path.join(COVERS_DIR, row.filename);
  if (!fs.existsSync(filePath)) {
    stmts.deleteCover.run(coverKey);
    return null;
  }

  return filePath;
}

export function getCoverBuffer(coverKey) {
  const filePath = getCoverFilePath(coverKey);
  if (!filePath) return null;

  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

export function saveCoverBuffer(coverKey, buffer) {
  const ext = buffer[0] === 0xff && buffer[1] === 0xd8 ? ".jpg" : ".png";
  const filename = `${hashString(coverKey)}${ext}`;
  const filePath = path.join(COVERS_DIR, filename);

  fs.writeFileSync(filePath, buffer);
  stmts.setCover.run(coverKey, filename, Date.now());
  return filePath;
}

/* ---------------- JSON Cache (Manifests and Catalog sources) ---------------- */

export function getCachedJson(url) {
  const row = stmts.getJsonCache.get(url);
  if (!row) return null;
  if (row.expires_at <= Date.now()) return null;

  try {
    return JSON.parse(row.data_json);
  } catch {
    return null;
  }
}

export function setCachedJson(url, data, ttlMs = 5 * 60 * 1000) {
  stmts.setJsonCache.run(
    url,
    JSON.stringify(data),
    Date.now() + ttlMs
  );
}

export function cleanExpiredCache() {
  stmts.cleanJsonCache.run(Date.now());
}

export function pruneStaleCovers(activeTuples, currentVersion = "v7.5.0", freshVersion = "fresh-v5") {
  if (!activeTuples || !(activeTuples instanceof Set)) {
    return 0;
  }

  const allRows = db.prepare("SELECT cover_key, filename FROM covers").all();
  let deletedCount = 0;
  const toDelete = [];

  for (const row of allRows) {
    const parts = row.cover_key.split("|");
    if (parts.length < 6) {
      toDelete.push(row);
      continue;
    }

    const [version, rank, type, _shape, tmdbId, catalogId] = parts;

    // 1. Purge older versions
    if (version !== currentVersion || Number(rank) > 10 || parts[12] === "banner"
      || (parts[6] === "full" && parts[12] !== freshVersion)) {
      toDelete.push(row);
      continue;
    }

    // 2. Purge items that are no longer at this rank in this catalog
    const normType = type === "series" || type === "tv" ? "tv" : "movie";
    const tupleKey1 = `${catalogId}|${type}|${rank}|${tmdbId}`;
    const tupleKey2 = `${catalogId}|${normType}|${rank}|${tmdbId}`;

    if (!activeTuples.has(tupleKey1) && !activeTuples.has(tupleKey2)) {
      toDelete.push(row);
    }
  }

  if (toDelete.length > 0) {
    const deleteStmt = db.prepare("DELETE FROM covers WHERE cover_key = ?");
    const deleteTransaction = db.transaction((rows) => {
      for (const r of rows) {
        deleteStmt.run(r.cover_key);
      }
    });

    try {
      deleteTransaction(toDelete);
    } catch (err) {
      console.warn(`[Cleanup] Errore DB transaction eliminazione covers:`, err.message);
    }

    for (const row of toDelete) {
      try {
        const filePath = path.join(COVERS_DIR, row.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        deletedCount++;
      } catch (fileErr) {
        console.warn(`[Cleanup] Errore rimozione file cover ${row.filename}:`, fileErr.message);
      }
    }
  }

  // Also clean unreferenced/old assets (> 14 days old)
  try {
    const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
    const staleAssets = db.prepare("SELECT url, filename FROM assets WHERE updated_at < ?").all(fourteenDaysAgo);
    if (staleAssets.length > 0) {
      const delAsset = db.prepare("DELETE FROM assets WHERE url = ?");
      for (const a of staleAssets) {
        delAsset.run(a.url);
        try {
          const aPath = path.join(ASSETS_DIR, a.filename);
          if (fs.existsSync(aPath)) fs.unlinkSync(aPath);
        } catch {}
      }
    }
  } catch (assetErr) {
    console.warn(`[Cleanup] Errore pulizia asset obsoleti:`, assetErr.message);
  }

  return deletedCount;
}

export function getDbStats() {
  const coversCount = stmts.countCovers.get()?.count || 0;
  const assetsCount = stmts.countAssets.get()?.count || 0;
  const mappingsCount = stmts.countMappings.get()?.count || 0;
  return {
    covers: coversCount,
    assets: assetsCount,
    mappings: mappingsCount,
    dataDir: DATA_DIR
  };
}

export { DATA_DIR, COVERS_DIR, ASSETS_DIR };

