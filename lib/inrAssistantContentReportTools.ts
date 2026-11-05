import "server-only";
import { jsonSchema, tool } from "ai";
import { requireUser } from "./requireUser";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { isInrAssistantContentReportSubmitRequest, parseInrAssistantContentReportHint, type InrAssistantContentReportHint } from "./inrAssistantContentReport.ts";

type Input = { revision: string; instructionQuote: string };
export function createInrAssistantContentReportTools(options: { accountId: string; actorUserId: string; currentUserMessage: string; clientContext?: { contentReport?: InrAssistantContentReportHint } | null; canStartWork?: () => boolean }) {
  return { submitContentReport: tool({
    strict: true,
    description: "Envoyer le signalement de contenu déjà ouvert et préparé dans son formulaire natif, uniquement sur ordre actuel explicite d’envoyer ce signalement. Utiliser la révision exacte clientContext.contentReport. Ne fournit ni texte, ni URL, ni motif : le navigateur utilise exclusivement le brouillon visible et vérifie son résultat réel. Une tentative maximum par ouverture, aucun renvoi automatique en cas d’incertitude.",
    inputSchema: jsonSchema<Input>({ type: "object", properties: { revision: { type: "string", maxLength: 36, pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" }, instructionQuote: { type: "string", maxLength: 1200 } }, required: ["revision", "instructionQuote"], additionalProperties: false }),
    execute: async input => {
      const failure = (code: string, message: string) => ({ ok: false, status: "blocked", code, message });
      const hint = parseInrAssistantContentReportHint(options.clientContext?.contentReport);
      if (!hint || input.revision !== hint.revision) return failure("missing_or_stale_draft", "Ouvrez le signalement et vérifiez son contenu avant de demander son envoi.");
      if (!matchesInrAssistantActionClause(options.currentUserMessage, input.instructionQuote, (current, quote) => isInrAssistantContentReportSubmitRequest(current) && isInrAssistantContentReportSubmitRequest(quote))) return failure("needs_instruction", "Demandez explicitement l’envoi du signalement affiché.");
      if (options.canStartWork?.() === false) return failure("blocked", "L’envoi doit être repris dans une nouvelle demande.");
      const auth = await requireUser();
      if (auth.errorResponse || auth.activeUserId !== options.accountId || auth.authUserId !== options.actorUserId) return failure("account_changed", "L’établissement ou la session a changé.");
      if (options.canStartWork?.() === false) return failure("blocked", "La demande a changé pendant la vérification de la session.");
      return { ok: true, status: "ui_action_requested", uiCommand: { command: "submit_content_report" as const, selection: { kind: "account_document" as const, id: "content_report" as const }, revision: hint.revision }, message: "L’envoi du signalement affiché est demandé au formulaire natif. Le navigateur doit encore confirmer sa réception." };
    },
  }) };
}
