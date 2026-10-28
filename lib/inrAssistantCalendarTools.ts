import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { calendarEventFingerprint, createAssistantActionPreview, hasAssistantActionApproval, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { sanitizeInrAssistantMemoryText } from "./inrAssistantMemory.ts";

type Row = Record<string, unknown>;
type Preview = { eventId: string; operation: "confirm" | "edit" | "cancel"; instructionQuote: string; title: string | null; description: string | null; location: string | null; start: string | null; end: string | null };
type Apply = { reference: string; instructionQuote: string };
const SELECT = "id,user_id,title,description,location,start_at,end_at,all_day,meta";
const LINK = { label: "iNr’Calendar", href: "/dashboard/agenda" };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const nullable = (max: number): JSONSchema7 => ({ type: ["string", "null"], maxLength: max });
function fields(value: unknown, names: string[]) { const row = object(value); if (Object.keys(row).length !== names.length || names.some(name => !Object.hasOwn(row, name))) throw new Error("Paramètres agenda invalides"); return row; }
function string(value: unknown, max: number) { if (typeof value !== "string" || !value.trim() || value.length > max || /\u0000/.test(value)) throw new Error("Texte invalide"); return value.trim(); }
function optional(value: unknown, max: number) { return value === null ? null : string(value, max); }
function date(value: unknown) { const text = string(value, 40); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text))) throw new Error("Date et fuseau explicites requis"); return new Date(text).toISOString(); }
function parsePreview(value: unknown): Preview {
  const input = fields(value, ["eventId", "operation", "instructionQuote", "title", "description", "location", "start", "end"]);
  if (!UUID.test(String(input.eventId)) || !["confirm", "edit", "cancel"].includes(String(input.operation))) throw new Error("Action invalide");
  const start = input.start === null ? null : date(input.start), end = input.end === null ? null : date(input.end);
  if (Boolean(start) !== Boolean(end) || start && end && (start >= end || Date.parse(end) - Date.parse(start) > 7 * 86400_000)) throw new Error("Créneau invalide");
  const result: Preview = { eventId: String(input.eventId), operation: input.operation as Preview["operation"], instructionQuote: string(input.instructionQuote, 1200), title: optional(input.title, 180), description: optional(input.description, 1500), location: optional(input.location, 250), start, end };
  if (result.operation !== "edit" && [result.title, result.description, result.location, start, end].some(value => value !== null)) throw new Error("La confirmation et l’annulation ne modifient pas le contenu");
  if (result.operation === "edit" && [result.title, result.description, result.location, start].every(value => value === null)) throw new Error("Modification requise");
  return result;
}
function parseApply(value: unknown): Apply { const input = fields(value, ["reference", "instructionQuote"]); const reference = string(input.reference, 15); if (!/^IA-[A-F0-9]{12}$/.test(reference)) throw new Error("Référence invalide"); return { reference, instructionQuote: string(input.instructionQuote, 1200) }; }
function schema<T>(properties: Record<string, JSONSchema7>, parse: (input: unknown) => T) { return jsonSchema<T>({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Paramètres agenda invalides") }; } } }); }
const safe = (value: unknown, maximum: number) => sanitizeInrAssistantMemoryText(typeof value === "string" ? value : "", maximum);
function command(message: string, quote: string, action: Preview["operation"]) {
  if (!message.includes(quote)) return false;
  const text = normalize(message);
  if (/\b(?:comment|pourquoi|explique|imagine|si je|si tu|si on|ne pas)\b|\bne\b.{0,40}\bpas\b|\b(?:annule|confirme|modifie)\s+pas\b/.test(text)) return false;
  return (action === "confirm" ? /\b(?:confirme|confirmer|valide|valider|accepte|accepter|finalise|finaliser)\b/ : action === "cancel" ? /\b(?:annule|annuler|supprime|supprimer)\b/ : /\b(?:modifie|modifier|deplace|deplacer|reporte|reporter|change|changer|corrige|corriger)\b/).test(normalize(quote));
}
function local(source: Request, path: string, method: string, body?: unknown) { const headers = new Headers({ "content-type": "application/json" }); for (const name of ["cookie", "authorization"]) { const value = source.headers.get(name); if (value) headers.set(name, value); } return new Request(new URL(path, source.url), { method, headers, signal: source.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }

/** A preview never changes an event. Only the same pro's exact, signed proposal can call the native lifecycle. */
export function createInrAssistantCalendarTools(options: { request: Request; accountId: string; actorUserId: string; edition: DashboardEdition; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; canStartWork?: () => boolean; resolvePreview?: (reference: string) => string | null }) {
  if (!UUID.test(options.accountId) || !UUID.test(options.actorUserId)) throw new Error("Périmètre agenda invalide");
  const { request, accountId, actorUserId, supabase, currentUserMessage } = options;
  const fail = (status: string, message: string) => ({ ok: false, status, message, nextAction: LINK });
  const scope = async () => { if (options.edition === "standard" || request.signal.aborted || options.canStartWork?.() === false) return false; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId; };
  const event = async (id: string) => { const result = await supabase.from("agenda_events").select(SELECT).eq("user_id", accountId).eq("id", id).maybeSingle(); if (result.error) throw new Error("Lecture agenda indisponible"); const row = object(result.data); return row.id === id && row.user_id === accountId ? row : null; };
  const writable = (row: Row) => { const meta = object(row.meta); return meta.readOnly !== true && meta.source !== "google_shared_calendar" && !meta.googleEventId && (!meta.source || ["manual", "inrbadge"].includes(String(meta.source))); };
  const attempts = new Map<string, Promise<Row>>();
  return {
    previewCalendarAction: tool({ strict: true, description: "Préparer sans rien modifier la confirmation d’un brouillon/d’une demande RDV, une modification de RDV confirmé ou sa suppression native. Lire le rendez-vous avant. Produit un aperçu exact (créneau, destinataires, rappels), un jeton signé et une référence IA-. Présenter au pro les effets et lui demander de confirmer cette référence. Google reste géré dans Google. Toutes les valeurs non modifiées sont null.",
      inputSchema: schema<Preview>({ eventId: { type: "string", format: "uuid" }, operation: { type: "string", enum: ["confirm", "edit", "cancel"] }, instructionQuote: { type: "string", maxLength: 1200 }, title: nullable(180), description: nullable(1500), location: nullable(250), start: nullable(40), end: nullable(40) }, parsePreview),
      execute: async raw => {
        const input = parsePreview(raw);
        if (!command(currentUserMessage, input.instructionQuote, input.operation)) return fail("needs_instruction", "Précisez le rendez-vous et l’action souhaitée.");
        if (!await scope()) return fail("blocked", "Ce compte ou cette édition ne permet pas l’action agenda.");
        try {
          const row = await event(input.eventId);
          if (!row || !writable(row)) return fail("blocked", "Rendez-vous absent ou géré par un autre agenda.");
          const meta = object(row.meta);
          if (input.operation === "confirm" && !["draft", "pending"].includes(String(meta.status))) return fail("already_confirmed", "Ce rendez-vous n’attend pas de confirmation.");
          if (row.all_day === true && input.start) return fail("needs_instruction", "Le déplacement d’un événement sur une journée entière se fait dans l’agenda.");
          const patch: Row = { operation: input.operation, title: input.title ?? row.title, description: input.description ?? row.description, location: input.location ?? row.location, start: input.start ?? row.start_at, end: input.end ?? row.end_at, allDay: row.all_day === true };
          const preview = createAssistantActionPreview({ accountId, actorUserId, kind: "calendar", targetId: input.eventId, fingerprint: calendarEventFingerprint(row), patch });
          const recipients = [...new Set([object(meta.contact), ...(Array.isArray(meta.guests) ? meta.guests.map(object) : [])].map(contact => typeof contact.email === "string" ? contact.email.toLowerCase() : "").filter(Boolean))].slice(0, 50);
          return { ok: true, status: "preview_ready", approvalKind: "calendar", eventId: input.eventId, ...preview, proposal: { operation: input.operation, title: safe(patch.title, 180), description: safe(patch.description, 1500), location: safe(patch.location, 250), start: patch.start, end: patch.end, allDay: patch.allDay, knownRecipients: recipients, remindersEnabled: object(meta.reminders).enabled !== false, effect: input.operation === "cancel" ? "Suppression de l’agenda natif. Cette action native n’envoie pas d’e-mail d’annulation." : "L’enregistrement peut envoyer les confirmations aux contacts/invités et au professionnel selon les réglages iNr’Calendar ; les rappels existants sont conservés." }, message: `Vérifiez cet aperçu, puis dites « Confirme ${preview.reference} » pour l’appliquer.`, nextAction: LINK, untrustedContent: true };
        } catch { return fail("unavailable", "L’aperçu ne peut pas être préparé. Aucun rendez-vous modifié."); }
      } }),
    applyCalendarAction: tool({ strict: true, description: "Appliquer uniquement l’aperçu agenda signé dont le pro confirme explicitement la référence IA- dans son dernier message. Le serveur retrouve le jeton privé de previewCalendarAction. Revalide compte, acteur, expiration et événement inchangé ; protège les mises à jour concurrentes et les reprises. Ne jamais dire qu’un email est livré.",
      inputSchema: schema<Apply>({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, instructionQuote: { type: "string", maxLength: 1200 } }, parseApply),
      execute: async raw => {
        const input = parseApply(raw), approved = verifyAssistantActionPreview(options.resolvePreview?.(input.reference) ?? "", { accountId, actorUserId, kind: "calendar" });
        if (!approved || approved.reference !== input.reference || !hasAssistantActionApproval(currentUserMessage, input.instructionQuote, approved.reference)) return fail("confirmation_required", "Confirmez la référence exacte d’un aperçu agenda valide.");
        if (!await scope()) return fail("blocked", "Le compte actif a changé ou l’action est indisponible.");
        if (!attempts.has(approved.reference)) attempts.set(approved.reference, (async (): Promise<Row> => {
          try {
            const row = await event(approved.targetId), operation = String(approved.patch.operation);
            const action = operation === "edit" ? "update" : operation;
            if (!row) return operation === "cancel" ? { ok: true, status: "cancelled", action, eventId: approved.targetId, message: "Le rendez-vous est absent de l’agenda.", nextAction: LINK } : fail("blocked", "Rendez-vous introuvable.");
            if (object(row.meta).assistantConfirmedAction === approved.reference) return { ok: true, status: "already_processed", action, eventId: approved.targetId, message: "Cette validation a déjà été enregistrée. Aucun nouvel envoi demandé.", nextAction: LINK };
            if (!writable(row) || calendarEventFingerprint(row) !== approved.fingerprint) return fail("stale_preview", "Le rendez-vous a changé. Préparez et validez un nouvel aperçu.");
            if (!await scope()) return fail("blocked", "Le compte actif a changé.");
            const route = await import("@/app/api/calendar/events/route");
            let response: Response;
            if (operation === "cancel") response = await route.DELETE(local(request, `/api/calendar/events?id=${approved.targetId}&expectedState=${approved.fingerprint}`, "DELETE"));
            else {
              const patch = approved.patch;
              response = await route.PATCH(local(request, `/api/calendar/events?id=${approved.targetId}`, "PATCH", { summary: patch.title, description: patch.description, location: patch.location, start: patch.start, end: patch.end, allDay: patch.allDay, ...(patch.allDay ? { date: String(patch.start).slice(0, 10) } : {}), expectedState: approved.fingerprint, inrcy: { ...(operation === "confirm" ? { status: "confirmed" } : {}), assistantConfirmedAction: approved.reference } }));
            }
            if (!response.ok) return fail(response.status === 409 ? "stale_preview" : "unknown", "L’action n’est pas confirmée. Relisez le rendez-vous avant toute nouvelle proposition.");
            const after = await event(approved.targetId);
            if (operation === "cancel" ? after !== null : object(after?.meta).assistantConfirmedAction !== approved.reference) return fail("unknown", "Le résultat reste à vérifier dans l’agenda.");
            return { ok: true, status: operation === "cancel" ? "cancelled" : operation === "confirm" ? "confirmed" : "updated", action, eventId: approved.targetId, message: operation === "cancel" ? "Rendez-vous supprimé de l’agenda natif, sans e-mail d’annulation." : "Rendez-vous enregistré. Le parcours natif de confirmation et de rappels s’applique ; la livraison des e-mails n’est pas attestée ici.", nextAction: LINK };
          } catch { return fail("unknown", "Le résultat est incertain. Relisez le rendez-vous avant de réessayer."); }
        })());
        return attempts.get(approved.reference)!;
      } }),
  };
}
