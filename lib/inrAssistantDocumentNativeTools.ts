import "server-only";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { requireUser } from "./requireUser";
import { getDashboardEditionForAccountId } from "./dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "./accountSubscriptionAccess";
import { COMMERCIAL_UUID } from "./commercialDocumentDraft.ts";
import { commercialDocumentRow as row } from "./commercialDocumentValidation.ts";
import { matchesInrAssistantActionClause, inrAssistantMaskQuotedText } from "./inrAssistantActionClause.ts";
import { unquotedInrAssistantIntent as intent } from "./inrAssistantCommandRegistry.ts";
import { assistantActionFingerprint, createAssistantActionPreview, hasAssistantActionApproval, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";

type PreviewInput = { documentId: string; expectedUpdatedAt: string; reference: string; instructionQuote: string };
type ApplyInput = { reference: string; instructionQuote: string };
const KIND = "commercial_document";
const LINK = { label: "Mes factures", href: "/dashboard/factures" };
const fingerprint = (document: Record<string, unknown>) => assistantActionFingerprint({
  id: document.id, user_id: document.user_id, type: document.type, updated_at: document.updated_at, payload: document.payload,
});
const text = (value: unknown, max = 180) => typeof value === "string" && value.trim() && value.length <= max ? value.trim() : "";
function parsePreview(value: unknown): PreviewInput {
  const input = row(value);
  if (Object.keys(input).sort().join(",") !== "documentId,expectedUpdatedAt,instructionQuote,reference" ||
    !COMMERCIAL_UUID.test(String(input.documentId)) || !text(input.expectedUpdatedAt, 40) || !Number.isFinite(Date.parse(String(input.expectedUpdatedAt))) ||
    !text(input.reference) || !text(input.instructionQuote, 1600)) throw new Error("Référence de facture invalide.");
  return input as PreviewInput;
}
function parseApply(value: unknown): ApplyInput {
  const input = row(value);
  if (Object.keys(input).sort().join(",") !== "instructionQuote,reference" || !/^IA-[A-F0-9]{12}$/.test(String(input.reference)) || !text(input.instructionQuote, 1600)) throw new Error("Confirmation invalide.");
  return input as ApplyInput;
}
function isPaidInstruction(message: string, quote: string) {
  return matchesInrAssistantActionClause(message, quote, (current, clause) => {
    const command = intent(inrAssistantMaskQuotedText(clause)), all = intent(inrAssistantMaskQuotedText(current));
    return !/\b(?:ne|pas|jamais|sans|not|never)\b|\bn'/.test(all) &&
      !/^(?:comment|pourquoi|explique|imagine|how|why)\b/.test(all) &&
      /\b(?:marque|marquer|passe|passer|indique|declare|mark|set)\b/.test(all) && /\bfacture\b|\binvoice\b/.test(all) && /\bpayee?\b|\bpaid\b/.test(all) &&
      !/^(?:comment|pourquoi|explique|imagine|how|why)\b/.test(command) &&
      /\b(?:marque|marquer|passe|passer|indique|declare|mark|set)\b/.test(command) && /\bfacture\b|\binvoice\b/.test(command) && /\bpayee?\b|\bpaid\b/.test(command);
  });
}

export function createInrAssistantDocumentNativeTools(options: {
  request: Request; accountId: string; actorUserId: string; supabase: Pick<SupabaseClient, "from">;
  edition: DashboardEdition; currentUserMessage: string; currentApprovalMessage?: string;
  clientContext?: InrAssistantClientContext | null; resolvePreview?: (reference: string) => string | null;
  canStartWork?: () => boolean;
}) {
  const { request, accountId, actorUserId, supabase } = options;
  const pending = new Map<string, Promise<Record<string, unknown>>>();
  const fail = (status: string, message: string) => ({ ok: false, status, message, nextAction: LINK });
  const allowed = async () => {
    if (request.signal.aborted || options.canStartWork?.() === false || options.edition !== "founder") return false;
    const auth = await requireUser();
    return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId &&
      await getDashboardEditionForAccountId(accountId) === "founder" && (await getActiveSubscriptionAccountIds([accountId])).has(accountId);
  };
  const read = async (id: string) => {
    const result = await supabase.from("doc_saves").select("id,user_id,type,name,payload,updated_at").eq("id", id).eq("user_id", accountId).eq("type", "facture").maybeSingle();
    const document = row(result.data);
    return result.error || !result.data || document.id !== id || document.user_id !== accountId || document.type !== "facture" || row(document.payload).isTemplate === true ? null : document;
  };
  const previewSchema = jsonSchema<PreviewInput>({ type: "object", additionalProperties: false, properties: {
    documentId: { type: "string", pattern: COMMERCIAL_UUID.source }, expectedUpdatedAt: { type: "string", maxLength: 40 },
    reference: { type: "string", minLength: 1, maxLength: 180 }, instructionQuote: { type: "string", minLength: 1, maxLength: 1600 },
  }, required: ["documentId", "expectedUpdatedAt", "reference", "instructionQuote"] });
  return {
    previewCommercialDocumentAction: tool({ strict: true,
      description: "Prévisualiser le statut manuel payé d’UNE facture réelle lue avec readCommercialDocuments. Numéro/ID exact cité, version updatedAt exacte, demande actuelle explicite. Ce statut n’encaisse rien, ne finalise rien et n’attribue aucun numéro. La confirmation exacte du nouvel aperçu sera nécessaire.",
      inputSchema: previewSchema,
      execute: async raw => {
        try {
          const input = parsePreview(raw);
          if (!await allowed()) return fail("not_included", "Accès actif à la gestion commerciale requis.");
          if (!isPaidInstruction(options.currentUserMessage, input.instructionQuote)) return fail("needs_instruction", "Demandez explicitement de marquer une facture précise comme payée. Aucun statut modifié.");
          const document = await read(input.documentId), payload = row(document?.payload);
          if (!document || document.updated_at !== input.expectedUpdatedAt) return fail("needs_details", "Relisez la facture et sa version actuelle.");
          const reference = intent(input.reference), selected = options.clientContext?.screen?.selection;
          const currentSelected = selected?.kind === "invoice" && selected.id === input.documentId && /^(?:cette facture|la facture ouverte)$/.test(reference);
          if (!intent(options.currentUserMessage).includes(reference) || !reference ||
            !currentSelected && ![document.id, payload.number].some(value => text(value) && intent(String(value)) === reference)) return fail("needs_details", "Citez le numéro exact de la facture, ou désignez la facture actuellement ouverte.");
          if (selected?.id === input.documentId && options.clientContext?.screen?.pendingChanges === true || currentSelected && options.clientContext?.screen?.pendingChanges !== false) return fail("blocked", "Enregistrez ou abandonnez les modifications du formulaire avant de modifier le statut enregistré.");
          if (payload.status === "paye") return { ok: true, status: "unchanged", id: input.documentId, documentStatus: "paye", paymentCollected: false, nextAction: LINK, message: "Cette facture porte déjà le statut payé. Aucun encaissement effectué." };
          const preview = createAssistantActionPreview({ accountId, actorUserId, kind: KIND, targetId: input.documentId, fingerprint: fingerprint(document), patch: { operation: "mark_paid", expectedUpdatedAt: input.expectedUpdatedAt } });
          return { ok: true, status: "preview_ready", approvalKind: KIND, ...preview,
            proposal: { operation: "mark_paid", id: input.documentId, number: text(payload.number), clientName: text(payload.clientName), previousStatus: text(payload.status), nextStatus: "paye", paymentCollected: false },
            nextAction: LINK, message: `Vérifiez la facture, puis dites « Confirme ${preview.reference} ». Seul le statut manuel payé sera enregistré ; aucun encaissement, numéro, finalisation ou envoi.` };
        } catch { return fail("blocked", "La préparation du changement de statut est indisponible. Aucun statut modifié."); }
      },
    }),
    applyCommercialDocumentAction: tool({ strict: true,
      description: "Appliquer un aperçu commercial privé validé par sa référence exacte IA-… dans une confirmation actuelle. Pour le statut payé : écriture comptable manuelle seulement, jamais encaissement ou finalisation. Un échec incertain impose relecture, pas une nouvelle tentative inventée.",
      inputSchema: jsonSchema<ApplyInput>({ type: "object", additionalProperties: false, properties: { reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, instructionQuote: { type: "string", minLength: 1, maxLength: 1600 } }, required: ["reference", "instructionQuote"] }),
      execute: async raw => {
        const input = parseApply(raw);
        if (pending.has(input.reference)) return pending.get(input.reference)!;
        const run = async () => {
          if (!await allowed()) return fail("not_included", "Les droits ou l’établissement actif ont changé.");
          const approvalMessage = options.currentApprovalMessage ?? options.currentUserMessage;
          if (!inrAssistantMaskQuotedText(approvalMessage).includes(input.instructionQuote) || !hasAssistantActionApproval(approvalMessage, input.instructionQuote, input.reference)) return fail("needs_instruction", "Confirmez explicitement la référence exacte de l’aperçu.");
          const approved = verifyAssistantActionPreview(options.resolvePreview?.(input.reference) ?? "", { accountId, actorUserId, kind: KIND });
          if (!approved || approved.reference !== input.reference || approved.patch.operation !== "mark_paid" || !COMMERCIAL_UUID.test(approved.targetId) || !text(approved.patch.expectedUpdatedAt, 40)) return fail("blocked", "L’aperçu a expiré ou ne correspond pas à ce compte. Préparez un nouvel aperçu.");
          if (options.clientContext?.screen?.selection?.id === approved.targetId && options.clientContext.screen.pendingChanges === true) return fail("blocked", "Le formulaire contient des modifications non enregistrées. Vérifiez-les avant de confirmer le statut.");
          const document = await read(approved.targetId);
          if (!document || document.updated_at === approved.patch.expectedUpdatedAt && fingerprint(document) !== approved.fingerprint) return fail("blocked", "La facture a changé. Préparez un nouvel aperçu.");
          if (!await allowed()) return fail("blocked", "Les droits ou l’établissement actif ont changé.");
          const headers = new Headers({ "content-type": "application/json", "idempotency-key": `assistant_document_${approved.reference}` });
          for (const name of ["cookie", "authorization"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
          const native = await import("@/app/api/documents/status/route");
          const response = await native.POST(new Request(new URL("/api/documents/status", request.url), { method: "POST", headers, signal: request.signal, body: JSON.stringify({ documentId: approved.targetId, expectedUpdatedAt: approved.patch.expectedUpdatedAt, status: "paye" }) }));
          const receipt = row(await response.json().catch(() => null));
          if (!response.ok || receipt.ok !== true || receipt.id !== approved.targetId || receipt.documentStatus !== "paye" || receipt.paymentCollected !== false) return fail(response.status === 409 ? "blocked" : "unknown", "Le statut payé ne peut pas être confirmé. Relisez la facture avant toute autre action.");
          return { ...receipt, status: receipt.unchanged ? "unchanged" : "updated", nextAction: LINK };
        };
        const promise = run().catch(() => fail("unknown", "Le changement de statut ne peut pas être confirmé. Relisez la facture."));
        pending.set(input.reference, promise);
        return promise;
      },
    }),
  };
}
