// A launch hint belongs only to the candidate selected when the player mounted.
export function resolveStreamFilename(stream, initialStream, initialFilename = null) {
  const raw = stream?.raw || {};
  const declared =
    stream?.behaviorHints?.filename ||
    raw.behaviorHints?.filename ||
    stream?.filename ||
    raw.filename;
  if (declared) return declared;
  if (stream === initialStream && initialFilename) return initialFilename;
  const url = String(stream?.url || "").split("?")[0];
  const filename = url.slice(url.lastIndexOf("/") + 1);
  return filename && filename.includes(".") ? filename : null;
}
