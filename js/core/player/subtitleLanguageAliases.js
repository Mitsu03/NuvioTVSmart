const OPENSUBTITLES_SPANISH_ALIASES = Object.freeze({
  spn: "es",
  sp: "es",
  esp: "es",
  spl: "es-419"
});

export function normalizeOpenSubtitlesSpanishCode(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase();
  return Object.prototype.hasOwnProperty.call(OPENSUBTITLES_SPANISH_ALIASES, code)
    ? OPENSUBTITLES_SPANISH_ALIASES[code]
    : "";
}

export function normalizeHbsLanguageAlias(value, aliases = { bos: "bs", hrv: "hr", srp: "sr" }) {
  const tokenized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-_./]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!tokenized.startsWith("hbs")) return "";
  const language = tokenized.slice(3).trim();
  return Object.prototype.hasOwnProperty.call(aliases, language) ? aliases[language] : "";
}

const LANGUAGE_CODE_ALIASES = Object.freeze({
  id: "id",
  in: "id",
  ind: "id",
  ms: "ms",
  may: "ms",
  msa: "ms"
});

function normalizeLanguageText(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  const withoutAccents =
    typeof text.normalize === "function"
      ? text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      : text;
  return withoutAccents
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasWholeWord(text, value) {
  return ` ${text} `.includes(` ${value} `);
}

/**
 * Resolve subtitle-only language aliases without changing the broader audio
 * track language mapping. Human-readable labels take precedence over an
 * ambiguous Malay/Malaysian technical code when they explicitly say
 * Indonesian.
 */
export function normalizeSubtitleLanguageAlias(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const providerCode = normalizeOpenSubtitlesSpanishCode(raw) || normalizeHbsLanguageAlias(raw);
  if (providerCode) return providerCode;

  const text = normalizeLanguageText(raw);
  if (
    hasWholeWord(text, "bahasa indonesia") ||
    hasWholeWord(text, "indonesia") ||
    hasWholeWord(text, "indonesian")
  ) {
    return "id";
  }
  if (
    hasWholeWord(text, "bahasa malaysia") ||
    hasWholeWord(text, "bahasa melayu") ||
    hasWholeWord(text, "malay") ||
    hasWholeWord(text, "malaysian")
  ) {
    return "ms";
  }

  const codeMatch = raw.match(/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i);
  if (!codeMatch) {
    return "";
  }
  const baseCode = codeMatch[0].split(/[-_]/)[0].toLowerCase();
  return LANGUAGE_CODE_ALIASES[baseCode] || "";
}
