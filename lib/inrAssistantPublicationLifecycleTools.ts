import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { getDashboardEditionForAuthUser } from "./dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "./accountSubscriptionAccess";
import { assistantActionFingerprint, createAssistantActionPreview, hasAssistantActionApproval, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { sanitizeInrAssistantMemoryText } from "./inrAssistantMemory.ts";
import { canRemoveInstagramDraftLocally } from "./inrsend/instagramCapabilities";
import { createInrAssistantPublishedPublicationTools } from "./inrAssistantPublishedPublicationTools.ts";

type Row = Record<string, unknown>;
type ReadInput = { view: "drafts" | "history" | "prepared"; recordId: string | null; offset: number };
type TextPatch = { title: string | null; content: string | null; cta: string | null; hashtags: string[] | null };
type EditInput = { actionId: string; operation: "save_draft" | "text" | "channels" | "media"; channel: string | null; channels: string[] | null; text: TextPatch | null; mediaId: string | null; mediaOperation: "append" | "replace" | "remove" | null; mediaIndex: number | null; instructionQuote: string };
type PreviewInput = { targetId: string; operation: "delete_channel" | "cancel_tiktok_pending" | "retry_tiktok" | "refuse_prepared" | "restore_prepared"; channel: string | null; instructionQuote: string };
type ApplyInput = { reference: string; instructionQuote: string };
const CHANNELS = ["site_web", "inr_search", "gmb", "facebook", "instagram", "threads", "linkedin", "tiktok", "youtube_shorts", "pinterest", "x"];
const EDITABLE = ["prepared", "pending_validation", "pending", "draft"];
const SEND_LINK = { label: "Publications iNr’Send", href: "/dashboard/mails?folder=publications" };
const AGENT_LINK = { label: "Publications iNr’Agent", href: "/dashboard/agent/publications" };
const EVENT_SELECT = "id,user_id,module,type,payload,created_at";
const AGENT_SELECT = "id,user_id,automation_key,action_type,target_tool,title,summary,preview_text,target_channels,image_assets,payload,status,validation_required,execution_policy,scheduled_for,validated_at,refused_at,completed_at,created_at,updated_at";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const safe = (value: unknown, max = 240) => sanitizeInrAssistantMemoryText(typeof value === "string" ? value : "", max);
const normalized = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const channelList = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && CHANNELS.includes(item)))] : [];
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides"); return input; }
function id(value: unknown) { if (typeof value !== "string" || !UUID.test(value)) throw new Error("Identifiant invalide"); return value; }
function text(value: unknown, max = 1200) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Texte invalide"); return value.trim(); }
function channel(value: unknown) { if (typeof value !== "string" || !CHANNELS.includes(value)) throw new Error("Canal invalide"); return value; }
function parseRead(value: unknown): ReadInput { const input = fields(value, ["view", "recordId", "offset"]); if (!["drafts", "history", "prepared"].includes(String(input.view)) || !Number.isInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) > 10000) throw new Error("Lecture invalide"); return { view: input.view as ReadInput["view"], recordId: input.recordId === null ? null : id(input.recordId), offset: Number(input.offset) }; }
function parseEdit(value: unknown): EditInput {
  const input = fields(value, ["actionId", "operation", "channel", "channels", "text", "mediaId", "mediaOperation", "mediaIndex", "instructionQuote"]);
  if (!["save_draft", "text", "channels", "media"].includes(String(input.operation))) throw new Error("Modification invalide");
  const result: EditInput = { actionId: id(input.actionId), operation: input.operation as EditInput["operation"], channel: input.channel === null ? null : channel(input.channel), channels: null, text: null, mediaId: input.mediaId === null ? null : id(input.mediaId), mediaOperation: null, mediaIndex: null, instructionQuote: text(input.instructionQuote) };
  if (input.operation === "channels") {
    if (!Array.isArray(input.channels) || !input.channels.length || input.channels.length > CHANNELS.length || input.channels.some(item => !CHANNELS.includes(String(item)))) throw new Error("Sélection invalide");
    result.channels = [...new Set(input.channels as string[])];
  } else if (input.channels !== null) throw new Error("Canaux inattendus");
  if (input.operation === "text") {
    const content = fields(input.text, ["title", "content", "cta", "hashtags"]);
    for (const [key, max] of [["title", 180], ["content", 6000], ["cta", 180]] as const) if (content[key] !== null && (typeof content[key] !== "string" || (content[key] as string).length > max)) throw new Error("Texte invalide");
    if (content.hashtags !== null && (!Array.isArray(content.hashtags) || content.hashtags.length > 30 || content.hashtags.some(item => typeof item !== "string" || item.length > 80))) throw new Error("Hashtags invalides");
    if (Object.values(content).every(item => item === null)) throw new Error("Modification vide");
    result.text = content as TextPatch;
  } else if (input.text !== null) throw new Error("Texte inattendu");
  if (input.operation === "media") {
    if (!["append", "replace", "remove"].includes(String(input.mediaOperation)) || !Number.isInteger(input.mediaIndex) || Number(input.mediaIndex) < 0 || Number(input.mediaIndex) > 20) throw new Error("Média invalide");
    if (input.mediaOperation === "remove" ? result.mediaId !== null : result.mediaId === null) throw new Error("Média manquant ou inattendu");
    result.mediaOperation = input.mediaOperation as EditInput["mediaOperation"]; result.mediaIndex = Number(input.mediaIndex);
  } else if (input.mediaOperation !== null || input.mediaIndex !== null || input.mediaId !== null) throw new Error("Média inattendu");
  if (["text", "media"].includes(result.operation) ? !result.channel : result.channel !== null) throw new Error("Canal manquant ou inattendu");
  return result;
}
function parsePreview(value: unknown): PreviewInput { const input = fields(value, ["targetId", "operation", "channel", "instructionQuote"]); if (!["delete_channel", "cancel_tiktok_pending", "retry_tiktok", "refuse_prepared", "restore_prepared"].includes(String(input.operation))) throw new Error("Action invalide"); const targetChannel = input.channel === null ? null : channel(input.channel); if (String(input.operation).endsWith("prepared") ? targetChannel !== null : !targetChannel) throw new Error("Canal invalide"); if (["cancel_tiktok_pending", "retry_tiktok"].includes(String(input.operation)) && targetChannel !== "tiktok") throw new Error("Canal invalide"); return { targetId: id(input.targetId), operation: input.operation as PreviewInput["operation"], channel: targetChannel, instructionQuote: text(input.instructionQuote) }; }
function parseApply(value: unknown): ApplyInput { const input = fields(value, ["reference", "instructionQuote"]), reference = text(input.reference, 15); if (!/^IA-[A-F0-9]{12}$/.test(reference)) throw new Error("Référence invalide"); return { reference, instructionQuote: text(input.instructionQuote) }; }
function schema<T>(properties: Record<string, JSONSchema7>, parse: (value: unknown) => T) { return jsonSchema<T>({ type: "object", properties, additionalProperties: false, required: Object.keys(properties) }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Paramètres publication invalides") }; } } }); }
function permits(message: string, selected: string, operation: string) {
  const unquoted = message.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|«[^»]*»|“[^”]*”|"[^"]*"|^>.*$/gm, " ");
  if (!unquoted.includes(selected)) return false;
  if (/\b(?:comment|pourquoi|explique|imagine|si|quand|lorsque|apres|avant|demain|plus tard|ce soir|not|never)\b|\bne\b.{0,80}\bpas\b|n['’](?:annule|efface)|\b(?:supprime|annule|refuse|modifie)\s+pas\b|\bdans\s+(?:\d+|une?|deux|trois)\s*(?:minutes?|heures?|jours?)\b/.test(normalized(unquoted))) return false;
  const words = normalized(selected);
  return (operation === "delete_channel" ? /\b(?:supprime\w*|efface\w*|retire\w*)\b/
    : operation === "cancel_tiktok_pending" ? /\b(?:annule\w*|retire\w*)\b/
      : operation === "retry_tiktok" ? /\b(?:retente\w*|reessaie\w*|relance\w*|retry)\b/
      : operation === "refuse_prepared" ? /\b(?:refuse\w*|rejette\w*|annule\w*)\b/
        : operation === "restore_prepared" ? /\b(?:restaure\w*|reouvre\w*|remets|remettre|reviens|rouvre\w*)\b/
          : operation === "save_draft" ? /\b(?:enregistre\w*|sauvegarde\w*|conserve\w*)\b/
            : /\b(?:modifie\w*|corrige\w*|remplace\w*|change\w*|ajoute\w*|retire\w*|supprime\w*|selectionne\w*|decoche\w*|coche\w*|mets|mettre)\b/).test(words);
}
function local(source: Request, path: string, method: string, body: unknown) { const headers = new Headers({ "content-type": "application/json" }); for (const key of ["cookie", "authorization"]) { const value = source.headers.get(key); if (value) headers.set(key, value); } return new Request(new URL(path, source.url), { method, headers, body: JSON.stringify(body), signal: source.signal }); }
/** Only a confirmed failure can be resubmitted; pending/unknown may already be live. */
function canRetryTikTok(current: Row) {
  const result = row(row(row(row(current.event).payload).results).tiktok), settings = row(row(result.diagnostics).publicationSettings ?? result.publicationSettings);
  const state = String(result.tiktok_status ?? result.status ?? result.state).toLowerCase();
  if (result.pending === true || row(row(result.diagnostics).status).pending === true || result.cancelled === true || result.deleted === true || result.ok === true || !["failed", "error", "publish_failed", "send_failed"].includes(state)) return false;
  const deliveries = Array.isArray(current.deliveries) ? current.deliveries.map(row).filter(value => value.channel === "tiktok") : [];
  if (deliveries.some(value => !["failed", "error"].includes(String(value.status)))) return false;
  return typeof settings.privacyLevel === "string" && ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"].includes(settings.privacyLevel) && settings.musicUsageConfirmed === true && ["none", "self", "branded", "both"].includes(String(settings.commercialContent));
}
function agentChannels(record: Row) { const payload = row(record.payload), publish = row(payload.publishPayload); return channelList(payload.selectedChannels ?? payload.channels ?? publish.channels ?? record.target_channels); }
function posts(record: Row) { const payload = row(record.payload); return row(payload.postByChannel || row(payload.publishPayload).postByChannel); }
function describe(record: Row, agent = false) {
  const payload = row(record.payload), preparedPosts = posts(record);
  const publicationId = payload.publication_id;
  return { recordId: record.id, ...(agent ? { actionId: record.id } : record.type === "publish_draft" ? { draftId: record.id } : typeof publicationId === "string" && UUID.test(publicationId) ? { publicationId } : {}), title: safe(record.title || payload.title, 180), preview: safe(record.preview_text || payload.preview || payload.content, 1000), status: safe(record.status || payload.status, 40), createdAt: safe(record.created_at, 40), updatedAt: safe(record.updated_at || payload.saved_at, 40), scheduledAt: safe(record.scheduled_for, 40) || null,
    channels: agent ? agentChannels(record) : channelList(payload.channels), posts: Object.entries(preparedPosts).filter(([key]) => CHANNELS.includes(key)).slice(0, 11).map(([key, value]) => ({ channel: key, title: safe(row(value).title, 180), content: safe(row(value).content || row(value).text || row(value).body, 1500) })),
    channelResults: Object.entries(row(payload.results)).filter(([key]) => CHANNELS.includes(key)).map(([key, value]) => ({ channel: key, status: safe(row(value).status || row(value).state, 40), deleted: row(value).deleted === true, pending: row(value).pending === true, error: safe(row(value).error, 240) })),
    toolUrl: agent ? AGENT_LINK.href : record.type === "publish_draft" ? `/dashboard?action=publish&draftId=${String(record.id)}` : SEND_LINK.href };
}

export function createInrAssistantPublicationLifecycleTools(options: { request: Request; accountId: string; actorUserId: string; edition: DashboardEdition; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; currentApprovalMessage?: string; canStartWork?: () => boolean; resolvePreview?: (reference: string) => string | null }) {
  const accountId = id(options.accountId), actorUserId = id(options.actorUserId), { request, supabase } = options;
  const fail = (status: string, message: string): Row => ({ ok: false, status, message, nextAction: SEND_LINK });
  async function access(write: boolean, agent: boolean) {
    if (request.signal.aborted || options.canStartWork?.() === false) return false;
    const auth = await requireUser(); if (auth.errorResponse || auth.activeUserId !== accountId || auth.authUserId !== actorUserId) return false;
    if (agent && (options.edition === "basic" || await getDashboardEditionForAuthUser(actorUserId) === "basic")) return false;
    return !write || (await getActiveSubscriptionAccountIds([accountId])).has(accountId);
  }
  const readSignal = () => AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
  const preparedQuery = () => supabase.from("inr_agent_actions").select(AGENT_SELECT).eq("user_id", accountId).eq("automation_key", "publish").eq("action_type", "publication").eq("target_tool", "booster");
  async function prepared(targetId: string) { const result = await preparedQuery().eq("id", targetId).abortSignal(readSignal()).maybeSingle(); if (result.error) throw new Error("Read failed"); const record = row(result.data); return record.id === targetId && record.user_id === accountId && record.automation_key === "publish" && record.action_type === "publication" && record.target_tool === "booster" ? record : null; }
  async function published(targetId: string): Promise<Row | null> {
    const publication = await supabase.from("publications").select("id,user_id,title,content,hashtags").eq("user_id", accountId).eq("id", targetId).abortSignal(readSignal()).maybeSingle();
    const event = await supabase.from("app_events").select(EVENT_SELECT).eq("user_id", accountId).eq("module", "booster").eq("type", "publish").contains("payload", { publication_id: targetId }).order("created_at", { ascending: false }).limit(1).abortSignal(readSignal()).maybeSingle();
    const deliveries = await supabase.from("publication_deliveries").select("user_id,publication_id,channel,status").eq("user_id", accountId).eq("publication_id", targetId).limit(100).abortSignal(readSignal());
    if (publication.error || event.error || deliveries.error) throw new Error("Read failed");
    if (row(publication.data).id !== targetId || row(publication.data).user_id !== accountId || row(event.data).user_id !== accountId || row(row(event.data).payload).publication_id !== targetId || !Array.isArray(deliveries.data) || deliveries.data.length >= 100) return null;
    return { publication: row(publication.data), event: row(event.data), deliveries: deliveries.data };
  }
  const editable = (record: Row) => EDITABLE.includes(String(record.status)) && !record.validated_at && !record.completed_at && !record.scheduled_for;
  const restorable = (record: Row) => ["refused", "validated", "scheduled"].includes(String(record.status)) && !record.completed_at && record.validation_required !== false && record.execution_policy !== "automatic_after_settings" && Date.parse(String(record.scheduled_for)) > Date.now();
  async function guard(write: boolean, agent: boolean, operation: () => Promise<Row>) { try { if (!await access(write, agent)) return fail("blocked", agent ? "Cette action iNr’Agent nécessite Standard ou Premium et la session de l’établissement actif." : "La session, l’abonnement ou l’établissement actif doit être vérifié."); return await operation(); } catch { return fail(write ? "unknown" : "unavailable", write ? "Le résultat est incertain. Relisez l’historique ; aucune action n’a été relancée automatiquement." : "Lecture de la publication indisponible."); } }
  const attempts = new Map<string, { fingerprint: string; promise: Promise<Row> }>();
  function once(key: string, input: unknown, agent: boolean, operation: () => Promise<Row>) { const fingerprint = assistantActionFingerprint(input), existing = attempts.get(key); if (existing) return existing.fingerprint === fingerprint ? existing.promise : Promise.resolve(fail("needs_instruction", "Une modification différente a déjà été traitée pour cet élément. Vérifiez son état avant une nouvelle demande.")); const promise = guard(true, agent, operation); attempts.set(key, { fingerprint, promise }); return promise; }
  async function nativeAgent(body: Row): Promise<Response> { const response = await (await import("@/app/api/agent/actions/route")).PATCH(local(request, "/api/agent/actions", "PATCH", body)); if (!response) throw new Error("Native result unavailable"); return response; }
  async function libraryMedia(mediaId: string) {
    const result = await supabase.from("pro_media_library").select("id,user_id,bucket_name,storage_path,media_type,mime_type,size_bytes,duration_seconds,original_file_name,title").eq("user_id", accountId).eq("id", mediaId).eq("is_active", true).neq("source", "ai_media_generation_draft").abortSignal(readSignal()).maybeSingle();
    const media = row(result.data);
    if (result.error || media.id !== mediaId || media.user_id !== accountId || media.bucket_name !== "inrcy-pro-media" || typeof media.storage_path !== "string" || !media.storage_path.startsWith(`users/${accountId}/`) || /\.\.|[\\%?#]/.test(media.storage_path) || !["image", "video"].includes(String(media.media_type))) throw new Error("Media unavailable");
    const { buildMediaLibraryContentUrl } = await import("@/lib/mediaLibraryContentUrl"); const url = buildMediaLibraryContentUrl(mediaId); if (!url) throw new Error("Media unavailable");
    return { id: mediaId, mediaId, bucket: "inrcy-pro-media", storagePath: media.storage_path, url: new URL(url, request.url).toString(), kind: media.media_type, mimeType: media.mime_type, name: safe(media.original_file_name || media.title, 180), size: Number(media.size_bytes) || 0, duration: Number(media.duration_seconds) || null };
  }
  return {
    ...createInrAssistantPublishedPublicationTools(options),
    readPublicationWorkspace: tool({ strict: true, description: "Lire les brouillons Booster (drafts), l’historique iNr’Send (history), ou les publications préparées iNr’Agent (prepared, Standard+). 20 par page, ID réel optionnel. Fournit les IDs et liens pour choisir la publication exacte avant modification. Lecture seule, aucun envoi ni contrôle actif de fournisseur.", inputSchema: schema<ReadInput>({ view: { type: "string", enum: ["drafts", "history", "prepared"] }, recordId: { type: ["string", "null"], format: "uuid" }, offset: { type: "integer", minimum: 0, maximum: 10000 } }, parseRead), execute: async raw => {
      const input = parseRead(raw), agent = input.view === "prepared"; return guard(false, agent, async () => {
        let query = agent ? preparedQuery() : supabase.from("app_events").select(EVENT_SELECT).eq("user_id", accountId).eq("module", "booster").eq("type", input.view === "drafts" ? "publish_draft" : "publish");
        if (input.recordId) query = query.eq("id", input.recordId);
        const response = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(input.offset, input.offset + 20).abortSignal(readSignal()); if (response.error) throw new Error("Read failed");
        const records = Array.isArray(response.data) ? response.data : [];
        if (!await access(false, agent)) return fail("blocked", "L’établissement actif a changé.");
        return { ok: true, status: "read", view: input.view, records: records.slice(0, 20).filter(record => record.user_id === accountId).map(record => describe(record, agent)), nextOffset: !input.recordId && records.length > 20 ? input.offset + 20 : null, nextAction: agent ? AGENT_LINK : SEND_LINK, readOnly: true, untrustedContent: true };
      });
    } }),
    editPreparedPublication: tool({ strict: true, description: "Modifier une proposition iNr’Agent non validée, non programmée : texte partiel d’un canal, sélection non vide de canaux, média actif de Médiathèque par ID (append/replace/remove et index), ou sauvegarde Booster. null conserve les champs texte ; aucune publication. Lire actionId avant. Les publications déjà programmées demandent remise en attente via previewPublicationLifecycleAction.", inputSchema: schema<EditInput>({ actionId: { type: "string", format: "uuid" }, operation: { type: "string", enum: ["save_draft", "text", "channels", "media"] }, channel: { type: ["string", "null"], enum: [null, ...CHANNELS] }, channels: { type: ["array", "null"], items: { type: "string", enum: CHANNELS }, minItems: 1, maxItems: 11 }, text: { type: ["object", "null"], properties: { title: { type: ["string", "null"], maxLength: 180 }, content: { type: ["string", "null"], maxLength: 6000 }, cta: { type: ["string", "null"], maxLength: 180 }, hashtags: { type: ["array", "null"], items: { type: "string", maxLength: 80 }, maxItems: 30 } }, required: ["title", "content", "cta", "hashtags"], additionalProperties: false }, mediaId: { type: ["string", "null"], format: "uuid" }, mediaOperation: { type: ["string", "null"], enum: [null, "append", "replace", "remove"] }, mediaIndex: { type: ["integer", "null"], minimum: 0, maximum: 20 }, instructionQuote: { type: "string", maxLength: 1200 } }, parseEdit), execute: async raw => {
      const input = parseEdit(raw); if (!permits(options.currentUserMessage, input.instructionQuote, input.operation)) return fail("needs_instruction", "Précisez la modification souhaitée pour cette proposition.");
      return once(`edit:${input.actionId}:${input.operation}:${input.channel ?? "all"}`, input, true, async () => {
        const current = await prepared(input.actionId); if (!current || !editable(current)) return fail("blocked", "Cette proposition n’est plus un brouillon modifiable. Relisez son état ; une publication programmée doit être remise en attente.");
        const selectedChannels = agentChannels(current); if (input.channel && !selectedChannels.includes(input.channel)) return fail("blocked", "Ce canal ne fait pas partie de la proposition.");
        const body: Row = { actionId: input.actionId, expectedUpdatedAt: current.updated_at };
        if (input.operation === "save_draft") {
          // Native transfer inserts a Booster draft before closing its source.
          // Recover that receipt if a previous response/closure was lost.
          const existing = await supabase.from("app_events").select("id,user_id,module,type,payload").eq("user_id", accountId).eq("module", "booster").eq("type", "publish_draft").contains("payload", { inrAgentActionId: input.actionId }).limit(2).abortSignal(readSignal());
          if (existing.error) throw new Error("Draft lookup failed");
          const drafts = Array.isArray(existing.data) ? existing.data : [];
          if (drafts.length > 1) return fail("needs_instruction", "Plusieurs brouillons correspondent à cette proposition. Consultez iNr’Send avant de continuer.");
          if (drafts.length === 1) {
            const recovered = row(drafts[0]); if (typeof recovered.id !== "string" || !UUID.test(recovered.id) || recovered.user_id !== accountId || !await access(false, true)) return fail("blocked", "Le brouillon doit être vérifié.");
            return { ok: true, status: "draft", actionId: input.actionId, draftId: recovered.id, toolUrl: `/dashboard?action=publish&draftId=${recovered.id}`, message: "Le brouillon existe déjà. Aucun doublon créé ; vérifiez la fermeture de sa proposition dans iNr’Agent." };
          }
          body.editType = "save_publish_draft";
        }
        else if (input.operation === "channels") { body.editType = "publish_channel_selection"; body.channels = input.channels; body.confirmPending = false; }
        else if (input.operation === "text") {
          const post = row(posts(current)[input.channel!]), patch = input.text!;
          Object.assign(body, { editType: "publish_channel_text", channel: input.channel, applyToAllChannels: false, title: patch.title ?? post.title ?? post.subject ?? "", content: patch.content ?? post.content ?? post.text ?? post.body ?? "", cta: patch.cta ?? post.cta ?? post.callToAction ?? "", hashtags: patch.hashtags ?? post.hashtags ?? [], ctaMode: post.ctaMode ?? "none", ctaUrl: post.ctaUrl ?? "", ctaPhone: post.ctaPhone ?? "" });
          if (!String(body.content).trim()) return fail("needs_instruction", "Le texte de publication ne peut pas être vide.");
        } else Object.assign(body, { editType: "publish_channel_media", channel: input.channel, media: input.mediaId ? await libraryMedia(input.mediaId) : null, removeMedia: input.mediaOperation === "remove", mediaOperation: input.mediaOperation, mediaIndex: input.mediaIndex, applyToAllChannels: false });
        const latest = await prepared(input.actionId); if (!latest || assistantActionFingerprint(latest) !== assistantActionFingerprint(current)) return fail("stale_preview", "La proposition a changé. Relisez-la avant de la modifier.");
        if (!await access(true, true)) return fail("blocked", "L’établissement actif a changé.");
        const response = await nativeAgent(body), result = row(await response.json());
        if (!response.ok) return fail(response.status === 409 ? "stale_preview" : response.status < 500 ? "blocked" : "unknown", "L’application n’a pas confirmé la modification. Relisez la proposition.");
        if (input.operation === "save_draft") {
          if (result.savedAsDraft !== true || typeof result.draftId !== "string" || !UUID.test(result.draftId)) return fail("unknown", "Le brouillon n’est pas confirmé.");
          const after = await prepared(input.actionId), transfer = row(row(after?.payload).movedToInrSendDraft);
          if (!after || after.status !== "cancelled" || transfer.ok !== true || transfer.draftId !== result.draftId || !await access(false, true)) return fail("unknown", "Le transfert du brouillon n’a pas pu être relu. Vérifiez iNr’Send avant toute nouvelle demande.");
          return { ok: true, status: "draft", actionId: input.actionId, draftId: result.draftId, toolUrl: `/dashboard?action=publish&draftId=${result.draftId}`, message: "La proposition a été transférée en brouillon Booster et fermée dans iNr’Agent. Aucune diffusion lancée." };
        }
        const after = await prepared(input.actionId); if (result.saved !== true || row(result.action).id !== input.actionId || !after || !await access(false, true)) return fail("unknown", "La modification n’a pas pu être relue.");
        if (input.operation === "channels" && JSON.stringify([...agentChannels(after)].sort()) !== JSON.stringify([...input.channels!].sort())) return fail("unknown", "La sélection de canaux n’est pas confirmée.");
        if (input.operation === "text") { const afterPost = row(posts(after)[input.channel!]); if (String(afterPost.content ?? afterPost.text ?? "").trim() !== String(body.content).trim() || String(afterPost.title ?? "") !== String(body.title)) return fail("unknown", "Le nouveau texte n’est pas confirmé."); }
        return { ok: true, status: "updated", actionId: input.actionId, operation: input.operation, record: describe(after, true), nextAction: AGENT_LINK, message: "La proposition a été modifiée par le chemin natif puis relue. Aucune diffusion lancée.", untrustedContent: true };
      });
    } }),
    previewPublicationLifecycleAction: tool({ strict: true, description: "Préparer un aperçu signé : supprimer un canal iNr’Send, annuler un TikTok en attente, retry_tiktok pour un échec TikTok confirmé avec ses réglages/consentements natifs déjà enregistrés, ou refuser/restaurer une proposition iNr’Agent. targetId=publicationId pour iNr’Send, actionId pour iNr’Agent. Présenter effet puis demander confirmation IA-. Aucun réenvoi d’un état inconnu/en cours.", inputSchema: schema<PreviewInput>({ targetId: { type: "string", format: "uuid" }, operation: { type: "string", enum: ["delete_channel", "cancel_tiktok_pending", "retry_tiktok", "refuse_prepared", "restore_prepared"] }, channel: { type: ["string", "null"], enum: [null, ...CHANNELS] }, instructionQuote: { type: "string", maxLength: 1200 } }, parsePreview), execute: async raw => {
      const input = parsePreview(raw), agent = input.operation.endsWith("prepared"); if (!permits(options.currentUserMessage, input.instructionQuote, input.operation)) return fail("needs_instruction", "Précisez la publication, le canal et l’action souhaitée.");
      return guard(false, agent, async () => {
        const current = agent ? await prepared(input.targetId) : await published(input.targetId); if (!current) return fail("not_found", "Publication introuvable dans cet établissement.");
        if (agent && !(input.operation === "refuse_prepared" ? editable(current) : restorable(current))) return fail("blocked", "L’état ou l’échéance de cette proposition ne permet pas cette action.");
        if (!agent) {
          const result = row(row(row(row(current.event).payload).results)[input.channel!]);
          if (!Object.keys(result).length || input.channel === "youtube_shorts" || input.operation === "delete_channel" && input.channel === "tiktok") return fail("unsupported", "Ce canal ne dispose pas de cette suppression native. Ouvrez son service pour gérer la publication.");
          if (input.channel === "instagram" && !canRemoveInstagramDraftLocally(result, current.deliveries)) return fail("unsupported", "Instagram ne permet pas de supprimer une publication diffusée depuis iNrCy. Supprimez-la dans Instagram.");
          if (input.operation === "cancel_tiktok_pending" && !(result.pending === true || ["pending", "queued", "processing"].includes(String(result.status)))) return fail("blocked", "Seul un TikTok encore en attente peut être annulé localement.");
          if (input.operation === "retry_tiktok" && !canRetryTikTok(current)) return fail("blocked", "La nouvelle tentative exige un échec TikTok confirmé et les réglages/consentements natifs d’origine. Un état en cours ou inconnu ne sera pas relancé.");
        }
        const effect = input.operation === "retry_tiktok" ? "Retente uniquement le canal TikTok en échec avec ses médias et réglages natifs d’origine ; les autres canaux ne sont pas relancés." : input.operation === "delete_channel" ? input.channel === "instagram" ? "Retire uniquement le brouillon Instagram local, sans suppression distante." : `Supprime la diffusion sur ${input.channel} ; les autres canaux restent inchangés.` : input.operation === "cancel_tiktok_pending" ? "Annule le suivi TikTok dans iNr’Send uniquement. TikTok ne garantit pas l’arrêt de la diffusion déjà confiée." : input.operation === "refuse_prepared" ? "Refuse cette proposition non validée. Aucune publication existante n’est supprimée." : "Remet la proposition en attente de validation et suspend les diffusions futures concernées. Aucun envoi n’est lancé.";
        const preview = createAssistantActionPreview({ accountId, actorUserId, kind: "publication_lifecycle", targetId: input.targetId, fingerprint: assistantActionFingerprint(current), patch: { operation: input.operation, channel: input.channel } });
        return { ok: true, status: "preview_ready", approvalKind: "publication_lifecycle", ...preview, proposal: { ...describe(agent ? current : row(current.event), agent), targetId: input.targetId, operation: input.operation, channel: input.channel, effect }, message: `Vérifiez l’aperçu puis dites « Confirme ${preview.reference} ».`, nextAction: agent ? AGENT_LINK : SEND_LINK, untrustedContent: true };
      });
    } }),
    applyPublicationLifecycleAction: tool({ strict: true, description: "Appliquer seulement l’aperçu publication dont le pro confirme la référence IA- exacte dans son dernier message. Jeton récupéré côté serveur, compte et état relus, résultat natif vérifié. Ne pas répéter une suppression incertaine ; ne pas annoncer une suppression distante pour une annulation TikTok ou un brouillon Instagram local.", inputSchema: schema<ApplyInput>({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, instructionQuote: { type: "string", maxLength: 1200 } }, parseApply), execute: async raw => {
      const input = parseApply(raw), approved = verifyAssistantActionPreview(options.resolvePreview?.(input.reference) ?? "", { accountId, actorUserId, kind: "publication_lifecycle" });
      if (!approved || approved.reference !== input.reference || !hasAssistantActionApproval(options.currentApprovalMessage ?? options.currentUserMessage, input.instructionQuote, input.reference)) return fail("confirmation_required", "Confirmez la référence exacte d’un aperçu valide.");
      const action = String(approved.patch.operation), targetChannel = approved.patch.channel, agent = action.endsWith("prepared");
      return once(`apply:${input.reference}`, approved, agent, async () => {
        const current = agent ? await prepared(approved.targetId) : await published(approved.targetId); if (!current) return fail("not_found", "Publication introuvable.");
        if (assistantActionFingerprint(current) !== approved.fingerprint) return fail("stale_preview", "La publication a changé. Préparez un nouvel aperçu avant toute action.");
        if (agent && !(action === "refuse_prepared" ? editable(current) : action === "restore_prepared" && restorable(current))) return fail("blocked", "La proposition ne peut plus recevoir cette action.");
        if (!await access(true, agent)) return fail("blocked", "L’établissement actif a changé.");
        if (agent) {
          const response = await nativeAgent({ actionId: approved.targetId, expectedUpdatedAt: current.updated_at, ...(action === "refuse_prepared" ? { status: "refused" } : { editType: current.status === "refused" ? "restore_refused_publication" : "restore_validated_publication" }) });
          const result = row(await response.json()), after = response.ok ? await prepared(approved.targetId) : null;
          if (!response.ok || result.saved !== true || row(result.action).id !== approved.targetId || !after || after.status !== (action === "refuse_prepared" ? "refused" : "pending_validation")) return fail(response.status === 409 ? "stale_preview" : "unknown", "La nouvelle décision n’est pas confirmée. Relisez la proposition.");
          return { ok: true, status: String(after.status), action, actionId: approved.targetId, nextAction: AGENT_LINK, message: "La décision a été enregistrée puis relue. Aucune diffusion lancée." };
        }
        if (action === "retry_tiktok") {
          if (targetChannel !== "tiktok" || !canRetryTikTok(current)) return fail("blocked", "TikTok ne peut plus recevoir cette nouvelle tentative. Relisez son état.");
          const { POST } = await import("@/app/api/inrsend/publications/[publicationId]/tiktok/retry/route");
          const response = await POST(local(request, `/api/inrsend/publications/${approved.targetId}/tiktok/retry`, "POST", {}), { params: Promise.resolve({ publicationId: approved.targetId }) });
          const nativeResult = row(await response.json()), after = await published(approved.targetId), confirmed = row(row(row(row(after?.event).payload).results).tiktok);
          if (!response.ok || nativeResult.ok !== true || nativeResult.publication_id !== approved.targetId || !after || !await access(false, false) || assistantActionFingerprint(after) === approved.fingerprint) return fail("unknown", "La tentative TikTok n’a pas pu être confirmée. Relisez iNr’Send ; aucun nouvel envoi automatique ne sera lancé.");
          if (confirmed.pending === true || row(row(confirmed.diagnostics).status).pending === true || ["pending", "processing", "queued", "PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD", "SEND_TO_USER_INBOX"].includes(String(confirmed.tiktok_status ?? confirmed.status))) return { ok: true, status: "processing", action, publicationId: approved.targetId, channel: "tiktok", nextAction: SEND_LINK, message: "La nouvelle tentative TikTok est acceptée et encore en cours. Elle ne prouve pas une diffusion terminée." };
          if (confirmed.ok === true && confirmed.tiktok_status_fetch_failed !== true && ["published", "delivered", "success", "PUBLISH_COMPLETE"].includes(String(confirmed.tiktok_status ?? confirmed.status))) return { ok: true, status: "published", action, publicationId: approved.targetId, channel: "tiktok", nextAction: SEND_LINK, message: "La nouvelle tentative TikTok a été confirmée dans l’historique natif." };
          return fail("unknown", "L’état final TikTok doit être vérifié dans iNr’Send. Aucune autre tentative n’a été lancée.");
        }
        if (typeof targetChannel !== "string" || !CHANNELS.includes(targetChannel) || targetChannel === "youtube_shorts" || !["delete_channel", "cancel_tiktok_pending"].includes(action) || action === "delete_channel" && targetChannel === "tiktok") return fail("unsupported", "Action de canal non prise en charge.");
        const currentResult = row(row(row(row(current.event).payload).results)[targetChannel]);
        if (targetChannel === "instagram" && !canRemoveInstagramDraftLocally(currentResult, current.deliveries)) return fail("unsupported", "La suppression distante Instagram n’est pas prise en charge.");
        const routes: Record<string, string> = { site_web: "site-web", inr_search: "inr-search" };
        const { createPublicationChannelHandlers } = await import("@/lib/inrsend/publicationChannelActions");
        const native = createPublicationChannelHandlers(targetChannel as Parameters<typeof createPublicationChannelHandlers>[0]);
        const response = await native.DELETE(local(request, `/api/inrsend/publications/${approved.targetId}/${routes[targetChannel] || targetChannel}`, "DELETE", { externalId: typeof currentResult.external_id === "string" ? currentResult.external_id : null, ...(action === "cancel_tiktok_pending" ? { action: "cancel_pending" } : {}) }), { params: Promise.resolve({ publicationId: approved.targetId }) });
        const result = row(await response.json());
        if (!response.ok || result.ok !== true || (action === "cancel_tiktok_pending" ? result.cancelled !== true : result.deleted !== true)) return fail(response.status === 409 ? "blocked" : "unknown", "L’opération native n’est pas confirmée. Relisez iNr’Send avant toute nouvelle tentative.");
        const after = await published(approved.targetId), afterResult = row(row(row(row(after?.event).payload).results)[targetChannel]);
        if (!after || !await access(false, false) || (action === "cancel_tiktok_pending" ? afterResult.cancelled !== true && afterResult.status !== "cancelled" : afterResult.deleted !== true && afterResult.status !== "deleted")) return fail("unknown", "L’opération n’a pas pu être confirmée par relecture.");
        const localOnly = action === "cancel_tiktok_pending" || targetChannel === "instagram";
        return { ok: true, status: action === "cancel_tiktok_pending" ? "cancelled_locally" : localOnly ? "deleted_locally" : "deleted", action, publicationId: approved.targetId, channel: targetChannel, localOnly, nextAction: SEND_LINK, message: localOnly ? "La modification locale est confirmée. Aucune suppression distante n’est annoncée." : "La suppression du canal est confirmée par le chemin natif et l’historique relu." };
      });
    } }),
  };
}
