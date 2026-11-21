import { saveReusableStreamLink } from "../../../core/streams/streamLinkReuse.js";
import {
  canonicalStreamUrl,
  findRedirectTargetStream
} from "../../../core/player/streamRedirect.js";
import { buildStreamInfo, renderStreamInfo } from "./streamInfoOverlay.js";

export function handleListedStreamRedirect(screen, controller, detail = {}) {
  if (
    !Number.isInteger(detail?.playToken) ||
    !controller.isPlaybackRequestActive(
      detail.playToken,
      detail.playbackUrl || detail.requestedUrl
    ) ||
    canonicalStreamUrl(screen.activePlaybackUrl) !== canonicalStreamUrl(detail.requestedUrl)
  )
    return false;
  const target = findRedirectTargetStream(
    screen.streamCandidates || [],
    detail.requestedUrl,
    detail.resolvedUrl
  );
  if (!target || screen.getCurrentStreamCandidate() === target) return false;
  screen.currentStreamIndex = screen.streamCandidates.indexOf(target);
  screen.activePlaybackSourceContext = screen.getPlaybackSourceContext(target);
  controller.currentStreamIdentity = screen.buildPlaybackContext(target).streamIdentity;
  screen.rememberSelectedStreamPreference(target);
  saveReusableStreamLink(screen, target, { headers: controller.currentPlaybackHeaders || {} });
  if (screen.streamInfoVisible && screen.streamInfoOverlay) {
    screen.streamInfoOverlay.innerHTML = renderStreamInfo(buildStreamInfo(screen, controller));
  }
  // The transport keeps the original URL: seek/reopen may fail over again.
  return true;
}
