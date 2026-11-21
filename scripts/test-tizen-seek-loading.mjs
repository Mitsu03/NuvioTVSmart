// Tizen AVPlay seek-loading completion and watchdog.
//
// Reproduces the infinite seek spinner on Samsung TVs: AVPlay reports the
// playback clock from a 1000 ms tick (and on some firmware in whole-second
// steps), so a fixed "advance < 1 s" check never accepted a sample after a
// seek. Also covers failed native seeks, which never emit "seeked".
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};

// Deterministic clock and timers.
let now = 1_000_000;
const realDateNow = Date.now;
Date.now = () => now;
let timers = [];
let nextTimerId = 1;
globalThis.setTimeout = (fn, ms) => {
  const id = nextTimerId++;
  timers.push({ id, at: now + Number(ms || 0), fn });
  return id;
};
globalThis.clearTimeout = (id) => {
  timers = timers.filter((timer) => timer.id !== id);
};
function advance(ms) {
  const end = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const due = timers[0];
    if (!due || due.at > end) break;
    timers.shift();
    now = due.at;
    due.fn();
  }
  now = end;
}

const { Environment } = await import("../js/platform/environment.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { createPlayerScreenMethods30 } =
  await import("../js/ui/screens/player/playerScreenMethods-30-schedule-buffering-spinner-refresh.js");

let isTizen = true;
Environment.isTizen = () => isTizen;
Environment.isWebOS = () => !isTizen;

let nativeSeconds = 0;
const seekCalls = [];
Object.assign(PlayerController, {
  isUsingAvPlay: () => isTizen,
  getCurrentTimeSeconds: () => nativeSeconds,
  getPlaybackReadyState: () => 4,
  isPlaybackEnded: () => false,
  getAvPlayState: () => "PLAYING",
  seekToSeconds: (seconds) => {
    seekCalls.push(seconds);
    return true;
  },
  avplaySeekInFlight: false,
  avplaySeekSettledAt: 0,
  avplayLastSeekOutcome: null,
  video: null
});

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(String(args[0]));

function createScreen() {
  const screen = {
    seekLoading: false,
    pendingPlaybackRestore: null,
    hasPresentedPlaybackFrame: true,
    loadingVisible: false,
    paused: false,
    isStartupLoadingVisible: () => false,
    getPlaybackControlPaused: () => screen.paused,
    updateLoadingVisibility: () => {},
    clearBufferingSpinnerTimer: () => {}
  };
  Object.assign(screen, createPlayerScreenMethods30());
  return screen;
}

// Mirrors seekPlaybackSeconds(): mark the UI seek, then start the watchdog.
function beginSeek(screen, targetSeconds) {
  screen.seekLoadingBaselineSeconds = screen.getPlaybackCurrentSeconds();
  screen.seekLoadingTargetSeconds = targetSeconds;
  screen.seekLoadingSettled = false;
  screen.seekLoadingProgressSeconds = null;
  screen.seekLoadingProgressAt = 0;
  screen.seekLoadingStartedAt = Date.now();
  screen.seekLoading = true;
  screen.startSeekLoadingWatchdog();
}

function nativeSeekSettles(screen, targetSeconds, { success = true } = {}) {
  advance(300);
  nativeSeconds = targetSeconds;
  PlayerController.avplaySeekSettledAt = Date.now();
  PlayerController.avplayLastSeekOutcome = { success, targetMs: targetSeconds * 1000 };
  if (success) {
    // onSeeked handler
    screen.seekLoadingSettled = true;
    screen.seekLoadingProgressSeconds = null;
  }
  screen.completeSeekLoadingIfReady();
}

// AVPlay tick: +1000 ms wall clock, +1.000 s playback clock (whole seconds).
function tick(screen, playbackAdvanceSeconds = 1) {
  advance(1000);
  nativeSeconds += playbackAdvanceSeconds;
  if (screen.seekLoading) {
    screen.completeSeekLoadingIfReady(); // markPlaybackProgress() -> completeSeekLoadingIfReady()
  }
}

function reset() {
  timers = [];
  nativeSeconds = 100;
  seekCalls.length = 0;
  warnings.length = 0;
  PlayerController.avplaySeekInFlight = false;
  PlayerController.avplaySeekSettledAt = 0;
  PlayerController.avplayLastSeekOutcome = null;
  isTizen = true;
}

// 1. Whole-second 1000 ms ticks: spinner must clear once playback advances.
{
  reset();
  const screen = createScreen();
  beginSeek(screen, 110);
  nativeSeekSettles(screen, 110);
  assert.equal(
    screen.seekLoading,
    true,
    "the seek jump itself must not count as playback progress"
  );
  tick(screen);
  assert.equal(
    screen.seekLoading,
    false,
    "a normal 1.0 s advance per 1000 ms tick must clear the seek spinner"
  );
  assert.equal(
    screen.seekLoadingWatchdogTimer,
    null,
    "clearing the seek spinner stops the watchdog"
  );
}

// 2. Slightly late tick (1.02 s advance) is still accepted.
{
  reset();
  const screen = createScreen();
  beginSeek(screen, 300);
  nativeSeekSettles(screen, 300);
  tick(screen, 1.02);
  tick(screen, 1.02);
  assert.equal(screen.seekLoading, false);
}

// 3. A large jump between samples is not mistaken for playback progress.
{
  reset();
  const screen = createScreen();
  beginSeek(screen, 500);
  nativeSeekSettles(screen, 500);
  tick(screen, 30);
  assert.equal(
    screen.seekLoading,
    true,
    "an implausible 30 s advance in 1 s must not complete the seek"
  );
  tick(screen);
  assert.equal(screen.seekLoading, false);
}

// 4. Failed native seek (no "seeked" event) must not hang forever.
{
  reset();
  const screen = createScreen();
  beginSeek(screen, 200);
  nativeSeconds = 100;
  advance(300);
  PlayerController.avplaySeekSettledAt = Date.now();
  PlayerController.avplayLastSeekOutcome = { success: false, targetMs: 200_000 };
  assert.equal(
    screen.hasSeekLoadingSettled(),
    true,
    "a failed native seek still ends the native operation"
  );
  tick(screen);
  tick(screen);
  assert.equal(
    screen.seekLoading,
    false,
    "playback continuing after a failed seek clears the spinner"
  );
}

// 5. A settle marker from an older seek does not settle a newer UI seek.
{
  reset();
  const screen = createScreen();
  PlayerController.avplaySeekSettledAt = Date.now();
  advance(50);
  beginSeek(screen, 50);
  assert.equal(screen.hasSeekLoadingSettled(), false);
  PlayerController.avplaySeekInFlight = true;
  PlayerController.avplaySeekSettledAt = Date.now() + 10;
  assert.equal(screen.hasSeekLoadingSettled(), false, "an in-flight native seek is never settled");
  screen.stopSeekLoadingWatchdog();
}

// 6. Watchdog: playback stalls after the seek -> one retry, then give up.
{
  reset();
  const screen = createScreen();
  beginSeek(screen, 900);
  nativeSeekSettles(screen, 900);
  advance(11_700);
  assert.equal(seekCalls.length, 1, "watchdog retries the seek once after ~12 s without progress");
  assert.equal(seekCalls[0], 900);
  assert.equal(screen.seekLoading, true);
  advance(30_000);
  assert.equal(seekCalls.length, 1, "the seek is retried at most once");
  assert.equal(screen.seekLoading, false, "watchdog always hands the controls back");
  assert.ok(
    warnings.some((w) => w.startsWith("Tizen AVPlay seek did not resume")),
    "give-up is logged as a warning"
  );
}

// 7. Watchdog clears the spinner when playback advances but samples never land.
{
  reset();
  const screen = createScreen();
  beginSeek(screen, 400);
  advance(300);
  nativeSeconds = 400;
  PlayerController.avplaySeekSettledAt = Date.now();
  screen.seekLoadingSettled = true;
  // No completeSeekLoadingIfReady() calls at all (no timeupdate delivered).
  advance(3_700); // first watchdog check records the position
  assert.equal(screen.seekLoading, true);
  nativeSeconds = 404;
  advance(4_000); // second check sees the clock advancing
  assert.equal(
    screen.seekLoading,
    false,
    "watchdog sees the clock advancing and clears the spinner"
  );
  assert.equal(seekCalls.length, 0);
}

// 8. Native seek still in flight: watchdog waits for the controller timeout.
{
  reset();
  const screen = createScreen();
  beginSeek(screen, 700);
  PlayerController.avplaySeekInFlight = true;
  advance(36_000);
  assert.equal(screen.seekLoading, true);
  assert.equal(seekCalls.length, 0, "never re-seek while AVPlay is still seeking");
  PlayerController.avplaySeekInFlight = false;
  screen.stopSeekLoadingWatchdog();
}

// 9. Non-Tizen (webOS / HTML5) keeps requiring the "seeked" event and no watchdog.
{
  reset();
  isTizen = false;
  const screen = createScreen();
  beginSeek(screen, 50);
  assert.equal(screen.seekLoadingWatchdogTimer ?? null, null, "no watchdog outside Tizen AVPlay");
  PlayerController.avplaySeekSettledAt = Date.now() + 1;
  assert.equal(screen.hasSeekLoadingSettled(), false, "webOS still needs the seeked event");
  screen.seekLoadingSettled = true;
  nativeSeconds = 50;
  screen.completeSeekLoadingIfReady();
  advance(250);
  nativeSeconds = 50.25;
  screen.completeSeekLoadingIfReady();
  assert.equal(screen.seekLoading, false, "webOS 250 ms timeupdates still complete the seek");
}

// 10. Paused after a seek completes immediately once the frame is ready.
{
  reset();
  const screen = createScreen();
  screen.paused = true;
  beginSeek(screen, 120);
  nativeSeekSettles(screen, 120);
  assert.equal(screen.seekLoading, false);
}

console.warn = originalWarn;
Date.now = realDateNow;
console.log("tizen seek loading tests passed");
