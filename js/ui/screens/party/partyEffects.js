// Android ui/screens/party/PartyEffects.kt: app-wide watch party toasts and
// an availability refresh whenever the app comes to the foreground.
import { PartyRepository } from "../../../core/party/partyRepository.js";
import { PartyEventType } from "../../../core/party/partyModels.js";
import { t } from "./partyUi.js";

const TOAST_DURATION_MS = 2000;
let installed = false;
let toastTimer = null;

export function showPartyToast(message) {
  const text = String(message || "").trim();
  if (!text || typeof document === "undefined") return;
  let toast = document.getElementById("partyToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "partyToast";
    toast.className = "party-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), TOAST_DURATION_MS);
}

export function partyEventMessage(event) {
  switch (event?.type) {
    case PartyEventType.MemberJoined:
      return t("party_member_joined", [event.name]);
    case PartyEventType.MemberLeft:
      return t("party_member_left", [event.name]);
    case PartyEventType.Removed:
      return t("party_removed");
    case PartyEventType.Ended:
      return t("party_ended");
    case PartyEventType.MediaChanged:
      return t("party_media_changed", [event.media?.title || ""]);
    case PartyEventType.ControlChanged:
      return t(event.hostOnly ? "party_control_host_only" : "party_control_everyone");
    default:
      return "";
  }
}

export function installPartyEffects(repository = PartyRepository) {
  if (installed) return;
  installed = true;
  repository.subscribeEvents((event) => showPartyToast(partyEventMessage(event)));
  void repository.refreshAvailability();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void repository.refreshAvailability();
  });
}
