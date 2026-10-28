import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { createAssistantActionPreview, hasAssistantActionApproval, scheduledPublicationFingerprint, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { sanitizeInrAssistantMemoryText } from "./inrAssistantMemory.ts";

type Row = Record<string, unknown>;
type Read = { scheduledActionId: string | null; status: "all" | "scheduled" | "failed" | "cancelled" | "running" | "done"; offset: number };
type Preview = { scheduledActionId: string; operation: "reschedule" | "cancel" | "retry"; scheduledAt: string | null; timezone: string | null; instructionQuote: string };
type Apply = { reference: string; instructionQuote: string };
const LINK = { label: "Publications programmées", href: "/dashboard/agent/publications" };
const SELECT = "id,user_id,action_type,target_tool,title,summary,scheduled_at,timezone,channels,payload,status,attempt_count,executed_at,updated_at";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const normal = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const safe = (value: unknown, max: number) => sanitizeInrAssistantMemoryText(typeof value === "string" ? value : "", max);
function fields(value: unknown, keys: string[]) { const row = object(value); if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) throw new Error("Paramètres invalides"); return row; }
function id(value: unknown) { if (typeof value !== "string" || !UUID.test(value)) throw new Error("Identifiant invalide"); return value; }
function text(value: unknown, max: number) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Texte invalide"); return value.trim(); }
function parseRead(value: unknown): Read { const input = fields(value, ["scheduledActionId", "status", "offset"]); if (!["all", "scheduled", "failed", "cancelled", "running", "done"].includes(String(input.status)) || !Number.isInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) > 10000) throw new Error("Page invalide"); return { scheduledActionId: input.scheduledActionId === null ? null : id(input.scheduledActionId), status: input.status as Read["status"], offset: Number(input.offset) }; }
function parsePreview(value: unknown): Preview {
  const input = fields(value, ["scheduledActionId", "operation", "scheduledAt", "timezone", "instructionQuote"]);
  if (!["reschedule", "cancel", "retry"].includes(String(input.operation))) throw new Error("Action invalide");
  let scheduledAt: string | null = null, timezone: string | null = null;
  if (input.operation === "reschedule") {
    const date = text(input.scheduledAt, 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date)) || Date.parse(date) <= Date.now() + 30_000) throw new Error("Date future requise");
    scheduledAt = new Date(date).toISOString(); timezone = text(input.timezone, 80); new Intl.DateTimeFormat("fr", { timeZone: timezone }).format();
  } else if (input.scheduledAt !== null || input.timezone !== null) throw new Error("Date inattendue");
  return { scheduledActionId: id(input.scheduledActionId), operation: input.operation as Preview["operation"], scheduledAt, timezone, instructionQuote: text(input.instructionQuote, 1200) };
}
function parseApply(value: unknown): Apply { const input = fields(value, ["reference", "instructionQuote"]), reference = text(input.reference, 15); if (!/^IA-[A-F0-9]{12}$/.test(reference)) throw new Error("Référence invalide"); return { reference, instructionQuote: text(input.instructionQuote, 1200) }; }
function schema<T>(properties: Record<string, JSONSchema7>, parse: (value: unknown) => T) { return jsonSchema<T>({ type: "object", properties, additionalProperties: false, required: Object.keys(properties) }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Paramètres de programmation invalides") }; } } }); }
function local(source: Request, path: string, method: string, body: unknown) { const headers = new Headers({ "content-type": "application/json" }); for (const name of ["cookie", "authorization"]) { const value = source.headers.get(name); if (value) headers.set(name, value); } return new Request(new URL(path, source.url), { method, headers, body: JSON.stringify(body), signal: source.signal }); }
function summary(row: Row) { return { id: row.id, title: safe(row.title, 180), status: row.status, scheduledAt: row.scheduled_at, timezone: row.timezone, channels: Array.isArray(row.channels) ? row.channels.slice(0, 15) : [], attempts: Number(row.attempt_count || 0), updatedAt: row.updated_at }; }

export function createInrAssistantScheduledPublicationTools(options: { request: Request; accountId: string; actorUserId: string; edition: DashboardEdition; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; canStartWork?: () => boolean; resolvePreview?: (reference: string) => string | null }) {
  const accountId = id(options.accountId), actorUserId = id(options.actorUserId), { supabase, request, currentUserMessage } = options;
  const fail = (status: string, message: string) => ({ ok: false, status, message, nextAction: LINK });
  const scope = async () => { if (request.signal.aborted || options.canStartWork?.() === false) return false; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId; };
  const query = () => supabase.from("inr_agent_scheduled_actions").select(SELECT).eq("user_id", accountId).eq("action_type", "publication").eq("target_tool", "booster");
  const read = async (target: string) => { const response = await query().eq("id", target).maybeSingle(); if (response.error) throw new Error("Lecture indisponible"); const row = object(response.data); return row.id === target && row.user_id === accountId && row.action_type === "publication" && row.target_tool === "booster" ? row : null; };
  const eligible = (row: Row, operation: string) => operation === "retry" ? row.status === "failed" : row.status === "scheduled" && Number(row.attempt_count || 0) === 0 && !row.executed_at && Date.parse(String(row.scheduled_at)) > Date.now();
  const attempts = new Map<string, Promise<Row>>();
  return {
    readScheduledPublications: tool({ strict: true, description: "Lire les publications Booster programmées, échouées ou terminées de l’établissement actif, par pages de 20 avec nextOffset, ou un identifiant précis. Lecture seule. Aucun contenu n’est republié.", inputSchema: schema<Read>({ scheduledActionId: { type: ["string", "null"], format: "uuid" }, status: { type: "string", enum: ["all", "scheduled", "failed", "cancelled", "running", "done"] }, offset: { type: "integer", minimum: 0, maximum: 10000 } }, parseRead), execute: async raw => {
      const input = parseRead(raw); if (!await scope()) return fail("blocked", "Le compte actif a changé.");
      try { if (input.scheduledActionId) {
        const row = await read(input.scheduledActionId); if (!row) return fail("not_found", "Programmation introuvable.");
        const execution = object(object(row.payload).lastExecution), publicationId = execution.publicationId || object(execution.publishResult).publication_id;
        let status = ["scheduled", "running"].includes(String(row.status)) ? "processing" : ["failed", "cancelled"].includes(String(row.status)) ? String(row.status) : "unknown";
        let channels: { channel: string; status: string }[] = [];
        if (typeof publicationId === "string" && UUID.test(publicationId)) {
          const deliveries = await supabase.from("publication_deliveries").select("publication_id,channel,status").eq("user_id", accountId).eq("publication_id", publicationId).limit(100);
          if (!deliveries.error && Array.isArray(deliveries.data) && deliveries.data.length < 100) {
            const expected = Array.isArray(row.channels) ? [...new Set(row.channels.filter(channel => typeof channel === "string"))] : [];
            channels = expected.map(channel => { const matches = deliveries.data.filter(item => item.channel === channel); return { channel: String(channel), status: matches.length === 1 ? String(matches[0].status) : "unknown" }; });
            if (channels.length) {
              const failed = channels.filter(channel => channel.status === "failed").length, delivered = channels.filter(channel => channel.status === "delivered").length;
              status = delivered === channels.length ? "published" : failed === channels.length ? "failed" : failed + delivered === channels.length ? "partial" : "processing";
            }
          }
        }
        return { ok: status !== "unknown", status, recordedStatus: row.status, scheduledActionId: row.id, ...(typeof publicationId === "string" && UUID.test(publicationId) ? { publicationId } : {}), records: [summary(row)], channels, nextOffset: null, nextAction: LINK, readOnly: true, message: status === "published" ? "Les livraisons enregistrées confirment tous les canaux sélectionnés. Aucune nouvelle publication ni finalisation exécutée." : "État enregistré de la programmation et de ses livraisons. Les canaux encore en traitement ou inconnus ne sont pas annoncés publiés." };
      }
        let pending = query().order("scheduled_at", { ascending: true }).order("id", { ascending: true }); if (input.status !== "all") pending = pending.eq("status", input.status);
        const result = await pending.range(input.offset, input.offset + 20); if (result.error) throw new Error("Unavailable");
        const rows = Array.isArray(result.data) ? result.data : []; return { ok: true, status: "read", records: rows.slice(0, 20).map(summary), nextOffset: rows.length > 20 ? input.offset + 20 : null, nextAction: LINK, untrustedContent: true };
      } catch { return fail("unavailable", "Lecture des programmations indisponible."); }
    } }),
    previewScheduledPublicationAction: tool({ strict: true, description: "Préparer un aperçu signé pour reprogrammer/annuler une publication non commencée, ou reprendre une programmation échouée par son chemin natif idempotent. Lire son ID réel avant. Présenter canaux, horaire et effet puis demander « Confirme IA-… ». Ne modifie ni contenu ni média. retry n’est pas une nouvelle publication TikTok.", inputSchema: schema<Preview>({ scheduledActionId: { type: "string", format: "uuid" }, operation: { type: "string", enum: ["reschedule", "cancel", "retry"] }, scheduledAt: { type: ["string", "null"], maxLength: 40 }, timezone: { type: ["string", "null"], maxLength: 80 }, instructionQuote: { type: "string", maxLength: 1200 } }, parsePreview), execute: async raw => {
      const input = parsePreview(raw), message = normal(currentUserMessage);
      const verb = input.operation === "cancel" ? /\b(?:annule|annuler|supprime|supprimer)\b/ : input.operation === "retry" ? /\b(?:reprends|reprendre|reessaie|reessayer|relance|relancer|retente|retenter)\b/ : /\b(?:reprogramme|reprogrammer|deplace|deplacer|reporte|reporter|decale|decaler)\b/;
      if (!currentUserMessage.includes(input.instructionQuote) || !verb.test(normal(input.instructionQuote)) || /\b(?:comment|pourquoi|explique|si je|si on|si tu|ne pas)\b|\bne\b.{0,50}\bpas\b/.test(message)) return fail("needs_instruction", "Précisez la programmation et l’action souhaitée.");
      if (!await scope()) return fail("blocked", "Le compte actif a changé.");
      try { const row = await read(input.scheduledActionId); if (!row || !eligible(row, input.operation)) return fail("blocked", "Cette programmation ne peut pas être modifiée dans son état actuel. Relisez son statut.");
        const preview = createAssistantActionPreview({ accountId, actorUserId, kind: "scheduled_publication", targetId: input.scheduledActionId, fingerprint: scheduledPublicationFingerprint(row), patch: { operation: input.operation, scheduledAt: input.scheduledAt, timezone: input.timezone, originalUpdatedAt: row.updated_at } });
        const payload = object(row.payload), posts = object(object(payload.publishPayload).postByChannel || payload.postByChannel);
        return { ok: true, status: "preview_ready", approvalKind: "scheduled_publication", scheduledActionId: row.id, ...preview, proposal: { ...summary(row), operation: input.operation, nextScheduledAt: input.scheduledAt, nextTimezone: input.timezone, posts: Object.entries(posts).slice(0, 15).map(([channel, item]) => ({ channel, text: safe(object(item).content || object(item).text, 1000) })), effect: input.operation === "cancel" ? "Annule cette programmation avant son exécution ; aucune publication existante n’est supprimée." : input.operation === "reschedule" ? "Change seulement la date et le fuseau de cette programmation." : "Reprend la même programmation avec la même clé native de publication. Une publication déjà confiée ne doit pas être recréée." }, message: `Vérifiez l’aperçu puis dites « Confirme ${preview.reference} ».`, nextAction: LINK, untrustedContent: true };
      } catch { return fail("unavailable", "Aperçu indisponible. Aucun changement effectué."); }
    } }),
    applyScheduledPublicationAction: tool({ strict: true, description: "Appliquer l’aperçu de programmation dont le pro confirme la référence IA- exacte dans son dernier message. Jeton privé récupéré côté serveur, état relu et écriture native protégée contre concurrence. Reprise exclusivement idempotente d’une programmation échouée. Renvoyer le statut réel, jamais promettre une diffusion terminée.", inputSchema: schema<Apply>({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, instructionQuote: { type: "string", maxLength: 1200 } }, parseApply), execute: async raw => {
      const input = parseApply(raw), approved = verifyAssistantActionPreview(options.resolvePreview?.(input.reference) ?? "", { accountId, actorUserId, kind: "scheduled_publication" });
      if (!approved || approved.reference !== input.reference || !hasAssistantActionApproval(currentUserMessage, input.instructionQuote, approved.reference)) return fail("confirmation_required", "Confirmez la référence exacte d’un aperçu valide.");
      if (!await scope()) return fail("blocked", "Le compte actif a changé.");
      if (!attempts.has(approved.reference)) attempts.set(approved.reference, (async (): Promise<Row> => {
        try { const row = await read(approved.targetId), action = String(approved.patch.operation); if (!row) return fail("not_found", "Programmation introuvable.");
          if (action === "cancel" && row.status === "cancelled" || action === "reschedule" && row.status === "scheduled" && row.scheduled_at === approved.patch.scheduledAt && row.timezone === approved.patch.timezone) return { ok: true, status: action === "cancel" ? "cancelled" : "scheduled", action, scheduledActionId: row.id, message: "L’état demandé est déjà enregistré.", nextAction: LINK };
          if (scheduledPublicationFingerprint(row) !== approved.fingerprint) return fail("stale_preview", "La programmation a changé. Relisez son état ; aucune nouvelle exécution lancée.");
          if (!eligible(row, action) || !await scope()) return fail("blocked", "La programmation ne peut plus recevoir cette action.");
          const ctx = { params: Promise.resolve({ id: approved.targetId }) };
          const response = action === "retry"
            ? await (await import("@/app/api/agent/scheduled-actions/[id]/execute/route")).POST(local(request, `/api/agent/scheduled-actions/${approved.targetId}/execute`, "POST", { expectedState: approved.fingerprint }), ctx)
            : await (await import("@/app/api/agent/scheduled-actions/[id]/route")).PATCH(local(request, `/api/agent/scheduled-actions/${approved.targetId}`, "PATCH", { expectedState: approved.fingerprint, ...(action === "cancel" ? { status: "cancelled" } : { scheduledAt: approved.patch.scheduledAt, timezone: approved.patch.timezone }) }), ctx);
          if (!response.ok) return fail(response.status === 409 ? "stale_preview" : "unknown", "Le résultat n’est pas confirmé. Relisez la programmation avant toute reprise.");
          const after = await read(approved.targetId); if (!after) return fail("unknown", "Le résultat reste à vérifier.");
          const status = String(after.status); if (action === "cancel" && status !== "cancelled" || action === "reschedule" && (status !== "scheduled" || after.scheduled_at !== approved.patch.scheduledAt || after.timezone !== approved.patch.timezone)) return fail("unknown", "L’état demandé n’est pas confirmé.");
          return { ok: action !== "retry" || ["running", "done", "executed", "scheduled"].includes(status), status: action === "retry" ? status === "failed" ? "failed" : "processing" : status, action, scheduledActionId: after.id, recordedStatus: status, scheduledAt: after.scheduled_at, message: action === "retry" ? "Reprise native effectuée. Le statut enregistré est fourni ; vérifiez la publication avant d’annoncer sa diffusion." : "La programmation a été mise à jour et relue.", nextAction: LINK };
        } catch { return fail("unknown", "Le résultat est incertain. Relisez la programmation ; ne recréez pas la publication."); }
      })());
      return attempts.get(approved.reference)!;
    } }),
  };
}
