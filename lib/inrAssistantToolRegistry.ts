import "server-only";
import { createInrAssistantResearchTools } from "./inrAssistantResearchTools.ts";
import { isInrAssistantWebResearchRequest } from "./inrAssistantResearchIntent.ts";
import { isInrAssistantCurrentTimeRequest } from "./inrAssistantClock.ts";
import { isInrAssistantAccountDiagnosticRequest } from "./inrAssistantObjectives.ts";
import { getInrAssistantBasicShopReadView } from "./inrAssistantBasicShopRead.ts";
import { createInrAssistantBadgeIdentityThemeUiTools } from "./inrAssistantBadgeIdentityThemeUiTools.ts";
import { isInrAssistantBadgeLogoThemeRequest } from "./inrAssistantBadgeIdentityTheme.ts";
import { isInrAssistantResumePublicationDraftRequest } from "./inrAssistantSendPublicationIntent.ts";
import { createInrAssistantNotificationNavigationTools } from "./inrAssistantNotificationNavigationTools.ts";
import { isInrAssistantNotificationActionRequest } from "./inrAssistantNotificationNavigation.ts";
import { createInrAssistantStudioDraftReviewUiTools } from "./inrAssistantStudioDraftReviewUiTools.ts";
import { INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS, isInrAssistantStudioDraftReviewRequest } from "./inrAssistantStudioDraftReview.ts";
import { createInrAssistantContentReportTools } from "./inrAssistantContentReportTools.ts";
import { isInrAssistantContentReportSubmitRequest } from "./inrAssistantContentReport.ts";
import { createInrAssistantBusinessRichTextUiTools } from "./inrAssistantBusinessRichTextUiTools.ts";
import { isInrAssistantBusinessRichTextRequest } from "./inrAssistantBusinessRichText.ts";
import { isInrAssistantExistingCreditOrderReconciliationRequest } from "./inrAssistantCreditOrderReconciliation.ts";
import { createInrAssistantGoogleBusinessDraftUiTools } from "./inrAssistantGoogleBusinessDraftUiTools.ts";
import { isInrAssistantGoogleBusinessDraftReviewRequest } from "./inrAssistantGoogleBusinessDraftReview.ts";
import { createInrAssistantStudioPreferenceTools } from "./inrAssistantStudioPreferenceTools.ts";
import { isInrAssistantStudioForgetPreferenceRequest } from "./inrAssistantStudioPreferenceIntent.ts";
import { createInrAssistantLocalInterfaceTools } from "./inrAssistantLocalInterfaceTools.ts";
import { isInrAssistantLocalInterfaceRequest } from "./inrAssistantLocalInterface.ts";
import { createInrAssistantSendPublicationTools } from "./inrAssistantSendPublicationTools.ts";
import { createInrAssistantApplicationPreferenceTools } from "./inrAssistantApplicationPreferenceTools.ts";
import { isInrAssistantApplicationPreferenceRequest } from "./inrAssistantApplicationPreferences.ts";

import { createInrAssistantUiTools } from "./inrAssistantUiTools.ts";
import { createInrAssistantBusinessIdentityTools } from "./inrAssistantBusinessIdentityTools.ts";
import { createInrAssistantSocialPublicationPreferencesTools } from "./inrAssistantSocialPublicationPreferencesTools.ts";
import { createInrAssistantPinterestBoardTools } from "./inrAssistantPinterestBoardTools.ts";
import { createInrAssistantWebsiteLifecycleTools } from "./inrAssistantWebsiteLifecycleTools.ts";
import { createInrAssistantDnaScheduleTools } from "./inrAssistantDnaScheduleTools.ts";
import { createInrAssistantReferralTools } from "./inrAssistantReferralTools.ts";
import { createInrAssistantGeneratorSettingsTools } from "./inrAssistantGeneratorSettingsTools.ts";
import { createInrAssistantWebsiteTools } from "./inrAssistantWebsiteTools.ts";
import { createInrAssistantBusinessDnaSourceTools } from "./inrAssistantBusinessDnaSourceTools.ts";
import { createInrAssistantAccountServiceTools } from "./inrAssistantAccountServiceTools.ts";
import { createInrAssistantNativePresentationTools } from "./inrAssistantNativePresentationTools.ts";
import { createInrAssistantChannelConfigurationTools } from "./inrAssistantChannelConfigurationTools.ts";
import { createInrAssistantMediaTools } from "./inrAssistantMediaTools.ts";
import { createInrAssistantAccountTools } from "./inrAssistantAccountTools.ts";
import { createInrAssistantDiagnosticsTools } from "./inrAssistantDiagnosticsTools.ts";
import { createInrAssistantChannelTools } from "./inrAssistantChannelTools.ts";
import { createInrAssistantWorkspaceTools } from "./inrAssistantWorkspaceTools.ts";
import { createInrAssistantMemoryTools } from "./inrAssistantMemoryTools.ts";
import { createInrAssistantAttachmentTools } from "./inrAssistantAttachmentTools.ts";
import { createInrAssistantBusinessTools } from "./inrAssistantBusinessTools.ts";
import { createInrAssistantCtaTools } from "./inrAssistantCtaTools.ts";
import { createInrAssistantDnaAnalysisTools } from "./inrAssistantDnaAnalysisTools.ts";
import { createInrAssistantManagementTools } from "./inrAssistantManagementTools.ts";
import { createInrAssistantPublicationTools } from "./inrAssistantPublicationTools.ts";
import { createInrAssistantWorkspaceActionTools } from "./inrAssistantWorkspaceActionTools.ts";
import { createInrAssistantInsightsTools } from "./inrAssistantInsightsTools.ts";
import { createInrAssistantCommercialTools } from "./inrAssistantCommercialTools.ts";
import { createInrAssistantDocumentTools } from "./inrAssistantDocumentTools.ts";
import { createInrAssistantDocumentNativeTools } from "./inrAssistantDocumentNativeTools.ts";
import { createInrAssistantCalendarTools } from "./inrAssistantCalendarTools.ts";
import { createInrAssistantScheduledPublicationTools } from "./inrAssistantScheduledPublicationTools.ts";
import { createInrAssistantCommunicationTools } from "./inrAssistantCommunicationTools.ts";
import { createInrAssistantAdvertisingTools } from "./inrAssistantAdvertisingTools.ts";
import { createInrAssistantSettingsTools } from "./inrAssistantSettingsTools.ts";
import { createInrAssistantCampaignTools } from "./inrAssistantCampaignTools.ts";
import { createInrAssistantMailboxTools } from "./inrAssistantMailboxTools.ts";
import { createInrAssistantAgentTools } from "./inrAssistantAgentTools.ts";
import { createInrAssistantChannelActionTools } from "./inrAssistantChannelActionTools.ts";
import { createInrAssistantMediaLibraryTools } from "./inrAssistantMediaLibraryTools.ts";
import { createInrAssistantPublicationLifecycleTools } from "./inrAssistantPublicationLifecycleTools.ts";
import { createInrAssistantStatsTools } from "./inrAssistantStatsTools.ts";
import { inrAssistantRoutingText, type InrAssistantToolFamily } from "./inrAssistantToolRouting.ts";
import type { InrAssistantGatewayArgs } from "./inrAssistantGatewayTypes.ts";
import type { InrAssistantMediaResult } from "./inrAssistantMediaTools.ts";
import type { InrAssistantPublicationResult } from "./inrAssistantPublicationTools.ts";

export type InrAssistantToolRegistryContext = {
  args: InrAssistantGatewayArgs;
  latestRequest: string;
  spokenRequest: string;
  families: Set<InrAssistantToolFamily>;
  requiredTools: string[];
  /** Server catalogue labels used only to select schemas, never as executor instructions. */
  discoveryTopics?: string[];
  canExecute: boolean;
  draftOnly: boolean;
  statusOnly: boolean;
  navigationRequested: boolean;
  screenCommandRequested: boolean;
  remainingTimeMs: () => number;
  onMediaStarted: (requestId: string) => void;
  onMediaResult: (result: InrAssistantMediaResult) => void;
  onPublicationResult: (result: InrAssistantPublicationResult) => void;
  resolvePreview: (reference: string) => string | null;
};

/** Build the same family handlers from trusted server scope, without executing them.
 * Edition/status filtering, mutation serialization and receipts remain in the gateway.
 * Selection limits model schemas; each native tool retains its own authorization.
 * Deadline and result callbacks retain the gateway's live per-request state.
 */
export function createInrAssistantToolRegistry(context: InrAssistantToolRegistryContext) {
  const { args, latestRequest, spokenRequest, families, requiredTools, canExecute,
    draftOnly, statusOnly, navigationRequested, screenCommandRequested,
    remainingTimeMs, onMediaStarted, onMediaResult, onPublicationResult, resolvePreview } = context;
  const normalizedRequest = inrAssistantRoutingText(latestRequest);
  const researchTools = (() => {
    const searchRequested = isInrAssistantWebResearchRequest(spokenRequest) || requiredTools.includes("searchPublicWeb");
    const clockRequested = isInrAssistantCurrentTimeRequest(spokenRequest) || requiredTools.includes("readCurrentDateTime");
    if (!searchRequested && !clockRequested) return {};
    const available = createInrAssistantResearchTools({ accountId: args.accountId, edition: args.edition,
      requestId: args.requestId, currentUserMessage: spokenRequest, signal: args.signal,
      canStartWork: () => remainingTimeMs() > 50_000 });
    return {
      ...(searchRequested ? { searchPublicWeb: available.searchPublicWeb } : {}),
      ...(clockRequested ? { readCurrentDateTime: available.readCurrentDateTime } : {}),
    };
  })();
  const uiTools = (() => {
    if (!navigationRequested && !screenCommandRequested) return {};
    const available = createInrAssistantUiTools({accountId:args.accountId,actorUserId:args.actorUserId,edition:args.edition,currentUserMessage:latestRequest,clientContext:args.clientContext,supabase:args.supabase,canStartWork:()=>remainingTimeMs()>1000});
    return {
      ...(navigationRequested && available.navigateApplication ? { navigateApplication: available.navigateApplication } : {}),
      ...(screenCommandRequested && available.runScreenCommand ? { runScreenCommand: available.runScreenCommand } : {}),
    };
  })();
  const mediaTools = families.has("media") ? (() => {const available = createInrAssistantMediaTools({
    request: args.request, requestId: args.actionRequestId ?? args.requestId,
    currentUserMessage: latestRequest,
    statusReadOnly: statusOnly && args.taskIntent !== "continue",
    previewTarget: args.clientContext?.mediaPreview,
    saveAuthorizedRequestIds: args.taskContext?.receipts.filter(receipt=>["generateMedia","modifyMedia"].includes(receipt.tool) && receipt.resultMode === "save" && typeof receipt.requestId === "string").map(receipt=>receipt.requestId!),
    canStartWork: () => remainingTimeMs() > 20_000,
    onWorkStarted: onMediaStarted,
    onResult: onMediaResult,
  }); if (!/cout|co[uû]te|credits?|tarif|prix|devis|quote|cost/i.test(`${latestRequest} ${(context.discoveryTopics??[]).join(" ")}`) && !requiredTools.includes("quoteMediaGeneration")) { const {quoteMediaGeneration:_quote,...selected}=available; return selected; } return available;})() : {};
  const accountTools = (() => {
    if (!args.supabase) return {};
    const available = createInrAssistantAccountTools({ supabase: args.supabase, accountId: args.accountId });
    return {
      ...(args.edition === "basic" || families.has("business") || families.has("media") || families.has("publication") ? { getBusinessDna: available.getBusinessDna } : {}),
      ...(families.has("media") || families.has("publication") ? { searchMedia: available.searchMedia } : {}),
      ...(families.has("publication") && (requiredTools.includes("getRecentPublications") || /historique|dernier|recent|deja|similaire|bloqu|diagnosti|echec|echou|incident|dysfonctionn|fail|probleme/.test(normalizedRequest)) ? { getRecentPublications: available.getRecentPublications } : {}),
    };
  })();
  const diagnosticTools = args.supabase && (requiredTools.includes("getAccountDiagnostics") || isInrAssistantAccountDiagnosticRequest(latestRequest)) ? createInrAssistantDiagnosticsTools({ supabase: args.supabase, accountId: args.accountId, edition: args.edition }) : {};
  const channelTools = args.supabase && (requiredTools.includes("readChannelStatus") || (!requiredTools.length || /connect|etat|manquant|cockpit|total|blocage/i.test(latestRequest)) && /canaux|canal|channel|cockpit|connect|connexion|manquant|\b\d{1,2}\s*(?:\/|sur)\s*14\b/i.test(latestRequest))
    ? createInrAssistantChannelTools({supabase:args.supabase,accountId:args.accountId,edition:args.edition,signal:args.signal}) : {};
  const workspaceTools = args.supabase ? createInrAssistantWorkspaceTools({ supabase: args.supabase, accountId: args.accountId, edition: args.edition, request: args.request }) : {};
  const memoryTools = args.memory ? createInrAssistantMemoryTools({ memory: args.memory, excludeTurnId: args.turnId }) : {};
  const attachmentTools=args.fileContexts?.some(file=>file.text)?createInrAssistantAttachmentTools(args.fileContexts):{};
  const discoveryTopic=(context.discoveryTopics??[]).join(" ");
  const topic = inrAssistantRoutingText(`${statusOnly ? args.taskContext!.instruction : latestRequest} ${discoveryTopic}`);
  const routingTopic = inrAssistantRoutingText([latestRequest,discoveryTopic,args.taskContext?.instruction??"",...args.messages.filter(m=>m.role === "user").slice(-3,-1).map(m=>m.content)].join(" "));
  const businessTools = (() => {
    if (!args.supabase || !families.has("business")) return {};
    const available = createInrAssistantBusinessTools({ request: args.request, accountId: args.accountId, actorUserId: args.actorUserId, supabase: args.supabase, edition: args.edition, currentUserMessage: latestRequest, canStartWork: () => remainingTimeMs() > 15_000 });
    return {
      ...(canExecute && /(?:\badn\b|\bdna\b|entreprise|business|horaires|prestations|services|mission|valeurs)/.test(topic) && /(?:ajout|rempli|complet|modifi|chang|mets|mettez|remplac|enrich|enregistr|sauvegard|update|fill|save)/.test(topic) ? { updateBusinessDna: available.updateBusinessDna } : {}),
      ...(canExecute && /(?:configuration|reglages|\bia\b|\bai\b|emoji|consignes|\bton\b|tutoiement|vouvoiement)/.test(topic) ? { updateAiConfiguration: available.updateAiConfiguration } : {}),
      ...(/(?:connect|connexion)/.test(topic) ? { guideChannelConnection: available.guideChannelConnection } : {}),
    };
  })();
  const ctaTools = canExecute && args.supabase && /(?:\bctas?\b|appels? a l.action|\bbouton\b.{0,70}(?:appeler|telephone|facebook|site)|(?:telephone|numero|site|website|lien).{0,70}(?:partout|tous|toutes|contenus|publications|canaux|bouton)|(?:tous|toutes).{0,70}(?:telephone|site|website|lien))/.test(routingTopic)
    ? createInrAssistantCtaTools({ request: args.request, accountId: args.accountId, supabase: args.supabase,
      currentUserMessage: latestRequest, canStartWork: () => remainingTimeMs() > 15_000 }) : {};
  const dnaAnalysisTools = args.supabase && /\b(?:adn|dna)\b/.test(topic) && /(?:analys|complet|rempli|enrich|suivi|etat|resultat|termine)/.test(topic)
    ? createInrAssistantDnaAnalysisTools({ request: args.request, accountId: args.accountId, supabase: args.supabase,
      currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      actionStartedAt: args.actionStartedAt,
      canStartWork: () => remainingTimeMs() > 15_000 }) : {};
  const managementTools = (() => {
    if (!canExecute || args.edition === "basic" || !args.actorUserId || !families.has("management")) return {};
    const available = createInrAssistantManagementTools({ request: args.request, accountId: args.accountId, actorUserId: args.actorUserId,
      edition: args.edition, currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId });
    return {
      ...(/(?:abonn|souscri|resili|facturation|standard|premium|founder|stripe)/.test(topic) ? { prepareSubscriptionAction: available.prepareSubscriptionAction } : {}),
      ...(/(?:agent|automatis|planning)/.test(topic) ? { configureAgentAutomation: available.configureAgentAutomation } : {}),
    };
  })();
  const publicationTools = (() => {
    if (!args.supabase || !families.has("publication")) return {};
    const available = createInrAssistantPublicationTools({ request: args.request, accountId: args.accountId, supabase: args.supabase,
      currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      statusReadOnly:statusOnly,
      canStartWork: () => remainingTimeMs() > 15_000, onResult: onPublicationResult });
    return {
      ...(/musique|soundtrack|pinterest|tableau|placement|reel|story|ephemere|ghost/.test(topic) || requiredTools.includes("readPublicationOptions") ? {readPublicationOptions: available.readPublicationOptions} : {}),
      ...(canExecute && requiredTools.some(name=>["preparePublication","executePublication"].includes(name)) ? {preparePublication: available.preparePublication} : {}),
      ...(canExecute && requiredTools.includes("executePublication") ? { executePublication: available.executePublication } : {}),
      ...(canExecute && requiredTools.includes("editPublication") ? { editPublication: available.editPublication } : {}),
      ...(statusOnly || /(?:statut|status|etat|deja|suivi|verifi|resultat|en cours)/.test(topic) ? { getPublicationStatus: available.getPublicationStatus } : {}),
    };
  })();
  const workspaceActionTools = (() => {
    if (!args.supabase || !families.has("workspace") && !families.has("media") && !families.has("commercial")) return {};
    const available = createInrAssistantWorkspaceActionTools({ request: args.request, accountId: args.accountId, supabase: args.supabase, edition: args.edition,
      currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId, canStartWork: () => remainingTimeMs() > 15_000 });
    return {
      ...(canExecute && requiredTools.includes("updateMediaMetadata") ? { updateMediaMetadata: available.updateMediaMetadata } : {}),
      ...(canExecute && requiredTools.includes("prepareCampaignEmail") ? { prepareCampaignEmail: available.prepareCampaignEmail } : {}),
      ...(canExecute && requiredTools.includes("prepareCalendarAppointment") ? { prepareCalendarAppointment: available.prepareCalendarAppointment } : {}),
      ...(/(?:\bcrm\b|client|prospect|contact)/.test(topic) ? { searchCrmContacts: available.searchCrmContacts, ...(families.has("commercial") && requiredTools.some(name => ["manageCrmContact","prepareCommercialDocument","readCrmContact"].includes(name)) || /fiche|detail/.test(topic) ? {readCrmContact: available.readCrmContact} : {}) } : {}),
    };
  })();
  const insightsTools = (() => {
    if (!args.supabase) return {};
    const available = createInrAssistantInsightsTools({ request: args.request, accountId: args.accountId, supabase: args.supabase, actorUserId: args.actorUserId, currentUserMessage: latestRequest, currentApprovalMessage: spokenRequest, resolvePreview, canStartWork: () => remainingTimeMs() > 15000 });
    return {
      ...(/(?:stats|statisti|resultat|impression|performan)/.test(topic) ? { readStatsSnapshots: available.readStatsSnapshots } : {}),
      ...(/(?:reputation|\bavis\b|review)/.test(topic) ? { readGoogleReviews: available.readGoogleReviews, listGoogleReviews: available.listGoogleReviews, ...(canExecute ? {generateGoogleReviewReplyDraft: available.generateGoogleReviewReplyDraft, replyToGoogleReview: available.replyToGoogleReview, previewGoogleReviewReplyAction: available.previewGoogleReviewReplyAction, ...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest)?{applyGoogleReviewReplyAction:available.applyGoogleReviewReplyAction}:{})} : {}) } : {}),
    };
  })();
  const commercialTools = (() => {
    if (!canExecute || args.edition === "basic" || !args.supabase || !families.has("commercial")) return {};
    const available = createInrAssistantCommercialTools({ request: args.request, accountId: args.accountId, supabase: args.supabase,
      edition: args.edition, currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      canStartWork: () => remainingTimeMs() > 15_000 });
    return {
      ...(requiredTools.includes("manageCrmContact") ? { manageCrmContact: available.manageCrmContact } : {}),
      ...(requiredTools.includes("prepareCommercialDocument") ? { prepareCommercialDocument: available.prepareCommercialDocument } : {}),
    };
  })();
  const documentTools = args.supabase && families.has("commercial") && /devis|facture|document commercial/.test(routingTopic)
    ? (()=>{const available=createInrAssistantDocumentTools({request:args.request,accountId:args.accountId,supabase:args.supabase!,edition:args.edition,currentUserMessage:latestRequest,actionRequestId:args.actionRequestId??args.requestId,clientContext:args.clientContext,canStartWork:()=>remainingTimeMs()>15000});
      return {readCommercialDocuments:available.readCommercialDocuments,...(canExecute && requiredTools.includes("finalizeCommercialDocument")?{finalizeCommercialDocument:available.finalizeCommercialDocument}:{}),...(canExecute && requiredTools.includes("updateCommercialDocument")?{updateCommercialDocument:available.updateCommercialDocument}:{})};})() : {};
  const calendarLifecycle = requiredTools.some(name=>["confirmCalendarAppointment","updateCalendarAppointment","cancelCalendarAppointment","rejectCalendarAppointment"].includes(name));
  const calendarTools=canExecute && args.supabase && args.actorUserId && calendarLifecycle
    ? (()=>{const available=createInrAssistantCalendarTools({request:args.request,accountId:args.accountId,actorUserId:args.actorUserId!,supabase:args.supabase!,edition:args.edition,currentUserMessage:latestRequest,currentApprovalMessage:spokenRequest,canStartWork:()=>remainingTimeMs()>15000,resolvePreview});
      return {previewCalendarAction:available.previewCalendarAction,...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest)?{applyCalendarAction:available.applyCalendarAction}:{})};})() : {};
  const scheduledLifecycle=requiredTools.some(name=>["updateScheduledPublication","cancelScheduledPublication","retryScheduledPublication","publishScheduledPublicationNow","editScheduledPublication"].includes(name));
  const scheduledTools=args.supabase && args.actorUserId && families.has("publication") && (scheduledLifecycle || /programm|planifi|echec|echou/.test(topic))
    ? (()=>{const available=createInrAssistantScheduledPublicationTools({request:args.request,accountId:args.accountId,actorUserId:args.actorUserId!,supabase:args.supabase!,edition:args.edition,currentUserMessage:latestRequest,currentApprovalMessage:spokenRequest,canStartWork:()=>remainingTimeMs()>15000,resolvePreview});
      return {readScheduledPublications:available.readScheduledPublications,...(canExecute && scheduledLifecycle?{previewScheduledPublicationAction:available.previewScheduledPublicationAction,previewScheduledPublicationEdit:available.previewScheduledPublicationEdit}:{}),...(canExecute && scheduledLifecycle && /\bia-[a-f0-9]{12}\b/i.test(spokenRequest)?{applyScheduledPublicationAction:available.applyScheduledPublicationAction}:{})};})() : {};
  const communicationTools = (() => {
    if (args.edition === "basic" || !args.supabase || !families.has("workspace")) return {};
    const available = createInrAssistantCommunicationTools({ request: args.request, accountId: args.accountId, actorUserId: args.actorUserId,
      supabase: args.supabase, edition: args.edition, currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      canStartWork: () => remainingTimeMs() > 15_000 });
    const mail = /(?:campagne|email|e-mail|\bmail|newsletter|courriel|fidelis|propuls)/.test(routingTopic);
    const calendar = /(?:agenda|calendar|rendez.vous|\brdv\b)/.test(routingTopic);
    return {
      ...((mail || calendar) && (calendarLifecycle || /(?:retrouv|recherch|consulte|lis\b|lire|liste|voir|verifi|dernier|existant|modifi|corrig|chang|deplac|envo|programm)/.test(topic)) ? { readCommunicationRecords: available.readCommunicationRecords } : {}),
      ...(canExecute && mail && requiredTools.includes("updateCampaignDraft") ? { updateCampaignDraft: available.updateCampaignDraft } : {}),
      ...(canExecute && mail && requiredTools.includes("dispatchCampaignDraft") && !families.has("advertising") ? { dispatchCampaignDraft: available.dispatchCampaignDraft } : {}),
    };
  })();
  const advertisingTools = (() => {
    if (args.edition === "basic" || !families.has("advertising")) return {};
    const available = createInrAssistantAdvertisingTools({ request: args.request, accountId: args.accountId, edition: args.edition,
      currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      canStartWork: () => remainingTimeMs() > 15_000 });
    return {
      readAdvertisingCampaigns: available.readAdvertisingCampaigns,
      ...(canExecute && /(?:cre|prepar|brouillon|draft)/.test(topic) ? { prepareAdvertisingCampaign: available.prepareAdvertisingCampaign } : {}),
      ...(canExecute && /(?:pause|arret|suspend|repren|repri|reactiv|modifi|corrig|chang|budget|supprim|effac|update)/.test(topic) ? { manageAdvertisingCampaign: available.manageAdvertisingCampaign } : {}),
    };
  })();
  const settingsTools = families.has("settings") ? createInrAssistantSettingsTools({ request: args.request, accountId: args.accountId,
    actorUserId: args.actorUserId, edition: args.edition, currentUserMessage: latestRequest, canStartWork: () => remainingTimeMs() > 15_000 }) : {};
  const campaignTools = args.supabase && args.actorUserId && families.has("workspace") && (requiredTools.some(name=>["dispatchCampaignAudience","selectCampaignMailbox","listCampaignMailboxes","readCampaignDeliveryStatus"].includes(name)) || statusOnly && requiredTools.includes("dispatchCampaignDraft") || /audience|segment|expediteur|mailbox|boite|\bap-[a-f0-9]{12}\b/.test(routingTopic))
    ? (()=>{ const available=createInrAssistantCampaignTools({request:args.request,accountId:args.accountId,actorUserId:args.actorUserId!,edition:args.edition,supabase:args.supabase!,currentUserMessage:latestRequest,actionRequestId:args.actionRequestId??args.requestId,canStartWork:()=>remainingTimeMs()>15_000});
      return { listCampaignMailboxes:available.listCampaignMailboxes,
        ...(statusOnly || requiredTools.includes("readCampaignDeliveryStatus")?{readCampaignDeliveryStatus:available.readCampaignDeliveryStatus}:{}),
        ...(canExecute && /expediteur|boite|adresse d.envoi|mailbox|sender/.test(topic)?{selectCampaignMailbox:available.selectCampaignMailbox}:{}),
        ...(canExecute && /audience|segment|clients|prospects|contacts|destinataires|apercu|envoi|envoie/.test(topic)?{previewCampaignAudience:available.previewCampaignAudience}:{}),
        ...(canExecute && /\bap-[a-f0-9]{12}\b/.test(topic)?{dispatchCampaignAudience:available.dispatchCampaignAudience}:{}) };
    })() : {};
  const individualMailboxRequested = requiredTools.some(name => ["listIndividualMailboxes", "readIndividualMailHistory", "previewIndividualMail", "sendIndividualMail"].includes(name)) ||
    /mail|courriel|boite|expediteur/.test(routingTopic) && !/campagne|newsletter|audience|segment/.test(routingTopic);
  const mailboxTools=args.supabase && args.actorUserId && families.has("workspace") && individualMailboxRequested
    ? createInrAssistantMailboxTools({request:args.request,accountId:args.accountId,actorUserId:args.actorUserId,supabase:args.supabase,edition:args.edition,currentUserMessage:latestRequest,currentApprovalMessage:spokenRequest,resolvePreview,canStartWork:()=>remainingTimeMs()>15000}) : {};
  const additionalTools = (() => {
    if (!args.supabase || !args.actorUserId || draftOnly) return {};
    const scope = { request: args.request, accountId: args.accountId, actorUserId: args.actorUserId, supabase: args.supabase, edition: args.edition,
      currentUserMessage: latestRequest, currentApprovalMessage: spokenRequest, resolvePreview, canStartWork: () => remainingTimeMs() > 15_000 };
    const selected: Record<string, unknown> = {};
    const pick = (available: Record<string, unknown>, names: string[]) => { for (const name of names) if (available[name]) selected[name] = available[name]; };
    if (/inrsend|inr.send|historique|brouillons?/.test(topic) && /publication|inrsend|inr.send/.test(topic) || requiredTools.some(name => ["readSendPublicationHistory", "resumePublicationDraft"].includes(name)) || isInrAssistantResumePublicationDraftRequest(latestRequest)) {
      const available = createInrAssistantSendPublicationTools(scope);
      pick(available, ["readSendPublicationHistory", ...(canExecute && isInrAssistantResumePublicationDraftRequest(latestRequest) ? ["resumePublicationDraft"] : [])]);
    }
    if (canExecute && isInrAssistantBadgeLogoThemeRequest(latestRequest)) Object.assign(selected, createInrAssistantBadgeIdentityThemeUiTools({ ...scope, clientContext: args.clientContext }));
    if (canExecute && isInrAssistantNotificationActionRequest(latestRequest)) Object.assign(selected, createInrAssistantNotificationNavigationTools({ ...scope, clientContext: args.clientContext }));
    if (canExecute && (requiredTools.includes("prepareStudioDraftReview") || INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS.some(target => isInrAssistantStudioDraftReviewRequest(latestRequest, target)))) Object.assign(selected, createInrAssistantStudioDraftReviewUiTools({ ...scope, clientContext: args.clientContext }));
    if (canExecute && (requiredTools.includes("submitContentReport") || isInrAssistantContentReportSubmitRequest(latestRequest))) Object.assign(selected, createInrAssistantContentReportTools({ ...scope, clientContext: args.clientContext }));
    if (canExecute && (requiredTools.includes("formatBusinessDnaText") || isInrAssistantBusinessRichTextRequest(latestRequest))) Object.assign(selected, createInrAssistantBusinessRichTextUiTools({ ...scope, clientContext: args.clientContext }));
    if (canExecute && (requiredTools.includes("prepareGoogleBusinessDraftReview") || isInrAssistantGoogleBusinessDraftReviewRequest(latestRequest))) Object.assign(selected, createInrAssistantGoogleBusinessDraftUiTools({ ...scope, clientContext: args.clientContext }));
    if (/studio|generateur de media/.test(topic) && /memor|preference|reglage/.test(topic) || requiredTools.some(name => ["readStudioSavedPreferences", "forgetStudioPreferenceBlock"].includes(name))) {
      const available = createInrAssistantStudioPreferenceTools(scope);
      pick(available, ["readStudioSavedPreferences", ...(canExecute && [1, 2, 3, 4, 5, 6].some(id => isInrAssistantStudioForgetPreferenceRequest(latestRequest, id)) ? ["forgetStudioPreferenceBlock"] : [])]);
    }
    if (canExecute && args.clientContext?.interfaces?.length && isInrAssistantLocalInterfaceRequest(latestRequest)) Object.assign(selected, createInrAssistantLocalInterfaceTools({ ...scope, clientContext: args.clientContext }));
    if (canExecute && (requiredTools.includes("configureApplicationPreferences") || isInrAssistantApplicationPreferenceRequest(latestRequest))) Object.assign(selected, createInrAssistantApplicationPreferenceTools(scope));
    if (families.has("business") && (requiredTools.some(name => ["readBusinessIdentity","searchBusinessProfessions","updateBusinessIdentity"].includes(name)) || /identite|coordonne|raison sociale|profession|metier|postal|ville|profil entreprise|(?:nom|prenom|logo|telephone|adresse).{0,35}(?:entreprise|societe|profil)/.test(topic))) {
      const available = createInrAssistantBusinessIdentityTools(scope);
      pick(available, ["readBusinessIdentity", ...(/profession|metier|activite/.test(topic) ? ["searchBusinessProfessions"] : []), ...(canExecute ? ["updateBusinessIdentity"] : [])]);
    }
    if (families.has("business") && (requiredTools.some(name => ["readChannelResources","previewChannelResourceSelection","previewChannelDisconnection","applyChannelConfiguration","updateLinkedInPersonalSharing"].includes(name)) || /ressource|page facebook|fiche google|etablissement google|organisation linkedin|tableau pinterest|partage personnel|deconnect|dissoci/.test(topic))) {
      const available = createInrAssistantChannelConfigurationTools(scope);
      pick(available, ["readChannelResources", ...(canExecute ? ["previewChannelResourceSelection", "previewChannelDisconnection", "updateLinkedInPersonalSharing", ...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest) ? ["applyChannelConfiguration"] : [])] : [])]);
    }
    if (/sources? (?:adn|dna)|documents? (?:adn|dna|de reference)|fichiers? (?:adn|dna)|(?:adn|dna).{0,35}(?:sources?|documents?|fichiers?)/.test(topic) || requiredTools.some(name => ["readBusinessDnaSources","applyBusinessDnaDocumentRemoval"].includes(name))) {
      const available = createInrAssistantBusinessDnaSourceTools(scope);
      pick(available, ["readBusinessDnaSources", ...(canExecute ? ["previewBusinessDnaDocumentRemoval", ...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest)?["applyBusinessDnaDocumentRemoval"]:[])] : [])]);
    }
    if (/ga4|analytics|search console|gsc|widget|actualites|actus/.test(topic) || requiredTools.some(name => ["readWebsiteConfiguration", "updateWebsiteConfiguration", "applyWebsiteAnalyticsDisconnection"].includes(name))) {
      const available = createInrAssistantWebsiteTools(scope);
      pick(available, ["readWebsiteConfiguration", ...(canExecute ? ["updateWebsiteConfiguration", "previewWebsiteAnalyticsDisconnection", ...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest)?["applyWebsiteAnalyticsDisconnection"]:[])] : [])]);
    }
    if (getInrAssistantBasicShopReadView(latestRequest) || /notification|abonnement|credits?|recharges?|commandes?|factures? d.abonnement|rgpd|donnees personnelles|cookies?|parrainage/.test(topic) || requiredTools.some(name => ["readAccountServices","markNotificationsRead","previewNotificationRemoval","applyNotificationRemoval","reconcileExistingCreditOrder","prepareAccountDocumentDownload","configureCookieConsent"].includes(name))) {
      const available = createInrAssistantAccountServiceTools(scope);
      pick(available, ["readAccountServices", ...(canExecute && isInrAssistantExistingCreditOrderReconciliationRequest(latestRequest) ? ["reconcileExistingCreditOrder"] : []), ...(canExecute && /notifications?/.test(topic) ? ["markNotificationsRead", "previewNotificationRemoval", ...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest) ? ["applyNotificationRemoval"] : [])] : []), ...(canExecute && (requiredTools.includes("prepareAccountDocumentDownload") || /telecharg|export/.test(topic)) ? ["prepareAccountDocumentDownload"] : []), ...(canExecute && /cookies?/.test(topic) ? ["configureCookieConsent"] : [])]);
    }
    if (/parrain|recommandation|referral/.test(topic) || requiredTools.includes("applyReferralSubmission")) { const available=createInrAssistantReferralTools(scope); pick(available, [...(canExecute ? ["previewReferralSubmission", ...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest)?["applyReferralSubmission"]:[])] : [])]); }
    if (requiredTools.some(name => ["readSocialPublicationPreferences","updateSocialPublicationPreferences"].includes(name)) || /(?:facebook|instagram|threads).{0,65}(?:preference|reglage|defaut|activer|desactiver)|(?:preference|reglage|defaut).{0,65}(?:facebook|instagram|threads)/.test(topic)) { const available=createInrAssistantSocialPublicationPreferencesTools(scope); pick(available,["readSocialPublicationPreferences",...(canExecute?["updateSocialPublicationPreferences"]:[])]); }
    if (requiredTools.includes("applyPinterestBoardMutation")) { const available=createInrAssistantPinterestBoardTools(scope); pick(available,[...(canExecute?["previewPinterestBoardMutation",...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest)?["applyPinterestBoardMutation"]:[])]:[])]); }
    if (requiredTools.includes("applyWebsiteReset")) { const available=createInrAssistantWebsiteLifecycleTools(scope); pick(available,[...(canExecute?["previewWebsiteReset",...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest)?["applyWebsiteReset"]:[])]:[])]); }
    if (requiredTools.some(name=>["readBusinessDnaSchedule","updateBusinessDnaSchedule"].includes(name)) || /(?:programmation|planification|analyse mensuelle).{0,70}(?:adn|dna)|(?:adn|dna).{0,70}(?:mensuel|programmation|planification)/.test(topic)) { const available=createInrAssistantDnaScheduleTools(scope); pick(available,["readBusinessDnaSchedule",...(canExecute?["updateBusinessDnaSchedule"]:[])]); }
    if (/panier moyen|conversion|estimations?|reglages? du generateur|opportunites/.test(topic) || requiredTools.some(name=>["readGeneratorBusinessSettings","updateGeneratorBusinessSettings"].includes(name))) { const available=createInrAssistantGeneratorSettingsTools(scope); pick(available,["readGeneratorBusinessSettings",...(canExecute?["updateGeneratorBusinessSettings"]:[])]); }
    if (/badge|search/.test(topic)) {
      const available = createInrAssistantNativePresentationTools(scope);
      pick(available, ["readNativeChannelPresentation", ...(canExecute ? ["updateNativeChannelPresentation"] : [])]);
    }
    if (args.edition === "founder" && (families.has("commercial") || requiredTools.some(name => ["applyCommercialDocumentAction", "applyCommercialTemplateAction", "prepareCurrentDocumentTemplate"].includes(name)))) {
      const available = createInrAssistantDocumentNativeTools({ ...scope, clientContext: args.clientContext });
      pick(available, ["readCommercialTemplates",
        ...(canExecute && requiredTools.includes("prepareCommercialDocumentForm") ? ["prepareCommercialDocumentForm"] : []),
        ...(canExecute && requiredTools.includes("prepareCurrentDocumentTemplate") ? ["prepareCurrentDocumentTemplate"] : []),
        ...(canExecute && requiredTools.includes("applyCommercialTemplateAction") ? ["previewCommercialTemplateAction", ...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest) ? ["applyCommercialTemplateAction"] : [])] : []),
        ...(canExecute && requiredTools.includes("applyCommercialDocumentAction") ? ["previewCommercialDocumentAction", ...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest) ? ["applyCommercialDocumentAction"] : [])] : [])]);
    }
    if (/idees?/.test(topic) && /agent|publication|editorial/.test(topic) && args.edition !== "basic") pick(createInrAssistantAgentTools(scope), ["readPublicationIdeas", ...(requiredTools.includes("managePublicationIdeas") ? ["managePublicationIdeas"] : [])]);
    if (requiredTools.some(name => ["setNativeChannelActivation","updateChannelPublicUrl","applyGoogleBusinessProfileUpdate"].includes(name)) || /google business|fiche google|profil google/.test(topic)) {
      const available = createInrAssistantChannelActionTools(scope);
      pick(available, ["readGoogleBusinessProfile", ...(/categor|activit/.test(topic) ? ["searchGoogleBusinessCategories"] : []), ...requiredTools.filter(name => ["setNativeChannelActivation","updateChannelPublicUrl"].includes(name)), ...(requiredTools.includes("applyGoogleBusinessProfileUpdate") ? ["previewGoogleBusinessProfileUpdate", "applyGoogleBusinessProfileUpdate"] : [])]);
    }
    if (requiredTools.some(name => ["importMediaAttachment","prepareMediaDownload","applyMediaDeletion"].includes(name))) {
      const available = createInrAssistantMediaLibraryTools({ ...scope, mediaAttachments: args.mediaAttachments, resolveMediaAttachment: args.resolveMediaAttachment, claimMediaAttachmentImport: args.claimMediaAttachmentImport });
      pick(available, [...(requiredTools.includes("importMediaAttachment") ? ["listImportableMediaAttachments","importMediaAttachment"] : []), ...(requiredTools.includes("prepareMediaDownload") ? ["prepareMediaDownload"] : []), ...(requiredTools.includes("applyMediaDeletion") ? ["previewMediaDeletion","applyMediaDeletion"] : [])]);
    }
    if (families.has("publication") && (requiredTools.some(name => ["editPreparedPublication","applyPublicationLifecycleAction","editPublication","applyPublishedPublicationEdit"].includes(name)) || /historique|brouillon|proposition|preparee|retrouv|recherch|liste|consulte/.test(topic))) {
      const available = createInrAssistantPublicationLifecycleTools(scope);
      pick(available, ["readPublicationWorkspace", "readPublishedPublicationForEdit", ...(canExecute && requiredTools.some(name => ["editPublication", "applyPublishedPublicationEdit"].includes(name)) ? ["previewPublishedPublicationEdit", ...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest) ? ["applyPublishedPublicationEdit"] : [])] : []), ...(requiredTools.includes("editPreparedPublication") ? ["editPreparedPublication"] : []), ...(requiredTools.includes("applyPublicationLifecycleAction") ? ["previewPublicationLifecycleAction","applyPublicationLifecycleAction"] : [])]);
    }
    if (/stats|statistiq|bilan|rapport/.test(topic) || requiredTools.some(name => ["readStatsEvolution","readStatsReports","refreshStatsSources","sendStatsReport","prepareStatsReportDownload"].includes(name))) {
      const available = createInrAssistantStatsTools(scope);
      pick(available, [...(/rapport|bilan/.test(topic) || requiredTools.some(name => ["readStatsReports","sendStatsReport","prepareStatsReportDownload"].includes(name)) ? ["readStatsReports"] : []), ...(/mensuel|mois|evolution/.test(topic) || requiredTools.includes("readStatsEvolution") ? ["readStatsEvolution"] : []), ...requiredTools.filter(name => ["refreshStatsSources","sendStatsReport","prepareStatsReportDownload"].includes(name))]);
    }
    return selected;
  })();
  return { researchTools, uiTools, mediaTools, accountTools, diagnosticTools, channelTools, workspaceTools, memoryTools, attachmentTools, businessTools, ctaTools, dnaAnalysisTools, managementTools, publicationTools, workspaceActionTools, insightsTools, commercialTools, documentTools, calendarTools, scheduledTools, communicationTools, advertisingTools, settingsTools, campaignTools, mailboxTools, additionalTools };
}
