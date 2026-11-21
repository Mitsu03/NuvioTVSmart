import { ProfileManager } from "../../../core/profile/profileManager.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { watchedItemsShareIdentity } from "../../../data/repository/watchedIdentity.js";
import { EpisodeShuffleStore } from "../../../data/local/episodeShuffleStore.js";
import { episodeKey } from "../../../core/player/episodeShuffle.js";

export async function loadPlayerShuffleWatched(screen, mountToken) {
  const contentId = screen.params?.itemId || screen.params?.contentId;
  const contentType = screen.params?.itemType;
  if (!EpisodeShuffleStore.get(contentId, contentType).enabled) return;
  const profileId = ProfileManager.getActiveProfileId();
  const reference = { ...screen.params, contentId };
  try {
    const items = await watchedItemsRepository.getAll(5000, profileId);
    if (!screen.isActiveMountToken(mountToken) || ProfileManager.getActiveProfileId() !== profileId)
      return;
    screen.shuffleRemoteWatched = new Set(
      items
        .filter(
          (item) =>
            item.season != null &&
            item.episode != null &&
            watchedItemsShareIdentity(item, reference)
        )
        .map(episodeKey)
    );
    screen.shuffleNextCache = null;
  } catch (_) {
    // The local watched snapshot remains usable if the selected tracker fails.
  }
}
