import "server-only";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./requireUser";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { parseInrAssistantUiCommand, isInrAssistantScreenCommandRequest } from "./inrAssistantUiCommands.ts";
import { getInrAssistantNavigation, INR_ASSISTANT_NAVIGATION_DESTINATIONS, isInrAssistantNavigationRequest } from "./inrAssistantUiCommands.ts";

export function createInrAssistantUiTools(options: { accountId: string; currentUserMessage: string; supabase?: Pick<SupabaseClient, "from">; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  // Request-local only. A requested document never changes the browser snapshot.
  let requestedDocument: { kind: "quote" | "invoice"; id: string } | undefined;
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
        if (target.documentId) requestedDocument = { kind: target.destination === "quotes" ? "quote" : "invoice", id: target.documentId };
        return { ok: true, status: "navigation_requested", navigation: target, nextAction: { href: target.href, label: target.label }, message: `Ouverture de ${target.label} demandée. Les modifications non enregistrées restent protégées.` };
      },
    }),
    runScreenCommand: tool({
      strict: true,
      description: "Télécharger le PDF natif. Pour l’aperçu actuellement ouvert, documentId/documentKind null ; il doit déclarer export_document_pdf. Pour un document nommé ou un autre document, lire son ID réel avec readCommercialDocuments puis fournir documentId et documentKind. Le navigateur ouvre cette cible vérifiée, attend son montage, puis exporte ce document exact ; toute navigation refusée arrête l’export. Ne finalise, ne sauvegarde et n’envoie rien. Un téléchargement lancé n’est pas la preuve d’un fichier reçu.",
      inputSchema: jsonSchema<{ command: "export_document_pdf"; instructionQuote: string; documentId?: string | null; documentKind?: "quote" | "invoice" | null }>({ type: "object", properties: {
        command: { type: "string", enum: ["export_document_pdf"] }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 },
        documentId: { type: ["string", "null"], format: "uuid" }, documentKind: { type: ["string", "null"], enum: ["quote", "invoice", null] },
      }, required: ["command", "instructionQuote", "documentId", "documentKind"], additionalProperties: false }),
      execute: async input => {
        const screen = options.clientContext?.screen;
        const explicitTarget = input.documentId ? { kind: input.documentKind, id: input.documentId } : undefined;
        const target = explicitTarget ?? requestedDocument ?? screen?.selection;
        const command = parseInrAssistantUiCommand({ command: input.command, selection: target });
        const currentTarget = command?.command === "export_document_pdf" && command.selection.kind === screen?.selection?.kind && command.selection.id === screen.selection.id;
        if (!command || command.command !== "export_document_pdf" || options.canStartWork?.() === false ||
          !input.instructionQuote?.trim() || !options.currentUserMessage.includes(input.instructionQuote) ||
          !isInrAssistantScreenCommandRequest(input.instructionQuote) || !isInrAssistantScreenCommandRequest(options.currentUserMessage)) {
          return { ok: false, status: "needs_instruction", message: "Ouvrez le devis ou la facture puis demandez le téléchargement de son PDF. Aucun document n’a été modifié." };
        }
        // A compound/named request must never silently fall back to the old open document.
        const text = options.currentUserMessage.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
        const refersToCurrent = /\b(?:ce|cet|cette|this|current)\s+(?:devis|facture|document|quote|invoice)|\b(?:apercu|preview|actuellement|ouvert)\b/.test(text);
        const namesDocument = /\b(?:devis|facture|quote|invoice)\s+(?!(?:ouvert|actuel|en cours|que je vois)\b)[a-z0-9]/.test(text);
        if (!explicitTarget && !requestedDocument && !refersToCurrent && (namesDocument || isInrAssistantNavigationRequest(options.currentUserMessage))) {
          return { ok: false, status: "needs_details", message: "Identifiez d’abord le document demandé pour exporter son PDF exact. Le document actuellement ouvert n’a pas été exporté." };
        }
        const auth = await requireUser();
        if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "Le compte actif doit être vérifié." };
        let navigation;
        if (explicitTarget || requestedDocument) {
          const targetNavigation = getInrAssistantNavigation(command.selection.kind === "quote" ? "quotes" : "invoices", command.selection.id);
          if (!targetNavigation || !options.supabase) return { ok: false, status: "not_found", message: "Le document demandé doit être vérifié dans le compte actif." };
          const kind = command.selection.kind === "quote" ? "devis" : "facture";
          const { data, error } = await options.supabase.from("doc_saves").select("id,user_id,type").eq("user_id", options.accountId).eq("type", kind).eq("id", command.selection.id).maybeSingle();
          if (error || !data || data.user_id !== options.accountId || data.id !== command.selection.id || data.type !== kind) return { ok: false, status: "not_found", message: "Ce document n’est pas accessible dans l’établissement actif." };
          if (!currentTarget) navigation = targetNavigation;
        }
        if (currentTarget && !screen?.availableCommands?.includes(command.command)) return { ok: false, status: "needs_details", message: "Le PDF de cet aperçu n’est pas disponible. Ouvrez le document puis réessayez." };
        return { ok: true, status: "ui_action_requested", uiCommand: command, ...(navigation ? { navigation } : {}), message: navigation ? "L’ouverture du document exact puis son export PDF ont été demandés au navigateur. Le document n’est ni finalisé ni envoyé." : "La génération du PDF de l’aperçu ouvert a été demandée au navigateur. Le document n’est ni finalisé ni envoyé." };
      },
    }),
  };
}
