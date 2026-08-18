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
  publishProgress: number;
  publishProgressLabel: string;
  publishProgressPhaseIndex?: number;
  publishProgressPhaseTotal?: number;
  publishProgressPhaseLabel?: string;
  publishError: string;
  onPublish: () => void;
  onSchedule: () => void;
};

export default function PublishFooterActions({
  styles,
  publishAreaRef,
  saving,
  scheduling,
  draftSaving,
  publishProgress,
  publishProgressLabel,
  publishProgressPhaseIndex,
  publishProgressPhaseTotal,
  publishProgressPhaseLabel,
  publishError,
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
              disabled={draftSaving}
              style={{
                opacity: draftSaving ? 0.64 : 1,
                cursor: draftSaving ? "wait" : "pointer",
              }}
            >
              {i18nT("programmer_ad97007f")}{" "}</button>
            <button
              type="button"
              className={`${styles.primaryBtn} ${styles.publishConfirmButton}`}
              onClick={onPublish}
              disabled={draftSaving}
              style={{
                opacity: draftSaving ? 0.64 : 1,
                cursor: draftSaving ? "wait" : "pointer",
              }}
            >
              {i18nT("verifier_et_publier_8f73de05")}{" "}</button>
          </div>
        )}
      </div>
      {publishError ? <StatusMessage variant="error" style={{marginTop:0,textAlign:'right',maxWidth:520,justifySelf:'end'}}>{publishError}</StatusMessage> : null}
    </div>
  );
}
