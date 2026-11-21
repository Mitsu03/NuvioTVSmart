import { MdbListAccount } from "../../../data/repository/mdbListAccount.js";
import { registerMdbListAccountActions } from "./settingsMdbListAccount.js";
import { MDBLIST_PROVIDER_SETTINGS } from "../../../data/local/mdbListSettingsStore.js";
/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function renderMdblistIntegrationDetail(model) {
  const { MdbListSettingsStore, mdbListRepository, t, maskValue } = internals;

  registerMdbListAccountActions.call(this);
  const toggleMdbListSetting = (field) => {
    MdbListSettingsStore.set({ [field]: !MdbListSettingsStore.get()[field] });
  };
  this.actionMap.set("integration:mdblist:enabled", () => {
    MdbListSettingsStore.set({ enabled: !MdbListSettingsStore.get().enabled });
  });
  this.actionMap.set("integration:mdblist:key", () => {
    this.openTextDialog({
      title: t("settings.integration.mdblist.dialog.title"),
      value: MdbListSettingsStore.get().apiKey || "",
      placeholder: t("settings.integration.mdblist.dialog.placeholder"),
      returnFocusKey: "integration:mdblist:key",
      clearLabel: t("common.clear", {}, t("action_clear", {}, "Clear")),
      onClear: () => {
        MdbListSettingsStore.set({ apiKey: "" });
        return true;
      },
      onSubmit: async (value) => {
        const trimmed = String(value || "").trim();
        if (trimmed) {
          if (this.textDialog) {
            this.textDialog.statusMessage = t("action_saving", {}, "Saving...");
            this.textDialog.statusKind = "info";
            await this.render({ refreshModel: false });
          }
          const valid = await mdbListRepository.validateApiKey(trimmed);
          if (!valid) {
            if (this.textDialog) {
              this.textDialog.statusMessage = t("settings.integration.mdblist.invalidApiKey");
              this.textDialog.statusKind = "error";
            }
            return false;
          }
        }
        MdbListSettingsStore.set({ apiKey: trimmed });
        return true;
      }
    });
  });
  [
    ["trakt", "showTrakt"],
    ["imdb", "showImdb"],
    ["tmdb", "showTmdb"],
    ["letterboxd", "showLetterboxd"],
    ["tomatoes", "showTomatoes"],
    ["audience", "showAudience"],
    ["metacritic", "showMetacritic"],
    ["mal", "showMal"]
  ].forEach(([provider, field]) => {
    this.actionMap.set(`integration:mdblist:${provider}`, () => toggleMdbListSetting(field));
  });

  this.actionMap.set("integration:mdblist:hero", () => toggleMdbListSetting("showOnHero"));
  const ratingOrder = model.mdbList.ratingOrder;
  const moveRating = (provider, delta) => {
    const order = [...MdbListSettingsStore.get().ratingOrder];
    const from = order.indexOf(provider);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length || !MdbListSettingsStore.get().enabled) return;
    [order[from], order[to]] = [order[to], order[from]];
    MdbListSettingsStore.set({ ratingOrder: order });
    if ((delta < 0 && to === 0) || (delta > 0 && to === order.length - 1)) {
      this.contentFocusKey = `integration:mdblist:${provider}`;
    }
  };
  const arrow = (provider, direction, disabled) => {
    const key = `integration:mdblist:${direction}:${provider}`;
    this.actionMap.set(key, () => moveRating(provider, direction === "up" ? -1 : 1));
    return `<button class="settings-action-row settings-mdb-order-arrow${disabled ? " is-disabled" : " settings-content-focusable focusable"}" data-zone="content" ${this.registerAction(key, this.actionMap.get(key))} ${disabled ? 'disabled aria-disabled="true"' : ""} aria-label="${internals.escapeAttribute(t(direction === "up" ? "cd_move_up" : "cd_move_down"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction === "up" ? "M7 14l5-5 5 5z" : "M7 10l5 5 5-5z"}" fill="currentColor"/></svg></button>`;
  };

  return `
        ${this.renderSectionHeader({ labelKey: "settings.integration.mdblist.label", subtitleKey: "settings.integration.mdblist.subtitle" })}
        <div class="settings-group-card settings-group-card-fill">
          <div class="settings-stack">
            ${this.renderActionRow({
              focusKey: "integration:back",
              title: t("settings.integration.backToIntegrations.title"),
              subtitle: t("settings.integration.backToIntegrations.subtitle"),
              icon: "back"
            })}
            ${this.renderActionRow({ focusKey: "integration:mdblist:account", title: "MDBList", subtitle: MdbListAccount.connected() ? t("mdblist_connected_as", [MdbListAccount.user()?.name || t("mdblist_account_fallback")]) : t("mdblist_status_enter_code"), value: MdbListAccount.connected() ? t("debrid_disconnect") : t("servers_connect"), disabled: !MdbListAccount.configured() && !MdbListAccount.connected() })}
            ${!MdbListAccount.configured() ? `<p>${internals.escapeHtml(t("mdblist_missing_client"))}</p>` : ""}
            ${this.mdbListAccountMessage ? `<p>${internals.escapeHtml(this.mdbListAccountMessage)}</p>` : ""}
            ${MdbListAccount.connected() ? this.renderActionRow({ focusKey: "integration:mdblist:lists", title: t("mdblist_library_lists"), subtitle: t("mdblist_library_lists_description") }) : ""}
            ${this.renderToggleRow({
              focusKey: "integration:mdblist:enabled",
              title: t("settings.integration.mdblist.enable.title"),
              subtitle: t("settings.integration.mdblist.enable.subtitle"),
              checked: Boolean(model.mdbList.enabled)
            })}
            ${this.renderActionRow({
              focusKey: "integration:mdblist:key",
              title: t("settings.integration.mdblist.apiKey.title"),
              subtitle: t("settings.integration.mdblist.apiKey.subtitle"),
              value: maskValue(model.mdbList.apiKey, t("common.notSet")),
              disabled: !model.mdbList.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:mdblist:hero",
              title: t("mdblist_show_on_hero_title"),
              subtitle: t("mdblist_show_on_hero_subtitle"),
              checked: Boolean(model.mdbList.showOnHero),
              disabled: !model.mdbList.enabled
            })}
            <div class="settings-mdb-order-heading">
              <h3>${t("mdblist_rating_order_title")}</h3>
              <p>${t("mdblist_rating_order_subtitle")}</p>
            </div>
            ${ratingOrder
              .map(
                (provider, index) => `<div class="settings-mdb-order-row">
              ${this.renderToggleRow({ focusKey: `integration:mdblist:${provider}`, title: t(`settings.integration.mdblist.${provider}.title`), checked: model.mdbList[MDBLIST_PROVIDER_SETTINGS[provider]] !== false, disabled: !model.mdbList.enabled })}
              ${arrow(provider, "up", !model.mdbList.enabled || index === 0)}
              ${arrow(provider, "down", !model.mdbList.enabled || index === ratingOrder.length - 1)}
            </div>`
              )
              .join("")}
          </div>
        </div>
      `;
}
