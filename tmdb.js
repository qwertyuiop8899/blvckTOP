import {
  getTmdbMapping,
  setTmdbMapping,
  getTmdbImagesDb,
  setTmdbImagesDb
} from "./db.js";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMAGE = "https://image.tmdb.org/t/p";
export const DEFAULT_TMDB_KEY = process.env.TMDB_API_KEY || "ad0f7351455041d8c9c0d4370a4b5fa5";

async function tmdbFetch(path, apiKey = DEFAULT_TMDB_KEY) {
  const key = apiKey || DEFAULT_TMDB_KEY;
  if (!key) throw new Error("TMDB API key mancante.");

  const sep = path.includes("?") ? "&" : "?";
  const url = `${TMDB_API}${path}${sep}api_key=${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "blvckTOP/7.2"
    }
  });

  if (!response.ok) {
    throw new Error(`TMDB error ${response.status}`);
  }

  return response.json();
}

export async function validateTmdbKey(apiKey = DEFAULT_TMDB_KEY) {
  await tmdbFetch("/configuration", apiKey);
  return true;
}

export async function getTmdbImages(type, tmdbId, apiKey = DEFAULT_TMDB_KEY) {
  const mediaType = type === "series" || type === "tv" ? "tv" : "movie";

  // Check persistent DB first
  const dbData = getTmdbImagesDb(mediaType, tmdbId);
  if (dbData) return dbData;

  const data = await tmdbFetch(
    `/${mediaType}/${encodeURIComponent(tmdbId)}/images?include_image_language=it,en,null`,
    apiKey
  );

  // Store in DB
  setTmdbImagesDb(mediaType, tmdbId, data);
  return data;
}

export async function getTmdbDetails(type, tmdbId, apiKey = DEFAULT_TMDB_KEY) {
  if (!tmdbId) return null;
  const mediaType = type === "series" || type === "tv" ? "tv" : "movie";
  try {
    const data = await tmdbFetch(
      `/${mediaType}/${encodeURIComponent(tmdbId)}?language=it-IT`,
      apiKey
    );
    const genre = data.genres?.[0]?.name || "";
    const rating = data.vote_average && data.vote_average > 0 ? String(data.vote_average.toFixed(1)) : "";
    return { genre, rating, title: data.title || data.name };
  } catch (err) {
    console.warn(`TMDB details fallito per ${mediaType} ${tmdbId}:`, err.message);
    return null;
  }
}

export async function resolveTmdbId(type, rawId, apiKey = DEFAULT_TMDB_KEY) {
  if (!rawId) return null;

  const id = String(rawId);

  if (id.startsWith("tmdb:")) {
    return id.split(":")[1] || null;
  }

  if (/^\d+$/.test(id)) {
    return id;
  }

  if (id.startsWith("tt")) {
    const wantsTv = type === "series" || type === "tv";
    const mediaType = wantsTv ? "tv" : "movie";

    // Check persistent DB
    const cachedId = getTmdbMapping(id, mediaType);
    if (cachedId !== undefined) {
      return cachedId;
    }

    try {
      const data = await tmdbFetch(
        `/find/${encodeURIComponent(id)}?external_source=imdb_id`,
        apiKey
      );

      const list = wantsTv ? data.tv_results : data.movie_results;
      const result = list?.[0]?.id ? String(list[0].id) : null;

      // Store in DB (even if null, to avoid re-querying failed lookups)
      setTmdbMapping(id, mediaType, result);
      return result;
    } catch (err) {
      console.warn(`TMDB find fallito per ${id}:`, err.message);
      return null;
    }
  }

  return null;
}

function scoreByLanguage(item) {
  if (item.iso_639_1 === "it") return 0;
  if (item.iso_639_1 === "en") return 1;
  if (item.iso_639_1 == null) return 2;
  return 3;
}

function sortImages(items) {
  return [...(items || [])]
    .filter(x => x.file_path)
    .sort((a, b) => {
      const lang = scoreByLanguage(a) - scoreByLanguage(b);
      if (lang !== 0) return lang;
      return (b.vote_average || 0) - (a.vote_average || 0);
    });
}

export function chooseBackdrop(images) {
  const items = sortImages(images?.backdrops);

  return items.length
    ? `${TMDB_IMAGE}/w1280${items[0].file_path}`
    : null;
}

export function choosePoster(images) {
  const items = sortImages(images?.posters);

  return items.length
    ? `${TMDB_IMAGE}/w780${items[0].file_path}`
    : null;
}

export function chooseLogo(images) {
  const items = sortImages(images?.logos);

  return items.length
    ? `${TMDB_IMAGE}/w500${items[0].file_path}`
    : null;
}

function chooseTextless(items, size) {
  const textless = [...(items || [])]
    .filter(x => x.file_path && !x.iso_639_1)
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));

  return textless.length
    ? `${TMDB_IMAGE}/${size}${textless[0].file_path}`
    : null;
}

// Banner: textless art + title logo when both exist, otherwise the regular art (title already printed on it).
export function chooseBannerArtwork(images, shape) {
  const logoUrl = chooseLogo(images);
  const textless = logoUrl
    ? (shape === "poster" ? chooseTextless(images?.posters, "w780") : chooseTextless(images?.backdrops, "w1280"))
    : null;

  return textless
    ? { artworkUrl: textless, logoUrl }
    : { artworkUrl: shape === "poster" ? choosePoster(images) : chooseBackdrop(images), logoUrl: "" };
}
