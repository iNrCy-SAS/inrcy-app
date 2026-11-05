import "server-only";
import { jsonSchema, tool } from "ai";
import { requireUser } from "./requireUser";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS, isInrAssistantStudioDraftReviewRequest, type InrAssistantStudioDraftReviewTarget } from "./inrAssistantStudioDraftReview.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
export { isInrAssistantStudioDraftReviewRequest } from "./inrAssistantStudioDraftReview.ts";

export function createInrAssistantStudioDraftReviewUiTools(options: { accountId: string; actorUserId: string; currentUserMessage: string; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  return { prepareStudioDraftReview: tool({ strict: true,
    description: "Ouvrir UNIQUEMENT la confirmation native actuelle du Studio pour réinitialiser, fermer avec brouillon, abandonner le retour d’une publication ou examiner l’abandon de la tentative guidée/libre. Choisir la cible et sa révision exactes déclarées par clientContext.interfaces. Aucun job annulé, aucun brouillon supprimé, aucun crédit remboursé par cet outil. Le professionnel choisit personnellement dans le dialogue. Ne jamais affirmer l’action finale pour confirmation_required.",
    inputSchema: jsonSchema<{ target: InrAssistantStudioDraftReviewTarget; revision: string; instructionQuote: string }>({ type: "object", additionalProperties: false, required: ["target", "revision", "instructionQuote"], properties: { target: { type: "string", enum: [...INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS] }, revision: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 } } }),
    execute: async input => {
      const fail = (status: string, message: string) => ({ ok: false, status, message });
      if (!INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS.includes(input.target)) return fail("needs_instruction", "Choisissez une confirmation native du Studio disponible.");
      const hint = options.clientContext?.interfaces?.find(item => item.id === input.target && item.revision === input.revision && item.operations.includes("review"));
      if (!hint) return fail("navigation_required", "Ouvrez le Studio concerné et attendez que sa confirmation actuelle soit disponible.");
      if (!matchesInrAssistantActionClause(options.currentUserMessage, input.instructionQuote, (current, quote) => isInrAssistantStudioDraftReviewRequest(current, input.target) && isInrAssistantStudioDraftReviewRequest(quote, input.target))) return fail("needs_instruction", "Demandez explicitement cette action sur le brouillon ou la tentative du Studio concerné.");
      if (options.canStartWork?.() === false) return fail("blocked", "La confirmation doit être reprise dans une nouvelle demande.");
      const auth = await requireUser();
      if (auth.errorResponse || auth.activeUserId !== options.accountId || auth.authUserId !== options.actorUserId || options.canStartWork?.() === false) return fail("blocked", "La session ou l’établissement actif a changé.");
      return { ok: true, status: "confirmation_required", confirmationRequired: true,
        uiCommand: { command: "control_local_interface", selection: { kind: "account_document", id: input.target }, revision: hint.revision, operation: "review", value: null },
        message: "Ouverture de la confirmation native du Studio demandée. L’action finale n’est pas exécutée par l’assistant. Vérifiez le brouillon ou la tentative affichée et choisissez personnellement dans le dialogue ; aucun arrêt, aucune suppression et aucun remboursement ne sont affirmés." };
    },
  }) };
}
