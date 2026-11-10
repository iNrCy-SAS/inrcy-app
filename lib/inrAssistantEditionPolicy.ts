import type { DashboardEdition } from "./dashboardEdition.ts";

// Basic can execute its included manual tools. Agents and Premium operations
// remain absent; native executors independently enforce the account's edition.
const BASIC_SUPPORT_TOOLS = new Set([
  "refreshBadgeThemeFromLogo", "resumePublicationDraft", "openNotificationAction",
  "prepareStudioDraftReview",
  "submitContentReport",
  "formatBusinessDnaText",
  "reconcileExistingCreditOrder",
  "prepareGoogleBusinessDraftReview",
  "readPublishedPublicationForEdit", "previewPublishedPublicationEdit", "applyPublishedPublicationEdit",
  "readStudioSavedPreferences", "forgetStudioPreferenceBlock", "generateGoogleReviewReplyDraft",
  "controlLocalInterface", "configureApplicationPreferences", "readSendPublicationHistory",
  "discoverCapabilities", "searchPublicWeb", "readCurrentDateTime",
  "proposeHumanSupport", "readAppGuide", "getBusinessDna", "searchMedia", "getRecentPublications",
  "getAccountDiagnostics", "readWorkspaceSection", "recallPastDiscussions", "guideChannelConnection",
  "readToolSettings", "readChannelStatus", "readAttachedDocument", "navigateApplication", "runScreenCommand", "getPublicationStatus", "getBusinessDnaAnalysis", "prepareStudioPrompt",
  "updateBusinessDna", "updateAiConfiguration", "configureBusinessCta", "startBusinessDnaAnalysis",
  "generateMedia", "modifyMedia", "getMediaGeneration", "cancelMediaGeneration", "updateMediaMetadata",
  "preparePublication", "executePublication", "editPublication", "readPublicationWorkspace", "previewPublicationLifecycleAction", "applyPublicationLifecycleAction",
  "readStatsSnapshots", "readGoogleReviews", "replyToGoogleReview", "updateToolSettings",
  "readGoogleBusinessProfile", "searchGoogleBusinessCategories", "previewGoogleBusinessProfileUpdate", "applyGoogleBusinessProfileUpdate", "setNativeChannelActivation", "updateChannelPublicUrl",
  "listImportableMediaAttachments", "importMediaAttachment", "prepareMediaDownload", "previewMediaDeletion", "applyMediaDeletion",
  "refreshStatsSources", "readStatsReports", "prepareStatsReportDownload",
  "previewWebsiteAnalyticsDisconnection", "applyWebsiteAnalyticsDisconnection",
  "readSocialPublicationPreferences", "updateSocialPublicationPreferences", "previewPinterestBoardMutation", "applyPinterestBoardMutation",
  "previewWebsiteReset", "applyWebsiteReset", "readBusinessDnaSchedule", "updateBusinessDnaSchedule", "previewReferralSubmission", "applyReferralSubmission",
  "acceptMediaGeneration", "discardMediaGeneration",
  "readGeneratorBusinessSettings", "updateGeneratorBusinessSettings",
  "previewNotificationRemoval", "applyNotificationRemoval",
  "readAccountServices", "markNotificationsRead", "prepareAccountDocumentDownload", "configureCookieConsent",
  "readBusinessDnaSources", "previewBusinessDnaDocumentRemoval", "applyBusinessDnaDocumentRemoval", "readWebsiteConfiguration", "updateWebsiteConfiguration",
  "readNativeChannelPresentation", "updateNativeChannelPresentation", "readPublicationOptions", "quoteMediaGeneration", "readBusinessIdentity", "searchBusinessProfessions", "updateBusinessIdentity",
  "readChannelResources", "previewChannelResourceSelection", "previewChannelDisconnection", "applyChannelConfiguration", "updateLinkedInPersonalSharing",
  "listGoogleReviews", "previewGoogleReviewReplyAction", "applyGoogleReviewReplyAction", "readStatsEvolution",
  "previewScheduledPublicationEdit", "readScheduledPublications", "previewScheduledPublicationAction", "applyScheduledPublicationAction",
]);

export function assistantToolsForEdition<T>(tools: Record<string, T>, edition: DashboardEdition): Record<string, T> {
  return edition === "basic" ? Object.fromEntries(Object.entries(tools).filter(([name]) => BASIC_SUPPORT_TOOLS.has(name))) : tools;
}

/** Distinguish advice from a direct order; edition rights are checked separately. */
export function isBasicAssistantExecutionRequest(message: string): boolean {
  const text = message.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (/^(?:comment|pourquoi|ou\b|est.ce|peux.tu m.expliquer|explique|guide|aide.moi a (?:connecter|comprendre)|how\b|why\b|where\b|como\b|wie\b)/.test(text) ||
    /\b(?:explique\w*|expliquer|me dire|m.apprendre|explain|teach|tell me|erklar\w*|explica\w*)\b.{0,65}\b(?:comment|how|pourquoi|why|ou|where|wie|como)\b/.test(text)) return false;
  return /\b(?:genere|generer|cree|creer|redige|rediger|ecris|ecrire|prepare|preparer|publie|publier|programme|programmer|planifie|planifier|modifie|modifier|corrige|corriger|remplis|remplir|complete|completer|mets|mettez|envoie|envoyer|supprime|supprimer|generate|create|write|publish|schedule|update|delete|send)\b/.test(text);
}
