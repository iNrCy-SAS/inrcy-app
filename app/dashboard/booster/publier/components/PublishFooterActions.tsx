import { useTranslations } from "next-intl";
import type { MutableRefObject } from "react";
import StatusMessage from "../../../_components/StatusMessage";
import PublishExecutionProgress from "../../../_components/PublishExecutionProgress";

type PublishModalStyles = Readonly<Record<string, string>>;

type PublishFooterActionsProps = {
  styles: PublishModalStyles;
  publishAreaRef: MutableRefObject<HTMLDivElement | null>;
  saving: boolean;
  scheduling: boolean;
  draftSaving: boolean;
  voiceBusy?: boolean;
  publishProgress: number;
  publishProgressLabel: string;
  publishProgressPhaseIndex?: number;
  publishProgressPhaseTotal?: number;
  publishProgressPhaseLabel?: string;
  publishError: string;
  mediaPreparationIssue?: string;
  mediaPreparationFailed?: boolean;
  onPublish: () => void;
  onSchedule: () => void;
};

export default function PublishFooterActions({
  styles,
  publishAreaRef,
  saving,
  scheduling,
  draftSaving,
  voiceBusy = false,
  publishProgress,
  publishProgressLabel,
  publishProgressPhaseIndex,
  publishProgressPhaseTotal,
  publishProgressPhaseLabel,
  publishError,
  mediaPreparationIssue = "",
  mediaPreparationFailed = false,
  onPublish,
  onSchedule,
}: PublishFooterActionsProps) {
  const i18nT = useTranslations("booster");
  const busy = saving || scheduling;
  return (
    <div ref={publishAreaRef} className={styles.publishFooterRoot}>
      <div className={styles.publishFooterRow}>
        {busy ? (
          <PublishExecutionProgress
            styles={styles}
            scheduling={scheduling}
            publishProgress={publishProgress}
            publishProgressLabel={publishProgressLabel}
            phaseIndex={scheduling ? undefined : publishProgressPhaseIndex}
            phaseTotal={scheduling ? undefined : publishProgressPhaseTotal}
            phaseLabel={scheduling ? undefined : publishProgressPhaseLabel}
          />
        ) : (
          <div className={styles.publishFooterActionsGroup}>
            <button
              type="button"
              className={`${styles.secondaryBtn} ${styles.publishScheduleButton}`}
              onClick={onSchedule}
              disabled={draftSaving || voiceBusy || Boolean(mediaPreparationIssue)}
              style={{
                opacity: draftSaving || voiceBusy || mediaPreparationIssue ? 0.64 : 1,
                cursor: draftSaving || voiceBusy || mediaPreparationIssue ? "wait" : "pointer",
              }}
            >
              <span>{i18nT("programmer_ad97007f")}</span>
            </button>
            <button
              type="button"
              className={`${styles.primaryBtn} ${styles.publishConfirmButton}`}
              onClick={onPublish}
              disabled={draftSaving || voiceBusy || Boolean(mediaPreparationIssue)}
              style={{
                opacity: draftSaving || voiceBusy || mediaPreparationIssue ? 0.64 : 1,
                cursor: draftSaving || voiceBusy || mediaPreparationIssue ? "wait" : "pointer",
              }}
            >
              <span className={styles.publishActionIcon} aria-hidden="true">
                🚀
              </span>
              <span>{i18nT("verifier_et_publier_8f73de05")}</span>
            </button>
          </div>
        )}
      </div>
      {mediaPreparationIssue ? (
        <div role={mediaPreparationFailed ? "alert" : "status"} style={{ marginTop: 8, textAlign: "right", color: mediaPreparationFailed ? "#fecaca" : "#fde68a", fontSize: 12 }}>
          {mediaPreparationIssue}
        </div>
      ) : null}
      {publishError ? <StatusMessage variant="error" style={{marginTop:0,textAlign:'right',maxWidth:520,justifySelf:'end'}}>{publishError}</StatusMessage> : null}
    </div>
  );
}
