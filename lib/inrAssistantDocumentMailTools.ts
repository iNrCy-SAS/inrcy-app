import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { requireUser } from "./requireUser";
import { getDashboardEditionForAccountId } from "./dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "./accountSubscriptionAccess";
import { parseInrAssistantDocumentMailCommand } from "./inrAssistantDocumentUiCommands.ts";
import { matchesInrAssistantActionClause, inrAssistantMaskQuotedText } from "./inrAssistantActionClause.ts";

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/’/g, "'").toLowerCase();
export function isInrAssistantDocumentMailInstruction(message: string, quote: string, recipient: string) {
  return matchesInrAssistantActionClause(message, quote, (current, clause) => [current, clause].every(value => {
    const text = normalize(inrAssistantMaskQuotedText(value));
    const addresses = value.match(/[^\s@<>;,"«»“”]+@[^\s@<>;,"«»“”]+\.[^\s@<>;,"«»“”]+/g) ?? [];
    return addresses.some(email => email.replace(/[.!?]+$/, "").toLowerCase() === recipient.toLowerCase()) &&
      !/\b(?:comment|pourquoi|expliqu\w*|imagine|how|why)\b/.test(text) &&
      !/\b(?:ne|n'|not|don't|do not|jamais|never)\b.{0,45}\b(?:prepar|ouvr|redig|rempl|prepare|open|draft)/.test(text) &&
      !/\b(?:sans|without)\b.{0,20}\b(?:prepar|ouvr|redig|rempl|prepare|open|draft)/.test(text) &&
      !/\b(?:si|if|quand|when|lorsque|demain|tomorrow|plus tard|later)\b|\b(?:apres|after).{0,35}\b(?:confirmation|accord|approval)\b/.test(text) &&
      /\b(?:prepare\w*|ouvre\w*|redige\w*|rempli\w*|open|draft)\b/.test(text) && /\b(?:mail|email|courriel|composeur|composer)\b/.test(text) &&
      /\b(?:pdf|piece jointe|pj)\b/.test(text) && /\b(?:devis|facture|document|quote|invoice)\b/.test(text);
  }));
}

export async function requestInrAssistantDocumentMail(options: {
  accountId: string; currentUserMessage: string; supabase?: Pick<SupabaseClient, "from">;
  clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean;
}, input: { recipient?: string | null; documentId?: string | null; documentKind?: "quote" | "invoice" | null; instructionQuote: string }) {
  const fail = (status: string, message: string) => ({ ok: false, status, message });
  const screen = options.clientContext?.screen;
  const command = parseInrAssistantDocumentMailCommand({ command: "prepare_document_mail", selection: screen?.selection,
    revision: screen?.revision, expectedUpdatedAt: screen?.documentVersion, recipient: input.recipient });
  if (!command || !screen || screen.pendingChanges !== false || !screen.availableCommands?.includes(command.command) ||
    screen.pathname !== `/dashboard/${command.selection.kind === "quote" ? "devis" : "factures"}/new` ||
    input.documentId && input.documentId !== command.selection.id || input.documentKind && input.documentKind !== command.selection.kind) return fail("needs_details", "Ouvrez le document finalisé et enregistré, sans modifications locales, puis indiquez le destinataire du mail. Rien n’a été envoyé.");
  if (options.canStartWork?.() === false || !isInrAssistantDocumentMailInstruction(options.currentUserMessage, input.instructionQuote, command.recipient)) return fail("needs_instruction", "Demandez explicitement la préparation du mail avec le PDF et son destinataire. Aucun envoi n’est déclenché.");
  const auth = await requireUser();
  if (auth.errorResponse || auth.activeUserId !== options.accountId || !options.supabase ||
    await getDashboardEditionForAccountId(options.accountId) !== "founder" || !(await getActiveSubscriptionAccountIds([options.accountId])).has(options.accountId)) return fail("blocked", "L’accès actif à la gestion commerciale doit être vérifié.");
  const kind = command.selection.kind === "quote" ? "devis" : "facture";
  const { data, error } = await options.supabase.from("doc_saves").select("id,user_id,type,updated_at,payload").eq("user_id", options.accountId).eq("type", kind).eq("id", command.selection.id).maybeSingle();
  if (error || !data || data.id !== command.selection.id || data.user_id !== options.accountId || data.type !== kind ||
    data.updated_at !== command.expectedUpdatedAt || data.payload?.isFinalized !== true || data.payload?.isTemplate === true ||
    typeof data.payload?.number !== "string" || !data.payload.number.trim()) return fail("blocked", "Ce document a changé ou n’est pas finalisé. Rechargez sa version actuelle. Aucune finalisation ni aucun envoi n’ont été lancés.");
  const targetText = normalize(inrAssistantMaskQuotedText(input.instructionQuote));
  const nouns = kind === "devis" ? "devis|document|quote" : "facture|document|invoice";
  const currentTarget = new RegExp(`\\b(?:ce|cet|cette|this|current)\\s+(?:${nouns})\\b|\\b(?:${nouns})\\s+(?:actuel|actuelle|ouvert|ouverte|current)\\b`).test(targetText);
  const wrongKind = kind === "devis" ? /\b(?:facture|invoice)\b/.test(targetText) : /\b(?:devis|quote)\b/.test(targetText);
  const namedTarget = [data.payload.number, data.id].some(reference => {
    const escaped = normalize(reference).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(targetText);
  });
  if (wrongKind || !currentTarget && !namedTarget) return fail("needs_details", "Désignez le document ouvert ou son numéro exact. Aucun autre document n’a été préparé.");
  if (options.canStartWork?.() === false) return fail("blocked", "La préparation a été interrompue.");
  return { ok: true, status: "ui_action_requested", uiCommand: command,
    message: "Préparation du PDF et ouverture du composeur demandées au navigateur. Le destinataire et la pièce jointe restent à vérifier avant l’envoi explicite. Le document n’est ni sauvegardé ni finalisé par cette commande." };
}
