import { showEpisodeImdbRating } from "../../../core/util/imdbRatingVisibility.js";
import { isWatchProgressCompleted } from "../../../domain/model/watchProgress.js";

export function continueWatchingRating(item = {}, visibility = "SHOW_ALL") {
  const isSeries = ["series", "tv", "anime", "show", "tvshow"].includes(
    String(item.contentType || item.type || item.apiType || "").toLowerCase()
  );
  const value = isSeries ? item.episodeImdbRating : item.imdbRating;
  if (
    isSeries &&
    !showEpisodeImdbRating(visibility, !item.isNextUp && isWatchProgressCompleted(item))
  ) {
    return null;
  }
  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : null;
}
