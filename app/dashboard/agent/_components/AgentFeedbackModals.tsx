import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import PublishExecutionProgress from "../../_components/PublishExecutionProgress";
import PublishExecutionResultModal from "../../_components/PublishExecutionResultModal";
import dashboardStyles from "../../dashboard.module.css";
import styles from "../agent.module.css";
import type {
  AgentCampaignLaunchNotice,
  AgentConfirmDialogState,
  AgentPublishExecutionProgressState,
} from "../_lib/agent.types";

type PublishSummary = ComponentProps<typeof PublishExecutionResultModal>["summary"];

type AgentFeedbackModalsProps = {
  publishExecutionProgress: AgentPublishExecutionProgressState;
  publishSuccessSummary: PublishSummary | null;
  campaignLaunchNotice: AgentCampaignLaunchNotice;
  confirmDialog: AgentConfirmDialogState;
  onClosePublishSuccess: () => void;
  onOpenPublishedInrSend: () => void;
  onCloseCampaignLaunch: () => void;
  onOpenCampaignFolder: (folder: NonNullable<AgentCampaignLaunchNotice>["folder"]) => void;
  onCloseConfirm: () => void;
  onConfirm: () => void;
};

export default function AgentFeedbackModals({
  publishExecutionProgress,
  publishSuccessSummary,
  campaignLaunchNotice,
  confirmDialog,
  onClosePublishSuccess,
  onOpenPublishedInrSend,
  onCloseCampaignLaunch,
  onOpenCampaignFolder,
  onCloseConfirm,
  onConfirm,
}: AgentFeedbackModalsProps) {
  const i18nT = useTranslations("agent");
  return (
    <>
      {publishExecutionProgress ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 130,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(3, 8, 20, 0.52)",
          }}
          role="dialog"
          aria-modal="true"
          aria-label={i18nT("publication_en_cours_58f34b8e")}
        >
          <div
            className={dashboardStyles.blockCard}
            style={{
              width: "min(520px, 100%)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.40)",
              background:
                "linear-gradient(180deg, rgba(12,18,32,0.98), rgba(10,14,24,0.98))",
            }}
          >
            <PublishExecutionProgress
              styles={dashboardStyles}
              publishProgress={publishExecutionProgress.progress}
              publishProgressLabel={publishExecutionProgress.label}
            />
          </div>
        </div>
      ) : null}

      {publishSuccessSummary ? (
        <PublishExecutionResultModal
          styles={dashboardStyles}
          summary={publishSuccessSummary}
          onClose={onClosePublishSuccess}
          onOpenInrSend={onOpenPublishedInrSend}
        />
      ) : null}

      {campaignLaunchNotice ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={onCloseCampaignLaunch}>
          <section
            className={`${styles.settingsModal} ${styles.validationChoiceModal}`}
            role="dialog"
            aria-modal="true"
            aria-label={i18nT("campagne_lancee_cd26fb1b")}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className={styles.modalClose} onClick={onCloseCampaignLaunch} aria-label={i18nT("fermer_5ab4ec64")}>
              ×
            </button>
            <p className={styles.modalEyebrow}>{i18nT("inr_agent_88080b90")}</p>
            <h2>{campaignLaunchNotice.title}</h2>
            <p className={styles.modalHint}>{campaignLaunchNotice.details}</p>
            <div className={styles.modalActionButtonRow}>
              <button type="button" className={styles.modalActionSecondaryButton} onClick={onCloseCampaignLaunch}>
                {i18nT("fermer_5ab4ec64")}{" "}</button>
              <button
                type="button"
                className={styles.modalActionButton}
                onClick={() => onOpenCampaignFolder(campaignLaunchNotice.folder)}
              >
                {i18nT("voir_dans_inr_send_67983fee")}{" "}</button>
            </div>
          </section>
        </div>
      ) : null}

      {confirmDialog ? (
        <div
          className={`${styles.modalBackdrop} ${styles.confirmModalBackdrop}`}
          role="presentation"
          onClick={onCloseConfirm}
        >
          <section
            className={`${styles.settingsModal} ${styles.validationChoiceModal}`}
            role="dialog"
            aria-modal="true"
            aria-label={confirmDialog.title}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className={styles.modalClose} onClick={onCloseConfirm} aria-label={i18nT("fermer_5ab4ec64")}>
              ×
            </button>
            <p className={styles.modalEyebrow}>{i18nT("confirmation_3424edc2")}</p>
            <h2>{confirmDialog.title}</h2>
            <p className={styles.modalHint}>{confirmDialog.message}</p>
            <div className={styles.modalActionButtonRow}>
              <button type="button" className={styles.modalActionSecondaryButton} onClick={onCloseConfirm}>
                {confirmDialog.cancelLabel || i18nT("annuler_49ba3292")}
              </button>
              <button
                type="button"
                className={styles.modalActionButton}
                data-tone={confirmDialog.tone || "warning"}
                onClick={onConfirm}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
