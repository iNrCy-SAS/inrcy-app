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
export type AiMediaVideoDuration = 10 | 20 | 30;
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
  withText: boolean;
  textKeywords: string[];
  withMusic: boolean;
  withNarration: boolean;
  format: AiMediaOutputFormat;
  typology: AiMediaTypology;
  visualStyle: AiMediaVisualStyle;
  imageStyle: AiMediaImageStyle;
  shotType: AiMediaShotType;
  peopleMode: AiMediaPeopleMode;
  creativity: AiMediaCreativity;
  useBrandColors: boolean;
  logoMode: AiMediaLogoMode;
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

function normalizeInspirationImages(
  value: unknown,
  kind: AiMediaKind,
): AiMediaInspirationImage[] {
  if (
    value === null ||
    typeof value === "undefined" ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return [];
  }
  if (kind !== "video") {
    throw new AiMediaRequestValidationError(
      "Le fichier d’inspiration est disponible uniquement pour une vidéo.",
    );
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

  const requestedDuration = Number(body.durationSeconds || 20);
  if (kind === "video" && ![10, 20, 30].includes(requestedDuration)) {
    throw new AiMediaRequestValidationError(
      "Durée vidéo invalide : choisissez 10, 20 ou 30 secondes.",
    );
  }

  const withText = body.withText === true;

  return {
    requestId: readRequestId(body.requestId),
    kind,
    subjectSource,
    idea,
    withText,
    textKeywords: withText ? normalizeTextKeywords(body.textKeywords) : [],
    withMusic: kind === "video" && body.withMusic === true,
    withNarration: kind === "video" && body.withNarration === true,
    format: format as AiMediaOutputFormat,
    typology: typology as AiMediaTypology,
    visualStyle: visualStyle as AiMediaVisualStyle,
    imageStyle: imageStyle as AiMediaImageStyle,
    shotType: shotType as AiMediaShotType,
    peopleMode: peopleMode as AiMediaPeopleMode,
    creativity: creativity as AiMediaCreativity,
    useBrandColors: body.useBrandColors !== false,
    logoMode: logoMode as AiMediaLogoMode,
    durationSeconds:
      kind === "video" ? (requestedDuration as AiMediaVideoDuration) : null,
    inspirationImages: normalizeInspirationImages(body.inspirationImages, kind),
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
