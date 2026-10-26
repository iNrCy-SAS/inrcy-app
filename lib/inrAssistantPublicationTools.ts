import "server-only";

import { createHash } from "node:crypto";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOOSTER_PUBLICATION_CHANNELS, BOOSTER_PUBLICATION_CHANNEL_LABELS, type BoosterPublicationChannelKey as Channel } from "./boosterPublicationPolicy.ts";
import { BOOSTER_CHANNEL_CONTENT_RULES } from "./boosterChannelRules.ts";
import { classifyBoosterPublicationResult } from "./boosterPublicationOutcome.ts";

type Row = Record<string, unknown>;
type Post = { channel: Channel; title: string; content: string; cta?: string | null; hashtags?: string[] | null };
type PrepareInput = { posts: Post[]; mediaIds?: string[] | null; draftId?: string | null };
type ExecuteInput = { draftId: string; mode: "publish" | "schedule"; scheduledAt?: string | null; timezone?: string | null };
type EditInput = { publicationId: string; channel: Channel; title?: string | null; content?: string | null; hashtags?: string[] | null };
export type InrAssistantPublicationResult = {
  action: "prepare" | "publish" | "schedule" | "edit" | "status";
  ok: boolean;
  status: "draft" | "queued" | "scheduled" | "updated" | "unchanged" | "needs_clarification" | "blocked" | "unknown" | "failed" | "partial" | "published" | "processing";
  message: string; toolUrl: string; checkedAt: string;
  draftId?: string; publicationId?: string; scheduledActionId?: string; scheduledAt?: string;
  channels?: Array<{ channel: Channel; status: string }>;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SEND_URL = "/dashboard/mails?folder=publications";
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
class PublicationInputError extends Error {}
class PublicationReadError extends Error {}
const normalized = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new PublicationInputError("Référence de publication invalide.");
  return value.toLowerCase();
}
function strict(input: Row, keys: string[]) {
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new PublicationInputError("Critères de publication invalides.");
}
function text(value: unknown, maximum: number, nullable = false): string | undefined {
  if (value == null && nullable) return undefined;
  if (typeof value !== "string" || value.length > maximum || !value.trim()) throw new PublicationInputError("Texte de publication invalide.");
  return value.trim();
}
function tags(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== "string" || item.length > 60)) throw new PublicationInputError("Hashtags invalides.");
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}
function post(value: unknown): Post {
  const input = row(value); strict(input, ["channel", "title", "content", "cta", "hashtags"]);
  if (!BOOSTER_PUBLICATION_CHANNELS.includes(input.channel as Channel)) throw new PublicationInputError("Canal de publication invalide.");
  const channel = input.channel as Channel;
  if (input.cta != null && (typeof input.cta !== "string" || input.cta.length > 300)) throw new PublicationInputError("Appel à l’action invalide.");
  return { channel, title: text(input.title, 180)!, content: text(input.content, BOOSTER_CHANNEL_CONTENT_RULES[channel].max)!,
    cta: typeof input.cta === "string" ? input.cta.trim() : "", hashtags: tags(input.hashtags) ?? [] };
}
function prepareInput(value: unknown): PrepareInput {
  const input = row(value); strict(input, ["posts", "mediaIds", "draftId"]);
  if (!Array.isArray(input.posts) || input.posts.length < 1 || input.posts.length > 11) throw new PublicationInputError("Précisez le texte et les canaux de la publication.");
  const posts = input.posts.map(post);
  if (new Set(posts.map((item) => item.channel)).size !== posts.length) throw new PublicationInputError("Un seul texte par canal est attendu.");
  if (input.mediaIds != null && (!Array.isArray(input.mediaIds) || input.mediaIds.length > 4)) throw new PublicationInputError("Sélectionnez au plus quatre médias.");
  return { posts, mediaIds: input.mediaIds == null ? null : [...new Set((input.mediaIds as unknown[]).map(id))], draftId: input.draftId == null ? undefined : id(input.draftId) };
}
function executeInput(value: unknown): ExecuteInput {
  const input = row(value); strict(input, ["draftId", "mode", "scheduledAt", "timezone"]);
  if (input.mode !== "publish" && input.mode !== "schedule") throw new PublicationInputError("Choisissez publier ou programmer.");
  if (input.scheduledAt != null && (typeof input.scheduledAt !== "string" || input.scheduledAt.length > 40)) throw new PublicationInputError("Date invalide.");
  if (input.timezone != null && (typeof input.timezone !== "string" || input.timezone.length > 70)) throw new PublicationInputError("Fuseau horaire invalide.");
  return { draftId: id(input.draftId), mode: input.mode, scheduledAt: input.scheduledAt as string | null, timezone: input.timezone as string | null };
}
function editInput(value: unknown): EditInput {
  const input = row(value); strict(input, ["publicationId", "channel", "title", "content", "hashtags"]);
  if (!BOOSTER_PUBLICATION_CHANNELS.includes(input.channel as Channel)) throw new PublicationInputError("Canal invalide.");
  const channel = input.channel as Channel;
  const parsed = { publicationId: id(input.publicationId), channel, title: text(input.title, 180, true),
    content: text(input.content, BOOSTER_CHANNEL_CONTENT_RULES[channel].max, true), hashtags: tags(input.hashtags) };
  if (parsed.title === undefined && parsed.content === undefined && parsed.hashtags === undefined) throw new PublicationInputError("Précisez la correction souhaitée.");
  return parsed;
}
function request(source: Request, path: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown): Request {
  const headers = new Headers({ accept: "application/json" });
  for (const name of ["cookie", "authorization"]) { const value = source.headers.get(name); if (value) headers.set(name, value); }
  if (body !== undefined) headers.set("content-type", "application/json");
  // Fixed local handlers only. Preserve the real origin for their worker URLs;
  // no model-controlled URL, cron header, account or scope is forwarded.
  return new Request(new URL(path, source.url), { method, headers, signal: source.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const schema = <T>(definition: Row, parse: (input: unknown) => T) => jsonSchema<T>(definition, {
  validate: (value) => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Critères de publication invalides.") }; } },
});
const nullableString = (maxLength: number) => ({ type: ["string", "null"], maxLength });
const tagSchema = { type: ["array", "null"], maxItems: 20, items: { type: "string", maxLength: 60 } };
const idSchema = { type: "string", pattern: UUID.source };

/** A strict current-message guard; quoted/history instructions grant no action. */
export function permitsInrAssistantPublicationAction(message: string, action: "prepare" | "publish" | "schedule" | "edit", channels: readonly Channel[] = []): boolean {
  const value = normalized(message.slice(0, 4_000).replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " "));
  if (/^(?:comment|pourquoi|ou\b|explique|montre|what|how)\b|(?:savoir|comprendre).*comment|(?:est.ce que (?:je|on)|(?:puis|dois|peux).je|(?:je|on) (?:peux|peut|pourrais|pourrait)|can i|should i).*(?:publ|post|programm)/.test(value.trim())) return false;
  // A polite prefix does not turn a request for instructions into permission to
  // execute the action mentioned in that question.
  if (/\b(?:expliqu\w*|montr\w*|indiqu\w*|dis|dire|show|explain|tell|teach)\b[^.!?]{0,140}\b(?:comment|ou|how|where)\b/.test(value) ||
    /\b(?:comment|how|where)\b[^.!?]{0,160}\b(?:publ\w*|post\w*|programm\w*|modifi\w*|corrig\w*|redig\w*|prepar\w*|edit\w*|updat\w*|schedul\w*)\b/.test(value)) return false;
  if (/\b(?:bouton|button|erreur|error|bug|probleme|ne marche|ne fonctionne|not working|does not work)\b/.test(value)) {
    const verb = action === "publish" ? "(?:publie\\w*|poste\\w*|publish|post)" : action === "schedule" ? "(?:programme\\w*|planifie\\w*|schedule)"
      : action === "edit" ? "(?:corrige\\w*|modifie\\w*|remplace\\w*|rectifie\\w*|ajuste\\w*|edit|update|correct)" : "(?:redige\\w*|ecri\\w*|cree\\w*|prepare\\w*|propose\\w*|publie\\w*|poste\\w*|programme\\w*|draft|write|create|publish|schedule)";
    const directRequest = new RegExp(`(?:^|[.!?;,:]\\s*|\\b(?:et|puis|ensuite|please)\\s+)\\s*${verb}\\b|\\b(?:(?:peux|pourrais)[- ]tu|tu (?:peux|pourrais)|je veux que tu|j.aimerais que tu|(?:can|could|would) you)\\s+(?:me\\s+|please\\s+)?${verb}\\b`);
    if (!directRequest.test(value)) return false;
  }
  const later = /\b(?:demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|dans \d+|le \d{1,2}|\d{4}-\d{2}-\d{2})\b/.test(value);
  if (action === "publish" && (/(?:ne\s+publie|ne\s+poste|sans\s+publier|(?:pas|jamais).{0,45}(?:publ|post)|do\s+not\s+(?:publish|post))/.test(value) || later && !/\b(?:maintenant|immediatement|now)\b/.test(value))) return false;
  if (action === "schedule" && /(?:ne\s+programme|sans\s+programmer|pas\s+programmer|do\s+not\s+schedule)/.test(value)) return false;
  if (action === "edit" && /(?:ne\s+modifie|sans\s+modifier|pas\s+modifier)/.test(value)) return false;
  const intent = action === "prepare" ? /\b(?:redig\w*|ecri\w*|cree\w*|crea\w*|prepar\w*|brouillon\w*|propose\w*|publie\w*|post\w*|programm\w*|draft|write|create|publish|schedule)\b/
    : action === "publish" ? /\b(?:publie\w*|publia\w*|poster|poste\w*|publish|post)\b/
      : action === "schedule" ? later ? /\b(?:programm\w*|planifi\w*|schedule|publie\w*|post\w*)\b/ : /\b(?:programm\w*|planifi\w*|schedule)\b/
        : /\b(?:corrig\w*|modifi\w*|remplac\w*|rectifi\w*|ajust\w*|edite\w*|edit|update|correct)\b/;
  if (!intent.test(value)) return false;
  if (action === "schedule" && (!/\b(?:demain|aujourd.hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}|le \d{1,2})\b/.test(value) ||
    !/\b(?:[01]?\d|2[0-3])\s*(?:h(?:\s*[0-5]\d)?|:[0-5]\d)\b|\b(?:huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix.sept|dix.huit|dix.neuf|vingt) heures?\b/.test(value))) return false;
  if (action === "prepare" || action === "edit" || !channels.length || /(?:\bbrouillon\b|tous? (?:mes |les )?canaux|tous? (?:mes |les )?reseaux|partout|all (?:my )?channels)/.test(value)) return true;
  const names: Record<Channel, RegExp> = { site_web: /\bsite(?: web)?\b/, inr_search: /inr.?search/, gmb: /\b(?:google|gmb)\b/, facebook: /\b(?:facebook|fb)\b/,
    instagram: /\b(?:instagram|insta)\b/, threads: /\bthreads\b/, linkedin: /\blinkedin\b/, tiktok: /\btiktok\b/,
    youtube_shorts: /\byoutube\b/, pinterest: /\bpinterest\b/, x: /\b(?:twitter|x)\b/ };
  return channels.every((channel) => names[channel].test(value));
}

export function createInrAssistantPublicationTools(options: {
  request: Request; accountId: string; supabase: Pick<SupabaseClient, "from">;
  actionRequestId: string; currentUserMessage: string; canStartWork?: () => boolean;
  onResult?: (result: InrAssistantPublicationResult) => void;
}) {
  const accountId = id(options.accountId);
  if (!options.actionRequestId || options.actionRequestId.length > 180 || typeof options.currentUserMessage !== "string") throw new PublicationInputError("Contexte de publication invalide.");
  const hash = createHash("sha256").update(`${accountId}:${options.actionRequestId}`).digest("hex");
  const receipt = `assistant-publication:v1:${hash}`;
  const publishKey = `booster_manual:assistant:${hash}`;
  const rawUuid = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  const scheduleId = `${rawUuid.slice(0, 8)}-${rawUuid.slice(8, 12)}-${rawUuid.slice(12, 16)}-${rawUuid.slice(16, 20)}-${rawUuid.slice(20)}`;
  const singleflight = new Map<string, { fingerprint: string; promise: Promise<InrAssistantPublicationResult> }>();
  const result = (action: InrAssistantPublicationResult["action"], status: InrAssistantPublicationResult["status"], message: string, extra: Partial<InrAssistantPublicationResult> = {}): InrAssistantPublicationResult => ({
    action, ok: ["draft", "queued", "scheduled", "updated", "unchanged", "published", "processing", "partial"].includes(status), status, message,
    toolUrl: action === "prepare" ? "/dashboard?action=publish" : SEND_URL, checkedAt: new Date().toISOString(), ...extra,
  });
  async function access(action: InrAssistantPublicationResult["action"], write = true) {
    const { requireUser } = await import("@/lib/requireUser");
    const auth = await requireUser();
    if (auth.errorResponse || auth.activeUserId !== accountId || !auth.authUserId) return result(action, "blocked", "La session ou l’établissement actif doit être vérifié avant cette action.");
    if (!write) return null;
    const { getActiveSubscriptionAccountIds } = await import("@/lib/accountSubscriptionAccess");
    const active = await getActiveSubscriptionAccountIds([accountId]);
    if (!active.has(accountId)) return result(action, "blocked", "Cette action nécessite un essai en cours ou un abonnement actif. Je peux vous aider à consulter votre abonnement.");
    if (options.canStartWork && !options.canStartWork()) return result(action, "blocked", "Cette demande a pris trop de temps. Vérifions son état avant de lancer une nouvelle action.");
    return null;
  }
  async function once(action: InrAssistantPublicationResult["action"], input: unknown, operation: () => Promise<InrAssistantPublicationResult>) {
    const fingerprint = JSON.stringify(input);
    const slot = action === "publish" || action === "schedule" ? "execute" : action;
    const previous = singleflight.get(slot);
    if (previous) return previous.fingerprint === fingerprint ? previous.promise : result(action, "needs_clarification", "Une action de ce type a déjà été traitée dans cette demande. Précisez la nouvelle modification dans un nouveau message.");
    const promise = (async () => {
      let answer: InrAssistantPublicationResult;
      try { answer = await operation(); }
      catch { answer = result(action, "unknown", "L’état de cette action n’a pas pu être confirmé. Vérifiez iNr’Send ou le brouillon avant toute nouvelle tentative ; rien n’a été relancé automatiquement."); }
      try { options.onResult?.(answer); } catch { /* A UI callback cannot replay business work. */ }
      return answer;
    })();
    singleflight.set(slot, { fingerprint, promise });
    return promise;
  }
  async function read(operation: () => PromiseLike<unknown>): Promise<Row> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = row(await Promise.race([Promise.resolve(operation()), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PublicationReadError()), 5_000); })]));
      if (response.error) throw new PublicationReadError();
      return response;
    } finally { if (timer) clearTimeout(timer); }
  }
  function beforeMutation(action: InrAssistantPublicationResult["action"]) {
    return options.request.signal.aborted || options.canStartWork && !options.canStartWork()
      ? result(action, "blocked", "La demande a été interrompue ou a pris trop de temps avant l’action. Aucune nouvelle opération n’a été lancée.") : null;
  }
  async function draft(draftId: string) {
    const { GET } = await import("@/app/api/booster/events/route");
    const response = await GET(request(options.request, `/api/booster/events?draftId=${draftId}`));
    const data = row(await response.json());
    if (!response.ok || data.ok !== true) throw new PublicationReadError();
    return row(data.payload);
  }
  async function media(ids: string[]) {
    if (!ids.length) return { images: [] as Row[], video: null as Row | null };
    const response = await read(() => options.supabase.from("pro_media_library")
      .select("id,user_id,bucket_name,storage_path,media_type,mime_type,size_bytes,duration_seconds,original_file_name,title")
      .eq("user_id", accountId).eq("is_active", true).neq("source", "ai_media_generation_draft").in("id", ids).limit(4));
    if (!Array.isArray(response.data) || response.data.length !== ids.length) throw new PublicationReadError();
    const rows = response.data;
    const { buildMediaLibraryContentUrl } = await import("@/lib/mediaLibraryContentUrl");
    const selected = ids.map((mediaId) => {
      const item = rows.find((entry: unknown) => row(entry).id === mediaId) as Row | undefined;
      if (!item || item.user_id !== accountId || item.bucket_name !== "inrcy-pro-media" ||
        typeof item.storage_path !== "string" || !item.storage_path.startsWith(`users/${accountId}/`) || item.storage_path.includes("..") ||
        !["image", "video"].includes(String(item.media_type))) throw new PublicationReadError();
      const relative = buildMediaLibraryContentUrl(mediaId);
      if (!relative) throw new PublicationReadError();
      return { mediaId, name: String(item.original_file_name || item.title || "Média").slice(0, 180), type: String(item.mime_type || ""),
        storagePath: item.storage_path, bucket: "inrcy-pro-media", publicUrl: new URL(relative, options.request.url).toString(),
        size: Number(item.size_bytes) || 0, duration: Number(item.duration_seconds) || null, kind: item.media_type };
    });
    const videos = selected.filter((item) => item.kind === "video");
    if (videos.length && (videos.length !== 1 || selected.length !== 1)) throw new PublicationInputError("Choisissez des images ou une seule vidéo pour cette publication.");
    return { images: selected.filter((item) => item.kind === "image") as Row[], video: videos[0] ?? null };
  }
  function storedPosts(payload: Row): Post[] {
    const channels = Array.isArray(payload.channels) ? payload.channels : [];
    const posts = row(payload.postByChannel);
    return prepareInput({ posts: channels.map((channel) => {
      const stored = row(posts[String(channel)]);
      return { channel, title: stored.title || payload.title, content: stored.content || stored.text || stored.message, cta: stored.cta ?? "", hashtags: stored.hashtags ?? [] };
    }), mediaIds: null, draftId: null }).posts;
  }
  function postedPayload(posts: Post[], assets: Awaited<ReturnType<typeof media>>) {
    const postByChannel = Object.fromEntries(posts.map(({ channel, ...content }) => [channel, { ...content, cta: content.cta || "", hashtags: content.hashtags ?? [] }]));
    return { creationMode: "manual", source: "booster", origin: { source: "booster", label: "iNr’Assistant", workflowTool: "booster", workflowAction: "publier" },
      channels: posts.map(({ channel }) => channel), postByChannel, post: row(postByChannel[posts[0].channel]), idea: posts[0].content.slice(0, 500),
      mediaType: assets.video ? "video" : "images", images: assets.images, video: assets.video,
      mediaModeByChannel: Object.fromEntries(posts.map(({ channel }) => [channel, assets.video ? "video" : assets.images.length ? "images" : "none"])) };
  }
  function actionFailure(action: InrAssistantPublicationResult["action"], response: Response) {
    return result(action, response.status >= 500 ? "unknown" : "blocked", response.status === 404 ? "Cette publication ou ce brouillon n’a pas été retrouvé dans cet établissement."
      : response.status === 409 ? "L’application a refusé cette action pour éviter un conflit, un doublon ou une opération non prise en charge. Vérifiez le détail dans iNr’Send."
        : response.status === 429 ? "Une limite temporaire a été atteinte. Vérifiez l’état de la demande avant de réessayer plus tard."
          : "L’application n’a pas confirmé cette action. Vérifiez les paramètres, l’accès et l’état du canal dans l’outil.");
  }
  function statusProjection(data: Row): InrAssistantPublicationResult {
    const entries = Array.isArray(row(data.summary).entries) ? row(data.summary).entries as unknown[] : [];
    const channels = entries.flatMap((value) => {
      const entry = row(value);
      if (!BOOSTER_PUBLICATION_CHANNELS.includes(entry.channel as Channel)) return [];
      const state = ["published", "published_with_warning", "processing", "failed"].includes(String(entry.status)) ? String(entry.status)
        : ["queued", "preparing", "running", "pending", "finalizing"].includes(String(entry.status)) ? "processing" : "unknown";
      return [{ channel: entry.channel as Channel, status: state }];
    });
    if (!channels.length) for (const channel of BOOSTER_PUBLICATION_CHANNELS) {
      const value = row(row(data.results)[channel]);
      if (Object.keys(value).length) channels.push({ channel, status: classifyBoosterPublicationResult(value).status });
    }
    const processing = data.done !== true || channels.some((entry) => entry.status === "processing" || entry.status === "unknown");
    const failed = channels.filter((entry) => entry.status === "failed").length;
    const status = processing ? "processing" : failed === channels.length && failed > 0 ? "failed" : failed > 0 ? "partial" : channels.length ? "published" : "unknown";
    const publicationId = typeof data.publication_id === "string" && UUID.test(data.publication_id) ? data.publication_id : undefined;
    return result("status", status, status === "processing" ? "La publication est encore en cours ou doit être vérifiée. Ne pas la republier."
      : status === "published" ? "Les canaux indiqués ont confirmé la publication ; vérifiez les éventuels avertissements dans iNr’Send."
        : status === "partial" ? "Certains canaux ont publié et d’autres ont échoué. Ne relancez pas ceux qui ont déjà réussi."
          : status === "failed" ? "Les canaux indiqués signalent un échec. Vérifiez le détail avant de décider d’une nouvelle tentative."
            : "L’état final n’est pas suffisamment renseigné pour confirmer la publication.", { publicationId, channels });
  }

  return {
    preparePublication: tool({ strict: true,
      description: "Rédiger des textes adaptés puis enregistrer un vrai brouillon Booster, uniquement sur la demande actuelle de création/rédaction. posts contient un texte par canal choisi ; mediaIds uniquement des IDs actifs de Médiathèque, jamais des URLs. Aucun envoi ni programmation. draftId=null crée, sinon corrige ce brouillon en conservant ses autres canaux. mediaIds=null conserve ses médias ; [] les retire seulement sur demande explicite. Retourne l’ID pour executePublication ou un lien de vérification.",
      inputSchema: schema<PrepareInput>({ type: "object", properties: {
        posts: { type: "array", minItems: 1, maxItems: 11, items: { type: "object", properties: { channel: { type: "string", enum: BOOSTER_PUBLICATION_CHANNELS }, title: { type: "string", maxLength: 180 }, content: { type: "string", maxLength: 5_000 }, cta: nullableString(300), hashtags: tagSchema }, required: ["channel", "title", "content", "cta", "hashtags"], additionalProperties: false } },
        mediaIds: { type: ["array", "null"], maxItems: 4, items: idSchema }, draftId: { anyOf: [idSchema, { type: "null" }] },
      }, required: ["posts", "mediaIds", "draftId"], additionalProperties: false }, prepareInput),
      execute: async (raw) => {
        const input = prepareInput(raw);
        return once("prepare", input, async () => {
          if (!permitsInrAssistantPublicationAction(options.currentUserMessage, "prepare")) return result("prepare", "needs_clarification", "Voulez-vous que j’enregistre un brouillon ? Précisez le sujet et les canaux souhaités.");
          const denied = await access("prepare"); if (denied) return denied;
          let previousPayload: Row = {};
          if (!input.draftId) {
            const previous = await read(() => options.supabase.from("app_events").select("id").eq("user_id", accountId).eq("module", "booster").eq("type", "publish_draft")
              .contains("payload", { assistantActionKey: receipt }).limit(1).maybeSingle());
            const previousId = row(previous.data).id;
            if (typeof previousId === "string" && UUID.test(previousId)) return result("prepare", "draft", "Le brouillon de cette demande existe déjà. Aucun doublon n’a été créé.", { draftId: previousId, toolUrl: `/dashboard?action=publish&draftId=${previousId}` });
          } else previousPayload = await draft(input.draftId);
          const hasPreviousMedia = Boolean(previousPayload.videoDraft || (Array.isArray(previousPayload.imageDrafts) && previousPayload.imageDrafts.length));
          if (input.draftId && hasPreviousMedia && input.mediaIds?.length === 0 && !/(?:sans (?:image|video|media)|texte seul|(?:retire|supprime|enleve).{0,25}(?:image|video|media))/i.test(normalized(options.currentUserMessage))) return result("prepare", "needs_clarification", "Le brouillon contient déjà des médias. Souhaitez-vous les conserver ou les retirer ? Aucun média n’a été supprimé.", { draftId: input.draftId });
          const mediaIds = input.mediaIds ?? (Array.isArray(previousPayload.assistantMediaIds) ? previousPayload.assistantMediaIds.map(id) : []);
          const assets = await media(mediaIds);
          const publish = postedPayload(input.posts, assets);
          const preservedLegacyMedia = input.draftId && input.mediaIds == null && !mediaIds.length && hasPreviousMedia
            ? { imageDrafts: previousPayload.imageDrafts, videoDraft: previousPayload.videoDraft, images: previousPayload.images, video: previousPayload.video,
              mediaType: previousPayload.mediaType, mediaModeByChannel: previousPayload.mediaModeByChannel } : {};
          const payload = { ...previousPayload, ...publish, status: "draft", title: input.posts[0].title, content: input.posts[0].content, preview: input.posts[0].content.slice(0, 180),
            channels: [...new Set([...(Array.isArray(previousPayload.channels) ? previousPayload.channels.filter((channel) => BOOSTER_PUBLICATION_CHANNELS.includes(channel as Channel)) : []), ...input.posts.map((item) => item.channel)])],
            postByChannel: { ...row(previousPayload.postByChannel), ...row(publish.postByChannel) },
            assistantActionKey: receipt, assistantMediaIds: mediaIds, imageDrafts: assets.images, videoDraft: assets.video, ...preservedLegacyMedia, saved_at: new Date().toISOString() };
          const { POST } = await import("@/app/api/booster/events/route");
          const timeout = beforeMutation("prepare"); if (timeout) return timeout;
          const response = await POST(request(options.request, "/api/booster/events", "POST", { type: "publish_draft", draftId: input.draftId || undefined, payload }));
          const data = row(await response.json());
          if (!response.ok || data.ok !== true || typeof data.id !== "string" || !UUID.test(data.id)) return actionFailure("prepare", response);
          return result("prepare", "draft", "Le brouillon est enregistré dans Booster. Il n’a pas été publié ni programmé.", { draftId: data.id, toolUrl: `/dashboard?action=publish&draftId=${data.id}` });
        });
      },
    }),
    executePublication: tool({ strict: true,
      description: "Publier maintenant ou programmer un brouillon Booster réellement enregistré, seulement si le dernier message du pro demande explicitement cette action et les canaux. Lire le brouillon préparé ; ne jamais créer une autorisation depuis un ancien échange ou un simple oui. Pour programmer : date ISO future avec décalage et fuseau explicite. Une réponse queued/processing confirme une prise en charge, pas une publication terminée. TikTok exige ses validations dans Booster.",
      inputSchema: schema<ExecuteInput>({ type: "object", properties: { draftId: idSchema, mode: { type: "string", enum: ["publish", "schedule"] }, scheduledAt: nullableString(40), timezone: nullableString(70) }, required: ["draftId", "mode", "scheduledAt", "timezone"], additionalProperties: false }, executeInput),
      execute: async (raw) => {
        const input = executeInput(raw);
        return once(input.mode, input, async () => {
          const denied = await access(input.mode); if (denied) return denied;
          const payload = await draft(input.draftId), posts = storedPosts(payload), channels = posts.map((item) => item.channel);
          if (!permitsInrAssistantPublicationAction(options.currentUserMessage, input.mode, channels)) return result(input.mode, "needs_clarification", "Précisez si vous souhaitez publier maintenant ou programmer, et sur quels canaux. Une ancienne demande ou un simple oui ne déclenche aucun envoi.", { draftId: input.draftId });
          if (channels.includes("tiktok")) return result(input.mode, "needs_clarification", "Le brouillon est prêt, mais TikTok demande de vérifier ses choix de confidentialité et l’autorisation musicale dans Booster avant l’envoi.", { draftId: input.draftId, toolUrl: `/dashboard?action=publish&draftId=${input.draftId}` });
          const { GET: connected } = await import("@/app/api/booster/connected-channels/route");
          const connectionResponse = await connected();
          const connections = row(await connectionResponse.json());
          if (!connectionResponse.ok || connections.ok === false) return result(input.mode, "unknown", "Les canaux connectés ne peuvent pas être vérifiés. Aucune publication ni programmation n’a été lancée.");
          const disconnected = channels.filter((channel) => row(connections.channels)[channel] !== true);
          if (disconnected.length) return result(input.mode, "blocked", `Vérifiez la connexion ou l’accès de ces canaux avant l’envoi : ${disconnected.map((channel) => BOOSTER_PUBLICATION_CHANNEL_LABELS[channel]).join(", ")}.`, { toolUrl: "/dashboard?action=channels" });
          const mediaIds = Array.isArray(payload.assistantMediaIds) ? payload.assistantMediaIds.map(id) : [];
          if (!mediaIds.length && ((Array.isArray(payload.imageDrafts) && payload.imageDrafts.length) || payload.videoDraft)) return result(input.mode, "needs_clarification", "Ce brouillon contient des médias à vérifier dans Booster. Choisissez des médias de la Médiathèque pour le publier depuis l’assistant.", { toolUrl: `/dashboard?action=publish&draftId=${input.draftId}` });
          const assets = await media(mediaIds);
          if ((channels.includes("youtube_shorts") && !assets.video) || (channels.some((channel) => ["instagram", "pinterest"].includes(channel)) && !assets.video && !assets.images.length)) return result(input.mode, "needs_clarification", "Un média adapté est nécessaire pour ces canaux : YouTube nécessite une vidéo, Instagram et Pinterest une image ou une vidéo.", { draftId: input.draftId });
          const publish = postedPayload(posts, assets);
          if (input.mode === "schedule") {
            const date = typeof input.scheduledAt === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(input.scheduledAt) ? Date.parse(input.scheduledAt) : NaN;
            if (!Number.isFinite(date) || date < Date.now() + 60_000 || !input.timezone) return result("schedule", "needs_clarification", "Précisez la date, l’heure et le fuseau de programmation. La date doit être dans le futur.");
            try { new Intl.DateTimeFormat("fr-FR", { timeZone: input.timezone }); } catch { return result("schedule", "needs_clarification", "Précisez un fuseau horaire valide pour cette programmation."); }
            const { GET, POST } = await import("@/app/api/agent/scheduled-actions/route");
            const previous = await GET(request(options.request, `/api/agent/scheduled-actions?requestId=${scheduleId}`));
            if (previous.ok) {
              const previousData = row(await previous.json()), saved = row(previousData.scheduledAction);
              if (saved.id === scheduleId) return result("schedule", saved.status === "scheduled" ? "scheduled" : "unknown", "Cette programmation existe déjà ; son état enregistré a été conservé sans créer de doublon.", { scheduledActionId: scheduleId, scheduledAt: String(saved.scheduledAt || "") });
              return result("schedule", "unknown", "La programmation précédente doit être vérifiée avant toute nouvelle création.");
            }
            if (previous.status !== 404 || row(await previous.json()).tableMissing !== false) return actionFailure("schedule", previous);
            const scheduledAt = new Date(date).toISOString();
            const timeout = beforeMutation("schedule"); if (timeout) return timeout;
            const response = await POST(request(options.request, "/api/agent/scheduled-actions", "POST", { scheduleRequestId: scheduleId, automationKey: "publish", actionType: "publication", targetTool: "booster", source: "manual",
              title: posts[0].title, summary: "Publication programmée avec iNr’Assistant", scheduledAt, timezone: input.timezone, channels,
              payload: { creationMode: "manual", kind: "manual_publish_schedule", origin: { source: "booster_scheduled", label: "iNr’Assistant", workflowTool: "booster", workflowAction: "publier" }, publishPayload: { ...publish, source: "booster_scheduled" } } }));
            const data = row(await response.json()), saved = row(data.scheduledAction);
            if (!response.ok || saved.id !== scheduleId || saved.status !== "scheduled") return actionFailure("schedule", response);
            return result("schedule", "scheduled", "La publication est programmée. Elle n’est pas encore publiée.", { scheduledActionId: scheduleId, scheduledAt, draftId: input.draftId });
          }
          const { POST } = await import("@/app/api/booster/publish-now/route");
          const timeout = beforeMutation("publish"); if (timeout) return timeout;
          const response = await POST(request(options.request, "/api/booster/publish-now", "POST", { ...publish, idempotencyKey: publishKey }));
          const data = row(await response.json());
          if (!response.ok || typeof data.publication_id !== "string" || !UUID.test(data.publication_id)) return actionFailure("publish", response);
          const projected = statusProjection(data);
          return { ...projected, action: "publish", draftId: input.draftId,
            ...(response.status === 202 ? { ok: true, status: "queued" as const, message: "La publication a été prise en charge en arrière-plan. Les résultats par canal doivent encore être vérifiés dans iNr’Send." } : {}) };
        });
      },
    }),
    editPublication: tool({ strict: true,
      description: "Corriger le texte d’une publication existante sur un canal, uniquement sur demande actuelle explicite. Réutilise le traitement réel iNr’Send et conserve ses médias. X et TikTok ne permettent pas cette modification ; Threads publié peut également la refuser. Ne jamais remplacer une publication refusée par une nouvelle. Les champs null sont conservés. Après un résultat incertain, vérifier iNr’Send avant de réessayer.",
      inputSchema: schema<EditInput>({ type: "object", properties: { publicationId: idSchema, channel: { type: "string", enum: BOOSTER_PUBLICATION_CHANNELS }, title: nullableString(180), content: nullableString(5_000), hashtags: tagSchema }, required: ["publicationId", "channel", "title", "content", "hashtags"], additionalProperties: false }, editInput),
      execute: async (raw) => {
        const input = editInput(raw);
        return once("edit", input, async () => {
          if (!permitsInrAssistantPublicationAction(options.currentUserMessage, "edit")) return result("edit", "needs_clarification", "Précisez la publication, le canal et la correction souhaitée avant de la modifier.");
          if (["x", "tiktok", "youtube_shorts"].includes(input.channel)) return result("edit", "blocked", "Ce canal ne permet pas cette correction depuis iNr’Send. Ouvrez la publication sur la plateforme pour vérifier les possibilités.");
          const denied = await access("edit"); if (denied) return denied;
          const publication = await read(() => options.supabase.from("publications").select("id,title,content,hashtags").eq("id", input.publicationId).eq("user_id", accountId).maybeSingle());
          if (!publication.data) return result("edit", "blocked", "Cette publication n’a pas été retrouvée dans cet établissement.");
          const events = await read(() => options.supabase.from("app_events").select("payload").eq("user_id", accountId).eq("module", "booster").eq("type", "publish")
            .contains("payload", { publication_id: input.publicationId }).order("created_at", { ascending: false }).limit(1).maybeSingle());
          const event = row(row(events.data).payload), current = row(row(event.postByChannel)[input.channel] || event.post || publication.data);
          const previousResult = row(row(event.results)[input.channel]);
          if (previousResult.pending === true || /(?:unknown|pending|processing|queued)/i.test(String(previousResult.code || previousResult.status || ""))) return result("edit", "unknown", "L’état de ce canal est encore incertain ou en cours. Vérifiez-le dans iNr’Send avant toute nouvelle modification.", { publicationId: input.publicationId });
          const unchanged = (input.title === undefined || input.title === current.title) && (input.content === undefined || input.content === current.content) &&
            (input.hashtags === undefined || JSON.stringify(input.hashtags) === JSON.stringify(current.hashtags || []));
          if (unchanged) return result("edit", "unchanged", "Le texte enregistré correspond déjà à cette correction. Aucun nouvel appel de modification n’a été effectué.", { publicationId: input.publicationId });
          const { createPublicationChannelHandlers } = await import("@/lib/inrsend/publicationChannelActions");
          const handlers = createPublicationChannelHandlers(input.channel as Parameters<typeof createPublicationChannelHandlers>[0]);
          const { publicationId, channel, ...patch } = input;
          const timeout = beforeMutation("edit"); if (timeout) return timeout;
          const response = await handlers.PATCH(request(options.request, `/api/inrsend/publications/${publicationId}/${channel.replace("_", "-")}`, "PATCH", patch), { params: Promise.resolve({ publicationId }) });
          const data = row(await response.json());
          if (!response.ok || data.ok !== true) return actionFailure("edit", response);
          return result("edit", "updated", "La correction a été confirmée par iNr’Send pour ce canal.", { publicationId, channels: [{ channel, status: "updated" }] });
        });
      },
    }),
    getPublicationStatus: tool({ strict: true,
      description: "Vérifier le résultat réellement enregistré d’une publication de cet établissement, sans la republier : état en cours, échecs, réussites ou succès partiels par canal. Un état enregistré n’est pas une nouvelle vérification indépendante chez le fournisseur.",
      inputSchema: schema<{ publicationId: string }>({ type: "object", properties: { publicationId: idSchema }, required: ["publicationId"], additionalProperties: false }, (value) => { const input = row(value); strict(input, ["publicationId"]); return { publicationId: id(input.publicationId) }; }),
      execute: async (raw) => {
        strict(row(raw), ["publicationId"]);
        const publicationId = id(raw.publicationId);
        const denied = await access("status", false); if (denied) return denied;
        try {
          const { GET } = await import("@/app/api/booster/publications/[publicationId]/status/route");
          const response = await GET(request(options.request, `/api/booster/publications/${publicationId}/status`), { params: Promise.resolve({ publicationId }) });
          const data = row(await response.json());
          return response.ok ? statusProjection(data) : actionFailure("status", response);
        } catch { return result("status", "unknown", "L’état de cette publication ne peut pas être vérifié pour le moment. Ne pas la republier automatiquement."); }
      },
    }),
  };
}
