import assert from "node:assert/strict";
import {
  RandomEpisodePicker,
  createEpisodeShuffle,
  shuffleCandidates
} from "../js/core/player/episodeShuffle.js";
const videos = [1, 2, 3, 4].map((episode) => ({
  id: `e${episode}`,
  season: 1,
  episode,
  released: "2020-01-01"
}));
const now = Date.parse("2026-10-16T12:00:00Z");
assert.deepEqual(
  shuffleCandidates(
    [
      ...videos,
      { id: "special", season: 0, episode: 1 },
      { ...videos[0], id: "duplicate" },
      { id: "future-first", season: 2, episode: 1, released: "2030-01-01" },
      { id: "future-season-second", season: 2, episode: 2 },
      { id: "unavailable", season: 3, episode: 1, available: false },
      { id: "later", season: 3, episode: 2 }
    ],
    now
  ).map((e) => e.id),
  videos.map((e) => e.id)
);
const picker = new RandomEpisodePicker(
  "show",
  videos,
  new Set(["1:1"]),
  new Map([["1:2", { positionMs: 91, durationMs: 100 }]]),
  () => 0
);
assert.equal(picker.pick(false).id, "e3");
assert.equal(picker.pick(false).id, "e4");
assert.equal(picker.pick(false).id, "e3");
assert.equal(picker.pick(true, "1:1").id, "e2");
const preview = new RandomEpisodePicker("show", videos, new Set(), new Map(), () => 0);
preview.recordPlayed("1:1");
assert.equal(preview.pick(true, "1:1", false).id, "e2");
assert(!preview.shown.has("e2"));
preview.recordPlayed("1:2");
assert(preview.shown.has("e2"));
const shuffle = createEpisodeShuffle(() => 0);
const base = {
  profileId: 1,
  contentId: "show",
  videos,
  includeWatched: true,
  surface: "home",
  visit: 5
};
assert.equal(shuffle.select(base).id, "e1");
assert.equal(shuffle.select(base).id, "e1");
assert.equal(shuffle.select({ ...base, videos: [] }).id, "e1");
assert.equal(shuffle.select({ ...base, visit: 4 }).id, "e1");
assert.equal(shuffle.select({ ...base, visit: 6 }).id, "e2");
assert.equal(shuffle.select({ ...base, profileId: 2 }).id, "e1");
assert.equal(shuffle.select({ ...base, surface: "detail" }).id, "e1");
shuffle.clearSelection(1, "show", "detail");
assert.equal(shuffle.select({ ...base, surface: "detail" }).id, "e2");
assert.equal(shuffle.select({ ...base, surface: "playback", current: "1:1" }).id, "e2");
assert.equal(shuffle.select({ ...base, surface: "playback", current: "1:2" }).id, "e3");
assert.equal(shuffle.select({ ...base, contentId: "empty", videos: [], surface: "detail" }), null);
// Persistent preferences remain disabled until the profile's global gate is on.
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k)
};
const { EpisodeShuffleStore: store } = await import("../js/data/local/episodeShuffleStore.js");
const { LayoutPreferences: layout } = await import("../js/data/local/layoutPreferences.js");
assert(store.save("show", { enabled: true, includeWatched: true }, "1"));
assert.equal(store.get("show", "series", "1").enabled, false);
layout.setForProfile("1", { randomEpisodeEnabled: true }, { silentSync: true });
assert.equal(store.get("show", "series", "1").enabled, true);
assert.equal(store.get("show", "movie", "1").enabled, false);
assert.equal(store.get("show", "series", "2").enabled, false);
layout.setForProfile("1", { randomEpisodeEnabled: false }, { silentSync: true });
assert.equal(store.get("show", "series", "1").includeWatched, true);
console.log(
  "Shuffle parity fixtures passed: availability, watched/completed filtering, history, previews, stable Home refresh, visit ordering, profile/surface isolation and global gate."
);
