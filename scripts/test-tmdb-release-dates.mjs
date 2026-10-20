import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("TMDB air dates can correct an addon date without changing episode text or Simkl dates", async () => {
  const settings = { enabled: true, useEpisodes: false, useReleaseDates: true };
  let seasonLookups = 0;
  const fixtures = {
    TMDB_API_KEY: "test-key",
    TmdbSettingsStore: { get: () => settings },
    TmdbService: { ensureTmdbId: async () => "123" },
    TmdbMetadataService: {
      fetchEnrichment: async () => ({ releaseInfo: "2017-2021" }),
      fetchEpisodeEnrichment: async () => {
        seasonLookups++;
        return new Map([
          ["1:1", { airDate: "2017-10-03", title: "TMDB title", overview: "TMDB overview" }],
          ["1:2", { airDate: "2017-10-10", title: "TMDB title 2" }]
        ]);
      }
    },
    isSeriesDetailMeta: () => true,
    mergeGenreLists: (genres) => genres
  };
  const source = await readFile(
    new URL("../js/ui/screens/detail/metaDetailsScreenMethods-06-enrich-meta.js", import.meta.url),
    "utf8"
  );
  const script = source
    .replace(/^import \* as internals from [^;]+;/m, "const internals = fixtures;")
    .replace(
      "export function createMetaDetailsScreenMethods06()",
      "function createMetaDetailsScreenMethods06()"
    )
    .concat("\ncreateMetaDetailsScreenMethods06;");
  const createMethods = vm.runInNewContext(script, { fixtures, console });
  const meta = {
    id: "black-clover",
    type: "series",
    name: "Black Clover",
    releaseInfo: "2017",
    videos: [
      {
        season: 1,
        episode: 1,
        title: "Addon title",
        overview: "Addon overview",
        released: "2017-10-02T23:00:00Z"
      },
      {
        season: 1,
        episode: 2,
        title: "Simkl title",
        released: "2017-10-09T14:00:00Z",
        simklReleased: true
      }
    ]
  };

  const withTmdbDates = await createMethods().enrichMeta.call({}, meta);
  assert.equal(seasonLookups, 1);
  assert.equal(withTmdbDates.videos[0].released, "2017-10-03");
  assert.equal(withTmdbDates.videos[0].title, "Addon title");
  assert.equal(withTmdbDates.videos[0].overview, "Addon overview");
  assert.equal(withTmdbDates.videos[1].released, "2017-10-09T14:00:00Z");

  settings.useReleaseDates = false;
  const withAddonDates = await createMethods().enrichMeta.call({}, meta);
  assert.equal(seasonLookups, 1);
  assert.equal(withAddonDates.videos[0].released, "2017-10-02T23:00:00Z");
});
