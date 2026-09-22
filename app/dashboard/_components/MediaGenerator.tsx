"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import useMediaGeneration, {
  MediaGenerationAccountChangedError,
  MediaGenerationCancelledError,
  type MediaGenerationFormat,
  type MediaGenerationImageStyle,
  type MediaGenerationImagePurpose,
  type MediaGenerationInspirationImage,
  type MediaGenerationKind,
  type MediaGenerationLogoMode,
  type MediaGenerationNarrationVoice,
  type MediaGenerationNarrationVoiceVariant,
  type MediaGenerationPeopleMode,
  type MediaGenerationReferenceRole,
  type MediaGenerationResult,
  type MediaGenerationSource,
  type MediaGenerationSubjectSource,
  type MediaGenerationTypology,
  type MediaGenerationVisualDirection,
  type MediaGenerationVisualStyle,
  type MediaGenerationVideoDuration,
  type MediaGenerationVideoCharacterMode,
  type MediaGenerationTeamVideoSpeechMode,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import useAiMediaGeneratorPreferences from "@/app/dashboard/_hooks/useAiMediaGeneratorPreferences";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "@/app/dashboard/_components/MediaLibraryPickerModal";
import type { AiMediaGeneratorBlockDefaults } from "@/lib/aiMediaGenerationPreferences";
import {
  AI_MEDIA_INSPIRATION_MAX_COUNT,
  AI_MEDIA_INSPIRATION_MAX_DIMENSION,
  AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS,
  AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES,
  AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES,
  aiMediaBriefRequestsVisibleText,
  resolveAiMediaPreviewFormat,
} from "@/lib/aiMediaGenerationContracts";
import {
  AI_MEDIA_NARRATION_VOICE_VARIANTS,
  defaultAiMediaNarrationVoiceVariant,
  isAiMediaNarrationVoiceVariantForGender,
} from "@/lib/aiMediaNarrationVoices";
import {
  INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS,
  INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  INR_MEDIA_IMAGE_FORMATS_LABEL,
  INR_MEDIA_IMAGE_MAX_MB_LABEL,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL,
  isInrMediaVideoFile,
  isInrMediaImageFile,
} from "@/lib/mediaRules";
import { uploadUniversalMediaFile } from "@/lib/universalMediaUploadClient";
import MediaSubjectVoiceButton from "./MediaSubjectVoiceButton";

import styles from "./MediaGenerator.module.css";

export type MediaGeneratorOrigin = "menu" | "booster" | "inrsend" | "inragent";
export type MediaGeneratorAcceptMode = "library" | "insert";
export type MediaGeneratorStudioMode = "generate" | "modify" | "retouch";

type MediaGeneratorProps = {
  source: MediaGenerationSource;
  origin: MediaGeneratorOrigin;
  publicationBrief?: string;
  acceptMode: MediaGeneratorAcceptMode;
  studioMode?: MediaGeneratorStudioMode;
  mediaType?: MediaGenerationKind;
  onAccepted: (result: MediaGenerationResult) => void | Promise<void>;
  onResultChange?: (result: MediaGenerationResult | null) => void;
  onBusyChange?: (busy: boolean) => void;
};

const FORMATS: Array<{
  id: MediaGenerationFormat;
  icon: string;
  ratio: string;
}> = [
  { id: "square", icon: "□", ratio: "1:1" },
  { id: "portrait", icon: "▯", ratio: "4:5" },
  { id: "story", icon: "▯", ratio: "9:16" },
  { id: "landscape", icon: "▭", ratio: "16:9" },
];

type StudioMediaSourceMode = "ai" | "criteria" | "real";
type StudioAiPeopleCriterion =
  | "auto"
  | "none"
  | "one"
  | "two"
  | "three"
  | "group";
type StudioAiSettingCriterion =
  | "auto"
  | "interior"
  | "exterior"
  | "studio"
  | "neutral";
type StudioAiFocusCriterion =
  | "auto"
  | "people"
  | "product"
  | "environment";
type StudioCharacterCount = 0 | 1 | 2 | 3;
type StudioImagePurpose = MediaGenerationImagePurpose;
type StudioVisualDirection = MediaGenerationVisualDirection;
type StudioTextMode = "none" | "ai" | "exact";
type StudioVideoSceneMode = "single" | "multi";
type StudioRequiredReferenceRole = Exclude<
  MediaGenerationReferenceRole,
  "inspiration"
>;
type StudioReferenceImage = MediaGenerationInspirationImage & {
  usage: "required" | "inspiration";
};

const IMAGE_STYLES: MediaGenerationImageStyle[] = [
  "photo",
  "illustration",
  "three_d",
  "graphic",
];
const LOGO_MODES: MediaGenerationLogoMode[] = ["discreet", "visible", "none"];
const MAX_TEXT_KEYWORDS = 6;
const MAX_INSPIRATION_IMAGES = AI_MEDIA_INSPIRATION_MAX_COUNT;
const IMAGE_PURPOSES: Array<{ id: StudioImagePurpose; label: string }> = [
  { id: "auto", label: "Déduit de ma consigne" },
  { id: "simple", label: "Image simple" },
  { id: "social", label: "Publication sociale" },
  { id: "flyer", label: "Flyer" },
  { id: "product_sheet", label: "Fiche produit" },
  { id: "poster", label: "Affiche" },
  { id: "banner", label: "Bannière" },
  { id: "infographic", label: "Infographie" },
];
const VISUAL_DIRECTIONS: Array<{
  id: StudioVisualDirection;
  label: string;
}> = [
  { id: "auto", label: "Déduite de ma consigne" },
  { id: "clean", label: "Épurée" },
  { id: "premium", label: "Premium" },
  { id: "warm", label: "Chaleureuse" },
  { id: "dynamic", label: "Dynamique" },
  { id: "bold", label: "Audacieuse" },
];
const AI_PEOPLE_CRITERIA: StudioAiPeopleCriterion[] = [
  "auto",
  "none",
  "one",
  "two",
  "three",
  "group",
];
const AI_SETTING_CRITERIA: StudioAiSettingCriterion[] = [
  "auto",
  "interior",
  "exterior",
  "studio",
  "neutral",
];
const AI_FOCUS_CRITERIA: StudioAiFocusCriterion[] = [
  "auto",
  "people",
  "product",
  "environment",
];
const REQUIRED_REFERENCE_ROLES: Array<{
  id: StudioRequiredReferenceRole;
  label: string;
}> = [
  {
    id: "character",
    label: "Personnage(s) · nombre détecté automatiquement",
  },
  { id: "product", label: "Produit / objet" },
  { id: "environment", label: "Décor / lieu" },
];
const INSPIRATION_IMAGE_ACCEPT = [
  ...INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  ...INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

function normalizeCharacterReferenceIndexes(images: StudioReferenceImage[]) {
  let characterIndex = 0;
  return images.map((image) => {
    if (image.role !== "character") {
      const { characterIndex: _characterIndex, ...withoutCharacterIndex } =
        image;
      return withoutCharacterIndex;
    }
    characterIndex += 1;
    if (characterIndex > 3) {
      const { characterIndex: _characterIndex, ...withoutCharacterIndex } =
        image;
      return {
        ...withoutCharacterIndex,
        role: "inspiration" as const,
        usage: "inspiration" as const,
      };
    }
    return {
      ...image,
      characterIndex: characterIndex as 1 | 2 | 3,
    };
  });
}

function inferRequiredReferenceRole(
  fileName: string
): StudioRequiredReferenceRole {
  const normalized = String(fileName || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
  if (
    /person|portrait|visage|equipe|team|collaborateur|dirigeant/.test(
      normalized
    )
  ) {
    return "character";
  }
  if (/decor|lieu|local|boutique|atelier|bureau|environment/.test(normalized)) {
    return "environment";
  }
  return "product";
}

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

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error("L’image d’inspiration n’a pas pu être préparée.")
            ),
      "image/jpeg",
      quality
    );
  });
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("L’image d’inspiration n’a pas pu être lue."));
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

async function prepareInspirationImageInBrowser(
  file: File
): Promise<MediaGenerationInspirationImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("L’image d’inspiration est illisible."));
      image.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("L’image d’inspiration est illisible.");
    }

    let scale = Math.min(
      1,
      AI_MEDIA_INSPIRATION_MAX_DIMENSION /
        Math.max(image.naturalWidth, image.naturalHeight)
    );
    let output: Blob | null = null;
    for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context)
        throw new Error("L’image d’inspiration n’a pas pu être préparée.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.88, 0.78, 0.68]) {
        const candidate = await canvasBlob(canvas, quality);
        if (candidate.size <= AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES) {
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

async function discardTransientInspirationImage(storagePath: string) {
  if (!storagePath) return;
  await fetch("/api/media-generation/normalize-reference", {
    method: "DELETE",
    credentials: "include",
    cache: "no-store",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storagePath }),
  }).catch(() => undefined);
}

async function prepareInspirationImageOnServer(
  file: File
): Promise<MediaGenerationInspirationImage> {
  const uploaded = await uploadUniversalMediaFile(file, {
    target: "ai_identity_reference",
    requestedFolder: "studio-identity-reference",
    source: "studio",
  });
  const storagePath = String(uploaded.storagePath || "");
  if (!storagePath) {
    throw new Error("La conversion de cette image n’a pas pu démarrer.");
  }

  try {
    const response = await fetch("/api/media-generation/normalize-reference", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storagePath,
        fileName: file.name,
        mimeType: uploaded.contentType || file.type,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        String(
          payload?.error ||
            "Cette image n’a pas pu être convertie automatiquement."
        )
      );
    }
    const image = payload?.image;
    const data = typeof image?.data === "string" ? image.data.trim() : "";
    if (
      image?.mimeType !== "image/jpeg" ||
      data.length < 64 ||
      data.length > AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    ) {
      throw new Error("L’image convertie est invalide.");
    }
    return {
      mimeType: "image/jpeg",
      data,
      name:
        typeof image?.name === "string" && image.name.trim()
          ? image.name.trim().slice(0, 120)
          : `${
              file.name.replace(/\.[^.]+$/, "").slice(0, 110) || "reference"
            }.jpg`,
    };
  } catch (error) {
    await discardTransientInspirationImage(storagePath);
    throw error;
  }
}

export async function prepareMediaGenerationImageReference(
  file: File
): Promise<MediaGenerationInspirationImage> {
  if (!isInrMediaImageFile(file)) {
    throw new Error(`Formats acceptés : ${INR_MEDIA_IMAGE_FORMATS_LABEL}.`);
  }
  if (!file.size || file.size > AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES) {
    throw new Error(
      `L’image d’inspiration doit peser moins de ${INR_MEDIA_IMAGE_MAX_MB_LABEL}.`
    );
  }

  try {
    return await prepareInspirationImageInBrowser(file);
  } catch {
    // HEIC/HEIF/TIFF et certains AVIF/BMP ne sont pas décodables par tous les
    // navigateurs. Le binaire va directement dans Storage, est converti par le
    // normaliseur commun à Booster, puis supprimé avant le retour au client.
    return await prepareInspirationImageOnServer(file);
  }
}

/**
 * Modifier accepte aussi une vidéo source. L’API de génération utilise un
 * cadre image comme référence ; on extrait donc proprement la première image
 * décodable de la vidéo et on la soumet au même normaliseur que les images.
 */
async function prepareVideoReferenceFrame(
  file: File
): Promise<MediaGenerationInspirationImage> {
  if (!isInrMediaVideoFile(file)) {
    throw new Error("Formats vidéo acceptés : MP4, M4V ou MOV.");
  }
  if (!file.size || file.size > INR_MEDIA_VIDEO_SOURCE_MAX_BYTES) {
    throw new Error(
      `La vidéo source doit peser moins de ${INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL}.`
    );
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("La vidéo source est illisible."));
    });
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("La vidéo source est illisible.");
    }
    const targetTime = Number.isFinite(video.duration)
      ? Math.min(Math.max(0, video.duration / 2), 1)
      : 0;
    if (targetTime > 0) {
      video.currentTime = targetTime;
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () =>
          reject(new Error("La vidéo source est illisible."));
      });
    }
    const scale = Math.min(
      1,
      AI_MEDIA_INSPIRATION_MAX_DIMENSION /
        Math.max(video.videoWidth, video.videoHeight)
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("La vidéo source n’a pas pu être préparée.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const output = await canvasBlob(canvas, 0.86);
    if (output.size > AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES) {
      throw new Error("La première image de la vidéo reste trop volumineuse.");
    }
    return {
      mimeType: "image/jpeg",
      data: await blobBase64(output),
      name: `${
        file.name.replace(/\.[^.]+$/, "").slice(0, 110) || "video"
      }-frame.jpg`,
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
  studioMode = "generate",
  mediaType,
  onAccepted,
  onResultChange,
  onBusyChange,
}: MediaGeneratorProps) {
  const t = useTranslations("media");
  const locale = useLocale();
  const transformMode = studioMode !== "generate";
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

  const [subjectSource, setSubjectSource] =
    useState<MediaGenerationSubjectSource>(
      publicationAvailable ? "publication" : "profile"
    );
  const [customIdea, setCustomIdea] = useState("");
  const [aiInstruction, setAiInstruction] = useState("");
  const [kind, setKind] = useState<MediaGenerationKind>("image");
  const [format, setFormat] = useState<MediaGenerationFormat>("square");
  const [imageStyle, setImageStyle] =
    useState<MediaGenerationImageStyle>("photo");
  const [identityConsent, setIdentityConsent] = useState(false);
  const [teamVideoSpeechMode, setTeamVideoSpeechMode] =
    useState<MediaGenerationTeamVideoSpeechMode>("voiceover");
  const [teamVideoVeoConsent, setTeamVideoVeoConsent] = useState(false);
  const [teamVideoConsentOpen, setTeamVideoConsentOpen] = useState(false);
  const [mediaSourceMode, setMediaSourceMode] =
    useState<StudioMediaSourceMode>("ai");
  const [aiPeopleCriterion, setAiPeopleCriterion] =
    useState<StudioAiPeopleCriterion>("auto");
  const [aiSettingCriterion, setAiSettingCriterion] =
    useState<StudioAiSettingCriterion>("auto");
  const [aiFocusCriterion, setAiFocusCriterion] =
    useState<StudioAiFocusCriterion>("auto");
  const [realCharacterCount, setRealCharacterCount] =
    useState<StudioCharacterCount>(0);
  const [useBrandColors, setUseBrandColors] = useState(true);
  const [logoMode, setLogoMode] = useState<MediaGenerationLogoMode>("discreet");
  const [imagePurpose, setImagePurpose] = useState<StudioImagePurpose>("auto");
  const [visualDirection, setVisualDirection] =
    useState<StudioVisualDirection>("auto");
  const [textMode, setTextMode] = useState<StudioTextMode>("none");
  const [exactText, setExactText] = useState("");
  const [videoSceneMode, setVideoSceneMode] =
    useState<StudioVideoSceneMode>("single");
  const [durationSeconds, setDurationSeconds] =
    useState<MediaGenerationVideoDuration>(8);
  const [withText, setWithText] = useState(false);
  const [textKeywords, setTextKeywords] = useState<string[]>([]);
  const [textKeywordDraft, setTextKeywordDraft] = useState("");
  const [withMusic, setWithMusic] = useState(true);
  const [narrationVoice, setNarrationVoice] =
    useState<MediaGenerationNarrationVoice>("female");
  const [narrationVoiceVariant, setNarrationVoiceVariant] =
    useState<MediaGenerationNarrationVoiceVariant>("Kore");
  const [inspirationImages, setInspirationImages] = useState<
    StudioReferenceImage[]
  >([]);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [inspirationBusy, setInspirationBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [creationScreen, setCreationScreen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [actionError, setActionError] = useState("");
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false);
  const appliedPreferencesEpochRef = useRef(-1);
  const clearedSensitiveStateEpochRef = useRef(0);
  const generationSequenceRef = useRef(0);
  const initializedStudioModeRef = useRef<MediaGeneratorStudioMode | null>(
    null
  );
  const identityReferenceSetIdRef = useRef("");
  if (!identityReferenceSetIdRef.current) {
    identityReferenceSetIdRef.current = createIdentityReferenceSetId();
  }
  const acceptInFlightRef = useRef(false);
  const busy = generationBusy || discarding;
  const operationLocked = busy || finishing || voiceBusy || inspirationBusy;

  useEffect(() => {
    if (!mediaType) return;
    setKind(mediaType);
  }, [mediaType]);

  useEffect(() => {
    if (studioMode === "generate") return;
    if (initializedStudioModeRef.current === studioMode) return;
    initializedStudioModeRef.current = studioMode;
    setKind("image");
    setFormat("square");
    setSubjectSource("custom");
    setCustomIdea(
      studioMode === "retouch"
        ? t("ai_generator_retouch_default_idea")
        : t("ai_generator_modify_default_idea")
    );
    setAiInstruction("");
    setMediaSourceMode("real");
    setAiPeopleCriterion("auto");
    setAiSettingCriterion("auto");
    setAiFocusCriterion("auto");
    setRealCharacterCount(0);
    setInspirationImages([]);
    setLibraryPickerOpen(false);
    setIdentityConsent(false);
    setActionError("");
  }, [studioMode, t]);

  useEffect(() => {
    if (clearedSensitiveStateEpochRef.current === preferencesAccountEpoch)
      return;
    clearedSensitiveStateEpochRef.current = preferencesAccountEpoch;
    setCustomIdea(
      transformMode
        ? studioMode === "retouch"
          ? t("ai_generator_retouch_default_idea")
          : t("ai_generator_modify_default_idea")
        : ""
    );
    setAiInstruction("");
    setTextKeywords([]);
    setTextKeywordDraft("");
    setTextMode("none");
    setExactText("");
    setImagePurpose("auto");
    setVisualDirection("auto");
    setVideoSceneMode("single");
    setInspirationImages([]);
    setMediaSourceMode(transformMode ? "real" : "ai");
    setAiPeopleCriterion("auto");
    setAiSettingCriterion("auto");
    setAiFocusCriterion("auto");
    setRealCharacterCount(0);
    setIdentityConsent(false);
    setTeamVideoVeoConsent(false);
    setTeamVideoConsentOpen(false);
    identityReferenceSetIdRef.current = createIdentityReferenceSetId();
  }, [preferencesAccountEpoch, studioMode, t, transformMode]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    if (appliedPreferencesEpochRef.current === preferencesAccountEpoch) return;

    const block1 = savedPreferences.blocks[1];
    const block6 = savedPreferences.blocks[6];
    if (block1.saved && !transformMode) {
      if (!mediaType) setKind(block1.defaults.kind);
      setSubjectSource(
        block1.defaults.subjectSource === "publication" && !publicationAvailable
          ? "profile"
          : block1.defaults.subjectSource
      );
    }

    const block2 = savedPreferences.blocks[2];
    if (block2.saved) {
      setFormat(block2.defaults.format);
    }

    const block3 = savedPreferences.blocks[3];
    if (block3.saved) {
      setImagePurpose(block3.defaults.imagePurpose);
      setVisualDirection(block3.defaults.visualDirection);
      setVideoSceneMode(block3.defaults.sceneMode);
      setUseBrandColors(block3.defaults.useBrandColors);
      setLogoMode(block3.defaults.logoMode);
    }

    const block4 = savedPreferences.blocks[4];
    if (block4.saved) {
      setImageStyle(block4.defaults.imageStyle);
    }

    const block5 = savedPreferences.blocks[5];
    if (block5.saved && !transformMode) {
      setTeamVideoSpeechMode(block5.defaults.teamVideoSpeechMode);
      setAiPeopleCriterion(block5.defaults.aiPeopleCriterion || "auto");
      setAiSettingCriterion(block5.defaults.aiSettingCriterion || "auto");
      setAiFocusCriterion(block5.defaults.aiFocusCriterion || "auto");
      if (
        block5.defaults.sourceMode === "real" ||
        block5.defaults.identityMode === "reference_team"
      ) {
        setMediaSourceMode("real");
        setRealCharacterCount(
          block5.defaults.peopleMode === "none" ||
            block5.defaults.peopleMode === "auto"
            ? 0
            : block5.defaults.peopleMode === "team"
            ? 2
            : 1
        );
      } else if (block5.defaults.identityMode === "professional") {
        setMediaSourceMode("real");
        setRealCharacterCount(1);
      } else if (
        block5.defaults.sourceMode === "criteria" ||
        block5.defaults.peopleMode !== "auto"
      ) {
        setMediaSourceMode("criteria");
        setAiPeopleCriterion(
          block5.defaults.aiPeopleCriterion ||
            (block5.defaults.peopleMode === "none"
              ? "none"
              : block5.defaults.peopleMode === "solo"
              ? "one"
              : "group")
        );
      } else {
        setMediaSourceMode("ai");
      }
    }

    if (block6.saved) {
      setDurationSeconds(block6.defaults.durationSeconds);
      if (!block3.saved) {
        setVideoSceneMode(
          block6.defaults.connectScenes ? "single" : "multi"
        );
      }
      setWithText(block6.defaults.withText);
      setTextMode(block6.defaults.withText ? "ai" : "none");
      setWithMusic(block6.defaults.withMusic);
      setNarrationVoice(block6.defaults.narrationVoice);
      setNarrationVoiceVariant(block6.defaults.narrationVoiceVariant);
    }

    appliedPreferencesEpochRef.current = preferencesAccountEpoch;
  }, [
    mediaType,
    preferencesAccountEpoch,
    preferencesLoaded,
    publicationAvailable,
    savedPreferences,
    transformMode,
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
  const creativeBrief = subjectSource === "custom" ? customIdea : aiInstruction;
  const creativeBriefMaximum = 1_600;
  const effectiveWithText = textMode !== "none";
  const structuredVisualStyle: MediaGenerationVisualStyle =
    visualDirection === "bold"
      ? "colorful"
      : visualDirection === "auto"
      ? "brand"
      : visualDirection;
  const structuredTypology: MediaGenerationTypology =
    kind === "image" &&
    ["flyer", "product_sheet"].includes(imagePurpose)
      ? "offer"
      : kind === "image" && ["poster", "banner"].includes(imagePurpose)
      ? "showcase"
      : kind === "image" && imagePurpose === "infographic"
      ? "advice"
      : "service";
  const generationAiInstruction = useMemo(() => {
    if (transformMode) return aiInstruction.trim();

    const directives: string[] = [];
    if (kind === "video" && durationSeconds > 8) {
      directives.push(
        videoSceneMode === "single"
          ? "Raconter l'action dans une scène continue, avec les mêmes personnes, le même lieu et une continuité visuelle entre les plans."
          : "Construire un récit multiscène clair : chaque scène apporte une étape différente sans perdre le sujet central."
      );
    }
    const directiveText = directives.join(" ").trim();
    const baseInstruction = creativeBrief.trim();
    return [baseInstruction, directiveText].filter(Boolean).join("\n\n");
  }, [
    creativeBrief,
    durationSeconds,
    kind,
    mediaSourceMode,
    transformMode,
    videoSceneMode,
  ]);
  const subjectReady =
    subjectSource === "profile" ||
    (subjectSource === "publication" && publicationAvailable) ||
    (subjectSource === "custom" && resolvedIdea.length >= 3);
  const resolvedTextKeywords = effectiveWithText
    ? normalizeTextKeywordValues([...textKeywords, textKeywordDraft])
    : [];
  const counter = quota?.[kind] || null;
  const exhausted = quota?.unlimited ? false : counter?.remaining === 0;
  const videoMaxDurationSeconds = quota?.videoMaxDurationSeconds ?? 24;
  const videoRemainingSeconds =
    kind === "video" && !quota?.unlimited
      ? quota?.video.remaining ?? null
      : null;
  const resultPreviewFormat = generationResult
    ? resolveAiMediaPreviewFormat({
        width: generationResult.item.width,
        height: generationResult.item.height,
        fallback: generationResult.format,
      })
    : format;

  useEffect(() => {
    if (!quota) return;
    const affordableDurations = ([8, 16, 24] as const).filter(
      (duration) =>
        duration <= videoMaxDurationSeconds &&
        (quota.unlimited ||
          quota.video.remaining === null ||
          duration <= quota.video.remaining)
    );
    setDurationSeconds((current) =>
      affordableDurations.includes(current)
        ? current
        : affordableDurations.at(-1) ??
          (current > videoMaxDurationSeconds
            ? videoMaxDurationSeconds
            : current)
    );
  }, [quota, videoMaxDurationSeconds]);

  const videoDurationUnavailable =
    kind === "video" && durationSeconds > videoMaxDurationSeconds;
  const videoCreditInsufficient =
    kind === "video" &&
    videoRemainingSeconds !== null &&
    durationSeconds > videoRemainingSeconds;
  const characterReferences = inspirationImages.filter(
    (image) => image.role === "character" && image.usage !== "inspiration"
  );
  const environmentReference = inspirationImages.find(
    (image) => image.role === "environment"
  );
  const productReference = inspirationImages.find(
    (image) => image.role === "product"
  );
  const inspirationReference = inspirationImages.find(
    (image) => image.role === "inspiration"
  );
  const effectiveCharacterCount = transformMode
    ? realCharacterCount
    : (Math.min(characterReferences.length, 3) as StudioCharacterCount);
  const effectivePeopleMode: MediaGenerationPeopleMode =
    mediaSourceMode === "ai"
      ? "auto"
      : mediaSourceMode === "criteria"
      ? aiPeopleCriterion === "none"
        ? "none"
        : aiPeopleCriterion === "one"
        ? "solo"
        : aiPeopleCriterion === "auto"
        ? "auto"
        : "team"
      : effectiveCharacterCount === 0
      ? "auto"
      : effectiveCharacterCount === 1
      ? "solo"
      : "team";
  const effectiveIdentityMode: MediaGenerationVideoCharacterMode =
    mediaSourceMode !== "real" || effectiveCharacterCount === 0
      ? "auto"
      : effectiveCharacterCount === 1
      ? "professional"
      : "reference_team";
  const strictIdentityReferenceMode = effectiveIdentityMode !== "auto";
  const referenceAnimationAvailable =
    kind === "video" && inspirationImages.length > 0;
  const referenceCinematicRequested = referenceAnimationAvailable;
  const animatedCharactersSpeak =
    kind === "video" && teamVideoSpeechMode === "characters";
  const teamCinematicConsentRequired =
    kind === "video" && effectiveIdentityMode === "reference_team";
  const effectiveWithNarration = kind === "video" && !animatedCharactersSpeak;
  const characterReferenceMissing =
    transformMode &&
    mediaSourceMode === "real" &&
    characterReferences.length !== effectiveCharacterCount;
  const identityConsentRequired =
    strictIdentityReferenceMode && characterReferences.length > 0;
  const identityConsentMissing = identityConsentRequired && !identityConsent;
  const transformReferenceMissing = transformMode && !inspirationReference;
  const visibleTextModeConflict =
    textMode === "none" &&
    aiMediaBriefRequestsVisibleText({
      kind,
      imagePurpose,
      idea: resolvedIdea,
      aiInstruction: creativeBrief,
    });
  const disabled =
    operationLocked ||
    !subjectReady ||
    (textMode === "exact" && exactText.trim().length < 2) ||
    visibleTextModeConflict ||
    Boolean(exhausted) ||
    videoDurationUnavailable ||
    videoCreditInsufficient ||
    characterReferenceMissing ||
    identityConsentMissing ||
    transformReferenceMissing;

  const resetDate = useMemo(() => {
    if (!quota?.resetAt) return "";
    const parsed = new Date(quota.resetAt);
    if (Number.isNaN(parsed.getTime())) return "";
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
    }).format(parsed);
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
            ? effectiveIdentityMode === "reference_team"
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

  const quotaValue =
    quotaLoading && !counter
      ? t("chargement_01cba1df")
      : quota?.unlimited
      ? t("ai_generator_unlimited")
      : counter?.limit === null || !counter
      ? "—"
      : counter.limit === 0
      ? kind === "video"
        ? "0 s / 0 s"
        : "0 / 0"
      : kind === "video"
      ? `${counter.used + counter.reserved} s / ${counter.limit} s`
      : `${counter.used + counter.reserved} / ${counter.limit}`;

  const clearTransientState = () => {
    reset();
    setActionError("");
  };

  const resetReferenceConsent = () => {
    identityReferenceSetIdRef.current = createIdentityReferenceSetId();
    setIdentityConsent(false);
    setTeamVideoVeoConsent(false);
    setTeamVideoConsentOpen(false);
    if (actionError || error) clearTransientState();
  };

  const orderReferences = (images: StudioReferenceImage[]) =>
    [...images].sort((left, right) => {
      const rank = (image: StudioReferenceImage) =>
        image.role === "character"
          ? image.characterIndex || 1
          : image.role === "environment"
          ? 4
          : image.role === "inspiration"
          ? 4.5
          : 5;
      return rank(left) - rank(right);
    });

  const selectMediaSourceMode = (mode: StudioMediaSourceMode) => {
    setMediaSourceMode(mode);
    if (mode === "ai" && transformMode) {
      setInspirationImages([]);
    } else if (characterReferences.length === 0) {
      // Un décor ou un produit peut être l'unique référence de la scène.
      // Le Studio ne doit pas créer implicitement un personnage obligatoire.
      setRealCharacterCount(0);
    }
    resetReferenceConsent();
  };

  const selectRealCharacterCount = (count: StudioCharacterCount) => {
    setRealCharacterCount(count);
    setInspirationImages((current) =>
      current.filter(
        (image) =>
          image.role !== "character" || (image.characterIndex || 0) <= count
      )
    );
    resetReferenceConsent();
  };

  const removeReferenceImage = (
    role: MediaGenerationReferenceRole,
    characterIndex?: 1 | 2 | 3
  ) => {
    setInspirationImages((current) =>
      current.filter(
        (image) =>
          !(
            image.role === role &&
            (role !== "character" || image.characterIndex === characterIndex)
          )
      )
    );
    if (
      role === "character" &&
      characterReferences.length <= 1 &&
      Boolean(environmentReference || productReference)
    ) {
      setRealCharacterCount(0);
    }
    resetReferenceConsent();
  };

  const prepareReferenceFile = async (
    file: File,
    role: MediaGenerationReferenceRole,
    characterIndex?: 1 | 2 | 3,
    insertion: "replace" | "append" = "replace"
  ) => {
    setInspirationBusy(true);
    setActionError("");
    try {
      const prepared =
        transformMode &&
        studioMode === "modify" &&
        role === "inspiration" &&
        isInrMediaVideoFile(file)
          ? await prepareVideoReferenceFrame(file)
          : await prepareMediaGenerationImageReference(file);
      const proposedRole =
        insertion === "append" ? inferRequiredReferenceRole(file.name) : role;
      const next: StudioReferenceImage = {
        ...prepared,
        role: proposedRole,
        ...(proposedRole === "character" ? { characterIndex } : {}),
        usage:
          insertion === "append" || role === "inspiration"
            ? "inspiration"
            : "required",
      };
      setInspirationImages((current) => {
        const retained =
          insertion === "append"
            ? current
            : current.filter(
                (image) =>
                  !(
                    image.role === role &&
                    (role !== "character" ||
                      image.characterIndex === characterIndex)
                  )
              );
        return normalizeCharacterReferenceIndexes(
          orderReferences([...retained, next]).slice(0, MAX_INSPIRATION_IMAGES)
        );
      });
      if (role !== "character" && characterReferences.length === 0) {
        // Une référence de décor/produit suffit : elle bascule explicitement
        // la scène en mode « aucun personnage » et débloque la génération.
        setRealCharacterCount(0);
      }
      resetReferenceConsent();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : t("ai_generator_error")
      );
    } finally {
      setInspirationBusy(false);
    }
  };

  const prepareLibraryInspiration = async (
    item: MediaLibraryPickerItem,
    insertion: "replace" | "append" = "replace"
  ) => {
    if (!item.signed_url) {
      throw new Error(t("ai_generator_inspiration_library_unavailable"));
    }
    const response = await fetch(item.signed_url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(t("ai_generator_inspiration_library_unavailable"));
    }
    const blob = await response.blob();
    const candidateMimeType = blob.type || item.mime_type || "";
    const videoReference = isInrMediaVideoFile({
      name: item.original_file_name || item.title || "inspiration",
      type: candidateMimeType,
    });
    const mimeType = videoReference
      ? candidateMimeType
      : (["image/jpeg", "image/png", "image/webp"] as string[]).includes(
          candidateMimeType
        )
      ? candidateMimeType
      : "image/jpeg";
    const file = new File(
      [blob],
      item.original_file_name || item.title || "inspiration.jpg",
      { type: mimeType }
    );
    await prepareReferenceFile(file, "inspiration", undefined, insertion);
  };

  const handleLibraryInspirationConfirm = async (
    items: MediaLibraryPickerItem[]
  ) => {
    const selected = items.slice(
      0,
      transformMode
        ? 1
        : Math.max(0, MAX_INSPIRATION_IMAGES - inspirationImages.length)
    );
    for (const item of selected) {
      await prepareLibraryInspiration(
        item,
        transformMode ? "replace" : "append"
      );
    }
  };

  const handleReferenceFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files).slice(
      0,
      Math.max(0, MAX_INSPIRATION_IMAGES - inspirationImages.length)
    );
    for (const file of selected) {
      await prepareReferenceFile(file, "inspiration", undefined, "append");
    }
  };

  const removeReferenceAt = (index: number) => {
    setInspirationImages((current) =>
      normalizeCharacterReferenceIndexes(
        current.filter((_, currentIndex) => currentIndex !== index)
      )
    );
    resetReferenceConsent();
  };

  const setReferenceUsage = (
    index: number,
    usage: "required" | "inspiration"
  ) => {
    setInspirationImages((current) => {
      const currentReference = current[index];
      if (!currentReference) return current;
      const next = current.map((reference, currentIndex) => {
        if (currentIndex !== index) return reference;
        if (usage === "inspiration") {
          return { ...reference, usage: "inspiration" as const };
        }
        return {
          ...reference,
          usage: "required" as const,
          role:
            reference.role === "inspiration" || !reference.role
              ? inferRequiredReferenceRole(reference.name)
              : reference.role,
        };
      });
      return normalizeCharacterReferenceIndexes(next);
    });
    resetReferenceConsent();
  };

  const setReferenceRole = (
    index: number,
    role: StudioRequiredReferenceRole
  ) => {
    setInspirationImages((current) => {
      const next = current.map((reference, currentIndex) => {
        if (currentIndex === index) return { ...reference, role };
        if (
          role !== "character" &&
          reference.role === role &&
          currentIndex !== index
        ) {
          const { characterIndex: _characterIndex, ...withoutCharacterIndex } =
            reference;
          return {
            ...withoutCharacterIndex,
            role: "inspiration" as const,
            usage: "inspiration" as const,
          };
        }
        return reference;
      });
      return normalizeCharacterReferenceIndexes(next);
    });
    resetReferenceConsent();
  };

  const addTextKeywords = (rawValue: string) => {
    setTextKeywords((current) =>
      normalizeTextKeywordValues([...current, rawValue])
    );
    setTextKeywordDraft("");
    if (actionError || error) clearTransientState();
  };

  const removeTextKeyword = (keyword: string) => {
    setTextKeywords((current) => current.filter((value) => value !== keyword));
    if (actionError || error) clearTransientState();
  };

  const handleRememberPreferenceGroup = (
    groupId: 1 | 2 | 3 | 4,
    checked: boolean
  ) => {
    if (groupId === 1) {
      const block1: AiMediaGeneratorBlockDefaults[1] = {
        kind,
        // Les consignes et le sujet libre restent volontairement ponctuels.
        subjectSource:
          subjectSource === "publication" ? "publication" : "profile",
      };
      const block2: AiMediaGeneratorBlockDefaults[2] = {
        typology: savedPreferences.blocks[2].defaults.typology,
        format,
      };
      const block3: AiMediaGeneratorBlockDefaults[3] = {
        visualStyle: savedPreferences.blocks[3].defaults.visualStyle,
        creativity: savedPreferences.blocks[3].defaults.creativity,
        imagePurpose,
        visualDirection,
        sceneMode: videoSceneMode,
        useBrandColors,
        logoMode,
      };
      const block4: AiMediaGeneratorBlockDefaults[4] = {
        imageStyle,
        shotType: savedPreferences.blocks[4].defaults.shotType,
      };
      void Promise.all([
        savePreferenceBlock(1, checked, block1),
        savePreferenceBlock(2, checked, block2),
        savePreferenceBlock(3, checked, block3),
        savePreferenceBlock(4, checked, block4),
      ]);
      return;
    }

    if (groupId === 2) {
      const block5: AiMediaGeneratorBlockDefaults[5] = {
        peopleMode: effectivePeopleMode,
        sourceMode: mediaSourceMode,
        aiPeopleCriterion,
        aiSettingCriterion,
        aiFocusCriterion,
        identityMode: effectiveIdentityMode,
        teamVideoMode: "cinematic",
        teamVideoSpeechMode,
      };
      void savePreferenceBlock(5, checked, block5);
      return;
    }

    if (groupId === 3) {
      const block3: AiMediaGeneratorBlockDefaults[3] = {
        visualStyle: savedPreferences.blocks[3].defaults.visualStyle,
        creativity: savedPreferences.blocks[3].defaults.creativity,
        imagePurpose,
        visualDirection,
        sceneMode: videoSceneMode,
        useBrandColors,
        logoMode,
      };
      void savePreferenceBlock(3, checked, block3);
      return;
    }

    const block6: AiMediaGeneratorBlockDefaults[6] = {
      durationSeconds,
      connectScenes: videoSceneMode === "single",
      withText: effectiveWithText,
      withMusic,
      withNarration: teamVideoSpeechMode === "voiceover",
      narrationVoice,
      narrationVoiceVariant,
    };
    void savePreferenceBlock(6, checked, block6);
  };

  const performGeneration = async (veoConsentForAttempt: boolean) => {
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
        if (sequence !== generationSequenceRef.current) {
          setTeamVideoVeoConsent(false);
          setTeamVideoConsentOpen(false);
          return;
        }
        setActionError(
          caught instanceof Error ? caught.message : t("ai_generator_error")
        );
        setTeamVideoVeoConsent(false);
        setTeamVideoConsentOpen(false);
        return;
      } finally {
        setDiscarding(false);
      }
    }

    try {
      await generate({
        inputMode: "essential",
        source,
        kind,
        subjectSource,
        idea: resolvedIdea,
        aiInstruction: generationAiInstruction,
        generationMode:
          mediaSourceMode === "ai"
            ? "ai_free"
            : mediaSourceMode === "criteria"
            ? "ai_criteria"
            : "inspiration",
        peopleCriterion:
          mediaSourceMode === "criteria" ? aiPeopleCriterion : "auto",
        settingCriterion:
          mediaSourceMode === "criteria" ? aiSettingCriterion : "auto",
        focusCriterion:
          mediaSourceMode === "criteria" ? aiFocusCriterion : "auto",
        textMode: textMode,
        exactText: exactText,
        withText: effectiveWithText,
        textKeywords: resolvedTextKeywords,
        withMusic: kind === "video" ? withMusic : undefined,
        withNarration: kind === "video" ? effectiveWithNarration : undefined,
        narrationVoice:
          kind === "video" && effectiveWithNarration
            ? narrationVoice
            : undefined,
        narrationVoiceVariant:
          kind === "video" && effectiveWithNarration
            ? narrationVoiceVariant
            : undefined,
        format,
        typology: structuredTypology,
        visualStyle: structuredVisualStyle,
        visualDirection,
        imagePurpose: kind === "image" ? imagePurpose : "auto",
        imageStyle,
        peopleMode: effectivePeopleMode,
        identityMode: effectiveIdentityMode,
        videoCharacterMode: effectiveIdentityMode,
        identityConsent: identityConsentRequired ? identityConsent : false,
        identityReferenceSetId: inspirationImages.length
          ? identityReferenceSetIdRef.current
          : undefined,
        useBrandColors,
        logoMode,
        teamVideoMode: kind === "video" ? "cinematic" : undefined,
        teamVideoSpeechMode: kind === "video" ? teamVideoSpeechMode : undefined,
        teamVideoVeoConsent: teamCinematicConsentRequired
          ? veoConsentForAttempt
          : false,
        durationSeconds: kind === "video" ? durationSeconds : undefined,
        sceneMode: kind === "video" ? videoSceneMode : undefined,
        connectScenes:
          kind === "video" && durationSeconds > 8
            ? videoSceneMode === "single"
            : false,
        inspirationImages: mediaSourceMode === "real" ? inspirationImages : [],
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
      setActionError(
        caught instanceof Error ? caught.message : t("ai_generator_error")
      );
    } finally {
      // L'accord porte sur un essai de génération précis. Une nouvelle
      // tentative, réussie ou non, exige donc une confirmation fraîche.
      if (identityConsentRequired) setIdentityConsent(false);
      setTeamVideoVeoConsent(false);
      setTeamVideoConsentOpen(false);
    }
  };

  const handleGenerate = async () => {
    if (!subjectReady) return;
    if (teamCinematicConsentRequired) {
      setTeamVideoVeoConsent(false);
      setTeamVideoConsentOpen(true);
      return;
    }
    await performGeneration(false);
  };

  const handleConfirmTeamVideoConsent = async () => {
    if (!teamVideoVeoConsent) return;
    setTeamVideoConsentOpen(false);
    await performGeneration(true);
  };

  const handleCancelTeamVideoConsent = () => {
    setTeamVideoVeoConsent(false);
    setTeamVideoConsentOpen(false);
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
        setActionError(
          caught instanceof Error ? caught.message : t("ai_generator_error")
        );
        return;
      } finally {
        setDiscarding(false);
      }
    }
    clearTransientState();
    setCreationScreen(false);
  };

  const handleConfirm = async () => {
    if (!generationResult || operationLocked || acceptInFlightRef.current)
      return;
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
      setActionError(
        caught instanceof Error ? caught.message : t("ai_generator_error")
      );
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
          : "ai_generator_subject_publication_unavailable"
      ),
      disabled: !publicationAvailable,
    },
    {
      id: "custom",
      title: t("ai_generator_subject_custom"),
      description: t("ai_generator_subject_custom_hint"),
    },
    {
      id: "profile",
      title: t("ai_generator_subject_profile"),
      description: t("ai_generator_subject_profile_hint"),
    },
  ];

  const renderReferenceSlot = (args: {
    role: MediaGenerationReferenceRole;
    characterIndex?: 1 | 2 | 3;
    title: string;
    hint: string;
    optional?: boolean;
  }) => {
    const reference = inspirationImages.find(
      (image) =>
        image.role === args.role &&
        (args.role !== "character" ||
          image.characterIndex === args.characterIndex)
    );
    const inputId = `ai-media-reference-${args.role}-${
      args.characterIndex || 0
    }`;
    return (
      <div
        key={inputId}
        className={styles.referenceSlot}
        data-ready={reference ? "true" : "false"}
      >
        {reference ? (
          <img
            src={`data:${reference.mimeType};base64,${reference.data}`}
            alt=""
          />
        ) : (
          <span className={styles.referenceSlotIcon} aria-hidden="true">
            {args.role === "character"
              ? "◉"
              : args.role === "environment"
              ? "▧"
              : args.role === "inspiration"
              ? "✦"
              : "◇"}
          </span>
        )}
        <span className={styles.referenceSlotCopy}>
          <strong>{args.title}</strong>
          <small>
            {reference
              ? t("ai_generator_essential_reference_ready")
              : args.optional
              ? `${args.hint} · ${t("ai_generator_essential_optional")}`
              : args.hint}
          </small>
        </span>
        <span className={styles.referenceSlotActions}>
          <label htmlFor={inputId}>
            {reference
              ? t("ai_generator_essential_replace")
              : t("ai_generator_essential_add")}
          </label>
          <input
            id={inputId}
            type="file"
            accept={INSPIRATION_IMAGE_ACCEPT}
            disabled={operationLocked}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                void prepareReferenceFile(file, args.role, args.characterIndex);
              }
            }}
          />
          {args.role === "inspiration" ? (
            <button
              type="button"
              disabled={operationLocked}
              onClick={() => setLibraryPickerOpen(true)}
            >
              {t("ai_generator_inspiration_from_library")}
            </button>
          ) : null}
          {reference ? (
            <button
              type="button"
              aria-label={t("ai_generator_inspiration_remove")}
              disabled={operationLocked}
              onClick={() =>
                removeReferenceImage(args.role, args.characterIndex)
              }
            >
              ×
            </button>
          ) : null}
        </span>
      </div>
    );
  };

  const teamVideoConsentDialog = teamVideoConsentOpen ? (
    <div className={styles.teamVideoConsentBackdrop}>
      <div
        className={styles.teamVideoConsentDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-media-team-video-consent-title"
        aria-describedby="ai-media-team-video-consent-description"
      >
        <span className={styles.teamVideoConsentIcon} aria-hidden="true">
          ▶
        </span>
        <div className={styles.teamVideoConsentHeading}>
          <small>{t("ai_generator_team_video_consent_eyebrow")}</small>
          <h3 id="ai-media-team-video-consent-title">
            {t("ai_generator_team_video_consent_title")}
          </h3>
          <p id="ai-media-team-video-consent-description">
            {t(
              animatedCharactersSpeak
                ? "ai_generator_team_video_consent_description_characters"
                : "ai_generator_team_video_consent_description"
            )}
          </p>
        </div>
        <label className={styles.teamVideoConsentCheck}>
          <input
            type="checkbox"
            autoFocus
            checked={teamVideoVeoConsent}
            onChange={(event) => setTeamVideoVeoConsent(event.target.checked)}
          />
          <span>
            {t(
              animatedCharactersSpeak
                ? "ai_generator_team_video_consent_checkbox_characters"
                : "ai_generator_team_video_consent_checkbox"
            )}
          </span>
        </label>
        {!teamVideoVeoConsent ? (
          <p className={styles.teamVideoConsentRequired} role="status">
            {t("ai_generator_team_video_consent_required")}
          </p>
        ) : null}
        <div className={styles.teamVideoConsentActions}>
          <button
            type="button"
            className={styles.teamVideoConsentCancel}
            onClick={handleCancelTeamVideoConsent}
          >
            {t("ai_generator_team_video_consent_cancel")}
          </button>
          <button
            type="button"
            className={styles.teamVideoConsentConfirm}
            disabled={!teamVideoVeoConsent}
            onClick={() => void handleConfirmTeamVideoConsent()}
          >
            {t("ai_generator_team_video_consent_confirm")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (creationScreen) {
    return (
      <div
        className={styles.creationWorkspace}
        data-origin={origin}
        data-media-kind={kind}
      >
        <div className={styles.creationBackdrop} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        {teamVideoConsentDialog}

        {operationLocked && !generationResult ? (
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
            <h3>{progressLabel}</h3>
            <p>
              {t(
                kind === "video"
                  ? effectiveIdentityMode === "reference_team"
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
                <h3>
                  {t(
                    kind === "video"
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
                {kind === "video" && generationResult.videoEngineResult ? (
                  <span
                    className={styles.engineResultBadge}
                    data-fallback={generationResult.videoEngineResult.includes(
                      "fallback"
                    )}
                  >
                    {t(
                      `ai_generator_video_engine_result_${generationResult.videoEngineResult}`
                    )}
                  </span>
                ) : null}
              </div>
            </div>
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
                  <img
                    src={generationResult.item.signed_url}
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
            <div className={styles.savedStatus} role="status">
              <span aria-hidden="true">✓</span>
              {t("ai_generator_saved_automatically")}
            </div>
            <div className={styles.resultActions}>
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
              <button
                type="button"
                className={styles.regenerateButton}
                onClick={() => void handleGenerate()}
                disabled={disabled}
              >
                ↻ {t("ai_generator_regenerate")}
              </button>
              <button
                type="button"
                className={styles.editButton}
                onClick={() => void handleEditCriteria()}
                disabled={operationLocked}
              >
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
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={disabled}
              >
                {t("ai_generator_retry")}
              </button>
              <button type="button" onClick={() => void handleEditCriteria()}>
                {t("ai_generator_edit_criteria")}
              </button>
            </div>
          </div>
        ) : null}

        {actionError && generationResult ? (
          <div className={styles.error} role="alert">
            {actionError}
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

  return (
    <div className={styles.generator} data-origin={origin}>
      {teamVideoConsentDialog}
      <div
        className={styles.essentialGrid}
        data-testid="inr-studio-essential-grid"
      >
        <section
          className={`${styles.essentialCard} ${styles.creationCard}`}
          data-media-kind={kind}
          data-subject-source={subjectSource}
          data-generator-block="subject"
        >
          <header className={styles.essentialCardHeader}>
            <span>1</span>
            <div>
              <h3>{t("ai_generator_redesign_subject_title")}</h3>
              <p>
                Parlez à l’IA comme à un créatif : expliquez librement le
                résultat que vous souhaitez.
              </p>
            </div>
          </header>

          <div className={styles.subjectSourceChoices} role="radiogroup">
            {subjectChoices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={subjectSource === choice.id}
                data-active={subjectSource === choice.id ? "true" : "false"}
                disabled={operationLocked || choice.disabled}
                title={choice.description}
                onClick={() => {
                  setSubjectSource(choice.id);
                  if (actionError || error) clearTransientState();
                }}
              >
                <span aria-hidden="true">
                  {choice.id === "publication"
                    ? "▤"
                    : choice.id === "custom"
                    ? "✦"
                    : "◆"}
                </span>
                <span>
                  <strong>{choice.title}</strong>
                  <small>{choice.description}</small>
                </span>
              </button>
            ))}
          </div>

          <label
            className={`${styles.essentialTextareaField} ${styles.creativeBriefField}`}
          >
            <span>
              Votre consigne à l’IA
              <small>
                {subjectSource === "custom"
                  ? "Obligatoire"
                  : "Facultative, mais fortement recommandée"}
              </small>
            </span>
            <div className={styles.customTextareaWrap}>
              <textarea
                value={creativeBrief}
                aria-invalid={
                  subjectSource === "custom" && creativeBrief.trim().length < 3
                }
                aria-describedby={
                  subjectSource === "custom" && creativeBrief.trim().length < 3
                    ? "ai-media-creative-brief-alert"
                    : undefined
                }
                onChange={(event) => {
                  if (subjectSource === "custom") {
                    setCustomIdea(event.target.value);
                  } else {
                    setAiInstruction(event.target.value);
                  }
                  if (actionError || error) clearTransientState();
                }}
                placeholder={
                  kind === "image"
                    ? "Ex. Crée un flyer premium pour notre journée portes ouvertes, avec notre produit au centre, une lumière chaleureuse et une zone claire pour la date…"
                    : "Ex. Filme notre équipe préparant la commande, commence par un plan large puis rapproche-toi du produit, avec une ambiance énergique…"
                }
                maxLength={creativeBriefMaximum}
                disabled={busy || finishing}
                readOnly={voiceBusy}
                rows={6}
              />
              <MediaSubjectVoiceButton
                purpose="instruction"
                disabled={busy || finishing}
                value={creativeBrief}
                maxLength={creativeBriefMaximum}
                onBusyChange={setVoiceBusy}
                onChange={(nextValue) => {
                  if (subjectSource === "custom") {
                    setCustomIdea(nextValue);
                  } else {
                    setAiInstruction(nextValue);
                  }
                  if (actionError || error) clearTransientState();
                }}
              />
            </div>
            {subjectSource === "custom" && creativeBrief.trim().length < 3 ? (
              <small
                id="ai-media-creative-brief-alert"
                className={styles.fieldAlert}
                role="alert"
              >
                Décrivez ce que vous souhaitez créer en quelques mots.
              </small>
            ) : (
              <small>
                Décrivez le sujet, l’action, l’ambiance, le résultat attendu et
                tout élément à respecter. Les réglages suivants préciseront ce
                brief sans le remplacer.
              </small>
            )}
          </label>
        </section>

        <section
          className={`${styles.essentialCard} ${styles.mediaCard}`}
          data-source-mode={mediaSourceMode}
          data-character-count={effectiveCharacterCount}
          data-generator-block="selection"
        >
          <header className={styles.essentialCardHeader}>
            <span>2</span>
            <div>
              <h3>{t("ai_generator_redesign_selection_title")}</h3>
              <p>{t("ai_generator_redesign_selection_hint")}</p>
            </div>
            <RememberPreferenceControl
              checked={savedPreferences.blocks[5].saved}
              disabled={
                operationLocked || preferencesLoading || savingBlockIds.has(5)
              }
              saving={savingBlockIds.has(5)}
              label={t("ai_generator_remember_settings")}
              savingLabel={t("ai_generator_preferences_saving")}
              blockTitle={t("ai_generator_redesign_selection_title")}
              onChange={(checked) => handleRememberPreferenceGroup(2, checked)}
            />
          </header>

          {!transformMode ? (
            <div
              className={`${styles.essentialSegmented} ${styles.mediaModeField}`}
              role="radiogroup"
            >
              {(["ai", "criteria", "real"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={mediaSourceMode === mode}
                  data-active={mediaSourceMode === mode ? "true" : "false"}
                  disabled={operationLocked}
                  onClick={() => selectMediaSourceMode(mode)}
                >
                  <span aria-hidden="true">
                    {mode === "ai" ? "✦" : mode === "criteria" ? "◎" : "◉"}
                  </span>
                  {t(
                    mode === "ai"
                      ? "ai_generator_redesign_selection_ai"
                      : mode === "criteria"
                      ? "ai_generator_redesign_selection_criteria"
                      : "ai_generator_redesign_selection_inspiration"
                  )}
                </button>
              ))}
            </div>
          ) : null}

          {mediaSourceMode === "ai" ? (
            <div className={styles.aiMediaNotice} role="note">
              <span aria-hidden="true">✦</span>
              <div>
                <strong>{t("ai_generator_essential_ai_notice_title")}</strong>
                <small>{t("ai_generator_essential_ai_notice_hint")}</small>
              </div>
              </div>
          ) : mediaSourceMode === "criteria" ? (
            <div
              className={styles.aiCriteriaPanel}
              role="group"
              aria-label={t("ai_generator_redesign_criteria_panel_label")}
              data-testid="ai-media-criteria-panel"
            >
              <div className={styles.aiCriteriaIntro}>
                <span aria-hidden="true">◎</span>
                <div>
                  <strong>
                    {t("ai_generator_redesign_criteria_intro_title")}
                  </strong>
                  <small>{t("ai_generator_redesign_criteria_intro_hint")}</small>
                </div>
              </div>
              <div className={styles.aiCriteriaGrid}>
                <label className={styles.essentialSelectField}>
                  <span>{t("ai_generator_redesign_criteria_people_label")}</span>
                  <select
                    className={styles.studioSelect}
                    value={aiPeopleCriterion}
                    disabled={operationLocked}
                    onChange={(event) => {
                      const next = event.target
                        .value as StudioAiPeopleCriterion;
                      setAiPeopleCriterion(next);
                      if (next === "none" && aiFocusCriterion === "people") {
                        setAiFocusCriterion("auto");
                      }
                    }}
                  >
                    {AI_PEOPLE_CRITERIA.map((option) => (
                      <option key={option} value={option}>
                        {t(`ai_generator_redesign_criteria_people_${option}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.essentialSelectField}>
                  <span>{t("ai_generator_redesign_criteria_setting_label")}</span>
                  <select
                    className={styles.studioSelect}
                    value={aiSettingCriterion}
                    disabled={operationLocked}
                    onChange={(event) =>
                      setAiSettingCriterion(
                        event.target.value as StudioAiSettingCriterion
                      )
                    }
                  >
                    {AI_SETTING_CRITERIA.map((option) => (
                      <option key={option} value={option}>
                        {t(`ai_generator_redesign_criteria_setting_${option}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.essentialSelectField}>
                  <span>{t("ai_generator_redesign_criteria_focus_label")}</span>
                  <select
                    className={styles.studioSelect}
                    value={aiFocusCriterion}
                    disabled={operationLocked}
                    onChange={(event) =>
                      setAiFocusCriterion(
                        event.target.value as StudioAiFocusCriterion
                      )
                    }
                  >
                    {AI_FOCUS_CRITERIA.map((option) => (
                      <option
                        key={option}
                        value={option}
                        disabled={
                          option === "people" && aiPeopleCriterion === "none"
                        }
                      >
                        {t(`ai_generator_redesign_criteria_focus_${option}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : transformMode ? (
            <>
              <div className={styles.aiMediaNotice} role="note">
                <span aria-hidden="true">
                  {studioMode === "retouch" ? "✎" : "↻"}
                </span>
                <div>
                  <strong>
                    {t(
                      studioMode === "retouch"
                        ? "ai_generator_retouch_tab_title"
                        : "ai_generator_studio_tab_modify"
                    )}
                  </strong>
                  <small>
                    {t("ai_generator_essential_inspiration_slot_hint")}
                  </small>
                </div>
              </div>
              <div className={styles.referenceSlots}>
                {renderReferenceSlot({
                  role: "inspiration",
                  title: t("ai_generator_essential_inspiration_slot"),
                  hint: t("ai_generator_essential_inspiration_slot_hint"),
                })}
              </div>
            </>
          ) : (
            <>
              <div
                className={styles.referenceDropzone}
                data-has-files={inspirationImages.length ? "true" : "false"}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!operationLocked) {
                    void handleReferenceFiles(event.dataTransfer.files);
                  }
                }}
              >
                <span
                  className={styles.referenceDropzoneIcon}
                  aria-hidden="true"
                >
                  +
                </span>
                <span>
                  <strong>Déposez vos références ici</strong>
                  <small>
                    Personnages, produits, lieux ou inspirations ·{" "}
                    {inspirationImages.length}/{MAX_INSPIRATION_IMAGES}
                  </small>
                </span>
                <span className={styles.referenceDropzoneActions}>
                  <label htmlFor="ai-media-reference-multiple">
                    Choisir sur mon appareil
                  </label>
                  <input
                    id="ai-media-reference-multiple"
                    type="file"
                    accept={INSPIRATION_IMAGE_ACCEPT}
                    multiple
                    disabled={
                      operationLocked ||
                      inspirationImages.length >= MAX_INSPIRATION_IMAGES
                    }
                    onChange={(event) => {
                      const files = event.currentTarget.files;
                      event.currentTarget.value = "";
                      if (files?.length) void handleReferenceFiles(files);
                    }}
                  />
                  <button
                    type="button"
                    disabled={
                      operationLocked ||
                      inspirationImages.length >= MAX_INSPIRATION_IMAGES
                    }
                    onClick={() => setLibraryPickerOpen(true)}
                  >
                    Choisir dans ma médiathèque
                  </button>
                </span>
              </div>

              {inspirationImages.length ? (
                <div className={styles.referenceCollection}>
                  {inspirationImages.map((reference, index) => {
                    const required = reference.usage === "required";
                    return (
                      <article
                        key={`${reference.name}-${index}`}
                        className={styles.referenceCard}
                        data-required={required ? "true" : "false"}
                        data-reference-role={reference.role || "inspiration"}
                      >
                        <img
                          src={`data:${reference.mimeType};base64,${reference.data}`}
                          alt=""
                        />
                        <div className={styles.referenceCardHeading}>
                          <strong>
                            {reference.name || `Référence ${index + 1}`}
                          </strong>
                          <button
                            type="button"
                            aria-label="Retirer cette référence"
                            disabled={operationLocked}
                            onClick={() => removeReferenceAt(index)}
                          >
                            ×
                          </button>
                        </div>
                        <div
                          className={styles.referenceUsageChoices}
                          role="radiogroup"
                          aria-label={`Utilisation de ${reference.name}`}
                        >
                          <button
                            type="button"
                            role="radio"
                            aria-checked={required}
                            data-active={required ? "true" : "false"}
                            disabled={operationLocked}
                            onClick={() => setReferenceUsage(index, "required")}
                          >
                            {t("ai_generator_redesign_reference_required")}
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={!required}
                            data-active={!required ? "true" : "false"}
                            disabled={operationLocked}
                            onClick={() =>
                              setReferenceUsage(index, "inspiration")
                            }
                          >
                            {t("ai_generator_redesign_reference_inspiration")}
                          </button>
                        </div>
                        <label className={styles.referenceRoleField}>
                          <span>
                            {t("ai_generator_redesign_reference_role_proposed")}
                          </span>
                          <select
                            className={styles.studioSelect}
                            value={
                              reference.role === "inspiration" ||
                              !reference.role
                                ? inferRequiredReferenceRole(reference.name)
                                : reference.role
                            }
                            disabled={operationLocked}
                            onChange={(event) =>
                              setReferenceRole(
                                index,
                                event.target
                                  .value as StudioRequiredReferenceRole
                              )
                            }
                          >
                            {REQUIRED_REFERENCE_ROLES.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {reference.role === "character" ? (
                          <p className={styles.characterReferenceStatus}>
                            {required
                              ? "Identité stricte : toutes les personnes présentes doivent être conservées et peuvent être mises en action."
                              : "Les personnes présentes inspirent le rendu sans imposer leur identité."}
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {kind === "video" && characterReferences.length ? (
                <div className={styles.identityContinuityNotice} role="note">
                  <span aria-hidden="true">✓</span>
                  <p>
                    Identité conservée entre les scènes pour chaque personnage
                    utilisé impérativement.
                  </p>
                </div>
              ) : null}
            </>
          )}

          <div className={styles.newSceneNotice} role="note">
            <span aria-hidden="true">✓</span>
            <p>
              {mediaSourceMode === "ai"
                ? `L’IA crée ${
                    kind === "video" ? "une vidéo" : "une image"
                  } entièrement nouvelle à partir de votre brief.`
                : mediaSourceMode === "criteria"
                ? t(
                    kind === "video"
                      ? "ai_generator_redesign_criteria_result_video"
                      : "ai_generator_redesign_criteria_result_image"
                  )
                : t(
                    kind === "video"
                      ? "ai_generator_essential_new_scene_video"
                      : "ai_generator_essential_new_scene_image"
                  )}
            </p>
          </div>

          {characterReferenceMissing ? (
            <p className={styles.identityRequirement} role="alert">
              {t("ai_generator_essential_character_missing")}
            </p>
          ) : null}
        </section>

        <section
          className={`${styles.essentialCard} ${styles.messageCard} ${styles.directionCard}`}
          data-generator-block="direction"
          data-media-kind={kind}
        >
          <header className={styles.essentialCardHeader}>
            <span>3</span>
            <div>
              <h3>
                {t(
                  kind === "image"
                    ? "ai_generator_redesign_image_direction_title"
                    : "ai_generator_redesign_video_direction_title"
                )}
              </h3>
              <p>
                {kind === "image"
                  ? "Donnez le cadre de production ; l’IA complète ce que votre consigne ne précise pas."
                  : "Cadrez le film, son rythme et la continuité de son histoire."}
              </p>
            </div>
            <RememberPreferenceControl
              checked={savedPreferences.blocks[3].saved}
              disabled={
                operationLocked || preferencesLoading || savingBlockIds.has(3)
              }
              saving={savingBlockIds.has(3)}
              label={t("ai_generator_remember_settings")}
              savingLabel={t("ai_generator_preferences_saving")}
              blockTitle={t(
                kind === "image"
                  ? "ai_generator_redesign_image_direction_title"
                  : "ai_generator_redesign_video_direction_title"
              )}
              onChange={(checked) => handleRememberPreferenceGroup(3, checked)}
            />
          </header>

          <div className={styles.directionSettings}>
            {kind === "image" ? (
              <label className={styles.essentialSelectField}>
                <span>Type de création</span>
                <select
                  className={styles.studioSelect}
                  value={imagePurpose}
                  disabled={operationLocked}
                  onChange={(event) =>
                    setImagePurpose(event.target.value as StudioImagePurpose)
                  }
                >
                  {IMAGE_PURPOSES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className={styles.essentialField}>
                <span>Durée</span>
                <div className={styles.essentialSegmented} role="radiogroup">
                  {([8, 16, 24] as const).map((duration) => {
                    const durationUnavailable =
                      duration > videoMaxDurationSeconds;
                    const creditInsufficient =
                      videoRemainingSeconds !== null &&
                      duration > videoRemainingSeconds;
                    return (
                      <button
                        key={duration}
                        type="button"
                        role="radio"
                        aria-checked={durationSeconds === duration}
                        data-active={
                          durationSeconds === duration ? "true" : "false"
                        }
                        disabled={
                          operationLocked ||
                          durationUnavailable ||
                          creditInsufficient
                        }
                        title={
                          creditInsufficient
                            ? t("ai_generator_video_credit_insufficient")
                            : durationUnavailable
                            ? t("ai_generator_video_premium_required")
                            : undefined
                        }
                        onClick={() => setDurationSeconds(duration)}
                      >
                        {duration} s
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <label className={styles.essentialSelectField}>
              <span>{t("ai_generator_format_title")}</span>
              <select
                className={styles.studioSelect}
                value={format}
                disabled={operationLocked}
                onChange={(event) =>
                  setFormat(event.target.value as MediaGenerationFormat)
                }
              >
                {FORMATS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {t(`ai_generator_format_${option.id}`)} · {option.ratio}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.essentialSelectField}>
              <span>{kind === "video" ? "Réalisation" : "Rendu visuel"}</span>
              <select
                className={styles.studioSelect}
                value={imageStyle}
                disabled={operationLocked}
                onChange={(event) =>
                  setImageStyle(event.target.value as MediaGenerationImageStyle)
                }
              >
                {IMAGE_STYLES.map((option) => (
                  <option key={option} value={option}>
                    {t(
                      kind === "video"
                        ? `ai_generator_video_render_${option}`
                        : `ai_generator_render_${option}`
                    )}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.essentialSelectField}>
              <span>Direction visuelle</span>
              <select
                className={styles.studioSelect}
                value={visualDirection}
                disabled={operationLocked}
                onChange={(event) =>
                  setVisualDirection(
                    event.target.value as StudioVisualDirection
                  )
                }
              >
                {VISUAL_DIRECTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {kind === "video" && durationSeconds > 8 ? (
            <div className={styles.sceneModeField}>
              <span>Organisation du scénario</span>
              <div className={styles.sceneModeChoices} role="radiogroup">
                {(["single", "multi"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={videoSceneMode === mode}
                    data-active={videoSceneMode === mode ? "true" : "false"}
                    disabled={operationLocked}
                    onClick={() => setVideoSceneMode(mode)}
                  >
                    <strong>
                      {mode === "single" ? "Scène unique" : "Multiscène"}
                    </strong>
                    <small>
                      {mode === "single"
                        ? "Une action continue et une identité stable."
                        : "Plusieurs étapes reliées dans une même histoire."}
                    </small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section
          className={`${styles.essentialCard} ${styles.soundCard} ${styles.finishCard}`}
          data-media-kind={kind}
          data-generator-block="finish"
        >
          <header className={styles.essentialCardHeader}>
            <span>4</span>
            <div>
              <h3>
                {t(
                  kind === "image"
                    ? "ai_generator_redesign_image_finish_title"
                    : "ai_generator_redesign_video_finish_title"
                )}
              </h3>
              <p>
                {kind === "image"
                  ? "Décidez exactement ce qui doit être écrit et signé."
                  : "Pilotez ce qui sera entendu, lu et identifié dans la vidéo."}
              </p>
            </div>
            <RememberPreferenceControl
              checked={savedPreferences.blocks[6].saved}
              disabled={
                operationLocked || preferencesLoading || savingBlockIds.has(6)
              }
              saving={savingBlockIds.has(6)}
              label={t("ai_generator_remember_settings")}
              savingLabel={t("ai_generator_preferences_saving")}
              blockTitle={t(
                kind === "image"
                  ? "ai_generator_redesign_image_finish_title"
                  : "ai_generator_redesign_video_finish_title"
              )}
              onChange={(checked) => handleRememberPreferenceGroup(4, checked)}
            />
          </header>

          <div className={styles.textModePanel}>
            <div className={styles.textModeHeading}>
              <span>Texte visible</span>
              <small>
                Aucun slogan automatique n’est ajouté si vous choisissez « Aucun
                texte ».
              </small>
            </div>
            <div className={styles.textModeChoices} role="radiogroup">
              {(
                [
                  ["none", "ai_generator_redesign_text_none"],
                  ["ai", "ai_generator_redesign_text_ai"],
                  ["exact", "ai_generator_redesign_text_exact"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={textMode === mode}
                  data-active={textMode === mode ? "true" : "false"}
                  disabled={operationLocked}
                  onClick={() => {
                    setTextMode(mode);
                    setWithText(mode !== "none");
                  }}
                >
                  {t(label)}
                </button>
              ))}
            </div>

            {visibleTextModeConflict ? (
              <small className={styles.fieldAlert} role="alert">
                Votre brief demande du texte visible. Choisissez « Texte rédigé
                par l’IA » ou « Texte exact » avant de générer.
              </small>
            ) : null}

            {textMode === "exact" ? (
              <label
                className={`${styles.essentialTextareaField} ${styles.exactTextField}`}
              >
                <span>
                  Texte à reproduire fidèlement
                  <small>{exactText.length}/600</small>
                </span>
                <textarea
                  value={exactText}
                  maxLength={600}
                  rows={5}
                  disabled={operationLocked}
                  aria-invalid={exactText.trim().length < 2}
                  onChange={(event) => setExactText(event.target.value)}
                  placeholder={
                    "Titre\nSous-titre\nPrix, date ou lieu\nAppel à l’action\nMentions utiles…"
                  }
                />
                {exactText.trim().length < 2 ? (
                  <small className={styles.fieldAlert} role="alert">
                    Ajoutez le texte qui doit apparaître sur le média.
                  </small>
                ) : null}
              </label>
            ) : null}

            {textMode === "ai" ? (
              <div className={styles.textKeywordsGroup}>
                <div className={styles.textKeywordsHeader}>
                  <span>Mots ou informations à évoquer</span>
                  <small>
                    {t("ai_generator_text_keywords_counter", {
                      count: resolvedTextKeywords.length,
                      max: MAX_TEXT_KEYWORDS,
                    })}
                  </small>
                </div>
                {textKeywords.length ? (
                  <div className={styles.textKeywordTags}>
                    {textKeywords.map((keyword) => (
                      <span
                        key={keyword}
                        className={styles.textKeywordTag}
                        title={keyword}
                      >
                        <span>{keyword}</span>
                        <button
                          type="button"
                          onClick={() => removeTextKeyword(keyword)}
                          disabled={operationLocked}
                          aria-label={t("ai_generator_text_keyword_remove", {
                            keyword,
                          })}
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
                    onChange={(event) =>
                      setTextKeywordDraft(event.target.value.slice(0, 160))
                    }
                    onKeyDown={(event) => {
                      if (["Enter", ",", ";"].includes(event.key)) {
                        event.preventDefault();
                        if (textKeywordDraft.trim()) {
                          addTextKeywords(textKeywordDraft);
                        }
                      }
                    }}
                    onBlur={() => {
                      if (textKeywordDraft.trim()) {
                        addTextKeywords(textKeywordDraft);
                      }
                    }}
                    placeholder="Ex. nouveauté, fabrication locale, 20 septembre…"
                    disabled={
                      operationLocked ||
                      textKeywords.length >= MAX_TEXT_KEYWORDS
                    }
                  />
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addTextKeywords(textKeywordDraft)}
                    disabled={
                      operationLocked ||
                      !textKeywordDraft.trim() ||
                      textKeywords.length >= MAX_TEXT_KEYWORDS
                    }
                  >
                    Ajouter
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {kind === "video" ? (
            <>
              <div className={styles.soundChoices} role="radiogroup">
                {(["voiceover", "characters"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={teamVideoSpeechMode === mode}
                    data-active={
                      teamVideoSpeechMode === mode ? "true" : "false"
                    }
                    disabled={operationLocked}
                    onClick={() => {
                      setTeamVideoSpeechMode(mode);
                      setTeamVideoVeoConsent(false);
                      setTeamVideoConsentOpen(false);
                    }}
                  >
                    <span aria-hidden="true">
                      {mode === "voiceover" ? "◉" : "◖"}
                    </span>
                    <span>
                      <strong>
                        {t(`ai_generator_essential_sound_${mode}`)}
                      </strong>
                      <small>
                        {t(`ai_generator_team_speech_${mode}_hint`)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>

              {teamVideoSpeechMode === "voiceover" ? (
                <div className={styles.voiceSettings}>
                  <div className={styles.essentialField}>
                    <span>{t("ai_generator_narration_voice_label")}</span>
                    <div
                      className={styles.essentialSegmented}
                      role="radiogroup"
                    >
                      {(["female", "male"] as const).map((voice) => (
                        <button
                          key={voice}
                          type="button"
                          role="radio"
                          aria-checked={narrationVoice === voice}
                          data-active={
                            narrationVoice === voice ? "true" : "false"
                          }
                          disabled={operationLocked}
                          onClick={() => {
                            setNarrationVoice(voice);
                            setNarrationVoiceVariant((current) =>
                              isAiMediaNarrationVoiceVariantForGender(
                                current,
                                voice
                              )
                                ? current
                                : defaultAiMediaNarrationVoiceVariant(voice)
                            );
                          }}
                        >
                          {t(`ai_generator_narration_voice_${voice}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className={styles.essentialSelectField}>
                    <span>
                      {t("ai_generator_narration_voice_variant_label")}
                    </span>
                    <select
                      className={styles.studioSelect}
                      value={narrationVoiceVariant}
                      disabled={operationLocked}
                      onChange={(event) =>
                        setNarrationVoiceVariant(
                          event.target
                            .value as MediaGenerationNarrationVoiceVariant
                        )
                      }
                    >
                      {AI_MEDIA_NARRATION_VOICE_VARIANTS[narrationVoice].map(
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
              ) : (
                <div className={styles.characterSpeechNotice} role="note">
                  {t("ai_generator_essential_character_speech_notice")}
                </div>
              )}

              <label className={styles.essentialSwitchRow}>
                <span>
                  <strong>{t("ai_generator_with_music")}</strong>
                  <small>{t("ai_generator_music_inrcy_hint")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={withMusic}
                  disabled={operationLocked}
                  onChange={(event) => setWithMusic(event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
            </>
          ) : null}

          <div className={styles.identitySettings}>
            <label className={styles.essentialSwitchRow}>
              <span>
                <strong>{t("ai_generator_brand_colors")}</strong>
                <small>{t("ai_generator_brand_colors_hint")}</small>
              </span>
              <input
                type="checkbox"
                checked={useBrandColors}
                disabled={operationLocked}
                onChange={(event) => setUseBrandColors(event.target.checked)}
              />
              <i aria-hidden="true" />
            </label>

            <div className={styles.essentialField}>
              <span>{t("ai_generator_logo_label")}</span>
              <div className={styles.essentialSegmented} role="radiogroup">
                {LOGO_MODES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={logoMode === option}
                    data-active={logoMode === option ? "true" : "false"}
                    disabled={operationLocked}
                    onClick={() => setLogoMode(option)}
                  >
                    {t(`ai_generator_logo_${option}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className={styles.generatorAlerts} aria-live="polite">
        {preferencesError ? (
          <div className={styles.preferencesError} role="alert">
            {t(
              preferencesError === "load"
                ? "ai_generator_preferences_load_error"
                : "ai_generator_preferences_save_error"
            )}
          </div>
        ) : null}

        {videoCreditInsufficient ? (
          <div className={styles.warning} role="status">
            {t("ai_generator_video_credit_insufficient")}
          </div>
        ) : videoDurationUnavailable ? (
          <div className={styles.warning} role="status">
            {t("ai_generator_video_premium_required")}
          </div>
        ) : exhausted ? (
          <div className={styles.warning} role="status">
            {t("ai_generator_quota_reached")}
          </div>
        ) : null}
        {actionError || error ? (
          <div className={styles.error} role="alert">
            {actionError || error}
          </div>
        ) : null}
      </div>

      <div
        className={styles.footerBar}
        data-kind={kind}
        data-consent-required={identityConsentRequired ? "true" : "false"}
      >
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
              <span>
                {t(
                  kind === "image"
                    ? "ai_generator_image_quota"
                    : "ai_generator_video_quota"
                )}
              </span>
              <strong>{quotaValue}</strong>
            </div>
            <small>
              {quota?.unlimited
                ? t("ai_generator_unlimited")
                : counter?.remaining !== null && counter
                ? kind === "video"
                  ? t("ai_generator_video_seconds_remaining", {
                      count: counter.remaining,
                    })
                  : t("ai_generator_remaining", { count: counter.remaining })
                : t("ai_generator_monthly_quota")}
              {resetDate
                ? ` · ${t("ai_generator_reset", { date: resetDate })}`
                : ""}
            </small>
          </div>
        </div>
        {identityConsentRequired ? (
          <label
            className={styles.footerConsent}
            data-checked={identityConsent ? "true" : "false"}
            htmlFor="ai-media-footer-identity-consent"
          >
            <input
              id="ai-media-footer-identity-consent"
              type="checkbox"
              checked={identityConsent}
              disabled={operationLocked}
              aria-describedby="ai-media-footer-consent-hint"
              onChange={(event) => {
                setIdentityConsent(event.target.checked);
                setTeamVideoVeoConsent(false);
                setTeamVideoConsentOpen(false);
                if (actionError || error) clearTransientState();
              }}
            />
            <span className={styles.footerConsentCopy}>
              <span className={styles.footerConsentHeading}>
                <strong>{t("ai_generator_footer_consent_title")}</strong>
                <em id="ai-media-footer-consent-status" role="status">
                  {t(
                    identityConsent
                      ? "ai_generator_footer_consent_confirmed"
                      : "ai_generator_footer_consent_blocking"
                  )}
                </em>
              </span>
              <span className={styles.footerConsentStatement}>
                {t(
                  effectiveIdentityMode === "reference_team"
                    ? "ai_generator_reference_team_consent_label"
                    : "ai_generator_video_character_consent_label"
                )}
              </span>
              <small id="ai-media-footer-consent-hint">
                {t(
                  effectiveIdentityMode === "reference_team" && kind === "video"
                    ? "ai_generator_identity_consent_hint_team_video_cinematic"
                    : kind === "image"
                    ? "ai_generator_identity_consent_hint_image"
                    : "ai_generator_identity_consent_hint_video"
                )}
              </small>
            </span>
          </label>
        ) : null}
        <button
          type="button"
          className={styles.generateButton}
          disabled={disabled}
          aria-describedby={
            identityConsentMissing
              ? "ai-media-footer-consent-status"
              : undefined
          }
          onClick={() => void handleGenerate()}
        >
          <span aria-hidden="true">✦</span>
          <strong>
            {t(
              kind === "image"
                ? "ai_generator_generate_image"
                : "ai_generator_generate_video"
            )}
          </strong>
        </button>
      </div>

      <MediaLibraryPickerModal
        open={libraryPickerOpen}
        title={t("ai_generator_inspiration_library_title")}
        subtitle={t("ai_generator_inspiration_library_subtitle")}
        accept="image"
        multiple={!transformMode}
        maxSelection={
          transformMode
            ? 1
            : Math.max(1, MAX_INSPIRATION_IMAGES - inspirationImages.length)
        }
        confirmLabel={t("ai_generator_inspiration_library_confirm")}
        onClose={() => setLibraryPickerOpen(false)}
        onConfirm={handleLibraryInspirationConfirm}
      />
    </div>
  );
}
