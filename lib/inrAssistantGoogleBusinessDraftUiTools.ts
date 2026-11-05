import "server-only";
import { jsonSchema, tool } from "ai";
import { requireUser } from "./requireUser";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { isInrAssistantGoogleBusinessDraftReviewRequest } from "./inrAssistantGoogleBusinessDraftReview.ts";
export { isInrAssistantGoogleBusinessDraftReviewRequest } from "./inrAssistantGoogleBusinessDraftReview.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";

export function createInrAssistantGoogleBusinessDraftUiTools(options: { accountId: string; actorUserId: string; currentUserMessage: string; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  return { prepareGoogleBusinessDraftReview: tool({ strict: true,
    description: "Ouvrir seulement la revue native des modifications DÉJÀ SAISIES dans la fiche Google Business ouverte. Utiliser google_profile_draft et sa révision de clientContext.interfaces. Le professionnel vérifie les valeurs et clique personnellement la confirmation finale. Aucun champ n’est fourni, aucun PATCH ou enregistrement n’est lancé par cet outil. Retour confirmation_required ; ne jamais dire enregistré pour une revue ouverte.",
    inputSchema: jsonSchema<{ revision: string; instructionQuote: string }>({ type: "object", additionalProperties: false, required: ["revision", "instructionQuote"], properties: { revision: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 } } }),
    execute: async input => {
      const fail = (status: string, message: string) => ({ ok: false, status, message });
      const hint = options.clientContext?.interfaces?.find(item => item.id === "google_profile_draft" && item.revision === input.revision && item.operations.includes("review"));
      if (!hint) return fail("navigation_required", "Ouvrez la fiche Google et attendez que ses modifications actuelles puissent être revues.");
      if (!matchesInrAssistantActionClause(options.currentUserMessage, input.instructionQuote, (current, quote) => isInrAssistantGoogleBusinessDraftReviewRequest(current) && isInrAssistantGoogleBusinessDraftReviewRequest(quote))) return fail("needs_instruction", "Demandez explicitement la revue des modifications saisies dans la fiche Google ouverte.");
      if (options.canStartWork?.() === false) return fail("blocked", "La revue doit être reprise dans une nouvelle demande.");
      const auth = await requireUser();
      if (auth.errorResponse || auth.activeUserId !== options.accountId || auth.authUserId !== options.actorUserId || options.canStartWork?.() === false) return fail("blocked", "La session ou l’établissement actif a changé.");
      return { ok: true, status: "confirmation_required", confirmationRequired: true,
        uiCommand: { command: "control_local_interface", selection: { kind: "account_document", id: "google_profile_draft" }, revision: hint.revision, operation: "review", value: null },
        message: "Ouverture de la revue native des modifications saisies demandée. Aucune modification n’est enregistrée par l’assistant. Vérifiez les valeurs dans le dialogue puis confirmez personnellement ; un enregistrement ne pourra être affirmé qu’après le résultat natif et sa relecture." };
    },
  }) };
}
