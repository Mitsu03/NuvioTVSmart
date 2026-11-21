var media = require("./bitmapSubtitles").matroska;
var mkv = require("./audioTranscodeMatroska");
function unsigned(b, e) {
  if (!e) return null;
  var n = 0;
  for (var p = e.dataStart; p < e.dataEnd; p++) n = n * 256 + b[p];
  return n;
}
async function prepare(url, trackNumber, trackIndex, context) {
  if (!/^https?:\/\//i.test(String(url || ""))) throw Error("source-url");
  function range(s, e, max) {
    return media.requestRange(url, s, e, max, 0, context);
  }
  var head = await range(0, 2 * 1024 * 1024 - 1, 2 * 1024 * 1024);
  if (!head.totalSize) throw Error("source-size");
  var meta = media.parseHeader(head.buffer, head.totalSize);
  if (meta.timecodeScaleNs !== 1000000) throw Error("time-scale");
  var audios = meta.tracks.filter(function (t) {
    return t.type === 2;
  });
  var selected =
    trackNumber > 0
      ? audios.find(function (t) {
          return t.number === trackNumber;
        })
      : audios[trackIndex];
  if (
    !selected ||
    ["A_DTS", "A_TRUEHD"].indexOf(selected.codecId) < 0 ||
    selected.number > 126 ||
    selected.number < 1 ||
    selected.compression.type !== "none"
  )
    throw Error("track-format");
  var video = meta.tracks.find(function (t) {
    return t.type === 1;
  });
  if (!video) throw Error("video-track");
  var cueProbe = await range(
    meta.cuesOffset,
    Math.min(meta.totalSize - 1, meta.cuesOffset + 65535),
    65536
  );
  var cueHeader = media.readElement(cueProbe.buffer, 0, cueProbe.buffer.length, true);
  if (
    !cueHeader ||
    cueHeader.id !== 0x1c53bb6b ||
    !cueHeader.totalSize ||
    cueHeader.totalSize > 8 * 1024 * 1024
  )
    throw Error("cue-size");
  var cueBuffer =
    cueProbe.buffer.length >= cueHeader.totalSize
      ? cueProbe.buffer
      : (await range(meta.cuesOffset, meta.cuesOffset + cueHeader.totalSize - 1, 8 * 1024 * 1024))
          .buffer;
  var cues = media.parseCues(cueBuffer, meta.timecodeScaleNs).filter(function (c) {
    return c.track === video.number;
  });
  cues = cues
    .filter(function (c, i, a) {
      return i === 0 || c.clusterPosition !== a[i - 1].clusterPosition;
    })
    .map(function (c) {
      return { timeMs: c.timeMs, start: meta.segmentDataStart + c.clusterPosition };
    });
  if (!cues.length || cues[0].timeMs > 100 || cues[0].start > head.buffer.length)
    throw Error("first-cue");
  for (var i = 1; i < cues.length; i++)
    if (cues[i].start <= cues[i - 1].start) throw Error("cue-order");
  var header = Buffer.from(head.buffer.subarray(0, cues[0].start));
  var eb = media.readElement(header, 0, header.length, false),
    segment = media.readElement(header, eb.declaredDataEnd, header.length, true);
  var parents = mkv.children(header, segment.dataStart, header.length),
    tracks = parents.find(function (e) {
      return e.id === 0x1654ae6b;
    });
  if (!tracks) throw Error("tracks");
  function discard(e) {
    mkv.voidPad(e.declaredDataEnd - e.start).copy(header, e.start);
  }
  parents
    .filter(function (e) {
      return e.id === 0xbf;
    })
    .forEach(discard);
  var entries = mkv.children(header, tracks.dataStart, tracks.dataEnd);
  entries
    .filter(function (e) {
      return e.id === 0xbf;
    })
    .forEach(discard);
  var found = false,
    downmix = false;
  entries
    .filter(function (e) {
      return e.id === 0xae;
    })
    .forEach(function (entry) {
      var fields = mkv.children(header, entry.dataStart, entry.dataEnd);
      if (
        unsigned(
          header,
          fields.find(function (e) {
            return e.id === 0xd7;
          })
        ) !== selected.number
      )
        return;
      if (
        fields.some(function (e) {
          return e.id === 0x6d80;
        })
      )
        throw Error("encoded-track");
      var codec = fields.find(function (e) {
          return e.id === 0x86;
        }),
        audio = fields.find(function (e) {
          return e.id === 0xe1;
        });
      var codecLength = selected.codecId === "A_TRUEHD" ? 8 : 5;
      if (!codec || codec.dataEnd - codec.dataStart !== codecLength || !audio)
        throw Error("track-header");
      var audioFields = mkv.children(header, audio.dataStart, audio.dataEnd),
        sample = audioFields.find(function (e) {
          return e.id === 0xb5;
        }),
        channels = unsigned(
          header,
          audioFields.find(function (e) {
            return e.id === 0x9f;
          })
        );
      var rate =
        sample &&
        (sample.dataEnd - sample.dataStart === 4
          ? header.readFloatBE(sample.dataStart)
          : sample.dataEnd - sample.dataStart === 8
            ? header.readDoubleBE(sample.dataStart)
            : 0);
      if (rate !== 48000 || !channels || channels > 8) throw Error("audio-layout");
      downmix = channels > 6;
      if (downmix) {
        var channelField = audioFields.find(function (e) {
          return e.id === 0x9f;
        });
        header.fill(0, channelField.dataStart, channelField.dataEnd);
        header[channelField.dataEnd - 1] = 6;
      }
      header.write("A_AC3", codec.dataStart);
      if (codecLength > 5) {
        mkv.size(5, codec.dataStart - codec.start - 1).copy(header, codec.start + 1);
        mkv.voidPad(codecLength - 5).copy(header, codec.dataStart + 5);
      }
      fields
        .filter(function (e) {
          return [0x63a2, 0xbf, 0x23e383].indexOf(e.id) >= 0;
        })
        .forEach(discard);
      audioFields
        .filter(function (e) {
          return e.id === 0x6264 || e.id === 0xbf;
        })
        .forEach(discard);
      found = true;
    });
  if (!found) throw Error("track-header");
  return {
    header: header,
    cues: cues,
    meta: meta,
    trackNumber: selected.number,
    trackIndex: audios.indexOf(selected),
    downmix: downmix,
    format: selected.codecId === "A_TRUEHD" ? "truehd" : "dts"
  };
}
module.exports = { prepare: prepare };
