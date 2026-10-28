import "server-only";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./requireUser";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { parseInrAssistantUiCommand, isInrAssistantScreenCommandRequest } from "./inrAssistantUiCommands.ts";
import { getInrAssistantNavigation, INR_ASSISTANT_NAVIGATION_DESTINATIONS, isInrAssistantNavigationRequest } from "./inrAssistantUiCommands.ts";

export function createInrAssistantUiTools(options: { accountId: string; currentUserMessage: string; supabase?: Pick<SupabaseClient, "from">; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  return {
    navigateApplication: tool({
      strict: true,
      description: "Ouvrir l’écran iNrCy demandé sans clic sur un lien. Choisir une destination du catalogue. documentId null pour un module ; pour ouvrir un devis/facture précis, choisir quotes/invoices et son ID obtenu par readCommercialDocuments, vérifié dans le compte actif. Aucun envoi, réglage, paiement ou OAuth. Le navigateur protège les modifications non enregistrées. Ne pas annoncer l’écran ouvert avant son ouverture.",
      inputSchema: jsonSchema<{ destination: string; documentId?: string | null; instructionQuote: string }>({ type: "object", properties: {
        destination: { type: "string", enum: INR_ASSISTANT_NAVIGATION_DESTINATIONS },
        documentId: { type: ["string", "null"], format: "uuid" },
        instructionQuote: { type: "string", minLength: 1, maxLength: 1200 },
      }, required: ["destination", "documentId", "instructionQuote"], additionalProperties: false }),
      execute: async input => {
        const target = getInrAssistantNavigation(input.destination, input.documentId);
        if (!target || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() ||
          !options.currentUserMessage.includes(input.instructionQuote) || !isInrAssistantNavigationRequest(input.instructionQuote) ||
          !isInrAssistantNavigationRequest(options.currentUserMessage) || options.canStartWork?.() === false) {
          return { ok: false, status: "needs_instruction", message: "Indiquez l’écran que vous souhaitez ouvrir. Aucune navigation n’a été lancée." };
        }
        const auth = await requireUser();
        if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "Le compte actif doit être vérifié avant la navigation." };
        if (target.documentId) {
          if (!options.supabase) return { ok: false, status: "unavailable", message: "Le document doit être vérifié avant son ouverture." };
          const kind = target.destination === "quotes" ? "devis" : "facture";
          const { data, error } = await options.supabase.from("doc_saves").select("id,user_id,type").eq("user_id", options.accountId).eq("type", kind).eq("id", target.documentId).maybeSingle();
          if (error || !data || data.user_id !== options.accountId || data.id !== target.documentId || data.type !== kind) return { ok: false, status: "not_found", message: "Ce document n’est pas accessible dans l’établissement actif." };
        }
        return { ok: true, status: "navigation_requested", navigation: target, nextAction: { href: target.href, label: target.label }, message: `Ouverture de ${target.label} demandée. Les modifications non enregistrées restent protégées.` };
      },
    }),
    runScreenCommand: tool({
      strict: true,
      description: "Générer et télécharger le PDF du devis ou de la facture actuellement ouvert dans l’application, avec son rendu natif. Uniquement si le contexte écran propose export_document_pdf et une sélection. Ne finalise ni ne sauvegarde ni n’envoie le document. Ne pas annoncer le téléchargement terminé avant son exécution dans le navigateur. Pour un autre document, il faut d’abord l’ouvrir.",
      inputSchema: jsonSchema<{ command: "export_document_pdf"; instructionQuote: string }>({ type: "object", properties: {
        command: { type: "string", enum: ["export_document_pdf"] }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 },
      }, required: ["command", "instructionQuote"], additionalProperties: false }),
      execute: async input => {
        const screen = options.clientContext?.screen;
        const command = parseInrAssistantUiCommand({ command: input.command, selection: screen?.selection });
        if (!command || !screen?.availableCommands?.includes(command.command) || options.canStartWork?.() === false ||
          !input.instructionQuote?.trim() || !options.currentUserMessage.includes(input.instructionQuote) ||
          !isInrAssistantScreenCommandRequest(input.instructionQuote) || !isInrAssistantScreenCommandRequest(options.currentUserMessage)) {
          return { ok: false, status: "needs_instruction", message: "Ouvrez le devis ou la facture puis demandez le téléchargement de son PDF. Aucun document n’a été modifié." };
        }
        const auth = await requireUser();
        if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "Le compte actif doit être vérifié." };
        return { ok: true, status: "ui_action_requested", uiCommand: command, message: "La génération du PDF de l’aperçu ouvert a été demandée au navigateur. Le document n’est ni finalisé ni envoyé." };
      },
    }),
  };
}
