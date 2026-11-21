// Lightweight AVPlay call trace for diagnosing native state errors.
//
// Samsung AVPlay reports PLAYER_ERROR_INVALID_STATE without saying which
// earlier call put the native player in that state. This keeps the last calls
// made to the AVPlay object (method, compact arguments, native state before
// the call and the outcome, including async callbacks) so a failed seek can
// dump the sequence that led to it in one Console Debug entry.

const MAX_ENTRIES = 60;
// Pure getters polled every tick; recording them would flood the trace.
const UNTRACED_METHODS = new Set([
  "getState",
  "getCurrentTime",
  "getDuration",
  "getCurrentStreamInfo",
  "getTotalTrackInfo",
  "getStreamingProperty",
  "getVersion"
]);
// Listener events fired continuously during playback.
const NOISY_LISTENER_EVENTS = new Set([
  "oncurrentplaytime",
  "onbufferingprogress",
  "onsubtitlechange"
]);
// Methods whose trailing function arguments are success/error callbacks.
const CALLBACK_METHODS = new Set(["prepareAsync", "seekTo", "jumpForward", "jumpBackward"]);

const entries = [];
let originAt = 0;
const wrappedTargets = new WeakMap();

function now() {
  return Date.now();
}

function summarizeArg(method, value, index) {
  if (typeof value === "function") return "fn";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    if (method === "open") {
      try {
        return `url(${new URL(value).host})`;
      } catch (_) {
        return "url(?)";
      }
    }
    if (method === "setStreamingProperty" && index > 0) return "…";
    if (method === "setExternalSubtitlePath") return "path";
    return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  }
  return "{…}";
}

function describeError(value) {
  const text = [value?.name, value?.message, typeof value === "string" ? value : ""]
    .filter(Boolean)
    .join(" ");
  return (text || String(value || "error")).slice(0, 80);
}

function push(text) {
  entries.push(`+${Math.max(0, now() - originAt)}ms ${text}`);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

function readState(target) {
  try {
    return String(target.getState?.() || "?");
  } catch (_) {
    return "?";
  }
}

export function getAvPlayCallTrace() {
  return entries.slice();
}

export function wrapAvPlayForTrace(target) {
  if (!target || typeof target !== "object" || typeof Proxy !== "function") {
    return target;
  }
  const cached = wrappedTargets.get(target);
  if (cached) return cached;

  const methodCache = new Map();
  const proxy = new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop];
      if (typeof value !== "function" || typeof prop !== "string" || UNTRACED_METHODS.has(prop)) {
        return typeof value === "function" ? value.bind(obj) : value;
      }
      if (methodCache.has(prop)) return methodCache.get(prop);
      const traced = function (...args) {
        if (prop === "open") {
          entries.length = 0;
          originAt = now();
        }
        const stateBefore = readState(obj);
        const label = `${prop}(${args
          .filter((arg) => typeof arg !== "function")
          .map((arg, index) => summarizeArg(prop, arg, index))
          .join(",")})`;
        let callArgs = args;
        if (prop === "setListener" && args[0] && typeof args[0] === "object") {
          const listener = args[0];
          const tracedListener = {};
          Object.keys(listener).forEach((key) => {
            const handler = listener[key];
            if (typeof handler !== "function" || NOISY_LISTENER_EVENTS.has(key)) {
              tracedListener[key] = handler;
              return;
            }
            tracedListener[key] = (...eventArgs) => {
              const detail =
                key === "onerror" || key === "onevent" ? ` ${describeError(eventArgs[0])}` : "";
              push(`event ${key}${detail} [${readState(obj)}]`);
              return handler(...eventArgs);
            };
          });
          callArgs = [tracedListener, ...args.slice(1)];
        }
        if (CALLBACK_METHODS.has(prop)) {
          callArgs = args.map((arg, index) => {
            if (typeof arg !== "function") return arg;
            const kind = index === args.findIndex((a) => typeof a === "function") ? "ok" : "err";
            return (...cbArgs) => {
              push(
                `${prop} -> ${kind === "ok" ? "OK" : `ERR ${describeError(cbArgs[0])}`} [${readState(obj)}]`
              );
              return arg(...cbArgs);
            };
          });
        }
        // Record the call before invoking it: callbacks may fire synchronously.
        push(`${label} [${stateBefore}]`);
        try {
          return value.apply(obj, callArgs);
        } catch (error) {
          push(`${prop} THREW ${describeError(error)}`);
          throw error;
        }
      };
      methodCache.set(prop, traced);
      return traced;
    }
  });
  wrappedTargets.set(target, proxy);
  return proxy;
}
