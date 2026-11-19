import { useTranslations } from "next-intl";
import type { ChannelKey, ChannelMediaMode } from "../publishModal.shared";
import type { MetaPrimaryPublicationPlacement } from "@/lib/metaPublicationTargets";
import { getMetaImageMotionDuration } from "@/lib/metaImageMotionTiming";
import type { ThreadsPublicationMode, ThreadsPublicationPreferences } from "@/lib/threadsPublicationPreferences";
import type { FacebookPublicationPreferences } from "@/lib/facebookPublicationPreferences";
import type { InstagramPublicationPreferences } from "@/lib/instagramPublicationPreferences";
import css from "./PublishValidationChannelOptions.module.css";

type Props = {
  channel: ChannelKey;
  disabled?: boolean;
  pinterestBoards: Array<{ id: string; name: string }>;
  pinterestBoardId: string;
  pinterestBoardsLoading: boolean;
  pinterestBoardsError: string;
  onPinterestBoardChange: (boardId: string) => void;
  threadsPublicationMode: ThreadsPublicationMode;
  threadsPublicationPreferences: ThreadsPublicationPreferences;
  threadsPreferencesLoading: boolean;
  threadsPreferencesFailed: boolean;
  onThreadsPublicationModeChange: (mode: ThreadsPublicationMode) => void;
  instagramPublicationPlacement: MetaPrimaryPublicationPlacement;
  instagramStoryEnabled: boolean;
  instagramPublicationPreferences: InstagramPublicationPreferences;
  instagramMediaMode: ChannelMediaMode;
  instagramImageCount?: number;
  onInstagramPublicationPlacementChange: (
    placement: MetaPrimaryPublicationPlacement,
  ) => void;
  onInstagramStoryEnabledChange: (enabled: boolean) => void;
  facebookPublicationPlacement: MetaPrimaryPublicationPlacement;
  facebookStoryEnabled: boolean;
  facebookPublicationPreferences: FacebookPublicationPreferences;
  facebookMediaMode: ChannelMediaMode;
  facebookImageCount?: number;
  onFacebookPublicationPlacementChange: (
    placement: MetaPrimaryPublicationPlacement,
  ) => void;
  onFacebookStoryEnabledChange: (enabled: boolean) => void;
};

/** Controlled publication options, displayed in the Validation channel card. */
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
    const changePlacement = (value: "classic" | "reel") => {
      if (disabled || value === "reel" && !preferences.reelsEnabled) return;
      onPlacement(value);
      // A saved Story-only draft keeps its Story when a primary format is added.
      if (placement === "story") onStory(true);
    };
    return <div className={css.options} data-channel-validation-options={channel} title={durationHint}>
      <div className={css.choices} role="radiogroup" aria-label={t(facebook ? "facebook_publication_format" : "instagram_publication_format")}>
        <label className={css.choice} data-selected={placement === "classic"}><input type="radio" name={`booster-${channel}-placement`} value="classic" checked={placement === "classic"} disabled={disabled} onChange={() => changePlacement("classic")} /><span>{t("instagram_classic")}</span></label>
        {preferences.reelsEnabled || placement === "reel" ? <label className={css.choice} data-selected={placement === "reel"}><input type="radio" name={`booster-${channel}-placement`} value="reel" checked={placement === "reel"} disabled={disabled || !preferences.reelsEnabled} onChange={() => changePlacement("reel")} /><span>{t("wizard_reel_option")}</span></label> : null}
      </div>
      <label className={css.story}><input type="checkbox" checked={placement === "story" || storyEnabled}
        disabled={disabled || !preferences.storiesEnabled} onChange={event => {
          if (placement === "story" && !event.target.checked) onPlacement("classic");
          onStory(event.target.checked);
        }} /><span>{t("wizard_story_option")}</span></label>
      {durationHint ? <p className={css.hint}>{durationHint}</p> : null}
    </div>;
  }
  if (channel === "pinterest") {
    const { pinterestBoards: boards, pinterestBoardId: boardId, pinterestBoardsLoading: loading } = props;
    return <div className={css.options} data-channel-validation-options={channel}>
      <label className={css.field}><span>{t("tableau_pinterest_1af82867")}</span>
        <select aria-label={t("tableau_pinterest_1af82867")} title={props.pinterestBoardsError || t("tableau_pinterest_1af82867")}
          value={boardId} disabled={disabled || loading || !boards.length} onChange={event => props.onPinterestBoardChange(event.target.value)}>
          {!boards.length ? <option value="">{t(loading ? "chargement_01cba1df" : "aucun_tableau_d327ddcf")}</option>
            : !boardId ? <option value="">{t("choisir_un_tableau_77f9de39")}</option> : null}
          {boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}
        </select>
      </label>
    </div>;
  }
  if (channel === "threads") {
    const ghostDisabled = props.threadsPreferencesLoading || props.threadsPreferencesFailed || !props.threadsPublicationPreferences.ghostEnabled;
    return <div className={css.options} data-channel-validation-options={channel}>
      <div className={css.choices} role="radiogroup" aria-label={t("threads_publication_format")}>
        <label className={css.choice} data-selected={props.threadsPublicationMode === "classic"}><input type="radio" name="booster-threads-mode" value="classic" checked={props.threadsPublicationMode === "classic"} disabled={disabled} onChange={() => props.onThreadsPublicationModeChange("classic")} /><span>{t("threads_classic")}</span></label>
        <label className={css.choice} data-selected={props.threadsPublicationMode === "ghost"} title={t(props.threadsPreferencesLoading ? "threads_ghost_preferences_loading" : props.threadsPreferencesFailed ? "threads_ghost_preferences_error" : "threads_ghost_help")}><input type="radio" name="booster-threads-mode" value="ghost" checked={props.threadsPublicationMode === "ghost"} disabled={disabled || ghostDisabled} onChange={() => { if (!ghostDisabled) props.onThreadsPublicationModeChange("ghost"); }} /><span>{t("threads_ghost")}</span></label>
      </div>
      {props.threadsPublicationMode === "ghost" ? <p className={css.hint}>{t("threads_ghost_help")}</p> : null}
      {props.threadsPreferencesLoading && props.threadsPublicationMode === "ghost" ? <p className={css.hint} role="status">{t("threads_ghost_preferences_loading")}</p> : null}
    </div>;
  }
  return null;
}
