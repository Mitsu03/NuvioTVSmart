// Watch party player rules, mirroring Android PlayerRuntimeControllerParty.kt.
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};
let monotonic = 0;
globalThis.performance = { now: () => monotonic };

const { createPlayerPartyMethods } = await import("../js/ui/screens/player/playerParty.js");
const { PlayerController } = await import("../js/core/player/playerController.js");
const { PartyRepository } = await import("../js/core/party/partyRepository.js");
const { PartyMemberStatus } = await import("../js/core/party/partyModels.js");

const MEDIA = {
  type: "movie",
  meta_id: "tt1",
  meta_type: "movie",
  title: "Movie",
  season: null,
  episode: null,
  source: null
};
const KEY = "movie|tt1||";

let repoState;
let repoPlayback;
let serverNow;
const published = [];
const statuses = [];
const publishedMedia = [];
const sharedStreams = [];
Object.assign(PartyRepository, {
  getState: () => repoState,
  getPlayback: () => repoPlayback,
  nowMs: () => serverNow,
  isAvailable: () => true,
  publishPlayback: (paused, positionMs, rate) => published.push({ paused, positionMs, rate }),
  setLocalStatus: (status, mediaKey, behindMs = null) =>
    statuses.push({ status, mediaKey, behindMs }),
  publishMedia: async (media, positionMs) => publishedMedia.push({ media, positionMs }),
  shareStream: (stream) => sharedStreams.push(stream)
});

let supportedRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
let engineRate = 1;
let rateCalls = 0;
const engine = { paused: false };
Object.assign(PlayerController, {
  pause: () => {
    engine.paused = true;
  },
  resume: () => {
    engine.paused = false;
  },
  setPlaybackRate: async (rate) => {
    rateCalls += 1;
    if (!supportedRates.includes(rate) && supportedRates.length === 1) return false;
    engineRate = rate;
    return true;
  },
  getSupportedPlaybackRates: () => supportedRates,
  currentPlaybackHeaders: {}
});
PlayerController.video = { ended: false };

function party({
  memberId = "m2",
  host = "m1",
  hostOnly = false,
  presence = {},
  sharing = false
} = {}) {
  return {
    id: "p1",
    code: "ABC234",
    memberId,
    hostMemberId: host,
    members: [
      { id: "m1", display_name: "Host" },
      { id: "m2", display_name: "Guest" },
      { id: "m3", display_name: "Third" }
    ],
    presence,
    media: MEDIA,
    mediaKey: KEY,
    maxMembers: 3,
    connected: true,
    hostOnly,
    sharing
  };
}

function createScreen(params = { itemId: "tt1", itemType: "movie" }) {
  const seeks = [];
  const messages = [];
  const screen = {
    ...createPlayerPartyMethods(),
    params,
    paused: false,
    positionMs: 60000,
    hasPresentedPlaybackFrame: true,
    bufferingActive: false,
    loadingVisible: false,
    seekLoading: false,
    seekPreviewSeconds: null,
    postPlayPlaybackEnded: false,
    playerRouteActive: true,
    controlsVisible: false,
    partyRateNudge: null,
    partyBehind: false,
    partyBehindMs: null,
    partyNudgeUnsupported: false,
    activePlaybackUrl: "https://cdn.example.com/movie.mkv",
    candidate: {
      url: "https://cdn.example.com/movie.mkv",
      name: "TB HD",
      addonName: "Addon",
      behaviorHints: { filename: "movie.mkv", proxyHeaders: { request: { Referer: "r" } } }
    },
    seeks,
    messages,
    getPlaybackControlPaused() {
      return this.paused;
    },
    getPlaybackCurrentSeconds() {
      return this.positionMs / 1000;
    },
    getPlaybackDurationSeconds() {
      return 7200;
    },
    getPlaybackSpeed() {
      return engineRate;
    },
    seekPlaybackSeconds(seconds) {
      seeks.push(Math.round(seconds * 1000));
      this.positionMs = Math.round(seconds * 1000);
    },
    isStartupErrorVisible() {
      return false;
    },
    isExternalFrameMode() {
      return false;
    },
    getCurrentStreamCandidate() {
      return this.candidate;
    },
    getCurrentStreamDisplayName() {
      return "TB HD";
    },
    renderControlButtons() {},
    schedulePauseOverlay() {},
    dismissPauseOverlay() {},
    updateMediaSessionPlaybackState() {},
    setControlsVisible() {},
    resetControlsAutoHide() {},
    renderPartyPill() {},
    showPartyMessage(text) {
      messages.push(text);
    }
  };
  // applyPartyPaused drives the engine; keep the screen's paused flag in step.
  const pause = PlayerController.pause;
  const resume = PlayerController.resume;
  PlayerController.pause = () => {
    pause();
    screen.paused = true;
  };
  PlayerController.resume = () => {
    resume();
    screen.paused = false;
  };
  return screen;
}

async function tick(screen, sync, ms = 250) {
  monotonic += ms;
  serverNow += ms;
  if (!screen.paused) screen.positionMs += ms * engineRate;
  screen.partySyncTick(sync);
  await Promise.resolve();
  await Promise.resolve();
}

function newSync() {
  return {
    bufferingSince: null,
    mismatchSince: null,
    lastSeek: null,
    lastCorrection: null,
    lastSeq: null,
    lastStatus: null,
    lastShared: undefined,
    wasInBackground: false,
    wasRendered: false,
    publishedInitial: false,
    seekLeadMs: 0,
    measureSeekLead: false,
    wasBehind: false
  };
}

function reset() {
  published.length = 0;
  statuses.length = 0;
  publishedMedia.length = 0;
  sharedStreams.length = 0;
  engineRate = 1;
  supportedRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  serverNow = 1_000_000;
  repoPlayback = null;
}

// ---- keys and media ----
reset();
repoState = { party: party(), busy: false };
let screen = createScreen();
assert.equal(screen.partyKey(), KEY);
assert(screen.isPartySynced());
assert.equal(
  createScreen({ itemId: "tt9", itemType: "tv", season: "1", episode: 2 }).partyKey(),
  "series|tt9|1|2",
  "TV type and string numbers match Android keys"
);
assert(
  !createScreen({ itemId: "tt1", itemType: "cloud" }).canUseParty(),
  "cloud items cannot start a party"
);
const partyMedia = screen.currentPartyMedia();
assert.equal(partyMedia.meta_id, "tt1");
assert.equal(partyMedia.source.filename, "movie.mkv");
assert.equal(partyMedia.source.name, "TB HD");

// ---- shared stream eligibility ----
assert.equal(screen.currentPartyStream().url, "https://cdn.example.com/movie.mkv");
assert.deepEqual(screen.currentPartyStream().headers, { Referer: "r" });
screen.candidate = { ...screen.candidate, infoHash: "abc" };
assert(screen.currentPartyStream(), "debrid links resolved to HTTP stay shareable");
screen.candidate = { ...screen.candidate, engineFs: { infoHash: "abc" } };
assert.equal(screen.currentPartyStream(), null, "local torrent engines are never shared");
screen.candidate = { url: "http://127.0.0.1:11470/x" };
screen.activePlaybackUrl = "http://127.0.0.1:11470/x";
assert.equal(screen.currentPartyStream(), null, "local URLs are never shared");

// ---- member joins a playing party: first state is forced ----
reset();
repoState = { party: party(), busy: false };
screen = createScreen();
screen.paused = true;
repoPlayback = {
  seq: 4,
  member_id: "m1",
  paused: false,
  position_ms: 120000,
  rate: 1,
  at: serverNow,
  media_key: KEY,
  waiting: false
};
let sync = newSync();
await tick(screen, sync);
assert.equal(screen.paused, false, "joining resumes to match the party");
assert.equal(screen.seeks.at(-1), 120250, "and seeks to the party position");
assert.equal(statuses.at(-1).status, PartyMemberStatus.Ready);

// ---- drift: nudge when supported, seek past 1.5 s ----
for (let i = 0; i < 12; i += 1) await tick(screen, sync);
screen.positionMs += 600;
for (let i = 0; i < 3; i += 1) await tick(screen, sync);
assert.equal(engineRate, 0.95, "ahead by 600 ms slows down by 5%");
for (let i = 0; i < 40 && screen.partyRateNudge != null; i += 1) await tick(screen, sync);
assert.equal(screen.partyRateNudge, null, "nudging stops once in sync");
assert.equal(engineRate, 1, "and returns to the party rate");
screen.positionMs -= 4000;
await tick(screen, sync);
await tick(screen, sync);
assert(
  Math.abs(screen.seeks.at(-1) - (repoPlayback.position_ms + (serverNow - repoPlayback.at))) < 300,
  "large drift seeks back to the party"
);

// ---- engines fixed at 1x (Samsung AVPlay, webOS MSE): seek instead of nudge ----
reset();
supportedRates = [1];
rateCalls = 0;
repoState = { party: party(), busy: false };
screen = createScreen();
repoPlayback = {
  seq: 1,
  member_id: "m1",
  paused: false,
  position_ms: 60000,
  rate: 1,
  at: serverNow,
  media_key: KEY,
  waiting: false
};
sync = newSync();
for (let i = 0; i < 14; i += 1) await tick(screen, sync);
screen.positionMs += 900;
for (let i = 0; i < 4; i += 1) await tick(screen, sync);
assert.equal(engineRate, 1, "no speed change on engines that cannot change rate");
assert.equal(rateCalls, 0, "fixed-rate engines are never asked to change speed");
assert.equal(screen.partyRateNudge, null);
screen.positionMs += 900;
const seeksBefore = screen.seeks.length;
for (let i = 0; i < 4; i += 1) await tick(screen, sync);
assert(screen.seeks.length > seeksBefore, "drift is still corrected by seeking");

// ---- host-only member: own pause, rewind behind, blocked skip, catch up ----
reset();
repoState = { party: party({ hostOnly: true }), busy: false };
screen = createScreen();
repoPlayback = {
  seq: 1,
  member_id: "m1",
  paused: false,
  position_ms: 60000,
  rate: 1,
  at: serverNow,
  media_key: KEY,
  waiting: false
};
assert(screen.isPartyControlLocked());
screen.toggleOwnPlayback();
assert.equal(screen.paused, true);
assert.equal(screen.partyBehind, true, "pausing alone falls behind the party");
assert.equal(published.length, 0, "a locked member never publishes");
screen.toggleOwnPlayback();
assert.equal(screen.paused, false, "resuming plays from where the member paused");
assert.equal(screen.ownSeekTarget(30000), 30000, "rewinding is allowed and stays behind");
assert.equal(screen.partyBehind, true);
screen.partyBehind = false;
assert.equal(screen.ownSeekTarget(90000), null, "skipping ahead of the party is blocked");
assert.equal(screen.messages.at(-1), "party_host_only_note");
screen.partyBehind = true;
assert.equal(screen.ownSeekTarget(90000), null, "reaching the party catches up");
assert.equal(screen.partyBehind, false);
assert.equal(
  screen.partyUserSeekTarget(10000),
  10000,
  "unlocked seeks are passed through when controls are free"
);

// ---- behind status is reported in 5 s steps, and rejoins when close ----
reset();
repoState = { party: party({ hostOnly: true }), busy: false };
screen = createScreen();
repoPlayback = {
  seq: 1,
  member_id: "m1",
  paused: false,
  position_ms: 60000,
  rate: 1,
  at: serverNow,
  media_key: KEY,
  waiting: false
};
sync = newSync();
await tick(screen, sync);
screen.positionMs = 40000;
screen.partyBehind = true;
await tick(screen, sync);
assert.equal(statuses.at(-1).status, PartyMemberStatus.Behind);
assert.equal(statuses.at(-1).behindMs, 20000);
screen.positionMs = repoPlayback.position_ms + (serverNow - repoPlayback.at) - 1000;
await tick(screen, sync);
assert.equal(screen.partyBehind, false, "within 2 s of the party while playing rejoins");
await tick(screen, sync);
assert.equal(
  screen.messages.at(-1),
  "party_caught_up",
  "a locked member is told they are back in sync"
);

// ---- loading and buffering statuses ----
reset();
repoState = { party: party(), busy: false };
screen = createScreen();
sync = newSync();
screen.hasPresentedPlaybackFrame = false;
await tick(screen, sync);
assert.equal(statuses.at(-1).status, PartyMemberStatus.Loading);
screen.hasPresentedPlaybackFrame = true;
screen.bufferingActive = true;
await tick(screen, sync);
assert.equal(statuses.at(-1).status, PartyMemberStatus.Ready, "short buffering is not reported");
for (let i = 0; i < 5; i += 1) await tick(screen, sync);
assert.equal(statuses.at(-1).status, PartyMemberStatus.Buffering, "buffering over 1 s is reported");

// ---- host publishes the first state once the first frame shows ----
reset();
repoState = { party: party({ memberId: "m1" }), busy: false };
screen = createScreen();
sync = newSync();
await tick(screen, sync);
assert.equal(published.length, 1);
assert.equal(published[0].paused, false);
await tick(screen, sync);
assert.equal(published.length, 1, "only once");

// ---- a pause outside the party controls is published after 1.2 s ----
reset();
repoState = { party: party({ memberId: "m1" }), busy: false };
screen = createScreen();
repoPlayback = {
  seq: 1,
  member_id: "m1",
  paused: false,
  position_ms: 60000,
  rate: 1,
  at: serverNow,
  media_key: KEY,
  waiting: false
};
sync = newSync();
await tick(screen, sync);
await tick(screen, sync);
screen.paused = true;
for (let i = 0; i < 4; i += 1) await tick(screen, sync);
assert.equal(published.length, 0);
for (let i = 0; i < 2; i += 1) await tick(screen, sync);
assert.equal(published.at(-1).paused, true);

// ---- host switching episode in the player publishes the new media ----
reset();
repoState = { party: party({ memberId: "m1" }), busy: false };
screen = createScreen();
screen.partyPreviousKey = KEY;
screen.params = { itemId: "tt1", itemType: "series", season: 1, episode: 3 };
repoState = {
  party: {
    ...party({ memberId: "m1" }),
    media: { ...MEDIA, type: "series", meta_type: "series", season: 1, episode: 2 },
    mediaKey: "series|tt1|1|2"
  },
  busy: false
};
screen.partyPreviousKey = "series|tt1|1|2";
await tick(screen, newSync());
assert.equal(publishedMedia.at(-1).media.episode, 3);
assert.equal(publishedMedia.at(-1).positionMs, 0);

// ---- sharing: the host's current link is shared once per change ----
reset();
repoState = { party: party({ memberId: "m1", sharing: true }), busy: false };
screen = createScreen();
sync = newSync();
await tick(screen, sync);
await tick(screen, sync);
assert.equal(sharedStreams.length, 1);
assert.equal(sharedStreams[0].url, "https://cdn.example.com/movie.mkv");

// ---- leaving the player pauses the party only when nobody else watches ----
reset();
repoState = { party: party({ memberId: "m1" }), busy: false };
screen = createScreen();
repoPlayback = {
  seq: 1,
  member_id: "m1",
  paused: false,
  position_ms: 60000,
  rate: 1,
  at: serverNow,
  media_key: KEY,
  waiting: false
};
screen.leavePartyPlayback();
assert.equal(published.at(-1).paused, true);
assert.equal(statuses.at(-1).status, PartyMemberStatus.Browsing);
reset();
repoState = {
  party: party({
    memberId: "m1",
    presence: { m2: { member_id: "m2", status: PartyMemberStatus.Ready, media_key: KEY } }
  }),
  busy: false
};
repoPlayback = {
  seq: 1,
  member_id: "m1",
  paused: false,
  position_ms: 60000,
  rate: 1,
  at: serverNow,
  media_key: KEY,
  waiting: false
};
screen.leavePartyPlayback();
assert.equal(published.length, 0, "others keep watching");

// ---- resume position follows the party ----
reset();
repoState = { party: party(), busy: false };
repoPlayback = {
  seq: 1,
  member_id: "m1",
  paused: true,
  position_ms: 42000,
  rate: 1,
  at: serverNow,
  media_key: KEY,
  waiting: false
};
assert.equal(createScreen().partyResumePositionMs(), 42000);
repoState = { party: { ...party(), mediaKey: "movie|tt2||" }, busy: false };
assert.equal(createScreen().partyResumePositionMs(), null);

console.log(
  "Watch party player parity passed: keys, sharing rules, forced first state, nudge/seek correction, fixed-rate engines, host-only behind/catch-up, statuses, initial host state, outside toggles, episode switch, leaving, resume"
);
