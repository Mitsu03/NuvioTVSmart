import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const internals = await import("../js/core/player/playerController.js");
const { createPlayerControllerMethods17 } =
  await import("../js/core/player/playerControllerMethods-17-save-progress-if-needed.js");
const { createPlayerControllerMethods19 } =
  await import("../js/core/player/playerControllerMethods-19-pause.js");
const { createPlayerControllerMethods20 } =
  await import("../js/core/player/playerControllerMethods-20-flush-progress.js");
const { createWebOsExactSeekMethods } = await import("../js/platform/webos/webosExactSeek.js");

const writes = [],
  marks = [],
  removals = [];
internals.watchProgressRepository.saveProgress = async (value, options) =>
  writes.push({ value, options });
internals.watchProgressRepository.removeProgress = async (...args) => removals.push(args);
internals.watchedItemsRepository.mark = async (value) => marks.push(value);
function player() {
  return {
    ...createPlayerControllerMethods17(),
    ...createPlayerControllerMethods19(),
    ...createPlayerControllerMethods20(),
    currentItemId: "tt-progress-fixture",
    currentItemType: "movie",
    playbackSessionActive: true,
    isPlaying: true,
    progressSeekSyncTimer: null,
    getCurrentTimeSeconds: () => 300,
    getDurationSeconds: () => 1000,
    pushProgressIfDue: async () => true
  };
}
const local = { allowCloudSync: false, syncRemote: false };

// Android keeps completion sticky for the current playback, including stale
// unknown-duration callbacks and a later backward seek in that same session.
{
  const c = player();
  const context = c.createProgressContext();
  await c.flushProgress(950000, 1000000, false, context, local);
  const count = writes.length,
    markCount = marks.length;
  await c.flushProgress(300000, 1000000, false, context, local);
  await c.flushProgress(300000, 0, false, context, local);
  await c.flushProgress(960000, 1000000, false, context, local);
  assert.equal(writes.length, count);
  assert.equal(marks.length, markCount);
  assert.equal(writes.at(-1).value.positionMs, 1000000);
  await c.flushProgress(0, 1000000, true, context, local);
  assert.equal(removals.length, 1, "explicit removal remains available");

  // A replay/new player session can create progress again. An old captured
  // context must not latch completion in the replacement session.
  c.watchProgressSession = { completedKeys: new Set() };
  const replay = c.createProgressContext();
  await c.flushProgress(300000, 1000000, false, replay, local);
  assert.equal(writes.length, count + 1);
  await c.flushProgress(970000, 1000000, false, context, local);
  await c.flushProgress(310000, 1000000, false, replay, local);
  assert.equal(writes.at(-1).value.positionMs, 310000);

  const previous = player();
  const previousContext = previous.createProgressContext();
  previous.watchProgressSession = { completedKeys: new Set() };
  await previous.flushProgress(950000, 1000000, false, previousContext, local);
  await previous.flushProgress(320000, 1000000, false, null, local);
  assert.equal(
    writes.at(-1).value.positionMs,
    320000,
    "late old-session completion cannot latch a replay"
  );
}

// Latch before async watched writes so overlapping lower-progress callbacks
// cannot overwrite completion while a watched write is still pending.
{
  const c = player();
  let release;
  internals.watchedItemsRepository.mark = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const completed = c.flushProgress(950000, 1000000, false, null, local);
  const count = writes.length;
  assert.equal(await c.flushProgress(300000, 1000000, false, null, local), false);
  assert.equal(writes.length, count);
  release();
  await completed;
  internals.watchedItemsRepository.mark = async (value) => marks.push(value);
}

// Completion for an episode must not block the next episode's identity.
{
  const c = player();
  c.currentItemType = "series";
  c.currentVideoId = "tt-progress-fixture:1:1";
  c.currentSeason = 1;
  c.currentEpisode = 1;
  internals.watchedSeriesReconciliationService.reconcile = async () => {};
  await c.flushProgress(950000, 1000000, false, null, local);
  c.currentVideoId = "tt-progress-fixture:1:2";
  c.currentEpisode = 2;
  await c.flushProgress(300000, 1000000, false, null, local);
  assert.equal(writes.at(-1).value.episode, 2);
  assert.equal(writes.at(-1).value.positionMs, 300000);
}

// A new LG exact seek cancels the previous 700 ms persistence debounce.
// Periodic checkpoints ignore internal decoding, while pause/exit flushes use
// the requested position (Android's seek position), never preceding keyframes.
{
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  let nextId = 0;
  const timers = new Map();
  globalThis.setTimeout = (callback) => {
    timers.set(++nextId, callback);
    return nextId;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  try {
    const c = player();
    Object.assign(
      c,
      createWebOsExactSeekMethods({
        every: () => 10,
        stopEvery() {},
        later: () => 11,
        stopLater() {}
      })
    );
    c.video = {
      currentTime: 300,
      duration: 1000,
      paused: false,
      muted: false,
      addEventListener() {},
      removeEventListener() {},
      pause() {
        this.paused = true;
      }
    };
    c.emitVideoEvent = () => {};
    c.getCurrentTimeSeconds = () => c.video.currentTime;
    c.scheduleProgressSyncAfterSeek();
    assert.equal(timers.size, 1);
    c.seekWebOsExactly(600);
    assert.equal(timers.size, 0);
    c.video.currentTime = 598.4;
    assert.equal(c.saveProgressIfNeeded(), false);
    await c.flushCurrentProgress({ forceCloudSync: true });
    assert.equal(writes.at(-1).value.positionMs, 600000);
    c.seekWebOsExactly(0);
    const countBeforeZero = writes.length;
    await c.flushCurrentProgress({ forceCloudSync: true });
    assert.equal(writes.length, countBeforeZero, "seek to zero does not re-save an old snapshot");
    c.seekWebOsExactly(600);
    c.video.currentTime = 598.4;
    for (const method of [
      "stopWebOsDtsAudioTranscode",
      "stopWebOsPlaybackKeepAlive",
      "stopWebOsServiceKeepAlive",
      "stopProgressSaving",
      "setStartupPresentationAudioMuted",
      "clearWebOsTrackSelections",
      "syncWebOsPlaybackKeepAwake",
      "setStartupAudioGate",
      "teardownAdaptiveInstances",
      "teardownAvPlay",
      "resetNativeMediaState",
      "clearPlaybackEngineAttempts"
    ])
      c[method] = () => {};
    c.avplayFallbackAttempts = new Set();
    Object.assign(c.video, { removeAttribute() {}, querySelectorAll: () => [], load() {} });
    await c.stop({ forceCloudSync: true });
    assert.equal(
      writes.at(-1).value.positionMs,
      600000,
      "exit captures the target before cancelling native decode"
    );
    assert.equal(c.getWebOsExactSeekTargetSeconds(), null);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
}
console.log(
  "Watch progress player parity passed: completion, overlapping callbacks, replay/session isolation, episode identity, seek debounce, checkpoints and pending-seek flush"
);
