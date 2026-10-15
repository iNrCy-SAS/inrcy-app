"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";
import type {
  MediaGenerationFormat,
  MediaGenerationKind,
  MediaGenerationResult,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import { resolveAiMediaPreviewFormat } from "@/lib/aiMediaGenerationContracts";
import { AI_MEDIA_VIDEO_MODELS } from "@/lib/aiMediaModelCatalog";
import { MediaGenerationActions } from "./MediaEngineCreditControls";
import styles from "./MediaGenerator.module.css";
import editorStyles from "./MediaGenerationCreationWorkspace.module.css";

type RegenerationConsent = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

type Props = {
  variant?: "full" | "embedded";
  creationStarted?: boolean;
  generationInProgress?: boolean;
  cancellationPending?: boolean;
  kind: MediaGenerationKind;
  format: MediaGenerationFormat;
  durationSeconds: number;
  origin?: string;
  creationMode?: "guided" | "free";
  progress: number;
  operationLocked: boolean;
  finishing: boolean;
  generationResult: MediaGenerationResult | null;
  generationCancellable: boolean;
  cancelConfirmationOpen: boolean;
  setCancelConfirmationOpen: (open: boolean) => void;
  handleRequestGenerationStop: () => void;
  handleConfirmGenerationStop: () => void;
  handleConfirm: () => void | Promise<void>;
  handleSaveToLibrary?: () => void | Promise<void>;
  handleGenerate: () => void | Promise<void>;
  handleEditCriteria: () => void | Promise<void>;
  handleReset?: () => void;
  disabled: boolean;
  acceptMode: "library" | "insert";
  savingToLibrary?: boolean;
  actionError?: string;
  error?: string;
  originChangedNotice?: boolean;
  identityTeam?: boolean;
  referenceCinematicRequested?: boolean;
  editLabel?: string;
  overlay?: ReactNode;
  regenerationConsents?: RegenerationConsent[];
  creditSummary?: ReactNode;
  engineControls?: ReactNode;
};

export function MediaGenerationSettingsTabs({ idPrefix, tabs, activeTab, onChange }: { idPrefix: string; tabs: readonly { id: string; label: string; warning?: boolean | string }[]; activeTab: string; onChange: (id: string) => void }) {
  const t = useTranslations("media");
  return <div className={editorStyles.tabs} role="tablist" aria-label={t("ai_generator_editor_settings_label")}>
    {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${idPrefix}-tab-${tab.id}`} aria-controls={`${idPrefix}-panel-${tab.id}`} aria-label={tab.label} aria-describedby={tab.warning ? `${idPrefix}-warning-${tab.id}` : undefined} title={tab.warning ? (typeof tab.warning === "string" ? tab.warning : t("ai_generator_editor_criteria_incomplete")) : undefined} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => onChange(tab.id)} onKeyDown={(event) => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : null;
      if (next === null) return;
      event.preventDefault(); onChange(tabs[next].id);
      document.getElementById(`${idPrefix}-tab-${tabs[next].id}`)?.focus();
    }}><span>{tab.label}</span>{tab.warning && <>
      <span className={editorStyles.tabWarning} aria-hidden="true">⚠︎</span>
      <span id={`${idPrefix}-warning-${tab.id}`} className={editorStyles.warningDescription}>{(typeof tab.warning === "string" ? tab.warning : t("ai_generator_editor_criteria_incomplete"))}</span>
    </>}</button>)}
  </div>;
}

const FORMATS: Array<{ id: MediaGenerationFormat; ratio: string }> = [
  { id: "square", ratio: "1:1" },
  { id: "portrait", ratio: "4:5" },
  { id: "story", ratio: "9:16" },
  { id: "landscape", ratio: "16:9" },
];

function RegenerationAuthorization({
  consents,
  disabled,
}: {
  consents?: RegenerationConsent[];
  disabled: boolean;
}) {
  const t = useTranslations("media");
  if (!consents?.length) return null;
  return (
    <fieldset className={styles.regenerationConsent} disabled={disabled}>
      <legend>{t("ai_generator_footer_consent_title")}</legend>
      <small>{t("ai_generator_footer_consent_blocking")}</small>
      {consents.map((consent) => (
        <label className={styles.regenerationConsentOption} key={consent.id}>
          <input
            type="checkbox"
            checked={consent.checked}
            onChange={(event) => consent.onChange(event.target.checked)}
          />
          <span>{consent.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Presentation only: both creation paths retain their own requests and lifecycle. */
export default function MediaGenerationCreationWorkspace({
  variant = "full",
  creationStarted = true,
  generationInProgress,
  cancellationPending = false,
  kind,
  format,
  durationSeconds,
  origin,
  creationMode = "guided",
  progress,
  operationLocked,
  finishing,
  generationResult,
  generationCancellable,
  cancelConfirmationOpen,
  setCancelConfirmationOpen,
  handleRequestGenerationStop,
  handleConfirmGenerationStop,
  handleConfirm,
  handleSaveToLibrary,
  handleGenerate,
  creditSummary,
  engineControls,
  handleEditCriteria,
  handleReset,
  disabled,
  acceptMode,
  savingToLibrary = false,
  actionError,
  error,
  originChangedNotice,
  identityTeam = false,
  referenceCinematicRequested = false,
  editLabel,
  overlay,
  regenerationConsents,
}: Props) {
  const t = useTranslations("media");
  const instanceId = useId();
  const embedded = variant === "embedded";
  const rendering = generationInProgress ?? operationLocked;
  const creationError = actionError || error;
  const showCreationError = !rendering && !generationResult &&
    (embedded ? Boolean(creationError) : creationStarted);
  const previewKind = generationResult?.item.media_type ?? kind;
  const resultPreviewFormat = generationResult
    ? resolveAiMediaPreviewFormat({
        width: generationResult.item.width,
        height: generationResult.item.height,
        fallback: generationResult.format,
      })
    : format;
  const resultSavedToLibrary = Boolean(generationResult && !generationResult.draft);
  const progressLabel =
    progress >= 99
      ? t("ai_generator_stage_patience")
      : progress < 18
      ? t(
          creationMode === "free"
            ? "ai_generator_stage_brief"
            : "ai_generator_stage_profile"
        )
      : progress < 42
      ? t(
          creationMode === "free"
            ? "ai_generator_stage_brief"
            : "ai_generator_stage_brand"
        )
      : progress < 72
      ? t(
          kind === "video"
            ? identityTeam
              ? "ai_generator_stage_team_composition"
              : "ai_generator_stage_storyboard"
            : "ai_generator_stage_image"
        )
      : t(
          kind === "video"
            ? referenceCinematicRequested
              ? "ai_generator_stage_team_animation"
              : "ai_generator_stage_render"
            : "ai_generator_stage_finish"
        );

  return (
    <div
      className={embedded ? `${styles.creationWorkspace} ${editorStyles.embedded}` : styles.creationWorkspace}
      data-origin={origin}
      data-media-kind={previewKind}
      data-creation-mode={creationMode}
      data-media-creation-stage={
        generationResult ? "result" : rendering ? "progress" : showCreationError ? "error" : "idle"
      }
    >
      <div className={styles.creationBackdrop} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      {overlay}

      {!generationResult && !rendering && !showCreationError ? <div className={editorStyles.idle}>
        <span className={editorStyles.idleIcon} aria-hidden="true">✦</span>
        <p className={styles.creationEyebrow}>iNr’Studio</p>
        <h3>{t("ai_generator_editor_preview_title")}</h3>
        <p>{t("ai_generator_editor_preview_hint")}</p>
      </div> : null}

      {rendering && !generationResult ? (
        <div
          className={styles.creationProgress}
          role="status"
          aria-live="polite"
        >
          <div className={styles.orbit} aria-hidden="true">
            <span>✦</span>
          </div>
          <p className={styles.creationEyebrow}>
            {t("ai_generator_creation_eyebrow")}
          </p>
          <h3>{cancellationPending ? t("ai_generator_editor_stop_pending") : progressLabel}</h3>
          <p>
            {t(
              creationMode === "free"
                ? "ai_generator_free_progress_hint"
                : kind === "video"
                ? identityTeam
                  ? "ai_generator_video_creation_detail_team_cinematic"
                  : "ai_generator_video_creation_detail"
                : "ai_generator_image_creation_detail",
              { duration: durationSeconds }
            )}
          </p>
          <div className={styles.largeProgressTrack} aria-hidden="true">
            <span style={{ width: `${Math.max(4, progress)}%` }} />
          </div>
          <strong>{progress} %</strong>
          <small>{t("ai_generator_keep_open")}</small>
          <div className={styles.stopGenerationSlot}>
            {generationCancellable && !embedded ? (
              <button
                type="button"
                className={styles.stopGenerationButton}
                onClick={handleRequestGenerationStop}
              >
                {t("ai_generator_stop_generation")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {cancelConfirmationOpen && generationCancellable ? (
        <div className={styles.cancelGenerationBackdrop}>
          <div
            className={styles.cancelGenerationDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${instanceId}-cancel-title`}
            aria-describedby={`${instanceId}-cancel-description`}
          >
            <span aria-hidden="true">!</span>
            <h3 id={`${instanceId}-cancel-title`}>
              {t("ai_generator_stop_confirm_title")}
            </h3>
            <p id={`${instanceId}-cancel-description`}>
              {t("ai_generator_stop_confirm_description")}
            </p>
            <p className={styles.cancelGenerationWarning}>
              {t("ai_generator_stop_confirm_cost_warning")}
            </p>
            <div>
              <button
                type="button"
                className={styles.keepGeneratingButton}
                onClick={() => setCancelConfirmationOpen(false)}
              >
                {t("ai_generator_stop_confirm_continue")}
              </button>
              <button
                type="button"
                className={styles.confirmStopButton}
                onClick={handleConfirmGenerationStop}
              >
                {t("ai_generator_stop_confirm_action")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {generationResult ? (
        <div className={styles.reviewWorkspace} data-media-review>
          <div className={styles.reviewHeading} data-media-review-heading>
            <div>
              <p>{t("ai_generator_ready")}</p>
              <h3>
                {t(
                  previewKind === "video"
                    ? "ai_generator_video_ready_title"
                    : "ai_generator_image_ready_title"
                )}
              </h3>
            </div>
            <div className={styles.reviewBadges}>
              <span>
                {
                  FORMATS.find((item) => item.id === resultPreviewFormat)
                    ?.ratio
                }
              </span>
              {previewKind === "video" && generationResult.videoEngineResult ? (
                <span
                  className={styles.engineResultBadge}
                  data-fallback={generationResult.videoEngineResult.includes(
                    "fallback"
                  )}
                >
                  {AI_MEDIA_VIDEO_MODELS.some((model) => model.id === generationResult.videoEngineResult)
                    ? t("ai_generator_generated_model", { model: AI_MEDIA_VIDEO_MODELS.find((model) => model.id === generationResult.videoEngineResult)?.label || generationResult.videoEngineResult })
                    : t(`ai_generator_video_engine_result_${generationResult.videoEngineResult}`)}
                </span>
              ) : null}
            </div>
          </div>
          <div className={styles.previewViewport} data-media-preview>
            <div
              className={styles.previewFrame}
              data-format={resultPreviewFormat}
              style={{ position: "relative" }}
            >
              {generationResult.item.signed_url ? (
                generationResult.item.media_type === "video" ? (
                  <video
                    src={generationResult.item.signed_url}
                    controls
                    playsInline
                    preload="metadata"
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      minWidth: 0,
                      minHeight: 0,
                      objectFit: "contain",
                      objectPosition: "center",
                      background: "#000",
                    }}
                  />
                ) : (
                  <Image
                    src={generationResult.item.signed_url}
                    fill
                    unoptimized
                    sizes="(max-width: 760px) 100vw, 70vw"
                    style={{ objectFit: "contain", objectPosition: "center" }}
                    alt={
                      generationResult.item.title ||
                      t("ai_generator_preview_alt")
                    }
                  />
                )
              ) : (
                <span>{t("apercu_indisponible_d0ce704a")}</span>
              )}
            </div>
          </div>
          <div className={styles.savedStatus} role="status" data-media-saved-status>
            <span aria-hidden="true">✓</span>
            {resultSavedToLibrary
              ? t("ai_generator_saved_to_library")
              : t("ai_generator_saved_automatically")}
          </div>
          <div className={styles.resultActions} data-media-result-actions>
            {!embedded ? <RegenerationAuthorization
              consents={regenerationConsents}
              disabled={operationLocked}
            /> : null}
            <button
              type="button"
              className={styles.confirmButton}
              onClick={() => void handleConfirm()}
              disabled={operationLocked}
            >
              {finishing
                ? t(
                    acceptMode === "insert"
                      ? "ai_generator_inserting"
                      : "ai_generator_finishing_library"
                  )
                : t(
                    acceptMode === "insert"
                      ? "ai_generator_confirm_insert"
                      : "ai_generator_open_library"
                  )}
            </button>
            {acceptMode === "insert" && handleSaveToLibrary ? (
              <button
                type="button"
                className={styles.saveToLibraryButton}
                onClick={() => void handleSaveToLibrary()}
                disabled={operationLocked || resultSavedToLibrary}
              >
                {savingToLibrary
                  ? t("ai_generator_finishing_library")
                  : resultSavedToLibrary
                  ? `✓ ${t("ai_generator_saved_to_library")}`
                  : t("ai_generator_open_library")}
              </button>
            ) : null}
            {!embedded ? <MediaGenerationActions>
            {engineControls}
            {creditSummary}
            <button
              type="button"
              className={styles.regenerateButton}
              onClick={() => void handleGenerate()}
              disabled={disabled}
            >
              ↻ {t("ai_generator_regenerate")}
            </button>
            </MediaGenerationActions> : null}
            <button
              type="button"
              className={styles.editButton}
              onClick={() => void handleEditCriteria()}
              disabled={operationLocked}
            >
              {editLabel || t("ai_generator_edit_criteria")}
            </button>
            {handleReset ? <button type="button" className={styles.editButton}
              onClick={handleReset} disabled={operationLocked} data-media-reset>
              ↺ {t("ai_generator_workspace_reset_action")}
            </button> : null}
          </div>
        </div>
      ) : null}

      {showCreationError ? (
        <div className={styles.creationErrorPanel} role="alert">
          <span aria-hidden="true">!</span>
          <h3>{t("ai_generator_creation_failed_title")}</h3>
          <p>{creationError || t("ai_generator_error")}</p>
          {!embedded ? <RegenerationAuthorization
            consents={regenerationConsents}
            disabled={operationLocked}
          /> : null}
          <div>
            {!embedded ? <MediaGenerationActions>
            {engineControls}
            {creditSummary}
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={disabled}
            >
              {t("ai_generator_retry")}
            </button>
            </MediaGenerationActions> : null}
            <button type="button" onClick={() => void handleEditCriteria()}>
              {editLabel || t("ai_generator_edit_criteria")}
            </button>
            {handleReset ? <button type="button" className={styles.editButton}
              onClick={handleReset} disabled={operationLocked} data-media-reset>
              ↺ {t("ai_generator_workspace_reset_action")}
            </button> : null}
          </div>
        </div>
      ) : null}

      {creationError && generationResult ? (
        <div className={styles.error} role="alert">
          {creationError}
        </div>
      ) : null}
      {originChangedNotice ? (
        <div className={styles.warning} role="status">
          {t("ai_generator_origin_changed")}
        </div>
      ) : null}
    </div>
  );
}
