// Mirrors Android FilenameEpisodeMatcher, without lookbehind for older TV engines.
const sxe = /([sS])\s*(\d{1,3})\s*([eE])\s*(\d{1,4})/;
const cross = /(^|[^0-9])(\d{1,2})([xX])(\d{1,4})/;
const episodeOnly = /\b([eE][pP]?)([.\s]?)(\d{1,4})\b/;
const pad = (value, original) => String(value).padStart(original.length, "0");
export function buildNextFilename(
  filename,
  currentSeason,
  currentEpisode,
  nextSeason,
  nextEpisode
) {
  if (typeof filename !== "string" || !filename.trim()) return null;
  const replace = (match, replacement) =>
    filename.slice(0, match.index) + replacement + filename.slice(match.index + match[0].length);
  let match = sxe.exec(filename);
  if (
    match &&
    currentSeason != null &&
    Number(match[2]) === Number(currentSeason) &&
    Number(match[4]) === Number(currentEpisode)
  ) {
    return replace(
      match,
      `${match[1]}${pad(nextSeason ?? currentSeason, match[2])}${match[3]}${pad(nextEpisode, match[4])}`
    );
  }
  match = cross.exec(filename);
  if (
    match &&
    currentSeason != null &&
    Number(match[2]) === Number(currentSeason) &&
    Number(match[4]) === Number(currentEpisode)
  ) {
    return replace(
      match,
      `${match[1]}${pad(nextSeason ?? currentSeason, match[2])}${match[3]}${pad(nextEpisode, match[4])}`
    );
  }
  match = episodeOnly.exec(filename);
  return match && Number(match[3]) === Number(currentEpisode)
    ? replace(match, `${match[1]}${match[2]}${pad(nextEpisode, match[3])}`)
    : null;
}
export function extractSeasonEpisode(filename) {
  if (typeof filename !== "string" || !filename.trim()) return null;
  const match = sxe.exec(filename) || cross.exec(filename);
  if (match) return { season: Number(match[2]), episode: Number(match[4]) };
  const single = episodeOnly.exec(filename);
  return single ? { season: null, episode: Number(single[3]) } : null;
}
export function filenameMatches(candidate, expected) {
  return Boolean(
    typeof candidate === "string" &&
    candidate.trim() &&
    typeof expected === "string" &&
    expected.trim() &&
    candidate.toLowerCase() === expected.toLowerCase()
  );
}
export function expectedEpisodeFilename(filename, nextSeason, nextEpisode) {
  const current = extractSeasonEpisode(filename);
  return (
    (current &&
      buildNextFilename(filename, current.season, current.episode, nextSeason, nextEpisode)) ||
    filename ||
    null
  );
}
