import { hasPendingManualWatched } from "../mediaserver/manualServerWatched.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { metaRepository } from "./metaRepository.js";
import { watchedItemsRepository } from "./watchedItemsRepository.js";
import { watchProgressRepository } from "./watchProgressRepository.js";
import { detailWatchedEnrichmentService } from "./detailWatchedEnrichmentService.js";
import { watchedItemsShareIdentity } from "./watchedIdentity.js";
import { isWatchProgressCompleted } from "../../domain/model/watchProgress.js";

export function isSeriesType(type = "") {
  const normalized = String(type || "")
    .trim()
    .toLowerCase();
  return ["series", "tv", "anime", "show", "tvshow"].includes(normalized);
}

function isRemoteSimklSeriesMarker(item = {}, contentReference = {}) {
  return (
    String(item?.trackingProviderId || "").toLowerCase() === "simkl" &&
    watchedItemsShareIdentity(item, contentReference) &&
    item?.season == null &&
    item?.episode == null
  );
}

function firstPositiveInt(values = []) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

function parseSeasonEpisodeFromVideoId(rawId = "") {
  const id = String(rawId || "").trim();
  if (!id) {
    return null;
  }
  const parts = id.split(":");
  if (parts.length < 3) {
    return null;
  }
  const season = Number(parts[parts.length - 2]);
  const episode = Number(parts[parts.length - 1]);
  if (!Number.isInteger(season) || season <= 0 || !Number.isInteger(episode) || episode <= 0) {
    return null;
  }
  return { season, episode };
}

function normalizeEpisode(video = {}) {
  // An explicit specials season must not be inferred as season one.
  const declaredSeason = video.season ?? video.seasonNumber;
  if (declaredSeason != null && Number(declaredSeason) === 0) return null;
  const parsed = parseSeasonEpisodeFromVideoId(video.id);
  const episode = firstPositiveInt([
    video.episode,
    video.episodeNumber,
    video.number,
    parsed?.episode
  ]);
  const season =
    firstPositiveInt([video.season, video.seasonNumber, parsed?.season]) || (episode ? 1 : null);
  if (!video.id || !season || !episode) {
    return null;
  }
  return {
    id: String(video.id || ""),
    title: String(video.title || video.name || `S${season}E${episode}`),
    season,
    episode,
    released:
      video.released ||
      video.releaseDate ||
      video.release_date ||
      video.firstAired ||
      video.first_aired ||
      video.airDate ||
      video.air_date ||
      "",
    available: video.available
  };
}

function isFutureRelease(rawReleaseDate, today = new Date()) {
  const rawDate = String(rawReleaseDate || "").trim();
  if (!rawDate) {
    return false;
  }
  const parsed = Date.parse(rawDate);
  return Number.isFinite(parsed) && parsed > today.getTime();
}

function isReleasedEpisode(episode = {}, today = new Date()) {
  if (episode.available === false || isFutureRelease(episode.released, today)) {
    return false;
  }
  return true;
}

function watchedEpisodeKey(season, episode) {
  return `${Number(season)}:${Number(episode)}`;
}

export function getReleasedMainEpisodes(meta = {}) {
  const today = new Date();
  const candidates = (Array.isArray(meta?.videos) ? meta.videos : [])
    .map((video) => normalizeEpisode(video))
    .filter(Boolean)
    .filter((episode) => episode.season > 0);
  const unavailableSeasons = new Set();
  const episodesBySeason = new Map();
  candidates.forEach((episode) => {
    const seasonEpisodes = episodesBySeason.get(episode.season) || [];
    seasonEpisodes.push(episode);
    episodesBySeason.set(episode.season, seasonEpisodes);
  });
  episodesBySeason.forEach((seasonEpisodes, season) => {
    const firstEpisode = seasonEpisodes.reduce(
      (first, episode) => (!first || episode.episode < first.episode ? episode : first),
      null
    );
    if (firstEpisode?.available === false || isFutureRelease(firstEpisode?.released, today)) {
      unavailableSeasons.add(season);
    }
  });

  return candidates
    .filter((episode) => !unavailableSeasons.has(episode.season))
    .filter((episode) => isReleasedEpisode(episode, today))
    .sort((left, right) => {
      if (left.season !== right.season) {
        return left.season - right.season;
      }
      return left.episode - right.episode;
    });
}

function progressMatchesContent(progress = {}, contentReference = {}) {
  return watchedItemsShareIdentity(progress, contentReference);
}

function progressEpisodeKey(progress = {}) {
  const season = firstPositiveInt([progress.season, progress.seasonNumber]);
  const episode = firstPositiveInt([progress.episode, progress.episodeNumber]);
  if (season && episode) {
    return watchedEpisodeKey(season, episode);
  }
  const parsed = parseSeasonEpisodeFromVideoId(progress.videoId);
  return parsed ? watchedEpisodeKey(parsed.season, parsed.episode) : "";
}

function watchedItemEpisodeKey(item = {}) {
  if (item.season == null || item.episode == null) {
    return "";
  }
  return watchedEpisodeKey(item.season, item.episode);
}

function buildContentReference(contentId, meta = {}) {
  return {
    contentId,
    id: meta?.id,
    imdbId: meta?.imdbId || meta?.imdb_id || meta?.ids?.imdb || null,
    tmdbId: meta?.tmdbId ?? meta?.tmdb_id ?? meta?.ids?.tmdb ?? null,
    traktId: meta?.traktId ?? meta?.trakt_id ?? meta?.ids?.trakt ?? null,
    slug: meta?.slug || meta?.ids?.slug || null
  };
}

function buildProviderIdentityOptions(contentType, contentId, meta = {}) {
  return {
    contentType,
    title: meta?.name || meta?.title || contentId,
    imdbId: meta?.imdbId || meta?.imdb_id || meta?.ids?.imdb || null,
    tmdbId: meta?.tmdbId ?? meta?.tmdb_id ?? meta?.ids?.tmdb ?? null,
    traktId: meta?.traktId ?? meta?.trakt_id ?? meta?.ids?.trakt ?? null
  };
}

async function loadSeriesMeta(contentId, contentType, meta = null) {
  if (meta && Array.isArray(meta.videos)) {
    return meta;
  }
  try {
    const result = await metaRepository.getMetaFromAllAddons(contentType || "series", contentId);
    return result?.status === "success" ? result.data : result;
  } catch (error) {
    console.warn("[watchedSeries] failed to load series meta", error);
    return null;
  }
}

async function markReleasedEpisodes(
  contentId,
  contentType,
  meta,
  watchedAt = Date.now(),
  { skipTrackingWrite = false } = {}
) {
  const profileId = ProfileManager.getActiveProfileId();
  const episodes = getReleasedMainEpisodes(meta);
  if (!episodes.length) {
    return false;
  }
  const identityOptions = buildProviderIdentityOptions(contentType, contentId, meta);
  const watchedItems = episodes.map((episode) => ({
    contentId,
    ...identityOptions,
    contentType,
    title: episode.title || meta?.name || contentId,
    season: episode.season,
    episode: episode.episode,
    videoId: episode.id,
    released: episode.released,
    watchedAt
  }));
  const progressItems = episodes.map((episode) => ({
    contentId,
    contentType,
    imdbId: identityOptions.imdbId,
    tmdbId: identityOptions.tmdbId,
    traktId: identityOptions.traktId,
    videoId: episode.id,
    season: episode.season,
    episode: episode.episode,
    title: meta?.name || null,
    episodeTitle: episode.title || null,
    positionMs: 100,
    durationMs: 100,
    updatedAt: watchedAt
  }));
  const outcome = await watchedItemsRepository.markBatch(watchedItems, { skipTrackingWrite });
  if (ProfileManager.getActiveProfileId() !== profileId) {
    return false;
  }
  await watchProgressRepository.saveProgressBatch(
    progressItems.filter((item) =>
      outcome.succeeded.some((entry) => entry.videoId === item.videoId)
    )
  );
  return outcome.ok;
}

export const watchedSeriesReconciliationService = {
  isSeriesType,

  async reconcile(contentId, contentType = "series", options = {}) {
    const profileId = ProfileManager.getActiveProfileId();
    const normalizedContentId = String(contentId || "").trim();
    const normalizedType = String(contentType || "series").trim() || "series";
    // Do not promote optimistic episode writes to a confirmed whole-series badge.
    if (hasPendingManualWatched(normalizedContentId, profileId)) return false;
    if (!normalizedContentId || !isSeriesType(normalizedType)) {
      return false;
    }

    const meta = await loadSeriesMeta(normalizedContentId, normalizedType, options.meta || null);
    if (ProfileManager.getActiveProfileId() !== profileId) return false;
    const episodes = getReleasedMainEpisodes(meta || {});
    if (!episodes.length) {
      return false;
    }

    const contentReference = buildContentReference(normalizedContentId, meta);
    const [watchedItems, progressItems, hasSeriesMarker] = await Promise.all([
      watchedItemsRepository.getAll(5000).catch(() => []),
      watchProgressRepository.getAll().catch(() => []),
      watchedItemsRepository.isWatched(normalizedContentId).catch(() => false)
    ]);
    if (ProfileManager.getActiveProfileId() !== profileId) return false;
    const hasRemoteSimklSeriesMarker = watchedItems.some((item) =>
      isRemoteSimklSeriesMarker(item, contentReference)
    );

    const watchedEpisodeKeys = new Set();
    watchedItems.forEach((item) => {
      if (!watchedItemsShareIdentity(item, contentReference)) {
        return;
      }
      const key = watchedItemEpisodeKey(item);
      if (key) {
        watchedEpisodeKeys.add(key);
      }
    });
    progressItems.forEach((progress) => {
      if (
        !progressMatchesContent(progress, contentReference) ||
        !isWatchProgressCompleted(progress)
      ) {
        return;
      }
      const key = progressEpisodeKey(progress);
      if (key) {
        watchedEpisodeKeys.add(key);
      }
    });

    const completedEpisode = options.completedEpisode || null;
    if (completedEpisode?.season && completedEpisode?.episode) {
      watchedEpisodeKeys.add(watchedEpisodeKey(completedEpisode.season, completedEpisode.episode));
    }

    const allWatched = episodes.every((episode) =>
      watchedEpisodeKeys.has(watchedEpisodeKey(episode.season, episode.episode))
    );

    if (allWatched && !hasSeriesMarker) {
      await watchedItemsRepository.mark(
        {
          contentId: normalizedContentId,
          ...buildProviderIdentityOptions(normalizedType, normalizedContentId, meta),
          contentType: normalizedType,
          title: meta?.name || options.title || normalizedContentId,
          watchedAt: Date.now()
        },
        { skipTrackingWrite: true }
      );
      detailWatchedEnrichmentService.invalidateCache(normalizedContentId);
      return true;
    }

    // A completed Simkl entry with no episode history is projected as a root
    // watched marker, matching Android. It is provider state, not a local
    // marker inferred from the episodes currently returned by the meta addon,
    // so do not erase it merely because those episode rows are incomplete.
    if (!allWatched && hasSeriesMarker && !hasRemoteSimklSeriesMarker) {
      await watchedItemsRepository.unmark(normalizedContentId, {
        rootOnly: true,
        skipTrackingWrite: true
      });
      detailWatchedEnrichmentService.invalidateCache(normalizedContentId);
      return true;
    }

    return false;
  },

  async markSeriesWatched(contentId, contentType = "series", options = {}) {
    const normalizedContentId = String(contentId || "").trim();
    const normalizedType = String(contentType || "series").trim() || "series";
    if (!normalizedContentId || !isSeriesType(normalizedType)) {
      return false;
    }
    const watchedAt = Date.now();
    const profileId = ProfileManager.getActiveProfileId();
    const meta = await loadSeriesMeta(normalizedContentId, normalizedType, options.meta || null);
    if (ProfileManager.getActiveProfileId() !== profileId) {
      return false;
    }
    // Resolve episodes before mutating the local badge or any provider history.
    if (!getReleasedMainEpisodes(meta || {}).length) {
      return false;
    }
    const markedEpisodes = await markReleasedEpisodes(
      normalizedContentId,
      normalizedType,
      meta,
      watchedAt
    );
    if (!markedEpisodes) {
      detailWatchedEnrichmentService.invalidateCache(normalizedContentId);
      return false;
    }
    if (ProfileManager.getActiveProfileId() !== profileId) {
      return false;
    }
    await watchedItemsRepository.mark(
      {
        contentId: normalizedContentId,
        ...buildProviderIdentityOptions(normalizedType, normalizedContentId, meta),
        title: meta?.name || options.title || normalizedContentId,
        watchedAt
      },
      { skipTrackingWrite: true }
    );
    detailWatchedEnrichmentService.invalidateCache(normalizedContentId);
    return true;
  },

  async unmarkSeriesWatched(contentId, options = {}) {
    const normalizedContentId = String(contentId || "").trim();
    if (!normalizedContentId) {
      return false;
    }
    const normalizedType = String(options.contentType || "series").trim() || "series";
    const profileId = ProfileManager.getActiveProfileId();
    const meta = await loadSeriesMeta(normalizedContentId, normalizedType, options.meta || null);
    if (ProfileManager.getActiveProfileId() !== profileId) return false;
    const episodes = getReleasedMainEpisodes(meta || {});
    const providerOptions = buildProviderIdentityOptions(normalizedType, normalizedContentId, meta);
    if (!episodes.length) {
      // Catalog titles can still remove their stored episode history without
      // metadata. A native series needs exact episode refs; never guess its ID.
      if (normalizedContentId.startsWith("server:")) return false;
      const accepted = await watchedItemsRepository.unmark(normalizedContentId, providerOptions);
      if (accepted === false || ProfileManager.getActiveProfileId() !== profileId) return false;
      await watchProgressRepository.removeProgress(normalizedContentId);
      detailWatchedEnrichmentService.invalidateCache(normalizedContentId);
      return ProfileManager.getActiveProfileId() === profileId;
    }

    let complete = true;
    for (const episode of episodes) {
      if (ProfileManager.getActiveProfileId() !== profileId) return false;
      const accepted = await watchedItemsRepository.unmark(normalizedContentId, {
        ...providerOptions,
        season: episode.season,
        episode: episode.episode,
        videoId: episode.id,
        released: episode.released
      });
      if (accepted === false) {
        complete = false;
        continue;
      }
      await watchProgressRepository.removeProgress(normalizedContentId, episode.id);
    }
    if (ProfileManager.getActiveProfileId() !== profileId) return false;
    // A series marker is a local aggregate, never a server item write. Keep
    // failed episode entries intact while clearing the now-incomplete aggregate.
    await watchedItemsRepository.unmark(normalizedContentId, {
      ...providerOptions,
      rootOnly: true,
      skipTrackingWrite: !complete,
      skipServerWrite: true
    });
    if (complete) await watchProgressRepository.removeProgress(normalizedContentId);
    detailWatchedEnrichmentService.invalidateCache(normalizedContentId);
    return complete && ProfileManager.getActiveProfileId() === profileId;
  }
};
