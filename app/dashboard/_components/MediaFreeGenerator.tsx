"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import StudioMusicLibrary from "./StudioMusicLibrary";
import StudioVoicePool, { type StudioVoiceProfile } from "./StudioVoicePool";
import { deleteCharacterVoiceSample, getCharacterVoiceSelectionState } from "@/lib/aiMediaCharacterVoiceClient";
import { AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES, AI_MEDIA_NARRATION_VOICE_MIN_SECONDS, exceedsAiMediaCharacterVoiceEngineDuration, isAiMediaCharacterVoiceEngine } from "@/lib/aiMediaCharacterVoices";
import MediaPromptHelp from "./MediaPromptHelp";
import MediaGenerationCreationWorkspace from "./MediaGenerationCreationWorkspace";
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
const REFERENCE_ROLE_PATHS = {
  inspiration: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4",
  character: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  environment: "M12 3 5 12h4l-4 5h6v4h2v-4h6l-4-5h4L12 3Z",
  product: "m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9 9-4m-9 4L3 8m9 4v9M7 5.8 16 11",
} as const;
const IMAGE_ACCEPT = [
  ...INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  ...INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

function referencesForRequest(references: Reference[], includeCharacterVoices = true) {
  let characterIndex = 0;
  return references.map(({ id: _id, fromVideo: _fromVideo, ...savedReference }) => {
    const { voiceMode: _voiceMode, voiceSample: _voiceSample, ...imageOnlyReference } = savedReference;
    const reference = includeCharacterVoices ? savedReference : imageOnlyReference;
    if (reference.role !== "character" || (reference.usage !== "required" && (!includeCharacterVoices || savedReference.voiceMode !== "provided"))) {
      return reference;
    }
    characterIndex += 1;
    return { ...reference, characterIndex: characterIndex as 1 | 2 | 3 };
  });
}

function MediaSettingsDialog({ id, kind, title, closeLabel, closeBlocked, initialFocusId, addRole, onClose, children }: {
  id: string; kind: "images" | "audio" | "music"; title: string; closeLabel: string; closeBlocked: boolean; initialFocusId?: string; addRole?: MediaGenerationReferenceRole; onClose: () => void; children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const initialFocus = useRef(initialFocusId);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const target = initialFocus.current ? document.getElementById(initialFocus.current) : closeRef.current;
    target?.focus({ preventScroll: true });
    if (initialFocus.current) target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog id={id} ref={dialogRef} className={styles.mediaSettingsDialog} data-media-settings-dialog={kind} data-add-mode={addRole ? "true" : undefined} data-add-role={addRole}
    aria-labelledby={titleId} aria-modal="true"
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!closeBlocked) onClose(); }}
    onClose={(event) => event.stopPropagation()}
    onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget && !closeBlocked) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    } }}>
    <header className={styles.mediaSettingsDialogHeader}><h2 id={titleId}>
      {kind === "audio" ? <span className={styles.audioDialogIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3m-3 0h6" /></svg></span> : null}
      {title}</h2>
      <button ref={closeRef} type="button" disabled={closeBlocked} aria-label={closeLabel} onClick={onClose}>×</button>
    </header>
    <div className={styles.mediaSettingsDialogBody}>{children}</div>
  </dialog>;
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
  const [pendingReferenceRole, setPendingReferenceRole] = useState<MediaGenerationReferenceRole | null>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [withMusic, setWithMusic] = useState(true);
  const [soundtrackId, setSoundtrackId] = useState<string | null>(null);
  const [voiceSourcePreference, setVoiceSourcePreference] = useState<"ai" | "provided">("ai");
  const [voiceReferenceId, setVoiceReferenceId] = useState<string | null>(null);
  const [narrationVoiceMode, setNarrationVoiceMode] = useState<"ai" | "provided">("ai");
  const [voiceProfiles, setVoiceProfiles] = useState<StudioVoiceProfile[]>([]);
  const [activeNarrationVoiceId, setActiveNarrationVoiceId] = useState<string | null>(null);
  const [narrationVoiceConsent, setNarrationVoiceConsent] = useState(false);
  const [withSubtitles, setWithSubtitles] = useState(false);
  const [speechMode, setSpeechMode] =
    useState<"voiceover" | "characters" | "silent">("voiceover");
  const exactSpeechEditorVisible = kind === "video" && spokenScriptOpen && speechMode !== "silent";
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
  const [mediaSettingsDialog, setMediaSettingsDialog] = useState<"images" | "audio" | "music" | null>(null);
  const [voicePoolOpen, setVoicePoolOpen] = useState(false);
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
  const referenceImportIntent = useRef<{ role: MediaGenerationReferenceRole; sequence: number } | null>(null);
  const referenceAction = useRef<{ encoded: string; id: string; usage?: "required" | "inspiration" } | null>(null);
  const voiceModeIntent = useRef<"ai" | "provided" | null>(null);
  const voiceAction = useRef<{ encoded: string; targetId: string | null } | null>(null);
  const operationLocked = cancellationPending || ((busy || finishing) && !recovering) || voiceBusy || referencesBusy || characterVoiceBusy;
  const locked = operationLocked;
  const releaseUnusedVoiceSample = (sample: Parameters<typeof deleteCharacterVoiceSample>[0]) => {
    // A submitted request owns its original audio even if the next draft is
    // edited or recovery is paused. Existing storage expiry cleans it later.
    if (sample && !recoveryPending && !submittedVoicePaths.current.has(sample.path)) void deleteCharacterVoiceSample(sample);
  };
  const referencePickerVisible = editorAvailable && !stopConfirmOpen && !voicePoolOpen;
  const voiceReferences = references.filter(reference => reference.role === "character");
  const selectedVoiceReference = speechMode === "characters" ? voiceReferences.find(reference => reference.id === voiceReferenceId) ?? (voiceReferences.length === 1 ? voiceReferences[0] : null) : null;
  const selectedVoiceMode = speechMode === "voiceover" ? narrationVoiceMode : selectedVoiceReference ? selectedVoiceReference.voiceMode ?? "ai" : voiceSourcePreference;
  useInrAssistantLocalInterface("studio_free_library", { open: libraryOpen }, {
    open: { invoke: () => { if (locked || !referencePickerVisible || references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT) throw new Error("reference_picker_unavailable"); setPendingReferenceRole(pendingReferenceRole ?? "inspiration"); setSelectedReferenceId(null); setMediaSettingsDialog("images"); setLibraryOpen(true); }, matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === true },
    close: { invoke: () => setLibraryOpen(false), matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === false },
  }, libraryOpen || referencePickerVisible, locked);
  useInrAssistantLocalInterface("studio_media_images", { open: mediaSettingsDialog === "images", pendingReferenceRole, selectedReferenceId, references: references.map(({ id, role, usage }) => ({ id, role, usage })) }, {
    open: { invoke: value => {
      if (locked || libraryOpen || !referencePickerVisible || value !== null && !/^role:(?:inspiration|character|environment|product)$/.test(value)) throw new Error("studio_images_unavailable");
      setPendingReferenceRole(value ? value.slice(5) as MediaGenerationReferenceRole : "inspiration");
      setSelectedReferenceId(null);
      setActionError("");
      setMediaSettingsDialog("images");
    }, matches: (state, value) => !!state && typeof state === "object" && (state as { open?: boolean }).open === true &&
      (value === null || (state as { pendingReferenceRole?: string }).pendingReferenceRole === value.slice(5)) },
    select: { invoke: value => {
      if (locked || libraryOpen || !referencePickerVisible) throw new Error("studio_reference_unavailable");
      const match = value?.match(/^(reference|inspiration):([0-4])(?::(true|false))?$/);
      if (!match || (match[1] === "reference" ? match[3] !== undefined : match[3] === undefined)) throw new Error("studio_reference_unavailable");
      const reference = references[Number(match[2])];
      if (!reference) throw new Error("studio_reference_unavailable");
      const usage = match[1] === "inspiration" ? match[3] === "true" ? "inspiration" : "required" : undefined;
      referenceAction.current = { encoded: value!, id: reference.id, usage };
      if (usage) updateReference(reference.id, { usage });
      else { setSelectedReferenceId(reference.id); setPendingReferenceRole(reference.role ?? null); setMediaSettingsDialog("images"); }
    }, matches: (state, value) => {
      const action = referenceAction.current;
      if (!action || action.encoded !== value || !state || typeof state !== "object") return false;
      const current = state as { open?: boolean; selectedReferenceId?: string; references?: Array<{ id: string; usage?: string }> };
      const reference = current.references?.find(item => item.id === action.id);
      return Boolean(reference && (action.usage ? reference.usage === action.usage : current.open && current.selectedReferenceId === action.id));
    } },
    close: { invoke: () => { if (mediaSettingsDialog !== "images" || locked || libraryOpen) throw new Error("studio_images_busy"); setMediaSettingsDialog(null); }, matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === false },
  }, !voicePoolOpen && (referencePickerVisible || mediaSettingsDialog === "images"), locked);
  const projectedReferences = references.map(reference => {
    const profile = voiceProfiles.find(profile => profile.target && profile.target !== "narration" && profile.target.characterId === reference.id);
    return reference.voiceMode === "provided" && profile ? { ...reference, voiceSample: profile.sample } : reference;
  });
  const activeNarrationProfile = voiceProfiles.find(profile => profile.id === activeNarrationVoiceId && profile.target === "narration");
  const narrationVoiceSample = activeNarrationProfile?.sample;
  const providedNarrationVoiceActive = kind === "video" && speechMode === "voiceover" && narrationVoiceMode === "provided";
  const narrationVoiceMissing = providedNarrationVoiceActive && !narrationVoiceSample;
  const narrationVoiceTooShort = providedNarrationVoiceActive && Boolean(narrationVoiceSample && narrationVoiceSample.durationSeconds < AI_MEDIA_NARRATION_VOICE_MIN_SECONDS);
  const narrationVoiceUnauthorized = providedNarrationVoiceActive && !narrationVoiceConsent;
  const characterVoiceSelection = getCharacterVoiceSelectionState(kind === "video" && speechMode === "characters" ? projectedReferences : []);
  const providedVoiceWithEmptyScript = kind === "video" && (characterVoiceSelection.hasProvidedVoice || providedNarrationVoiceActive) && explicitlyEmptySpokenScript;
  const selectedVideoEngine = characterVoiceSelection.hasProvidedVoice && !isAiMediaCharacterVoiceEngine(enginePreference.videoEngine)
    ? "wan27" : enginePreference.videoEngine;
  const videoModel = getAiMediaVideoModelForCharacterVoice(selectedVideoEngine, characterVoiceSelection.hasProvidedVoice);
  const videoResolution = videoModel.resolutions.includes(enginePreference.videoResolution)
    ? enginePreference.videoResolution : videoModel.defaultResolution;
  const characterVoiceSpeechConflict = characterVoiceSelection.hasProvidedVoice && speechMode !== "characters";
  const aiVoiceSettingsAvailable = kind === "video" && selectedVoiceMode === "ai" && speechMode !== "silent" &&
    (speechMode === "voiceover" || voiceReferences.length > 1 || characterVoiceSpeechConflict);
  useInrAssistantLocalInterface("studio_video_audio", { open: mediaSettingsDialog === "audio" }, {
    open: { invoke: () => { if (!aiVoiceSettingsAvailable || voicePoolOpen || locked || libraryOpen || !editorAvailable || stopConfirmOpen) throw new Error("studio_audio_unavailable"); setMediaSettingsDialog("audio"); }, matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === true },
    close: { invoke: () => { if (mediaSettingsDialog !== "audio" || locked) throw new Error("studio_audio_busy"); setMediaSettingsDialog(null); }, matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === false },
  }, kind === "video" && ((!voicePoolOpen && aiVoiceSettingsAvailable && editorAvailable && !stopConfirmOpen) || mediaSettingsDialog === "audio"), locked);
  const wan3VoiceDurationExceeded = kind === "video" && speechMode === "characters" && exceedsAiMediaCharacterVoiceEngineDuration("wan3", projectedReferences);
  const characterVoiceDurationExceeded = kind === "video" && speechMode === "characters" && exceedsAiMediaCharacterVoiceEngineDuration(selectedVideoEngine, projectedReferences);
  const counter = quota?.credits;
  const maxDuration = quota?.videoMaxDurationSeconds ?? 30;
  const durations = getMediaVideoDurationChoices(maxDuration);
  const exhausted = !quota?.unlimited && counter?.remaining === 0;
  const personReferences = references.filter(
    (reference) =>
      reference.role === "character" && reference.usage === "required"
  );
  const realVoiceNeedsPerson = kind === "video" && speechMode === "characters" && voiceSourcePreference === "provided" && !selectedVoiceReference;
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
    : realVoiceNeedsPerson ? t(voiceReferences.length ? "ai_generator_voice_choose_person" : "ai_generator_voice_photo_needed")
    : providedVoiceWithEmptyScript ? t("ai_generator_voice_exact_script_needed")
    : narrationVoiceMissing ? t("ai_generator_voice_pool_select_narration")
    : narrationVoiceTooShort ? t("ai_generator_narration_voice_reference_limits")
    : narrationVoiceUnauthorized ? t("ai_generator_narration_voice_consent_required")
    : characterVoiceSelection.missingSample ? t("ai_generator_character_voice_sample_missing")
    : characterVoiceSpeechConflict ? t("ai_generator_character_voice_speech_required")
    : characterVoiceDurationExceeded ? t("ai_generator_character_voice_wan3_duration_limit") : "";
  const referencePhotoMissing = kind === "video" && references.length === 0 && !videoModel.supportsTextToVideo;
  const photoRequiredHint = referencePhotoMissing
    ? t("ai_generator_model_photo_required") : "";
  const referenceSettingsWarning = kind === "image" ? criteriaWarning : !referenceCompatible
    ? referenceCompatibilityReason : referenceCriteriaIncomplete ? t("ai_generator_free_reference_criteria_required")
    : roleLimitExceeded ? t("ai_generator_free_role_limit") : "";
  const visibleReferenceWarning = operationLocked ? "" : referencePhotoMissing
    ? t("ai_generator_reference_photo_needed", { model: videoModel.label }) : referenceSettingsWarning;
  const audioSettingsWarning = realVoiceNeedsPerson ? t(voiceReferences.length ? "ai_generator_voice_choose_person" : "ai_generator_voice_photo_needed")
    : providedVoiceWithEmptyScript ? t("ai_generator_voice_exact_script_needed")
    : narrationVoiceMissing ? t("ai_generator_voice_pool_select_narration")
    : narrationVoiceTooShort ? t("ai_generator_narration_voice_reference_limits")
    : narrationVoiceUnauthorized ? t("ai_generator_narration_voice_consent_required")
    : characterVoiceSelection.missingSample ? t("ai_generator_character_voice_sample_missing")
    : characterVoiceSpeechConflict ? t("ai_generator_character_voice_speech_required")
    : characterVoiceDurationExceeded ? t("ai_generator_character_voice_wan3_duration_limit")
    : speechInvalid ? speechError : spokenScriptConflict ? t("ai_generator_spoken_script_silent_help") : "";
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
  }, quota, !durationUnavailable && referenceCompatible && briefCompatible && !providedVoiceWithEmptyScript && !narrationVoiceMissing && !narrationVoiceTooShort && !narrationVoiceUnauthorized && (kind !== "video" || !speechInvalid && !misplacedSpeechBlocking && promptReady));
  const creditInsufficient = creditQuote.insufficient;
  const modelRecommendation = recommendAiMediaModel({ kind, format: fixedFormat || format, operation: "generate", brief: effectivePrompt,
    ...(source === "studio" ? { recommendationContext: "studio-free" as const } : {}),
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
    !realVoiceNeedsPerson &&
    !providedVoiceWithEmptyScript &&
    !narrationVoiceMissing && !narrationVoiceTooShort && !narrationVoiceUnauthorized &&
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

  useEffect(() => { setMediaSettingsDialog(null); }, [kind]);

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
      setPendingReferenceRole(null);
      setSelectedReferenceId(null);
      referenceAction.current = null;
      setFormat(fixedFormat || (kind === "video" ? "story" : "square"));
      setDuration(8);
      setSceneMode("single");
      setWithMusic(true);
      setSoundtrackId(null);
      setVoiceSourcePreference("ai");
      setVoiceReferenceId(null);
      setNarrationVoiceMode("ai");
      setVoiceProfiles([]);
      setActiveNarrationVoiceId(null);
      setNarrationVoiceConsent(false);
      voiceModeIntent.current = null;
      voiceAction.current = null;
      setWithSubtitles(false);
      setSpeechMode("voiceover");
      setVoice("female");
      setVoiceVariant("Kore");
      setIdentityConsent(false);
      setTeamConsent(false);
      setLibraryOpen(false);
      setMediaSettingsDialog(null);
      setVoicePoolOpen(false);
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

  const addFiles = async (files: File[], lockOwned = false, requestedRole: MediaGenerationReferenceRole | null = pendingReferenceRole): Promise<boolean> => {
    if (!lockOwned && (locked || (operationInFlight.current && !recoveryPending))) return false;
    if (!requestedRole) { setActionError(t("ai_generator_reference_choose_role")); return false; }
    const currentSequence = sequence.current;
    const requestedVoiceMode = requestedRole === "character" ? voiceModeIntent.current : null;
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
        if (sequence.current !== currentSequence) return false;
        prepared.push({
          ...image,
          id: globalThis.crypto.randomUUID(),
          role: requestedRole,
          usage: requestedRole === "inspiration" ? "inspiration" : "required",
          fromVideo: false,
        });
      }
      if (!prepared.length) return false;
      const attachRequestedVoice = requestedVoiceMode === "provided" && voiceReferences.length === 0 && prepared.length === 1;
      if (attachRequestedVoice) {
        prepared[0].voiceMode = "provided";
        setVoiceReferenceId(prepared[0].id);
        voiceModeIntent.current = null;
        setSpeechMode("characters");
      }
      setReferences((current) =>
        [...current, ...prepared].slice(0, AI_MEDIA_INSPIRATION_MAX_COUNT)
      );
      resetConsent();
      setMediaSettingsDialog(null);
      return true;
    } catch (caught) {
      if (sequence.current === currentSequence)
        setActionError(
          caught instanceof StudioInspirationImageOnlyError
            ? t("ai_generator_inspiration_images_only")
            : caught instanceof Error
            ? caught.message
            : t("ai_generator_free_refs_error")
        );
      return false;
    } finally {
      if (sequence.current === currentSequence) {
        setReferencesBusy(false);
        operationInFlight.current = false;
      }
    }
  };

  const addLibraryFiles = async (items: MediaLibraryPickerItem[]) => {
    if (locked || (operationInFlight.current && !recoveryPending)) return;
    const requestedRole = pendingReferenceRole;
    if (!requestedRole) { setActionError(t("ai_generator_reference_choose_role")); return; }
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
      const added = await addFiles(files, true, requestedRole);
      if (sequence.current !== currentSequence) return;
      if (added) setLibraryOpen(false);
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
    patch: Partial<Pick<Reference, "role" | "usage" | "voiceMode" | "voiceSample">>,
    preserveIndependentVoice = true
  ) => {
    const previous = references.find((reference) => reference.id === id);
    const clearsVoice = (Object.hasOwn(patch, "role") && patch.role !== "character") || patch.voiceMode === "ai";
    if (previous?.voiceSample && !clearsVoice && Object.hasOwn(patch, "voiceSample") && previous.voiceSample.path !== patch.voiceSample?.path) {
      releaseUnusedVoiceSample(previous.voiceSample);
    }
    if (clearsVoice && preserveIndependentVoice) setVoiceProfiles(current => {
      const kept = current.map(profile => profile.target && profile.target !== "narration" && profile.target.characterId === id ? { ...profile, target: null } : profile);
      return previous?.voiceSample && !kept.some(profile => profile.sample.path === previous.voiceSample!.path) && kept.length < 3
        ? [...kept, { id: globalThis.crypto.randomUUID(), sample: previous.voiceSample, target: null, gender: "auto" as const }] : kept;
    });
    setReferences((current) =>
      current.map((reference) =>
        reference.id !== id
          ? reference
          : {
              ...reference,
              ...patch,
              ...(clearsVoice ? { voiceMode: "ai" as const, voiceSample: undefined } : {}),
              // Changing the subject type preserves the professional's choice
              // between a required reference and optional inspiration.
              ...(patch.role && !reference.usage
                ? { usage: "required" as const }
                : {}),
            }
      )
    );
    if (patch.voiceMode === "provided") setSpeechMode("characters");
    resetConsent();
  };

  const removeReference = (id: string) => {
    const previous = references.find(reference => reference.id === id);
    setVoiceProfiles(current => {
      const kept = current.map(profile => profile.target && profile.target !== "narration" && profile.target.characterId === id ? { ...profile, target: null } : profile);
      return previous?.voiceSample && !kept.some(profile => profile.sample.path === previous.voiceSample!.path) && kept.length < 3
        ? [...kept, { id: globalThis.crypto.randomUUID(), sample: previous.voiceSample, target: null, gender: "auto" as const }] : kept;
    });
    setReferences((current) => current.filter((reference) => reference.id !== id));
    resetConsent();
  };

  const chooseVoiceMode = (mode: "ai" | "provided") => {
    if (locked) return;
    if (speechMode === "voiceover") {
      setNarrationVoiceMode(mode);
      setNarrationVoiceConsent(false);
      resetConsent();
      setMediaSettingsDialog(null);
      return;
    }
    setVoiceSourcePreference(mode);
    voiceModeIntent.current = selectedVoiceReference ? null : mode;
    if (selectedVoiceReference) updateReference(selectedVoiceReference.id, { voiceMode: mode });
    else if (mode === "provided") { setSpeechMode("characters"); resetConsent(); }
    setMediaSettingsDialog(null);
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
      for (const reference of projectedReferences) if (reference.voiceSample?.path) submittedVoicePaths.current.add(reference.voiceSample.path);
      if (providedNarrationVoiceActive && narrationVoiceSample) submittedVoicePaths.current.add(narrationVoiceSample.path);
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
        ...(kind === "video" ? { soundtrackId: withMusic ? soundtrackId : null } : {}),
        ...(kind === "video" ? { withSubtitles: effectiveWithSubtitles } : {}),
        withNarration: effectiveWithNarration,
        narrationVoice: effectiveWithNarration ? voice : undefined,
        narrationVoiceVariant:
          effectiveWithNarration ? voiceVariant : undefined,
        ...(kind === "video" && speechMode === "voiceover" ? { narrationVoiceMode, narrationVoiceSample: providedNarrationVoiceActive ? narrationVoiceSample : undefined,
          narrationVoiceConsent: providedNarrationVoiceActive && narrationVoiceConsent, narrationVoiceGender: providedNarrationVoiceActive ? activeNarrationProfile?.gender ?? "auto" : undefined } : {}),
        videoEngine: selectedVideoEngine,
        teamVideoSpeechMode: kind === "video" ? requestSpeechMode : undefined,
        teamVideoMode: "cinematic",
        inspirationImages: referencesForRequest(projectedReferences, kind === "video" && speechMode === "characters"),
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

  const focusSettingsSection = (section: string) => {
    const target = document.getElementById(`${instanceId}-${section === "criteria" ? "media-tools" : "prompt"}`);
    target?.focus({ preventScroll: true });
    return Boolean(target && document.activeElement === target);
  };
  const isSettingsNavigationApplied = (encoded: string | null) => {
    if (!encoded) return false;
    let change: { field?: string; value?: string };
    try { change = JSON.parse(encoded); } catch { return false; }
    if (change.field !== "activeTab") return true;
    const target = document.getElementById(`${instanceId}-${change.value === "criteria" ? "media-tools" : "prompt"}`);
    return Boolean(target && document.activeElement === target);
  };
  const assistantFormSnapshot: InrAssistantStudioFormSnapshot = {
    mode: "free", kind, locked: operationLocked, editorVisible: editorAvailable && !stopConfirmOpen,
    fixedFormat, maxPromptLength: maxUserPromptLength, activeTab: activeSettingsTab, prompt, useBusinessDna, format,
    videoEngine: selectedVideoEngine, videoResolution, language: locale,
    durationScene: { seconds: duration, sceneMode }, speechMode, spokenScript, spokenScriptOpen,
    narrationVoice: voice, narrationVoiceVariant: voiceVariant, withMusic, withSubtitles,
    voiceMode: selectedVoiceMode, voiceReferenceId: selectedVoiceReference?.id,
    voiceReferences: speechMode === "characters" ? voiceReferences.map(reference => ({ id: reference.id, name: reference.name, voiceMode: reference.voiceMode ?? "ai", referenceIndex: references.findIndex(item => item.id === reference.id) })) : [],
  };
  const isVoiceSelectionApplied = (snapshot: unknown, encoded: string | null) => {
    if (!encoded) return false;
    let field: unknown; try { field = JSON.parse(encoded)?.field; } catch { return false; }
    if (field !== "voiceMode" && field !== "voiceReferenceId") return true;
    if (voiceAction.current?.encoded !== encoded || !snapshot || typeof snapshot !== "object") return false;
    const state = snapshot as { voiceReferenceId?: string | null; voiceReferences?: Array<{ id: string }> };
    return (state.voiceReferenceId ?? null) === voiceAction.current.targetId &&
      (voiceAction.current.targetId === null || state.voiceReferences?.some(reference => reference.id === voiceAction.current!.targetId) === true);
  };
  const committedFormSelectionMatches = (snapshot: unknown, encoded: string | null) => {
    let appliedValue = encoded;
    if (encoded && voiceAction.current?.encoded === encoded) {
      try {
        if (JSON.parse(encoded)?.field === "voiceReferenceId") appliedValue = JSON.stringify({ field: "voiceReferenceId", value: voiceAction.current.targetId });
      } catch { return false; }
    }
    return isInrAssistantStudioFormSelectionApplied(snapshot, appliedValue) && isSettingsNavigationApplied(encoded) && isVoiceSelectionApplied(snapshot, encoded);
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
          case "activeTab": if (!focusSettingsSection(change.value)) throw new Error("studio_section_unavailable"); setActiveSettingsTab(change.value); break;
          case "prompt": setPrompt(change.value); break;
          case "useBusinessDna": setUseBusinessDna(change.value); break;
          case "format": setFormat(change.value); break;
          case "durationScene": setDuration(change.value.seconds); setSceneMode(change.value.sceneMode); break;
          case "speechMode":
            if (change.value !== "characters" && !characterVoiceSelection.hasProvidedVoice) { voiceModeIntent.current = null; setVoiceSourcePreference("ai"); }
            setSpeechMode(change.value); resetConsent(); break;
          case "voiceMode": voiceAction.current = { encoded: encoded!, targetId: selectedVoiceReference?.id ?? null }; chooseVoiceMode(change.value); break;
          case "voiceReferenceId": voiceAction.current = { encoded: encoded!, targetId: change.value }; setVoiceReferenceId(change.value); break;
          case "spokenScript": setSpokenScript(change.value); break;
          case "spokenScriptOpen": setSpokenScriptOpen(change.value); if (!change.value) setSpokenScript(""); break;
          case "narrationVoice": setVoice(change.value); setVoiceVariant(defaultAiMediaNarrationVoiceVariant(change.value)); break;
          case "narrationVoiceVariant": setVoiceVariant(change.value); break;
          case "withMusic": setWithMusic(change.value); break;
          case "withSubtitles": setWithSubtitles(change.value); break;
          default: throw new Error("studio_form_unavailable");
        }
      },
      matches: committedFormSelectionMatches,
    },
  }, editorAvailable && !stopConfirmOpen, operationLocked);

  const referenceAddTitle = t(pendingReferenceRole ? `ai_generator_reference_add_${pendingReferenceRole}_title` : "ai_generator_reference_add_title");
  const addReferenceControls = (<div className={styles.mediaAddContent}>
            <div className={styles.mediaAddIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={REFERENCE_ROLE_PATHS[pendingReferenceRole ?? "inspiration"]} /></svg>
            </div>
            <div className={styles.mediaAddActions}>
              <label
                className={`${styles.importButton} ${styles.mediaAddOption}`}
                data-disabled={
                  locked || !pendingReferenceRole ||
                  references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT
                }
              >
                <span className={styles.mediaAddOptionIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg></span>
                {t("ai_generator_free_import")}
                <input
                  type="file"
                  multiple
                  accept={IMAGE_ACCEPT}
                  disabled={
                    locked || !pendingReferenceRole ||
                    references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT
                  }
                  onClick={() => { referenceImportIntent.current = pendingReferenceRole ? { role: pendingReferenceRole, sequence: sequence.current } : null; }}
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.currentTarget.value = "";
                    const intent = referenceImportIntent.current ?? (pendingReferenceRole ? { role: pendingReferenceRole, sequence: sequence.current } : null);
                    referenceImportIntent.current = null;
                    if (files.length && intent && intent.sequence === sequence.current) void addFiles(files, false, intent.role);
                  }}
                />
              </label>
              <button
                type="button"
                className={`${styles.secondaryButton} ${styles.mediaAddOption}`}
                disabled={
                  locked || !pendingReferenceRole ||
                  references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT
                }
                onClick={() => setLibraryOpen(true)}
              >
                <span className={styles.mediaAddOptionIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h7l2 2h9v13H3V5Zm4 7h10M7 16h7" /></svg></span>
                {t("ai_generator_free_library")}
              </button>
            </div>
            {referencesBusy ? (
              <p className={styles.muted} role="status">
                {t("ai_generator_free_refs_loading")}
              </p>
            ) : null}
            {actionError ? <p className={styles.videoFrameError} role="alert">{actionError}</p> : null}
          </div>);

  const referenceControls = (<div className={styles.referencesSection}>
            {references.length ? (
              <div className={styles.references} data-character-voices={kind === "video" ? "true" : undefined}>
                {references.map((reference, index) => (
                  <div id={`${instanceId}-reference-${reference.id}`} tabIndex={-1} className={styles.reference} key={reference.id} data-reference-id={reference.id} data-selected={selectedReferenceId === reference.id}>
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
                    <button type="button" className={styles.referenceInspirationToggle} data-reference-inspiration-toggle={reference.id}
                      aria-label={t("ai_generator_reference_inspiration_toggle", { index: index + 1 })} aria-pressed={reference.usage === "inspiration"} disabled={locked}
                      onClick={() => updateReference(reference.id, { usage: reference.usage === "inspiration" ? "required" : "inspiration" })}>
                      <span aria-hidden="true">{reference.usage === "inspiration" ? "✦" : "✧"}</span>{t("ai_generator_reference_inspiration")}
                    </button>
                    <small>{t(reference.usage === "inspiration" ? "ai_generator_free_usage_inspiration" : reference.usage === "required" ? "ai_generator_free_usage_required" : "ai_generator_free_reference_criteria_required")}</small>

                  </div>
                ))}
              </div>
            ) : null}
            {references.some((reference) => reference.fromVideo) ? (
              <p className={styles.muted}>
                {t("ai_generator_free_references_video_hint")}
              </p>
            ) : null}
            {referenceSettingsWarning && referenceSettingsWarning !== photoRequiredHint ? (
              <p className={styles.muted} role="alert">{referenceSettingsWarning}</p>
            ) : null}
          </div>);

  const audioControls = (<div className={styles.audioSection}>
              {audioSettingsWarning ? <p className={styles.muted} role="alert">{audioSettingsWarning}</p> : null}
              {characterVoiceSpeechConflict ? <button type="button" className={styles.secondaryButton} disabled={locked} onClick={() => setSpeechMode("characters")}>{t("ai_generator_character_voice_switch_characters")}</button> : null}
              {speechMode === "characters" && voiceReferences.length > 1 ? <label className={styles.voicePersonChoice}>
                <span>{t("ai_generator_voice_choose_person")}</span>
                <select id={`${instanceId}-voice-character`} value={selectedVoiceReference?.id ?? ""} disabled={locked}
                  onChange={event => {
                    const target = voiceReferences.find(reference => reference.id === event.target.value);
                    if (!target) return;
                    setVoiceReferenceId(target.id);
                    const intendedMode = voiceModeIntent.current;
                    voiceModeIntent.current = null;
                    if (intendedMode) updateReference(target.id, { voiceMode: intendedMode });
                    else setVoiceSourcePreference(target.voiceMode ?? "ai");
                  }}>
                  <option value="" disabled>{t("ai_generator_voice_choose_person")}</option>
                  {voiceReferences.map(reference => <option key={reference.id} value={reference.id}>{reference.name}</option>)}
                </select>
              </label> : null}
              {speechMode === "characters" && voiceSourcePreference === "provided" && !voiceReferences.length ? <button type="button" className={styles.secondaryButton} disabled={locked}
                onClick={() => { setPendingReferenceRole("character"); setSelectedReferenceId(null); setMediaSettingsDialog("images"); }}>{t("ai_generator_add_reference_character")}</button> : null}

              {speechMode === "characters" ? (
                <p className={styles.muted} role="note">
                  {t("ai_generator_essential_character_speech_notice")}
                </p>
              ) : null}
              {speechMode === "voiceover" && narrationVoiceMode === "ai" ? (
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
            </div>);

  const libraryPicker = (<MediaLibraryPickerModal
        open={libraryOpen}
        title={t("ai_generator_video_images_dialog_title")}
        subtitle={t("ai_generator_free_references_hint", { count: AI_MEDIA_INSPIRATION_MAX_COUNT })}
        accept="image"
        multiple
        maxSelection={Math.max(
          1,
          AI_MEDIA_INSPIRATION_MAX_COUNT - references.length
        )}
        confirmLabel={t("ai_generator_inspiration_library_confirm")}
        onClose={() => setLibraryOpen(false)}
        onConfirm={addLibraryFiles}
      />);

  const engineControls = !editorAvailable ? null : (
    <MediaEngineCreditControls kind={kind} format={fixedFormat || format} videoEngine={selectedVideoEngine}
            imageEngine={enginePreference.imageEngine} resolution={videoResolution}
            durationSeconds={duration} sceneMode={sceneMode} automaticSceneMode={source === "studio"} onDurationSceneChange={(seconds, mode) => { setDuration(seconds); setSceneMode(mode); }} videoMaxDurationSeconds={maxDuration}
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
          <div className={editorStyles.settingsPanels}>

        <section
          className={`${styles.promptPanel} ${editorStyles.tabPanel}`}
          data-spoken-script-open={exactSpeechEditorVisible}
          id={`${instanceId}-panel-prompt`}
        >
          <div className={styles.videoBriefFrame} data-media-brief-frame data-video-brief-frame={kind === "video" ? true : undefined}>
          <div className={styles.videoFrameHeading}>
            <label htmlFor={`${instanceId}-prompt`}>{t(kind === "video" ? "ai_generator_video_visual_brief_title" : "ai_generator_free_prompt_label")}</label>
            <div className={styles.videoBriefHeadingHelp}>
              {kind === "video" ? <p id={`${instanceId}-visual-brief-help`}>{t("ai_generator_video_visual_brief_hint_short")}</p> : null}
              <MediaPromptHelp kind={kind} />
            </div>
          </div>
          <div className={styles.promptContainer} data-invalid={kind === "video" && (prompt.length > maxUserPromptLength || misplacedSpeechBlocking) ? true : undefined}>
            <textarea
              id={`${instanceId}-prompt`}
              value={prompt}
              maxLength={kind === "video" ? undefined : maxUserPromptLength}
              disabled={operationLocked}
              readOnly={voiceBusy}
              title={promptWarning || undefined}
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
              {kind === "video" ? <div className={styles.videoBriefFeedback}>
                <span className={styles.videoBriefFeedbackSizer} aria-hidden="true">{t("ai_generator_video_brief_too_long", { max: maxUserPromptLength })}</span>
                <span className={styles.videoBriefFeedbackSizer} aria-hidden="true">{t("ai_generator_video_speech_move")}</span>
                <span className={styles.videoBriefFeedbackSizer} aria-hidden="true">{t("ai_generator_video_speech_override_notice")}</span>
                {prompt.length > maxUserPromptLength ? <p id={`${instanceId}-visual-brief-error`} className={styles.videoFrameError} role="alert">
                  {t("ai_generator_video_brief_too_long", { max: maxUserPromptLength })}
                </p> : misplacedSpeechBlocking ? <p id={`${instanceId}-visual-brief-error`} className={styles.videoFrameError} role="alert">{t("ai_generator_video_speech_move")}</p>
                  : misplacedSpeech && spokenScriptOpen ? <p className={styles.promptHelp}>{t("ai_generator_video_speech_override_notice")}</p> : null}
              </div> : null}
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
          </div>
          <div id={`${instanceId}-media-tools`} className={styles.videoTools} data-media-tools tabIndex={-1} role="group" aria-label={t("ai_generator_editor_tab_criteria")}>
            <div className={styles.mediaFormatRow}>
              <label className={styles.videoFormatControl} htmlFor={`${instanceId}-media-format`}><span className={styles.mediaToolsTitle}>{t("ai_generator_free_format_label")}</span>
                <select id={`${instanceId}-media-format`} value={format} disabled={locked || Boolean(fixedFormat)} onChange={event => setFormat(event.target.value as MediaGenerationFormat)}>
                  {FORMATS.filter(option => !fixedFormat || option.id === fixedFormat).map(option => <option key={option.id} value={option.id}>{t(`ai_generator_format_${option.id}`)} · {option.ratio}</option>)}
                </select>
              </label>
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
              </div>
            </div>
            <div className={styles.referenceAddControl}>
              <span id={`${instanceId}-add-media-title`} className={styles.mediaToolsTitle}>{t("ai_generator_add_media_title")}</span>
              <div className={styles.referenceRoleToolbar} role="group" aria-labelledby={`${instanceId}-add-media-title`}>
              {(["inspiration", "character", "environment", "product"] as const).map(role => {
                const label = t(role === "inspiration" ? "ai_generator_reference_inspiration" : role === "character" ? "ai_generator_add_reference_character" : `ai_generator_free_role_${role}`);
                const roleWarning = !operationLocked && roleLimitExceeded && role === "character" ? referenceSettingsWarning : "";
                const tooltip = visibleReferenceWarning ? `${label} — ${visibleReferenceWarning}` : label;
                return <button key={role} type="button" className={styles.referenceRoleButton} data-media-role-add={role}
                  data-invalid={Boolean(roleWarning) || undefined}
                  disabled={locked || !referencePickerVisible || references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT}
                  aria-label={label} title={tooltip} data-inrcy-tooltip-title={tooltip} aria-haspopup="dialog" aria-expanded={mediaSettingsDialog === "images" && pendingReferenceRole === role}
                  aria-controls={mediaSettingsDialog === "images" ? `${instanceId}-media-images-dialog` : undefined}
                  aria-describedby={visibleReferenceWarning ? `${instanceId}-media-images-warning` : undefined}
                  onClick={() => { setPendingReferenceRole(role); setSelectedReferenceId(null); setActionError(""); setMediaSettingsDialog("images"); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={REFERENCE_ROLE_PATHS[role]} /></svg>
                  <span className={styles.referenceRoleLabel}>{label}</span>
                  {roleWarning ? <span className={styles.referenceIconWarning} aria-hidden="true">!</span> : null}
                </button>;
              })}
              {kind === "video" ? <button type="button" className={styles.referenceRoleButton} data-video-music-button disabled={locked || !editorAvailable || stopConfirmOpen}
                aria-label={t("ai_generator_music_title")} title={t("ai_generator_music_title")} data-inrcy-tooltip-title={t("ai_generator_music_title")} aria-haspopup="dialog" aria-expanded={mediaSettingsDialog === "music"}
                aria-controls={mediaSettingsDialog === "music" ? `${instanceId}-video-music-dialog` : undefined}
                onClick={() => setMediaSettingsDialog("music")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13M9 8l12-2M9 18c0 1.7-1.8 3-4 3s-4-1.3-4-3 1.8-3 4-3 4 1.3 4 3Zm12-2c0 1.7-1.8 3-4 3s-4-1.3-4-3 1.8-3 4-3 4 1.3 4 3Z" /></svg>
                <span className={styles.referenceRoleLabel}>{t("ai_generator_music_title")}</span>
              </button> : null}
              </div>
            </div>
            {visibleReferenceWarning ? <p id={`${instanceId}-media-images-warning`} className={styles.referenceWarning} data-reference-warning role={referencePhotoMissing ? "status" : "alert"}>
              <span className={styles.referenceWarningIcon} aria-hidden="true">!</span><span>{visibleReferenceWarning}</span>
            </p> : null}
            {!operationLocked && audioSettingsWarning ? <span id={`${instanceId}-video-audio-warning`} className={styles.srOnly}>{audioSettingsWarning}</span> : null}
          </div>
          {references.length ? <div className={styles.mediaReferenceThumbs} data-media-reference-thumbnails role="list" aria-label={t("ai_generator_free_references_title")}>
            {references.map((reference, index) => <div key={reference.id} className={styles.mediaReferenceThumb} data-usage={reference.usage}
              data-invalid={!operationLocked && (!reference.role || !reference.usage || roleLimitExceeded && reference.role === "character") || undefined} role="listitem">
              <button type="button" className={styles.mediaReferenceOpen} data-media-reference-open={index} disabled={locked}
                aria-label={`${t("ai_generator_free_reference", { index: index + 1 })} · ${reference.name} · ${t(reference.usage === "inspiration" ? "ai_generator_free_usage_inspiration" : reference.usage === "required" ? "ai_generator_free_usage_required" : "ai_generator_free_reference_criteria_required")}`}
                title={!operationLocked && (!reference.role || !reference.usage || roleLimitExceeded && reference.role === "character") ? `${reference.name} — ${visibleReferenceWarning}` : reference.name}
                aria-describedby={!operationLocked && (!reference.role || !reference.usage || roleLimitExceeded && reference.role === "character") ? `${instanceId}-media-images-warning` : undefined}
                aria-haspopup="dialog" onClick={() => { setSelectedReferenceId(reference.id); setPendingReferenceRole(reference.role ?? null); setMediaSettingsDialog("images"); }}>
                <img src={`data:${reference.mimeType};base64,${reference.data}`} alt="" />
              </button>
              <button type="button" className={styles.mediaReferenceOptional} data-reference-inspiration-toggle={reference.id} disabled={locked}
                aria-label={t("ai_generator_reference_inspiration_toggle", { index: index + 1 })} title={t("ai_generator_reference_inspiration_toggle", { index: index + 1 })}
                aria-pressed={reference.usage === "inspiration"} onClick={() => updateReference(reference.id, { usage: reference.usage === "inspiration" ? "required" : "inspiration" })}><span aria-hidden="true">{reference.usage === "inspiration" ? "✦" : "✧"}</span></button>
            </div>)}
          </div> : null}
          {kind === "video" ? <div className={styles.spokenScriptSection} data-exact={exactSpeechEditorVisible}>
            <div className={styles.spokenScriptPanel} data-video-speech-frame data-invalid={speechInvalid ? true : undefined}>
              <div className={`${styles.spokenScriptHeading} ${styles.videoSpeechModeRow}`} data-silent={speechMode === "silent"}>
                <div className={styles.videoFrameHeading}>
                  <div className={styles.videoSpeechTitleRow}>
                    <label htmlFor={`${instanceId}-${speechMode === "silent" ? "video-speech-mode" : exactSpeechEditorVisible ? "spoken-script" : "spoken-script-mode"}`}>{t("ai_generator_video_sound_and_speech_title")}</label>
                  </div>
                  <p id={`${instanceId}-spoken-script-help`} className={styles.srOnly}>{t("ai_generator_video_speech_frame_hint_short")}</p>
                </div>
                <label className={styles.speechSelectField} htmlFor={`${instanceId}-video-speech-mode`}>
                <span>{t("ai_generator_free_audio_characters")}</span>
                <select id={`${instanceId}-video-speech-mode`} className={styles.spokenScriptModeSelect} value={speechMode} disabled={locked}
                  aria-describedby={hasSpokenScript ? `${instanceId}-speech-mode-help` : undefined}
                  onChange={event => {
                    const mode = event.target.value as typeof speechMode;
                    if (mode === "silent" && hasSpokenScript) return;
                    if (mode !== "characters" && !characterVoiceSelection.hasProvidedVoice) { voiceModeIntent.current = null; setVoiceSourcePreference("ai"); }
                    setSpeechMode(mode); resetConsent();
                  }}>
                  {(["voiceover", "characters", "silent"] as const).map(mode => <option key={mode} value={mode} disabled={mode === "silent" && hasSpokenScript}>{t(`ai_generator_free_audio_${mode}`)}</option>)}
                </select>
                </label>
                <label className={styles.speechSelectField} htmlFor={`${instanceId}-spoken-script-mode`}>
                <span>{t("ai_generator_speech_menu_label")}</span>
                <select
                  id={`${instanceId}-spoken-script-mode`}
                  className={styles.spokenScriptModeSelect}
                  value={spokenScriptOpen ? "exact" : "automatic"}
                  disabled={locked || speechMode === "silent"}
                  aria-label={`${t("ai_generator_video_speech_automatic")} / ${t("ai_generator_video_speech_exact")}`}
                  aria-controls={`${instanceId}-spoken-script-panel`}
                  aria-describedby={`${instanceId}-spoken-script-help`}
                  onChange={(event) => {
                    if (event.target.value === "exact") {
                      setSpokenScriptOpen(true);
                      window.requestAnimationFrame(() => document.getElementById(`${instanceId}-spoken-script`)?.focus({ preventScroll: true }));
                    } else {
                      setSpokenScript("");
                      setSpokenScriptOpen(false);
                    }
                  }}
                >
                  <option value="automatic">{t("ai_generator_video_speech_automatic")}</option>
                  <option value="exact">{t("ai_generator_video_speech_exact")}</option>
                </select>
                </label>
                <div className={`${styles.speechSelectField} ${styles.voiceSourceField}`}>
                  <div className={styles.voiceMenuHeading}>
                    <label htmlFor={`${instanceId}-video-voice-mode`}>{t("ai_generator_narration_voice_label")}</label>
                  </div>
                  <select id={`${instanceId}-video-voice-mode`} className={styles.spokenScriptModeSelect} value={selectedVoiceMode} disabled={locked || speechMode === "silent"}
                    aria-describedby={audioSettingsWarning ? `${instanceId}-video-audio-warning` : undefined}
                    onChange={event => chooseVoiceMode(event.target.value === "provided" ? "provided" : "ai")}>
                    <option value="ai">{t("ai_generator_character_voice_ai")}</option>
                    <option value="provided">{t("ai_generator_voice_real")}</option>
                  </select>
                  {selectedVoiceMode === "ai" && (speechMode === "silent" || aiVoiceSettingsAvailable) ? <button type="button" className={styles.voiceSettingsMain} data-video-audio-button disabled={locked || speechMode === "silent"}
                    aria-haspopup="dialog" aria-expanded={mediaSettingsDialog === "audio"} aria-controls={mediaSettingsDialog === "audio" ? `${instanceId}-video-audio-dialog` : undefined}
                    onClick={() => setMediaSettingsDialog("audio")}>{t("ai_generator_voice_details")}</button> : null}
                  <StudioVoicePool scopeKey={quota?.accountId ?? ""} visible={speechMode !== "silent" && selectedVoiceMode === "provided"}
                    available={!mediaSettingsDialog && !libraryOpen && !stopConfirmOpen} onOpenChange={setVoicePoolOpen}
                    profiles={voiceProfiles} onChange={setVoiceProfiles} characters={voiceReferences.map(reference => ({ id: reference.id, name: reference.name, referenceIndex: references.findIndex(item => item.id === reference.id) }))}
                    selectedCharacterId={selectedVoiceReference?.id ?? null} speechMode={speechMode}
                    activeNarrationVoiceId={activeNarrationVoiceId} onNarrationChange={id => { if (id !== activeNarrationVoiceId) setNarrationVoiceConsent(false); setActiveNarrationVoiceId(id); }}
                    narrationConsent={narrationVoiceConsent} onNarrationConsentChange={setNarrationVoiceConsent} disabled={locked} onBusyChange={setCharacterVoiceBusy}
                    onAssignCharacter={id => updateReference(id, { voiceMode: "provided" })} onUnassignCharacter={id => updateReference(id, { voiceMode: "ai" }, false)}
                    releaseSample={releaseUnusedVoiceSample} />
                </div>
                <label className={styles.inlineSubtitles}>
                  <input type="checkbox" checked={withSubtitles} disabled={locked || speechMode === "silent"}
                    data-media-subtitles onChange={event => setWithSubtitles(event.target.checked)} />
                  <span>{t("ai_generator_free_subtitles")}</span>
                </label>
              </div>
              {providedVoiceWithEmptyScript ? <p className={styles.referenceWarning} data-video-voice-script-warning role="alert">{t("ai_generator_voice_exact_script_needed")}</p> : null}
              {providedNarrationVoiceActive && audioSettingsWarning && !providedVoiceWithEmptyScript ? <p className={styles.referenceWarning} role="alert">{audioSettingsWarning}</p> : null}
              {hasSpokenScript ? <p id={`${instanceId}-speech-mode-help`} className={styles.srOnly}>{t("ai_generator_spoken_script_remove_for_silent")}</p> : null}
              <div id={`${instanceId}-spoken-script-panel`} className={styles.spokenScriptContent}>
              {exactSpeechEditorVisible ? <>
              <div className={styles.spokenScriptInput}>
                <textarea id={`${instanceId}-spoken-script`} value={spokenScript}
                  disabled={locked}
                  aria-invalid={speechInvalid ? true : undefined}
                  aria-describedby={`${instanceId}-spoken-script-help ${instanceId}-spoken-script-count ${instanceId}-spoken-script-budget${speechInvalid ? ` ${instanceId}-spoken-script-error` : ""}`}
                  placeholder={t("ai_generator_spoken_script_placeholder")}
                  onChange={(event) => { setSpokenScriptOpen(true); setSpokenScript(event.target.value); }} />
                <span id={`${instanceId}-spoken-script-count`} className={styles.spokenScriptCounter} aria-live="polite">
                  {t("ai_generator_video_speech_count", { count: speechState.units.toLocaleString(locale), max: speechState.maxUnits.toLocaleString(locale), unit: speechUnit })}
                  {" · "}{t("ai_generator_video_speech_character_count", { count: speechState.characters.toLocaleString(locale), max: speechState.maxCharacters.toLocaleString(locale) })}
                </span>
              </div>
              <p id={`${instanceId}-spoken-script-budget`} className={explicitlyEmptySpokenScript ? styles.promptHelp : styles.srOnly}
                title={explicitlyEmptySpokenScript ? t("ai_generator_video_speech_empty") : t("ai_generator_video_speech_budget", { seconds: duration, model: videoModel.label })}>
                <span aria-hidden="true">{explicitlyEmptySpokenScript ? t("ai_generator_video_speech_empty_short") : t("ai_generator_video_speech_budget_short", { seconds: duration, model: videoModel.label })}</span>
                <span className={styles.srOnly}>{explicitlyEmptySpokenScript ? t("ai_generator_video_speech_empty") : t("ai_generator_video_speech_budget", { seconds: duration, model: videoModel.label })}</span>
              </p>
              </> : speechMode !== "silent" ? <p className={styles.promptHelp}>{t("ai_generator_video_speech_automatic_hint")}</p> : null}
              {!spokenScriptOpen && speechState.script ? <p className={styles.promptHelp}>{t("ai_generator_video_speech_legacy")}</p> : null}
              {(exactSpeechEditorVisible || Boolean(speechState.script)) && speechState.segmentBudgets.length > 1 && speechMode === "characters" ? <div className={styles.speechSegments}>
                {speechState.segmentBudgets.map((segment, index) => <span key={index} data-invalid={segment.issue ? true : undefined}>
                  {t("ai_generator_video_speech_segment", { index: index + 1, seconds: segment.durationSeconds, count: segment.units.toLocaleString(locale), max: segment.maxUnits.toLocaleString(locale), unit: speechUnit })}
                </span>)}
              </div> : null}
              {speechInvalid ? <p id={`${instanceId}-spoken-script-error`} className={styles.videoFrameError} role="alert">{speechError}</p> : null}
              </div>
            </div>
          </div> : <p id={`${instanceId}-prompt-help`} className={styles.srOnly}>
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
      {mediaSettingsDialog === "images" ? <MediaSettingsDialog id={`${instanceId}-media-images-dialog`} kind="images" title={selectedReferenceId ? t("ai_generator_video_images_dialog_title") : referenceAddTitle} addRole={selectedReferenceId ? undefined : pendingReferenceRole ?? "inspiration"} closeLabel={t("ai_generator_video_settings_close")} closeBlocked={locked || libraryOpen} initialFocusId={selectedReferenceId ? `${instanceId}-reference-${selectedReferenceId}` : undefined} onClose={() => setMediaSettingsDialog(null)}>
        {selectedReferenceId ? referenceControls : addReferenceControls}
        {libraryPicker}
      </MediaSettingsDialog> : null}
      {kind === "video" ? <StudioMusicLibrary withMusic={withMusic} soundtrackId={soundtrackId} scopeKey={quota?.accountId ?? ""} disabled={locked}
        open={mediaSettingsDialog === "music"} available={editorAvailable && !stopConfirmOpen && !libraryOpen && !voicePoolOpen && Boolean(quota?.accountId)}
        onOpen={() => setMediaSettingsDialog("music")} onClose={() => setMediaSettingsDialog(null)}
        onChange={(enabled, id) => { setWithMusic(enabled); setSoundtrackId(id); }}
        renderDialog={content => <MediaSettingsDialog id={`${instanceId}-video-music-dialog`} kind="music" title={t("ai_generator_music_title")} closeLabel={t("ai_generator_video_settings_close")} closeBlocked={locked} onClose={() => setMediaSettingsDialog(null)}>{content}</MediaSettingsDialog>} /> : null}
      {kind === "video" && mediaSettingsDialog === "audio" ? <MediaSettingsDialog id={`${instanceId}-video-audio-dialog`} kind="audio" title={t("ai_generator_narration_voice_label")} closeLabel={t("ai_generator_video_settings_close")} closeBlocked={locked} onClose={() => setMediaSettingsDialog(null)}>
        {audioControls}
      </MediaSettingsDialog> : null}
    </div>
  );
}
