export function createPlaybackProxyRedirectTrace(baseUrl) {
  try {
    const base = new URL(baseUrl);
    if (
      !/^https?:$/.test(base.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      typeof globalThis.crypto?.getRandomValues !== "function"
    )
      return null;
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const id = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    const options = new URLSearchParams({ nuvioReport: "1", nuvioTrace: id });
    return { id, reportUrl: `${base.origin}/proxy/${options.toString()}/` };
  } catch (_) {
    // Observability is optional; never prevent an otherwise valid playback.
    return null;
  }
}
