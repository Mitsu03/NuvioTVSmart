import { ProfileManager } from "../../../core/profile/profileManager.js";
import { AmbientModeStore, AMBIENT_TIMEOUT_OPTIONS } from "../../../data/local/ambientModeStore.js";
import { getAmbientCatalogs } from "../../ambient/ambientCatalogs.js";
import { I18n } from "../../../i18n/index.js";
const t = (key, params = []) => I18n.t(key, params, { fallback: key });
export function renderAmbientSection() {
  const settings = AmbientModeStore.get();
  const pid = ProfileManager.getActiveProfileId();
  const mount = this.settingsMountToken;
  const current = () =>
    this.isMounted &&
    this.activeSection === "ambient" &&
    this.settingsMountToken === mount &&
    ProfileManager.getActiveProfileId() === pid;
  this.actionMap.set(
    "ambient:enabled",
    () => current() && AmbientModeStore.set({ enabled: !AmbientModeStore.get().enabled })
  );
  this.actionMap.set("ambient:timeout", () =>
    this.openOptionDialog({
      title: t("ambient_mode_timeout"),
      options: AMBIENT_TIMEOUT_OPTIONS.map((minutes) => ({
        id: String(minutes),
        label: I18n.getQuantityString("ambient_mode_timeout_minutes", minutes, [minutes])
      })),
      selectedId: String(settings.timeoutMinutes),
      returnFocusKey: "ambient:timeout",
      onSelect: (option) => current() && AmbientModeStore.set({ timeoutMinutes: Number(option.id) })
    })
  );
  this.actionMap.set("ambient:catalogs", async () => {
    const mountToken = this.settingsMountToken;
    const profileId = ProfileManager.getActiveProfileId();
    const catalogs = await getAmbientCatalogs();
    if (
      !this.isMounted ||
      this.activeSection !== "ambient" ||
      this.settingsMountToken !== mountToken ||
      ProfileManager.getActiveProfileId() !== profileId
    )
      return;
    this.openMultiChoiceDialog({
      title: t("ambient_mode_catalogs"),
      message: t("ambient_mode_catalogs_dialog_subtitle"),
      options: catalogs.map((entry) => ({
        id: entry.key,
        label: `${entry.title} · ${entry.source}`
      })),
      selectedIds: AmbientModeStore.get().catalogKeys,
      returnFocusKey: "ambient:catalogs",
      onToggle: (keys) => {
        if (!current()) return;
        if (keys.length <= 3) AmbientModeStore.set({ catalogKeys: keys });
        else this.optionDialog.selectedIds = new Set(AmbientModeStore.get().catalogKeys);
      }
    });
  });
  return `<div class="settings-stack">${this.renderToggleRow({ focusKey: "ambient:enabled", title: t("ambient_mode_title"), subtitle: t("ambient_mode_enabled_subtitle"), checked: settings.enabled })}${settings.enabled ? this.renderActionRow({ focusKey: "ambient:timeout", title: t("ambient_mode_timeout"), subtitle: t("ambient_mode_timeout_subtitle"), value: I18n.getQuantityString("ambient_mode_timeout_minutes", settings.timeoutMinutes, [settings.timeoutMinutes]) }) + this.renderActionRow({ focusKey: "ambient:catalogs", title: t("ambient_mode_catalogs"), subtitle: t("ambient_mode_catalogs_subtitle"), value: settings.catalogKeys.length ? t("ambient_mode_catalogs_count", [settings.catalogKeys.length, 3]) : t("ambient_mode_catalogs_default") }) : ""}</div>`;
}
