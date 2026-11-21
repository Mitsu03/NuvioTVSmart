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
let failPath = "",
  malformed = false,
  requests = [];
globalThis.fetch = async (url) => {
  const u = new URL(url);
  requests.push(u.pathname + u.search);
  const body =
    u.pathname.includes("/history") && u.searchParams.get("page") === "1"
      ? Array.from({ length: 100 }, () => ({
          watched_at: "2026-10-15T00:00:00Z",
          movie: { title: "Fixture", ids: { imdb: "tt100" } }
        }))
      : [];
  return new Response(JSON.stringify(malformed ? {} : body), {
    status: failPath && (u.pathname + u.search).includes(failPath) ? 503 : 200
  });
};
failPath = "page=2";
await assert.rejects(() => TraktAuthService.fetchWatchHistory({ limit: 300 }));
failPath = "/playback/movies";
await assert.rejects(() => TraktAuthService.fetchPlaybackState());
failPath = "/playback/episodes";
await assert.rejects(() => TraktAuthService.fetchPlaybackState());
failPath = "";
malformed = true;
await assert.rejects(() => TraktAuthService.fetchPlaybackState());
malformed = false;
assert.deepEqual(await TraktAuthService.fetchPlaybackState(), []);
// Production repository functions; endpoints above and snapshots below are independent fixtures.
let clock = Date.now();
const realNow = Date.now;
Date.now = () => clock;
let playback = [
  {
    type: "movie",
    contentId: "tt100",
    videoId: "tt100",
    title: "Fixture",
    pausedAt: new Date(clock).toISOString(),
    progressPercent: 25
  }
];
let fail = false,
  calls = 0,
  deferred = null;
TraktAuthService.fetchWatchHistory = async () => [];
// Every poll reports a Trakt change here, so these cases exercise the remote reads.
let activityTick = 0;
TraktAuthService.fetchLastActivities = async () => (
  ++activityTick,
  { movies: { paused_at: String(activityTick) }, episodes: { watched_at: String(activityTick) } }
);
TraktAuthService.fetchPlaybackState = async () => {
  calls++;
  if (deferred) return deferred;
  if (fail) throw new Error("fixture outage");
  return playback;
};
TraktAuthService.fetchWatchedShows = async () => [];
const initial = await repo.getAllForContinueWatching();
assert(initial.some((i) => i.contentId === "tt100"));
clock += 31000;
fail = true;
assert.deepEqual(
  await repo.getAllForContinueWatching(),
  initial,
  "failed refresh retains the complete last snapshot"
);
assert.equal(
  repo.getContinueWatchingRemoteProgressState().loaded,
  false,
  "fallback is not a successful refresh"
);
const before = calls;
await repo.getAllForContinueWatching();
assert.equal(calls, before + 1, "failure does not renew snapshot TTL");
fail = false;
playback = [];
assert.deepEqual(
  await repo.getAllForContinueWatching(),
  [],
  "successful empty result really clears remote progress"
);
assert.equal(repo.getContinueWatchingRemoteProgressState().loaded, true);
// Initial failure in another profile must not borrow the first profile snapshot.
profile = "2";
auth("two");
fail = true;
await assert.rejects(() => repo.getAllForContinueWatching());
assert.equal(repo.getContinueWatchingRemoteProgressState().loaded, false);
fail = false;
playback = [
  {
    type: "movie",
    contentId: "tt200",
    videoId: "tt200",
    pausedAt: new Date(clock).toISOString(),
    progressPercent: 35
  }
];
await repo.getAllForContinueWatching();
clock += 31000;
let release;
deferred = new Promise((r) => {
  release = r;
});
const old = repo.getAllForContinueWatching();
const observed = assert.rejects(old);
await Promise.resolve();
await Promise.resolve();
profile = "3";
auth("three");
deferred = null;
playback = [];
await repo.getAllForContinueWatching();
release([{ type: "movie", contentId: "ttOLD", videoId: "ttOLD", progressPercent: 50 }]);
await observed;
assert.deepEqual(
  await repo.getAllForContinueWatching(),
  [],
  "late response cannot overwrite another profile"
);
// Strict watched reads propagate the failure even though ordinary callers retain fallback behavior.
profile = "4";
auth("four");
TraktAuthService.fetchWatchedShows = async () => {
  throw new Error("fixture watched outage");
};
await assert.rejects(() => watched.getRemoteTraktWatchedShows({ strict: true }));
// Timeout is an error, not an empty success; a late underlying completion is ignored.
profile = "5";
auth("five");
fail = false;
TraktAuthService.fetchWatchedShows = async () => [];
playback = [{ type: "movie", contentId: "tt500", videoId: "tt500", progressPercent: 25 }];
const beforeTimeout = await repo.getAllForContinueWatching();
clock += 31000;
let releaseTimeout;
deferred = new Promise((r) => {
  releaseTimeout = r;
});
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) =>
  ms === 10000
    ? (queueMicrotask(() => callback(...args)), null)
    : realTimeout(callback, ms, ...args);
assert.deepEqual(await repo.getAllForContinueWatching(), beforeTimeout);
globalThis.setTimeout = realTimeout;
assert.equal(repo.getContinueWatchingRemoteProgressState().loaded, false);
deferred = null;
playback = [];
assert.deepEqual(await repo.getAllForContinueWatching(), []);
releaseTimeout([{ type: "movie", contentId: "ttLATE", videoId: "ttLATE", progressPercent: 20 }]);
await Promise.resolve();
assert.deepEqual(await repo.getAllForContinueWatching(), []);
// Failure after reconnecting another account in the same profile cannot reuse the old cache.
auth("five-other");
fail = true;
await assert.rejects(() => repo.getAllForContinueWatching());
fail = false;
// Successful empty arrays remain authoritative; watched-only failures preserve the whole prior snapshot.
profile = "6";
auth("six");
playback = [{ type: "movie", contentId: "tt600", videoId: "tt600", progressPercent: 25 }];
const lastGood = await repo.getAllForContinueWatching();
clock += 31000;
TraktAuthService.fetchWatchedShows = async () => {
  throw new Error("fixture watched failure");
};
assert.deepEqual(await repo.getAllForContinueWatching(), lastGood);
assert.equal(repo.getContinueWatchingRemoteProgressState().loaded, false);
// Shared reads use a single request, and source changes invalidate in-flight work.
profile = "7";
auth("seven");
TraktAuthService.fetchWatchedShows = async () => [];
let resolveShared;
deferred = new Promise((r) => {
  resolveShared = r;
});
const countBefore = calls;
const first = repo.getAllForContinueWatching();
const second = repo.getAllForContinueWatching();
await new Promise((r) => setImmediate(r));
assert.equal(calls, countBefore + 1);
resolveShared([]);
await Promise.all([first, second]);
clock += 31000;
let resolveSource;
deferred = new Promise((r) => {
  resolveSource = r;
});
const sourceRequest = repo.getAllForContinueWatching();
const sourceRejected = assert.rejects(sourceRequest);
await Promise.resolve();
TraktSettingsStore.set({ watchProgressSource: "nuvio_sync" }, { silentSync: true });
resolveSource([]);
await sourceRejected;
deferred = null;
// A fallback read never rewrites or rolls back newer local progress.
profile = "8";
auth("eight");
playback = [{ type: "movie", contentId: "tt800", videoId: "tt800", progressPercent: 20 }];
await repo.getAllForContinueWatching();
clock += 31000;
const { WatchProgressStore } = await import("../js/data/local/watchProgressStore.js");
WatchProgressStore.upsert(
  {
    contentId: "ttLOCAL",
    videoId: "ttLOCAL",
    contentType: "movie",
    source: "trakt_playback",
    positionMs: 25000,
    durationMs: 100000,
    updatedAt: clock
  },
  profile
);
const localBefore = WatchProgressStore.listForProfile(profile);
fail = true;
await repo.getAllForContinueWatching();
assert.deepEqual(WatchProgressStore.listForProfile(profile), localBefore);
Date.now = realNow;
console.log(
  "Trakt failure parity passed: partial HTTP failures, malformed/empty results, cache retention/retry, initial failure, profile race, strict watched reads"
);
