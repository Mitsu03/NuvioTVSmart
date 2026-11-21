import { CUSTOM_POSTER_SCREENS } from "../poster/customPosterScreens.js";

function screensFromRemote(value) {
  // Android removes the key for ALL and stores "none" for an empty selection.
  if (value == null) return [...CUSTOM_POSTER_SCREENS];
  if (!value.trim() || value === "none") return [];
  return [...new Set(value.split(",").filter((key) => CUSTOM_POSTER_SCREENS.includes(key)))];
}

export function projectCustomPosterSettings(raw = {}) {
  const screens = screensFromRemote(
    typeof raw.custom_poster_enabled_screens === "string" ? raw.custom_poster_enabled_screens : null
  );
  return {
    custom_poster_url_pattern:
      typeof raw.custom_poster_url_pattern === "string" ? raw.custom_poster_url_pattern.trim() : "",
    custom_poster_enabled_screens: screens.length ? screens.join(",") : "none"
  };
}

export function importCustomPosterSettings(raw = {}, authoritative = false) {
  const result = {};
  if (authoritative || typeof raw.custom_poster_url_pattern === "string") {
    result.customPosterUrlPattern =
      typeof raw.custom_poster_url_pattern === "string" ? raw.custom_poster_url_pattern : "";
  }
  if (authoritative || typeof raw.custom_poster_enabled_screens === "string") {
    result.customPosterEnabledScreens = screensFromRemote(
      typeof raw.custom_poster_enabled_screens === "string"
        ? raw.custom_poster_enabled_screens
        : null
    );
  }
  return result;
}
