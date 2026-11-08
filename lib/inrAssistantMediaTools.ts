import "server-only";

import { jsonSchema, tool } from "ai";
import { normalizeAiMediaGenerationRequest, type AiMediaLibraryPickerItem, type AiMediaOutputFormat } from "./aiMediaGenerationContracts.ts";
import { getAiMediaVisualBriefMaxChars, getAiMediaVideoSpeechState } from "./aiMediaVideoSpeechBudget.ts";
import { AI_MEDIA_AVAILABLE_VIDEO_MODELS, getAiMediaVideoEngineRetirementIssue, getAiMediaImageModel, getAiMediaVideoModel, getAiMediaVideoResolution, isAiMediaVideoEngineAvailable, type AiMediaImageEngine, type AiMediaVideoEngine, type AiMediaVideoResolution } from "./aiMediaModelCatalog.ts";
import { getAutomaticMediaVideoDurationOptions } from "./aiMediaVideoClientOptions.ts";
import { permitsInrAssistantMediaAction } from "./inrAssistantMediaIntent.ts";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
import { isInrAssistantMediaPreviewButtonRequest } from "./inrAssistantMediaPreview.ts";
export { permitsInrAssistantMediaAction } from "./inrAssistantMediaIntent.ts";

type JsonRecord = Record<string, unknown>;
type MediaInput = {
  mediaType: "image" | "video";
  prompt: string;
  format?: AiMediaOutputFormat | null;
  durationSeconds?: number | null;
  settings?: Array<{ field: string; valueJson: string }> | null;
  resultMode?: "save" | "preview" | null;
};
type DraftDecisionInput = { requestId: string; mediaId: string; instructionQuote: string };
type ReferenceInput = { mediaId: string; role: "character" | "environment" | "product" | "inspiration"; usage: "required" | "inspiration"; characterIndex?: 1 | 2 | 3 | null };
type ModificationInput = { sourceMediaId: string; instruction: string; resultMode?: "save" | "preview" | null };

export type InrAssistantMediaResult = {
  ok: boolean;
  status: "completed" | "processing" | "failed" | "ready_to_save" | "quoted" | "discarded" | "unknown";
  requestId: string;
  message: string;
  libraryUrl: "/dashboard/mediatheque";
  mediaType?: "image" | "video";
  creditsUsed?: number;
  draft?: boolean;
  resultMode?: "save" | "preview";
  media?: {
    id: string;
    title: string;
    mediaType: "image" | "video";
    url: string | null;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
  };
};

const FORMATS = ["square", "portrait", "story", "landscape"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_PATTERN = /^[a-z0-9][a-z0-9_-]{7,179}$/i;
const SETTING_FIELDS = ["imageEngine", "videoEngine", "useBusinessDna", "referenceMediaIds", "references", "withMusic", "withNarration", "spokenScript", "withSubtitles", "narrationVoice", "narrationVoiceVariant", "videoResolution", "teamVideoSpeechMode"] as const;

class MediaToolError extends Error {}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function referencesInput(value: unknown): ReferenceInput[] {
  if (!Array.isArray(value) || value.length > 5) throw new MediaToolError("Choisissez au plus cinq références de la Médiathèque.");
  const mediaIds = new Set<string>(), slots = new Set<number>();
  return value.map(entry => {
    const input = record(entry);
    if (Object.keys(input).some(key => !["mediaId", "role", "usage", "characterIndex"].includes(key)) || typeof input.mediaId !== "string" || !UUID_PATTERN.test(input.mediaId) || mediaIds.has(input.mediaId.toLowerCase()) || !["character", "environment", "product", "inspiration"].includes(String(input.role)) || !["required", "inspiration"].includes(String(input.usage)) || input.role === "inspiration" && input.usage !== "inspiration" || input.characterIndex != null && (input.role !== "character" || ![1, 2, 3].includes(Number(input.characterIndex)) || !Number.isInteger(input.characterIndex)) || input.role === "character" && input.usage === "required" && input.characterIndex == null) throw new MediaToolError("Rôle, utilisation ou emplacement de référence invalide.");
    if (input.role === "character" && input.characterIndex != null) { if (slots.has(Number(input.characterIndex))) throw new MediaToolError("Chaque personnage doit avoir un emplacement distinct."); slots.add(Number(input.characterIndex)); }
    mediaIds.add(input.mediaId.toLowerCase());
    return { mediaId: input.mediaId.toLowerCase(), role: input.role as ReferenceInput["role"], usage: input.usage as ReferenceInput["usage"], ...(input.characterIndex == null ? {} : { characterIndex: input.characterIndex as 1 | 2 | 3 }) };
  });
}
function parseDraftDecision(value: unknown): DraftDecisionInput {
  const input = record(value);
  if (Object.keys(input).length !== 3 || Object.keys(input).some(key => !["requestId", "mediaId", "instructionQuote"].includes(key)) || typeof input.requestId !== "string" || !REQUEST_PATTERN.test(input.requestId) || typeof input.mediaId !== "string" || !UUID_PATTERN.test(input.mediaId) || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() || input.instructionQuote.length > 1200) throw new MediaToolError("Précisez la génération et le brouillon exact à traiter.");
  return { requestId: input.requestId, mediaId: input.mediaId.toLowerCase(), instructionQuote: input.instructionQuote };
}
function draftDecisionRequested(message: string, quote: string, action: "accept" | "discard") {
  if (message.includes(quote) && isInrAssistantMediaPreviewButtonRequest(message, action) && isInrAssistantMediaPreviewButtonRequest(quote, action)) return true;
  const current = inrAssistantMaskQuotedText(message), text = current.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(), selected = inrAssistantMaskQuotedText(quote).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (!message.includes(quote) || /\b(?:comment|pourquoi|explique|si|if|quand|when|apres|avant|demain|plus tard|pas maintenant|sans|never|not)\b|\bne\b.{0,60}\bpas\b|\bn['’]|\b(?:enregistre|sauvegarde|accepte|valide|rejette|refuse|supprime|jette)\s+pas\b/.test(text)) return false;
  const accept = /\b(?:enregistr\w*|sauvegard\w*|accept\w*|valid\w*|conserv\w*)\b/, discard = /\b(?:rejett\w*|rejette|refus\w*|jett\w*|jette|supprim\w*|retir\w*|abandon\w*)\b/;
  return /\b(?:brouillon|apercu|resultat|image|photo|video|media|creation)\b/.test(selected) && (action === "accept" ? accept.test(selected) && !discard.test(text) : discard.test(selected) && !accept.test(text));
}
function previewRequested(message: string | undefined) { const text = inrAssistantMaskQuotedText(message ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(); return /\b(?:apercu|previsualis\w*)\b|\bsans\s+(?:l['’]|les?\s+)?(?:enregistr\w*|sauvegard\w*)\b|\b(?:avant de|avant d['’])\s*(?:enregistr\w*|sauvegard\w*)\b|\bne\b.{0,30}\b(?:enregistr\w*|sauvegard\w*)\b.{0,15}\bpas\b/.test(text); }

function parseInput(value: unknown): MediaInput {
  const input = record(value);
  if (Object.keys(input).some((key) => !["mediaType", "prompt", "format", "durationSeconds", "settings", "resultMode"].includes(key)) || input.resultMode != null && !["save", "preview"].includes(String(input.resultMode)) ||
    !["image", "video"].includes(String(input.mediaType)) ||
    typeof input.prompt !== "string" || input.prompt.trim().length < 3 || input.prompt.length > 4_000 ||
    (input.format != null && !FORMATS.includes(input.format as AiMediaOutputFormat)) ||
    (input.durationSeconds != null && (!Number.isInteger(input.durationSeconds) || Number(input.durationSeconds) < 4 || Number(input.durationSeconds) > 30)) ||
    (input.mediaType === "image" && input.durationSeconds != null)) {
    throw new MediaToolError("Les critères du média sont invalides. Précisez le média souhaité avant de relancer.");
  }
  const promptLimit = getAiMediaVisualBriefMaxChars(input.mediaType === "video" ? "video" : "image", "free");
  if (typeof input.prompt === "string" && input.prompt.length > promptLimit) throw new MediaToolError(`Le brief visuel de la vidéo est limité à ${promptLimit} caractères. Placez les paroles exactes dans le champ « Paroles à prononcer ».`);
  if (input.settings != null && (!Array.isArray(input.settings) || input.settings.length > SETTING_FIELDS.length)) throw new MediaToolError("Réglages Studio invalides.");
  const settings = new Set<string>();
  for (const entry of input.settings as Array<Record<string, unknown>> ?? []) {
    if (!entry || typeof entry !== "object" || Object.keys(entry).length !== 2 || typeof entry.field !== "string" || !(SETTING_FIELDS as readonly string[]).includes(entry.field) || settings.has(entry.field) || typeof entry.valueJson !== "string" || entry.valueJson.length > 6000) throw new MediaToolError("Réglages Studio invalides.");
    settings.add(entry.field);
    let value: unknown; try { value = JSON.parse(entry.valueJson); } catch { throw new MediaToolError("Valeur Studio invalide."); }
    const field = entry.field;
    const retiredVideoEngine = input.mediaType === "video" && field === "videoEngine" ? getAiMediaVideoEngineRetirementIssue(value) : null;
    if (retiredVideoEngine) throw new MediaToolError(retiredVideoEngine.message);
    if (field === "references") referencesInput(value);
    if (field === "references" ? false : ["useBusinessDna", "withMusic", "withNarration", "withSubtitles"].includes(field) ? typeof value !== "boolean"
      : field === "referenceMediaIds" ? !Array.isArray(value) || value.length > 5 || new Set(value).size !== value.length || value.some(id => typeof id !== "string" || !UUID_PATTERN.test(id))
        : field === "imageEngine" ? input.mediaType !== "image" || !["openai", "gemini", "flux", "grok", "recraft"].includes(String(value))
          : field === "videoEngine" ? input.mediaType !== "video" || !isAiMediaVideoEngineAvailable(value)
            : field === "narrationVoice" ? !["female", "male"].includes(String(value))
              : field === "teamVideoSpeechMode" ? !["voiceover", "characters"].includes(String(value))
                : typeof value !== "string" || value.length > (field === "spokenScript" ? 4000 : field === "exactText" ? 1200 : 80)) throw new MediaToolError(`Réglage Studio incompatible : ${field}.`);
    if (input.mediaType !== "video" && ["withMusic", "withNarration", "spokenScript", "withSubtitles", "narrationVoice", "narrationVoiceVariant", "videoResolution", "teamVideoSpeechMode"].includes(field)) throw new MediaToolError("Les réglages audio et vidéo exigent une vidéo.");
  }
  if (settings.has("references") && settings.has("referenceMediaIds")) throw new MediaToolError("Utilisez references ou referenceMediaIds, sans mélanger les deux sélections.");
  return {
    mediaType: input.mediaType as MediaInput["mediaType"], prompt: input.prompt.trim(),
    format: input.format as MediaInput["format"], durationSeconds: input.durationSeconds as MediaInput["durationSeconds"],
    settings: input.settings as MediaInput["settings"],
    resultMode: input.resultMode as MediaInput["resultMode"],
  };
}

function parseModification(value: unknown): ModificationInput {
  const input = record(value);
  if (Object.keys(input).some((key) => !["sourceMediaId", "instruction", "resultMode"].includes(key)) || input.resultMode != null && !["save", "preview"].includes(String(input.resultMode)) || typeof input.sourceMediaId !== "string" || !UUID_PATTERN.test(input.sourceMediaId) ||
    typeof input.instruction !== "string" || input.instruction.trim().length < 3 || input.instruction.length > 1_200) {
    throw new MediaToolError("Précisez l’image de Mes médias et la modification souhaitée.");
  }
  return { sourceMediaId: input.sourceMediaId.toLowerCase(), instruction: input.instruction.trim(), resultMode: input.resultMode as ModificationInput["resultMode"] };
}

/** Provider choice stays server-owned and uses the existing Studio catalogue and tariffs. */
export function chooseInrAssistantMediaEngine(input: MediaInput): { imageEngine?: AiMediaImageEngine; videoEngine?: AiMediaVideoEngine } {
  const brief = input.prompt.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (input.mediaType === "video") {
    // Speech is not a quality ranking. Use only active text-to-video models
    // that support the requested numeric duration and optional resolution.
    const settings = Object.fromEntries((input.settings ?? []).map(entry => [entry.field, JSON.parse(entry.valueJson) as unknown]));
    const priority = ["grok-lite", "veo-lite"];
    const candidates = [...AI_MEDIA_AVAILABLE_VIDEO_MODELS].sort((a, b) => {
      const rank = (id: string) => priority.includes(id) ? priority.indexOf(id) : priority.length;
      return rank(a.id) - rank(b.id);
    });
    const selected = candidates.find(model => {
      if (!model.supportsTextToVideo || !isAiMediaVideoEngineAvailable(model.id)) return false;
      try {
        const resolution = getAiMediaVideoResolution(model.id, settings.videoResolution);
        return getAutomaticMediaVideoDurationOptions(model.id, resolution).some(option => option.durationSeconds === (input.durationSeconds ?? 8));
      } catch { return false; }
    });
    if (!selected) {
      throw new MediaToolError("La création vidéo est momentanément indisponible. Réessayez dans quelques instants.");
    }
    return { videoEngine: selected.id };
  }
  const textBrief = brief.replace(/\b(?:(?:sans|without|no)\s+(?:aucun(?:e)?\s+)?|(?:pas\s+de|aucun(?:e)?)\s+)(?:texte|titre|slogan|text|headline|lettering)(?:\s*(?:ni|ou|and|or)\s*(?:texte|titre|slogan|text|headline|lettering))*\b/g, "");
  const visibleText = /\b(?:texte|titre|slogan|affiche|flyer|infographie|prix|tarif|text|headline|poster)\b|[«“"€$]/.test(textBrief);
  const illustration = /\b(?:illustration|dessin|graphique|vectoriel|cartoon|pictogramme)\b/.test(brief);
  const photo = /\b(?:photo\w*|realiste|produit|chantier|photograph\w*)\b/.test(brief);
  const imageEngine: AiMediaImageEngine = visibleText ? "openai" : illustration ? "recraft" : photo ? "flux" : "grok";
  getAiMediaImageModel(imageEngine);
  return { imageEngine };
}

function makeRequest(source: Request, path: string, body?: unknown): Request {
  // This URL is never fetched. Calling fixed local route handlers preserves the
  // original Next request context and their account/auth/quota checks.
  const headers = new Headers();
  for (const name of ["cookie", "authorization"]) {
    const value = source.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("accept", "application/json");
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(new URL(path, "https://inrcy.local"), {
    method: body === undefined ? "GET" : "POST", headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: source.signal,
  });
}

async function responseData(response: Response): Promise<JsonRecord> {
  const data = record(await response.json());
  if (!response.ok || data.ok !== true) {
    throw new MediaToolError(typeof data.error === "string" ? data.error.slice(0, 500) : "Le média n’a pas pu être créé. Réessayez dans quelques instants.");
  }
  return data;
}

function resultForItem(requestId: string, item: AiMediaLibraryPickerItem, creditsUsed?: number): InrAssistantMediaResult {
  return {
    ok: true, status: "completed", requestId, message: "Votre média est prêt et enregistré dans Mes médias.",
    libraryUrl: "/dashboard/mediatheque", mediaType: item.media_type,
    ...(creditsUsed === undefined ? {} : { creditsUsed }),
    media: {
      id: item.id, title: item.title || "Média créé", mediaType: item.media_type,
      url: item.signed_url || null, mimeType: item.mime_type, width: item.width, height: item.height,
      durationSeconds: item.duration_seconds,
    },
  };
}
function previewForItem(requestId: string, item: unknown, creditsUsed?: number): InrAssistantMediaResult {
  const draft = record(item);
  if (typeof draft.id !== "string" || !UUID_PATTERN.test(draft.id) || !["image", "video"].includes(String(draft.media_type))) throw new MediaToolError("Le brouillon généré ne peut pas encore être retrouvé. Aucune nouvelle génération n’a été lancée.");
  return { ...resultForItem(requestId, draft as AiMediaLibraryPickerItem, creditsUsed), status: "ready_to_save", draft: true, resultMode: "preview", message: "Votre aperçu est créé et reste un brouillon temporaire du Studio, pas un média enregistré. Vous pouvez l’accepter dans Mes médias ou le refuser ; les crédits de génération déjà utilisés ne sont pas remboursés." };
}

async function acceptDraft(request: Request, requestId: string, item: unknown, creditsUsed?: number): Promise<InrAssistantMediaResult> {
  const draft = record(item);
  if (typeof draft.id !== "string" || !UUID_PATTERN.test(draft.id)) throw new MediaToolError("Le média généré ne peut pas être retrouvé. Ouvrez Mes médias avant de relancer.");
  const { POST } = await import("@/app/api/media-generation/drafts/[id]/accept/route");
  const accepted = await responseData(await POST(
    makeRequest(request, `/api/media-generation/drafts/${draft.id}/accept`, {}),
    { params: Promise.resolve({ id: draft.id }) },
  ));
  const saved = record(accepted.item);
  if (saved.id !== draft.id || !["image", "video"].includes(String(saved.media_type))) {
    throw new MediaToolError("L’enregistrement du média n’a pas pu être confirmé. Ouvrez Mes médias avant de relancer.");
  }
  return resultForItem(requestId, saved as AiMediaLibraryPickerItem, creditsUsed);
}

/** Do not transmit signed private preview URLs back to the language provider. */
function modelOutput(output: InrAssistantMediaResult) {
  const media = output.media ? { id: output.media.id, title: output.media.title, mediaType: output.media.mediaType } : null;
  return { type: "json" as const, value: {
    ok: output.ok, status: output.status, requestId: output.requestId, message: output.message,
    libraryUrl: output.libraryUrl, media, creditsUsed: output.creditsUsed ?? null,
    ...(output.draft === undefined ? {} : { draft: output.draft }), ...(output.resultMode ? { resultMode: output.resultMode } : {}),
  } };
}

/** Instantiate once per assistant request and reuse the same tools across model fallbacks. */
export function createInrAssistantMediaTools(options: {
  request: Request;
  requestId: string;
  currentUserMessage?: string;
  /** A status check must not accept a ready draft as an implicit write. */
  statusReadOnly?: boolean;
  /** Server-owned prior receipts only; never populated from model arguments. */
  saveAuthorizedRequestIds?: readonly string[];
  /** Untrusted UI hint restricts the target; it never authorizes a decision. */
  previewTarget?: { requestId: string; mediaId: string } | null;
  canStartWork?: () => boolean;
  onWorkStarted?: (requestId: string) => void;
  onResult?: (result: InrAssistantMediaResult) => void;
}) {
  if (!REQUEST_PATTERN.test(options.requestId)) throw new Error("Invalid assistant media request ID.");
  const mediaRequestId = `assistant_${options.requestId}_media`;
  if (!REQUEST_PATTERN.test(mediaRequestId)) throw new Error("Invalid assistant media request ID.");
  let generation: Promise<InrAssistantMediaResult> | null = null;
  const draftDecisions = new Map<string, { action: "accept" | "discard"; promise: Promise<InrAssistantMediaResult> }>();
  const denied = (mediaType: "image" | "video"): InrAssistantMediaResult => ({ ok: false, status: "failed", requestId: mediaRequestId,
    mediaType, libraryUrl: "/dashboard/mediatheque", message: "Précisez si vous souhaitez créer ou modifier ce média maintenant. Aucune génération n’a été lancée." });

  const recoverExisting = async (requestId: string, mediaType?: MediaInput["mediaType"], resultMode: "save" | "preview" = "save"): Promise<InrAssistantMediaResult | null> => {
    if (typeof requestId !== "string" || !REQUEST_PATTERN.test(requestId)) throw new MediaToolError("Identifiant de génération invalide.");
    const { GET } = await import("@/app/api/media-generation/status/route");
    const response = await GET(makeRequest(options.request, `/api/media-generation/status?requestId=${encodeURIComponent(requestId)}`));
    // Only this account-scoped, explicit absence permits new paid work. An
    // unavailable status check is never evidence that an earlier job is absent.
    if (response.status === 404) {
      const missing = record(await response.json());
      if (missing.code === "AI_MEDIA_GENERATION_NOT_FOUND") return null;
      throw new MediaToolError("La création précédente n’a pas pu être vérifiée. Aucune nouvelle génération n’a été lancée.");
    }
    const data = await responseData(response);
    if (data.status === "completed") {
      const used = Number.isSafeInteger(data.creditsUsed) ? Number(data.creditsUsed) : undefined;
      const item = record(data.item);
      const savedType = item.media_type === "image" || item.media_type === "video" ? item.media_type : mediaType;
      if (data.draft === false && typeof item.id === "string" && UUID_PATTERN.test(item.id) && savedType) return resultForItem(requestId,item as AiMediaLibraryPickerItem,used);
      if (options.statusReadOnly || resultMode === "preview") {
        if (data.draft === false && typeof item.id === "string" && UUID_PATTERN.test(item.id) && savedType) return resultForItem(requestId,item as AiMediaLibraryPickerItem,used);
        if (resultMode === "preview") return previewForItem(requestId, item, used);
        return {ok:true,status:"ready_to_save",requestId,libraryUrl:"/dashboard/mediatheque",...(savedType?{mediaType:savedType}:{}),...(used===undefined?{}:{creditsUsed:used}),message:"La création est terminée. Son enregistrement en Médiathèque reste à confirmer ; cette vérification n’a effectué aucune écriture ni nouvelle génération."};
      }
      try { return await acceptDraft(options.request, requestId, data.item, used); }
      catch (error) {
        return { ok: false, status: "ready_to_save", requestId, libraryUrl: "/dashboard/mediatheque",
          ...(savedType ? { mediaType: savedType } : {}), ...(used === undefined ? {} : { creditsUsed: used }),
          message: error instanceof MediaToolError ? error.message : "Le média est créé, mais son enregistrement dans Mes médias doit être vérifié. Ne relancez pas sa création." };
      }
    }
    const failed = data.status === "failed" || data.status === "expired";
    if (!failed && data.status !== "processing" && data.status !== "reserved") {
      throw new MediaToolError("L’état de la création précédente est inconnu. Aucune nouvelle génération n’a été lancée.");
    }
    return { ok: !failed, status: failed ? "failed" : "processing", requestId, libraryUrl: "/dashboard/mediatheque",
      ...(mediaType ? { mediaType } : {}),
      message: failed ? typeof data.error === "string" && data.error.trim() ? data.error : "Cette création a échoué. Aucun nouveau média n’a été lancé."
        : "La génération est en cours. Le média n’est pas encore prêt." };
  };

  const generate = async (raw: unknown, modification?: ModificationInput, quoteOnly = false): Promise<InrAssistantMediaResult> => {
    const input: MediaInput = modification ? { mediaType: "image", prompt: modification.instruction, resultMode: modification.resultMode } : parseInput(raw);
    const resultMode = input.resultMode === "preview" || previewRequested(options.currentUserMessage) ? "preview" : "save";
    let started = false;
    let readyItem: unknown = null;
    let creditsUsed: number | undefined;
    try {
      const existing = quoteOnly ? null : await recoverExisting(mediaRequestId, input.mediaType, resultMode);
      if (existing) return { ...existing, ...(existing.status === "processing" ? { resultMode } : {}) };
      const settings = Object.fromEntries((input.settings ?? []).map(entry => [entry.field, JSON.parse(entry.valueJson) as unknown]));
      const selectedReferences = settings.references === undefined ? null : referencesInput(settings.references);
      if (selectedReferences?.some(reference => reference.role === "character" && reference.usage === "required")) throw new MediaToolError("La fidélité à une personne identifiable exige sa photo et la confirmation personnelle d’autorisation dans iNr’Studio. Ouvrez le Studio pour ce consentement ; aucun crédit n’a été engagé par l’assistant.");
      const engine: { imageEngine?: AiMediaImageEngine; videoEngine?: AiMediaVideoEngine } = modification ? { imageEngine: "openai" } : settings.imageEngine ? { imageEngine: settings.imageEngine as AiMediaImageEngine } : settings.videoEngine ? { videoEngine: settings.videoEngine as AiMediaVideoEngine } : chooseInrAssistantMediaEngine(input);
      if (input.mediaType === "image" && !settings.imageEngine && (selectedReferences?.length || Array.isArray(settings.referenceMediaIds) && settings.referenceMediaIds.length)) engine.imageEngine = "openai";
      const retiredVideoEngine = input.mediaType === "video" ? getAiMediaVideoEngineRetirementIssue(engine.videoEngine) : null;
      if (retiredVideoEngine) throw new MediaToolError(retiredVideoEngine.message);
      const format = input.format ?? (input.mediaType === "video" ? "story" : "square");
      const { checkInrAssistantMediaGenerationAccess } = await import("./inrAssistantMediaAccess.ts");
      const access = await checkInrAssistantMediaGenerationAccess();
      if (!access.allowed) throw new MediaToolError(access.message);
      const { GET: quotaGET } = await import("@/app/api/media-generation/quota/route");
      const quota = record((await responseData(await quotaGET())).quota);
      if (quota.creditsReady !== true) throw new MediaToolError("Le portefeuille de crédits média n’est pas encore disponible pour cet établissement.");
      const maxDuration = Number(quota.videoMaxDurationSeconds);
      const durationSeconds = input.mediaType === "video" ? input.durationSeconds ?? Math.min(8, maxDuration) : undefined;
      if (input.mediaType === "video" && (!Number.isSafeInteger(maxDuration) || maxDuration < 4 || !Number.isInteger(durationSeconds) || Number(durationSeconds) > maxDuration)) {
        throw new MediaToolError(`La durée souhaitée dépasse le plafond de cet établissement${Number.isSafeInteger(maxDuration) ? ` (${maxDuration} secondes)` : ""}. Choisissez une durée autorisée.`);
      }
      const videoModel = engine.videoEngine ? getAiMediaVideoModel(engine.videoEngine) : null;
      let videoResolution: AiMediaVideoResolution | undefined;
      try {
        if (videoModel) videoResolution = getAiMediaVideoResolution(videoModel.id, settings.videoResolution);
      } catch { throw new MediaToolError("Résolution indisponible pour ce moteur."); }
      // The same duration-only policy as the mounted Studio owns the clip pair.
      // Resolve after the requested engine/resolution, never from prompt prose.
      const videoDuration = videoModel ? getAutomaticMediaVideoDurationOptions(videoModel.id, videoResolution)
        .find(option => option.durationSeconds === durationSeconds) : undefined;
      if (videoModel && !videoDuration) throw new MediaToolError("Cette durée n’est pas disponible avec le moteur et la résolution choisis. Choisissez une durée compatible.");
      if (input.mediaType === "video") {
        const speech = getAiMediaVideoSpeechState({ kind: "video", creationMode: "free", freePrompt: input.prompt,
          spokenScript: settings.spokenScript as string | undefined, withNarration: settings.withNarration === true,
          teamVideoSpeechMode: settings.teamVideoSpeechMode === "characters" ? "characters" : "voiceover",
          durationSeconds, videoEngine: engine.videoEngine, videoResolution,
          sceneMode: videoDuration?.sceneMode });
        if (speech.issue) throw new MediaToolError(speech.issue.message);
      }
      const source = modification ? await (await import("./inrAssistantMediaSource.ts")).loadInrAssistantImageReference(modification.sourceMediaId) : null;
      const referenceIds = (settings.referenceMediaIds ?? []) as string[];
      delete settings.referenceMediaIds;
      delete settings.references;
      const referenceSelections: ReferenceInput[] = selectedReferences ?? referenceIds.map(mediaId => ({ mediaId, role: "inspiration", usage: "inspiration" }));
      const references = referenceSelections.length ? await Promise.all(referenceSelections.map(async reference => ({ ...(await (await import("./inrAssistantMediaSource.ts")).loadInrAssistantImageReference(reference.mediaId)).reference, role: reference.role, usage: reference.usage, ...(reference.characterIndex == null ? {} : { characterIndex: reference.characterIndex }) }))) : [];
      const payload = {
        contractVersion: 4, requestId: mediaRequestId, source: "studio", operation: "generate",
        creationMode: "free", freePrompt: input.prompt, useBusinessDna: true, inputMode: "essential",
        kind: input.mediaType, format, ...engine,
        withMusic: false, withNarration: false, inspirationImages: references, ...settings, identityMode: "auto", identityConsent: false,
        ...(videoDuration ? { durationSeconds: videoDuration.durationSeconds, videoResolution, sceneMode: videoDuration.sceneMode, connectScenes: false } : {}),
        ...(source ? { operation: "modify", creationMode: "guided", format: source.format, aiInstruction: modification!.instruction,
          inspirationImages: [source.reference], modificationSourceWidth: source.width, modificationSourceHeight: source.height,
          textMode: "none", logoMode: "none", useBrandColors: false, useBusinessDna: false } : {}),
      };
      const normalized = normalizeAiMediaGenerationRequest(payload);
      const { POST: quotePOST } = await import("@/app/api/media-generation/quote/route");
      const quoted = await responseData(await quotePOST(makeRequest(options.request, "/api/media-generation/quote", {
        ...normalized, inspirationImagesCount: source ? 1 : references.length,
      })));
      const quote = record(quoted.quote);
      creditsUsed = Number(quote.totalCredits);
      if (!Number.isSafeInteger(creditsUsed) || creditsUsed <= 0 || typeof quote.quoteId !== "string" || typeof quote.tariffVersion !== "string") {
        throw new MediaToolError("Le coût du média n’a pas pu être confirmé. Réessayez dans quelques instants.");
      }
      const remaining = record(quoted.credits).remaining;
      if (quoteOnly) return { ok: true, status: "quoted", requestId: mediaRequestId, mediaType: input.mediaType, creditsUsed, libraryUrl: "/dashboard/mediatheque", message: `Devis Studio natif : ${creditsUsed} crédits média${typeof remaining === "number" ? ` ; ${remaining} disponibles` : ""}. Aucune génération, réservation de crédits ni sauvegarde lancée. Le devis sera revérifié lors de la création.` };
      if (typeof remaining === "number" && remaining < creditsUsed) {
        throw new MediaToolError(`Crédits média insuffisants : ${remaining} disponibles, ${creditsUsed} nécessaires.`);
      }
      const { POST: generatePOST } = await import("@/app/api/media-generation/generate/route");
      if (options.canStartWork && !options.canStartWork()) {
        throw new MediaToolError("La préparation a pris trop de temps pour lancer ce média en toute fiabilité. Redemandez sa création ; aucune génération n’a été lancée.");
      }
      started = true;
      options.onWorkStarted?.(mediaRequestId);
      const generated = await responseData(await generatePOST(makeRequest(options.request, "/api/media-generation/generate", {
        ...payload, expectedCredits: creditsUsed, creditQuoteId: quote.quoteId, creditTariffVersion: quote.tariffVersion,
      })));
      readyItem = generated.item;
      if (resultMode === "preview") return previewForItem(mediaRequestId, readyItem, creditsUsed);
      return { ...await acceptDraft(options.request, mediaRequestId, readyItem, creditsUsed), resultMode: "save", draft: false };
    } catch (error) {
      return {
        ok: false, status: readyItem ? "ready_to_save" : started && !(error instanceof MediaToolError) ? "processing" : "failed",
        requestId: mediaRequestId, mediaType: input.mediaType, libraryUrl: "/dashboard/mediatheque",
        resultMode,
        ...(creditsUsed === undefined ? {} : { creditsUsed }),
        message: error instanceof MediaToolError || error instanceof Error && error.name === "AiMediaRequestValidationError" ? error.message : started
          ? "La génération a été lancée. Vérifiez son état avant de relancer pour éviter un doublon."
          : "La création du média est momentanément indisponible. Aucun nouveau média n’a été confirmé.",
      };
    }
  };

  const decideDraft = async (input: DraftDecisionInput, action: "accept" | "discard"): Promise<InrAssistantMediaResult> => {
    const fail = (message: string, status: "failed" | "unknown" = "failed"): InrAssistantMediaResult => ({ ok: false, status, requestId: input.requestId, libraryUrl: "/dashboard/mediatheque", message });
    if (options.previewTarget && (input.requestId !== options.previewTarget.requestId || input.mediaId !== options.previewTarget.mediaId)) return fail("La décision ne correspond pas à l’aperçu ciblé dans cette conversation. Aucun autre brouillon n’a été modifié.");
    const message = options.currentUserMessage ?? "";
    const permitsCreation = (text: string) => permitsInrAssistantMediaAction(text, "generate", "image") || permitsInrAssistantMediaAction(text, "generate", "video") || permitsInrAssistantMediaAction(text, "modify");
    const savedGenerationOrder = action === "accept" && options.saveAuthorizedRequestIds?.includes(input.requestId) === true && message.includes(input.instructionQuote) && !previewRequested(message) && permitsCreation(message) && permitsCreation(input.instructionQuote);
    if (!savedGenerationOrder && !draftDecisionRequested(message, input.instructionQuote, action)) return fail(action === "accept" ? "Demandez explicitement d’enregistrer cet aperçu Studio dans Mes médias." : "Demandez explicitement de refuser ce brouillon temporaire Studio. Aucun média enregistré ne sera supprimé.");
    if (options.statusReadOnly && !savedGenerationOrder || options.request.signal.aborted || options.canStartWork?.() === false) return fail("Cette demande ne peut pas modifier un brouillon pendant une vérification ou après interruption.");
    const key = `${input.requestId}:${input.mediaId}`, prior = draftDecisions.get(key);
    if (prior) return prior.action === action ? prior.promise : fail("Une décision différente a déjà été traitée pour cet aperçu dans cette demande. Relisez son état avant une autre action.");
    const promise = (async (): Promise<InrAssistantMediaResult> => {
      let started = false;
      try {
        const { GET } = await import("@/app/api/media-generation/status/route");
        const read = () => GET(makeRequest(options.request, `/api/media-generation/status?requestId=${encodeURIComponent(input.requestId)}`));
        const beforeResponse = await read(), before = record(await beforeResponse.json()), item = record(before.item);
        if (!beforeResponse.ok || before.ok !== true || before.status !== "completed" || item.id !== input.mediaId || !["image", "video"].includes(String(item.media_type)) || typeof before.draft !== "boolean") return fail("La génération et cet aperçu exact ne sont pas retrouvés ensemble dans le compte actif. Aucune opération n’a été lancée.");
        const used = Number.isSafeInteger(before.creditsUsed) ? Number(before.creditsUsed) : undefined;
        if (before.draft === false) return action === "accept" ? { ...resultForItem(input.requestId, item as AiMediaLibraryPickerItem, used), draft: false, resultMode: "save" } : fail("Ce média est déjà enregistré dans Mes médias. Refuser un aperçu ne supprime jamais un média accepté ; utilisez son parcours de suppression distinct.");
        if (options.request.signal.aborted || options.canStartWork?.() === false) return fail("La demande a été interrompue avant la décision. Le brouillon est conservé.");
        started = true;
        if (action === "accept") {
          await acceptDraft(options.request, input.requestId, item, used);
          const afterResponse = await read(), after = record(await afterResponse.json()), saved = record(after.item);
          if (!afterResponse.ok || after.ok !== true || after.status !== "completed" || after.draft !== false || saved.id !== input.mediaId || saved.media_type !== item.media_type) return fail("L’enregistrement a été demandé, mais sa relecture n’est pas confirmée. Vérifiez Mes médias avant une nouvelle décision.", "unknown");
          return { ...resultForItem(input.requestId, saved as AiMediaLibraryPickerItem, used), draft: false, resultMode: "save" };
        }
        const { DELETE } = await import("@/app/api/media-generation/drafts/[id]/route");
        const deleted = await responseData(await DELETE(new Request(makeRequest(options.request, `/api/media-generation/drafts/${input.mediaId}`, {}), { method: "DELETE" }), { params: Promise.resolve({ id: input.mediaId }) }));
        if (deleted.discarded !== true || deleted.accepted === true) return fail("Le brouillon a changé pendant la décision et n’a pas été confirmé comme refusé. Aucun média accepté n’est supprimé.", "unknown");
        const afterResponse = await read(), after = record(await afterResponse.json());
        if (afterResponse.status !== 410 || after.code !== "AI_MEDIA_RESULT_UNAVAILABLE") return fail("Le refus du brouillon doit encore être vérifié. Aucune nouvelle génération ni tentative automatique n’a été lancée.", "unknown");
        return { ok: true, status: "discarded", requestId: input.requestId, libraryUrl: "/dashboard/mediatheque", draft: false, resultMode: "preview", ...(used === undefined ? {} : { creditsUsed: used }), message: "Le brouillon temporaire exact a été refusé puis son absence relue. Aucune génération supplémentaire ; les crédits déjà utilisés ne sont pas remboursés." };
      } catch { return fail(started ? "La décision sur cet aperçu n’a pas pu être confirmée. Vérifiez son état avant de réessayer ; rien n’a été relancé automatiquement." : "Le brouillon ne peut pas être vérifié dans le compte actif. Aucune décision n’a été appliquée.", started ? "unknown" : "failed"); }
    })().then(result => { try { options.onResult?.(result); } catch { /* Presentation cannot replay a native draft decision. */ } return result; });
    draftDecisions.set(key, { action, promise });
    return promise;
  };
  const draftDecisionSchema = jsonSchema<DraftDecisionInput>({ type: "object", properties: { requestId: { type: "string", minLength: 8, maxLength: 179 }, mediaId: { type: "string", format: "uuid" }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 } }, required: ["requestId", "mediaId", "instructionQuote"], additionalProperties: false }, { validate: value => { try { return { success: true, value: parseDraftDecision(value) }; } catch { return { success: false, error: new Error("Brouillon Studio invalide") }; } } });

  return {
    acceptMediaGeneration: tool({ strict: true, description: "Enregistrer un aperçu Studio sur ordre explicite actuel ou poursuivre un enregistrement déjà autorisé et prouvé côté serveur. requestId et mediaId du même résultat ready_to_save. Job du compte relu, accept natif puis draft=false vérifié ; aucun crédit ni génération. Déjà enregistré : aucune seconde écriture.", inputSchema: draftDecisionSchema, execute: async raw => decideDraft(parseDraftDecision(raw), "accept"), toModelOutput: ({ output }) => modelOutput(output) }),
    discardMediaGeneration: tool({ strict: true, description: "Refuser uniquement un aperçu temporaire Studio sur ordre explicite actuel. requestId et mediaId liés par le job du compte ; DELETE natif puis absence relue. Ne supprime jamais un média déjà accepté, ne rembourse aucun crédit et ne régénère rien. Résultat incertain : ne pas répéter.", inputSchema: draftDecisionSchema, execute: async raw => decideDraft(parseDraftDecision(raw), "discard"), toModelOutput: ({ output }) => modelOutput(output) }),
    quoteMediaGeneration: tool({ strict: true, description: "Obtenir le vrai devis Studio, moteur/durée numérique/références/réglages identiques à generateMedia, découpage automatique sans choix de montage. Lecture seule : aucun débit, génération ou sauvegarde. settings[{field,valueJson}] encode les valeurs JSON ; referenceMediaIds contient uniquement des IDs d’images actives du compte. Aucun consentement identité n’est fourni implicitement.", inputSchema: jsonSchema<MediaInput>({ type: "object", properties: { mediaType: { type: "string", enum: ["image", "video"] }, resultMode: { type: ["string", "null"], enum: ["save", "preview", null] }, prompt: { type: "string", minLength: 3, maxLength: 4000, description: "Brief visuel : vidéo 500 caractères max, image 4000. Paroles exactes : réglage spokenScript, avec le mode de voix demandé." }, format: { type: ["string", "null"], enum: [...FORMATS, null] }, durationSeconds: { type: ["integer", "null"], minimum: 4, maximum: 30 }, settings: { type: ["array", "null"], maxItems: SETTING_FIELDS.length, items: { type: "object", properties: { field: { type: "string", enum: [...SETTING_FIELDS] }, valueJson: { type: "string", maxLength: 6000 } }, required: ["field", "valueJson"], additionalProperties: false } } }, required: ["mediaType", "prompt", "format", "durationSeconds", "settings", "resultMode"], additionalProperties: false }, { validate: value => { try { return { success: true, value: parseInput(value) }; } catch { return { success: false, error: new Error("Réglages Studio invalides") }; } } }), execute: async raw => generate(parseInput(raw), undefined, true), toModelOutput: ({ output }) => modelOutput(output) }),
    cancelMediaGeneration: tool({
      strict: true,
      description: "Demander l’arrêt natif d’une tentative Studio identifiée par son requestId réel. L’arrêt n’est possible qu’avant réservation des crédits ; une génération déjà en traitement continue chez le fournisseur. Ne jamais promettre remboursement, annulation fournisseur ni suppression du média terminé. Une simple question ou vérification de statut n’autorise pas cette action.",
      inputSchema: jsonSchema<{ requestId: string; mediaType: "image" | "video"; instructionQuote: string }>({ type: "object", properties: { requestId: { type: "string", minLength: 8, maxLength: 179 }, mediaType: { type: "string", enum: ["image", "video"] }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 } }, required: ["requestId", "mediaType", "instructionQuote"], additionalProperties: false }),
      execute: async raw => {
        const input = record(raw);
        if (Object.keys(input).length !== 3 || typeof input.requestId !== "string" || !REQUEST_PATTERN.test(input.requestId) || !["image", "video"].includes(String(input.mediaType)) || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() || input.instructionQuote.length > 1200) throw new MediaToolError("Demande d’arrêt invalide.");
        const message = options.currentUserMessage ?? "", normalized = message.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
        const unquoted = message.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|«[^»]*»|“[^”]*”|"[^"]*"|^>.*$/gm, " ");
        const fail = (status: string, message: string) => ({ ok: false, status, requestId: input.requestId, message, libraryUrl: "/dashboard/mediatheque" });
        if (!unquoted.includes(input.instructionQuote) || !/\b(?:annule|annuler|arrete|arreter|stoppe|stopper)\b/.test(input.instructionQuote.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase())
          || /\b(?:comment|pourquoi|explique|si je|si tu|si on|ne pas)\b|\bne\b.{0,50}\bpas\b/.test(normalized)) return fail("needs_instruction", "Précisez la génération à arrêter.");
        if (options.request.signal.aborted || options.canStartWork?.() === false || options.statusReadOnly) return fail("blocked", "Cette action n’est pas disponible pendant une simple vérification.");
        try {
          const { GET } = await import("@/app/api/media-generation/status/route");
          const statusResponse = await GET(makeRequest(options.request, `/api/media-generation/status?requestId=${encodeURIComponent(input.requestId)}`));
          const status = record(await statusResponse.json());
          if (statusResponse.status === 404 && (status.code !== "AI_MEDIA_GENERATION_NOT_FOUND" || input.requestId !== mediaRequestId)) return fail("not_found", "Cette tentative n’est pas retrouvée dans cet établissement.");
          if (!statusResponse.ok && statusResponse.status !== 404) return fail("unknown", "L’état de la génération est indisponible. Aucun arrêt confirmé.");
          if (["processing", "reserved"].includes(String(status.status))) return fail("cannot_cancel", "La génération a déjà commencé. Le parcours natif ne peut plus l’arrêter ; aucun remboursement ni arrêt fournisseur n’est annoncé.");
          if (status.status === "completed") return { ok: true, status: "already_completed", requestId: input.requestId, message: "Le média est déjà créé. Il est conservé ; aucun nouvel enregistrement ni suppression effectué.", libraryUrl: "/dashboard/mediatheque" };
          if (["failed", "expired"].includes(String(status.status))) return { ok: true, status: "already_stopped", requestId: input.requestId, message: "Cette tentative est déjà terminée sans travail en cours. Aucun nouveau débit ni remboursement effectué.", libraryUrl: "/dashboard/mediatheque" };
          const { POST } = await import("@/app/api/media-generation/cancel/route");
          const data = await responseData(await POST(makeRequest(options.request, "/api/media-generation/cancel", { requestId: input.requestId, mediaKind: input.mediaType, surface: "studio" })));
          return data.cancellationPreventedReservation === true ? { ok: true, status: "cancelled", requestId: input.requestId, message: "Tentative arrêtée avant réservation des crédits.", libraryUrl: "/dashboard/mediatheque" }
            : fail(data.status === "processing" ? "cannot_cancel" : "already_stopped", "La tentative a changé d’état pendant la demande. Consultez son statut ; aucun arrêt fournisseur ni remboursement n’est garanti.");
        } catch { return fail("unknown", "L’arrêt n’a pas pu être confirmé. Vérifiez l’état de cette tentative."); }
      },
    }),
    modifyMedia: tool({
      description: "Modifier réellement une image existante de Mes médias sur demande actuelle du professionnel, et enregistrer le résultat comme un nouveau média sans écraser l’original. Retrouver d’abord l’image avec searchMedia et utiliser son ID réel ; demander une précision si plusieurs images correspondent. Décris uniquement les changements demandés ; conservation du cadrage et vérification des crédits Studio. Les montages vidéo ne sont pas pris en charge par cette opération.",
      inputSchema: jsonSchema<ModificationInput>({ type: "object", properties: {
        sourceMediaId: { type: "string", description: "ID exact de l’image existante retrouvée par searchMedia." },
        instruction: { type: "string", minLength: 3, maxLength: 1_200 },
        resultMode: { type: ["string", "null"], enum: ["save", "preview", null], description: "preview garde un brouillon temporaire, save/null enregistre (défaut)." },
      }, required: ["sourceMediaId", "instruction", "resultMode"], additionalProperties: false }, { validate: (value) => {
        try { return { success: true, value: parseModification(value) }; }
        catch (error) { return { success: false, error: error instanceof Error ? error : new Error("Invalid modification") }; }
      } }),
      execute: async (raw) => {
        const input = parseModification(raw);
        if (options.currentUserMessage !== undefined && !permitsInrAssistantMediaAction(options.currentUserMessage, "modify")) return denied("image");
        if (!generation) generation = generate(null, input).then((result) => { options.onResult?.(result); return result; });
        return generation;
      }, toModelOutput: ({ output }) => modelOutput(output),
    }),
    generateMedia: tool({
      description: "Créer une image/vidéo sur demande actuelle et l’enregistrer dans Mes médias. Rédige le brief depuis le besoin et l’ADN, choisis format/durée ; le pro ne choisit ni prompt ni fournisseur. Moteur compatible et crédits réels du compte. Une création par demande, jamais sur simple question d’aide ; média enregistré uniquement si completed.",
      inputSchema: jsonSchema<MediaInput>({
        type: "object", properties: {
          mediaType: { type: "string", enum: ["image", "video"] },
          prompt: { type: "string", minLength: 3, maxLength: 4_000, description: "Brief visuel : vidéo 500 caractères max, image 4000. Paroles exactes : réglage spokenScript, avec le mode de voix demandé." },
          format: { type: ["string", "null"], enum: [...FORMATS, null], description: "Format adapté au besoin du pro, ou null pour le format courant." },
          durationSeconds: { type: ["integer", "null"], minimum: 4, maximum: 30, description: "Durée vidéo numérique en secondes ou null ; découpage automatique selon moteur et résolution, sans choix de montage. Toujours null pour une image." },
          resultMode: { type: ["string", "null"], enum: ["save", "preview", null], description: "preview laisse un aperçu temporaire à accepter/refuser ; save/null enregistre le nouveau média (défaut)." },
          settings: { type: ["array", "null"], description: "Valeurs JSON. Durée via durationSeconds uniquement ; découpage automatique sans raccord imposé. teamVideoSpeechMode voiceover/characters. references=[{mediaId,role:character/environment/product/inspiration,usage:required/inspiration,characterIndex:1|2|3|null}], 5 images possédées ; exclusif referenceMediaIds. Identité fidèle et voix personnelle nécessitent consentement humain Studio.", maxItems: SETTING_FIELDS.length, items: { type: "object", properties: { field: { type: "string", enum: [...SETTING_FIELDS] }, valueJson: { type: "string", maxLength: 6000 } }, required: ["field", "valueJson"], additionalProperties: false } },
        }, required: ["mediaType", "prompt", "format", "durationSeconds", "settings", "resultMode"], additionalProperties: false,
      }, { validate: (value) => {
        try { return { success: true, value: parseInput(value) }; }
        catch (error) { return { success: false, error: error instanceof Error ? error : new Error("Invalid media request") }; }
      } }),
      execute: async (input) => {
        const parsed = parseInput(input);
        if (options.currentUserMessage !== undefined && !permitsInrAssistantMediaAction(options.currentUserMessage, "generate", parsed.mediaType)) return denied(parsed.mediaType);
        // One durable generation identity, even if a model repeats its tool call
        // or a provider fallback retries after a slow tool result.
        if (!generation) generation = generate(parsed).then((result) => { options.onResult?.(result); return result; });
        return generation;
      },
      toModelOutput: ({ output }) => modelOutput(output),
    }),
    getMediaGeneration: tool({
      description: "Lire l’état réel d’une création sans écriture, génération ni débit. Un brouillon prêt reste ready_to_save ; seul acceptMediaGeneration peut ensuite l’enregistrer sur ordre explicite. Utiliser le requestId réel de la création.",
      inputSchema: jsonSchema<{ requestId: string }>({
        type: "object", properties: { requestId: { type: "string", minLength: 8, maxLength: 179 } },
        required: ["requestId"], additionalProperties: false,
      }),
      execute: async ({ requestId }) => {
        const recovered = await recoverExisting(requestId, undefined, "preview");
        const result = recovered?.status === "ready_to_save" ? (() => { const { resultMode: _mode, ...readOnly } = recovered; return readOnly; })() : recovered;
        if (!result) throw new MediaToolError("Cette création est introuvable dans cet établissement. Aucun média n’a été relancé.");
        options.onResult?.(result);
        return result;
      },
      toModelOutput: ({ output }) => modelOutput(output),
    }),
  };
}
