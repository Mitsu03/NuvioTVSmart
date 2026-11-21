// Only the response to the original media request can identify a listed release.
// Segment, subtitle and CDN URLs are never used as filename guesses.
export function canonicalStreamUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch (_) {
    return null;
  }
}

export function createStreamRedirectReporter(
  controller,
  requestedUrl,
  playToken,
  playbackUrl = requestedUrl
) {
  const requested = canonicalStreamUrl(requestedUrl);
  const requestToken = playToken ?? controller.playRequestToken;
  let lastReported = null;
  return (responseUrl) => {
    const resolved = canonicalStreamUrl(responseUrl);
    if (
      !requested ||
      !resolved ||
      requested === resolved ||
      resolved === lastReported ||
      !Number.isInteger(requestToken) ||
      !controller.isPlaybackRequestActive(requestToken, playbackUrl)
    )
      return;
    lastReported = resolved;
    controller.emitVideoEvent("streamredirect", {
      requestedUrl,
      resolvedUrl: resolved,
      playToken: requestToken,
      playbackUrl
    });
  };
}

function addonField(stream, key) {
  return String(stream?.[key] || stream?.raw?.[key] || stream?.streamOrigin?.[key] || "").trim();
}
function sameAddon(source, target) {
  // A configured addon URL distinguishes two installations with the same name/id.
  for (const key of ["addonBaseUrl", "addonId", "addonName"]) {
    const left = addonField(source, key);
    const right = addonField(target, key);
    if (left || right) return Boolean(left && right && left === right);
  }
  return false;
}
function isAddonStream(stream) {
  return (
    stream &&
    !stream.serverPlayback &&
    !stream.raw?.serverPlayback &&
    !stream.infoHash &&
    !stream.raw?.infoHash &&
    !stream.externalUrl
  );
}

export function findRedirectTargetStream(streams, requestedUrl, resolvedUrl) {
  const requested = canonicalStreamUrl(requestedUrl);
  const resolved = canonicalStreamUrl(resolvedUrl);
  if (!requested || !resolved || requested === resolved) return null;
  const sources = streams.filter(
    (stream) => isAddonStream(stream) && canonicalStreamUrl(stream.url) === requested
  );
  if (sources.length !== 1) return null;
  const query = new URL(requested).search;
  const matches = streams.filter((stream) => {
    if (!isAddonStream(stream) || !sameAddon(sources[0], stream)) return false;
    const candidate = canonicalStreamUrl(stream.url);
    if (!candidate || candidate === requested) return false;
    const forwarded = new URL(candidate);
    forwarded.search = query;
    return candidate === resolved || Boolean(query && forwarded.href === resolved);
  });
  // Ambiguous URLs cannot safely assign file/hash/size metadata.
  return matches.length === 1 ? matches[0] : null;
}
