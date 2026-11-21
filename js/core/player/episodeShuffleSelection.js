import { ProfileManager } from "../profile/profileManager.js";
import { EpisodeShuffleStore } from "../../data/local/episodeShuffleStore.js";
import { WatchedItemsStore } from "../../data/local/watchedItemsStore.js";
import { WatchProgressStore } from "../../data/local/watchProgressStore.js";
import { watchedItemsShareIdentity } from "../../data/repository/watchedIdentity.js";
import { EpisodeShuffle, episodeKey } from "./episodeShuffle.js";
import { LocalStore } from "../storage/localStore.js";

const localStates = new Map();
function localState(profileId) {
  const revision = `${LocalStore.revision("watchedItems")}:${LocalStore.revision("watchProgressItems")}`;
  const cached = localStates.get(String(profileId));
  if (cached?.revision === revision) return cached;
  const state = {
    revision,
    watched: WatchedItemsStore.listForProfile(profileId),
    progress: WatchProgressStore.listForProfile(profileId)
  };
  localStates.set(String(profileId), state);
  while (localStates.size > 6) localStates.delete(localStates.keys().next().value);
  return state;
}

export function selectShuffleEpisode({
  contentId,
  contentType = "series",
  videos,
  surface,
  current = null,
  visit = 0,
  preferredVideoId = null,
  watched = new Set(),
  progress = new Map(),
  reference = {},
  profileId = ProfileManager.getActiveProfileId(),
  settings = null,
  useLocalState = true
}) {
  const config = settings || EpisodeShuffleStore.get(contentId, contentType, profileId);
  if (!config.enabled) {
    EpisodeShuffle.clearSelection(profileId, contentId, surface);
    return null;
  }
  const identity = { ...reference, contentId, contentType };
  const matches = (item) =>
    ["series", "tv", "show", "anime"].includes(
      String(item.contentType || item.type).toLowerCase()
    ) && watchedItemsShareIdentity(item, identity);
  const combinedWatched = new Set(watched),
    combinedProgress = new Map(progress);
  const state = useLocalState ? localState(profileId) : { watched: [], progress: [] };
  for (const item of state.watched)
    if (matches(item) && item.season != null && item.episode != null)
      combinedWatched.add(episodeKey(item));
  for (const item of state.progress) {
    if (matches(item) && item.season != null && item.episode != null) {
      const key = episodeKey(item),
        previous = combinedProgress.get(key);
      if (!previous || Number(previous.updatedAt || 0) < Number(item.updatedAt || 0))
        combinedProgress.set(key, item);
    }
  }
  return EpisodeShuffle.select({
    profileId,
    contentId,
    videos,
    includeWatched: config.includeWatched,
    watched: combinedWatched,
    progress: combinedProgress,
    surface,
    current: current ? episodeKey(current) : null,
    visit,
    preferredVideoId
  });
}
