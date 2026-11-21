import { MediaServerRepository } from "./mediaServerRepository.js";

let active = null;
let timer = null;
let latest = null;
let chain = Promise.resolve();

function sameSession(left, right) {
  return Boolean(
    left &&
    right &&
    left.profileId === right.profileId &&
    left.connectionId === right.connectionId &&
    left.itemId === right.itemId &&
    left.mediaSourceId === right.mediaSourceId &&
    left.playSessionId === right.playSessionId
  );
}

function send(playback, event, context) {
  const position = Number(context?.positionMs || 0);
  chain = chain
    .catch(() => {})
    .then(() =>
      MediaServerRepository.report(playback, event, position, event === "pause" || event === "stop")
    )
    .catch(() => {});
  return chain;
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

export const MediaServerScrobbleService = {
  isEnabled() {
    return Boolean(active) || MediaServerRepository.connections().some((entry) => entry.enabled);
  },
  start(context) {
    const playback = context?.serverPlayback;
    stopTimer();
    if (!sameSession(active, playback)) {
      if (active) send(active, "stop", latest);
      active = playback || null;
      if (active) send(active, "start", context);
    } else {
      send(active, "resume", context);
    }
    latest = active ? context : null;
    if (active)
      timer = setInterval(() => {
        if (active && latest) send(active, "progress", latest);
      }, 10000);
  },
  update(context) {
    if (sameSession(active, context?.serverPlayback)) latest = context;
  },
  pause(context) {
    stopTimer();
    if (!sameSession(active, context?.serverPlayback)) return;
    send(active, "pause", context);
    latest = context;
  },
  stop(context) {
    stopTimer();
    if (active)
      send(active, "stop", sameSession(active, context?.serverPlayback) ? context : latest);
    active = null;
    latest = null;
  },
  cancel() {
    this.stop(latest);
  }
};
