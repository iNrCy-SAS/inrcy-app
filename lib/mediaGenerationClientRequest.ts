import { AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS, shouldConnectAiMediaVideoScenes, type AiMediaNarrationVoiceVariant } from "./aiMediaGenerationContracts.ts";
import type { AiMediaVideoEngine, AiMediaImageEngine } from "./aiMediaModelCatalog.ts";
import type { AiMediaCharacterVoiceSample } from "./aiMediaCharacterVoices.ts";
import { isProvidedCharacterVoice } from "./aiMediaCharacterVoiceClient.ts";

export type MediaGenerationKind = "image" | "video";

export type MediaGenerationOperation = "generate" | "modify";

export type MediaGenerationSource = "booster" | "studio";

export type MediaGenerationSubjectSource = "publication" | "profile" | "custom";

export type MediaGenerationFormat =
  | "square"
  | "portrait"
  | "story"
  | "landscape";

export type MediaGenerationTypology =
  | "company"
  | "service"
  | "advice"
  | "showcase"
  | "offer"
  | "event"
  | "behind_scenes"
  | "recruitment";

export type MediaGenerationVisualStyle =
  | "brand"
  | "clean"
  | "premium"
  | "warm"
  | "dynamic"
  | "expert"
  | "local"
  | "colorful";

export type MediaGenerationVisualDirection =
  | "auto"
  | "clean"
  | "premium"
  | "warm"
  | "dynamic"
  | "bold";

export type MediaGenerationImagePurpose =
  | "auto"
  | "simple"
  | "social"
  | "flyer"
  | "product_sheet"
  | "poster"
  | "banner"
  | "infographic";

export type MediaGenerationImageStyle =
  | "photo"
  | "illustration"
  | "three_d"
  | "graphic";

export type MediaGenerationShotType = "auto" | "close" | "medium" | "wide";

export type MediaGenerationPeopleMode = "auto" | "none" | "solo" | "team";

export type MediaGenerationCreativity = "faithful" | "bold";

export type MediaGenerationLogoMode = "discreet" | "visible" | "none";

export type MediaGenerationVideoDuration = number;

export type MediaGenerationVideoSceneMode = "single" | "multi";

export type MediaGenerationVideoEngine = AiMediaVideoEngine;

export type MediaGenerationTeamVideoMode = "cinematic" | "montage";

export type MediaGenerationTeamVideoSpeechMode = "voiceover" | "characters";

export type MediaGenerationNarrationVoice = "female" | "male";

export type MediaGenerationNarrationVoiceVariant = AiMediaNarrationVoiceVariant;

export type MediaGenerationInputMode = "legacy" | "essential";

export type MediaGenerationTextMode = "none" | "ai" | "exact";

export type MediaGenerationMode =
  | "ai_free"
  | "ai_criteria"
  | "inspiration";

export type MediaGenerationPeopleCriterion =
  | "auto"
  | "none"
  | "one"
  | "two"
  | "three"
  | "group";

export type MediaGenerationSettingCriterion =
  | "auto"
  | "interior"
  | "exterior"
  | "studio"
  | "neutral";

export type MediaGenerationFocusCriterion =
  | "auto"
  | "people"
  | "product"
  | "environment";

export type MediaGenerationReferenceRole =
  | "character"
  | "environment"
  | "product"
  | "inspiration";

export type MediaGenerationReferenceUsage = "required" | "inspiration";

export type MediaGenerationIdentityMode =
  | "auto"
  | "professional"
  | "brand_avatar"
  | "reference_team";

/** @deprecated Alias conservé pour les anciens écrans vidéo. */
export type MediaGenerationVideoCharacterMode = MediaGenerationIdentityMode;

export type MediaGenerationVideoEngineResult =
  | MediaGenerationVideoEngine
  | "omni_veo_fallback"
  | "veo_omni_fallback"
  | "local_fallback";

export type MediaGenerationInspirationImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
  name: string;
  role?: MediaGenerationReferenceRole;
  usage?: MediaGenerationReferenceUsage;
  characterIndex?: 1 | 2 | 3;
  voiceMode?: "ai" | "provided";
  voiceSample?: AiMediaCharacterVoiceSample;
};

export type MediaGenerationRequest = {
  creationMode?: "guided" | "free";
  freePrompt?: string;
  publicationSubject?: string;
  spokenScript?: string;
  withSubtitles?: boolean;
  useBusinessDna?: boolean;
  operation?: MediaGenerationOperation;
  inputMode?: MediaGenerationInputMode;
  generationMode?: MediaGenerationMode;
  peopleCriterion?: MediaGenerationPeopleCriterion;
  settingCriterion?: MediaGenerationSettingCriterion;
  focusCriterion?: MediaGenerationFocusCriterion;
  /** Canvas autoritaire de l'image source, utilisé uniquement par Modifier. */
  modificationSourceWidth?: number;
  modificationSourceHeight?: number;
  kind: MediaGenerationKind;
  subjectSource: MediaGenerationSubjectSource;
  idea: string;
  aiInstruction?: string;
  textMode?: MediaGenerationTextMode;
  exactText?: string;
  withText?: boolean;
  textKeywords: string[];
  withMusic?: boolean;
  /** Bundled catalogue choice; absent/null means Auto. */
  soundtrackId?: string | null;
  withNarration?: boolean;
  narrationVoice?: MediaGenerationNarrationVoice;
  narrationVoiceVariant?: MediaGenerationNarrationVoiceVariant;
  narrationVoiceMode?: "ai" | "provided";
  narrationVoiceSample?: AiMediaCharacterVoiceSample | null;
  narrationVoiceConsent?: boolean;
  narrationVoiceGender?: "auto" | "female" | "male";
  format: MediaGenerationFormat;
  typology?: MediaGenerationTypology;
  visualStyle?: MediaGenerationVisualStyle;
  visualDirection?: MediaGenerationVisualDirection;
  imagePurpose?: MediaGenerationImagePurpose;
  imageStyle: MediaGenerationImageStyle;
  shotType?: MediaGenerationShotType;
  peopleMode: MediaGenerationPeopleMode;
  creativity?: MediaGenerationCreativity;
  useBrandColors: boolean;
  logoMode: MediaGenerationLogoMode;
  videoEngine?: MediaGenerationVideoEngine;
  imageEngine?: AiMediaImageEngine;
  videoResolution?: "720p" | "768p" | "1080p";
  expectedCredits?: number;
  creditTariffVersion?: string;
  creditQuoteId?: string;
  teamVideoMode?: MediaGenerationTeamVideoMode;
  teamVideoSpeechMode?: MediaGenerationTeamVideoSpeechMode;
  /** Consentement ponctuel Veo : il ne doit jamais être mémorisé. */
  teamVideoVeoConsent?: boolean;
  teamVideoProviderConsent?: MediaGenerationVideoEngine;
  identityMode?: MediaGenerationIdentityMode;
  videoCharacterMode?: MediaGenerationVideoCharacterMode;
  identityConsent?: boolean;
  identityReferenceSetId?: string;
  durationSeconds?: MediaGenerationVideoDuration;
  sceneMode?: MediaGenerationVideoSceneMode;
  connectScenes?: boolean;
  inspirationImages?: MediaGenerationInspirationImage[];
  source: MediaGenerationSource;
};

export function characterReferenceCount(
  images: MediaGenerationInspirationImage[] | undefined,
  identityMode: MediaGenerationIdentityMode
) {
  return (images || []).filter(
    (image) =>
      (image.role === "character" && image.usage !== "inspiration") ||
      (!image.role && identityMode !== "auto")
  ).length;
}

export function hasAnimationSourceImage(
  kind: MediaGenerationKind,
  images: MediaGenerationInspirationImage[] | undefined
) {
  return kind === "video" && Boolean(images?.length);
}

export function hasStrictIdentityReferences(request: MediaGenerationRequest) {
  const identityMode =
    request.identityMode || request.videoCharacterMode || "auto";
  return (
    (request.kind === "video" && (request.inspirationImages || []).some((image) => isProvidedCharacterVoice(image) && image.voiceSample)) ||
    (request.peopleMode !== "none" &&
    identityMode !== "auto" &&
    characterReferenceCount(request.inspirationImages, identityMode) > 0)
  );
}

export function resolveMediaGenerationTextMode(request: MediaGenerationRequest) {
  return request.textMode || (request.withText ? "ai" : "none");
}

export function resolveMediaGenerationSceneMode(
  request: MediaGenerationRequest
): MediaGenerationVideoSceneMode {
  if (request.kind !== "video" || (request.durationSeconds || 16) < 8) {
    return "single";
  }
  return request.sceneMode || "single";
}

export function resolveMediaGenerationConnectScenes(request: MediaGenerationRequest) {
  const sceneMode = resolveMediaGenerationSceneMode(request);
  return shouldConnectAiMediaVideoScenes({
    ...request,
    sceneMode,
    connectScenes: sceneMode === "single",
  });
}

export function normalizeMediaGenerationAiInstruction(
  request: MediaGenerationRequest
) {
  const value = String(request.aiInstruction || "").trim();
  if (
    request.operation === "modify" &&
    value.length > AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS
  ) {
    throw new Error(
      `La consigne de modification ne peut pas dépasser ${AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS.toLocaleString("fr-FR")} caractères.`
    );
  }
  return value;
}

export function buildGenerationAttemptKey(
  request: MediaGenerationRequest,
  idea: string
) {
  const textMode = resolveMediaGenerationTextMode(request);
  const aiInstruction = normalizeMediaGenerationAiInstruction(request);
  return JSON.stringify({
    creationMode: request.creationMode || "guided",
    freePrompt: request.creationMode === "free" ? request.freePrompt : undefined,
    ...(request.creationMode === "free" && request.kind === "image" && request.publicationSubject ? { publicationSubject: request.publicationSubject } : {}),
    spokenScript: request.creationMode === "free" && request.kind === "video" ? request.spokenScript : undefined,
    ...(request.creationMode === "free" && request.kind === "video" && request.withSubtitles &&
      (request.withNarration || request.teamVideoSpeechMode === "characters") ? { withSubtitles: true } : {}),
    ...(request.creationMode === "free" && request.useBusinessDna ? { useBusinessDna: true } : {}),
    operation: request.operation || "generate",
    inputMode: request.inputMode || "legacy",
    generationMode:
      request.operation === "modify"
        ? null
        : request.generationMode ||
          (request.inspirationImages?.length ? "inspiration" : "ai_free"),
    peopleCriterion: request.peopleCriterion || "auto",
    settingCriterion: request.settingCriterion || "auto",
    focusCriterion: request.focusCriterion || "auto",
    modificationSourceWidth:
      request.operation === "modify" ? request.modificationSourceWidth : null,
    modificationSourceHeight:
      request.operation === "modify" ? request.modificationSourceHeight : null,
    kind: request.kind,
    subjectSource: request.subjectSource,
    idea,
    aiInstruction,
    textMode: request.textMode,
    exactText: request.exactText,
    withText: textMode !== "none",
    textKeywords: textMode === "ai" ? request.textKeywords : [],
    withMusic: request.kind === "video" && Boolean(request.withMusic),
    ...(request.kind === "video" && request.withMusic && request.soundtrackId ? { soundtrackId: request.soundtrackId } : {}),
    withNarration: request.kind === "video" && Boolean(request.withNarration),
    narrationVoice:
      request.kind === "video" && request.withNarration
        ? request.narrationVoice || "female"
        : null,
    narrationVoiceVariant:
      request.kind === "video" && request.withNarration
        ? request.narrationVoiceVariant || null
        : null,
    ...(request.kind === "video" && request.withNarration && request.teamVideoSpeechMode !== "characters" && request.narrationVoiceMode === "provided" ? {
      narrationVoiceMode: "provided", narrationVoiceSample: request.narrationVoiceSample?.path,
      narrationVoiceConsent: request.narrationVoiceConsent === true, narrationVoiceGender: request.narrationVoiceGender || "auto",
    } : {}),
    format: request.format,
    typology: request.typology || "service",
    visualStyle: request.visualStyle || "brand",
    visualDirection: request.visualDirection || "auto",
    imagePurpose: request.imagePurpose || "auto",
    shotType: request.shotType || "auto",
    creativity: request.creativity || "faithful",
    imageStyle: request.imageStyle,
    peopleMode: request.peopleMode,
    useBrandColors: request.useBrandColors,
    logoMode: request.logoMode,
    imageEngine: request.kind === "image" ? request.imageEngine || "openai" : null,
    videoResolution: request.kind === "video" ? request.videoResolution || null : null,
    teamVideoProviderConsent: request.teamVideoProviderConsent || null,
    videoEngine:
      request.kind === "video"
        ? request.videoEngine ||
          (request.inputMode === "essential" &&
          request.teamVideoSpeechMode === "characters"
            ? "veo"
            : "omni")
        : null,
    teamVideoMode:
      request.kind === "video" && request.inputMode === "essential"
        ? "cinematic"
        : hasAnimationSourceImage(request.kind, request.inspirationImages)
        ? request.teamVideoMode || "montage"
        : null,
    teamVideoSpeechMode:
      request.kind === "video" &&
      (request.inputMode === "essential" ||
        (hasAnimationSourceImage(request.kind, request.inspirationImages) &&
          request.teamVideoMode === "cinematic"))
        ? request.teamVideoSpeechMode || "voiceover"
        : null,
    teamVideoVeoConsent:
      request.kind === "video" &&
      (request.identityMode || request.videoCharacterMode) ===
        "reference_team" &&
      request.teamVideoMode === "cinematic" &&
      Boolean(request.teamVideoVeoConsent),
    identityMode:
      request.peopleMode !== "none"
        ? request.identityMode || request.videoCharacterMode || "auto"
        : "auto",
    identityConsent:
      hasStrictIdentityReferences(request) && Boolean(request.identityConsent),
    identityReferenceSetId: request.inspirationImages?.length
      ? request.identityReferenceSetId || ""
      : "",
    durationSeconds:
      request.kind === "video" ? request.durationSeconds || 16 : null,
    sceneMode: request.kind === "video" ? resolveMediaGenerationSceneMode(request) : undefined,
    connectScenes: resolveMediaGenerationConnectScenes(request),
    inspirationImages: (request.inspirationImages || []).map((image) => ({
      mimeType: image.mimeType,
      length: image.data.length,
      role: image.role || null,
      usage: image.usage || null,
      characterIndex: image.characterIndex || null,
      voiceMode: request.kind === "video" && image.role === "character" ? image.voiceMode || "ai" : null,
      voiceSamplePath: request.kind === "video" && isProvidedCharacterVoice(image) ? image.voiceSample?.path || null : null,
    })),
    source: request.source,
  });
}
