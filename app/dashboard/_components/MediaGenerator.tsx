"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import useMediaGeneration, {
  MediaGenerationAccountChangedError,
  MediaGenerationCancelledError,
  type MediaGenerationFormat,
  type MediaGenerationImageStyle,
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
  type MediaGenerationVideoDuration,
  type MediaGenerationVideoCharacterMode,
  type MediaGenerationTeamVideoSpeechMode,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import useAiMediaGeneratorPreferences from "@/app/dashboard/_hooks/useAiMediaGeneratorPreferences";
import {
  AI_MEDIA_INSPIRATION_MAX_COUNT,
  AI_MEDIA_INSPIRATION_MAX_DIMENSION,
  AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS,
  AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES,
  AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES,
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
  isInrMediaImageFile,
} from "@/lib/mediaRules";
import { uploadUniversalMediaFile } from "@/lib/universalMediaUploadClient";
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

type StudioMediaSourceMode = "ai" | "real";
type StudioCharacterCount = 0 | 1 | 2 | 3;

const IMAGE_STYLES: MediaGenerationImageStyle[] = [
  "photo",
  "illustration",
  "three_d",
  "graphic",
];
const LOGO_MODES: MediaGenerationLogoMode[] = ["discreet", "visible", "none"];
const MAX_TEXT_KEYWORDS = 6;
const MAX_INSPIRATION_IMAGES = AI_MEDIA_INSPIRATION_MAX_COUNT;
const INSPIRATION_IMAGE_ACCEPT = [
  ...INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  ...INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

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

async function prepareInspirationImage(
  file: File
): Promise<MediaGenerationInspirationImage> {
  if (!isInrMediaImageFile(file)) {
    throw new Error(`Formats acceptés : ${INR_MEDIA_IMAGE_FORMATS_LABEL}.`);
  }
  if (!file.size || file.size > AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES) {
    throw new Error("L’image d’inspiration doit peser moins de 12 Mo.");
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
    error: preferencesError,
    accountEpoch: preferencesAccountEpoch,
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
  const [realCharacterCount, setRealCharacterCount] =
    useState<StudioCharacterCount>(1);
  const [useBrandColors, setUseBrandColors] = useState(true);
  const [logoMode, setLogoMode] = useState<MediaGenerationLogoMode>("discreet");
  const [durationSeconds, setDurationSeconds] =
    useState<MediaGenerationVideoDuration>(8);
  const [withText, setWithText] = useState(true);
  const [textKeywords, setTextKeywords] = useState<string[]>([]);
  const [textKeywordDraft, setTextKeywordDraft] = useState("");
  const [withMusic, setWithMusic] = useState(true);
  const [narrationVoice, setNarrationVoice] =
    useState<MediaGenerationNarrationVoice>("female");
  const [narrationVoiceVariant, setNarrationVoiceVariant] =
    useState<MediaGenerationNarrationVoiceVariant>("Kore");
  const [inspirationImages, setInspirationImages] = useState<
    MediaGenerationInspirationImage[]
  >([]);
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
  const identityReferenceSetIdRef = useRef("");
  if (!identityReferenceSetIdRef.current) {
    identityReferenceSetIdRef.current = createIdentityReferenceSetId();
  }
  const acceptInFlightRef = useRef(false);
  const busy = generationBusy || discarding;
  const operationLocked = busy || finishing || voiceBusy || inspirationBusy;

  useEffect(() => {
    if (clearedSensitiveStateEpochRef.current === preferencesAccountEpoch)
      return;
    clearedSensitiveStateEpochRef.current = preferencesAccountEpoch;
    setCustomIdea("");
    setAiInstruction("");
    setTextKeywords([]);
    setTextKeywordDraft("");
    setInspirationImages([]);
    setMediaSourceMode("ai");
    setRealCharacterCount(1);
    setIdentityConsent(false);
    setTeamVideoVeoConsent(false);
    setTeamVideoConsentOpen(false);
    identityReferenceSetIdRef.current = createIdentityReferenceSetId();
  }, [preferencesAccountEpoch]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    if (appliedPreferencesEpochRef.current === preferencesAccountEpoch) return;

    const block1 = savedPreferences.blocks[1];
    const block6 = savedPreferences.blocks[6];
    if (block1.saved) {
      setKind(block1.defaults.kind);
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
      setUseBrandColors(block3.defaults.useBrandColors);
      setLogoMode(block3.defaults.logoMode);
    }

    const block4 = savedPreferences.blocks[4];
    if (block4.saved) {
      setImageStyle(block4.defaults.imageStyle);
    }

    const block5 = savedPreferences.blocks[5];
    if (block5.saved) {
      setTeamVideoSpeechMode(block5.defaults.teamVideoSpeechMode);
    }

    if (block6.saved) {
      setDurationSeconds(block6.defaults.durationSeconds);
      setWithText(block6.defaults.withText);
      setWithMusic(block6.defaults.withMusic);
      setNarrationVoice(block6.defaults.narrationVoice);
      setNarrationVoiceVariant(block6.defaults.narrationVoiceVariant);
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
  const resultPreviewFormat = generationResult
    ? resolveAiMediaPreviewFormat({
        width: generationResult.item.width,
        height: generationResult.item.height,
        fallback: generationResult.format,
      })
    : format;

  useEffect(() => {
    if (!quota) return;
    setDurationSeconds((current) =>
      current > videoMaxDurationSeconds ? videoMaxDurationSeconds : current
    );
  }, [quota, videoMaxDurationSeconds]);

  const videoDurationRestricted =
    kind === "video" && videoMaxDurationSeconds < 24;
  const videoPremiumRequired =
    kind === "video" && durationSeconds > videoMaxDurationSeconds;
  const characterReferences = inspirationImages.filter(
    (image) => image.role === "character"
  );
  const environmentReference = inspirationImages.find(
    (image) => image.role === "environment"
  );
  const productReference = inspirationImages.find(
    (image) => image.role === "product"
  );
  const effectivePeopleMode: MediaGenerationPeopleMode =
    mediaSourceMode === "ai"
      ? "auto"
      : realCharacterCount === 0
      ? "none"
      : realCharacterCount === 1
      ? "solo"
      : "team";
  const effectiveIdentityMode: MediaGenerationVideoCharacterMode =
    mediaSourceMode === "ai" || realCharacterCount === 0
      ? "auto"
      : realCharacterCount === 1
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
    mediaSourceMode === "real" &&
    characterReferences.length !== realCharacterCount;
  const identityConsentRequired =
    strictIdentityReferenceMode && characterReferences.length > 0;
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

  const resetReferenceConsent = () => {
    identityReferenceSetIdRef.current = createIdentityReferenceSetId();
    setIdentityConsent(false);
    setTeamVideoVeoConsent(false);
    setTeamVideoConsentOpen(false);
    if (actionError || error) clearTransientState();
  };

  const orderReferences = (images: MediaGenerationInspirationImage[]) =>
    [...images].sort((left, right) => {
      const rank = (image: MediaGenerationInspirationImage) =>
        image.role === "character"
          ? image.characterIndex || 1
          : image.role === "environment"
          ? 4
          : 5;
      return rank(left) - rank(right);
    });

  const selectMediaSourceMode = (mode: StudioMediaSourceMode) => {
    setMediaSourceMode(mode);
    if (mode === "ai") setInspirationImages([]);
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
    resetReferenceConsent();
  };

  const prepareReferenceFile = async (
    file: File,
    role: MediaGenerationReferenceRole,
    characterIndex?: 1 | 2 | 3
  ) => {
    setInspirationBusy(true);
    setActionError("");
    try {
      const prepared = await prepareInspirationImage(file);
      const next: MediaGenerationInspirationImage = {
        ...prepared,
        role,
        ...(role === "character" ? { characterIndex } : {}),
      };
      setInspirationImages((current) =>
        orderReferences([
          ...current.filter(
            (image) =>
              !(
                image.role === role &&
                (role !== "character" ||
                  image.characterIndex === characterIndex)
              )
          ),
          next,
        ]).slice(0, MAX_INSPIRATION_IMAGES)
      );
      resetReferenceConsent();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : t("ai_generator_error")
      );
    } finally {
      setInspirationBusy(false);
    }
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
        aiInstruction: aiInstruction.trim(),
        withText,
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
        <section className={`${styles.essentialCard} ${styles.creationCard}`}>
          <header className={styles.essentialCardHeader}>
            <span>1</span>
            <div>
              <h3>{t("ai_generator_essential_creation_title")}</h3>
              <p>{t("ai_generator_essential_creation_hint")}</p>
            </div>
          </header>

          <div className={styles.essentialField}>
            <span>{t("ai_generator_essential_media_type")}</span>
            <div className={styles.essentialSegmented} role="radiogroup">
              {(["image", "video"] as const).map((mediaKind) => (
                <button
                  key={mediaKind}
                  type="button"
                  role="radio"
                  aria-checked={kind === mediaKind}
                  data-active={kind === mediaKind ? "true" : "false"}
                  disabled={operationLocked}
                  onClick={() => {
                    setKind(mediaKind);
                    if (actionError || error) clearTransientState();
                  }}
                >
                  <span aria-hidden="true">
                    {mediaKind === "image" ? "▣" : "▶"}
                  </span>
                  {t(
                    mediaKind === "image" ? "image_50e19fda" : "video_304f6ca4"
                  )}
                </button>
              ))}
            </div>
          </div>

          {kind === "video" ? (
            <div className={styles.essentialField}>
              <span>{t("ai_generator_duration_title")}</span>
              <div className={styles.essentialSegmented} role="radiogroup">
                {([8, 16, 24] as const).map((duration) => {
                  const premiumLocked = duration > videoMaxDurationSeconds;
                  return (
                    <button
                      key={duration}
                      type="button"
                      role="radio"
                      aria-checked={durationSeconds === duration}
                      data-active={
                        durationSeconds === duration ? "true" : "false"
                      }
                      disabled={operationLocked || premiumLocked}
                      title={
                        premiumLocked
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
          ) : null}

          <div className={styles.essentialSplitFields}>
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
              <span>
                {t(
                  kind === "video"
                    ? "ai_generator_video_render_label"
                    : "ai_generator_render_label"
                )}
              </span>
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
          </div>

          <label className={styles.essentialSelectField}>
            <span>{t("ai_generator_essential_subject_source")}</span>
            <select
              className={styles.studioSelect}
              value={subjectSource}
              disabled={operationLocked}
              onChange={(event) => {
                setSubjectSource(
                  event.target.value as MediaGenerationSubjectSource
                );
                if (actionError || error) clearTransientState();
              }}
            >
              {subjectChoices.map((choice) => (
                <option
                  key={choice.id}
                  value={choice.id}
                  disabled={choice.disabled}
                >
                  {choice.title}
                </option>
              ))}
            </select>
          </label>

          {subjectSource === "custom" ? (
            <label className={styles.essentialTextareaField}>
              <span>{t("ai_generator_custom_label")}</span>
              <div className={styles.customTextareaWrap}>
                <textarea
                  value={customIdea}
                  onChange={(event) => {
                    setCustomIdea(event.target.value);
                    if (actionError || error) clearTransientState();
                  }}
                  placeholder={t("ai_generator_custom_placeholder")}
                  maxLength={1_600}
                  disabled={busy || finishing}
                  readOnly={voiceBusy}
                  rows={3}
                />
                <MediaSubjectVoiceButton
                  disabled={busy || finishing}
                  value={customIdea}
                  maxLength={1_600}
                  onBusyChange={setVoiceBusy}
                  onChange={(nextValue) => {
                    setCustomIdea(nextValue);
                    if (actionError || error) clearTransientState();
                  }}
                />
              </div>
              {customIdea.trim().length > 0 && customIdea.trim().length < 3 ? (
                <small>{t("ai_generator_custom_too_short")}</small>
              ) : null}
            </label>
          ) : null}

          <label className={styles.essentialTextareaField}>
            <span>
              {t("ai_generator_essential_instruction_label")}
              <small>{t("ai_generator_instruction_optional")}</small>
            </span>
            <div className={styles.customTextareaWrap}>
              <textarea
                value={aiInstruction}
                onChange={(event) => {
                  setAiInstruction(event.target.value);
                  if (actionError || error) clearTransientState();
                }}
                placeholder={t("ai_generator_instruction_placeholder")}
                maxLength={600}
                disabled={operationLocked}
                rows={2}
              />
              <MediaSubjectVoiceButton
                purpose="instruction"
                disabled={busy || finishing}
                value={aiInstruction}
                maxLength={600}
                onBusyChange={setVoiceBusy}
                onChange={(nextValue) => {
                  setAiInstruction(nextValue);
                  if (actionError || error) clearTransientState();
                }}
              />
            </div>
            <small>{t("ai_generator_instruction_hint")}</small>
          </label>
        </section>

        <section className={`${styles.essentialCard} ${styles.mediaCard}`}>
          <header className={styles.essentialCardHeader}>
            <span>2</span>
            <div>
              <h3>{t("ai_generator_essential_media_title")}</h3>
              <p>{t("ai_generator_essential_media_hint")}</p>
            </div>
          </header>

          <div className={styles.essentialSegmented} role="radiogroup">
            {(["ai", "real"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={mediaSourceMode === mode}
                data-active={mediaSourceMode === mode ? "true" : "false"}
                disabled={operationLocked}
                onClick={() => selectMediaSourceMode(mode)}
              >
                <span aria-hidden="true">{mode === "ai" ? "✦" : "◉"}</span>
                {t(`ai_generator_essential_media_mode_${mode}`)}
              </button>
            ))}
          </div>

          {mediaSourceMode === "ai" ? (
            <div className={styles.aiMediaNotice} role="note">
              <span aria-hidden="true">✦</span>
              <div>
                <strong>{t("ai_generator_essential_ai_notice_title")}</strong>
                <small>{t("ai_generator_essential_ai_notice_hint")}</small>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.essentialField}>
                <span>{t("ai_generator_essential_character_count")}</span>
                <div className={styles.essentialSegmented} role="radiogroup">
                  {([0, 1, 2, 3] as const).map((count) => (
                    <button
                      key={count}
                      type="button"
                      role="radio"
                      aria-checked={realCharacterCount === count}
                      data-active={
                        realCharacterCount === count ? "true" : "false"
                      }
                      disabled={operationLocked}
                      onClick={() => selectRealCharacterCount(count)}
                    >
                      {count === 0
                        ? t("ai_generator_essential_character_none")
                        : count}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.referenceSlots}>
                {Array.from({ length: realCharacterCount }, (_, index) =>
                  renderReferenceSlot({
                    role: "character",
                    characterIndex: (index + 1) as 1 | 2 | 3,
                    title: t("ai_generator_essential_character_slot", {
                      count: index + 1,
                    }),
                    hint: t("ai_generator_essential_character_slot_hint"),
                  })
                )}
                {renderReferenceSlot({
                  role: "environment",
                  title: t("ai_generator_essential_environment_slot"),
                  hint: t("ai_generator_essential_environment_slot_hint"),
                  optional: true,
                })}
                {renderReferenceSlot({
                  role: "product",
                  title: t("ai_generator_essential_product_slot"),
                  hint: t("ai_generator_essential_product_slot_hint"),
                  optional: true,
                })}
              </div>
            </>
          )}

          <div className={styles.newSceneNotice} role="note">
            <span aria-hidden="true">✓</span>
            <p>
              {t(
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

        <section className={`${styles.essentialCard} ${styles.messageCard}`}>
          <header className={styles.essentialCardHeader}>
            <span>3</span>
            <div>
              <h3>{t("ai_generator_essential_message_title")}</h3>
              <p>{t("ai_generator_essential_message_hint")}</p>
            </div>
          </header>

          <label className={styles.essentialSwitchRow}>
            <span>
              <strong>{t("ai_generator_text_on_media")}</strong>
              <small>{t("ai_generator_text_inspiration_hint")}</small>
            </span>
            <input
              type="checkbox"
              checked={withText}
              disabled={operationLocked}
              onChange={(event) => setWithText(event.target.checked)}
            />
            <i aria-hidden="true" />
          </label>

          {withText ? (
            <div className={styles.textKeywordsGroup}>
              <div className={styles.textKeywordsHeader}>
                <span>{t("ai_generator_text_keywords_label")}</span>
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
                    <span key={keyword} className={styles.textKeywordTag}>
                      {keyword}
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
                      if (textKeywordDraft.trim())
                        addTextKeywords(textKeywordDraft);
                    }
                  }}
                  onBlur={() => {
                    if (textKeywordDraft.trim())
                      addTextKeywords(textKeywordDraft);
                  }}
                  placeholder={t("ai_generator_text_keywords_placeholder")}
                  disabled={
                    operationLocked || textKeywords.length >= MAX_TEXT_KEYWORDS
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
                  {t("ai_generator_text_keyword_add")}
                </button>
              </div>
            </div>
          ) : null}

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
        </section>

        <section
          className={`${styles.essentialCard} ${styles.soundCard}`}
          data-media-kind={kind}
        >
          <header className={styles.essentialCardHeader}>
            <span>4</span>
            <div>
              <h3>{t("ai_generator_essential_sound_title")}</h3>
              <p>
                {t(
                  kind === "video"
                    ? "ai_generator_essential_sound_hint"
                    : "ai_generator_essential_sound_image_hint"
                )}
              </p>
            </div>
          </header>

          {kind === "image" ? (
            <div className={styles.noAudioNotice} role="note">
              <span aria-hidden="true">▣</span>
              <div>
                <strong>{t("ai_generator_essential_no_audio_title")}</strong>
                <small>{t("ai_generator_essential_no_audio_hint")}</small>
              </div>
            </div>
          ) : (
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
          )}
        </section>
      </div>

      {preferencesError ? (
        <div className={styles.preferencesError} role="alert">
          {t(
            preferencesError === "load"
              ? "ai_generator_preferences_load_error"
              : "ai_generator_preferences_save_error"
          )}
        </div>
      ) : null}

      {videoPremiumRequired ? (
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
              {videoPremiumRequired
                ? t("ai_generator_video_premium_required")
                : quota?.unlimited
                ? t("ai_generator_unlimited")
                : counter?.remaining !== null && counter
                ? t("ai_generator_remaining", { count: counter.remaining })
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
    </div>
  );
}
