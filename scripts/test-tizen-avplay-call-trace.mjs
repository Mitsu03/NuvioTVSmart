// AVPlay call trace used to diagnose native PLAYER_ERROR_INVALID_STATE.
import assert from "node:assert/strict";

const { wrapAvPlayForTrace, getAvPlayCallTrace } =
  await import("../js/core/player/engines/avplayCallTrace.js");

const native = {
  state: "NONE",
  listener: null,
  open(url) {
    this.openedUrl = url;
    this.state = "IDLE";
  },
  getState() {
    return this.state;
  },
  getCurrentTime() {
    return 1234;
  },
  setListener(listener) {
    this.listener = listener;
  },
  prepareAsync(ok) {
    this.state = "READY";
    ok();
  },
  play() {
    this.state = "PLAYING";
  },
  setStreamingProperty() {},
  seekTo(_ms, _ok, err) {
    err("PLAYER_ERROR_INVALID_STATE");
  },
  stop() {
    throw new Error("boom");
  }
};

const avplay = wrapAvPlayForTrace(native);
assert.equal(wrapAvPlayForTrace(native), avplay, "one proxy per native object");
assert.equal(typeof avplay.seekTo, "function");

avplay.open("https://cdn.example/path/secret-token/movie.mkv");
avplay.setStreamingProperty("COOKIE", "session=secret");
let bufferingEvents = 0;
avplay.setListener({
  onbufferingstart: () => {
    bufferingEvents += 1;
  },
  oncurrentplaytime: () => {}
});
avplay.prepareAsync(() => {});
avplay.play();
native.listener.onbufferingstart();
native.listener.oncurrentplaytime(5000);
assert.equal(bufferingEvents, 1, "traced listener still calls the app handler");
assert.equal(avplay.getCurrentTime(), 1234, "untraced getters keep working");
let seekError = null;
avplay.seekTo(
  60000,
  () => {},
  (error) => {
    seekError = error;
  }
);
assert.equal(seekError, "PLAYER_ERROR_INVALID_STATE", "error callback still reaches the app");
assert.throws(() => avplay.stop(), /boom/);

const trace = getAvPlayCallTrace().map((line) => line.replace(/^\+\d+ms /, ""));
assert.deepEqual(trace, [
  "open(url(cdn.example)) [NONE]",
  "setStreamingProperty(COOKIE,…) [IDLE]",
  "setListener({…}) [IDLE]",
  "prepareAsync() [IDLE]",
  "prepareAsync -> OK [READY]",
  "play() [READY]",
  "event onbufferingstart [PLAYING]",
  "seekTo(60000) [PLAYING]",
  "seekTo -> ERR PLAYER_ERROR_INVALID_STATE [PLAYING]",
  "stop() [PLAYING]",
  "stop THREW Error boom"
]);
assert.ok(
  !trace.join(" ").includes("secret"),
  "no URLs, paths, tokens or cookie values in the trace"
);

avplay.open("https://other.example/x.mkv");
assert.equal(getAvPlayCallTrace().length, 1, "a new open() starts a fresh trace");

// The trace wraps webapis.avplay only while Tizen diagnostics are enabled.
{
  const { tizenAvplayEngine } = await import("../js/core/player/engines/platformAvplayEngine.js");
  const nativeAvPlay = { open() {}, getState: () => "NONE" };
  globalThis.webapis = { avplay: nativeAvPlay };
  globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__ = false;
  assert.equal(tizenAvplayEngine.getApi(), nativeAvPlay, "no wrapper during normal playback");
  globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__ = true;
  assert.notEqual(tizenAvplayEngine.getApi(), nativeAvPlay, "traced while diagnostics are on");
  delete globalThis.__NUVIO_DEBUG_TIZEN_AVPLAY__;
  delete globalThis.webapis;
}

console.log("tizen avplay call trace tests passed");
