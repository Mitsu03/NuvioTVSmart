// Tizen direct-source redirect resolution for AVPlay.
import assert from "node:assert/strict";

const { resolveTizenDirectRedirect, describeSourceHost } =
  await import("../js/platform/tizen/tizenRedirectResolver.js");

function fakeFetch({ finalUrl, status = 206, headers = {}, delayMs = 0, fail = false } = {}) {
  const calls = [];
  const impl = (url, init) => {
    calls.push({ url, init });
    if (fail) return Promise.reject(new TypeError("network"));
    const response = {
      url: finalUrl ?? url,
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      body: { cancel() {} }
    };
    return delayMs
      ? new Promise((resolve) => setTimeout(() => resolve(response), delayMs))
      : Promise.resolve(response);
  };
  impl.calls = calls;
  return impl;
}

const ADDON = "https://aiostreams.example/api/v1/playback/abc123/movie.mkv";
const CDN = "https://cdn42.debrid.example/dl/xyz/movie.mkv?token=t";

// 1. Redirect endpoint resolves to the final media URL with a ranged GET.
{
  const fetchImpl = fakeFetch({
    finalUrl: CDN,
    headers: { "accept-ranges": "bytes", "content-range": "bytes 0-0/123" }
  });
  const result = await resolveTizenDirectRedirect(ADDON, {}, { fetchImpl });
  assert.equal(result.redirected, true);
  assert.equal(result.url, CDN);
  assert.equal(result.details.status, 206);
  assert.equal(result.details.acceptRanges, "bytes");
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].init.headers.Range, "bytes=0-0");
  assert.equal(fetchImpl.calls[0].init.redirect, "follow");
}

// 2. Direct file URL: no redirect, original URL kept, server details reported.
{
  const fetchImpl = fakeFetch({ status: 200, headers: {} });
  const result = await resolveTizenDirectRedirect(CDN, {}, { fetchImpl });
  assert.equal(result.redirected, false);
  assert.equal(result.url, CDN);
  assert.equal(result.reason, "no-redirect");
  assert.equal(result.details.status, 200);
  assert.equal(result.details.acceptRanges, null);
}

// 3. Sources with headers AVPlay cannot replay are left untouched.
{
  const fetchImpl = fakeFetch({ finalUrl: CDN });
  const result = await resolveTizenDirectRedirect(
    ADDON,
    { Authorization: "Bearer x" },
    { fetchImpl }
  );
  assert.equal(result.redirected, false);
  assert.equal(result.reason, "request-headers");
  assert.equal(fetchImpl.calls.length, 0);
  const withUa = await resolveTizenDirectRedirect(ADDON, { "User-Agent": "Nuvio" }, { fetchImpl });
  assert.equal(withUa.redirected, true, "a User-Agent header alone does not block resolution");
}

// 4. Local proxy, HLS/DASH manifests and non-HTTP URLs are skipped.
{
  const fetchImpl = fakeFetch({ finalUrl: CDN });
  assert.equal(
    (await resolveTizenDirectRedirect("http://127.0.0.1:2710/proxy/x", {}, { fetchImpl })).reason,
    "local"
  );
  assert.equal(
    (await resolveTizenDirectRedirect("https://x.example/a/master.m3u8", {}, { fetchImpl })).reason,
    "adaptive-manifest"
  );
  assert.equal(
    (await resolveTizenDirectRedirect("https://x.example/a/manifest.mpd", {}, { fetchImpl }))
      .reason,
    "adaptive-manifest"
  );
  assert.equal(
    (await resolveTizenDirectRedirect("magnet:?xt=urn:btih:abc", {}, { fetchImpl })).reason,
    "not-http"
  );
  assert.equal(fetchImpl.calls.length, 0);
}

// 5. Network failures and timeouts fall back to the original URL.
{
  const failed = await resolveTizenDirectRedirect(
    ADDON,
    {},
    { fetchImpl: fakeFetch({ fail: true }) }
  );
  assert.equal(failed.url, ADDON);
  assert.equal(failed.reason, "fetch-failed");
  const slow = await resolveTizenDirectRedirect(
    ADDON,
    {},
    { fetchImpl: fakeFetch({ finalUrl: CDN, delayMs: 200 }), timeoutMs: 20 }
  );
  assert.equal(slow.url, ADDON);
  assert.equal(slow.reason, "timeout");
}

// 6. Diagnostics only expose hosts, never paths or tokens.
assert.equal(describeSourceHost(CDN), "cdn42.debrid.example");
assert.equal(describeSourceHost("not a url"), null);

console.log("tizen redirect resolver tests passed");
