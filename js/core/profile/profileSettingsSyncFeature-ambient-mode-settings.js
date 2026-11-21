import { AmbientModeStore } from "../../data/local/ambientModeStore.js";
function parse(raw = {}) {
  const result = {};
  if (typeof raw.ambient_enabled === "boolean") result.enabled = raw.ambient_enabled;
  if (Number.isFinite(Number(raw.ambient_timeout_minutes)) && raw.ambient_timeout_minutes != null)
    result.timeoutMinutes = Number(raw.ambient_timeout_minutes);
  try {
    const keys = typeof raw.ambient_catalog_keys === "string" ? JSON.parse(raw.ambient_catalog_keys) : raw.ambient_catalog_keys;
    if (Array.isArray(keys)) result.catalogKeys = keys;
  } catch (_) {
    /* Invalid optional keys keep the current selection. */
  }
  return result;
}
export const ambient_mode_settings = {
  export(id) {
    const settings = AmbientModeStore.getForProfile(id);
    return {
      ambient_enabled: settings.enabled,
      ambient_timeout_minutes: settings.timeoutMinutes,
      ambient_catalog_keys: JSON.stringify(settings.catalogKeys)
    };
  },
  project(raw) {
    const settings = parse(raw);
    const result = {};
    if (settings.enabled !== undefined) result.ambient_enabled = settings.enabled;
    if (settings.timeoutMinutes !== undefined) result.ambient_timeout_minutes = settings.timeoutMinutes;
    if (settings.catalogKeys) result.ambient_catalog_keys = JSON.stringify(settings.catalogKeys);
    return result;
  },
  import(id, raw) {
    const partial = parse(raw);
    if (!Object.keys(partial).length) return false;
    AmbientModeStore.setForProfile(id, partial, { silentSync: true });
    return true;
  }
};
