export type AiMediaKind = "image" | "video";
export type AiMediaSurface = "booster" | "studio";
export type AiMediaSubjectSource = "publication" | "profile" | "custom";

export type AiMediaGenerationRequest = {
  requestId: string;
  kind: AiMediaKind;
  subjectSource: AiMediaSubjectSource;
  idea: string;
  withText: boolean;
  withMusic: boolean;
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

  return {
    requestId: readRequestId(body.requestId),
    kind,
    subjectSource,
    idea,
    withText: kind === "image" && body.withText === true,
    withMusic: kind === "video" && body.withMusic === true,
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
