import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  AI_ENGINE_OPTIONS,
  getAiEngineOption,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";
import AiEngineInfoModal from "../../../_components/AiEngineInfoModal";
import {
  BOOSTER_MAX_IMAGE_COUNT,
  BOOSTER_IMAGE_ACCEPT,
  BOOSTER_VIDEO_ACCEPT,
  getLocalizedBoosterImageFormats,
  getLocalizedBoosterImageLimits,
  getLocalizedBoosterMediaOptimization,
  getLocalizedBoosterRecommendedVideoDuration,
  getLocalizedBoosterSelectedMediaSummary,
  getLocalizedBoosterVideoFormats,
  getLocalizedBoosterVideoLimits,
  type ThemeKey,
} from "../publishModal.shared";
import { textAreaStyle } from "../publishModal.styles";
import { getGenerationMediaSelectionPolicy } from "../generationMediaSelection";
import PublishStepTitle from "./PublishStepTitle";

type PublishModalStyles = Readonly<Record<string, string>>;

function formatVideoSeconds(seconds: number | null) {
  if (!Number.isFinite(Number(seconds))) return "";
  const safeSeconds = Math.max(0, Math.round(Number(seconds)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

type VoiceState = "idle" | "recording" | "transcribing";
type VoiceRecordingMode = "media" | "liveOnly";
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

type VoiceSpeechRecognitionAlternative = {
  transcript?: string;
};

type VoiceSpeechRecognitionResult = {
  readonly isFinal?: boolean;
  readonly length: number;
  readonly [index: number]: VoiceSpeechRecognitionAlternative | undefined;
};

type VoiceSpeechRecognitionResultList = {
  readonly length: number;
  readonly [index: number]: VoiceSpeechRecognitionResult | undefined;
};

type VoiceSpeechRecognitionEvent = Event & {
  readonly results?: VoiceSpeechRecognitionResultList;
};

type VoiceSpeechRecognitionErrorEvent = Event & {
  readonly error?: string;
};

type VoiceSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: VoiceSpeechRecognitionEvent) => void) | null;
  onerror: ((event: VoiceSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type VoiceSpeechRecognitionConstructor = new () => VoiceSpeechRecognition;

const VOICE_MAX_SECONDS = 90;
const VOICE_MIN_BYTES = 900;

const voiceMimeCandidates = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg;codecs=opus",
  "audio/wav",
];

function formatVoiceDuration(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function pickVoiceMimeType() {
  if (
    typeof window === "undefined" ||
    typeof window.MediaRecorder === "undefined"
  )
    return "";
  if (typeof window.MediaRecorder.isTypeSupported !== "function") return "";
  try {
    return (
      voiceMimeCandidates.find((type) =>
        window.MediaRecorder.isTypeSupported(type),
      ) || ""
    );
  } catch {
    return "";
  }
}

function normalizeRecordedVoiceMimeType(type: string) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized.startsWith("video/mp4")) {
    return normalized.replace(/^video\/mp4/, "audio/mp4");
  }
  return normalized || "audio/webm";
}

function voiceExtensionFromMime(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  return "webm";
}

function appendVoiceText(current: string, next: string) {
  const cleanCurrent = current.trim();
  const cleanNext = next.trim();
  if (!cleanCurrent) return cleanNext;
  if (!cleanNext) return cleanCurrent;
  return `${cleanCurrent}\n${cleanNext}`;
}

function normalizeLiveVoiceText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanTranscriptTextForSubmission(value: string) {
  return normalizeLiveVoiceText(value).slice(0, 1400).trim();
}

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: VoiceSpeechRecognitionConstructor;
    webkitSpeechRecognition?: VoiceSpeechRecognitionConstructor;
  };
  return (
    speechWindow.SpeechRecognition ||
    speechWindow.webkitSpeechRecognition ||
    null
  );
}

function waitForVoiceWarmup(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getVoicePlatformInfo() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      isIOS: false,
      isSafari: false,
      hasSpeechRecognition: false,
      canUseLivePreview: false,
      shouldUseLiveOnly: false,
      shouldWarmupMicrophone: false,
    };
  }

  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const isIOS =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
  const isSafari =
    /Safari/i.test(userAgent) &&
    !/Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|Opera/i.test(userAgent);
  const hasSpeechRecognition = Boolean(getSpeechRecognitionConstructor());
  const hasMediaRecording = Boolean(
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof window.MediaRecorder !== "undefined",
  );
  const shouldUseLiveOnly = hasSpeechRecognition && !hasMediaRecording;

  return {
    isIOS,
    isSafari,
    hasSpeechRecognition,
    canUseLivePreview:
      hasSpeechRecognition && hasMediaRecording && !isIOS && !isSafari,
    shouldUseLiveOnly,
    shouldWarmupMicrophone: isIOS || isSafari,
  };
}

async function warmupVoiceMicrophoneIfNeeded() {
  const { shouldWarmupMicrophone } = getVoicePlatformInfo();
  if (!shouldWarmupMicrophone) return;

  try {
    if (window.sessionStorage.getItem("inrcy_voice_micro_warmed_v1") === "1")
      return;
  } catch {
    // sessionStorage peut être indisponible en navigation privée stricte.
  }

  const warmupStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
  });
  warmupStream.getTracks().forEach((track) => track.stop());

  try {
    window.sessionStorage.setItem("inrcy_voice_micro_warmed_v1", "1");
  } catch {
    // Best-effort only.
  }

  await waitForVoiceWarmup(450);
}

type PublishIntentPanelProps = {
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
  onImagesChange: (files: FileList | null) => void;
  onVideoChange: (files: FileList | null) => void;
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
  removeVideo: () => void;
  removeImage: (index: number) => void;
  useImagesForAI: boolean;
  setUseImagesForAI: Dispatch<SetStateAction<boolean>>;
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
  aiPreferredEngine: AiPreferredEngine;
  defaultAiPreferredEngine: AiPreferredEngine;
  onAiPreferredEngineChange: (engine: AiPreferredEngine) => void;
  onGenerate: () => void;
  onOpenAiConfiguration: () => void;
};

export default function PublishIntentPanel({
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
  onImagesChange,
  onVideoChange,
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
  removeVideo,
  removeImage,
  useImagesForAI,
  setUseImagesForAI,
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
  aiPreferredEngine,
  defaultAiPreferredEngine,
  onAiPreferredEngineChange,
  onGenerate,
  onOpenAiConfiguration,
}: PublishIntentPanelProps) {
  const i18nT = useTranslations("booster");
  const mediaT = useTranslations("media");
  const locale = useLocale();
  const runtimeT = i18nT as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceTarget, setVoiceTarget] = useState<VoiceTarget | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const [voiceErrorTarget, setVoiceErrorTarget] = useState<VoiceTarget>("idea");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [mobileInstructionExpanded, setMobileInstructionExpanded] =
    useState(false);
  const [engineInfoOpen, setEngineInfoOpen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceRecordingModeRef = useRef<VoiceRecordingMode | null>(null);
  const voiceTargetRef = useRef<VoiceTarget | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const maxRecordingTimerRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<VoiceSpeechRecognition | null>(null);
  const liveVoiceBaseTextRef = useRef("");
  const liveVoiceLastTextRef = useRef("");
  const hasLiveVoiceDraftRef = useRef(false);
  const liveOnlyUnavailableRef = useRef(false);
  const [liveVoiceEnabled, setLiveVoiceEnabled] = useState(false);
  const selectedAiEngineOption = getAiEngineOption(aiPreferredEngine);
  const visibleErrors = Array.from(
    new Set([imgError.trim(), genError.trim()].filter(Boolean)),
  );

  const setVoiceTargetText = (
    target: VoiceTarget,
    updater: SetStateAction<string>,
  ) => {
    if (target === "idea") {
      setIdea(updater);
      return;
    }
    setPublicationInstruction(updater);
  };

  const getVoiceTargetText = (target: VoiceTarget) =>
    target === "idea" ? idea : publicationInstruction;

  const setTargetedVoiceError = (target: VoiceTarget, message: string) => {
    setVoiceErrorTarget(target);
    setVoiceError(message);
  };

  const clearVoiceTarget = () => {
    voiceTargetRef.current = null;
    setVoiceTarget(null);
  };

  const clearVoiceTimers = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (maxRecordingTimerRef.current) {
      window.clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
  };

  const stopMediaStream = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const stopLiveSpeechRecognition = () => {
    const recognition = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    setLiveVoiceEnabled(false);
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
        // Best-effort cleanup only.
      }
    }
  };

  const resetLiveVoiceDraft = () => {
    liveVoiceBaseTextRef.current = "";
    liveVoiceLastTextRef.current = "";
    hasLiveVoiceDraftRef.current = false;
  };

  const startLiveSpeechRecognition = (
    baseText: string,
    target: VoiceTarget,
  ) => {
    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionConstructor) return false;

    try {
      stopLiveSpeechRecognition();
      resetLiveVoiceDraft();

      const recognition = new SpeechRecognitionConstructor();
      recognition.lang = locale;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      liveVoiceBaseTextRef.current = baseText;

      recognition.onresult = (event) => {
        const results = event.results;
        if (!results?.length) return;

        let liveText = "";
        for (let index = 0; index < results.length; index += 1) {
          const transcript = results[index]?.[0]?.transcript || "";
          liveText += ` ${transcript}`;
        }

        const normalizedLiveText = normalizeLiveVoiceText(liveText);
        if (!normalizedLiveText) return;

        liveVoiceLastTextRef.current = normalizedLiveText;
        hasLiveVoiceDraftRef.current = true;
        setVoiceTargetText(target, () =>
          appendVoiceText(liveVoiceBaseTextRef.current, normalizedLiveText),
        );
      };

      recognition.onerror = () => {
        speechRecognitionRef.current = null;
        setLiveVoiceEnabled(false);
        if (voiceRecordingModeRef.current === "liveOnly") {
          clearVoiceTimers();
          voiceRecordingModeRef.current = null;
          liveOnlyUnavailableRef.current = true;
          setRecordingSeconds(0);
          setVoiceState("idle");
          setTargetedVoiceError(
            target,
            i18nT("voice_live_unavailable"),
          );
          clearVoiceTarget();
        }
      };

      recognition.onend = () => {
        speechRecognitionRef.current = null;
        setLiveVoiceEnabled(false);
        if (voiceRecordingModeRef.current === "liveOnly") {
          clearVoiceTimers();
          voiceRecordingModeRef.current = null;
          void submitLiveVoiceTextForCorrection(target);
        }
      };

      recognition.start();
      speechRecognitionRef.current = recognition;
      setLiveVoiceEnabled(true);
      return true;
    } catch {
      speechRecognitionRef.current = null;
      setLiveVoiceEnabled(false);
      return false;
    }
  };

  const submitLiveVoiceTextForCorrection = async (target: VoiceTarget) => {
    const liveTranscript = cleanTranscriptTextForSubmission(
      liveVoiceLastTextRef.current,
    );
    if (!liveTranscript) {
      setTargetedVoiceError(
        target,
        i18nT("aucun_texte_n_a_ete_detecte_7c72cc50"),
      );
      resetLiveVoiceDraft();
      setVoiceState("idle");
      setRecordingSeconds(0);
      clearVoiceTarget();
      return;
    }

    setVoiceState("transcribing");
    setVoiceError("");

    try {
      const formData = new FormData();
      formData.append("text", liveTranscript);

      const response = await fetch("/api/booster/transcribe", {
        method: "POST",
        body: formData,
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          String(json?.user_message || json?.error || i18nT("correction_impossible_a95af972")),
        );
      }

      const correctedText = String(json?.text || "").trim();
      if (!correctedText) {
        throw new Error(i18nT("aucun_texte_n_a_ete_detecte_6273e0bf"));
      }

      setVoiceTargetText(target, () =>
        appendVoiceText(liveVoiceBaseTextRef.current, correctedText),
      );
      resetLiveVoiceDraft();
    } catch (error) {
      setTargetedVoiceError(
        target,
        i18nT("voice_correction_failed_live_kept"),
      );
      resetLiveVoiceDraft();
    } finally {
      setVoiceState("idle");
      setRecordingSeconds(0);
      clearVoiceTarget();
    }
  };

  const submitVoiceBlob = async (audioBlob: Blob, target: VoiceTarget) => {
    if (!audioBlob.size || audioBlob.size < VOICE_MIN_BYTES) {
      const liveDraftKept =
        hasLiveVoiceDraftRef.current && liveVoiceLastTextRef.current.trim();
      setTargetedVoiceError(
        target,
        liveDraftKept
          ? i18nT("voice_too_short_live_kept")
          : i18nT("voice_too_short"),
      );
      resetLiveVoiceDraft();
      setVoiceState("idle");
      clearVoiceTarget();
      return;
    }

    setVoiceState("transcribing");
    setVoiceError("");

    try {
      const mimeType = audioBlob.type || "audio/webm";
      const extension = voiceExtensionFromMime(mimeType);
      const audioFile = new File([audioBlob], `booster-vocal.${extension}`, {
        type: mimeType,
      });
      const formData = new FormData();
      formData.append("audio", audioFile);

      const response = await fetch("/api/booster/transcribe", {
        method: "POST",
        body: formData,
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          String(
            json?.user_message || json?.error || "Transcription impossible.",
          ),
        );
      }

      const transcript = String(json?.text || "").trim();
      if (!transcript) {
        throw new Error("Aucun texte n’a été détecté dans le vocal.");
      }

      if (hasLiveVoiceDraftRef.current) {
        setVoiceTargetText(target, () =>
          appendVoiceText(liveVoiceBaseTextRef.current, transcript),
        );
      } else {
        setVoiceTargetText(target, (current) =>
          appendVoiceText(current, transcript),
        );
      }
      resetLiveVoiceDraft();
    } catch (error) {
      const liveDraftKept =
        hasLiveVoiceDraftRef.current && liveVoiceLastTextRef.current.trim();
      setTargetedVoiceError(
        target,
        liveDraftKept
          ? i18nT("voice_transcription_failed_live_kept")
          : i18nT("voice_transcription_failed"),
      );
      resetLiveVoiceDraft();
    } finally {
      setVoiceState("idle");
      setRecordingSeconds(0);
      clearVoiceTarget();
    }
  };

  const stopVoiceRecording = () => {
    const recordingMode = voiceRecordingModeRef.current;

    if (recordingMode === "liveOnly") {
      clearVoiceTimers();
      stopLiveSpeechRecognition();
      voiceRecordingModeRef.current = null;
      const target = voiceTargetRef.current || "idea";
      void submitLiveVoiceTextForCorrection(target);
      return;
    }

    stopLiveSpeechRecognition();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    clearVoiceTimers();
    stopMediaStream();
    voiceRecordingModeRef.current = null;
    setVoiceState("idle");
    clearVoiceTarget();
  };

  const startLiveOnlyVoiceRecording = (target: VoiceTarget) => {
    const started = startLiveSpeechRecognition(
      getVoiceTargetText(target),
      target,
    );
    if (!started) {
      liveOnlyUnavailableRef.current = true;
      return false;
    }

    voiceRecordingModeRef.current = "liveOnly";
    setRecordingSeconds(0);
    setVoiceState("recording");
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((value) => Math.min(VOICE_MAX_SECONDS, value + 1));
    }, 1000);
    maxRecordingTimerRef.current = window.setTimeout(() => {
      stopVoiceRecording();
    }, VOICE_MAX_SECONDS * 1000);
    return true;
  };

  const startMediaVoiceRecording = async (
    allowLivePreview: boolean,
    target: VoiceTarget,
  ) => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof window.MediaRecorder === "undefined"
    ) {
      setTargetedVoiceError(
        target,
        i18nT("voice_recording_unsupported"),
      );
      setVoiceState("idle");
      clearVoiceTarget();
      return;
    }

    try {
      await warmupVoiceMicrophoneIfNeeded();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Conserver la référence avant le constructeur permet de libérer le micro
      // même si une WebView mobile annonce MediaRecorder mais refuse son codec.
      mediaStreamRef.current = stream;
      const mimeType = pickVoiceMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      voiceRecordingModeRef.current = "media";

      recorder.ondataavailable = (event) => {
        if (event.data?.size) audioChunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        setTargetedVoiceError(
          target,
          i18nT("voice_micro_recording_error"),
        );
        clearVoiceTimers();
        stopLiveSpeechRecognition();
        resetLiveVoiceDraft();
        stopMediaStream();
        voiceRecordingModeRef.current = null;
        setVoiceState("idle");
        clearVoiceTarget();
      };

      recorder.onstop = () => {
        clearVoiceTimers();
        stopMediaStream();
        const type = normalizeRecordedVoiceMimeType(
          audioChunksRef.current[0]?.type ||
            recorder.mimeType ||
            mimeType ||
            "audio/webm",
        );
        const audioBlob = new Blob(audioChunksRef.current, { type });
        mediaRecorderRef.current = null;
        voiceRecordingModeRef.current = null;
        audioChunksRef.current = [];
        void submitVoiceBlob(audioBlob, target);
      };

      // Un bloc unique est plus fiable que des fragments MP4/WebM concaténés
      // sur Safari iOS, Chrome Android et les navigateurs embarqués.
      recorder.start();
      if (allowLivePreview) {
        startLiveSpeechRecognition(getVoiceTargetText(target), target);
      }
      setRecordingSeconds(0);
      setVoiceState("recording");
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((value) => Math.min(VOICE_MAX_SECONDS, value + 1));
      }, 1000);
      maxRecordingTimerRef.current = window.setTimeout(() => {
        stopVoiceRecording();
      }, VOICE_MAX_SECONDS * 1000);
    } catch (error) {
      stopLiveSpeechRecognition();
      resetLiveVoiceDraft();
      stopMediaStream();
      voiceRecordingModeRef.current = null;
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setTargetedVoiceError(
          target,
          i18nT("voice_micro_permission_denied"),
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setTargetedVoiceError(target, i18nT("voice_micro_not_found"));
      } else if (
        getVoicePlatformInfo().hasSpeechRecognition &&
        startLiveOnlyVoiceRecording(target)
      ) {
        return;
      } else {
        setTargetedVoiceError(
          target,
          i18nT("voice_micro_activation_failed"),
        );
      }
      setVoiceState("idle");
      clearVoiceTarget();
    }
  };

  const startVoiceRecording = async (target: VoiceTarget) => {
    setVoiceErrorTarget(target);
    setVoiceError("");
    voiceTargetRef.current = target;
    setVoiceTarget(target);
    stopLiveSpeechRecognition();
    resetLiveVoiceDraft();
    voiceRecordingModeRef.current = null;

    if (typeof window === "undefined" || typeof navigator === "undefined")
      return;
    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      setTargetedVoiceError(
        target,
        i18nT("voice_https_required"),
      );
      clearVoiceTarget();
      return;
    }

    const platformInfo = getVoicePlatformInfo();
    if (
      platformInfo.shouldUseLiveOnly &&
      !liveOnlyUnavailableRef.current &&
      startLiveOnlyVoiceRecording(target)
    ) {
      return;
    }

    await startMediaVoiceRecording(platformInfo.canUseLivePreview, target);
  };

  const onVoiceButtonClick = (target: VoiceTarget) => {
    if (voiceState === "recording" && voiceTarget === target) {
      stopVoiceRecording();
      return;
    }
    if (voiceState === "idle") {
      void startVoiceRecording(target);
    }
  };

  useEffect(() => {
    return () => {
      clearVoiceTimers();
      stopLiveSpeechRecognition();
      stopMediaStream();
      voiceRecordingModeRef.current = null;
      voiceTargetRef.current = null;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state === "recording") recorder.stop();
    };
  }, []);

  const generationDisabled = generating || voiceState !== "idle";
  const isVoiceTargetDisabled = (target: VoiceTarget) =>
    generating ||
    voiceState === "transcribing" ||
    (voiceState === "recording" && voiceTarget !== target);
  const getVoiceButtonLabel = (target: VoiceTarget) =>
    voiceTarget === target && voiceState === "recording"
      ? i18nT("arreter_le_vocal_value_aace3fb5", {
          value0: formatVoiceDuration(recordingSeconds),
        })
      : voiceTarget === target && voiceState === "transcribing"
        ? i18nT("correction_du_vocal_en_cours_2a811504")
        : target === "idea"
          ? i18nT("dicter_le_sujet_f14f51b5")
          : i18nT("dicter_la_consigne_ponctuelle_312b62b3");
  const getVoiceButtonShortLabel = (target: VoiceTarget) =>
    voiceTarget === target && voiceState === "recording"
      ? `■ ${formatVoiceDuration(recordingSeconds)}`
      : voiceTarget === target && voiceState === "transcribing"
        ? "…"
        : "🎙️";

  const renderIntentField = (args: {
    target: VoiceTarget;
    label: string;
    helper: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    maxLength?: number;
  }) => {
    const targetActive = voiceTarget === args.target;
    const voiceDisabled = isVoiceTargetDisabled(args.target);
    return (
      <div style={{ minWidth: 0, display: "grid", alignContent: "start" }}>
        <div
          style={{
            minHeight: isMobile ? 34 : 38,
            marginBottom: 6,
            display: "grid",
            alignContent: "start",
            gap: 2,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.94 }}>
            {args.label}
          </div>
          <div style={{ fontSize: 10.5, opacity: 0.68, lineHeight: 1.2 }}>
            {args.helper}
          </div>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ position: "relative", minWidth: 0 }}>
            <textarea
              placeholder={args.placeholder}
              style={{
                ...textAreaStyle,
                minHeight: isMobile ? 104 : 130,
                paddingRight: isMobile ? 58 : 66,
                paddingBottom: isMobile ? 52 : 56,
              }}
              value={args.value}
              maxLength={args.maxLength}
              onChange={(event) => args.onChange(event.target.value)}
            />
            <button
              type="button"
              className={
                targetActive && voiceState === "recording"
                  ? styles.primaryBtn
                  : styles.secondaryBtn
              }
              onClick={() => onVoiceButtonClick(args.target)}
              disabled={voiceDisabled}
              aria-label={getVoiceButtonLabel(args.target)}
              title={i18nT(
                args.target === "idea"
                  ? "voice_subject_title"
                  : "voice_instruction_title",
              )}
              style={{
                position: "absolute",
                right: isMobile ? 10 : 12,
                bottom: isMobile ? 10 : 12,
                zIndex: 2,
                minWidth:
                  targetActive && voiceState === "recording"
                    ? isMobile
                      ? 82
                      : 90
                    : isMobile
                      ? 38
                      : 42,
                height: isMobile ? 36 : 40,
                minHeight: isMobile ? 36 : 40,
                borderRadius: 999,
                padding:
                  targetActive && voiceState === "recording"
                    ? isMobile
                      ? "0 10px"
                      : "0 12px"
                    : 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize:
                  targetActive && voiceState === "recording"
                    ? isMobile
                      ? 11
                      : 12
                    : isMobile
                      ? 16
                      : 18,
                fontWeight: 950,
                lineHeight: 1,
                whiteSpace: "nowrap",
                boxShadow: "0 10px 24px rgba(0,0,0,0.28)",
                opacity: voiceDisabled ? 0.6 : 1,
                cursor: voiceDisabled ? "not-allowed" : "pointer",
              }}
            >
              {getVoiceButtonShortLabel(args.target)}
            </button>
          </div>
          {targetActive && voiceState === "recording" ? (
            <div
              style={{
                fontSize: isMobile ? 11 : 12,
                color: "#ffdfdf",
                fontWeight: 800,
              }}
            >
              {liveVoiceEnabled
                ? i18nT("les_mots_apparaissent_en_direct_recliquez_cf12629c")
                : i18nT("parlez_maintenant_puis_recliquez_sur_le_2a84f44e")}
            </div>
          ) : null}
          {targetActive && voiceState === "transcribing" ? (
            <div
              style={{
                fontSize: isMobile ? 11 : 12,
                color: "#dff6ff",
                fontWeight: 800,
              }}
            >
              {i18nT("transcription_correction_en_cours_a793d172")}{" "}</div>
          ) : null}
          {voiceError && voiceErrorTarget === args.target ? (
            <div
              style={{ fontSize: 12.5, color: "#ffb4b4", lineHeight: 1.35 }}
            >
              {voiceError}
            </div>
          ) : null}
        </div>
      </div>
    );
  };
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

  return (
    <div
      className={styles.blockCard}
      style={{ minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <PublishStepTitle
          styles={styles}
          step={stepNumber}
          testId="booster-intention-title"
        >
          {i18nT("votre_intention_97631932")}{" "}</PublishStepTitle>
      </div>
      <div
        className={styles.subtitle}
        style={{ marginBottom: 10, maxWidth: "none", whiteSpace: "normal" }}
      >
        {i18nT("decrivez_le_sujet_de_cette_publication_d6313015")}{" "}{" "}
        <strong>{getLocalizedBoosterMediaOptimization("generation", runtimeT)}</strong>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile
              ? "minmax(0, 1fr)"
              : "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 10,
            alignItems: "start",
            minWidth: 0,
          }}
        >
          {renderIntentField({
            target: "idea",
            label: i18nT("sujet_de_la_publication_obligatoire_pour_62d82326"),
            helper: i18nT("le_theme_et_les_faits_a_3ed5ecc7"),
            placeholder: runtimeT(THEME_PLACEHOLDER_KEYS[theme] || THEME_PLACEHOLDER_KEYS[""]),
            value: idea,
            onChange: setIdea,
          })}

          {isMobile ? (
            <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() =>
                  setMobileInstructionExpanded((current) => !current)
                }
                aria-expanded={mobileInstructionExpanded}
                style={{
                  width: "100%",
                  minHeight: 38,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "7px 11px",
                  borderRadius: 12,
                  textAlign: "left",
                  fontSize: 12,
                  fontWeight: 850,
                }}
              >
                <span>
                  {publicationInstruction.trim()
                    ? i18nT("consigne_ajoutee_modifier_ee9b29d7")
                    : i18nT("ajouter_une_consigne_a_l_ia_d2a6adfb")}
                </span>
                <span aria-hidden="true">
                  {mobileInstructionExpanded ? "▴" : "▾"}
                </span>
              </button>
              {mobileInstructionExpanded
                ? renderIntentField({
                    target: "instruction",
                    label: i18nT("consigne_ponctuelle_a_l_ia_facultatif_cf850551"),
                    helper:
                      i18nT("prioritaire_sur_votre_configuration_ia_pour_5278e325"),
                    placeholder:
                      i18nT("ex_insistez_sur_la_personnalisation_redigez_19b7a61d"),
                    value: publicationInstruction,
                    onChange: setPublicationInstruction,
                    maxLength: 4_000,
                  })
                : null}
            </div>
          ) : (
            renderIntentField({
              target: "instruction",
              label: i18nT("consigne_ponctuelle_a_l_ia_facultatif_cf850551"),
              helper:
                i18nT("prioritaire_sur_votre_configuration_ia_pour_5278e325"),
              placeholder:
                i18nT("ex_insistez_sur_la_personnalisation_redigez_19b7a61d"),
              value: publicationInstruction,
              onChange: setPublicationInstruction,
              maxLength: 4_000,
            })
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={BOOSTER_IMAGE_ACCEPT}
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            onImagesChange(e.target.files);
            e.currentTarget.value = "";
          }}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept={BOOSTER_VIDEO_ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            onVideoChange(e.target.files);
            e.currentTarget.value = "";
          }}
        />
        <div
          style={{
            display: "grid",
            gap: isMobile ? 8 : 10,
            minWidth: 0,
            padding: isMobile ? "8px 10px" : "10px 12px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.035)",
            overflow: "visible",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 7 : 8,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={onPickImagesClick}
              disabled={pickImagesDisabled}
              title={
                hasVideoMedia
                  ? i18nT("generation_images_blocked_by_video")
                  : imagesLimitReached
                    ? i18nT("generation_images_limit", { count: BOOSTER_MAX_IMAGE_COUNT })
                    : `${getLocalizedBoosterImageLimits(runtimeT)} · ${getLocalizedBoosterImageFormats(runtimeT)}`
              }
              style={{
                flex: "0 0 auto",
                minHeight: isMobile ? 32 : 34,
                padding: isMobile ? "6px 9px" : "7px 12px",
                fontSize: isMobile ? 11 : 12,
                whiteSpace: "nowrap",
                opacity: pickImagesDisabled ? 0.48 : 1,
                filter: pickImagesDisabled ? "grayscale(1)" : undefined,
                cursor: pickImagesDisabled ? "not-allowed" : "pointer",
              }}
            >
              {i18nT("ajouter_des_images_79088d11")}{" "}</button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={onPickVideoClick}
              disabled={pickVideoDisabled}
              title={
                hasImages
                  ? i18nT("generation_video_blocked_by_images")
                  : pickVideoDisabled
                    ? i18nT("generation_video_limit")
                    : `${getLocalizedBoosterVideoLimits(runtimeT)} · ${getLocalizedBoosterVideoFormats(runtimeT)} · ${getLocalizedBoosterRecommendedVideoDuration(runtimeT)}`
              }
              style={{
                flex: "0 0 auto",
                minHeight: isMobile ? 32 : 34,
                padding: isMobile ? "6px 9px" : "7px 12px",
                fontSize: isMobile ? 11 : 12,
                whiteSpace: "nowrap",
                opacity: pickVideoDisabled ? 0.48 : 1,
                filter: pickVideoDisabled ? "grayscale(1)" : undefined,
                cursor: pickVideoDisabled ? "not-allowed" : "pointer",
              }}
            >
              {i18nT("ajouter_une_video_c0be31cb")}{" "}</button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={onGenerateMedia}
              title={mediaT("ai_generator_generate_media")}
              style={{
                flex: "0 0 auto",
                minHeight: isMobile ? 32 : 34,
                padding: isMobile ? "6px 9px" : "7px 12px",
                fontSize: isMobile ? 11 : 12,
                whiteSpace: "nowrap",
                borderColor: "rgba(81,215,255,0.34)",
                background:
                  "linear-gradient(135deg, rgba(38,180,238,0.20), rgba(183,65,197,0.24))",
              }}
            >
              ✦ {mediaT("ai_generator_generate_media")}
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={onOpenMediaLibrary}
              title={i18nT("ajouter_depuis_la_mediatheque_d0f700b2")}
              style={{
                flex: "0 0 auto",
                minHeight: isMobile ? 32 : 34,
                padding: isMobile ? "6px 9px" : "7px 12px",
                fontSize: isMobile ? 11 : 12,
                whiteSpace: "nowrap",
              }}
            >
              {i18nT("mediatheque_f23ba807")}{" "}</button>
            <span
              title={
                !isMobile
                  ? i18nT("camera_mobile_only")
                  : hasVideoMedia
                    ? i18nT("camera_open_to_take_photo")
                    : imagesLimitReached
                      ? i18nT("generation_images_limit", { count: BOOSTER_MAX_IMAGE_COUNT })
                      : hasImages
                        ? i18nT("camera_open_to_take_photo")
                        : i18nT("camera_open_photo_or_video")
              }
              style={{ display: "inline-flex", flex: "0 0 auto" }}
            >
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={!cameraDisabled ? onTakePhotoClick : undefined}
                disabled={cameraDisabled}
                aria-disabled={cameraDisabled}
                style={{
                  flex: "0 0 auto",
                  minHeight: 32,
                  padding: "6px 9px",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  opacity: cameraDisabled ? 0.48 : 1,
                  filter: cameraDisabled ? "grayscale(1)" : undefined,
                  cursor: cameraDisabled ? "not-allowed" : "pointer",
                }}
              >
                {i18nT("appareil_inrcy_89d04cc9")}{" "}</button>
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 7 : 8,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                flex: "1 1 100%",
                minWidth: 0,
                fontSize: isMobile ? 10.5 : 12,
                opacity: hasImages || hasVideoMedia ? 0.85 : 0.7,
                lineHeight: 1.45,
                overflowWrap: "anywhere",
              }}
            >
              {getLocalizedBoosterSelectedMediaSummary({
                imageCount: images.length,
                hasVideo: hasVideoMedia,
                context: "generation",
              }, runtimeT)}
              <span style={{ opacity: 0.74 }}>
                {hasImages ? ` · ${getLocalizedBoosterImageFormats(runtimeT)}` : ""}
                {hasVideoMedia
                  ? ` · ${getLocalizedBoosterVideoFormats(runtimeT)} · ${getLocalizedBoosterRecommendedVideoDuration(runtimeT)}`
                  : ""}
              </span>
            </div>
            <label
              title={i18nT(
                useImagesForAI
                  ? "generation_images_used_by_ai"
                  : "generation_images_publication_only",
              )}
              style={{
                flex: "0 0 auto",
                display: "inline-flex",
                alignItems: "center",
                gap: isMobile ? 5 : 7,
                minHeight: isMobile ? 30 : 32,
                padding: isMobile ? "5px 8px" : "6px 10px",
                borderRadius: 999,
                border: useImagesForAI
                  ? "1px solid rgba(76,195,255,0.34)"
                  : "1px solid rgba(255,255,255,0.14)",
                background: useImagesForAI
                  ? "rgba(76,195,255,0.12)"
                  : "rgba(255,255,255,0.055)",
                color: useImagesForAI ? "#dff6ff" : "rgba(255,255,255,0.76)",
                fontSize: isMobile ? 10.5 : 12,
                fontWeight: 850,
                whiteSpace: "nowrap",
                cursor: images.length ? "pointer" : "default",
                userSelect: "none",
                opacity: images.length ? 1 : 0.9,
              }}
            >
              <input
                type="checkbox"
                checked={useImagesForAI}
                disabled={!images.length}
                onChange={(event) => setUseImagesForAI(event.target.checked)}
                style={{
                  width: isMobile ? 13 : 14,
                  height: isMobile ? 13 : 14,
                  margin: 0,
                  accentColor: "#4cc3ff",
                }}
              />
              {useImagesForAI
                ? i18nT("images_utilisees_par_l_ia_27b19f51")
                : i18nT("images_hors_generation_c3e94f90")}
            </label>
          </div>

          {videoPreviewUrl && videoFile ? (
            <div
              style={{
                display: isMobile ? "grid" : "flex",
                alignItems: "center",
                justifyContent: isMobile ? "center" : "flex-start",
                gap: isMobile ? 10 : 12,
                padding: isMobile ? 10 : 12,
                borderRadius: 14,
                border: "1px solid rgba(76,195,255,0.22)",
                background: "rgba(76,195,255,0.08)",
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: isMobile ? "100%" : 260,
                  maxWidth: isMobile ? "min(100%, 260px)" : "100%",
                  marginInline: isMobile ? "auto" : undefined,
                  justifySelf: isMobile ? "center" : undefined,
                  alignSelf: isMobile ? "center" : undefined,
                  aspectRatio: "16 / 9",
                  height: "auto",
                  borderRadius: 12,
                  background: "#050816",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 10px 28px rgba(0,0,0,0.28)",
                }}
              >
                <video
                  src={videoPreviewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    borderRadius: 12,
                    background: "#050816",
                    display: "block",
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: isMobile ? "center" : "space-between",
                  gap: 8,
                  minWidth: 0,
                  width: isMobile ? "100%" : "min(360px, 100%)",
                  textAlign: isMobile ? "center" : "left",
                }}
              >
                <strong
                  style={{
                    fontSize: isMobile ? 11 : 12,
                    maxWidth: isMobile ? 230 : 300,
                    overflowWrap: "anywhere",
                    lineHeight: 1.25,
                  }}
                >
                  {videoFile.name}
                </strong>
                <button
                  type="button"
                  aria-label={i18nT("supprimer_la_video_pour_tous_les_42f4e867")}
                  title={i18nT("supprimer_la_video_pour_tous_les_42f4e867")}
                  onClick={removeVideo}
                  style={{
                    flex: "0 0 auto",
                    width: isMobile ? 30 : 32,
                    height: isMobile ? 30 : 32,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.22)",
                    background: "rgba(255,255,255,0.10)",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    fontSize: isMobile ? 13 : 14,
                    boxShadow: "0 8px 18px rgba(0,0,0,0.22)",
                  }}
                >
                  🗑️
                </button>
              </div>
            </div>
          ) : null}

          {imagePreviews.length ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: isMobile ? 6 : 7,
                minWidth: 0,
                overflow: "visible",
                flexWrap: "wrap",
              }}
            >
              {imagePreviews.map((url, index) => (
                <div
                  key={`${url}-${index}`}
                  title={images[index]?.name || `Image ${index + 1}`}
                  style={{
                    position: "relative",
                    width: isMobile ? 38 : 48,
                    height: isMobile ? 38 : 48,
                    flex: "0 0 auto",
                    borderRadius: 10,
                    overflow: "hidden",
                    border: "1px solid rgba(255,255,255,0.20)",
                    background: "rgba(255,255,255,0.06)",
                  }}
                >
                  <img
                    src={url}
                    alt={i18nT("image_value_5907a7ef", { value0: index + 1 })}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                  <button
                    type="button"
                    aria-label={i18nT("supprimer_l_image_value_pour_tous_561091e2", { value0: index + 1 })}
                    title={i18nT("supprimer_l_image_value_pour_tous_561091e2", { value0: index + 1 })}
                    onClick={() => removeImage(index)}
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      width: isMobile ? 17 : 18,
                      height: isMobile ? 17 : 18,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.30)",
                      background: "rgba(10,16,30,0.88)",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontSize: isMobile ? 11 : 12,
                      fontWeight: 900,
                      lineHeight: 1,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {visibleErrors.map((message) => (
          <div
            key={message}
            role="alert"
            style={{ fontSize: 13, color: "#ffb4b4" }}
          >
            {message}
          </div>
        ))}
        {showMediaOptimizerAction && onOpenMediaOptimizer ? (
          <button
            type="button"
            onClick={() => onOpenMediaOptimizer()}
            style={{
              justifySelf: "start",
              border: "1px solid rgba(105,239,255,0.42)",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(47,209,255,0.24), rgba(155,81,255,0.28))",
              color: "#effcff",
              padding: "9px 14px",
              fontSize: 12,
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {i18nT("optimiser_le_media_1bc4fc40")}{" "}</button>
        ) : null}
        {generationNotice ? (
          <div
            role="status"
            style={{
              fontSize: 13,
              lineHeight: 1.4,
              color: "#dff6ff",
              border: "1px solid rgba(126, 220, 255, 0.28)",
              background: "rgba(78, 177, 220, 0.10)",
              borderRadius: 10,
              padding: "8px 10px",
            }}
          >
            {generationNotice}
          </div>
        ) : null}
        <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
          <div
            style={{
              display: "grid",
              gap: isMobile ? 5 : 0,
              width: isMobile ? "100%" : "fit-content",
              maxWidth: "100%",
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: isMobile ? "grid" : "inline-flex",
                alignItems: isMobile ? "stretch" : "center",
                gap: isMobile ? 5 : 7,
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
                  width: isMobile ? "100%" : 280,
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
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`${styles.primaryBtn} ${styles.aiGenerateBtn}`}
              onClick={onGenerate}
              disabled={generationDisabled}
            >
              {generating
                ? i18nT("generation_avec_value_0ba06089", { value0: selectedAiEngineOption.shortLabel })
                : voiceState !== "idle"
                  ? i18nT("vocal_en_cours_6e444e8f")
                  : i18nT("generer_avec_inrcy_58900495")}
            </button>
          </div>
          {generationMediaWarning ? (
            <div
              role="status"
              style={{
                width: "min(620px, 100%)",
                fontSize: 12.5,
                lineHeight: 1.4,
                color: "#ffd7a3",
                border: "1px solid rgba(251, 146, 60, 0.34)",
                background: "rgba(251, 146, 60, 0.10)",
                borderRadius: 10,
                padding: "8px 10px",
              }}
            >
              ⚠️ {generationMediaWarning}
            </div>
          ) : null}
          {generating ? (
            <div
              style={{
                width: "min(520px, 100%)",
                display: "grid",
                gap: 7,
                color: "rgba(255,255,255,0.72)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 10,
                  fontSize: 12,
                  lineHeight: 1.25,
                }}
              >
                <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <strong
                    style={{
                      color: "rgba(255,255,255,0.94)",
                      fontSize: 12,
                      lineHeight: 1.2,
                    }}
                  >
                    {i18nT("etape_13146b48")}{" "}{Math.max(1, generationPhaseIndex)}/{generationPhaseTotal}
                    {generationPhaseLabel ? ` · ${generationPhaseLabel}` : ""}
                  </strong>
                  <span
                    style={{
                      color: "rgba(255,255,255,0.66)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {generationStage || i18nT("generation_en_cours_01513ecf")}
                  </span>
                </div>
                <strong
                  style={{
                    color: "rgba(255,255,255,0.9)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {generationProgress}%
                </strong>
              </div>
              <div
                aria-hidden="true"
                style={{
                  height: 7,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${generationProgress}%`,
                    borderRadius: 999,
                    background:
                      "linear-gradient(90deg, rgba(76,195,255,0.92), rgba(99,102,241,0.95))",
                    transition: "width 420ms ease",
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <AiEngineInfoModal
        open={engineInfoOpen}
        activeEngine={aiPreferredEngine}
        onClose={() => setEngineInfoOpen(false)}
      />
    </div>
  );
}
