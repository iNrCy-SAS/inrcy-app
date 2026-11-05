import "server-only";
import { jsonSchema, tool } from "ai";
import { requireUser } from "./requireUser";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { INR_ASSISTANT_BUSINESS_RICH_TEXT_FIELDS, INR_ASSISTANT_BUSINESS_RICH_TEXT_FORMATS, INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES, isInrAssistantBusinessRichTextRequest, parseInrAssistantBusinessRichTextEdit, type InrAssistantBusinessRichTextField, type InrAssistantBusinessRichTextFormat } from "./inrAssistantBusinessRichText.ts";
type Input = { field: InrAssistantBusinessRichTextField; format: InrAssistantBusinessRichTextFormat; selectionText: string | null; wholeField: boolean; revision: string; instructionQuote: string };
export function createInrAssistantBusinessRichTextUiTools(options: { accountId: string; actorUserId: string; currentUserMessage: string; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  return { formatBusinessDnaText: tool({ strict: true,
    description: "Mettre en forme un champ ADN réellement affiché : gras, italique, titre, liste à puces ou retrait natif du format. field dans les8 champs natifs ; selectionText est un passage exact fourni par le professionnel, unique dans le champ ; wholeField=true et selectionText=null seulement si tout le champ est explicitement demandé. Révision du hint correspondant dna_text_*. Aucun HTML, texte inventé ou sélecteur. Format déjà présent conservé, contenu et autres champs intacts. Le navigateur vérifie le rendu ; autosauvegarde native distincte, jamais annoncée avant relecture.",
    inputSchema: jsonSchema<Input>({ type: "object", additionalProperties: false, required: ["field", "format", "selectionText", "wholeField", "revision", "instructionQuote"], properties: { field: { type: "string", enum: INR_ASSISTANT_BUSINESS_RICH_TEXT_FIELDS }, format: { type: "string", enum: [...INR_ASSISTANT_BUSINESS_RICH_TEXT_FORMATS] }, selectionText: { type: ["string", "null"], maxLength: 5000 }, wholeField: { type: "boolean" }, revision: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" }, instructionQuote: { type: "string", minLength: 1, maxLength: 6200 } } }),
    execute: async input => {
      const fail = (status: string, message: string) => ({ ok: false, status, message }), edit = parseInrAssistantBusinessRichTextEdit({ format: input.format, selectionText: input.selectionText, wholeField: input.wholeField });
      if (!edit || !INR_ASSISTANT_BUSINESS_RICH_TEXT_FIELDS.includes(input.field) || !matchesInrAssistantActionClause(options.currentUserMessage, input.instructionQuote, (current, quote) => isInrAssistantBusinessRichTextRequest(current, input.field, edit) && isInrAssistantBusinessRichTextRequest(quote, input.field, edit))) return fail("needs_instruction", "Nommez le champ ADN, le format et le passage exact, ou demandez explicitement tout le champ.");
      const id = INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES[input.field], hint = options.clientContext?.interfaces?.find(hint => hint.id === id && hint.revision === input.revision && hint.operations.includes("select"));
      if (!hint) return fail("navigation_required", "Affichez le champ ADN exact et attendez son chargement avant de demander sa mise en forme.");
      if (options.canStartWork?.() === false) return fail("blocked", "La mise en forme doit être reprise dans une nouvelle demande.");
      const auth = await requireUser(); if (auth.errorResponse || auth.activeUserId !== options.accountId || auth.authUserId !== options.actorUserId || options.canStartWork?.() === false) return fail("blocked", "La session ou l’établissement actif a changé.");
      return { ok: true, status: "ui_action_requested", uiCommand: { command: "control_local_interface", selection: { kind: "account_document", id }, revision: hint.revision, operation: "select", value: JSON.stringify(edit) }, message: "Mise en forme transmise au seul champ ADN affiché. Le navigateur doit confirmer son rendu natif. L’autosauvegarde existante reste distincte ; aucune persistance n’est présumée." };
    },
  }) };
}
