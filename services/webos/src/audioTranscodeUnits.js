const media = require("./bitmapSubtitles").matroska;
const LIMIT = 8 * 1024 * 1024;
// Cues locate seek points, not every Cluster. Discover bounded units only in
// oversized cue intervals; ordinary intervals retain the existing path.
function createUnits(cues, cuesOffset, fetchRange) {
  const cache = new Map();
  async function at(position, ctx) {
    if (ctx.cancelled) throw Error("cancelled");
    if (position >= cuesOffset) return null;
    let index = 0;
    for (let i = 0; i < cues.length && cues[i].start <= position; i++) index = i;
    const cue = cues[index],
      end = cues[index + 1]?.start ?? cuesOffset;
    if (end - cue.start <= LIMIT) return { start: cue.start, end, timeMs: cue.timeMs };
    let start = cue.start;
    while (start < end) {
      if (ctx.cancelled) throw Error("cancelled");
      let unit = cache.get(start);
      if (!unit) {
        // Only element headers are probed. Never read the whole cue interval.
        const probe = (await fetchRange(start, Math.min(end - 1, start + 65535), ctx)).buffer;
        const cluster = media.readElement(probe, 0, probe.length, true);
        if (!cluster || cluster.id !== 0x1f43b675 || !cluster.totalSize)
          throw Error("cluster-header");
        let next = start + cluster.totalSize;
        if (cluster.totalSize > LIMIT) throw Error("cluster-limit");
        if (next > end) throw Error("cluster-boundary");
        let p = cluster.dataStart,
          timeMs = null;
        while (p < cluster.dataEnd) {
          const child = media.readElement(probe, p, cluster.dataEnd, true);
          if (!child) break;
          if (child.id === 0xe7 && !child.truncated) {
            timeMs = 0;
            for (let j = child.dataStart; j < child.dataEnd; j++) timeMs = timeMs * 256 + probe[j];
            break;
          }
          p = child.declaredDataEnd;
        }
        if (timeMs === null) throw Error("cluster-timecode");
        // Preserve inter-cluster elements and offsets, without treating them as
        // independent audio units. Unknown sizes remain a protected failure.
        let elements = 0;
        while (next < end) {
          if (++elements > 1024 || ctx.cancelled)
            throw Error(ctx.cancelled ? "cancelled" : "element-budget");
          const bytes = (await fetchRange(next, Math.min(end - 1, next + 15), ctx)).buffer;
          const element = media.readElement(bytes, 0, bytes.length, true);
          if (!element || !element.totalSize) throw Error("cluster-header");
          if (element.id === 0x1f43b675) break;
          next += element.totalSize;
          if (next > end) throw Error("cluster-boundary");
          if (next - start > LIMIT) throw Error("cluster-limit");
        }
        unit = { start, end: next, timeMs };
        if (ctx.cancelled) throw Error("cancelled");
        cache.set(start, unit);
        while (cache.size > 64) cache.delete(cache.keys().next().value);
      }
      if (position < unit.end) return unit;
      start = unit.end;
    }
    throw Error("cluster-boundary");
  }
  return { at };
}
module.exports = { createUnits };
