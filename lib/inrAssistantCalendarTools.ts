import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { calendarEventFingerprint, createAssistantActionPreview, hasAssistantActionApproval, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { sanitizeInrAssistantMemoryText } from "./inrAssistantMemory.ts";
import { inrAssistantMaskQuotedText, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";

type Row = Record<string, unknown>;
type Preview = { eventId: string; operation: "confirm" | "edit" | "cancel" | "reject"; instructionQuote: string; title: string | null; description: string | null; location: string | null; start: string | null; end: string | null; addGuestEmails: string[] | null; remindersEnabled: boolean | null; reminderMailboxId: string | null };
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
  const input = fields({ addGuestEmails: null, remindersEnabled: null, reminderMailboxId: null, ...object(value) }, ["eventId", "operation", "instructionQuote", "title", "description", "location", "start", "end", "addGuestEmails", "remindersEnabled", "reminderMailboxId"]);
  if (!UUID.test(String(input.eventId)) || !["confirm", "edit", "cancel", "reject"].includes(String(input.operation))) throw new Error("Action invalide");
  if (input.addGuestEmails !== null && (!Array.isArray(input.addGuestEmails) || !input.addGuestEmails.length || input.addGuestEmails.length > 10 || input.addGuestEmails.some(value => typeof value !== "string" || value.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value)))) throw new Error("Adresses des invités invalides");
  if (input.remindersEnabled !== null && typeof input.remindersEnabled !== "boolean" || input.reminderMailboxId !== null && (typeof input.reminderMailboxId !== "string" || !UUID.test(input.reminderMailboxId))) throw new Error("Réglage des rappels invalide");
  const start = input.start === null ? null : date(input.start), end = input.end === null ? null : date(input.end);
  if (Boolean(start) !== Boolean(end) || start && end && (start >= end || Date.parse(end) - Date.parse(start) > 7 * 86400_000)) throw new Error("Créneau invalide");
  const result: Preview = { eventId: String(input.eventId), operation: input.operation as Preview["operation"], instructionQuote: string(input.instructionQuote, 1200), title: optional(input.title, 180), description: optional(input.description, 1500), location: optional(input.location, 250), start, end, addGuestEmails: input.addGuestEmails === null ? null : [...new Set((input.addGuestEmails as string[]).map(value => value.toLowerCase()))], remindersEnabled: input.remindersEnabled as boolean | null, reminderMailboxId: input.reminderMailboxId as string | null };
  const updates = [result.title, result.description, result.location, start, result.addGuestEmails, result.remindersEnabled, result.reminderMailboxId];
  if (result.operation !== "edit" && updates.some(value => value !== null)) throw new Error("Cette action ne modifie pas le contenu");
  if (result.operation === "edit" && updates.every(value => value === null)) throw new Error("Modification requise");
  return result;
}
function parseApply(value: unknown): Apply { const input = fields(value, ["reference", "instructionQuote"]); const reference = string(input.reference, 15); if (!/^IA-[A-F0-9]{12}$/.test(reference)) throw new Error("Référence invalide"); return { reference, instructionQuote: string(input.instructionQuote, 1200) }; }
function schema<T>(properties: Record<string, JSONSchema7>, parse: (input: unknown) => T) { return jsonSchema<T>({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Paramètres agenda invalides") }; } } }); }
const safe = (value: unknown, maximum: number) => sanitizeInrAssistantMemoryText(typeof value === "string" ? value : "", maximum);
function command(message: string, quote: string, action: Preview["operation"]) {
  if (/^(?:imagin\w*|suppos\w*|pretend|assume)\b/.test(inrAssistantUnquotedRequest(message))) return false;
  return matchesInrAssistantActionClause(message, quote, (current, exact) => commandClause(current, exact, action));
}
function commandClause(message: string, quote: string, action: Preview["operation"]) {
  if (!inrAssistantMaskQuotedText(message).includes(quote)) return false;
  const text = normalize(inrAssistantMaskQuotedText(message)), directive = normalize(inrAssistantMaskQuotedText(quote));
  if (/\b(?:comment|pourquoi|explique|imagine|suppose|si|quand|lorsque|ne pas)\b|\bne\b.{0,40}\bpas\b|\bn['’]|\b(?:annule|confirme|modifie|refuse|rejette|ajoute|active|desactive|invite|coupe)\s+pas\b/.test(text)) return false;
  return (action === "confirm" ? /\b(?:confirme|confirmer|valide|valider|accepte|accepter|finalise|finaliser)\b/ : action === "cancel" ? /\b(?:annule|annuler|supprime|supprimer)\b/ : action === "reject" ? /\b(?:refuse|refuser|rejette|rejeter)\b/ : /\b(?:modifie|modifier|deplace|deplacer|reporte|reporter|change|changer|corrige|corriger|ajoute|ajouter|invite|inviter|active|activer|reactive|reactiver|desactive|desactiver|coupe|couper)\b/).test(directive);
}
function local(source: Request, path: string, method: string, body?: unknown) { const headers = new Headers({ "content-type": "application/json" }); for (const name of ["cookie", "authorization"]) { const value = source.headers.get(name); if (value) headers.set(name, value); } return new Request(new URL(path, source.url), { method, headers, signal: source.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }

/** A preview never changes an event. Only the same pro's exact, signed proposal can call the native lifecycle. */
export function createInrAssistantCalendarTools(options: { request: Request; accountId: string; actorUserId: string; edition: DashboardEdition; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; currentApprovalMessage?: string; canStartWork?: () => boolean; resolvePreview?: (reference: string) => string | null }) {
  if (!UUID.test(options.accountId) || !UUID.test(options.actorUserId)) throw new Error("Périmètre agenda invalide");
  const { request, accountId, actorUserId, supabase, currentUserMessage } = options;
  const fail = (status: string, message: string) => ({ ok: false, status, message, nextAction: LINK });
  const scope = async () => { if (!["premium", "founder"].includes(options.edition) || request.signal.aborted || options.canStartWork?.() === false) return false; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId; };
  const event = async (id: string) => { const result = await supabase.from("agenda_events").select(SELECT).eq("user_id", accountId).eq("id", id).maybeSingle(); if (result.error) throw new Error("Lecture agenda indisponible"); const row = object(result.data); return row.id === id && row.user_id === accountId ? row : null; };
  const writable = (row: Row) => { const meta = object(row.meta); return meta.readOnly !== true && meta.source !== "google_shared_calendar" && !meta.googleEventId && (!meta.source || ["manual", "inrbadge"].includes(String(meta.source))); };
  const attempts = new Map<string, Promise<Row>>();
  return {
    previewCalendarAction: tool({ strict: true, description: "Préparer sans modification la confirmation, l’édition ou la suppression d’un RDV local, ou le refus natif (reject) d’une demande client en attente avec notification. Lire le rendez-vous avant. edit peut ajouter des invités par adresses explicites sans retirer les anciens, activer/désactiver ses rappels et choisir leur boîte connectée explicitement citée. Aucun changement des réglages globaux ni des délais. Aperçu exact, jeton signé, référence IA- à confirmer par le pro. Google reste géré dans Google. Toutes les valeurs non modifiées sont null.",
      inputSchema: schema<Preview>({ eventId: { type: "string", format: "uuid" }, operation: { type: "string", enum: ["confirm", "edit", "cancel", "reject"] }, instructionQuote: { type: "string", maxLength: 1200 }, title: nullable(180), description: nullable(1500), location: nullable(250), start: nullable(40), end: nullable(40), addGuestEmails: { type: ["array", "null"], minItems: 1, maxItems: 10, uniqueItems: true, items: { type: "string", format: "email", maxLength: 254 } }, remindersEnabled: { type: ["boolean", "null"] }, reminderMailboxId: { type: ["string", "null"], format: "uuid" } }, parsePreview),
      execute: async raw => {
        const input = parsePreview(raw);
        if (!command(currentUserMessage, input.instructionQuote, input.operation)) return fail("needs_instruction", "Précisez le rendez-vous et l’action souhaitée.");
        if (!await scope()) return fail("blocked", "Ce compte ou cette édition ne permet pas l’action agenda.");
        try {
          const row = await event(input.eventId);
          if (!row || !writable(row)) return fail("blocked", "Rendez-vous absent ou géré par un autre agenda.");
          const meta = object(row.meta);
          if (input.operation === "reject" && (meta.source !== "inrbadge" || meta.status !== "pending")) return fail("blocked", "Seule une demande client encore en attente peut être refusée. Aucun rendez-vous supprimé.");
          if (input.operation === "confirm" && !["draft", "pending"].includes(String(meta.status))) return fail("already_confirmed", "Ce rendez-vous n’attend pas de confirmation.");
          if (row.all_day === true && input.start) return fail("needs_instruction", "Le déplacement d’un événement sur une journée entière se fait dans l’agenda.");
          const patch: Row = { operation: input.operation, title: input.title ?? row.title, description: input.description ?? row.description, location: input.location ?? row.location, start: input.start ?? row.start_at, end: input.end ?? row.end_at, allDay: row.all_day === true };
          const guestRows = Array.isArray(meta.guests) ? meta.guests.map(object) : [];
          const reminders = { ...object(meta.reminders) };
          const quote = normalize(inrAssistantMaskQuotedText(input.instructionQuote));
          if (input.addGuestEmails) {
            if (!/\b(?:ajoute|ajouter|invite|inviter)\b/.test(quote) || input.addGuestEmails.some(email => !input.instructionQuote.toLowerCase().includes(email))) return fail("needs_instruction", "Citez les adresses exactes des invités à ajouter.");
            patch.guests = [...guestRows, ...input.addGuestEmails.filter(email => !guestRows.some(guest => String(guest.email ?? "").toLowerCase() === email)).map(email => ({ email, display_name: email }))];
            if ((patch.guests as unknown[]).length > 50) return fail("needs_details", "La liste d’invités est trop longue pour cet aperçu.");
          }
          if (input.remindersEnabled !== null) {
            if (!/\brappels?\b/.test(quote) || !(input.remindersEnabled ? /\b(?:active|activer|reactive|reactiver)\b/ : /\b(?:desactive|desactiver|coupe|couper)\b/).test(quote)) return fail("needs_instruction", "Indiquez explicitement si les rappels de ce rendez-vous doivent être activés ou désactivés.");
            reminders.enabled = input.remindersEnabled;
          }
          if (input.reminderMailboxId) {
            if (!/\brappels?\b/.test(quote) || !/\b(?:modifie|change|utilise|choisis|selectionne|active|configure)\b/.test(quote)) return fail("needs_instruction", "Précisez la boîte à utiliser pour les rappels de ce rendez-vous.");
            const { data, error } = await supabase.from("integrations").select("id,user_id,category,account_email,status").eq("id", input.reminderMailboxId).eq("user_id", accountId).eq("category", "mail").maybeSingle();
            const mailbox = object(data);
            if (error || mailbox.id !== input.reminderMailboxId || mailbox.user_id !== accountId || mailbox.category !== "mail" || mailbox.status !== "connected" || typeof mailbox.account_email !== "string" || !input.instructionQuote.toLowerCase().includes(mailbox.account_email.toLowerCase())) return fail("needs_instruction", "Désignez l’adresse exacte d’une boîte connectée pour les rappels.");
            reminders.mailAccountId = input.reminderMailboxId;
          }
          if (input.remindersEnabled !== null || input.reminderMailboxId) patch.reminders = reminders;
          const preview = createAssistantActionPreview({ accountId, actorUserId, kind: "calendar", targetId: input.eventId, fingerprint: calendarEventFingerprint(row), patch });
          const recipients = input.operation === "reject" ? [String(object(meta.contact).email || object(meta.inrBadgeAppointmentRequest).clientEmail || "").toLowerCase()].filter(Boolean) : [...new Set([object(meta.contact), ...(Array.isArray(patch.guests) ? patch.guests.map(object) : guestRows)].map(contact => typeof contact.email === "string" ? contact.email.toLowerCase() : "").filter(Boolean))].slice(0, 50);
          return { ok: true, status: "preview_ready", approvalKind: "calendar", eventId: input.eventId, ...preview, proposal: { operation: input.operation, title: safe(patch.title, 180), description: safe(patch.description, 1500), location: safe(patch.location, 250), start: patch.start, end: patch.end, allDay: patch.allDay, knownRecipients: recipients, remindersEnabled: reminders.enabled !== false, reminderMailboxId: reminders.mailAccountId ?? null, effect: input.operation === "cancel" ? "Suppression de l’agenda natif. Cette action native n’envoie pas d’e-mail d’annulation." : input.operation === "reject" ? "Refus de la demande client conservée dans l’agenda. Le parcours natif tente d’envoyer le mail de refus au client ; aucune livraison ne peut être garantie." : "L’enregistrement peut envoyer les confirmations aux contacts/invités et au professionnel selon les réglages iNr’Calendar ; seuls les rappels explicitement demandés sont modifiés." }, message: `Vérifiez cet aperçu, puis dites « Confirme ${preview.reference} » pour l’appliquer.`, nextAction: LINK, untrustedContent: true };
        } catch { return fail("unavailable", "L’aperçu ne peut pas être préparé. Aucun rendez-vous modifié."); }
      } }),
    applyCalendarAction: tool({ strict: true, description: "Appliquer uniquement l’aperçu agenda signé dont le pro confirme explicitement la référence IA- dans son dernier message. Le serveur retrouve le jeton privé de previewCalendarAction. Revalide compte, acteur, expiration et événement inchangé ; protège les mises à jour concurrentes et les reprises. Ne jamais dire qu’un email est livré.",
      inputSchema: schema<Apply>({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, instructionQuote: { type: "string", maxLength: 1200 } }, parseApply),
      execute: async raw => {
        const input = parseApply(raw), approved = verifyAssistantActionPreview(options.resolvePreview?.(input.reference) ?? "", { accountId, actorUserId, kind: "calendar" });
        if (!approved || approved.reference !== input.reference || !hasAssistantActionApproval(options.currentApprovalMessage ?? currentUserMessage, input.instructionQuote, approved.reference)) return fail("confirmation_required", "Confirmez la référence exacte d’un aperçu agenda valide.");
        if (!await scope()) return fail("blocked", "Le compte actif a changé ou l’action est indisponible.");
        if (!attempts.has(approved.reference)) attempts.set(approved.reference, (async (): Promise<Row> => {
          try {
            const row = await event(approved.targetId), operation = String(approved.patch.operation);
            const action = operation === "edit" ? "update" : operation;
            if (!row) return operation === "cancel" ? { ok: true, status: "cancelled", action, eventId: approved.targetId, message: "Le rendez-vous est absent de l’agenda.", nextAction: LINK } : fail("blocked", "Rendez-vous introuvable.");
            if (object(row.meta).assistantConfirmedAction === approved.reference) return { ok: true, status: "already_processed", action, eventId: approved.targetId, message: "Cette validation a déjà été enregistrée. Aucun nouvel envoi demandé.", nextAction: LINK };
            if (!writable(row) || calendarEventFingerprint(row) !== approved.fingerprint) return fail("stale_preview", "Le rendez-vous a changé. Préparez et validez un nouvel aperçu.");
            if (!await scope()) return fail("blocked", "Le compte actif a changé.");
            let response: Response;
            if (operation === "reject") {
              const route = await import("@/app/api/calendar/appointment-requests/route");
              response = await route.PATCH(local(request, `/api/calendar/appointment-requests?id=${approved.targetId}`, "PATCH", { action: "reject", expectedState: approved.fingerprint, approvalReference: approved.reference }));
            }
            else {
              const route = await import("@/app/api/calendar/events/route");
              const patch = approved.patch;
              if (operation === "cancel") response = await route.DELETE(local(request, `/api/calendar/events?id=${approved.targetId}&expectedState=${approved.fingerprint}`, "DELETE"));
              else response = await route.PATCH(local(request, `/api/calendar/events?id=${approved.targetId}`, "PATCH", { summary: patch.title, description: patch.description, location: patch.location, start: patch.start, end: patch.end, allDay: patch.allDay, ...(patch.allDay ? { date: String(patch.start).slice(0, 10) } : {}), expectedState: approved.fingerprint, inrcy: { ...(operation === "confirm" ? { status: "confirmed" } : {}), ...(patch.guests ? { guests: patch.guests } : {}), ...(patch.reminders ? { reminders: patch.reminders } : {}), assistantConfirmedAction: approved.reference } }));
            }
            if (!response.ok) return fail(response.status === 409 ? "stale_preview" : "unknown", "L’action n’est pas confirmée. Relisez le rendez-vous avant toute nouvelle proposition.");
            const after = await event(approved.targetId);
            if (operation === "cancel" ? after !== null : object(after?.meta).assistantConfirmedAction !== approved.reference) return fail("unknown", "Le résultat reste à vérifier dans l’agenda.");
            const receipt = object(await response.json().catch(() => null));
            return { ok: true, status: operation === "cancel" ? "cancelled" : operation === "confirm" ? "confirmed" : operation === "reject" ? "rejected" : "updated", action, eventId: approved.targetId, ...(operation === "reject" ? { rejectionMailSent: receipt.rejectionMailSent === true } : {}), message: operation === "cancel" ? "Rendez-vous supprimé de l’agenda natif, sans e-mail d’annulation." : operation === "reject" ? "Demande refusée et conservée dans l’agenda. Le parcours natif de notification a été exécuté ; la livraison du mail n’est pas attestée ici." : "Rendez-vous enregistré. Le parcours natif de confirmation et de rappels s’applique ; la livraison des e-mails n’est pas attestée ici.", nextAction: LINK };
          } catch { return fail("unknown", "Le résultat est incertain. Relisez le rendez-vous avant de réessayer."); }
        })());
        return attempts.get(approved.reference)!;
      } }),
  };
}
