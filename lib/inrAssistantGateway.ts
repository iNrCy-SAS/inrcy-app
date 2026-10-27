import "server-only";

import { asSchema, createGateway, generateText, jsonSchema, stepCountIs, tool, wrapLanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { assistantToolsForEdition, isBasicAssistantExecutionRequest, BASIC_ASSISTANT_EXECUTION_NOTICE } from "./inrAssistantEditionPolicy.ts";
import { getAiGatewayCredential } from "@/lib/aiGatewayConfig";
import {
  AiGatewayGuardUnavailableError,
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { getConfiguredAiGatewayModelPricing } from "@/lib/aiGatewayEconomics";
import { recordAiGatewayOperationCall } from "@/lib/aiGatewayOperationTelemetry";
import { isUpstashEnabled } from "@/lib/upstashMode";
import {
  classifyInrAssistantRequest,
  getInrAssistantModelChain,
  INR_ASSISTANT_MODELS,
  INR_ASSISTANT_MODEL_PRICING,
  type InrAssistantModel,
} from "./inrAssistantPolicy.ts";
import { reserveInrAssistantRequest, finalizeInrAssistantRequest } from "./inrAssistantQuota.ts";
import { buildInrAssistantSystemPrompt, InrAssistantInputError, type InrAssistantMessage } from "./inrAssistantConversation.ts";
import { getInrAssistantAppKnowledge, createInrAssistantAppGuideTool, getVerifiedInrAssistantNavigation } from "./inrAssistantAppGuides.ts";
import { createInrAssistantMediaTools, type InrAssistantMediaResult } from "./inrAssistantMediaTools.ts";
import { createInrAssistantAccountTools } from "./inrAssistantAccountTools.ts";
import { createInrAssistantDiagnosticsTools } from "./inrAssistantDiagnosticsTools.ts";
import { createInrAssistantWorkspaceTools } from "./inrAssistantWorkspaceTools.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { createInrAssistantMemoryTools, type InrAssistantMemoryReader } from "./inrAssistantMemoryTools.ts";
import { selectInrAssistantToolFamilies, inrAssistantRoutingText, inrAssistantRequiredTools, inrAssistantTaskOutcome, verifiedInrAssistantCapabilityLimit } from "./inrAssistantToolRouting.ts";
import type { InrAssistantTaskState, InrAssistantTaskOutcome, InrAssistantActionReceipt } from "./inrAssistantTaskPolicy.ts";
import { createInrAssistantBusinessTools } from "./inrAssistantBusinessTools.ts";
import { createInrAssistantManagementTools } from "./inrAssistantManagementTools.ts";
import { createInrAssistantPublicationTools, type InrAssistantPublicationResult } from "./inrAssistantPublicationTools.ts";
import { createInrAssistantWorkspaceActionTools } from "./inrAssistantWorkspaceActionTools.ts";
import { createInrAssistantInsightsTools } from "./inrAssistantInsightsTools.ts";
import { createInrAssistantCtaTools } from "./inrAssistantCtaTools.ts";
import { createInrAssistantDnaAnalysisTools } from "./inrAssistantDnaAnalysisTools.ts";
import { withInrAssistantToolActivities, type InrAssistantActivityCallback } from "./inrAssistantActivity.ts";
import { createInrAssistantCommercialTools } from "./inrAssistantCommercialTools.ts";
import { createInrAssistantCommunicationTools } from "./inrAssistantCommunicationTools.ts";
import { createInrAssistantAdvertisingTools } from "./inrAssistantAdvertisingTools.ts";
import { createInrAssistantSettingsTools } from "./inrAssistantSettingsTools.ts";
import { classifyInrAssistantGatewayFailure, projectInrAssistantGatewayDiagnostic, recordInrAssistantGatewayDiagnostic,
  type InrAssistantDiagnosticPhase, type InrAssistantGatewayDiagnostic } from "./inrAssistantGatewayDiagnostics.ts";
import { assistantModelInputBudget } from "./inrAssistantAttachments.ts";
import { assistantMessagesWithFiles } from "./inrAssistantAttachmentPrompt.ts";
import type { AssistantFileContext } from "./inrAssistantAttachmentStorage.ts";
import { compactInrAssistantGuideContext } from "./inrAssistantPromptContext.ts";

const supportTool = tool({
  description: "Préparer une proposition d’aide par un humain quand le pro la demande, qu’un accès administrateur est nécessaire ou qu’un blocage ne peut pas être résolu de façon fiable. Rien n’est envoyé : le pro doit vérifier le résumé et choisir de contacter l’équipe.",
  inputSchema: jsonSchema<{ message: string; summary: string }>({
    type: "object", properties: {
      message: { type: "string", description: "Message concis dans la langue du pro expliquant la limite et proposant de vérifier le résumé avant de contacter l’équipe. Ne jamais dire que la transmission est faite.", maxLength: 1_500 },
      summary: { type: "string", description: "Besoin, blocage, éléments connus et étapes déjà essayées. Ne pas inventer d’étape, ne pas inclure de mot de passe ou de secret.", maxLength: 2_000 },
    }, required: ["message", "summary"], additionalProperties: false,
  }, { validate: (value) => {
    const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (Object.keys(input).some((key) => !["message", "summary"].includes(key)) ||
      typeof input.message !== "string" || !input.message.trim() || input.message.length > 1_500 ||
      typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > 2_000) {
      return { success: false, error: new Error("Invalid human-support proposal") };
    }
    return { success: true, value: { message: input.message.trim(), summary: input.summary.trim() } };
  } }),
});

export type InrAssistantReply = { message: string; needsHuman?: boolean; handoffSummary?: string; media?: InrAssistantMediaResult; outcome?: InrAssistantTaskOutcome; taskState?: InrAssistantTaskState };

export class InrAssistantUnavailableError extends Error {
  code = "assistant_unavailable";
  declare readonly diagnostic?: InrAssistantGatewayDiagnostic;
  constructor(diagnostic?: InrAssistantGatewayDiagnostic) {
    super("L’assistant est momentanément indisponible. Merci de réessayer dans quelques instants.");
    const safeDiagnostic = projectInrAssistantGatewayDiagnostic(diagnostic);
    if (safeDiagnostic) Object.defineProperty(this, "diagnostic", { value: safeDiagnostic, enumerable: false });
  }
}

function guardCost(model: InrAssistantModel, inputTokens: number, outputTokens: number) {
  const base = INR_ASSISTANT_MODEL_PRICING[model];
  const configured = getConfiguredAiGatewayModelPricing(model);
  // Guard estimates allow for cache-write premiums; they are not customer billing.
  return Math.ceil(inputTokens * Math.max(base.inputUsdPerMillion, configured?.inputUsdPerMillion ?? 0) * 1.25 +
    outputTokens * Math.max(base.outputUsdPerMillion, configured?.outputUsdPerMillion ?? 0));
}

export async function generateInrAssistantReply(args: {
  accountId: string;
  actorUserId?: string;
  displayName: string;
  edition: DashboardEdition;
  requestId: string;
  actionRequestId?: string;
  actionStartedAt?: string;
  request: Request;
  messages: InrAssistantMessage[];
  accountContext?: unknown;
  clientContext?: InrAssistantClientContext | null;
  memory?: InrAssistantMemoryReader;
  turnId?: string;
  supabase?: Pick<SupabaseClient, "from">;
  signal?: AbortSignal;
  onActivity?: InrAssistantActivityCallback;
  fileContexts?: AssistantFileContext[];
  /** Server-resolved pending task only, never an HTTP body field. */
  actionInstruction?: string;
  taskContext?: InrAssistantTaskState;
}): Promise<InrAssistantReply> {
  const diagnosticStartedAt = Date.now();
  let lastFailure: InrAssistantGatewayDiagnostic | undefined;
  const note = (phase: InrAssistantDiagnosticPhase, fields: Partial<InrAssistantGatewayDiagnostic> = {}) =>
    recordInrAssistantGatewayDiagnostic({ ...fields, requestId: args.requestId, phase, elapsedMs: Date.now() - diagnosticStartedAt });
  const noteFailure = (phase: InrAssistantDiagnosticPhase, fields: Partial<InrAssistantGatewayDiagnostic> = {}) => {
    lastFailure = note(phase, fields); return lastFailure;
  };
  const spokenRequest = args.messages.at(-1)?.content ?? "";
  const latestRequest = args.actionInstruction ?? spokenRequest;
  if (args.edition === "basic" && isBasicAssistantExecutionRequest(latestRequest)) return { message: BASIC_ASSISTANT_EXECUTION_NOTICE };
  const capabilityLimit = verifiedInrAssistantCapabilityLimit(latestRequest,args.edition);
  if (capabilityLimit) return {message:capabilityLimit,outcome:"blocked"};
  const families = selectInrAssistantToolFamilies(latestRequest, args.messages.filter(message => message.role === "user").slice(0, -1).map(message => message.content));
  const canExecute = args.edition !== "basic";
  const verifiedNavigation = getVerifiedInrAssistantNavigation(latestRequest);
  if (verifiedNavigation && !args.fileContexts?.length) {
    const navigationQuota = await reserveInrAssistantRequest({
      billingAccountId: args.accountId, requestId: args.requestId, edition: args.edition, complexity: "routine",
    });
    await finalizeInrAssistantRequest(navigationQuota, { success: true });
    return { message: verifiedNavigation };
  }
  const credential = getAiGatewayCredential();
  if (!credential) throw new InrAssistantUnavailableError(noteFailure("credential_missing"));
  // The shared guard permits local development without Redis. Production
  // Assistant must never silently disable economic limits when Redis is absent.
  if (process.env.NODE_ENV === "production" && !isUpstashEnabled()) {
    noteFailure("redis_reserve"); throw new AiGatewayGuardUnavailableError();
  }
  let system = buildInrAssistantSystemPrompt(args.displayName, args.accountContext, getInrAssistantAppKnowledge(latestRequest, 2_400), args.edition, args.clientContext, Boolean(args.fileContexts?.length));
  const messages = assistantMessagesWithFiles(args.messages.map((message,index)=>index === args.messages.length-1 && latestRequest !== spokenRequest ? {...message,content:latestRequest} : message), args.fileContexts ?? []);
  const bytes = assistantModelInputBudget;
  const complexity = classifyInrAssistantRequest(latestRequest);
  const requiredTools = canExecute ? [...new Set([...(args.taskContext?.requiredTools ?? []), ...inrAssistantRequiredTools(latestRequest)])] : [];
  const maxCalls = complexity === "complex" || requiredTools.length > 1 ? 12 : requiredTools.length ? 7 : 4;
  const gateway = createGateway({ apiKey: credential });
  const maxOutputTokens = complexity === "complex" ? 6_000 : 1_800;
  const started = Date.now();
  let deadline = started + (maxCalls > 7 ? 240_000 : 100_000);
  let llmCalls = 0;
  let economicFailure: unknown;
  const mediaState: { result?: InrAssistantMediaResult; requestId?: string } = {};
  const publicationResults: InrAssistantPublicationResult[] = [];
  const actionFacts = new Map<string, { message: string; label?: string; href?: string }>();
  const receipts: InrAssistantActionReceipt[] = [...(args.taskContext?.receipts ?? [])];
  const readCounts = new Map<string,number>();
  const observedActionNames = new Set(["updateBusinessDna", "updateAiConfiguration", "configureBusinessCta", "startBusinessDnaAnalysis", "configureAgentAutomation", "prepareSubscriptionAction", "preparePublication", "executePublication", "editPublication", "updateMediaMetadata", "prepareCampaignEmail", "prepareCalendarAppointment", "replyToGoogleReview"]);
  for (const name of ["manageCrmContact", "prepareCommercialDocument", "updateCampaignDraft", "dispatchCampaignDraft", "updateCalendarAppointment", "prepareAdvertisingCampaign", "manageAdvertisingCampaign", "updateToolSettings"]) observedActionNames.add(name);
  for (const name of ["generateMedia","modifyMedia","mergeCrmContacts","cancelCalendarAppointment"]) observedActionNames.add(name);
  const savedActionReply = () => [...actionFacts.values()].map(fact => `${fact.message}${fact.href ? `\n\n[${fact.label ?? "Ouvrir l’outil"}](${fact.href})` : ""}`).join("\n\n");
  const followupAfterMedia = families.has("publication") || families.has("business") && /\b(?:adn|dna|configuration|reglages)\b/i.test(latestRequest);
  const mediaTools = canExecute && families.has("media") ? createInrAssistantMediaTools({
    request: args.request, requestId: args.actionRequestId ?? args.requestId,
    currentUserMessage: latestRequest,
    canStartWork: () => deadline - Date.now() > 20_000,
    onWorkStarted: (requestId) => { mediaState.requestId = requestId; deadline = started + 780_000; },
    onResult: (result) => { mediaState.result = result; },
  }) : {};
  const accountTools = (() => {
    if (!args.supabase) return {};
    const available = createInrAssistantAccountTools({ supabase: args.supabase, accountId: args.accountId });
    return {
      ...(args.edition === "basic" || families.has("business") || families.has("media") || families.has("publication") ? { getBusinessDna: available.getBusinessDna } : {}),
      ...(families.has("media") || families.has("publication") ? { searchMedia: available.searchMedia } : {}),
      ...(families.has("publication") ? { getRecentPublications: available.getRecentPublications } : {}),
    };
  })();
  const diagnosticTools = args.supabase && /(?:erreur|error|bloqu|impossible|echec|failed|bug|ne fonctionne|probleme|diagnosti|日志|错误)/i.test(latestRequest) ? createInrAssistantDiagnosticsTools({ supabase: args.supabase, accountId: args.accountId, edition: args.edition }) : {};
  const workspaceTools = args.supabase ? createInrAssistantWorkspaceTools({ supabase: args.supabase, accountId: args.accountId, edition: args.edition, request: args.request }) : {};
  const memoryTools = args.memory ? createInrAssistantMemoryTools({ memory: args.memory, excludeTurnId: args.turnId }) : {};
  const topic = inrAssistantRoutingText(latestRequest);
  const routingTopic = inrAssistantRoutingText([latestRequest,...args.messages.filter(m=>m.role === "user").slice(-3,-1).map(m=>m.content)].join(" "));
  const businessTools = (() => {
    if (!canExecute || !args.supabase || !families.has("business")) return {};
    const available = createInrAssistantBusinessTools({ request: args.request, accountId: args.accountId, supabase: args.supabase, edition: args.edition, currentUserMessage: latestRequest });
    return {
      ...(/(?:\badn\b|\bdna\b|entreprise|business|horaires|prestations|services|mission|valeurs)/.test(topic) && /(?:ajout|rempli|complet|modifi|mets|mettez|remplac|enrich|enregistr|sauvegard|update|fill|save)/.test(topic) ? { updateBusinessDna: available.updateBusinessDna } : {}),
      ...(/(?:configuration|reglages|\bia\b|\bai\b|emoji|consignes|\bton\b|tutoiement|vouvoiement)/.test(topic) ? { updateAiConfiguration: available.updateAiConfiguration } : {}),
      ...(/(?:connect|connexion)/.test(topic) ? { guideChannelConnection: available.guideChannelConnection } : {}),
    };
  })();
  const ctaTools = canExecute && args.supabase && /(?:\bctas?\b|appels? a l.action|\bbouton\b.{0,70}(?:appeler|telephone|facebook|site)|(?:telephone|numero|site|website|lien).{0,70}(?:partout|tous|toutes|contenus|publications|canaux|bouton)|(?:tous|toutes).{0,70}(?:telephone|site|website|lien))/.test(routingTopic)
    ? createInrAssistantCtaTools({ request: args.request, accountId: args.accountId, supabase: args.supabase,
      currentUserMessage: latestRequest, canStartWork: () => deadline - Date.now() > 15_000 }) : {};
  const dnaAnalysisTools = args.edition !== "basic" && args.supabase && /\b(?:adn|dna)\b/.test(topic) && /(?:analys|complet|rempli|enrich|suivi|etat|resultat|termine)/.test(topic)
    ? createInrAssistantDnaAnalysisTools({ request: args.request, accountId: args.accountId, supabase: args.supabase,
      currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      actionStartedAt: args.actionStartedAt,
      canStartWork: () => deadline - Date.now() > 15_000 }) : {};
  const managementTools = (() => {
    if (!canExecute || !args.actorUserId || !families.has("management")) return {};
    const available = createInrAssistantManagementTools({ request: args.request, accountId: args.accountId, actorUserId: args.actorUserId,
      edition: args.edition, currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId });
    return {
      ...(/(?:abonn|souscri|resili|facturation|standard|premium|founder|stripe)/.test(topic) ? { prepareSubscriptionAction: available.prepareSubscriptionAction } : {}),
      ...(/(?:agent|automatis|planning)/.test(topic) ? { configureAgentAutomation: available.configureAgentAutomation } : {}),
    };
  })();
  const publicationTools = (() => {
    if (!canExecute || !args.supabase || !families.has("publication")) return {};
    const available = createInrAssistantPublicationTools({ request: args.request, accountId: args.accountId, supabase: args.supabase,
      currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      canStartWork: () => deadline - Date.now() > 15_000, onResult: result => { publicationResults.push(result); } });
    return {
      preparePublication: available.preparePublication,
      ...(/(?:publie|publier|publish|programme|programmer|schedule)/.test(routingTopic) ? { executePublication: available.executePublication } : {}),
      ...(/(?:modifi|corrig|chang|\bedit)/.test(topic) ? { editPublication: available.editPublication } : {}),
      ...(/(?:statut|status|etat|deja|suivi|verifi|resultat|en cours)/.test(topic) ? { getPublicationStatus: available.getPublicationStatus } : {}),
    };
  })();
  const workspaceActionTools = (() => {
    if (!canExecute || !args.supabase || !families.has("workspace") && !families.has("media")) return {};
    const available = createInrAssistantWorkspaceActionTools({ request: args.request, accountId: args.accountId, supabase: args.supabase, edition: args.edition,
      currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId, canStartWork: () => deadline - Date.now() > 15_000 });
    return {
      ...(/(?:renomm|titres?|tags?|archive|masqu|reactiv|metadata)/.test(topic) ? { updateMediaMetadata: available.updateMediaMetadata } : {}),
      ...(/(?:campagne|email|e-mail|\bmail|newsletter|courriel|fidelis|propuls)/.test(topic) ? { prepareCampaignEmail: available.prepareCampaignEmail } : {}),
      ...(/(?:agenda|calendar|rendez.vous|\brdv\b)/.test(topic) ? { prepareCalendarAppointment: available.prepareCalendarAppointment } : {}),
      ...(/(?:\bcrm\b|client|prospect|contact)/.test(topic) ? { searchCrmContacts: available.searchCrmContacts } : {}),
    };
  })();
  const insightsTools = (() => {
    if (args.edition === "basic" || !args.supabase) return {};
    const available = createInrAssistantInsightsTools({ request: args.request, accountId: args.accountId, supabase: args.supabase, currentUserMessage: latestRequest });
    return {
      ...(/(?:stats|statisti|resultat|impression|performan)/.test(topic) ? { readStatsSnapshots: available.readStatsSnapshots } : {}),
      ...(/(?:reputation|\bavis\b|review)/.test(topic) ? { readGoogleReviews: available.readGoogleReviews, replyToGoogleReview: available.replyToGoogleReview } : {}),
    };
  })();
  const commercialTools = (() => {
    if (!canExecute || !args.supabase || !families.has("commercial")) return {};
    const available = createInrAssistantCommercialTools({ request: args.request, accountId: args.accountId, supabase: args.supabase,
      edition: args.edition, currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      canStartWork: () => deadline - Date.now() > 15_000 });
    return {
      ...(/(?:ajout|cre|modifi|corrig|chang|supprim|effac|retire|update|delete).{0,60}(?:contact|client|prospect)|(?:contact|client|prospect).{0,60}(?:ajout|cre|modifi|corrig|chang|supprim|effac|retire|update|delete)/.test(topic) ? { manageCrmContact: available.manageCrmContact } : {}),
      ...(/(?:devis|facture|document commercial|encaisser)/.test(topic) && !/(?:facture.{0,20}abonnement|facture.{0,20}stripe)/.test(topic) ? { prepareCommercialDocument: available.prepareCommercialDocument } : {}),
    };
  })();
  const communicationTools = (() => {
    if (!canExecute || !args.supabase || !families.has("workspace")) return {};
    const available = createInrAssistantCommunicationTools({ request: args.request, accountId: args.accountId, actorUserId: args.actorUserId,
      supabase: args.supabase, edition: args.edition, currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      canStartWork: () => deadline - Date.now() > 15_000 });
    const mail = /(?:campagne|email|e-mail|\bmail|newsletter|courriel|fidelis|propuls)/.test(routingTopic);
    const calendar = /(?:agenda|calendar|rendez.vous|\brdv\b)/.test(routingTopic);
    return {
      ...((mail || calendar) && /(?:retrouv|recherch|consulte|lis\b|lire|liste|voir|verifi|dernier|existant|modifi|corrig|chang|deplac|envo|programm)/.test(topic) ? { readCommunicationRecords: available.readCommunicationRecords } : {}),
      ...(mail && /(?:modifi|corrig|chang|brouillon|draft)/.test(topic) ? { updateCampaignDraft: available.updateCampaignDraft } : {}),
      ...(mail && /(?:envo|expedi|programm|schedule|send)/.test(topic) && !families.has("advertising") ? { dispatchCampaignDraft: available.dispatchCampaignDraft } : {}),
      ...(calendar && /(?:modifi|corrig|chang|deplac|report|update)/.test(routingTopic) ? { updateCalendarAppointment: available.updateCalendarAppointment } : {}),
      ...(calendar && /(?:annule|annuler|supprime|cancel)/.test(topic) ? {cancelCalendarAppointment:available.cancelCalendarAppointment,readCommunicationRecords:available.readCommunicationRecords} : {}),
    };
  })();
  const advertisingTools = (() => {
    if (!canExecute || !families.has("advertising")) return {};
    const available = createInrAssistantAdvertisingTools({ request: args.request, accountId: args.accountId, edition: args.edition,
      currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      canStartWork: () => deadline - Date.now() > 15_000 });
    return {
      readAdvertisingCampaigns: available.readAdvertisingCampaigns,
      ...(/(?:cre|prepar|brouillon|draft)/.test(topic) ? { prepareAdvertisingCampaign: available.prepareAdvertisingCampaign } : {}),
      ...(/(?:pause|arret|suspend|repren|repri|reactiv|modifi|corrig|chang|budget|supprim|effac|update)/.test(topic) ? { manageAdvertisingCampaign: available.manageAdvertisingCampaign } : {}),
    };
  })();
  const settingsTools = families.has("settings") ? createInrAssistantSettingsTools({ request: args.request, accountId: args.accountId,
    edition: args.edition, currentUserMessage: latestRequest, canStartWork: () => deadline - Date.now() > 15_000 }) : {};
  const operationGuidance = [
    Object.keys(commercialTools).length ? "CRM : retrouve les IDs avec searchCrmContacts ; manageCrmContact ne change que la fiche demandée. prepareCommercialDocument enregistre seulement un brouillon : quantité, prix HT et TVA explicites, renseignements manquants signalés, jamais de numéro officiel, finalisation ou envoi. Documents commerciaux distincts des factures d’abonnement." : "",
    Object.keys(communicationTools).length ? "readCommunicationRecords retrouve les éléments actuels ; updateCampaignDraft corrige le brouillon. dispatchCampaignDraft exige les destinataires littéraux du dernier ordre ; programmation = date/heure/fuseau explicites. queued ne prouve pas livraison. updateCalendarAppointment modifie un rendez-vous encore brouillon ; rendez-vous confirmé et validation nécessaire restent dans l’outil natif. Préparer n’autorise pas envoyer." : "",
    Object.keys(advertisingTools).length ? "ADS : vérifie les campagnes/prérequis avec readAdvertisingCampaigns. prepareAdvertisingCampaign prépare un brouillon avec budget/date explicitement demandés. manageAdvertisingCampaign respecte les actions disponibles et validations natives ; un brouillon ou un lien ne lance jamais une campagne facturée." : "",
    Object.keys(settingsTools).length ? "Réglages : readToolSettings puis updateToolSettings changent seulement les valeurs demandées et relisent le résultat. Présente les résultats partiels/inconnus comme tels ; ne devine aucune déclaration légale ni identité." : "",
  ].filter(Boolean).join("\n");
  system += operationGuidance ? `\n${operationGuidance}` : "";
  // Native settings endpoints merge the active account's existing configuration.
  // Serialize writes in one turn so parallel model tool calls cannot overwrite
  // a sibling tool's freshly saved fields. Read-only tools remain concurrent.
  let mutationTail: Promise<unknown> = Promise.resolve();
  const serializeMutations = <T extends Record<string, unknown>>(available: T): T => Object.fromEntries(Object.entries(available).map(([name, definition]) => {
    if (!observedActionNames.has(name) || !definition || typeof definition !== "object" || !("execute" in definition) || typeof definition.execute !== "function") return [name, definition];
    const execute = definition.execute;
    return [name, { ...definition, execute: (...input: unknown[]) => {
      const next = mutationTail.then(() => Reflect.apply(execute, definition, input));
      mutationTail = next.catch(() => undefined); return next;
    } }];
  })) as T;
  const tools = withInrAssistantToolActivities(serializeMutations(assistantToolsForEdition({ proposeHumanSupport: supportTool, readAppGuide: createInrAssistantAppGuideTool(), ...mediaTools, ...accountTools, ...diagnosticTools,
    ...workspaceTools, ...memoryTools, ...businessTools, ...ctaTools, ...dnaAnalysisTools, ...managementTools, ...publicationTools, ...workspaceActionTools, ...insightsTools,
    ...commercialTools, ...communicationTools, ...advertisingTools, ...settingsTools }, args.edition)),
  { requestId: args.requestId, onActivity: args.onActivity });
  const schemas = await Promise.all(Object.entries(tools).map(async ([name, definition]) => ({
    type: "function", name, description: definition.description,
    inputSchema: await asSchema<unknown>(definition.inputSchema).jsonSchema,
  })));
  // Compact against real schemas, not a guessed fixed overhead. Recheck the
  // complete provider representation in middleware before every paid step.
  const schemaBytes = bytes(schemas) + 2_048;
  if (bytes({ system, messages }) + schemaBytes > 31_000) {
    // Rich actions already have typed tools to read full business facts. Drop
    // duplicated eager context before dropping recent conversation or safety rules.
    system = buildInrAssistantSystemPrompt(args.displayName, undefined, getInrAssistantAppKnowledge(latestRequest, 1_200), args.edition, args.clientContext, Boolean(args.fileContexts?.length)) + (operationGuidance ? `\n${operationGuidance}` : "");
  }
  if (bytes({ system, messages }) + schemaBytes > 31_000) {
    // Compound requests can need many real action schemas. The guide remains
    // available as a tool; remove only its duplicated eager prose, not rights.
    system = buildInrAssistantSystemPrompt(args.displayName, undefined, undefined, args.edition, args.clientContext, Boolean(args.fileContexts?.length)) + (operationGuidance ? `\n${operationGuidance}` : "");
  }
  while (messages.length > 1 && bytes({ system, messages }) + schemaBytes > 31_000) messages.shift();
  if (bytes({system,messages}) + schemaBytes > 30_500) system = buildInrAssistantSystemPrompt(args.displayName,undefined,undefined,args.edition,args.clientContext,Boolean(args.fileContexts?.length),true) + (operationGuidance ? `\n${operationGuidance}` : "");
  if (bytes({ system, messages }) + schemaBytes > 31_000) {
    noteFailure("input_limit", { inputBytes: bytes({ system, messages }) + schemaBytes, historyTurns: messages.length });
    throw new InrAssistantUnavailableError(lastFailure);
  }
  const quota = await reserveInrAssistantRequest({
    billingAccountId: args.accountId, requestId: args.requestId, edition: args.edition, complexity,
  });
  const chain = getInrAssistantModelChain({ edition: args.edition, complexity, solReserved: quota.solReserved });
  let success = false;
  const finishReply = (reply: InrAssistantReply): InrAssistantReply => {
    for (const result of publicationResults) {
      const name = result.action === "prepare" ? "preparePublication" : result.action === "edit" ? "editPublication" : result.action === "status" ? "getPublicationStatus" : "executePublication";
      if (!receipts.some(r=>r.tool === name && r.status === result.status)) receipts.push({tool:name,ok:result.ok,status:result.status,message:result.message,...(result.draftId?{draftId:result.draftId}:{}),toolUrl:result.toolUrl});
    }
    if (mediaState.result && !receipts.some(r=>r.tool === "generateMedia" || r.tool === "modifyMedia")) receipts.push({tool:requiredTools.includes("modifyMedia")?"modifyMedia":"generateMedia",ok:mediaState.result.ok,status:mediaState.result.status,message:mediaState.result.message,requestId:mediaState.result.requestId,...(mediaState.result.media?.id?{id:mediaState.result.media.id}:{})});
    const outcome = inrAssistantTaskOutcome(requiredTools,receipts,reply.message);
    success = outcome === "completed";
    if (!requiredTools.length) return reply;
    const labels: Record<string,string> = {generateMedia:"créer le média",modifyMedia:"retoucher l’image",preparePublication:"préparer la publication",executePublication:"publier ou programmer la publication",editPublication:"corriger la publication",configureBusinessCta:"configurer les appels à l’action",startBusinessDnaAnalysis:"analyser l’ADN",updateBusinessDna:"compléter l’ADN",updateAiConfiguration:"appliquer les réglages IA",configureAgentAutomation:"configurer l’agent",prepareCampaignEmail:"préparer la campagne mail",dispatchCampaignDraft:"envoyer ou programmer la campagne",updateCampaignDraft:"corriger le brouillon",updateCalendarAppointment:"modifier le rendez-vous",cancelCalendarAppointment:"annuler le rendez-vous",manageCrmContact:"modifier la fiche CRM",mergeCrmContacts:"fusionner les contacts",prepareAdvertisingCampaign:"préparer la campagne publicitaire",manageAdvertisingCampaign:"modifier la campagne publicitaire"};
    const remaining = requiredTools.filter(name=>!receipts.some(r=>r.tool === name && r.ok && !["partial","failed","unknown"].includes(r.status)));
    const factual = [...new Set(receipts.filter(r=>r.ok).map(r=>r.message))].join("\n\n");
    const message = outcome === "partial" ? `${factual || savedActionReply() || reply.message}\n\nIl reste à ${remaining.map(name=>labels[name]??"terminer l’action demandée").join(", ")}. Vous pouvez me demander de continuer ; les étapes déjà réalisées seront conservées.` : reply.message;
    return {...reply,message,outcome,taskState:{version:1,instruction:latestRequest,actionRequestId:args.actionRequestId??args.requestId,startedAt:args.actionStartedAt??new Date(started).toISOString(),expiresAt:new Date(started+30*60_000).toISOString(),outcome,requiredTools,receipts:receipts.slice(-32),question:message.slice(-2000)}};
  };
  try {
    for (const attempt of chain) {
      if (args.signal?.aborted) noteFailure("request_aborted", { model: attempt.model, callCount: llmCalls });
      args.signal?.throwIfAborted();
      const remaining = deadline - Date.now();
      if (remaining < 1_000 || llmCalls >= maxCalls) {
        noteFailure(remaining < 1_000 ? "deadline" : "call_limit", { model: attempt.model, callCount: llmCalls }); break;
      }
      let reply = "";
      let handoffSummary = "";
      let failureStatus: number | undefined;
      try {
        const guardedModel = (selected: typeof attempt) => {
          const attempt = selected;
          return wrapLanguageModel({
          model: gateway(attempt.model),
          middleware: {
            specificationVersion: "v3",
            transformParams: async ({ params }) => ({
              ...params,
              // This signal belongs only to doGenerate, not executeTools. A video
              // may take minutes without inheriting a 35-second LLM deadline.
              abortSignal: AbortSignal.any([
                ...(params.abortSignal ? [params.abortSignal] : []),
                AbortSignal.timeout(Math.max(1, Math.min(35_000, deadline - Date.now()))),
              ]),
            }),
            wrapGenerate: async ({ doGenerate, params }) => {
              if (llmCalls >= maxCalls || deadline - Date.now() < 1_000) {
                throw new InrAssistantUnavailableError(noteFailure(llmCalls >= maxCalls ? "call_limit" : "deadline", { model: attempt.model, callCount: llmCalls }));
              }
              const estimatedInputTokens = bytes({ prompt: params.prompt, tools: params.tools }) + 1_024;
              if (estimatedInputTokens > 32_000) {
                noteFailure("input_limit", { model: attempt.model, inputBytes: estimatedInputTokens - 1_024, callCount: llmCalls });
                throw new InrAssistantUnavailableError(lastFailure);
              }
              const callStartedAt = Date.now();
              const estimatedCost = guardCost(attempt.model, estimatedInputTokens, maxOutputTokens);
              const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
                feature: "assistant.chat", estimatedInputTokens, reservedOutputTokens: maxOutputTokens, estimatedCostMicroUsd: estimatedCost,
              }).catch((error: unknown) => {
                noteFailure("redis_reserve", { model: attempt.model, durationMs: Date.now() - callStartedAt, callCount: llmCalls });
                economicFailure = error; throw error;
              });
              llmCalls++;
              let usage = { inputTokens: estimatedInputTokens, outputTokens: maxOutputTokens, totalTokens: estimatedInputTokens + maxOutputTokens };
              let usageEstimated = true;
              let received = false;
              let statusCode: number | undefined;
              try {
                const output = await doGenerate();
                received = true;
                const input = output.usage.inputTokens.total;
                const outputCount = output.usage.outputTokens.total;
                if (Number.isFinite(input) && Number.isFinite(outputCount)) {
                  const inputTokens = Math.max(0, Math.ceil(input!));
                  // Provider V3 output total already includes reasoning tokens.
                  const outputTokens = Math.max(0, Math.ceil(outputCount!));
                  usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
                  usageEstimated = false;
                }
                note("provider_completed", { model: attempt.model, durationMs: Date.now() - callStartedAt, callCount: llmCalls,
                  finishReason: output.finishReason.unified, hasText: output.content.some(part => part.type === "text" && Boolean(part.text.trim())) });
                return output;
              } catch (error) {
                statusCode = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) || undefined : undefined;
                noteFailure(classifyInrAssistantGatewayFailure(error, args.signal?.aborted), {
                  model: attempt.model, statusCode, durationMs: Date.now() - callStartedAt, callCount: llmCalls,
                });
                throw error;
              } finally {
                const cost = usageEstimated ? estimatedCost : guardCost(attempt.model, usage.inputTokens, usage.outputTokens);
                // Account each LLM step before tools run. Never charge result.usage
                // a second time: it only represents the last step of the SDK loop.
                await commitAiGatewayAccountAttempt({ reservation, feature: "assistant.chat", model: attempt.model, usage, actualCostMicroUsd: cost })
                  .catch((error: unknown) => {
                    noteFailure("redis_commit", { model: attempt.model, durationMs: Date.now() - callStartedAt, callCount: llmCalls });
                    economicFailure = error; throw error;
                  });
                recordAiGatewayOperationCall({
                  feature: "assistant.chat", model: attempt.model, transport: "vercel_ai_gateway",
                  fallbackStage: attempt === chain[0] ? "primary" : "gateway_model",
                  status: received ? "success" : "failure", statusCode, ...usage,
                  reservedOutputTokens: maxOutputTokens, costMicroUsd: cost, pricingSource: "configured", usageEstimated,
                  durationMs: Date.now() - callStartedAt, hasImages: Boolean(args.fileContexts?.some(file => file.image)), httpAttempts: 1,
                });
              }
            },
          },
          });
        };
        const model = guardedModel(attempt);
        const result = await generateText({
          model, system, messages, maxOutputTokens, tools,
          stopWhen: [stepCountIs(maxCalls), () => llmCalls >= maxCalls || Boolean(mediaState.result) && !followupAfterMedia],
          onStepFinish: ({ toolResults }) => {
            for (const result of toolResults) {
              if (result && !observedActionNames.has(result.toolName)) readCounts.set(result.toolName,(readCounts.get(result.toolName)??0)+1);
              if (!result || !observedActionNames.has(result.toolName)) continue;
              const output = result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : {};
              if (typeof output.message !== "string" || !output.message.trim()) continue;
              const next = output.nextAction && typeof output.nextAction === "object" ? output.nextAction as Record<string, unknown> : {};
              const href = typeof next.href === "string" && next.href.startsWith("/dashboard") && next.href.length < 500 ? next.href : typeof output.toolUrl === "string" && output.toolUrl.startsWith("/dashboard") ? output.toolUrl : undefined;
              let message = output.message.slice(0, 1_800);
              if (result.toolName === "configureBusinessCta" && Array.isArray(output.items)) {
                const channels: Record<string, string> = { site_web: "Site web", gmb: "Google Business", facebook: "Facebook", instagram: "Instagram", threads: "Threads", linkedin: "LinkedIn", x: "X", tiktok: "TikTok", youtube_shorts: "YouTube", pinterest: "Pinterest" };
                const statuses: Record<string, string> = { applied: "appliqué", unchanged: "déjà en place", blocked: "non appliqué", unknown: "non confirmé" };
                const details = output.items.slice(0, 16).flatMap(item => {
                  if (!item || typeof item !== "object") return [];
                  const row = item as Record<string, unknown>;
                  if (typeof row.tool !== "string" || typeof row.message !== "string" || typeof row.status !== "string" || !statuses[row.status]) return [];
                  const channel = typeof row.channel === "string" ? channels[row.channel] : undefined;
                  return [`- ${row.tool.slice(0, 100)}${channel ? ` · ${channel}` : ""} : ${statuses[row.status]}. ${row.message.slice(0, 260)}`];
                });
                message = `${output.status === "partial" ? "Réglages appliqués en partie." : message}\n\n${details.join("\n")}`.slice(0, 7_000);
              }
              if (!["generateMedia","modifyMedia"].includes(result.toolName)) actionFacts.set(result.toolCallId, { message, ...(href ? { href, label: typeof next.label === "string" ? next.label.slice(0, 100) : undefined } : {}) });
              const receipt: InrAssistantActionReceipt = {tool:result.toolName,ok:output.ok === true,status:typeof output.status === "string"?output.status:"unknown",message};
              for (const key of ["id","draftId","requestId","scheduledActionId","eventId","recordId","publicationId"] as const) if (typeof output[key] === "string" && /^[a-z0-9_-]{8,180}$/i.test(output[key])) receipt[key] = output[key];
              const media = output.media && typeof output.media === "object" ? output.media as Record<string,unknown> : {};
              if (typeof media.id === "string" && /^[a-f0-9-]{36}$/i.test(media.id)) receipt.id = media.id;
              if (href) receipt.toolUrl = href;
              receipts.push(receipt);
            }
          },
          prepareStep: ({ stepNumber, messages: stepMessages }) => {
            const goalsDone = requiredTools.length > 0 && requiredTools.every(name=>receipts.some(r=>r.tool === name && r.ok && !["partial","failed","unknown"].includes(r.status)));
            const answerOnly = goalsDone || stepNumber >= maxCalls-1 || llmCalls >= maxCalls-1;
            if (stepNumber === 0 && !answerOnly && !args.taskContext) return;
            // Keep call/result pairs intact and discard only earlier chat text.
            // After a guide or DNA lookup, creation remains possible in step 2;
            // the last step only answers and never repeats reads or actions.
            let latestUser = 0;
            stepMessages.forEach((message, index) => { if (message.role === "user") latestUser = index; });
            // Some Qwen tool-call responses ignore toolChoice:none. Do not spend
            // the fourth and final call on another tool loop: reserve it for the
            // existing economical fallback, with its own real cost accounting.
            const answerAttempt = answerOnly && attempt.model === INR_ASSISTANT_MODELS.qwen
              ? chain.find(candidate => candidate.model === INR_ASSISTANT_MODELS.luna) ?? attempt
              : attempt;
            return {
              ...(answerOnly ? { model: guardedModel(answerAttempt) } : {}),
              messages: compactInrAssistantGuideContext(stepMessages.slice(latestUser)),
              activeTools: answerOnly ? [] : Object.keys(tools).filter(name => (readCounts.get(name)??0) < 2 && !args.taskContext?.receipts.some(r=>r.tool === name && r.ok && !["partial","failed","unknown"].includes(r.status))) as Array<keyof typeof tools>,
              ...(answerOnly ? { toolChoice: "none" as const } : {}),
              system: buildInrAssistantSystemPrompt(args.displayName, undefined, readCounts.has("readAppGuide") ? undefined : getInrAssistantAppKnowledge(latestRequest, 1_800), args.edition, args.clientContext, Boolean(args.fileContexts?.length), true)
                + (operationGuidance ? `\n${operationGuidance}` : "")
                + (args.taskContext ? `\nReprise vérifiée de la tâche. Résultats enregistrés, à réutiliser sans refaire ces actions : ${JSON.stringify(args.taskContext.receipts).slice(0,5000)}. La précision actuelle complète seulement cette tâche. Réponds dans la langue de ce message : ${JSON.stringify(spokenRequest).slice(0,500)}` : "")
                + (answerOnly ? "\nRépondez maintenant sans appeler d’outil. Utilisez seulement les faits déjà obtenus. Si le sujet ou une donnée indispensable manque, posez une question courte pour continuer. N’inventez ni résultat ni action exécutée." : ""),
            };
          },
          // Normal calls retain their 100s deadline in the model middleware.
          // Only an actual dispatched media job extends it to the function limit.
          maxRetries: 0, abortSignal: args.signal, timeout: Math.max(1, started + 780_000 - Date.now()),
          providerOptions: {
            gateway: { user: args.accountId, tags: ["assistant.chat", `request:${args.requestId}`] },
            ...(attempt.reasoningEffort ? { openai: { reasoningEffort: attempt.reasoningEffort } } : {}),
          },
        });
        reply = result.text.trim();
        for (const call of result.steps.flatMap((step) => step.toolCalls)) {
          const input = call?.input && typeof call.input === "object" ? call.input as Record<string, unknown> : {};
          if (call?.toolName === "proposeHumanSupport" && !call.dynamic && typeof input.message === "string" && typeof input.summary === "string") {
            reply = input.message.trim().slice(0, 1_500);
            handoffSummary = input.summary.trim().slice(0, 2_000);
            break;
          }
        }
        if (result.finishReason === "length") {
          noteFailure("output_limit", { model: attempt.model, finishReason: result.finishReason, hasText: Boolean(reply), callCount: llmCalls });
          reply = "";
        } else if (!reply) {
          noteFailure("empty_output", { model: attempt.model, finishReason: result.finishReason, hasText: false, callCount: llmCalls });
        }
      } catch (error) {
        if (economicFailure && !actionFacts.size && !mediaState.result && !publicationResults.length) throw economicFailure;
        if (error instanceof InrAssistantInputError && !actionFacts.size && !mediaState.result && !publicationResults.length) throw error;
        failureStatus = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) || undefined : undefined;
        if (args.signal?.aborted) {
          noteFailure("request_aborted", { model: attempt.model, callCount: llmCalls });
          // A disconnected browser does not undo an already confirmed action.
          // The factual branches below return it without another model or mutation.
          if (!actionFacts.size && !publicationResults.length && !mediaState.result && !mediaState.requestId) throw error;
        }
      }
      if (mediaState.result) {
        success = true;
        const media = mediaState.result;
        const completedActions = publicationResults.filter(result => result.action !== "status");
        return finishReply({ message: completedActions.length || actionFacts.size ? (reply || [media.message, savedActionReply() || completedActions.map(result => result.message).join("\n\n")].join("\n\n"))
          : `${media.message}${media.status === "processing" || media.status === "ready_to_save" ? `\n\nRéférence de création : ${media.requestId}` : ""}`, media });
      }
      // If a long-running job was dispatched, never retry creation through
      // another model. Its server identity can recover the real status later.
      if (mediaState.requestId) {
        success = true;
        const media: InrAssistantMediaResult = { ok: true, status: "processing", requestId: mediaState.requestId,
          message: "La création a été lancée. Je dois vérifier son état avant de la relancer.", libraryUrl: "/dashboard/mediatheque" };
        receipts.push({tool:"generateMedia",ok:true,status:"processing",message:media.message,requestId:media.requestId});
        return finishReply({ message: `${media.message}\n\nRéférence de création : ${media.requestId}`, media });
      }
      // A real action result survives a summary/provider failure. Never retry an
      // already executed mutation just to obtain a prettier answer.
      if (publicationResults.length) {
        success = true;
        return finishReply({ message: reply || publicationResults.map(result => `${result.message}\n\n[Ouvrir l’outil](${result.toolUrl})`).join("\n\n") });
      }
      if (actionFacts.size) {
        success = true;
        return finishReply({ message: reply || savedActionReply() });
      }
      if (reply) { success = true; return finishReply({ message: reply, ...(handoffSummary ? { needsHuman: true, handoffSummary } : {}) }); }
      await recordAiGatewayAccountFailure({ accountId: args.accountId, feature: "assistant.chat", model: attempt.model, status: failureStatus }).catch(() => undefined);
    }
    throw new InrAssistantUnavailableError(lastFailure ?? noteFailure("unavailable", { callCount: llmCalls }));
  } finally {
    note("quota_finalize_started", { callCount: llmCalls });
    await finalizeInrAssistantRequest(quota, { success });
    note("quota_finalize_completed", { callCount: llmCalls });
  }
}
