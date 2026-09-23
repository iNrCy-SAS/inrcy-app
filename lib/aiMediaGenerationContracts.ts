import {
  isAiMediaNarrationVoiceVariantForGender,
  type AiMediaNarrationVoiceVariant,
} from "./aiMediaNarrationVoices.ts";
import { INR_MEDIA_IMAGE_MAX_BYTES } from "./mediaRules.ts";

export type AiMediaKind = "image" | "video";
export type AiMediaOperation = "generate" | "modify";
export type AiMediaCreationMode = "guided" | "free";
export type AiMediaSurface = "booster" | "studio";
export type AiMediaSubjectSource = "publication" | "profile" | "custom";
export type AiMediaOutputFormat = "square" | "portrait" | "story" | "landscape";
export type AiMediaTypology =
  | "company"
  | "service"
  | "advice"
  | "showcase"
  | "offer"
  | "event"
  | "behind_scenes"
  | "recruitment";
export type AiMediaVisualStyle =
  | "brand"
  | "clean"
  | "premium"
  | "warm"
  | "dynamic"
  | "expert"
  | "local"
  | "colorful";
/** Intention visuelle choisie explicitement dans iNrStudio. */
export type AiMediaVisualDirection =
  | "auto"
  | "clean"
  | "premium"
  | "warm"
  | "dynamic"
  | "bold";
/** Type de composition image demandé explicitement dans iNrStudio. */
export type AiMediaImagePurpose =
  | "auto"
  | "simple"
  | "social"
  | "flyer"
  | "product_sheet"
  | "poster"
  | "banner"
  | "infographic";
export type AiMediaImageStyle =
  | "photo"
  | "illustration"
  | "three_d"
  | "graphic";
export type AiMediaShotType = "auto" | "close" | "medium" | "wide";
export type AiMediaPeopleMode = "auto" | "none" | "solo" | "team";
export type AiMediaCreativity = "faithful" | "bold";
export type AiMediaLogoMode = "discreet" | "visible" | "none";
export type AiMediaVideoDuration = 8 | 16 | 24;
export type AiMediaVideoSceneMode = "single" | "multi";
export type AiMediaVideoEngine = "omni" | "veo";
export type AiMediaTeamVideoMode = "cinematic" | "montage";
export type AiMediaTeamVideoSpeechMode = "voiceover" | "characters";
export type AiMediaNarrationVoice = "female" | "male";
export type AiMediaInputMode = "legacy" | "essential";
export type AiMediaTextMode = "none" | "ai" | "exact";
/** Parcours créatif explicite de Générer ; Modifier n'en consomme aucun. */
export type AiMediaGenerationMode =
  | "ai_free"
  | "ai_criteria"
  | "inspiration";
export type AiMediaPeopleCriterion =
  | "auto"
  | "none"
  | "one"
  | "two"
  | "three"
  | "group";
export type AiMediaSettingCriterion =
  | "auto"
  | "interior"
  | "exterior"
  | "studio"
  | "neutral";
export type AiMediaFocusCriterion =
  | "auto"
  | "people"
  | "product"
  | "environment";
export type AiMediaReferenceRole =
  | "character"
  | "environment"
  | "product"
  | "inspiration";
export type AiMediaReferenceUsage = "required" | "inspiration";
export type { AiMediaNarrationVoiceVariant } from "./aiMediaNarrationVoices.ts";
export type AiMediaIdentityMode =
  | "auto"
  | "professional"
  | "brand_avatar"
  | "reference_team";
/** @deprecated Nom historique conservé pour les anciens appelants vidéo. */
export type AiMediaVideoCharacterMode = AiMediaIdentityMode;
export type AiMediaInspirationImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  /** Octets de l'image encodes en base64, sans prefixe data:. */
  data: string;
  /** Rôle explicite de la référence dans la nouvelle scène à composer. */
  role?: AiMediaReferenceRole;
  /** Contrainte obligatoire ou simple source d'inspiration non fidèle. */
  usage?: AiMediaReferenceUsage;
  /** Index stable du média Personnage ; un média peut contenir une ou plusieurs personnes. */
  characterIndex?: 1 | 2 | 3;
};

export const AI_MEDIA_INSPIRATION_MAX_COUNT = 5;
export const AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES = INR_MEDIA_IMAGE_MAX_BYTES;
export const AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES = 560_000;
export const AI_MEDIA_INSPIRATION_MAX_DIMENSION = 1_280;
export const AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS = 800_000;
/** Limite propre au brief de Modifier Image, de l'interface au fournisseur. */
export const AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS = 1_200;
export const AI_MEDIA_FREE_PROMPT_MAX_CHARS = 4_000;

export type AiMediaFormatSpec = {
  format: AiMediaOutputFormat;
  label: string;
  aspectRatio: "1:1" | "4:5" | "9:16" | "16:9";
  width: number;
  height: number;
  generationSize: "1024x1024" | "1024x1536" | "1536x1024";
};

export const AI_MEDIA_FORMAT_SPECS: Record<
  AiMediaOutputFormat,
  AiMediaFormatSpec
> = {
  square: {
    format: "square",
    label: "Carré",
    aspectRatio: "1:1",
    width: 1080,
    height: 1080,
    generationSize: "1024x1024",
  },
  portrait: {
    format: "portrait",
    label: "Portrait",
    aspectRatio: "4:5",
    width: 1080,
    height: 1350,
    generationSize: "1024x1536",
  },
  story: {
    format: "story",
    label: "Story / Reel",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    generationSize: "1024x1536",
  },
  landscape: {
    format: "landscape",
    label: "Paysage",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    generationSize: "1536x1024",
  },
};

/**
 * Choisit le cadre d'aperçu qui correspond au fichier réellement produit.
 * Le format demandé reste le repli autoritaire lorsque les dimensions ne sont
 * pas encore disponibles (ancien média, métadonnées en cours d'extraction).
 */
export function resolveAiMediaPreviewFormat(args: {
  width: number | null | undefined;
  height: number | null | undefined;
  fallback: AiMediaOutputFormat;
}): AiMediaOutputFormat {
  const width = Number(args.width);
  const height = Number(args.height);
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return args.fallback;
  }

  const measuredRatio = width / height;
  const formats = Object.values(AI_MEDIA_FORMAT_SPECS);
  return formats.reduce((closest, candidate) => {
    const closestRatio = closest.width / closest.height;
    const candidateRatio = candidate.width / candidate.height;
    const closestDistance = Math.abs(Math.log(measuredRatio / closestRatio));
    const candidateDistance = Math.abs(
      Math.log(measuredRatio / candidateRatio)
    );
    return candidateDistance < closestDistance ? candidate : closest;
  }, AI_MEDIA_FORMAT_SPECS[args.fallback]).format;
}

export type AiMediaGenerationRequest = {
  requestId: string;
  /** Independent free-form creative path; never the legacy `ai_free` casting option. */
  creationMode?: AiMediaCreationMode;
  freePrompt?: string;
  /** `modify` conserve une image source et applique uniquement la consigne. */
  operation?: AiMediaOperation;
  /** Le Studio essentiel omet les anciens réglages décoratifs du payload. */
  inputMode?: AiMediaInputMode;
  /** Contrat de composition de Générer, distinct des références de Modifier. */
  generationMode: AiMediaGenerationMode;
  /** Critères structurés, actifs uniquement avec `generationMode=ai_criteria`. */
  peopleCriterion: AiMediaPeopleCriterion;
  settingCriterion: AiMediaSettingCriterion;
  focusCriterion: AiMediaFocusCriterion;
  /** Dimensions orientées du canvas autoritaire, exclusivement pour `modify`. */
  modificationSourceWidth?: number | null;
  modificationSourceHeight?: number | null;
  kind: AiMediaKind;
  subjectSource: AiMediaSubjectSource;
  idea: string;
  /** Consigne ponctuelle facultative, appliquée à cette génération uniquement. */
  aiInstruction: string;
  /** Politique du texte visible. Toujours normalisée sur les nouvelles requêtes. */
  textMode?: AiMediaTextMode;
  /** Texte utilisateur à composer sans reformulation lorsque `textMode=exact`. */
  exactText?: string;
  withText: boolean;
  textKeywords: string[];
  withMusic: boolean;
  withNarration: boolean;
  narrationVoice: AiMediaNarrationVoice | null;
  narrationVoiceVariant: AiMediaNarrationVoiceVariant | null;
  format: AiMediaOutputFormat;
  typology: AiMediaTypology;
  visualStyle: AiMediaVisualStyle;
  /** Contrat Studio structuré, distinct de la consigne libre. */
  visualDirection: AiMediaVisualDirection;
  /** Contrat Studio structuré, actif uniquement pour une image. */
  imagePurpose: AiMediaImagePurpose;
  imageStyle: AiMediaImageStyle;
  shotType: AiMediaShotType;
  peopleMode: AiMediaPeopleMode;
  creativity: AiMediaCreativity;
  useBrandColors: boolean;
  logoMode: AiMediaLogoMode;
  videoEngine: AiMediaVideoEngine | null;
  identityMode: AiMediaIdentityMode;
  /** @deprecated Alias de compatibilité pour les anciennes générations vidéo. */
  videoCharacterMode: AiMediaVideoCharacterMode;
  /** Accord ponctuel, jamais réutilisé pour une autre génération. */
  identityConsent: boolean;
  /**
   * Rendu demandé pour une identité de référence. `cinematic` demande de vrais
   * mouvements ; une équipe exige en plus le consentement Google ponctuel.
   */
  teamVideoMode: AiMediaTeamVideoMode;
  /**
   * `characters` conserve les dialogues natifs synchronisés du moteur vidéo.
   * `voiceover` garde les personnes silencieuses et autorise la narration iNrCy.
   */
  teamVideoSpeechMode: AiMediaTeamVideoSpeechMode;
  /** Accord ponctuel pour transmettre à Google la seule image de groupe déjà composée. */
  teamVideoVeoConsent: boolean;
  /** Identifiant aléatoire du jeu de références, jamais dérivé de leur contenu. */
  identityReferenceSetId: string;
  durationSeconds: AiMediaVideoDuration | null;
  /** Contrat produit explicite ; `connectScenes` reste l'alias moteur historique. */
  sceneMode?: AiMediaVideoSceneMode;
  /** Opt-in: chain generated scenes from the preceding frame; otherwise render in parallel. */
  connectScenes: boolean;
  inspirationImages: AiMediaInspirationImage[];
  source: AiMediaSurface;
};

const AI_MEDIA_VISIBLE_TEXT_NEGATION =
  /\b(?:sans|aucun(?:e)?|pas\s+de)\s+(?:texte|titre|prix|tarif|montant|mot|lettre|chiffre|slogan|accroche)\b/i;
const AI_MEDIA_VISIBLE_TEXT_REQUEST =
  /\b(?:affich(?:e|er|ez)|[ée]cri(?:re|vez)|inscri(?:re|vez)|mentionn(?:e|er|ez)|texte|titre|sous[- ]?titre|accroche|slogan|cta|appel\s+[àa]\s+l['’]action|prix|tarif|montant|pack|forfait|formule|abonnement|promotion|promo|remise|comparatif|comparer)\b/i;
const AI_MEDIA_COMMERCIAL_VALUE =
  /(?:\b\d{1,4}(?:[.,]\d{1,2})?\s*(?:€|euros?|%|jours?|mois|ans?)\b|\b(?:prix|tarif|montant)\s*[:=]?\s*\d)/i;

/**
 * Détecte un brief qui exige explicitement des informations lisibles. Cette
 * décision produit est partagée par l'UI et le serveur : aucun prix, pack ou
 * texte demandé ne peut ainsi disparaître silencieusement en mode sans texte.
 */
export function aiMediaBriefRequestsVisibleText(args: {
  kind: AiMediaKind;
  imagePurpose?: AiMediaImagePurpose | null;
  idea?: unknown;
  aiInstruction?: unknown;
}) {
  if (args.kind !== "image") return false;
  const brief = [args.idea, args.aiInstruction]
    .map((value) => String(value || "").normalize("NFKC").trim())
    .filter(Boolean)
    .join(" ");
  if (!brief || AI_MEDIA_VISIBLE_TEXT_NEGATION.test(brief)) return false;
  const asksForVisibleCopy = AI_MEDIA_VISIBLE_TEXT_REQUEST.test(brief);
  const includesCommercialValue = AI_MEDIA_COMMERCIAL_VALUE.test(brief);
  const isCommercialGraphic = [
    "flyer",
    "product_sheet",
    "poster",
    "banner",
    "infographic",
  ].includes(args.imagePurpose || "auto");
  return asksForVisibleCopy && (includesCommercialValue || isCommercialGraphic);
}

export type AiMediaLibraryPickerItem = {
  id: string;
  bucket_name: string | null;
  storage_path: string;
  original_file_name?: string | null;
  media_type: AiMediaKind;
  mime_type: string | null;
  size_bytes: number | null;
  title: string | null;
  tags: string[] | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string | null;
  signed_url: string | null;
};

export type AiMediaSoundtrackResponse = {
  id: string;
  name: string;
};

export class AiMediaRequestValidationError extends Error {
  code = "invalid_ai_media_request" as const;

  constructor(message: string) {
    super(message);
    this.name = "AiMediaRequestValidationError";
  }
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}

function normalizeAiInstruction(
  value: unknown,
  max = 2_400,
  rejectOverflow = false
) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (rejectOverflow && normalized.length > max) {
    throw new AiMediaRequestValidationError(
      `La consigne de modification ne peut pas dépasser ${max.toLocaleString("fr-FR")} caractères.`
    );
  }
  return normalized.slice(0, max);
}

function readRequestId(value: unknown) {
  const id = cleanText(value, 180);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/.test(id)) {
    throw new AiMediaRequestValidationError(
      "Identifiant de génération invalide. Merci de relancer la création."
    );
  }
  return id;
}

function readModificationSourceDimension(
  value: unknown,
  label: "largeur" | "hauteur"
) {
  const dimension = Number(value);
  if (
    !Number.isInteger(dimension) ||
    dimension < 1 ||
    dimension > 32_768
  ) {
    throw new AiMediaRequestValidationError(
      `La ${label} de l’image source est invalide.`
    );
  }
  return dimension;
}

function normalizeTextKeywords(value: unknown) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split(/[,;\n]+/)
    : [];
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of rawValues) {
    const keyword = cleanText(rawValue, 48)
      .replace(/\s+/g, " ")
      .replace(/^[#,;\s]+|[#,;\s]+$/g, "")
      .trim();
    if (keyword.length < 2) continue;
    const comparable = keyword.toLocaleLowerCase();
    if (seen.has(comparable)) continue;
    seen.add(comparable);
    keywords.push(keyword);
    if (keywords.length >= 6) break;
  }
  return keywords;
}

function normalizeInspirationImages(
  value: unknown,
  inputMode: AiMediaInputMode
): AiMediaInspirationImage[] {
  if (
    value === null ||
    typeof value === "undefined" ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.length > AI_MEDIA_INSPIRATION_MAX_COUNT) {
    throw new AiMediaRequestValidationError(
      "Ajoutez entre une et cinq images de référence."
    );
  }
  const normalized = values.map((candidate) => {
    const source =
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : null;
    const mimeType = String(source?.mimeType ?? "")
      .trim()
      .toLowerCase();
    if (
      !(["image/jpeg", "image/png", "image/webp"] as string[]).includes(
        mimeType
      )
    ) {
      throw new AiMediaRequestValidationError(
        "Format d’image d’inspiration invalide. Utilisez JPG, PNG ou WebP."
      );
    }
    const data = typeof source?.data === "string" ? source.data.trim() : "";
    if (
      data.length < 64 ||
      data.length > AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    ) {
      throw new AiMediaRequestValidationError(
        "Une image d’inspiration est invalide ou trop volumineuse."
      );
    }
    const rawRole = cleanText(source?.role, 24);
    if (
      rawRole &&
      !(["character", "environment", "product", "inspiration"] as string[]).includes(rawRole)
    ) {
      throw new AiMediaRequestValidationError("Rôle de référence invalide.");
    }
    if (inputMode === "essential" && !rawRole) {
      throw new AiMediaRequestValidationError(
        "Chaque média doit être identifié comme personnage, décor, produit ou inspiration."
      );
    }
    const rawUsage = cleanText(source?.usage, 24);
    if (
      rawUsage &&
      !(["required", "inspiration"] as string[]).includes(rawUsage)
    ) {
      throw new AiMediaRequestValidationError(
        "Usage de référence invalide."
      );
    }
    // Compatibilité : les rôles structurés historiques étaient déjà choisis
    // comme des contraintes. Le rôle `inspiration` reste, lui, non fidèle.
    const usage = (rawUsage ||
      (rawRole && rawRole !== "inspiration"
        ? "required"
        : "inspiration")) as AiMediaReferenceUsage;
    const characterIndex = Number(source?.characterIndex);
    if (
      rawRole === "character" &&
      !([1, 2, 3] as number[]).includes(characterIndex)
    ) {
      throw new AiMediaRequestValidationError(
        "Chaque média Personnage doit avoir un emplacement numéroté."
      );
    }
    return {
      mimeType: mimeType as AiMediaInspirationImage["mimeType"],
      data,
      ...(rawRole ? { role: rawRole as AiMediaReferenceRole } : {}),
      usage,
      ...(rawRole === "character"
        ? { characterIndex: characterIndex as 1 | 2 | 3 }
        : {}),
    };
  });

  if (inputMode === "essential") {
    const characterIndexes = normalized
      .filter((image) => image.role === "character")
      .map((image) => image.characterIndex);
    if (new Set(characterIndexes).size !== characterIndexes.length) {
      throw new AiMediaRequestValidationError(
        "Chaque média Personnage doit occuper un emplacement distinct."
      );
    }
    for (const singletonRole of ["environment", "product"] as const) {
      if (
        normalized.filter((image) => image.role === singletonRole).length > 1
      ) {
        throw new AiMediaRequestValidationError(
          singletonRole === "environment"
            ? "Ajoutez un seul décor de référence."
            : "Ajoutez un seul produit de référence."
        );
      }
    }
  }
  return normalized;
}

export function normalizeAiMediaGenerationRequest(
  value: unknown
): AiMediaGenerationRequest {
  let body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!body) {
    throw new AiMediaRequestValidationError("Demande de média invalide.");
  }

  if (body.creationMode !== undefined && !["guided", "free"].includes(String(body.creationMode))) {
    throw new AiMediaRequestValidationError("Parcours de création invalide.");
  }
  const creationMode: AiMediaCreationMode = body.creationMode === "free" ? "free" : "guided";
  let freePrompt = "";
  if (creationMode === "free") {
    if (body.operation === "modify" || body.source !== "studio") {
      throw new AiMediaRequestValidationError("Le mode Libre est disponible dans Générer du Studio.");
    }
    if (typeof body.freePrompt !== "string" || body.freePrompt.length > AI_MEDIA_FREE_PROMPT_MAX_CHARS) {
      throw new AiMediaRequestValidationError(`Décrivez votre média en ${AI_MEDIA_FREE_PROMPT_MAX_CHARS.toLocaleString("fr-FR")} caractères maximum.`);
    }
    freePrompt = normalizeAiInstruction(body.freePrompt, AI_MEDIA_FREE_PROMPT_MAX_CHARS);
    if (freePrompt.length < 3) {
      throw new AiMediaRequestValidationError("Décrivez le média souhaité avant de générer.");
    }
    // Whitelist free controls. Hidden guided state must not influence a free
    // creation, including text grids, commercial defaults and stale casting.
    body = {
      requestId: body.requestId, operation: "generate", source: "studio",
      inputMode: "essential", kind: body.kind, format: body.format,
      subjectSource: "custom", idea: freePrompt.slice(0, 2_000),
      inspirationImages: body.inspirationImages,
      identityReferenceSetId: body.identityReferenceSetId,
      identityConsent: body.identityConsent,
      teamVideoVeoConsent: body.teamVideoVeoConsent,
      durationSeconds: body.durationSeconds, sceneMode: body.sceneMode,
      connectScenes: body.connectScenes,
      withMusic: body.withMusic,
      withNarration: body.teamVideoSpeechMode === "characters" ? false : body.withNarration,
      narrationVoice: body.narrationVoice, narrationVoiceVariant: body.narrationVoiceVariant,
      videoEngine: "omni", teamVideoMode: "cinematic",
      teamVideoSpeechMode: body.teamVideoSpeechMode,
      useBrandColors: false, logoMode: "none", textMode: "none",
    };
  }

  const requestId = readRequestId(body.requestId);
  const inputMode: AiMediaInputMode =
    body.inputMode === "essential" ? "essential" : "legacy";
  const operation: AiMediaOperation =
    body.operation === "modify" ? "modify" : "generate";

  const kind =
    body.kind === "image" || body.kind === "video" ? body.kind : null;
  if (!kind) {
    throw new AiMediaRequestValidationError("Type de média invalide.");
  }

  const source =
    body.source === "booster" || body.source === "studio" ? body.source : null;
  if (!source) {
    throw new AiMediaRequestValidationError("Origine de génération invalide.");
  }

  const rawIdea = cleanText(body.idea, 2_000);
  const rawSubjectSource = cleanText(body.subjectSource, 40);
  if (
    rawSubjectSource &&
    !["publication", "profile", "custom"].includes(rawSubjectSource)
  ) {
    throw new AiMediaRequestValidationError("Source du sujet invalide.");
  }
  const subjectSource = (rawSubjectSource ||
    (rawIdea ? "custom" : "profile")) as AiMediaSubjectSource;
  // En génération, le brief écrit par le professionnel reste prioritaire
  // quelle que soit sa source. L'ADN n'est qu'un contexte : il ne doit jamais
  // effacer une demande explicite envoyée avec `subjectSource: profile`.
  // Le mode `modify`, lui, conserve son contrat minimal source + consigne.
  const idea = operation === "modify" ? "" : rawIdea;
  if (
    operation !== "modify" &&
    subjectSource !== "profile" &&
    idea.length < 3
  ) {
    throw new AiMediaRequestValidationError(
      "Décrivez votre idée en quelques mots avant de générer le média."
    );
  }
  const aiInstruction = normalizeAiInstruction(
    body.aiInstruction,
    operation === "modify"
      ? AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS
      : 2_400,
    operation === "modify"
  );
  if (operation === "modify" && kind !== "image") {
    throw new AiMediaRequestValidationError(
      "La modification IA accepte uniquement une image pour le moment."
    );
  }
  if (operation === "modify" && aiInstruction.length < 3) {
    throw new AiMediaRequestValidationError(
      "Décrivez la modification à appliquer à l’image."
    );
  }
  const modificationSourceWidth =
    operation === "modify"
      ? readModificationSourceDimension(
          body.modificationSourceWidth,
          "largeur"
        )
      : null;
  const modificationSourceHeight =
    operation === "modify"
      ? readModificationSourceDimension(
          body.modificationSourceHeight,
          "hauteur"
        )
      : null;

  const format = cleanText(body.format, 30) || "square";
  if (!(format in AI_MEDIA_FORMAT_SPECS)) {
    throw new AiMediaRequestValidationError("Format de média invalide.");
  }

  const typology = cleanText(body.typology, 40) || "service";
  if (
    ![
      "company",
      "service",
      "advice",
      "showcase",
      "offer",
      "event",
      "behind_scenes",
      "recruitment",
    ].includes(typology)
  ) {
    throw new AiMediaRequestValidationError("Type de contenu invalide.");
  }

  const visualStyle = cleanText(body.visualStyle, 40) || "brand";
  if (
    ![
      "brand",
      "clean",
      "premium",
      "warm",
      "dynamic",
      "expert",
      "local",
      "colorful",
    ].includes(visualStyle)
  ) {
    throw new AiMediaRequestValidationError("Style visuel invalide.");
  }

  const rawVisualDirection = cleanText(body.visualDirection, 40) || "auto";
  if (
    !["auto", "clean", "premium", "warm", "dynamic", "bold"].includes(
      rawVisualDirection
    )
  ) {
    throw new AiMediaRequestValidationError("Direction visuelle invalide.");
  }
  const visualDirection = rawVisualDirection as AiMediaVisualDirection;

  const rawImagePurpose = cleanText(body.imagePurpose, 40) || "auto";
  if (
    ![
      "auto",
      "simple",
      "social",
      "flyer",
      "product_sheet",
      "poster",
      "banner",
      "infographic",
    ].includes(rawImagePurpose)
  ) {
    throw new AiMediaRequestValidationError("Type de création image invalide.");
  }
  const imagePurpose =
    kind === "image" ? (rawImagePurpose as AiMediaImagePurpose) : "auto";

  const imageStyle = cleanText(body.imageStyle, 40) || "photo";
  if (!["photo", "illustration", "three_d", "graphic"].includes(imageStyle)) {
    throw new AiMediaRequestValidationError("Type de rendu invalide.");
  }

  const shotType = cleanText(body.shotType, 40) || "auto";
  if (!["auto", "close", "medium", "wide"].includes(shotType)) {
    throw new AiMediaRequestValidationError("Cadrage invalide.");
  }

  let peopleMode = cleanText(body.peopleMode, 40) || "auto";
  if (!["auto", "none", "solo", "team"].includes(peopleMode)) {
    throw new AiMediaRequestValidationError("Présence humaine invalide.");
  }

  const creativity = cleanText(body.creativity, 40) || "faithful";
  if (!["faithful", "bold"].includes(creativity)) {
    throw new AiMediaRequestValidationError("Niveau de créativité invalide.");
  }

  const logoMode = operation === "modify" ? "none" : cleanText(body.logoMode, 40) || "discreet";
  if (!["discreet", "visible", "none"].includes(logoMode)) {
    throw new AiMediaRequestValidationError("Présence du logo invalide.");
  }

  const requestedDuration = Number(body.durationSeconds || 16);
  if (
    body.connectScenes !== undefined &&
    typeof body.connectScenes !== "boolean"
  ) {
    throw new AiMediaRequestValidationError(
      "L’option de raccord des scènes est invalide."
    );
  }
  if (kind === "video" && ![8, 16, 24].includes(requestedDuration)) {
    throw new AiMediaRequestValidationError(
      "Durée vidéo invalide : choisissez 8, 16 ou 24 secondes."
    );
  }
  const rawSceneMode = cleanText(body.sceneMode, 24);
  if (rawSceneMode && !["single", "multi"].includes(rawSceneMode)) {
    throw new AiMediaRequestValidationError("Mode de scènes invalide.");
  }
  // Produit : `single` désigne une séquence continue raccordée sur plusieurs
  // segments de 8 s ; `multi` assemble des plans indépendants. Le booléen
  // historique est conservé comme alias moteur pour les anciens clients.
  const normalizedRequestedSceneMode: AiMediaVideoSceneMode =
    kind !== "video" || requestedDuration <= 8
      ? "single"
      : rawSceneMode
      ? (rawSceneMode as AiMediaVideoSceneMode)
      : body.connectScenes === true
      ? "single"
      : "multi";
  const requestedSceneConnection =
    kind === "video" &&
    requestedDuration > 8 &&
    normalizedRequestedSceneMode === "single";

  // Modifier has only a source canvas and an instruction. Generation controls
  // must not add a slogan, exact-text overlay or branding after the edit.
  const rawTextMode = operation === "modify" ? "none" : cleanText(body.textMode, 24);
  if (rawTextMode && !["none", "ai", "exact"].includes(rawTextMode)) {
    throw new AiMediaRequestValidationError("Mode de texte invalide.");
  }
  const normalizedTextKeywords = normalizeTextKeywords(body.textKeywords);
  const exactText = cleanText(body.exactText, 600);
  // Les anciens clients n'envoient que `withText`. Une demande vraiment
  // guidée reste compatible ; un simple booléen sur un brief ADN vide ne doit
  // plus forcer une accroche générique et répétitive.
  const inferredTextMode: AiMediaTextMode =
    body.withText === true &&
    Boolean(rawIdea || aiInstruction || normalizedTextKeywords.length)
      ? "ai"
      : "none";
  const textMode = (rawTextMode || inferredTextMode) as AiMediaTextMode;
  if (textMode === "exact" && exactText.length < 1) {
    throw new AiMediaRequestValidationError(
      "Saisissez le texte exact à afficher."
    );
  }
  if (
    operation === "generate" &&
    creationMode !== "free" &&
    source === "studio" &&
    textMode === "none" &&
    aiMediaBriefRequestsVisibleText({
      kind,
      imagePurpose,
      idea,
      aiInstruction,
    })
  ) {
    throw new AiMediaRequestValidationError(
      "Votre brief demande du texte visible. Choisissez « Texte rédigé par l’IA » ou « Texte exact » avant de générer."
    );
  }
  const withText = textMode !== "none";
  const requestedWithNarration =
    kind === "video" && body.withNarration === true;
  const rawNarrationVoice = cleanText(body.narrationVoice, 24) || "female";
  if (
    kind === "video" &&
    requestedWithNarration &&
    !["female", "male"].includes(rawNarrationVoice)
  ) {
    throw new AiMediaRequestValidationError("Voix de narration invalide.");
  }
  const rawNarrationVoiceVariant = cleanText(body.narrationVoiceVariant, 24);
  if (
    kind === "video" &&
    requestedWithNarration &&
    rawNarrationVoiceVariant &&
    !isAiMediaNarrationVoiceVariantForGender(
      rawNarrationVoiceVariant,
      rawNarrationVoice as AiMediaNarrationVoice
    )
  ) {
    throw new AiMediaRequestValidationError(
      "Variante de voix de narration invalide."
    );
  }
  const rawVideoEngine =
    cleanText(body.videoEngine, 24) ||
    (inputMode === "essential" && body.teamVideoSpeechMode === "characters"
      ? "veo"
      : "omni");
  if (kind === "video" && !["omni", "veo"].includes(rawVideoEngine)) {
    throw new AiMediaRequestValidationError("Moteur vidéo invalide.");
  }
  // Le rôle et l'usage sont normalisés avant l'identité : une référence de
  // personnage marquée obligatoire doit activer la fidélité même si un ancien
  // client simplifié envoie encore `identityMode: auto`.
  let inspirationImages = normalizeInspirationImages(
    body.inspirationImages,
    inputMode
  );
  if (
    operation === "modify" &&
    (inspirationImages.length !== 1 ||
      inspirationImages[0]?.role !== "inspiration")
  ) {
    throw new AiMediaRequestValidationError(
      "Ajoutez une seule image source avant de lancer la modification."
    );
  }
  const rawGenerationMode = cleanText(body.generationMode, 32);
  if (
    rawGenerationMode &&
    !["ai_free", "ai_criteria", "inspiration"].includes(rawGenerationMode)
  ) {
    throw new AiMediaRequestValidationError("Mode de génération invalide.");
  }
  const rawPeopleCriterion = cleanText(body.peopleCriterion, 24) || "auto";
  if (
    !["auto", "none", "one", "two", "three", "group"].includes(
      rawPeopleCriterion
    )
  ) {
    throw new AiMediaRequestValidationError("Critère de personnages invalide.");
  }
  const rawSettingCriterion = cleanText(body.settingCriterion, 24) || "auto";
  if (
    !["auto", "interior", "exterior", "studio", "neutral"].includes(
      rawSettingCriterion
    )
  ) {
    throw new AiMediaRequestValidationError("Critère de décor invalide.");
  }
  const rawFocusCriterion = cleanText(body.focusCriterion, 24) || "auto";
  if (
    !["auto", "people", "product", "environment"].includes(
      rawFocusCriterion
    )
  ) {
    throw new AiMediaRequestValidationError("Critère de priorité invalide.");
  }
  const hasExplicitGenerationMode = Boolean(rawGenerationMode);
  const inferredGenerationMode: AiMediaGenerationMode = inspirationImages.length
    ? "inspiration"
    : rawPeopleCriterion !== "auto" ||
      rawSettingCriterion !== "auto" ||
      rawFocusCriterion !== "auto"
    ? "ai_criteria"
    : "ai_free";
  const generationMode: AiMediaGenerationMode =
    operation === "modify"
      ? "ai_free"
      : ((rawGenerationMode || inferredGenerationMode) as AiMediaGenerationMode);
  if (
    operation === "generate" &&
    hasExplicitGenerationMode &&
    generationMode === "inspiration" &&
    inspirationImages.length === 0
  ) {
    throw new AiMediaRequestValidationError(
      "Ajoutez au moins une référence pour utiliser le mode Inspiration."
    );
  }
  if (
    operation === "generate" &&
    hasExplicitGenerationMode &&
    generationMode !== "inspiration" &&
    inspirationImages.length > 0
  ) {
    throw new AiMediaRequestValidationError(
      "Sélectionnez le mode Inspiration pour utiliser des références."
    );
  }
  const peopleCriterion =
    generationMode === "ai_criteria"
      ? (rawPeopleCriterion as AiMediaPeopleCriterion)
      : "auto";
  const settingCriterion =
    generationMode === "ai_criteria"
      ? (rawSettingCriterion as AiMediaSettingCriterion)
      : "auto";
  const focusCriterion =
    generationMode === "ai_criteria" &&
    !(peopleCriterion === "none" && rawFocusCriterion === "people")
      ? (rawFocusCriterion as AiMediaFocusCriterion)
      : "auto";
  if (generationMode === "ai_criteria") {
    peopleMode =
      peopleCriterion === "none"
        ? "none"
        : peopleCriterion === "one"
        ? "solo"
        : peopleCriterion === "two" ||
          peopleCriterion === "three" ||
          peopleCriterion === "group"
        ? "team"
        : peopleMode;
  } else if (hasExplicitGenerationMode && generationMode === "ai_free") {
    // Le mode IA libre ne reçoit jamais une contrainte de casting résiduelle.
    peopleMode = "auto";
  }
  const rawIdentityMode =
    cleanText(body.identityMode ?? body.videoCharacterMode, 32) || "auto";
  if (
    !["auto", "professional", "brand_avatar", "reference_team"].includes(
      rawIdentityMode
    )
  ) {
    throw new AiMediaRequestValidationError("Mode d’identité invalide.");
  }
  // Une modification part de son image source ; elle ne déclare jamais cette
  // image comme référence d'identité pour une nouvelle composition.
  const requestedIdentityMode: AiMediaIdentityMode =
    operation === "modify" ? "auto" : (rawIdentityMode as AiMediaIdentityMode);
  // Migration des anciens payloads : le mode biométrique explicite donnait
  // autrefois son sens à des références sans rôle. On les transforme ici en
  // vrai couple rôle+usage ; en aval, aucune référence non structurée ou
  // marquée `inspiration` ne peut activer silencieusement la fidélité.
  if (inputMode === "legacy" && requestedIdentityMode !== "auto") {
    let legacyCharacterIndex = 0;
    inspirationImages = inspirationImages.map((image) => {
      if (image.role) return image;
      legacyCharacterIndex += 1;
      return {
        ...image,
        role: "character" as const,
        usage: "required" as const,
        characterIndex: Math.min(legacyCharacterIndex, 3) as 1 | 2 | 3,
      };
    });
  }
  const requiredCharacterReferences = inspirationImages.filter(
    (image) => image.role === "character" && image.usage === "required"
  );
  const requiredIdentityMode: AiMediaIdentityMode | null =
    requiredCharacterReferences.length >= 2
      ? "reference_team"
      : requiredCharacterReferences.length === 1
      ? "professional"
      : null;
  const identityMode = requiredIdentityMode
    ? requiredIdentityMode
    : requestedIdentityMode === "reference_team"
    ? "reference_team"
    : peopleMode !== "none"
    ? requestedIdentityMode
    : "auto";
  // Une équipe de référence décrit plusieurs adultes distincts : ce mode est
  // toujours ramené à une scène d'équipe, même si un ancien client envoie
  // encore `auto` ou `solo` pour la présence humaine.
  const normalizedPeopleMode =
    identityMode === "reference_team"
      ? "team"
      : requiredIdentityMode === "professional"
      ? "auto"
      : peopleMode;
  const characterReferences = inspirationImages.filter(
    (image) => image.role === "character" && image.usage === "required"
  );
  if (
    identityMode === "professional" &&
    (characterReferences.length === 0 ||
      (inputMode === "essential" && characterReferences.length !== 1))
  ) {
    throw new AiMediaRequestValidationError(
      "Ajoutez une photo du professionnel distincte pour guider son identité."
    );
  }
  if (identityMode === "brand_avatar" && characterReferences.length === 0) {
    throw new AiMediaRequestValidationError(
      "Ajoutez au moins un dessin d’avatar ou une photo autorisée à transformer."
    );
  }
  if (
    identityMode === "reference_team" &&
    (characterReferences.length < 2 || characterReferences.length > 3)
  ) {
    throw new AiMediaRequestValidationError(
      "Ajoutez deux ou trois photos, avec une personne adulte distincte et autorisée par image."
    );
  }
  // L'accord biométrique ne concerne que les modes qui demandent réellement
  // de préserver l'identité d'une personne. Une image de décor, de produit ou
  // d'ambiance en mode automatique reste une inspiration visuelle ordinaire.
  const strictIdentityReferenceRequested =
    identityMode !== "auto" && characterReferences.length > 0;
  if (strictIdentityReferenceRequested && body.identityConsent !== true) {
    throw new AiMediaRequestValidationError(
      "Confirmez que chaque personne identifiable est majeure et vous a autorisé à utiliser son image."
    );
  }
  const rawTeamVideoMode =
    cleanText(body.teamVideoMode, 24) ||
    (inputMode === "essential" ? "cinematic" : "montage");
  if (!["cinematic", "montage"].includes(rawTeamVideoMode)) {
    throw new AiMediaRequestValidationError(
      "Mode d’animation des personnages invalide."
    );
  }
  // Le geste explicite « animer » porte sur l'image ajoutée, quel que soit le
  // libellé d'identité choisi dans l'interface (générique, pro, avatar, équipe).
  const identityAnimationSupported = inspirationImages.length > 0;
  const teamVideoMode =
    kind === "video" &&
    (identityAnimationSupported || inputMode === "essential")
      ? (rawTeamVideoMode as AiMediaTeamVideoMode)
      : "montage";
  const rawTeamVideoSpeechMode =
    cleanText(body.teamVideoSpeechMode, 24) || "voiceover";
  if (!["voiceover", "characters"].includes(rawTeamVideoSpeechMode)) {
    throw new AiMediaRequestValidationError(
      "Mode vocal des personnages animés invalide."
    );
  }
  const teamVideoSpeechMode =
    teamVideoMode === "cinematic"
      ? (rawTeamVideoSpeechMode as AiMediaTeamVideoSpeechMode)
      : "voiceover";
  // Les dialogues natifs Veo et une voix off synthétique ne doivent jamais se
  // superposer. En mode personnages, l'audio applicatif est neutralisé au
  // contrat, avant même de démarrer le pipeline de narration.
  const withNarration =
    requestedWithNarration && teamVideoSpeechMode !== "characters";
  // Le consentement est volontairement lié à cette requête, à ce mode et à
  // cette destination. Un booléen isolé sur une image ou un autre mode ne peut
  // jamais ouvrir un egress Google par accident.
  const teamVideoVeoConsent =
    identityMode === "reference_team" &&
    teamVideoMode === "cinematic" &&
    body.teamVideoVeoConsent === true;
  if (
    inputMode === "essential" &&
    kind === "video" &&
    identityMode === "reference_team" &&
    !teamVideoVeoConsent
  ) {
    throw new AiMediaRequestValidationError(
      "Confirmez l’animation de la scène composée avec ces personnages."
    );
  }
  const connectScenes = shouldConnectAiMediaVideoScenes({
    kind,
    durationSeconds: requestedDuration,
    connectScenes: requestedSceneConnection,
    identityMode,
    peopleMode: normalizedPeopleMode,
    teamVideoMode,
  });
  const sceneMode = normalizedRequestedSceneMode;

  return {
    requestId,
    creationMode,
    freePrompt: creationMode === "free" ? freePrompt : undefined,
    operation,
    inputMode,
    generationMode,
    peopleCriterion,
    settingCriterion,
    focusCriterion,
    modificationSourceWidth,
    modificationSourceHeight,
    kind,
    subjectSource,
    idea,
    aiInstruction,
    textMode,
    exactText: textMode === "exact" ? exactText : "",
    withText,
    textKeywords: textMode === "ai" ? normalizedTextKeywords : [],
    withMusic: kind === "video" && body.withMusic === true,
    withNarration,
    narrationVoice:
      kind === "video" && withNarration
        ? (rawNarrationVoice as AiMediaNarrationVoice)
        : null,
    narrationVoiceVariant:
      kind === "video" && withNarration && rawNarrationVoiceVariant
        ? (rawNarrationVoiceVariant as AiMediaNarrationVoiceVariant)
        : null,
    format: format as AiMediaOutputFormat,
    typology: typology as AiMediaTypology,
    visualStyle: visualStyle as AiMediaVisualStyle,
    visualDirection,
    imagePurpose,
    imageStyle: imageStyle as AiMediaImageStyle,
    shotType: shotType as AiMediaShotType,
    peopleMode: normalizedPeopleMode as AiMediaPeopleMode,
    creativity: creativity as AiMediaCreativity,
    useBrandColors: operation !== "modify" && body.useBrandColors !== false,
    logoMode: logoMode as AiMediaLogoMode,
    videoEngine:
      kind === "video" ? (rawVideoEngine as AiMediaVideoEngine) : null,
    identityMode,
    videoCharacterMode: identityMode,
    identityConsent:
      strictIdentityReferenceRequested && body.identityConsent === true,
    teamVideoMode,
    teamVideoSpeechMode,
    teamVideoVeoConsent,
    identityReferenceSetId: operation === "modify"
      ? ""
      : inspirationImages.length
      ? cleanText(body.identityReferenceSetId, 120) || `legacy:${requestId}`
      : "",
    durationSeconds:
      kind === "video" ? (requestedDuration as AiMediaVideoDuration) : null,
    sceneMode,
    connectScenes,
    inspirationImages,
    source,
  };
}

/** Shared client/server applicability: local identity animation has no generated scene joins. */
export function shouldConnectAiMediaVideoScenes(request: {
  kind: string;
  durationSeconds?: number | null;
  connectScenes?: boolean;
  identityMode?: string;
  videoCharacterMode?: string;
  peopleMode?: string;
  teamVideoMode?: string;
}): boolean {
  if (
    request.kind !== "video" ||
    (request.durationSeconds ?? 16) <= 8 ||
    request.connectScenes !== true
  ) {
    return false;
  }
  const requestedIdentity =
    request.identityMode || request.videoCharacterMode || "auto";
  const identity =
    requestedIdentity === "reference_team" || request.peopleMode !== "none"
      ? requestedIdentity
      : "auto";
  return identity === "auto" || request.teamVideoMode === "cinematic";
}

export function buildAiMediaTitle(idea: string, kind: AiMediaKind) {
  const compact = cleanText(idea, 180)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
  if (!compact) return kind === "image" ? "Image IA iNrCy" : "Vidéo IA iNrCy";
  return compact.length <= 90 ? compact : `${compact.slice(0, 87).trimEnd()}…`;
}
