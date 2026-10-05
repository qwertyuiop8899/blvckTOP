import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setGlobalDispatcher, ProxyAgent } from "undici";

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  try {
    const dispatcher = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(dispatcher);
    console.log(`[Proxy] Attivato proxy globale: ${proxyUrl.replace(/:[^:@]+@/, ":***@")}`);
  } catch (err) {
    console.error(`[Proxy] Errore configurazione proxy:`, err.message);
  }
}

import {
  encryptConfig,
  decryptConfig,
  shortConfigId
} from "./config-token.js";

import {
  getTmdbImages,
  getTmdbDetails,
  chooseBackdrop,
  choosePoster,
  resolveTmdbId,
  DEFAULT_TMDB_KEY
} from "./tmdb.js";

import {
  getCachedJson,
  setCachedJson,
  getCoverFilePath,
  saveCoverBuffer,
  getDbStats
} from "./db.js";

import { createTopCover } from "./cover-generator.js";
import { initScheduler, computeCoverKey } from "./preload.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SOURCE_MANIFEST_URL = process.env.SOURCE_MANIFEST_URL;

if (!SOURCE_MANIFEST_URL) {
  throw new Error("SOURCE_MANIFEST_URL non configurato.");
}

if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 24) {
  throw new Error("APP_SECRET non configurato o troppo corto (minimo 24 caratteri).");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("trust proxy", true);
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

const pendingCovers = new Map();
const JSON_TTL = 15 * 60 * 1000; // 15 minuti cache per i JSON

function sourceBaseUrl() {
  return SOURCE_MANIFEST_URL.replace(/\/manifest\.json(?:\?.*)?$/i, "");
}

function publicBase(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.get("host")}`;
}

async function fetchJson(url, ttl = JSON_TTL) {
  const cached = getCachedJson(url);
  if (cached) return cached;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*"
    }
  });

  if (!response.ok) {
    throw new Error(`Sorgente HTTP ${response.status} (${response.statusText})`);
  }

  const text = await response.text();
  try {
    const data = JSON.parse(text);
    setCachedJson(url, data, ttl);
    return data;
  } catch {
    throw new Error(`La sorgente non ha restituito JSON valido: ${text.slice(0, 80)}`);
  }
}

function catalogKey(type, id) {
  return `${type}::${id}`;
}

function selectedCatalogSet(config) {
  return new Set(
    (config.catalogs || []).map(c => catalogKey(c.type, c.id))
  );
}

function normalizeShape(shape) {
  return shape === "poster" || shape === "portrait"
    ? "poster"
    : "landscape";
}

export function normalizeCanvasBackground(bg) {
  const s = String(bg || "").toLowerCase().trim();
  if (s === "transparent") {
    return "transparent";
  }
  if (s === "stremio" || s === "stremio-navy" || s === "rgb(26,23,62)" || s === "rgb(26, 23, 62)" || s === "#1a173e" || s === "1a173e") {
    return "stremio";
  }
  if (s === "black" || s === "nero") {
    return "black";
  }
  return "provider";
}

function getCatalogConfig(config, type, id) {
  return (config.catalogs || []).find(
    c => c.type === type && c.id === id
  ) || null;
}

export function catalogAccent(catalog = {}) {
  const key = `${catalog.id || ""} ${catalog.name || ""}`.toLowerCase();

  if (key.includes("netflix")) return "#E50914";
  if (key.includes("prime") || key.includes("amazon")) return "#00A8E1";
  if (key.includes("disney")) return "#2D7DFF";
  if (key.includes("apple")) return "#D8DFEA";
  if (key.includes("now") || key.includes("sky")) return "#00CFFF";
  if (key.includes("paramount")) return "#0064FF";
  if (key.includes("raiplay") || key.includes("rai")) return "#1C6DFF";
  if (key.includes("rakuten")) return "#BF0000";
  if (key.includes("chili")) return "#FF5A1F";
  if (key.includes("max") || key.includes("hbo")) return "#7D57FF";
  if (key.includes("infinity") || key.includes("mediaset")) return "#00A3E0";
  if (key.includes("timvision") || key.includes("tim")) return "#003399";
  if (key.includes("discovery")) return "#003399";

  return "#8C75FF";
}

async function buildCoverUrl(
  req,
  token,
  meta,
  rank,
  type,
  catalog
) {
  const shape = normalizeShape(catalog.shape);
  const canvasBackground = normalizeCanvasBackground(catalog.canvasBackground);
  const showMeta = catalog.showMeta !== false && catalog.showMeta !== "false";
  const showLogo = catalog.showLogo !== false && catalog.showLogo !== "false";
  const genre = showMeta ? (Array.isArray(meta?.genres) && meta.genres.length > 0 ? meta.genres[0] : (meta?.genre || "")) : "";
  const rating = showMeta ? (meta?.imdbRating || meta?.rating || "") : "";

  try {
    const tmdbId = await resolveTmdbId(
      type,
      meta.id || meta.tmdbId,
      DEFAULT_TMDB_KEY
    );

    if (tmdbId) {
      const qs = new URLSearchParams({
        rank: String(rank),
        type: type === "series" ? "tv" : type,
        tmdbId,
        shape,
        catalogId: catalog.id || "",
        canvasBackground,
        showMeta: String(showMeta),
        showLogo: String(showLogo),
        genre: genre || "",
        rating: rating || "",
        v: "7.5.0"
      });

      return `${publicBase(req)}/c/${token}/top-cover?${qs}`;
    }
  } catch (err) {
    console.warn(`TMDB resolve fallito per ${meta.id}:`, err.message);
  }

  const fallbackArtwork = shape === "poster"
    ? (meta.poster || meta.background)
    : (meta.background || meta.poster);

  if (!fallbackArtwork) return meta.poster;

  const qs = new URLSearchParams({
    rank: String(rank),
    artwork: fallbackArtwork,
    shape,
    catalogId: catalog.id || "",
    canvasBackground,
    showMeta: String(showMeta),
    showLogo: String(showLogo),
    genre: genre || "",
    rating: rating || "",
    v: "7.5.0"
  });

  return `${publicBase(req)}/c/${token}/top-cover?${qs}`;
}

/* ---------------- Public configurator ---------------- */

app.get("/api/catalogs", async (_req, res) => {
  try {
    const source = await fetchJson(SOURCE_MANIFEST_URL);

    const catalogs = (source.catalogs || [])
      .filter(c => {
        const id = String(c.id || "").toLowerCase();
        const name = String(c.name || "").toLowerCase();
        if (id.includes("last-video") || id.includes("calendar-video")) return false;
        if (name.includes("last video") || name.includes("calendar video")) return false;
        return true;
      })
      .map(c => ({
        id: c.id,
        type: c.type,
        name: c.name || c.id
      }));

    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ catalogs });
  } catch (err) {
    console.error("Errore /api/catalogs:", err.message);
    res.status(502).json({
      error: `Impossibile caricare i cataloghi: ${err.message}`
    });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const requested = Array.isArray(req.body?.catalogs)
      ? req.body.catalogs
      : [];

    if (!requested.length) {
      return res.status(400).json({
        error: "Seleziona almeno un catalogo."
      });
    }

    const source = await fetchJson(SOURCE_MANIFEST_URL);

    const available = new Map(
      (source.catalogs || []).map(c => [
        catalogKey(c.type, c.id),
        c
      ])
    );

    const catalogs = requested
      .map(requestedCatalog => {
        const sourceCatalog = available.get(
          catalogKey(requestedCatalog.type, requestedCatalog.id)
        );

        if (!sourceCatalog) return null;

        return {
          id: sourceCatalog.id,
          type: sourceCatalog.type,
          name: sourceCatalog.name || sourceCatalog.id,
          shape: normalizeShape(requestedCatalog.shape),
          canvasBackground: normalizeCanvasBackground(requestedCatalog.canvasBackground),
          showMeta: requestedCatalog.showMeta !== false && requestedCatalog.showMeta !== "false",
          showLogo: requestedCatalog.showLogo !== false && requestedCatalog.showLogo !== "false"
        };
      })
      .filter(Boolean);

    if (!catalogs.length) {
      return res.status(400).json({
        error: "Cataloghi non validi."
      });
    }

    const token = encryptConfig({
      v: 3,
      catalogs
    });

    // Tailored for Stremio (solid backgrounds -> "stremio" rgb(26, 23, 62))
    const stremioCatalogs = catalogs.map(c => ({
      ...c,
      canvasBackground: c.canvasBackground === "black" || c.canvasBackground === "stremio" ? "stremio" : c.canvasBackground
    }));
    const tokenStremio = encryptConfig({ v: 3, catalogs: stremioCatalogs });

    // Tailored for Nuvio (solid backgrounds -> "black" #000000)
    const nuvioCatalogs = catalogs.map(c => ({
      ...c,
      canvasBackground: c.canvasBackground === "black" || c.canvasBackground === "stremio" ? "black" : c.canvasBackground
    }));
    const tokenNuvio = encryptConfig({ v: 3, catalogs: nuvioCatalogs });

    const base = publicBase(req);
    const manifestUrl = `${base}/c/${token}/manifest.json`;
    const stremioManifestUrl = `${base}/c/${tokenStremio}/manifest.json`;
    const nuvioManifestUrl = `${base}/c/${tokenNuvio}/manifest.json`;

    res.json({
      ok: true,
      manifestUrl,
      stremioManifestUrl,
      nuvioManifestUrl,
      catalogCount: catalogs.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Impossibile generare il manifest."
    });
  }
});

app.get("/api/stats", (_req, res) => {
  res.json(getDbStats());
});

app.get("/manifest.json", async (_req, res) => {
  try {
    const source = await fetchJson(SOURCE_MANIFEST_URL);
    const catalogs = (source.catalogs || [])
      .filter(c => {
        const id = String(c.id || "").toLowerCase();
        const name = String(c.name || "").toLowerCase();
        if (id.includes("last-video") || id.includes("calendar-video")) return false;
        if (name.includes("last video") || name.includes("calendar video")) return false;
        return true;
      });

    const manifest = {
      id: "com.blvcktop.default",
      version: "7.2.0",
      name: "blvckTOP",
      description: "Classifiche Top 10 con cover numerate HD per Nuvio & Stremio",
      logo: "https://raw.githubusercontent.com/blvckroby/MusicDB/refs/heads/main/loghi/Top10Badge.svg",
      types: ["movie", "series"],
      resources: ["catalog", "meta"],
      idPrefixes: ["tt", "tmdb"],
      catalogs,
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      }
    };

    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Generated addon ---------------- */

app.get("/c/:token/manifest.json", async (req, res) => {
  try {
    const config = decryptConfig(req.params.token);
    const source = await fetchJson(SOURCE_MANIFEST_URL);
    const selected = selectedCatalogSet(config);

    const catalogs = (source.catalogs || [])
      .filter(c => selected.has(catalogKey(c.type, c.id)))
      .map(c => {
        const conf = getCatalogConfig(config, c.type, c.id);

        return {
          ...c,
          name: c.name || conf?.name || c.id
        };
      });

    const idSuffix = shortConfigId(req.params.token);

    const manifest = {
      id: `com.blvcktop.${idSuffix}`,
      version: "7.2.0",
      name: "blvckTOP",
      description: "Classifiche Top 10 con cover numerate HD per Nuvio & Stremio",
      logo: "https://raw.githubusercontent.com/blvckroby/MusicDB/refs/heads/main/loghi/Top10Badge.svg",
      types: ["movie", "series"],
      resources: ["catalog", "meta"],
      idPrefixes: ["tt", "tmdb"],
      catalogs,
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      }
    };

    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(manifest);
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

app.get("/c/:token/catalog/:type/:catalogId.json", async (req, res) => {
  try {
    const config = decryptConfig(req.params.token);
    const { type, catalogId } = req.params;

    const catalog = getCatalogConfig(config, type, catalogId);

    if (!catalog) {
      return res.status(404).json({ metas: [] });
    }

    const query = req.url.includes("?")
      ? req.url.slice(req.url.indexOf("?"))
      : "";

    const sourceUrl =
      `${sourceBaseUrl()}/catalog/${encodeURIComponent(type)}/` +
      `${encodeURIComponent(catalogId)}.json${query}`;

    const data = await fetchJson(sourceUrl);
    const metas = Array.isArray(data.metas) ? data.metas : [];

    const decorated = await Promise.all(
      metas.map(async (meta, index) => ({
        ...meta,
        poster: await buildCoverUrl(
          req,
          req.params.token,
          meta,
          index + 1,
          type,
          catalog
        ),
        posterShape:
          normalizeShape(catalog.shape) === "poster"
            ? "poster"
            : "landscape"
      }))
    );

    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      ...data,
      metas: decorated
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({
      error: err.message,
      metas: []
    });
  }
});

app.get("/c/:token/meta/:type/:id.json", async (req, res) => {
  try {
    decryptConfig(req.params.token);

    const url =
      `${sourceBaseUrl()}/meta/${encodeURIComponent(req.params.type)}/` +
      `${encodeURIComponent(req.params.id)}.json`;

    const data = await fetchJson(url);

    res.setHeader("Cache-Control", "public, max-age=1800");
    res.json(data);
  } catch (err) {
    res.status(502).json({
      error: err.message
    });
  }
});

app.get(["/c/:token/top-cover", "/top-cover"], async (req, res) => {
  try {
    let config = null;
    if (req.params.token) {
      try {
        config = decryptConfig(req.params.token);
      } catch {}
    }

    const rank = Math.max(
      1,
      Math.min(99, Number(req.query.rank || 1))
    );

    const type = String(req.query.type || "movie");
    const shape = normalizeShape(String(req.query.shape || "landscape"));
    const tmdbId = req.query.tmdbId ? String(req.query.tmdbId) : null;
    const catalogId = req.query.catalogId ? String(req.query.catalogId) : "";

    const canvasBackground = normalizeCanvasBackground(req.query.canvasBackground);

    const showMetaParam = req.query.showMeta;
    const showLogoParam = req.query.showLogo;
    const catalog = config?.catalogs?.find(c => c.id === catalogId) || { id: catalogId };
    const showMeta = showMetaParam !== undefined
      ? (showMetaParam !== "false" && showMetaParam !== "0" && showMetaParam !== false)
      : (catalog.showMeta !== false && catalog.showMeta !== "false");
    const showLogo = showLogoParam !== undefined
      ? (showLogoParam !== "false" && showLogoParam !== "0" && showLogoParam !== false)
      : (catalog.showLogo !== false && catalog.showLogo !== "false");

    let artworkUrl = req.query.artwork ? String(req.query.artwork) : null;
    let resolvedTmdbId = tmdbId;
    let genre = showMeta && req.query.genre ? String(req.query.genre) : "";
    let rating = showMeta && req.query.rating ? String(req.query.rating) : "";

    const accent = catalogAccent(catalog);
    const effectiveType = type === "series" || type === "tv" ? "tv" : "movie";

    // If artworkUrl, tmdbId, genre, or rating are missing, resolve from catalog
    if ((!artworkUrl && !resolvedTmdbId && catalogId) || (showMeta && !genre && catalogId) || (showMeta && !rating && catalogId)) {
      try {
        const catType = type === "series" || type === "tv" ? "series" : "movie";
        const sourceUrl = `${sourceBaseUrl()}/catalog/${encodeURIComponent(catType)}/${encodeURIComponent(catalogId)}.json`;
        const catData = await fetchJson(sourceUrl);
        const metas = Array.isArray(catData?.metas) ? catData.metas : [];
        const item = metas[rank - 1] || metas[0];
        if (item) {
          if (showMeta && !genre) genre = Array.isArray(item.genres) && item.genres.length > 0 ? item.genres[0] : (item.genre || "");
          if (showMeta && !rating) rating = item.imdbRating || item.rating || "";
          if (!resolvedTmdbId) {
            resolvedTmdbId = await resolveTmdbId(catType, item.id || item.tmdbId, DEFAULT_TMDB_KEY);
            if (!resolvedTmdbId && !artworkUrl) {
              artworkUrl = shape === "poster" ? (item.poster || item.background) : (item.background || item.poster);
            }
          }
        }
      } catch (catErr) {
        console.warn(`[top-cover] Errore lookup catalogId ${catalogId} rank ${rank}:`, catErr.message);
      }
    }

    // If genre or rating are still missing, but tmdbId is resolved, fetch TMDB details
    if (showMeta && resolvedTmdbId && (!genre || !rating)) {
      try {
        const details = await getTmdbDetails(effectiveType, resolvedTmdbId, DEFAULT_TMDB_KEY);
        if (details) {
          if (!genre && details.genre) genre = details.genre;
          if (!rating && details.rating) rating = details.rating;
        }
      } catch (detErr) {
        console.warn(`Errore fetch details TMDB ${resolvedTmdbId}:`, detErr.message);
      }
    }

    // If artworkUrl is not provided yet, resolve it via TMDB
    if (resolvedTmdbId && !artworkUrl) {
      try {
        const images = await getTmdbImages(effectiveType, resolvedTmdbId, DEFAULT_TMDB_KEY);
        artworkUrl = shape === "poster"
          ? choosePoster(images)
          : chooseBackdrop(images);
      } catch (tmdbErr) {
        console.warn(`Errore fetch immagini TMDB ${resolvedTmdbId}:`, tmdbErr.message);
      }
    }

    if (!artworkUrl) {
      return res.status(404).send("Nessuna immagine disponibile per questo titolo.");
    }

    const coverKey = computeCoverKey({
      rank,
      type: effectiveType,
      shape,
      tmdbId: resolvedTmdbId,
      catalogId,
      canvasBackground,
      accent,
      artworkUrl,
      genre,
      rating,
      showLogo
    });

    // 1. Check persistent disk cache (instant response via sendFile)
    const existingFilePath = getCoverFilePath(coverKey);
    if (existingFilePath) {
      res.setHeader("X-Cover-Cache", "HIT-DISK");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.sendFile(existingFilePath);
    }

    // 2. Check pending in-flight generation
    if (pendingCovers.has(coverKey)) {
      const png = await pendingCovers.get(coverKey);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Cover-Cache", "SHARED");
      return res.send(png);
    }

    // 3. Generate cover with sharp
    const generationPromise = (async () => {
      const png = await createTopCover({
        rank,
        artworkUrl,
        shape,
        accent,
        canvasBackground,
        genre,
        rating,
        catalogId,
        showLogo
      });

      // Persist to disk and DB
      saveCoverBuffer(coverKey, png);
      return png;
    })();

    pendingCovers.set(coverKey, generationPromise);

    try {
      const png = await generationPromise;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Cover-Cache", "GENERATED");
      res.send(png);
    } finally {
      pendingCovers.delete(coverKey);
    }
  } catch (err) {
    console.error(`Errore top-cover:`, err);
    res.status(500).json({
      error: err.message || "Errore generazione cover"
    });
  }
});

app.listen(PORT, () => {
  console.log(`blvckTOP avviato su http://localhost:${PORT}`);
  console.log(`TMDB Key configurata: ${DEFAULT_TMDB_KEY.slice(0, 6)}...${DEFAULT_TMDB_KEY.slice(-4)}`);
  
  // Inizializza il cron job alle 9:00 e alle 18:00
  initScheduler(SOURCE_MANIFEST_URL);
});
