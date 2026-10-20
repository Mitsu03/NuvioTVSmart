/**
 * Meta addons date an episode by its television broadcast, so a series that streams ahead of the
 * broadcast is listed as unaired while it is already out. Simkl dates the first availability, so
 * when it has an earlier date for the same season and episode, that date replaces the addon's.
 *
 * This module is the pure half: parsing and comparing. simklEpisodeReleaseDates.js does the I/O.
 */

const MAX_SIMKL_ENTRIES_PER_SERIES = 6;
const SERIES_ID_KEYS = ["imdb", "tmdb", "tvdb"];
const ZONED_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Simkl numbers anime episodes per entry, so only its TVDB season/episode pair lines up with the
 * numbering of IMDB, TMDB and TVDB based meta. Kitsu, MAL and similar IDs number differently and
 * yield an empty object here.
 */
function parseSeriesIds(contentId) {
  const raw = String(contentId || "").trim();
  if (/^tt\d+/i.test(raw)) return { imdb: raw.split(":")[0].toLowerCase() };
  const match = raw.match(/^(imdb|tmdb|tvdb):([^:]+)/i);
  return match ? { [match[1].toLowerCase()]: match[2].toLowerCase() } : {};
}

export function usesTvdbStyleNumbering(contentId) {
  return Object.keys(parseSeriesIds(contentId)).length > 0;
}

export function imdbIdOf(contentIds = []) {
  for (const contentId of contentIds) {
    const imdb = parseSeriesIds(contentId).imdb;
    if (imdb) return imdb;
  }
  return null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function episodeKey(video = {}) {
  const season = positiveInteger(video.season ?? video.seasonNumber);
  const episode = positiveInteger(video.episode ?? video.number ?? video.episodeNumber);
  return season && episode ? `${season}:${episode}` : null;
}

function addonReleased(video = {}) {
  return (
    video.released ||
    video.releaseDate ||
    video.release_date ||
    video.firstAired ||
    video.first_aired ||
    video.airDate ||
    video.air_date ||
    ""
  );
}

/**
 * A zoned timestamp keeps its exact instant, a zoneless one is read in the viewer's timezone, and
 * a plain date counts from UTC midnight. Matches how Continue Watching reads `released`.
 */
function releaseInstant(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const exact = Date.parse(value);
    if (Number.isFinite(exact)) return exact;
  }
  const datePortion = (value.match(/\b\d{4}-\d{2}-\d{2}\b/) || [])[0];
  const dateMs = datePortion ? Date.parse(datePortion) : NaN;
  return Number.isFinite(dateMs) ? dateMs : null;
}

/** Only an episode the addon still lists as unaired can be wrong in a way that matters. */
export function hasUpcomingEpisode(videos = [], nowMs = Date.now()) {
  return (Array.isArray(videos) ? videos : []).some((video) => {
    if (!episodeKey(video)) return false;
    const released = releaseInstant(addonReleased(video));
    return released != null && released > nowMs;
  });
}

/**
 * Simkl entries to read episodes from: `{ path: "tv" | "anime", simklId }`. Every anime season is
 * its own entry sharing the franchise IDs, so several can match one series.
 */
export function simklEpisodeSourcesFor(entries = [], contentIds = []) {
  const wanted = contentIds.map(parseSeriesIds).filter((ids) => Object.keys(ids).length);
  if (!wanted.length) return [];
  const sources = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || entry.mediaType === "movies") return;
    const ids = (entry.show || entry.movie || {}).ids || {};
    const matches = wanted.some((candidate) =>
      SERIES_ID_KEYS.some(
        (key) => candidate[key] && String(ids[key] ?? "").toLowerCase() === candidate[key]
      )
    );
    if (!matches) return;
    const simklId = positiveInteger(ids.simkl ?? ids.simkl_id);
    if (!simklId) return;
    const path = entry.mediaType === "anime" ? "anime" : "tv";
    sources.set(`${path}:${simklId}`, { path, simklId });
  });
  return Array.from(sources.values())
    .sort((left, right) => right.simklId - left.simklId)
    .slice(0, MAX_SIMKL_ENTRIES_PER_SERIES);
}

export function simklEpisodeSourcesFromSearch(results = []) {
  const sources = new Map();
  (Array.isArray(results) ? results : []).forEach((result) => {
    const type = String(result?.type || "").toLowerCase();
    const path = type === "anime" ? "anime" : type === "tv" || type === "show" ? "tv" : null;
    const simklId = positiveInteger(result?.ids?.simkl ?? result?.ids?.simkl_id);
    if (path && simklId) sources.set(`${path}:${simklId}`, { path, simklId });
  });
  return Array.from(sources.values()).slice(0, MAX_SIMKL_ENTRIES_PER_SERIES);
}

/**
 * Maps "season:episode" to the release instant from a Simkl `/episodes` payload. Specials and
 * episodes without a zoned date are left out. Anime is keyed by its TVDB mapping only.
 */
export function parseSimklEpisodeReleases(episodes = [], { isAnime = false } = {}) {
  const releases = new Map();
  (Array.isArray(episodes) ? episodes : []).forEach((episode) => {
    if (!episode || String(episode.type || "").toLowerCase() !== "episode") return;
    const key = episodeKey(isAnime ? episode.tvdb || {} : episode);
    if (!key) return;
    const date = String(episode.date || "").trim();
    const released = ZONED_DATE_TIME.test(date) ? Date.parse(date) : NaN;
    if (!Number.isFinite(released)) return;
    if (!releases.has(key) || released < releases.get(key)) releases.set(key, released);
  });
  return releases;
}

/** Keeps the earlier of two release maps per episode. */
export function mergeSimklEpisodeReleases(target, incoming) {
  incoming.forEach((released, key) => {
    if (!target.has(key) || released < target.get(key)) target.set(key, released);
  });
  return target;
}

/**
 * Replaced episodes carry `simklReleased` so a later TMDB release date pass leaves them alone.
 */
export function withEarlierSimklReleases(videos = [], releases = new Map()) {
  if (!Array.isArray(videos) || !releases.size) return videos;
  let changed = false;
  const dated = videos.map((video) => {
    const key = episodeKey(video);
    const simklRelease = key ? releases.get(key) : undefined;
    if (simklRelease == null) return video;
    const addonRelease = releaseInstant(addonReleased(video));
    if (addonRelease == null || simklRelease >= addonRelease) return video;
    changed = true;
    return { ...video, released: new Date(simklRelease).toISOString(), simklReleased: true };
  });
  return changed ? dated : videos;
}
