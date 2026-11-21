// Android ui/screens/party/PartySettingsContent.kt: the Watch party entry in Settings.
import { Router } from "../../navigation/routerState.js";
import { PartyRepository } from "../../../core/party/partyRepository.js";
import { formatPartyCode } from "../../../core/party/partyModels.js";
import { displayTitle, t } from "../party/partyUi.js";
import { SECTION_META } from "./settingsScreenHelpers-03-clamp-subtitle-text-opacity.js";

export function isWatchPartySectionVisible() {
  return PartyRepository.isAvailable();
}

export function renderWatchPartySection() {
  const party = PartyRepository.getState().party;
  this.actionMap.set("watchParty:open", () => Router.navigate("watchParty"));
  const row = party
    ? this.renderActionRow({
        focusKey: "watchParty:open",
        title: displayTitle(party.media),
        subtitle: t("party_seats", [party.members.length, party.maxMembers]),
        value: formatPartyCode(party.code),
        leadingIcon: "groups"
      })
    : this.renderActionRow({
        focusKey: "watchParty:open",
        title: t("party_join_title"),
        subtitle: PartyRepository.canUse()
          ? t("party_join_description")
          : t("party_sign_in_required"),
        leadingIcon: "groups"
      });
  return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "watchParty"))}
      <div class="settings-group-card">
        <div class="settings-stack">${row}</div>
      </div>
    `;
}
