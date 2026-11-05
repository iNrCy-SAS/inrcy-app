import { prepareInrAssistantMediaUiAction } from "./inrAssistantMediaUiTools.ts";
import { prepareInrAssistantAdsUiAction } from "./inrAssistantAdsUiTools.ts";
import { INR_ASSISTANT_ADS_FIELDS } from "./inrAssistantAdsUiCommands.ts";
import { INR_ASSISTANT_MEDIA_UI_COMMANDS, type InrAssistantMediaUiCommandName } from "./inrAssistantMediaUiCommands.ts";
import "server-only";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./requireUser";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { resolveInrAssistantMailAttachments } from "./inrAssistantMailAttachments.ts";
import { INR_ASSISTANT_MAIL_LIFECYCLE, type InrAssistantMailLifecycleName } from "./inrAssistantMailLifecycle.ts";
import { parseInrAssistantUiCommand, isInrAssistantScreenCommandRequest, INR_ASSISTANT_ADS_STEPS, inrAssistantMailPatchRequested } from "./inrAssistantUiCommands.ts";
import { getInrAssistantNavigation, INR_ASSISTANT_NAVIGATION_DESTINATIONS, isInrAssistantNavigationRequest } from "./inrAssistantUiCommands.ts";
import { isDashboardDestinationAllowedForEdition, type DashboardEdition } from "./dashboardEdition.ts";
import { isInrAssistantScreenCommandAllowed } from "./inrAssistantScreenCommandPolicy.ts";

import { prepareInrAssistantStudioUiAction } from "./inrAssistantStudioUiTools.ts";
import { INR_ASSISTANT_STUDIO_UI_COMMANDS, type InrAssistantStudioUiCommandName } from "./inrAssistantStudioUiCommands.ts";
import { prepareInrAssistantStatsUiAction } from "./inrAssistantStatsUiTools.ts";
import { INR_ASSISTANT_STATS_UI_COMMANDS, INR_ASSISTANT_STATS_CHANNELS, type InrAssistantStatsUiCommandName } from "./inrAssistantStatsUiCommands.ts";

import { prepareInrAssistantBadgeUiAction } from "./inrAssistantBadgeUiTools.ts";

import { prepareInrAssistantWebsiteUiAction } from "./inrAssistantWebsiteUiTools.ts";
import { INR_ASSISTANT_WEBSITE_UI_COMMANDS, type InrAssistantWebsiteUiCommand } from "./inrAssistantWebsiteUiCommands.ts";

export function createInrAssistantUiTools(options: { accountId: string; edition: DashboardEdition; currentUserMessage: string; supabase?: Pick<SupabaseClient, "from">; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  // Request-local only. A requested document never changes the browser snapshot.
  let requestedDocument: { kind: "quote" | "invoice"; id: string } | undefined;
  const statsViewOnly = options.clientContext?.screen?.availableCommands?.length === 1 && options.clientContext.screen.availableCommands[0] === "configure_stats_view";
  return {
    navigateApplication: tool({
      strict: true,
      description: "Ouvrir l’écran iNrCy demandé sans clic sur un lien. Choisir une destination du catalogue. documentId null pour un module ; pour ouvrir un devis/facture précis, choisir quotes/invoices et son ID obtenu par readCommercialDocuments, vérifié dans le compte actif. Aucun envoi, réglage, paiement ou OAuth. Le navigateur protège les modifications non enregistrées. Ne pas annoncer l’écran ouvert avant son ouverture.",
      inputSchema: jsonSchema<{ destination: string; documentId?: string | null; instructionQuote: string }>({ type: "object", properties: {
        destination: { type: "string", enum: INR_ASSISTANT_NAVIGATION_DESTINATIONS.filter(destination => { const target = getInrAssistantNavigation(destination); return target && isDashboardDestinationAllowedForEdition(target.href, options.edition); }) },
        documentId: { type: ["string", "null"], format: "uuid" },
        instructionQuote: { type: "string", minLength: 1, maxLength: 1200 },
      }, required: ["destination", "documentId", "instructionQuote"], additionalProperties: false }),
      execute: async input => {
        const target = getInrAssistantNavigation(input.destination, input.documentId);
        if (!target || !isDashboardDestinationAllowedForEdition(target.href, options.edition) || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() ||
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
      description: "Exécuter une capacité déclarée du formulaire courant. configure_stats_view : patch.panel=\"evolution\" pour la vue Évolution, \"all\" pour l’ensemble ou un canal natif ; evolutionView=\"measured\" (mesures) ou \"index\" (indice), metric=\"visibility\" ou \"clicks\", channel=\"all\" ou un canal Stats. Mettre les réglages non demandés à null ; aucun changes ni paramètre de publication. configure_ads_draft : nom/texte/étape, adsChanges[{field,valueJson}] pour budget/dates/ciblage/textes/réglages du canal ; channel seul demande confirmation avant perte de saisie, mediaId seul (+metaSlot pour Meta) choisit un média possédé. Aucun ID fournisseur ni consentement. save_ads_draft sauvegarde et relit le brouillon sans diffusion ; configure_video_retouch : format/cadrage ; configure_mail_draft : recipient explicite, subject, bodyText, attachmentIds de searchMedia (5 médias du compte, total 10 Mo, PJ existantes conservées). configure_* ne sauvegarde, ne publie et n’envoie rien. save_mail_draft : sauvegarde exacte du composeur avec relecture ; send_mail_draft : confirmation native de son contenu/PJ puis acceptation fournisseur ou file, jamais livraison ; open_mail_schedule : ouvre le sélecteur, date à confirmer par le professionnel, aucun envoi programmé à ce stade. select_video_source : patch.mediaId réel ; save_video_retouch : sauvegarde une copie ; optimize_media : copie optimisée avec patch.targetBytes optionnel (5–75 Mo). Originaux conservés. prepare_document_mail : document courant finalisé, enregistré, propre, recipient explicite ; PDF joint au composeur, aucun envoi. patch/documentId/documentKind/recipient null hors usage. export_document_pdf : aperçu courant avec IDs null, ou document lu via readCommercialDocuments et IDs explicites ; ouvrir puis exporter sans sauvegarde/finalisation/envoi. Attendre l’acquittement de l’interface ; compte et révision revérifiés. Téléchargement transmis ne prouve pas fichier reçu.",
      inputSchema: jsonSchema<{ command: "export_document_pdf" | "configure_ads_draft" | "save_ads_draft" | "configure_video_retouch" | "configure_mail_draft" | "prepare_document_mail" | InrAssistantMediaUiCommandName | InrAssistantMailLifecycleName | InrAssistantStudioUiCommandName | InrAssistantStatsUiCommandName | "download_badge_qr" | InrAssistantWebsiteUiCommand["command"]; instructionQuote: string; documentId?: string | null; documentKind?: "quote" | "invoice" | null; recipient?: string | null; patch?: Record<string, unknown> | null }>({ type: "object", properties: {
        command: { type: "string", enum: statsViewOnly ? ["configure_stats_view"] : ["export_document_pdf", "configure_ads_draft", "save_ads_draft", "configure_video_retouch", "configure_mail_draft", "prepare_document_mail", ...INR_ASSISTANT_MEDIA_UI_COMMANDS, ...INR_ASSISTANT_MAIL_LIFECYCLE, ...INR_ASSISTANT_STUDIO_UI_COMMANDS, ...INR_ASSISTANT_STATS_UI_COMMANDS, "download_badge_qr", ...INR_ASSISTANT_WEBSITE_UI_COMMANDS].filter(command => isInrAssistantScreenCommandAllowed(options.edition, command)) }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 },
        recipient: statsViewOnly ? { type: "null" } : { type: ["string", "null"], maxLength: 254 },
        documentId: statsViewOnly ? { type: "null" } : { type: ["string", "null"], format: "uuid" }, documentKind: statsViewOnly ? { type: "null" } : { type: ["string", "null"], enum: ["quote", "invoice", null] },
        patch: statsViewOnly ? { type: ["object", "null"], properties: {
          panel: { type: ["string", "null"], enum: ["all", "evolution", ...INR_ASSISTANT_STATS_CHANNELS, null], description: "Vue demandée : evolution pour Évolution, all pour l’ensemble ou le canal natif. null conserve la vue." },
          evolutionView: { type: ["string", "null"], enum: ["measured", "index", null], description: "Mesures réelles ou indice de l’évolution ; null conserve le réglage." },
          metric: { type: ["string", "null"], enum: ["visibility", "clicks", null], description: "Visibilité ou clics ; null conserve le réglage." },
          channel: { type: ["string", "null"], enum: ["all", ...INR_ASSISTANT_STATS_CHANNELS, null], description: "Canal de l’évolution ; gmb correspond à Google Business. null conserve le filtre." },
        }, required: ["panel", "evolutionView", "metric", "channel"], additionalProperties: false } : { type: ["object", "null"], properties: {
          mediaId: { type: ["string", "null"], format: "uuid" }, targetBytes: { type: ["integer", "null"], minimum: 5000000, maximum: 75000000 },
          channel: { type: ["string", "null"], enum: ["meta", "google", "linkedin", "pinterest", "tiktok", "x", "openai", "all", ...INR_ASSISTANT_STATS_CHANNELS.filter(channel => !["linkedin", "pinterest", "tiktok", "x"].includes(channel)), null] }, metaSlot: { type: ["string", "null"], enum: ["feed", "story_reel", null] },
          adsChanges: options.clientContext?.screen?.availableCommands?.includes("configure_ads_draft") ? { type: ["array", "null"], minItems: 1, maxItems: 40, items: { type: "object", properties: { field: { type: "string", enum: [...INR_ASSISTANT_ADS_FIELDS] }, valueJson: { type: "string", maxLength: 4000, description: "Valeur JSON du seul champ demandé (nombre, booléen, chaîne entre guillemets, null ou liste de chaînes). Jamais les autres champs, les IDs fournisseur ou les consentements." } }, required: ["field", "valueJson"], additionalProperties: false } } : { type: "null" },
          changes: { type: ["array", "null"], minItems: 1, maxItems: 8, items: { type: "object", properties: { field: { type: "string", enum: ["fit", "zoom", "offsetX", "offsetY", "backgroundMode", "backgroundColor", "overlay", "search", "typeFilter", "activeFilter", "selectedMediaIds", "previewMediaId"] }, valueJson: { type: "string", maxLength: 18000 } }, required: ["field", "valueJson"], additionalProperties: false } },
          panel: { type: ["string", "null"], enum: ["all", "evolution", ...INR_ASSISTANT_STATS_CHANNELS, null] },
          evolutionView: { type: ["string", "null"], enum: ["measured", "index", null] }, metric: { type: ["string", "null"], enum: ["visibility", "clicks", null] },
          name: { type: ["string", "null"], maxLength: 100 }, primaryText: { type: ["string", "null"], maxLength: 800 },
          step: { type: ["string", "null"], enum: [...INR_ASSISTANT_ADS_STEPS, null] },
          format: { type: ["string", "null"], enum: ["original", "9_16", "1_1", "16_9", "png", "pdf", "html", "react_next", null] },
          adaptationMode: { type: ["string", "null"], enum: ["safe_frame", "cover_crop", null] },
          recipient: { type: ["string", "null"], maxLength: 254 }, subject: { type: ["string", "null"], maxLength: 220 }, bodyText: { type: ["string", "null"], maxLength: 6000 },
          attachmentIds: { type: ["array", "null"], maxItems: 5, minItems: 1, items: { type: "string", format: "uuid" }, uniqueItems: true },
        }, required: ["name", "primaryText", "step", "format", "adaptationMode", "recipient", "subject", "bodyText", "attachmentIds", "mediaId", "targetBytes", "channel", "metaSlot", "adsChanges", "changes", "panel", "evolutionView", "metric"], additionalProperties: false },
      }, required: ["command", "instructionQuote", "documentId", "documentKind", "recipient", "patch"], additionalProperties: false }),
      execute: async input => {
        if (!isInrAssistantScreenCommandAllowed(options.edition, input.command)) return { ok: false, status: "not_included", message: "Cette commande n’est pas incluse dans l’offre du compte. Aucun changement effectué." };
        const websiteAction = await prepareInrAssistantWebsiteUiAction(input, options); if (websiteAction) return websiteAction;
        const badgeAction = await prepareInrAssistantBadgeUiAction(input, options); if (badgeAction) return badgeAction;
        const studioAction = await prepareInrAssistantStudioUiAction(input, options); if (studioAction) return studioAction;
        const statsAction = await prepareInrAssistantStatsUiAction(input, options); if (statsAction) return statsAction;
        const adsAction = await prepareInrAssistantAdsUiAction(input, { ...options, isRequest: isInrAssistantScreenCommandRequest });
        if (adsAction) return adsAction;
        const mediaAction = await prepareInrAssistantMediaUiAction(input, { ...options, isRequest: isInrAssistantScreenCommandRequest });
        if (mediaAction) return mediaAction;
        const screen = options.clientContext?.screen;
        if (INR_ASSISTANT_MAIL_LIFECYCLE.includes(input.command as InrAssistantMailLifecycleName)) {
          if (input.patch || input.documentId || input.documentKind || input.recipient || options.canStartWork?.() === false || !input.instructionQuote?.trim()
            || !options.currentUserMessage.includes(input.instructionQuote) || !isInrAssistantScreenCommandRequest(options.currentUserMessage, input.command as InrAssistantMailLifecycleName)
            || !isInrAssistantScreenCommandRequest(input.instructionQuote, input.command as InrAssistantMailLifecycleName)) return { ok: false, status: "needs_instruction", message: "Demandez explicitement l’action sur le composeur affiché. Aucun envoi ou enregistrement effectué." };
          const command = parseInrAssistantUiCommand({ command: input.command, selection: screen?.selection, revision: screen?.revision });
          if (!command || screen?.pathname !== "/dashboard/mails" || !screen.availableCommands?.includes(input.command as InrAssistantMailLifecycleName)) return { ok: false, status: "needs_details", message: "Ouvrez le composeur exact et vérifiez son contenu." };
          const auth = await requireUser();
          if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "Le compte actif a changé." };
          return { ok: true, status: "ui_action_requested", uiCommand: command, message: input.command === "save_mail_draft" ? "Enregistrement du composeur demandé ; attendre sa relecture native." : input.command === "send_mail_draft" ? "Confirmation native d’envoi demandée pour ce composeur exact et ses pièces jointes. Seule l’acceptation du fournisseur pourra être attestée, jamais la livraison." : "Ouverture du sélecteur natif de programmation demandée. Le professionnel doit encore choisir et confirmer la date ; aucun envoi programmé à ce stade." };
        }
        if (input.command === "prepare_document_mail") {
          if (input.patch) return { ok: false, status: "needs_details", message: "La préparation d’un PDF en pièce jointe ne modifie pas le document." };
          const { requestInrAssistantDocumentMail } = await import("./inrAssistantDocumentMailTools");
          return requestInrAssistantDocumentMail(options, input);
        }
        if (input.command === "configure_ads_draft" || input.command === "configure_video_retouch" || input.command === "configure_mail_draft") {
          let patch = input.patch;
          if (input.command === "configure_mail_draft" && patch) {
            if (Object.hasOwn(patch, "attachments")) return { ok: false, status: "blocked", message: "Les pièces jointes doivent être identifiées dans Mes médias." };
            const { attachmentIds, ...fields } = patch;
            patch = fields;
            if (attachmentIds !== null && attachmentIds !== undefined) {
              const auth = await requireUser();
              if (auth.errorResponse || auth.activeUserId !== options.accountId || !options.supabase) return { ok: false, status: "blocked", message: "Le compte actif doit être vérifié." };
              const attachments = await resolveInrAssistantMailAttachments(options.supabase, options.accountId, attachmentIds);
              if (!attachments) return { ok: false, status: "needs_details", message: "Choisissez au plus cinq médias actifs du compte, dans la limite totale de 10 Mo. Aucune pièce jointe ajoutée." };
              patch = { ...fields, attachments };
            }
          }
          const command = parseInrAssistantUiCommand({ command: input.command, selection: screen?.selection, revision: screen?.revision, patch });
          const expectedPath = input.command === "configure_ads_draft" ? "/dashboard/ads" : input.command === "configure_mail_draft" ? "/dashboard/mails" : "/dashboard/generer-media";
          if (!command || command.command !== input.command || input.documentId || input.documentKind || screen?.pathname !== expectedPath || !screen.availableCommands?.includes(input.command)) return { ok: false, status: "needs_details", message: "Ouvrez le formulaire ou la vidéo à modifier et précisez les réglages. Aucun changement n’a été appliqué." };
          if (options.canStartWork?.() === false || !input.instructionQuote?.trim() || !options.currentUserMessage.includes(input.instructionQuote)
            || !isInrAssistantScreenCommandRequest(input.instructionQuote, input.command) || !isInrAssistantScreenCommandRequest(options.currentUserMessage, input.command)) return { ok: false, status: "needs_instruction", message: "Demandez explicitement les changements du formulaire ouvert. Aucun changement n’a été appliqué." };
          if (command.command === "configure_mail_draft" && !inrAssistantMailPatchRequested(input.instructionQuote, command.patch)) return { ok: false, status: "needs_details", message: "Précisez les champs à modifier et l’adresse exacte si le destinataire doit changer. Aucun message envoyé." };
          const auth = await requireUser();
          if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "Le compte actif doit être vérifié." };
          return { ok: true, status: "ui_action_requested", uiCommand: command, message: "Application des réglages demandée au formulaire ouvert. Le navigateur vérifiera sa révision avant modification ; aucune sauvegarde ou publication n’est lancée." };
        }
        const explicitTarget = input.documentId ? { kind: input.documentKind, id: input.documentId } : undefined;
        const target = explicitTarget ?? requestedDocument ?? screen?.selection;
        const command = parseInrAssistantUiCommand({ command: input.command, selection: target });
        const currentTarget = command?.command === "export_document_pdf" && command.selection.kind === screen?.selection?.kind && command.selection.id === screen.selection.id;
        if (!command || command.command !== "export_document_pdf" || options.canStartWork?.() === false ||
          !input.instructionQuote?.trim() || !options.currentUserMessage.includes(input.instructionQuote) ||
          !isInrAssistantScreenCommandRequest(input.instructionQuote, "export_document_pdf") || !isInrAssistantScreenCommandRequest(options.currentUserMessage, "export_document_pdf")) {
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
        if (currentTarget && screen?.revision) command.revision = screen.revision;
        return { ok: true, status: "ui_action_requested", uiCommand: command, ...(navigation ? { navigation } : {}), message: navigation ? "L’ouverture du document exact puis son export PDF ont été demandés au navigateur. Le document n’est ni finalisé ni envoyé." : "La génération du PDF de l’aperçu ouvert a été demandée au navigateur. Le document n’est ni finalisé ni envoyé." };
      },
    }),
  };
}
