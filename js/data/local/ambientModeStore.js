import { createProfileScopedStore } from "./profileScopedStore.js";
export const AMBIENT_TIMEOUT_OPTIONS = [1, 2, 5, 10, 15, 30];
export function normalizeAmbientSettings(value = {}) {
  return {
    enabled: value.enabled !== false,
    timeoutMinutes: AMBIENT_TIMEOUT_OPTIONS.includes(Number(value.timeoutMinutes))
      ? Number(value.timeoutMinutes)
      : 5,
    catalogKeys: [
      ...new Set(
        (Array.isArray(value.catalogKeys) ? value.catalogKeys : []).filter(
          (key) => typeof key === "string" && key
        )
      )
    ].slice(0, 3)
  };
}
const store = createProfileScopedStore({
  key: "ambientModeSettings",
  normalize: normalizeAmbientSettings
});
export const AmbientModeStore = {
  get: () => store.get(),
  getForProfile: (id) => store.getForProfile(id),
  set: (partial) => store.set(partial),
  setForProfile: (id, partial, options) => store.setForProfile(id, partial, options)
};
