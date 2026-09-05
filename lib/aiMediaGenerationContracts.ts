export type AiMediaKind = "image" | "video";
export type AiMediaSurface = "booster" | "studio";
export type AiMediaSubjectSource = "publication" | "profile" | "custom";
export type AiMediaOutputFormat =
  | "square"
  | "portrait"
  | "story"
  | "landscape";
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
export type AiMediaImageStyle = "photo" | "illustration" | "three_d" | "graphic";
export type AiMediaShotType = "auto" | "close" | "medium" | "wide";
export type AiMediaPeopleMode = "auto" | "none" | "solo" | "team";
export type AiMediaCreativity = "faithful" | "bold";
export type AiMediaLogoMode = "discreet" | "visible" | "none";
export type AiMediaVideoDuration = 8 | 16 | 24;
export type AiMediaVideoEngine = "omni" | "veo";
export type AiMediaTeamVideoMode = "cinematic" | "montage";
export type AiMediaTeamVideoSpeechMode = "voiceover" | "characters";
export type AiMediaNarrationVoice = "female" | "male";
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
};

export const AI_MEDIA_INSPIRATION_MAX_COUNT = 3;
export const AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS = 800_000;

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

export type AiMediaGenerationRequest = {
  requestId: string;
  kind: AiMediaKind;
  subjectSource: AiMediaSubjectSource;
  idea: string;
  /** Consigne ponctuelle facultative, appliquée à cette génération uniquement. */
  aiInstruction: string;
  withText: boolean;
  textKeywords: string[];
  withMusic: boolean;
  withNarration: boolean;
  narrationVoice: AiMediaNarrationVoice | null;
  format: AiMediaOutputFormat;
  typology: AiMediaTypology;
  visualStyle: AiMediaVisualStyle;
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
  inspirationImages: AiMediaInspirationImage[];
  source: AiMediaSurface;
};

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

function normalizeAiInstruction(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 600);
}

function readRequestId(value: unknown) {
  const id = cleanText(value, 180);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/.test(id)) {
    throw new AiMediaRequestValidationError(
      "Identifiant de génération invalide. Merci de relancer la création.",
    );
  }
  return id;
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

function normalizeInspirationImages(value: unknown): AiMediaInspirationImage[] {
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
      "Ajoutez entre une et trois images d’inspiration.",
    );
  }
  return values.map((candidate) => {
    const source =
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : null;
    const mimeType = String(source?.mimeType ?? "").trim().toLowerCase();
    if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(mimeType)) {
      throw new AiMediaRequestValidationError(
        "Format d’image d’inspiration invalide. Utilisez JPG, PNG ou WebP.",
      );
    }
    const data = typeof source?.data === "string" ? source.data.trim() : "";
    if (
      data.length < 64 ||
      data.length > AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    ) {
      throw new AiMediaRequestValidationError(
        "Une image d’inspiration est invalide ou trop volumineuse.",
      );
    }
    return {
      mimeType: mimeType as AiMediaInspirationImage["mimeType"],
      data,
    };
  });
}

export function normalizeAiMediaGenerationRequest(
  value: unknown,
): AiMediaGenerationRequest {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!body) {
    throw new AiMediaRequestValidationError("Demande de média invalide.");
  }

  const requestId = readRequestId(body.requestId);

  const kind = body.kind === "image" || body.kind === "video" ? body.kind : null;
  if (!kind) {
    throw new AiMediaRequestValidationError("Type de média invalide.");
  }

  const source =
    body.source === "booster" || body.source === "studio"
      ? body.source
      : null;
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
  const subjectSource = (
    rawSubjectSource || (rawIdea ? "custom" : "profile")
  ) as AiMediaSubjectSource;
  const idea = subjectSource === "profile" ? "" : rawIdea;
  if (subjectSource !== "profile" && idea.length < 3) {
    throw new AiMediaRequestValidationError(
      "Décrivez votre idée en quelques mots avant de générer le média.",
    );
  }
  const aiInstruction = normalizeAiInstruction(body.aiInstruction);

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

  const imageStyle = cleanText(body.imageStyle, 40) || "photo";
  if (!["photo", "illustration", "three_d", "graphic"].includes(imageStyle)) {
    throw new AiMediaRequestValidationError("Type de rendu invalide.");
  }

  const shotType = cleanText(body.shotType, 40) || "auto";
  if (!["auto", "close", "medium", "wide"].includes(shotType)) {
    throw new AiMediaRequestValidationError("Cadrage invalide.");
  }

  const peopleMode = cleanText(body.peopleMode, 40) || "auto";
  if (!["auto", "none", "solo", "team"].includes(peopleMode)) {
    throw new AiMediaRequestValidationError("Présence humaine invalide.");
  }

  const creativity = cleanText(body.creativity, 40) || "faithful";
  if (!["faithful", "bold"].includes(creativity)) {
    throw new AiMediaRequestValidationError("Niveau de créativité invalide.");
  }

  const logoMode = cleanText(body.logoMode, 40) || "discreet";
  if (!["discreet", "visible", "none"].includes(logoMode)) {
    throw new AiMediaRequestValidationError("Présence du logo invalide.");
  }

  const requestedDuration = Number(body.durationSeconds || 16);
  if (kind === "video" && ![8, 16, 24].includes(requestedDuration)) {
    throw new AiMediaRequestValidationError(
      "Durée vidéo invalide : choisissez 8, 16 ou 24 secondes.",
    );
  }

  const withText = body.withText === true;
  const requestedWithNarration = kind === "video" && body.withNarration === true;
  const rawNarrationVoice = cleanText(body.narrationVoice, 24) || "female";
  if (
    kind === "video" &&
    requestedWithNarration &&
    !["female", "male"].includes(rawNarrationVoice)
  ) {
    throw new AiMediaRequestValidationError("Voix de narration invalide.");
  }
  const rawVideoEngine = cleanText(body.videoEngine, 24) || "omni";
  if (kind === "video" && !["omni", "veo"].includes(rawVideoEngine)) {
    throw new AiMediaRequestValidationError("Moteur vidéo invalide.");
  }
  const rawIdentityMode =
    cleanText(body.identityMode ?? body.videoCharacterMode, 32) || "auto";
  if (
    !["auto", "professional", "brand_avatar", "reference_team"].includes(
      rawIdentityMode,
    )
  ) {
    throw new AiMediaRequestValidationError("Mode d’identité invalide.");
  }
  const requestedIdentityMode = rawIdentityMode as AiMediaIdentityMode;
  const identityMode =
    requestedIdentityMode === "reference_team"
      ? "reference_team"
      : peopleMode !== "none"
        ? requestedIdentityMode
        : "auto";
  // Une équipe de référence décrit plusieurs adultes distincts : ce mode est
  // toujours ramené à une scène d'équipe, même si un ancien client envoie
  // encore `auto` ou `solo` pour la présence humaine.
  const normalizedPeopleMode =
    identityMode === "reference_team" ? "team" : peopleMode;
  const identityEnabled = normalizedPeopleMode !== "none";
  const normalizedInspirationImages = normalizeInspirationImages(
    body.inspirationImages,
  );
  const inspirationImages = identityEnabled ? normalizedInspirationImages : [];
  if (
    identityMode === "professional" &&
    inspirationImages.length === 0
  ) {
    throw new AiMediaRequestValidationError(
      "Ajoutez au moins une photo du professionnel pour guider son identité.",
    );
  }
  if (
    identityMode === "brand_avatar" &&
    inspirationImages.length === 0
  ) {
    throw new AiMediaRequestValidationError(
      "Ajoutez au moins un dessin d’avatar ou une photo autorisée à transformer.",
    );
  }
  if (
    identityMode === "reference_team" &&
    (inspirationImages.length < 2 || inspirationImages.length > 3)
  ) {
    throw new AiMediaRequestValidationError(
      "Ajoutez deux ou trois photos, avec une personne adulte distincte et autorisée par image.",
    );
  }
  // Toute image d'identité peut contenir un visage : l'accord est requis
  // même en mode automatique, pour une image comme pour une vidéo.
  const identityReferenceRequested = inspirationImages.length > 0;
  if (identityReferenceRequested && body.identityConsent !== true) {
    throw new AiMediaRequestValidationError(
      "Confirmez que vous êtes cette personne ou que vous avez son autorisation.",
    );
  }
  const rawTeamVideoMode = cleanText(body.teamVideoMode, 24) || "montage";
  if (!["cinematic", "montage"].includes(rawTeamVideoMode)) {
    throw new AiMediaRequestValidationError("Mode d’animation des personnages invalide.");
  }
  // Le geste explicite « animer » porte sur l'image ajoutée, quel que soit le
  // libellé d'identité choisi dans l'interface (générique, pro, avatar, équipe).
  const identityAnimationSupported = inspirationImages.length > 0;
  const teamVideoMode =
    kind === "video" && identityAnimationSupported
      ? (rawTeamVideoMode as AiMediaTeamVideoMode)
      : "montage";
  const rawTeamVideoSpeechMode =
    cleanText(body.teamVideoSpeechMode, 24) || "voiceover";
  if (!["voiceover", "characters"].includes(rawTeamVideoSpeechMode)) {
    throw new AiMediaRequestValidationError(
      "Mode vocal des personnages animés invalide.",
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

  return {
    requestId,
    kind,
    subjectSource,
    idea,
    aiInstruction,
    withText,
    textKeywords: withText ? normalizeTextKeywords(body.textKeywords) : [],
    withMusic: kind === "video" && body.withMusic === true,
    withNarration,
    narrationVoice:
      kind === "video" && withNarration
        ? (rawNarrationVoice as AiMediaNarrationVoice)
        : null,
    format: format as AiMediaOutputFormat,
    typology: typology as AiMediaTypology,
    visualStyle: visualStyle as AiMediaVisualStyle,
    imageStyle: imageStyle as AiMediaImageStyle,
    shotType: shotType as AiMediaShotType,
    peopleMode: normalizedPeopleMode as AiMediaPeopleMode,
    creativity: creativity as AiMediaCreativity,
    useBrandColors: body.useBrandColors !== false,
    logoMode: logoMode as AiMediaLogoMode,
    videoEngine:
      kind === "video" ? (rawVideoEngine as AiMediaVideoEngine) : null,
    identityMode,
    videoCharacterMode: identityMode,
    identityConsent:
      inspirationImages.length > 0 && body.identityConsent === true,
    teamVideoMode,
    teamVideoSpeechMode,
    teamVideoVeoConsent,
    identityReferenceSetId: inspirationImages.length
      ? cleanText(body.identityReferenceSetId, 120) || `legacy:${requestId}`
      : "",
    durationSeconds:
      kind === "video" ? (requestedDuration as AiMediaVideoDuration) : null,
    inspirationImages,
    source,
  };
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
