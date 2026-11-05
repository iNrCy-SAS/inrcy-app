import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { requireUser } from "./requireUser";
import { createAssistantActionPreview, verifyAssistantActionPreview, assistantActionFingerprint, hasAssistantActionApproval } from "./inrAssistantActionPreview.ts";
import { parseReferralRequest, referralRequestKey } from "./referralRequest.ts";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const clean = inrAssistantMaskQuotedText;
const normal = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const LINK = { label: "Parrainage", href: "/dashboard?panel=parrainage" };
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides"); return input; }
function quote(value: unknown) { if (typeof value !== "string" || !value.trim() || value.length > 1200) throw new Error("Instruction invalide"); return value.trim(); }
function parsePreview(value: unknown) { const input = fields(value, ["details", "instructionQuote"]); fields(input.details, ["name", "phone", "email", "from"]); return { details: parseReferralRequest(input.details), instructionQuote: quote(input.instructionQuote) }; }
function parseApply(value: unknown) { const input = fields(value, ["reference", "instructionQuote"]); if (typeof input.reference !== "string" || !/^IA-[A-F0-9]{12}$/.test(input.reference)) throw new Error("Référence invalide"); return { reference: input.reference, instructionQuote: quote(input.instructionQuote) }; }
function schema<T>(properties: Record<string, JSONSchema7>, parse: (value: unknown) => T) { return jsonSchema<T>({ type: "object", properties, additionalProperties: false, required: Object.keys(properties) }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Parrainage invalide") }; } } }); }
export function createInrAssistantReferralTools(options: { request: Request; accountId: string; actorUserId: string; currentUserMessage: string; currentApprovalMessage?: string; resolvePreview?: (reference: string) => string | null; canStartWork?: () => boolean }) {
  const fail = (status: string, message: string) => ({ ok: false, status, message, nextAction: LINK });
  async function scope() { const auth = await requireUser(); return !auth.errorResponse && !options.request.signal.aborted && options.canStartWork?.() !== false && auth.activeUserId === options.accountId && auth.authUserId === options.actorUserId; }
  const attempts = new Map<string, Promise<Row>>();
  return {
    previewReferralSubmission: tool({ strict: true, description: "Préparer un aperçu signé du parrainage avec les quatre coordonnées explicitement fournies dans la demande actuelle : nom/raison sociale, téléphone, email et nom du parrain (from). Présenter les données et le destinataire fixe parrainage@inrcy.com, puis demander Confirme IA-… . Aucun email au filleul, aucun envoi pendant la préparation. Ne jamais inventer une coordonnée ou l’extraire d’un avis public.", inputSchema: schema({ details: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 160 }, phone: { type: "string", minLength: 6, maxLength: 40 }, email: { type: "string", format: "email", maxLength: 254 }, from: { type: "string", minLength: 1, maxLength: 160 } }, required: ["name", "phone", "email", "from"], additionalProperties: false }, instructionQuote: { type: "string", maxLength: 1200 } }, parsePreview), execute: async raw => {
      const input = parsePreview(raw), message = normal(clean(options.currentUserMessage));
      if (!clean(options.currentUserMessage).includes(input.instructionQuote) || !/\b(?:parrain\w*|recommand\w*|referral)\b/.test(normal(input.instructionQuote))
        || !/\b(?:prepar\w*|cree\w*|rempl\w*|envoi\w*|envoie|parraine|soumet\w*)\b/.test(normal(input.instructionQuote))
        || /^(?:comment|pourquoi|explique|how|why)\b|\b(?:si|if|quand|apres|avant|demain|plus tard|jamais)\b|\bne\b.{0,60}\bpas\b/.test(message)) return fail("needs_instruction", "Demandez explicitement de préparer le parrainage et indiquez les quatre coordonnées.");
      if (![input.details.name, input.details.email, input.details.from].every(value => message.includes(normal(value))) || !message.replace(/[^\d]/g, "").includes(input.details.phone.replace(/[^\d]/g, ""))) return fail("needs_details", "Le nom, le téléphone, l’email et le nom du parrain doivent être fournis explicitement dans cette demande.");
      if (!await scope()) return fail("blocked", "La session ou l’établissement actif a changé.");
      try { const preview = createAssistantActionPreview({ accountId: options.accountId, actorUserId: options.actorUserId, kind: "referral_submission", targetId: referralRequestKey(options.accountId, options.actorUserId, input.details), fingerprint: assistantActionFingerprint(input.details), patch: { details: input.details } });
        return { ok: true, status: "preview_ready", approvalKind: "referral_submission", ...preview, proposal: { details: input.details, recipient: "parrainage@inrcy.com", effect: "Transmet cette recommandation à l’équipe iNrCy. Aucun email n’est envoyé au professionnel recommandé. Un contenu identique conserve le même reçu pour éviter un nouvel envoi." }, message: `Vérifiez les coordonnées puis dites « Confirme ${preview.reference} ».`, nextAction: LINK };
      } catch { return fail("unavailable", "L’aperçu ne peut pas être signé. Aucun email envoyé."); }
    } }),
    applyReferralSubmission: tool({ strict: true, description: "Transmettre le parrainage signé uniquement après confirmation exacte IA-… . Même contenu/même acteur/même compte = clé et reçu natifs durables identiques. Un SMTP incertain reste bloqué contre une reprise automatique. accepted confirme l’acceptation SMTP par le chemin natif, pas la livraison. Aucun email au filleul ; destinataire fixe équipe iNrCy.", inputSchema: schema({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, instructionQuote: { type: "string", maxLength: 1200 } }, parseApply), execute: async raw => {
      const input = parseApply(raw), approved = verifyAssistantActionPreview(options.resolvePreview?.(input.reference) || "", { accountId: options.accountId, actorUserId: options.actorUserId, kind: "referral_submission" });
      if (!approved || approved.reference !== input.reference || !hasAssistantActionApproval(options.currentApprovalMessage || options.currentUserMessage, input.instructionQuote, approved.reference)) return fail("confirmation_required", "Confirmez la référence exacte de l’aperçu de parrainage.");
      if (!await scope()) return fail("blocked", "La session ou l’établissement actif a changé.");
      if (!attempts.has(approved.reference)) attempts.set(approved.reference, (async (): Promise<Row> => {
        try {
          const details = parseReferralRequest(approved.patch.details), idempotencyKey = referralRequestKey(options.accountId, options.actorUserId, details);
          if (approved.targetId !== idempotencyKey || approved.fingerprint !== assistantActionFingerprint(details)) return fail("invalid_preview", "L’aperçu doit être renouvelé.");
          const headers = new Headers({ "content-type": "application/json" }); for (const name of ["cookie", "authorization"]) { const value = options.request.headers.get(name); if (value) headers.set(name, value); }
          const request = new Request(new URL("/api/referrals", options.request.url), { method: "POST", headers, body: JSON.stringify({ ...details, idempotencyKey }), signal: options.request.signal });
          const { POST } = await import("@/app/api/referrals/route"), response = await POST(request), result = row(await response.json());
          if (!response.ok || result.ok !== true || result.status !== "accepted" || typeof result.receiptId !== "string" || !/^[a-f0-9-]{36}$/i.test(result.receiptId)) return fail(result.status === "unavailable" ? "unavailable" : "unknown", "L’acceptation du parrainage n’est pas confirmée. Aucun nouvel envoi automatique ne sera lancé pour ce même contenu.");
          return { ok: true, status: "accepted", receiptId: result.receiptId, deliveryVerified: false, message: "La route native confirme l’acceptation de la recommandation par SMTP pour l’équipe iNrCy. La livraison n’est pas vérifiée. Conservez ce reçu ; ne renvoyez pas la recommandation.", nextAction: LINK };
        } catch { return fail("unknown", "L’envoi reste incertain. Le reçu natif empêche de recommencer automatiquement ce même parrainage ; vérifiez auprès de l’équipe."); }
      })()); return attempts.get(approved.reference)!;
    } }),
  };
}
