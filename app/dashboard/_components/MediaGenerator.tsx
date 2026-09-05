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
  type MediaGenerationNarrationVoice,
  type MediaGenerationPeopleMode,
  type MediaGenerationResult,
  type MediaGenerationShotType,
  type MediaGenerationSource,
  type MediaGenerationSubjectSource,
  type MediaGenerationTypology,
  type MediaGenerationVideoDuration,
  type MediaGenerationVideoCharacterMode,
  type MediaGenerationVideoEngine,
  type MediaGenerationVisualStyle,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import useAiMediaGeneratorPreferences from "@/app/dashboard/_hooks/useAiMediaGeneratorPreferences";
import type {
  AiMediaGeneratorBlockDefaults,
  AiMediaGeneratorPreferenceBlockId,
} from "@/lib/aiMediaGenerationPreferences";
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
const VIDEO_CHARACTER_MODES: MediaGenerationVideoCharacterMode[] = [
  "auto",
  "professional",
  "brand_avatar",
  "reference_team",
];
const CREATIVITY_LEVELS: MediaGenerationCreativity[] = ["faithful", "bold"];
const LOGO_MODES: MediaGenerationLogoMode[] = ["discreet", "visible", "none"];
const MAX_TEXT_KEYWORDS = 6;
const MAX_INSPIRATION_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_INSPIRATION_OUTPUT_BYTES = 560_000;
const MAX_INSPIRATION_DIMENSION = 1_280;
const MAX_INSPIRATION_IMAGES = 3;

type RememberPreferenceControlProps = {
  checked: boolean;
  disabled: boolean;
  saving: boolean;
  label: string;
  savingLabel: string;
  blockTitle: string;
  onChange: (checked: boolean) => void;
};

function RememberPreferenceControl({
  checked,
  disabled,
  saving,
  label,
  savingLabel,
  blockTitle,
  onChange,
}: RememberPreferenceControlProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label} — ${blockTitle}`}
      className={styles.rememberPreference}
      data-checked={checked ? "true" : "false"}
      data-saving={saving ? "true" : "false"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
      <small>{saving ? savingLabel : label}</small>
    </button>
  );
}

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

function createIdentityReferenceSetId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `identity-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
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
  const {
    preferences: savedPreferences,
    loaded: preferencesLoaded,
    loading: preferencesLoading,
    error: preferencesError,
    savingBlockIds,
    accountEpoch: preferencesAccountEpoch,
    saveBlock: savePreferenceBlock,
  } = useAiMediaGeneratorPreferences();

  const [subjectSource, setSubjectSource] = useState<MediaGenerationSubjectSource>(
    publicationAvailable ? "publication" : "profile",
  );
  const [customIdea, setCustomIdea] = useState("");
  const [aiInstruction, setAiInstruction] = useState("");
  const [kind, setKind] = useState<MediaGenerationKind>("image");
  const [format, setFormat] = useState<MediaGenerationFormat>("square");
  const [typology, setTypology] = useState<MediaGenerationTypology>("service");
  const [visualStyle, setVisualStyle] = useState<MediaGenerationVisualStyle>("brand");
  const [imageStyle, setImageStyle] = useState<MediaGenerationImageStyle>("photo");
  const [shotType, setShotType] = useState<MediaGenerationShotType>("auto");
  const [peopleMode, setPeopleMode] = useState<MediaGenerationPeopleMode>("auto");
  const [videoCharacterMode, setVideoCharacterMode] =
    useState<MediaGenerationVideoCharacterMode>("auto");
  const [identityConsent, setIdentityConsent] = useState(false);
  const [creativity, setCreativity] = useState<MediaGenerationCreativity>("faithful");
  const [useBrandColors, setUseBrandColors] = useState(true);
  const [logoMode, setLogoMode] = useState<MediaGenerationLogoMode>("discreet");
  const [durationSeconds, setDurationSeconds] =
    useState<MediaGenerationVideoDuration>(8);
  const [videoEngine, setVideoEngine] =
    useState<MediaGenerationVideoEngine>("omni");
  const [withText, setWithText] = useState(true);
  const [textKeywords, setTextKeywords] = useState<string[]>([]);
  const [textKeywordDraft, setTextKeywordDraft] = useState("");
  const [withMusic, setWithMusic] = useState(true);
  const [withNarration, setWithNarration] = useState(true);
  const [narrationVoice, setNarrationVoice] =
    useState<MediaGenerationNarrationVoice>("female");
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
  const appliedPreferencesEpochRef = useRef(-1);
  const clearedSensitiveStateEpochRef = useRef(0);
  const generationSequenceRef = useRef(0);
  const identityReferenceSetIdRef = useRef("");
  if (!identityReferenceSetIdRef.current) {
    identityReferenceSetIdRef.current = createIdentityReferenceSetId();
  }
  const acceptInFlightRef = useRef(false);
  const busy = generationBusy || discarding;
  const operationLocked = busy || finishing || voiceBusy || inspirationBusy;

  useEffect(() => {
    if (clearedSensitiveStateEpochRef.current === preferencesAccountEpoch) return;
    clearedSensitiveStateEpochRef.current = preferencesAccountEpoch;
    setCustomIdea("");
    setAiInstruction("");
    setTextKeywords([]);
    setTextKeywordDraft("");
    setInspirationImages([]);
    setIdentityConsent(false);
    identityReferenceSetIdRef.current = createIdentityReferenceSetId();
  }, [preferencesAccountEpoch]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    if (appliedPreferencesEpochRef.current === preferencesAccountEpoch) return;

    const block1 = savedPreferences.blocks[1];
    if (block1.saved) {
      setKind(block1.defaults.kind);
      setSubjectSource(
        block1.defaults.subjectSource === "publication" && !publicationAvailable
          ? "profile"
          : block1.defaults.subjectSource,
      );
    }

    const block2 = savedPreferences.blocks[2];
    if (block2.saved) {
      setTypology(block2.defaults.typology);
      setFormat(block2.defaults.format);
    }

    const block3 = savedPreferences.blocks[3];
    if (block3.saved) {
      setVisualStyle(block3.defaults.visualStyle);
      setCreativity(block3.defaults.creativity);
      setUseBrandColors(block3.defaults.useBrandColors);
      setLogoMode(block3.defaults.logoMode);
    }

    const block4 = savedPreferences.blocks[4];
    if (block4.saved) {
      setImageStyle(block4.defaults.imageStyle);
      setShotType(block4.defaults.shotType);
    }

    const block5 = savedPreferences.blocks[5];
    if (block5.saved) {
      setPeopleMode(
        block5.defaults.identityMode === "reference_team"
          ? "team"
          : block5.defaults.peopleMode,
      );
      setVideoCharacterMode(
        block5.defaults.peopleMode === "none"
          ? "auto"
          : block5.defaults.identityMode,
      );
    }

    const block6 = savedPreferences.blocks[6];
    if (block6.saved) {
      setDurationSeconds(block6.defaults.durationSeconds);
      setWithText(block6.defaults.withText);
      setWithMusic(block6.defaults.withMusic);
      setWithNarration(block6.defaults.withNarration);
      setNarrationVoice(block6.defaults.narrationVoice);
    }

    appliedPreferencesEpochRef.current = preferencesAccountEpoch;
  }, [
    preferencesAccountEpoch,
    preferencesLoaded,
    publicationAvailable,
    savedPreferences,
  ]);

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
  const videoMaxDurationSeconds = quota?.videoMaxDurationSeconds ?? 24;

  useEffect(() => {
    if (!quota) return;
    setDurationSeconds((current) =>
      current > videoMaxDurationSeconds ? videoMaxDurationSeconds : current,
    );
  }, [quota, videoMaxDurationSeconds]);

  const videoDurationRestricted =
    kind === "video" && videoMaxDurationSeconds < 24;
  const videoPremiumRequired =
    kind === "video" && durationSeconds > videoMaxDurationSeconds;
  const characterReferenceMissing =
    peopleMode !== "none" &&
    ((videoCharacterMode === "professional" ||
      videoCharacterMode === "brand_avatar")
      ? inspirationImages.length === 0
      : videoCharacterMode === "reference_team"
        ? inspirationImages.length < 2 || inspirationImages.length > 3
        : false);
  const identityConsentRequired =
    peopleMode !== "none" && inspirationImages.length > 0;
  const identityConsentMissing = identityConsentRequired && !identityConsent;
  const disabled =
    operationLocked ||
    !subjectReady ||
    Boolean(exhausted) ||
    videoPremiumRequired ||
    characterReferenceMissing ||
    identityConsentMissing;

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
            ? t(
                kind === "video"
                  ? videoCharacterMode === "reference_team"
                    ? "ai_generator_stage_team_composition"
                    : "ai_generator_stage_storyboard"
                  : "ai_generator_stage_image",
              )
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

  const handleRememberPreference = (
    blockId: AiMediaGeneratorPreferenceBlockId,
    checked: boolean,
  ) => {
    switch (blockId) {
      case 1: {
        const defaults: AiMediaGeneratorBlockDefaults[1] = {
          kind,
          // A free subject is one-shot. Choosing it never makes its text, or
          // even the empty custom editor, the next generation's default.
          subjectSource: subjectSource === "publication" ? "publication" : "profile",
        };
        void savePreferenceBlock(1, checked, defaults);
        return;
      }
      case 2: {
        const defaults: AiMediaGeneratorBlockDefaults[2] = { typology, format };
        void savePreferenceBlock(2, checked, defaults);
        return;
      }
      case 3: {
        const defaults: AiMediaGeneratorBlockDefaults[3] = {
          visualStyle,
          creativity,
          useBrandColors,
          logoMode,
        };
        void savePreferenceBlock(3, checked, defaults);
        return;
      }
      case 4: {
        const defaults: AiMediaGeneratorBlockDefaults[4] = {
          imageStyle,
          shotType,
        };
        void savePreferenceBlock(4, checked, defaults);
        return;
      }
      case 5: {
        const defaults: AiMediaGeneratorBlockDefaults[5] = {
          peopleMode:
            videoCharacterMode === "reference_team" ? "team" : peopleMode,
          identityMode: peopleMode === "none" ? "auto" : videoCharacterMode,
        };
        void savePreferenceBlock(5, checked, defaults);
        return;
      }
      case 6: {
        const defaults: AiMediaGeneratorBlockDefaults[6] = {
          durationSeconds,
          withText,
          withMusic,
          withNarration,
          narrationVoice,
        };
        void savePreferenceBlock(6, checked, defaults);
      }
    }
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
        aiInstruction: aiInstruction.trim(),
        withText,
        textKeywords: resolvedTextKeywords,
        withMusic: kind === "video" ? withMusic : undefined,
        withNarration: kind === "video" ? withNarration : undefined,
        narrationVoice:
          kind === "video" && withNarration ? narrationVoice : undefined,
        format,
        typology,
        visualStyle,
        imageStyle,
        shotType,
        peopleMode,
        identityMode:
          peopleMode !== "none" ? videoCharacterMode : "auto",
        videoCharacterMode:
          peopleMode !== "none" ? videoCharacterMode : "auto",
        identityConsent:
          peopleMode !== "none" ? identityConsent : false,
        identityReferenceSetId:
          peopleMode !== "none" && inspirationImages.length
            ? identityReferenceSetIdRef.current
            : undefined,
        creativity,
        useBrandColors,
        logoMode,
        videoEngine: kind === "video" ? videoEngine : undefined,
        durationSeconds: kind === "video" ? durationSeconds : undefined,
        inspirationImages:
          peopleMode !== "none" ? inspirationImages : [],
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
    } finally {
      // L'accord porte sur un essai de génération précis. Une nouvelle
      // tentative, réussie ou non, exige donc une confirmation fraîche.
      if (inspirationImages.length > 0) setIdentityConsent(false);
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
              {t(
                kind === "video"
                  ? videoCharacterMode === "reference_team"
                    ? "ai_generator_video_creation_detail_team"
                    : "ai_generator_video_creation_detail"
                  : "ai_generator_image_creation_detail",
                { duration: durationSeconds },
              )}
            </p>
            <div className={styles.largeProgressTrack} aria-hidden="true">
              <span style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
            <strong>{progress} %</strong>
            <small>{t("ai_generator_keep_open")}</small>
            <div className={styles.stopGenerationSlot}>
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
              <div className={styles.reviewBadges}>
                <span>{FORMATS.find((item) => item.id === format)?.ratio}</span>
                {kind === "video" && generationResult.videoEngineResult ? (
                  <span
                    className={styles.engineResultBadge}
                    data-fallback={generationResult.videoEngineResult === "omni_veo_fallback"}
                  >
                    {t(`ai_generator_video_engine_result_${generationResult.videoEngineResult}`)}
                  </span>
                ) : null}
              </div>
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
      <div className={styles.criteriaGrid}>
        <section className={`${styles.criteriaSection} ${styles.collapsibleSection}`}>
          <div className={styles.collapsibleHeader}>
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
                {inspirationImages.length
                  ? t("ai_generator_inspiration_summary", {
                      count: inspirationImages.length,
                    })
                  : ""}
              </span>
              <i aria-hidden="true">⌄</i>
            </button>
            <RememberPreferenceControl
              checked={savedPreferences.blocks[1].saved}
              disabled={preferencesLoading || savingBlockIds.has(1)}
              saving={savingBlockIds.has(1)}
              label={t("ai_generator_remember_settings")}
              savingLabel={t("ai_generator_preferences_saving")}
              blockTitle={t("ai_generator_group_creation_title")}
              onChange={(checked) => handleRememberPreference(1, checked)}
            />
          </div>
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
                      setIdentityConsent(false);
                      setKind(option);
                    }}
                  >
                    <span aria-hidden="true">{option === "image" ? "✦" : "▶"}</span>
                    <strong>{t(option === "image" ? "image_50e19fda" : "video_304f6ca4")}</strong>
                    <small>
                      {t(
                        option === "image"
                          ? "ai_generator_kind_image_hint"
                          : videoCharacterMode === "reference_team"
                            ? "ai_generator_kind_video_hint_team"
                            : "ai_generator_kind_video_hint",
                      )}
                    </small>
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
              <div className={styles.aiInstructionField}>
                <label htmlFor="ai-media-instruction">
                  {t("ai_generator_instruction_label")}
                  <small>{t("ai_generator_instruction_optional")}</small>
                </label>
                <textarea
                  id="ai-media-instruction"
                  value={aiInstruction}
                  onChange={(event) => {
                    setAiInstruction(event.target.value);
                    if (actionError || error) clearTransientState();
                  }}
                  placeholder={t("ai_generator_instruction_placeholder")}
                  maxLength={600}
                  disabled={operationLocked}
                  rows={2}
                  aria-describedby="ai-media-instruction-hint"
                />
                <span id="ai-media-instruction-hint">
                  {t("ai_generator_instruction_hint")}
                  {aiInstruction.length ? ` · ${aiInstruction.length}/600` : ""}
                </span>
              </div>
            </div>
          </div> : null}
        </section>

        <section className={`${styles.criteriaSection} ${styles.collapsibleSection} ${styles.contentCriteriaSection}`}>
          <div className={styles.collapsibleHeader}>
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
            <RememberPreferenceControl
              checked={savedPreferences.blocks[2].saved}
              disabled={preferencesLoading || savingBlockIds.has(2)}
              saving={savingBlockIds.has(2)}
              label={t("ai_generator_remember_settings")}
              savingLabel={t("ai_generator_preferences_saving")}
              blockTitle={t("ai_generator_group_content_title")}
              onChange={(checked) => handleRememberPreference(2, checked)}
            />
          </div>
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
          <div className={styles.collapsibleHeader}>
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
              <span className={styles.sectionSelection}>
                {t(`ai_generator_style_${visualStyle}`)} · {t(`ai_generator_creativity_${creativity}`)} · {t(`ai_generator_logo_${logoMode}`)}
              </span>
              <i aria-hidden="true">⌄</i>
            </button>
            <RememberPreferenceControl
              checked={savedPreferences.blocks[3].saved}
              disabled={preferencesLoading || savingBlockIds.has(3)}
              saving={savingBlockIds.has(3)}
              label={t("ai_generator_remember_settings")}
              savingLabel={t("ai_generator_preferences_saving")}
              blockTitle={t("ai_generator_group_art_title")}
              onChange={(checked) => handleRememberPreference(3, checked)}
            />
          </div>
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

        <section className={`${styles.criteriaSection} ${styles.collapsibleSection}`}>
          <div className={styles.collapsibleHeader}>
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
            <RememberPreferenceControl
              checked={savedPreferences.blocks[4].saved}
              disabled={preferencesLoading || savingBlockIds.has(4)}
              saving={savingBlockIds.has(4)}
              label={t("ai_generator_remember_settings")}
              savingLabel={t("ai_generator_preferences_saving")}
              blockTitle={t("ai_generator_group_composition_title")}
              onChange={(checked) => handleRememberPreference(4, checked)}
            />
          </div>
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
          <div className={styles.collapsibleHeader}>
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
                {peopleMode !== "none" ? (
                  <>
                    {t(`ai_generator_video_character_${videoCharacterMode}`)} · {inspirationImages.length
                      ? t("ai_generator_reference_summary", { count: inspirationImages.length })
                      : t(`ai_generator_people_${peopleMode}`)}
                  </>
                ) : t(`ai_generator_people_${peopleMode}`)}
              </span>
              <i aria-hidden="true">⌄</i>
            </button>
            <RememberPreferenceControl
              checked={savedPreferences.blocks[5].saved}
              disabled={preferencesLoading || savingBlockIds.has(5)}
              saving={savingBlockIds.has(5)}
              label={t("ai_generator_remember_settings")}
              savingLabel={t("ai_generator_preferences_saving")}
              blockTitle={t("ai_generator_group_identity_title")}
              onChange={(checked) => handleRememberPreference(5, checked)}
            />
          </div>
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
                    onClick={() => {
                      setPeopleMode(option);
                      if (option === "none") {
                        setVideoCharacterMode("auto");
                        setIdentityConsent(false);
                        setInspirationImages([]);
                        identityReferenceSetIdRef.current = createIdentityReferenceSetId();
                      } else if (
                        videoCharacterMode === "reference_team" &&
                        option !== "team"
                      ) {
                        setVideoCharacterMode("auto");
                        setIdentityConsent(false);
                      }
                    }}
                    disabled={operationLocked}
                  >
                    {t(`ai_generator_people_${option}`)}
                  </button>
                ))}
              </div>
            </div>
            {peopleMode !== "none" ? (
              <>
                <div className={styles.parameterGroup}>
                  <span>{t("ai_generator_video_character_label")}</span>
                  <div className={`${styles.parameterChoices} ${styles.identityModeChoices}`} role="radiogroup" aria-label={t("ai_generator_video_character_label")}>
                    {VIDEO_CHARACTER_MODES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={videoCharacterMode === option}
                        className={videoCharacterMode === option ? styles.compactChoiceActive : ""}
                        onClick={() => {
                          setVideoCharacterMode(option);
                          if (option === "reference_team") setPeopleMode("team");
                          setIdentityConsent(false);
                          if (actionError || error) clearTransientState();
                        }}
                        disabled={operationLocked}
                      >
                        {t(`ai_generator_video_character_${option}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.inspirationSection}>
                  <strong className={styles.combinedSectionTitle}>
                    {t(
                      videoCharacterMode === "professional"
                        ? "ai_generator_professional_photos_title"
                        : videoCharacterMode === "brand_avatar"
                          ? "ai_generator_avatar_reference_title"
                          : videoCharacterMode === "reference_team"
                            ? "ai_generator_reference_team_title"
                          : kind === "video"
                            ? "ai_generator_media_to_animate_title"
                            : "ai_generator_identity_reference_title",
                    )}
                  </strong>
                  <p>
                    {t(
                      videoCharacterMode === "professional"
                        ? "ai_generator_reference_professional_hint"
                        : videoCharacterMode === "brand_avatar"
                          ? "ai_generator_reference_avatar_hint"
                          : videoCharacterMode === "reference_team"
                            ? "ai_generator_reference_team_hint"
                          : "ai_generator_reference_generic_hint",
                    )}
                  </p>
                  {inspirationImages.length ? (
                    <div className={styles.inspirationPreviews}>
                      {inspirationImages.map((image, index) => (
                        <div key={`${image.name}-${index}`} className={styles.inspirationPreview}>
                          <img src={`data:${image.mimeType};base64,${image.data}`} alt="" />
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
                              identityReferenceSetIdRef.current = createIdentityReferenceSetId();
                              setIdentityConsent(false);
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
                        <small>{inspirationImages.length} / {MAX_INSPIRATION_IMAGES}</small>
                        <input
                          type="file"
                          multiple
                          accept="image/jpeg,image/png,image/webp"
                          disabled={operationLocked}
                          onChange={(event) => {
                            const remaining = MAX_INSPIRATION_IMAGES - inspirationImages.length;
                            const files = Array.from(event.currentTarget.files || []).slice(0, remaining);
                            event.currentTarget.value = "";
                            if (!files.length) return;
                            setInspirationBusy(true);
                            setActionError("");
                            void Promise.all(files.map(prepareInspirationImage))
                              .then((prepared) => {
                                setInspirationImages((current) =>
                                  [...current, ...prepared].slice(0, MAX_INSPIRATION_IMAGES),
                                );
                                identityReferenceSetIdRef.current = createIdentityReferenceSetId();
                                setIdentityConsent(false);
                              })
                              .catch((caught) =>
                                setActionError(
                                  caught instanceof Error ? caught.message : t("ai_generator_error"),
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
                  {characterReferenceMissing ? (
                    <p className={styles.identityRequirement} role="alert">
                      {t(
                        videoCharacterMode === "reference_team"
                          ? "ai_generator_video_character_reference_team_required"
                          : videoCharacterMode === "brand_avatar"
                            ? "ai_generator_video_character_avatar_reference_required"
                            : "ai_generator_video_character_professional_photo_required",
                      )}
                    </p>
                  ) : null}
                  {identityConsentRequired ? (
                    <label className={styles.identityConsent}>
                      <input
                        type="checkbox"
                        checked={identityConsent}
                        disabled={operationLocked}
                        onChange={(event) => {
                          setIdentityConsent(event.target.checked);
                          if (actionError || error) clearTransientState();
                        }}
                      />
                      <span>
                        <strong>
                          {t(
                            videoCharacterMode === "reference_team"
                              ? "ai_generator_reference_team_consent_label"
                              : "ai_generator_video_character_consent_label",
                          )}
                        </strong>
                        <small>
                          {t(
                            videoCharacterMode === "reference_team" && kind === "video"
                              ? "ai_generator_identity_consent_hint_team_video"
                              : kind === "image"
                              ? "ai_generator_identity_consent_hint_image"
                              : "ai_generator_identity_consent_hint_video",
                          )}
                        </small>
                      </span>
                    </label>
                  ) : null}
                  {identityConsentMissing ? (
                    <p className={styles.identityRequirement} role="alert">
                      {t("ai_generator_video_character_consent_required")}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
          </div> : null}
        </section>

        <section className={`${styles.criteriaSection} ${styles.optionsSection} ${styles.collapsibleSection}`}>
          <div className={styles.collapsibleHeader}>
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
                      narration: withNarration
                        ? `${t("ai_generator_with_narration")} · ${t(`ai_generator_narration_voice_${narrationVoice}`)}`
                        : t("ai_generator_without_narration"),
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
            <RememberPreferenceControl
              checked={savedPreferences.blocks[6].saved}
              disabled={preferencesLoading || savingBlockIds.has(6)}
              saving={savingBlockIds.has(6)}
              label={t("ai_generator_remember_settings")}
              savingLabel={t("ai_generator_preferences_saving")}
              blockTitle={t("ai_generator_group_finish_title")}
              onChange={(checked) => handleRememberPreference(6, checked)}
            />
          </div>
          {expandedStep === 6 ? <div className={styles.collapsibleBody}>
            {kind === "video" ? (
              <div className={styles.durationChoices} role="radiogroup" aria-label={t("ai_generator_duration_title")}>
                {([8, 16, 24] as const).map((duration) => {
                  const premiumLocked = duration > videoMaxDurationSeconds;
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
            {videoDurationRestricted ? (
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
              <div className={styles.narrationControl}>
                <label className={styles.switchRow}>
                  <span>
                    <strong>{t("ai_generator_narration")}</strong>
                    <small>{t("ai_generator_narration_hint")}</small>
                  </span>
                  <input type="checkbox" checked={withNarration} onChange={(event) => setWithNarration(event.target.checked)} />
                  <i aria-hidden="true" />
                </label>
                {withNarration ? (
                  <div className={styles.narrationVoicePicker}>
                    <span>{t("ai_generator_narration_voice_label")}</span>
                    <div
                      className={`${styles.parameterChoices} ${styles.twoChoices}`}
                      role="radiogroup"
                      aria-label={t("ai_generator_narration_voice_label")}
                    >
                      {(["female", "male"] as const).map((voice) => (
                        <button
                          key={voice}
                          type="button"
                          role="radio"
                          aria-checked={narrationVoice === voice}
                          className={narrationVoice === voice ? styles.compactChoiceActive : ""}
                          onClick={() => setNarrationVoice(voice)}
                          disabled={operationLocked}
                        >
                          {voice === "female"
                            ? t("ai_generator_narration_voice_female")
                            : t("ai_generator_narration_voice_male")}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
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

      {preferencesError ? (
        <div className={styles.preferencesError} role="alert">
          {t(
            preferencesError === "load"
              ? "ai_generator_preferences_load_error"
              : "ai_generator_preferences_save_error",
          )}
        </div>
      ) : null}

      {videoPremiumRequired ? (
        <div className={styles.warning} role="status">
          {t("ai_generator_video_premium_required")}
        </div>
      ) : exhausted ? (
        <div className={styles.warning} role="status">{t("ai_generator_quota_reached")}</div>
      ) : null}
      {actionError || error ? <div className={styles.error} role="alert">{actionError || error}</div> : null}

      <div className={styles.footerBar} data-kind={kind}>
        <div className={styles.quotaCard} data-kind={kind}>
          <span className={styles.quotaIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M4.6 15.8a8 8 0 1 1 14.8 0" />
              <path d="M12 12l4.2-3.1" />
              <circle cx="12" cy="12" r="1.45" />
            </svg>
          </span>
          <div className={styles.quotaCopy}>
            <div className={styles.quotaHeadline}>
              <span>{t(kind === "image" ? "ai_generator_image_quota" : "ai_generator_video_quota")}</span>
              <strong>{quotaValue}</strong>
            </div>
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
        </div>
        {kind === "video" ? (
          <div className={styles.footerEnginePicker}>
            <span>{t("ai_generator_video_engine_title")}</span>
            <div
              className={styles.footerEngineChoices}
              role="radiogroup"
              aria-label={t("ai_generator_video_engine_title")}
            >
              {(["omni", "veo"] as const).map((engine) => (
                <button
                  key={engine}
                  type="button"
                  role="radio"
                  aria-checked={videoEngine === engine}
                  data-active={videoEngine === engine}
                  onClick={() => setVideoEngine(engine)}
                  disabled={operationLocked}
                  title={t(`ai_generator_video_engine_${engine}_hint`)}
                >
                  <span aria-hidden="true">{engine === "omni" ? "⚡" : "✦"}</span>
                  <strong>{t(`ai_generator_video_engine_${engine}`)}</strong>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <button type="button" className={styles.generateButton} disabled={disabled} onClick={() => void handleGenerate()}>
          <span aria-hidden="true">✦</span>
          <strong>{t(kind === "image" ? "ai_generator_generate_image" : "ai_generator_generate_video")}</strong>
        </button>
      </div>

    </div>
  );
}
