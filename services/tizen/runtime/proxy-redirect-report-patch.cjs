/* Shared by the Tizen and bundled webOS services. Keep injected code ES5. */
module.exports = function patchProxyRedirectReports(source) {
  if (source.indexOf("/* NUVIO_PROXY_REDIRECT_REPORTS */") >= 0) return source;
  function replaceOnce(target, replacement) {
    var index = source.indexOf(target);
    if (index < 0 || source.indexOf(target, index + target.length) >= 0) {
      throw new Error("Unsupported media proxy redirect-report layout");
    }
    source = source.replace(target, replacement);
  }

  // This function is injected into the proxy module, not executed by the patcher.
  function createNuvioRedirectReports() {
    var records = Object.create(null);
    var ttl = 120000;
    var maximum = 64;
    function valid(id) { return typeof id === "string" && /^[0-9a-f]{32}$/.test(id); }
    function prune() {
      var now = Date.now();
      Object.keys(records).forEach(function (id) {
        if (now - records[id].touched > ttl) delete records[id];
      });
    }
    function http(value) { return typeof value === "string" && value.length <= 16384 && /^https?:\/\//i.test(value); }
    return {
      begin: function (id, requestedUrl) {
        if (!valid(id) || !http(requestedUrl)) return 0;
        prune();
        var record = records[id];
        if (!record) {
          var ids = Object.keys(records);
          if (ids.length >= maximum) {
            ids.sort(function (a, b) { return records[a].touched - records[b].touched; });
            delete records[ids[0]];
          }
          record = records[id] = { requestedUrl: requestedUrl, sequence: 0, touched: Date.now() };
        }
        // A child playlist/segment may inherit the trace. Only root reopens count.
        if (record.requestedUrl !== requestedUrl) return 0;
        record.touched = Date.now();
        return ++record.sequence;
      },
      complete: function (id, sequence, resolvedUrl, status) {
        var record = valid(id) && records[id];
        if (!record || !sequence || sequence !== record.sequence || status < 200 || status >= 300 || !http(resolvedUrl)) return;
        record.resolvedUrl = resolvedUrl;
        record.completedSequence = sequence;
        record.touched = Date.now();
      },
      respond: function (req, res, id) {
        prune();
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "GET" || !valid(id)) {
          res.statusCode = req.method === "GET" ? 400 : 405;
          res.end('{"status":"invalid"}');
          return;
        }
        var record = records[id];
        if (record) record.touched = Date.now();
        res.end(JSON.stringify(record && record.resolvedUrl ? {
          status: "resolved", requestedUrl: record.requestedUrl,
          resolvedUrl: record.resolvedUrl, sequence: record.completedSequence
        } : { status: "pending" }));
      }
    };
  }

  replaceOnce('cfgOpts={Destination:"d",DestinationHeader:"h",ResponseHeader:"r"}',
    'nuvioRedirectReports=(' + createNuvioRedirectReports.toString() + ')(),cfgOpts={Destination:"d",DestinationHeader:"h",ResponseHeader:"r"}');
  replaceOnce('var opts=querystring.parse(req.params.opts);',
    'var opts=querystring.parse(req.params.opts),nuvioReportSequence=0;if(opts.nuvioReport==="1"){nuvioRedirectReports.respond(req,res,opts.nuvioTrace);return;}');
  replaceOnce('handleFetchWithRedirects(dest,req,headers,httpsAgent,opts,cfgOpts).then',
    'nuvioReportSequence=nuvioRedirectReports.begin(opts.nuvioTrace,url.format(dest)),handleFetchWithRedirects(dest,req,headers,httpsAgent,opts,cfgOpts).then');
  replaceOnce('var responseHeaders=makeHeaders(result.headers,proxyResHeaders);',
    'nuvioRedirectReports.complete(opts.nuvioTrace,nuvioReportSequence,url.format(dest),result.status);var responseHeaders=makeHeaders(result.headers,proxyResHeaders);');
  return source + "\n/* NUVIO_PROXY_REDIRECT_REPORTS */\n";
};
