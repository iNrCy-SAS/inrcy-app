"use client";
import usePaidMediaAction from "../_hooks/usePaidMediaAction";
import { getClientUserFacingErrorMessage as getSafeClientErrorMessage } from "@/lib/userFacingErrors";
import { getClientAiMediaGenerationErrorMessage } from "@/lib/aiMediaGenerationPublicErrorI18n";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useInrAssistantLocalInterface } from "../_hooks/useInrAssistantLocalInterface";
import { parseInrAssistantStudioFormSelection, isInrAssistantStudioFormSelectionApplied, type InrAssistantStudioFormSnapshot } from "@/lib/inrAssistantStudioFormSelection";
import useMediaGeneration, {
  MediaGenerationAccountChangedError,
  MediaGenerationCancelledError,
  type MediaGenerationFormat,
  type MediaGenerationKind,
  type MediaGenerationNarrationVoice,
  type MediaGenerationNarrationVoiceVariant,
  type MediaGenerationReferenceRole,
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
import { hydrateStudioReferenceMemory, prepareStudioReferenceMemory, requestStudioReferenceMemory, studioReferenceDraftFingerprint, studioSavedReferenceFingerprint, publishStudioReferenceMemoryMetadata, readStudioReferenceMemoryMetadata, STUDIO_REFERENCE_MEMORY_EVENT, type StudioReferenceMemoryMetadata, type StudioMemoryReference, type StudioReferenceDraft } from "@/lib/studioReferenceMemoryClient";
import { uploadFileToMediaLibrary } from "@/lib/mediaLibraryUploadClient";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "./MediaLibraryPickerModal";
import MediaSubjectVoiceButton from "./MediaSubjectVoiceButton";
import StudioMusicLibrary from "./StudioMusicLibrary";
import StudioVoicePool, { type StudioVoiceProfile } from "./StudioVoicePool";
import StudioExactDialogueEditor from "./StudioExactDialogueEditor";
import { initializeMediaExactDialogueRows, projectMediaExactDialogueRows, mergeMediaExactDialogueRows, serializeMediaExactDialogueRows, buildMediaExactDialogueCharacters, getMediaExactDialogueDisplayBudget, type MediaExactDialogueRow, type MediaExactDialogueCharacter } from "@/lib/mediaExactDialogueEditor";
import { deleteCharacterVoiceSample, getCharacterVoiceSelectionState } from "@/lib/aiMediaCharacterVoiceClient";
import { AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES, AI_MEDIA_NARRATION_VOICE_MIN_SECONDS, exceedsAiMediaCharacterVoiceEngineDuration, hasTooShortAiMediaCharacterVoice, isAiMediaCharacterVoiceEngine, normalizeAiMediaCharacterName } from "@/lib/aiMediaCharacterVoices";
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
import { getMediaVideoDurationChoices, getMediaVideoContextResolution, getAiMediaVideoReferenceCompatibilityIssue, isMediaVideoBriefCompatible } from "@/lib/aiMediaVideoClientOptions";
import { recommendAiMediaModel } from "@/lib/aiMediaModelRecommendation";
import type { StudioWorkingPanel } from "@/lib/inrStudioWorkingDraft";
import styles from "./MediaFreeGenerator.module.css";

type Props = {
  source: MediaGenerationSource;
  acceptMode: "library" | "insert";
  mediaType?: MediaGenerationKind;
  imageOnly?: boolean;
  initialPrompt?: string;
  publicationSubject?: string;
  /** Studio shares only this editable brief; media settings and jobs stay local. */
  sharedPrompt?: string;
  onSharedPromptChange?: (prompt: string) => void;
  requiredPromptSuffix?: string;
  fixedFormat?: MediaGenerationFormat;
  onAccepted: (result: MediaGenerationResult) => void | Promise<void>;
  onResultChange?: (result: MediaGenerationResult | null) => void;
  onBusyChange?: (busy: boolean) => void;
  initialWorkingPanel?: StudioWorkingPanel;
  onWorkingPanelChange?: (kind: MediaGenerationKind, panel: StudioWorkingPanel | null) => void;
  onPendingRecoveryChange?: (pending: boolean) => void;
  /** Select the owning panel before recovering; changing it afterwards hides its result. */
  onRecoveryKind?: (kind: MediaGenerationKind) => void;
  onReset?: () => void;
};

type Reference = StudioMemoryReference;
type ReferenceMemoryState = { scopeKey: string; loaded: boolean; busy: boolean; saved: boolean; revision: number;
  lastAction: "remember" | "forget" | null; fingerprint: string; error: "" | "load" | "save" | "forget" };
const emptyReferenceMemory = (scopeKey: string): ReferenceMemoryState => ({ scopeKey, loaded: false, busy: false, saved: false,
  revision: 0, lastAction: null, fingerprint: "", error: "" });

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

function referencesForRequest(references: Reference[], includeCharacterVoices = true, exactCharacters?: readonly MediaExactDialogueCharacter[]) {
  let characterIndex = 0;
  return references.map(({ id: _id, fromVideo: _fromVideo, libraryMediaId: _libraryMediaId, ...savedReference }) => {
    const { voiceMode: _voiceMode, voiceSample: _voiceSample, ...imageOnlyReference } = savedReference;
    const reference = includeCharacterVoices ? savedReference : imageOnlyReference;
    const exact = exactCharacters?.find(character => character.id === _id);
    if (exact) return { ...reference, characterIndex: exact.characterIndex };
    if (exactCharacters && reference.role === "character") return { ...reference, characterIndex: undefined };
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
  publicationSubject,
  sharedPrompt,
  onSharedPromptChange,
  requiredPromptSuffix = "",
  fixedFormat,
  onAccepted,
  onResultChange,
  onBusyChange,
  initialWorkingPanel,
  onWorkingPanelChange,
  onPendingRecoveryChange,
  onRecoveryKind,
  onReset,
}: Props) {
  const { paidActionsLocked, subscriptionLabel, subscriptionMessage, openSubscription } = usePaidMediaAction();
  const i18nT = useTranslations("shell");
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
  const [spokenScript, setSpokenScript] = useState(initialWorkingPanel?.spokenScript ?? "");
  const [spokenScriptOpen, setSpokenScriptOpen] = useState(initialWorkingPanel?.spokenScriptOpen ?? false);
  const [exactRows, setExactRows] = useState<MediaExactDialogueRow[]>(initialWorkingPanel?.exactRows ?? []);
  const [exactDialogueOpen, setExactDialogueOpen] = useState(false);
  const [legacyExactImported, setLegacyExactImported] = useState(Boolean(initialWorkingPanel?.exactRows.length));
  const [useBusinessDna, setUseBusinessDna] = useState(initialWorkingPanel?.useBusinessDna ?? true);
  const [format, setFormat] = useState<MediaGenerationFormat>(
    fixedFormat || initialWorkingPanel?.format || (kind === "video" ? "story" : "square")
  );
  const [duration, setDuration] = useState<MediaGenerationVideoDuration>(initialWorkingPanel?.duration ?? 8);
  const [sceneMode, setSceneMode] = useState<MediaGenerationVideoSceneMode>(initialWorkingPanel?.sceneMode ?? "single");
  const [references, setReferences] = useState<Reference[]>(initialWorkingPanel?.references ?? []);
  const [pendingReferenceRole, setPendingReferenceRole] = useState<MediaGenerationReferenceRole | null>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [withMusic, setWithMusic] = useState(initialWorkingPanel?.withMusic ?? true);
  const [soundtrackId, setSoundtrackId] = useState<string | null>(initialWorkingPanel?.soundtrackId ?? null);
  const [voiceSourcePreference, setVoiceSourcePreference] = useState<"ai" | "provided">(initialWorkingPanel?.voiceSourcePreference ?? "ai");
  const [voiceReferenceId, setVoiceReferenceId] = useState<string | null>(initialWorkingPanel?.voiceReferenceId ?? null);
  const narrationVoiceMode = voiceSourcePreference;
  const [voiceProfiles, setVoiceProfiles] = useState<StudioVoiceProfile[]>(initialWorkingPanel?.voices ?? []);
  const [activeNarrationVoiceId, setActiveNarrationVoiceId] = useState<string | null>(initialWorkingPanel?.activeNarrationVoiceId ?? null);
  const [narrationVoiceConsent, setNarrationVoiceConsent] = useState(false);
  const [withSubtitles, setWithSubtitles] = useState(initialWorkingPanel?.withSubtitles ?? false);
  const [speechMode, setSpeechMode] =
    useState<"voiceover" | "characters" | "silent">(initialWorkingPanel?.speechMode ?? "voiceover");
  const exactSpeechEditorVisible = kind === "video" && spokenScriptOpen;
  const exactSpeechActive = exactSpeechEditorVisible && speechMode !== "silent";
  const explicitlyEmptySpokenScript = exactSpeechActive && !exactRows.some(row => row.text.trim());
  const [voice, setVoice] = useState<MediaGenerationNarrationVoice>(initialWorkingPanel?.voice ?? "female");
  const [voiceVariant, setVoiceVariant] =
    useState<MediaGenerationNarrationVoiceVariant>(initialWorkingPanel?.voiceVariant ?? "Kore");
  const [identityConsent, setIdentityConsent] = useState(false);
  const [teamConsent, setTeamConsent] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [characterVoiceBusy, setCharacterVoiceBusy] = useState(false);
  const [referencesBusy, setReferencesBusy] = useState(false);
  const [referenceMemoryState, setReferenceMemoryState] = useState<ReferenceMemoryState>(() => emptyReferenceMemory(""));
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
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const speechInputRef = useRef<HTMLTextAreaElement>(null);
  const operationInFlight = useRef(false);
  const referenceSetId = useRef("");
  const submittedVoicePaths = useRef(new Set<string>());
  const referenceImportIntent = useRef<{ role: MediaGenerationReferenceRole; sequence: number } | null>(null);
  const referenceAction = useRef<{ encoded: string; id: string; usage?: "required" | "inspiration" } | null>(null);
  const voiceAction = useRef<{ encoded: string; targetId: string | null } | null>(null);
  const referenceMemoryController = useRef<AbortController | null>(null);
  const referenceMemoryLoadedAccount = useRef<string | null>(null);
  const voiceSelectionRevision = useRef(0);
  const referenceMemoryAction = useRef<{ value: "remember" | "forget"; scopeKey: string; revision: number } | null>(null);
  const referenceMemoryCurrent = useRef<{ accountId: string; draft: StudioReferenceDraft }>({ accountId: "", draft: { references: [], voices: [], activeNarrationVoiceId: null } });
  referenceMemoryCurrent.current = { accountId: quota?.accountId ?? "", draft: { references, voices: voiceProfiles, activeNarrationVoiceId } };
  const referenceMemory = referenceMemoryState.scopeKey === quota?.accountId ? referenceMemoryState : emptyReferenceMemory(quota?.accountId ?? "");
  const referenceMemoryFingerprint = studioReferenceDraftFingerprint(referenceMemoryCurrent.current.draft);
  const referenceMemoryDirty = referenceMemory.saved && referenceMemory.fingerprint !== referenceMemoryFingerprint;
  const operationLocked = cancellationPending || ((busy || finishing) && !recovering) || voiceBusy || referencesBusy || characterVoiceBusy || referenceMemory.busy;
  const locked = operationLocked;
  const releaseUnusedVoiceSample = (sample: Parameters<typeof deleteCharacterVoiceSample>[0]) => {
    // A submitted request owns its original audio even if the next draft is
    // edited or recovery is paused. Existing storage expiry cleans it later.
    if (sample && !recoveryPending && !submittedVoicePaths.current.has(sample.path)) void deleteCharacterVoiceSample(sample);
  };
  const referencePickerVisible = editorAvailable && !stopConfirmOpen && !voicePoolOpen && !exactDialogueOpen;
  const voiceReferences = references.filter(reference => reference.role === "character");
  // Global generation intent is independent of the saved photo/voice bindings.
  const voiceConfigurationMode = speechMode;
  const selectedVoiceReference = voiceConfigurationMode === "characters" ? voiceReferences.find(reference => reference.id === voiceReferenceId) ?? (!voiceReferenceId && voiceReferences.length === 1 ? voiceReferences[0] ?? null : null) : null;
  const selectedVoiceMode = voiceSourcePreference;
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
      if (usage && (mediaSettingsDialog !== "images" || selectedReferenceId !== reference.id)) throw new Error("studio_reference_unavailable");
      referenceAction.current = { encoded: value!, id: reference.id, usage };
      if (usage) updateReference(reference.id, { usage });
      else { setSelectedReferenceId(reference.id); setPendingReferenceRole(reference.role ?? null); setMediaSettingsDialog("images"); }
    }, matches: (state, value) => {
      const action = referenceAction.current;
      if (!action || action.encoded !== value || !state || typeof state !== "object") return false;
      const current = state as { open?: boolean; selectedReferenceId?: string; references?: Array<{ id: string; usage?: string }> };
      const reference = current.references?.find(item => item.id === action.id);
      return Boolean(reference && current.open && current.selectedReferenceId === action.id && (!action.usage || reference.usage === action.usage));
    } },
    close: { invoke: () => { if (mediaSettingsDialog !== "images" || locked || libraryOpen) throw new Error("studio_images_busy"); setMediaSettingsDialog(null); }, matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === false },
  }, !voicePoolOpen && (referencePickerVisible || mediaSettingsDialog === "images"), locked);
  const projectedReferences: Reference[] = references.map(reference => {
    const profile = voiceProfiles.find(profile => profile.target && profile.target !== "narration" && profile.target.characterId === reference.id);
    if (reference.role === "character" && kind === "video" && speechMode === "characters" && voiceSourcePreference === "provided") return { ...reference, voiceMode: "provided" as const, voiceSample: profile?.sample ?? reference.voiceSample };
    const { voiceMode: _inactiveMode, voiceSample: _inactiveSample, ...withoutInactiveVoice } = reference;
    return reference.role === "character" ? { ...withoutInactiveVoice, voiceMode: "ai" as const } : withoutInactiveVoice;
  });
  const exactCharacters = buildMediaExactDialogueCharacters(projectedReferences).map(character => {
    const reference = projectedReferences.find(item => item.id === character.id);
    return { ...character, voiceLabel: reference?.voiceMode === "provided"
      ? reference.voiceSample ? t("ai_generator_exact_dialogue_provided_voice", { name: reference.voiceSample.name }) : t("ai_generator_character_voice_sample_missing")
      : t("ai_generator_character_voice_ai") };
  });
  const effectiveExactRows = projectMediaExactDialogueRows(exactRows, speechMode, narrationVoiceMode);
  const serializedExact = serializeMediaExactDialogueRows(effectiveExactRows, exactCharacters);
  const exactHasCharacters = exactSpeechActive && effectiveExactRows.some(row => row.speaker === "character");
  const exactHasProvidedNarrator = exactSpeechActive && effectiveExactRows.some(row => row.speaker === "provided_voice");
  const exactNeedsCharacter = exactSpeechActive && speechMode === "characters" && !exactHasCharacters;
  const exactInvalid = exactSpeechActive && (Boolean(serializedExact.issue) || exactNeedsCharacter);
  const speakingCharacterIds = new Set(effectiveExactRows.flatMap(row => row.speaker === "character" && row.characterId ? [row.characterId] : []));
  const generationReferences: Reference[] = kind === "video" ? projectedReferences.map(reference => {
    if (reference.role !== "character" || speechMode === "characters" && (!exactSpeechActive || speakingCharacterIds.has(reference.id))) return reference;
    const { voiceMode: _voiceMode, voiceSample: _voiceSample, ...withoutInactiveVoice } = reference;
    return withoutInactiveVoice;
  }) : projectedReferences;
  const providedCharacterVoicesCount = generationReferences.filter(reference => reference.voiceMode === "provided" && reference.voiceSample).length;
  const names = projectedReferences.filter(reference => reference.role === "character").map(reference => normalizeAiMediaCharacterName(reference.characterName ?? ""));
  const namedCharacters = names.filter((name): name is string => Boolean(name));
  const characterNameInvalid = names.some(name => name === null) || new Set(namedCharacters.map(name => name.toLowerCase())).size !== namedCharacters.length;
  const activeNarrationProfile = voiceProfiles.find(profile => profile.id === activeNarrationVoiceId && profile.target === "narration");
  const narrationVoiceSample = activeNarrationProfile?.sample;
  const providedNarrationVoiceActive = kind === "video" && speechMode !== "silent" && (exactSpeechActive ? exactHasProvidedNarrator : speechMode === "voiceover" && narrationVoiceMode === "provided");
  const narrationVoiceMissing = providedNarrationVoiceActive && !narrationVoiceSample;
  const narrationVoiceTooShort = providedNarrationVoiceActive && Boolean(narrationVoiceSample && narrationVoiceSample.durationSeconds < AI_MEDIA_NARRATION_VOICE_MIN_SECONDS);
  const narrationVoiceUnauthorized = providedNarrationVoiceActive && !narrationVoiceConsent;
  const characterVoiceSelection = getCharacterVoiceSelectionState(kind === "video" && speechMode === "characters" ? generationReferences : []);
  const providedVoiceWithEmptyScript = kind === "video" && (characterVoiceSelection.hasProvidedVoice || providedNarrationVoiceActive) && explicitlyEmptySpokenScript;
  const selectedVideoEngine = enginePreference.videoEngine;
  const characterVoiceEngineUnsupported = characterVoiceSelection.hasProvidedVoice && !isAiMediaCharacterVoiceEngine(selectedVideoEngine);
  const videoModel = getAiMediaVideoModelForCharacterVoice(selectedVideoEngine, characterVoiceSelection.hasProvidedVoice);
  const requestSpeechMode: MediaGenerationTeamVideoSpeechMode =
    !explicitlyEmptySpokenScript && speechMode === "characters" ? "characters" : "voiceover";
  const hasCharacterReferences = generationReferences.some(reference => reference.role === "character");
  const videoResolution = getMediaVideoContextResolution(selectedVideoEngine, enginePreference.videoResolution,
    { format: fixedFormat || format, teamVideoSpeechMode: requestSpeechMode, hasCharacterReferences });
  const preferredVideoResolution = enginePreference.videoResolution;
  const updateEnginePreference = enginePreference.update;
  useEffect(() => {
    if (kind !== "video" || locked || result || recoveryPending || videoResolution === preferredVideoResolution) return;
    updateEnginePreference({ videoEngine: selectedVideoEngine, videoResolution });
  }, [kind, locked, result, recoveryPending, videoResolution, preferredVideoResolution, selectedVideoEngine, updateEnginePreference]);
  const aiVoiceSettingsAvailable = kind === "video" && selectedVoiceMode === "ai" && voiceConfigurationMode !== "silent" &&
    (voiceConfigurationMode === "voiceover" || voiceReferences.length > 1);
  useInrAssistantLocalInterface("studio_video_audio", { open: mediaSettingsDialog === "audio" }, {
    open: { invoke: () => { if (exactDialogueOpen || !aiVoiceSettingsAvailable || voicePoolOpen || locked || libraryOpen || !editorAvailable || stopConfirmOpen) throw new Error("studio_audio_unavailable"); setMediaSettingsDialog("audio"); }, matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === true },
    close: { invoke: () => { if (mediaSettingsDialog !== "audio" || locked) throw new Error("studio_audio_busy"); setMediaSettingsDialog(null); }, matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === false },
  }, kind === "video" && !exactDialogueOpen && ((!voicePoolOpen && aiVoiceSettingsAvailable && editorAvailable && !stopConfirmOpen) || mediaSettingsDialog === "audio"), locked);
  const wan3VoiceDurationExceeded = kind === "video" && speechMode === "characters" && exceedsAiMediaCharacterVoiceEngineDuration("wan3", projectedReferences);
  const characterVoiceDurationExceeded = kind === "video" && (exactSpeechEditorVisible ? exactHasCharacters : speechMode === "characters") && exceedsAiMediaCharacterVoiceEngineDuration(selectedVideoEngine, generationReferences);
  const characterVoiceTooShort = kind === "video" && (exactSpeechEditorVisible ? exactHasCharacters : speechMode === "characters") && hasTooShortAiMediaCharacterVoice(selectedVideoEngine, generationReferences);
  const counter = quota?.credits;
  const maxDuration = quota?.videoMaxDurationSeconds ?? 30;
  const durations = getMediaVideoDurationChoices(maxDuration);
  const exhausted = !quota?.unlimited && counter?.remaining === 0;
  const personReferences = references.filter(
    (reference) =>
      reference.role === "character" && reference.usage === "required"
  );
  // Pool assignments already identify their character; an editor selection is
  // needed only while choosing a supplied voice with no existing assignment.
  const realVoiceNeedsPerson = kind === "video" && speechMode === "characters" && voiceSourcePreference === "provided" && !voiceReferences.length;
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
    ...(exactSpeechActive && !serializedExact.issue ? { exactDialogue: serializedExact.turns } : {}),
    withNarration: effectiveWithNarration, teamVideoSpeechMode: requestSpeechMode,
    durationSeconds: duration, videoEngine: selectedVideoEngine,
    videoResolution, sceneMode, language: locale,
    inspirationImages: exactSpeechEditorVisible ? exactCharacters.map(character => ({ role: "character" as const, characterIndex: character.characterIndex })) : projectedReferences,
  });
  const speechInvalid = kind === "video" && Boolean(speechState.issue);
  const speechDisplayBudget = exactSpeechActive ? getMediaExactDialogueDisplayBudget(effectiveExactRows, { durationSeconds: duration, videoEngine: selectedVideoEngine, videoResolution, sceneMode, language: locale }) : speechState;
  const speechUnit = t(speechDisplayBudget.unit === "mots" ? "ai_generator_video_speech_words" : "ai_generator_video_speech_characters");
  const speechError = speechState.issue?.code === "AI_MEDIA_VIDEO_DURATION_INVALID"
    ? t("ai_generator_model_duration_unavailable", { seconds: duration })
    : speechState.issue?.code === "AI_MEDIA_EXACT_DIALOGUE_INVALID"
      ? t("ai_generator_exact_dialogue_engine_incompatible")
      : speechState.issue?.code === "AI_MEDIA_INVALID_SPEECH_MODE"
      ? t("ai_generator_spoken_script_silent_help") : t("ai_generator_video_speech_too_long");
  const durationUnavailable = kind === "video" && (!durations.includes(duration) || !canGenerateAiMediaVideoDuration(selectedVideoEngine, duration, videoResolution, sceneMode));
  const referenceCompatible = kind === "video" ? !characterVoiceEngineUnsupported && isMediaVideoReferenceCompatible(selectedVideoEngine, references.length, characterVoiceSelection.hasProvidedVoice, providedCharacterVoicesCount) : isAiMediaImageModelCompatible({ engine: enginePreference.imageEngine, operation: "generate", inspirationImagesCount: references.length });
  const referenceDurationUnsupported = kind === "video" && getAiMediaVideoReferenceCompatibilityIssue(selectedVideoEngine,
    { inspirationImagesCount: references.length, durationSeconds: duration, videoResolution, sceneMode: sceneMode })?.code === "AI_MEDIA_VIDEO_REFERENCE_DURATION_UNSUPPORTED";
  const briefCompatible = kind !== "video" || isMediaVideoBriefCompatible(selectedVideoEngine, effectivePrompt);
  const promptReady = prompt.trim().length >= 3 && prompt.length <= maxUserPromptLength;
  const promptWarning = operationLocked ? "" : kind === "video" && prompt.length > maxUserPromptLength
    ? t("ai_generator_video_brief_too_long", { max: maxUserPromptLength }) : misplacedSpeechBlocking
    ? t("ai_generator_video_speech_move") : !promptReady
    ? t("ai_generator_idea_required")
    : !briefCompatible ? t("ai_generator_engine_brief_too_long") : "";
  const referenceCompatibilityReason = kind === "video"
    ? characterVoiceEngineUnsupported ? t("ai_generator_character_voice_engine_required")
      : references.length === 0 && !videoModel.supportsTextToVideo
      ? t("ai_generator_model_photo_required")
      : !videoModel.supportsImageToVideo
        ? t("ai_generator_model_text_only")
        : t("ai_generator_model_reference_limit", { count: videoModel.maxReferenceImages })
    : references.length > imageModel.maxReferenceImages && imageModel.supportsReferences
      ? t("ai_generator_model_reference_limit", { count: imageModel.maxReferenceImages })
      : t("ai_generator_image_references_unavailable");
  const criteriaWarning = operationLocked ? "" : characterNameInvalid ? t("ai_generator_character_name_invalid") : !referenceCompatible
    ? referenceCompatibilityReason
    : referenceCriteriaIncomplete ? t("ai_generator_free_reference_criteria_required")
    : roleLimitExceeded ? t("ai_generator_free_role_limit")
    : exactNeedsCharacter ? t("ai_generator_exact_dialogue_choose_speaker")
    : realVoiceNeedsPerson ? t("ai_generator_voice_photo_needed")
    : providedVoiceWithEmptyScript ? t("ai_generator_voice_exact_script_needed")
    : narrationVoiceMissing ? t("ai_generator_voice_pool_select_narration")
    : narrationVoiceTooShort ? t("ai_generator_narration_voice_reference_limits")
    : narrationVoiceUnauthorized ? t("ai_generator_narration_voice_consent_required")
    : characterVoiceSelection.missingSample ? t("ai_generator_character_voice_sample_missing")
    : characterVoiceTooShort ? t("ai_generator_character_voice_kling_reference_limits")
    : characterVoiceDurationExceeded ? t("ai_generator_character_voice_wan3_duration_limit") : "";
  const referencePhotoMissing = kind === "video" && references.length === 0 && !videoModel.supportsTextToVideo;
  const photoRequiredHint = referencePhotoMissing
    ? t("ai_generator_model_photo_required") : "";
  const referenceSettingsWarning = kind === "image" ? criteriaWarning : characterNameInvalid ? t("ai_generator_character_name_invalid") : !referenceCompatible
    ? referenceCompatibilityReason : referenceCriteriaIncomplete ? t("ai_generator_free_reference_criteria_required")
    : roleLimitExceeded ? t("ai_generator_free_role_limit") : "";
  const visibleReferenceWarning = operationLocked ? "" : referencePhotoMissing
    ? t("ai_generator_reference_photo_needed", { model: videoModel.label }) : referenceSettingsWarning;
  const audioSettingsWarning = exactSpeechActive && serializedExact.issue === "missing_character" ? t("ai_generator_exact_dialogue_missing")
    : exactSpeechActive && serializedExact.issue === "provided_mix" ? t("ai_generator_exact_dialogue_provided_mix")
    : exactSpeechActive && serializedExact.issue === "unassigned" || exactNeedsCharacter ? t("ai_generator_exact_dialogue_choose_speaker")
    : realVoiceNeedsPerson ? t("ai_generator_voice_photo_needed")
    : providedVoiceWithEmptyScript ? t("ai_generator_voice_exact_script_needed")
    : narrationVoiceMissing ? t("ai_generator_voice_pool_select_narration")
    : narrationVoiceTooShort ? t("ai_generator_narration_voice_reference_limits")
    : narrationVoiceUnauthorized ? t("ai_generator_narration_voice_consent_required")
    : characterVoiceSelection.missingSample ? t("ai_generator_character_voice_sample_missing")
    : characterVoiceTooShort ? t("ai_generator_character_voice_kling_reference_limits")
    : characterVoiceDurationExceeded ? t("ai_generator_character_voice_wan3_duration_limit")
    : speechInvalid ? speechError : "";
  const creditQuote = useMediaCreditQuote({ kind, format: fixedFormat || format, operation: "generate", creationMode: "free",
    inputMode: "essential", identityMode,
    videoEngine: selectedVideoEngine, imageEngine: enginePreference.imageEngine,
    videoResolution, durationSeconds: kind === "video" ? duration : undefined,
    sceneMode: kind === "video" ? sceneMode : undefined,
    inspirationImagesCount: references.length, withNarration: effectiveWithNarration,
    ...(kind === "video" ? { narrationVoiceMode: providedNarrationVoiceActive ? "provided" : narrationVoiceMode } : {}),
    hasProvidedCharacterVoice: characterVoiceSelection.hasProvidedVoice, providedCharacterVoicesCount,
    teamVideoSpeechMode: requestSpeechMode,
    ...(kind === "video" ? { freePrompt: effectivePrompt, withSubtitles: effectiveWithSubtitles,
      inspirationImages: referencesForRequest(generationReferences, exactSpeechEditorVisible ? exactHasCharacters : speechMode === "characters", exactSpeechEditorVisible ? exactCharacters : undefined)
        .map(reference => ({ role: reference.role, characterIndex: reference.characterIndex, characterName: reference.characterName })) } : {}),
    ...(exactSpeechActive && !serializedExact.issue ? { exactDialogue: serializedExact.turns, inspirationImages: exactCharacters.map(character => ({ role: "character" as const, characterIndex: character.characterIndex })) } : {}),
  }, quota, !paidActionsLocked && !exactInvalid && !characterNameInvalid && !durationUnavailable && !referenceDurationUnsupported && referenceCompatible && briefCompatible && !realVoiceNeedsPerson && !characterVoiceSelection.missingSample && !providedVoiceWithEmptyScript && !characterVoiceTooShort && !narrationVoiceMissing && !narrationVoiceTooShort && !narrationVoiceUnauthorized && (kind !== "video" || !speechInvalid && !misplacedSpeechBlocking && promptReady));
  const creditInsufficient = creditQuote.insufficient;
  const modelRecommendation = recommendAiMediaModel({ kind, format: fixedFormat || format, operation: "generate", brief: effectivePrompt,
    ...(source === "studio" ? { recommendationContext: "studio-free" as const } : {}),
    durationSeconds: duration, sceneMode, withNarration: effectiveWithNarration,
    teamVideoSpeechMode: requestSpeechMode, language: locale, inspirationImagesCount: references.length,
    inputMode: "essential", identityMode });
  const canGenerate =
    !operationLocked &&
    !exactDialogueOpen &&
    !reviewingRecovery &&
    promptReady &&
    Boolean(quota) &&
    !quotaLoading &&
    quota?.studioEnabled !== false &&
    !exhausted &&
    !durationUnavailable &&
    !referenceDurationUnsupported &&
    !creditInsufficient &&
    creditQuote.ready &&
    referenceCompatible &&
    briefCompatible &&
    !referenceCriteriaIncomplete &&
    !roleLimitExceeded &&
    !realVoiceNeedsPerson &&
    !exactInvalid &&
    !characterNameInvalid &&
    !providedVoiceWithEmptyScript &&
    !narrationVoiceMissing && !narrationVoiceTooShort && !narrationVoiceUnauthorized &&
    !characterVoiceSelection.missingSample &&
    !characterVoiceTooShort &&
    !characterVoiceDurationExceeded &&
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
    if (!paidActionsLocked) void loadQuota();
  }, [loadQuota, paidActionsLocked]);

  useEffect(() => {
    // Account preferences may load a different provider without a selector event.
    setIdentityConsent(false);
    setTeamConsent(false);
  }, [authorizationEngine, quota?.accountId]);

  useLayoutEffect(() => {
    onBusyChange?.(operationLocked);
    return () => onBusyChange?.(false);
  }, [onBusyChange, operationLocked]);

  const hasDraftSettings = Boolean(
    references.length || !useBusinessDna || format !== (fixedFormat || (kind === "video" ? "story" : "square")) ||
    (kind === "video" && (spokenScript.trim() || exactRows.length || duration !== 8 || sceneMode !== "single" ||
      !withMusic || soundtrackId || voiceProfiles.length || withSubtitles || speechMode !== "voiceover" ||
      voice !== "female" || voiceVariant !== "Kore" || voiceSourcePreference !== "ai"))
  );
  useLayoutEffect(() => {
    if (references.length && !referenceSetId.current) referenceSetId.current = globalThis.crypto.randomUUID();
    onWorkingPanelChange?.(kind, hasDraftSettings ? {
      references, format, useBusinessDna, duration, sceneMode, withMusic, soundtrackId,
      spokenScript, spokenScriptOpen, exactRows, withSubtitles, speechMode, voice, voiceVariant,
      voiceSourcePreference, voiceReferenceId, voices: voiceProfiles, activeNarrationVoiceId,
    } : null);
  }, [activeNarrationVoiceId, duration, exactRows, format, hasDraftSettings, kind, onWorkingPanelChange,
    references, sceneMode, soundtrackId, speechMode, spokenScript, spokenScriptOpen, useBusinessDna, voice,
    voiceProfiles, voiceReferenceId, voiceSourcePreference, voiceVariant, withMusic, withSubtitles]);

  const restoredWorkingPanel = useRef(Boolean(initialWorkingPanel));

  useEffect(() => { setMediaSettingsDialog(null); }, [kind]);

  useLayoutEffect(() => {
    const narrow = window.matchMedia("(max-width: 1100px)");
    const inputs = [promptInputRef.current, speechInputRef.current].filter((input): input is HTMLTextAreaElement => Boolean(input));
    const resize = () => {
      for (const input of inputs) {
        if (!narrow.matches) { input.style.removeProperty("height"); continue; }
        input.style.height = "0px";
        input.style.height = `${Math.max(140, input.scrollHeight)}px`;
      }
    };
    const widths = new WeakMap<Element, number>();
    const observer = new ResizeObserver(entries => {
      if (entries.some(entry => {
        const previous = widths.get(entry.target);
        widths.set(entry.target, entry.contentRect.width);
        return previous !== entry.contentRect.width;
      })) resize();
    });
    for (const input of inputs) observer.observe(input);
    narrow.addEventListener("change", resize);
    resize();
    return () => { observer.disconnect(); narrow.removeEventListener("change", resize); };
  }, [prompt, spokenScript, kind, exactSpeechEditorVisible]);

  useEffect(() => {
    // The hook's earlier effect hydrates the scoped recovery pointer once quota
    // identifies the account. Do not permit replacement before that first check.
    if (quota?.accountId && !quotaLoading) setRecoveryAccountChecked(quota.accountId);
  }, [quota?.accountId, quotaLoading]);

  const recoveryGuardPending = paidActionsLocked ? recoveryPending : !quota?.accountId || quotaLoading ||
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
      referenceMemoryController.current?.abort(); referenceMemoryController.current = null;
      referenceMemoryLoadedAccount.current = null; referenceMemoryAction.current = null;
      setReferenceMemoryState(emptyReferenceMemory(""));
      setPrompt("");
      setRecoveryAccountChecked(null);
      setSpokenScript("");
      setExactRows([]); setExactDialogueOpen(false); setLegacyExactImported(false);
      setSpokenScriptOpen(false);
      setUseBusinessDna(true);
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
      setVoiceProfiles([]);
      setActiveNarrationVoiceId(null);
      setNarrationVoiceConsent(false);
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

  useEffect(() => {
    const accountId = quota?.accountId;
    if (!accountId || referenceMemoryLoadedAccount.current === accountId) return;
    const controller = new AbortController(); referenceMemoryController.current = controller;
    const accountSequence = sequence.current;
    const metadataRevision = readStudioReferenceMemoryMetadata(accountId)?.revision ?? 0;
    const voiceRevision = voiceSelectionRevision.current;
    let ownsOperation = false;
    const isCurrent = () => !controller.signal.aborted && sequence.current === accountSequence && referenceMemoryCurrent.current.accountId === accountId;
    const scope = { accountId, signal: controller.signal, isCurrent };
    const pristine = () => !restoredWorkingPanel.current && !referenceMemoryCurrent.current.draft.references.length && !referenceMemoryCurrent.current.draft.voices.length && !operationInFlight.current;
    setReferenceMemoryState(emptyReferenceMemory(accountId));
    void (async () => {
      try {
        const response = await requestStudioReferenceMemory("GET", scope);
        if (!isCurrent()) return;
        setReferenceMemoryState(current => ({ ...current, scopeKey: accountId, saved: Boolean(response.memory),
          fingerprint: response.memory ? studioSavedReferenceFingerprint(response.memory) : "" }));
        // A late load never replaces references or voices the professional has already added.
        if (response.memory && pristine()) {
          ownsOperation = true; operationInFlight.current = true;
          setReferenceMemoryState(current => ({ ...current, busy: true }));
          const restored = await hydrateStudioReferenceMemory(response, scope, prepareMediaGenerationImageReference);
          if (restored && isCurrent() && (readStudioReferenceMemoryMetadata(accountId)?.revision ?? 0) <= metadataRevision && !referenceMemoryCurrent.current.draft.references.length && !referenceMemoryCurrent.current.draft.voices.length) {
            setReferences(restored.references); setVoiceProfiles(restored.voices); setActiveNarrationVoiceId(restored.activeNarrationVoiceId);
            const firstCharacterVoice = restored.voices.find(profile => {
              const target = profile.target;
              return target && target !== "narration" && restored.references.some(reference => reference.id === target.characterId && reference.role === "character" && reference.voiceMode === "provided");
            });
            if (kind === "video" && firstCharacterVoice?.target && firstCharacterVoice.target !== "narration") {
              // Restore the saved voices, never silently choose another provider for them.
              if (voiceSelectionRevision.current === voiceRevision) {
                setSpeechMode("characters"); setVoiceSourcePreference("provided"); setVoiceReferenceId(firstCharacterVoice.target.characterId);
              }
            }
            setIdentityConsent(false); setTeamConsent(false); setNarrationVoiceConsent(false);
            referenceSetId.current = globalThis.crypto.randomUUID();
            setReferenceMemoryState(current => ({ ...current, fingerprint: studioReferenceDraftFingerprint(restored) }));
          } else if (restored) {
            for (const profile of restored.voices) void deleteCharacterVoiceSample(profile.sample);
          }
        }
        if (isCurrent()) referenceMemoryLoadedAccount.current = accountId;
      } catch {
        if (isCurrent()) {
          referenceMemoryLoadedAccount.current = accountId;
          setReferenceMemoryState(current => ({ ...current, error: "load" }));
        }
      } finally {
        if (isCurrent()) {
          if (ownsOperation) operationInFlight.current = false;
          const published = readStudioReferenceMemoryMetadata(accountId);
          setReferenceMemoryState(current => ({ ...current, loaded: true, busy: false,
            ...(published && published.revision > metadataRevision ? { saved: published.saved, fingerprint: published.fingerprint, lastAction: null } : {}) }));
        }
        if (referenceMemoryController.current === controller) referenceMemoryController.current = null;
      }
    })();
    return () => { controller.abort(); if (ownsOperation) operationInFlight.current = false; };
  }, [quota?.accountId, kind]);

  useEffect(() => {
    const accountId = quota?.accountId;
    if (!accountId) return;
    const synchronize = (metadata: StudioReferenceMemoryMetadata | undefined) => {
      if (!metadata || metadata.accountId !== accountId || metadata.origin === instanceId || referenceMemoryCurrent.current.accountId !== accountId) return;
      setReferenceMemoryState(current => {
        if (current.scopeKey !== accountId || !current.loaded || current.busy || current.saved === metadata.saved && current.fingerprint === metadata.fingerprint) return current;
        return { ...current, saved: metadata.saved, fingerprint: metadata.fingerprint, lastAction: null, revision: current.revision + 1 };
      });
    };
    synchronize(readStudioReferenceMemoryMetadata(accountId));
    const onMemoryChange = (event: Event) => synchronize((event as CustomEvent<StudioReferenceMemoryMetadata>).detail);
    window.addEventListener(STUDIO_REFERENCE_MEMORY_EVENT, onMemoryChange);
    return () => window.removeEventListener(STUDIO_REFERENCE_MEMORY_EVENT, onMemoryChange);
  }, [quota?.accountId, instanceId]);

  const referenceMemoryAvailable = editorAvailable && !stopConfirmOpen && !voicePoolOpen && !libraryOpen && !mediaSettingsDialog && !exactDialogueOpen;
  const hasMemoryReferences = Boolean(references.length || voiceProfiles.length);
  const handleRememberReferences = async (canApply: () => boolean = () => true): Promise<boolean> => {
    const accountId = quota?.accountId;
    if (!canApply() || !accountId || locked || operationInFlight.current || !referenceMemory.loaded || !referenceMemoryAvailable || !hasMemoryReferences || referenceMemory.saved && !referenceMemoryDirty && !referenceMemory.error) return false;
    const controller = new AbortController(); referenceMemoryController.current = controller;
    const accountSequence = sequence.current;
    const ownsCurrentOperation = () => referenceMemoryController.current === controller && sequence.current === accountSequence && referenceMemoryCurrent.current.accountId === accountId;
    const isCurrent = () => canApply() && !controller.signal.aborted && ownsCurrentOperation();
    const scope = { accountId, signal: controller.signal, isCurrent };
    const draft = referenceMemoryCurrent.current.draft;
    const fingerprint = studioReferenceDraftFingerprint(draft);
    operationInFlight.current = true;
    setReferenceMemoryState(current => ({ ...current, busy: true, error: "" }));
    try {
      const memory = await prepareStudioReferenceMemory(draft, scope, async (file, reference) => {
        const uploaded = await uploadFileToMediaLibrary(file, { source: "studio", title: reference.characterName || reference.name, accountId, signal: controller.signal });
        return String(uploaded.mediaId || "");
      }, (id, libraryMediaId) => {
        if (isCurrent()) setReferences(current => current.map(reference => reference.id === id ? { ...reference, libraryMediaId } : reference));
      });
      await requestStudioReferenceMemory("PUT", scope, memory);
      if (!isCurrent()) return false;
      setReferenceMemoryState(current => ({ ...current, saved: true, fingerprint, revision: current.revision + 1, lastAction: "remember" }));
      publishStudioReferenceMemoryMetadata(accountId, memory, instanceId);
      return true;
    } catch {
      if (isCurrent()) setReferenceMemoryState(current => ({ ...current, error: "save" }));
      return false;
    } finally {
      if (ownsCurrentOperation()) { operationInFlight.current = false; setReferenceMemoryState(current => ({ ...current, busy: false })); }
      if (referenceMemoryController.current === controller) referenceMemoryController.current = null;
    }
  };
  const handleForgetReferences = async (canApply: () => boolean = () => true): Promise<boolean> => {
    const accountId = quota?.accountId;
    if (!canApply() || !accountId || locked || operationInFlight.current || !referenceMemory.loaded || !referenceMemory.saved || !referenceMemoryAvailable) return false;
    const controller = new AbortController(); referenceMemoryController.current = controller;
    const accountSequence = sequence.current;
    const ownsCurrentOperation = () => referenceMemoryController.current === controller && sequence.current === accountSequence && referenceMemoryCurrent.current.accountId === accountId;
    const isCurrent = () => canApply() && !controller.signal.aborted && ownsCurrentOperation();
    operationInFlight.current = true;
    setReferenceMemoryState(current => ({ ...current, busy: true, error: "" }));
    try {
      await requestStudioReferenceMemory("DELETE", { accountId, signal: controller.signal, isCurrent });
      if (!isCurrent()) return false;
      // Forget the default only. Current photos, voices and permanent library files stay usable.
      setReferenceMemoryState(current => ({ ...current, saved: false, fingerprint: "", revision: current.revision + 1, lastAction: "forget" }));
      publishStudioReferenceMemoryMetadata(accountId, null, instanceId);
      return true;
    } catch {
      if (isCurrent()) setReferenceMemoryState(current => ({ ...current, error: "forget" }));
      return false;
    } finally {
      if (ownsCurrentOperation()) { operationInFlight.current = false; setReferenceMemoryState(current => ({ ...current, busy: false })); }
      if (referenceMemoryController.current === controller) referenceMemoryController.current = null;
    }
  };
  useInrAssistantLocalInterface("studio_reference_memory", { scopeKey: quota?.accountId ?? "", loaded: referenceMemory.loaded,
    saved: referenceMemory.saved, busy: referenceMemory.busy, revision: referenceMemory.revision, lastAction: referenceMemory.lastAction,
    hasReferences: hasMemoryReferences, dirty: referenceMemoryDirty, error: referenceMemory.error }, { select: {
    invoke: async (value, stillCurrent) => {
      if (value !== "remember" && value !== "forget" || !referenceMemoryAvailable || locked) throw new Error("studio_reference_memory_unavailable");
      referenceMemoryAction.current = { value, scopeKey: quota?.accountId ?? "", revision: referenceMemory.revision };
      const confirmed = value === "remember" ? await handleRememberReferences(stillCurrent) : await handleForgetReferences(stillCurrent);
      if (!confirmed) throw new Error("studio_reference_memory_unconfirmed");
    },
    matches: (state, value) => {
      const action = referenceMemoryAction.current;
      if (!state || typeof state !== "object" || !action || value !== action.value) return false;
      const current = state as { scopeKey?: string; revision?: number; lastAction?: string; saved?: boolean; busy?: boolean; error?: string; dirty?: boolean };
      return current.scopeKey === action.scopeKey && current.revision === action.revision + 1 && current.lastAction === value &&
        current.saved === (value === "remember") && current.busy === false && !current.error && (value !== "remember" || current.dirty === false);
    },
  } }, referenceMemoryAvailable && referenceMemory.loaded, locked);

  const addFiles = async (files: File[], lockOwned = false, requestedRole: MediaGenerationReferenceRole | null = pendingReferenceRole, libraryMediaIds: readonly string[] = []): Promise<boolean> => {
    if (!lockOwned && (locked || (operationInFlight.current && !recoveryPending))) return false;
    if (!requestedRole) { setActionError(t("ai_generator_reference_choose_role")); return false; }
    const currentSequence = sequence.current;
    operationInFlight.current = true;
    setReferencesBusy(true);
    setActionError("");
    try {
      const prepared: Reference[] = [];
      for (const file of files) assertStudioInspirationImageMetadata(file, t("ai_generator_inspiration_images_only"));
      for (const [fileIndex, file] of files.slice(
        0,
        AI_MEDIA_INSPIRATION_MAX_COUNT - references.length
      ).entries()) {
        const image = await prepareMediaGenerationImageReference(file);
        if (sequence.current !== currentSequence) return false;
        prepared.push({
          ...image,
          id: globalThis.crypto.randomUUID(),
          role: requestedRole,
          usage: requestedRole === "inspiration" ? "inspiration" : "required",
          fromVideo: false,
          ...(libraryMediaIds[fileIndex] ? { libraryMediaId: libraryMediaIds[fileIndex] } : {}),
        });
      }
      if (!prepared.length) return false;
      if (requestedRole === "character" && voiceReferences.length === 0 && prepared.length === 1) {
        setVoiceReferenceId(prepared[0].id);
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
            : getSafeClientErrorMessage(caught, t("ai_generator_free_refs_error"))
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
      const added = await addFiles(files, true, requestedRole, items.slice(0, files.length).map(item => item.id));
      if (sequence.current !== currentSequence) return;
      if (added) setLibraryOpen(false);
    } catch (caught) {
      if (sequence.current === currentSequence)
        setActionError(
          caught instanceof StudioInspirationImageOnlyError
            ? t("ai_generator_inspiration_images_only")
            : getSafeClientErrorMessage(caught, t("ai_generator_free_refs_error"))
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
    voiceSelectionRevision.current += 1;
    setVoiceSourcePreference(mode);
    if (voiceConfigurationMode === "voiceover") {
      setNarrationVoiceConsent(false);
      resetConsent();
      setMediaSettingsDialog(null);
      return;
    }
    resetConsent();
    setMediaSettingsDialog(null);
  };

  const handleGenerate = async () => {
    if (paidActionsLocked) { openSubscription(); return; }
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
      for (const reference of generationReferences) if (reference.voiceSample?.path) submittedVoicePaths.current.add(reference.voiceSample.path);
      if (providedNarrationVoiceActive && narrationVoiceSample) submittedVoicePaths.current.add(narrationVoiceSample.path);
      await generate({
        ...creditQuote.authorization,
        imageEngine: enginePreference.imageEngine,
        videoResolution,
        operation: "generate",
        creationMode: "free",
        freePrompt: effectivePrompt,
        ...(kind === "image" && publicationSubject?.trim() ? { publicationSubject } : {}),
        ...(exactSpeechActive ? { exactDialogue: serializedExact.turns } : {}),
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
        ...(kind === "video" && speechMode === "voiceover" ? { narrationVoiceMode: providedNarrationVoiceActive ? "provided" : narrationVoiceMode, narrationVoiceSample: providedNarrationVoiceActive ? narrationVoiceSample : undefined,
          narrationVoiceConsent: providedNarrationVoiceActive && narrationVoiceConsent, narrationVoiceGender: providedNarrationVoiceActive ? activeNarrationProfile?.gender ?? "auto" : undefined } : {}),
        videoEngine: selectedVideoEngine,
        teamVideoSpeechMode: kind === "video" ? requestSpeechMode : undefined,
        teamVideoMode: "cinematic",
        inspirationImages: referencesForRequest(generationReferences, kind === "video" && (exactSpeechEditorVisible ? exactHasCharacters : speechMode === "characters"), exactSpeechEditorVisible ? exactCharacters : undefined),
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
          getClientAiMediaGenerationErrorMessage(caught, getSafeClientErrorMessage(caught, t("ai_generator_error")))
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
        setActionError(getClientAiMediaGenerationErrorMessage(caught, getSafeClientErrorMessage(caught, t("ai_generator_error"))));
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
        setActionError(getClientAiMediaGenerationErrorMessage(caught, getSafeClientErrorMessage(caught, t("ai_generator_error"))));
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
          getSafeClientErrorMessage(caught, t("ai_generator_error"))
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
          getSafeClientErrorMessage(caught, t("ai_generator_error"))
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
    mode: "free", kind, locked: operationLocked || exactDialogueOpen, editorVisible: editorAvailable && !stopConfirmOpen && !exactDialogueOpen,
    automaticSceneMode: source === "studio",
    fixedFormat, maxPromptLength: maxUserPromptLength, activeTab: activeSettingsTab, prompt, useBusinessDna, format,
    videoEngine: selectedVideoEngine, videoResolution, language: locale,
    durationScene: { seconds: duration, sceneMode }, speechMode, spokenScript, spokenScriptOpen, exactDialogueEditor: true,
    voiceSelectionMode: voiceConfigurationMode, ...(exactSpeechActive && !serializedExact.issue ? { exactDialogue: serializedExact.turns } : {}),
    narrationVoice: voice, narrationVoiceVariant: voiceVariant, withMusic, withSubtitles,
    voiceMode: selectedVoiceMode, voiceReferenceId: selectedVoiceReference?.id,
    voiceReferences: voiceConfigurationMode === "characters" ? voiceReferences.map(reference => ({ id: reference.id, name: reference.name, voiceMode: voiceSourcePreference, characterIndex: exactCharacters.find(character => character.id === reference.id)?.characterIndex, referenceIndex: references.findIndex(item => item.id === reference.id) })) : [],
  };
  const isVoiceSelectionApplied = (snapshot: unknown, encoded: string | null) => {
    if (!encoded) return false;
    let field: unknown; try { field = JSON.parse(encoded)?.field; } catch { return false; }
    if (field === "voiceMode") return voiceAction.current?.encoded === encoded;
    if (field !== "voiceReferenceId") return true;
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
        if (operationLocked || exactDialogueOpen) throw new Error("quota_refresh_unavailable");
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
            voiceSelectionRevision.current += 1;
            setSpeechMode(change.value); resetConsent(); break;
          case "voiceMode": voiceAction.current = { encoded: encoded!, targetId: selectedVoiceReference?.id ?? null }; chooseVoiceMode(change.value); break;
          case "voiceReferenceId": voiceSelectionRevision.current += 1; voiceAction.current = { encoded: encoded!, targetId: change.value }; setVoiceReferenceId(change.value); break;
          case "spokenScript": throw new Error("studio_exact_dialogue_editor_required");
          case "spokenScriptOpen": setSpokenScriptOpen(change.value); if (change.value && !exactRows.length) { setExactRows(initializeMediaExactDialogueRows(exactRows, spokenScript, exactCharacters, { speechMode: assistantFormSnapshot.speechMode ?? "voiceover", characterId: voiceReferenceId, narrationVoiceMode })); setLegacyExactImported(Boolean(spokenScript)); } break;
          case "narrationVoice": voiceSelectionRevision.current += 1; setVoice(change.value); setVoiceVariant(defaultAiMediaNarrationVoiceVariant(change.value)); break;
          case "narrationVoiceVariant": voiceSelectionRevision.current += 1; setVoiceVariant(change.value); break;
          case "withMusic": setWithMusic(change.value); break;
          case "withSubtitles": setWithSubtitles(change.value); break;
          default: throw new Error("studio_form_unavailable");
        }
      },
      matches: committedFormSelectionMatches,
    },
  }, editorAvailable && !stopConfirmOpen && !exactDialogueOpen, operationLocked || exactDialogueOpen);

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
                      title={reference.characterName ? `${reference.characterName} · ${reference.name}` : reference.name}
                    >
                      {reference.characterName ? `${reference.characterName} · ${reference.name}` : reference.name}
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
              {voiceConfigurationMode === "characters" && voiceReferences.length > 1 ? <label className={styles.voicePersonChoice}>
                <span>{t("ai_generator_voice_choose_person")}</span>
                <select id={`${instanceId}-voice-character`} value={selectedVoiceReference?.id ?? ""} disabled={locked}
                  onChange={event => {
                    const target = voiceReferences.find(reference => reference.id === event.target.value);
                    if (!target) return;
                    voiceSelectionRevision.current += 1; setVoiceReferenceId(target.id);
                  }}>
                  <option value="" disabled>{t("ai_generator_voice_choose_person")}</option>
                  {voiceReferences.map(reference => <option key={reference.id} value={reference.id}>{reference.characterName || reference.name}</option>)}
                </select>
              </label> : null}
              {voiceConfigurationMode === "characters" && voiceSourcePreference === "provided" && !voiceReferences.length ? <button type="button" className={styles.secondaryButton} disabled={locked}
                onClick={() => { setPendingReferenceRole("character"); setSelectedReferenceId(null); setMediaSettingsDialog("images"); }}>{t("ai_generator_add_reference_character")}</button> : null}

              {speechMode === "characters" ? (
                <p className={styles.muted} role="note">
                  {t("ai_generator_essential_character_speech_notice")}
                </p>
              ) : null}
              {voiceConfigurationMode === "voiceover" && selectedVoiceMode === "ai" ? (
                <div className={styles.voiceOptions}>
                  <label>
                    <span>{t("ai_generator_narration_voice_label")}</span>
                    <select
                      value={voice}
                      disabled={locked}
                      onChange={(event) => {
                        const next = event.target
                          .value as MediaGenerationNarrationVoice;
                        voiceSelectionRevision.current += 1; setVoice(next);
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
                      onChange={(event) => {
                        voiceSelectionRevision.current += 1;
                        setVoiceVariant(
                          event.target
                            .value as MediaGenerationNarrationVoiceVariant
                        );
                      }}
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
            providedCharacterVoicesCount={providedCharacterVoicesCount}
            hasCharacterReferences={hasCharacterReferences}
            videoAudioChoice={{ creationMode: "free", teamVideoSpeechMode: requestSpeechMode, withNarration: effectiveWithNarration, narrationVoiceMode: providedNarrationVoiceActive ? "provided" : narrationVoiceMode }}
            onVideoEngineChange={(videoEngine, resolution) => { resetConsent(); enginePreference.update({ videoEngine, videoResolution: resolution ?? getAiMediaVideoModel(videoEngine).defaultResolution }); }}
            onImageEngineChange={(imageEngine) => { resetConsent(); enginePreference.update({ imageEngine }); }}
            onResolutionChange={(resolution) => { resetConsent(); enginePreference.update({ videoEngine: selectedVideoEngine, videoResolution: resolution }); }} />
  );
  const creditSummary = paidActionsLocked && !recoveryPending ? null : reviewingRecovery
    ? <MediaRecoveredCreditSummary creditsUsed={result?.creditsUsed} />
    : <MediaCreditQuoteSummary status={creditQuote} quota={quota} />;

  const generationAction = <button
    type="button" className={styles.primaryButton} data-media-primary-action
    disabled={paidActionsLocked && !recoveryPending && !busy ? false : recoveryIncompatible || (recoveryPending ? recovering || operationLocked : busy ? !cancellable : Boolean(result) || !canGenerate)}
    style={paidActionsLocked && !recoveryPending && !busy ? { filter: "grayscale(1)", opacity: 0.55 } : undefined}
    aria-label={paidActionsLocked && !recoveryPending && !busy ? `${t(kind === "video" ? "ai_generator_generate_video" : "ai_generator_generate_image")} — ${subscriptionLabel}` : undefined}
    title={paidActionsLocked && !recoveryPending && !busy ? subscriptionLabel : recoveryPending ? t("ai_generator_recovery_generation_blocked") : busy && !cancellable ? t("ai_generator_editor_stop_locked") : undefined}
    onClick={() => { if (recoveryPending) void handleRecoverResult(); else if (busy) setStopConfirmOpen(true); else if (paidActionsLocked) openSubscription(); else if (!result) void handleGenerate(); }}
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
        error={paidActionsLocked && !recoveryPending ? "" : error}
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
      <div className={`${editorStyles.editorBody} ${styles.studioEditorBody}`} data-recovery-pending={recoveryPending}>
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
          <div className={styles.promptContainer} data-invalid={kind === "video" && (prompt.length > maxUserPromptLength || misplacedSpeechBlocking) ? true : undefined}>
            <textarea
              ref={promptInputRef}
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
            </div>
            <div className={styles.referenceAddControl}>
              <div className={styles.referenceAddHeading}>
                <span id={`${instanceId}-add-media-title`} className={styles.mediaToolsTitle}>{t("ai_generator_add_media_title")}</span>
                <div className={styles.referenceMemoryActions} data-studio-reference-memory>
                  <button type="button" data-reference-memory-remember title={t("ai_generator_reference_memory_hint")}
                    disabled={locked || !referenceMemoryAvailable || !referenceMemory.loaded || !hasMemoryReferences || referenceMemory.saved && !referenceMemoryDirty && !referenceMemory.error}
                    onClick={() => { void handleRememberReferences(); }}>
                    {t(referenceMemory.saved ? "ai_generator_reference_memory_update" : "ai_generator_reference_memory_remember")}
                  </button>
                  {referenceMemory.saved ? <button type="button" data-reference-memory-forget title={t("ai_generator_reference_memory_forget_hint")}
                    disabled={locked || !referenceMemoryAvailable || !referenceMemory.loaded}
                    onClick={() => { void handleForgetReferences(); }}>{t("ai_generator_reference_memory_forget")}</button> : null}
                  <span className={styles.srOnly} role="status">{t(referenceMemory.busy ? "ai_generator_reference_memory_saving" : !referenceMemory.loaded ? "ai_generator_reference_memory_loading" : referenceMemory.saved ? "ai_generator_reference_memory_saved" : "ai_generator_reference_memory_hint")}</span>
                </div>
              </div>
              {referenceMemory.error ? <p className={styles.referenceMemoryError} role="alert">{t(`ai_generator_reference_memory_${referenceMemory.error}_error`)}</p> : null}
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
              data-character-index={exactCharacters.find(character => character.id === reference.id)?.characterIndex}
              data-invalid={!operationLocked && (!reference.role || !reference.usage || roleLimitExceeded && reference.role === "character") || undefined} role="listitem">
              <button type="button" className={styles.mediaReferenceOpen} data-media-reference-open={index} disabled={locked}
                aria-label={`${exactCharacters.some(character => character.id === reference.id) ? `${t("ai_generator_exact_dialogue_character", { index: exactCharacters.find(character => character.id === reference.id)!.characterIndex })}${reference.characterName ? ` · ${reference.characterName}` : ""}` : t("ai_generator_free_reference", { index: index + 1 })} · ${reference.name} · ${t(reference.usage === "inspiration" ? "ai_generator_free_usage_inspiration" : reference.usage === "required" ? "ai_generator_free_usage_required" : "ai_generator_free_reference_criteria_required")}`}
                title={!operationLocked && (!reference.role || !reference.usage || roleLimitExceeded && reference.role === "character") ? `${reference.name} — ${visibleReferenceWarning}` : reference.characterName ? `${reference.characterName} · ${reference.name}` : reference.name}
                aria-describedby={!operationLocked && (!reference.role || !reference.usage || roleLimitExceeded && reference.role === "character") ? `${instanceId}-media-images-warning` : undefined}
                aria-haspopup="dialog" onClick={() => { setSelectedReferenceId(reference.id); setPendingReferenceRole(reference.role ?? null); setMediaSettingsDialog("images"); }}>
                <img src={`data:${reference.mimeType};base64,${reference.data}`} alt="" />
              </button>
              {exactCharacters.some(character => character.id === reference.id) ? <span className={styles.mediaCharacterCaption}>
                <span aria-hidden="true">{exactCharacters.find(character => character.id === reference.id)!.characterIndex}</span>
                <span className={styles.srOnly}>{t("ai_generator_exact_dialogue_character", { index: exactCharacters.find(character => character.id === reference.id)!.characterIndex })}{reference.characterName ? ` · ${reference.characterName}` : ""}</span>
              </span> : null}
              {reference.role === "character" && reference.characterName ? <span className={styles.mediaReferenceName} aria-hidden="true" title={reference.characterName}>{reference.characterName}</span> : null}
              <span className={styles.mediaReferenceCategory} data-reference-category={reference.role ?? "unassigned"}
                role="img" aria-label={t(reference.role ? `ai_generator_free_role_${reference.role}` : "ai_generator_free_reference_role_placeholder")}
                title={t(reference.role ? `ai_generator_free_role_${reference.role}` : "ai_generator_free_reference_role_placeholder")}>
                {reference.role ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={REFERENCE_ROLE_PATHS[reference.role]} /></svg> : <span aria-hidden="true">?</span>}
              </span>
            </div>)}
          </div> : null}
          {kind === "video" ? <div className={styles.spokenScriptSection} data-exact={exactSpeechEditorVisible}>
            <div className={styles.spokenScriptPanel} data-video-speech-frame data-invalid={speechInvalid ? true : undefined}>
              <div className={`${styles.spokenScriptHeading} ${styles.videoSpeechModeRow}`} data-silent={!exactSpeechEditorVisible && speechMode === "silent"}>
                <div className={styles.videoFrameHeading}>
                  <div className={styles.videoSpeechTitleRow}>
                    <label htmlFor={`${instanceId}-${!exactSpeechEditorVisible && speechMode === "silent" ? "video-speech-mode" : "spoken-script-mode"}`}>{t("ai_generator_video_sound_and_speech_title")}</label>
                  </div>
                  <p id={`${instanceId}-spoken-script-help`} className={styles.srOnly}>{t("ai_generator_video_speech_frame_hint_short")}</p>
                </div>
                <label className={styles.speechSelectField} htmlFor={`${instanceId}-video-speech-mode`}>
                <span>{t("ai_generator_free_audio_characters")}</span>
                <select id={`${instanceId}-video-speech-mode`} className={styles.spokenScriptModeSelect} value={speechMode} disabled={locked}
                  onChange={event => {
                    const mode = event.target.value as typeof speechMode;
                    voiceSelectionRevision.current += 1;
                    setSpeechMode(mode); resetConsent();
                  }}>
                  {(["voiceover", "characters", "silent"] as const).map(mode => <option key={mode} value={mode}>{t(`ai_generator_free_audio_${mode}`)}</option>)}
                </select>
                </label>
                <div className={styles.speechSelectField}>
                <label htmlFor={`${instanceId}-spoken-script-mode`}>{t("ai_generator_speech_menu_label")}</label>
                <select
                  id={`${instanceId}-spoken-script-mode`}
                  className={styles.spokenScriptModeSelect}
                  value={spokenScriptOpen ? "exact" : "automatic"}
                  disabled={locked}
                  aria-label={`${t("ai_generator_video_speech_automatic")} / ${t("ai_generator_video_speech_exact")}`}
                  aria-describedby={`${instanceId}-spoken-script-help`}
                  onChange={(event) => {
                    if (event.target.value === "exact") {
                      setSpokenScriptOpen(true);
                      if (!exactRows.length) { setExactRows(initializeMediaExactDialogueRows(exactRows, spokenScript, exactCharacters, { speechMode, characterId: voiceReferenceId, narrationVoiceMode })); setLegacyExactImported(Boolean(spokenScript)); }
                    } else {
                      setSpokenScriptOpen(false);
                    }
                  }}
                >
                  <option value="automatic">{t("ai_generator_video_speech_automatic")}</option>
                  <option value="exact">{t("ai_generator_video_speech_exact")}</option>
                </select>
                {exactSpeechEditorVisible ? <StudioExactDialogueEditor enabled={editorAvailable && speechMode !== "silent" && !voicePoolOpen && !libraryOpen && !mediaSettingsDialog} disabled={locked}
                  scopeKey={quota?.accountId ?? ""} rows={effectiveExactRows} onChange={edited => setExactRows(current => mergeMediaExactDialogueRows(current, edited, speechMode))} characters={exactCharacters}
                  narrationOnly={speechMode === "voiceover" ? narrationVoiceMode : undefined} requireCharacter={speechMode === "characters"}
                  speechBudget={{ units: speechDisplayBudget.units, maxUnits: speechDisplayBudget.maxUnits, characters: speechDisplayBudget.characters, maxCharacters: speechDisplayBudget.maxCharacters, unitLabel: speechUnit, engineLabel: videoModel.label, durationSeconds: duration }}
                  validationMessage={audioSettingsWarning || undefined}
                  onOpenChange={setExactDialogueOpen} legacyImported={legacyExactImported} defaultSpeaker={speechMode === "characters" ? "character" : narrationVoiceMode === "provided" ? "provided_voice" : "ai_voice"} defaultCharacterId={voiceReferenceId} /> : null}
                </div>
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
                  {selectedVoiceMode === "ai" && (voiceConfigurationMode === "silent" || aiVoiceSettingsAvailable) ? <button type="button" className={styles.voiceSettingsMain} data-video-audio-button disabled={locked || voiceConfigurationMode === "silent"}
                    aria-haspopup="dialog" aria-expanded={mediaSettingsDialog === "audio"} aria-controls={mediaSettingsDialog === "audio" ? `${instanceId}-video-audio-dialog` : undefined}
                    onClick={() => setMediaSettingsDialog("audio")}>{t("ai_generator_voice_details")}</button> : null}
                  <StudioVoicePool scopeKey={quota?.accountId ?? ""} visible={speechMode !== "silent" && selectedVoiceMode === "provided"}
                    available={!mediaSettingsDialog && !libraryOpen && !stopConfirmOpen && !exactDialogueOpen} onOpenChange={setVoicePoolOpen}
                    profiles={voiceProfiles} onChange={setVoiceProfiles} characters={voiceReferences.map(reference => ({ id: reference.id, name: reference.characterName || reference.name, characterName: reference.characterName, referenceIndex: references.findIndex(item => item.id === reference.id) }))}
                    onCharacterNameChange={(id, characterName) => { if (!locked) setReferences(current => current.map(reference => reference.id === id && reference.role === "character" ? { ...reference, characterName } : reference)); }}
                    selectedCharacterId={selectedVoiceReference?.id ?? null} speechMode={voiceConfigurationMode}
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
            </div>
          </div> : <p id={`${instanceId}-prompt-help`} className={styles.srOnly}>
            {requiredPromptSuffix ? i18nT("les_criteres_du_canal_sont_ajoutes_eb227fa2") : t("ai_generator_free_prompt_help")}
          </p>}
        </section>
          </div>
        </div>
        <div className={editorStyles.previewPane}>{preview}</div>
      </div>
      <div className={styles.footer} data-media-footer>
        {paidActionsLocked ? <p role="status">{subscriptionMessage}</p> : <MediaQuotaSummary kind={kind} counter={counter} unlimited={quota?.unlimited} creditsReady={quota?.creditsReady}
          resetDate={resetDate} locked={locked} onRefresh={() => { void loadQuota({ force: true }); }} />}
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
            {i18nT("value_inrstudio_872d053d", { value0: t("ai_generator_editor_recover") })}</a> : canRecover && !busy ? <div className={styles.recoveryActions} data-media-recovery-actions>
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
      {!paidActionsLocked && !quota && !quotaLoading ? (
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
        open={mediaSettingsDialog === "music"} available={editorAvailable && !stopConfirmOpen && !libraryOpen && !voicePoolOpen && !exactDialogueOpen && Boolean(quota?.accountId)}
        onOpen={() => setMediaSettingsDialog("music")} onClose={() => setMediaSettingsDialog(null)}
        onChange={(enabled, id) => { setWithMusic(enabled); setSoundtrackId(id); }}
        renderDialog={content => <MediaSettingsDialog id={`${instanceId}-video-music-dialog`} kind="music" title={t("ai_generator_music_title")} closeLabel={t("ai_generator_video_settings_close")} closeBlocked={locked} onClose={() => setMediaSettingsDialog(null)}>{content}</MediaSettingsDialog>} /> : null}
      {kind === "video" && mediaSettingsDialog === "audio" ? <MediaSettingsDialog id={`${instanceId}-video-audio-dialog`} kind="audio" title={t("ai_generator_narration_voice_label")} closeLabel={t("ai_generator_video_settings_close")} closeBlocked={locked} onClose={() => setMediaSettingsDialog(null)}>
        {audioControls}
      </MediaSettingsDialog> : null}
    </div>
  );
}
