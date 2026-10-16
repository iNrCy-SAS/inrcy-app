"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import useMediaGeneration, {
  MediaGenerationAccountChangedError,
  MediaGenerationCancelledError,
  type MediaGenerationFormat,
  type MediaGenerationInspirationImage,
  type MediaGenerationKind,
  type MediaGenerationNarrationVoice,
  type MediaGenerationNarrationVoiceVariant,
  type MediaGenerationReferenceRole,
  type MediaGenerationReferenceUsage,
  type MediaGenerationResult,
  type MediaGenerationSource,
  type MediaGenerationTeamVideoSpeechMode,
  type MediaGenerationVideoDuration,
  type MediaGenerationVideoSceneMode,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import {
  AI_MEDIA_FREE_PROMPT_MAX_CHARS,
  AI_MEDIA_INSPIRATION_MAX_COUNT,
} from "@/lib/aiMediaGenerationContracts";
import {
  AI_MEDIA_NARRATION_VOICE_VARIANTS,
  defaultAiMediaNarrationVoiceVariant,
} from "@/lib/aiMediaNarrationVoices";
import {
  INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS,
  INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS,
  INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES,
  isInrMediaVideoFile,
} from "@/lib/mediaRules";
import {
  prepareMediaGenerationImageReference,
  prepareVideoReferenceFrame,
} from "@/lib/mediaGenerationReferenceClient";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "./MediaLibraryPickerModal";
import MediaSubjectVoiceButton from "./MediaSubjectVoiceButton";
import MediaPromptHelp from "./MediaPromptHelp";
import MediaGenerationCreationWorkspace, { MediaGenerationSettingsTabs } from "./MediaGenerationCreationWorkspace";
import editorStyles from "./MediaGenerationCreationWorkspace.module.css";
import MediaQuotaSummary from "./MediaQuotaSummary";
import useMediaEnginePreference from "../_hooks/useMediaEnginePreference";
import useMediaCreditQuote from "../_hooks/useMediaCreditQuote";
import MediaEngineCreditControls, { isMediaVideoReferenceCompatible, MediaCreditQuoteSummary, MediaRecoveredCreditSummary, MediaGenerationActions } from "./MediaEngineCreditControls";
import { getAiMediaImageModel, getAiMediaVideoModel, isAiMediaImageModelCompatible } from "@/lib/aiMediaModelCatalog";
import { canGenerateAiMediaVideoDuration } from "@/lib/aiMediaVideoTimeline";
import { getMediaVideoDurationChoices, isMediaVideoBriefCompatible } from "@/lib/aiMediaVideoClientOptions";
import { recommendAiMediaModel } from "@/lib/aiMediaModelRecommendation";
import styles from "./MediaFreeGenerator.module.css";

type Props = {
  source: MediaGenerationSource;
  acceptMode: "library" | "insert";
  mediaType?: MediaGenerationKind;
  imageOnly?: boolean;
  initialPrompt?: string;
  requiredPromptSuffix?: string;
  fixedFormat?: MediaGenerationFormat;
  onAccepted: (result: MediaGenerationResult) => void | Promise<void>;
  onResultChange?: (result: MediaGenerationResult | null) => void;
  onBusyChange?: (busy: boolean) => void;
  /** Select the owning panel before recovering; changing it afterwards hides its result. */
  onRecoveryKind?: (kind: MediaGenerationKind) => void;
  onReset?: () => void;
};

type Reference = Omit<
  MediaGenerationInspirationImage,
  "role" | "usage"
> & {
  id: string;
  /** Chosen explicitly by the professional before the request is sent. */
  role?: MediaGenerationReferenceRole;
  /** A reference can be authoritative or only steer the creative direction. */
  usage?: MediaGenerationReferenceUsage;
  fromVideo: boolean;
};

const MAX_PROMPT = AI_MEDIA_FREE_PROMPT_MAX_CHARS;
const FORMATS: { id: MediaGenerationFormat; ratio: string }[] = [
  { id: "square", ratio: "1:1" },
  { id: "portrait", ratio: "4:5" },
  { id: "story", ratio: "9:16" },
  { id: "landscape", ratio: "16:9" },
];
const ROLES = ["character", "environment", "product", "inspiration"] as const;
const IMAGE_ACCEPT = [
  ...INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  ...INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");
const VIDEO_ACCEPT = [
  IMAGE_ACCEPT,
  ...INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES,
  ...INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

function referencesForRequest(references: Reference[]) {
  let characterIndex = 0;
  return references.map(({ id: _id, fromVideo: _fromVideo, ...reference }) => {
    if (reference.role !== "character" || reference.usage !== "required") {
      return reference;
    }
    characterIndex += 1;
    return { ...reference, characterIndex: characterIndex as 1 | 2 | 3 };
  });
}

/** Free creation owns its state and never reads the guided generator's defaults. */
export default function MediaFreeGenerator({
  source,
  acceptMode,
  mediaType = "image",
  imageOnly = false,
  initialPrompt = "",
  requiredPromptSuffix = "",
  fixedFormat,
  onAccepted,
  onResultChange,
  onBusyChange,
  onRecoveryKind,
  onReset,
}: Props) {
  const t = useTranslations("media");
  const locale = useLocale();
  const instanceId = useId();
  const kind = mediaType;
  const {
    quota,
    quotaLoading,
    busy,
    progress,
    error,
    result,
    originChangedNotice,
    cancellable,
    cancellationPending,
    canRecover,
    recoveryContext,
    loadQuota,
    generate,
    retryRecovery,
    cancelRecovery,
    cancelGeneration,
    acceptDraft,
    discardDraft,
    reset,
  } = useMediaGeneration();
  const recoveryIncompatible = Boolean(recoveryContext && ((imageOnly && recoveryContext.kind !== "image") || (fixedFormat && recoveryContext.format !== fixedFormat)));
  const recoveredFormat = result?.recovered ? result.format : recoveryContext?.format;
  const enginePreference = useMediaEnginePreference(quota?.accountId);
  const imageModel = getAiMediaImageModel(enginePreference.imageEngine);
  const videoModel = getAiMediaVideoModel(enginePreference.videoEngine);
  const videoResolution = videoModel.resolutions.includes(enginePreference.videoResolution)
    ? enginePreference.videoResolution : videoModel.defaultResolution;
  const [prompt, setPrompt] = useState(initialPrompt);
  const [useBusinessDna, setUseBusinessDna] = useState(false);
  const [format, setFormat] = useState<MediaGenerationFormat>(
    fixedFormat || (kind === "video" ? "story" : "square")
  );
  const [duration, setDuration] = useState<MediaGenerationVideoDuration>(8);
  const [sceneMode, setSceneMode] = useState<MediaGenerationVideoSceneMode>("single");
  const [references, setReferences] = useState<Reference[]>([]);
  const [withMusic, setWithMusic] = useState(true);
  const [speechMode, setSpeechMode] =
    useState<"voiceover" | "characters" | "silent">("voiceover");
  const [voice, setVoice] = useState<MediaGenerationNarrationVoice>("female");
  const [voiceVariant, setVoiceVariant] =
    useState<MediaGenerationNarrationVoiceVariant>("Kore");
  const [identityConsent, setIdentityConsent] = useState(false);
  const [teamConsent, setTeamConsent] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [referencesBusy, setReferencesBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [creationScreen, setCreationScreen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState("prompt");
  const [editingRecoveredId, setEditingRecoveredId] = useState<string | null>(null);
  const reviewingRecovery = Boolean(recoveryContext || canRecover || (result?.recovered && editingRecoveredId !== result.item.id));
  const [activeAttempt, setActiveAttempt] = useState<{ kind: MediaGenerationKind; format: MediaGenerationFormat; durationSeconds: number } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const sequence = useRef(0);
  const operationInFlight = useRef(false);
  const referenceSetId = useRef("");
  const operationLocked = busy || finishing || voiceBusy || referencesBusy;
  const locked = operationLocked;
  const counter = quota?.credits;
  const maxDuration = quota?.videoMaxDurationSeconds ?? 30;
  const durations = getMediaVideoDurationChoices(maxDuration);
  const exhausted = !quota?.unlimited && counter?.remaining === 0;
  const personReferences = references.filter(
    (reference) =>
      reference.role === "character" && reference.usage === "required"
  );
  const identityRequired = personReferences.length > 0;
  const teamConsentRequired = kind === "video" && personReferences.length > 1;
  const effectiveWithNarration =
    kind === "video" && speechMode === "voiceover";
  const requestSpeechMode: MediaGenerationTeamVideoSpeechMode =
    speechMode === "characters" ? "characters" : "voiceover";
  const referenceCriteriaIncomplete = references.some(
    (reference) => !reference.role || !reference.usage
  );
  // Exact identity preservation is limited to three people. Inspiration-only
  // images and all other roles can freely share the five available slots.
  const roleLimitExceeded = personReferences.length > 3;
  const maxUserPromptLength = Math.max(0, MAX_PROMPT - (requiredPromptSuffix ? requiredPromptSuffix.length + 1 : 0));
  const effectivePrompt = [prompt.trim(), requiredPromptSuffix.trim()].filter(Boolean).join(" ");
  const durationUnavailable = kind === "video" && (!durations.includes(duration) || !canGenerateAiMediaVideoDuration(enginePreference.videoEngine, duration, videoResolution, sceneMode));
  const referenceCompatible = kind === "video" ? isMediaVideoReferenceCompatible(enginePreference.videoEngine, references.length) : isAiMediaImageModelCompatible({ engine: enginePreference.imageEngine, operation: "generate", inspirationImagesCount: references.length });
  const briefCompatible = kind !== "video" || isMediaVideoBriefCompatible(enginePreference.videoEngine, effectivePrompt);
  const promptReady = prompt.trim().length >= 3 && prompt.length <= maxUserPromptLength;
  const promptWarning = operationLocked ? "" : !promptReady
    ? t("ai_generator_idea_required")
    : !briefCompatible ? t("ai_generator_engine_brief_too_long") : "";
  const referenceCompatibilityReason = kind === "video"
    ? references.length === 0 && !videoModel.supportsTextToVideo
      ? t("ai_generator_model_photo_required")
      : !videoModel.supportsImageToVideo
        ? t("ai_generator_model_text_only")
        : t("ai_generator_model_reference_limit", { count: videoModel.maxReferenceImages })
    : references.length > imageModel.maxReferenceImages && imageModel.supportsReferences
      ? t("ai_generator_model_reference_limit", { count: imageModel.maxReferenceImages })
      : t("ai_generator_image_references_unavailable");
  const criteriaWarning = operationLocked ? "" : !referenceCompatible
    ? referenceCompatibilityReason
    : referenceCriteriaIncomplete ? t("ai_generator_free_reference_criteria_required")
    : roleLimitExceeded ? t("ai_generator_free_role_limit")
    : identityRequired && !identityConsent ? t("ai_generator_video_character_consent_required")
    : teamConsentRequired && !teamConsent ? t("ai_generator_team_video_consent_required") : "";
  const photoRequiredHint = kind === "video" && !videoModel.supportsTextToVideo
    ? t("ai_generator_model_photo_required") : "";
  const creditQuote = useMediaCreditQuote({ kind, format: fixedFormat || format, operation: "generate", creationMode: "free",
    inputMode: "essential", identityMode: personReferences.length > 1 ? "reference_team" : identityRequired ? "professional" : "auto",
    videoEngine: enginePreference.videoEngine, imageEngine: enginePreference.imageEngine,
    videoResolution, durationSeconds: kind === "video" ? duration : undefined,
    sceneMode: kind === "video" ? sceneMode : undefined,
    inspirationImagesCount: references.length, withNarration: effectiveWithNarration,
    teamVideoSpeechMode: requestSpeechMode,
  }, quota, !durationUnavailable && referenceCompatible && briefCompatible);
  const creditInsufficient = creditQuote.insufficient;
  const modelRecommendation = recommendAiMediaModel({ kind, format: fixedFormat || format, operation: "generate", brief: effectivePrompt,
    durationSeconds: duration, sceneMode, withNarration: effectiveWithNarration,
    teamVideoSpeechMode: requestSpeechMode, language: locale, inspirationImagesCount: references.length,
    inputMode: "essential", identityMode: personReferences.length > 1 ? "reference_team" : identityRequired ? "professional" : "auto" });
  const canGenerate =
    !operationLocked &&
    !reviewingRecovery &&
    promptReady &&
    Boolean(quota) &&
    !quotaLoading &&
    quota?.studioEnabled !== false &&
    !exhausted &&
    !durationUnavailable &&
    !creditInsufficient &&
    creditQuote.ready &&
    referenceCompatible &&
    briefCompatible &&
    !referenceCriteriaIncomplete &&
    !roleLimitExceeded &&
    (!identityRequired || identityConsent) &&
    (!teamConsentRequired || teamConsent);
  const resetDate =
    quota?.resetAt && !Number.isNaN(Date.parse(quota.resetAt))
      ? new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "long",
        }).format(new Date(quota.resetAt))
      : "";

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  useLayoutEffect(() => {
    onBusyChange?.(operationLocked);
    return () => onBusyChange?.(false);
  }, [onBusyChange, operationLocked]);

  useLayoutEffect(() => {
    onResultChange?.(result);
  }, [onResultChange, result]);

  useLayoutEffect(() => {
    if (recoveryIncompatible) return;
    if (recoveredFormat) setFormat(recoveredFormat);
    if (recoveryContext && recoveryContext.kind !== mediaType) onRecoveryKind?.(recoveryContext.kind);
  }, [recoveredFormat, recoveryContext, recoveryIncompatible, mediaType, onRecoveryKind]);

  useEffect(() => {
    const clearAccountState = () => {
      sequence.current += 1;
      setPrompt("");
      setUseBusinessDna(false);
      setReferences([]);
      setFormat(fixedFormat || (kind === "video" ? "story" : "square"));
      setDuration(8);
      setSceneMode("single");
      setWithMusic(true);
      setSpeechMode("voiceover");
      setVoice("female");
      setVoiceVariant("Kore");
      setIdentityConsent(false);
      setTeamConsent(false);
      setLibraryOpen(false);
      setStopConfirmOpen(false);
      setActionError("");
      setReferencesBusy(false);
      setFinishing(false);
      setSavingToLibrary(false);
      setCreationScreen(false);
      operationInFlight.current = false;
      referenceSetId.current = "";
    };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, clearAccountState);
    return () => {
      sequence.current += 1;
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, clearAccountState);
    };
  }, [fixedFormat, kind]);

  const resetConsent = () => {
    setIdentityConsent(false);
    setTeamConsent(false);
    referenceSetId.current = globalThis.crypto.randomUUID();
  };

  const addFiles = async (files: File[], lockOwned = false) => {
    if (!lockOwned && (locked || operationInFlight.current)) return;
    const currentSequence = sequence.current;
    operationInFlight.current = true;
    setReferencesBusy(true);
    setActionError("");
    try {
      const prepared: Reference[] = [];
      for (const file of files.slice(
        0,
        AI_MEDIA_INSPIRATION_MAX_COUNT - references.length
      )) {
        const fromVideo = kind === "video" && isInrMediaVideoFile(file);
        const image = fromVideo
          ? await prepareVideoReferenceFrame(file)
          : await prepareMediaGenerationImageReference(file);
        if (sequence.current !== currentSequence) return;
        prepared.push({
          ...image,
          id: globalThis.crypto.randomUUID(),
          role: undefined,
          usage: undefined,
          fromVideo,
        });
      }
      setReferences((current) =>
        [...current, ...prepared].slice(0, AI_MEDIA_INSPIRATION_MAX_COUNT)
      );
      resetConsent();
    } catch (caught) {
      if (sequence.current === currentSequence)
        setActionError(
          caught instanceof Error
            ? caught.message
            : t("ai_generator_free_refs_error")
        );
    } finally {
      if (sequence.current === currentSequence) {
        setReferencesBusy(false);
        operationInFlight.current = false;
      }
    }
  };

  const addLibraryFiles = async (items: MediaLibraryPickerItem[]) => {
    if (locked || operationInFlight.current) return;
    const currentSequence = sequence.current;
    operationInFlight.current = true;
    setReferencesBusy(true);
    setActionError("");
    try {
      const files = await Promise.all(
        items
          .slice(0, AI_MEDIA_INSPIRATION_MAX_COUNT - references.length)
          .map(async (item) => {
            if (!item.signed_url)
              throw new Error(
                t("ai_generator_inspiration_library_unavailable")
              );
            const response = await fetch(item.signed_url, {
              cache: "no-store",
            });
            if (!response.ok)
              throw new Error(
                t("ai_generator_inspiration_library_unavailable")
              );
            const blob = await response.blob();
            return new File(
              [blob],
              item.original_file_name ||
                item.title ||
                (item.media_type === "video"
                  ? "reference.mp4"
                  : "reference.jpg"),
              {
                type:
                  blob.type ||
                  item.mime_type ||
                  (item.media_type === "video" ? "video/mp4" : "image/jpeg"),
              }
            );
          })
      );
      if (sequence.current !== currentSequence) return;
      await addFiles(files, true);
      if (sequence.current !== currentSequence) return;
      setLibraryOpen(false);
    } catch (caught) {
      if (sequence.current === currentSequence)
        setActionError(
          caught instanceof Error
            ? caught.message
            : t("ai_generator_free_refs_error")
        );
    } finally {
      if (sequence.current === currentSequence) {
        setReferencesBusy(false);
        operationInFlight.current = false;
      }
    }
  };

  const updateReference = (
    id: string,
    patch: Partial<Pick<Reference, "role" | "usage">>
  ) => {
    setReferences((current) =>
      current.map((reference) =>
        reference.id !== id
          ? reference
          : {
              ...reference,
              ...patch,
              // A usage belongs to a role. Clearing it avoids carrying an
              // authoritative choice from a product or person onto another role.
              ...(Object.hasOwn(patch, "role") && patch.role !== reference.role
                ? { usage: undefined }
                : {}),
            }
      )
    );
    resetConsent();
  };

  const handleGenerate = async () => {
    if (!canGenerate || operationInFlight.current) return;
    operationInFlight.current = true;
    const currentSequence = sequence.current;
    let retryableFailure = false;
    setActionError("");
    setFinishing(true);
    setCreationScreen(true);
    setActiveAttempt({ kind, format: fixedFormat || format, durationSeconds: duration });
    try {
      if (result?.draft) await discardDraft(result);
      if (sequence.current !== currentSequence) return;
      setStopConfirmOpen(false);
      await generate({
        ...creditQuote.authorization,
        imageEngine: enginePreference.imageEngine,
        videoResolution,
        operation: "generate",
        creationMode: "free",
        freePrompt: effectivePrompt,
        useBusinessDna,
        inputMode: "essential",
        source,
        kind,
        subjectSource: "custom",
        idea: effectivePrompt,
        format: fixedFormat || format,
        durationSeconds: kind === "video" ? duration : undefined,
        sceneMode: kind === "video" ? sceneMode : undefined,
        withMusic: kind === "video" && withMusic,
        withNarration: effectiveWithNarration,
        narrationVoice: effectiveWithNarration ? voice : undefined,
        narrationVoiceVariant:
          effectiveWithNarration ? voiceVariant : undefined,
        videoEngine: enginePreference.videoEngine,
        teamVideoSpeechMode: kind === "video" ? requestSpeechMode : undefined,
        teamVideoMode: "cinematic",
        inspirationImages: referencesForRequest(references),
        identityMode:
          personReferences.length > 1
            ? "reference_team"
            : identityRequired
            ? "professional"
            : "auto",
        identityConsent: identityRequired && identityConsent,
        teamVideoVeoConsent: videoModel.provider === "google" && teamConsentRequired && teamConsent,
        teamVideoProviderConsent: teamConsentRequired && teamConsent ? enginePreference.videoEngine : undefined,
        identityReferenceSetId: references.length
          ? referenceSetId.current || undefined
          : undefined,
        // Compatibility-only values: the free server branch builds its own creative plan.
        textKeywords: [],
        imageStyle: "photo",
        peopleMode: "auto",
        useBrandColors: false,
        logoMode: "none",
      });
    } catch (caught) {
      if (sequence.current !== currentSequence) return;
      if (
        !(caught instanceof MediaGenerationAccountChangedError) &&
        !(caught instanceof MediaGenerationCancelledError)
      ) {
        retryableFailure = true;
        setActionError(
          caught instanceof Error ? caught.message : t("ai_generator_error")
        );
      }
    } finally {
      if (sequence.current === currentSequence) {
        setFinishing(false);
        // A failed attempt keeps the same references and request on screen.
        // Reuse its explicit authorization for Retry; a successful new
        // creation (or a cancellation) still requires fresh authorization.
        if (!retryableFailure) {
          setIdentityConsent(false);
          setTeamConsent(false);
        }
        operationInFlight.current = false;
      }
    }
  };

  const handleEdit = () => {
    if (operationLocked) return;
    if (result?.recovered) setEditingRecoveredId(result.item.id);
    setActiveSettingsTab("prompt");
    window.requestAnimationFrame(() => document.getElementById(`${instanceId}-prompt`)?.focus());
  };

  const handleRecoverResult = async () => {
    if (!canRecover || recoveryIncompatible || operationLocked || operationInFlight.current) return;
    operationInFlight.current = true;
    const currentSequence = sequence.current;
    setActionError("");
    try {
      await retryRecovery();
    } catch (caught) {
      if (sequence.current === currentSequence && !(caught instanceof MediaGenerationAccountChangedError)) {
        setActionError(caught instanceof Error ? caught.message : t("ai_generator_error"));
      }
    } finally {
      if (sequence.current === currentSequence) operationInFlight.current = false;
    }
  };

  const handleAbandonRecovery = async () => {
    if (!canRecover || recoveryIncompatible || operationLocked || operationInFlight.current) return;
    operationInFlight.current = true;
    const currentSequence = sequence.current;
    setActionError("");
    try {
      const recovered = await cancelRecovery();
      if (sequence.current === currentSequence && !recovered) setCreationScreen(false);
    } catch (caught) {
      if (sequence.current === currentSequence && !(caught instanceof MediaGenerationAccountChangedError)) {
        setActionError(caught instanceof Error ? caught.message : t("ai_generator_error"));
      }
    } finally {
      if (sequence.current === currentSequence) operationInFlight.current = false;
    }
  };

  const handleAccept = async () => {
    if (!result || operationLocked || operationInFlight.current) return;
    operationInFlight.current = true;
    const currentSequence = sequence.current;
    setFinishing(true);
    setActionError("");
    try {
      const accepted = await acceptDraft(result);
      if (sequence.current !== currentSequence) return;
      onResultChange?.(accepted);
      await onAccepted(accepted);
    } catch (caught) {
      if (sequence.current !== currentSequence) return;
      if (!(caught instanceof MediaGenerationAccountChangedError))
        setActionError(
          caught instanceof Error ? caught.message : t("ai_generator_error")
        );
    } finally {
      if (sequence.current === currentSequence) {
        operationInFlight.current = false;
        setFinishing(false);
      }
    }
  };

  const handleSaveToLibrary = async () => {
    if (
      !result ||
      !result.draft ||
      operationLocked ||
      operationInFlight.current
    ) {
      return;
    }
    operationInFlight.current = true;
    const currentSequence = sequence.current;
    setFinishing(true);
    setSavingToLibrary(true);
    setActionError("");
    try {
      const accepted = await acceptDraft(result);
      if (sequence.current !== currentSequence) return;
      onResultChange?.(accepted);
    } catch (caught) {
      if (sequence.current !== currentSequence) return;
      if (!(caught instanceof MediaGenerationAccountChangedError)) {
        setActionError(
          caught instanceof Error ? caught.message : t("ai_generator_error")
        );
      }
    } finally {
      if (sequence.current === currentSequence) {
        operationInFlight.current = false;
        setSavingToLibrary(false);
        setFinishing(false);
      }
    }
  };

  const handleConfirmGenerationStop = () => {
    setStopConfirmOpen(false);
    if (canRecover && !busy) {
      void handleAbandonRecovery();
      return;
    }
    if (cancelGeneration()) {
      setActionError("");
      setCreationScreen(false);
    }
  };

  const engineControls = reviewingRecovery ? null : (
    <MediaEngineCreditControls kind={kind} format={fixedFormat || format} videoEngine={enginePreference.videoEngine}
            imageEngine={enginePreference.imageEngine} resolution={videoResolution}
            durationSeconds={duration} sceneMode={sceneMode} onDurationSceneChange={(seconds, mode) => { setDuration(seconds); setSceneMode(mode); }} videoMaxDurationSeconds={maxDuration}
            recommendation={modelRecommendation}
            brief={effectivePrompt}
            referenceCount={references.length} disabled={locked}
            onVideoEngineChange={(videoEngine, resolution) => { resetConsent(); enginePreference.update({ videoEngine, videoResolution: resolution ?? getAiMediaVideoModel(videoEngine).defaultResolution }); }}
            onImageEngineChange={(imageEngine) => enginePreference.update({ imageEngine })}
            onResolutionChange={(resolution) => enginePreference.update({ videoResolution: resolution })} />
  );
  const creditSummary = reviewingRecovery
    ? <MediaRecoveredCreditSummary creditsUsed={result?.creditsUsed} />
    : <MediaCreditQuoteSummary status={creditQuote} quota={quota} />;

  const generationAction = <button
    type="button" className={styles.primaryButton} data-media-primary-action
    disabled={recoveryIncompatible || (busy ? !cancellable : canRecover ? operationLocked : Boolean(result) || !canGenerate)}
    title={busy && !cancellable ? t("ai_generator_editor_stop_locked") : undefined}
    onClick={() => { if (busy) setStopConfirmOpen(true); else if (canRecover) void handleRecoverResult(); else if (!result) void handleGenerate(); }}
  >
    <span aria-hidden="true">{busy ? "■" : "✦"}</span>
    {t(busy ? "ai_generator_editor_stop" : canRecover ? "ai_generator_editor_recover" : kind === "video" ? "ai_generator_generate_video" : "ai_generator_generate_image")}
  </button>;

  const preview = (
      <MediaGenerationCreationWorkspace
        variant="embedded"
        creationStarted={creationScreen}
        generationInProgress={busy}
        recoveryPending={canRecover}
        cancellationPending={cancellationPending}
        kind={busy && activeAttempt ? activeAttempt.kind : kind}
        format={busy && activeAttempt ? activeAttempt.format : format}
        durationSeconds={busy && activeAttempt ? activeAttempt.durationSeconds : duration}
        origin={source}
        creationMode="free"
        progress={progress}
        operationLocked={operationLocked}
        finishing={finishing}
        generationResult={result}
        generationCancellable={cancellable || (canRecover && !recoveryIncompatible && !operationLocked)}
        cancelConfirmationOpen={stopConfirmOpen}
        setCancelConfirmationOpen={setStopConfirmOpen}
        handleRequestGenerationStop={() => setStopConfirmOpen(true)}
        handleConfirmGenerationStop={handleConfirmGenerationStop}
        handleConfirm={handleAccept}
        handleSaveToLibrary={handleSaveToLibrary}
        handleGenerate={handleGenerate}
        handleEditCriteria={handleEdit}
        handleReset={canRecover ? undefined : onReset}
        disabled={!canGenerate || canRecover}
        creditSummary={creditSummary}
        engineControls={engineControls}
        acceptMode={acceptMode}
        savingToLibrary={savingToLibrary}
        actionError={actionError}
        error={error}
        originChangedNotice={originChangedNotice}
        identityTeam={personReferences.length > 1}
        referenceCinematicRequested={kind === "video" && references.length > 0}
        editLabel={t("ai_generator_free_edit_prompt")}
        regenerationConsents={
          identityRequired
            ? [
                {
                  id: "identity",
                  label: t(
                    personReferences.length > 1
                      ? "ai_generator_reference_team_consent_label"
                      : "ai_generator_video_character_consent_label"
                  ),
                  checked: identityConsent,
                  onChange: (checked) => {
                    setIdentityConsent(checked);
                    setTeamConsent(false);
                  },
                },
                ...(teamConsentRequired
                  ? [{
                      id: "team",
                      label: t("ai_generator_team_video_provider_consent", { provider: videoModel.providerLabel }),
                      checked: teamConsent,
                      onChange: setTeamConsent,
                    }]
                  : []),
              ]
            : undefined
        }
      />
  );

  return (
    <div
      className={styles.workspace}
      data-creation-mode="free"
      data-media-kind={kind}
      data-view="editor"
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return;
        const info = event.currentTarget.querySelector<HTMLElement>(
          "[data-business-dna-info]:popover-open"
        );
        if (!info) return;
        // Close this optional help before Studio's own Escape shortcut runs.
        event.preventDefault();
        event.stopPropagation();
        info.hidePopover();
      }}
    >
      <div className={editorStyles.editorBody}>
        <div className={editorStyles.settingsPane}>
          <MediaGenerationSettingsTabs idPrefix={instanceId} activeTab={activeSettingsTab} onChange={setActiveSettingsTab} tabs={[
            { id: "prompt", label: t("ai_generator_editor_tab_prompt"), warning: promptWarning },
            { id: "criteria", label: t("ai_generator_editor_tab_criteria"), warning: criteriaWarning },
          ]} />
          <div className={editorStyles.settingsPanels}>
        <section
          className={`${styles.parameters} ${editorStyles.tabPanel}`}
          role="tabpanel" id={`${instanceId}-panel-criteria`} aria-labelledby={`${instanceId}-tab-criteria`} hidden={activeSettingsTab !== "criteria"}
        >
          <div className={styles.panelHeading}>
            <span className={styles.panelIcon} aria-hidden="true">
              ◈
            </span>
            <div>
              <h2 id={`${instanceId}-parameters`}>
                {t("ai_generator_free_parameters_title")}
              </h2>
              <p>{t("ai_generator_free_parameters_hint")}</p>
            </div>
          </div>
          <fieldset className={`${styles.fieldset} ${styles.formatFieldset}`} disabled={locked}>
            <legend>{t("ai_generator_free_format_label")}</legend>
            <div className={styles.formatOptions}>
              {FORMATS.filter((option) => !fixedFormat || option.id === fixedFormat).map((option) => (
                <label
                  className={styles.formatOption}
                  data-selected={format === option.id}
                  key={option.id}
                >
                  <input
                    type="radio"
                    name={`${instanceId}-format`}
                    value={option.id}
                    checked={format === option.id}
                    onChange={() => setFormat(option.id)}
                  />
                  <span
                    className={styles.formatIcon}
                    data-format={option.id}
                    aria-hidden="true"
                  />
                  <strong>{t(`ai_generator_format_${option.id}`)}</strong>
                  <small>{option.ratio}</small>
                </label>
              ))}
            </div>
          </fieldset>
          <div className={styles.referencesSection}>
            <div className={styles.sectionHeading}>
              <h3>{t("ai_generator_free_references_title")}</h3>
              {kind !== "video" || videoModel.supportsTextToVideo ? <span>{t("ai_generator_free_optional")}</span> : null}
            </div>
            <p className={styles.muted} role={criteriaWarning && criteriaWarning === photoRequiredHint ? "alert" : undefined}>
              {photoRequiredHint
                ? photoRequiredHint
                : t("ai_generator_free_references_hint", {
                    count: AI_MEDIA_INSPIRATION_MAX_COUNT,
                  })}
            </p>
            <div className={styles.referenceActions}>
              <label
                className={styles.importButton}
                data-disabled={
                  locked ||
                  references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT
                }
              >
                <span aria-hidden="true">＋</span>
                {t("ai_generator_free_import")}
                <input
                  type="file"
                  multiple
                  accept={kind === "video" ? VIDEO_ACCEPT : IMAGE_ACCEPT}
                  disabled={
                    locked ||
                    references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT
                  }
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.currentTarget.value = "";
                    if (files.length) void addFiles(files);
                  }}
                />
              </label>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={
                  locked ||
                  references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT
                }
                onClick={() => setLibraryOpen(true)}
              >
                {t("ai_generator_free_library")}
              </button>
            </div>
            {referencesBusy ? (
              <p className={styles.muted} role="status">
                {t("ai_generator_free_refs_loading")}
              </p>
            ) : null}
            {references.length ? (
              <div className={styles.references}>
                {references.map((reference, index) => (
                  <div className={styles.reference} key={reference.id}>
                    <div className={styles.referenceImage}>
                      <img
                        src={`data:${reference.mimeType};base64,${reference.data}`}
                        alt={t("ai_generator_free_reference", {
                          index: index + 1,
                        })}
                      />
                      <span>{index + 1}</span>
                      <button
                        type="button"
                        aria-label={t(
                          "ai_generator_free_reference_remove",
                          { index: index + 1 }
                        )}
                        disabled={locked}
                        onClick={() => {
                          setReferences((current) =>
                            current.filter(
                              (entry) => entry.id !== reference.id
                            )
                          );
                          resetConsent();
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <small
                      className={styles.fileName}
                      title={reference.name}
                    >
                      {reference.name}
                    </small>
                    <select
                      aria-label={t("ai_generator_free_reference_role", {
                        index: index + 1,
                      })}
                      aria-invalid={!reference.role || undefined}
                      data-incomplete={!reference.role || undefined}
                      value={reference.role ?? ""}
                      disabled={locked}
                      onChange={(event) =>
                        updateReference(reference.id, {
                          role: event.target.value
                            ? (event.target.value as MediaGenerationReferenceRole)
                            : undefined,
                        })
                      }
                    >
                      <option value="" disabled>
                        {t("ai_generator_free_reference_role_placeholder")}
                      </option>
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {t(`ai_generator_free_role_${role}`)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t("ai_generator_free_reference_usage", {
                        index: index + 1,
                      })}
                      aria-invalid={!reference.usage || undefined}
                      data-incomplete={!reference.usage || undefined}
                      value={reference.usage ?? ""}
                      disabled={locked}
                      onChange={(event) =>
                        updateReference(reference.id, {
                          usage: event.target.value
                            ? (event.target.value as MediaGenerationReferenceUsage)
                            : undefined,
                        })
                      }
                    >
                      <option value="" disabled>
                        {t("ai_generator_free_reference_usage_placeholder")}
                      </option>
                      {reference.role !== "inspiration" ? (
                        <option value="required">
                          {t("ai_generator_free_usage_required")}
                        </option>
                      ) : null}
                      <option value="inspiration">
                        {t("ai_generator_free_usage_inspiration")}
                      </option>
                    </select>
                  </div>
                ))}
              </div>
            ) : null}
            {references.some((reference) => reference.fromVideo) ? (
              <p className={styles.muted}>
                {t("ai_generator_free_references_video_hint")}
              </p>
            ) : null}
            {criteriaWarning && criteriaWarning !== photoRequiredHint ? (
              <p className={styles.muted} role="alert">{criteriaWarning}</p>
            ) : null}
          </div>
          {identityRequired ? (
            <label className={styles.consent}>
              <input
                type="checkbox"
                checked={identityConsent}
                disabled={locked}
                onChange={(event) => {
                  setIdentityConsent(event.target.checked);
                  setTeamConsent(false);
                }}
              />
              <span>
                {t(
                  personReferences.length > 1
                    ? "ai_generator_reference_team_consent_label"
                    : "ai_generator_video_character_consent_label"
                )}
              </span>
            </label>
          ) : null}
          {teamConsentRequired ? (
            <label className={styles.consent}>
              <input
                type="checkbox"
                checked={teamConsent}
                disabled={locked}
                onChange={(event) => setTeamConsent(event.target.checked)}
              />
              <span>{t("ai_generator_team_video_provider_consent", { provider: videoModel.providerLabel })}</span>
            </label>
          ) : null}
          {kind === "video" ? (
            <div className={styles.audioSection}>
              <h3>{t("ai_generator_essential_sound_title")}</h3>
              <fieldset className={styles.soundChoices} disabled={locked}>
                <legend className={styles.srOnly}>
                  {t("ai_generator_essential_sound_title")}
                </legend>
                {(["voiceover", "characters", "silent"] as const).map((mode) => (
                  <label
                    className={styles.soundChoice}
                    data-selected={speechMode === mode}
                    key={mode}
                  >
                    <input
                      type="radio"
                      name={`${instanceId}-speech-mode`}
                      value={mode}
                      checked={speechMode === mode}
                      onChange={() => {
                        setSpeechMode(mode);
                        setTeamConsent(false);
                      }}
                    />
                    <span>
                      <strong>
                        {t(`ai_generator_free_audio_${mode}`)}
                      </strong>
                      <small>
                        {t(`ai_generator_free_audio_${mode}_hint`)}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {speechMode === "characters" ? (
                <p className={styles.muted} role="note">
                  {t("ai_generator_essential_character_speech_notice")}
                </p>
              ) : null}
              {effectiveWithNarration ? (
                <div className={styles.voiceOptions}>
                  <label>
                    <span>{t("ai_generator_narration_voice_label")}</span>
                    <select
                      value={voice}
                      disabled={locked}
                      onChange={(event) => {
                        const next = event.target
                          .value as MediaGenerationNarrationVoice;
                        setVoice(next);
                        setVoiceVariant(
                          defaultAiMediaNarrationVoiceVariant(next)
                        );
                      }}
                    >
                      {(["female", "male"] as const).map((gender) => (
                        <option key={gender} value={gender}>
                          {t(`ai_generator_narration_voice_${gender}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>
                      {t("ai_generator_narration_voice_variant_label")}
                    </span>
                    <select
                      value={voiceVariant}
                      disabled={locked}
                      onChange={(event) =>
                        setVoiceVariant(
                          event.target
                            .value as MediaGenerationNarrationVoiceVariant
                        )
                      }
                    >
                      {AI_MEDIA_NARRATION_VOICE_VARIANTS[voice].map(
                        (variant) => (
                          <option key={variant} value={variant}>
                            {t(
                              `ai_generator_narration_voice_variant_${variant.toLowerCase()}`
                            )}
                          </option>
                        )
                      )}
                    </select>
                  </label>
                </div>
              ) : null}
              <label className={styles.musicOption}>
                <input
                  type="checkbox"
                  checked={withMusic}
                  disabled={locked}
                  onChange={(event) => setWithMusic(event.target.checked)}
                />
                <span>{t("ai_generator_free_music")}</span>
              </label>
            </div>
          ) : null}
        </section>
        <section
          className={`${styles.promptPanel} ${editorStyles.tabPanel}`}
          role="tabpanel" id={`${instanceId}-panel-prompt`} aria-labelledby={`${instanceId}-tab-prompt`} hidden={activeSettingsTab !== "prompt"}
        >
          <div className={styles.panelHeading}>
            <span className={styles.promptIcon} aria-hidden="true">
              ✦
            </span>
            <div className={styles.promptHeadingCopy}>
              <div className={styles.promptTitleRow}>
                <h2 id={`${instanceId}-prompt-title`}>
                  {t("ai_generator_free_prompt_title")}
                </h2>
                <MediaPromptHelp kind={kind} />
              </div>
              <p>{t("ai_generator_free_prompt_hint")}</p>
            </div>
          </div>
          <div className={styles.businessDnaRow}>
            <label className={styles.businessDnaOption}>
              <input
                type="checkbox"
                checked={useBusinessDna}
                disabled={operationLocked}
                onChange={(event) => setUseBusinessDna(event.target.checked)}
              />
              <strong>{t("ai_generator_use_business_dna_label")}</strong>
            </label>
            <button
              type="button"
              className={styles.businessDnaInfoButton}
              popoverTarget={`${instanceId}-business-dna-help`}
              aria-haspopup="dialog"
              aria-label={t("ai_generator_use_business_dna_info_label")}
              title={t("ai_generator_use_business_dna_info_label")}
            >
              <span aria-hidden="true">i</span>
            </button>
            <div
              id={`${instanceId}-business-dna-help`}
              popover="auto"
              role="dialog"
              data-business-dna-info
              aria-labelledby={`${instanceId}-business-dna-help-title`}
              className={styles.businessDnaInfo}
              onToggle={(event) => {
                if (event.newState === "open") {
                  event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
                }
              }}
            >
              <header className={styles.businessDnaInfoHeader}>
                <h3 id={`${instanceId}-business-dna-help-title`}>
                  {t("ai_generator_use_business_dna_label")}
                </h3>
                <button
                  type="button"
                  className={styles.businessDnaInfoClose}
                  popoverTarget={`${instanceId}-business-dna-help`}
                  popoverTargetAction="hide"
                  aria-label={t("ai_generator_use_business_dna_info_close")}
                >×</button>
              </header>
              <p>{t("ai_generator_use_business_dna_info_sources")}</p>
              <p>{t("ai_generator_use_business_dna_info_identity")}</p>
              <p>{t("ai_generator_use_business_dna_info_contacts")}</p>
              <p>{t("ai_generator_use_business_dna_info_freedom")}</p>
            </div>
          </div>
          <div className={styles.promptContainer}>
            <label
              className={styles.srOnly}
              htmlFor={`${instanceId}-prompt`}
            >
              {t("ai_generator_free_prompt_label")}
            </label>
            <textarea
              id={`${instanceId}-prompt`}
              value={prompt}
              maxLength={maxUserPromptLength}
              disabled={busy || finishing || referencesBusy}
              readOnly={voiceBusy}
              aria-describedby={`${instanceId}-prompt-help`}
              placeholder={t(
                kind === "video"
                  ? "ai_generator_free_prompt_placeholder_video"
                  : "ai_generator_free_prompt_placeholder_image"
              )}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className={styles.promptToolbar}>
              <span>
                {prompt.length.toLocaleString(locale)} /{" "}
                {maxUserPromptLength.toLocaleString(locale)}
              </span>
              <MediaSubjectVoiceButton
                value={prompt}
                onChange={setPrompt}
                onBusyChange={setVoiceBusy}
                disabled={busy || finishing || referencesBusy}
                maxLength={maxUserPromptLength}
                purpose="instruction"
                contextLabel={t("ai_generator_free_prompt_label")}
                placement="inline"
              />
            </div>
          </div>
          <p id={`${instanceId}-prompt-help`} className={styles.promptHelp}>
            {requiredPromptSuffix ? "Les critères du canal sont ajoutés automatiquement à votre consigne." : t("ai_generator_free_prompt_help")}
          </p>
        </section>
          </div>
        </div>
        <div className={editorStyles.previewPane}>{preview}</div>
      </div>
      <div className={styles.footer} data-media-footer>
        <MediaQuotaSummary kind={kind} counter={counter} unlimited={quota?.unlimited} creditsReady={quota?.creditsReady}
          resetDate={resetDate} locked={locked} onRefresh={() => { void loadQuota({ force: true }); }} />
        <MediaGenerationActions>
          {engineControls}
          {creditSummary}
          {recoveryIncompatible ? <a className={styles.secondaryButton} href="/dashboard/generer-media" data-media-recovery-studio-link>
            {t("ai_generator_editor_recover")} · iNrStudio
          </a> : canRecover && !busy ? <div className={styles.recoveryActions} data-media-recovery-actions>
            {generationAction}
            <button type="button" className={styles.recoveryStop} disabled={operationLocked}
              aria-label={t("ai_generator_editor_abandon")} title={t("ai_generator_editor_abandon")}
              onClick={() => setStopConfirmOpen(true)}>{t("ai_generator_editor_stop")}</button>
          </div> : generationAction}
        </MediaGenerationActions>
      </div>
      {!canRecover && !busy && (exhausted || creditInsufficient || durationUnavailable) ? (
        <p className={styles.error} role="status">
          {t(
            exhausted
              ? "ai_generator_quota_reached"
              : creditInsufficient
              ? "ai_generator_video_credit_insufficient"
              : "ai_generator_model_duration_unavailable",
            { seconds: duration }
          )}
        </p>
      ) : null}
      {!quota && !quotaLoading ? (
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() => void loadQuota({ force: true })}
        >
          {t("ai_generator_free_retry_quota")}
        </button>
      ) : null}
      {originChangedNotice ? (
        <p className={styles.muted} role="status">
          {t("ai_generator_origin_changed")}
        </p>
      ) : null}
      <MediaLibraryPickerModal
        open={libraryOpen}
        title={t("ai_generator_inspiration_library_title")}
        subtitle={t("ai_generator_inspiration_library_subtitle")}
        accept={kind === "video" ? "all" : "image"}
        multiple
        maxSelection={Math.max(
          1,
          AI_MEDIA_INSPIRATION_MAX_COUNT - references.length
        )}
        confirmLabel={t("ai_generator_inspiration_library_confirm")}
        onClose={() => setLibraryOpen(false)}
        onConfirm={addLibraryFiles}
      />
    </div>
  );
}
