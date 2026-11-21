import {
  MdbListSettingsStore,
  MDBLIST_RATING_ORDER,
  MDBLIST_PROVIDER_SETTINGS
} from "../../../data/local/mdbListSettingsStore.js";
import { mdbListRepository } from "../../../data/repository/mdbListRepository.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { Router } from "../../navigation/routerState.js";

function identity(hero) {
  return [
    hero?.id || hero?.contentId || "",
    hero?.type || hero?.contentType || hero?.apiType || "movie",
    hero?.season ?? 0,
    hero?.episode ?? 0
  ].join("|");
}
function providers(settings) {
  return MDBLIST_RATING_ORDER.filter(
    (key) => settings[MDBLIST_PROVIDER_SETTINGS[key]] !== false
  ).join(",");
}

export function ensureHeroMdbListRatings() {
  const hero = this.heroItem;
  const settings = MdbListSettingsStore.get();
  if (
    !hero?.id ||
    hero.heroSource === "collection" ||
    !settings.enabled ||
    !settings.showOnHero ||
    !settings.apiKey ||
    !providers(settings)
  )
    return;
  const key = identity(hero);
  const profile = ProfileManager.getActiveProfileId();
  const previous = this.heroMdbListRequest;
  if (
    previous &&
    previous.key === key &&
    previous.profile === profile &&
    previous.apiKey === settings.apiKey &&
    previous.providers === providers(settings) &&
    previous.loadToken === this.homeLoadToken
  ) {
    if (previous.ratings && hero.mdbListRatings !== previous.ratings) {
      this.heroItem = { ...hero, mdbListRatings: previous.ratings };
      this.applyHeroToDom();
    }
    return previous.promise;
  }
  const request = {
    key,
    profile,
    apiKey: settings.apiKey,
    providers: providers(settings),
    loadToken: this.homeLoadToken
  };
  this.heroMdbListRequest = request;
  request.promise = mdbListRepository
    .getRatingsForMeta(hero, hero.id, hero.type || hero.apiType || "movie")
    .catch(() => null)
    .then((result) => {
      const currentSettings = MdbListSettingsStore.get();
      if (
        !result?.ratings ||
        this.heroMdbListRequest !== request ||
        Router.getCurrent() !== "home" ||
        this.homeLoadToken !== request.loadToken ||
        ProfileManager.getActiveProfileId() !== profile ||
        identity(this.heroItem) !== key ||
        !currentSettings.enabled ||
        !currentSettings.showOnHero ||
        currentSettings.apiKey !== request.apiKey ||
        providers(currentSettings) !== request.providers
      )
        return;
      request.ratings = result.ratings;
      this.heroItem = { ...this.heroItem, mdbListRatings: result.ratings };
      if (hero.heroSource === "continueWatching") {
        this.continueWatchingDisplay = (this.continueWatchingDisplay || []).map((item) =>
          identity(item) === key ? { ...item, mdbListRatings: result.ratings } : item
        );
        this.persistContinueWatchingSnapshot?.();
      } else {
        this.mergeHeroIntoCatalogState?.(hero.id, this.heroItem);
      }
      this.applyHeroToDom();
    });
  return request.promise;
}
