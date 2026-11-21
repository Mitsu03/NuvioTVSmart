// DASH may reference absolute CDNs in BaseURL/SegmentTemplate. Keep those
// requests on the already-selected playback proxy when native headers are needed.
export function routeAdaptiveProxyRequest(requestUrl, playbackUrl) {
  try {
    const proxy = new URL(playbackUrl);
    const target = new URL(requestUrl, proxy);
    if (!/^https?:$/.test(target.protocol) || !proxy.pathname.startsWith("/proxy/"))
      return requestUrl;
    if (target.origin === proxy.origin && target.pathname.startsWith("/proxy/")) return target.href;
    const options = new URLSearchParams(proxy.pathname.slice(7).split("/")[0]);
    if (!options.get("d")) return requestUrl;
    options.set("d", target.origin);
    proxy.pathname = `/proxy/${options.toString()}${target.pathname}`;
    proxy.search = target.search;
    proxy.hash = "";
    return proxy.href;
  } catch (_) {
    return requestUrl;
  }
}

export function applyAdaptiveRequestHeaders(request, forwardedHeaders, playbackUrl) {
  const headers = new Headers(request.headers || {});
  Object.entries(forwardedHeaders).forEach(([name, value]) => headers.set(name, value));
  request.headers = Object.fromEntries(headers.entries());
  request.url = routeAdaptiveProxyRequest(request.url, playbackUrl);
  return Promise.resolve(request);
}
