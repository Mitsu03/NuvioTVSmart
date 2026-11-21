import { addonRepository } from "../../data/repository/addonRepository.js";
import { catalogRepository } from "../../data/repository/catalogRepository.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import {
  catalogRequiresExtras,
  catalogShouldShowOnHome,
  catalogSkipStep,
  catalogSupportsExtra,
  buildCatalogOrderKey
} from "../../core/addons/homeCatalogs.js";
import { filterReleasedItems } from "../../core/util/releaseInfoUtils.js";
import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";
import { TmdbService } from "../../core/tmdb/tmdbService.js";
import { TmdbMetadataService } from "../../core/tmdb/tmdbMetadataService.js";
import { mapWithConcurrency } from "../../core/network/mapWithConcurrency.js";
import { localizedGenreLabel } from "../../i18n/genreLabels.js";

export async function getAmbientCatalogs() {
  const addons = await addonRepository.getInstalledAddons({ includeMediaServers: true });
  return addons.flatMap((addon) =>
    (addon.catalogs || [])
      .filter((catalog) => !catalogRequiresExtras(catalog))
      .map((catalog) => ({
        key: buildCatalogOrderKey(addon.id, catalog.apiType || catalog.type, catalog.id),
        title: catalog.name || catalog.id,
        source: addon.displayName || addon.name || addon.id,
        addon,
        catalog
      }))
  );
}
export function chooseAmbientCatalogs(catalogs, keys, heroKeys = []) {
  const selected = (keys.length ? keys : heroKeys)
    .map((key) => catalogs.find((entry) => entry.key === key))
    .filter(Boolean);
  return (
    selected.length
      ? selected
      : catalogs.filter((entry) => catalogShouldShowOnHome(entry.catalog)).slice(0, 1)
  ).slice(0, 3);
}
export function interleaveAmbientRows(rows) {
  const seen = new Set();
  const result = [];
  const longest = Math.max(0, ...rows.map((row) => row.length));
  for (let index = 0; index < longest; index++)
    for (const row of rows) {
      const item = row[index];
      if (!item) continue;
      const key = `${item.apiType || item.type}:${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
  return result.slice(0, 30);
}
function ambientEnrichmentWithinBudget(task, fallback, signal, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const abort = () => finish(fallback);
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    Promise.resolve().then(task).then(finish, abort);
  });
}
export async function loadAmbientSlides(keys, signal) {
  const prefs = LayoutPreferences.get();
  const selected = chooseAmbientCatalogs(
    await getAmbientCatalogs(),
    keys,
    prefs.heroCatalogKeys || []
  );
  const rows = await Promise.all(
    selected.map(async ({ addon, catalog }) => {
      try {
        const result = await catalogRepository.getCatalog({
          addonBaseUrl: addon.baseUrl,
          addonId: addon.id,
          addonName: addon.displayName || addon.name,
          catalogId: catalog.id,
          catalogName: catalog.name,
          type: catalog.apiType || catalog.type,
          skip: 0,
          skipStep: catalogSkipStep(catalog),
          supportsSkip: catalogSupportsExtra(catalog, "skip"),
          signal
        });
        const items = result?.status === "success" ? result.data?.items || [] : [];
        return (prefs.hideUnreleasedContent ? filterReleasedItems(items) : items).slice(0, 10);
      } catch (_) {
        return [];
      }
    })
  );
  const settings = TmdbSettingsStore.get();
  const deadline = Date.now() + 15000;
  const items = await mapWithConcurrency(interleaveAmbientRows(rows), 2, async (item) => {
    if (
      signal?.aborted ||
      Date.now() >= deadline ||
      !settings.enabled ||
      !(settings.useArtwork || settings.useBasicInfo || settings.useDetails)
    )
      return item;
    try {
      const id = await ambientEnrichmentWithinBudget(
        () => TmdbService.ensureTmdbId(item.id, item.apiType || item.type),
        null,
        signal,
        Math.min(3000, Math.max(1, deadline - Date.now()))
      );
      if (!id || signal?.aborted) return item;
      const meta = await ambientEnrichmentWithinBudget(
        () =>
          TmdbMetadataService.fetchEnrichment({
            tmdbId: id,
            contentType: item.apiType || item.type,
            language: settings.language
          }),
        null,
        signal,
        Math.min(3000, Math.max(1, deadline - Date.now()))
      );
      return {
        ...item,
        name: settings.useBasicInfo ? meta?.localizedTitle || item.name : item.name,
        genres: settings.useBasicInfo ? meta?.genres || item.genres : item.genres,
        background: settings.useArtwork ? meta?.backdrop || item.background : item.background,
        logo: settings.useArtwork ? meta?.logo || item.logo : item.logo
      };
    } catch (_) {
      return item;
    }
  });
  return items
    .map((item) => ({
      id: `${item.apiType || item.type}:${item.id}`,
      title: item.name || "",
      backdropUrl: item.background || item.landscapePoster,
      logoUrl: item.logo || null,
      genres: (item.genres || []).slice(0, 3).map(localizedGenreLabel)
    }))
    .filter((slide) => slide.backdropUrl);
}
