import {
  hasWatchProgressStarted,
  isWatchProgressCompleted,
  isWatchProgressInProgress
} from "../../../domain/model/watchProgress.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { EpisodeShuffleStore } from "../../../data/local/episodeShuffleStore.js";
import { selectShuffleEpisode } from "../../../core/player/episodeShuffleSelection.js";
import {
  EpisodeShuffle,
  RandomEpisodePicker,
  episodeKey
} from "../../../core/player/episodeShuffle.js";
import { NuvioDialog } from "../../components/nuvioDialog.js";
import { I18n } from "../../../i18n/index.js";
import { watchedItemsShareIdentity } from "../../../data/repository/watchedIdentity.js";
const t = (key) => I18n.t(key);

export function detailShuffleSettings(screen) {
  return EpisodeShuffleStore.get(
    screen.params?.itemId || screen.meta?.id,
    screen.params?.itemType || screen.meta?.type
  );
}
export function selectDetailShuffle(screen, settings = null) {
  return selectShuffleEpisode({
    contentId: screen.params?.itemId || screen.meta?.id,
    contentType: screen.params?.itemType || screen.meta?.type,
    videos: screen.episodes || [],
    surface: "detail",
    watched: screen.watchedEpisodeKeys || new Set(),
    progress: screen.episodeProgressMap || new Map(),
    visit: screen.shuffleVisit || 0,
    reference: screen.meta || {},
    useLocalState: false,
    settings
  });
}
export function openDetailShuffle(screen) {
  if (
    !LayoutPreferences.get().randomEpisodeEnabled ||
    !["series", "tv"].includes(String(screen.params?.itemType || screen.meta?.type).toLowerCase())
  )
    return false;
  const profileId = ProfileManager.getActiveProfileId(),
    token = screen.detailLoadToken;
  const contentId = screen.params?.itemId || screen.meta?.id;
  const draft = { ...detailShuffleSettings(screen), enabled: true };
  let selected = null;
  let choosing = true;
  const picker = new RandomEpisodePicker(
    contentId,
    screen.episodes || [],
    screen.watchedEpisodeKeys || new Set(),
    screen.episodeProgressMap || new Map()
  );
  const current = () =>
    token === screen.detailLoadToken && profileId === ProfileManager.getActiveProfileId();
  const close = () => {
    screen.shuffleDialog?.destroy();
    screen.shuffleDialog = null;
    screen.focusDetailDescriptor({ selector: '[data-action="shuffleEpisodes"]' });
  };
  const choose = () => {
    selected = picker.pick(draft.includeWatched);
  };
  const save = (settings) => {
    if (!current() || !EpisodeShuffleStore.save(contentId, settings, profileId)) return false;
    if (!settings.enabled) EpisodeShuffle.clearSelection(profileId, contentId, "detail");
    screen.nextEpisodeToWatch = screen.computeNextEpisodeToWatch(screen.resumeProgress);
    return true;
  };
  const show = (error = null) => {
    if (!current()) return;
    screen.shuffleDialog?.destroy();
    const startPlayback = (options = {}) => {
      if (!current() || !selected) return;
      if (!save(draft)) {
        show(t("shuffle_save_failed"));
        return;
      }
      close();
      screen.render(screen.meta, { selector: '[data-action="shuffleEpisodes"]' });
      void screen.openEpisodeStreamChooser(selected.id, options);
    };
    const progress = selected ? screen.episodeProgressMap?.get(episodeKey(selected)) : null;
    const resumable = progress && isWatchProgressInProgress(progress);
    const allCount = picker.candidates(true).length;
    const unwatchedCount = picker.candidates(false).length;
    const buttons = choosing
      ? [
          ...[false, true]
            .filter((include) => (include ? allCount > 0 : unwatchedCount > 0))
            .map((includeWatched) => ({
              key: String(includeWatched),
              label: t(
                includeWatched ? "random_episode_include_watched" : "random_episode_unwatched"
              ),
              onAction: () => {
                draft.includeWatched = includeWatched;
                choose();
                choosing = false;
                show();
              }
            })),
          ...(allCount === 0 ? [{ key: "close", label: t("action_close"), onAction: close }] : []),
          ...(detailShuffleSettings(screen).enabled
            ? [
                {
                  key: "stop",
                  label: t("shuffle_stop"),
                  onAction: () => {
                    if (!save({ ...draft, enabled: false })) {
                      show(t("shuffle_save_failed"));
                      return;
                    }
                    close();
                    screen.render(screen.meta, { selector: '[data-action="shuffleEpisodes"]' });
                  }
                }
              ]
            : [])
        ]
      : [
          ...(selected
            ? [
                {
                  key: "play",
                  label: t(resumable ? "detail_btn_resume" : "shuffle_play_episode"),
                  onAction: () => startPlayback()
                },
                {
                  key: "manual",
                  label: t("play_manually"),
                  onAction: () => startPlayback({ manualSelection: true })
                },
                ...(resumable
                  ? [
                      {
                        key: "restart",
                        label: t("detail.playFromBeginning"),
                        onAction: () => startPlayback({ startOver: true })
                      }
                    ]
                  : []),
                ...(picker.candidates(draft.includeWatched).length > 1
                  ? [
                      {
                        key: "again",
                        label: t("shuffle_again"),
                        onAction: () => {
                          choose();
                          show();
                        }
                      }
                    ]
                  : [])
              ]
            : []),
          {
            key: "selection",
            label: t("shuffle_change_selection"),
            onAction: () => {
              choosing = true;
              show();
            }
          }
        ];
    const hidden =
      selected &&
      !screen.isEpisodeMarkedWatched(selected) &&
      LayoutPreferences.get().blurUnwatchedEpisodes;
    const content =
      selected && !choosing && selected.thumbnail && !hidden
        ? () => {
            const image = document.createElement("img");
            image.src = selected.thumbnail;
            image.alt = "";
            image.style.cssText =
              "display:block;width:100%;max-height:22vh;object-fit:cover;border-radius:12px";
            return image;
          }
        : null;
    screen.shuffleDialog = new NuvioDialog({
      title: t("random_episode_title"),
      error,
      content,
      subtitle: choosing
        ? t(
            allCount === 0
              ? "random_episode_empty_subtitle"
              : unwatchedCount === 0
                ? "random_episode_caught_up"
                : "shuffle_choose_episodes"
          )
        : selected
          ? `S${selected.season}E${selected.episode}${hidden ? ` · ${t("shuffle_artwork_hidden")}` : ` · ${selected.title || ""}`}`
          : t(draft.includeWatched ? "random_episode_empty_subtitle" : "random_episode_caught_up"),
      buttons,
      suppressEnterUntilKeyUp: true,
      onDismiss: () => {
        if (!choosing) {
          choosing = true;
          show();
        } else close();
      }
    }).mount(document.body);
  };
  show();
  return true;
}

export function detailShuffleResume(screen, progress = null) {
  return (
    [progress, ...Array.from(screen.episodeProgressMap?.values() || [])]
      .filter(
        (item) =>
          item?.videoId &&
          (!item.contentId ||
            watchedItemsShareIdentity(item, {
              ...screen.meta,
              contentId: screen.params?.itemId || screen.meta?.id
            })) &&
          item.season != null &&
          item.episode != null &&
          hasWatchProgressStarted(item) &&
          !isWatchProgressCompleted(item)
      )
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null
  );
}
