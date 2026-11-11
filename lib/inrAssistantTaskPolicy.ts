import { isInrAssistantBadgeLogoThemeRequest } from "./inrAssistantBadgeIdentityTheme.ts";
import { isInrAssistantResumePublicationDraftRequest } from "./inrAssistantSendPublicationIntent.ts";
import { isInrAssistantNotificationActionRequest } from "./inrAssistantNotificationNavigation.ts";
import { isInrAssistantAccountUiRequest } from "./inrAssistantAccountUiIntent.ts";
import { INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS, isInrAssistantStudioDraftReviewRequest } from "./inrAssistantStudioDraftReview.ts";
import { isInrAssistantContentReportSubmitRequest } from "./inrAssistantContentReport.ts";
import { isInrAssistantBusinessRichTextRequest } from "./inrAssistantBusinessRichText.ts";
import { isInrAssistantExistingCreditOrderReconciliationRequest } from "./inrAssistantCreditOrderReconciliation.ts";
import { isInrAssistantGoogleBusinessDraftReviewRequest } from "./inrAssistantGoogleBusinessDraftReview.ts";
import { isInrAssistantScheduledPublishNowRequest } from "./inrAssistantScheduledPublicationIntent.ts";
import { isInrAssistantStudioForgetPreferenceRequest } from "./inrAssistantStudioPreferenceIntent.ts";
import { isInrAssistantGoogleReviewDraftRequest } from "./inrAssistantGoogleReviewDraftIntent.ts";
import { isInrAssistantLocalInterfaceRequest } from "./inrAssistantLocalInterface.ts";
import { isInrAssistantApplicationPreferenceRequest } from "./inrAssistantApplicationPreferences.ts";
import { hasInrAssistantMediaSubject, permitsInrAssistantMediaAction } from "./inrAssistantMediaIntent.ts";
import { isInrAssistantDnaScheduleRequest, isInrAssistantPinterestBoardRequest, isInrAssistantSocialPreferencesRequest, isInrAssistantWebsiteLifecycleRequest, isInrAssistantNativePresentationRequest, isInrAssistantWebsiteConfigurationRequest } from "./inrAssistantBasicTargetIntents.ts";
import { isInrAssistantMediaPreviewButtonRequest, isInrAssistantMediaPreviewDecisionRequest } from "./inrAssistantMediaPreview.ts";
import { isInrAssistantStudioDraftRequest } from "./inrAssistantStudioDraft.ts";
import { inrAssistantStandardCommands } from "./inrAssistantStandardRouting.ts";
import { INR_ASSISTANT_COMMANDS, INR_ASSISTANT_PENDING_STATUSES, INR_ASSISTANT_UNCERTAIN_STATUSES, isInrAssistantAcceptedReceipt, inrAssistantSettingTargets, requestsInrAssistantSettingsChange } from "./inrAssistantCommandRegistry.ts";
import { inrAssistantRequestClauses, inrAssistantClauseIsAdvice, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";
import { hasInrAssistantDeferredApproval } from "./inrAssistantActionClause.ts";
import { readInrAssistantCommunicationIntent } from "./inrAssistantCommunicationIntent.ts";
import type { InrAssistantUiStep } from "./inrAssistantUiTask.ts";
import { isInrAssistantDocumentTemplateInstruction } from "./inrAssistantDocumentUiCommands.ts";
export { inrAssistantRequestClauses, inrAssistantClauseIsAdvice } from "./inrAssistantRequestClauses.ts";

export const INR_ASSISTANT_APPROVAL_KINDS = ["calendar","scheduled_publication","google_business_profile","media_delete","publication_lifecycle","individual_mail","commercial_document","google_review_reply","channel_resource_selection","channel_disconnection","business_dna_document_removal","website_analytics_disconnection","pinterest_board_mutation","website_reset","referral_submission","notification_removal","published_publication_edit"] as const;
export type InrAssistantTaskOutcome = "completed" | "partial" | "needs_input" | "processing" | "blocked" | "failed";
export type InrAssistantActionReceipt = { tool: string; ok: boolean; status: string; message: string; id?: string; draftId?: string; requestId?: string; scheduledActionId?: string; eventId?: string; recordId?: string; publicationId?: string; toolUrl?: string; /** Private capability, never sent to the model or client. */ approvalToken?: string; approvalReference?: string; approvalKind?: typeof INR_ASSISTANT_APPROVAL_KINDS[number]; resultMode?: "save" | "preview"; draft?: boolean };
export type InrAssistantTaskState = {
  version: 1; instruction: string; actionRequestId: string; startedAt: string; expiresAt: string;
  outcome: InrAssistantTaskOutcome; requiredTools: string[]; requiredCalls?: Record<string, number>; receipts: InrAssistantActionReceipt[]; question: string;
  /** Private server binding to the original attachments; never a browser grant. */
  mediaImportSource?: { turnId: string; createdAt: string };
  /** Browser handoffs, distinct from native business confirmations. */
  uiSteps?: InrAssistantUiStep[];
};
export const INR_ASSISTANT_MAX_TRACKED_ACTIONS = 24;
const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Schema vocabulary only; executors independently authorize the original request. */
export function inrAssistantRoutingText(text: string): string {
  return normalize(text).replace(/\bcall.to.action\b/g, "cta")
    .replace(/\b(?:publicacion(?:es)?|beitrage?|beitrag|bijdrage|pubblicazioni?|publicacoes|veroffentlichung)\b/g, "publication")
    .replace(/\b(?:crea|crear|erstelle|erstellen|creare|cria|criar|maak|create)\b/g, "cree")
    .replace(/\b(?:publica|publicar|veroffentliche|pubblica|publish)\b/g, "publie")
    .replace(/\b(?:programa|programar|plane|planen|schedule)\b/g, "programme")
    .replace(/\b(?:telefono|telefon|phone)\b/g, "telephone")
    .replace(/\b(?:sitio web|webseite|website)\b/g, "site web")
    .replace(/\b(?:imagen(?:es)?|immagine|bild(?:er)?|imagem|afbeelding)\b/g, "image")
    .replace(/\b(?:boton|button|schaltflache)\b/g, "bouton")
    .replace(/\b(?:alle|todos|todas|all)\b/g, "tous").replace(/\b(?:canales|kanale|channels)\b/g, "canaux");
}
/** Schema discovery only. A provider, actual spend or preflight distinguishes
 * advertising from an otherwise ambiguous mail campaign; this grants no action. */
export function isInrAssistantAdvertisingRequest(message: string): boolean {
  const text = inrAssistantRoutingText(inrAssistantUnquotedRequest(message));
  if (/\bads\b|publicit|annonceur|campagne sponsoris|\badvertising\b/.test(text)) return true;
  if (!/\b(?:campagnes?|campaigns?)\b/.test(text) || /\b(?:(?:e-?)?mails?|courriels?|newsletters?|fidelis\w*|propuls\w*)\b/.test(text)) return false;
  return /\b(?:google|meta|facebook|instagram|linkedin|pinterest|chatgpt|openai|depens\w*|cout\w*|budget|clics?|impressions?|conversions?|roas|cpa|spend|spent|metrics|preflight)\b|\b(?:pret\w*|prealable)\b.{0,60}\b(?:lanc\w*|diffus\w*|activ\w*)\b|\b(?:lanc\w*|diffus\w*)\b.{0,50}\bpret\w*\b/.test(text);
}
/** A mentioned invoice can be attachment evidence rather than an account record.
 * Resolve this only within its unquoted clause, never from another requested read. */
export function isInrAssistantAttachedFileRequest(message: string): boolean {
  const text = inrAssistantUnquotedRequest(message);
  return /\b(?:fichiers?|pieces?|documents?|scans?|factures?|devis|pdf)\b[^.!?;]{0,90}\b(?:joint(?:e|es|s)?|attach(?:e|ee|es|ees))\b|\b(?:dans|depuis|a partir de)\s+(?:la|le|les|ce|cette|ces|mon|ma|mes)\s+fichiers?\b/.test(text);
}
/** A Studio price estimate is a native read, not a commercial document or a
 * request to read the credit ledger merely because its unit is credits. */
export function isInrAssistantMediaQuoteRequest(message: string): boolean {
  const text=inrAssistantUnquotedRequest(message);
  if (isInrAssistantAttachedFileRequest(message)) return false;
  if (!hasInrAssistantMediaSubject(message,"image") && !hasInrAssistantMediaSubject(message,"video")) return false;
  if (!/\b(?:devis|cout\w*|tarif\w*|prix|quote|cost|combien)\b/.test(text)) return false;
  if (!/\b(?:devis|cout\w*|tarif\w*|prix|quote|cost)\b/.test(text) && /\b(?:solde|restants?|reste|restent|disponibles?|remaining|balance)\b/.test(text)) return false;
  return /^(?:(?:peux|pourrais)[- ]tu\s+|(?:pouvez|pourriez)[- ]vous\s+)?(?:donne\w*(?:-moi)?|montre\w*|affiche\w*|indique\w*|calcule\w*|estime\w*|verifi\w*|lis|lire|consulte\w*|prepare\w*|quels?|quelles?|combien|show|check|quote)\b/.test(text);
}
export function isInrAssistantMediaStatusRequest(message:string):boolean {
  const text=inrAssistantUnquotedRequest(message);
  return /\b(?:apercu|creation|generation|preview)\b/.test(text) && /\b(?:statut|etat|suivi|ou en est|status)\b/.test(text)
    && /^(?:quels?|quelles?|verifi\w*|montre\w*|consulte\w*|lis|lire|ou|check|show)\b/.test(text);
}
/** Public counter labels name pending states, never native mutations. */
export function isInrAssistantCrmAggregateReadRequest(message: string): boolean {
  const text = inrAssistantUnquotedRequest(message);
  return /^(?:(?:peux|pourrais)[- ]tu\s+|(?:pouvez|pourriez)[- ]vous\s+)?(?:donne\w*(?:-moi)?|lis|lire|consulte\w*|liste\w*|montre\w*|affiche\w*|indique\w*|verifi\w*|quels?|quelles?|combien)\b/.test(text)
    && /\bcrm\b/.test(text) && /\b(?:compteurs?|agreg\w*|counts?)\b/.test(text);
}
/** Business goals, distinct from their prerequisite reads. */
export function inrAssistantRequiredTools(message: string): string[] {
  return [...new Set(inrAssistantActionObjectives(message).map(objective => objective.tool))];
}
/** Preserving a draft's body does not revoke an explicit choice of sender.
 * This tracks only that current choice; native tools still validate its quote,
 * mailbox ownership, draft identity and the complete original instruction. */
function campaignSenderSelectionRequested(message:string):boolean {
  const current=inrAssistantUnquotedRequest(message);
  if(hasInrAssistantDeferredApproval(message) || /\b(?:si|quand|lorsque|if|when|unless)\b|^(?:imagin\w*|suppos\w*)\b/.test(current)) return false;
  const selection="(?:choisi\\w*|selection\\w*|utilis\\w*|select|use)";
  if(new RegExp(`(?:\\b(?:ne|pas|jamais|sans|not|never|without|do not)\\b|\\bn'|don't).{0,40}\\b${selection}\\b|\\b${selection}\\b.{0,16}\\b(?:pas|jamais|not|never|rien|nothing)\\b`).test(current)
    || /(?:\b(?:ne|sans|not|never|without|do not)\b|\bn').{0,20}\b(?:modifi\w*|chang\w*|mets)\b.{0,35}\b(?:expediteur|boite|adresse d.envoi|sender|mailbox)\b/.test(current)) return false;
  return inrAssistantRequestClauses(message).some(clause=>!inrAssistantClauseIsAdvice(clause)
    && /^(?:choisis|selectionne|utilise|mets|change|modifie|select|use)\b/.test(clause)
    && /\b(?:campagne|mail|newsletter|brouillon|draft)\b/.test(clause)
    && /\b(?:expediteur|boite|adresse d.envoi|sender|mailbox)\b/.test(clause));
}
export type InrAssistantActionObjective = { kind: "action"; tool: string; instruction: string };
export function inrAssistantActionObjectives(message: string): InrAssistantActionObjective[] {
  for (const operation of ["accept", "discard"] as const) if (isInrAssistantMediaPreviewButtonRequest(message, operation)) return [{kind:"action",tool:operation === "accept" ? "acceptMediaGeneration" : "discardMediaGeneration",instruction:inrAssistantRoutingText(message)}];
  if (isInrAssistantStudioDraftRequest(message)) return [];
  const clauses = inrAssistantRequestClauses(message).map(inrAssistantRoutingText);
  const mediaContext = hasInrAssistantMediaSubject(message, "image") || hasInrAssistantMediaSubject(message, "video");
  const required: InrAssistantActionObjective[] = [];
  const communication = readInrAssistantCommunicationIntent(message);
  const current = inrAssistantUnquotedRequest(message);
  const deferredSensitiveAction = hasInrAssistantDeferredApproval(message) || /^(?:si|quand|lorsque|if|when|unless|imagin\w*|suppos\w*)\b|\b(?:si|quand|lorsque|if|when|unless)\s+(?:je|j'|tu|vous|nous|on|il|elle|le|la|les|un|une|the|i|you|we|they)\b/.test(current);
  let previousWasMail = false;
  for (const clause of clauses) {
    // Only an explicit object pronoun can inherit the immediately preceding
    // campaign. This is tracking vocabulary; executors still receive the exact
    // original request and independently verify its instruction and recipients.
    const mailPronoun = /^(?:envoi\w*|diffuse\w*|modifi\w*|corrig\w*|change\w*)(?:-(?:le|la|les)\b|\s+(?:le|la|les)(?=\s+(?:a|au|aux|pour|demain|maintenant)\b|[.!?;,:]|$))|^(?:send|edit|update)\s+(?:it|them)\b/.test(clause.trim());
    const inferredMail: boolean = previousWasMail && mailPronoun;
    required.push(...requiredToolsForClause(inferredMail ? `${clause} — campagne mail` : clause, mediaContext).map(tool => ({ kind: "action" as const, tool, instruction: clause })));
    const target = clause.match(/\b(?:campagnes?|e-?mails?|newsletters?|images?|photos?|videos?|visuels?|logos?|flyers?|affiches?|publications?|posts?|crm|contacts?|clients?|prospects?|devis|factures?|agenda|rendez.vous|rdv)\b/);
    previousWasMail = target ? /^(?:campagnes?|e-?mails?|newsletters?)$/.test(target[0]) && !isInrAssistantAdvertisingRequest(clause) : inferredMail;
  }
  // Clause routing must not discard a later explicit media refusal or turn a
  // wish introducing a knowledge question into an unfinished paid task.
  return required.filter(objective => !(["prepareAdvertisingCampaign", "manageAdvertisingCampaign", "manageCrmContact", "acceptMediaGeneration", "discardMediaGeneration", "prepareCampaignEmail", "updateCampaignDraft", "previewCampaignAudience", "dispatchCampaignDraft", "dispatchCampaignAudience", "selectCampaignMailbox"].includes(objective.tool) && deferredSensitiveAction)
    && (objective.tool !== "selectCampaignMailbox" || campaignSenderSelectionRequested(message))
    && (objective.tool !== "prepareCampaignEmail" || communication.campaignDraft)
    && (objective.tool !== "updateCampaignDraft" || communication.campaignDraftEdit)
    && (objective.tool !== "acceptMediaGeneration" || isInrAssistantMediaPreviewDecisionRequest(message,"accept"))
    && (objective.tool !== "discardMediaGeneration" || isInrAssistantMediaPreviewDecisionRequest(message,"discard"))).filter(objective => objective.tool === "generateMedia"
    ? permitsInrAssistantMediaAction(message, "generate", "image") || permitsInrAssistantMediaAction(message, "generate", "video")
    : objective.tool !== "modifyMedia" || permitsInrAssistantMediaAction(message, "modify"))
    .filter(objective => !["confirmCalendarAppointment", "finalizeCommercialDocument"].includes(objective.tool) || !hasInrAssistantDeferredApproval(objective.instruction));
}
function requiredToolsForClause(message: string, mediaContext: boolean): string[] {
  const t = inrAssistantRoutingText(message).replace(/^(?:dans|sur)\s+(?:(?:le|mon|notre)\s+)?crm\s*[:,]?\s*/, ""), result: string[] = [];
  // Names of pending counters ("RDV à confirmer", "devis à accepter")
  // describe states to read. They are not orders to perform those operations.
  // Independent imperatives have already been split into their own clauses.
  if (isInrAssistantCrmAggregateReadRequest(message)) return result;
  if (isInrAssistantBadgeLogoThemeRequest(message)) return ["refreshBadgeThemeFromLogo"];
  if (isInrAssistantResumePublicationDraftRequest(message)) return ["resumePublicationDraft"];
  if (isInrAssistantNotificationActionRequest(message)) return ["openNotificationAction"];
  if (isInrAssistantAccountUiRequest(message, "open_subscription_invoice_link")) return ["prepareAccountDocumentDownload"];
  if (INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS.some(target => isInrAssistantStudioDraftReviewRequest(message, target))) return ["prepareStudioDraftReview"];
  if (isInrAssistantContentReportSubmitRequest(message)) return ["submitContentReport"];
  if (isInrAssistantBusinessRichTextRequest(message)) return ["formatBusinessDnaText"];
  if (isInrAssistantExistingCreditOrderReconciliationRequest(message)) return ["reconcileExistingCreditOrder"];
  if (isInrAssistantGoogleBusinessDraftReviewRequest(message)) return ["prepareGoogleBusinessDraftReview"];
  if (isInrAssistantScheduledPublishNowRequest(message)) return ["publishScheduledPublicationNow"];
  if (isInrAssistantGoogleReviewDraftRequest(message, "avis-1") || [...message.matchAll(/\bavis-[1-9]\d{0,3}\b/gi)].some(match => isInrAssistantGoogleReviewDraftRequest(message, match[0].toLowerCase()))) return ["generateGoogleReviewReplyDraft"];
  if ([1, 2, 3, 4, 5, 6].some(id => isInrAssistantStudioForgetPreferenceRequest(message, id))) return ["forgetStudioPreferenceBlock"];
  if (inrAssistantClauseIsAdvice(t)) return result;
  if (/^(?:si|quand|lorsque|if|when|unless|imagin\w*|suppos\w*)\b/.test(t)) return result;
  if (isInrAssistantMediaQuoteRequest(message)) return result;
  for (const operation of ["accept", "discard"] as const) if (isInrAssistantMediaPreviewDecisionRequest(message,operation)) return [operation === "accept"?"acceptMediaGeneration":"discardMediaGeneration"];
  const communication = readInrAssistantCommunicationIntent(message);
  if (communication.campaignDraftEdit) return ["updateCampaignDraft"];
  if (communication.campaignDraft) return ["prepareCampaignEmail"];
  if (communication.campaignAudiencePreview) return ["previewCampaignAudience"];
  if (campaignSenderSelectionRequested(message)) return ["selectCampaignMailbox"];
  if (isInrAssistantLocalInterfaceRequest(message)) return ["controlLocalInterface"];
  if (/^(?:(?:peux|pourrais)[- ]tu\s+|(?:pouvez|pourriez)[- ]vous\s+)?(?:lis|lire|consulte\w*|cherche\w*|recherch\w*|retrouv\w*|liste\w*|regarde\w*|montre\w*|affiche\w*|ouvre\w*|indique\w*|compare\w*|verifi\w*|quels?|quelles?|combien)\b/.test(t)) return result;
  if (/^(?:ne\b|n['’]|not\b|never\b|don't\b|do not\b)/.test(t.trim()) || /\b(?:ne|sans|not|never)\b.{0,20}\b(?:modifi|cre|gener|publ|envoi)/.test(t)) {
    // The media guard distinguishes generating a temporary preview from saving
    // or publishing it. A refusal of those separate actions does not revoke it.
    if (permitsInrAssistantMediaAction(message, "generate", "image") || permitsInrAssistantMediaAction(message, "generate", "video")) result.push("generateMedia");
    if (permitsInrAssistantMediaAction(message, "modify")) result.push("modifyMedia");
    return result;
  }
  if (/\bnotifications?\b/.test(t) && /\b(?:supprim\w*|retir\w*|effac\w*|delete|remove)\b/.test(t)) return ["applyNotificationRemoval"];
  if (/notifications?/.test(t) && /\b(?:marque\w*|classe\w*)\b/.test(t) && /\blues?\b/.test(t)) return ["markNotificationsRead"];
  if (isInrAssistantApplicationPreferenceRequest(message)) return ["configureApplicationPreferences"];
  if (/cookies?/.test(t) && /\b(?:active|desactive|accepte|refuse|modifie|change|enregistre)\b/.test(t)) return ["configureCookieConsent"];
  if (/\b(?:telecharge\w*|exporte\w*|download)\b/.test(t) && /rgpd|donnees personnelles|factures? d.abonnement|factures? inrcy/.test(t)) return ["prepareAccountDocumentDownload"];
  if (/\b(?:adn|dna)\b/.test(t) && /document|fichier/.test(t) && /supprime|retire|efface/.test(t)) return ["applyBusinessDnaDocumentRemoval"];
  if (/ga4|gsc|search console|google analytics/.test(t) && /deconnect|dissoci/.test(t)) return ["applyWebsiteAnalyticsDisconnection"];
  if ((["analytics", "widget"] as const).some(section => isInrAssistantWebsiteConfigurationRequest(message, section))) return ["updateWebsiteConfiguration"];
  if (/panier moyen|taux de (?:conversion|transformation)|hypotheses? (?:du generateur|des estimations)/.test(t) && /modifie|change|mets|definis|enregistre/.test(t)) return ["updateGeneratorBusinessSettings"];
  const identity = /\b(?:identite|profil entreprise|nom|prenom|societe|raison sociale|adresse|code postal|ville|profession|metier|telephone|email professionnel)\b/.test(t) && /\b(?:modifi\w*|chang\w*|mets|remplac\w*|enregistr\w*|complet\w*|defini\w*)\b/.test(t);
  if (isInrAssistantDnaScheduleRequest(message)) return ["updateBusinessDnaSchedule"];
  if (/parrain|recommandation|referral/.test(t) && /prepare|cree|remplis|envoie|parraine|soumet/.test(t)) return ["applyReferralSubmission"];
  if ((["create","rename","delete"] as const).some(action=>isInrAssistantPinterestBoardRequest(message,action))) return ["applyPinterestBoardMutation"];
  if ((["remove_url","reset"] as const).some(mode=>isInrAssistantWebsiteLifecycleRequest(message,mode))) return ["applyWebsiteReset"];
  if ((["facebook","instagram","threads"] as const).some(channel=>isInrAssistantSocialPreferencesRequest(message,channel))) return ["updateSocialPublicationPreferences"];
  if (identity && !/\b(?:crm|contact|client|prospect|publication|post|image|video|media|cta|bouton|fiche google)\b/.test(t)) return ["updateBusinessIdentity"];
  if (/\b(?:deconnect\w*|dissoci\w*|selectionne\w*|choisis|utilise|remplace\w*)\b/.test(t) && /\b(?:connexion|ressource|page facebook|fiche google|etablissement google|profil instagram|organisation linkedin|tableau pinterest)\b/.test(t)) return ["applyChannelConfiguration"];
  if (/linkedin/.test(t) && /partage|personnel/.test(t) && /active|desactive|modifie|change/.test(t)) return ["updateLinkedInPersonalSharing"];
  if (/\b(?:avis|review)\b/.test(t) && /\b(?:supprim\w*|effac\w*|modifi\w*|corrig\w*|remplac\w*)\b/.test(t) && /reponse/.test(t)) return ["applyGoogleReviewReplyAction"];
  // Settings are a distinct object, even if their defaults mention images,
  // emails or appointments. Do not borrow those nouns for a creation goal.
  const standardCommands = inrAssistantStandardCommands(t);
  if (standardCommands) return standardCommands;
  if ((["inrbadge", "inr_search"] as const).some(channel => isInrAssistantNativePresentationRequest(message, channel))) return ["updateNativeChannelPresentation"];
  if (requestsInrAssistantSettingsChange(message)) return ["updateToolSettings"];
  if (isInrAssistantDocumentTemplateInstruction(message, "create") || isInrAssistantDocumentTemplateInstruction(message, "delete")) return ["applyCommercialTemplateAction"];
  if (/\bfacture\b/.test(t) && /\b(?:marque|marquer|passe|passer|declare)\b/.test(t) && /\bpayee?\b/.test(t)) return ["applyCommercialDocumentAction"];
  if (/\b(?:annule\w*|arret\w*|stop|cancel)\b/.test(t) && /generat|creation/.test(t) && /media|image|video/.test(t)) return ["cancelMediaGeneration"];
  if (permitsInrAssistantMediaAction(message, "generate", "image") || permitsInrAssistantMediaAction(message, "generate", "video")) result.push("generateMedia");
  if (hasInrAssistantMediaSubject(message, "image") && permitsInrAssistantMediaAction(message, "modify")) result.push("modifyMedia");
  if (mediaContext && /\b(?:tags?|titre|metadata|metadonnees|archive\w*|renomm\w*)\b/.test(t) && /\b(?:ajout\w*|mets|modifi\w*|renomm\w*|archive\w*|masqu\w*|retire\w*|add|rename|update)\b/.test(t)) result.push("updateMediaMetadata");
  const publication = /\b(?:publications?|posts?|booster|publie|publier|publish)\b/.test(t);
  const publicationObject = /\b(?:publications?|posts?|booster)\b/.test(t);
  const publicationPurpose = /\b(?:pour|afin de|avant de|a)\s+(?:publier|poster|diffuser)\b/.test(t);
  if (publicationObject && /programm|planifi/.test(t) && /\b(?:corrig\w*|modifi\w*|remplac\w*|ajout\w*|retir\w*|edit|update)\b/.test(t)) return ["editScheduledPublication"];
  const scheduledAction = publicationObject && /\b(?:annul\w*|supprim\w*|reprogramm\w*|deplac\w*|report\w*|decal\w*|reprend\w*|reessai\w*|relanc\w*|retent\w*)\b/.test(t) && /programm|planifi|echec|echou/.test(t);
  if (scheduledAction) result.push(/\b(?:annul\w*|supprim\w*)\b/.test(t)?"cancelScheduledPublication":/\b(?:reprend\w*|reessai\w*|relanc\w*|retent\w*)\b/.test(t)?"retryScheduledPublication":"updateScheduledPublication");
  else if (publication && !publicationPurpose && /\b(?:publie\w*|publier|programme\w*|planifi\w*|schedule|publish|poste\w*)\b/.test(t)) result.push("executePublication");
  else if (publication && (!publicationPurpose || publicationObject) && /\b(?:cree|creer|prepare\w*|redig\w*|ecri\w*|write|draft|propose\w*)\b/.test(t)) result.push("preparePublication");
  if (publicationObject && /\b(?:corrig\w*|modifi\w*|edit|update)\b/.test(t)) result.push("editPublication");
  if (/\b(?:cta|ctas|bouton)\b|appels? a l.action/.test(t) && /\b(?:mets|mettre|configure\w*|fais|ajout\w*|set|use|change\w*|modifi\w*|appliqu\w*)\b/.test(t)) result.push("configureBusinessCta");
  if (/\b(?:adn|dna)\b/.test(t) && /\b(?:complet\w*|rempli\w*|analys\w*|enrich\w*)\b/.test(t)) result.push("startBusinessDnaAnalysis");
  else if (/\b(?:adn|dna|mission|entreprise|services)\b/.test(t) && /\b(?:modifi\w*|ajout\w*|mets|change\w*|enregistre\w*)\b/.test(t)) result.push("updateBusinessDna");
  if (/\b(?:ton|tone|style|vouvoiement|tutoiement|emoji|consignes|langue)\b/.test(t) && /\b(?:modifi\w*|ajout\w*|mets|passe|change\w*|configure\w*|regle\w*)\b/.test(t)) result.push("updateAiConfiguration");
  if (/\b(?:agent|automatisation)\b/.test(t) && /\b(?:configure\w*|active|desactive|regle\w*|programme\w*)\b/.test(t)) result.push("configureAgentAutomation");
  if (/\b(?:abonnement|abonner|souscri\w*|resili\w*|forfait)\b/.test(t) && /\b(?:change\w*|modifi\w*|passe|souscri\w*|resili\w*|annul\w*|prepare\w*)\b/.test(t)) result.push("prepareSubscriptionAction");
  if (/\b(?:avis|review)\b/.test(t) && /\b(?:repond\w*|reply|reponse)\b/.test(t)) result.push("replyToGoogleReview");
  if (/\b(?:devis|factures?|document commercial)\b/.test(t) && !/\b(?:abonnement|stripe|pdf)\b/.test(t) && /\b(?:prepare\w*|cree\w*|creer|redig\w*|etabli\w*|draft)\b/.test(t)) result.push("prepareCommercialDocument");
  if (/\b(?:devis|factures?|document commercial)\b/.test(t) && /\b(?:finalis\w*|valid\w*|fige\w*|confirm\w*)\b/.test(t)) result.push("finalizeCommercialDocument");
  if (/\b(?:devis|factures?|document commercial)\b/.test(t) && /\b(?:modifi\w*|corrig\w*|complet\w*|ajout\w*|change\w*|remplac\w*|update|edit)\b/.test(t)) result.push("updateCommercialDocument");
  const crmTarget = /\b(?:crm|contacts?|clients?|prospects?)\b/.exec(t);
  const otherObject = /\b(?:images?|photos?|videos?|visuels?|logos?|flyers?|affiches?|publications?|posts?|campagnes?|e-?mails?|newsletters?|devis|factures?|agenda|rendez.vous|rdv)\b/.exec(t);
  if (crmTarget && (!otherObject || crmTarget.index < otherObject.index) && /\b(?:ajout\w*|cree|modifi\w*|remplac\w*|supprim\w*|retire|fusionn\w*|add|update|merge|delete)\b/.test(t)) result.push(/fusionn|merge/.test(t)?"mergeCrmContacts":"manageCrmContact");
  const individualMail=/\b(?:mail|email|courriel)\b/.test(t) && !/campagne|newsletter|audience|segment/.test(t) && (/individuel/.test(t) || /@/.test(t));
  if(individualMail && /\b(?:envoi\w*|prepar\w*|redig\w*|ecris)\b/.test(t)) result.push("sendIndividualMail");
  const advertising = isInrAssistantAdvertisingRequest(message);
  if (!individualMail && /\b(?:mail|email|campagne|newsletter)\b/.test(t) && !advertising && !inrAssistantSettingTargets(message).includes("notifications")) {
    if (/\b(?:envoie|envoyer|diffuse|send|programme|schedule)\b/.test(t)) result.push(/\bap-[a-f0-9]{12}\b|(?:tous|mes|segment|audience).{0,35}(?:clients|prospects|contacts)|audience|segment/.test(t)?"dispatchCampaignAudience":"dispatchCampaignDraft");
    else if (/\b(?:modifi\w*|corrig\w*|change\w*)\b/.test(t)) result.push("updateCampaignDraft");
    else if (/\b(?:prepare\w*|cree|redige|ecris)\b/.test(t)) result.push("prepareCampaignEmail");
  }
  if (/\bap-[a-f0-9]{12}\b/.test(t) && /\b(?:envoie|envoyer|diffuse|send|confirme)\b/.test(t)) result.push("dispatchCampaignAudience");
  if (/\b(?:campagne|mail|newsletter)\b/.test(t) && /expediteur|boite|adresse d.envoi/.test(t) && /\b(?:choisis|selectionne|utilise|mets|change|modifie)\b/.test(t)) result.push("selectCampaignMailbox");
  if (/\b(?:agenda|rendez.vous|rdv|calendar)\b/.test(t)) {
    if (/\b(?:refuse\w*|rejette\w*|rejeter)\b/.test(t)) result.push("rejectCalendarAppointment");
    else if (/\b(?:annule|annuler|supprime|cancel)\b/.test(t)) result.push("cancelCalendarAppointment");
    else if (/\b(?:confirme\w*|valide\w*|accepte\w*|finalise\w*)\b/.test(t)) result.push("confirmCalendarAppointment");
    else if (/\b(?:modifi\w*|deplac\w*|report\w*|change\w*|invite\w*)\b/.test(t) || /\b(?:rappels?|invites?)\b/.test(t) && /\b(?:ajoute\w*|active\w*|reactive\w*|desactive\w*|coupe\w*|utilise\w*|choisis|selectionne\w*)\b/.test(t)) result.push("updateCalendarAppointment");
    else if (/\b(?:prepare\w*|cree|ajoute|planifie)\b/.test(t)) result.push("prepareCalendarAppointment");
  }
  if (advertising && /^(?:(?:peux|pourrais)[- ]tu\s+|(?:pouvez|pourriez)[- ]vous\s+)?(?:prepare\w*|cree\w*|mets?\b.{0,30}\bpause|pause|arret\w*|suspend\w*|modifi\w*|change\w*|supprime\w*|repren\w*)\b/.test(t)) result.push(/\b(?:pause|arret\w*|suspend\w*|modifi\w*|change\w*|supprime\w*|repren\w*)\b/.test(t)?"manageAdvertisingCampaign":"prepareAdvertisingCampaign");
  return [...new Set(result)];
}
/** A transcript is never a grant. Only server-stored, scoped, recent pending work qualifies. */
export function continueInrAssistantTask(current: string, task: InrAssistantTaskState | null | undefined, now = Date.now(), intent?: "continue" | "check_status"): string | null {
  if (!task || task.version !== 1 || !["needs_input","partial","processing"].includes(task.outcome) || !Number.isFinite(Date.parse(task.expiresAt)) || !Number.isFinite(Date.parse(task.startedAt)) || Date.parse(task.expiresAt) <= now || Date.parse(task.startedAt) > now || current.length > 1800) return null;
  if(task.receipts.some(receipt=>INR_ASSISTANT_UNCERTAIN_STATUSES.has(receipt.status))) return null;
  const answer = current.trim(), t = normalize(answer);
  if (!answer || /```|^>|[«»]|\b(?:annule|stop|arrete|oublie|ignore|autre|different|ne|pas|jamais|not|never|cancel)\b|mot de passe|password|token|cle api|api.?key/.test(t)) return null;
  const approvedReference=t.match(/\bia-[a-f0-9]{12}\b/i)?.[0];
  if (task.uiSteps?.length && (intent === "continue" || intent === "check_status" || /^(?:continuer?|reprends|termine|poursuis)[.!\s]*$/.test(t))) return task.instruction;
  if(approvedReference && /^(?:confirme|valide|applique|confirm|approve)\b/.test(t) && task.receipts.some(receipt=>receipt.approvalToken && receipt.approvalReference?.toLowerCase()===approvedReference)) {
    return `${task.instruction}\nValidation actuelle de cet aperçu uniquement : ${answer}`.slice(0,4000);
  }
  if (task.outcome === "processing" || intent === "check_status") {
    if (!task.receipts.some(receipt=>receipt.ok && INR_ASSISTANT_PENDING_STATUSES.has(receipt.status))) return null;
    if (!intent && !/^(?:continue|reprends|verifie|verifier|actualise|suivi|statut|etat|ou en|est.ce (?:fini|termine)|c.est (?:fini|termine)|check|status|refresh)\b/.test(t)) return null;
    return `Vérifie uniquement l’état des opérations déjà lancées de cette tâche, sans les relancer. Demande initiale : « ${task.instruction.replace(/[«»]/g, "")} »`;
  }
  if (/^(?:comment|pourquoi|explique|how|why|what|qui|quel|quand|ou)\b/.test(t)) return null;
  const previous = inrAssistantRoutingText(task.instruction), question = inrAssistantRoutingText(task.question);
  const remaining = task.requiredTools.filter(name=>!inrAssistantGoalCompleted(name, task.receipts, task.requiredCalls));
  if (isInrAssistantAffirmation(answer) && task.outcome === "needs_input" &&
    /(?:voulez|souhaitez|puis.je|dois.je|would you|should i|shall i)/.test(question) && /(?:lanc|gener|creer|create|generate)/.test(question) &&
    task.requiredTools.includes("generateMedia") && !task.receipts.some(receipt => ["generateMedia", "modifyMedia"].includes(receipt.tool)) &&
    (permitsInrAssistantMediaAction(task.instruction, "generate", "image") || permitsInrAssistantMediaAction(task.instruction, "generate", "video"))) return task.instruction;
  if ((intent === "continue" || /^(?:continue|reprends|termine|poursuis|oui[, ]+continue|oui[, ]+termine)\b/.test(t)) && task.outcome === "partial" && remaining.length) return task.instruction;
  if (task.requiredTools.includes("configureBusinessCta") && /\b(?:telephone|tel|numero|site|website|web)\b/.test(t) && /\b(?:cta|ctas|canaux|partout)\b/.test(previous)) {
    if (/\b(?:telephone|tel|numero)\b/.test(t) === /\b(?:site|website|web)\b/.test(t)) return null;
    const scope = /\b(?:tous|toutes|partout|all)\b/.test(t) ? "tous mes canaux" : /\b(?:tous|toutes|partout|all)\b/.test(previous) ? "tous mes canaux" : (task.instruction.match(/\b(?:Facebook|Instagram|LinkedIn|Google|TikTok|YouTube|Pinterest|Threads|Twitter)\b/gi)??[]).join(", ");
    if (!scope) return null;
    return `Configure mes CTA avec mon ${/\b(?:telephone|tel|numero)\b/.test(t)?"téléphone":"site web"} dans ${scope}. Précision actuelle : ${answer}`;
  }
  if (task.requiredTools.includes("updateAiConfiguration") && /ton|tone|style|tutoiement|vouvoiement/.test(previous) && /ton|tone|style|souhait|choisi/.test(question) && !/\b(?:publie|envoie|cree|supprime|ajoute|mets|programme)\b/.test(t)) return `Modifie le ton de mes contenus et ma configuration IA : ${answer}`;
  if (task.requiredTools.some(x=>["startBusinessDnaAnalysis","updateBusinessDna"].includes(x)) && /\b(?:mission|description|services|prestations|valeurs)\b/.test(question) && !/\b(?:publie|envoie|supprime|programme)\b/.test(t)) {
    const field = question.match(/\b(?:mission|description|services|prestations|valeurs)\b/)![0];
    return `Modifie l’ADN de mon entreprise, ${field} : ${answer}`;
  }
  if (task.requiredTools.includes("executePublication") && /\b(?:demain|aujourd.hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{4}-\d{2}-\d{2})\b/.test(t) && /\b\d{1,2}\s*(?:h|:[0-5]\d)/.test(t)) return `Programme ma publication. ${answer} ${task.instruction}`.slice(0,4000);
  if (task.requiredTools.includes("generateMedia") && /sujet|format|souhait|brief/.test(question)) {
    if (isInrAssistantAffirmation(answer) || /\b(?:publie|envoie|supprime|execute|programme|contact|crm)\b/.test(t)) return null;
    const format = /^(?:format\s+)?(?:carre|square|portrait|paysage|landscape|story|vertical|horizontal)[.!\s]*$/.test(t);
    if (format && /format/.test(question)) return `${task.instruction}\nFormat choisi : ${answer}`.slice(0,4000);
    if (/\b(?:image|photo|visuel|video)\b/.test(t)) return `Crée ${answer}. ${task.instruction}`.slice(0,4000);
    if (/sujet|brief/.test(question) && answer.length >= 3 && answer.length <= 800) return `${task.instruction}\nSujet précisé par le professionnel : « ${answer.replace(/[«»]/g, "")} »`.slice(0,4000);
  }
  if (task.requiredTools.includes("dispatchCampaignDraft") && /\b(?:envoie|envoyer|send|programme|schedule)\b/.test(t) && /@/.test(answer)) return `${answer} Cette demande concerne le brouillon de campagne mail préparé.`;
  if (task.requiredTools.includes("updateCalendarAppointment") && /\b\d{1,2}\s*(?:h|:[0-5]\d)/.test(t) && /heure|date|quand/.test(question)) return `Déplace mon rendez-vous dans mon agenda : ${answer}. ${task.instruction}`.slice(0,4000);
  // Generic slot completion is bounded by the server's *unfinished* command,
  // its original intent and its actual question. It cannot authorize another
  // action, add a dispatch/payment, or replay something already confirmed.
  if (task.outcome === "needs_input" && remaining.length === 1 && !isInrAssistantAffirmation(answer)) {
    const name=remaining[0], command=INR_ASSISTANT_COMMANDS[name];
    const newGoals=inrAssistantRequiredTools(answer);
    const forbidden=/\b(?:publie\w*|envoi\w*|diffuse\w*|supprim\w*|effac\w*|paye\w*|achete\w*|execute\w*|contacte\w*|publish|send|delete|pay|buy)\b/;
    const changesScope=/\b(?:autre compte|autre etablissement|administrateur|admin|systeme|system|permissions?|droits|authorization)\b/;
    if (command?.clarification?.test(question) && inrAssistantRequiredTools(task.instruction).includes(name)
      && !forbidden.test(t) && !changesScope.test(t) && newGoals.length === 0) {
      // A complete different command must stand alone; field-only replies can
      // refine the saved target, never replace it with a second target.
      const differentTarget=inrAssistantSettingTargets(answer).some(target=>!inrAssistantSettingTargets(task.instruction).includes(target));
      if (name === "updateToolSettings" && differentTarget) return null;
      return `${task.instruction}\nPrécision actuelle pour cette seule action : ${answer}`.slice(0,4000);
    }
  }
  return null;
}
export function isInrAssistantAffirmation(value: string): boolean {
  return /^(?:oui|oui[, ]+(?:vas.y|lance(?:.la|.le)?|cree(?:.la|.le)?|confirme|d.accord)|ok|d.accord|vas.y|yes|yes[, ]+(?:please|go ahead)|si|ja)[.!\s]*$/.test(normalize(value.trim()));
}
export function inrAssistantRequiredCalls(message: string): Record<string, number> {
  const numbers: Record<string, number> = {deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,neuf:9,dix:10,two:2,three:3,four:4,five:5};
  const counts: Record<string,number>={};
  const settingsTargets=new Set(message.split(/\s+(?:puis|ensuite|et|and|then)\s+(?=(?:modifi|chang|mets|coup|desactiv|activ|regl|configure|publie|cree|envoie|disable|enable|set|publish|send)\w*\b)|[;\n]/i).filter(clause=>requestsInrAssistantSettingsChange(clause)).flatMap(clause=>inrAssistantSettingTargets(clause)));
  if(settingsTargets.size>1) counts.updateToolSettings=settingsTargets.size;
  for (const objective of inrAssistantActionObjectives(message)) {
    const name = objective.tool;
    const object=INR_ASSISTANT_COMMANDS[name]?.batchObject;
    if (!object) continue;
    const match=objective.instruction.match(new RegExp(`\\b(\\d{1,6}|${Object.keys(numbers).join("|")})\\s+(?:(?:nouveaux?|nouvelles?)\\s+)?(?:${name === "prepareCampaignEmail" ? "brouillons?|" : ""}${object})\\b`));
    const count=match ? numbers[match[1]] ?? Number(match[1]) : 1;
    counts[name]=(counts[name]??0)+count;
  }
  return Object.fromEntries(Object.entries(counts).filter(([,count])=>count>1));
}
/** Refuse oversized work before exposing a mutating tool, including on resume. */
export function inrAssistantTaskTrackingLimit(requiredTools: string[], requiredCalls: Record<string, number> = {}): string | null {
  const tracked = new Set(requiredTools);
  // Publishing can save a draft before dispatch; its native receipt also needs
  // to survive a partial task so a continuation cannot prepare it a second time.
  if (tracked.has("executePublication")) tracked.add("preparePublication");
  const counts = [...tracked].map(name => requiredCalls[name] ?? 1);
  return counts.some(count => !Number.isSafeInteger(count) || count < 1) || counts.reduce((total, count) => total + count, 0) > INR_ASSISTANT_MAX_TRACKED_ACTIONS
    ? `Cette demande dépasse la limite de suivi de ${INR_ASSISTANT_MAX_TRACKED_ACTIONS} actions. Répartissez-la en plusieurs demandes plus petites avant de lancer les opérations. Aucune nouvelle action n’a été lancée.` : null;
}
const confirmedReceipt = isInrAssistantAcceptedReceipt;
const receiptRecordId = (receipt: InrAssistantActionReceipt) => receipt.id ?? receipt.recordId ?? receipt.eventId ?? receipt.draftId;
/** Keep every distinct confirmation, not the last N events. Repeated failures
 * or retries must never push an earlier saved record out of private task state. */
export function compactInrAssistantTaskReceipts(receipts: InrAssistantActionReceipt[], requiredTools: string[], requiredCalls: Record<string, number> = {}): InrAssistantActionReceipt[] {
  const confirmed = new Map<string, InrAssistantActionReceipt>();
  const unconfirmed = new Map<string, InrAssistantActionReceipt>();
  for (const receipt of receipts) {
    if (confirmedReceipt(receipt)) {
      const identity = receiptRecordId(receipt) ?? receipt.requestId ?? receipt.scheduledActionId ?? receipt.publicationId ?? "single";
      confirmed.set(`${receipt.tool}:${identity}`, receipt);
    } else unconfirmed.set(`${receipt.tool}:${receipt.approvalReference??(INR_ASSISTANT_UNCERTAIN_STATUSES.has(receipt.status)?receiptRecordId(receipt)??receipt.requestId??"uncertain":"single")}`, receipt);
  }
  const result = [...confirmed.values()];
  for (const receipt of unconfirmed.values()) {
    const name=receipt.tool;
    if (INR_ASSISTANT_UNCERTAIN_STATUSES.has(receipt.status) || receipt.approvalToken && receipt.approvalReference || !inrAssistantGoalCompleted(name, result, requiredCalls) && (requiredTools.includes(name) || !result.some(item => item.tool === name))) result.push(receipt);
  }
  return result;
}
export function inrAssistantGoalCompleted(name: string, receipts: InrAssistantActionReceipt[], requiredCalls: Record<string, number> = {}): boolean {
  const successful = receipts.filter(receipt => receipt.tool === name && confirmedReceipt(receipt));
  const count = requiredCalls[name] ?? 1;
  if (count <= 1) return successful.length > 0;
  return new Set(successful.flatMap(receipt => { const id = receiptRecordId(receipt); return id ? [id] : []; })).size >= count;
}
export function inrAssistantTaskOutcome(required: string[], receipts: InrAssistantActionReceipt[], question: string, requiredCalls: Record<string, number> = {}): InrAssistantTaskOutcome {
  if(receipts.some(receipt=>INR_ASSISTANT_UNCERTAIN_STATUSES.has(receipt.status))) return "blocked";
  if (!required.length) return "completed";
  const achieved = (name: string) => inrAssistantGoalCompleted(name, receipts, requiredCalls);
  if (required.every(achieved)) return receipts.some(r=>r.ok&&INR_ASSISTANT_PENDING_STATUSES.has(r.status))?"processing":"completed";
  if (receipts.some(receipt => ["prepareGoogleBusinessDraftReview", "prepareStudioDraftReview"].includes(receipt.tool) && receipt.status === "confirmation_required" || receipt.status === "preview_ready" && receipt.approvalReference)) return "needs_input";
  if (receipts.some(r=>r.ok)) return "partial";
  if (/\?|pr[eé]cis|quel|indique|manqu|choisi/.test(question)) return "needs_input";
  return receipts.length ? "blocked" : "needs_input";
}
