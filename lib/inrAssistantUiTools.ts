import { prepareInrAssistantMediaUiAction } from "./inrAssistantMediaUiTools.ts";
import { prepareInrAssistantAdsUiAction } from "./inrAssistantAdsUiTools.ts";
import { INR_ASSISTANT_ADS_FIELDS } from "./inrAssistantAdsUiCommands.ts";
import { type InrAssistantMediaUiCommandName } from "./inrAssistantMediaUiCommands.ts";
import "server-only";
import { INR_ASSISTANT_BUSINESS_FORM_TABS } from "./inrAssistantBusinessFormUiCommands.ts";
import { prepareInrAssistantBusinessFormUiAction } from "./inrAssistantBusinessFormUiTools.ts";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
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
import { type InrAssistantStudioUiCommandName } from "./inrAssistantStudioUiCommands.ts";
import { prepareInrAssistantStatsUiAction } from "./inrAssistantStatsUiTools.ts";
import { INR_ASSISTANT_STATS_CHANNELS, INR_ASSISTANT_STATS_INDEX_RANGES, type InrAssistantStatsUiCommandName } from "./inrAssistantStatsUiCommands.ts";

import { prepareInrAssistantBadgeUiAction } from "./inrAssistantBadgeUiTools.ts";

import { prepareInrAssistantWebsiteUiAction } from "./inrAssistantWebsiteUiTools.ts";
import { INR_ASSISTANT_WEBSITE_UI_COMMANDS, type InrAssistantWebsiteUiCommand } from "./inrAssistantWebsiteUiCommands.ts";

const SCREEN_COMMAND_FIELDS: Readonly<Record<string, readonly string[]>> = {
  configure_business_form: ["businessFormAction", "businessFormTab"],
  configure_stats_view: ["panel", "evolutionView", "metric", "channel", "indexRangeMonths"],
  configure_media_library: ["changes"], configure_image_retouch: ["changes"],
  select_image_source: ["mediaId"], reset_image_retouch: [], save_image_retouch: [],
  configure_video_retouch: ["format", "adaptationMode"], select_video_source: ["mediaId"], save_video_retouch: [],
  optimize_media: ["mediaId", "targetBytes"],
  configure_ads_draft: ["name", "primaryText", "step", "channel", "mediaId", "metaSlot", "adsChanges"], save_ads_draft: [],
  configure_mail_draft: ["recipient", "subject", "bodyText", "attachmentIds"],
  save_mail_draft: [], send_mail_draft: [], open_mail_schedule: [],
  prepare_document_mail: [], export_document_pdf: [], download_badge_qr: ["format"],
  generate_website_widget_code: ["format"], show_website_widget_code: ["format"], copy_website_widget_code: ["format"],
};
const SCREEN_COMMAND_HELP: Readonly<Record<string, string>> = {
  configure_business_form: "configure_business_form : patch.businessFormAction reset/discard/select_tab/open_persistent_reset ; businessFormTab pour l’onglet. La remise à zéro définitive ouvre seulement la confirmation personnelle.",
  configure_stats_view: 'configure_stats_view : patch.panel="evolution" pour Évolution, "all" pour Globale ; evolutionView measured/index, metric visibility/clicks, channel et indexRangeMonths natifs. Réglages non demandés à null.',
  configure_media_library: 'configure_media_library : patch est un OBJET contenant seulement changes[{field,valueJson}]. field=typeFilter et valueJson=\'"image"\' affiche les images ; search utilise le terme encodé comme chaîne JSON. typeFilter : all/image/video/audio ; activeFilter : active/inactive/all. Ne pas utiliser patch.type ni encoder patch comme texte.',
  configure_image_retouch: 'configure_image_retouch : patch est un OBJET contenant seulement changes[{field,valueJson}], jamais un texte JSON. Exemple fond blanc et zoom110% : {"changes":[{"field":"backgroundMode","valueJson":"\\"white\\""},{"field":"zoom","valueJson":"1.1"}]}. zoom est un facteur0.4–3 (110%=1.1, pas110) ; backgroundMode=white utilise le fond blanc natif ; backgroundColor est une couleur hexadécimale #RRGGBB pour le mode color. Autres réglages : fit=contain/cover, offsetX/offsetY=-100à100, overlay. Inclure uniquement les champs demandés ; conserver documentId/documentKind/recipient à null.',
  select_image_source: "select_image_source : patch.mediaId réel obtenu dans Mes médias.",
  reset_image_retouch: "reset_image_retouch : patch null ; réinitialisation locale, sans sauvegarde.",
  save_image_retouch: "save_image_retouch : patch null ; sauvegarde native d’une copie, original conservé.",
  configure_video_retouch: "configure_video_retouch : patch.format original/9_16/1_1/16_9, adaptationMode safe_frame/cover_crop ; aperçu local, sauvegarde distincte.",
  select_video_source: "select_video_source : patch.mediaId réel obtenu dans Mes médias.",
  save_video_retouch: "save_video_retouch : patch null ; sauvegarde native d’une copie.",
  optimize_media: "optimize_media : patch.mediaId possédé et targetBytes optionnel de 5 à 75 Mo ; copie distincte.",
  configure_ads_draft: "configure_ads_draft : nom/texte/étape, adsChanges[{field,valueJson}] pour réglages explicitement demandés ; mediaId possédé (+metaSlot pour Meta). Aucun ID fournisseur ou consentement inventé ; pas de diffusion.",
  save_ads_draft: "save_ads_draft : patch null ; sauvegarde et relecture, aucune diffusion.",
  configure_mail_draft: "configure_mail_draft : patch.recipient explicite, subject, bodyText, attachmentIds issus de Mes médias (5 médias, 10 Mo). Pièces jointes existantes conservées ; aucun envoi.",
  save_mail_draft: "save_mail_draft : patch null ; sauvegarde exacte et relecture.",
  send_mail_draft: "send_mail_draft : patch null ; ouvre la confirmation personnelle du contenu exact et de ses pièces jointes, jamais une preuve de livraison.",
  open_mail_schedule: "open_mail_schedule : patch null ; ouvre le sélecteur natif, date à confirmer personnellement.",
  prepare_document_mail: "prepare_document_mail : recipient explicite, patch null ; document finalisé, enregistré et propre, PDF joint au composeur sans envoi.",
  export_document_pdf: "export_document_pdf : patch null ; aperçu courant avec IDs null, ou devis/facture lu et identifié par documentId/documentKind. Aucun enregistrement, finalisation ou envoi.",
  download_badge_qr: "download_badge_qr : patch.format png/pdf, téléchargement du QR affiché.",
  generate_website_widget_code: "generate_website_widget_code : patch.format html/react_next ou null ; génération native du code, sans installation externe.",
  show_website_widget_code: "show_website_widget_code : patch.format html/react_next ou null ; affichage du code déjà généré.",
  copy_website_widget_code: "copy_website_widget_code : patch.format html/react_next ou null ; copie du code natif.",
};

function matchesScreenInputSchema(value: unknown, schema: JSONSchema7): boolean {
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
  if (types.length && !types.some(type => type === kind || type === "number" && kind === "integer")) return false;
  if (typeof value === "string") return !(schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength
    || schema.format === "uuid" && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value));
  if (typeof value === "number") return Number.isFinite(value) && !(schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum);
  if (Array.isArray(value)) return !(schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems || schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length)
    && value.every(item => typeof schema.items === "object" && !Array.isArray(schema.items) ? matchesScreenInputSchema(item, schema.items) : true);
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>, properties = schema.properties ?? {};
    return !(schema.required?.some(key => !Object.hasOwn(row, key)) || schema.additionalProperties === false && Object.keys(row).some(key => !Object.hasOwn(properties, key)))
      && Object.entries(row).every(([key, item]) => typeof properties[key] === "object" ? matchesScreenInputSchema(item, properties[key] as JSONSchema7) : true);
  }
  return true;
}

/** Schema selection reduces ambiguity; native executors still authorize every effect. */
function screenCommandContract(options: { edition: DashboardEdition; clientContext?: InrAssistantClientContext | null }) {
  const all = Object.keys(SCREEN_COMMAND_FIELDS).filter(command => isInrAssistantScreenCommandAllowed(options.edition, command));
  const mounted = options.clientContext?.screen?.availableCommands?.filter(command => all.includes(command)) ?? [];
  // A named, server-verified document can be opened and exported in one request.
  // All other commands are narrowed when the mounted screen advertises them.
  const commands = mounted.length ? mounted : all;
  const fields = [...new Set(commands.flatMap(command => SCREEN_COMMAND_FIELDS[command]))];
  const canTargetDocument = commands.includes("export_document_pdf"), canAddressMail = commands.includes("prepare_document_mail");
  const nullableString = (maxLength: number): JSONSchema7 => ({ type: ["string", "null"], maxLength });
  const nullableEnum = (values: readonly (string | number)[]): JSONSchema7 => ({ type: [values.every(value => typeof value === "number") ? "integer" : "string", "null"], enum: [...values, null] });
  const libraryChanges = commands.includes("configure_media_library"), imageChanges = commands.includes("configure_image_retouch");
  const changeFields = [...(libraryChanges ? ["search", "typeFilter", "activeFilter", "selectedMediaIds", "previewMediaId"] : []), ...(imageChanges ? ["fit", "zoom", "offsetX", "offsetY", "backgroundMode", "backgroundColor", "overlay"] : [])];
  const formats = [...new Set([
    ...(commands.includes("configure_video_retouch") ? ["original", "9_16", "1_1", "16_9"] : []),
    ...(commands.includes("download_badge_qr") ? ["png", "pdf"] : []),
    ...(commands.some(command => INR_ASSISTANT_WEBSITE_UI_COMMANDS.includes(command as never)) ? ["html", "react_next"] : []),
  ])];
  const properties: Record<string, JSONSchema7> = {
    businessFormAction: nullableEnum(["reset", "discard", "select_tab", "open_persistent_reset"]), businessFormTab: nullableEnum(INR_ASSISTANT_BUSINESS_FORM_TABS),
    name: nullableString(100), primaryText: nullableString(800), step: nullableEnum(INR_ASSISTANT_ADS_STEPS),
    mediaId: { type: ["string", "null"], format: "uuid" }, targetBytes: { type: ["integer", "null"], minimum: 5000000, maximum: 75000000 },
    channel: nullableEnum(commands.includes("configure_ads_draft") ? ["meta", "google", "linkedin", "pinterest", "tiktok", "x", "openai", "all", ...INR_ASSISTANT_STATS_CHANNELS.filter(channel => !["linkedin", "pinterest", "tiktok", "x"].includes(channel))] : ["all", ...INR_ASSISTANT_STATS_CHANNELS]),
    metaSlot: nullableEnum(["feed", "story_reel"]),
    format: nullableEnum(formats), adaptationMode: nullableEnum(["safe_frame", "cover_crop"]),
    recipient: nullableString(254), subject: nullableString(220), bodyText: nullableString(6000),
    attachmentIds: { type: ["array", "null"], maxItems: 5, minItems: 1, items: { type: "string", format: "uuid" }, uniqueItems: true },
    adsChanges: { type: ["array", "null"], minItems: 1, maxItems: 40, items: { type: "object", properties: { field: { type: "string", enum: [...INR_ASSISTANT_ADS_FIELDS] }, valueJson: { type: "string", maxLength: 4000, description: "Valeur JSON du seul champ demandé." } }, required: ["field", "valueJson"], additionalProperties: false } },
    changes: { type: ["array", "null"], minItems: 1, maxItems: 8, items: { type: "object", properties: { field: { type: "string", enum: changeFields }, valueJson: { type: "string", maxLength: 18000, description: 'Valeur JSON valide ; pour les images : "image" avec les guillemets JSON.' } }, required: ["field", "valueJson"], additionalProperties: false } },
    panel: nullableEnum(["all", "evolution", ...INR_ASSISTANT_STATS_CHANNELS]), evolutionView: nullableEnum(["measured", "index"]), metric: nullableEnum(["visibility", "clicks"]), indexRangeMonths: nullableEnum(INR_ASSISTANT_STATS_INDEX_RANGES),
  };
  const schema: JSONSchema7 = { type: "object", properties: {
    command: { type: "string", enum: commands }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200, description: "Extrait exact contenant seulement le verbe et l’objet de cette étape, sans proposition introductive ni autre étape." },
    documentId: canTargetDocument ? { type: ["string", "null"], format: "uuid" } : { type: "null" },
    documentKind: canTargetDocument ? nullableEnum(["quote", "invoice"]) : { type: "null" }, recipient: canAddressMail ? nullableString(254) : { type: "null" },
    patch: fields.length ? { type: ["object", "null"], properties: Object.fromEntries(fields.map(field => [field, properties[field]])), required: fields, additionalProperties: false } : { type: "null" },
  }, required: ["command", "instructionQuote", "documentId", "documentKind", "recipient", "patch"], additionalProperties: false };
  return { schema, description: "Appliquer seulement les capacités déclarées de l’écran courant. " + commands.map(command => SCREEN_COMMAND_HELP[command]).join(" ")
    + " Les champs facultatifs non fournis valent null. Citer le verbe et son objet de l’étape, pas une introduction. Attendre l’accusé du navigateur avant d’annoncer le résultat ; compte, droits et révision sont revérifiés.",
    validate(value: unknown) {
      let valid = matchesScreenInputSchema(value, schema);
      const input = value as { command?: string; patch?: Record<string, unknown> | null; documentId?: unknown; documentKind?: unknown; recipient?: unknown } | null;
      if (valid && input) {
        const fields = SCREEN_COMMAND_FIELDS[input.command!] ?? [];
        valid = Object.entries(input.patch ?? {}).every(([key, item]) => item === null || fields.includes(key));
        if (input.command !== "export_document_pdf" && (input.documentId !== null || input.documentKind !== null) || input.command !== "prepare_document_mail" && input.recipient !== null) valid = false;
        for (const name of ["changes", "adsChanges"]) if (Array.isArray(input.patch?.[name])) {
          const changes = input.patch[name] as {field:string;valueJson:string}[];
          if (new Set(changes.map(change => change.field)).size !== changes.length) valid = false;
          for (const change of changes) { try { JSON.parse(change.valueJson); } catch { valid = false; } }
        }
        if (valid && ["configure_media_library", "configure_image_retouch"].includes(input.command!)) {
          if (!Array.isArray(input.patch?.changes)) valid = false;
          else {
            const patch = Object.fromEntries(input.patch.changes.map(change => [(change as {field:string}).field, JSON.parse((change as {valueJson:string}).valueJson)]));
            const screen = options.clientContext?.screen;
            valid = Boolean(parseInrAssistantUiCommand({command:input.command,selection:screen?.selection,revision:screen?.revision,patch}));
          }
        }
      }
      return valid ? { success: true as const, value: value as never } : { success: false as const, error: new Error("Paramètres de commande invalides : utiliser un objet patch natif, les seules clés de l’étape, des valeurs JSON valides et null pour les champs non utilisés.") };
    },
  };
}

export function createInrAssistantUiTools(options: { accountId: string; actorUserId?: string; edition: DashboardEdition; currentUserMessage: string; supabase?: Pick<SupabaseClient, "from">; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  // Request-local only. A requested document never changes the browser snapshot.
  let requestedDocument: { kind: "quote" | "invoice"; id: string } | undefined;
  const screenContract = screenCommandContract(options);
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
      description: screenContract.description,
      inputSchema: jsonSchema<{ command: "configure_business_form" | "export_document_pdf" | "configure_ads_draft" | "save_ads_draft" | "configure_video_retouch" | "configure_mail_draft" | "prepare_document_mail" | InrAssistantMediaUiCommandName | InrAssistantMailLifecycleName | InrAssistantStudioUiCommandName | InrAssistantStatsUiCommandName | "download_badge_qr" | InrAssistantWebsiteUiCommand["command"]; instructionQuote: string; documentId?: string | null; documentKind?: "quote" | "invoice" | null; recipient?: string | null; patch?: Record<string, unknown> | null }>(screenContract.schema, { validate: screenContract.validate }),
      execute: async input => {
        if (!isInrAssistantScreenCommandAllowed(options.edition, input.command)) return { ok: false, status: "not_included", message: "Cette commande n’est pas incluse dans l’offre du compte. Aucun changement effectué." };
        const businessFormAction = await prepareInrAssistantBusinessFormUiAction(input, options); if (businessFormAction) return businessFormAction;
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
