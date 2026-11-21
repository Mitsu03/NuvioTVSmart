import { isWatchProgressCompleted } from "../../domain/model/watchProgress.js";

let lastVisit = 0;
export function nextShuffleVisit() {
  lastVisit = Math.max(lastVisit + 1, Date.now());
  return lastVisit;
}
export const episodeKey = (episode) => `${Number(episode?.season)}:${Number(episode?.episode)}`;
function futureRelease(value, now) {
  if (!value) return false;
  const text = String(value).trim();
  const exact = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) ? Date.parse(text) : NaN;
  const embedded = (text.match(/\b\d{4}-\d{2}-\d{2}\b/) || [])[0];
  const timestamp = Number.isFinite(exact) ? exact : Date.parse(embedded || "");
  return Number.isFinite(timestamp) && timestamp > now;
}
export function shuffleCandidates(videos, now = Date.now()) {
  const candidates = (videos || []).filter(
    (v) => v.season != null && Number(v.season) > 0 && v.episode != null
  );
  const first = new Map();
  candidates.forEach((v) => {
    if (
      !first.has(Number(v.season)) ||
      Number(v.episode) < Number(first.get(Number(v.season)).episode)
    )
      first.set(Number(v.season), v);
  });
  const unavailable = new Set(
    [...first]
      .filter(([, v]) => v.available === false || futureRelease(v.released, now))
      .map(([s]) => s)
  );
  const coordinates = new Set(),
    ids = new Set();
  return candidates.filter((v) => {
    const key = episodeKey(v),
      id = String(v.id || "").trim();
    if (
      !id ||
      Number(v.episode) <= 0 ||
      unavailable.has(Number(v.season)) ||
      v.available === false ||
      futureRelease(v.released, now) ||
      coordinates.has(key) ||
      ids.has(id)
    )
      return false;
    coordinates.add(key);
    ids.add(id);
    return true;
  });
}
export class RandomEpisodePicker {
  constructor(contentId, videos, watched = new Set(), progress = new Map(), random = Math.random) {
    this.contentId = contentId;
    this.random = random;
    this.episodes = shuffleCandidates(videos);
    this.watched = new Set(watched);
    for (const [key, value] of progress) if (isWatchProgressCompleted(value)) this.watched.add(key);
    this.shown = new Set();
    this.lastPickedId = null;
  }
  candidates(includeWatched) {
    return includeWatched
      ? this.episodes
      : this.episodes.filter((v) => !this.watched.has(episodeKey(v)));
  }
  find(id, includeWatched, current = null) {
    return (
      this.candidates(includeWatched).find((v) => v.id === id && episodeKey(v) !== current) || null
    );
  }
  inherit(previous) {
    if (previous?.contentId !== this.contentId) return;
    this.shown = new Set(previous.shown);
    this.lastPickedId = previous.lastPickedId;
  }
  recordPlayed(current) {
    const video = this.episodes.find((v) => episodeKey(v) === current);
    if (video) this.shown.add(video.id);
  }
  pick(includeWatched, current = null, consumeSelection = true) {
    const candidates = this.candidates(includeWatched).filter((v) => episodeKey(v) !== current);
    if (!candidates.length) return null;
    let pool = candidates.filter((v) => !this.shown.has(v.id));
    if (!pool.length) {
      if (consumeSelection) candidates.forEach((v) => this.shown.delete(v.id));
      else this.shown.clear();
      pool = candidates.filter((v) => v.id !== this.lastPickedId);
      if (!pool.length) pool = candidates;
    }
    const selected =
      pool[Math.min(pool.length - 1, Math.max(0, Math.floor(this.random() * pool.length)))];
    if (consumeSelection) this.shown.add(selected.id);
    this.lastPickedId = selected.id;
    return selected;
  }
}
export function createEpisodeShuffle(random = Math.random) {
  const sessions = new Map();
  return {
    select({
      profileId,
      contentId,
      videos,
      includeWatched = false,
      watched = new Set(),
      progress = new Map(),
      surface,
      current = null,
      visit = 0,
      preferredVideoId = null
    }) {
      const key = JSON.stringify([String(profileId), contentId, surface, includeWatched]);
      const session = sessions.get(key) || {
        picker: null,
        selected: null,
        current: null,
        visit: 0
      };
      sessions.delete(key);
      sessions.set(key, session);
      while (sessions.size > 96) sessions.delete(sessions.keys().next().value);
      const picker = new RandomEpisodePicker(contentId, videos, watched, progress, random);
      picker.inherit(session.picker);
      if (current != null && (!session.picker || session.current !== current))
        picker.recordPlayed(current);
      session.picker = picker;
      const newerVisit = visit > session.visit;
      if (session.current !== current || newerVisit) session.selected = null;
      session.current = current;
      if (newerVisit) session.visit = visit;
      session.selected =
        (session.selected &&
          (picker.find(session.selected.id, includeWatched, current) ||
            (surface === "home" ? session.selected : null))) ||
        (preferredVideoId && picker.find(preferredVideoId, includeWatched, current)) ||
        picker.pick(includeWatched, current, surface !== "playback" || current == null);
      return session.selected;
    },
    clearSelection(profileId, contentId, surface) {
      for (const [key, session] of sessions) {
        const [profile, content, entrySurface] = JSON.parse(key);
        if (profile === String(profileId) && content === contentId && surface === entrySurface)
          session.selected = null;
      }
    }
  };
}
export const EpisodeShuffle = createEpisodeShuffle();
