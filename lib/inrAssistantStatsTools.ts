import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { getDashboardEditionForAuthUser } from "./dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "./accountSubscriptionAccess";
import { sanitizeInrAssistantMemoryText } from "./inrAssistantMemory.ts";
import { ownedInrAssistantStatsReportDocument } from "./inrAssistantStatsReportDocument.ts";

type Row = Record<string, unknown>;
type Refresh = { channel: string | null; instructionQuote: string };
type Reports = { reportId: string | null; offset: number };
const CHANNELS = ["site_web", "gmb", "facebook", "instagram", "threads", "linkedin", "tiktok", "youtube_shorts", "pinterest", "x"];
const REFRESH_SOURCES = [...CHANNELS, "inrbadge", "inr_search"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LINK = { label: "iNr’Stats", href: "/dashboard/stats" };
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const safe = (value: unknown, max = 240) => sanitizeInrAssistantMemoryText(typeof value === "string" ? value : "", max);
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides"); return input; }
function id(value: unknown) { if (typeof value !== "string" || !UUID.test(value)) throw new Error("Identifiant invalide"); return value; }
function quote(value: unknown) { if (typeof value !== "string" || !value.trim() || value.length > 1200) throw new Error("Instruction invalide"); return value.trim(); }
function parseRefresh(value: unknown): Refresh { const input = fields(value, ["channel", "instructionQuote"]); if (input.channel !== null && !REFRESH_SOURCES.includes(String(input.channel))) throw new Error("Canal invalide"); return { channel: input.channel as string | null, instructionQuote: quote(input.instructionQuote) }; }
function parseReports(value: unknown): Reports { const input = fields(value, ["reportId", "offset"]); if (!Number.isInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) > 10000) throw new Error("Page invalide"); return { reportId: input.reportId === null ? null : id(input.reportId), offset: Number(input.offset) }; }
function parseSend(value: unknown) { const input = fields(value, ["instructionQuote"]); return { instructionQuote: quote(input.instructionQuote) }; }
function parseDownload(value: unknown) { const input = fields(value, ["reportId", "instructionQuote"]); return { reportId: id(input.reportId), instructionQuote: quote(input.instructionQuote) }; }
function schema<T>(properties: Record<string, JSONSchema7>, parse: (value: unknown) => T) { return jsonSchema<T>({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Paramètres iNr’Stats invalides") }; } } }); }
function instruction(message: string, selectedQuote: string, kind: "refresh" | "send" | "download") {
  const unquoted = message.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|«[^»]*»|“[^”]*”|"[^"]*"|^>.*$/gm, " ");
  if (!unquoted.includes(selectedQuote)) return false;
  const normalized = unquoted.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/\b(?:comment|pourquoi|explique|imagine|si|quand|lorsque|apres|avant|demain|plus tard|ce soir|not|never|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|\bne\b.{0,80}\bpas\b|n['’](?:envoie|actualise|exporte)|\b(?:envoie|actualise|rafraichis|telecharge|exporte)\s+pas\b|\bdans\s+(?:\d+|une?|deux|trois)\s*(?:minutes?|heures?|jours?)\b|\b(?:a|vers)\s+\d{1,2}\s*(?:h|:)|\b\d{4}-\d{2}-\d{2}\b/.test(normalized)) return false;
  const selected = selectedQuote.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (kind === "refresh") return /\b(?:actualise\w*|rafraichi\w*|synchronise\w*|refresh)\b/.test(selected);
  if (kind === "download") return /\b(?:telecharge\w*|exporte\w*|recupere\w*)\b/.test(selected) && /\b(?:bilan|rapport|pdf)\b/.test(selected);
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(normalized) || /\b(?:client|collegue|partenaire|destinataire|equipe)\b/.test(normalized)) return false;
  const explicitDestination = /\b(?:a|au|aux|to)\b/.test(selected);
  if (explicitDestination && !/\ba\s+(?:mon |notre |l['’])adresse\s+(?:professionnelle|pro|configuree)\b/.test(selected)) return false;
  return /\b(?:envoie\w*|envoyer|expedie\w*|adresse\w*)\b/.test(selected) && /\b(?:bilan|rapport)\b/.test(selected) && /\b(?:statistiques?|stats|inrstats)\b|inr['’ ]stats/.test(selected);
}
function local(source: Request, path: string, body: unknown, method = "POST") { const headers = new Headers({ "content-type": "application/json" }); for (const key of ["cookie", "authorization"]) { const value = source.headers.get(key); if (value) headers.set(key, value); } return new Request(new URL(path, source.url), { method, headers, ...(method === "POST" ? { body: JSON.stringify(body) } : {}), signal: source.signal }); }
function projectBlock(value: unknown) {
  const block = row(value), connection = row(block.connection), leads = row(block.capturedLeads);
  const available = connection.statsConnected === true && !block.error && block.live === true;
  return { channel: safe(block.channel, 30), statsConnected: connection.statsConnected === true, live: block.live === true, snapshotDate: safe(block.snapshotDate, 40), syncedAt: numeric(block.syncAt), error: safe(block.error),
    opportunitiesEstimated: available ? numeric(block.opportunities) : null, capturedLeadsWeek: available ? numeric(leads.week) : null, capturedLeadsMonth: available ? numeric(leads.month) : null, valueEstimated: available ? numeric(block.estimatedValue) : null };
}

export function createInrAssistantStatsTools(options: { request: Request; accountId: string; actorUserId: string; edition: DashboardEdition; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; canStartWork?: () => boolean }) {
  const accountId = id(options.accountId), actorUserId = id(options.actorUserId), { request, supabase } = options;
  const fail = (status: string, message: string): Row => ({ ok: false, status, message, nextAction: LINK });
  async function access(write: boolean, agent = false) {
    if (request.signal.aborted || options.canStartWork?.() === false) return false;
    const auth = await requireUser();
    if (auth.errorResponse || auth.activeUserId !== accountId || auth.authUserId !== actorUserId) return false;
    if (agent && (options.edition === "basic" || await getDashboardEditionForAuthUser(actorUserId) === "basic")) return false;
    return !write || (await getActiveSubscriptionAccountIds([accountId])).has(accountId);
  }
  async function guarded(write: boolean, action: () => Promise<Row>) { try { if (!await access(write)) return fail("blocked", "La session, l’abonnement ou l’établissement actif doit être vérifié."); return await action(); } catch { return fail(write ? "unknown" : "unavailable", write ? "Résultat non confirmé. Vérifiez iNr’Stats avant toute nouvelle tentative ; aucun envoi n’a été relancé." : "Lecture des bilans indisponible."); } }
  const attempts = new Map<string, Promise<Row>>();
  const once = (key: string, action: () => Promise<Row>) => { if (!attempts.has(key)) attempts.set(key, guarded(true, action)); return attempts.get(key)!; };
  return {
    refreshStatsSources: tool({ strict: true, description: "Actualiser maintenant les statistiques natives de tous les canaux (channel=null) ou d’un seul, y compris inrbadge/inr_search. Demande explicite actuelle requise. Retourne les sources réellement fraîches, indisponibles ou anciennes ; les valeurs absentes restent inconnues. Badge/Search exposent seulement une lecture native sans preuve de fraîcheur.", inputSchema: schema<Refresh>({ channel: { type: ["string", "null"], enum: [null, ...REFRESH_SOURCES] }, instructionQuote: { type: "string", maxLength: 1200 } }, parseRefresh), execute: async raw => {
      const input = parseRefresh(raw); if (!instruction(options.currentUserMessage, input.instructionQuote, "refresh")) return fail("needs_instruction", "Précisez les statistiques à actualiser maintenant.");
      return once(`refresh:${input.channel ?? "all"}`, async () => {
        if (input.channel === "inrbadge" || input.channel === "inr_search") {
          const response = input.channel === "inrbadge"
            ? await (await import("@/app/api/inrstats/inrbadge/route")).GET(local(request, "/api/inrstats/inrbadge", null, "GET"))
            : await (await import("@/app/api/inr-search/analytics/route")).GET();
          const data = row(await response.json());
          if (!response.ok || data.ok === false) return fail("unavailable", "La source de statistiques n’a pas pu être rechargée.");
          if (!await access(false)) return fail("blocked", "L’établissement actif a changé.");
          // These native analytics readers currently replace DB failures with
          // empty snapshots. Their zeros are not evidence of measured activity.
          return { ok: true, status: "read", channel: input.channel, freshness: "unverified", nextAction: LINK, message: "La source a été relue par le chemin natif. Ce lecteur ne distingue pas encore un instantané vide d’un échec de mesure ; aucune fraîcheur ni valeur n’est affirmée." };
        }
        const response = input.channel
          ? await (await import("@/app/api/stats/channel-refresh/route")).POST(local(request, "/api/stats/channel-refresh", { channel: input.channel }))
          : await (await import("@/app/api/stats/daily-refresh/route")).POST(local(request, "/api/stats/daily-refresh", { announce: false, force: true }));
        const data = row(await response.json());
        if (!response.ok) return fail(response.status < 500 ? "blocked" : "unknown", "Le rafraîchissement n’est pas confirmé. Consultez iNr’Stats.");
        if (!await access(false)) return fail("blocked", "L’établissement actif a changé.");
        if (!input.channel && data.ran !== true) return { ok: false, status: data.inProgress === true ? "processing" : "unchanged", message: "Aucun nouveau rafraîchissement terminé n’est confirmé.", nextAction: LINK };
        const sources = input.channel ? [projectBlock(row(row(data.periods)["30"]).block)] : Object.values(row(row(row(data.inrstats)["30"]).blocks)).map(projectBlock);
        const known = sources.filter(source => CHANNELS.includes(source.channel));
        if (!known.length || input.channel && known[0].channel !== input.channel) return fail("unknown", "La réponse ne confirme aucune source de statistiques attendue.");
        const fresh = known.filter(source => source.statsConnected && source.live && !source.error).length;
        return { ok: fresh > 0, status: fresh === known.length ? "refreshed" : fresh ? "partial" : "unavailable", sources: known, refreshedChannels: fresh, checkedAt: new Date().toISOString(), nextAction: LINK, message: "Résultat du rafraîchissement natif. Une source ancienne, déconnectée ou en erreur n’est pas présentée comme fraîche ; les opportunités et valeurs restent des estimations." };
      });
    } }),
    readStatsReports: tool({ strict: true, description: "Lister les bilans PDF iNr’Stats enregistrés de l’établissement actif, 20 par page, ou obtenir le lien de téléchargement d’un reportId réel. Ne génère ni n’envoie rien. Un rapport marqué échoué peut contenir un PDF dont l’envoi a échoué.", inputSchema: schema<Reports>({ reportId: { type: ["string", "null"], format: "uuid" }, offset: { type: "integer", minimum: 0, maximum: 10000 } }, parseReports), execute: async raw => {
      const input = parseReports(raw); return guarded(false, async () => {
        let query = supabase.from("inr_agent_actions").select("id,user_id,automation_key,action_type,target_tool,title,status,payload,created_at,completed_at").eq("user_id", accountId).eq("automation_key", "stats").eq("action_type", "stats_report").eq("target_tool", "inrstats");
        if (input.reportId) query = query.eq("id", input.reportId);
        const result = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(input.offset, input.offset + 20).abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(8000)]));
        if (result.error) throw new Error("Read failed");
        const records = Array.isArray(result.data) ? result.data : [];
        const reports = records.slice(0, 20).flatMap(value => {
          const record = row(value), payload = row(record.payload), document = ownedInrAssistantStatsReportDocument(payload.reportDocument, accountId);
          if (record.user_id !== accountId || record.action_type !== "stats_report" || record.target_tool !== "inrstats" || typeof record.id !== "string" || !UUID.test(record.id)) return [];
          const downloadUrl = document ? `/api/assistant/reports/${record.id}/download` : null;
          return [{ reportId: record.id, title: safe(record.title, 180), status: safe(record.status, 40), createdAt: safe(record.created_at, 40), sentAt: safe(row(payload.delivery).sentAt, 40) || null, filename: document?.filename ?? null, downloadUrl, available: Boolean(downloadUrl) }];
        });
        if (!await access(false)) return fail("blocked", "L’établissement actif a changé.");
        return { ok: true, status: "read", reports, nextOffset: !input.reportId && records.length > 20 ? input.offset + 20 : null, nextAction: LINK, readOnly: true, untrustedContent: true };
      });
    } }),
    prepareStatsReportDownload: tool({ strict: true, description: "Sur demande actuelle de télécharger un bilan PDF déjà enregistré : vérifier l’ID réel et préparer le téléchargement natif. Ne génère pas de rapport et n’envoie aucun mail. La commande UI contient seulement l’ID ; le serveur réauthentifie le compte au téléchargement.", inputSchema: schema({ reportId: { type: "string", format: "uuid" }, instructionQuote: { type: "string", maxLength: 1200 } }, parseDownload), execute: async raw => {
      const input = parseDownload(raw); if (!instruction(options.currentUserMessage, input.instructionQuote, "download")) return fail("needs_instruction", "Précisez le bilan enregistré à télécharger.");
      return guarded(false, async () => {
        const response = await supabase.from("inr_agent_actions").select("id,user_id,automation_key,action_type,target_tool,payload").eq("user_id", accountId).eq("id", input.reportId).eq("automation_key", "stats").eq("action_type", "stats_report").eq("target_tool", "inrstats").abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(8000)])).maybeSingle();
        if (response.error) throw new Error("Read failed");
        const record = row(response.data), document = ownedInrAssistantStatsReportDocument(row(record.payload).reportDocument, accountId);
        if (record.id !== input.reportId || record.user_id !== accountId || record.automation_key !== "stats" || record.action_type !== "stats_report" || record.target_tool !== "inrstats" || !document) return fail("not_found", "Ce bilan PDF n’est plus disponible dans cet établissement.");
        if (!await access(false)) return fail("blocked", "L’établissement actif a changé.");
        return { ok: true, status: "ui_action_requested", reportId: input.reportId, filename: document.filename, uiCommand: { command: "download_stats_report", selection: { kind: "stats_report", id: input.reportId } }, nextAction: LINK, message: "Le téléchargement du bilan est demandé au navigateur ; sa réception reste à confirmer." };
      });
    } }),
    sendStatsReport: tool({ strict: true, description: "Sur demande explicite actuelle d’ENVOYER un bilan statistique : générer le PDF puis envoyer par la route native à l’adresse professionnelle configurée du compte, sans destinataire fourni par le modèle. Consomme les crédits natifs applicables. Un simple téléchargement/aperçu ne permet pas l’envoi. Ne jamais retenter un résultat incertain.", inputSchema: schema({ instructionQuote: { type: "string", maxLength: 1200 } }, parseSend), execute: async raw => {
      const input = parseSend(raw); if (!instruction(options.currentUserMessage, input.instructionQuote, "send")) return fail("needs_instruction", "Pour envoyer un bilan, demandez explicitement l’envoi du rapport iNr’Stats à l’adresse professionnelle du compte.");
      return once("send-report", async () => {
        if (!await access(true, true)) return fail("blocked", "La génération et l’envoi d’un bilan par iNr’Agent nécessitent Standard ou Premium.");
        const response = await (await import("@/app/api/agent/actions/send-stats-report/route")).POST(local(request, "/api/agent/actions/send-stats-report", { origin: "inrstats" }));
        const data = row(await response.json());
        if (!response.ok || data.sent !== true) return fail(response.status < 500 ? "blocked" : "unknown", "L’envoi du bilan n’est pas confirmé. Consultez l’historique iNr’Stats avant de réessayer.");
        let sameScope = false;
        try { sameScope = await access(false); } catch { /* A failed scope read cannot erase a confirmed delivery. */ }
        if (!sameScope) return { ok: true, status: "sent", scopeChanged: true, message: "Le serveur a confirmé l’envoi demandé avant la fin de cette vérification de session. Ne le renvoyez pas. Consultez l’historique de l’établissement d’origine après avoir rétabli la session." };
        const action = row(data.action);
        return { ok: true, status: "sent", ...(typeof action.id === "string" && UUID.test(action.id) ? { reportId: action.id } : {}), recipientEmail: safe(data.recipientEmail, 254), filename: safe(data.filename, 180), nextAction: LINK, message: "La route native confirme l’envoi du bilan PDF à l’adresse professionnelle configurée." };
      });
    } }),
  };
}
