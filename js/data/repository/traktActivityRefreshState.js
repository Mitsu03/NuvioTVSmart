// Trakt last_activities tracking shared by Continue Watching and the watched
// lists, mirroring Android's TraktProgressService refresh gating:
// - polls read last_activities and skip the remote reads when nothing changed;
// - only the watched list whose activity changed is refetched;
// - a watch action opens a short forced window; one completed forced refresh
//   closes it, and the first poll after the window rechecks playback and
//   history once more in case Trakt had not caught up with the action yet.

const DEFAULT_FORCE_REFRESH_WINDOW_MS = 30_000;

let forceRefreshWindowMs = DEFAULT_FORCE_REFRESH_WINDOW_MS;
let scopeKey = null;
let state = createState();
let actionGeneration = 0;

function createState() {
  return {
    lastKnownActivityFingerprint: null,
    lastKnownMoviesWatchedAt: null,
    lastKnownEpisodeActivityFingerprint: null,
    // Set when last_activities changed and cleared once a refresh completes, so
    // a superseded refresh does not leave that change unfetched.
    activityRefreshPending: false,
    watchedMoviesStale: true,
    watchedShowsStale: true,
    forceRefreshUntilMs: 0,
    progressRecheckAtMs: 0
  };
}

export function useTraktActivityScope(key) {
  const normalized = String(key || "");
  if (scopeKey !== normalized) {
    scopeKey = normalized;
    state = createState();
  }
  return state;
}

export function resetTraktActivityState() {
  scopeKey = null;
  state = createState();
  actionGeneration += 1;
}

export function getTraktActivityState() {
  return state;
}

/** Bumped by watch actions so an in-flight refresh started before them is not reused. */
export function getTraktActivityActionGeneration() {
  return actionGeneration;
}

export function setTraktForceRefreshWindowMs(ms) {
  forceRefreshWindowMs = Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_FORCE_REFRESH_WINDOW_MS;
}

/** Android refreshNow()/requestFastSync(): force refreshes for a short window after a watch action. */
export function requestTraktRefreshAfterWatchAction({ movies = false, shows = false } = {}) {
  if (movies) state.watchedMoviesStale = true;
  if (shows) state.watchedShowsStale = true;
  state.forceRefreshUntilMs = Date.now() + forceRefreshWindowMs;
  actionGeneration += 1;
}

/**
 * Applies a last_activities payload. Returns whether the activity fingerprint
 * changed, or null when last_activities could not be read.
 */
export function applyTraktLastActivities(activities) {
  if (activities === null || activities === undefined) return null;
  if (typeof activities !== "object" || Array.isArray(activities)) return true;
  const moviesWatchedAt = activities.movies?.watched_at ?? null;
  if (moviesWatchedAt !== state.lastKnownMoviesWatchedAt) {
    state.watchedMoviesStale = true;
    state.lastKnownMoviesWatchedAt = moviesWatchedAt;
  }
  const episodeFingerprint = [activities.episodes?.paused_at, activities.episodes?.watched_at]
    .filter((value) => value != null)
    .join("|");
  if (episodeFingerprint !== state.lastKnownEpisodeActivityFingerprint) {
    state.lastKnownEpisodeActivityFingerprint = episodeFingerprint;
    state.watchedShowsStale = true;
  }
  const fingerprint = [
    activities.movies?.paused_at,
    activities.movies?.watched_at,
    activities.episodes?.paused_at,
    activities.episodes?.watched_at
  ]
    .filter((value) => value != null)
    .join("|");
  const changed = fingerprint !== state.lastKnownActivityFingerprint;
  state.lastKnownActivityFingerprint = fingerprint;
  return changed;
}
