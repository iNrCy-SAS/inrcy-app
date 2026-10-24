import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import {
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  AI_ENGINE_OPTIONS,
  getAiEngineOption,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";
import { BOOSTER_DOCUMENT_ACCEPT } from "@/lib/boosterDocumentAttachmentPolicy";
import AiEngineInfoModal from "../../../_components/AiEngineInfoModal";
import PublishReferencePicker from "./PublishReferencePicker";
import MediaSubjectVoiceButton from "../../../_components/MediaSubjectVoiceButton";
import {
  BOOSTER_MAX_IMAGE_COUNT,
  BOOSTER_IMAGE_ACCEPT,
  BOOSTER_VIDEO_ACCEPT,
  getLocalizedBoosterImageFormats,
  getLocalizedBoosterImageLimits,
  getLocalizedBoosterRecommendedVideoDuration,
  getLocalizedBoosterSelectedMediaSummary,
  getLocalizedBoosterVideoFormats,
  getLocalizedBoosterVideoLimits,
  type ThemeKey,
} from "../publishModal.shared";
import { getGenerationMediaSelectionPolicy } from "../generationMediaSelection";
import css from "./PublishIntentPanel.module.css";

type PublishModalStyles = Readonly<Record<string, string>>;

function formatVideoSeconds(seconds: number | null) {
  if (!Number.isFinite(Number(seconds))) return "";
  const safeSeconds = Math.max(0, Math.round(Number(seconds)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

type VoiceTarget = "idea" | "instruction";

const THEME_PLACEHOLDER_KEYS: Record<ThemeKey, string> = {
  "": "theme_placeholder_default",
  promotion: "theme_placeholder_promotion",
  information: "theme_placeholder_information",
  conseil: "theme_placeholder_advice",
  avis_client: "theme_placeholder_review",
  realisation: "theme_placeholder_project",
  actualite: "theme_placeholder_news",
  autre: "theme_placeholder_other",
};

type PublishIntentPanelProps = {
  actionsContainer?: HTMLElement | null;
  styles: PublishModalStyles;
  isMobile: boolean;
  stepNumber: number;
  theme: ThemeKey;
  idea: string;
  setIdea: Dispatch<SetStateAction<string>>;
  publicationInstruction: string;
  setPublicationInstruction: Dispatch<SetStateAction<string>>;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  videoInputRef: MutableRefObject<HTMLInputElement | null>;
  pdfInputRef: MutableRefObject<HTMLInputElement | null>;
  onImagesChange: (files: FileList | null) => void;
  onVideoChange: (files: FileList | null) => void;
  onPdfChange: (files: FileList | null) => void;
  onPickImagesClick: () => void;
  onPickVideoClick: () => void;
  onGenerateMedia: () => void;
  onTakePhotoClick: () => void;
  onOpenMediaLibrary: () => void;
  images: File[];
  imagePreviews: string[];
  videoFile: File | null;
  videoPreviewUrl: string;
  videoDurationSeconds: number | null;
  pdfFile: File | null;
  documentFiles: File[];
  pdfAttachmentError: string;
  onRemovePdf: (index?: number) => void;
  onRetouchVideo: () => void;
  removeVideo: () => void;
  removeImage: (index: number) => void;
  imgError: string;
  showMediaOptimizerAction?: boolean;
  onOpenMediaOptimizer?: () => void;
  genError: string;
  generationNotice: string;
  generationMediaWarning: string;
  generating: boolean;
  generationPhaseIndex: number;
  generationPhaseTotal: number;
  generationPhaseLabel: string;
  generationStage: string;
  generationProgress: number;
  generationProgressRef?: RefObject<HTMLDivElement | null>;
  aiPreferredEngine: AiPreferredEngine;
  defaultAiPreferredEngine: AiPreferredEngine;
  onAiPreferredEngineChange: (engine: AiPreferredEngine) => void;
  onGenerate: () => void;
  onOpenAiConfiguration: () => void;
  onVoiceBusyChange?: (busy: boolean) => void;
};

export default function PublishIntentPanel({
  actionsContainer,
  styles,
  isMobile,
  stepNumber,
  theme,
  idea,
  setIdea,
  publicationInstruction,
  setPublicationInstruction,
  fileInputRef,
  videoInputRef,
  pdfInputRef,
  onImagesChange,
  onVideoChange,
  onPdfChange,
  onPickImagesClick,
  onPickVideoClick,
  onGenerateMedia,
  onTakePhotoClick,
  onOpenMediaLibrary,
  images,
  imagePreviews,
  videoFile,
  videoPreviewUrl,
  videoDurationSeconds,
  pdfFile,
  documentFiles,
  pdfAttachmentError,
  onRemovePdf,
  onRetouchVideo,
  removeVideo,
  removeImage,
  imgError,
  showMediaOptimizerAction = false,
  onOpenMediaOptimizer,
  genError,
  generationNotice,
  generationMediaWarning,
  generating,
  generationPhaseIndex,
  generationPhaseTotal,
  generationPhaseLabel,
  generationStage,
  generationProgress,
  generationProgressRef,
  aiPreferredEngine,
  defaultAiPreferredEngine,
  onAiPreferredEngineChange,
  onGenerate,
  onOpenAiConfiguration,
  onVoiceBusyChange,
}: PublishIntentPanelProps) {
  const i18nT = useTranslations("booster");
  const mediaT = useTranslations("media");
  const runtimeT = i18nT as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const [voiceTarget, setVoiceTarget] = useState<VoiceTarget | null>(null);
  const [engineInfoOpen, setEngineInfoOpen] = useState(false);
  const selectedAiEngineOption = getAiEngineOption(aiPreferredEngine);
  const visibleErrors = Array.from(
    new Set(
      [pdfAttachmentError.trim(), imgError.trim(), genError.trim()].filter(
        Boolean,
      ),
    ),
  );

  useEffect(() => {
    onVoiceBusyChange?.(voiceTarget !== null);
  }, [onVoiceBusyChange, voiceTarget]);

  useEffect(
    () => () => {
      onVoiceBusyChange?.(false);
    },
    [onVoiceBusyChange],
  );

  const handleVoiceBusyChange = (target: VoiceTarget, busy: boolean) => {
    setVoiceTarget((current) =>
      busy ? target : current === target ? null : current,
    );
  };

  const generationDisabled = generating || voiceTarget !== null;
  const isVoiceTargetDisabled = (target: VoiceTarget) =>
    generating || (voiceTarget !== null && voiceTarget !== target);

  const renderIntentField = (args: {
    target: VoiceTarget; label: string; helper: string; placeholder: string;
    value: string; onChange: (value: string) => void; maxLength?: number;
  }) => (
    <div className={css.field} data-brief-field={args.target}>
      <div className={css.fieldHeading}>
        <label htmlFor={`booster-brief-${args.target}`}>
          <svg className={css.fieldGlyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {args.target === "idea" ? <><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 .8-1 1.5-1 2H9c0-.5 0-1.2-1-2Z" /></> : <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="#161e36"/><circle cx="15" cy="12" r="2" fill="#161e36"/><circle cx="10" cy="18" r="2" fill="#161e36"/></>}
          </svg>
          {i18nT(args.target === "idea" ? "wizard_brief_idea" : "wizard_brief_instruction")}
        </label>
        <span>{args.helper}</span>
      </div>
      <div className={css.textareaWrap}>
        <textarea
          id={`booster-brief-${args.target}`}
          aria-label={args.label}
          placeholder={args.placeholder}
          className={css.textarea}
          value={args.value}
          maxLength={args.maxLength}
          readOnly={voiceTarget !== null}
          onChange={(event) => args.onChange(event.target.value)}
        />
        <MediaSubjectVoiceButton
          purpose={args.target === "idea" ? "subject" : "instruction"}
          disabled={isVoiceTargetDisabled(args.target)}
          value={args.value} maxLength={args.maxLength} mergeMode="paragraph"
          onBusyChange={(busy) => handleVoiceBusyChange(args.target, busy)}
          onChange={args.onChange}
        />
      </div>
    </div>
  );
  const hasImages = images.length > 0;
  const hasVideoMedia = Boolean(videoFile || videoPreviewUrl);
  const imagesLimitReached = images.length >= BOOSTER_MAX_IMAGE_COUNT;
  const generationMediaPolicy = getGenerationMediaSelectionPolicy({
    imageCount: images.length,
    hasVideo: hasVideoMedia,
    maxImageCount: BOOSTER_MAX_IMAGE_COUNT,
  });
  const pickImagesDisabled = generationMediaPolicy.imagePickerDisabled;
  const pickVideoDisabled = generationMediaPolicy.videoPickerDisabled;
  const cameraDisabled =
    !isMobile || generationMediaPolicy.cameraCaptureDisabled;

  const generationActions = (
<div
            data-testid="booster-ai-generation-actions"
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-end",
              gap: isMobile ? 8 : 10,
              flexWrap: "wrap",
              width: "100%",
              minWidth: 0,
            }}
          >
            <div className={css.engineControl}
              style={{
                display: "grid",
                gap: 5,
                flex: isMobile ? "1 1 100%" : "1 1 420px",
                width: isMobile ? "100%" : 420,
                maxWidth: "100%",
                minWidth: isMobile ? 0 : 220,
                color: "rgba(255,255,255,0.84)",
                fontSize: 12,
                fontWeight: 850,
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  minWidth: 0,
                }}
              >
                <span style={{ whiteSpace: "nowrap" }}>{i18nT("moteur_ia_a7f9dad3")}</span>
                <button
                  type="button"
                  onClick={() => setEngineInfoOpen(true)}
                  aria-label={i18nT("informations_sur_les_moteurs_ia_499c34b6")}
                  title={i18nT("informations_sur_les_moteurs_ia_499c34b6")}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    border: "1px solid rgba(125,211,252,0.44)",
                    background: "rgba(125,211,252,0.12)",
                    color: "#bae6fd",
                    display: "inline-grid",
                    placeItems: "center",
                    padding: 0,
                    cursor: "pointer",
                    fontSize: 10,
                    fontWeight: 950,
                    lineHeight: 1,
                  }}
                >
                  i
                </button>
              </div>
              <select
                value={aiPreferredEngine}
                onChange={(event) =>
                  onAiPreferredEngineChange(
                    event.target.value as AiPreferredEngine,
                  )
                }
                disabled={generationDisabled}
                style={{
                  width: "100%",
                  maxWidth: "100%",
                  minHeight: 34,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.055)",
                  color: "white",
                  padding: "6px 9px",
                  fontSize: isMobile ? 12.5 : 12.25,
                  fontWeight: 760,
                  outline: "none",
                  opacity: generationDisabled ? 0.68 : 1,
                  cursor: generationDisabled ? "wait" : "pointer",
                }}
              >
                {AI_ENGINE_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    style={{ color: "#0b1020", background: "#ffffff" }}
                  >
                    {option.label}
                    {option.value === defaultAiPreferredEngine
                      ? i18nT("defaut_9e21a00d")
                      : ""}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className={`${styles.primaryBtn} ${styles.aiGenerateBtn}`}
              onClick={onGenerate}
              disabled={generationDisabled || !idea.trim()}
              style={{
                flex: isMobile ? "1 1 100%" : "0 0 auto",
                width: isMobile ? "100%" : "auto",
                minHeight: 34,
                whiteSpace: "nowrap",
              }}
            >
              {generating
                ? i18nT("generation_avec_value_0ba06089", { value0: selectedAiEngineOption.shortLabel })
                : voiceTarget !== null
                  ? i18nT("vocal_en_cours_6e444e8f")
                  : i18nT("generer_avec_inrcy_58900495")}
            </button>
          </div>
  );

  const referenceSummary = getLocalizedBoosterSelectedMediaSummary({
    imageCount: images.length, hasVideo: hasVideoMedia, context: "generation",
  }, runtimeT);

  return (
    <div className={css.intent} data-publish-intent>
      <div className={css.panels}>
        <div className={css.writing}>
          {renderIntentField({
            target: "idea",
            label: i18nT("sujet_de_la_publication_obligatoire_pour_62d82326"),
            helper: i18nT("le_theme_et_les_faits_a_3ed5ecc7"),
            placeholder: runtimeT(THEME_PLACEHOLDER_KEYS[theme] || THEME_PLACEHOLDER_KEYS[""]),
            value: idea, onChange: setIdea,
          })}
          {renderIntentField({
            target: "instruction",
            label: i18nT("consigne_ponctuelle_a_l_ia_facultatif_cf850551"),
            helper: i18nT("prioritaire_sur_votre_configuration_ia_pour_5278e325"),
            placeholder: i18nT("ex_insistez_sur_la_personnalisation_redigez_19b7a61d"),
            value: publicationInstruction, onChange: setPublicationInstruction, maxLength: 4_000,
          })}
        </div>
        <aside className={css.references} aria-label={i18nT("wizard_inspirations_help")}>
          <div className={css.referenceHeading}>
            <h2>{i18nT("wizard_inspirations_help")}</h2>
            <PublishReferencePicker disabled={generationDisabled}
              documentDetail={i18nT("wizard_reference_document_limits")} documentCount={documentFiles.length}
              onPickDocument={() => pdfInputRef.current?.click()} onGenerateMedia={onGenerateMedia} onOpenMediaLibrary={onOpenMediaLibrary}
              image={{ onSelect: onPickImagesClick, disabled: pickImagesDisabled,
                disabledReason: imagesLimitReached ? i18nT("generation_images_limit", { count: BOOSTER_MAX_IMAGE_COUNT }) : undefined,
                detail: `${getLocalizedBoosterImageLimits(runtimeT)} · ${getLocalizedBoosterImageFormats(runtimeT)}` }}
              video={{ onSelect: onPickVideoClick, disabled: pickVideoDisabled,
                disabledReason: pickVideoDisabled ? i18nT("generation_video_limit") : undefined,
                detail: `${getLocalizedBoosterVideoLimits(runtimeT)} · ${getLocalizedBoosterVideoFormats(runtimeT)} · ${getLocalizedBoosterRecommendedVideoDuration(runtimeT)}` }}
              camera={isMobile ? { onSelect: onTakePhotoClick, disabled: cameraDisabled, disabledReason: i18nT("generation_images_limit", { count: BOOSTER_MAX_IMAGE_COUNT }) } : undefined}
            />
          </div>
          <div className={css.referenceThumbnails} data-wizard-reference-media>
            {documentFiles.map((pdfFile, index) => <div key={`${pdfFile.name}-${pdfFile.size}-${index}`} className={css.pdfThumbnail} data-testid="booster-selected-pdf" title={`${pdfFile.name} · ${formatAttachmentSize(pdfFile.size)}`}>
              <span aria-hidden="true">{pdfFile.name.split(".").pop()?.toUpperCase()}</span><strong>{pdfFile.name}</strong>
              <button type="button" className={css.remove} disabled={generationDisabled} onClick={() => onRemovePdf(index)} aria-label={`${i18nT("remove_pdf_attachment")} ${pdfFile.name}`}>×</button>
            </div>)}
            {imagePreviews.map((url,index) => <div className={css.thumbnail} key={url} title={images[index]?.name || i18nT("image_value_5907a7ef", { value0: index + 1 })}>
              <img src={url} alt={i18nT("image_value_5907a7ef", { value0: index + 1 })} />
              <button type="button" className={css.remove} aria-label={i18nT("supprimer_l_image_value_pour_tous_561091e2", { value0: index + 1 })} onClick={() => removeImage(index)}>×</button>
            </div>)}
            {hasVideoMedia && videoPreviewUrl ? <div className={css.videoThumbnail} title={videoFile?.name}>
              <video src={videoPreviewUrl} playsInline preload="metadata" muted />
              <span>{videoDurationSeconds !== null ? formatVideoSeconds(videoDurationSeconds) : "▶"}</span>
              <button type="button" className={css.remove} onClick={removeVideo} aria-label={i18nT("supprimer_la_video_pour_tous_les_42f4e867")}>×</button>
              <button type="button" className={css.retouchVideo} onClick={onRetouchVideo}>{mediaT("ai_generator_studio_tab_retouch")}</button>
            </div> : null}
            {!pdfFile && !hasImages && !hasVideoMedia ? <span className={css.emptyReference}>{referenceSummary}</span> : null}
          </div>
        </aside>
      </div>
      <input ref={pdfInputRef} type="file" accept={BOOSTER_DOCUMENT_ACCEPT} multiple hidden onChange={(event) => { onPdfChange(event.target.files); event.currentTarget.value = ""; }} />
      <input ref={fileInputRef} type="file" accept={BOOSTER_IMAGE_ACCEPT} multiple hidden onChange={(e) => { onImagesChange(e.target.files); e.currentTarget.value = ""; }} />
      <input ref={videoInputRef} type="file" accept={BOOSTER_VIDEO_ACCEPT} hidden onChange={(e) => { onVideoChange(e.target.files); e.currentTarget.value = ""; }} />
      {visibleErrors.length || generationNotice || generationMediaWarning || generating || showMediaOptimizerAction ? <div className={css.messages}>
        {visibleErrors.map(message => <div key={message} role="alert" className={css.error}>{message}</div>)}
        {showMediaOptimizerAction && onOpenMediaOptimizer ? <button type="button" className={css.referenceAction} onClick={() => onOpenMediaOptimizer()}>{i18nT("optimiser_le_media_1bc4fc40")}</button> : null}
        {generationNotice ? <div role="status">{generationNotice}</div> : null}
        {generationMediaWarning ? <div role="status" className={css.warning}>⚠️ {generationMediaWarning}</div> : null}
        {generating ? <div ref={generationProgressRef} className={css.generationProgress} role="status">
          <div><strong>{i18nT("etape_13146b48")} {Math.max(1, generationPhaseIndex)}/{generationPhaseTotal}{generationPhaseLabel ? ` · ${generationPhaseLabel}` : ""}</strong><span>{generationProgress}%</span></div>
          <span>{generationStage || i18nT("generation_en_cours_01513ecf")}</span>
          <div aria-hidden="true" className={css.progressTrack}><span style={{ width: `${generationProgress}%` }} /></div>
        </div> : null}
      </div> : null}
      {actionsContainer ? createPortal(generationActions, actionsContainer) : generationActions}
      <AiEngineInfoModal open={engineInfoOpen} activeEngine={aiPreferredEngine} onClose={() => setEngineInfoOpen(false)} />
    </div>
  );
}
