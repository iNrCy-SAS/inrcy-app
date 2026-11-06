import "server-only";
import { matchesInrAssistantActionClause, inrAssistantMaskQuotedText } from "./inrAssistantActionClause.ts";

import { createHash } from "node:crypto";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOOSTER_PUBLICATION_CHANNELS, BOOSTER_PUBLICATION_CHANNEL_LABELS, type BoosterPublicationChannelKey as Channel } from "./boosterPublicationPolicy.ts";
import { BOOSTER_CHANNEL_CONTENT_RULES } from "./boosterChannelRules.ts";
import { INSTAGRAM_CAPTION_MAX_LENGTH } from "./instagramCaptionLimits.ts";
import { countPinterestCharacters, PINTEREST_DESCRIPTION_MAX_LENGTH, PINTEREST_TITLE_MAX_LENGTH } from "./pinterestTextLimits.ts";
import { classifyBoosterPublicationResult } from "./boosterPublicationOutcome.ts";

type Row = Record<string, unknown>;
type Post = { channel: Channel; title: string; content: string; cta?: string | null; hashtags?: string[] | null; ctaMode?: string; ctaUrl?: string; ctaPhone?: string; ctaAction?: string };
type ChannelChange = { channel: Channel; field: "mediaIds" | "placement" | "includeStory" | "soundtrackId" | "threadsMode" | "pinterestBoardId" | "cta" | "imageTransform" | "videoFormat" | "videoAdaptationMode"; valueJson: string };
type PrepareInput = { posts: Post[]; mediaIds?: string[] | null; draftId?: string | null; operationKey?: string | null; channelChanges?: ChannelChange[] | null };
type ExecuteInput = { draftId: string; mode: "publish" | "schedule"; scheduledAt?: string | null; timezone?: string | null; channelSchedules?: Array<{ channel: Channel; scheduledAt: string }> | null; immediateChannels?: Channel[] | null };
type EditInput = { publicationId: string; channel: Channel; title?: string | null; content?: string | null; hashtags?: string[] | null };
export type InrAssistantPublicationResult = {
  action: "prepare" | "publish" | "schedule" | "edit" | "status";
  ok: boolean;
  status: "draft" | "queued" | "scheduled" | "updated" | "unchanged" | "needs_clarification" | "blocked" | "unknown" | "failed" | "partial" | "published" | "processing";
  message: string; toolUrl: string; checkedAt: string;
  draftId?: string; publicationId?: string; scheduledActionId?: string; scheduledAt?: string;
  channels?: Array<{ channel: Channel; status: string }>;
  scheduledActions?: Array<{ id: string; scheduledAt: string; channels: Channel[] }>;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SEND_URL = "/dashboard/mails?folder=publications";
const CHANNEL_FIELDS = ["mediaIds", "placement", "includeStory", "soundtrackId", "threadsMode", "pinterestBoardId", "cta", "imageTransform", "videoFormat", "videoAdaptationMode"] as const;
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
// Generated Instagram/Pinterest bodies keep their editorial headroom. Manual
// drafts use the native envelope; complete native text is still preflighted.
function manualPostContentMaximum(channel: Channel): number {
  return channel === "instagram" ? INSTAGRAM_CAPTION_MAX_LENGTH
    : channel === "pinterest" ? PINTEREST_DESCRIPTION_MAX_LENGTH : BOOSTER_CHANNEL_CONTENT_RULES[channel].max;
}
function manualPostContent(value: unknown, channel: Channel, nullable = false): string | undefined {
  if (channel !== "pinterest") return text(value, manualPostContentMaximum(channel), nullable);
  return pinterestText(value, PINTEREST_DESCRIPTION_MAX_LENGTH, nullable);
}
function manualPostTitle(value: unknown, channel: Channel, nullable = false): string | undefined {
  return channel === "pinterest" ? pinterestText(value, PINTEREST_TITLE_MAX_LENGTH, nullable) : text(value, 180, nullable);
}
function pinterestText(value: unknown, maximum: number, nullable: boolean): string | undefined {
  if (value == null && nullable) return undefined;
  if (typeof value !== "string" || countPinterestCharacters(value) > maximum || !value.trim()) throw new PublicationInputError("Texte de publication invalide.");
  return value.trim();
}
function post(value: unknown): Post {
  const input = row(value); strict(input, ["channel", "title", "content", "cta", "hashtags", "ctaMode", "ctaUrl", "ctaPhone", "ctaAction"]);
  if (!BOOSTER_PUBLICATION_CHANNELS.includes(input.channel as Channel)) throw new PublicationInputError("Canal de publication invalide.");
  const channel = input.channel as Channel;
  if (input.cta != null && (typeof input.cta !== "string" || input.cta.length > 300)) throw new PublicationInputError("Appel à l’action invalide.");
  for (const field of ["ctaMode", "ctaUrl", "ctaPhone", "ctaAction"]) if (input[field] != null && (typeof input[field] !== "string" || String(input[field]).length > (field === "ctaUrl" ? 2000 : 80))) throw new PublicationInputError("Destination d’appel à l’action invalide.");
  if (input.ctaMode != null && !["none", "website", "call", "message", "custom"].includes(String(input.ctaMode))) throw new PublicationInputError("Choix d’appel à l’action invalide.");
  return { channel, title: manualPostTitle(input.title, channel)!, content: manualPostContent(input.content, channel)!,
    cta: typeof input.cta === "string" ? input.cta.trim() : undefined, hashtags: tags(input.hashtags), ...Object.fromEntries(["ctaMode", "ctaUrl", "ctaPhone", "ctaAction"].filter(key => input[key] != null).map(key => [key, String(input[key]).trim()])) };
}
function prepareInput(value: unknown): PrepareInput {
  const input = row(value); strict(input, ["posts", "mediaIds", "draftId", "operationKey", "channelChanges"]);
  if (!Array.isArray(input.posts) || input.posts.length < 1 || input.posts.length > 11) throw new PublicationInputError("Précisez le texte et les canaux de la publication.");
  const posts = input.posts.map(post);
  if (new Set(posts.map((item) => item.channel)).size !== posts.length) throw new PublicationInputError("Un seul texte par canal est attendu.");
  if (input.mediaIds != null && (!Array.isArray(input.mediaIds) || input.mediaIds.length > 4)) throw new PublicationInputError("Sélectionnez au plus quatre médias.");
  if (input.operationKey != null && (typeof input.operationKey !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(input.operationKey))) throw new PublicationInputError("Clé de lot invalide.");
  return { posts, mediaIds: input.mediaIds == null ? null : [...new Set((input.mediaIds as unknown[]).map(id))], draftId: input.draftId == null ? undefined : id(input.draftId), operationKey: input.operationKey == null ? null : String(input.operationKey), channelChanges: parseChannelChanges(input.channelChanges, posts.map(post => post.channel)) };
}
function parseChannelChanges(value: unknown, channels: Channel[]): ChannelChange[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 50) throw new PublicationInputError("Options par canal invalides.");
  const seen = new Set<string>();
  return value.map(entry => {
    const change = row(entry); strict(change, ["channel", "field", "valueJson"]);
    if (Object.keys(change).length !== 3 || !channels.includes(change.channel as Channel) || !(CHANNEL_FIELDS as readonly unknown[]).includes(change.field) || typeof change.valueJson !== "string" || change.valueJson.length > 2000) throw new PublicationInputError("Option de canal invalide.");
    let parsed: unknown; try { parsed = JSON.parse(change.valueJson); } catch { throw new PublicationInputError("Valeur d’option invalide."); }
    const key = `${change.channel}:${change.field}${change.field === "imageTransform" ? `:${row(parsed).imageIndex}` : ""}`;
    if (seen.has(key)) throw new PublicationInputError("Une seule modification par champ ou image est attendue."); seen.add(key);
    const meta = ["facebook", "instagram"].includes(String(change.channel));
    if (change.field === "mediaIds" ? !Array.isArray(parsed) || parsed.length > 4 || parsed.some(value => typeof value !== "string" || !UUID.test(value)) || new Set(parsed).size !== parsed.length
      : change.field === "placement" ? !meta || !["classic", "reel", "story"].includes(String(parsed))
        : change.field === "includeStory" ? !meta || typeof parsed !== "boolean"
          : change.field === "soundtrackId" ? !meta || parsed !== null && (typeof parsed !== "string" || parsed.length > 100 || !/^[a-z0-9_-]+$/.test(parsed))
            : change.field === "threadsMode" ? change.channel !== "threads" || !["classic", "ghost"].includes(String(parsed))
              : change.field === "pinterestBoardId" ? change.channel !== "pinterest" || typeof parsed !== "string" || !/^\d{1,40}$/.test(parsed)
                : change.field === "videoFormat" ? !["original", "9_16", "1_1", "16_9"].includes(String(parsed))
                  : change.field === "videoAdaptationMode" ? !["safe_frame", "cover_crop"].includes(String(parsed))
                    : change.field === "cta" ? !validCtaChange(parsed)
                      : !validImageTransformChange(parsed)) throw new PublicationInputError("Cette option ne correspond pas au canal.");
    return change as unknown as ChannelChange;
  });
}
function validCtaChange(value: unknown) {
  const input = row(value), keys = Object.keys(input);
  return keys.length > 0 && keys.every(key => ["cta", "ctaMode", "ctaUrl", "ctaPhone", "ctaAction"].includes(key)) && keys.every(key => typeof input[key] === "string" && String(input[key]).length <= (key === "ctaUrl" ? 2000 : key === "cta" ? 300 : 80))
    && (input.ctaMode === undefined || ["none", "website", "call", "message", "custom"].includes(String(input.ctaMode)))
    && (input.ctaAction === undefined || ["", "BOOK", "ORDER", "SHOP", "SIGN_UP"].includes(String(input.ctaAction)));
}
function validImageTransformChange(value: unknown) {
  const input = row(value), keys = Object.keys(input);
  if (!Number.isInteger(input.imageIndex) || Number(input.imageIndex) < 0 || Number(input.imageIndex) > 4 || keys.length < 2 || keys.some(key => !["imageIndex", "fit", "zoom", "offsetX", "offsetY", "backgroundMode", "backgroundColor"].includes(key))) return false;
  return keys.every(key => key === "imageIndex" || key === "fit" ? key === "imageIndex" || ["contain", "cover"].includes(String(input[key]))
    : key === "zoom" ? typeof input[key] === "number" && Number.isFinite(input[key]) && Number(input[key]) >= .4 && Number(input[key]) <= 3
      : key === "offsetX" || key === "offsetY" ? typeof input[key] === "number" && Number.isFinite(input[key]) && Math.abs(Number(input[key])) <= 100
        : key === "backgroundMode" ? ["transparent", "color", "white", "black", "gray", "sand", "brand"].includes(String(input[key])) : typeof input[key] === "string" && /^#[a-f\d]{6}$/i.test(input[key]));
}
function executeInput(value: unknown): ExecuteInput {
  const input = row(value); strict(input, ["draftId", "mode", "scheduledAt", "timezone", "channelSchedules", "immediateChannels"]);
  if (input.mode !== "publish" && input.mode !== "schedule") throw new PublicationInputError("Choisissez publier ou programmer.");
  if (input.scheduledAt != null && (typeof input.scheduledAt !== "string" || input.scheduledAt.length > 40)) throw new PublicationInputError("Date invalide.");
  if (input.timezone != null && (typeof input.timezone !== "string" || input.timezone.length > 70)) throw new PublicationInputError("Fuseau horaire invalide.");
  if (input.immediateChannels != null && (!Array.isArray(input.immediateChannels) || input.immediateChannels.length > 11 || input.immediateChannels.some(channel => !BOOSTER_PUBLICATION_CHANNELS.includes(channel as Channel)) || new Set(input.immediateChannels).size !== input.immediateChannels.length)) throw new PublicationInputError("Canaux immédiats invalides.");
  if (input.channelSchedules != null && (!Array.isArray(input.channelSchedules) || input.channelSchedules.length > 11 || new Set(input.channelSchedules.map(item => row(item).channel)).size !== input.channelSchedules.length || input.channelSchedules.some(item => { const entry = row(item); return Object.keys(entry).length !== 2 || !BOOSTER_PUBLICATION_CHANNELS.includes(entry.channel as Channel) || typeof entry.scheduledAt !== "string" || entry.scheduledAt.length > 40; }))) throw new PublicationInputError("Programmations par canal invalides.");
  if (input.mode === "publish" && (Array.isArray(input.channelSchedules) && input.channelSchedules.length || Array.isArray(input.immediateChannels) && input.immediateChannels.length)) throw new PublicationInputError("Les dates par canal nécessitent le mode programmer.");
  return { draftId: id(input.draftId), mode: input.mode, scheduledAt: input.scheduledAt as string | null, timezone: input.timezone as string | null, channelSchedules: input.channelSchedules as ExecuteInput["channelSchedules"], immediateChannels: input.immediateChannels as ExecuteInput["immediateChannels"] };
}
function editInput(value: unknown): EditInput {
  const input = row(value); strict(input, ["publicationId", "channel", "title", "content", "hashtags"]);
  if (!BOOSTER_PUBLICATION_CHANNELS.includes(input.channel as Channel)) throw new PublicationInputError("Canal invalide.");
  const channel = input.channel as Channel;
  const parsed = { publicationId: id(input.publicationId), channel, title: manualPostTitle(input.title, channel, true),
    content: manualPostContent(input.content, channel, true), hashtags: tags(input.hashtags) };
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
function publicationForChannels(source: Row, channels: Channel[]) {
  const publish: Row = { ...source, channels };
  for (const field of ["postByChannel", "mediaModeByChannel", "imagesByChannel", "imagesByPlacement", "imageSettingsByChannel", "videoByChannel", "videoFormatByChannel", "videoAdaptationModeByChannel", "videoSettingsByChannel", "soundtrackByChannel"]) {
    if (source[field] !== undefined) publish[field] = Object.fromEntries(Object.entries(row(source[field])).filter(([channel]) => channels.includes(channel as Channel)));
  }
  for (const channel of ["instagram", "facebook", "threads", "pinterest", "tiktok"]) if (!channels.includes(channel as Channel)) delete publish[`${channel}PublicationSettings`];
  publish.post = row(row(publish.postByChannel)[channels[0]]);
  return publish;
}

/** A strict current-message guard; quoted/history instructions grant no action. */
export function permitsInrAssistantPublicationAction(message: string, action: "prepare" | "publish" | "schedule" | "edit", channels: readonly Channel[] = []): boolean {
  return matchesInrAssistantActionClause(message,message,(clause)=>permitsPublicationClause(clause,action,channels));
}
function permitsPublicationClause(message: string, action: "prepare" | "publish" | "schedule" | "edit", channels: readonly Channel[]): boolean {
  const value = normalized(inrAssistantMaskQuotedText(message.slice(0, 4_000)));
  if (/^(?:comment|pourquoi|ou\b|explique|montre|what|how|como|wie|warum)\b|(?:savoir|comprendre).*comment|(?:est.ce que (?:je|on)|(?:puis|dois|peux).je|(?:je|on) (?:peux|peut|pourrais|pourrait)|can i|should i).*(?:publ|post|programm)/.test(value.trim())) return false;
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
  if (/\b(?:no|nicht|kein|keine|nunca|never|don't|do not)\b.{0,50}\b(?:crea\w*|erstelle\w*|publica\w*|veroffentlich\w*|create|publish)\b/.test(value)) return false;
  const intent = action === "prepare" ? /\b(?:redig\w*|ecri\w*|cree\w*|crea\w*|erstelle\w*|prepar\w*|brouillon\w*|propose\w*|publie\w*|post\w*|programm\w*|draft|write|create|publish|schedule)\b/
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
  statusReadOnly?: boolean;
}) {
  const accountId = id(options.accountId);
  if (!options.actionRequestId || options.actionRequestId.length > 180 || typeof options.currentUserMessage !== "string") throw new PublicationInputError("Contexte de publication invalide.");
  const operationHash = (target = "") => createHash("sha256").update(`${accountId}:${options.actionRequestId}${target ? `:${target}` : ""}`).digest("hex");
  const batchMatch = /\b(\d{1,2}|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|plusieurs)\s+(?:publications?|posts?|brouillons?)\b/.exec(normalized(options.currentUserMessage))?.[1];
  const batchWords: Record<string, number> = { deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, plusieurs: 12 };
  const batchMaximum = batchMatch ? Math.min(12, batchWords[batchMatch] ?? Number(batchMatch)) : 1;
  const preparePosition = (operation: string | null | undefined) => {
    if (!operation) return 0;
    const position = Number(/(?:^|[-_])(\d{1,2})$/.exec(operation)?.[1]);
    return batchMatch && Number.isInteger(position) && position >= 1 && position <= batchMaximum ? position : -1;
  };
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
    const data = row(input);
    const category = action === "publish" || action === "schedule" ? "execute" : action;
    const target = category === "prepare" ? String(preparePosition(data.operationKey as string | null)) : category === "execute" ? String(data.draftId) : category === "edit" ? `${String(data.publicationId)}:${String(data.channel)}` : "default";
    const slot = `${category}:${target}`;
    const previous = singleflight.get(slot);
    if (previous) return previous.fingerprint === fingerprint ? previous.promise : result(action, "needs_clarification", "Une action de ce type a déjà été traitée dans cette demande. Précisez la nouvelle modification dans un nouveau message.");
    if (category !== "status" && [...singleflight.keys()].filter(key => key.startsWith(`${category}:`)).length >= batchMaximum) return result(action, "needs_clarification", "Le nombre d’éléments demandé a déjà été traité. Aucun élément supplémentaire n’a été créé ni diffusé.");
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
      return { channel, title: stored.title || payload.title, content: stored.content || stored.text || stored.message, cta: stored.cta ?? "", hashtags: stored.hashtags ?? [],
        ...Object.fromEntries(["ctaMode", "ctaUrl", "ctaPhone", "ctaAction"].filter(key => stored[key] != null).map(key => [key, stored[key]])) };
    }), mediaIds: null, draftId: null }).posts;
  }
  function postedPayload(posts: Post[], assets: Awaited<ReturnType<typeof media>>, previous: Row = {}, resetMedia = false) {
    const postByChannel = Object.fromEntries(posts.map(({ channel, ...content }) => {
      const before = { ...row(row(previous.postByChannel)[channel]) };
      if (resetMedia) for (const field of ["media", "mediaAsset", "image", "imageAsset", "video", "videoAsset", "imageUrl", "mediaMode"]) delete before[field];
      return [channel, { ...before, ...Object.fromEntries(Object.entries(content).filter(([, value]) => value !== undefined)), cta: content.cta ?? before.cta ?? "", hashtags: content.hashtags ?? before.hashtags ?? [] }];
    }));
    const preserved = Object.fromEntries(["imageSettingsByChannel", "imagesByPlacement", "imagesByChannel", "videoByChannel", "videoFormatByChannel", "videoAdaptationModeByChannel", "videoSettingsByChannel", "mediaModeByChannel", "mediaWorkspaceId", "mediaWorkspaceClientKey", "mediaPipelineCutoverV1", "imageInteractionsByKey", "videoSourceMetadata", "theme"].filter(key => previous[key] !== undefined && !(resetMedia && ["imageSettingsByChannel", "imagesByPlacement", "imagesByChannel", "videoByChannel", "mediaModeByChannel", "mediaWorkspaceId", "mediaWorkspaceClientKey", "mediaPipelineCutoverV1"].includes(key))).map(key => [key, previous[key]]));
    const priorImages = [...(Array.isArray(previous.images) ? previous.images : []), ...(Array.isArray(previous.imageDrafts) ? previous.imageDrafts : [])].map(row);
    const images = assets.images.map((asset, index) => { const before = priorImages.find(item => (item.mediaId || item.id) === asset.mediaId || item.storagePath === asset.storagePath); return { ...before, ...asset, imageKey: before?.imageKey || `image-${index + 1}` }; });
    const video = assets.video ? { ...(resetMedia ? {} : row(previous.video || previous.videoDraft)), ...assets.video } : null;
    const clearedMedia = resetMedia ? { imageSettingsByChannel: {}, imagesByPlacement: {}, imagesByChannel: {}, videoByChannel: {}, mediaWorkspaceId: null, mediaWorkspaceClientKey: null, mediaPipelineCutoverV1: false } : {};
    return { ...preserved, ...clearedMedia, creationMode: "manual", source: "booster", origin: { source: "booster", label: "iNr’Assistant", workflowTool: "booster", workflowAction: "publier" },
      channels: posts.map(({ channel }) => channel), postByChannel, post: row(postByChannel[posts[0].channel]), idea: posts[0].content.slice(0, 500),
      mediaType: video || !resetMedia && previous.mediaType === "video" ? "video" : "images", images, video,
      mediaModeByChannel: { ...Object.fromEntries(posts.map(({ channel }) => [channel, video ? "video" : images.length ? "images" : "none"])), ...(!resetMedia ? row(previous.channelMediaModes) : {}), ...row(preserved.mediaModeByChannel) } };
  }
  async function applyChannelOptions(publish: Row, changes: ChannelChange[] | null, previous: Row = {}) {
    for (const key of ["instagramPublicationSettings", "facebookPublicationSettings", "threadsPublicationSettings", "pinterestPublicationSettings", "soundtrackByChannel"]) if (previous[key] !== undefined) publish[key] = previous[key];
    for (const channel of ["instagram", "facebook"]) if (previous[`${channel}PublicationSettings`] === undefined && previous[`${channel}PublicationPlacement`] !== undefined) {
      const { buildMetaPublicationSelection } = await import("@/lib/metaPublicationTargets");
      const placement = String(previous[`${channel}PublicationPlacement`]);
      if (!["classic", "reel", "story"].includes(placement)) throw new PublicationInputError("Placement Meta du brouillon invalide.");
      publish[`${channel}PublicationSettings`] = buildMetaPublicationSelection(placement as "classic" | "reel" | "story", previous[`${channel}StoryEnabled`] === true);
    }
    if (previous.pinterestPublicationSettings === undefined && typeof previous.pinterestBoardId === "string" && previous.pinterestBoardId) publish.pinterestPublicationSettings = { boardId: previous.pinterestBoardId, boardName: previous.pinterestBoardName || "" };
    for (const change of changes ?? []) {
      const value: unknown = JSON.parse(change.valueJson), channel = change.channel;
      if (change.field === "mediaIds") {
        const selected = await media(value as string[]); if (selected.video) throw new PublicationInputError("Le média propre à un canal doit contenir des images ; choisissez une vidéo commune via mediaIds.");
        publish.imagesByChannel = { ...row(publish.imagesByChannel), [channel]: selected.images };
        publish.mediaModeByChannel = { ...row(publish.mediaModeByChannel), [channel]: selected.images.length ? "images" : "none" };
      } else if (change.field === "placement" || change.field === "includeStory") {
        const key = `${channel}PublicationSettings`, before = row(publish[key]);
        const placement = change.field === "placement" ? String(value) : String(before.primaryPlacement ?? before.placement ?? "classic"), includeStory = change.field === "includeStory" ? value === true : before.includeStory === true;
        publish[key] = { version: 2, primaryPlacement: placement, includeStory: placement === "story" ? false : includeStory, placements: placement === "story" ? ["story"] : [placement, ...(includeStory ? ["story"] : [])] };
      } else if (change.field === "threadsMode") publish.threadsPublicationSettings = { mode: value };
      else if (change.field === "soundtrackId") {
        if (value !== null) { const { GET } = await import("@/app/api/booster/soundtracks/route"); const response = await GET(), catalog = row(await response.json()); if (!response.ok || !Array.isArray(catalog.soundtracks) || !catalog.soundtracks.some(item => row(item).id === value)) throw new PublicationInputError("Choisissez une musique du catalogue natif Booster."); }
        publish.soundtrackByChannel = { ...row(publish.soundtrackByChannel), [channel]: value };
      } else if (change.field === "cta") {
        const posts = row(publish.postByChannel), before = row(posts[channel]), patch = row(value), candidate = { ...before, ...patch };
        const { getCtaMode, getCtaWebsiteUrl, getCtaPhone, isBoosterCtaModeSupportedForChannel, normalizeBoosterPostCtaForChannel } = await import("@/lib/boosterCta");
        const mode = getCtaMode(candidate);
        if (!isBoosterCtaModeSupportedForChannel(channel, mode) || ["website", "custom"].includes(mode) && !getCtaWebsiteUrl(candidate) || mode === "call" && !getCtaPhone(candidate)) throw new PublicationInputError("Précisez un CTA et une destination valides pour ce canal ; aucun réglage global ne les remplacera.");
        posts[channel] = normalizeBoosterPostCtaForChannel(channel, candidate); publish.postByChannel = posts;
      } else if (change.field === "videoFormat" || change.field === "videoAdaptationMode") {
        const before = row(row(publish.videoSettingsByChannel)[channel]);
        const settings = { ...before, format: change.field === "videoFormat" ? value : before.format || row(publish.videoFormatByChannel)[channel] || "original",
          adaptationMode: change.field === "videoAdaptationMode" ? value : before.adaptationMode || row(publish.videoAdaptationModeByChannel)[channel] || "safe_frame" };
        publish.videoSettingsByChannel = { ...row(publish.videoSettingsByChannel), [channel]: settings };
        publish.videoFormatByChannel = { ...row(publish.videoFormatByChannel), [channel]: settings.format };
        publish.videoAdaptationModeByChannel = { ...row(publish.videoAdaptationModeByChannel), [channel]: settings.adaptationMode };
      } else if (change.field === "imageTransform") {
        const patch = { ...row(value) }, imageIndex = Number(patch.imageIndex); delete patch.imageIndex;
        const selected = Array.isArray(row(publish.imagesByChannel)[channel]) ? row(publish.imagesByChannel)[channel] as unknown[] : Array.isArray(publish.images) ? publish.images as unknown[] : [];
        if (!selected[imageIndex] || row(publish.mediaModeByChannel)[channel] !== "images") throw new PublicationInputError("Cette image n’existe pas dans le canal sélectionné.");
        const before = row(row(publish.imageSettingsByChannel)[channel]), keys = selected.map((item, index) => String(row(item).imageKey || (Array.isArray(before.imageKeys) ? before.imageKeys[index] : "") || `image-${index + 1}`)), key = keys[imageIndex];
        const prior = row(row(before.transforms)[key]), next = { fit: "contain", zoom: 1, offsetX: 0, offsetY: 0, backgroundMode: "color", backgroundColor: "#ffffff", ...prior, ...patch, blurBackground: false };
        if (next.fit === "contain" && Number(next.zoom) > 1) throw new PublicationInputError("Le mode image entière accepte un zoom au maximum égal à un.");
        publish.imageSettingsByChannel = { ...row(publish.imageSettingsByChannel), [channel]: { ...before, imageKeys: keys, transforms: { ...row(before.transforms), [key]: next }, customizedImageKeys: [...new Set([...(Array.isArray(before.customizedImageKeys) ? before.customizedImageKeys : []), key])] } };
        // Existing placement derivatives no longer represent the changed image.
        // The native pipeline must regenerate this channel from its owned source.
        if (publish.imagesByPlacement) { const placements = { ...row(publish.imagesByPlacement) }; delete placements[channel]; publish.imagesByPlacement = placements; }
      } else {
        const { GET } = await import("@/app/api/integrations/pinterest/boards/route"); const response = await GET(request(options.request, "/api/integrations/pinterest/boards")), data = row(await response.json());
        const board = Array.isArray(data.boards) ? data.boards.map(row).find(board => board.id === value) : null;
        if (!response.ok || data.ok !== true || !board) throw new PublicationInputError("Choisissez un tableau Pinterest accessible au compte connecté.");
        publish.pinterestPublicationSettings = { boardId: board.id, boardName: typeof board.name === "string" ? board.name.slice(0, 180) : "" };
      }
    }
    const channels = Array.isArray(publish.channels) ? publish.channels : [];
    for (const channel of channels) {
      const post = row(row(publish.postByChannel)[String(channel)]);
      if (post.ctaMode !== undefined) {
        const { getCtaMode, getCtaWebsiteUrl, getCtaPhone, isBoosterCtaModeSupportedForChannel, normalizeBoosterPostCtaForChannel } = await import("@/lib/boosterCta");
        const mode = getCtaMode(post);
        if (!isBoosterCtaModeSupportedForChannel(channel as Channel, mode) || ["website", "custom"].includes(mode) && !getCtaWebsiteUrl(post) || mode === "call" && !getCtaPhone(post)) throw new PublicationInputError("Ce CTA ponctuel est incomplet ou indisponible sur ce canal. Vérifiez son mode et sa destination.");
        row(publish.postByChannel)[String(channel)] = normalizeBoosterPostCtaForChannel(channel as Channel, post);
      }
    }
    if (channels.length) publish.post = row(row(publish.postByChannel)[String(channels[0])]);
    return publish;
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
    readPublicationOptions: tool({ strict: true, description: "Consulter les vrais IDs et libellés des musiques Booster Meta ou tableaux Pinterest du compte connecté avant de choisir une option par canal. Aucun envoi. Ne jamais inventer un ID de musique/tableau.", inputSchema: schema<{ view: "soundtracks" | "pinterest_boards" }>({ type: "object", properties: { view: { type: "string", enum: ["soundtracks", "pinterest_boards"] } }, required: ["view"], additionalProperties: false }, raw => { const value = row(raw); strict(value, ["view"]); if (!["soundtracks", "pinterest_boards"].includes(String(value.view))) throw new PublicationInputError("Catalogue invalide"); return value as { view: "soundtracks" | "pinterest_boards" }; }), execute: async ({ view }) => {
      const denied = await access("status", false); if (denied) return denied;
      try { const response = view === "soundtracks" ? await (await import("@/app/api/booster/soundtracks/route")).GET() : await (await import("@/app/api/integrations/pinterest/boards/route")).GET(request(options.request, "/api/integrations/pinterest/boards")); const data = row(await response.json()); if (!response.ok || data.ok !== true) return result("status", "blocked", "Le catalogue natif demandé n’est pas disponible."); const items = view === "soundtracks" ? data.soundtracks : data.boards; return { ok: true, status: "read", view, items: Array.isArray(items) ? items.slice(0, 100).map(item => ({ id: String(row(item).id ?? "").slice(0, 100), label: String(row(item).label ?? row(item).name ?? "").slice(0, 180) })) : [], untrustedContent: true }; } catch { return result("status", "unknown", "Le catalogue n’a pas pu être vérifié."); }
    } }),
    preparePublication: tool({ strict: true,
      description: "Enregistrer un brouillon Booster demandé actuellement : posts contient un texte par canal et mediaIds des IDs actifs de Médiathèque. Aucun envoi. draftId=null crée, sinon corrige ; mediaIds=null conserve, [] retire sur ordre. Pour un lot explicitement chiffré, appeler une fois par publication avec operationKey=post-1, post-2, etc. (maximum 12), conserver ces indices à la reprise. null pour une publication unique. Retourne chaque draftId pour executePublication.",
      inputSchema: schema<PrepareInput>({ type: "object", properties: {
        posts: { type: "array", minItems: 1, maxItems: 11, items: { type: "object", properties: { channel: { type: "string", enum: BOOSTER_PUBLICATION_CHANNELS }, title: { type: "string", maxLength: 180 }, content: { type: "string", maxLength: 5_000 }, cta: nullableString(300), hashtags: tagSchema }, required: ["channel", "title", "content", "cta", "hashtags"], additionalProperties: false } },
        mediaIds: { type: ["array", "null"], maxItems: 4, items: idSchema }, draftId: { anyOf: [idSchema, { type: "null" }] }, operationKey: { type: ["string", "null"], maxLength: 40 },
        channelChanges: { type: ["array", "null"], description: "Valeurs JSON natives par canal : mediaIds images, placement classic/reel/story, includeStory, soundtrackId catalogue/null, threadsMode classic/ghost, pinterestBoardId catalogue. cta={ctaMode:none/website/call/message/custom,cta?,ctaUrl?,ctaPhone?,ctaAction?:BOOK/ORDER/SHOP/SIGN_UP} ponctuel, destinations explicites. imageTransform={imageIndex:0..4,fit?:contain/cover,zoom?:0.4..3 (contain≤1),offsetX/Y?:-100..100,backgroundMode?,backgroundColor?:#RRGGBB}. videoFormat=original/9_16/1_1/16_9 ; videoAdaptationMode=safe_frame/cover_crop. Champs absents conservés ; aucun consentement inventé.", maxItems: 50, items: { type: "object", properties: { channel: { type: "string", enum: BOOSTER_PUBLICATION_CHANNELS }, field: { type: "string", enum: [...CHANNEL_FIELDS] }, valueJson: { type: "string", maxLength: 2000 } }, required: ["channel", "field", "valueJson"], additionalProperties: false } },
      }, required: ["posts", "mediaIds", "draftId", "operationKey", "channelChanges"], additionalProperties: false }, prepareInput),
      execute: async (raw) => {
        const input = prepareInput(raw);
        const position = preparePosition(input.operationKey);
        if (position < 0) return result("prepare", "needs_clarification", "Une clé numérotée de lot exige une demande explicite de plusieurs publications.");
        const receipt = `assistant-publication:v1:${operationHash(position ? `batch:${position}` : "")}`;
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
          const hasPreviousMedia = Boolean(previousPayload.mediaWorkspaceId || previousPayload.videoDraft || (Array.isArray(previousPayload.imageDrafts) && previousPayload.imageDrafts.length));
          if (input.draftId && hasPreviousMedia && input.mediaIds?.length === 0 && !/(?:sans (?:image|video|media)|texte seul|(?:retire|supprime|enleve).{0,25}(?:image|video|media))/i.test(normalized(options.currentUserMessage))) return result("prepare", "needs_clarification", "Le brouillon contient déjà des médias. Souhaitez-vous les conserver ou les retirer ? Aucun média n’a été supprimé.", { draftId: input.draftId });
          const mediaIds = input.mediaIds ?? (Array.isArray(previousPayload.assistantMediaIds) ? previousPayload.assistantMediaIds.map(id) : []);
          const assets = await media(mediaIds);
          const priorChanges = parseChannelChanges(previousPayload.assistantChannelChanges, [...new Set([...(Array.isArray(previousPayload.channels) ? previousPayload.channels as Channel[] : []), ...input.posts.map(post => post.channel)])]) ?? [];
          const changes = input.channelChanges == null ? priorChanges : [...priorChanges.filter(before => !input.channelChanges!.some(after => before.channel === after.channel && before.field === after.field)), ...input.channelChanges];
          const resetMedia = input.mediaIds != null && (Boolean(previousPayload.mediaWorkspaceId) || JSON.stringify(input.mediaIds) !== JSON.stringify(Array.isArray(previousPayload.assistantMediaIds) ? previousPayload.assistantMediaIds : []));
          const publish = await applyChannelOptions(postedPayload(input.posts, assets, previousPayload, resetMedia), input.channelChanges ?? null, previousPayload);
          const preservedLegacyMedia = input.draftId && input.mediaIds == null && !mediaIds.length && hasPreviousMedia
            ? { imageDrafts: previousPayload.imageDrafts, videoDraft: previousPayload.videoDraft, images: previousPayload.images, video: previousPayload.video,
              mediaType: previousPayload.mediaType, mediaModeByChannel: previousPayload.mediaModeByChannel } : {};
          const payload = { ...previousPayload, ...publish, status: "draft", title: input.posts[0].title, content: input.posts[0].content, preview: input.posts[0].content.slice(0, 180),
            channels: [...new Set([...(Array.isArray(previousPayload.channels) ? previousPayload.channels.filter((channel) => BOOSTER_PUBLICATION_CHANNELS.includes(channel as Channel)) : []), ...input.posts.map((item) => item.channel)])],
            postByChannel: { ...row(previousPayload.postByChannel), ...row(publish.postByChannel) },
            assistantActionKey: receipt, assistantMediaIds: mediaIds, assistantChannelChanges: changes, imageDrafts: assets.images, videoDraft: assets.video, ...preservedLegacyMedia, saved_at: new Date().toISOString() };
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
      inputSchema: schema<ExecuteInput>({ type: "object", properties: { draftId: idSchema, mode: { type: "string", enum: ["publish", "schedule"] }, scheduledAt: nullableString(40), timezone: nullableString(70),
        channelSchedules: { type: ["array", "null"], maxItems: 11, description: "Optionnel : dates ISO futures propres à chaque canal. Avec cette liste, tous les canaux du brouillon doivent être ici ou dans immediateChannels, sans recouvrement ; scheduledAt=null.", items: { type: "object", properties: { channel: { type: "string", enum: BOOSTER_PUBLICATION_CHANNELS }, scheduledAt: { type: "string", maxLength: 40 } }, required: ["channel", "scheduledAt"], additionalProperties: false } },
        immediateChannels: { type: ["array", "null"], maxItems: 11, uniqueItems: true, description: "Optionnel : canaux à publier maintenant lors d’une programmation mixte ; instruction immédiate explicite requise pour chacun.", items: { type: "string", enum: BOOSTER_PUBLICATION_CHANNELS } },
      }, required: ["draftId", "mode", "scheduledAt", "timezone", "channelSchedules", "immediateChannels"], additionalProperties: false }, executeInput),
      execute: async (raw) => {
        const input = executeInput(raw);
        const executionHash = operationHash(`draft:${input.draftId}`);
        const publishKey = `booster_manual:assistant:${executionHash}`;
        const rawUuid = `${executionHash.slice(0, 12)}5${executionHash.slice(13, 16)}8${executionHash.slice(17, 32)}`;
        const scheduleId = `${rawUuid.slice(0, 8)}-${rawUuid.slice(8, 12)}-${rawUuid.slice(12, 16)}-${rawUuid.slice(16, 20)}-${rawUuid.slice(20)}`;
        return once(input.mode, input, async () => {
          const denied = await access(input.mode); if (denied) return denied;
          const payload = await draft(input.draftId), posts = storedPosts(payload), channels = posts.map((item) => item.channel);
          const immediate = input.mode === "schedule" ? input.immediateChannels ?? [] : [];
          const customDates = input.channelSchedules?.length ? input.channelSchedules : null;
          const scheduledChannels = input.mode === "schedule" ? customDates ? customDates.map(item => item.channel) : channels.filter(channel => !immediate.includes(channel)) : [];
          if (input.mode === "schedule" && (!scheduledChannels.length || customDates && input.scheduledAt != null || [...scheduledChannels, ...immediate].length !== channels.length
            || new Set([...scheduledChannels, ...immediate]).size !== channels.length || [...scheduledChannels, ...immediate].some(channel => !channels.includes(channel)))) return result("schedule", "needs_clarification", "Chaque canal du brouillon doit avoir une date ou être explicitement immédiat, sans doublon. Avec des dates par canal, laissez scheduledAt à null.");
          const allowed = input.mode === "schedule" ? scheduledChannels.every(channel => permitsInrAssistantPublicationAction(options.currentUserMessage, "schedule", [channel]))
            && immediate.every(channel => permitsInrAssistantPublicationAction(options.currentUserMessage, "publish", [channel])) : permitsInrAssistantPublicationAction(options.currentUserMessage, "publish", channels);
          if (!allowed) return result(input.mode, "needs_clarification", "Précisez si vous souhaitez publier maintenant ou programmer, et sur quels canaux. Les canaux immédiats nécessitent leur propre ordre actuel ; une ancienne demande ou un simple oui ne déclenche aucun envoi.", { draftId: input.draftId });
          const scheduleGroups = new Map<string, Channel[]>();
          if (input.mode === "schedule") {
            if (!input.timezone) return result("schedule", "needs_clarification", "Précisez le fuseau de programmation.");
            try { new Intl.DateTimeFormat("fr-FR", { timeZone: input.timezone }); } catch { return result("schedule", "needs_clarification", "Précisez un fuseau horaire valide."); }
            for (const channel of scheduledChannels) {
              const dateText = customDates?.find(item => item.channel === channel)?.scheduledAt ?? input.scheduledAt;
              const date = typeof dateText === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(dateText) ? Date.parse(dateText) : NaN;
              if (!Number.isFinite(date) || date < Date.now() + 60_000) return result("schedule", "needs_clarification", "Chaque programmation exige une date ISO future avec heure et décalage explicites.");
              const key = new Date(date).toISOString(); scheduleGroups.set(key, [...scheduleGroups.get(key) ?? [], channel]);
            }
          }
          if (channels.includes("tiktok")) return result(input.mode, "needs_clarification", "Le brouillon est prêt, mais TikTok demande de vérifier ses choix de confidentialité et l’autorisation musicale dans Booster avant l’envoi.", { draftId: input.draftId, toolUrl: `/dashboard?action=publish&draftId=${input.draftId}` });
          const { GET: connected } = await import("@/app/api/booster/connected-channels/route");
          const connectionResponse = await connected();
          const connections = row(await connectionResponse.json());
          if (!connectionResponse.ok || connections.ok === false) return result(input.mode, "unknown", "Les canaux connectés ne peuvent pas être vérifiés. Aucune publication ni programmation n’a été lancée.");
          const disconnected = channels.filter((channel) => row(connections.channels)[channel] !== true);
          if (disconnected.length) return result(input.mode, "blocked", `Vérifiez la connexion ou l’accès de ces canaux avant l’envoi : ${disconnected.map((channel) => BOOSTER_PUBLICATION_CHANNEL_LABELS[channel]).join(", ")}.`, { toolUrl: "/dashboard?action=channels" });
          const mediaIds = Array.isArray(payload.assistantMediaIds) ? payload.assistantMediaIds.map(id) : [];
          let ownedWorkspace = false;
          if (payload.mediaWorkspaceId) {
            if (typeof payload.mediaWorkspaceId !== "string" || !UUID.test(payload.mediaWorkspaceId)) return result(input.mode, "blocked", "L’espace média du brouillon doit être vérifié dans Booster.");
            const workspace = await read(() => options.supabase.from("publication_workspaces").select("id,account_id").eq("id", payload.mediaWorkspaceId).eq("account_id", accountId).maybeSingle());
            if (!workspace.data || row(workspace.data).id !== payload.mediaWorkspaceId || row(workspace.data).account_id !== accountId) return result(input.mode, "blocked", "Cet espace média n’appartient pas à l’établissement actif.");
            ownedWorkspace = true;
          }
          if (!mediaIds.length && !ownedWorkspace && ((Array.isArray(payload.imageDrafts) && payload.imageDrafts.length) || payload.videoDraft)) return result(input.mode, "needs_clarification", "Ce brouillon contient des médias anciens sans espace vérifié. Choisissez des médias de la Médiathèque ou rouvrez-le dans Booster avant de le publier.", { toolUrl: `/dashboard?action=publish&draftId=${input.draftId}` });
          const assets = await media(mediaIds);
          // The current native draft is authoritative. Replaying old assistant
          // patches here would undo a later edit made in the real Booster UI.
          const publish = await applyChannelOptions(postedPayload(posts, assets, payload), null, payload);
          const hasChannelMedia = (channel: string) => row(publish.mediaModeByChannel)[channel] === "none" ? false : ownedWorkspace && ["video", "images"].includes(String(row(publish.mediaModeByChannel)[channel])) ? true : row(publish.mediaModeByChannel)[channel] === "video" ? Boolean(assets.video) : Array.isArray(row(publish.imagesByChannel)[channel]) ? (row(publish.imagesByChannel)[channel] as unknown[]).length > 0 : assets.images.length > 0 || Boolean(assets.video);
          if ((channels.includes("youtube_shorts") && !assets.video && !(ownedWorkspace && row(publish.mediaModeByChannel).youtube_shorts === "video")) || channels.some(channel => ["instagram", "pinterest"].includes(channel) && !hasChannelMedia(channel))) return result(input.mode, "needs_clarification", "Un média adapté est nécessaire pour ces canaux : YouTube nécessite une vidéo, Instagram et Pinterest une image ou une vidéo.", { draftId: input.draftId });
          if (input.mode === "schedule") {
            const { GET, POST } = await import("@/app/api/agent/scheduled-actions/route");
            const recorded: NonNullable<InrAssistantPublicationResult["scheduledActions"]> = [];
            const partial = (message: string) => result("schedule", recorded.length ? "partial" : "unknown", message, { draftId: input.draftId, scheduledActions: recorded, ...(recorded[0] ? { scheduledActionId: recorded[0].id } : {}) });
            for (const [scheduledAt, groupChannels] of scheduleGroups) {
              try {
              const hash = operationHash(`draft:${input.draftId}:schedule:${[...groupChannels].sort().join(",")}`), uuid = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
              const groupId = !customDates && !immediate.length ? scheduleId : `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
              const previous = await GET(request(options.request, `/api/agent/scheduled-actions?requestId=${groupId}`));
              if (previous.ok) {
                const saved = row(row(await previous.json()).scheduledAction);
                if (saved.id !== groupId || saved.status !== "scheduled" || String(saved.scheduledAt || saved.scheduled_at) !== scheduledAt
                  || Array.isArray(saved.channels) && JSON.stringify([...saved.channels].sort()) !== JSON.stringify([...groupChannels].sort())) return partial("Une programmation précédente a changé ou commencé. Relisez-la avant toute nouvelle diffusion ; les groupes confirmés sont fournis.");
                recorded.push({ id: groupId, scheduledAt, channels: groupChannels }); continue;
              }
              if (previous.status !== 404 || row(await previous.json()).tableMissing !== false) return partial("Une programmation précédente ne peut pas être vérifiée. Aucun groupe supplémentaire ni canal immédiat n’a été lancé.");
              const timeout = beforeMutation("schedule"); if (timeout) return partial("La demande a été interrompue. Les groupes déjà confirmés restent programmés ; les autres ne sont pas annoncés enregistrés.");
              const response = await POST(request(options.request, "/api/agent/scheduled-actions", "POST", { scheduleRequestId: groupId, automationKey: "publish", actionType: "publication", targetTool: "booster", source: "manual",
                title: posts.find(post => post.channel === groupChannels[0])!.title, summary: "Publication programmée avec iNr’Assistant", scheduledAt, timezone: input.timezone, channels: groupChannels,
                payload: { creationMode: "manual", kind: "manual_publish_schedule", scheduleGrouping: { mode: "multichannel_single_action", channelCount: groupChannels.length, createdFrom: "booster_publish_schedule" }, origin: { source: "booster_scheduled", label: "iNr’Assistant", workflowTool: "booster", workflowAction: "publier" }, publishPayload: { ...publicationForChannels(publish, groupChannels), source: "booster_scheduled", idempotencyKey: `${publishKey}:schedule:${groupId}` } } }));
              const saved = row(row(await response.json()).scheduledAction);
              if (!response.ok || saved.id !== groupId || saved.status !== "scheduled") return partial("L’enregistrement d’un groupe n’est pas confirmé. Les groupes précédents restent programmés ; aucun canal immédiat n’a été publié.");
              recorded.push({ id: groupId, scheduledAt, channels: groupChannels });
              } catch { return partial("Le résultat d’un groupe reste incertain. Les groupes déjà confirmés sont conservés ; relisez les reçus avant de reprendre. Aucun canal immédiat n’a été lancé."); }
            }
            if (!immediate.length) return result("schedule", "scheduled", "Les groupes de canaux sont programmés à leurs dates respectives. Ils ne sont pas encore publiés.", { scheduledActionId: recorded[0].id, scheduledAt: recorded.length === 1 ? recorded[0].scheduledAt : undefined, scheduledActions: recorded, draftId: input.draftId, channels: scheduledChannels.map(channel => ({ channel, status: "scheduled" })) });
            const timeout = beforeMutation("publish"); if (timeout) return partial("Les programmations sont enregistrées. Le canal immédiat n’a pas été lancé, car la demande a été interrompue.");
            try {
              const response = await (await import("@/app/api/booster/publish-now/route")).POST(request(options.request, "/api/booster/publish-now", "POST", { ...publicationForChannels(publish, immediate), idempotencyKey: `${publishKey}:immediate` }));
              const data = row(await response.json());
              if (!response.ok || typeof data.publication_id !== "string" || !UUID.test(data.publication_id)) return partial("Les programmations sont enregistrées ; le résultat des canaux immédiats doit être vérifié avant toute reprise.");
              const projected = statusProjection(data);
              const combined = response.status === 202 ? "queued" : projected.status === "published" ? "scheduled" : ["failed", "unknown", "partial"].includes(projected.status) ? "partial" : projected.status;
              return result("schedule", combined, "Les programmations restent enregistrées à leurs dates. Le résultat immédiat est fourni par canal ; les canaux programmés ne sont pas annoncés publiés et les canaux déjà réussis ne doivent pas être relancés.", { scheduledActionId: recorded[0].id, scheduledActions: recorded, draftId: input.draftId, publicationId: String(data.publication_id), channels: [...scheduledChannels.map(channel => ({ channel, status: "scheduled" })), ...(projected.channels?.length ? projected.channels : immediate.map(channel => ({ channel, status: "processing" })))] });
            } catch { return partial("Les programmations sont enregistrées ; le résultat immédiat est incertain. Vérifiez son reçu natif avant toute nouvelle tentative."); }
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
      description: "Ancienne entrée de correction de texte : une publication déjà diffusée exige désormais readPublishedPublicationForEdit puis previewPublishedPublicationEdit et sa confirmation référencée avant applyPublishedPublicationEdit. Cet outil ne modifie aucun canal et n’autorise aucun remplacement silencieux. Pour un brouillon, utiliser preparePublication ; pour une proposition non validée, editPreparedPublication.",
      inputSchema: schema<EditInput>({ type: "object", properties: { publicationId: idSchema, channel: { type: "string", enum: BOOSTER_PUBLICATION_CHANNELS }, title: nullableString(180), content: nullableString(5_000), hashtags: tagSchema }, required: ["publicationId", "channel", "title", "content", "hashtags"], additionalProperties: false }, editInput),
      execute: async (raw) => {
        const input = editInput(raw);
        if (!permitsInrAssistantPublicationAction(options.currentUserMessage, "edit")) return result("edit", "needs_clarification", "Précisez la publication, le canal et la correction souhaitée avant de la modifier.");
        if (["x", "tiktok", "youtube_shorts", "threads"].includes(input.channel)) return result("edit", "blocked", "Ce canal publié ne permet pas cette correction depuis iNr’Send. Vérifiez ses possibilités sur la plateforme.");
        const denied = await access("edit"); if (denied) return denied;
        return result("edit", "needs_clarification", "La modification d’un canal publié nécessite son aperçu confirmé : relire avec readPublishedPublicationForEdit, préparer previewPublishedPublicationEdit, puis appliquer uniquement après confirmation de sa référence. Aucun canal modifié.", { publicationId: input.publicationId });
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
          const response = await GET(request(options.request, `/api/booster/publications/${publicationId}/status${options.statusReadOnly ? "?readOnly=true" : ""}`), { params: Promise.resolve({ publicationId }) });
          const data = row(await response.json());
          return response.ok ? statusProjection(data) : actionFailure("status", response);
        } catch { return result("status", "unknown", "L’état de cette publication ne peut pas être vérifié pour le moment. Ne pas la republier automatiquement."); }
      },
    }),
  };
}
