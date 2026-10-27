import "server-only";

import { jsonSchema, tool } from "ai";
import { normalizeAiMediaGenerationRequest, type AiMediaLibraryPickerItem, type AiMediaOutputFormat } from "./aiMediaGenerationContracts.ts";
import { getAiMediaImageModel, getAiMediaVideoModel, isAiMediaVideoEngineAvailable, type AiMediaImageEngine, type AiMediaVideoEngine } from "./aiMediaModelCatalog.ts";

type JsonRecord = Record<string, unknown>;
type MediaInput = {
  mediaType: "image" | "video";
  prompt: string;
  format?: AiMediaOutputFormat | null;
  durationSeconds?: number | null;
};
type ModificationInput = { sourceMediaId: string; instruction: string };

export type InrAssistantMediaResult = {
  ok: boolean;
  status: "completed" | "processing" | "failed" | "ready_to_save";
  requestId: string;
  message: string;
  libraryUrl: "/dashboard/mediatheque";
  mediaType?: "image" | "video";
  creditsUsed?: number;
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

class MediaToolError extends Error {}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function parseInput(value: unknown): MediaInput {
  const input = record(value);
  if (Object.keys(input).some((key) => !["mediaType", "prompt", "format", "durationSeconds"].includes(key)) ||
    !["image", "video"].includes(String(input.mediaType)) ||
    typeof input.prompt !== "string" || input.prompt.trim().length < 3 || input.prompt.length > 4_000 ||
    (input.format != null && !FORMATS.includes(input.format as AiMediaOutputFormat)) ||
    (input.durationSeconds != null && (!Number.isInteger(input.durationSeconds) || Number(input.durationSeconds) < 4 || Number(input.durationSeconds) > 30)) ||
    (input.mediaType === "image" && input.durationSeconds != null)) {
    throw new MediaToolError("Les critères du média sont invalides. Précisez le média souhaité avant de relancer.");
  }
  return {
    mediaType: input.mediaType as MediaInput["mediaType"], prompt: input.prompt.trim(),
    format: input.format as MediaInput["format"], durationSeconds: input.durationSeconds as MediaInput["durationSeconds"],
  };
}

function parseModification(value: unknown): ModificationInput {
  const input = record(value);
  if (Object.keys(input).some((key) => !["sourceMediaId", "instruction"].includes(key)) || typeof input.sourceMediaId !== "string" || !UUID_PATTERN.test(input.sourceMediaId) ||
    typeof input.instruction !== "string" || input.instruction.trim().length < 3 || input.instruction.length > 1_200) {
    throw new MediaToolError("Précisez l’image de Mes médias et la modification souhaitée.");
  }
  return { sourceMediaId: input.sourceMediaId.toLowerCase(), instruction: input.instruction.trim() };
}

/** Only the latest server-supplied user text may authorize a paid media action. */
export function permitsInrAssistantMediaAction(message: string, action: "generate" | "modify", mediaType: "image" | "video" = "image"): boolean {
  if (typeof message !== "string") return false;
  const value = message.slice(0, 4_000).replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " ")
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (!value || /^(?:comment|pourquoi|ou|how|where|what)\b|\b(?:expliqu\w*|montr\w*|comprendre|savoir|explain|show|teach)\b|\b(?:comment|how|where)\b/.test(value) ||
    /\b(?:puis.je|dois.je|(?:je|on) (?:peux|peut|dois|doit)|can i|should i)\b/.test(value) ||
    /\b(?:prepare|redige|ecris|write|draft|propose)\w*\b.{0,70}\b(?:prompt|brief|instructions?|consignes?)\b/.test(value)) return false;
  const verbs = action === "generate"
    ? "(?:cree\\w*|gener\\w*|fais|faire|faites|fass\\w*|realise\\w*|produi\\w*|dessin\\w*|anime\\w*|create|generate|make|produce|draw)"
    : "(?:modifi\\w*|retouch\\w*|corrig\\w*|remplac\\w*|retir\\w*|enlev\\w*|supprim\\w*|recadr\\w*|eclairci\\w*|assombri\\w*|ajout\\w*|mets|mettre|rends|rendre|ameliore\\w*|augment\\w*|redui\\w*|edit|modify|retouch|remove|replace|brighten|crop|add)";
  if (new RegExp(`\\b(?:ne|sans|pas|jamais|not|never|don't|do not)\\b.{0,60}\\b${verbs}\\b|\\b${verbs}\\b.{0,18}\\b(?:pas|jamais|not|never)\\b`).test(value)) return false;
  const direct = new RegExp(`(?:^|[.!?;,:]\\s*|\\b(?:et|puis|ensuite|please|stp)\\s+)\\s*${verbs}\\b|\\b(?:(?:peux|pourrais|voudrais)[- ]tu|tu (?:peux|pourrais)|je (?:veux|souhaite|voudrais) que tu|j.aimerais que tu|(?:can|could|would) you|i want you to)\\s+(?:me\\s+|please\\s+)?${verbs}\\b`).test(value);
  if (action === "modify") return direct;
  const need = /\b(?:je (?:veux|souhaite|voudrais)|j.aimerais|j.ai besoin d.|i (?:want|need))\s+(?:(?:une?|des?|an?|the|some)\s+)?(?:(?:nouvelle?|belle?|new)\s+)?(?:image|photo|video|visuel|illustration|affiche|flyer|media|clip|picture)\b/.test(value);
  const subject = mediaType === "video" ? /\b(?:videos?|clips?|films?|animations?)\b|视频|วิดีโอ/ : /\b(?:images?|photos?|visuels?|illustrations?|affiches?|flyers?|medias?|dessins?|logos?|pictures?|posters?)\b|图片|รูป/;
  return (direct || need) && subject.test(value);
}

/** Provider choice stays server-owned and uses the existing Studio catalogue and tariffs. */
export function chooseInrAssistantMediaEngine(input: MediaInput): { imageEngine?: AiMediaImageEngine; videoEngine?: AiMediaVideoEngine } {
  const brief = input.prompt.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (input.mediaType === "video") {
    const dialogue = /\b(?:dialogue|parle|parler|dit|dire|voix|prononce|paroles|speech|speaking|narration)\b/.test(brief);
    const preferred = dialogue ? "minimax-h3" : "grok-lite";
    const engine = isAiMediaVideoEngineAvailable(preferred) ? preferred : "veo-lite";
    if (!isAiMediaVideoEngineAvailable(engine) || !getAiMediaVideoModel(engine).supportsTextToVideo) {
      throw new MediaToolError("La création vidéo est momentanément indisponible. Réessayez dans quelques instants.");
    }
    return { videoEngine: engine };
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
  } };
}

/** Instantiate once per assistant request and reuse the same tools across model fallbacks. */
export function createInrAssistantMediaTools(options: {
  request: Request;
  requestId: string;
  currentUserMessage?: string;
  canStartWork?: () => boolean;
  onWorkStarted?: (requestId: string) => void;
  onResult?: (result: InrAssistantMediaResult) => void;
}) {
  if (!REQUEST_PATTERN.test(options.requestId)) throw new Error("Invalid assistant media request ID.");
  const mediaRequestId = `assistant_${options.requestId}_media`;
  if (!REQUEST_PATTERN.test(mediaRequestId)) throw new Error("Invalid assistant media request ID.");
  let generation: Promise<InrAssistantMediaResult> | null = null;
  const denied = (mediaType: "image" | "video"): InrAssistantMediaResult => ({ ok: false, status: "failed", requestId: mediaRequestId,
    mediaType, libraryUrl: "/dashboard/mediatheque", message: "Précisez si vous souhaitez créer ou modifier ce média maintenant. Aucune génération n’a été lancée." });

  const recoverExisting = async (requestId: string, mediaType?: MediaInput["mediaType"]): Promise<InrAssistantMediaResult | null> => {
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

  const generate = async (raw: unknown, modification?: ModificationInput): Promise<InrAssistantMediaResult> => {
    const input: MediaInput = modification ? { mediaType: "image", prompt: modification.instruction } : parseInput(raw);
    let started = false;
    let readyItem: unknown = null;
    let creditsUsed: number | undefined;
    try {
      const existing = await recoverExisting(mediaRequestId, input.mediaType);
      if (existing) return existing;
      const engine: { imageEngine?: AiMediaImageEngine; videoEngine?: AiMediaVideoEngine } = modification ? { imageEngine: "openai" } : chooseInrAssistantMediaEngine(input);
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
      const source = modification ? await (await import("./inrAssistantMediaSource.ts")).loadInrAssistantImageReference(modification.sourceMediaId) : null;
      const payload = {
        contractVersion: 4, requestId: mediaRequestId, source: "studio", operation: "generate",
        creationMode: "free", freePrompt: input.prompt, useBusinessDna: true, inputMode: "essential",
        kind: input.mediaType, format, ...engine,
        ...(videoModel ? { durationSeconds, videoResolution: videoModel.defaultResolution, sceneMode: "single" } : {}),
        withMusic: false, withNarration: false, inspirationImages: [], identityMode: "auto", identityConsent: false,
        ...(source ? { operation: "modify", creationMode: "guided", format: source.format, aiInstruction: modification!.instruction,
          inspirationImages: [source.reference], modificationSourceWidth: source.width, modificationSourceHeight: source.height,
          textMode: "none", logoMode: "none", useBrandColors: false, useBusinessDna: false } : {}),
      };
      const normalized = normalizeAiMediaGenerationRequest(payload);
      const { POST: quotePOST } = await import("@/app/api/media-generation/quote/route");
      const quoted = await responseData(await quotePOST(makeRequest(options.request, "/api/media-generation/quote", {
        ...normalized, inspirationImagesCount: source ? 1 : 0,
      })));
      const quote = record(quoted.quote);
      creditsUsed = Number(quote.totalCredits);
      if (!Number.isSafeInteger(creditsUsed) || creditsUsed <= 0 || typeof quote.quoteId !== "string" || typeof quote.tariffVersion !== "string") {
        throw new MediaToolError("Le coût du média n’a pas pu être confirmé. Réessayez dans quelques instants.");
      }
      const remaining = record(quoted.credits).remaining;
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
      return await acceptDraft(options.request, mediaRequestId, readyItem, creditsUsed);
    } catch (error) {
      return {
        ok: false, status: readyItem ? "ready_to_save" : started && !(error instanceof MediaToolError) ? "processing" : "failed",
        requestId: mediaRequestId, mediaType: input.mediaType, libraryUrl: "/dashboard/mediatheque",
        ...(creditsUsed === undefined ? {} : { creditsUsed }),
        message: error instanceof MediaToolError ? error.message : started
          ? "La génération a été lancée. Vérifiez son état avant de relancer pour éviter un doublon."
          : "La création du média est momentanément indisponible. Aucun nouveau média n’a été confirmé.",
      };
    }
  };

  return {
    modifyMedia: tool({
      description: "Modifier réellement une image existante de Mes médias sur demande actuelle du professionnel, et enregistrer le résultat comme un nouveau média sans écraser l’original. Retrouver d’abord l’image avec searchMedia et utiliser son ID réel ; demander une précision si plusieurs images correspondent. Décris uniquement les changements demandés ; conservation du cadrage et vérification des crédits Studio. Les montages vidéo ne sont pas pris en charge par cette opération.",
      inputSchema: jsonSchema<ModificationInput>({ type: "object", properties: {
        sourceMediaId: { type: "string", description: "ID exact de l’image existante retrouvée par searchMedia." },
        instruction: { type: "string", minLength: 3, maxLength: 1_200 },
      }, required: ["sourceMediaId", "instruction"], additionalProperties: false }, { validate: (value) => {
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
      description: "Créer réellement une image ou une vidéo demandée par le pro et l’enregistrer dans sa Médiathèque. Écris toi-même le brief créatif précis à partir de son besoin et de son ADN : sujet, style, composition, texte et paroles exacts si demandés. Choisis le format et la durée adaptés ; le pro n’a pas à écrire un prompt ni choisir un fournisseur. Le serveur choisit un moteur Studio compatible et utilise les vrais crédits média du compte. Une seule création par demande ; ne pas lancer pour une simple question d’aide, ni annoncer un média enregistré avant le résultat completed.",
      inputSchema: jsonSchema<MediaInput>({
        type: "object", properties: {
          mediaType: { type: "string", enum: ["image", "video"] },
          prompt: { type: "string", minLength: 3, maxLength: 4_000 },
          format: { type: ["string", "null"], enum: [...FORMATS, null], description: "Format adapté au besoin du pro, ou null pour le format courant." },
          durationSeconds: { type: ["integer", "null"], minimum: 4, maximum: 30, description: "Durée vidéo en secondes ou null ; toujours null pour une image." },
        }, required: ["mediaType", "prompt", "format", "durationSeconds"], additionalProperties: false,
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
      description: "Retrouver l’état réel d’une création déjà lancée, sans nouvelle génération ni débit. Dès que son brouillon est prêt, l’enregistrer dans Mes médias. Utiliser uniquement le requestId fourni par l’outil de création ; ne pas inventer un résultat.",
      inputSchema: jsonSchema<{ requestId: string }>({
        type: "object", properties: { requestId: { type: "string", minLength: 8, maxLength: 179 } },
        required: ["requestId"], additionalProperties: false,
      }),
      execute: async ({ requestId }) => {
        const result = await recoverExisting(requestId);
        if (!result) throw new MediaToolError("Cette création est introuvable dans cet établissement. Aucun média n’a été relancé.");
        options.onResult?.(result);
        return result;
      },
      toModelOutput: ({ output }) => modelOutput(output),
    }),
  };
}
