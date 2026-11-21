import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { LayoutPreferences } from "./layoutPreferences.js";

const KEY = "episodeShuffle";
export const EpisodeShuffleStore = {
  get(contentId, contentType, profileId = ProfileManager.getActiveProfileId()) {
    const saved = LocalStore.get(KEY, {})?.[String(profileId)]?.[contentId] || {};
    return {
      enabled:
        saved.enabled === true &&
        LayoutPreferences.getForProfile(profileId).randomEpisodeEnabled &&
        ["series", "tv"].includes(String(contentType).toLowerCase()),
      includeWatched: saved.includeWatched === true
    };
  },
  save(contentId, settings, profileId = ProfileManager.getActiveProfileId()) {
    if (!String(contentId || "").trim()) return false;
    const all = LocalStore.get(KEY, {}),
      key = String(profileId);
    all[key] = {
      ...all[key],
      [contentId]: {
        enabled: settings.enabled === true,
        includeWatched: settings.includeWatched === true
      }
    };
    LocalStore.set(KEY, all);
    const saved = LocalStore.get(KEY, {})?.[key]?.[contentId];
    return (
      saved?.enabled === (settings.enabled === true) &&
      saved?.includeWatched === (settings.includeWatched === true)
    );
  }
};
