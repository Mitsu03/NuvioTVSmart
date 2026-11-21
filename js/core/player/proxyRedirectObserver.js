import { canonicalStreamUrl, createStreamRedirectReporter } from "./streamRedirect.js";

function isMatchingLocalReportUrl(reportUrl, playbackUrl) {
  try {
    const report = new URL(reportUrl);
    const playback = new URL(playbackUrl);
    const options = (url) => new URLSearchParams(url.pathname.slice(7).split("/")[0]);
    const trace = options(playback).get("nuvioTrace");
    return (
      /^https?:$/.test(playback.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(playback.hostname) &&
      report.origin === playback.origin &&
      !report.username &&
      !report.password &&
      report.pathname.startsWith("/proxy/") &&
      playback.pathname.startsWith("/proxy/") &&
      /^[0-9a-f]{32}$/.test(trace || "") &&
      options(report).get("nuvioTrace") === trace &&
      options(report).get("nuvioReport") === "1" &&
      !options(report).has("d")
    );
  } catch (_) {
    return false;
  }
}

// Reads only local observations of the actual media request. Never probes the addon.
export function observeProxyRedirects(
  controller,
  { requestedUrl, playbackUrl, playToken, reportUrl },
  fetchImpl = globalThis.fetch
) {
  if (
    typeof fetchImpl !== "function" ||
    !canonicalStreamUrl(requestedUrl) ||
    !isMatchingLocalReportUrl(reportUrl, playbackUrl)
  )
    return () => {};
  const reportRedirect = createStreamRedirectReporter(
    controller,
    requestedUrl,
    playToken,
    playbackUrl
  );
  let cancelled = false;
  let timer = null;
  let timeout = null;
  let abort = null;
  let cancelPending = null;
  let failures = 0;
  let polls = 0;
  const active = () => !cancelled && controller.isPlaybackRequestActive(playToken, playbackUrl);
  const cancel = () => {
    cancelled = true;
    clearTimeout(timer);
    clearTimeout(timeout);
    abort?.abort();
    cancelPending?.();
    cancelPending = null;
  };
  const poll = async () => {
    if (!active()) return cancel();
    abort = typeof globalThis.AbortController === "function" ? new AbortController() : null;
    try {
      const response = await Promise.race([
        Promise.resolve()
          .then(() =>
            fetchImpl(reportUrl, {
              cache: "no-store",
              credentials: "omit",
              redirect: "error",
              ...(abort ? { signal: abort.signal } : {})
            })
          )
          .then((result) => {
            if (!result.ok) throw new Error("Redirect report unavailable");
            return result.json();
          }),
        new Promise((_, reject) => {
          cancelPending = () => reject(new Error("Redirect observation cancelled"));
          timeout = setTimeout(() => {
            abort?.abort();
            reject(new Error("Redirect report timed out"));
          }, 2000);
        })
      ]);
      if (!active()) return;
      if (response?.status !== "pending" && response?.status !== "resolved")
        throw new Error("Invalid redirect report");
      failures = 0;
      if (
        response.status === "resolved" &&
        Number.isInteger(response.sequence) &&
        response.sequence > 0 &&
        canonicalStreamUrl(response.requestedUrl) === canonicalStreamUrl(requestedUrl)
      ) {
        reportRedirect(response.resolvedUrl);
      }
    } catch (_) {
      // Old companion services may lack this endpoint. Metadata observation must
      // never trigger source retries, transport fallback or playback errors.
      failures += 1;
    } finally {
      clearTimeout(timeout);
      abort = null;
      cancelPending = null;
      if (active() && failures < 3) {
        polls += 1;
        timer = setTimeout(poll, polls < 10 ? 1000 : 3000);
      } else {
        cancel();
      }
    }
  };
  timer = setTimeout(poll, 0);
  return cancel;
}
