import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getAssetBuffer, saveAssetBuffer } from "./db.js";

// Limit Sharp to 1 worker thread and constrain in-memory cache to prevent CPU/RAM saturation
sharp.concurrency(1);
sharp.cache({ memory: 32, items: 50 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NETWORKS_DIR = path.join(__dirname, "public", "networks");
const ICONS_DIR = path.join(__dirname, "public", "icons");
const ICON_CACHE = new Map();

function loadSvg(filename, fromNetworks = false) {
  const dir = fromNetworks ? NETWORKS_DIR : ICONS_DIR;
  const key = `${fromNetworks ? 'net:' : 'icon:'}${filename}`;
  if (ICON_CACHE.has(key)) return ICON_CACHE.get(key);
  try {
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) {
      const fallbackPath = path.join(fromNetworks ? ICONS_DIR : NETWORKS_DIR, filename);
      if (fs.existsSync(fallbackPath)) {
        const content = fs.readFileSync(fallbackPath, "utf8");
        ICON_CACHE.set(key, content);
        return content;
      }
      return null;
    }
    const content = fs.readFileSync(filePath, "utf8");
    ICON_CACHE.set(key, content);
    return content;
  } catch {
    return null;
  }
}

const pendingDownloads = new Map();

const LAYOUTS = {
  landscape: {
    canvas: { width: 1280, height: 720 },
    card: {
      x: 300,
      y: 107,
      width: 900,
      height: 506,
      radius: 30
    },
    number: {
      xSingle: 62,
      xDouble: 24,
      sizeSingle: 450,
      sizeDouble: 370,
      opticalDrop: 8
    },
    logo: {
      maxWidth: 380,
      maxHeight: 155,
      left: 46,
      bottom: 40
    }
  },

  poster: {
    canvas: { width: 1000, height: 1500 },
    card: {
      x: 210,
      y: 165,
      width: 730,
      height: 1095,
      radius: 38
    },
    number: {
      xSingle: 14,
      xDouble: -10,
      sizeSingle: 405,
      sizeDouble: 335,
      opticalDrop: 22
    },
    logo: {
      maxWidth: 350,
      maxHeight: 145,
      left: 40,
      bottom: 42
    }
  }
};

export function normalizedShape(shape) {
  return shape === "poster" || shape === "portrait"
    ? "poster"
    : "landscape";
}

async function fetchBuffer(url) {
  // 1. Check persistent disk cache first
  const diskCached = getAssetBuffer(url);
  if (diskCached) return diskCached;

  // 2. Check pending parallel downloads
  if (pendingDownloads.has(url)) {
    return pendingDownloads.get(url);
  }

  const promise = (async () => {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "blvckTOP/7.2"
      }
    });

    if (!response.ok) {
      throw new Error(`Download immagine fallito (${response.status}) da ${url}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    saveAssetBuffer(url, buffer);
    return buffer;
  })();

  pendingDownloads.set(url, promise);

  try {
    return await promise;
  } finally {
    pendingDownloads.delete(url);
  }
}

function hexToRgb(hex) {
  const clean = String(hex || "#ffffff").replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map(x => x + x).join("")
    : clean.padEnd(6, "f").slice(0, 6);

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function escapeXml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatRating(raw) {
  if (!raw) return "";
  const num = parseFloat(String(raw).replace(",", "."));
  if (isNaN(num) || num <= 0) return "";
  return num.toFixed(1);
}

function cleanGenre(raw) {
  if (!raw) return "";
  let g = String(raw).trim();
  if (g.includes(",")) g = g.split(",")[0].trim();
  if (g.includes("/")) g = g.split("/")[0].trim();
  return g.toUpperCase();
}

function getBrandPalette(accent = "#8C75FF", catalogKey = "") {
  const key = String(catalogKey || "").toLowerCase();
  
  if (key.includes("netflix") || accent.toUpperCase() === "#E50914") {
    return {
      atmo: { c1: "#3d080c", c2: "#1f0305", c3: "#0a0102" },
      body: { c1: "#570a10", c2: "#38060a", c3: "#1a0204", c4: "#050001" },
      stroke: { s1: "#FFFFFF", s2: "#FECDD3", s3: "#F43F5E", s4: "#881337", s5: "#FDA4AF", s6: "#FFFFFF" },
      sheen: { c1: "#FFFFFF", c2: "#FECDD3" },
      bounce: { c1: "#E11D48", c2: "#FDA4AF" }
    };
  }

  if (key.includes("prime") || key.includes("amazon") || accent.toUpperCase() === "#00A8E1") {
    return {
      atmo: { c1: "#002847", c2: "#001324", c3: "#00050d" },
      body: { c1: "#004073", c2: "#002447", c3: "#001021", c4: "#00040a" },
      stroke: { s1: "#FFFFFF", s2: "#BAE6FD", s3: "#38BDF8", s4: "#0284C7", s5: "#7DD3FC", s6: "#FFFFFF" },
      sheen: { c1: "#FFFFFF", c2: "#BAE6FD" },
      bounce: { c1: "#0284C7", c2: "#7DD3FC" }
    };
  }

  if (key.includes("now") || key.includes("sky") || accent.toUpperCase() === "#00E575" || accent.toUpperCase() === "#00CFFF") {
    return {
      atmo: { c1: "#003319", c2: "#00170a", c3: "#000603" },
      body: { c1: "#005229", c2: "#003319", c3: "#00170b", c4: "#000502" },
      stroke: { s1: "#FFFFFF", s2: "#BBF7D0", s3: "#4ADE80", s4: "#15803D", s5: "#86EFAC", s6: "#FFFFFF" },
      sheen: { c1: "#FFFFFF", c2: "#BBF7D0" },
      bounce: { c1: "#16A34A", c2: "#86EFAC" }
    };
  }

  if (key.includes("disney") || accent.toUpperCase() === "#2D7DFF" || accent.toUpperCase() === "#155EEF") {
    return {
      atmo: { c1: "#0c1d42", c2: "#060e21", c3: "#02040a" },
      body: { c1: "#142d69", c2: "#0c1d42", c3: "#060d1f", c4: "#02040a" },
      stroke: { s1: "#FFFFFF", s2: "#BFDBFE", s3: "#60A5FA", s4: "#1D4ED8", s5: "#93C5FD", s6: "#FFFFFF" },
      sheen: { c1: "#FFFFFF", c2: "#BFDBFE" },
      bounce: { c1: "#2563EB", c2: "#93C5FD" }
    };
  }

  if (key.includes("apple") || accent.toUpperCase() === "#D8DFEA" || accent.toUpperCase() === "#F4F5F7") {
    return {
      atmo: { c1: "#26292e", c2: "#14161a", c3: "#08080a" },
      body: { c1: "#3c4048", c2: "#26292e", c3: "#14161a", c4: "#060708" },
      stroke: { s1: "#FFFFFF", s2: "#F1F5F9", s3: "#94A3B8", s4: "#475569", s5: "#CBD5E1", s6: "#FFFFFF" },
      sheen: { c1: "#FFFFFF", c2: "#F1F5F9" },
      bounce: { c1: "#64748B", c2: "#E2E8F0" }
    };
  }

  if (key.includes("hbo") || key.includes("max") || accent.toUpperCase() === "#7D57FF") {
    return {
      atmo: { c1: "#2c0b47", c2: "#160524", c3: "#07010d" },
      body: { c1: "#4a1478", c2: "#2c0b47", c3: "#130421", c4: "#040108" },
      stroke: { s1: "#FFFFFF", s2: "#DDD6FE", s3: "#A78BFA", s4: "#6D28D9", s5: "#C4B5FD", s6: "#FFFFFF" },
      sheen: { c1: "#FFFFFF", c2: "#DDD6FE" },
      bounce: { c1: "#7C3AED", c2: "#C4B5FD" }
    };
  }

  if (key.includes("paramount") || accent.toUpperCase() === "#0064FF") {
    return {
      atmo: { c1: "#001a44", c2: "#000d24", c3: "#00040d" },
      body: { c1: "#002a6e", c2: "#001a44", c3: "#000d24", c4: "#00030a" },
      stroke: { s1: "#FFFFFF", s2: "#BAE6FD", s3: "#38BDF8", s4: "#0284C7", s5: "#7DD3FC", s6: "#FFFFFF" },
      sheen: { c1: "#FFFFFF", c2: "#BAE6FD" },
      bounce: { c1: "#0284C7", c2: "#7DD3FC" }
    };
  }

  if (key.includes("rai") || accent.toUpperCase() === "#1C6DFF" || accent.toUpperCase() === "#0066CC") {
    return {
      atmo: { c1: "#002047", c2: "#001026", c3: "#00050f" },
      body: { c1: "#003575", c2: "#002047", c3: "#001026", c4: "#00040a" },
      stroke: { s1: "#FFFFFF", s2: "#BAE6FD", s3: "#38BDF8", s4: "#0369A1", s5: "#7DD3FC", s6: "#FFFFFF" },
      sheen: { c1: "#FFFFFF", c2: "#BAE6FD" },
      bounce: { c1: "#0284C7", c2: "#7DD3FC" }
    };
  }

  if (key.includes("infinity") || key.includes("mediaset") || accent.toUpperCase() === "#00A3E0") {
    return {
      atmo: { c1: "#002538", c2: "#00121d", c3: "#00060b" },
      body: { c1: "#003d5c", c2: "#002538", c3: "#00121d", c4: "#000508" },
      stroke: { s1: "#FFFFFF", s2: "#BAE6FD", s3: "#38BDF8", s4: "#0284C7", s5: "#7DD3FC", s6: "#FFFFFF" },
      sheen: { c1: "#FFFFFF", c2: "#BAE6FD" },
      bounce: { c1: "#0284C7", c2: "#7DD3FC" }
    };
  }

  // Generic calculated from accent RGB
  const rgb = hexToRgb(accent);
  const r1 = Math.round(rgb.r * 0.35), g1 = Math.round(rgb.g * 0.35), b1 = Math.round(rgb.b * 0.35);
  const r2 = Math.round(rgb.r * 0.18), g2 = Math.round(rgb.g * 0.18), b2 = Math.round(rgb.b * 0.18);
  const r3 = Math.round(rgb.r * 0.05), g3 = Math.round(rgb.g * 0.05), b3 = Math.round(rgb.b * 0.05);

  return {
    atmo: { c1: `rgb(${r1},${g1},${b1})`, c2: `rgb(${r2},${g2},${b2})`, c3: `rgb(${r3},${g3},${b3})` },
    body: { c1: `rgb(${Math.round(rgb.r * 0.5)},${Math.round(rgb.g * 0.5)},${Math.round(rgb.b * 0.5)})`, c2: `rgb(${r1},${g1},${b1})`, c3: `rgb(${r2},${g2},${b2})`, c4: `rgb(${r3},${g3},${b3})` },
    stroke: { s1: "#FFFFFF", s2: "#E0E7FF", s3: accent, s4: `rgb(${r1},${g1},${b1})`, s5: "#C7D2FE", s6: "#FFFFFF" },
    sheen: { c1: "#FFFFFF", c2: "#E0E7FF" },
    bounce: { c1: accent, c2: "#FFFFFF" }
  };
}

function generateGlassBackground(width, height, mode = "stremio", accent = "#8C75FF", catalogKey = "") {
  if (mode === "black" || mode === "nero") {
    return Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="#000000"/>
      </svg>
    `);
  }
  if (mode === "transparent") {
    return Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"/>
    `);
  }

  const isProvider = mode === "provider" || mode === "brand";
  const pal = isProvider ? getBrandPalette(accent, catalogKey) : {
    atmo: { c1: "#2e2569", c2: "#1b1642", c3: "#0a081c" },
    body: { c1: "#483896", c2: "#322673", c3: "#1d1647", c4: "#050410" },
    stroke: { s1: "#FFFFFF", s2: "#E0E7FF", s3: "#A5B4FC", s4: "#6366F1", s5: "#C7D2FE", s6: "#FFFFFF" },
    sheen: { c1: "#FFFFFF", c2: "#C7D2FE" },
    bounce: { c1: "#818CF8", c2: "#C7D2FE" }
  };

  const pad = 12;
  const rw = width - pad * 2;
  const rh = height - pad * 2;
  const rx = Math.round(width * 0.032);
  const strokeW = width > 1100 ? 4.0 : 3.5;

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- Canvas Ambient Atmosphere -->
        <radialGradient id="glassAtmosphere" cx="50%" cy="25%" r="75%">
          <stop offset="0%" stop-color="${pal.atmo.c1}"/>
          <stop offset="42%" stop-color="${pal.atmo.c2}"/>
          <stop offset="100%" stop-color="${pal.atmo.c3}"/>
        </radialGradient>

        <!-- Liquid Glass Card Interior: Strong top gradient flowing into ultra-deep dark bottom -->
        <linearGradient id="glassBodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${pal.body.c1}" stop-opacity="0.95"/>
          <stop offset="20%" stop-color="${pal.body.c2}" stop-opacity="0.92"/>
          <stop offset="50%" stop-color="${pal.body.c3}" stop-opacity="0.95"/>
          <stop offset="80%" stop-color="${pal.atmo.c3}" stop-opacity="0.98"/>
          <stop offset="100%" stop-color="${pal.body.c4}" stop-opacity="1.0"/>
        </linearGradient>

        <!-- Top Internal Glass Light Sheen -->
        <linearGradient id="innerGlassSheen" x1="0" y1="0" x2="0.8" y2="0.6">
          <stop offset="0%" stop-color="${pal.sheen.c1}" stop-opacity="0.28"/>
          <stop offset="35%" stop-color="${pal.sheen.c2}" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="${pal.bounce.c1}" stop-opacity="0"/>
        </linearGradient>

        <!-- 3D Liquid Glass Border Rim -->
        <linearGradient id="glassStrokeGrad" x1="0" y1="0" x2="0.75" y2="1">
          <stop offset="0%" stop-color="${pal.stroke.s1}" stop-opacity="1.0"/>
          <stop offset="16%" stop-color="${pal.stroke.s2}" stop-opacity="0.90"/>
          <stop offset="40%" stop-color="${pal.stroke.s3}" stop-opacity="0.55"/>
          <stop offset="70%" stop-color="${pal.stroke.s4}" stop-opacity="0.38"/>
          <stop offset="88%" stop-color="${pal.stroke.s5}" stop-opacity="0.70"/>
          <stop offset="100%" stop-color="${pal.stroke.s6}" stop-opacity="0.90"/>
        </linearGradient>

        <!-- Inner Bevel Stroke -->
        <linearGradient id="innerBevelGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.60"/>
          <stop offset="25%" stop-color="#FFFFFF" stop-opacity="0.12"/>
          <stop offset="65%" stop-color="#000000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.65"/>
        </linearGradient>

        <!-- Top Edge Specular Flare -->
        <linearGradient id="topFlare" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset="20%" stop-color="#FFFFFF" stop-opacity="0.90"/>
          <stop offset="50%" stop-color="#FFFFFF" stop-opacity="1.0"/>
          <stop offset="80%" stop-color="#FFFFFF" stop-opacity="0.90"/>
          <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
        </linearGradient>

        <!-- Bottom Rim Light Bounce -->
        <linearGradient id="bottomRimFlare" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${pal.bounce.c1}" stop-opacity="0"/>
          <stop offset="30%" stop-color="${pal.bounce.c2}" stop-opacity="0.60"/>
          <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.85"/>
          <stop offset="70%" stop-color="${pal.bounce.c2}" stop-opacity="0.60"/>
          <stop offset="100%" stop-color="${pal.bounce.c1}" stop-opacity="0"/>
        </linearGradient>

        <!-- Outer Drop Shadow -->
        <filter id="glassShadow" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="12" stdDeviation="22" flood-color="#020105" flood-opacity="0.94"/>
        </filter>
      </defs>

      <!-- Atmosphere Fill -->
      <rect width="${width}" height="${height}" fill="url(#glassAtmosphere)"/>

      <!-- Liquid Glass Container -->
      <g filter="url(#glassShadow)">
        <rect
          x="${pad}"
          y="${pad}"
          width="${rw}"
          height="${rh}"
          rx="${rx}"
          ry="${rx}"
          fill="url(#glassBodyGrad)"
          stroke="url(#glassStrokeGrad)"
          stroke-width="${strokeW}"
        />
        <rect
          x="${pad + 1.5}"
          y="${pad + 1.5}"
          width="${rw - 3}"
          height="${rh - 3}"
          rx="${rx - 1.5}"
          ry="${rx - 1.5}"
          fill="url(#innerGlassSheen)"
          stroke="url(#innerBevelGrad)"
          stroke-width="1.5"
        />
      </g>

      <!-- Top Lip -->
      <path
        d="M ${pad + rx + 8} ${pad + 2} Q ${width / 2} ${pad + 1.2} ${width - pad - rx - 8} ${pad + 2}"
        stroke="url(#topFlare)"
        stroke-width="${strokeW}"
        stroke-linecap="round"
        fill="none"
      />

      <!-- Bottom Lip -->
      <path
        d="M ${pad + rx + 14} ${height - pad - 2} Q ${width / 2} ${height - pad - 1.2} ${width - pad - rx - 14} ${height - pad - 2}"
        stroke="url(#bottomRimFlare)"
        stroke-width="2.5"
        stroke-linecap="round"
        fill="none"
      />
    </svg>
  `);
}

export function getProviderLogoSvg(catalogKey = "") {
  const key = String(catalogKey || "").toLowerCase().trim();

  // 1. Netflix (N ribbon from Pictorium)
  if (key.includes("netflix")) {
    const svg = loadSvg("Netflix_2016_N_logo.svg", true) || loadSvg("netflix.svg");
    return svg ? { width: 14, height: 26, svg } : null;
  }

  // 2. Prime Video (2024 logo from Pictorium)
  if (key.includes("prime") || key.includes("amazon")) {
    const svg = loadSvg("Prime_Video_logo_(2024).svg", true) || loadSvg("prime-logo.svg");
    return svg ? { width: 78, height: 24, svg } : null;
  }

  // 3. Disney+ (from Pictorium)
  if (key.includes("disney")) {
    const svg = loadSvg("Disney+_logo.svg", true) || loadSvg("disney.svg");
    return svg ? { width: 48, height: 26, svg } : null;
  }

  // 4. Apple TV+ (from Pictorium)
  if (key.includes("apple")) {
    const svg = loadSvg("Apple_TV_logo.svg", true) || loadSvg("apple.svg");
    return svg ? { width: 48, height: 24, svg } : null;
  }

  // 5. HBO / Max (from Pictorium)
  if (key.includes("hbo") || key.includes("max")) {
    const svg = loadSvg("HBO_logo.svg", true) || loadSvg("hbomax.svg");
    return svg ? { width: 58, height: 24, svg } : null;
  }

  // 6. Paramount+ (from Pictorium)
  if (key.includes("paramount")) {
    const svg = loadSvg("Paramount_Plus.svg", true) || loadSvg("paramount.svg");
    return svg ? { width: 42, height: 26, svg } : null;
  }

  // 7. NOW / Sky (from Pictorium)
  if (key.includes("now") || key.includes("sky")) {
    const svg = loadSvg("Now_logo.svg", true) || loadSvg("now.svg");
    return svg ? { width: 71, height: 22, svg } : null;
  }

  // 8. RaiPlay / RAI (from Pictorium)
  if (key.includes("rai")) {
    const svg = loadSvg("Logo_of_RAI_(2016).svg", true) || loadSvg("raiplay.svg");
    return svg ? { width: 44, height: 24, svg } : null;
  }

  // 9. Mediaset Infinity (from Pictorium)
  if (key.includes("infinity") || key.includes("mediaset")) {
    const svg = loadSvg("Mediaset_Infinity_logo.svg", true) || loadSvg("infinity.svg");
    return svg ? { width: 52, height: 25, svg } : null;
  }

  // 10. TIMVISION (from local /icons/tim.svg)
  if (key.includes("timvision") || key.includes("tim")) {
    const svg = loadSvg("tim.svg");
    return svg ? { width: 86, height: 20, svg } : null;
  }

  // 11. Discovery+ (from local /icons/discovery_plus.svg)
  if (key.includes("discovery")) {
    const svg = loadSvg("discovery_plus.svg");
    return svg ? { width: 30, height: 25, svg } : null;
  }

  // 12. Crunchyroll (from Pictorium)
  if (key.includes("crunchyroll")) {
    const svg = loadSvg("cr_logo_noTagline.svg", true) || loadSvg("crunchyroll.svg");
    return svg ? { width: 80, height: 16, svg } : null;
  }

  // 13. Hulu (from Pictorium)
  if (key.includes("hulu")) {
    const svg = loadSvg("Hulu_logo_(2018).svg", true);
    return svg ? { width: 60, height: 20, svg } : null;
  }

  // 14. Rakuten TV (from local /icons/rakuten.svg)
  if (key.includes("rakuten")) {
    const svg = loadSvg("rakuten.svg");
    return svg ? { width: 80, height: 18, svg } : null;
  }

  return null;
}

function numberSvg(rank, layout, accent, genre = "", rating = "", canvasBackground = "transparent", showLogo = true, catalogId = "") {
  const { canvas, card, number } = layout;
  const isDouble = String(rank).length > 1;
  const fontSize = isDouble ? number.sizeDouble : number.sizeSingle;
  const x = isDouble ? number.xDouble : number.xSingle;

  const centerY = card.y + card.height / 2;
  const y = centerY + fontSize * 0.34 + number.opticalDrop;

  const strokeWidth = layout === LAYOUTS.poster ? 10 : 11;
  const isProvider = canvasBackground === "provider" || canvasBackground === "brand";

  const escapedGenre = escapeXml(cleanGenre(genre));
  const ratingVal = formatRating(rating);
  const isLandscape = layout === LAYOUTS.landscape;

  // 1. Standalone Large Provider Logo (Left Column, Under Number)
  let logoXml = "";
  const rawLogo = (showLogo && catalogId) ? getProviderLogoSvg(catalogId) : null;

  if (rawLogo && rawLogo.svg) {
    const maxLogoW = isLandscape ? 200 : 180;
    const maxLogoH = isLandscape ? 72 : 85;
    const scale = Math.min(maxLogoW / rawLogo.width, maxLogoH / rawLogo.height);
    const logoW = Math.round(rawLogo.width * scale);
    const logoH = Math.round(rawLogo.height * scale);

    const leftCenterX = isLandscape ? 150 : 105;
    const leftCenterY = isLandscape ? 620 : 1380;
    const logoX = Math.round(leftCenterX - logoW / 2);
    const logoY = Math.round(leftCenterY - logoH / 2);

    const logoHref = `data:image/svg+xml;base64,${Buffer.from(rawLogo.svg).toString("base64")}`;
    logoXml = `
      <g filter="url(#logoShadow)">
        <image href="${logoHref}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" />
      </g>
    `;
  }

  // 2. Metadata (Genre & Rating Centered Under Artwork Card)
  const metaX = isLandscape ? 750 : 575;
  const metaY = isLandscape ? 672 : 1385;
  let metaXml = "";

  if (isLandscape) {
    const gSize = escapedGenre.length > 14 ? 36 : (escapedGenre.length > 10 ? 40 : 44);
    const starSize = 50;
    const dotSize = 34;

    if (escapedGenre && ratingVal) {
      metaXml = `
        <text x="${metaX}" y="${metaY}" text-anchor="middle" font-family="Inter, -apple-system, BlinkMacSystemFont, Arial, sans-serif" filter="url(#metaShadow)">
          <tspan fill="#F1F5F9" font-size="${gSize}" font-weight="900" letter-spacing="2.5">${escapedGenre}</tspan>
          <tspan fill="#94A3B8" font-size="${dotSize}" font-weight="800">   •   </tspan>
          <tspan fill="#FFB800" font-size="${starSize}" font-weight="900">★ </tspan>
          <tspan fill="#FFFFFF" font-size="${starSize}" font-weight="900">${ratingVal}</tspan>
        </text>
      `;
    } else if (escapedGenre) {
      metaXml = `<text x="${metaX}" y="${metaY}" text-anchor="middle" font-family="Inter, -apple-system, BlinkMacSystemFont, Arial, sans-serif" font-size="44" font-weight="900" letter-spacing="2.5" fill="#F1F5F9" filter="url(#metaShadow)">${escapedGenre}</text>`;
    } else if (ratingVal) {
      metaXml = `<text x="${metaX}" y="${metaY}" text-anchor="middle" font-family="Inter, -apple-system, BlinkMacSystemFont, Arial, sans-serif" font-size="50" font-weight="900" filter="url(#metaShadow)"><tspan fill="#FFB800">★ </tspan><tspan fill="#FFFFFF">${ratingVal}</tspan></text>`;
    }
  } else {
    // Poster / Portrait
    const gSize = escapedGenre.length > 14 ? 48 : (escapedGenre.length > 10 ? 54 : 60);
    const starSize = 68;
    const dotSize = 42;

    if (escapedGenre && ratingVal) {
      metaXml = `
        <text x="${metaX}" y="${metaY}" text-anchor="middle" font-family="Inter, -apple-system, BlinkMacSystemFont, Arial, sans-serif" filter="url(#metaShadow)">
          <tspan fill="#F1F5F9" font-size="${gSize}" font-weight="900" letter-spacing="3">${escapedGenre}</tspan>
          <tspan fill="#94A3B8" font-size="${dotSize}" font-weight="800">   •   </tspan>
          <tspan fill="#FFB800" font-size="${starSize}" font-weight="900">★ </tspan>
          <tspan fill="#FFFFFF" font-size="${starSize}" font-weight="900">${ratingVal}</tspan>
        </text>
      `;
    } else if (escapedGenre) {
      metaXml = `<text x="${metaX}" y="${metaY}" text-anchor="middle" font-family="Inter, -apple-system, BlinkMacSystemFont, Arial, sans-serif" font-size="60" font-weight="900" letter-spacing="3" fill="#F1F5F9" filter="url(#metaShadow)">${escapedGenre}</text>`;
    } else if (ratingVal) {
      metaXml = `<text x="${metaX}" y="${metaY}" text-anchor="middle" font-family="Inter, -apple-system, BlinkMacSystemFont, Arial, sans-serif" font-size="68" font-weight="900" filter="url(#metaShadow)"><tspan fill="#FFB800">★ </tspan><tspan fill="#FFFFFF">${ratingVal}</tspan></text>`;
    }
  }

  let defsFilterAndStroke;
  if (isProvider) {
    // Pure Crystal Glass Number (transparent, no colored neon glow)
    defsFilterAndStroke = `
      <linearGradient id="crystalGlassStroke" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>
        <stop offset="30%" stop-color="#FFFFFF" stop-opacity="0.80"/>
        <stop offset="65%" stop-color="#E2E8F0" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#CBD5E1" stop-opacity="0.85"/>
      </linearGradient>
      <filter id="numFilter" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000000" flood-opacity="0.95"/>
        <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="whiteGlow"/>
        <feFlood flood-color="#FFFFFF" flood-opacity="0.40" result="whiteColor"/>
        <feComposite in="whiteColor" in2="whiteGlow" operator="in" result="glassRim"/>
        <feMerge>
          <feMergeNode in="glassRim"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    `;
  } else {
    // Standard Neon Glow with brand accent
    defsFilterAndStroke = `
      <linearGradient id="strokeGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".98"/>
        <stop offset="48%" stop-color="#F1F2F4" stop-opacity=".94"/>
        <stop offset="100%" stop-color="#C9CDD3" stop-opacity=".86"/>
      </linearGradient>

      <filter id="numFilter" x="-120%" y="-120%" width="340%" height="340%">
        <feGaussianBlur stdDeviation="30" result="bigBlur"/>
        <feFlood flood-color="${accent}" flood-opacity=".72" result="brandColor"/>
        <feComposite in="brandColor" in2="bigBlur" operator="in" result="bigGlow"/>

        <feGaussianBlur in="SourceAlpha" stdDeviation="11" result="midBlur"/>
        <feFlood flood-color="${accent}" flood-opacity=".52" result="midColor"/>
        <feComposite in="midColor" in2="midBlur" operator="in" result="midGlow"/>

        <feMerge>
          <feMergeNode in="bigGlow"/>
          <feMergeNode in="midGlow"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    `;
  }

  const strokeUrl = isProvider ? "url(#crystalGlassStroke)" : "url(#strokeGrad)";

  return Buffer.from(`
    <svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${defsFilterAndStroke}

        <filter id="logoShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.92"/>
        </filter>

        <filter id="metaShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.95"/>
        </filter>
      </defs>

      <text
        x="${x}"
        y="${y}"
        font-family="Inter, Arial, Helvetica, sans-serif"
        font-size="${fontSize}"
        font-weight="800"
        letter-spacing="-16"
        fill="none"
        stroke="${strokeUrl}"
        stroke-width="${strokeWidth}"
        stroke-linejoin="round"
        paint-order="stroke"
        filter="url(#numFilter)"
      >${rank}</text>

      ${logoXml}
      ${metaXml}
    </svg>
  `);
}

async function roundedArtwork(buffer, layout) {
  const { card } = layout;

  const resized = await sharp(buffer)
    .resize(card.width, card.height, {
      fit: "cover",
      position: "centre"
    })
    .png()
    .toBuffer();

  const mask = Buffer.from(`
    <svg width="${card.width}" height="${card.height}" xmlns="http://www.w3.org/2000/svg">
      <rect
        width="100%"
        height="100%"
        rx="${card.radius}"
        ry="${card.radius}"
        fill="#fff"
      />
    </svg>
  `);

  return sharp(resized)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function cardShadow(layout) {
  const { card } = layout;

  const svg = Buffer.from(`
    <svg width="${card.width + 120}" height="${card.height + 120}" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="60"
        y="46"
        width="${card.width}"
        height="${card.height}"
        rx="${card.radius}"
        ry="${card.radius}"
        fill="#000"
        fill-opacity=".52"
      />
    </svg>
  `);

  return sharp(svg)
    .blur(24)
    .png()
    .toBuffer();
}

async function prepareLogo(buffer, layout) {
  const { logo: conf } = layout;

  const meta = await sharp(buffer).metadata();

  let width = meta.width || conf.maxWidth;
  let height = meta.height || conf.maxHeight;

  const scale = Math.min(
    conf.maxWidth / width,
    conf.maxHeight / height,
    1
  );

  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const logo = await sharp(buffer)
    .resize({
      width,
      height,
      fit: "inside",
      withoutEnlargement: true
    })
    .png()
    .toBuffer();

  const pad = 32;
  const outWidth = width + pad * 2;
  const outHeight = height + pad * 2;

  const alpha = await sharp(logo)
    .ensureAlpha()
    .extractChannel("alpha")
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .blur(10)
    .toBuffer();

  const shadow = await sharp({
    create: {
      width: outWidth,
      height: outHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0.58 }
    }
  })
    .composite([{ input: alpha, blend: "dest-in" }])
    .png()
    .toBuffer();

  const composed = await sharp({
    create: {
      width: outWidth,
      height: outHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      { input: shadow, left: 0, top: 6 },
      { input: logo, left: pad, top: pad }
    ])
    .png()
    .toBuffer();

  return {
    buffer: composed,
    visibleWidth: width,
    visibleHeight: height,
    pad
  };
}

async function brandAmbientGlow(layout, accent) {
  const { canvas, card } = layout;
  const rgb = hexToRgb(accent);

  const glowWidth = Math.min(canvas.width, card.x + 140);
  const glowHeight = Math.min(canvas.height, card.height + 260);

  const svg = Buffer.from(`
    <svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ambient" cx="34%" cy="52%" r="45%">
          <stop offset="0%" stop-color="rgb(${rgb.r},${rgb.g},${rgb.b})" stop-opacity=".20"/>
          <stop offset="45%" stop-color="rgb(${rgb.r},${rgb.g},${rgb.b})" stop-opacity=".07"/>
          <stop offset="100%" stop-color="rgb(${rgb.r},${rgb.g},${rgb.b})" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${glowWidth}" height="${glowHeight}" fill="url(#ambient)"/>
    </svg>
  `);

  return sharp(svg)
    .blur(10)
    .png()
    .toBuffer();
}

export function parseBackgroundColor(canvasBackground) {
  const bg = String(canvasBackground || "").toLowerCase().trim();
  if (!bg || bg === "transparent") {
    return { r: 0, g: 0, b: 0, alpha: 0 };
  }
  if (bg === "stremio" || bg === "stremio-navy" || bg === "rgb(26,23,62)" || bg === "rgb(26, 23, 62)" || bg === "#1a173e" || bg === "1a173e") {
    return { r: 26, g: 23, b: 62, alpha: 1 };
  }
  if (bg === "black" || bg === "nero") {
    return { r: 0, g: 0, b: 0, alpha: 1 };
  }
  if (bg.startsWith("#")) {
    const rgb = hexToRgb(bg);
    return { r: rgb.r, g: rgb.g, b: rgb.b, alpha: 1 };
  }
  return { r: 0, g: 0, b: 0, alpha: 0 };
}

export async function createTopCover({
  rank,
  artworkUrl,
  shape = "landscape",
  accent = "#FFFFFF",
  canvasBackground = "provider",
  genre = "",
  rating = "",
  catalogId = "",
  showLogo = true
}) {
  if (!artworkUrl) throw new Error("artworkUrl mancante.");

  const normalized = normalizedShape(shape);
  const layout = LAYOUTS[normalized];

  const artworkBuffer = await fetchBuffer(artworkUrl);

  const [art, shadow, ambient] = await Promise.all([
    roundedArtwork(artworkBuffer, layout),
    cardShadow(layout),
    brandAmbientGlow(layout, accent)
  ]);

  const { canvas, card } = layout;
  const bgLower = String(canvasBackground || "").toLowerCase().trim();
  const isProvider = bgLower === "provider" || bgLower === "brand";
  const isStremio = bgLower === "stremio" || bgLower === "stremio-navy" || bgLower === "rgb(26,23,62)" || bgLower === "rgb(26, 23, 62)" || bgLower === "#1a173e" || bgLower === "1a173e";

  const composites = [];

  // Soft brand tint around the number area (only for standard/neon modes)
  if (!isProvider) {
    composites.push({ input: ambient, left: 0, top: 0 });
  }

  // Number and metadata go behind the card.
  composites.push(
    { input: numberSvg(rank, layout, accent, genre, rating, canvasBackground, showLogo, catalogId), left: 0, top: 0 },
    // Card shadow.
    {
      input: shadow,
      left: card.x - 60,
      top: card.y - 46 + 16
    },
    // Backdrop/poster.
    {
      input: art,
      left: card.x,
      top: card.y
    }
  );

  let baseSharp;
  if (isProvider) {
    baseSharp = sharp(generateGlassBackground(canvas.width, canvas.height, "provider", accent, catalogId));
  } else if (isStremio) {
    baseSharp = sharp(generateGlassBackground(canvas.width, canvas.height, "stremio", accent, catalogId));
  } else {
    baseSharp = sharp({
      create: {
        width: canvas.width,
        height: canvas.height,
        channels: 4,
        background: parseBackgroundColor(canvasBackground)
      }
    });
  }

  return baseSharp
    .composite(composites)
    .png({
      compressionLevel: 8,
      adaptiveFiltering: true
    })
    .toBuffer();
}
