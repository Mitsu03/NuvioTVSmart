import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hasUpcomingEpisode,
  parseSimklEpisodeReleases,
  simklEpisodeSourcesFor,
  simklEpisodeSourcesFromSearch,
  usesTvdbStyleNumbering,
  withEarlierSimklReleases
} from "./simklEpisodeReleases.js";

// Shape of /anime/episodes/{id}?extended=full for a series streamed five days before broadcast.
const earlyStreamAnimeEpisodes = [
  {
    type: "episode",
    episode: 1,
    date: "2026-09-27T23:30:00+09:00",
    tvdb: { season: 1, episode: 1 }
  },
  {
    type: "episode",
    episode: 2,
    date: "2026-10-04T23:30:00+09:00",
    tvdb: { season: 1, episode: 2 }
  },
  {
    type: "episode",
    episode: 2,
    date: "2026-10-04T23:30:00+09:00",
    tvdb: { season: 1, episode: 2 }
  },
  {
    type: "episode",
    episode: 3,
    date: "2026-10-11T23:30:00+09:00",
    tvdb: { season: 1, episode: 3 }
  },
  { type: "episode", episode: 4, date: null, tvdb: { season: 1, episode: 4 } },
  { type: "episode", episode: 5, date: "2026-10-25T23:30:00+09:00", tvdb: null },
  {
    type: "special",
    episode: 1,
    date: "2026-09-20T23:30:00+09:00",
    tvdb: { season: 1, episode: 1 }
  }
];

// Shape of /tv/episodes/{id}?extended=full.
const showEpisodes = [
  { type: "episode", season: 1, episode: 9, date: "2023-03-12T21:00:00-04:00" },
  { type: "episode", season: 2, episode: 1, date: "2025-04-13T21:00:00-04:00" },
  { type: "special", season: 0, episode: 55, date: "2025-04-23T21:00:00-04:00" },
  { type: "episode", season: 2, episode: 2, date: "2025-04-20" }
];

function iso(releases) {
  return Object.fromEntries(
    Array.from(releases.entries()).map(([key, ms]) => [key, new Date(ms).toISOString()])
  );
}

test("anime releases are keyed by the tvdb mapping and repeated episodes collapse", () => {
  assert.deepEqual(iso(parseSimklEpisodeReleases(earlyStreamAnimeEpisodes, { isAnime: true })), {
    "1:1": "2026-09-27T14:30:00.000Z",
    "1:2": "2026-10-04T14:30:00.000Z",
    "1:3": "2026-10-11T14:30:00.000Z"
  });
});

test("show releases use their own season numbering and utc offset", () => {
  assert.deepEqual(iso(parseSimklEpisodeReleases(showEpisodes)), {
    "1:9": "2023-03-13T01:00:00.000Z",
    "2:1": "2025-04-14T01:00:00.000Z"
  });
});

test("an earlier simkl date replaces the broadcast date", () => {
  const releases = parseSimklEpisodeReleases(earlyStreamAnimeEpisodes, { isAnime: true });
  const videos = [
    { id: "tt1:1:2", season: 1, episode: 2, released: "2026-10-09T00:00:00.000Z" },
    { id: "tt1:1:3", season: 1, number: 3, firstAired: "2026-10-16T00:00:00.000Z" }
  ];

  assert.deepEqual(withEarlierSimklReleases(videos, releases), [
    { ...videos[0], released: "2026-10-04T14:30:00.000Z", simklReleased: true },
    { ...videos[1], released: "2026-10-11T14:30:00.000Z", simklReleased: true }
  ]);
});

test("a later or missing simkl date keeps the addon date", () => {
  const releases = new Map([
    ["1:1", Date.parse("2026-10-20T00:00:00Z")],
    ["1:2", Date.parse("2026-10-01T00:00:00Z")]
  ]);
  const videos = [
    { season: 1, episode: 1, released: "2026-10-16T00:00:00.000Z" },
    { season: 1, episode: 2 },
    { season: 4, episode: 2, released: "2026-10-09T16:15:00.000Z" },
    { released: "2026-10-16T00:00:00.000Z" }
  ];

  assert.deepEqual(withEarlierSimklReleases(videos, releases), videos);
});

test("a date only addon release is compared from midnight utc", () => {
  const releases = new Map([["1:3", Date.parse("2026-10-16T03:00:00+09:00")]]);

  assert.equal(
    withEarlierSimklReleases([{ season: 1, episode: 3, released: "2026-10-16" }], releases)[0]
      .released,
    "2026-10-15T18:00:00.000Z"
  );
});

test("only an episode still listed as unaired triggers a lookup", () => {
  const now = Date.parse("2026-10-11T20:00:00Z");
  assert.equal(
    hasUpcomingEpisode([{ season: 1, episode: 3, released: "2026-10-16T00:00:00.000Z" }], now),
    true
  );
  assert.equal(
    hasUpcomingEpisode([{ season: 1, episode: 2, released: "2026-10-09T00:00:00.000Z" }], now),
    false
  );
  assert.equal(hasUpcomingEpisode([{ released: "2026-10-16T00:00:00.000Z" }], now), false);
});

test("library lookup returns every season entry of a series and skips movies", () => {
  const entries = [
    { mediaType: "anime", show: { ids: { simkl: 1372805, imdb: "tt13196080" } } },
    { mediaType: "anime", show: { ids: { simkl: "2600001", imdb: "tt13196080" } } },
    { mediaType: "shows", show: { ids: { simkl: 1482218, imdb: "tt3581920", tmdb: "100088" } } },
    { mediaType: "movies", movie: { ids: { simkl: 99, imdb: "tt13196080" } } }
  ];

  assert.deepEqual(simklEpisodeSourcesFor(entries, ["tt13196080"]), [
    { path: "anime", simklId: 2600001 },
    { path: "anime", simklId: 1372805 }
  ]);
  assert.deepEqual(simklEpisodeSourcesFor(entries, ["tmdb:100088"]), [
    { path: "tv", simklId: 1482218 }
  ]);
  assert.deepEqual(simklEpisodeSourcesFor(entries, ["tt0000001"]), []);
  assert.deepEqual(simklEpisodeSourcesFor(entries, ["kitsu:1"]), []);
});

test("search results map shows and anime to their episode endpoints", () => {
  assert.deepEqual(
    simklEpisodeSourcesFromSearch([
      { type: "tv", ids: { simkl: 1482218 } },
      { type: "anime", ids: { simkl: 3140896 } },
      { type: "movie", ids: { simkl: 7 } },
      { type: "show", ids: { simkl: 42 } }
    ]),
    [
      { path: "tv", simklId: 1482218 },
      { path: "anime", simklId: 3140896 },
      { path: "tv", simklId: 42 }
    ]
  );
});

test("only imdb, tmdb and tvdb ids share simkl's tvdb numbering", () => {
  assert.equal(usesTvdbStyleNumbering("tt43691353"), true);
  assert.equal(usesTvdbStyleNumbering("tmdb:324502"), true);
  assert.equal(usesTvdbStyleNumbering("kitsu:50743"), false);
  assert.equal(usesTvdbStyleNumbering("mal:64340"), false);
});
