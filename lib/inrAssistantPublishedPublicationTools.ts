import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { getActiveSubscriptionAccountIds } from "./accountSubscriptionAccess";
import { createAssistantActionPreview, verifyAssistantActionPreview, hasAssistantActionApproval, assistantActionFingerprint } from "./inrAssistantActionPreview.ts";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";
import { sanitizeInrAssistantMemoryText } from "./inrAssistantMemory.ts";
import { INR_MEDIA_IMAGE_MAX_BYTES, INR_MEDIA_PUBLICATION_IMAGES_TOTAL_MAX_BYTES, INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES } from "./mediaRules.ts";
import { BOOSTER_CHANNEL_CONTENT_RULES } from "./boosterChannelRules.ts";
import { parseInrAssistantPublicationCtaPatch, isInrAssistantPublicationCtaPatchValid } from "./inrAssistantPublicationCtaPatch.ts";
import { normalizePublicationEditHashtag } from "./inrsend/publicationEditVersion.ts";

type Row = Record<string, unknown>;
const CHANNELS = ["site_web", "inr_search", "gmb", "facebook", "instagram", "linkedin", "pinterest"] as const;
type Channel = typeof CHANNELS[number];
type Change = { field: "title" | "content" | "hashtags" | "cta" | "media"; valueJson: string };
type Target = { publicationId: string; channel: Channel };
type Preview = Target & { sourceVersion: string; changes: Change[]; instructionQuote: string };
type MediaSource = { currentIndex: number } | { mediaId: string };
type MediaChange = { mediaType: "images"; images: MediaSource[] } | { mediaType: "video"; mediaId: string };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LINK = { label: "Publications iNr’Send", href: "/dashboard/mails?folder=publications" };
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const safe = (value: unknown, maximum = 180) => sanitizeInrAssistantMemoryText(typeof value === "string" ? value : "", maximum);
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Invalid input"); return input; }
function target(value: unknown): Target { const input = row(value); if (typeof input.publicationId !== "string" || !UUID.test(input.publicationId) || !CHANNELS.includes(input.channel as Channel)) throw new Error("Invalid publication"); return { publicationId: input.publicationId, channel: input.channel as Channel }; }
function quote(value: unknown) { if (typeof value !== "string" || !value.trim() || value.length > 1200) throw new Error("Invalid instruction"); return value.trim(); }
function mediaChange(value: unknown): MediaChange {
  const input = row(value);
  if (input.mediaType === "video") { fields(input, ["mediaType", "mediaId"]); if (typeof input.mediaId !== "string" || !UUID.test(input.mediaId)) throw new Error("Invalid video"); return input as MediaChange; }
  fields(input, ["mediaType", "images"]);
  if (input.mediaType !== "images" || !Array.isArray(input.images) || input.images.length > 5) throw new Error("Invalid images");
  const images: MediaSource[] = input.images.map(value => { const source = row(value); if (Object.keys(source).length !== 1) throw new Error("Invalid image source"); if (typeof source.mediaId === "string" && UUID.test(source.mediaId)) return { mediaId: source.mediaId }; if (Number.isInteger(source.currentIndex) && Number(source.currentIndex) >= 0 && Number(source.currentIndex) < 5) return { currentIndex: Number(source.currentIndex) }; throw new Error("Invalid image source"); });
  if (new Set(images.map(value => JSON.stringify(value))).size !== images.length) throw new Error("Duplicate source");
  let librarySeen = false; for (const source of images) { if ("mediaId" in source) librarySeen = true; else if (librarySeen) throw new Error("Native mixed order unsupported"); }
  return { mediaType: "images", images };
}
function parsedChanges(changes: Change[], channel: Channel): Row {
  const patch: Row = {}, seen = new Set<string>();
  for (const change of changes) {
    if (seen.has(change.field) || typeof change.valueJson !== "string" || change.valueJson.length > 12000) throw new Error("Invalid change"); seen.add(change.field);
    const value: unknown = JSON.parse(change.valueJson);
    if (change.field === "title" || change.field === "content") { if (typeof value !== "string" || value.length > (channel === "pinterest" ? 12000 : change.field === "title" ? 180 : BOOSTER_CHANNEL_CONTENT_RULES[channel].max)) throw new Error("Invalid text"); patch[change.field] = value.trim(); }
    else if (change.field === "hashtags") { if (!Array.isArray(value) || value.length > 20 || value.some(item => typeof item !== "string" || item.length > 60)) throw new Error("Invalid hashtags"); patch.hashtags = [...new Set(value.map(item => normalizePublicationEditHashtag(String(item))).filter(Boolean))]; }
    else if (change.field === "cta") {
      const cta = parseInrAssistantPublicationCtaPatch(value);
      if (!cta) throw new Error("Invalid CTA");
      Object.assign(patch, cta);
    } else if (change.field === "media") patch.media = mediaChange(value);
    else throw new Error("Invalid field");
  }
  return patch;
}
function parsePreview(value: unknown): Preview {
  const input = fields(value, ["publicationId", "channel", "sourceVersion", "changes", "instructionQuote"]), selected = target(input);
  if (typeof input.sourceVersion !== "string" || !/^[a-f0-9]{64}$/.test(input.sourceVersion) || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 5) throw new Error("Invalid source");
  const changes = input.changes.map(value => { const change = fields(value, ["field", "valueJson"]); if (!["title", "content", "hashtags", "cta", "media"].includes(String(change.field)) || typeof change.valueJson !== "string") throw new Error("Invalid field"); return change as Change; });
  parsedChanges(changes, selected.channel); return { ...selected, sourceVersion: input.sourceVersion, changes, instructionQuote: quote(input.instructionQuote) };
}
function schema<T>(properties: Record<string, JSONSchema7>, parse: (value: unknown) => T) { return jsonSchema<T>({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Paramètres de modification invalides") }; } } }); }
const targetSchema: Record<string, JSONSchema7> = { publicationId: { type: "string", format: "uuid" }, channel: { type: "string", enum: [...CHANNELS] } };
export function isInrAssistantPublishedPublicationEditRequest(message: string, instructionQuote = message): boolean {
  return matchesInrAssistantActionClause(message, instructionQuote, (current, quoted) => [current, quoted].every(value => {
    const text = inrAssistantUnquotedRequest(value);
    return !/\b(?:comment|pourquoi|explique|expliquer|si|quand|lorsque|if|when|unless|demain|apres|avant|sans|ne|pas|jamais|not|never)\b|\bn'/.test(text)
      && /^(?:(?:peux|pourrais)[ -]tu\s+|(?:pouvez|pourriez)[ -]vous\s+)?(?:(?:me|nous)\s+)?(?:modifi(?:e|er|ez)|corrig(?:e|er|ez)|remplac(?:e|er|ez)|retir(?:e|er|ez)|supprim(?:e|er|ez)|chang(?:e|er|ez)|ajout(?:e|er|ez)|mets|mettez)\b/.test(text)
      && /\bpublication\b|\bpost\b/.test(text) && !/\b(?:programme|brouillon|proposition)\b/.test(text)
      && !/^(?:(?:peux|pourrais)[ -]tu\s+|(?:pouvez|pourriez)[ -]vous\s+)?(?:supprim\w*|retir\w*)\s+(?:(?:la|cette|ma|notre)\s+)?(?:publication|post)\b/.test(text);
  }));
}
export function createInrAssistantPublishedPublicationTools(options: { request: Request; accountId: string; actorUserId: string; edition: DashboardEdition; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; currentApprovalMessage?: string; resolvePreview?: (reference: string) => string | null; canStartWork?: () => boolean }) {
  const fail = (status: string, message: string): Row => ({ ok: false, status, message, nextAction: LINK });
  async function scope(write = false) { const auth = await requireUser(); return !options.request.signal.aborted && options.canStartWork?.() !== false && !auth.errorResponse && auth.activeUserId === options.accountId && auth.authUserId === options.actorUserId && (!write || (await getActiveSubscriptionAccountIds([options.accountId])).has(options.accountId)); }
  async function state(input: Target) {
    const native = await import("./inrsend/publicationChannelActions");
    const current = await native.readInrSendPublicationEditState(options.accountId, input.publicationId, input.channel);
    if (!current || current.publication.user_id !== options.accountId) throw new Error("Publication unavailable");
    const result = row(row(current.eventPayload.results)[input.channel]);
    if (result.deleted === true || result.cancelled === true || result.pending === true || /unknown|pending|processing|queued|deleted|cancelled/.test(String(result.status || result.code || ""))) throw new Error("Publication state uncertain");
    const delivered = current.deliveries.some(item => item.channel === input.channel && ["delivered", "published", "success"].includes(String(item.status)));
    if (!(result.ok === true || typeof result.external_id === "string" && result.external_id || delivered)) throw new Error("Publication not delivered");
    return current;
  }
  const describe = (input: Target, current: Awaited<ReturnType<typeof state>>) => ({ ...input, sourceVersion: current.sourceVersion, post: { title: safe(current.post.title, 180), content: safe(current.post.content, 6000), hashtags: current.post.hashtags, ...Object.fromEntries(["cta", "ctaMode", "ctaUrl", "ctaPhone", "ctaAction"].map(key => [key, safe(current.post[key as keyof typeof current.post], key === "ctaUrl" ? 2000 : 300)])) }, imageReferences: current.images.images.slice(0, 5).map((_, index) => ({ currentIndex: index, label: `Image ${index + 1}` })), mediaType: current.video ? "video" : "images", untrustedContent: true });
  async function library(mediaId: string) {
    const result = await options.supabase.from("pro_media_library").select("id,user_id,bucket_name,storage_path,media_type,mime_type,size_bytes,upload_status,updated_at,source,is_active,original_file_name,title,duration_seconds").eq("id", mediaId).eq("user_id", options.accountId).eq("is_active", true).neq("source", "ai_media_generation_draft").abortSignal(AbortSignal.any([options.request.signal, AbortSignal.timeout(8000)])).maybeSingle();
    const item = row(result.data);
    if (result.error || item.id !== mediaId || item.user_id !== options.accountId || item.is_active !== true || item.source === "ai_media_generation_draft" || item.bucket_name !== "inrcy-pro-media" || typeof item.storage_path !== "string" || !item.storage_path.startsWith(`users/${options.accountId}/`) || /\.\.|[\\%?#]/.test(item.storage_path) || !["image", "video"].includes(String(item.media_type)) || !Number.isSafeInteger(item.size_bytes) || Number(item.size_bytes) <= 0 || Number(item.size_bytes) > (item.media_type === "video" ? INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES : INR_MEDIA_IMAGE_MAX_BYTES) || item.media_type === "video" && item.upload_status !== "uploaded") throw new Error("Media unavailable");
    return item;
  }
  async function sources(patch: Row, current: Awaited<ReturnType<typeof state>>) {
    const selection = patch.media as MediaChange | undefined, assets: Row[] = [];
    if (!selection) return assets;
    if (selection.mediaType === "video") { const item = await library(selection.mediaId); if (item.media_type !== "video") throw new Error("Wrong video"); return [item]; }
    let size = 0;
    for (const source of selection.images) { if ("currentIndex" in source) { if (!current.images.images[source.currentIndex]) throw new Error("Current image unavailable"); } else { const item = await library(source.mediaId); if (item.media_type !== "image") throw new Error("Wrong image"); size += Number(item.size_bytes); assets.push(item); } }
    if (size > INR_MEDIA_PUBLICATION_IMAGES_TOTAL_MAX_BYTES) throw new Error("Image total exceeded");
    return assets;
  }
  async function imageBytes(item: Row): Promise<Buffer> {
    if (!await scope(true)) throw new Error("Account changed");
    const auth = await requireUser(); if (auth.errorResponse || auth.activeUserId !== options.accountId || auth.authUserId !== options.actorUserId) throw new Error("Account changed");
    const result = await auth.supabase.storage.from("inrcy-pro-media").download(String(item.storage_path)).asStream();
    if (result.error || !result.data) throw new Error("Image unavailable");
    const reader = result.data.getReader(), chunks: Uint8Array[] = []; let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([(async () => { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > Number(item.size_bytes) || size > INR_MEDIA_IMAGE_MAX_BYTES) throw new Error("Image too large"); chunks.push(next.value); } if (size !== Number(item.size_bytes) || !size) throw new Error("Image changed"); return Buffer.concat(chunks, size); })(), new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => undefined); reject(new Error("Image unavailable")); }, 12000); })]);
    } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
    finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
  }
  async function validateCta(input: Target, patch: Row, current: Awaited<ReturnType<typeof state>>) {
    const selected = Object.fromEntries(Object.entries(patch).filter(([key]) => ["cta", "ctaMode", "ctaUrl", "ctaPhone", "ctaAction"].includes(key)));
    if (!isInrAssistantPublicationCtaPatchValid(input.channel, current.post, selected)) throw new Error("CTA incomplete");
  }
  async function validatePinterestText(input: Target, patch: Row, current: Awaited<ReturnType<typeof state>>): Promise<Row | null> {
    if (input.channel !== "pinterest") return null;
    const body: Row = { ...patch };
    delete body.media;
    const selection = patch.media as MediaChange | undefined;
    if (selection) {
      body.mediaType = selection.mediaType;
      body.retainedImages = selection.mediaType === "images"
        ? selection.images.filter((source): source is { currentIndex: number } => "currentIndex" in source).map(source => current.images.images[source.currentIndex])
        : [];
      // Library replacements are appended without image-interaction metadata by
      // this tool. Existing retained interactions are resolved by the native validator.
      body.newImages = [];
    }
    const native = await import("./inrsend/publicationChannelActions");
    const rejected = await native.validatePinterestPublicationEdit(options.accountId, body, current);
    if (!rejected) return null;
    const issue = row(await rejected.json());
    return { ...fail("invalid_input", String(issue.error || "Raccourcissez le texte Pinterest avant de préparer cette correction.")), code: issue.code, field: issue.field, length: issue.length, limit: issue.limit, excess: issue.excess };
  }
  function local(path: string, method: string, body?: unknown) { const headers = new Headers({ accept: "application/json" }); for (const key of ["cookie", "authorization"]) { const value = options.request.headers.get(key); if (value) headers.set(key, value); } if (body !== undefined) headers.set("content-type", "application/json"); return new Request(new URL(path, options.request.url), { method, headers, signal: options.request.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  const attempts = new Map<string, Promise<Row>>();
  return {
    readPublishedPublicationForEdit: tool({ strict: true, description: "Relire le canal exact d’une publication déjà diffusée dans iNr’Send, sa version native et les indices de ses images actuelles. Pas de reprise d’échec, pas de nouveau post. X/TikTok/Threads publiés ne sont pas modifiables ici. Lire avant previewPublishedPublicationEdit.", inputSchema: schema(targetSchema, value => { fields(value, ["publicationId", "channel"]); return target(value); }), execute: async input => { try { if (!await scope()) return fail("blocked", "Vérifiez le compte actif."); const current = await state(input); if (!await scope()) return fail("blocked", "L’établissement actif a changé."); return { ok: true, status: "read", ...describe(input, current), message: "Version iNr’Send relue pour préparer une correction ; aucune modification ni publication lancée.", nextAction: LINK }; } catch { return fail("unavailable", "Ce canal publié ne peut pas être relu ou son état est incertain. Vérifiez son détail iNr’Send avant toute modification."); } } }),
    previewPublishedPublicationEdit: tool({ strict: true, description: "Préparer l’aperçu signé d’une correction d’un canal déjà publié : title/content/hashtags, cta={cta?,ctaMode?,ctaUrl?,ctaPhone?,ctaAction?} ponctuel, media={mediaType:images,images:[{currentIndex:0},{mediaId:UUID}]} (0..5 images) ou {mediaType:video,mediaId:UUID}. Valeurs JSON explicites uniquement ; champs absents conservés. Une copie déjà retouchée en Médiathèque peut remplacer un média. Aucune URL/base64 ni génération/adaptation vidéo implicite. Présenter effets, texte et sources avant Confirme IA-… ; le parcours natif peut remplacer le post externe et ses interactions.", inputSchema: schema<Preview>({ ...targetSchema, sourceVersion: { type: "string", pattern: "^[a-f0-9]{64}$" }, changes: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", properties: { field: { type: "string", enum: ["title", "content", "hashtags", "cta", "media"] }, valueJson: { type: "string", maxLength: 12000 } }, required: ["field", "valueJson"], additionalProperties: false } }, instructionQuote: { type: "string", maxLength: 1200 } }, parsePreview), execute: async raw => {
      const input = parsePreview(raw);
      if (!isInrAssistantPublishedPublicationEditRequest(options.currentUserMessage, input.instructionQuote)) return fail("needs_instruction", "Demandez explicitement la correction de cette publication déjà diffusée.");
      try { if (!await scope(true)) return fail("blocked", "La session et l’abonnement doivent être vérifiés."); const current = await state(input); if (current.sourceVersion !== input.sourceVersion) return fail("stale_source", "Cette publication a changé depuis sa lecture. Relisez-la avant de préparer la correction."); const patch = parsedChanges(input.changes, input.channel); await validateCta(input, patch, current); const pinterestIssue = await validatePinterestText(input, patch, current); if (pinterestIssue) return pinterestIssue; const assets = await sources(patch, current); if (!await scope(true)) return fail("blocked", "L’établissement actif a changé.");
        const preview = createAssistantActionPreview({ accountId: options.accountId, actorUserId: options.actorUserId, kind: "published_publication_edit", targetId: input.publicationId, fingerprint: current.sourceVersion, patch: { channel: input.channel, changes: input.changes, mediaFingerprint: assistantActionFingerprint(assets) } });
        return { ok: true, status: "preview_ready", approvalKind: "published_publication_edit", ...preview, proposal: { before: describe(input, current), changedFields: input.changes.map(change => change.field), afterPost: { ...current.post, ...Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "media")) }, media: patch.media ?? "conservés", librarySources: assets.map(item => ({ mediaId: item.id, name: safe(item.title || item.original_file_name), kind: item.media_type })), effect: "Modifie uniquement ce canal. Le traitement natif peut créer un remplacement et retirer l’ancien post ; les liens, réactions ou commentaires peuvent ne pas être conservés. Aucun autre canal relancé." }, message: `Vérifiez le texte, les destinations, les médias et cet effet externe puis dites « Confirme ${preview.reference} ».`, nextAction: LINK, untrustedContent: true };
      } catch { return fail("unavailable", "L’aperçu n’a pas pu être vérifié. Vérifiez la publication, le CTA et les médias possédés ; aucun canal modifié."); }
    } }),
    applyPublishedPublicationEdit: tool({ strict: true, description: "Appliquer uniquement l’aperçu signé de correction publiée confirmé IA- exact. Revérifie compte/auteur, source et médias ; utilise le PATCH natif protégé contre les répétitions durables puis relit le canal. Un état inconnu, même après expiration, n’autorise jamais une nouvelle diffusion automatique.", inputSchema: schema({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, instructionQuote: { type: "string", maxLength: 1200 } }, value => { const input = fields(value, ["reference", "instructionQuote"]); if (typeof input.reference !== "string" || !/^IA-[A-F0-9]{12}$/.test(input.reference)) throw new Error("Invalid reference"); return { reference: input.reference, instructionQuote: quote(input.instructionQuote) }; }), execute: async input => {
      const approved = verifyAssistantActionPreview(options.resolvePreview?.(input.reference) || "", { accountId: options.accountId, actorUserId: options.actorUserId, kind: "published_publication_edit" });
      if (!approved || approved.reference !== input.reference || !hasAssistantActionApproval(options.currentApprovalMessage || options.currentUserMessage, input.instructionQuote, approved.reference)) return fail("confirmation_required", "Confirmez la référence exacte de l’aperçu de cette correction publiée.");
      if (!await scope(true)) return fail("blocked", "La session ou l’établissement actif a changé.");
      if (!attempts.has(input.reference)) attempts.set(input.reference, (async (): Promise<Row> => {
        try {
          const parsed = parsePreview({ publicationId: approved.targetId, channel: approved.patch.channel, sourceVersion: approved.fingerprint, changes: approved.patch.changes, instructionQuote: "Aperçu confirmé" }), current = await state(parsed);
          if (current.sourceVersion !== approved.fingerprint) return fail("stale_source", "La publication a changé depuis l’aperçu. Relisez son résultat ; ne relancez pas cette correction automatiquement.");
          const patch = parsedChanges(parsed.changes, parsed.channel); await validateCta(parsed, patch, current); const pinterestIssue = await validatePinterestText(parsed, patch, current); if (pinterestIssue) return pinterestIssue; const assets = await sources(patch, current);
          if (assistantActionFingerprint(assets) !== approved.patch.mediaFingerprint) return fail("stale_media", "Un média source a changé. Préparez un nouvel aperçu après relecture.");
          const body: Row = { ...patch, expectedState: approved.fingerprint, operationKey: approved.reference }; delete body.media;
          const selection = patch.media as MediaChange | undefined;
          if (selection?.mediaType === "video") {
            const video = assets[0]; body.mediaType = "video"; body.video = { bucket: video.bucket_name, storagePath: video.storage_path, name: video.original_file_name || video.title, type: video.mime_type, size: video.size_bytes, duration: video.duration_seconds, sourceVideo: { bucket: video.bucket_name, storagePath: video.storage_path } }; body.videoSettings = {}; body.retainedImages = []; body.newImages = [];
          } else if (selection?.mediaType === "images") {
            body.mediaType = "images"; body.retainedImages = selection.images.filter((source): source is { currentIndex: number } => "currentIndex" in source).map(source => current.images.images[source.currentIndex]);
            const images: Row[] = []; const { buildMediaLibraryContentUrl } = await import("./mediaLibraryContentUrl");
            for (const source of selection.images) if ("mediaId" in source) {
              const item = assets.find(asset => asset.id === source.mediaId)!;
              const bytes = await imageBytes(item), sourceUrl = buildMediaLibraryContentUrl(source.mediaId); if (!sourceUrl || assistantActionFingerprint(await library(source.mediaId)) !== assistantActionFingerprint(item)) throw new Error("Image changed");
              images.push({ name: String(item.original_file_name || item.title || "Image"), type: item.mime_type, dataUrl: `data:${item.mime_type};base64,${bytes.toString("base64")}`, originalUrl: new URL(sourceUrl, options.request.url).toString(), imageKey: source.mediaId });
            }
            // Native PATCH appends new images after retained ones. Reject a
            // mixed requested order that it cannot preserve faithfully.
            body.newImages = images;
          }
          if (!await scope(true)) return fail("blocked", "L’établissement actif a changé avant envoi.");
          const native = await import("./inrsend/publicationChannelActions"), handler = native.createPublicationChannelHandlers(parsed.channel);
          const response = await handler.PATCH(local(`/api/inrsend/publications/${parsed.publicationId}/${parsed.channel.replace("_", "-")}`, "PATCH", body), { params: Promise.resolve({ publicationId: parsed.publicationId }) }), data = row(await response.json());
          if (!response.ok || data.ok !== true || data.pending === true) return fail("unknown", "Le résultat de la correction reste incertain ou en cours. Aucune nouvelle tentative automatique ; vérifiez ce canal dans iNr’Send et chez le fournisseur.");
          const after = await state(parsed); if (!await scope(true) || after.sourceVersion === approved.fingerprint || Object.entries(patch).some(([key, value]) => key !== "media" && JSON.stringify(after.post[key as keyof typeof after.post]) !== JSON.stringify(value))) return fail("unknown", "Le nouveau contenu du canal n’a pas pu être confirmé après l’action. Vérifiez-le sans relancer la diffusion.");
          if (selection?.mediaType === "images" && (after.images.images.length !== selection.images.length || selection.images.some((source, index) => "currentIndex" in source ? after.images.images[index] !== current.images.images[source.currentIndex] : row(after.images.editableAttachments[index]).imageKey !== source.mediaId))) return fail("unknown", "La sélection d’images enregistrée n’a pas pu être confirmée. Vérifiez ce canal sans relancer la diffusion.");
          if (selection?.mediaType === "video" && after.video?.storagePath !== assets[0].storage_path && row(after.video?.sourceVideo).storagePath !== assets[0].storage_path) return fail("unknown", "La vidéo source enregistrée n’a pas pu être confirmée. Vérifiez ce canal sans relancer la diffusion.");
          return { ok: true, status: "updated", publicationId: parsed.publicationId, channel: parsed.channel, message: "La correction de ce canal a été confirmée par le parcours natif puis relue dans iNr’Send. Les autres canaux n’ont pas été relancés. Ce reçu ne constitue pas une vérification indépendante du fournisseur.", nextAction: LINK };
        } catch { return fail("unknown", "Le résultat de cette correction doit être vérifié. Aucune nouvelle tentative automatique ni publication de remplacement n’a été lancée par cet outil après l’incertitude."); }
      })());
      return attempts.get(input.reference)!;
    } }),
  };
}
