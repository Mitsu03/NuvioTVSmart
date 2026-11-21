// Parity with Android TraktProgressServiceRefreshTest (8905c1c0c, 3a871400d):
// last_activities gating, per-list watched refetch, forced window after a watch
// action, single playback recheck after the window, cancelled-refresh recovery.
import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k)
};
const { TraktAuthService } = await import("../js/data/repository/traktAuthService.js");
const { TraktAuthStore } = await import("../js/data/local/traktAuthStore.js");
const { TraktSettingsStore } = await import("../js/data/local/traktSettingsStore.js");
const { ProfileManager } = await import("../js/core/profile/profileManager.js");
const { watchProgressRepository: repo } =
  await import("../js/data/repository/watchProgressRepository.js");
const { watchedItemsRepository: watched } =
  await import("../js/data/repository/watchedItemsRepository.js");
const { setTraktForceRefreshWindowMs } =
  await import("../js/data/repository/traktActivityRefreshState.js");

let profile = "1";
ProfileManager.getActiveProfileId = () => profile;
const auth = (name) => {
  TraktAuthStore.saveToken({
    access_token: "fixture",
    refresh_token: `fixture-${name}`,
    expires_in: 86400
  });
  TraktSettingsStore.set({ watchProgressSource: "trakt" }, { silentSync: true });
};
auth("one");
TraktAuthService.getValidAccessToken = async () => "fixture";
globalThis.fetch = async () => new Response("{}", { status: 200 });

let clock = Date.now();
Date.now = () => clock;
const counts = { activities: 0, playback: 0, history: 0, movies: 0, shows: 0 };
const reset = () =>
  Object.keys(counts).forEach((k) => {
    counts[k] = 0;
  });
let episodesWatchedAt = "2026-01-01T00:00:00.000Z";
let activitiesFail = false,
  playbackHangs = null;
TraktAuthService.fetchLastActivities = async () => {
  counts.activities++;
  if (activitiesFail) throw new Error("fixture 503");
  return {
    movies: { watched_at: "2026-01-01T00:00:00.000Z" },
    episodes: { watched_at: episodesWatchedAt }
  };
};
TraktAuthService.fetchPlaybackState = async () => {
  counts.playback++;
  if (playbackHangs) return playbackHangs;
  return [
    {
      type: "movie",
      contentId: "tt0000001",
      videoId: "tt0000001",
      title: "Movie",
      pausedAt: new Date(clock).toISOString(),
      progressPercent: 40
    }
  ];
};
TraktAuthService.fetchWatchHistory = async () => {
  counts.history++;
  return [];
};
TraktAuthService.fetchWatchedMovies = async () => {
  counts.movies++;
  return [];
};
TraktAuthService.fetchWatchedShows = async () => {
  counts.shows++;
  return [];
};
const TTL = 31000;
const poll = async () => {
  clock += TTL;
  return repo.getAllForContinueWatching();
};

async function loaded() {
  const items = await repo.getAllForContinueWatching();
  assert(items.some((i) => i.contentId === "tt0000001"));
  await watched.getAll();
  reset();
}

// Unchanged last_activities: polls read only last_activities.
await loaded();
await poll();
assert.deepEqual(
  counts,
  { activities: 1, playback: 0, history: 0, movies: 0, shows: 0 },
  "unchanged activity skips remote reads"
);
assert.equal(repo.getContinueWatchingRemoteProgressState().loaded, true);

// Watch action refetches only the changed watched list; the next poll skips it.
reset();
episodesWatchedAt = "2026-01-02T00:00:00.000Z";
await watched.mark(
  { contentId: "tt0000002", contentType: "series", season: 1, episode: 1 },
  { skipTrackingWrite: true }
);
await repo.getAllForContinueWatching();
assert.equal(counts.playback, 1, "forced refresh within TTL");
assert.equal(counts.shows, 1);
assert.equal(counts.movies, 0, "unchanged watched movies are not refetched");
reset();
await repo.getAllForContinueWatching();
assert.equal(counts.playback, 0, "one completed forced refresh closes the window");
await poll();
assert.equal(counts.playback, 1, "first poll after the window rechecks playback once");
assert.equal(counts.history, 1);
assert.equal(counts.shows, 0, "recheck does not refetch watched lists");
reset();
await poll();
assert.deepEqual(
  counts,
  { activities: 1, playback: 0, history: 0, movies: 0, shows: 0 },
  "later polls skip again"
);

// A short force window is honoured: recheck becomes due once it ends.
setTraktForceRefreshWindowMs(1000);
reset();
await watched.mark({ contentId: "tt0000003", contentType: "movie" }, { skipTrackingWrite: true });
await repo.getAllForContinueWatching();
assert.equal(counts.playback, 1);
reset();
clock += 1500;
await repo.getAllForContinueWatching();
assert.equal(
  counts.playback,
  1,
  "recheck right after a short window, even inside the snapshot TTL"
);
reset();
await repo.getAllForContinueWatching();
assert.equal(counts.playback, 0, "recheck runs once");
setTraktForceRefreshWindowMs();

// Forced refresh refetches both watched lists when last_activities fails.
reset();
activitiesFail = true;
repo.removeProgress("ttMissing");
await new Promise((r) => setImmediate(r));
await repo.getAllForContinueWatching();
assert.equal(counts.shows, 1);
assert.equal(watched && counts.playback, 1);
await watched.getAll();
assert.equal(counts.movies, 1, "watched movies refetched when activity is unknown");
// Unreadable activity outside the window keeps the snapshot and does not renew it.
reset();
clock += 31000;
activitiesFail = true;
await repo.getAllForContinueWatching();
await poll();
assert.equal(counts.playback, 1, "only the post-window recheck reads playback");
assert.equal(counts.activities, 2, "unreadable activity is retried by each poll");
activitiesFail = false;

// A change seen by a refresh that did not complete is still fetched by the next poll.
await poll();
reset();
episodesWatchedAt = "2026-01-03T00:00:00.000Z";
let fail;
playbackHangs = new Promise((_, r) => {
  fail = r;
});
clock += TTL;
const broken = repo.getAllForContinueWatching();
await new Promise((r) => setImmediate(r));
assert.equal(counts.playback, 1);
fail(new Error("fixture outage"));
playbackHangs = null;
await broken;
assert.equal(repo.getContinueWatchingRemoteProgressState().loaded, false);
reset();
await repo.getAllForContinueWatching();
assert.equal(
  counts.playback,
  1,
  "pending change refetched although last_activities is unchanged now"
);
reset();
await poll();
assert.equal(counts.playback, 0, "pending cleared after a completed refresh");

// Profile switch starts a fresh activity scope.
profile = "2";
auth("two");
reset();
await repo.getAllForContinueWatching();
assert.equal(counts.playback, 1, "new profile loads its own snapshot");

console.log(
  "Trakt activity refresh parity passed: last_activities gating, per-list watched refetch, forced window, single recheck, unreadable activity, incomplete refresh, profile scope"
);
