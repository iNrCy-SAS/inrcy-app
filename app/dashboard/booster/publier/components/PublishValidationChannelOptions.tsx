import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import type { ChannelKey } from "../publishModal.shared";
import type { MetaPrimaryPublicationPlacement } from "@/lib/metaPublicationTargets";
import { getMetaImageMotionDuration } from "@/lib/metaImageMotionTiming";
import type PublishContentEditorPanel from "./PublishContentEditorPanel";
import css from "./PublishValidationChannelOptions.module.css";

type Props = Pick<ComponentProps<typeof PublishContentEditorPanel>,
  | "pinterestBoards" | "pinterestBoardId" | "pinterestBoardsLoading" | "pinterestBoardsError" | "onPinterestBoardChange"
  | "threadsPublicationMode" | "threadsPublicationPreferences" | "threadsPreferencesLoading" | "threadsPreferencesFailed" | "onThreadsPublicationModeChange"
  | "facebookPublicationPlacement" | "facebookStoryEnabled" | "facebookPublicationPreferences" | "onFacebookPublicationPlacementChange" | "onFacebookStoryEnabledChange"
  | "instagramPublicationPlacement" | "instagramStoryEnabled" | "instagramPublicationPreferences" | "onInstagramPublicationPlacementChange" | "onInstagramStoryEnabledChange"
  | "facebookMediaMode" | "facebookImageCount" | "instagramMediaMode" | "instagramImageCount"
> & { channel: ChannelKey; disabled?: boolean };

/** The same controlled values and callbacks are used by Contents and Validation. */
export default function PublishValidationChannelOptions(props: Props) {
  const t = useTranslations("booster");
  const { channel, disabled = false } = props;
  if (channel === "facebook" || channel === "instagram") {
    const facebook = channel === "facebook";
    const placement = facebook ? props.facebookPublicationPlacement : props.instagramPublicationPlacement;
    const preferences = facebook ? props.facebookPublicationPreferences : props.instagramPublicationPreferences;
    const storyEnabled = facebook ? props.facebookStoryEnabled : props.instagramStoryEnabled;
    const onPlacement = facebook ? props.onFacebookPublicationPlacementChange : props.onInstagramPublicationPlacementChange;
    const onStory = facebook ? props.onFacebookStoryEnabledChange : props.onInstagramStoryEnabledChange;
    const imageCount = (facebook ? props.facebookImageCount : props.instagramImageCount) || 0;
    const mode = facebook ? props.facebookMediaMode : props.instagramMediaMode;
    const durationHint = mode === "images" && imageCount > 0 ? [
      placement === "reel" ? t("publication_reel_duration_hint", { duration: getMetaImageMotionDuration(imageCount, "reel"), secondsPerImage: getMetaImageMotionDuration(1, "reel") }) : null,
      placement === "story" || storyEnabled ? t("publication_story_duration_hint", { secondsPerImage: getMetaImageMotionDuration(1, "story") }) : null,
    ].filter(Boolean).join(" · ") || undefined : undefined;
    const changePlacement = (value: string) => {
      if (disabled || !["classic", "reel", "story"].includes(value)) return;
      if (value === "reel" && !preferences.reelsEnabled || value === "story" && !preferences.storiesEnabled) return;
      onPlacement(value as MetaPrimaryPublicationPlacement);
      if (value === "story") onStory(false);
    };
    return <div className={css.options} data-channel-validation-options={channel} title={durationHint}>
      <select aria-label={t(facebook ? "facebook_publication_format" : "instagram_publication_format")} value={placement}
        title={durationHint} disabled={disabled} onChange={event => changePlacement(event.target.value)}>
        <option value="classic">{t("instagram_classic")}</option>
        {preferences.reelsEnabled || placement === "reel" ? <option value="reel" disabled={!preferences.reelsEnabled}>{t("instagram_reels")}</option> : null}
        {preferences.storiesEnabled || placement === "story" ? <option value="story" disabled={!preferences.storiesEnabled}>{t("instagram_stories")}</option> : null}
      </select>
      {placement !== "story" ? <label className={css.story}><input type="checkbox" checked={storyEnabled}
        disabled={disabled || !preferences.storiesEnabled} onChange={event => onStory(event.target.checked)} /><span>{t("instagram_stories")}</span></label> : null}
    </div>;
  }
  if (channel === "pinterest") {
    const { pinterestBoards: boards, pinterestBoardId: boardId, pinterestBoardsLoading: loading } = props;
    return <div className={css.options} data-channel-validation-options={channel}>
      <select aria-label={t("tableau_pinterest_1af82867")} title={props.pinterestBoardsError || t("tableau_pinterest_1af82867")}
        value={boardId} disabled={disabled || loading || !boards.length} onChange={event => props.onPinterestBoardChange(event.target.value)}>
        {!boards.length ? <option value="">{t(loading ? "chargement_01cba1df" : "aucun_tableau_d327ddcf")}</option>
          : !boardId ? <option value="">{t("choisir_un_tableau_77f9de39")}</option> : null}
        {boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}
      </select>
    </div>;
  }
  if (channel === "threads") {
    const ghostDisabled = props.threadsPreferencesLoading || props.threadsPreferencesFailed || !props.threadsPublicationPreferences.ghostEnabled;
    return <div className={css.options} data-channel-validation-options={channel}>
      <select aria-label={t("threads_publication_format")} value={props.threadsPublicationMode} disabled={disabled}
        title={props.threadsPublicationMode === "ghost" ? t("threads_ghost_help") : undefined}
        onChange={event => {
          const value = event.target.value;
          if (value === "classic" || value === "ghost" && !ghostDisabled) props.onThreadsPublicationModeChange(value);
        }}>
        <option value="classic">{t("threads_classic")}</option>
        <option value="ghost" disabled={ghostDisabled}>{t("threads_ghost")}</option>
      </select>
    </div>;
  }
  return null;
}
