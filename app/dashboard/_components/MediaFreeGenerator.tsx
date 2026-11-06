"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useInrAssistantLocalInterface } from "../_hooks/useInrAssistantLocalInterface";
import { parseInrAssistantStudioFormSelection, isInrAssistantStudioFormSelectionApplied, type InrAssistantStudioFormSnapshot } from "@/lib/inrAssistantStudioFormSelection";
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
  AI_MEDIA_INSPIRATION_MAX_COUNT,
} from "@/lib/aiMediaGenerationContracts";
import { detectAiMediaVideoVisualBriefSpeech, getAiMediaVisualBriefMaxChars, getAiMediaVideoSpeechState } from "@/lib/aiMediaVideoSpeechBudget";
import {
  AI_MEDIA_NARRATION_VOICE_VARIANTS,
  defaultAiMediaNarrationVoiceVariant,
} from "@/lib/aiMediaNarrationVoices";
import {
  INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS,
  INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
} from "@/lib/mediaRules";
import {
  prepareMediaGenerationImageReference,
  prepareMediaGenerationLibraryReferenceFile,
} from "@/lib/mediaGenerationReferenceClient";
import { assertStudioInspirationImageMetadata, StudioInspirationImageOnlyError } from "@/lib/studioInspirationImagePolicy";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "./MediaLibraryPickerModal";
import MediaSubjectVoiceButton from "./MediaSubjectVoiceButton";
import MediaCharacterVoiceInput from "./MediaCharacterVoiceInput";
import { deleteCharacterVoiceSample, getCharacterVoiceSelectionState } from "@/lib/aiMediaCharacterVoiceClient";
import { AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES, exceedsAiMediaCharacterVoiceEngineDuration, isAiMediaCharacterVoiceEngine } from "@/lib/aiMediaCharacterVoices";
import MediaPromptHelp from "./MediaPromptHelp";
import MediaGenerationCreationWorkspace, { MediaGenerationSettingsTabs } from "./MediaGenerationCreationWorkspace";
import editorStyles from "./MediaGenerationCreationWorkspace.module.css";
import MediaBusinessDnaHelp from "./MediaBusinessDnaHelp";
import MediaQuotaSummary from "./MediaQuotaSummary";
import useMediaEnginePreference from "../_hooks/useMediaEnginePreference";
import useMediaCreditQuote from "../_hooks/useMediaCreditQuote";
import MediaEngineCreditControls, { isMediaVideoReferenceCompatible, MediaCreditQuoteSummary, MediaRecoveredCreditSummary, MediaGenerationActions } from "./MediaEngineCreditControls";
import { getAiMediaImageModel, getAiMediaVideoModel, getAiMediaVideoModelForCharacterVoice, isAiMediaImageModelCompatible } from "@/lib/aiMediaModelCatalog";
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
  /** Studio shares only this editable brief; media settings and jobs stay local. */
  sharedPrompt?: string;
  onSharedPromptChange?: (prompt: string) => void;
  requiredPromptSuffix?: string;
  fixedFormat?: MediaGenerationFormat;
  onAccepted: (result: MediaGenerationResult) => void | Promise<void>;
  onResultChange?: (result: MediaGenerationResult | null) => void;
  onBusyChange?: (busy: boolean) => void;
  onPendingRecoveryChange?: (pending: boolean) => void;
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

function referencesForRequest(references: Reference[]) {
  let characterIndex = 0;
  return references.map(({ id: _id, fromVideo: _fromVideo, ...reference }) => {
    if (reference.role !== "character" || (reference.usage !== "required" && reference.voiceMode !== "provided")) {
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
  sharedPrompt,
  onSharedPromptChange,
  requiredPromptSuffix = "",
  fixedFormat,
  onAccepted,
  onResultChange,
  onBusyChange,
  onPendingRecoveryChange,
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
    recovering = false,
    canPauseRecovery = false,
    pauseRecovery,
    recoveryContext,
    loadQuota,
    generate,
    retryRecovery,
    cancelRecovery,
    cancelGeneration,
    acceptDraft,
    discardDraft,
  } = useMediaGeneration();
  const recoveryIncompatible = Boolean(recoveryContext && ((imageOnly && recoveryContext.kind !== "image") || (fixedFormat && recoveryContext.format !== fixedFormat)));
  const recoveredFormat = result?.recovered ? result.format : recoveryContext?.format;
  const enginePreference = useMediaEnginePreference(quota?.accountId);
  const imageModel = getAiMediaImageModel(enginePreference.imageEngine);
  const [localPrompt, setLocalPrompt] = useState(initialPrompt);
  const [recoveryAccountChecked, setRecoveryAccountChecked] = useState<string | null>(null);
  const prompt = sharedPrompt ?? localPrompt;
  const setPrompt = useCallback((value: string) => {
    setLocalPrompt(value);
    onSharedPromptChange?.(value);
  }, [onSharedPromptChange]);
  const [spokenScript, setSpokenScript] = useState("");
  const [spokenScriptOpen, setSpokenScriptOpen] = useState(false);
  const explicitlyEmptySpokenScript = kind === "video" && spokenScriptOpen && !spokenScript.trim();
  const [useBusinessDna, setUseBusinessDna] = useState(false);
  const [format, setFormat] = useState<MediaGenerationFormat>(
    fixedFormat || (kind === "video" ? "story" : "square")
  );
  const [duration, setDuration] = useState<MediaGenerationVideoDuration>(8);
  const [sceneMode, setSceneMode] = useState<MediaGenerationVideoSceneMode>("single");
  const [references, setReferences] = useState<Reference[]>([]);
  const [withMusic, setWithMusic] = useState(true);
  const [withSubtitles, setWithSubtitles] = useState(false);
  const [speechMode, setSpeechMode] =
    useState<"voiceover" | "characters" | "silent">("voiceover");
  const [voice, setVoice] = useState<MediaGenerationNarrationVoice>("female");
  const [voiceVariant, setVoiceVariant] =
    useState<MediaGenerationNarrationVoiceVariant>("Kore");
  const [identityConsent, setIdentityConsent] = useState(false);
  const [teamConsent, setTeamConsent] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [characterVoiceBusy, setCharacterVoiceBusy] = useState(false);
  const [referencesBusy, setReferencesBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [creationScreen, setCreationScreen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState("prompt");
  const [editingRecoveredId, setEditingRecoveredId] = useState<string | null>(null);
  const reviewingRecovery = Boolean(recoveryContext || canRecover || (result?.recovered && editingRecoveredId !== result.item.id));
  const recoveryPending = Boolean(canRecover || recovering || recoveryContext);
  const editorAvailable = !reviewingRecovery || recoveryPending;
  const [activeAttempt, setActiveAttempt] = useState<{ kind: MediaGenerationKind; format: MediaGenerationFormat; durationSeconds: number } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [quotaRefreshId, setQuotaRefreshId] = useState(0);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const sequence = useRef(0);
  const operationInFlight = useRef(false);
  const referenceSetId = useRef("");
  const submittedVoicePaths = useRef(new Set<string>());
  const operationLocked = cancellationPending || ((busy || finishing) && !recovering) || voiceBusy || referencesBusy || characterVoiceBusy;
  const locked = operationLocked;
  const releaseUnusedVoiceSample = (sample: Parameters<typeof deleteCharacterVoiceSample>[0]) => {
    // A submitted request owns its original audio even if the next draft is
    // edited or recovery is paused. Existing storage expiry cleans it later.
    if (sample && !recoveryPending && !submittedVoicePaths.current.has(sample.path)) void deleteCharacterVoiceSample(sample);
  };
  const referencePickerVisible = (!creationScreen || recoveryPending) && editorAvailable && activeSettingsTab === "criteria";
  useInrAssistantLocalInterface("studio_free_library", { open: libraryOpen }, {
    open: { invoke: () => { if (locked || !referencePickerVisible || references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT) throw new Error("reference_picker_unavailable"); setLibraryOpen(true); }, matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === true },
    close: { invoke: () => setLibraryOpen(false), matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === false },
  }, libraryOpen || referencePickerVisible, locked);
  const characterVoiceSelection = getCharacterVoiceSelectionState(kind === "video" ? references : []);
  const selectedVideoEngine = characterVoiceSelection.hasProvidedVoice && !isAiMediaCharacterVoiceEngine(enginePreference.videoEngine)
    ? "wan27" : enginePreference.videoEngine;
  const videoModel = getAiMediaVideoModelForCharacterVoice(selectedVideoEngine, characterVoiceSelection.hasProvidedVoice);
  const videoResolution = videoModel.resolutions.includes(enginePreference.videoResolution)
    ? enginePreference.videoResolution : videoModel.defaultResolution;
  const characterVoiceSpeechConflict = characterVoiceSelection.hasProvidedVoice && speechMode !== "characters";
  const wan3VoiceDurationExceeded = kind === "video" && exceedsAiMediaCharacterVoiceEngineDuration("wan3", references);
  const characterVoiceDurationExceeded = kind === "video" && exceedsAiMediaCharacterVoiceEngineDuration(selectedVideoEngine, references);
  const counter = quota?.credits;
  const maxDuration = quota?.videoMaxDurationSeconds ?? 30;
  const durations = getMediaVideoDurationChoices(maxDuration);
  const exhausted = !quota?.unlimited && counter?.remaining === 0;
  const personReferences = references.filter(
    (reference) =>
      reference.role === "character" && reference.usage === "required"
  );
  const identityRequired = personReferences.length > 0 || characterVoiceSelection.hasProvidedVoice;
  const identityMode = personReferences.length > 1 ? "reference_team" : personReferences.length === 1 ? "professional" : "auto";
  const teamConsentRequired = kind === "video" && personReferences.length > 1;
  const authorizationRequired = identityRequired || teamConsentRequired;
  const authorizationChecked = (!identityRequired || identityConsent) && (!teamConsentRequired || teamConsent);
  const authorizationVisible = authorizationRequired && !reviewingRecovery;
  const authorizationEngine = `${kind}:${kind === "video" ? selectedVideoEngine : enginePreference.imageEngine}`;
  const authorizationLabel = t(characterVoiceSelection.hasProvidedVoice
    ? "ai_generator_final_authorization_voices_label"
    : "ai_generator_final_authorization_images_label", {
      provider: kind === "video" ? videoModel.providerLabel : imageModel.providerLabel,
    });
  const effectiveWithNarration =
    kind === "video" && !explicitlyEmptySpokenScript && speechMode === "voiceover";
  const effectiveWithSubtitles =
    kind === "video" && !explicitlyEmptySpokenScript && speechMode !== "silent" && withSubtitles;
  const requestSpeechMode: MediaGenerationTeamVideoSpeechMode =
    !explicitlyEmptySpokenScript && speechMode === "characters" ? "characters" : "voiceover";
  const referenceCriteriaIncomplete = references.some(
    (reference) => !reference.role || !reference.usage
  );
  // Exact identity preservation is limited to three people. Inspiration-only
  // images and all other roles can freely share the five available slots.
  const roleLimitExceeded = references.filter((reference) => reference.role === "character" &&
    (reference.usage === "required" || (kind === "video" && reference.voiceMode === "provided"))).length > 3;
  const maxUserPromptLength = Math.max(0, getAiMediaVisualBriefMaxChars(kind) - (requiredPromptSuffix ? requiredPromptSuffix.length + 1 : 0));
  const effectivePrompt = [prompt.trim(), requiredPromptSuffix.trim()].filter(Boolean).join(" ");
  const misplacedSpeech = kind === "video" ? detectAiMediaVideoVisualBriefSpeech(effectivePrompt) : null;
  const misplacedSpeechBlocking = Boolean(misplacedSpeech) && !spokenScriptOpen;
  const speechState = getAiMediaVideoSpeechState({
    kind, creationMode: "free", freePrompt: effectivePrompt,
    ...(kind === "video" && spokenScriptOpen ? { spokenScript } : {}),
    withNarration: effectiveWithNarration, teamVideoSpeechMode: requestSpeechMode,
    durationSeconds: duration, videoEngine: selectedVideoEngine,
    videoResolution, sceneMode, language: locale,
  });
  const speechInvalid = kind === "video" && Boolean(speechState.issue);
  const speechUnit = t(speechState.unit === "mots" ? "ai_generator_video_speech_words" : "ai_generator_video_speech_characters");
  const speechError = speechState.issue?.code === "AI_MEDIA_VIDEO_DURATION_INVALID"
    ? t("ai_generator_model_duration_unavailable", { seconds: duration })
    : speechState.issue?.code === "AI_MEDIA_INVALID_SPEECH_MODE"
      ? t("ai_generator_spoken_script_silent_help") : t("ai_generator_video_speech_too_long");
  const hasSpokenScript = kind === "video" && spokenScript.trim().length > 0;
  const spokenScriptConflict = hasSpokenScript && speechMode === "silent";
  const durationUnavailable = kind === "video" && (!durations.includes(duration) || !canGenerateAiMediaVideoDuration(selectedVideoEngine, duration, videoResolution, sceneMode));
  const referenceCompatible = kind === "video" ? isMediaVideoReferenceCompatible(selectedVideoEngine, references.length, characterVoiceSelection.hasProvidedVoice) : isAiMediaImageModelCompatible({ engine: enginePreference.imageEngine, operation: "generate", inspirationImagesCount: references.length });
  const briefCompatible = kind !== "video" || isMediaVideoBriefCompatible(selectedVideoEngine, effectivePrompt);
  const promptReady = prompt.trim().length >= 3 && prompt.length <= maxUserPromptLength;
  const promptWarning = operationLocked ? "" : kind === "video" && prompt.length > maxUserPromptLength
    ? t("ai_generator_video_brief_too_long", { max: maxUserPromptLength }) : misplacedSpeechBlocking
    ? t("ai_generator_video_speech_move") : !promptReady
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
    : characterVoiceSelection.missingSample ? t("ai_generator_character_voice_sample_missing")
    : characterVoiceSpeechConflict ? t("ai_generator_character_voice_speech_required")
    : characterVoiceDurationExceeded ? t("ai_generator_character_voice_wan3_duration_limit") : "";
  const photoRequiredHint = kind === "video" && !videoModel.supportsTextToVideo
    ? t("ai_generator_model_photo_required") : "";
  const creditQuote = useMediaCreditQuote({ kind, format: fixedFormat || format, operation: "generate", creationMode: "free",
    inputMode: "essential", identityMode,
    videoEngine: selectedVideoEngine, imageEngine: enginePreference.imageEngine,
    videoResolution, durationSeconds: kind === "video" ? duration : undefined,
    sceneMode: kind === "video" ? sceneMode : undefined,
    inspirationImagesCount: references.length, withNarration: effectiveWithNarration,
    hasProvidedCharacterVoice: characterVoiceSelection.hasProvidedVoice,
    teamVideoSpeechMode: requestSpeechMode,
    ...(kind === "video" ? { withSubtitles: effectiveWithSubtitles } : {}),
    ...(kind === "video" && spokenScriptOpen ? { spokenScript } : {}),
  }, quota, !durationUnavailable && referenceCompatible && briefCompatible && (kind !== "video" || !speechInvalid && !misplacedSpeechBlocking && promptReady));
  const creditInsufficient = creditQuote.insufficient;
  const modelRecommendation = recommendAiMediaModel({ kind, format: fixedFormat || format, operation: "generate", brief: effectivePrompt,
    durationSeconds: duration, sceneMode, withNarration: effectiveWithNarration,
    teamVideoSpeechMode: requestSpeechMode, language: locale, inspirationImagesCount: references.length,
    inputMode: "essential", identityMode });
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
    !characterVoiceSelection.missingSample &&
    !characterVoiceSpeechConflict &&
    !characterVoiceDurationExceeded &&
    !spokenScriptConflict &&
    !speechInvalid &&
    !misplacedSpeechBlocking &&
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

  useEffect(() => {
    // Account preferences may load a different provider without a selector event.
    setIdentityConsent(false);
    setTeamConsent(false);
  }, [authorizationEngine, quota?.accountId]);

  useLayoutEffect(() => {
    onBusyChange?.(operationLocked);
    return () => onBusyChange?.(false);
  }, [onBusyChange, operationLocked]);

  useEffect(() => {
    // The hook's earlier effect hydrates the scoped recovery pointer once quota
    // identifies the account. Do not permit replacement before that first check.
    if (quota?.accountId && !quotaLoading) setRecoveryAccountChecked(quota.accountId);
  }, [quota?.accountId, quotaLoading]);

  const recoveryGuardPending = !quota?.accountId || quotaLoading ||
    recoveryAccountChecked !== quota.accountId || recoveryPending;
  useLayoutEffect(() => {
    onPendingRecoveryChange?.(recoveryGuardPending);
    return () => onPendingRecoveryChange?.(false);
  }, [onPendingRecoveryChange, recoveryGuardPending]);

  useLayoutEffect(() => {
    onResultChange?.(result);
  }, [onResultChange, result]);

  useLayoutEffect(() => {
    if (recoveryIncompatible) return;
    if (result?.recovered && editingRecoveredId !== result.item.id && recoveredFormat) setFormat(recoveredFormat);
    if (recoveryContext && recoveryContext.kind !== mediaType) onRecoveryKind?.(recoveryContext.kind);
  }, [recoveredFormat, recoveryContext, recoveryIncompatible, mediaType, onRecoveryKind, result, editingRecoveredId]);

  useEffect(() => {
    const clearAccountState = () => {
      sequence.current += 1;
      setPrompt("");
      setRecoveryAccountChecked(null);
      setSpokenScript("");
      setSpokenScriptOpen(false);
      setUseBusinessDna(false);
      setReferences([]);
      setFormat(fixedFormat || (kind === "video" ? "story" : "square"));
      setDuration(8);
      setSceneMode("single");
      setWithMusic(true);
      setWithSubtitles(false);
      setSpeechMode("voiceover");
      setVoice("female");
      setVoiceVariant("Kore");
      setIdentityConsent(false);
      setTeamConsent(false);
      setLibraryOpen(false);
      setStopConfirmOpen(false);
      setActionError("");
      setReferencesBusy(false);
      setCharacterVoiceBusy(false);
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
  }, [fixedFormat, kind, setPrompt]);

  const resetConsent = () => {
    setIdentityConsent(false);
    setTeamConsent(false);
    referenceSetId.current = globalThis.crypto.randomUUID();
  };

  const setGenerationAuthorization = (checked: boolean) => {
    setIdentityConsent(checked);
    setTeamConsent(checked);
  };

  const addFiles = async (files: File[], lockOwned = false) => {
    if (!lockOwned && (locked || (operationInFlight.current && !recoveryPending))) return;
    const currentSequence = sequence.current;
    operationInFlight.current = true;
    setReferencesBusy(true);
    setActionError("");
    try {
      const prepared: Reference[] = [];
      for (const file of files) assertStudioInspirationImageMetadata(file, t("ai_generator_inspiration_images_only"));
      for (const file of files.slice(
        0,
        AI_MEDIA_INSPIRATION_MAX_COUNT - references.length
      )) {
        const image = await prepareMediaGenerationImageReference(file);
        if (sequence.current !== currentSequence) return;
        prepared.push({
          ...image,
          id: globalThis.crypto.randomUUID(),
          role: undefined,
          usage: undefined,
          fromVideo: false,
        });
      }
      setReferences((current) =>
        [...current, ...prepared].slice(0, AI_MEDIA_INSPIRATION_MAX_COUNT)
      );
      resetConsent();
    } catch (caught) {
      if (sequence.current === currentSequence)
        setActionError(
          caught instanceof StudioInspirationImageOnlyError
            ? t("ai_generator_inspiration_images_only")
            : caught instanceof Error
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
    if (locked || (operationInFlight.current && !recoveryPending)) return;
    const currentSequence = sequence.current;
    operationInFlight.current = true;
    setReferencesBusy(true);
    setActionError("");
    try {
      for (const item of items) assertStudioInspirationImageMetadata(item, t("ai_generator_inspiration_images_only"));
      const files = await Promise.all(
        items
          .slice(0, AI_MEDIA_INSPIRATION_MAX_COUNT - references.length)
          .map(item => prepareMediaGenerationLibraryReferenceFile(item, t("ai_generator_inspiration_library_unavailable"), {
            imagesOnly: true, imagesOnlyMessage: t("ai_generator_inspiration_images_only"),
          }))
      );
      if (sequence.current !== currentSequence) return;
      await addFiles(files, true);
      if (sequence.current !== currentSequence) return;
      setLibraryOpen(false);
    } catch (caught) {
      if (sequence.current === currentSequence)
        setActionError(
          caught instanceof StudioInspirationImageOnlyError
            ? t("ai_generator_inspiration_images_only")
            : caught instanceof Error
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
    patch: Partial<Pick<Reference, "role" | "usage" | "voiceMode" | "voiceSample">>
  ) => {
    const previous = references.find((reference) => reference.id === id);
    const clearsVoice = (Object.hasOwn(patch, "role") && patch.role !== "character") || patch.voiceMode === "ai";
    if (previous?.voiceSample && (clearsVoice || (Object.hasOwn(patch, "voiceSample") && previous.voiceSample.path !== patch.voiceSample?.path))) {
      releaseUnusedVoiceSample(previous.voiceSample);
    }
    setReferences((current) =>
      current.map((reference) =>
        reference.id !== id
          ? reference
          : {
              ...reference,
              ...patch,
              ...(clearsVoice ? { voiceMode: "ai" as const, voiceSample: undefined } : {}),
              // A usage belongs to a role. Clearing it avoids carrying an
              // authoritative choice from a product or person onto another role.
              ...(Object.hasOwn(patch, "role") && patch.role !== reference.role
                ? { usage: undefined }
                : {}),
            }
      )
    );
    if (patch.voiceMode === "provided") setSpeechMode("characters");
    resetConsent();
  };

  const removeReference = (id: string) => {
    releaseUnusedVoiceSample(references.find((reference) => reference.id === id)?.voiceSample);
    setReferences((current) => current.filter((reference) => reference.id !== id));
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
      for (const reference of references) if (reference.voiceSample?.path) submittedVoicePaths.current.add(reference.voiceSample.path);
      await generate({
        ...creditQuote.authorization,
        imageEngine: enginePreference.imageEngine,
        videoResolution,
        operation: "generate",
        creationMode: "free",
        freePrompt: effectivePrompt,
        ...(kind === "video" && spokenScriptOpen ? { spokenScript } : {}),
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
        ...(kind === "video" ? { withSubtitles: effectiveWithSubtitles } : {}),
        withNarration: effectiveWithNarration,
        narrationVoice: effectiveWithNarration ? voice : undefined,
        narrationVoiceVariant:
          effectiveWithNarration ? voiceVariant : undefined,
        videoEngine: selectedVideoEngine,
        teamVideoSpeechMode: kind === "video" ? requestSpeechMode : undefined,
        teamVideoMode: "cinematic",
        inspirationImages: referencesForRequest(references),
        identityMode,
        identityConsent: identityRequired && identityConsent,
        teamVideoVeoConsent: videoModel.provider === "google" && teamConsentRequired && teamConsent,
        teamVideoProviderConsent: teamConsentRequired && teamConsent ? selectedVideoEngine : undefined,
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
      if (caught instanceof Error && caught.name === "MediaGenerationRecoveryPausedError") {
        retryableFailure = true;
      } else if (
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
      if (sequence.current === currentSequence) {
        setIdentityConsent(false);
        setTeamConsent(false);
      }
    } catch (caught) {
      if (sequence.current === currentSequence && !(caught instanceof MediaGenerationAccountChangedError) && !(caught instanceof Error && caught.name === "MediaGenerationRecoveryPausedError")) {
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
      if (sequence.current === currentSequence) {
        setIdentityConsent(false);
        setTeamConsent(false);
        if (!recovered) setCreationScreen(false);
      }
    } catch (caught) {
      if (sequence.current === currentSequence && !(caught instanceof MediaGenerationAccountChangedError) && !(caught instanceof Error && caught.name === "MediaGenerationRecoveryPausedError")) {
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

  const assistantFormSnapshot: InrAssistantStudioFormSnapshot = {
    mode: "free", kind, locked: operationLocked, editorVisible: editorAvailable && !stopConfirmOpen,
    fixedFormat, maxPromptLength: maxUserPromptLength, activeTab: activeSettingsTab, prompt, useBusinessDna, format,
    videoEngine: selectedVideoEngine, videoResolution, language: locale,
    durationScene: { seconds: duration, sceneMode }, speechMode, spokenScript, spokenScriptOpen,
    narrationVoice: voice, narrationVoiceVariant: voiceVariant, withMusic, withSubtitles: effectiveWithSubtitles,
  };
  useInrAssistantLocalInterface("studio_recovery_free", { confirmationOpen: stopConfirmOpen, canRecover, recovering, canPauseRecovery, resultId: result?.item.id ?? null, recoveryContext }, { retry: {
    invoke: () => { if (!canRecover || recovering || recoveryIncompatible || operationLocked) throw new Error("studio_recovery_unavailable"); void handleRecoverResult(); },
    matches: state => !!state && typeof state === "object" && ((state as { recovering?: boolean }).recovering === true || Boolean((state as { resultId?: string | null }).resultId)),
  }, stop: {
    invoke: () => { if (!canPauseRecovery || operationLocked || !pauseRecovery()) throw new Error("studio_recovery_pause_unavailable"); },
    matches: state => !!state && typeof state === "object" && (state as { recovering?: boolean; canRecover?: boolean }).recovering === false && (state as { canRecover?: boolean }).canRecover === true,
  }, review: {
    invoke: () => { if (!canRecover || recoveryIncompatible || busy || operationLocked) throw new Error("studio_recovery_unavailable"); setStopConfirmOpen(true); },
    matches: state => !!state && typeof state === "object" && (state as { confirmationOpen?: boolean; canRecover?: boolean }).confirmationOpen === true && (state as { canRecover?: boolean }).canRecover === true,
  } }, (canRecover || recovering) && !recoveryIncompatible, operationLocked);
  useInrAssistantLocalInterface("studio_free_form", { ...assistantFormSnapshot, quotaRefreshId, quotaAccountId: quota?.accountId ?? null }, {
    ...(!quotaLoading ? { retry: {
      invoke: async (_value: string | null, stillCurrent: () => boolean) => {
        if (operationLocked) throw new Error("quota_refresh_unavailable");
        const refreshed = await loadQuota({ force: true, canApply: stillCurrent, expectedAccountId: quota?.accountId ?? undefined });
        if (!refreshed?.accountId || !stillCurrent()) throw new Error("quota_refresh_unconfirmed");
        setQuotaRefreshId(current => current + 1);
      },
      matches: (state: unknown) => !!state && typeof state === "object" && (state as { quotaRefreshId?: number }).quotaRefreshId === quotaRefreshId + 1 && typeof (state as { quotaAccountId?: unknown }).quotaAccountId === "string",
    } } : {}),
    select: {
      invoke: encoded => {
        const change = parseInrAssistantStudioFormSelection(encoded, assistantFormSnapshot, (seconds, mode) => durations.includes(seconds) && canGenerateAiMediaVideoDuration(selectedVideoEngine, seconds, videoResolution, mode));
        if (!change) throw new Error("studio_form_unavailable");
        switch (change.field) {
          case "activeTab": setActiveSettingsTab(change.value); break;
          case "prompt": setPrompt(change.value); break;
          case "useBusinessDna": setUseBusinessDna(change.value); break;
          case "format": setFormat(change.value); break;
          case "durationScene": setDuration(change.value.seconds); setSceneMode(change.value.sceneMode); break;
          case "speechMode": setSpeechMode(change.value); resetConsent(); break;
          case "spokenScript": setSpokenScript(change.value); break;
          case "spokenScriptOpen": setSpokenScriptOpen(change.value); if (!change.value) setSpokenScript(""); break;
          case "narrationVoice": setVoice(change.value); setVoiceVariant(defaultAiMediaNarrationVoiceVariant(change.value)); break;
          case "narrationVoiceVariant": setVoiceVariant(change.value); break;
          case "withMusic": setWithMusic(change.value); break;
          case "withSubtitles": setWithSubtitles(change.value); break;
          default: throw new Error("studio_form_unavailable");
        }
      },
      matches: isInrAssistantStudioFormSelectionApplied,
    },
  }, editorAvailable && !stopConfirmOpen, operationLocked);

  const engineControls = !editorAvailable ? null : (
    <MediaEngineCreditControls kind={kind} format={fixedFormat || format} videoEngine={selectedVideoEngine}
            imageEngine={enginePreference.imageEngine} resolution={videoResolution}
            durationSeconds={duration} sceneMode={sceneMode} onDurationSceneChange={(seconds, mode) => { setDuration(seconds); setSceneMode(mode); }} videoMaxDurationSeconds={maxDuration}
            recommendation={modelRecommendation}
            brief={effectivePrompt}
            referenceCount={references.length} disabled={locked}
            allowedVideoEngines={characterVoiceSelection.hasProvidedVoice ? AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES : undefined}
            allowedVideoEnginesReason={characterVoiceSelection.hasProvidedVoice ? t("ai_generator_character_voice_engine_required") : undefined}
            unavailableVideoEngineReasons={wan3VoiceDurationExceeded ? { wan3: t("ai_generator_character_voice_wan3_duration_limit") } : undefined}
            hasProvidedCharacterVoice={characterVoiceSelection.hasProvidedVoice}
            onVideoEngineChange={(videoEngine, resolution) => { resetConsent(); enginePreference.update({ videoEngine, videoResolution: resolution ?? getAiMediaVideoModel(videoEngine).defaultResolution }); }}
            onImageEngineChange={(imageEngine) => { resetConsent(); enginePreference.update({ imageEngine }); }}
            onResolutionChange={(resolution) => { resetConsent(); enginePreference.update({ videoEngine: selectedVideoEngine, videoResolution: resolution }); }} />
  );
  const creditSummary = reviewingRecovery
    ? <MediaRecoveredCreditSummary creditsUsed={result?.creditsUsed} />
    : <MediaCreditQuoteSummary status={creditQuote} quota={quota} />;

  const generationAction = <button
    type="button" className={styles.primaryButton} data-media-primary-action
    disabled={recoveryIncompatible || (recoveryPending ? recovering || operationLocked : busy ? !cancellable : Boolean(result) || !canGenerate)}
    title={recoveryPending ? t("ai_generator_recovery_generation_blocked") : busy && !cancellable ? t("ai_generator_editor_stop_locked") : undefined}
    onClick={() => { if (recoveryPending) void handleRecoverResult(); else if (busy) setStopConfirmOpen(true); else if (!result) void handleGenerate(); }}
  >
    <span aria-hidden="true">{busy && !recoveryPending ? "■" : "✦"}</span>
    {t(recoveryPending ? recovering ? "ai_generator_recovery_checking" : "ai_generator_recovery_check" : busy ? "ai_generator_editor_stop" : kind === "video" ? "ai_generator_generate_video" : "ai_generator_generate_image")}
  </button>;

  const preview = (
      <MediaGenerationCreationWorkspace
        accountId={quota?.accountId}
        variant="embedded"
        creationStarted={creationScreen}
        generationInProgress={busy}
        recoveryPending={recoveryPending}
        recoveryChecking={recovering}
        canPauseRecovery={canPauseRecovery}
        handleRetryRecovery={handleRecoverResult}
        handlePauseRecovery={() => { pauseRecovery?.(); }}
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
        criteriaEditorState={{ activeTab: activeSettingsTab, targetTab: "prompt", ready: editorAvailable && !operationLocked }}
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
          authorizationRequired
            ? [
                {
                  id: "generation",
                  label: authorizationLabel,
                  checked: authorizationChecked,
                  onChange: setGenerationAuthorization,
                },
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
    >
      <div className={editorStyles.editorBody} data-recovery-pending={recoveryPending}>
        <div className={`${editorStyles.settingsPane} ${kind === "video" ? styles.videoSettingsPane : ""}`}>
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
                  accept={IMAGE_ACCEPT}
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
              <div className={styles.references} data-character-voices={kind === "video" ? "true" : undefined}>
                {references.map((reference, index) => (
                  <div className={styles.reference} key={reference.id} data-reference-id={reference.id}>
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
                        onClick={() => removeReference(reference.id)}
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
                    {kind === "video" && reference.role === "character" ? <MediaCharacterVoiceInput
                      mode={reference.voiceMode} sample={reference.voiceSample} disabled={locked}
                      onModeChange={(voiceMode) => updateReference(reference.id, { voiceMode })}
                      onSampleChange={(voiceSample) => updateReference(reference.id, { voiceSample })}
                      onBusyChange={setCharacterVoiceBusy}
                    /> : null}
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
            {characterVoiceSpeechConflict ? <button type="button" className={styles.secondaryButton} disabled={locked} onClick={() => setSpeechMode("characters")}>{t("ai_generator_character_voice_switch_characters")}</button> : null}
          </div>
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
                    data-disabled={mode === "silent" && hasSpokenScript}
                    key={mode}
                  >
                    <input
                      type="radio"
                      name={`${instanceId}-speech-mode`}
                      value={mode}
                      checked={speechMode === mode}
                      disabled={mode === "silent" && hasSpokenScript}
                      aria-describedby={mode === "silent" && hasSpokenScript ? `${instanceId}-speech-mode-help` : undefined}
                      onChange={() => {
                        if (mode === "silent" && hasSpokenScript) return;
                        setSpeechMode(mode);
                        resetConsent();
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
              {hasSpokenScript ? <p id={`${instanceId}-speech-mode-help`} className={styles.muted}>
                {t("ai_generator_spoken_script_remove_for_silent")}
              </p> : null}
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
              <label className={`${styles.musicOption} ${styles.subtitlesOption}`}>
                <input
                  type="checkbox"
                  checked={effectiveWithSubtitles}
                  disabled={locked || speechMode === "silent" || explicitlyEmptySpokenScript}
                  data-media-subtitles
                  onChange={(event) => setWithSubtitles(event.target.checked)}
                />
                <span>{t("ai_generator_free_subtitles")}</span>
              </label>
            </div>
          ) : null}
        </section>
        <section
          className={`${styles.promptPanel} ${editorStyles.tabPanel}`}
          data-spoken-script-open={kind === "video" && spokenScriptOpen}
          role="tabpanel" id={`${instanceId}-panel-prompt`} aria-labelledby={`${instanceId}-tab-prompt`} hidden={activeSettingsTab !== "prompt"}
        >
          {kind === "image" ? <div className={styles.panelHeading}>
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
          </div> : null}
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
            <MediaBusinessDnaHelp />
            {kind === "video" ? <MediaPromptHelp kind={kind} /> : null}
          </div>
          <div className={kind === "video" ? styles.videoBriefFrame : undefined} data-video-brief-frame={kind === "video" ? true : undefined}>
          {kind === "video" ? <div className={styles.videoFrameHeading}>
            <label htmlFor={`${instanceId}-prompt`}>{t("ai_generator_video_visual_brief_title")}</label>
            <p id={`${instanceId}-visual-brief-help`}>{t("ai_generator_video_visual_brief_hint_short")}</p>
          </div> : null}
          <div className={styles.promptContainer} data-invalid={kind === "video" && (prompt.length > maxUserPromptLength || misplacedSpeechBlocking) ? true : undefined}>
            <label
              className={styles.srOnly}
              htmlFor={`${instanceId}-prompt`}
            >
              {t("ai_generator_free_prompt_label")}
            </label>
            <textarea
              id={`${instanceId}-prompt`}
              value={prompt}
              maxLength={kind === "video" ? undefined : maxUserPromptLength}
              disabled={operationLocked}
              readOnly={voiceBusy}
              aria-invalid={kind === "video" && (prompt.length > maxUserPromptLength || misplacedSpeechBlocking) ? true : undefined}
              aria-describedby={kind === "image" ? `${instanceId}-prompt-help` : `${instanceId}-visual-brief-help ${instanceId}-prompt-count${prompt.length > maxUserPromptLength || misplacedSpeechBlocking ? ` ${instanceId}-visual-brief-error` : ""}`}
              placeholder={t(
                kind === "video"
                  ? "ai_generator_free_prompt_placeholder_video"
                  : "ai_generator_free_prompt_placeholder_image"
              )}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className={styles.promptToolbar}>
              <span id={`${instanceId}-prompt-count`} aria-live={kind === "video" ? "polite" : undefined}>
                {prompt.length.toLocaleString(locale)} /{" "}
                {maxUserPromptLength.toLocaleString(locale)}
              </span>
              <MediaSubjectVoiceButton
                value={prompt}
                onChange={setPrompt}
                onBusyChange={setVoiceBusy}
                disabled={operationLocked}
                maxLength={maxUserPromptLength}
                purpose="instruction"
                contextLabel={t("ai_generator_free_prompt_label")}
                placement="inline"
              />
            </div>
          </div>
          {kind === "video" && prompt.length > maxUserPromptLength ? <p id={`${instanceId}-visual-brief-error`} className={styles.videoFrameError} role="alert">
            {t("ai_generator_video_brief_too_long", { max: maxUserPromptLength })}
          </p> : misplacedSpeechBlocking ? <p id={`${instanceId}-visual-brief-error`} className={styles.videoFrameError} role="alert">{t("ai_generator_video_speech_move")}</p> : null}
          {misplacedSpeech && spokenScriptOpen ? <p className={styles.promptHelp}>{t("ai_generator_video_speech_override_notice")}</p> : null}
          </div>
          {kind === "video" ? <div className={styles.spokenScriptSection}>
            <div className={styles.videoFrameHeading}>
              <label htmlFor={`${instanceId}-spoken-script`}>{t("ai_generator_spoken_script_label")}</label>
              <p id={`${instanceId}-spoken-script-help`}>{t("ai_generator_video_speech_frame_hint_short")}</p>
            </div>
            <div id={`${instanceId}-spoken-script-panel`} className={styles.spokenScriptPanel} data-video-speech-frame data-invalid={speechInvalid ? true : undefined}>
              <div className={styles.spokenScriptHeading}>
                <span className={styles.speechModeBadge}>{t(spokenScriptOpen ? "ai_generator_video_speech_exact" : "ai_generator_video_speech_automatic")}</span>
            {!spokenScriptOpen ?
              <button
                id={`${instanceId}-add-spoken-script`}
                type="button"
                className={styles.addSpokenScriptButton}
                disabled={locked || speechMode === "silent"}
                aria-pressed={false}
                aria-controls={`${instanceId}-spoken-script-panel`}
                aria-describedby={speechMode === "silent" ? `${instanceId}-spoken-script-silent-help` : undefined}
                onClick={() => {
                  setSpokenScriptOpen(true);
                  window.requestAnimationFrame(() => document.getElementById(`${instanceId}-spoken-script`)?.focus());
                }}
              ><span aria-hidden="true">＋</span>{t("ai_generator_spoken_script_add")}</button> : null}
                {spokenScriptOpen ? <button type="button" disabled={locked} aria-controls={`${instanceId}-spoken-script-panel`}
                  onClick={() => {
                    setSpokenScript("");
                    setSpokenScriptOpen(false);
                    window.requestAnimationFrame(() => document.getElementById(`${instanceId}-add-spoken-script`)?.focus());
                  }}>{t("ai_generator_video_speech_reset")}</button> : null}
              </div>
              {speechMode === "silent" ? <div className={styles.spokenScriptSilentHelp}>
                <p id={`${instanceId}-spoken-script-silent-help`} className={styles.srOnly}>{t("ai_generator_spoken_script_silent_help")}</p>
                <button type="button" disabled={locked} onClick={() => {
                  setActiveSettingsTab("criteria");
                  window.requestAnimationFrame(() => document.getElementById(`${instanceId}-tab-criteria`)?.focus());
                }}>{t("ai_generator_spoken_script_choose_audio")}</button>
              </div> : null}
              <div className={styles.spokenScriptInput}>
                <textarea id={`${instanceId}-spoken-script`} value={spokenScript}
                  disabled={locked || speechMode === "silent"}
                  aria-invalid={speechInvalid ? true : undefined}
                  aria-describedby={`${instanceId}-spoken-script-help ${instanceId}-spoken-script-count ${instanceId}-spoken-script-budget${speechInvalid ? ` ${instanceId}-spoken-script-error` : ""}`}
                  placeholder={t("ai_generator_spoken_script_placeholder")}
                  onChange={(event) => { setSpokenScriptOpen(true); setSpokenScript(event.target.value); }} />
                <span id={`${instanceId}-spoken-script-count`} className={styles.spokenScriptCounter} aria-live="polite">
                  {t("ai_generator_video_speech_count", { count: speechState.units.toLocaleString(locale), max: speechState.maxUnits.toLocaleString(locale), unit: speechUnit })}
                  {" · "}{t("ai_generator_video_speech_character_count", { count: speechState.characters.toLocaleString(locale), max: speechState.maxCharacters.toLocaleString(locale) })}
                </span>
              </div>
              <p id={`${instanceId}-spoken-script-budget`} className={styles.promptHelp}
                title={explicitlyEmptySpokenScript ? t("ai_generator_video_speech_empty") : speechMode === "silent" ? t("ai_generator_video_speech_silent") : t("ai_generator_video_speech_budget", { seconds: duration, model: videoModel.label })}>
                <span aria-hidden="true">{explicitlyEmptySpokenScript ? t("ai_generator_video_speech_empty_short") : speechMode === "silent" ? t("ai_generator_free_audio_silent") : t("ai_generator_video_speech_budget_short", { seconds: duration, model: videoModel.label })}</span>
                <span className={styles.srOnly}>{explicitlyEmptySpokenScript ? t("ai_generator_video_speech_empty") : speechMode === "silent" ? t("ai_generator_video_speech_silent") : t("ai_generator_video_speech_budget", { seconds: duration, model: videoModel.label })}</span>
              </p>
              {!spokenScriptOpen && speechState.script ? <p className={styles.promptHelp}>{t("ai_generator_video_speech_legacy")}</p> : null}
              {speechState.segmentBudgets.length > 1 && speechMode === "characters" ? <div className={styles.speechSegments}>
                {speechState.segmentBudgets.map((segment, index) => <span key={index} data-invalid={segment.issue ? true : undefined}>
                  {t("ai_generator_video_speech_segment", { index: index + 1, seconds: segment.durationSeconds, count: segment.units.toLocaleString(locale), max: segment.maxUnits.toLocaleString(locale), unit: speechUnit })}
                </span>)}
              </div> : null}
              {speechInvalid ? <p id={`${instanceId}-spoken-script-error`} className={styles.videoFrameError} role="alert">{speechError}</p> : null}
            </div>
          </div> : <p id={`${instanceId}-prompt-help`} className={styles.promptHelp}>
            {requiredPromptSuffix ? "Les critères du canal sont ajoutés automatiquement à votre consigne." : t("ai_generator_free_prompt_help")}
          </p>}
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
          <div className={styles.finalAction} data-media-final-action>
          {authorizationVisible ? <div className={styles.footerAuthorization} data-media-final-authorization>
            <details className={styles.authorizationDetails} onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
                event.stopPropagation();
              }
            }}>
              <summary aria-label={t("ai_generator_final_authorization_details")} title={t("ai_generator_final_authorization_details")}><span aria-hidden="true">i</span></summary>
              <p>{authorizationLabel}</p>
            </details>
            <label className={styles.consent} htmlFor={`${instanceId}-authorization`}>
              <span>{t("ai_generator_final_authorization_short")}</span>
              <input id={`${instanceId}-authorization`} type="checkbox" required checked={authorizationChecked} disabled={locked}
                aria-label={authorizationLabel}
                onChange={(event) => setGenerationAuthorization(event.target.checked)} />
            </label>
          </div> : null}
          {recoveryIncompatible ? <a className={styles.secondaryButton} href="/dashboard/generer-media" data-media-recovery-studio-link>
            {t("ai_generator_editor_recover")} · iNrStudio
          </a> : canRecover && !busy ? <div className={styles.recoveryActions} data-media-recovery-actions>
            {generationAction}
            <button type="button" className={styles.recoveryStop} disabled={operationLocked}
              aria-label={t("ai_generator_recovery_cancel")} title={t("ai_generator_editor_abandon")}
              onClick={() => setStopConfirmOpen(true)}>{t("ai_generator_recovery_cancel")}</button>
          </div> : generationAction}
          </div>
        </MediaGenerationActions>
      </div>
      {!canRecover && !busy && durationUnavailable ? (
        <p className={styles.error} role="status">
          {t("ai_generator_model_duration_unavailable", { seconds: duration })}
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
        accept="image"
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
