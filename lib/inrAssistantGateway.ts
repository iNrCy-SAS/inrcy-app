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
import { inrAssistantRequiredCalls, inrAssistantGoalCompleted, inrAssistantTaskTrackingLimit, compactInrAssistantTaskReceipts } from "./inrAssistantTaskPolicy.ts";
import { deriveInrAssistantStudioDraft, isInrAssistantStudioDraftRequest, parseInrAssistantStudioDraft, type InrAssistantStudioDraft } from "./inrAssistantStudioDraft.ts";
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
import { INR_ASSISTANT_COMMANDS, INR_ASSISTANT_PENDING_STATUSES, INR_ASSISTANT_UNCERTAIN_STATUSES, inrAssistantCommandLabel } from "./inrAssistantCommandRegistry.ts";
import { createInrAssistantCampaignTools } from "./inrAssistantCampaignTools.ts";
import { createInrAssistantUiTools } from "./inrAssistantUiTools.ts";
import { getDirectInrAssistantNavigationRequest, parseInrAssistantNavigation, isInrAssistantNavigationRequest, isInrAssistantScreenCommandRequest, parseInrAssistantUiCommand, type InrAssistantNavigation, type InrAssistantUiCommand } from "./inrAssistantUiCommands.ts";
import { createInrAssistantChannelTools } from "./inrAssistantChannelTools.ts";
import { createInrAssistantDocumentTools } from "./inrAssistantDocumentTools.ts";
import { createInrAssistantCalendarTools } from "./inrAssistantCalendarTools.ts";
import { createInrAssistantScheduledPublicationTools } from "./inrAssistantScheduledPublicationTools.ts";
import { createInrAssistantAttachmentTools } from "./inrAssistantAttachmentTools.ts";

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

export type InrAssistantReply = { message: string; needsHuman?: boolean; handoffSummary?: string; media?: InrAssistantMediaResult; studioDraft?: InrAssistantStudioDraft; insertStudioDraft?: boolean; outcome?: InrAssistantTaskOutcome; taskState?: InrAssistantTaskState; navigation?: InrAssistantNavigation; uiCommand?:InrAssistantUiCommand; taskProgress?: { outcome:InrAssistantTaskOutcome; completed:string[]; remaining:string[] } };

/** Stored capabilities are deliberately excluded from every provider prompt. */
const publicTaskReceipts = (receipts: InrAssistantActionReceipt[] = []) => receipts.map(({approvalToken: _privateCapability, ...receipt})=>receipt);

const shortAffirmation = (value: string) => /^(?:oui|ok|d.accord|vas.y|yes|si|ja)[.!\s]*$/i.test(value.trim());
function previousStudioDraft(messages: Array<{role: string; content: string}>): InrAssistantStudioDraft | null {
  for (let index = messages.length - 2; index >= 0; index--) {
    if (messages[index].role === "user") {
      if (!shortAffirmation(messages[index].content)) return null;
      continue;
    }
    if (messages[index].role !== "assistant" || index === 0 || messages[index-1].role !== "user") return null;
    const draft = deriveInrAssistantStudioDraft(messages[index-1].content, messages[index].content);
    if (draft) return draft;
    if (!shortAffirmation(messages[index-1].content)) return null;
    index--;
  }
  return null;
}
function requestsStudioInsertion(message: string): boolean {
  const text = message.replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " ").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (/\b(?:ne|pas|sans|not|never)\b|^(?:comment|pourquoi|explique|how|why|what|est.ce que je|dois.je|should i|can i)\b/.test(text)) return false;
  return /^(?:oui[, ]+)?(?:(?:(?:peux|pourrais)[- ]tu|(?:pouvez|pourriez)[- ]vous|(?:can|could|would) you|je (?:veux|souhaite|voudrais) que tu|j.aimerais que tu)\s+(?:me\s+|nous\s+|please\s+)?)?(?:insere(?:r|z)?|colle(?:r|z)?|remplis|mets|insert|paste)\b.{0,65}\b(?:prompt|studio|champ|case|field)\b/.test(text);
}
function requestedHumanSupport(message: string): boolean {
  const text = message.replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " ").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Only a direct request for assistance qualifies. A contact instruction inside
  // the creative brief ("une image pour inviter les clients à contacter…") does not.
  return text.split(/[.!?;\n]+|\s+(?:puis|ensuite|then|et|and)\s+(?=(?:contact|appell|parl|join|talk|speak|je\b|i\b))/).some(clause => {
    const value = clause.trim();
    if (/\b(?:ne|pas|sans|not|never)\b.{0,45}\b(?:contact|equipe|humain|human|support)/.test(value)) return false;
    const opening = /^(?:(?:s.il vous plait|s.il te plait|please)[, ]+)?(?:(?:(?:peux|pourrais|voudrais)[- ]tu|(?:pouvez|pourriez|voudriez)[- ]vous|(?:can|could|would) you)\s+(?:me\s+|nous\s+)?)?(?:je (?:veux|souhaite|voudrais|desire)|j.ai besoin de|i (?:want|need)(?: to)?|i would like(?: to)?)?\s*/;
    const request = value.replace(opening, "");
    return /^(?:contacte(?:r|z)?|joindre|parler|appeler|talk|speak|reach|contact)\b.{0,55}\b(?:equipe|support|humain|human|personne|conseiller|team)\b/.test(request) ||
      /^(?:mettre|mets|mettez)\s+(?:moi|nous)?\s*(?:en contact|en relation)\b.{0,40}\b(?:equipe|support|humain|personne|conseiller)\b/.test(request) ||
      /^(?:(?:de l.|une?|the|a)\s*)?(?:aide|assistance)\s+humaine\b/.test(request) ||
      /^je (?:veux|souhaite|voudrais)\s+(?:un|une)\s+(?:humain|personne|conseiller)\b/.test(value);
  });
}
function studioDraftReply(draft: InrAssistantStudioDraft): InrAssistantReply {
  // The localized insertion button supplies the destination and next step.
  return { message: draft.prompt.split("\n").map(line=>`> ${line}`).join("\n"), studioDraft: draft, outcome: "completed" };
}

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
  taskIntent?: "continue" | "check_status";
  onTaskCheckpoint?: (state: InrAssistantTaskState) => Promise<void>;
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
  if(args.taskContext?.receipts.some(receipt=>INR_ASSISTANT_UNCERTAIN_STATUSES.has(receipt.status))) return {outcome:"blocked",message:"Une opération précédente a un résultat incertain. Vérifiez son état dans l’outil concerné avant de demander une nouvelle action."};
  const statusOnly = Boolean(args.taskContext && args.actionInstruction && (args.taskContext.outcome === "processing" || args.taskIntent === "check_status"));
  const navigationRequested = isInrAssistantNavigationRequest(args.taskContext?spokenRequest:latestRequest);
  const screenCommandRequested = isInrAssistantScreenCommandRequest(args.taskContext?spokenRequest:latestRequest);
  const draftOnly = isInrAssistantStudioDraftRequest(latestRequest);
  const insertRequest = requestsStudioInsertion(spokenRequest);
  if (!args.actionInstruction && !draftOnly && (shortAffirmation(spokenRequest) || insertRequest)) {
    const draft = previousStudioDraft(args.messages);
    if (draft) return { ...studioDraftReply(draft), insertStudioDraft: true };
  }
  if (args.edition === "basic" && !draftOnly && isBasicAssistantExecutionRequest(latestRequest)) return { message: BASIC_ASSISTANT_EXECUTION_NOTICE };
  const capabilityLimit = draftOnly ? null : verifiedInrAssistantCapabilityLimit(latestRequest,args.edition);
  if (capabilityLimit) return {message:capabilityLimit,outcome:"blocked"};
  const families = selectInrAssistantToolFamilies(latestRequest, args.messages.filter(message => message.role === "user").slice(0, -1).map(message => message.content));
  const canExecute = args.edition !== "basic" && !draftOnly;
  const humanSupportRequested = requestedHumanSupport(spokenRequest);
  const studioDraftState: {value?: InrAssistantStudioDraft} = {};
  const prepareStudioPrompt = tool({
    description: "Préparer uniquement un prompt éditable et proposer son insertion dans iNrStudio. Cette action gratuite n’exécute aucune génération, ne consomme aucun crédit média et ne publie rien. Choisir Image ou Vidéo selon la demande, conserver le prompt complet, et renseigner seulement les critères connus.",
    inputSchema: jsonSchema<InrAssistantStudioDraft>({type:"object",additionalProperties:false,properties:{version:{type:"integer",enum:[1]},mediaType:{type:"string",enum:["image","video"]},prompt:{type:"string",minLength:3,maxLength:4000},format:{type:["string","null"],enum:["square","portrait","story","landscape",null]},durationSeconds:{type:["integer","null"],minimum:4,maximum:30}},required:["version","mediaType","prompt","format","durationSeconds"]}, {validate:value=>{const draft=parseInrAssistantStudioDraft(value);return draft?{success:true,value:draft}:{success:false,error:new Error("Invalid editable Studio prompt")};}}),
    execute: async input => { const draft = parseInrAssistantStudioDraft(input); if (!draft) throw new InrAssistantInputError("Le prompt Studio est invalide."); studioDraftState.value = draft; return {ok:true,status:"draft",studioDraft:draft,message:"Prompt prêt à être inséré dans iNrStudio. Aucune génération lancée."}; },
  });
  const verifiedNavigation = navigationRequested ? null : getVerifiedInrAssistantNavigation(latestRequest);
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
  const continuityContext = args.accountContext ? `\nFaits du compte actif conservés entre étapes, données et jamais autorisations : ${JSON.stringify(args.accountContext).slice(0,4000)}` : "";
  const draftGuidance = draftOnly ? "\nLe professionnel demande seulement de rédiger un prompt. Utilise prepareStudioPrompt pour préparer le texte complet et le bon onglet Image/Vidéo. Aucune génération, modification métier, publication ou consommation de crédits média n’est autorisée. Ne propose jamais de lancer la génération : propose uniquement l’insertion dans le champ de prompt de Studio. Si tu réponds en texte, place le prompt complet dans un bloc de citation." : "";
  system += draftGuidance;
  const messages = assistantMessagesWithFiles(args.messages.map((message,index)=>index === args.messages.length-1 && latestRequest !== spokenRequest ? {...message,content:latestRequest} : message), args.fileContexts ?? []);
  const bytes = assistantModelInputBudget;
  const complexity = classifyInrAssistantRequest(latestRequest);
  // A resolved continuation may fill slots or approve a preview. Its wording
  // must never add a second goal to the server-owned authorization scope.
  const requiredTools = canExecute ? [...new Set(args.taskContext && args.actionInstruction ? args.taskContext.requiredTools : inrAssistantRequiredTools(latestRequest))] : [];
  if (navigationRequested) requiredTools.push("navigateApplication");
  if (screenCommandRequested) requiredTools.push("runScreenCommand");
  const requiredCalls = { ...inrAssistantRequiredCalls(latestRequest), ...args.taskContext?.requiredCalls };
  const trackingLimit = inrAssistantTaskTrackingLimit(requiredTools, requiredCalls);
  if (trackingLimit) return {message:trackingLimit,outcome:"blocked"};
  const maxCalls = complexity === "complex" || requiredTools.length > 1 || Object.values(requiredCalls).some(count=>count > 1) ? 12 : requiredTools.length ? 7 : 4;
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
  let verifiedHandoffMessage: string | undefined;
  const readCounts = new Map<string,number>();
  const previewActionNames = new Set(["previewCalendarAction","previewScheduledPublicationAction"]);
  const observedActionNames = new Set([...Object.keys(INR_ASSISTANT_COMMANDS),"navigateApplication","runScreenCommand","previewCampaignAudience",...previewActionNames,"applyCalendarAction","applyScheduledPublicationAction"]);
  const privateApprovals=new Map(receipts.flatMap(receipt=>receipt.approvalReference && receipt.approvalToken && receipt.approvalKind?[[receipt.approvalReference,{token:receipt.approvalToken,kind:receipt.approvalKind}] as const]:[]));
  const resolvePreview=(reference:string)=>privateApprovals.get(reference)?.token??null;
  let navigation: InrAssistantNavigation | undefined;
  let uiCommand: InrAssistantUiCommand | undefined;
  const uiTools = navigationRequested || screenCommandRequested ? createInrAssistantUiTools({accountId:args.accountId,currentUserMessage:latestRequest,clientContext:args.clientContext,supabase:args.supabase,canStartWork:()=>deadline-Date.now()>1000}) : {};
  const savedActionReply = () => [...actionFacts.values()].map(fact => `${fact.message}${fact.href ? `\n\n[${fact.label ?? "Ouvrir l’outil"}](${fact.href})` : ""}`).join("\n\n");
  const followupAfterMedia = requiredTools.some(name=>!['generateMedia','modifyMedia'].includes(name)) || families.has("publication") || families.has("business") && /\b(?:adn|dna|configuration|reglages)\b/i.test(latestRequest);
  const mediaTools = canExecute && families.has("media") ? createInrAssistantMediaTools({
    request: args.request, requestId: args.actionRequestId ?? args.requestId,
    currentUserMessage: latestRequest,
    statusReadOnly: statusOnly && args.taskIntent !== "continue",
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
  const channelTools = args.supabase && (!requiredTools.length || /connect|etat|manquant|cockpit|total|blocage/i.test(latestRequest)) && /canaux|canal|channel|cockpit|connect|connexion|manquant|\b\d{1,2}\s*(?:\/|sur)\s*14\b/i.test(latestRequest)
    ? createInrAssistantChannelTools({supabase:args.supabase,accountId:args.accountId,edition:args.edition,signal:args.signal}) : {};
  const workspaceTools = args.supabase ? createInrAssistantWorkspaceTools({ supabase: args.supabase, accountId: args.accountId, edition: args.edition, request: args.request }) : {};
  const memoryTools = args.memory ? createInrAssistantMemoryTools({ memory: args.memory, excludeTurnId: args.turnId }) : {};
  const attachmentTools=args.fileContexts?.some(file=>file.text)?createInrAssistantAttachmentTools(args.fileContexts):{};
  const topic = inrAssistantRoutingText(statusOnly ? args.taskContext!.instruction : latestRequest);
  const routingTopic = inrAssistantRoutingText([latestRequest,args.taskContext?.instruction??"",...args.messages.filter(m=>m.role === "user").slice(-3,-1).map(m=>m.content)].join(" "));
  const businessTools = (() => {
    if (!canExecute || !args.supabase || !families.has("business")) return {};
    const available = createInrAssistantBusinessTools({ request: args.request, accountId: args.accountId, supabase: args.supabase, edition: args.edition, currentUserMessage: latestRequest });
    return {
      ...(/(?:\badn\b|\bdna\b|entreprise|business|horaires|prestations|services|mission|valeurs)/.test(topic) && /(?:ajout|rempli|complet|modifi|chang|mets|mettez|remplac|enrich|enregistr|sauvegard|update|fill|save)/.test(topic) ? { updateBusinessDna: available.updateBusinessDna } : {}),
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
      statusReadOnly:statusOnly,
      canStartWork: () => deadline - Date.now() > 15_000, onResult: result => { publicationResults.push(result); } });
    return {
      ...(requiredTools.some(name=>["preparePublication","executePublication"].includes(name)) ? {preparePublication: available.preparePublication} : {}),
      ...(requiredTools.includes("executePublication") ? { executePublication: available.executePublication } : {}),
      ...(requiredTools.includes("editPublication") ? { editPublication: available.editPublication } : {}),
      ...(statusOnly || /(?:statut|status|etat|deja|suivi|verifi|resultat|en cours)/.test(topic) ? { getPublicationStatus: available.getPublicationStatus } : {}),
    };
  })();
  const workspaceActionTools = (() => {
    if (!canExecute || !args.supabase || !families.has("workspace") && !families.has("media")) return {};
    const available = createInrAssistantWorkspaceActionTools({ request: args.request, accountId: args.accountId, supabase: args.supabase, edition: args.edition,
      currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId, canStartWork: () => deadline - Date.now() > 15_000 });
    return {
      ...(requiredTools.includes("updateMediaMetadata") ? { updateMediaMetadata: available.updateMediaMetadata } : {}),
      ...(requiredTools.includes("prepareCampaignEmail") ? { prepareCampaignEmail: available.prepareCampaignEmail } : {}),
      ...(requiredTools.includes("prepareCalendarAppointment") ? { prepareCalendarAppointment: available.prepareCalendarAppointment } : {}),
      ...(/(?:\bcrm\b|client|prospect|contact)/.test(topic) ? { searchCrmContacts: available.searchCrmContacts, readCrmContact: available.readCrmContact } : {}),
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
      ...(requiredTools.includes("prepareCommercialDocument") ? { prepareCommercialDocument: available.prepareCommercialDocument } : {}),
    };
  })();
  const documentTools = args.supabase && families.has("commercial") && /devis|facture|document commercial/.test(routingTopic)
    ? (()=>{const available=createInrAssistantDocumentTools({request:args.request,accountId:args.accountId,supabase:args.supabase!,edition:args.edition,currentUserMessage:latestRequest,actionRequestId:args.actionRequestId??args.requestId,clientContext:args.clientContext,canStartWork:()=>deadline-Date.now()>15000});
      return {readCommercialDocuments:available.readCommercialDocuments,...(canExecute && requiredTools.includes("finalizeCommercialDocument")?{finalizeCommercialDocument:available.finalizeCommercialDocument}:{}),...(canExecute && requiredTools.includes("updateCommercialDocument")?{updateCommercialDocument:available.updateCommercialDocument}:{})};})() : {};
  const calendarLifecycle = requiredTools.some(name=>["confirmCalendarAppointment","updateCalendarAppointment","cancelCalendarAppointment"].includes(name));
  const calendarTools=canExecute && args.supabase && args.actorUserId && calendarLifecycle
    ? (()=>{const available=createInrAssistantCalendarTools({request:args.request,accountId:args.accountId,actorUserId:args.actorUserId!,supabase:args.supabase!,edition:args.edition,currentUserMessage:latestRequest,canStartWork:()=>deadline-Date.now()>15000,resolvePreview});
      return {previewCalendarAction:available.previewCalendarAction,...(/\bia-[a-f0-9]{12}\b/i.test(spokenRequest)?{applyCalendarAction:available.applyCalendarAction}:{})};})() : {};
  const scheduledLifecycle=requiredTools.some(name=>["updateScheduledPublication","cancelScheduledPublication","retryScheduledPublication"].includes(name));
  const scheduledTools=canExecute && args.supabase && args.actorUserId && families.has("publication") && (scheduledLifecycle || /programm|planifi|echec|echou/.test(topic))
    ? (()=>{const available=createInrAssistantScheduledPublicationTools({request:args.request,accountId:args.accountId,actorUserId:args.actorUserId!,supabase:args.supabase!,edition:args.edition,currentUserMessage:latestRequest,canStartWork:()=>deadline-Date.now()>15000,resolvePreview});
      return {readScheduledPublications:available.readScheduledPublications,...(scheduledLifecycle?{previewScheduledPublicationAction:available.previewScheduledPublicationAction}:{}),...(scheduledLifecycle && /\bia-[a-f0-9]{12}\b/i.test(spokenRequest)?{applyScheduledPublicationAction:available.applyScheduledPublicationAction}:{})};})() : {};
  const communicationTools = (() => {
    if (!canExecute || !args.supabase || !families.has("workspace")) return {};
    const available = createInrAssistantCommunicationTools({ request: args.request, accountId: args.accountId, actorUserId: args.actorUserId,
      supabase: args.supabase, edition: args.edition, currentUserMessage: latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      canStartWork: () => deadline - Date.now() > 15_000 });
    const mail = /(?:campagne|email|e-mail|\bmail|newsletter|courriel|fidelis|propuls)/.test(routingTopic);
    const calendar = /(?:agenda|calendar|rendez.vous|\brdv\b)/.test(routingTopic);
    return {
      ...((mail || calendar) && (calendarLifecycle || /(?:retrouv|recherch|consulte|lis\b|lire|liste|voir|verifi|dernier|existant|modifi|corrig|chang|deplac|envo|programm)/.test(topic)) ? { readCommunicationRecords: available.readCommunicationRecords } : {}),
      ...(mail && requiredTools.includes("updateCampaignDraft") ? { updateCampaignDraft: available.updateCampaignDraft } : {}),
      ...(mail && requiredTools.includes("dispatchCampaignDraft") && !families.has("advertising") ? { dispatchCampaignDraft: available.dispatchCampaignDraft } : {}),
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
  const campaignTools = canExecute && args.supabase && args.actorUserId && families.has("workspace") && (requiredTools.some(name=>["dispatchCampaignAudience","selectCampaignMailbox"].includes(name)) || statusOnly && requiredTools.includes("dispatchCampaignDraft") || /audience|segment|expediteur|mailbox|boite|\bap-[a-f0-9]{12}\b/.test(routingTopic))
    ? (()=>{ const available=createInrAssistantCampaignTools({request:args.request,accountId:args.accountId,actorUserId:args.actorUserId!,edition:args.edition,supabase:args.supabase!,currentUserMessage:latestRequest,actionRequestId:args.actionRequestId??args.requestId,canStartWork:()=>deadline-Date.now()>15_000});
      return { listCampaignMailboxes:available.listCampaignMailboxes,
        ...(statusOnly?{readCampaignDeliveryStatus:available.readCampaignDeliveryStatus}:{}),
        ...(/expediteur|boite|adresse d.envoi|mailbox|sender/.test(topic)?{selectCampaignMailbox:available.selectCampaignMailbox}:{}),
        ...(/audience|segment|clients|prospects|contacts|destinataires|apercu|envoi|envoie/.test(topic)?{previewCampaignAudience:available.previewCampaignAudience}:{}),
        ...(/\bap-[a-f0-9]{12}\b/.test(topic)?{dispatchCampaignAudience:available.dispatchCampaignAudience}:{}) };
    })() : {};
  const operationGuidance = [
    Object.keys(commercialTools).length ? "CRM : retrouve les IDs avec searchCrmContacts ; manageCrmContact ne change que la fiche demandée. prepareCommercialDocument enregistre seulement un brouillon : quantité, prix HT et TVA explicites, renseignements manquants signalés, jamais de numéro officiel, finalisation ou envoi. Documents commerciaux distincts des factures d’abonnement." : "",
    Object.keys(communicationTools).length ? "readCommunicationRecords retrouve les éléments actuels ; updateCampaignDraft corrige le brouillon. dispatchCampaignDraft exige les destinataires littéraux du dernier ordre ; programmation = date/heure/fuseau explicites. queued ne prouve pas livraison. Pour confirmer, déplacer ou annuler un rendez-vous, utilise previewCalendarAction puis présente son aperçu et sa référence IA. applyCalendarAction exige la confirmation actuelle exacte, jamais un simple oui. Préparer n’autorise pas envoyer." : "",
    Object.keys(documentTools).length ? "Documents : readCommercialDocuments lit les vrais documents du compte avant toute action. finalizeCommercialDocument valide uniquement le document/version explicitement demandé, sans envoi ni paiement." : "",
    Object.keys(scheduledTools).length ? "Planning : readScheduledPublications lit les éléments réels. Toute modification passe par previewScheduledPublicationAction et la confirmation exacte IA avant applyScheduledPublicationAction. Ne recrée jamais une publication pour reprendre son statut." : "",
    Object.keys(advertisingTools).length ? "ADS : vérifie les campagnes/prérequis avec readAdvertisingCampaigns. prepareAdvertisingCampaign prépare un brouillon avec budget/date explicitement demandés. manageAdvertisingCampaign respecte les actions disponibles et validations natives ; un brouillon ou un lien ne lance jamais une campagne facturée." : "",
    Object.keys(settingsTools).length ? "Réglages : readToolSettings puis updateToolSettings changent seulement les valeurs demandées et relisent le résultat. Présente les résultats partiels/inconnus comme tels ; ne devine aucune déclaration légale ni identité." : "",
    Object.keys(channelTools).length ? "Cockpit et canaux : readChannelStatus utilise les mêmes règles de comptage que le cockpit. Appelle-le pour l’état, les manquants, le total et les blocages ; le contexte initial partiel ne prouve pas le total. Un état enregistré n’est pas une vérification réseau en direct." : "",
    Object.keys(campaignTools).length ? "Campagne vers un segment CRM : listCampaignMailboxes retrouve les expéditeurs ; selectCampaignMailbox enregistre celui choisi, jamais deviné. previewCampaignAudience fige l’audience et fournit une référence AP à montrer avec nombre de destinataires, objet, expéditeur et exclusions. dispatchCampaignAudience exige l’ordre actuel et cette référence exacte ; une référence ancienne ou un simple oui ne vaut pas confirmation." : "",
    statusOnly ? `${args.taskIntent === "continue" ? "Poursuite du même travail : getMediaGeneration peut accepter uniquement son média déjà terminé ; aucun nouveau job." : "Suivi en lecture seule : aucune écriture."} Utilise les lecteurs de statut avec les références enregistrées ${JSON.stringify(publicTaskReceipts(args.taskContext?.receipts)).slice(0,4000)}. Aucun nouveau lancement. Un résultat en attente reste en attente.` : "",
  ].filter(Boolean).join("\n");
  system += operationGuidance ? `\n${operationGuidance}` : "";
  // Native settings endpoints merge the active account's existing configuration.
  // Serialize writes in one turn so parallel model tool calls cannot overwrite
  // a sibling tool's freshly saved fields. Read-only tools remain concurrent.
  let mutationTail: Promise<unknown> = Promise.resolve();
  let checkpointFailed = false;
  const seenToolResults=new Set<string>();
  const resultToolName=(name:string, output:Record<string,unknown>):string => {
    if(name === "applyCalendarAction") return ({confirm:"confirmCalendarAppointment",update:"updateCalendarAppointment",cancel:"cancelCalendarAppointment"} as Record<string,string>)[String(output.action)]??name;
    if(name === "applyScheduledPublicationAction") return ({reschedule:"updateScheduledPublication",cancel:"cancelScheduledPublication",retry:"retryScheduledPublication"} as Record<string,string>)[String(output.action)]??name;
    return name;
  };
  const recordToolResult=(result:{toolName:string;toolCallId:string;output:unknown;input?:unknown}):boolean=>{
    const key='tool-result:'+result.toolName+':'+result.toolCallId;
    if(seenToolResults.has(key)) return false;
    seenToolResults.add(key);
    let receiptsChanged=false;
    const observe=()=>{
              if (result && !observedActionNames.has(result.toolName)) readCounts.set(result.toolName,(readCounts.get(result.toolName)??0)+1);
              if (!result) return;
              let output = result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : {};
              if(["dispatchCampaignDraft","dispatchCampaignAudience"].includes(result.toolName) && output.status === "already_processed") {
                const saved=String(output.savedStatus);
                output={...output,status:["queued","paused","running","scheduled","failed","cancelled"].includes(saved)?saved:["done","completed"].includes(saved)?"processing":"unknown"};
              }
              if(result.toolName === "readCampaignDeliveryStatus" && typeof output.campaignId === "string") output={...output,recordId:output.campaignId};
              if (!observedActionNames.has(result.toolName)) {
                if (statusOnly && typeof output.status === "string" && typeof output.message === "string") {
                  const pending=receipts.filter(receipt=>INR_ASSISTANT_COMMANDS[receipt.tool]?.statusReader===result.toolName && INR_ASSISTANT_PENDING_STATUSES.has(receipt.status));
                  const ids=["id","draftId","requestId","publicationId","scheduledActionId","recordId","eventId"] as const;
                  const sourceInput = result.input && typeof result.input === "object" ? result.input as Record<string,unknown> : {};
                  const matching=pending.filter(receipt=>ids.some(key=>(typeof output[key]==="string" && output[key]===receipt[key]) || (typeof sourceInput[key]==="string" && sourceInput[key]===receipt[key])));
                  // Readers such as the ADN status endpoint have one singleton
                  // operation. Never guess across several pending records.
                  const candidates=matching.length?matching:result.toolName === "getBusinessDnaAnalysis" && pending.length===1?pending:[];
                  for(const previous of candidates) {
                    const index=receipts.indexOf(previous);
                    receipts[index]={...previous,ok:output.ok===true,status:output.status,message:output.message.slice(0,1800)};
                    receiptsChanged=true;
                  }
                }
                return;
              }
              if(result.toolName === "runScreenCommand" && output.ok === true) uiCommand=parseInrAssistantUiCommand(output.uiCommand)??undefined;
              if (result.toolName === "navigateApplication" && output.ok === true && output.navigation && typeof output.navigation === "object") {
                const target=parseInrAssistantNavigation(output.navigation);
                if(target) navigation=target;
              }
              if (output.ok === false && ["admin_required","support_required"].includes(String(output.status)) && typeof output.message === "string") verifiedHandoffMessage = output.message.slice(0,1500);
              if (typeof output.message !== "string" || !output.message.trim()) return;
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
              const receipt: InrAssistantActionReceipt = {tool:resultToolName(result.toolName,output),ok:output.ok === true,status:typeof output.status === "string"?output.status:"unknown",message};
              for (const key of ["id","draftId","requestId","scheduledActionId","eventId","recordId","publicationId"] as const) if (typeof output[key] === "string" && /^[a-z0-9_-]{8,180}$/i.test(output[key])) receipt[key] = output[key];
              if(typeof output.campaignId === "string" && /^[a-f0-9-]{36}$/i.test(output.campaignId)) receipt.recordId=output.campaignId;
              if(result.toolName === "updateToolSettings" && ["calendar","notifications","documents","badge","studio","tiktok"].includes(String(output.tool))) receipt.recordId=`settings_${output.tool}`;
              const media = output.media && typeof output.media === "object" ? output.media as Record<string,unknown> : {};
              if (typeof media.id === "string" && /^[a-f0-9-]{36}$/i.test(media.id)) receipt.id = media.id;
              if (href) receipt.toolUrl = href;
              if(typeof output.reference === "string") { const capability=privateApprovals.get(output.reference); if(capability) {receipt.approvalReference=output.reference;receipt.approvalToken=capability.token;receipt.approvalKind=capability.kind;} }
              receipts.push(receipt);
              receiptsChanged=true;

    };
    observe(); return receiptsChanged;
  };
  const checkpoint = async () => {
    if(!args.onTaskCheckpoint || !requiredTools.some(name=>!["navigateApplication","runScreenCommand"].includes(name))) return;
    try {await args.onTaskCheckpoint(taskState(inrAssistantTaskOutcome(requiredTools,receipts,"",requiredCalls),""));}
    catch {checkpointFailed=true;throw new InrAssistantInputError("La reprise de la tâche n’a pas pu être enregistrée. Aucune opération supplémentaire n’a été lancée.");}
  };
  const serializeMutations = <T extends Record<string, unknown>>(available: T): T => Object.fromEntries(Object.entries(available).map(([name, definition]) => {
    if (!observedActionNames.has(name) || !definition || typeof definition !== "object" || !("execute" in definition) || typeof definition.execute !== "function") return [name, definition];
    const execute = definition.execute;
    return [name, { ...definition, execute: (...input: unknown[]) => {
      const next = mutationTail.then(async () => {
        if(checkpointFailed) throw new InrAssistantInputError("La tâche doit être vérifiée avant de poursuivre.");
        const options=input[1] && typeof input[1] === "object"?input[1] as {toolCallId?:string}:{};
        const toolCallId=options.toolCallId??name+'-'+receipts.length;
        // Persist before business side effects, then after the verified result.
        // A surviving marker requires reconciliation, never blind replay.
        const mutating=!previewActionNames.has(name) && !["navigateApplication","runScreenCommand"].includes(name);
        const marker:InrAssistantActionReceipt={tool:name,ok:false,status:"executing_unconfirmed",message:"Opération commencée ; résultat à vérifier avant toute nouvelle tentative."};
        if(mutating) {
          if(!requiredTools.some(goal=>!["navigateApplication","runScreenCommand"].includes(goal))) requiredTools.push(name);
          receipts.push(marker); await checkpoint();
        }
        let output:unknown;
        try {output=await Reflect.apply(execute, definition, input);}
        catch(error) {if(mutating) checkpointFailed=true;throw error;}
        if(output && typeof output === "object") {
          const raw=output as Record<string,unknown>;
          if(previewActionNames.has(name) && typeof raw.token === "string") {
            if(raw.token.length<=24000 && typeof raw.reference === "string" && /^IA-[A-F0-9]{12}$/.test(raw.reference) && ["calendar","scheduled_publication"].includes(String(raw.approvalKind))) privateApprovals.set(raw.reference,{token:raw.token,kind:raw.approvalKind as "calendar"|"scheduled_publication"});
            const {token:_privateToken,...safe}=raw; output=safe;
          }
        }
        const markerIndex=receipts.indexOf(marker);
        if(markerIndex>=0) receipts.splice(markerIndex,1);
        const changed=recordToolResult({toolName:name,toolCallId,output,input:input[0]});
        if(mutating && !changed) receipts.push({...marker,status:"unknown",message:"L’outil n’a pas fourni de résultat vérifiable. Vérifiez l’opération avant de la réessayer."});
        if(changed || mutating) await checkpoint();
        if(mutating && receipts.some(receipt=>INR_ASSISTANT_UNCERTAIN_STATUSES.has(receipt.status))) checkpointFailed=true;
        return output;
      });
      mutationTail = next.catch(() => undefined); return next;
    } }];
  })) as T;
  const allTools = assistantToolsForEdition({ ...(humanSupportRequested ? {proposeHumanSupport: supportTool} : {}), ...(draftOnly ? {prepareStudioPrompt} : {}), readAppGuide: createInrAssistantAppGuideTool(), ...mediaTools, ...accountTools, ...diagnosticTools,
    ...workspaceTools, ...memoryTools, ...attachmentTools, ...businessTools, ...ctaTools, ...dnaAnalysisTools, ...managementTools, ...publicationTools, ...workspaceActionTools, ...insightsTools,
    ...commercialTools, ...communicationTools, ...advertisingTools, ...settingsTools, ...campaignTools, ...channelTools, ...documentTools, ...calendarTools, ...scheduledTools }, draftOnly ? "basic" : args.edition);
  // No executor is exposed during a status-only continuation. In particular a
  // queued publication can never be re-dispatched merely to obtain its status.
  const selectedTools = Object.fromEntries(Object.entries(assistantToolsForEdition({...allTools,...uiTools},args.edition)).filter(([name,definition])=>
    Boolean(definition) && !(statusOnly && observedActionNames.has(name)) &&
    !(["generateMedia","modifyMedia","cancelMediaGeneration"].includes(name) && !requiredTools.includes(name)) &&
    !(requiredTools.includes("updateToolSettings") && !requiredTools.some(tool=>["generateMedia","modifyMedia"].includes(tool)) && ["generateMedia","modifyMedia"].includes(name)))) as typeof allTools & typeof uiTools;
  const tools = withInrAssistantToolActivities(serializeMutations(selectedTools),
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
    system = buildInrAssistantSystemPrompt(args.displayName, args.accountContext, getInrAssistantAppKnowledge(latestRequest, 1_200), args.edition, args.clientContext, Boolean(args.fileContexts?.length)) + (operationGuidance ? `\n${operationGuidance}` : "");
  }
  if (bytes({ system, messages }) + schemaBytes > 31_000) {
    // Compound requests can need many real action schemas. The guide remains
    // available as a tool; remove only its duplicated eager prose, not rights.
    system = buildInrAssistantSystemPrompt(args.displayName, args.accountContext, undefined, args.edition, args.clientContext, Boolean(args.fileContexts?.length)) + (operationGuidance ? `\n${operationGuidance}` : "");
  }
  while (messages.length > 1 && bytes({ system, messages }) + schemaBytes > 31_000) messages.shift();
  if (bytes({system,messages}) + schemaBytes > 30_500) system = buildInrAssistantSystemPrompt(args.displayName,undefined,undefined,args.edition,args.clientContext,Boolean(args.fileContexts?.length),true) + continuityContext + (operationGuidance ? `\n${operationGuidance}` : "");
  if (bytes({ system, messages }) + schemaBytes > 31_000) {
    noteFailure("input_limit", { inputBytes: bytes({ system, messages }) + schemaBytes, historyTurns: messages.length });
    throw new InrAssistantUnavailableError(lastFailure);
  }
  const quota = await reserveInrAssistantRequest({
    billingAccountId: args.accountId, requestId: args.requestId, edition: args.edition, complexity,
  });
  const chain = getInrAssistantModelChain({ edition: args.edition, complexity, solReserved: quota.solReserved });
  let success = false;
  const taskState = (outcome:InrAssistantTaskOutcome,question:string):InrAssistantTaskState => ({version:1,instruction:statusOnly?args.taskContext!.instruction:latestRequest,actionRequestId:args.actionRequestId??args.requestId,startedAt:args.actionStartedAt??new Date(started).toISOString(),expiresAt:new Date(started+(outcome==="processing"?24*60:30)*60_000).toISOString(),outcome,requiredTools:requiredTools.filter(name=>!["navigateApplication","runScreenCommand"].includes(name)),...(Object.keys(requiredCalls).length?{requiredCalls}:{}),receipts:compactInrAssistantTaskReceipts(receipts.filter(receipt=>!["navigateApplication","runScreenCommand"].includes(receipt.tool)),requiredTools,requiredCalls),question:question.slice(-2000)});
  const finishReply = (reply: InrAssistantReply): InrAssistantReply => {
    if (draftOnly) {
      const draft = studioDraftState.value ?? deriveInrAssistantStudioDraft(latestRequest, reply.message);
      success = Boolean(draft || reply.message.trim());
      return draft ? studioDraftReply(draft) : {message:reply.message,outcome:"completed"};
    }
    for (const result of publicationResults) {
      const name = result.action === "prepare" ? "preparePublication" : result.action === "edit" ? "editPublication" : result.action === "status" ? "getPublicationStatus" : "executePublication";
      if (!receipts.some(r=>r.tool === name && r.status === result.status)) receipts.push({tool:name,ok:result.ok,status:result.status,message:result.message,...(result.draftId?{draftId:result.draftId}:{}),toolUrl:result.toolUrl});
    }
    if (mediaState.result && !receipts.some(r=>r.tool === "generateMedia" || r.tool === "modifyMedia")) receipts.push({tool:requiredTools.includes("modifyMedia")?"modifyMedia":"generateMedia",ok:mediaState.result.ok,status:mediaState.result.status,message:mediaState.result.message,requestId:mediaState.result.requestId,...(mediaState.result.media?.id?{id:mediaState.result.media.id}:{})});
    const businessRequired=requiredTools.filter(name=>!["navigateApplication","runScreenCommand"].includes(name));
    if(!businessRequired.length && (navigationRequested || screenCommandRequested)) return {...reply,...(navigation?{navigation}:{}),...(uiCommand?{uiCommand}:{}),outcome:navigation || uiCommand?"processing":"needs_input"};
    const outcome = inrAssistantTaskOutcome(businessRequired,receipts.filter(receipt=>!["navigateApplication","runScreenCommand"].includes(receipt.tool)),reply.message,requiredCalls);
    success = outcome === "completed";
    if (!requiredTools.length) return verifiedHandoffMessage ? {...reply,needsHuman:true,handoffSummary:verifiedHandoffMessage,outcome:"blocked"} : reply;
    const label=(name:string)=>name==="navigateApplication"?"ouvrir l’outil demandé":name==="runScreenCommand"?"exporter le PDF demandé":inrAssistantCommandLabel(name);
    const remaining = businessRequired.filter(name=>!inrAssistantGoalCompleted(name,receipts,requiredCalls));
    const completed = businessRequired.filter(name=>inrAssistantGoalCompleted(name,receipts,requiredCalls) && !receipts.some(receipt=>receipt.tool===name && INR_ASSISTANT_PENDING_STATUSES.has(receipt.status)));
    const unfinished=businessRequired.filter(name=>!completed.includes(name));
    const factual = [...new Set(receipts.filter(r=>r.ok).map(r=>r.message))].join("\n\n");
    const message = outcome === "partial" ? `${factual || savedActionReply() || reply.message}\n\nIl reste à ${remaining.map(label).join(", ")}. Vous pouvez me demander de continuer ; les étapes déjà réalisées seront conservées.` : reply.message;
    return {...reply,...(navigation?{navigation}:{}),...(uiCommand?{uiCommand}:{}),...(verifiedHandoffMessage && outcome !== "completed" ? {needsHuman:true,handoffSummary:verifiedHandoffMessage}:{}),message,outcome,taskProgress:{outcome,completed:completed.map(label),remaining:unfinished.map(label)},taskState:taskState(outcome,message)};
  };
  try {
    // A clearly named module must not be forgotten when the same request also
    // asks for a read. Use the authenticated native tool; the client still
    // checks its account and unsaved form before applying the navigation.
    const directNavigation = !statusOnly && !draftOnly ? getDirectInrAssistantNavigationRequest(spokenRequest) : null;
    const directNavigationTool = tools.navigateApplication as ReturnType<typeof createInrAssistantUiTools>["navigateApplication"] | undefined;
    if (directNavigation && directNavigationTool?.execute) {
      await directNavigationTool.execute({ ...directNavigation, documentId: null }, { toolCallId: "direct-navigation", messages });
      if (navigation) system += `\nL’ouverture du module ${navigation.label} est déjà demandée au navigateur. Effectue aussi toutes les lectures et autres tâches demandées. N’annonce pas son ouverture avant le retour du navigateur.`;
    }
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
          stopWhen: [stepCountIs(maxCalls), () => checkpointFailed || llmCalls >= maxCalls || Boolean(studioDraftState.value) || Boolean(mediaState.result) && !followupAfterMedia],
          onStepFinish: async ({ toolResults }) => {
            let changed=false;
            for(const result of toolResults) if(result && recordToolResult(result)) changed=true;
            if(changed && requiredTools.length) {try {await checkpoint();} catch {/* stopWhen prevents further calls. */}}
          },
          prepareStep: ({ stepNumber, messages: stepMessages }) => {
            // A UI-only request can also contain reads that are not durable
            // business goals. Opening its module must not suppress those reads.
            const goalsDone = requiredTools.some(name=>!["navigateApplication","runScreenCommand"].includes(name)) && requiredTools.every(name=>inrAssistantGoalCompleted(name,receipts,requiredCalls)) && (!statusOnly || [...readCounts.keys()].some(name=>requiredTools.some(goal=>INR_ASSISTANT_COMMANDS[goal]?.statusReader===name)));
            const answerOnly = goalsDone || stepNumber >= maxCalls-1 || llmCalls >= maxCalls-1;
            if (stepNumber === 0 && !answerOnly && !args.taskContext && !navigation) return;
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
              activeTools: answerOnly ? [] : Object.keys(tools).filter(name => !(name === "navigateApplication" && navigation) && (readCounts.get(name)??0) < 2 && !(args.taskContext && inrAssistantGoalCompleted(name,args.taskContext.receipts,requiredCalls))) as Array<keyof typeof tools>,
              ...(answerOnly ? { toolChoice: "none" as const } : {}),
              system: buildInrAssistantSystemPrompt(args.displayName, undefined, readCounts.has("readAppGuide") ? undefined : getInrAssistantAppKnowledge(latestRequest, 1_800), args.edition, args.clientContext, Boolean(args.fileContexts?.length), true)
                + continuityContext + draftGuidance + (operationGuidance ? `\n${operationGuidance}` : "")
                + (navigation ? `\nL’ouverture de ${navigation.label} est déjà demandée au navigateur. Termine aussi les lectures demandées, sans annoncer la navigation terminée.` : "")
                + (args.taskContext ? `\nReprise vérifiée de la tâche. Résultats enregistrés, à réutiliser sans refaire ces actions : ${JSON.stringify(publicTaskReceipts(args.taskContext.receipts)).slice(0,5000)}. La précision actuelle complète seulement cette tâche. Réponds dans la langue de ce message : ${JSON.stringify(spokenRequest).slice(0,500)}` : "")
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
        if (studioDraftState.value) return finishReply(studioDraftReply(studioDraftState.value));
        for (const call of result.steps.flatMap((step) => step.toolCalls)) {
          const input = call?.input && typeof call.input === "object" ? call.input as Record<string, unknown> : {};
          if (humanSupportRequested && call?.toolName === "proposeHumanSupport" && !call.dynamic && typeof input.message === "string" && typeof input.summary === "string") {
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
      if(checkpointFailed) return finishReply({message:savedActionReply() || "Le résultat de la tâche doit être vérifié avant de poursuivre. Aucune opération supplémentaire n’a été lancée."});
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
      if (verifiedHandoffMessage) return finishReply({message:verifiedHandoffMessage,needsHuman:true,handoffSummary:verifiedHandoffMessage});
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
