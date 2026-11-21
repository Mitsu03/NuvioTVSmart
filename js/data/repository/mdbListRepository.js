import { withRequestTimeout } from "../../core/network/requestTimeout.js";
import { MDBLIST_API_BASE_URL } from "../../config.js";
import { MdbListSettingsStore } from "../local/mdbListSettingsStore.js";
import { TmdbService } from "../../core/tmdb/tmdbService.js";
import { parseMdbListMediaRatings } from "../../core/util/mdbListRatingStatus.js";

const CACHE_MAX_ITEMS = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
const API_BASE_URL = String(MDBLIST_API_BASE_URL || "https://api.mdblist.com/").replace(/\/+$/, "");

const PROVIDERS = {
  TRAKT: { key: "trakt", apiValue: "trakt", settingsKey: "showTrakt" },
  IMDB: { key: "imdb", apiValue: "imdb", settingsKey: "showImdb" },
  TMDB: { key: "tmdb", apiValue: "tmdb", settingsKey: "showTmdb" },
  LETTERBOXD: { key: "letterboxd", apiValue: "letterboxd", settingsKey: "showLetterboxd" },
  TOMATOES: { key: "tomatoes", apiValue: "tomatoes", settingsKey: "showTomatoes" },
  AUDIENCE: { key: "audience", apiValue: "audience", settingsKey: "showAudience" },
  METACRITIC: { key: "metacritic", apiValue: "metacritic", settingsKey: "showMetacritic" },
  MAL: { key: "mal", apiValue: "mal", settingsKey: "showMal" }
};

const cache = new Map();
const inFlight = new Map();

function fetchMdbList(url, options = {}) {
  return withRequestTimeout((signal) => fetch(url, { ...options, signal }), 6000);
}

function javaStringHash(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return hash;
}

function normalizeMediaType(rawType) {
  switch (
    String(rawType || "")
      .trim()
      .toLowerCase()
  ) {
    case "movie":
    case "film":
      return "movie";
    case "series":
    case "tv":
    case "show":
    case "tvshow":
      return "show";
    default:
      return "movie";
  }
}

function extractImdbId(rawId) {
  const match = String(rawId || "").match(/tt\d+/i);
  return match?.[0] || null;
}

function extractTmdbId(rawId) {
  const trimmed = String(rawId || "").trim();
  if (/^tmdb:/i.test(trimmed)) {
    const value = trimmed.replace(/^tmdb:/i, "").split(":")[0];
    return /^\d+$/.test(value) ? value : null;
  }
  return null;
}

function firstNonEmpty(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function enabledProviders(settings = {}) {
  return Object.values(PROVIDERS).filter((provider) => settings[provider.settingsKey] !== false);
}

function cacheGet(cacheKey) {
  const entry = cache.get(cacheKey);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAtMs > Date.now()) {
    return entry.result;
  }
  cache.delete(cacheKey);
  return undefined;
}

function cacheSet(cacheKey, result) {
  if (!result) return;
  if (!cache.has(cacheKey) && cache.size >= CACHE_MAX_ITEMS) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(cacheKey, {
    result,
    expiresAtMs: Date.now() + CACHE_TTL_MS
  });
}

async function fetchRatings({ provider, mediaId, mediaType, apiKey }) {
  try {
    const payload = await withRequestTimeout(async (signal) => {
      const response = await fetch(
        `${API_BASE_URL}/${provider}/${encodeURIComponent(mediaType)}/${encodeURIComponent(mediaId)}?apikey=${encodeURIComponent(apiKey)}&append_to_response=keyword`,
        { signal }
      );
      return response.ok ? response.json() : null;
    }, 6000);
    if (!payload) return null;
    const ratings = parseMdbListMediaRatings(payload);
    const hasRatings = Object.keys(PROVIDERS).some((key) => ratings[PROVIDERS[key].key] != null);
    return hasRatings ? { ratings, hasImdbRating: ratings.imdb != null } : null;
  } catch (_) {
    return null;
  }
}

async function resolveMediaRef(meta, fallbackItemId, fallbackItemType, mediaType) {
  const imdbId =
    extractImdbId(meta?.imdbId || meta?.imdb_id || meta?.id) || extractImdbId(fallbackItemId);
  if (imdbId) return { provider: "imdb", mediaId: imdbId };
  const tmdbId = extractTmdbId(meta?.id) || extractTmdbId(fallbackItemId);
  if (tmdbId) return { provider: "tmdb", mediaId: tmdbId };
  const resolved = await resolveImdbId(meta, fallbackItemId, fallbackItemType, mediaType);
  return resolved ? { provider: "imdb", mediaId: resolved } : null;
}

async function resolveImdbId(
  meta = {},
  fallbackItemId = "",
  fallbackItemType = "",
  mediaType = "movie"
) {
  const directImdb = firstNonEmpty(
    extractImdbId(meta?.id),
    extractImdbId(fallbackItemId),
    extractImdbId(meta?.imdbId),
    extractImdbId(meta?.imdb_id),
    extractImdbId(meta?.externalIds?.imdb),
    extractImdbId(meta?.external_ids?.imdb_id)
  );
  if (directImdb) {
    return directImdb;
  }

  const tmdbId = firstNonEmpty(
    extractTmdbId(meta?.id),
    extractTmdbId(fallbackItemId),
    meta?.tmdbId,
    meta?.tmdb_id,
    meta?.ids?.tmdb,
    meta?.externalIds?.tmdb,
    meta?.external_ids?.tmdb,
    /^\d+$/.test(String(meta?.id || "").trim()) ? meta.id : "",
    /^\d+$/.test(String(fallbackItemId || "").trim()) ? fallbackItemId : ""
  );
  if (tmdbId) {
    const mapped = await TmdbService.tmdbToImdb(tmdbId, fallbackItemType || mediaType);
    if (mapped) {
      return mapped;
    }
  }

  const lookupType = fallbackItemType || mediaType;
  const convertedTmdbId = await TmdbService.ensureTmdbId(meta?.id, lookupType, {
    requireEnabled: false
  });
  if (convertedTmdbId) {
    const mapped = await TmdbService.tmdbToImdb(convertedTmdbId, lookupType);
    if (mapped) {
      return mapped;
    }
  }

  return null;
}

async function getCachedOrFetch(cacheKey, factory) {
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }
  const promise = factory()
    .then((result) => {
      cacheSet(cacheKey, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });
  inFlight.set(cacheKey, promise);
  return promise;
}

export const mdbListRepository = {
  async validateApiKey(apiKey) {
    const trimmed = String(apiKey || "").trim();
    if (!trimmed) {
      return true;
    }
    try {
      const response = await fetchMdbList(
        `${API_BASE_URL}/user?apikey=${encodeURIComponent(trimmed)}`
      );
      return response.ok;
    } catch (_error) {
      return false;
    }
  },

  async getImdbRatingForItem(itemId, itemType = "movie") {
    const settings = MdbListSettingsStore.get();
    if (!settings.enabled) {
      return null;
    }
    const apiKey = String(settings.apiKey || "").trim();
    if (!apiKey) {
      return null;
    }

    const mediaType = normalizeMediaType(itemType);
    const ref = await resolveMediaRef({ id: itemId }, itemId, itemType, mediaType);
    if (!ref) return null;
    const cacheKey = `${ref.provider}:${mediaType}:${ref.mediaId}:${javaStringHash(apiKey)}`;
    const result = await getCachedOrFetch(cacheKey, () =>
      fetchRatings({ ...ref, mediaType, apiKey })
    );
    return result?.ratings?.imdb ?? null;
  },

  async getRatingsForMeta(meta = {}, fallbackItemId = "", fallbackItemType = "movie") {
    const settings = MdbListSettingsStore.get();
    if (!settings.enabled) {
      return null;
    }
    const apiKey = String(settings.apiKey || "").trim();
    if (!apiKey) {
      return null;
    }
    const providers = enabledProviders(settings);
    if (!providers.length) {
      return null;
    }

    const mediaType = normalizeMediaType(meta?.apiType || fallbackItemType);
    const ref = await resolveMediaRef(meta, fallbackItemId, fallbackItemType, mediaType);
    if (!ref) return null;
    const cacheKey = `${ref.provider}:${mediaType}:${ref.mediaId}:${javaStringHash(apiKey)}`;
    const result = await getCachedOrFetch(cacheKey, () =>
      fetchRatings({ ...ref, mediaType, apiKey })
    );
    if (!result) return null;
    const selected = new Set(providers.map((provider) => provider.key));
    const ratings = Object.fromEntries(
      Object.values(PROVIDERS).map((provider) => [
        provider.key,
        selected.has(provider.key) ? result.ratings[provider.key] : null
      ])
    );
    ratings.tomatoesCertified = ratings.tomatoes != null && result.ratings.tomatoesCertified;
    ratings.audienceCertified = ratings.audience != null && result.ratings.audienceCertified;
    return { ratings, hasImdbRating: ratings.imdb != null };
  }
};
