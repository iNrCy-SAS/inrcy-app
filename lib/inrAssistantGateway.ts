import "server-only";

import { createInrAssistantToolRegistry } from "./inrAssistantToolRegistry.ts";
import type { InrAssistantGatewayArgs, InrAssistantReply } from "./inrAssistantGatewayTypes.ts";
import type { InrAssistantMediaResult } from "./inrAssistantMediaTools.ts";
import type { InrAssistantPublicationResult } from "./inrAssistantPublicationTools.ts";

import { asSchema, createGateway, generateText, InvalidToolInputError, jsonSchema, tool, wrapLanguageModel } from "ai";
import { assistantToolsForEdition } from "./inrAssistantEditionPolicy.ts";
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
import { reserveInrAssistantBudget, finalizeInrAssistantBudget } from "./inrAssistantBudget.ts";
import { buildInrAssistantSystemPrompt, InrAssistantInputError } from "./inrAssistantConversation.ts";
import { getInrAssistantAppKnowledge, createInrAssistantAppGuideTool, getVerifiedInrAssistantNavigation } from "./inrAssistantAppGuides.ts";
import { selectInrAssistantToolFamilies, inrAssistantSelectionToolHints, inrAssistantRoutingText, inrAssistantRequiredTools, inrAssistantTaskOutcome, verifiedInrAssistantCapabilityLimit } from "./inrAssistantToolRouting.ts";
import type { InrAssistantTaskState, InrAssistantTaskOutcome, InrAssistantActionReceipt } from "./inrAssistantTaskPolicy.ts";
import { INR_ASSISTANT_APPROVAL_KINDS, inrAssistantRequiredCalls, inrAssistantGoalCompleted, inrAssistantTaskTrackingLimit, compactInrAssistantTaskReceipts, inrAssistantRequestClauses, inrAssistantClauseIsAdvice } from "./inrAssistantTaskPolicy.ts";
import { inrAssistantObjectives, inrAssistantObjectiveCompleted, inrAssistantObjectiveReady, inrAssistantPlanAllowsAction, inrAssistantPlanAllowsRead, inrAssistantReadMatchesObjective, inrAssistantObjectiveFamily, inrAssistantObjectiveLabel, createInrAssistantReadBudget } from "./inrAssistantObjectives.ts";
import { inrAssistantUiActionsFromToolResult, INR_ASSISTANT_MAX_UI_ACTIONS, type InrAssistantUiAction } from "./inrAssistantUiActions.ts";
import { inrAssistantUiSteps, rebindInrAssistantUiStep, inrAssistantUiStepAcceptsAction, inrAssistantUiStepTool, isInrAssistantUiTaskTool, INR_ASSISTANT_UI_TASK_TOOLS, type InrAssistantUiStep } from "./inrAssistantUiTask.ts";
import { compactInrAssistantRejectedToolContext } from "./inrAssistantRejectedToolContext.ts";
import { discoverInrAssistantActionCoverage, INR_ASSISTANT_COVERAGE_FAMILIES } from "./inrAssistantActionCoverage.ts";
import { deriveInrAssistantStudioDraft, isInrAssistantStudioDraftRequest, parseInrAssistantStudioDraft, type InrAssistantStudioDraft } from "./inrAssistantStudioDraft.ts";
import { withInrAssistantToolActivities } from "./inrAssistantActivity.ts";
import { classifyInrAssistantGatewayFailure, projectInrAssistantGatewayDiagnostic, recordInrAssistantGatewayDiagnostic,
  type InrAssistantDiagnosticPhase, type InrAssistantGatewayDiagnostic } from "./inrAssistantGatewayDiagnostics.ts";
import { assistantModelInputBudget } from "./inrAssistantAttachments.ts";
import { assistantMessagesWithFiles } from "./inrAssistantAttachmentPrompt.ts";
import { compactInrAssistantGuideContext } from "./inrAssistantPromptContext.ts";
import { INR_ASSISTANT_COMMANDS, INR_ASSISTANT_PENDING_STATUSES, INR_ASSISTANT_UNCERTAIN_STATUSES } from "./inrAssistantCommandRegistry.ts";
import { createInrAssistantUiTools } from "./inrAssistantUiTools.ts";
import { getPureInrAssistantStatsViewRequest, getPureInrAssistantStatsViewSequence } from "./inrAssistantPureStatsViewRequest.ts";
import { getDirectInrAssistantNavigationRequest, getPureInrAssistantNavigationRequest, parseInrAssistantNavigation, isInrAssistantNavigationRequest, isInrAssistantScreenCommandRequest, parseInrAssistantUiCommand, type InrAssistantNavigation, type InrAssistantUiCommand } from "./inrAssistantUiCommands.ts";

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

export type { InrAssistantReply } from "./inrAssistantGatewayTypes.ts";

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

export async function generateInrAssistantReply(args: InrAssistantGatewayArgs): Promise<InrAssistantReply> {
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
  const savedUiSteps = args.taskContext?.uiSteps;
  const uiResumeRequested = Boolean(args.taskContext && args.actionInstruction && (args.taskIntent === "continue"
    || spokenRequest !== latestRequest && /^(?:oui[, ]+)?(?:continuer?|reprends|termine|poursuis)\b/.test(inrAssistantRoutingText(spokenRequest))));
  const uiSteps: InrAssistantUiStep[] = (savedUiSteps && uiResumeRequested
    ? rebindInrAssistantUiStep(savedUiSteps, args.browserStepResults ?? [], args.clientContext)
    : savedUiSteps ?? inrAssistantUiSteps(latestRequest, args.clientContext)).map(step => ({ ...step }));
  const appliedUi = new Set((uiResumeRequested || args.taskIntent === "check_status" ? args.browserStepResults ?? [] : []).filter(result => result.status === "applied" && uiSteps.some(step => step.id === result.stepId && step.source)).map(result => result.stepId));
  const statusOnly = Boolean(args.taskContext && args.actionInstruction && (args.taskIntent === "check_status" || args.taskContext.outcome === "processing" && !uiSteps.length));
  // A mounted screen intent such as “affiche la vue Évolution” can also
  // lexically resemble navigation. Its concrete server plan is authoritative.
  const navigationRequested = uiSteps.length ? uiSteps.some(step => inrAssistantUiStepTool(step) === "navigateApplication" && !step.actions?.length && !appliedUi.has(step.id)) : isInrAssistantNavigationRequest(args.taskContext ? spokenRequest : latestRequest);
  const screenCommandRequested = uiSteps.some(step => inrAssistantUiStepTool(step) === "runScreenCommand" && !step.actions?.length && !appliedUi.has(step.id));
  const draftOnly = isInrAssistantStudioDraftRequest(latestRequest);
  const insertRequest = requestsStudioInsertion(spokenRequest);
  if (!args.actionInstruction && !draftOnly && (shortAffirmation(spokenRequest) || insertRequest)) {
    const draft = previousStudioDraft(args.messages);
    if (draft) return { ...studioDraftReply(draft), insertStudioDraft: true };
  }
  const capabilityLimit = draftOnly ? null : verifiedInrAssistantCapabilityLimit(latestRequest,args.edition);
  if (capabilityLimit) return {message:capabilityLimit,outcome:"blocked"};
  // Known view buttons retain the same durable, ordered browser handoff as
  // model-driven tasks. Only a verified ACK can advance this finite sequence.
  const statsWorkflowInstruction = args.taskContext?.instruction ?? latestRequest;
  const statsSequence = args.edition === "basic" && statsWorkflowInstruction.trim().length <= 1200 && !args.fileContexts?.length && !draftOnly
    && ((!args.taskContext && !args.actionInstruction) || uiResumeRequested || args.taskIntent === "check_status")
    && !args.taskContext?.requiredTools.length && !args.taskContext?.receipts.length && !inrAssistantRequiredTools(statsWorkflowInstruction).length
    ? getPureInrAssistantStatsViewSequence(statsWorkflowInstruction, args.clientContext)
      ?? (args.taskContext && savedUiSteps?.[0]?.screen ? getPureInrAssistantStatsViewSequence(statsWorkflowInstruction, { source: "untrusted_client", screen: savedUiSteps[0].screen }) : null) : null;
  if (statsSequence && statsSequence.length === uiSteps.length && uiSteps.every((step, index) => step.command === statsSequence[index].command
    && step.instruction === inrAssistantRequestClauses(statsWorkflowInstruction)[index])) {
    const viewLabel = (index: number) => `Vue ${statsSequence[index].patch.panel === "all" ? "globale" : "Évolution"}`;
    const progress = (outcome: InrAssistantTaskOutcome) => ({ outcome,
      completed: uiSteps.flatMap((step, index) => appliedUi.has(step.id) ? [viewLabel(index)] : []),
      remaining: uiSteps.flatMap((step, index) => appliedUi.has(step.id) ? [] : [viewLabel(index)]) });
    const state = (outcome: InrAssistantTaskOutcome, question: string): InrAssistantTaskState => ({ version: 1,
      instruction: args.taskContext?.instruction ?? latestRequest, actionRequestId: args.actionRequestId ?? args.requestId,
      startedAt: args.taskContext?.startedAt ?? args.actionStartedAt ?? new Date().toISOString(),
      expiresAt: args.taskContext?.expiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
      outcome, requiredTools: [], receipts: [], uiSteps: uiSteps.map(step => ({ ...step })), question });
    const failure = (message: string): InrAssistantReply => ({ message, outcome: "blocked", taskState: state("blocked", message), taskProgress: progress("blocked") });
    if (args.signal?.aborted) { noteFailure("request_aborted", { callCount: 0 }); args.signal.throwIfAborted(); }
    if (args.browserStepResults?.some(result => uiSteps.some(step => step.id === result.stepId) && ["failed", "cancelled"].includes(result.status))) {
      return failure("Un changement de vue n’a pas été confirmé. Vérifiez l’écran puis renouvelez la demande ; aucune étape n’a été rejouée.");
    }
    if (args.browserStepResults?.some(result => result.status === "applied" && uiSteps.some(step => step.id === result.stepId && (!step.source || !step.actions?.length)))) {
      return failure("La confirmation de cette étape ne peut pas être vérifiée. Aucune étape supplémentaire n’a été lancée.");
    }
    if (uiSteps.some(step => appliedUi.has(step.id) && !args.browserStepResults?.some(result => result.stepId === step.id && result.status === "applied"
      && result.postScreen?.pathname === "/dashboard/stats" && result.postScreen.selection.kind === "stats" && result.postScreen.selection.id === "stats" && Boolean(result.postScreen.revision)))) {
      return failure("La confirmation reçue ne correspond pas à la vue iNr’Stats demandée. Aucune étape supplémentaire n’a été lancée.");
    }
    const index = uiSteps.findIndex(step => !appliedUi.has(step.id));
    if (index < 0) return { message: "Les changements de vue demandés sont confirmés dans iNr’Stats.", outcome: "completed", taskState: state("completed", ""), taskProgress: progress("completed") };
    if (args.taskIntent === "check_status") return { message: `${appliedUi.size} changement(s) de vue confirmé(s). La suite attend le résultat du navigateur ou une demande de reprise. Aucune action n’a été relancée.`, outcome: "partial", taskState: state("partial", "La suite attend le résultat du navigateur ou une demande de reprise."), taskProgress: progress("partial") };
    const step = uiSteps[index], screen = args.clientContext?.screen;
    if (step.actions?.length) return { message: "La suite attend le résultat vérifié du navigateur. L’étape déjà transmise n’a pas été rejouée.", outcome: "partial", taskState: state("partial", "La suite attend le résultat vérifié du navigateur."), taskProgress: progress("partial") };
    if (!screen || !step.screen || step.screen.pathname !== screen.pathname || step.screen.revision !== screen.revision
      || JSON.stringify(step.screen.selection) !== JSON.stringify(screen.selection) || !screen.availableCommands?.includes("configure_stats_view")) {
      return failure("La vue ou l’établissement a changé depuis l’étape précédente. Renouvelez la demande sur l’écran actuel ; aucune étape supplémentaire n’a été lancée.");
    }
    if (index > 0 && !args.browserStepResults?.some(result => result.stepId === uiSteps[index - 1].id && result.status === "applied"
      && result.postScreen?.pathname === screen.pathname && result.postScreen.revision === screen.revision
      && JSON.stringify(result.postScreen.selection) === JSON.stringify(screen.selection))) {
      return failure("L’écran ne correspond plus à la dernière étape confirmée. Aucune étape supplémentaire n’a été lancée.");
    }
    const request = statsSequence[index];
    const nativeScreen = createInrAssistantUiTools({ accountId: args.accountId, edition: args.edition, currentUserMessage: statsWorkflowInstruction, clientContext: args.clientContext, supabase: args.supabase, canStartWork: () => !args.signal?.aborted }).runScreenCommand;
    if (!nativeScreen?.execute) return failure("Le changement de vue natif n’est pas disponible. Aucune commande n’a été transmise.");
    const result: unknown = await nativeScreen.execute({ ...request, documentId: null, documentKind: null, recipient: null }, { toolCallId: `direct-stats-${step.id}`, messages: args.messages });
    const output = result && typeof result === "object" ? result as Record<string, unknown> : {};
    const command = output.ok === true ? parseInrAssistantUiCommand(output.uiCommand) : null;
    if (command?.command !== "configure_stats_view" || command.revision !== screen.revision || command.selection.id !== "stats"
      || JSON.stringify(command.patch) !== JSON.stringify(request.patch)) return failure(output.ok === false && typeof output.message === "string" ? output.message : "Le changement de vue demandé n’a pas pu être vérifié. Aucune commande n’a été transmise.");
    const actions = inrAssistantUiActionsFromToolResult(`direct-stats-${step.id}`, { ok: true, uiCommand: command });
    step.actions = actions;
    return { message: `Affichage de la ${viewLabel(index).toLowerCase()} demandé. La suite attend la confirmation de l’écran.`, uiCommand: command, uiActions: actions,
      outcome: "partial", taskState: state("partial", "La suite attend la confirmation de l’écran."), taskProgress: progress("partial") };
  }
  // Two named native view buttons need no model inference. Keep the normal
  // authenticated screen executor and signed browser acknowledgement path.
  const pureStatsView = !args.taskContext && !args.actionInstruction && !args.fileContexts?.length && !draftOnly && !inrAssistantRequiredTools(latestRequest).length
    ? getPureInrAssistantStatsViewRequest(spokenRequest, args.clientContext) : null;
  if (pureStatsView) {
    if (args.signal?.aborted) { noteFailure("request_aborted", { callCount: 0 }); args.signal.throwIfAborted(); }
    const nativeScreen = createInrAssistantUiTools({ accountId: args.accountId, edition: args.edition, currentUserMessage: spokenRequest, clientContext: args.clientContext, supabase: args.supabase, canStartWork: () => !args.signal?.aborted }).runScreenCommand;
    if (nativeScreen?.execute) {
      const result: unknown = await nativeScreen.execute({ ...pureStatsView, documentId: null, documentKind: null, recipient: null }, { toolCallId: "direct-stats-view", messages: args.messages });
      const output = result && typeof result === "object" ? result as Record<string, unknown> : {};
      const command = output.ok === true ? parseInrAssistantUiCommand(output.uiCommand) : null;
      if (command?.command === "configure_stats_view" && command.revision === args.clientContext?.screen?.revision
        && command.selection.id === "stats" && JSON.stringify(command.patch) === JSON.stringify(pureStatsView.patch)) {
        return { message: `Affichage de la vue ${pureStatsView.patch.panel === "evolution" ? "Évolution" : "globale"} demandé.`, uiCommand: command, outcome: "processing" };
      }
      return { message: output.ok === false && typeof output.message === "string" ? output.message : "Le changement de vue n’a pas pu être vérifié. Aucune commande n’a été transmise.", outcome: "blocked" };
    }
  }
  // Opening one named module needs only the native authenticated command. Keep
  // this independent of AI credentials, Redis and paid-provider availability.
  // Existing tasks, attached content and additional actions retain the full pipeline.
  const pureNavigation = !args.taskContext && !args.actionInstruction && !args.fileContexts?.length && !draftOnly && !screenCommandRequested && !inrAssistantRequiredTools(latestRequest).length
    ? getPureInrAssistantNavigationRequest(spokenRequest) : null;
  if (pureNavigation) {
    if (args.signal?.aborted) {
      noteFailure("request_aborted", { callCount: 0 });
      args.signal.throwIfAborted();
    }
    const nativeNavigation = createInrAssistantUiTools({ accountId: args.accountId, edition: args.edition, currentUserMessage: spokenRequest, clientContext: args.clientContext, supabase: args.supabase, canStartWork: () => !args.signal?.aborted }).navigateApplication;
    if (nativeNavigation?.execute) {
      const result: unknown = await nativeNavigation.execute({ ...pureNavigation, documentId: null }, { toolCallId: "direct-navigation", messages: args.messages });
      const output = result && typeof result === "object" ? result as Record<string, unknown> : {};
      const target = output.ok === true ? parseInrAssistantNavigation(output.navigation) : null;
      if (target?.destination === pureNavigation.destination) return { message: `Ouverture de ${target.label} demandée.`, navigation: target, outcome: "processing" };
      return { message: output.ok === false && typeof output.message === "string" ? output.message : "L’ouverture de cet outil n’a pas pu être vérifiée. Aucune navigation n’a été transmise.", outcome: "blocked" };
    }
  }
  const families = selectInrAssistantToolFamilies(latestRequest, args.messages.filter(message => message.role === "user").slice(0, -1).map(message => message.content));
  const objectives = draftOnly ? [] : inrAssistantObjectives(args.taskContext && args.actionInstruction ? args.taskContext.instruction : latestRequest, uiSteps);
  for (const objective of objectives) { const family=inrAssistantObjectiveFamily(objective.tool);if(family) families.add(family); }
  const adviceOnly = inrAssistantRequestClauses(latestRequest).some(inrAssistantClauseIsAdvice) && !inrAssistantRequiredTools(latestRequest).length && !uiSteps.length;
  const canExecute = !draftOnly && !adviceOnly;
  const canSaveExistingGeneration = args.taskIntent === "continue" && Boolean(args.taskContext?.receipts.some(receipt => ["generateMedia","modifyMedia"].includes(receipt.tool) && receipt.resultMode === "save" && receipt.requestId));
  const humanSupportRequested = requestedHumanSupport(spokenRequest);
  const studioDraftState: {value?: InrAssistantStudioDraft} = {};
  const prepareStudioPrompt = tool({
    description: "Préparer uniquement un prompt éditable et proposer son insertion dans iNrStudio. Cette action gratuite n’exécute aucune génération, ne consomme aucun crédit média et ne publie rien. Choisir Image ou Vidéo selon la demande, conserver le prompt complet, et renseigner seulement les critères connus.",
    inputSchema: jsonSchema<InrAssistantStudioDraft>({type:"object",additionalProperties:false,properties:{version:{type:"integer",enum:[1]},mediaType:{type:"string",enum:["image","video"]},prompt:{type:"string",minLength:3,maxLength:4000},format:{type:["string","null"],enum:["square","portrait","story","landscape",null]},durationSeconds:{type:["integer","null"],minimum:4,maximum:30}},required:["version","mediaType","prompt","format","durationSeconds"]}, {validate:value=>{const draft=parseInrAssistantStudioDraft(value);return draft?{success:true,value:draft}:{success:false,error:new Error("Invalid editable Studio prompt")};}}),
    execute: async input => { const draft = parseInrAssistantStudioDraft(input); if (!draft) throw new InrAssistantInputError("Le prompt Studio est invalide."); studioDraftState.value = draft; return {ok:true,status:"draft",studioDraft:draft,message:"Prompt prêt à être inséré dans iNrStudio. Aucune génération lancée."}; },
  });
  const verifiedNavigation = navigationRequested || args.taskContext ? null : getVerifiedInrAssistantNavigation(latestRequest);
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
  // A mounted form clause replaces only its own lexical business goals.
  if (uiSteps.length && !args.taskContext) {
    const business = new Set(objectives.filter(objective => objective.kind === "action").map(objective => objective.tool));
    for (let index = requiredTools.length - 1; index >= 0; index--) if (!business.has(requiredTools[index])) requiredTools.splice(index, 1);
  }
  if (canExecute && !args.taskContext) {
    for (const name of inrAssistantSelectionToolHints(latestRequest, args.clientContext?.screen)) {
      if (!requiredTools.includes(name)) requiredTools.push(name);
      families.add("media");
    }
  }
  for(const objective of objectives) if(objective.kind==="read" && !requiredTools.includes(objective.tool)) requiredTools.push(objective.tool);
  if (navigationRequested) requiredTools.push("navigateApplication");
  for (const step of uiSteps) if (!requiredTools.includes(inrAssistantUiStepTool(step))) requiredTools.push(inrAssistantUiStepTool(step));
  const requiredCalls = { ...inrAssistantRequiredCalls(latestRequest), ...args.taskContext?.requiredCalls };
  if (uiSteps.length) for (const name of Object.keys(requiredCalls)) {
    if (!requiredTools.includes(name)) delete requiredCalls[name];
    else if (objectives.some(objective => objective.kind === "action" && objective.tool === name)) requiredCalls[name] = objectives.filter(objective => objective.kind === "action" && objective.tool === name).reduce((count, objective) => count + objective.count, 0);
  }
  for(const name of new Set(objectives.filter(objective=>objective.kind==="read").map(objective=>objective.tool))) {
    const count=objectives.filter(objective=>objective.kind==="read" && objective.tool===name).length;
    if(count>1) requiredCalls[name]=Math.max(requiredCalls[name]??1,count);
  }
  if (!args.taskContext && requiredTools.includes("importMediaAttachment")) {
    const attachments = args.mediaAttachments ?? [];
    const named = attachments.filter(file => latestRequest.toLowerCase().includes(file.name.toLowerCase())).length;
    const text = inrAssistantRoutingText(latestRequest);
    const plural = text.match(/\b(?:(?:ces|les)(?:\s+(?:deux|trois|quatre|\d+))?|(?:tous|toutes)\s+(?:les|ces))\s+(images|photos|videos|fichiers\s+audio|audios|sons|fichiers|medias|pieces\s+jointes|pj)\b/)?.[1];
    const selectedKind = plural && /^(?:images|photos)$/.test(plural) ? "image" : plural === "videos" ? "video" : plural && /^(?:audios|sons|fichiers\s+audio)$/.test(plural) ? "audio" : null;
    const selected = plural ? attachments.filter(file => selectedKind === null || file.kind === selectedKind).length : 1;
    const count = Math.max(requiredCalls.importMediaAttachment ?? 1, named, selected);
    if (count > 1) requiredCalls.importMediaAttachment = count;
  }
  const trackingLimit = inrAssistantTaskTrackingLimit(requiredTools, requiredCalls);
  if (trackingLimit) return {message:trackingLimit,outcome:"blocked"};
  let maxCalls = complexity === "complex" || requiredTools.length > 1 || Object.values(requiredCalls).some(count=>count > 1) ? 12 : requiredTools.length ? 7 : 4;
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
  const readBudget = createInrAssistantReadBudget();
  const readObjectiveAtStart = new Map<string, string>();
  const previewActionNames = new Set(["previewNotificationRemoval","previewPublishedPublicationEdit","previewCalendarAction","previewScheduledPublicationAction","previewScheduledPublicationEdit","previewGoogleBusinessProfileUpdate","previewMediaDeletion","previewPublicationLifecycleAction","previewIndividualMail","previewCommercialDocumentAction","previewCommercialTemplateAction","previewChannelResourceSelection","previewChannelDisconnection","previewGoogleReviewReplyAction","previewBusinessDnaDocumentRemoval","previewWebsiteAnalyticsDisconnection","previewPinterestBoardMutation","previewWebsiteReset","previewReferralSubmission"]);
  const observedActionNames = new Set([...Object.keys(INR_ASSISTANT_COMMANDS),...INR_ASSISTANT_UI_TASK_TOOLS,"previewCampaignAudience",...previewActionNames,"applyCalendarAction","applyScheduledPublicationAction"]);
  const privateApprovals=new Map(receipts.flatMap(receipt=>receipt.approvalReference && receipt.approvalToken && receipt.approvalKind?[[receipt.approvalReference,{token:receipt.approvalToken,kind:receipt.approvalKind}] as const]:[]));
  const resolvePreview=(reference:string)=>privateApprovals.get(reference)?.token??null;
  let navigation: InrAssistantNavigation | undefined;
  let uiCommand: InrAssistantUiCommand | undefined;
  const uiActions: InrAssistantUiAction[] = [];
  const uiStepCalls = new Map<string, InrAssistantUiStep>();
  const uiReady = (step: InrAssistantUiStep) => {
    const index = objectives.findIndex(objective => objective.id === step.id);
    return index >= 0 && objectives.slice(0, index).every((objective, position) => objective.kind === "ui"
      ? appliedUi.has(objective.id) || step.command === "export_document_pdf" && uiSteps.some(previous => previous.id === objective.id && previous.command === "navigateApplication" && previous.actions?.length && uiActions.some(action => previous.actions?.some(queued => queued.id === action.id)))
      : inrAssistantObjectiveCompleted(objectives, position, receipts, appliedUi));
  };
  const savedActionReply = () => [...actionFacts.values()].map(fact => `${fact.message}${fact.href ? `\n\n[${fact.label ?? "Ouvrir l’outil"}](${fact.href})` : ""}`).join("\n\n");
  const followupAfterMedia = requiredTools.some(name=>!['generateMedia','modifyMedia'].includes(name)) || families.has("publication") || families.has("business") && /\b(?:adn|dna|configuration|reglages)\b/i.test(latestRequest);
  const buildRegistry = (discovery?: {
      families: typeof families;
      requiredTools: string[];
      discoveryTopics: string[];
  }) => createInrAssistantToolRegistry({
      args, latestRequest, spokenRequest, families, requiredTools, canExecute,
      draftOnly, statusOnly, navigationRequested, screenCommandRequested, resolvePreview,
      remainingTimeMs: () => deadline - Date.now(),
      onMediaStarted: (requestId) => { mediaState.requestId = requestId; deadline = started + 780_000; },
      onMediaResult: (result) => { mediaState.result = result; },
      onPublicationResult: (result) => { publicationResults.push(result); },
      ...discovery,
  });
  const { uiTools, mediaTools, accountTools, diagnosticTools, channelTools, workspaceTools, memoryTools, attachmentTools, businessTools, ctaTools, dnaAnalysisTools, managementTools, publicationTools, workspaceActionTools, insightsTools, commercialTools, documentTools, calendarTools, scheduledTools, communicationTools, advertisingTools, settingsTools, campaignTools, mailboxTools, additionalTools } = buildRegistry();
  const operationGuidance = [
    requiredTools.includes("getAccountDiagnostics") ? "Diagnostic demandé : consulte getAccountDiagnostics pour les signaux enregistrés du problème, même si une publication récente paraît publiée. Un simple statut ne remplace pas ce diagnostic ; source indisponible = inconnue, aucun signal ne prouve pas l’absence de problème. Aucune relance ou nouvelle création n’est autorisée par cette lecture." : "",
    Object.keys(additionalTools).length ? "Actions des outils inclus : lire les références réelles avant mutation. Toute suppression ou modification de fiche Google passe par un aperçu signé puis sa référence IA exacte confirmée actuellement. Les aperçus ne sont jamais des actions achevées. Pour les médias, importer uniquement les pièces jointes du tour courant ; téléchargement demandé au navigateur, jamais annoncé terminé sans retour. Les réglages/activations Basic sont permis ; les agents restent Standard. L’envoi d’un bilan exige un ordre explicite d’envoi, un PDF consulté ne l’autorise pas." : "",
    uiSteps.length ? `Parcours UI prévu, dans l’ordre : ${uiSteps.map(step => step.command).join(" → ")}. instructionQuote = extrait exact de la demande originale avec verbe et objet. Les commandes sont seulement transmises au navigateur ; toute suite attend son retour vérifié. Ne présente pas l’écran comme modifié sans reçu et ne répète pas une commande déjà transmise.` : "",
    Object.keys(commercialTools).length ? "CRM : retrouve les IDs avec searchCrmContacts ; manageCrmContact ne change que la fiche demandée. prepareCommercialDocument enregistre seulement un brouillon : quantité, prix HT et TVA explicites, renseignements manquants signalés, jamais de numéro officiel, finalisation ou envoi. Documents commerciaux distincts des factures d’abonnement." : "",
    Object.keys(communicationTools).length ? "readCommunicationRecords retrouve les éléments actuels ; updateCampaignDraft corrige le brouillon. dispatchCampaignDraft exige les destinataires littéraux du dernier ordre ; programmation = date/heure/fuseau explicites. queued ne prouve pas livraison. Pour confirmer, déplacer ou annuler un rendez-vous, utilise previewCalendarAction puis présente son aperçu et sa référence IA. applyCalendarAction exige la confirmation actuelle exacte, jamais un simple oui. Préparer n’autorise pas envoyer." : "",
    Object.keys(documentTools).length ? "Documents : readCommercialDocuments lit les vrais documents du compte avant toute action. finalizeCommercialDocument valide uniquement le document/version explicitement demandé, sans envoi ni paiement." : "",
    Object.keys(scheduledTools).length ? "Planning : readScheduledPublications lit les éléments réels. Toute modification passe par previewScheduledPublicationAction et la confirmation exacte IA avant applyScheduledPublicationAction. Ne recrée jamais une publication pour reprendre son statut." : "",
    Object.keys(advertisingTools).length ? "ADS : vérifie les campagnes/prérequis avec readAdvertisingCampaigns. prepareAdvertisingCampaign prépare un brouillon avec budget/date explicitement demandés. manageAdvertisingCampaign respecte les actions disponibles et validations natives ; un brouillon ou un lien ne lance jamais une campagne facturée." : "",
    args.edition === "basic" ? "Basique : réalise les outils manuels inclus et vérifie chaque résultat. Identité : readBusinessIdentity puis updateBusinessIdentity avec sa version et les seules valeurs fournies. Canaux : ressources réellement accessibles, aperçu signé avant changement de cible ou déconnexion ; OAuth reste personnel. Avis : listGoogleReviews pour filtrer/paginer ; modification ou suppression de réponse par aperçu confirmé. Studio : quoteMediaGeneration donne le coût natif sans lancer ; paramètres et références vérifiés, consentements jamais inventés. Retouche gratuite : select_image_source/configure_image_retouch/reset_image_retouch/save_image_retouch, réglages par changes[{field,valueJson}] ; stats configure_stats_view sélectionne la vue native. Téléchargement QR : download_badge_qr au format PNG ou PDF. Une action d’écran attend son reçu avant toute suite. Ne réduis jamais une liste partielle à tous les éléments." : "",
    Object.keys(settingsTools).length ? "Réglages : readToolSettings puis updateToolSettings changent seulement les valeurs demandées et relisent le résultat. Présente les résultats partiels/inconnus comme tels ; ne devine aucune déclaration légale ni identité." : "",
    Object.keys(channelTools).length ? "Cockpit et canaux : readChannelStatus utilise les mêmes règles de comptage que le cockpit. Appelle-le pour l’état, les manquants, le total et les blocages ; le contexte initial partiel ne prouve pas le total. Un état enregistré n’est pas une vérification réseau en direct." : "",
    Object.keys(campaignTools).length ? "Campagne vers un segment CRM : listCampaignMailboxes retrouve les expéditeurs ; selectCampaignMailbox enregistre celui choisi, jamais deviné. previewCampaignAudience fige l’audience et fournit une référence AP à montrer avec nombre de destinataires, objet, expéditeur et exclusions. dispatchCampaignAudience exige l’ordre actuel et cette référence exacte ; une référence ancienne ou un simple oui ne vaut pas confirmation." : "",
    statusOnly ? `${args.taskIntent === "continue" ? "Poursuite du même travail : getMediaGeneration reste en lecture seule ; acceptMediaGeneration peut conserver uniquement une génération initialement demandée avec enregistrement et déjà vérifiée, si le serveur la reconnaît. Aucun nouveau job." : "Suivi en lecture seule : aucune écriture."} Utilise les lecteurs de statut avec les références enregistrées ${JSON.stringify(publicTaskReceipts(args.taskContext?.receipts)).slice(0,4000)}. Aucun nouveau lancement. Un résultat en attente reste en attente.` : "",
  ].filter(Boolean).join("\n");
  system += operationGuidance ? `\n${operationGuidance}` : "";
  // Native settings endpoints merge the active account's existing configuration.
  // Serialize writes in one turn so parallel model tool calls cannot overwrite
  // a sibling tool's freshly saved fields. Read-only tools remain concurrent.
  let mutationTail: Promise<unknown> = Promise.resolve();
  let checkpointFailed = false;
  const seenToolResults=new Set<string>();
  const resultToolName=(name:string, output:Record<string,unknown>):string => {
    if(name === "applyCalendarAction") return ({confirm:"confirmCalendarAppointment",update:"updateCalendarAppointment",cancel:"cancelCalendarAppointment",reject:"rejectCalendarAppointment"} as Record<string,string>)[String(output.action)]??name;
    if(name === "previewScheduledPublicationEdit" && output.ok === true && output.status === "unchanged") return "editScheduledPublication";
    if(name === "applyPublishedPublicationEdit") return "editPublication";
    if(name === "applyScheduledPublicationAction") return ({reschedule:"updateScheduledPublication",cancel:"cancelScheduledPublication",edit:"editScheduledPublication",retry:"retryScheduledPublication",publish_now:"publishScheduledPublicationNow"} as Record<string,string>)[String(output.action)]??name;
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
                const index=objectives.findIndex(objective=>inrAssistantReadMatchesObjective(objective,result.toolName,result.input) && objective.id===readObjectiveAtStart.get(result.toolCallId));
                if(index>=0) {
                  const objective=objectives[index];
                  const verified=(output.ok===true || output.available===true || output.found===true) && output.ok!==false && output.available!==false
                    && !(result.toolName === "getAccountDiagnostics" && output.complete === false) && !(result.toolName === "readAccountServices" && (result.input as {view?:string} | undefined)?.view === "credits" && output.quotaKnown === false);
                  const more=typeof output.nextOffset==="number" || typeof output.nextPage==="number" || typeof output.nextCursor==="string" || output.truncated===true || output.complete===false;
                  receipts.push({tool:objective.tool,recordId:objective.id,ok:verified,status:verified && !(objective.exhaustive && more)?"read":"partial",message:verified?`${inrAssistantObjectiveLabel(objective.tool)}${objective.exhaustive && more?" : recherche encore partielle.":" : lecture effectuée."}`:"La lecture demandée n’a pas pu être vérifiée."});
                  receiptsChanged=true;
                }
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
              if((isInrAssistantUiTaskTool(result.toolName) || ["prepareMediaDownload","prepareStatsReportDownload"].includes(result.toolName)) && output.ok === true) uiCommand=parseInrAssistantUiCommand(output.uiCommand)??undefined;
              const queuedActions=inrAssistantUiActionsFromToolResult(result.toolCallId,output);
              if(uiActions.length+queuedActions.length>INR_ASSISTANT_MAX_UI_ACTIONS) throw new InrAssistantInputError("La limite d’actions à transmettre au navigateur est atteinte. Les actions restantes n’ont pas été transmises.");
              const uiStep = uiStepCalls.get(result.toolCallId);
              if (uiStep && queuedActions.some(action => inrAssistantUiStepAcceptsAction(uiStep, action))) uiStep.actions = queuedActions;
              uiActions.push(...queuedActions);
              if (["navigateApplication", "prepareCommercialDocumentForm", "resumePublicationDraft", "openNotificationAction"].includes(result.toolName) && output.ok === true && output.navigation && typeof output.navigation === "object") {
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
              if (result.toolName === "acceptMediaGeneration" && output.ok === true && output.status === "completed" && typeof output.requestId === "string") {
                for (let index=0;index<receipts.length;index++) { const previous=receipts[index]; if (["generateMedia","modifyMedia"].includes(previous.tool) && previous.requestId === output.requestId) receipts[index]={...previous,ok:true,status:"completed",draft:false,message}; }
              }
              const receipt: InrAssistantActionReceipt = {tool:resultToolName(result.toolName,output),ok:output.ok === true,status:typeof output.status === "string"?output.status:"unknown",message};
              if (output.resultMode === "save" || output.resultMode === "preview") receipt.resultMode=output.resultMode;
              if (typeof output.draft === "boolean") receipt.draft=output.draft;
              if (receipt.ok && receipt.status === "ready_to_save" && receipt.resultMode === "preview" && receipt.draft === true) receipt.status="preview_generated";
              for (const key of ["id","draftId","requestId","scheduledActionId","eventId","recordId","publicationId"] as const) if (typeof output[key] === "string" && /^[a-z0-9_-]{8,180}$/i.test(output[key])) receipt[key] = output[key];
              if(typeof output.campaignId === "string" && /^[a-f0-9-]{36}$/i.test(output.campaignId)) receipt.recordId=output.campaignId;
              if(["updateMediaMetadata","importMediaAttachment"].includes(result.toolName) && typeof output.mediaId === "string" && /^[a-z0-9_-]{8,180}$/i.test(output.mediaId)) receipt.recordId=output.mediaId;
              if(result.toolName === "updateToolSettings" && ["general","calendar","notifications","documents","badge","studio","tiktok"].includes(String(output.tool))) receipt.recordId=`settings_${output.tool}`;
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
    if(!args.onTaskCheckpoint || !uiSteps.length && !requiredTools.some(name=>!isInrAssistantUiTaskTool(name))) return;
    try {await args.onTaskCheckpoint(taskState(inrAssistantTaskOutcome(requiredTools,receipts,"",requiredCalls),""));}
    catch {checkpointFailed=true;throw new InrAssistantInputError("La reprise de la tâche n’a pas pu être enregistrée. Aucune opération supplémentaire n’a été lancée.");}
  };
  const serializeMutations = <T extends Record<string, unknown>>(available: T): T => Object.fromEntries(Object.entries(available).map(([name, definition]) => {
    if (!observedActionNames.has(name) || !definition || typeof definition !== "object" || !("execute" in definition) || typeof definition.execute !== "function") return [name, definition];
    const execute = definition.execute;
    return [name, { ...definition, execute: (...input: unknown[]) => {
      const next = mutationTail.then(async () => {
        if(checkpointFailed) throw new InrAssistantInputError("La tâche doit être vérifiée avant de poursuivre.");
        if(!inrAssistantPlanAllowsAction(objectives,name,receipts,appliedUi)) return {ok:false,status:"blocked",message:"Une étape explicitement demandée doit être terminée avant cette action."};
        if((isInrAssistantUiTaskTool(name) || ["prepareMediaDownload","prepareStatsReportDownload","prepareAccountDocumentDownload","configureCookieConsent","configureApplicationPreferences","controlLocalInterface"].includes(name)) && uiActions.length>INR_ASSISTANT_MAX_UI_ACTIONS-2) return {ok:false,status:"blocked",message:"La limite d’actions du navigateur est atteinte. Cette action n’a pas été transmise."};
        const options=input[1] && typeof input[1] === "object"?input[1] as {toolCallId?:string}:{};
        const toolCallId=options.toolCallId??name+'-'+receipts.length;
        if (isInrAssistantUiTaskTool(name) && uiSteps.length) {
          const data = input[0] && typeof input[0] === "object" ? input[0] as Record<string, unknown> : {};
          const clauseKey = (value: string) => inrAssistantRequestClauses(value).join(" ").replace(/[,.!?;:]+$/g, "").trim();
          const quotedClauses = typeof data.instructionQuote === "string" ? inrAssistantRequestClauses(data.instructionQuote).map(clauseKey) : [];
          const command = name === "runScreenCommand" ? data.command : name === "prepareCurrentDocumentTemplate" ? "create_document_template" : name === "prepareAccountDocumentDownload" ? data.kind === "account_export" ? "download_account_export" : data.kind === "subscription_invoice_hosted" ? "open_subscription_invoice_link" : "download_subscription_invoice" : name === "configureCookieConsent" ? "configure_cookie_consent" : name === "configureApplicationPreferences" ? "configure_application_preferences" : ["controlLocalInterface", "formatBusinessDnaText"].includes(name) ? "control_local_interface" : name === "submitContentReport" ? "submit_content_report" : name === "refreshBadgeThemeFromLogo" ? "refresh_badge_theme_from_logo" : name === "resumePublicationDraft" ? "navigateApplication" : name;
          // Preserve ordered full-clause matching, including explicit repeated
          // instructions. A shorter native verb/object quote needs one unique
          // match across ALL same-command steps, including completed steps.
          const sameCommand = uiSteps.filter(candidate => candidate.command === command && inrAssistantUiStepTool(candidate) === name);
          const exact = sameCommand.find(candidate => !candidate.actions?.length && !appliedUi.has(candidate.id) && quotedClauses.includes(clauseKey(candidate.instruction)));
          const matching = exact ? [] : name === "runScreenCommand" && quotedClauses.length === 1 && typeof data.instructionQuote === "string"
            ? sameCommand.filter(candidate => candidate.command !== "navigateApplication" && candidate.command !== "prepareCommercialDocumentForm" && candidate.command !== "openNotificationAction"
              && clauseKey(candidate.instruction).includes(quotedClauses[0]) && isInrAssistantScreenCommandRequest(data.instructionQuote as string, candidate.command)) : [];
          const step = exact ?? (matching.length === 1 ? matching[0] : undefined);
          const expectedCommands = [...new Set(uiSteps.filter(candidate => !candidate.actions?.length && !appliedUi.has(candidate.id)).map(candidate => candidate.command))];
          const deferUi = (reason: string, message: string) => ({ ok: false, status: "deferred", reason, expectedCommands, message });
          if (!sameCommand.length) return deferUi("ui_command_mismatch", "Cette commande ne correspond à aucune étape d’écran prévue. Aucune commande n’a été transmise.");
          if (!step) {
            if (sameCommand.some(candidate => quotedClauses.includes(clauseKey(candidate.instruction)) && (candidate.actions?.length || appliedUi.has(candidate.id)))) return deferUi("ui_step_already_queued", "Cette étape d’écran a déjà été transmise ou appliquée. Aucune nouvelle commande n’a été envoyée.");
            if (matching.length > 1) return deferUi("ui_quote_ambiguous", "Cet extrait correspond à plusieurs étapes d’écran. Citez l’étape complète avec son verbe et son objet.");
            return deferUi("ui_quote_unmatched", "Cet extrait ne correspond pas à une étape d’écran prévue. Citez un extrait exact de la demande avec son verbe et son objet.");
          }
          if (step.actions?.length || appliedUi.has(step.id)) return deferUi("ui_step_already_queued", "Cette étape d’écran a déjà été transmise ou appliquée. Aucune nouvelle commande n’a été envoyée.");
          if (!uiReady(step)) return deferUi("ui_waiting_prior_step", "Une étape précédente attend son résultat vérifié. Cette commande d’écran n’a pas été transmise.");
          if (step.afterStepId && !step.screen) return deferUi("ui_waiting_prior_transition", "Le formulaire de cette étape attend le retour vérifié de la transition précédente.");
          if (step.screen && (step.screen.pathname !== args.clientContext?.screen?.pathname || step.screen.revision !== args.clientContext.screen.revision || JSON.stringify(step.screen.selection) !== JSON.stringify(args.clientContext.screen.selection)
            || !args.clientContext.screen.availableCommands?.some(command => command === step.command))) return { ok: false, status: "blocked", reason: "ui_screen_changed", expectedCommands, message: "Le formulaire a changé depuis la demande initiale. Renouvelez votre demande sur le formulaire actuel." };
          uiStepCalls.set(toolCallId, step);
        }
        // Persist before business side effects, then after the verified result.
        // A surviving marker requires reconciliation, never blind replay.
        const mutating=!previewActionNames.has(name) && !isInrAssistantUiTaskTool(name);
        const marker:InrAssistantActionReceipt={tool:name,ok:false,status:"executing_unconfirmed",message:"Opération commencée ; résultat à vérifier avant toute nouvelle tentative."};
        if(mutating) {
          if(!requiredTools.some(goal=>!isInrAssistantUiTaskTool(goal))) requiredTools.push(name);
          receipts.push(marker); await checkpoint();
        }
        let output:unknown;
        try {output=await Reflect.apply(execute, definition, input);}
        catch(error) {if(mutating) checkpointFailed=true;throw error;}
        if(output && typeof output === "object") {
          const raw=output as Record<string,unknown>;
          if(previewActionNames.has(name) && typeof raw.token === "string") {
            if(raw.token.length<=24000 && typeof raw.reference === "string" && /^IA-[A-F0-9]{12}$/.test(raw.reference) && INR_ASSISTANT_APPROVAL_KINDS.some(kind => kind === raw.approvalKind)) privateApprovals.set(raw.reference,{token:raw.token,kind:raw.approvalKind as NonNullable<InrAssistantActionReceipt["approvalKind"]>});
            const {token:_privateToken,...safe}=raw; output=safe;
          }
        }
        const pendingUiStep = uiStepCalls.get(toolCallId);
        if (pendingUiStep && output && typeof output === "object" && (output as Record<string, unknown>).ok === true) {
          const effects = inrAssistantUiActionsFromToolResult(toolCallId, output);
          if (effects.length && effects.some(action => !inrAssistantUiStepAcceptsAction(pendingUiStep, action))) output = { ok: false, status: "blocked", message: "La commande d’écran ne correspond pas à l’étape prévue. Elle n’a pas été transmise au navigateur." };
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
  const discoveredNames = new Set<string>();
  const discoverCapabilities = tool({
      description: "Découvrir les capacités réelles de l’application lorsque les outils nécessaires ne sont pas proposés. Chercher le domaine ou l’action avec des mots métier (par exemple contact, agenda, publication, mail). Les résultats distinguent lecture, préparation, exécution, validation humaine et fonction absente. Une recherche précise expose au prochain pas les outils natifs inclus ; jamais une autorisation, aucun effet métier. Les outils conservent leurs contrôles d’ordre actuel, compte, forfait et confirmation.",
      inputSchema: jsonSchema<{
          query: string;
          domain: string | null;
          offset: number;
      }>({ type: "object", additionalProperties: false, properties: { query: { type: "string", maxLength: 200 }, domain: { type: ["string", "null"], enum: [...Object.keys(INR_ASSISTANT_COVERAGE_FAMILIES), null], description: "Domaine exact du catalogue ; null si inconnu. Le carnet d’adresses appartient à crm." }, offset: { type: "integer", minimum: 0, maximum: 1000 } }, required: ["query", "domain", "offset"] }),
      execute: async (input): Promise<Record<string, unknown>> => {
          const catalogue = discoverInrAssistantActionCoverage({ query: input.query, domain: input.domain ?? undefined, offset: input.offset, limit: 4, edition: args.edition });
          if (!input.query.trim() && !input.domain)
              return { ...catalogue, enabledTools: [] };
          const entries = catalogue.items.filter(item => item.availability === "implemented" && item.includedInEdition);
          const names = new Set(entries.flatMap(item => item.tools));
          const registry = buildRegistry({ families: new Set([...families, ...entries.map(item => item.family)]), requiredTools: [...new Set([...requiredTools, ...names])], discoveryTopics: entries.map(item => item.label) });
          const available = Object.assign({}, ...Object.values(registry)) as Record<string, unknown>;
          const selected = Object.fromEntries(Object.entries(assistantToolsForEdition(available, args.edition)).filter(([name, definition]) => names.has(name) && !tools[name as keyof typeof tools] && discoveredNames.size < 8 && allowedDefinition(name, definition)));
          const bounded = Object.fromEntries(Object.entries(selected).slice(0, Math.max(0, 8 - discoveredNames.size)));
          for (const name of Object.keys(bounded))
              discoveredNames.add(name);
          // AI SDK reads the same ToolSet again for each step. Added definitions use
          // exactly the same execution wrappers, budget and native authorization.
          Object.assign(tools, withInrAssistantToolActivities(serializeMutations(boundReads(bounded)), { requestId: args.requestId, onActivity: args.onActivity }));
          // A discovered native workflow gets the same seven-call ceiling as
          // an initially recognized action, within the unchanged time/cost caps.
          if (canExecute && Object.keys(bounded).length && maxCalls === 4) maxCalls = 7;
          return { ...catalogue, enabledTools: [...names].filter(name => Boolean(tools[name as keyof typeof tools])), activationLimitReached: discoveredNames.size >= 8 };
      },
  });
  const allTools = assistantToolsForEdition({discoverCapabilities, ...(humanSupportRequested ? {proposeHumanSupport: supportTool} : {}), ...(draftOnly ? {prepareStudioPrompt} : {}), readAppGuide: createInrAssistantAppGuideTool(), ...mediaTools, ...accountTools, ...diagnosticTools,
    ...workspaceTools, ...memoryTools, ...attachmentTools, ...businessTools, ...ctaTools, ...dnaAnalysisTools, ...managementTools, ...publicationTools, ...workspaceActionTools, ...insightsTools,
    ...commercialTools, ...communicationTools, ...advertisingTools, ...settingsTools, ...campaignTools, ...mailboxTools, ...channelTools, ...documentTools, ...calendarTools, ...scheduledTools, ...additionalTools }, draftOnly ? "basic" : args.edition);
  // No executor is exposed during a status-only continuation. In particular a
  // queued publication can never be re-dispatched merely to obtain its status.
  const allowedDefinition = (name: string, definition: unknown) => Boolean(definition) && !((statusOnly || draftOnly || adviceOnly) && observedActionNames.has(name) && !(statusOnly && !draftOnly && !adviceOnly && name === "acceptMediaGeneration" && canSaveExistingGeneration)) &&
      !(["generateMedia", "modifyMedia", "cancelMediaGeneration", "acceptMediaGeneration", "discardMediaGeneration"].includes(name) && !requiredTools.includes(name) && !(name === "acceptMediaGeneration" && canSaveExistingGeneration)) &&
      !(requiredTools.includes("updateToolSettings") && !requiredTools.some(tool => ["generateMedia", "modifyMedia"].includes(tool)) && ["generateMedia", "modifyMedia"].includes(name));
  const selectedTools = Object.fromEntries(Object.entries(assistantToolsForEdition({...allTools,...uiTools},args.edition)).filter(([name,definition])=>allowedDefinition(name,definition))) as typeof allTools & typeof uiTools;
  const boundReads = <T extends Record<string, unknown>>(available: T): T => Object.fromEntries(Object.entries(available).map(([name, definition]) => {
    if (observedActionNames.has(name) || !definition || typeof definition !== "object" || !("execute" in definition) || typeof definition.execute !== "function") return [name, definition];
    const execute = definition.execute;
    return [name, {
      ...definition,
      execute: async (...input: unknown[]) => {
        if (!inrAssistantPlanAllowsRead(objectives, name, receipts, appliedUi)) return { ok: false, status: "deferred", message: "Cette lecture est demandée après une action encore incomplète. Terminez cette action avant la lecture." };
        const eligibleObjective = objectives.find((objective, index) => inrAssistantReadMatchesObjective(objective, name, input[0]) &&
          !inrAssistantObjectiveCompleted(objectives, index, receipts, appliedUi) && inrAssistantObjectiveReady(objectives, index, receipts, appliedUi));
        const attempt = readBudget.start(name, input[0], eligibleObjective?.exhaustive ? eligibleObjective.id : undefined);
        if (!attempt) return { ok: false, status: "blocked", message: "Cette lecture se répète sans progression vérifiable. Précisez la recherche avant de continuer." };
        const executionOptions = input[1] as { toolCallId?: string } | undefined;
        if (eligibleObjective && executionOptions?.toolCallId) readObjectiveAtStart.set(executionOptions.toolCallId, eligibleObjective.id);
        const output = await Reflect.apply(execute, definition, input);
        readBudget.finish(attempt, output);
        return output;
      },
    }];
  })) as T;
  const tools = withInrAssistantToolActivities(serializeMutations(boundReads(selectedTools)),
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
    // Keep a short reviewed path/condition even when rich action schemas need
    // most of the budget. Full procedures remain available through readAppGuide.
    system = buildInrAssistantSystemPrompt(args.displayName, args.accountContext, getInrAssistantAppKnowledge(latestRequest, 650), args.edition, args.clientContext, Boolean(args.fileContexts?.length)) + (operationGuidance ? `\n${operationGuidance}` : "");
  }
  while (messages.length > 1 && bytes({ system, messages }) + schemaBytes > 31_000) messages.shift();
  if (bytes({system,messages}) + schemaBytes > 30_500) system = buildInrAssistantSystemPrompt(args.displayName,undefined,getInrAssistantAppKnowledge(latestRequest,350),args.edition,args.clientContext,Boolean(args.fileContexts?.length),true) + continuityContext + (operationGuidance ? `\n${operationGuidance}` : "");
  if (bytes({ system, messages }) + schemaBytes > 31_000) {
    noteFailure("input_limit", { inputBytes: bytes({ system, messages }) + schemaBytes, historyTurns: messages.length });
    throw new InrAssistantUnavailableError(lastFailure);
  }
  const quota = await reserveInrAssistantRequest({
    billingAccountId: args.accountId, requestId: args.requestId, edition: args.edition, complexity,
  });
  const chain = getInrAssistantModelChain({ edition: args.edition, complexity, solReserved: quota.solReserved });
  let success = false;
  let continuationMessages = messages;
  const rejectedToolCallIds = new Set<string>();
  let continuingSystem = system;
  const taskState = (outcome:InrAssistantTaskOutcome,question:string):InrAssistantTaskState => ({version:1,instruction:args.taskContext?.instruction ?? latestRequest,...(uiSteps.length?{uiSteps:uiSteps.map(step=>({...step}))}:{}),actionRequestId:args.actionRequestId??args.requestId,startedAt:args.actionStartedAt??new Date(started).toISOString(),expiresAt:new Date(started+(outcome==="processing"?24*60:30)*60_000).toISOString(),outcome,requiredTools:requiredTools.filter(name=>!isInrAssistantUiTaskTool(name)),...(Object.keys(requiredCalls).length?{requiredCalls}:{}),receipts:compactInrAssistantTaskReceipts(receipts.filter(receipt=>!isInrAssistantUiTaskTool(receipt.tool)),requiredTools,requiredCalls),question:question.slice(-2000)});
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
    if (mediaState.result && requiredTools.some(name=>["generateMedia","modifyMedia"].includes(name)) && !receipts.some(r=>r.tool === "generateMedia" || r.tool === "modifyMedia")) {
      const result=mediaState.result;
      receipts.push({tool:requiredTools.includes("modifyMedia")?"modifyMedia":"generateMedia",ok:result.ok,status:result.ok && result.status === "ready_to_save" && result.resultMode === "preview" && result.draft === true ? "preview_generated" : result.status,message:result.message,requestId:result.requestId,...(result.resultMode?{resultMode:result.resultMode}:{}),...(typeof result.draft === "boolean"?{draft:result.draft}:{}),...(result.media?.id?{id:result.media.id}:{})});
    }
    const businessRequired=requiredTools.filter(name=>!isInrAssistantUiTaskTool(name));
    if(!uiSteps.length && !businessRequired.length && (navigationRequested || screenCommandRequested)) return {...reply,...(navigation?{navigation}:{}),...(uiCommand?{uiCommand}:{}),...(uiActions.length?{uiActions}:{}),outcome:navigation || uiCommand?"processing":"needs_input"};
    let outcome = inrAssistantTaskOutcome(businessRequired,receipts.filter(receipt=>!isInrAssistantUiTaskTool(receipt.tool)),reply.message,requiredCalls);
    const pendingUi = uiSteps.filter(step => !appliedUi.has(step.id));
    if (pendingUi.length) outcome = args.browserStepResults?.some(result => ["failed", "cancelled"].includes(result.status)) ? "blocked" : "partial";
    success = outcome === "completed";
    if (!requiredTools.length && !uiSteps.length) return verifiedHandoffMessage ? {...reply,needsHuman:true,handoffSummary:verifiedHandoffMessage,outcome:"blocked"} : reply;
    const label=(name:string)=>name==="navigateApplication"?"ouvrir l’outil demandé":isInrAssistantUiTaskTool(name)?"appliquer l’étape d’écran demandée":inrAssistantObjectiveLabel(name);
    const remaining = businessRequired.filter(name=>!inrAssistantGoalCompleted(name,receipts,requiredCalls));
    const completed = businessRequired.filter(name=>inrAssistantGoalCompleted(name,receipts,requiredCalls) && !receipts.some(receipt=>receipt.tool===name && INR_ASSISTANT_PENDING_STATUSES.has(receipt.status)));
    const unfinished=businessRequired.filter(name=>!completed.includes(name));
    const factual = [...new Set(receipts.filter(r=>r.ok).map(r=>r.message))].join("\n\n");
    let message = outcome === "partial" ? `${factual || savedActionReply() || reply.message}\n\nIl reste à ${remaining.map(label).join(", ")}. Vous pouvez me demander de continuer ; les étapes déjà réalisées seront conservées.` : reply.message;
    if (pendingUi.length) {
      const browserMessage = outcome === "blocked" ? "Une étape d’écran a été refusée ou a échoué. Les actions suivantes n’ont pas été lancées. Vérifiez l’écran avant une nouvelle demande."
        : pendingUi.some(step => step.actions?.length) ? "L’étape d’écran attend la confirmation du navigateur. Les actions suivantes n’ont pas été lancées. La suite attend le retour du navigateur ; l’étape déjà transmise ne sera pas rejouée."
        : "L’étape d’écran n’a pas été transmise. Vérifiez le formulaire et les étapes précédentes avant de demander de continuer. Les actions suivantes n’ont pas été lancées.";
      message = [factual || savedActionReply(), browserMessage].filter(Boolean).join("\n\n");
    }
    return {...reply,...(navigation?{navigation}:{}),...(uiCommand?{uiCommand}:{}),...(uiActions.length?{uiActions}:{}),...(verifiedHandoffMessage && outcome !== "completed" ? {needsHuman:true,handoffSummary:verifiedHandoffMessage}:{}),message,outcome,taskProgress:{outcome,completed:completed.map(label),remaining:[...unfinished.map(label),...pendingUi.map(()=>"confirmer l’étape d’écran dans le navigateur")]},taskState:taskState(outcome,message)};
  };
  try {
    if (args.signal?.aborted) {
      noteFailure("request_aborted", { callCount: llmCalls });
      args.signal.throwIfAborted();
    }
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
      let toolInputRepairAttempt: typeof attempt | undefined;
      const attemptMessages = continuationMessages === messages ? messages : compactInrAssistantGuideContext(compactInrAssistantRejectedToolContext(continuationMessages, rejectedToolCallIds), { maxGuideCharacters: 1200 });
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
              // Reserve the accepted input ceiling, not a tokenizer guess. The
              // unused capacity is released only after confirmed provider usage.
              const assistantBudget = await reserveInrAssistantBudget({ accountId: args.accountId, edition: args.edition, estimatedCostMicroUsd: guardCost(attempt.model, 32_000, maxOutputTokens) }).catch((error: unknown) => {
                economicFailure = error; throw error;
              });
              const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
                feature: "assistant.chat", estimatedInputTokens, reservedOutputTokens: maxOutputTokens, estimatedCostMicroUsd: estimatedCost,
              }).catch(async (error: unknown) => {
                // No provider call occurred: this reservation may be released.
                await finalizeInrAssistantBudget(assistantBudget, 0).catch(() => undefined);
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
                if (Number.isSafeInteger(input) && input! >= 0 && Number.isSafeInteger(outputCount) && outputCount! >= 0) {
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
                await Promise.all([
                  finalizeInrAssistantBudget(assistantBudget, usageEstimated ? undefined : cost),
                  commitAiGatewayAccountAttempt({ reservation, feature: "assistant.chat", model: attempt.model, usage, actualCostMicroUsd: cost }),
                ])
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
          model, system: continuingSystem, messages: attemptMessages, maxOutputTokens, tools,
          stopWhen: [({ steps }) => steps.length >= maxCalls, () => checkpointFailed || llmCalls >= maxCalls || Boolean(studioDraftState.value) || Boolean(mediaState.result) && !followupAfterMedia],
          onStepFinish: async ({ toolResults, toolCalls, response }) => {
            // A model fallback keeps every completed call/result pair. Only
            // repeated/oversized guide prose is compacted, never native receipts.
            continuationMessages = [...attemptMessages, ...response.messages];
            for (const call of toolCalls) if (call.invalid && InvalidToolInputError.isInstance(call.error)) rejectedToolCallIds.add(call.toolCallId);
            if (!toolInputRepairAttempt && attempt.model === INR_ASSISTANT_MODELS.qwen && toolCalls.some(call => call.invalid && InvalidToolInputError.isInstance(call.error))) {
              toolInputRepairAttempt = chain.find(candidate => candidate.model === INR_ASSISTANT_MODELS.luna);
            }
            let changed=false;
            for(const result of toolResults) if(result && recordToolResult(result)) changed=true;
            if(changed && requiredTools.length) {try {await checkpoint();} catch {/* stopWhen prevents further calls. */}}
          },
          prepareStep: ({ stepNumber, messages: stepMessages }) => {
            // A UI-only request can also contain reads that are not durable
            // business goals. Opening its module must not suppress those reads.
            const goalsDone = requiredTools.some(name=>!isInrAssistantUiTaskTool(name)) && requiredTools.every(name=>inrAssistantGoalCompleted(name,receipts,requiredCalls)) && objectives.every((_,index)=>inrAssistantObjectiveCompleted(objectives,index,receipts,appliedUi)) && (!statusOnly || [...readCounts.keys()].some(name=>requiredTools.some(goal=>INR_ASSISTANT_COMMANDS[goal]?.statusReader===name)));
            const awaitsBrowser = !statusOnly && uiSteps.some(step => step.actions?.length && !appliedUi.has(step.id)) && !uiSteps.some(step => !step.actions?.length && !appliedUi.has(step.id) && uiReady(step));
            const answerOnly = awaitsBrowser || goalsDone || stepNumber >= maxCalls-1 || llmCalls >= maxCalls-1;
            const activeTools = answerOnly ? [] : Object.keys(tools).filter(name => !(name === "navigateApplication" && navigation) && readBudget.available(name) && inrAssistantPlanAllowsAction(objectives,name,receipts,appliedUi) && inrAssistantPlanAllowsRead(objectives,name,receipts,appliedUi) && !(isInrAssistantUiTaskTool(name) && uiSteps.length && !uiSteps.some(step => inrAssistantUiStepTool(step) === name && !step.actions?.length && !appliedUi.has(step.id) && uiReady(step))) && !(INR_ASSISTANT_COMMANDS[name] && requiredTools.includes(name) && inrAssistantGoalCompleted(name,receipts,requiredCalls)) && !(args.taskContext && inrAssistantGoalCompleted(name,args.taskContext.receipts,requiredCalls))) as Array<keyof typeof tools>;
            if (stepNumber === 0 && continuationMessages === messages && !answerOnly && !args.taskContext && !navigation) return { activeTools };
            // Keep call/result pairs intact and discard only earlier chat text.
            // After a guide or DNA lookup, creation remains possible in step 2;
            // the last step only answers and never repeats reads or actions.
            let latestUser = 0;
            stepMessages.forEach((message, index) => { if (message.role === "user") latestUser = index; });
            // Some Qwen tool-call responses ignore toolChoice:none. Do not spend
            // the final allowed call on another tool loop: reserve it for the
            // existing economical fallback, with its own real cost accounting.
            const answerAttempt = answerOnly && attempt.model === INR_ASSISTANT_MODELS.qwen
              ? chain.find(candidate => candidate.model === INR_ASSISTANT_MODELS.luna) ?? attempt
              : attempt;
            continuingSystem = buildInrAssistantSystemPrompt(args.displayName, undefined, readCounts.has("readAppGuide") ? undefined : getInrAssistantAppKnowledge(latestRequest, 1_800), args.edition, args.clientContext, Boolean(args.fileContexts?.length), true)
              + continuityContext + draftGuidance + (operationGuidance ? `\n${operationGuidance}` : "")
              + (navigation ? `\nL’ouverture de ${navigation.label} est déjà demandée au navigateur. Termine aussi les lectures demandées, sans annoncer la navigation terminée.` : "")
              + (args.taskContext ? `\nReprise vérifiée de la tâche. Résultats enregistrés, à réutiliser sans refaire ces actions : ${JSON.stringify(publicTaskReceipts(args.taskContext.receipts)).slice(0,5000)}. La précision actuelle complète seulement cette tâche. Réponds dans la langue de ce message : ${JSON.stringify(spokenRequest).slice(0,500)}` : "")
              + (answerOnly ? "\nRépondez maintenant sans appeler d’outil. Utilisez seulement les faits déjà obtenus. Si le sujet ou une donnée indispensable manque, posez une question courte pour continuer. N’inventez ni résultat ni action exécutée." : "");
            return {
              ...(toolInputRepairAttempt || answerOnly ? { model: guardedModel(toolInputRepairAttempt ?? answerAttempt) } : {}),
              messages: compactInrAssistantGuideContext(compactInrAssistantRejectedToolContext(stepMessages.slice(latestUser), rejectedToolCallIds)),
              activeTools,
              ...(answerOnly ? { toolChoice: "none" as const } : {}),
              system: continuingSystem,
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
