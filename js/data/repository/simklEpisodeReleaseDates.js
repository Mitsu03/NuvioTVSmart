import { SIMKL_API_URL, SIMKL_APP_NAME, SIMKL_CLIENT_ID } from "../../config.js";
import { SimklAuthService } from "./simklAuthService.js";
import { SimklSyncService } from "./simklSyncService.js";
import {
  hasUpcomingEpisode,
  imdbIdOf,
  mergeSimklEpisodeReleases,
  parseSimklEpisodeReleases,
  simklEpisodeSourcesFor,
  simklEpisodeSourcesFromSearch,
  usesTvdbStyleNumbering,
  withEarlierSimklReleases
} from "./simklEpisodeReleases.js";

const RELEASES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RELEASES_FAILURE_CACHE_TTL_MS = 10 * 60 * 1000;
const RELEASE_DATES_TIMEOUT_MS = 5000;

const releasesCache = new Map();
const searchCache = new Map();

function cached(cache, key, nowMs) {
  const entry = cache.get(key);
  return entry && nowMs < entry.expiresAt ? entry : null;
}

/**
 * Plain fetch on purpose: simklRequest signs the profile out on any 401, and a read of public
 * episode data must never cost the viewer their Simkl session.
 */
async function fetchSimklJson(path, query = {}, accessToken = null) {
  const base = String(SIMKL_API_URL || "https://api.simkl.com").replace(/\/+$/, "");
  const url = new URL(`${base}${path}`);
  Object.keys(query).forEach((key) => url.searchParams.set(key, query[key]));
  url.searchParams.set("client_id", SIMKL_CLIENT_ID);
  url.searchParams.set("app-name", SIMKL_APP_NAME || "nuvio");
  const headers = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) throw new Error(`Simkl request failed (${response.status})`);
  return response.json();
}

async function releasesFor(source, nowMs) {
  const key = `${source.path}:${source.simklId}`;
  const hit = cached(releasesCache, key, nowMs);
  if (hit) return hit.releases;
  let releases = null;
  try {
    const episodes = await fetchSimklJson(`/${source.path}/episodes/${source.simklId}`, {
      extended: "full"
    });
    releases = parseSimklEpisodeReleases(episodes, { isAnime: source.path === "anime" });
  } catch (error) {
    console.warn("Simkl episode release lookup failed", key, error?.message || error);
  }
  releasesCache.set(key, {
    releases: releases || new Map(),
    expiresAt: nowMs + (releases ? RELEASES_CACHE_TTL_MS : RELEASES_FAILURE_CACHE_TTL_MS)
  });
  return releases || new Map();
}

/** Series the viewer has not added to Simkl yet. */
async function searchEpisodeSources(contentIds, nowMs) {
  const imdbId = imdbIdOf(contentIds);
  if (!imdbId) return [];
  const hit = cached(searchCache, imdbId, nowMs);
  if (hit) return hit.sources;
  const accessToken = SimklAuthService.getCurrentAuthState()?.accessToken || null;
  const sources = simklEpisodeSourcesFromSearch(
    await fetchSimklJson("/search/id", { imdb: imdbId }, accessToken)
  );
  searchCache.set(imdbId, { sources, expiresAt: nowMs + RELEASES_CACHE_TTL_MS });
  return sources;
}

async function applySimklReleaseDates(meta, nowMs) {
  if (!SIMKL_CLIENT_ID || !hasUpcomingEpisode(meta?.videos, nowMs)) return meta;
  const contentIds = [meta.id, meta.imdb_id, meta.imdbId]
    .map((value) => String(value || "").trim())
    .filter((value) => value && usesTvdbStyleNumbering(value));
  if (!contentIds.length) return meta;

  let sources = simklEpisodeSourcesFor(SimklSyncService.getSnapshot().entries, contentIds);
  if (!sources.length) sources = await searchEpisodeSources(contentIds, nowMs);
  if (!sources.length) return meta;

  const releases = new Map();
  for (const source of sources) {
    mergeSimklEpisodeReleases(releases, await releasesFor(source, nowMs));
  }
  const videos = withEarlierSimklReleases(meta.videos, releases);
  return videos === meta.videos ? meta : { ...meta, videos };
}

/** Never fails and never holds a meta load for long: any problem returns the meta unchanged. */
export async function withSimklReleaseDates(meta, nowMs = Date.now()) {
  if (!meta || !Array.isArray(meta.videos) || !meta.videos.length) return meta;
  let timer = null;
  try {
    return await Promise.race([
      applySimklReleaseDates(meta, nowMs),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(meta), RELEASE_DATES_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    console.warn("Simkl release dates unavailable", meta.id, error?.message || error);
    return meta;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
