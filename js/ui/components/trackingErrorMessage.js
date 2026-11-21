import { I18n } from "../../i18n/index.js";

export function trackingErrorMessage(error, fallback = error?.message) {
  return String(error?.code || "").startsWith("mdblist_")
    ? I18n.t(error.code, {}, { fallback: I18n.t("mdblist_unavailable") })
    : fallback;
}
