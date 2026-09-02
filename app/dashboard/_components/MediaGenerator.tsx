"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import useMediaGeneration, {
  MediaGenerationAccountChangedError,
  MediaGenerationCancelledError,
  type MediaGenerationFormat,
  type MediaGenerationCreativity,
  type MediaGenerationImageStyle,
  type MediaGenerationInspirationImage,
  type MediaGenerationKind,
  type MediaGenerationLogoMode,
  type MediaGenerationPeopleMode,
  type MediaGenerationResult,
  type MediaGenerationShotType,
  type MediaGenerationSource,
  type MediaGenerationSubjectSource,
  type MediaGenerationTypology,
  type MediaGenerationVideoDuration,
  type MediaGenerationVisualStyle,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import MediaSubjectVoiceButton from "./MediaSubjectVoiceButton";

import styles from "./MediaGenerator.module.css";

export type MediaGeneratorOrigin = "menu" | "booster" | "inrsend";
export type MediaGeneratorAcceptMode = "library" | "insert";

type MediaGeneratorProps = {
  source: MediaGenerationSource;
  origin: MediaGeneratorOrigin;
  publicationBrief?: string;
  acceptMode: MediaGeneratorAcceptMode;
  onAccepted: (result: MediaGenerationResult) => void | Promise<void>;
  onResultChange?: (result: MediaGenerationResult | null) => void;
  onBusyChange?: (busy: boolean) => void;
};

const FORMATS: Array<{ id: MediaGenerationFormat; icon: string; ratio: string }> = [
  { id: "square", icon: "□", ratio: "1:1" },
  { id: "portrait", icon: "▯", ratio: "4:5" },
  { id: "story", icon: "▯", ratio: "9:16" },
  { id: "landscape", icon: "▭", ratio: "16:9" },
];

const TYPOLOGIES: Array<{ id: MediaGenerationTypology; icon: string }> = [
  { id: "company", icon: "◈" },
  { id: "service", icon: "✦" },
  { id: "advice", icon: "◎" },
  { id: "showcase", icon: "▣" },
  { id: "offer", icon: "◇" },
  { id: "event", icon: "◷" },
  { id: "behind_scenes", icon: "◉" },
  { id: "recruitment", icon: "+" },
];

const VISUAL_STYLES: MediaGenerationVisualStyle[] = [
  "brand",
  "clean",
  "premium",
  "warm",
  "dynamic",
  "expert",
  "local",
  "colorful",
];

const IMAGE_STYLES: MediaGenerationImageStyle[] = [
  "photo",
  "illustration",
  "three_d",
  "graphic",
];
const SHOT_TYPES: MediaGenerationShotType[] = ["auto", "close", "medium", "wide"];
const PEOPLE_MODES: MediaGenerationPeopleMode[] = ["auto", "none", "solo", "team"];
const CREATIVITY_LEVELS: MediaGenerationCreativity[] = ["faithful", "bold"];
const LOGO_MODES: MediaGenerationLogoMode[] = ["discreet", "visible", "none"];
const MAX_TEXT_KEYWORDS = 6;
const MAX_INSPIRATION_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_INSPIRATION_OUTPUT_BYTES = 560_000;
const MAX_INSPIRATION_DIMENSION = 1_280;
const MAX_INSPIRATION_IMAGES = 3;

function canvasBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("L’image d’inspiration n’a pas pu être préparée.")),
      "image/jpeg",
      quality,
    );
  });
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("L’image d’inspiration n’a pas pu être lue."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const separator = value.indexOf(",");
      if (separator < 0) {
        reject(new Error("L’image d’inspiration est invalide."));
        return;
      }
      resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function prepareInspirationImage(
  file: File,
): Promise<MediaGenerationInspirationImage> {
  if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) {
    throw new Error("Utilisez une image JPG, PNG ou WebP.");
  }
  if (!file.size || file.size > MAX_INSPIRATION_SOURCE_BYTES) {
    throw new Error("L’image d’inspiration doit peser moins de 12 Mo.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("L’image d’inspiration est illisible."));
      image.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("L’image d’inspiration est illisible.");
    }

    let scale = Math.min(
      1,
      MAX_INSPIRATION_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    );
    let output: Blob | null = null;
    for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("L’image d’inspiration n’a pas pu être préparée.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.88, 0.78, 0.68]) {
        const candidate = await canvasBlob(canvas, quality);
        if (candidate.size <= MAX_INSPIRATION_OUTPUT_BYTES) {
          output = candidate;
          break;
        }
      }
      if (output) break;
      scale *= 0.78;
    }
    if (!output) {
      throw new Error("L’image reste trop volumineuse après optimisation.");
    }
    return {
      mimeType: "image/jpeg",
      data: await blobBase64(output),
      name: file.name.slice(0, 120) || "inspiration.jpg",
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function normalizeTextKeywordValues(values: readonly string[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    for (const part of String(rawValue || "").split(/[,;\n]+/)) {
      const keyword = part
        .replace(/^[#,;\s]+|[#,;\s]+$/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 48);
      if (keyword.length < 2) continue;
      const comparable = keyword.toLocaleLowerCase();
      if (seen.has(comparable)) continue;
      seen.add(comparable);
      normalized.push(keyword);
      if (normalized.length >= MAX_TEXT_KEYWORDS) return normalized;
    }
  }
  return normalized;
}

export default function MediaGenerator({
  source,
  origin,
  publicationBrief = "",
  acceptMode,
  onAccepted,
  onResultChange,
  onBusyChange,
}: MediaGeneratorProps) {
  const t = useTranslations("media");
  const locale = useLocale();
  const normalizedPublicationBrief = String(publicationBrief || "").trim();
  const publicationAvailable = normalizedPublicationBrief.length >= 3;
  const {
    quota,
    progress,
    error,
    result: generationResult,
    originChangedNotice,
    busy: generationBusy,
    cancellable: generationCancellable,
    quotaLoading,
    loadQuota,
    generate,
    cancelGeneration,
    acceptDraft,
    discardDraft,
    reset,
  } = useMediaGeneration();

  const [subjectSource, setSubjectSource] = useState<MediaGenerationSubjectSource>(
    publicationAvailable ? "publication" : "profile",
  );
  const [customIdea, setCustomIdea] = useState("");
  const [kind, setKind] = useState<MediaGenerationKind>("image");
  const [format, setFormat] = useState<MediaGenerationFormat>("square");
  const [typology, setTypology] = useState<MediaGenerationTypology>("service");
  const [visualStyle, setVisualStyle] = useState<MediaGenerationVisualStyle>("brand");
  const [imageStyle, setImageStyle] = useState<MediaGenerationImageStyle>("photo");
  const [shotType, setShotType] = useState<MediaGenerationShotType>("auto");
  const [peopleMode, setPeopleMode] = useState<MediaGenerationPeopleMode>("auto");
  const [creativity, setCreativity] = useState<MediaGenerationCreativity>("faithful");
  const [useBrandColors, setUseBrandColors] = useState(true);
  const [logoMode, setLogoMode] = useState<MediaGenerationLogoMode>("discreet");
  const [durationSeconds, setDurationSeconds] =
    useState<MediaGenerationVideoDuration>(10);
  const [withText, setWithText] = useState(true);
  const [textKeywords, setTextKeywords] = useState<string[]>([]);
  const [textKeywordDraft, setTextKeywordDraft] = useState("");
  const [withMusic, setWithMusic] = useState(true);
  const [withNarration, setWithNarration] = useState(true);
  const [inspirationImages, setInspirationImages] =
    useState<MediaGenerationInspirationImage[]>([]);
  const [inspirationBusy, setInspirationBusy] = useState(false);
  const [inspirationRulesOpen, setInspirationRulesOpen] = useState(false);
  const [expandedStep, setExpandedStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [creationScreen, setCreationScreen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [actionError, setActionError] = useState("");
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false);
  const generationSequenceRef = useRef(0);
  const acceptInFlightRef = useRef(false);
  const busy = generationBusy || discarding;
  const operationLocked = busy || finishing || voiceBusy || inspirationBusy;

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  useEffect(() => {
    if (!publicationAvailable && subjectSource === "publication") {
      setSubjectSource("profile");
    }
  }, [publicationAvailable, subjectSource]);

  useLayoutEffect(() => {
    onBusyChange?.(operationLocked);
    return () => onBusyChange?.(false);
  }, [onBusyChange, operationLocked]);

  useLayoutEffect(() => {
    onResultChange?.(generationResult);
  }, [generationResult, onResultChange]);

  useEffect(() => {
    if (!generationBusy) setCancelConfirmationOpen(false);
  }, [generationBusy]);

  const resolvedIdea =
    subjectSource === "publication"
      ? normalizedPublicationBrief
      : subjectSource === "custom"
        ? customIdea.trim()
        : "";
  const subjectReady =
    subjectSource === "profile" ||
    (subjectSource === "publication" && publicationAvailable) ||
    (subjectSource === "custom" && resolvedIdea.length >= 3);
  const resolvedTextKeywords = withText
    ? normalizeTextKeywordValues([...textKeywords, textKeywordDraft])
    : [];
  const counter = quota?.[kind] || null;
  const exhausted = quota?.unlimited ? false : counter?.remaining === 0;
  const standardVideoLongFormRestricted =
    kind === "video" && quota?.videoLongFormPremiumRequired === true;
  const videoPremiumRequired =
    standardVideoLongFormRestricted && durationSeconds > 10;
  const disabled =
    operationLocked || !subjectReady || Boolean(exhausted) || videoPremiumRequired;

  const resetDate = useMemo(() => {
    if (!quota?.resetAt) return "";
    const parsed = new Date(quota.resetAt);
    if (Number.isNaN(parsed.getTime())) return "";
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(parsed);
  }, [locale, quota?.resetAt]);

  const progressLabel =
    progress >= 99
      ? t("ai_generator_stage_patience")
      : progress < 18
        ? t("ai_generator_stage_profile")
        : progress < 42
          ? t("ai_generator_stage_brand")
          : progress < 72
            ? t(kind === "video" ? "ai_generator_stage_storyboard" : "ai_generator_stage_image")
            : t(kind === "video" ? "ai_generator_stage_render" : "ai_generator_stage_finish");

  const quotaValue =
    quotaLoading && !counter
      ? t("chargement_01cba1df")
      : videoPremiumRequired
        ? t("ai_generator_premium_only_short")
        : quota?.unlimited
        ? t("ai_generator_unlimited")
        : counter?.limit === null || !counter
        ? "—"
        : counter.limit === 0
        ? "0 / 0"
        : `${counter.used + counter.reserved} / ${counter.limit}`;

  const clearTransientState = () => {
    reset();
    setActionError("");
  };

  const addTextKeywords = (rawValue: string) => {
    setTextKeywords((current) => normalizeTextKeywordValues([...current, rawValue]));
    setTextKeywordDraft("");
    if (actionError || error) clearTransientState();
  };

  const removeTextKeyword = (keyword: string) => {
    setTextKeywords((current) => current.filter((value) => value !== keyword));
    if (actionError || error) clearTransientState();
  };

  const handleGenerate = async () => {
    if (!subjectReady) return;
    const sequence = generationSequenceRef.current + 1;
    generationSequenceRef.current = sequence;
    setCreationScreen(true);
    setCancelConfirmationOpen(false);
    setActionError("");

    if (generationResult?.draft) {
      setDiscarding(true);
      try {
        await discardDraft(generationResult);
        onResultChange?.(null);
      } catch (caught) {
        if (sequence !== generationSequenceRef.current) return;
        setActionError(caught instanceof Error ? caught.message : t("ai_generator_error"));
        return;
      } finally {
        setDiscarding(false);
      }
    }

    try {
      await generate({
        source,
        kind,
        subjectSource,
        idea: resolvedIdea,
        withText,
        textKeywords: resolvedTextKeywords,
        withMusic: kind === "video" ? withMusic : undefined,
        withNarration: kind === "video" ? withNarration : undefined,
        format,
        typology,
        visualStyle,
        imageStyle,
        shotType,
        peopleMode,
        creativity,
        useBrandColors,
        logoMode,
        durationSeconds: kind === "video" ? durationSeconds : undefined,
        inspirationImages: kind === "video" ? inspirationImages : [],
      });
    } catch (caught) {
      if (sequence !== generationSequenceRef.current) return;
      if (caught instanceof MediaGenerationAccountChangedError) {
        setActionError("");
        return;
      }
      if (caught instanceof MediaGenerationCancelledError) {
        setActionError("");
        return;
      }
      setActionError(caught instanceof Error ? caught.message : t("ai_generator_error"));
    }
  };

  const handleRequestGenerationStop = () => {
    if (generationCancellable) setCancelConfirmationOpen(true);
  };

  const handleConfirmGenerationStop = () => {
    generationSequenceRef.current += 1;
    setCancelConfirmationOpen(false);
    if (!cancelGeneration()) return;
    setActionError("");
    setCreationScreen(false);
  };

  const handleEditCriteria = async () => {
    if (operationLocked) return;
    setActionError("");
    if (generationResult?.draft) {
      setDiscarding(true);
      try {
        await discardDraft(generationResult);
        onResultChange?.(null);
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : t("ai_generator_error"));
        return;
      } finally {
        setDiscarding(false);
      }
    }
    clearTransientState();
    setCreationScreen(false);
  };

  const handleConfirm = async () => {
    if (!generationResult || operationLocked || acceptInFlightRef.current) return;
    acceptInFlightRef.current = true;
    setActionError("");
    setFinishing(true);
    try {
      const result = await acceptDraft(generationResult);
      onResultChange?.(result);
      await onAccepted(result);
    } catch (caught) {
      if (caught instanceof MediaGenerationAccountChangedError) {
        setActionError("");
        return;
      }
      setActionError(caught instanceof Error ? caught.message : t("ai_generator_error"));
    } finally {
      acceptInFlightRef.current = false;
      setFinishing(false);
    }
  };

  const subjectChoices: Array<{
    id: MediaGenerationSubjectSource;
    title: string;
    description: string;
    disabled?: boolean;
  }> = [
    {
      id: "publication",
      title: t("ai_generator_subject_publication"),
      description: t(
        publicationAvailable
          ? "ai_generator_subject_publication_hint"
          : "ai_generator_subject_publication_unavailable",
      ),
      disabled: !publicationAvailable,
    },
    {
      id: "profile",
      title: t("ai_generator_subject_profile"),
      description: t("ai_generator_subject_profile_hint"),
    },
    {
      id: "custom",
      title: t("ai_generator_subject_custom"),
      description: t("ai_generator_subject_custom_hint"),
    },
  ];

  if (creationScreen) {
    return (
      <div className={styles.creationWorkspace} data-origin={origin} data-media-kind={kind}>
        <div className={styles.creationBackdrop} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        {operationLocked && !generationResult ? (
          <div className={styles.creationProgress} role="status" aria-live="polite">
            <div className={styles.orbit} aria-hidden="true">
              <span>✦</span>
            </div>
            <p className={styles.creationEyebrow}>{t("ai_generator_creation_eyebrow")}</p>
            <h3>{progressLabel}</h3>
            <p>
              {t(kind === "video" ? "ai_generator_video_creation_detail" : "ai_generator_image_creation_detail", {
                duration: durationSeconds,
              })}
            </p>
            <div className={styles.largeProgressTrack} aria-hidden="true">
              <span style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
            <strong>{progress} %</strong>
            <small>{t("ai_generator_keep_open")}</small>
            {generationCancellable ? (
              <button
                type="button"
                className={styles.stopGenerationButton}
                onClick={handleRequestGenerationStop}
              >
                {t("ai_generator_stop_generation")}
              </button>
            ) : null}
          </div>
        ) : null}

        {cancelConfirmationOpen && generationCancellable ? (
          <div className={styles.cancelGenerationBackdrop}>
            <div
              className={styles.cancelGenerationDialog}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="ai-media-cancel-title"
              aria-describedby="ai-media-cancel-description"
            >
              <span aria-hidden="true">!</span>
              <h3 id="ai-media-cancel-title">
                {t("ai_generator_stop_confirm_title")}
              </h3>
              <p id="ai-media-cancel-description">
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
          <div className={styles.reviewWorkspace}>
            <div className={styles.reviewHeading}>
              <div>
                <p>{t("ai_generator_ready")}</p>
                <h3>{t(kind === "video" ? "ai_generator_video_ready_title" : "ai_generator_image_ready_title")}</h3>
              </div>
              <span>{FORMATS.find((item) => item.id === format)?.ratio}</span>
            </div>
            <div className={styles.previewFrame} data-format={format}>
              {generationResult.item.signed_url ? (
                generationResult.item.media_type === "video" ? (
                  <video src={generationResult.item.signed_url} controls playsInline preload="metadata" />
                ) : (
                  <img src={generationResult.item.signed_url} alt={generationResult.item.title || t("ai_generator_preview_alt")} />
                )
              ) : (
                <span>{t("apercu_indisponible_d0ce704a")}</span>
              )}
            </div>
            <div className={styles.savedStatus} role="status">
              <span aria-hidden="true">✓</span>
              {t("ai_generator_saved_automatically")}
            </div>
            <div className={styles.resultActions}>
              <button type="button" className={styles.confirmButton} onClick={() => void handleConfirm()} disabled={operationLocked}>
                {finishing
                  ? t(acceptMode === "insert" ? "ai_generator_inserting" : "ai_generator_finishing_library")
                  : t(acceptMode === "insert" ? "ai_generator_confirm_insert" : "ai_generator_open_library")}
              </button>
              <button type="button" className={styles.regenerateButton} onClick={() => void handleGenerate()} disabled={disabled}>
                ↻ {t("ai_generator_regenerate")}
              </button>
              <button type="button" className={styles.editButton} onClick={() => void handleEditCriteria()} disabled={operationLocked}>
                {t("ai_generator_edit_criteria")}
              </button>
            </div>
          </div>
        ) : null}

        {!operationLocked && !generationResult ? (
          <div className={styles.creationErrorPanel}>
            <span aria-hidden="true">!</span>
            <h3>{t("ai_generator_creation_failed_title")}</h3>
            <p>{actionError || error || t("ai_generator_error")}</p>
            <div>
              <button type="button" onClick={() => void handleGenerate()} disabled={disabled}>
                {t("ai_generator_retry")}
              </button>
              <button type="button" onClick={() => void handleEditCriteria()}>
                {t("ai_generator_edit_criteria")}
              </button>
            </div>
          </div>
        ) : null}

        {actionError && generationResult ? <div className={styles.error} role="alert">{actionError}</div> : null}
        {originChangedNotice ? <div className={styles.warning} role="status">{t("ai_generator_origin_changed")}</div> : null}
      </div>
    );
  }

  return (
    <div className={styles.generator} data-origin={origin}>
      <div className={styles.introCard}>
        <div>
          <span>✦</span>
          <div>
            <strong>{t("ai_generator_made_inrcy")}</strong>
            <small>{t("ai_generator_made_inrcy_hint")}</small>
          </div>
        </div>
        <div className={styles.profileSignals}>
          <span>✓ {t("ai_generator_signal_profile")}</span>
          <span>✓ {t("ai_generator_signal_brand")}</span>
          <span>✓ {t("ai_generator_signal_history")}</span>
        </div>
      </div>

      <div className={styles.criteriaGrid}>
        <section className={`${styles.criteriaSection} ${styles.collapsibleSection}`}>
          <button
            type="button"
            className={styles.collapsibleToggle}
            aria-expanded={expandedStep === 1}
            onClick={() => setExpandedStep((current) => current === 1 ? null : 1)}
          >
            <span className={styles.stepBadge}>1</span>
            <span className={styles.collapsibleTitle}>
              <strong>{t("ai_generator_group_creation_title")}</strong>
              <small>{t("ai_generator_group_creation_hint")}</small>
            </span>
            <span className={styles.sectionSelection}>
              {t(kind === "image" ? "image_50e19fda" : "video_304f6ca4")} · {t(`ai_generator_subject_${subjectSource}`)}
              {kind === "video" && inspirationImages.length
                ? t("ai_generator_inspiration_summary", {
                    count: inspirationImages.length,
                  })
                : ""}
            </span>
            <i aria-hidden="true">⌄</i>
          </button>
          {expandedStep === 1 ? <div className={styles.collapsibleBody}>
            <div className={styles.combinedSubsection}>
              <strong className={styles.combinedSectionTitle}>{t("ai_generator_step_kind")}</strong>
              <div className={styles.kindChoices} role="radiogroup" aria-label={t("ai_generator_kind_label")}>
                {(["image", "video"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={kind === option}
                    className={kind === option ? styles.kindActive : ""}
                    disabled={operationLocked}
                    onClick={() => {
                      clearTransientState();
                      setKind(option);
                    }}
                  >
                    <span aria-hidden="true">{option === "image" ? "✦" : "▶"}</span>
                    <strong>{t(option === "image" ? "image_50e19fda" : "video_304f6ca4")}</strong>
                    <small>{t(option === "image" ? "ai_generator_kind_image_hint" : "ai_generator_kind_video_hint")}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.combinedSubsection}>
              <strong className={styles.combinedSectionTitle}>{t("ai_generator_step_subject")}</strong>
              <div className={styles.subjectChoices} role="radiogroup" aria-label={t("ai_generator_step_subject")}>
              {subjectChoices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  role="radio"
                  aria-checked={subjectSource === choice.id}
                  className={subjectSource === choice.id ? styles.choiceActive : ""}
                  disabled={operationLocked || choice.disabled}
                  onClick={() => {
                    clearTransientState();
                    setSubjectSource(choice.id);
                  }}
                >
                  <span aria-hidden="true">{subjectSource === choice.id ? "✓" : ""}</span>
                  <strong>{choice.title}</strong>
                  <small>{choice.description}</small>
                </button>
              ))}
              </div>
              {subjectSource === "custom" ? (
                <div className={styles.customField}>
                <label htmlFor="ai-media-custom-subject">{t("ai_generator_custom_label")}</label>
                <div className={styles.customTextareaWrap}>
                  <textarea
                    id="ai-media-custom-subject"
                    autoFocus
                    value={customIdea}
                    onChange={(event) => {
                      setCustomIdea(event.target.value);
                      if (actionError || error) clearTransientState();
                    }}
                    placeholder={t("ai_generator_custom_placeholder")}
                    maxLength={1_600}
                    disabled={busy || finishing}
                    rows={3}
                  />
                  <MediaSubjectVoiceButton
                    disabled={busy || finishing}
                    value={customIdea}
                    onBusyChange={setVoiceBusy}
                    onChange={(nextValue) => {
                      setCustomIdea(nextValue);
                      if (actionError || error) clearTransientState();
                    }}
                  />
                </div>
                {customIdea.trim().length > 0 && customIdea.trim().length < 3 ? <small>{t("ai_generator_custom_too_short")}</small> : null}
                </div>
              ) : null}
              {kind === "video" ? (
                <div className={styles.inspirationSection}>
                  <strong className={styles.combinedSectionTitle}>
                    {t("ai_generator_inspiration_title")}
                  </strong>
                  <p>{t("ai_generator_inspiration_hint")}</p>
                  {inspirationImages.length ? (
                    <div className={styles.inspirationPreviews}>
                      {inspirationImages.map((image, index) => (
                        <div
                          key={`${image.name}-${index}`}
                          className={styles.inspirationPreview}
                        >
                          <img
                            src={`data:${image.mimeType};base64,${image.data}`}
                            alt=""
                          />
                          <span>
                            <strong>{image.name}</strong>
                            <small>{t("ai_generator_inspiration_ready")}</small>
                          </span>
                          <button
                            type="button"
                            disabled={operationLocked}
                            aria-label={t("ai_generator_inspiration_remove")}
                            onClick={() => {
                              setInspirationImages((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index),
                              );
                              if (actionError || error) clearTransientState();
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {inspirationImages.length < MAX_INSPIRATION_IMAGES ? (
                    <div className={styles.inspirationPickerRow}>
                      <label className={styles.inspirationPicker}>
                        <span aria-hidden="true">＋</span>
                        <strong>
                          {inspirationBusy
                            ? t("ai_generator_inspiration_preparing")
                            : t("ai_generator_inspiration_add")}
                        </strong>
                        <small>
                          {inspirationImages.length} / {MAX_INSPIRATION_IMAGES}
                        </small>
                        <input
                          type="file"
                          multiple
                          accept="image/jpeg,image/png,image/webp"
                          disabled={operationLocked}
                          onChange={(event) => {
                            const remaining =
                              MAX_INSPIRATION_IMAGES - inspirationImages.length;
                            const files = Array.from(event.currentTarget.files || []).slice(
                              0,
                              remaining,
                            );
                            event.currentTarget.value = "";
                            if (!files.length) return;
                            setInspirationBusy(true);
                            setActionError("");
                            void Promise.all(files.map(prepareInspirationImage))
                              .then((prepared) =>
                                setInspirationImages((current) =>
                                  [...current, ...prepared].slice(
                                    0,
                                    MAX_INSPIRATION_IMAGES,
                                  ),
                                ),
                              )
                              .catch((caught) =>
                                setActionError(
                                  caught instanceof Error
                                    ? caught.message
                                    : t("ai_generator_error"),
                                ),
                              )
                              .finally(() => setInspirationBusy(false));
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className={styles.inspirationInfoButton}
                        aria-label={t("ai_generator_inspiration_rules_title")}
                        aria-expanded={inspirationRulesOpen}
                        onClick={() => setInspirationRulesOpen((current) => !current)}
                      >
                        i
                      </button>
                      {inspirationRulesOpen ? (
                        <aside className={styles.inspirationInfoBubble} role="note">
                          <strong>{t("ai_generator_inspiration_rules_title")}</strong>
                          <p>{t("ai_generator_inspiration_rules_body")}</p>
                        </aside>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div> : null}
        </section>

        <section className={`${styles.criteriaSection} ${styles.collapsibleSection} ${styles.contentCriteriaSection}`}>
          <button
            type="button"
            className={styles.collapsibleToggle}
            aria-expanded={expandedStep === 2}
            onClick={() => setExpandedStep((current) => current === 2 ? null : 2)}
          >
            <span className={styles.stepBadge}>2</span>
            <span className={styles.collapsibleTitle}>
              <strong>{t("ai_generator_group_content_title")}</strong>
              <small>{t("ai_generator_group_content_hint")}</small>
            </span>
            <span className={styles.sectionSelection}>
              {t(`ai_generator_typology_${typology}`)} · {FORMATS.find((item) => item.id === format)?.ratio}
            </span>
            <i aria-hidden="true">⌄</i>
          </button>
          {expandedStep === 2 ? <div className={styles.collapsibleBody}>
            <div className={styles.combinedSubsection}>
              <strong className={styles.combinedSectionTitle}>{t("ai_generator_typology_title")}</strong>
              <div className={styles.typologyChoices} role="radiogroup" aria-label={t("ai_generator_typology_title")}>
              {TYPOLOGIES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={typology === option.id}
                  className={typology === option.id ? styles.compactChoiceActive : ""}
                  onClick={() => setTypology(option.id)}
                  disabled={operationLocked}
                >
                  <span aria-hidden="true">{option.icon}</span>
                  {t(`ai_generator_typology_${option.id}`)}
                </button>
              ))}
              </div>
            </div>
            <div className={styles.combinedSubsection}>
              <strong className={styles.combinedSectionTitle}>{t("ai_generator_format_title")}</strong>
              <div className={styles.formatChoices} role="radiogroup" aria-label={t("ai_generator_format_title")}>
              {FORMATS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={format === option.id}
                  className={format === option.id ? styles.compactChoiceActive : ""}
                  onClick={() => setFormat(option.id)}
                  disabled={operationLocked}
                >
                  <span aria-hidden="true">{option.icon}</span>
                  <strong>{t(`ai_generator_format_${option.id}`)}</strong>
                  <small>{option.ratio}</small>
                </button>
              ))}
              </div>
            </div>
          </div> : null}
        </section>

        <section className={`${styles.criteriaSection} ${styles.collapsibleSection}`}>
          <button
            type="button"
            className={styles.collapsibleToggle}
            aria-expanded={expandedStep === 3}
            onClick={() => setExpandedStep((current) => current === 3 ? null : 3)}
          >
            <span className={styles.stepBadge}>3</span>
            <span className={styles.collapsibleTitle}>
              <strong>{t("ai_generator_group_art_title")}</strong>
              <small>{t("ai_generator_group_art_hint")}</small>
            </span>
            <span className={styles.sectionSelection}>{t(`ai_generator_style_${visualStyle}`)}</span>
            <i aria-hidden="true">⌄</i>
          </button>
          {expandedStep === 3 ? <div className={styles.collapsibleBody}>
            <div className={styles.styleChoices} role="radiogroup" aria-label={t("ai_generator_style_title")}>
              {VISUAL_STYLES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={visualStyle === option}
                  className={visualStyle === option ? styles.compactChoiceActive : ""}
                  onClick={() => setVisualStyle(option)}
                  disabled={operationLocked}
                >
                  {t(`ai_generator_style_${option}`)}
                </button>
              ))}
            </div>
          </div> : null}
        </section>

        <section className={`${styles.criteriaSection} ${styles.collapsibleSection}`}>
          <button
            type="button"
            className={styles.collapsibleToggle}
            aria-expanded={expandedStep === 4}
            onClick={() => setExpandedStep((current) => current === 4 ? null : 4)}
          >
            <span className={styles.stepBadge}>4</span>
            <span className={styles.collapsibleTitle}>
              <strong>{t("ai_generator_group_composition_title")}</strong>
              <small>{t("ai_generator_group_composition_hint")}</small>
            </span>
            <span className={styles.sectionSelection}>
              {t(`ai_generator_render_${imageStyle}`)} · {t(`ai_generator_shot_${shotType}`)}
            </span>
            <i aria-hidden="true">⌄</i>
          </button>
          {expandedStep === 4 ? <div className={styles.collapsibleBody}>
            <div className={styles.parameterGroup}>
              <span>{t("ai_generator_render_label")}</span>
              <div className={styles.parameterChoices} role="radiogroup" aria-label={t("ai_generator_render_label")}>
                {IMAGE_STYLES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={imageStyle === option}
                    className={imageStyle === option ? styles.compactChoiceActive : ""}
                    onClick={() => setImageStyle(option)}
                    disabled={operationLocked}
                  >
                    {t(`ai_generator_render_${option}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.parameterGroup}>
              <span>{t("ai_generator_shot_label")}</span>
              <div className={styles.parameterChoices} role="radiogroup" aria-label={t("ai_generator_shot_label")}>
                {SHOT_TYPES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={shotType === option}
                    className={shotType === option ? styles.compactChoiceActive : ""}
                    onClick={() => setShotType(option)}
                    disabled={operationLocked}
                  >
                    {t(`ai_generator_shot_${option}`)}
                  </button>
                ))}
              </div>
            </div>
          </div> : null}
        </section>

        <section className={`${styles.criteriaSection} ${styles.collapsibleSection}`}>
          <button
            type="button"
            className={styles.collapsibleToggle}
            aria-expanded={expandedStep === 5}
            onClick={() => setExpandedStep((current) => current === 5 ? null : 5)}
          >
            <span className={styles.stepBadge}>5</span>
            <span className={styles.collapsibleTitle}>
              <strong>{t("ai_generator_group_identity_title")}</strong>
              <small>{t("ai_generator_group_identity_hint")}</small>
            </span>
            <span className={styles.sectionSelection}>
              {t(`ai_generator_people_${peopleMode}`)} · {t(`ai_generator_logo_${logoMode}`)}
            </span>
            <i aria-hidden="true">⌄</i>
          </button>
          {expandedStep === 5 ? <div className={styles.collapsibleBody}>
            <div className={styles.parameterGroup}>
              <span>{t("ai_generator_people_label")}</span>
              <div className={styles.parameterChoices} role="radiogroup" aria-label={t("ai_generator_people_label")}>
                {PEOPLE_MODES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={peopleMode === option}
                    className={peopleMode === option ? styles.compactChoiceActive : ""}
                    onClick={() => setPeopleMode(option)}
                    disabled={operationLocked}
                  >
                    {t(`ai_generator_people_${option}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.parameterGroup}>
              <span>{t("ai_generator_creativity_label")}</span>
              <div className={`${styles.parameterChoices} ${styles.twoChoices}`} role="radiogroup" aria-label={t("ai_generator_creativity_label")}>
                {CREATIVITY_LEVELS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={creativity === option}
                    className={creativity === option ? styles.compactChoiceActive : ""}
                    onClick={() => setCreativity(option)}
                    disabled={operationLocked}
                  >
                    {t(`ai_generator_creativity_${option}`)}
                  </button>
                ))}
              </div>
            </div>
            <label className={styles.switchRow}>
              <span>
                <strong>{t("ai_generator_brand_colors")}</strong>
                <small>{t("ai_generator_brand_colors_hint")}</small>
              </span>
              <input type="checkbox" checked={useBrandColors} onChange={(event) => setUseBrandColors(event.target.checked)} />
              <i aria-hidden="true" />
            </label>
            <div className={styles.parameterGroup}>
              <span>{t("ai_generator_logo_label")}</span>
              <div className={`${styles.parameterChoices} ${styles.threeChoices}`} role="radiogroup" aria-label={t("ai_generator_logo_label")}>
                {LOGO_MODES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={logoMode === option}
                    className={logoMode === option ? styles.compactChoiceActive : ""}
                    onClick={() => setLogoMode(option)}
                    disabled={operationLocked}
                  >
                    {t(`ai_generator_logo_${option}`)}
                  </button>
                ))}
              </div>
            </div>
          </div> : null}
        </section>

        <section className={`${styles.criteriaSection} ${styles.optionsSection} ${styles.collapsibleSection}`}>
          <button
            type="button"
            className={styles.collapsibleToggle}
            aria-expanded={expandedStep === 6}
            onClick={() => setExpandedStep((current) => current === 6 ? null : 6)}
          >
            <span className={styles.stepBadge}>6</span>
            <span className={styles.collapsibleTitle}>
              <strong>{t("ai_generator_group_finish_title")}</strong>
              <small>{t("ai_generator_group_finish_hint")}</small>
            </span>
            <span className={styles.sectionSelection}>
              {kind === "video"
                ? t("ai_generator_options_summary_video", {
                    duration: durationSeconds,
                    text: t(withText ? "ai_generator_with_text" : "ai_generator_without_text"),
                    music: t(withMusic ? "ai_generator_with_music" : "ai_generator_without_music"),
                    narration: t(withNarration ? "ai_generator_with_narration" : "ai_generator_without_narration"),
                  })
                : withText && resolvedTextKeywords.length
                  ? t("ai_generator_options_summary_text_keywords", {
                      text: t("ai_generator_with_text"),
                      count: resolvedTextKeywords.length,
                    })
                  : t(withText ? "ai_generator_with_text" : "ai_generator_without_text")}
            </span>
            <i aria-hidden="true">⌄</i>
          </button>
          {expandedStep === 6 ? <div className={styles.collapsibleBody}>
            {kind === "video" ? (
              <div className={styles.durationChoices} role="radiogroup" aria-label={t("ai_generator_duration_title")}>
                {([10, 20, 30] as const).map((duration) => {
                  const premiumLocked = standardVideoLongFormRestricted && duration > 10;
                  return (
                    <button
                      key={duration}
                      type="button"
                      role="radio"
                      aria-checked={durationSeconds === duration}
                      className={durationSeconds === duration ? styles.compactChoiceActive : ""}
                      onClick={() => setDurationSeconds(duration)}
                      disabled={operationLocked || premiumLocked}
                      title={premiumLocked ? t("ai_generator_video_premium_required") : undefined}
                    >
                      <strong>{duration} s</strong>
                      <small>
                        {t(`ai_generator_duration_${duration}`)}
                        {premiumLocked ? ` · ${t("ai_generator_premium_only_short")}` : ""}
                      </small>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {standardVideoLongFormRestricted ? (
              <div className={styles.durationUpsell} role="note">
                {t("ai_generator_video_premium_required")}
              </div>
            ) : null}
            <label className={styles.switchRow}>
              <span>
                <strong>{t("ai_generator_text_on_media")}</strong>
                <small>{t("ai_generator_text_inspiration_hint")}</small>
              </span>
              <input type="checkbox" checked={withText} onChange={(event) => setWithText(event.target.checked)} />
              <i aria-hidden="true" />
            </label>
            {withText ? (
              <div className={styles.textKeywordsGroup}>
                <div className={styles.textKeywordsHeader}>
                  <span>{t("ai_generator_text_keywords_label")}</span>
                  <small>{t("ai_generator_text_keywords_counter", { count: resolvedTextKeywords.length, max: MAX_TEXT_KEYWORDS })}</small>
                </div>
                <p>{t("ai_generator_text_keywords_hint")}</p>
                {textKeywords.length ? (
                  <div className={styles.textKeywordTags} aria-label={t("ai_generator_text_keywords_label")}>
                    {textKeywords.map((keyword) => (
                      <span key={keyword} className={styles.textKeywordTag}>
                        {keyword}
                        <button
                          type="button"
                          onClick={() => removeTextKeyword(keyword)}
                          disabled={operationLocked}
                          aria-label={t("ai_generator_text_keyword_remove", { keyword })}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className={styles.textKeywordInputRow}>
                  <input
                    type="text"
                    value={textKeywordDraft}
                    onChange={(event) => setTextKeywordDraft(event.target.value.slice(0, 160))}
                    onKeyDown={(event) => {
                      if (["Enter", ",", ";"].includes(event.key)) {
                        event.preventDefault();
                        if (textKeywordDraft.trim()) addTextKeywords(textKeywordDraft);
                      } else if (event.key === "Backspace" && !textKeywordDraft && textKeywords.length) {
                        removeTextKeyword(textKeywords[textKeywords.length - 1]);
                      }
                    }}
                    onBlur={() => {
                      if (textKeywordDraft.trim()) addTextKeywords(textKeywordDraft);
                    }}
                    placeholder={t("ai_generator_text_keywords_placeholder")}
                    disabled={operationLocked || textKeywords.length >= MAX_TEXT_KEYWORDS}
                    aria-label={t("ai_generator_text_keywords_label")}
                  />
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addTextKeywords(textKeywordDraft)}
                    disabled={operationLocked || !textKeywordDraft.trim() || textKeywords.length >= MAX_TEXT_KEYWORDS}
                  >
                    {t("ai_generator_text_keyword_add")}
                  </button>
                </div>
              </div>
            ) : null}
            {kind === "video" ? (
              <label className={styles.switchRow}>
                <span>
                  <strong>{t("ai_generator_narration")}</strong>
                  <small>{t("ai_generator_narration_hint")}</small>
                </span>
                <input type="checkbox" checked={withNarration} onChange={(event) => setWithNarration(event.target.checked)} />
                <i aria-hidden="true" />
              </label>
            ) : null}
            {kind === "video" ? (
              <label className={styles.switchRow}>
                <span>
                  <strong>{t("ai_generator_with_music")}</strong>
                  <small>{t("ai_generator_music_inrcy_hint")}</small>
                </span>
                <input type="checkbox" checked={withMusic} onChange={(event) => setWithMusic(event.target.checked)} />
                <i aria-hidden="true" />
              </label>
            ) : null}
          </div> : null}
        </section>
      </div>

      <div className={styles.footerBar}>
        <div className={styles.quotaCard}>
          <span>{t(kind === "image" ? "ai_generator_image_quota" : "ai_generator_video_quota")}</span>
          <strong>{quotaValue}</strong>
          <small>
            {videoPremiumRequired
              ? t("ai_generator_video_premium_required")
              : quota?.unlimited
              ? t("ai_generator_unlimited")
              : counter?.remaining !== null && counter
              ? t("ai_generator_remaining", { count: counter.remaining })
              : t("ai_generator_monthly_quota")}
            {resetDate ? ` · ${t("ai_generator_reset", { date: resetDate })}` : ""}
          </small>
        </div>
        <button type="button" className={styles.generateButton} disabled={disabled} onClick={() => void handleGenerate()}>
          <span aria-hidden="true">✦</span>
          {t("ai_generator_generate_media")}
        </button>
      </div>

      {videoPremiumRequired ? (
        <div className={styles.warning} role="status">
          {t("ai_generator_video_premium_required")}
        </div>
      ) : exhausted ? (
        <div className={styles.warning} role="status">{t("ai_generator_quota_reached")}</div>
      ) : null}
      {actionError || error ? <div className={styles.error} role="alert">{actionError || error}</div> : null}
    </div>
  );
}
