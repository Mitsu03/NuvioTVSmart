import assert from "node:assert/strict";
import { createWebOsExactSeekMethods } from "../js/platform/webos/webosExactSeek.js";

class Clock {
  now = 0;
  next = 0;
  jobs = new Map();
  add(callback, ms, repeat = false) {
    const id = ++this.next;
    this.jobs.set(id, { callback, ms, repeat, at: this.now + ms });
    return id;
  }
  advance(ms) {
    const end = this.now + ms;
    while (true) {
      const entry = [...this.jobs]
        .filter(([, job]) => job.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, job] = entry;
      this.now = job.at;
      if (job.repeat) job.at += job.ms;
      else this.jobs.delete(id);
      job.callback();
    }
    this.now = end;
  }
}
class Video {
  currentTime = 60;
  duration = 200;
  readyState = 4;
  seeking = false;
  paused = false;
  ended = false;
  muted = false;
  listeners = [];
  addEventListener(type, callback, capture = false) {
    this.listeners.push({ type, callback, capture });
  }
  removeEventListener(type, callback, capture = false) {
    this.listeners = this.listeners.filter(
      (x) => x.type !== type || x.callback !== callback || x.capture !== capture
    );
  }
  dispatch(type) {
    let stopped = false;
    const event = {
      type,
      stopImmediatePropagation() {
        stopped = true;
      }
    };
    const list = this.listeners
      .filter((x) => x.type === type)
      .sort((a, b) => Number(b.capture) - Number(a.capture));
    for (const x of list) {
      x.callback(event);
      if (stopped) break;
    }
  }
  pause() {
    this.paused = true;
    this.dispatch("pause");
  }
  play() {
    if (this.rejectPlay) return Promise.reject(new Error("play rejected"));
    this.paused = false;
    this.dispatch("playing");
    return Promise.resolve();
  }
}
function fixture({ paused = false, muted = false } = {}) {
  const clock = new Clock();
  const video = new Video();
  video.paused = paused;
  video.muted = muted;
  const events = [];
  const visualEvents = [];
  const received = [];
  const methods = createWebOsExactSeekMethods({
    every: (cb, ms) => clock.add(cb, ms, true),
    stopEvery: (id) => clock.jobs.delete(id),
    later: (cb, ms) => clock.add(cb, ms),
    stopLater: (id) => clock.jobs.delete(id)
  });
  const controller = {
    ...methods,
    video,
    playRequestToken: 1,
    isPlaying: !paused,
    playbackEngine: "native-file",
    emitVideoEvent(type, detail) {
      (type === "webosexactseekvisual" ? visualEvents : events).push({ type, detail });
      video.dispatch(type);
    },
    syncWebOsPlaybackKeepAwake() {},
    scheduleProgressSyncAfterSeek() {
      this.progressSynced = true;
    }
  };
  for (const type of ["seeked", "canplay", "playing", "pause", "timeupdate", "error"]) {
    video.addEventListener(type, () => received.push(type));
  }
  return {
    clock,
    video,
    controller,
    events,
    visualEvents,
    received,
    move(time, ms = 50) {
      video.currentTime = time;
      video.dispatch("timeupdate");
      clock.advance(ms);
    }
  };
}

// seeked + readyState=4 only acknowledges the requested timestamp on LG.
{
  const f = fixture();
  assert(f.controller.seekWebOsExactly(100));
  assert.equal(f.video.muted, true);
  f.video.dispatch("seeked");
  f.clock.advance(1000);
  assert.equal(f.controller.isWebOsExactSeekInFlight(), true);
  assert.deepEqual(f.received, []);
  f.move(98.1);
  f.move(98.4);
  assert.equal(
    f.visualEvents.at(-1).detail.moving,
    true,
    "moving decoder can dismiss only the visual loader"
  );
  assert.equal(
    f.controller.isWebOsExactSeekInFlight(),
    true,
    "visual progress does not settle the seek"
  );
  assert.equal(f.video.muted, true, "visual progress does not release the decode audio gate");
  f.video.dispatch("waiting");
  assert.equal(
    f.visualEvents.at(-1).detail.moving,
    false,
    "native waiting restores the visual loader"
  );
  f.move(99.8);
  assert.equal(f.events.length, 0, "decode frames before the target are not reported as settled");
  f.move(100.05);
  assert.equal(f.controller.isWebOsExactSeekInFlight(), false);
  assert.equal(f.video.muted, false);
  assert.deepEqual(
    f.events.map((x) => x.type),
    ["seeked", "canplay", "playing"]
  );
  assert.equal(f.controller.progressSynced, true);
  assert.equal(f.clock.jobs.size, 0);
}
// A paused exact seek decodes internally, then preserves pause and user mute.
{
  const f = fixture({ paused: true, muted: true });
  f.controller.seekWebOsExactly(100, { paused: true });
  assert.equal(f.video.paused, false, "decoder must run to discard earlier keyframes");
  assert.deepEqual(f.received, [], "internal playing is not a user resume");
  f.move(99);
  f.move(99.5);
  f.move(100.1);
  assert.equal(f.video.paused, true);
  assert.equal(f.video.muted, true);
  assert.equal(f.controller.isPlaying, false);
  assert(!f.events.some((x) => x.type === "playing"));
}
// New group commands can supersede seeks and change pause intent in flight.
{
  const f = fixture();
  f.controller.seekWebOsExactly(100);
  assert(f.controller.setWebOsExactSeekPaused(true));
  f.controller.seekWebOsExactly(120, { paused: true });
  assert(f.controller.setWebOsExactSeekPaused(false));
  f.clock.advance(100);
  assert.equal(f.events.length, 0);
  f.move(118);
  f.move(118.5);
  f.move(119.2);
  f.move(120.1);
  assert.equal(f.video.paused, false);
  assert.equal(f.video.muted, false, "superseding keeps the original mute preference");
  assert.equal(f.events.filter((x) => x.type === "seeked").length, 1);
  assert.equal(f.controller.setWebOsExactSeekPaused(true), false);
}
// A backwards discontinuity cannot satisfy the post-seek movement requirement.
{
  const f = fixture();
  f.controller.seekWebOsExactly(100);
  f.move(99.5);
  f.move(99.7);
  f.move(100.5, 0);
  f.video.seeking = true;
  f.video.dispatch("seeking");
  f.clock.advance(50);
  assert.equal(f.events.length, 0);
  f.video.seeking = false;
  f.move(100.5);
  assert.equal(f.events.length, 0, "a provisional clock value is not advancement");
  f.move(100.7);
  assert.equal(f.controller.isWebOsExactSeekInFlight(), false);
}
// Teardown and source generation changes remove handlers, timers and mute.
for (const mode of ["cancel", "generation", "emptied", "error"]) {
  const f = fixture();
  const initialListeners = f.video.listeners.length;
  f.controller.seekWebOsExactly(100);
  if (mode === "cancel") f.controller.cancelWebOsExactSeek({ pause: true });
  if (mode === "generation") {
    f.controller.playRequestToken++;
    f.clock.advance(50);
  }
  if (mode === "emptied") f.video.dispatch("emptied");
  if (mode === "error") f.video.dispatch("error");
  assert.equal(f.controller.isWebOsExactSeekInFlight(), false, mode);
  assert.equal(f.video.muted, false, mode);
  assert.equal(f.video.paused, true, mode);
  assert.equal(f.video.listeners.length, initialListeners, mode);
  f.clock.advance(60000);
  assert.equal(f.events.length, 0, "cancelled operations cannot publish late completion/error");
}
// Failure paths must not strand the decoder playing silently forever.
{
  const f = fixture();
  f.controller.seekWebOsExactly(100);
  f.clock.advance(30000);
  assert.equal(f.controller.isWebOsExactSeekInFlight(), false);
  assert.equal(f.video.paused, true);
  assert.equal(f.video.muted, false);
  assert.equal(f.events.at(-1).type, "error");
  assert.equal(f.events.at(-1).detail.seekTimeout, true);
}
{
  const f = fixture({ paused: true });
  f.video.rejectPlay = true;
  f.controller.seekWebOsExactly(100);
  await Promise.resolve();
  assert.equal(f.controller.isWebOsExactSeekInFlight(), false);
  assert.equal(f.video.muted, false);
  assert.equal(f.events.at(-1).type, "error");
}
{
  const f = fixture();
  f.controller.seekWebOsExactly(200);
  f.video.currentTime = 199.98;
  f.video.ended = true;
  f.video.dispatch("ended");
  assert.equal(f.controller.isWebOsExactSeekInFlight(), false);
  assert.equal(f.controller.isPlaying, false);
  assert(!f.events.some((x) => x.type === "playing"));
}
console.log(
  "webOS exact seek passed: provisional clocks, paused decode, commands, lifecycle, failure and EOF"
);

// Exact mode is opt-in for native webOS files. Other engines and platforms keep
// their existing seek delegation and do not enter the decode pass.
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const { PlayerController } = await import("../js/core/player/playerController.js");
const { Platform } = await import("../js/platform/index.js");
const original = {
  webos: Platform.isWebOS,
  video: PlayerController.video,
  engine: PlayerController.playbackEngine,
  avplay: PlayerController.isUsingAvPlay,
  exact: PlayerController.seekWebOsExactly,
  cancel: PlayerController.cancelWebOsExactSeek,
  progress: PlayerController.scheduleProgressSyncAfterSeek,
  dts: PlayerController.webOsDtsAudioState
};
try {
  const calls = [];
  PlayerController.video = { currentTime: 0, paused: false };
  PlayerController.isUsingAvPlay = () => false;
  PlayerController.playbackEngine = "native-file";
  PlayerController.webOsDtsAudioState = null;
  PlayerController.seekWebOsExactly = (seconds, options) => {
    calls.push({ seconds, options });
    return true;
  };
  PlayerController.cancelWebOsExactSeek = () => {};
  PlayerController.scheduleProgressSyncAfterSeek = () => {};
  Platform.isWebOS = () => true;
  assert(PlayerController.seekToSeconds(50));
  assert.equal(calls.length, 0, "normal file seeks remain unchanged");
  assert.equal(PlayerController.video.currentTime, 50);
  assert(PlayerController.seekToSeconds(100, { exact: true, paused: true }));
  assert.deepEqual(calls.at(-1), { seconds: 100, options: { paused: true } });
  PlayerController.playbackEngine = "native-hls";
  PlayerController.seekToSeconds(110, { exact: true });
  assert.equal(calls.length, 1, "HLS is outside the measured native-file case");
  PlayerController.playbackEngine = "native-file";
  Platform.isWebOS = () => false;
  PlayerController.seekToSeconds(120, { exact: true });
  assert.equal(calls.length, 1, "other platforms do not use the LG adapter");
  Platform.isWebOS = () => true;
  PlayerController.webOsDtsAudioState = {};
  PlayerController.seekToSeconds(130, { exact: true });
  assert.equal(calls.length, 1, "audio conversion retains its own seek lifecycle");
} finally {
  Platform.isWebOS = original.webos;
  Object.assign(PlayerController, {
    video: original.video,
    playbackEngine: original.engine,
    isUsingAvPlay: original.avplay,
    seekWebOsExactly: original.exact,
    cancelWebOsExactSeek: original.cancel,
    scheduleProgressSyncAfterSeek: original.progress,
    webOsDtsAudioState: original.dts
  });
}
console.log(
  "webOS exact seek routing passed: opt-in, platform, engine and audio-conversion boundaries"
);
