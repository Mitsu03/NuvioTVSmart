// Android NuvioNavHost.openPartyMedia: open the party's title on the stream
// screen with manual selection, so everyone picks (or is shown) a source.
import { Router } from "../../navigation/routerState.js";

export function partyStreamRouteParams(media) {
  const season = media.season ?? null;
  const episode = media.episode ?? null;
  return {
    itemId: media.meta_id,
    itemType: media.type,
    videoId: media.video_id || media.meta_id,
    itemTitle: media.title || "",
    playerTitle: media.title || "",
    poster: media.poster || null,
    backdrop: media.background || null,
    logo: media.logo || null,
    season,
    episode,
    episodeTitle: media.episode_title || "",
    episodes: [],
    manualSelection: true
  };
}

export async function openPartyMedia(media) {
  if (!media) return;
  // From the player, replace it (Android pops the player before navigating).
  const fromPlayer = Router.getCurrent?.() === "player";
  await Router.navigate(
    "stream",
    partyStreamRouteParams(media),
    fromPlayer ? { skipStackPush: true, replaceHistory: true } : {}
  );
}
