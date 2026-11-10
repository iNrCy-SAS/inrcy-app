import * as rejectedToolContext from "../../lib/inrAssistantRejectedToolContext.ts";
import * as uiTask from "../../lib/inrAssistantUiTask.ts";
import * as clientScreen from "../../lib/inrAssistantClientContext.ts";
import assert from "node:assert/strict";
import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { asSchema, generateText, InvalidToolInputError, jsonSchema, stepCountIs, tool, wrapLanguageModel } from "ai";
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import * as policy from "../../lib/inrAssistantPolicy.ts";
import * as editionPolicy from "../../lib/inrAssistantEditionPolicy.ts";
import * as conversation from "../../lib/inrAssistantConversation.ts";
import * as routing from "../../lib/inrAssistantToolRouting.ts";
import * as activity from "../../lib/inrAssistantActivity.ts";
import * as gatewayDiagnostics from "../../lib/inrAssistantGatewayDiagnostics.ts";
import * as attachmentPolicy from "../../lib/inrAssistantAttachments.ts";
import * as attachmentPrompt from "../../lib/inrAssistantAttachmentPrompt.ts";
import * as promptContext from "../../lib/inrAssistantPromptContext.ts";
import * as mediaIntent from "../../lib/inrAssistantMediaIntent.ts";
import * as studioDraft from "../../lib/inrAssistantStudioDraft.ts";
import * as taskPolicy from "../../lib/inrAssistantTaskPolicy.ts";
import * as objectives from "../../lib/inrAssistantObjectives.ts";
import * as uiActions from "../../lib/inrAssistantUiActions.ts";
import * as actionCoverage from "../../lib/inrAssistantActionCoverage.ts";
import * as commandRegistry from "../../lib/inrAssistantCommandRegistry.ts";
import * as uiCommands from "../../lib/inrAssistantUiCommands.ts";
import * as statsUiCommands from "../../lib/inrAssistantStatsUiCommands.ts";
import * as businessFormUiCommands from "../../lib/inrAssistantBusinessFormUiCommands.ts";
import * as businessFormActionClauses from "../../lib/inrAssistantActionClause.ts";
import * as localInterfaces from "../../lib/inrAssistantLocalInterface.ts";
import * as applicationPreferences from "../../lib/inrAssistantApplicationPreferences.ts";
import * as studioDraftReview from "../../lib/inrAssistantStudioDraftReview.ts";
import * as contentReport from "../../lib/inrAssistantContentReport.ts";
import * as richText from "../../lib/inrAssistantBusinessRichText.ts";
import * as creditReconciliation from "../../lib/inrAssistantCreditOrderReconciliation.ts";
import * as googleDraftReview from "../../lib/inrAssistantGoogleBusinessDraftReview.ts";
import * as studioPreferenceIntent from "../../lib/inrAssistantStudioPreferenceIntent.ts";
import * as badgeIdentityTheme from "../../lib/inrAssistantBadgeIdentityTheme.ts";
import * as notificationNavigation from "../../lib/inrAssistantNotificationNavigation.ts";
import * as sendPublicationIntent from "../../lib/inrAssistantSendPublicationIntent.ts";
import * as accountUiIntent from "../../lib/inrAssistantAccountUiIntent.ts";
import * as basicShopRead from "../../lib/inrAssistantBasicShopRead.ts";
import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";
import * as scheduledEditorSelection from "../../lib/inrAssistantScheduledEditorSelection.ts";
import * as studioFormSelection from "../../lib/inrAssistantStudioFormSelection.ts";
import * as nativeDashboardEdition from "../../lib/dashboardEdition.ts";
import * as studioSavedPreferences from "../../lib/aiMediaGenerationPreferences.ts";
import * as pureStatsViewRequest from "../../lib/inrAssistantPureStatsViewRequest.ts";
import * as assistantClock from "../../lib/inrAssistantClock.ts";
import * as researchIntent from "../../lib/inrAssistantResearchIntent.ts";
import * as providerCost from "../../lib/inrAssistantProviderCost.ts";
import { getInrAssistantDocumentPrefillNavigation } from "../../lib/inrAssistantDocumentUiCommands.ts";
import type * as Gateway from "../../lib/inrAssistantGateway.ts";
import type * as ToolRegistry from "../../lib/inrAssistantToolRegistry.ts";
import type { InrAssistantMediaResult } from "../../lib/inrAssistantMediaTools.ts";
import type { InrAssistantPublicationResult } from "../../lib/inrAssistantPublicationTools.ts";
import type * as Memory from "../../lib/inrAssistantMemory.ts";
import type * as MemoryTools from "../../lib/inrAssistantMemoryTools.ts";
import { createCtaToolFixture, CTA_TEST_ACCOUNT_ID } from "./helpers/cta-runtime.mts";

function loadClosedModule<T>(file: string, stubs: Record<string, unknown>): T {
  const source = ts.transpileModule(readFileSync(new URL(`../../lib/${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  const pureDependencies: Record<string, unknown> = { "./inrAssistantBadgeIdentityTheme.ts": badgeIdentityTheme, "./inrAssistantNotificationNavigation.ts": notificationNavigation, "./inrAssistantSendPublicationIntent.ts": sendPublicationIntent, "./inrAssistantAccountUiIntent.ts": accountUiIntent, "./inrAssistantBasicShopRead.ts": basicShopRead, "./inrAssistantScheduledEditorSelection.ts": scheduledEditorSelection, "./inrAssistantStudioFormSelection.ts": studioFormSelection, "./inrAssistantUiCommands.ts": uiCommands,
    "./inrAssistantClock.ts": assistantClock, "./inrAssistantResearchIntent.ts": researchIntent, "./inrAssistantProviderCost.ts": providerCost };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { URL, URLSearchParams, Request, Response, Headers, AbortSignal, setTimeout, clearTimeout })((name: string) => {
    if (name in pureDependencies && !(name in stubs)) return pureDependencies[name];
    if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`);
    return stubs[name];
  }, record, record.exports);
  return record.exports as T;
}
const memoryRuntime = loadClosedModule<typeof Memory>("inrAssistantMemory.ts", { "server-only": {}, "node:crypto": { randomUUID } });
const notificationRemovalState = loadClosedModule<typeof import("../../lib/notificationRemovalState.ts")>("notificationRemovalState.ts", { "server-only": {}, "node:crypto": { createHash } });
const memoryToolsRuntime = loadClosedModule<typeof MemoryTools>("inrAssistantMemoryTools.ts", {
  "server-only": {}, ai: { jsonSchema, tool }, "./inrAssistantMemory.ts": memoryRuntime,
});

function harness(options: { sol?: boolean; fail?: number; guardError?: boolean; failCommit?: boolean;
  budgetFailure?: "limit" | "unavailable"; budgetFailureAt?: number; budgetCommitFailure?: boolean;
  reportedUsage?: { input: number | undefined; output: number | undefined };
  reportedGatewayCost?: string | number | null;
  productionNoRedis?: boolean; noCredential?: boolean; handoff?: boolean; media?: boolean; followup?: boolean; workflow?: boolean; failAfterPublication?: boolean;
  verifiedNavigation?: string; lookup?: "diagnostics" | "workspace" | "memory"; providerError?: Error; outputLimit?: boolean;
  emptyText?: boolean; ignoresToolChoice?: boolean; abortAfterPublication?: AbortController;
  textReply?: string; unexpectedHandoff?: boolean; mediaMetadata?: boolean; crmIds?: string[]; crmStatus?: string;
  plan?: Array<{tool:string;input?:Record<string,unknown>}>;
  parallelPlan?:Array<{tool:string;input?:Record<string,unknown>}>;
  extraTools?:Record<string,unknown>;
  diagnosticRead?: () => Record<string, unknown>;
  settingsTools?:Record<string,unknown>;
  calendarFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  documentNativeFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  mediaLibraryFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  channelActionFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  statsFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  mailboxFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  publicationWorkspaceRead?: boolean;
  nativeAccountServices?: boolean;
  richTextOutputTransform?: (output: unknown) => unknown;
  guideCharacters?: number;
  accountRead?: (name:string,input:unknown)=>unknown;
  nativeServices?: { auth: { activeUserId: string; authUserId: string }; draft?: (request: Request) => Promise<Response>; notificationFeed?: (request: Request) => Promise<Response>; notificationMark?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> };
  cta?: { definition: ReturnType<typeof createCtaToolFixture>["definition"]; input: { target: "phone" | "website"; instructionQuote: string; channels: string[] | null } } } = {}) {
  const generations: { model: string; params: LanguageModelV3CallOptions }[] = [];
  const reservations: { feature: string; reservedOutputTokens: number; estimatedInputTokens: number; estimatedCostMicroUsd: number }[] = [];
  const commits: { model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; actualCostMicroUsd: number }[] = [];
  const finalized: { success: boolean }[] = [];
  const quotaReservations: unknown[] = [];
  const budgetReservations: { accountId: string; edition: string; estimatedCostMicroUsd: number }[] = [];
  const budgetFinalizations: { reservation: unknown; actualCostMicroUsd: number | undefined }[] = [];
  const factories: string[] = [];
  const actionFactories: string[] = [];
  const publicationExecutions: string[] = [];
  const metadataExecutions: unknown[] = [];
  const crmExecutions: unknown[] = [];
  const mediaScopes: Array<{ requestId: string; currentUserMessage?: string }> = [];
  const toolScopes: { tool: string; accountId: string; edition: string }[] = [];
  const ctaScopes: { accountId: string; currentUserMessage: string }[] = [];
  const diagnostics: gatewayDiagnostics.InrAssistantGatewayDiagnostic[] = [];
  const operationCalls: { costMicroUsd: number; usageEstimated: boolean }[] = [];
  let mediaExecutions = 0;
  const stubs: Record<string, unknown> = {
    "server-only": {}, "./dashboardEdition.ts": {},
    ai: { asSchema, generateText, InvalidToolInputError, jsonSchema, stepCountIs, tool, wrapLanguageModel,
      createGateway: () => (id: string): LanguageModelV3 => ({
        specificationVersion: "v3", provider: "test", modelId: id, supportedUrls: {},
        doGenerate: async (params) => {
          generations.push({ model: id, params });
          if(options.parallelPlan && generations.length === 1) return {content:options.parallelPlan.map((call,index)=>({type:"tool-call" as const,toolCallId:`parallel-${index}`,toolName:call.tool,input:JSON.stringify(call.input??{})})),finishReason:{unified:"tool-calls" as const,raw:"test"},usage:{inputTokens:{total:100,noCache:100,cacheRead:0,cacheWrite:0},outputTokens:{total:40,text:10,reasoning:30}},warnings:[]};
          if (options.providerError) throw options.providerError;
          if (options.unexpectedHandoff && generations.length === 1) return {
            content: [{ type: "tool-call", toolCallId: "unexpected-support", toolName: "proposeHumanSupport", input: JSON.stringify({ message: "Contactez l’équipe pour valider cette création.", summary: "Un transfert non sollicité." }) },
              { type: "text", text: options.textReply ?? "Voici votre brouillon." }],
            finishReason: { unified: "tool-calls", raw: "test" },
            usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } }, warnings: [],
          };
          if (options.plan) {
            const next=options.plan[generations.length-1];
            const available=(params.tools??[]).filter(t=>t.type === "function").map(t=>t.name);
            const runs=next && available.includes(next.tool);
            return {content:runs?[{type:"tool-call",toolCallId:`plan-${generations.length}`,toolName:next.tool,input:JSON.stringify(next.input??{})}]:[{type:"text",text:next?`Outil absent : ${next.tool}`:options.textReply ?? "Les étapes demandées ont été traitées."}],finishReason:{unified:runs?"tool-calls":"stop",raw:"test"},usage:{inputTokens:{total:100,noCache:100,cacheRead:0,cacheWrite:0},outputTokens:{total:20,text:20,reasoning:0}},warnings:[]};
          }
          if (generations.length <= (options.fail ?? 0)) throw Object.assign(new Error("Unavailable"), { statusCode: 503 });
          if (options.failAfterPublication && generations.length > 3) throw Object.assign(new Error("Summary unavailable after publication"), { statusCode: 503 });
          const callTool = options.cta ? generations.length === 1 : options.ignoresToolChoice ? id === policy.INR_ASSISTANT_MODELS.qwen : options.workflow ? generations.length <= 3 : options.handoff || options.media || ((options.followup || options.lookup) && generations.length === 1);
          const toolName = options.cta ? "configureBusinessCta" : options.ignoresToolChoice ? "readAppGuide" : options.workflow ? ["generateMedia", "preparePublication", "executePublication"][generations.length - 1] : options.lookup === "memory" ? "recallPastDiscussions" : options.lookup === "diagnostics" ? "getAccountDiagnostics" : options.lookup === "workspace" ? "readWorkspaceSection" : options.handoff ? "proposeHumanSupport" : "generateMedia";
          const input = options.cta ? options.cta.input : options.workflow && generations.length > 1 ? { draftId: "stored-draft", mode: "publish" } : options.lookup === "memory" ? { query: "campagne de Noël", limit: 4 } : options.lookup === "diagnostics" ? { area: "all" } : options.lookup === "workspace" ? { section: "stats" } : options.handoff ? { message: "Vous pouvez faire vérifier ce blocage.", summary: "Blocage de connexion à vérifier." } : { prompt: "Une image" };
          return {
            content: callTool ? [{ type: "tool-call", toolCallId: "call-1", toolName, input: JSON.stringify(input) }]
              : [{ type: "text", text: options.emptyText ? "" : options.textReply ?? "Voici la prochaine étape." }],
            finishReason: { unified: options.outputLimit ? "length" : callTool ? "tool-calls" : "stop", raw: "test" },
            usage: { inputTokens: { total: options.reportedUsage ? options.reportedUsage.input : 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: options.reportedUsage ? options.reportedUsage.output : 40, text: 10, reasoning: 30 } }, warnings: [],
            ...(options.reportedGatewayCost !== undefined ? { providerMetadata: { gateway: { gatewayCost: options.reportedGatewayCost } } } : {}),
          };
        },
        doStream: async () => { throw new Error("Streaming not expected"); },
      }) },
    "@/lib/aiGatewayConfig": { getAiGatewayCredential: () => options.noCredential ? null : "synthetic" },
    "@/lib/aiGatewayAccountGuard": { AiGatewayGuardUnavailableError: class extends Error {},
      reserveAiGatewayAccountAttempt: async (_id: string, args: { feature: string; reservedOutputTokens: number; estimatedInputTokens: number; estimatedCostMicroUsd: number }) => {
        if (options.guardError) throw new Error("guard unavailable");
        reservations.push(args); return { id: reservations.length };
      }, commitAiGatewayAccountAttempt: async (args: { model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; actualCostMicroUsd: number }) => {
        commits.push(args); if (options.failCommit) throw new Error("commit unavailable");
      }, recordAiGatewayAccountFailure: async () => {} },
    "@/lib/aiGatewayEconomics": { getConfiguredAiGatewayModelPricing: () => null },
    "@/lib/aiGatewayOperationTelemetry": { recordAiGatewayOperationCall: (input: { costMicroUsd: number; usageEstimated: boolean }) => { operationCalls.push(input); } },
    "@/lib/upstashMode": { isUpstashEnabled: () => !options.productionNoRedis },
    "./inrAssistantPolicy.ts": policy,
    "./inrAssistantEditionPolicy.ts": editionPolicy,
    "./inrAssistantAttachments.ts": attachmentPolicy,
    "./inrAssistantAttachmentPrompt.ts": attachmentPrompt,
    "./inrAssistantPromptContext.ts": promptContext,
    "./inrAssistantMediaIntent.ts": mediaIntent,
    "./inrAssistantStudioDraft.ts": studioDraft,
    "./inrAssistantTaskPolicy.ts": taskPolicy,
    "./inrAssistantObjectives.ts": objectives,
    "./inrAssistantUiActions.ts": uiActions,
    "./inrAssistantUiTask.ts": uiTask,
    "./inrAssistantRejectedToolContext.ts": rejectedToolContext,
    "./inrAssistantActionCoverage.ts": actionCoverage,
    "./inrAssistantCommandRegistry.ts": commandRegistry,
    "./inrAssistantUiCommands.ts": uiCommands,
    "./inrAssistantPureStatsViewRequest.ts": pureStatsViewRequest,
    "./inrAssistantProviderCost.ts": providerCost,
    "./inrAssistantResearchTools.ts": { createInrAssistantResearchTools: () => ({
      // Integration fixture: the real SDK executes the surrounding tool loop,
      // while public search can never contact a provider or a database here.
      searchPublicWeb: tool({ inputSchema: jsonSchema<{ query: string; recency: string | null }>({ type: "object", properties: { query: { type: "string" }, recency: { type: ["string", "null"] } }, required: ["query", "recency"], additionalProperties: false }),
        execute: async () => ({ ok: false, source: "public_web_search", status: "unavailable", sources: [], contentCoverage: "none", message: "Recherche indisponible dans cette fixture isolée ; aucune source web consultée." }) }),
      readCurrentDateTime: tool({ inputSchema: jsonSchema<{ timeZone: string | null }>({ type: "object", properties: { timeZone: { type: ["string", "null"] } }, required: ["timeZone"], additionalProperties: false }),
        execute: async input => ({ ok: true, ...assistantClock.getInrAssistantCurrentDateTime(input.timeZone ?? "Europe/Paris") }) }),
    }) },
    "./inrAssistantUiTools.ts": { createInrAssistantUiTools: () => options.extraTools??{} },
    "./inrAssistantBusinessIdentityTools.ts": {createInrAssistantBusinessIdentityTools:()=>({})},
    "./inrAssistantChannelConfigurationTools.ts": {createInrAssistantChannelConfigurationTools:()=>({})},
    "./inrAssistantSocialPublicationPreferencesTools.ts": {createInrAssistantSocialPublicationPreferencesTools:()=>({})},
    "./inrAssistantPinterestBoardTools.ts": {createInrAssistantPinterestBoardTools:()=>({})},
    "./inrAssistantWebsiteLifecycleTools.ts": {createInrAssistantWebsiteLifecycleTools:()=>({})},
    "./inrAssistantDnaScheduleTools.ts": {createInrAssistantDnaScheduleTools:()=>({})},
    "./inrAssistantReferralTools.ts": {createInrAssistantReferralTools:()=>({})},
    "./inrAssistantGeneratorSettingsTools.ts": {createInrAssistantGeneratorSettingsTools:()=>({})},
    "./inrAssistantWebsiteTools.ts": {createInrAssistantWebsiteTools:()=>({})},
    "./inrAssistantBusinessDnaSourceTools.ts": {createInrAssistantBusinessDnaSourceTools:()=>({})},
    "./inrAssistantAccountServiceTools.ts": {createInrAssistantAccountServiceTools:()=>({})},
    "./inrAssistantNativePresentationTools.ts": {createInrAssistantNativePresentationTools:()=>({})},
    "./inrAssistantChannelTools.ts": { createInrAssistantChannelTools: () => ({}) },
    "./inrAssistantCampaignTools.ts": { createInrAssistantCampaignTools: () => ({}) },
    "./inrAssistantMailboxTools.ts": { createInrAssistantMailboxTools: (args:Record<string,unknown>) => options.mailboxFactory?.(args) ?? {} },
    "./inrAssistantDocumentTools.ts": { createInrAssistantDocumentTools: () => ({}) },
    "./inrAssistantDocumentNativeTools.ts": { createInrAssistantDocumentNativeTools: (args:Record<string,unknown>) => options.documentNativeFactory?.(args)??{} },
    "./inrAssistantCalendarTools.ts": { createInrAssistantCalendarTools: (args:Record<string,unknown>) => options.calendarFactory?.(args)??{} },
    "./inrAssistantScheduledPublicationTools.ts": { createInrAssistantScheduledPublicationTools: () => ({}) },
    "./inrAssistantAttachmentTools.ts": { createInrAssistantAttachmentTools: () => ({}) },
    "./inrAssistantAgentTools.ts": { createInrAssistantAgentTools: () => ({}) },
    "./inrAssistantChannelActionTools.ts": { createInrAssistantChannelActionTools: (args:Record<string,unknown>) => options.channelActionFactory?.(args) ?? {} },
    "./inrAssistantMediaLibraryTools.ts": { createInrAssistantMediaLibraryTools: (args:Record<string,unknown>) => options.mediaLibraryFactory?.(args) ?? {} },
    "./inrAssistantPublicationLifecycleTools.ts": { createInrAssistantPublicationLifecycleTools: () => options.publicationWorkspaceRead ? {
      readPublicationWorkspace: tool({ inputSchema: jsonSchema({ type: "object", properties: { view: { type: "string" }, recordId: { type: ["string", "null"] }, offset: { type: "integer" } } }), execute: async input => options.accountRead?.("readPublicationWorkspace", input) ?? { ok: true, records: [] } }),
    } : {} },
    "./inrAssistantStatsTools.ts": { createInrAssistantStatsTools: (args:Record<string,unknown>) => options.statsFactory?.(args) ?? {} },
    "./inrAssistantQuota.ts": { reserveInrAssistantRequest: async (args: unknown) => { quotaReservations.push(args); return { solReserved: options.sol ?? false }; },
      finalizeInrAssistantRequest: async (_quota: unknown, outcome: { success: boolean }) => { finalized.push(outcome); } },
    "./inrAssistantBudget.ts": {
      reserveInrAssistantBudget: async (args: { accountId: string; edition: string; estimatedCostMicroUsd: number }) => {
        budgetReservations.push(args);
        if (options.budgetFailure && budgetReservations.length >= (options.budgetFailureAt ?? 1)) throw Object.assign(new Error(options.budgetFailure === "limit" ? "Monthly assistant budget reached" : "Assistant budget unavailable"), { code: options.budgetFailure === "limit" ? "assistant_monthly_budget_reached" : "assistant_budget_unavailable" });
        return { id: budgetReservations.length };
      },
      finalizeInrAssistantBudget: async (reservation: unknown, actualCostMicroUsd?: number) => {
        budgetFinalizations.push({ reservation, actualCostMicroUsd });
        if (options.budgetCommitFailure) throw Object.assign(new Error("Assistant budget commit unavailable"), { code: "assistant_budget_unavailable" });
      },
    },
    "./inrAssistantConversation.ts": conversation,
    "./inrAssistantToolRouting.ts": routing,
    "./inrAssistantActivity.ts": activity,
    "./inrAssistantGatewayDiagnostics.ts": { ...gatewayDiagnostics, recordInrAssistantGatewayDiagnostic: (value: unknown) => {
      const safe = gatewayDiagnostics.projectInrAssistantGatewayDiagnostic(value);
      if (safe) diagnostics.push(safe); return safe ?? undefined;
    } },
    "./inrAssistantBusinessTools.ts": { createInrAssistantBusinessTools: () => Object.fromEntries(["updateBusinessDna", "updateAiConfiguration", "guideChannelConnection"].map(name => [name, tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => ({ available: true }) })])) },
    "./inrAssistantCtaTools.ts": { createInrAssistantCtaTools: (args: { accountId: string; currentUserMessage: string }) => { actionFactories.push("cta"); ctaScopes.push(args); return options.cta ? { configureBusinessCta: options.cta.definition } : {}; } },
    "./inrAssistantDnaAnalysisTools.ts": { createInrAssistantDnaAnalysisTools: () => { actionFactories.push("dna-analysis"); return {}; } },
    "./inrAssistantManagementTools.ts": { createInrAssistantManagementTools: () => ({}) },
    "./inrAssistantCommercialTools.ts": { createInrAssistantCommercialTools: () => options.crmIds ? {
      manageCrmContact: tool({ inputSchema: jsonSchema({ type: "object", properties: {
        action: { type: "string", enum: ["create", "update", "delete"] }, instructionQuote: { type: "string" }, reference: { type: "string" }, contactId: { type: ["string", "null"] }, fields: { type: "object" },
      }, required: ["action", "instructionQuote", "reference", "contactId", "fields"], additionalProperties: false }, { validate: value => { const input = value as Record<string, unknown>; return input.contactId === null || typeof input.contactId === "string" ? { success: true, value: input } : { success: false, error: new Error("Invalid contactId: " + JSON.stringify(value)) }; } }), execute: async input => {
        const id = options.crmIds![Math.min(crmExecutions.length, options.crmIds!.length - 1)];
        crmExecutions.push(input);
        return { ok: !options.crmStatus, status: options.crmStatus??"created", id, message: options.crmStatus?"Résultat CRM incertain.":`Fiche CRM enregistrée : ${id}.`, nextAction: { label: "iNr’CRM", href: "/dashboard/crm" } };
      } }),
    } : {} },
    "./inrAssistantCommunicationTools.ts": { createInrAssistantCommunicationTools: () => ({}) },
    "./inrAssistantAdvertisingTools.ts": { createInrAssistantAdvertisingTools: () => ({}) },
    "./inrAssistantSettingsTools.ts": { createInrAssistantSettingsTools: () => options.settingsTools ?? {} },
    "./inrAssistantPublicationTools.ts": { createInrAssistantPublicationTools: (args: { onResult?: (result: InrAssistantPublicationResult) => void }) => Object.fromEntries(["preparePublication", "executePublication"].map(name => [name,
      tool({ inputSchema: jsonSchema({ type: "object", properties: { draftId: { type: "string" }, mode: { type: "string" } }, required: ["draftId", "mode"] }), execute: async () => {
        publicationExecutions.push(name);
        const result: InrAssistantPublicationResult = { action: name === "preparePublication" ? "prepare" : "publish", ok: true,
          status: name === "preparePublication" ? "draft" : "queued", message: name === "preparePublication" ? "Le brouillon est enregistré." : "La publication est en file d’attente.",
          toolUrl: "/dashboard/send", checkedAt: "2026-10-26T12:00:00Z", draftId: "stored-draft" };
        args.onResult?.(result);
        if (name === "executePublication") options.abortAfterPublication?.abort(new Error("Disconnected browser"));
        return result;
      } }),
    ])) },
    "./inrAssistantWorkspaceActionTools.ts": { createInrAssistantWorkspaceActionTools: () => ({ ...(options.crmIds ? {
      searchCrmContacts: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => ({ available: true, contacts: [] }) }),
    } : {}), ...(options.mediaMetadata ? {
      updateMediaMetadata: tool({ inputSchema: jsonSchema<{ instructionQuote: string; mediaId: string; title: string; tags: string[] | null; tagsMode: string | null; isActive: boolean | null }>({ type: "object", properties: {
        instructionQuote: { type: "string" }, mediaId: { type: "string" }, title: { type: "string" },
        tags: { type: ["array", "null"], items: { type: "string" } }, tagsMode: { type: ["string", "null"] }, isActive: { type: ["boolean", "null"] },
      }, required: ["instructionQuote", "mediaId", "title", "tags", "tagsMode", "isActive"], additionalProperties: false }),
        execute: async input => { metadataExecutions.push(input); return { ok: true, status: "updated", mediaId: input.mediaId, message: "Le titre de l’image a été enregistré.", nextAction: { label: "Mes médias", href: "/dashboard/mediatheque" } }; },
      }),
    } : {}) }) },
    "./inrAssistantInsightsTools.ts": { createInrAssistantInsightsTools: () => {
      actionFactories.push("insights");
      return Object.fromEntries(["readStatsSnapshots", "readGoogleReviews", "replyToGoogleReview"].map(name => [name, tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => ({ available: true }) })]));
    } },
    "./inrAssistantAppGuides.ts": { getInrAssistantAppKnowledge: () => "Documentation officielle : /dashboard?action=publish", getVerifiedInrAssistantNavigation: () => options.verifiedNavigation ?? null, createInrAssistantAppGuideTool: () => tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => ({ found: true, ...(options.guideCharacters ? { guides: [{ id: "crm", content: "Guide natif. ".repeat(Math.ceil(options.guideCharacters / 13)) }] } : {}) }) }) },
    "./inrAssistantAccountTools.ts": { createInrAssistantAccountTools: () => Object.fromEntries(["getBusinessDna", "searchMedia", "getRecentPublications"].map(name => [name,
      tool({ inputSchema: jsonSchema<Record<string, unknown>>({ type: "object", properties: {offset:{type:"integer"},query:{type:"string"},limit:{type:"integer"}} }, { validate: value => {
        const input = value as Record<string, unknown>;
        return input && typeof input === "object" && ["offset", "limit"].every(key => input[key] === undefined || Number.isInteger(input[key]))
          ? { success: true, value: input } : { success: false, error: new Error("Expected integer pagination values") };
      } }), execute: async input => options.accountRead?.(name,input) ?? { available: true } }),
    ])) },
    "./inrAssistantMemoryTools.ts": memoryToolsRuntime,
    "./inrAssistantDiagnosticsTools.ts": { createInrAssistantDiagnosticsTools: (args: {accountId: string; edition: string}) => {
      toolScopes.push({ tool: "diagnostics", accountId: args.accountId, edition: args.edition });
      return { getAccountDiagnostics: tool({ inputSchema: jsonSchema({ type: "object", properties: { area: { type: "string" } } }), execute: async () => options.diagnosticRead?.() ?? ({ sources: [{ status: "available" }], message: "Une tentative récente a rencontré une limite temporaire." }) }) };
    } },
    "./inrAssistantWorkspaceTools.ts": { createInrAssistantWorkspaceTools: (args: {accountId: string; edition: string}) => {
      toolScopes.push({ tool: "workspace", accountId: args.accountId, edition: args.edition });
      return { readWorkspaceSection: tool({ inputSchema: jsonSchema({ type: "object", properties: { section: { type: "string" } } }), execute: async () => ({ available: true, measured: true, count: 12 }) }) };
    } },
    "./inrAssistantMediaTools.ts": { createInrAssistantMediaTools: (args: { requestId: string; currentUserMessage?: string;
      onWorkStarted: (id: string) => void; onResult: (result: InrAssistantMediaResult) => void }) => {
      factories.push(args.requestId);
      mediaScopes.push({ requestId: args.requestId, currentUserMessage: args.currentUserMessage });
      return { generateMedia: tool({ inputSchema: jsonSchema<{ prompt: string }>({ type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] }),
        execute: async () => {
          mediaExecutions++;
          args.onWorkStarted("assistant-server-id-media");
          const result: InrAssistantMediaResult = { ok: true, status: "completed", requestId: "assistant-server-id-media",
            message: "Votre média est enregistré.", libraryUrl: "/dashboard/mediatheque", mediaType: "image",
            ...(options.mediaMetadata ? { media: { id: "10000000-0000-4000-8000-000000000001", title: "Image", mediaType: "image" as const, url: "https://fixture.invalid/image.png", mimeType: "image/png", width: 1024, height: 1024, durationSeconds: null } } : {}),
          };
          if (!options.followup) args.onResult(result);
          return result;
        } }),...options.extraTools };
    } },
  };
  stubs["./inrAssistantLocalInterface.ts"] = localInterfaces;
  stubs["./inrAssistantApplicationPreferences.ts"] = applicationPreferences;
  stubs["./inrAssistantStudioDraftReview.ts"] = studioDraftReview;
  stubs["./inrAssistantStudioDraftReviewUiTools.ts"] = loadClosedModule("inrAssistantStudioDraftReviewUiTools.ts", { "server-only": {}, ai: { tool, jsonSchema }, "./requireUser": { requireUser: async () => ({ errorResponse: Response.json({}, { status: 401 }) }) }, "./inrAssistantActionClause.ts": businessFormActionClauses, "./inrAssistantStudioDraftReview.ts": studioDraftReview });
  stubs["./inrAssistantContentReport.ts"] = contentReport;
  stubs["./inrAssistantContentReportTools.ts"] = loadClosedModule("inrAssistantContentReportTools.ts", { "server-only": {}, ai: { tool, jsonSchema }, "./requireUser": { requireUser: async () => ({ errorResponse: Response.json({}, { status: 401 }) }) }, "./inrAssistantActionClause.ts": businessFormActionClauses, "./inrAssistantContentReport.ts": contentReport });
  stubs["./inrAssistantBusinessRichText.ts"] = richText;
  const richTextTools = loadClosedModule<typeof import("../../lib/inrAssistantBusinessRichTextUiTools.ts")>("inrAssistantBusinessRichTextUiTools.ts", { "server-only": {}, ai: { tool, jsonSchema }, "./requireUser": { requireUser: async () => options.nativeServices?.auth ?? ({ errorResponse: Response.json({}, { status: 401 }) }) }, "./inrAssistantActionClause.ts": businessFormActionClauses, "./inrAssistantBusinessRichText.ts": richText });
  stubs["./inrAssistantBusinessRichTextUiTools.ts"] = { createInrAssistantBusinessRichTextUiTools: (args: Parameters<typeof richTextTools.createInrAssistantBusinessRichTextUiTools>[0]) => {
    const tools = richTextTools.createInrAssistantBusinessRichTextUiTools(args), definition = tools.formatBusinessDnaText;
    return options.richTextOutputTransform ? { formatBusinessDnaText: { ...definition, execute: async (...executeArgs: Parameters<NonNullable<typeof definition.execute>>) => options.richTextOutputTransform!(await definition.execute!(...executeArgs)) } } : tools;
  } };
  stubs["./inrAssistantCreditOrderReconciliation.ts"] = creditReconciliation;
  stubs["./inrAssistantGoogleBusinessDraftReview.ts"] = googleDraftReview;
  stubs["./inrAssistantGoogleBusinessDraftUiTools.ts"] = loadClosedModule("inrAssistantGoogleBusinessDraftUiTools.ts", { "server-only": {}, ai: { tool, jsonSchema }, "./requireUser": { requireUser: async () => ({ errorResponse: Response.json({}, { status: 401 }) }) }, "./inrAssistantActionClause.ts": businessFormActionClauses, "./inrAssistantGoogleBusinessDraftReview.ts": googleDraftReview });
  stubs["./inrAssistantStudioPreferenceIntent.ts"] = studioPreferenceIntent;
  stubs["./inrAssistantBadgeIdentityTheme.ts"] = badgeIdentityTheme;
  stubs["./inrAssistantNotificationNavigation.ts"] = notificationNavigation;
  stubs["./inrAssistantSendPublicationIntent.ts"] = sendPublicationIntent;
  stubs["./inrAssistantAccountUiIntent.ts"] = accountUiIntent;
  stubs["./inrAssistantBasicShopRead.ts"] = basicShopRead;
  const localDependencies = { "server-only": {}, ai: { tool, jsonSchema }, "./requireUser": { requireUser: async () => options.nativeServices?.auth ?? ({ errorResponse: Response.json({ error: "No authenticated native UI fixture" }, { status: 401 }) }) }, "./inrAssistantActionClause.ts": businessFormActionClauses, "./inrAssistantLocalInterface.ts": localInterfaces, "./inrAssistantApplicationPreferences.ts": applicationPreferences };
  stubs["./inrAssistantLocalInterfaceTools.ts"] = loadClosedModule("inrAssistantLocalInterfaceTools.ts", localDependencies);
  stubs["./inrAssistantApplicationPreferenceTools.ts"] = loadClosedModule("inrAssistantApplicationPreferenceTools.ts", localDependencies);
  stubs["./inrAssistantStudioPreferenceTools.ts"] = loadClosedModule("inrAssistantStudioPreferenceTools.ts", { ...localDependencies, "./inrAssistantStudioPreferenceIntent.ts": studioPreferenceIntent, "./aiMediaGenerationPreferences.ts": studioSavedPreferences });
  stubs["./inrAssistantBadgeIdentityThemeUiTools.ts"] = loadClosedModule("inrAssistantBadgeIdentityThemeUiTools.ts", localDependencies);
  const notificationProjection = loadClosedModule("notifications.ts", { "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => { throw new Error("No notification database execution in this fixture"); } } }, "@/lib/notificationWriter": { insertNotificationOnce: () => { throw new Error("No notification write in this fixture"); } } });
  const noNativeRequest = async () => { throw new Error("No external native route is enabled for this fixture"); };
  stubs["./inrAssistantNotificationNavigationTools.ts"] = loadClosedModule("inrAssistantNotificationNavigationTools.ts", { ...localDependencies, "./dashboardEdition.ts": nativeDashboardEdition, "./inrAssistantMemory.ts": memoryRuntime, "./notificationRemovalState.ts": notificationRemovalState, "./notifications": notificationProjection,
    "@/app/api/notifications/feed/route": { GET: options.nativeServices?.notificationFeed ?? noNativeRequest }, "@/app/api/notifications/[id]/read/route": { POST: options.nativeServices?.notificationMark ?? noNativeRequest } });
  stubs["./inrAssistantSendPublicationTools.ts"] = loadClosedModule("inrAssistantSendPublicationTools.ts", { ...localDependencies, "./inrAssistantMemory.ts": memoryRuntime, "@/app/api/booster/events/route": { GET: options.nativeServices?.draft ?? noNativeRequest } });
  if (options.nativeAccountServices) stubs["./inrAssistantAccountServiceTools.ts"] = loadClosedModule("inrAssistantAccountServiceTools.ts", { ...localDependencies, "./inrAssistantMemory.ts": memoryRuntime, "./inrAssistantRequestClauses.ts": requestClauses,
    "./inrAssistantActionPreview.ts": loadClosedModule("inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": { createHash, createHmac, timingSafeEqual }, "./inrAssistantRequestClauses.ts": requestClauses }),
    "./notificationRemovalState.ts": notificationRemovalState, "./inrAssistantCreditOrderReconciliation.ts": creditReconciliation,
  });
  stubs["./inrAssistantToolRegistry.ts"] = loadClosedModule<typeof ToolRegistry>("inrAssistantToolRegistry.ts", stubs);
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantGateway.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    Date, TextEncoder, AbortSignal, console, process: { env: { NODE_ENV: options.productionNoRedis ? "production" : "test" } },
  })((name: string) => { if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`); return stubs[name]; }, moduleRecord, moduleRecord.exports);
  return { runtime: moduleRecord.exports as typeof Gateway, generations, reservations, commits, finalized, quotaReservations, budgetReservations, budgetFinalizations, factories, actionFactories, toolScopes, ctaScopes, publicationExecutions, metadataExecutions, crmExecutions, mediaScopes, diagnostics, operationCalls, get mediaExecutions() { return mediaExecutions; } };
}

const basic = { accountId: "account-a", displayName: "Entreprise A", edition: "standard" as const,
  requestId: "server-id", request: new Request("https://inrcy.test/api/assistant/chat"),
  messages: [{ role: "user" as const, content: "Aide-moi à connecter Facebook" }] };
const complex = "Analyse mes résultats, compare les stratégies et prépare un calendrier de publications pour chaque canal sur un mois avec un budget maximum de 100 euros.";

const studioPromptRequest = "Écris un prompt pour créer une image de flyer présentant les offres de mon entreprise.";
const studioPrompt = "Crée un flyer professionnel pour mon entreprise, dans un style moderne bleu et violet, avec un titre lisible et une présentation claire de mes services.";
const studioPromptReply = `Voici le prompt préparé :\n\n> ${studioPrompt}\n\nFormat recommandé : landscape.\n\nVous pouvez l’insérer dans Studio puis vérifier les critères avant de générer.`;
const toolNames = (params: LanguageModelV3CallOptions) => (params.tools ?? []).filter(tool => tool.type === "function").map(tool => tool.name);

test("Basic SDK draft resume executes its real dedicated native reader and never substitutes generic navigation", async () => {
  const id = "30000000-0000-4000-8000-000000000003", message = `Reprends le brouillon ${id}.`; let reads = 0;
  const h = harness({ plan: [{ tool: "resumePublicationDraft", input: { draftId: id, title: null, instructionQuote: message } }], nativeServices: { auth: { activeUserId: basic.accountId, authUserId: "actor-a" }, draft: async request => { reads++; assert.equal(request.method, "GET"); assert.equal(new URL(request.url).searchParams.get("draftId"), id); return Response.json({ ok: true, event: { id, module: "booster", type: "publish_draft", payload: { secret: "PRIVATE_DRAFT" } } }); } } });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", actorUserId: "actor-a", supabase: {} as never, messages: [{ role: "user", content: message }] });
  assert.equal(reads, 1, JSON.stringify({ reply, offered: h.generations.map(call => toolNames(call.params)), diagnostics: h.diagnostics })); assert.equal(reply.outcome, "partial", "The browser still has to confirm the exact draft screen");
  assert.ok(h.generations.some(call => toolNames(call.params).includes("resumePublicationDraft")));
  assert.ok(h.generations.every(call => !toolNames(call.params).includes("navigateApplication")), "A generic Booster opening must never replace the owned draft reader");
  const navigation = reply.uiActions?.find(action => action.type === "navigate"); assert.ok(navigation?.type === "navigate"); assert.equal(navigation.navigation.href, `/dashboard?action=publish&draftId=${id}`); assert.ok("publicationDraftId" in navigation.navigation && navigation.navigation.publicationDraftId === id);
  assert.doesNotMatch(JSON.stringify(reply), /PRIVATE_DRAFT/); assert.equal(h.mediaExecutions, 0); assert.equal(h.publicationExecutions.length, 0);
});

test("Basic SDK notification action marks and rereads its owned native source before its dedicated navigation handoff", async () => {
  const id = "40000000-0000-4000-8000-000000000004", message = `Ouvre la notification ${id}.`; let marks = 0, ownedReads = 0;
  const notice: Record<string, unknown> = { id, user_id: basic.accountId, category: "action", kind: "onboarding_connect_facebook", title: "Connectez Facebook", body: "Donnée non fiable", cta_label: "Ouvrir Facebook", cta_url: "/dashboard?panel=facebook", read_at: null, meta: {}, created_at: "2026-11-05T08:00:00Z" };
  const db = { from(table: string) { assert.equal(table, "notifications"); const filters: Array<[string, unknown]> = []; const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, abortSignal: () => query, maybeSingle: async () => { ownedReads++; assert.ok(filters.some(([key, value]) => key === "user_id" && value === basic.accountId)); assert.ok(filters.some(([key, value]) => key === "id" && value === id)); return { data: { ...notice }, error: null }; } }; return query; } };
  const h = harness({ plan: [{ tool: "openNotificationAction", input: { notificationId: id, title: null, instructionQuote: message } }], nativeServices: { auth: { activeUserId: basic.accountId, authUserId: "actor-a" }, notificationFeed: async request => { assert.equal(request.method, "GET"); return Response.json({ items: [{ ...notice, unread: true }], nextOffset: null }); }, notificationMark: async (request, context) => { assert.equal(request.method, "POST"); assert.equal((await context.params).id, id); marks++; notice.read_at = "2026-11-05T10:00:00Z"; return Response.json({ ok: true }); } } });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", actorUserId: "actor-a", supabase: db as never, messages: [{ role: "user", content: message }] });
  assert.equal(marks, 1, JSON.stringify({ reply, offered: h.generations.map(call => toolNames(call.params)), diagnostics: h.diagnostics })); assert.equal(ownedReads, 2); assert.equal(reply.outcome, "partial");
  assert.ok(h.generations.some(call => toolNames(call.params).includes("openNotificationAction"))); assert.ok(h.generations.every(call => !toolNames(call.params).includes("navigateApplication")));
  const navigation = reply.uiActions?.find(action => action.type === "navigate"); assert.ok(navigation?.type === "navigate"); assert.equal(navigation.navigation.href, "/dashboard?panel=facebook"); assert.ok("notificationId" in navigation.navigation && navigation.navigation.notificationId === id);
  assert.equal(h.mediaExecutions, 0); assert.equal(h.publicationExecutions.length, 0);
});

test("Basic SDK Badge logo theme keeps the real scoped command pending without generic local or screen controls", async () => {
  const message = "Applique les couleurs de mon logo au thème du Badge.";
  const h = harness({ plan: [{ tool: "refreshBadgeThemeFromLogo", input: { revision: "native_badge_1", instructionQuote: message } }], nativeServices: { auth: { activeUserId: basic.accountId, authUserId: "actor-a" } } });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", actorUserId: "actor-a", supabase: {} as never, messages: [{ role: "user", content: message }], clientContext: { source: "untrusted_client", interfaces: [{ id: "badge_identity_theme", revision: "native_badge_1", operations: ["retry"] }] } });
  assert.equal(reply.uiCommand?.command, "refresh_badge_theme_from_logo", JSON.stringify({ reply, offered: h.generations.map(call => toolNames(call.params)), diagnostics: h.diagnostics })); assert.equal(reply.outcome, "partial"); assert.equal(reply.uiActions?.length, 1);
  assert.ok(h.generations.some(call => toolNames(call.params).includes("refreshBadgeThemeFromLogo"))); assert.ok(h.generations.every(call => !toolNames(call.params).some(name => ["controlLocalInterface", "runScreenCommand", "navigateApplication"].includes(name))));
});

for (const [message, view] of [["Lis mon solde d’Unités d’Inertie", "inertia"], ["Mes commandes de prestations", "shop_orders"]] as const) test(`Basic SDK native account reader resolves ${view} without Studio credit or purchase substitution`, async () => {
  const records: Record<string, Array<Record<string, unknown>>> = {
    loyalty_balance: [{ user_id: basic.accountId, balance: "31.5" }],
    loyalty_ledger: [{ id: "native-inertia-event", user_id: basic.accountId, created_at: "2026-11-05T10:00:00Z", action_key: "create_actu", label: "Écriture historique", amount: "-2.5" }],
    boutique_orders: [{ id: "native-prestation-order", user_id: basic.accountId, product_key: "historic_service", product_name: "Prestation historique", method: "EUR", amount_eur: "12.50", amount_eur_tax_behavior: "exclusive", amount_ui: null, status: "processed", created_at: "2026-11-05T10:00:00Z", privateEmail: "PRIVATE@example.invalid" }],
  };
  const reads: Array<{ table: string; filters: Array<[string, unknown]>; projection: string; range: number[] }> = [];
  const db = { from(table: string) {
    assert.ok(table in records, `Only the native Inertia or prestation tables may be read, never credits or payment: ${table}`);
    let projection = "", range = [0, 0]; const filters: Array<[string, unknown]> = [];
    const execute = () => { reads.push({ table, filters, projection, range }); const data = records[table].filter(item => filters.every(([key, value]) => item[key] === value)).map(item => Object.fromEntries(projection.split(",").map(key => [key, item[key]]))); return { data, error: null }; };
    const query = { select(value: string) { projection = value; return query; }, eq(key: string, value: unknown) { assert.equal(key, "user_id"); assert.equal(value, basic.accountId); filters.push([key, value]); return query; }, order: () => query, range(start: number, end: number) { range = [start, end]; return query; }, async maybeSingle() { const result = execute(); return { ...result, data: result.data[0] ?? null }; }, then(resolve: (value: ReturnType<typeof execute>) => unknown) { return Promise.resolve(execute()).then(resolve); } }; return query;
  } };
  const h = harness({ nativeAccountServices: true, nativeServices: { auth: { activeUserId: basic.accountId, authUserId: "actor-a" } }, plan: [{ tool: "readAccountServices", input: { view, offset: 0 } }] });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", actorUserId: "actor-a", supabase: db as never, messages: [{ role: "user", content: message }] });
  assert.ok(h.generations.some(call => toolNames(call.params).includes("readAccountServices"))); assert.equal(reply.outcome, "completed", JSON.stringify(reply)); assert.equal(reply.uiActions?.length ?? 0, 0); assert.equal(h.mediaExecutions, 0); assert.equal(h.publicationExecutions.length, 0);
  assert.deepEqual(reads.map(read => read.table).sort(), view === "inertia" ? ["loyalty_balance", "loyalty_ledger"] : ["boutique_orders"]); assert.ok(reads.every(read => read.filters.some(([key, value]) => key === "user_id" && value === basic.accountId)));
  const outputs = h.generations.flatMap(call => call.params.prompt.flatMap(entry => entry.role === "tool" ? entry.content : [])).flatMap(part => part.type === "tool-result" && part.toolName === "readAccountServices" && part.output.type === "json" ? [part.output.value as Record<string, unknown>] : []), output = outputs.find(item => item.view === view);
  assert.ok(output); assert.equal(output.status, "read"); assert.equal(output.credits, undefined); assert.doesNotMatch(JSON.stringify(output), /PRIVATE|privateEmail/);
  if (view === "inertia") { assert.equal(output.unit, "UI"); assert.equal(output.balance, 31.5); assert.equal(output.balanceKnown, true); assert.equal(output.ledgerKnown, true); assert.equal((output.events as Array<Record<string, unknown>>)[0].amountUi, -2.5); }
  else { const order = (output.orders as Array<Record<string, unknown>>)[0]; assert.equal(order.amountEur, 12.5); assert.equal(order.amountUi, null); assert.equal(order.status, "processed"); assert.match(String(output.message), /ne prouve ni règlement/); }
  assert.ok(reply.taskState?.receipts.some(receipt => receipt.tool === "readAccountServices" && receipt.status === "read")); assert.ok(h.generations.every(call => !toolNames(call.params).some(name => ["generateMedia", "modifyMedia", "reconcileExistingCreditOrder", "executePublication"].includes(name))));
});

test("Basic SDK rich text refuses a later quoted passage returned for the first same-field step and preserves exact native order", async () => {
  const firstClause = "Mets en gras «Alice» dans la description ADN", secondClause = "mets en gras «Bob» dans la description ADN", message = `${firstClause}, puis ${secondClause}.`;
  const context = { source: "untrusted_client" as const, interfaces: [{ id: "dna_text_description" as const, revision: "native_rich_1", operations: ["select" as const] }] };
  const input = (selectionText: string, instructionQuote: string) => ({ field: "detailedDescription", format: "bold", selectionText, wholeField: false, revision: "native_rich_1", instructionQuote });
  const auth = { activeUserId: basic.accountId, authUserId: "actor-a" };
  let nativeResults = 0;
  const wrong = harness({ nativeServices: { auth }, plan: [{ tool: "formatBusinessDnaText", input: input("Alice", firstClause) }], richTextOutputTransform: output => {
    nativeResults++; assert.ok(output && typeof output === "object" && "ok" in output && output.ok === true && "uiCommand" in output);
    const command = output.uiCommand; assert.ok(command && typeof command === "object" && "value" in command); assert.equal(command.value, JSON.stringify({ format: "bold", selectionText: "Alice", wholeField: false }));
    return { ...output, uiCommand: { ...command, value: JSON.stringify({ format: "bold", selectionText: "Bob", wholeField: false }) } };
  } });
  const rejected = await wrong.runtime.generateInrAssistantReply({ ...basic, edition: "basic", actorUserId: "actor-a", supabase: {} as never, clientContext: context, messages: [{ role: "user", content: message }] });
  assert.equal(nativeResults, 1, "The actual native factory validates Alice before fault injection changes only its returned command"); assert.equal(rejected.uiActions?.length ?? 0, 0); assert.equal(rejected.uiCommand, undefined); assert.notEqual(rejected.outcome, "completed"); assert.ok(rejected.taskState?.uiSteps?.every(step => !step.actions?.length));
  const outputs = wrong.generations.flatMap(generation => generation.params.prompt.flatMap(entry => entry.role === "tool" ? entry.content : [])).flatMap(part => part.type === "tool-result" && part.toolName === "formatBusinessDnaText" && part.output.type === "json" ? [part.output.value as Record<string, unknown>] : []);
  assert.ok(outputs.some(output => output.ok === false && output.status === "blocked" && /ne correspond pas/.test(String(output.message))), JSON.stringify(outputs));
  const first = harness({ nativeServices: { auth }, parallelPlan: [{ tool: "formatBusinessDnaText", input: input("Alice", firstClause) }, { tool: "formatBusinessDnaText", input: input("Bob", secondClause) }] });
  const initial = await first.runtime.generateInrAssistantReply({ ...basic, edition: "basic", actorUserId: "actor-a", supabase: {} as never, clientContext: context, messages: [{ role: "user", content: message }] });
  assert.equal(initial.uiActions?.length, 1); assert.equal(initial.uiCommand?.command, "control_local_interface"); assert.ok(initial.uiCommand?.command === "control_local_interface"); assert.equal(initial.uiCommand.value, JSON.stringify({ format: "bold", selectionText: "Alice", wholeField: false })); assert.equal(initial.taskState?.uiSteps?.[0].actions?.length, 1); assert.equal(initial.taskState?.uiSteps?.[1].actions, undefined); assert.equal(initial.outcome, "partial");
  const state = structuredClone(initial.taskState!); state.uiSteps = uiTask.bindInrAssistantUiSteps(state.uiSteps!, initial.uiActions!, { turnId: randomUUID(), createdAt: new Date().toISOString() });
  const second = harness({ nativeServices: { auth }, plan: [{ tool: "formatBusinessDnaText", input: input("Bob", secondClause) }] });
  const completed = await second.runtime.generateInrAssistantReply({ ...basic, edition: "basic", actorUserId: "actor-a", supabase: {} as never, clientContext: context, taskContext: state, actionInstruction: message, taskIntent: "continue", browserStepResults: [{ stepId: state.uiSteps![0].id, status: "applied" }], messages: [{ role: "user", content: "Continuer" }] });
  assert.equal(completed.uiActions?.length, 1); assert.ok(completed.uiCommand?.command === "control_local_interface"); assert.equal(completed.uiCommand.value, JSON.stringify({ format: "bold", selectionText: "Bob", wholeField: false })); assert.equal(completed.taskState?.uiSteps?.[1].actions?.length, 1); assert.equal(completed.outcome, "partial", "Bob still requires its own native browser acknowledgement");
});

for (const edition of ["basic", "standard", "premium"] as const) test(`${edition}: a requested prompt is a free Studio draft with read-only tools, never an executed generation`, async () => {
  const h = harness({ textReply: studioPromptReply });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition, supabase: {} as never, messages: [{ role: "user", content: studioPromptRequest }] });
  assert.equal(h.generations.length, 1);
  const available = toolNames(h.generations[0].params);
  assert.ok(available.includes("readAppGuide"));
  assert.ok(available.every(name => ["prepareStudioPrompt","discoverCapabilities"].includes(name) || /^(?:read|get|search|recall|guide)/.test(name)), JSON.stringify(available));
  assert.equal(available.includes("generateMedia"), false);
  assert.equal(available.includes("proposeHumanSupport"), false);
  assert.equal(h.mediaExecutions, 0);
  assert.deepEqual(h.publicationExecutions, []);
  assert.equal(reply.needsHuman, undefined);
  assert.equal(reply.taskState, undefined, "A prompt draft is not a pending paid task");
  assert.deepEqual(reply.studioDraft, { version: 1, mediaType: "image", prompt: studioPrompt, format: "landscape", durationSeconds: null });
});

test("the read-only Studio preparation tool returns an insertable draft without calling native generation", async () => {
  const draft = { version: 1, mediaType: "image", prompt: studioPrompt, format: "landscape", durationSeconds: null };
  const h = harness({ plan: [{ tool: "prepareStudioPrompt", input: draft }] });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", supabase: {} as never, messages: [{ role: "user", content: studioPromptRequest }] });
  assert.deepEqual(reply.studioDraft, draft);
  assert.equal(h.finalized.at(-1)?.success, true);
  assert.equal(reply.taskState, undefined);
  assert.equal(reply.needsHuman, undefined);
  assert.equal(h.mediaExecutions, 0);
  assert.deepEqual(h.publicationExecutions, []);
  assert.ok(toolNames(h.generations[0].params).includes("prepareStudioPrompt"));
  assert.equal(toolNames(h.generations[0].params).includes("generateMedia"), false);
});

test("yes after a server prompt draft requests free insertion without a model or native generation", async () => {
  const h = harness();
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, messages: [
    { role: "user", content: studioPromptRequest }, { role: "assistant", content: studioPromptReply }, { role: "user", content: "oui" },
  ] });
  assert.equal(reply.insertStudioDraft, true);
  assert.deepEqual(reply.studioDraft, { version: 1, mediaType: "image", prompt: studioPrompt, format: "landscape", durationSeconds: null });
  assert.equal(reply.taskState, undefined);
  assert.equal(h.generations.length, 0);
  assert.equal(h.reservations.length, 0);
  assert.equal(h.commits.length, 0);
  assert.equal(h.mediaExecutions, 0);
});

test("an unsolicited human-support call cannot replace a supported Studio prompt or invent a handoff", async () => {
  const h = harness({ unexpectedHandoff: true, textReply: studioPromptReply });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, messages: [{ role: "user", content: studioPromptRequest }] });
  assert.equal(toolNames(h.generations[0].params).includes("proposeHumanSupport"), false);
  assert.equal(reply.needsHuman, undefined);
  assert.equal(reply.handoffSummary, undefined);
  assert.ok(reply.studioDraft);
  assert.match(reply.message, /flyer/i);
  assert.doesNotMatch(reply.message, /Contactez l’équipe|transfert non sollicité/);
  assert.equal(h.mediaExecutions, 0);
});

test("insertion advice stays conversational and an intervening user request cuts off an old Studio draft", async () => {
  for (const content of ["Explique-moi comment insérer ce prompt dans Studio", "Est-ce que je dois insérer ce prompt dans Studio ?", "Comment insérer ce prompt dans Studio ?"]) {
    const h = harness({ textReply: "Vous pouvez utiliser le bouton Insérer dans iNrStudio." });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, messages: [
      { role: "user", content: studioPromptRequest }, { role: "assistant", content: studioPromptReply }, { role: "user", content },
    ] });
    assert.equal(reply.insertStudioDraft, undefined, content);
    assert.equal(h.generations.length, 1, content);
    assert.equal(h.mediaExecutions, 0);
  }
  for (const content of ["non, ne l’insère pas", "Retrouve ma dernière publication."]) {
    const h = harness({ textReply: "Quelle action souhaitez-vous réaliser ?" });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, messages: [
      { role: "user", content: studioPromptRequest }, { role: "assistant", content: studioPromptReply },
      { role: "user", content }, { role: "user", content: "oui" },
    ] });
    assert.equal(reply.insertStudioDraft, undefined, content);
    assert.equal(h.generations.length, 1, content);
    assert.equal(h.mediaExecutions, 0);
  }
});

test("customer contact wording inside a creative brief does not request iNrCy support", async () => {
  for (const content of [
    "Crée une image pour inviter les clients à contacter notre équipe.",
    "Crée un flyer avec un appel à contacter le support de notre entreprise.",
    "Create an image inviting customers to contact our support team.",
    "Crée une image et ne contacte pas le support.",
  ]) {
    const h = harness({ media: true });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, messages: [{ role: "user", content }] });
    assert.equal(toolNames(h.generations[0].params).includes("proposeHumanSupport"), false, content);
    assert.equal(reply.needsHuman, undefined, content);
    assert.equal(h.mediaExecutions, 1, content);
  }
});

test("a server-confirmed real media order passes its effective instruction and stable identity to the media guard", async () => {
  const instruction = "Crée une image carrée de mon atelier.";
  const actionRequestId = "account-a_original-media-turn";
  const startedAt = new Date().toISOString();
  const taskContext = { version: 1 as const, instruction, actionRequestId, startedAt, expiresAt: new Date(Date.now() + 60_000).toISOString(), outcome: "needs_input" as const, requiredTools: ["generateMedia"], receipts: [], question: "Confirmez-vous la création de cette image ?" };
  const h = harness({ media: true });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, actionRequestId, actionInstruction: instruction, taskContext, messages: [{ role: "user", content: "oui" }] });
  assert.equal(h.mediaExecutions, 1);
  assert.deepEqual(h.mediaScopes, [{ requestId: actionRequestId, currentUserMessage: instruction }]);
  assert.equal(reply.media?.status, "completed");
  assert.equal(reply.needsHuman, undefined);
  assert.equal(toolNames(h.generations[0].params).includes("proposeHumanSupport"), false);
});

const mediaAndMetadataRequest = "Crée une image de mon atelier puis renomme cette image « Atelier rénové » dans Mes médias.";
const metadataInput = { instructionQuote: mediaAndMetadataRequest, mediaId: "10000000-0000-4000-8000-000000000001", title: "Atelier rénové", tags: null, tagsMode: null, isActive: null };

test("a media creation followed by metadata update continues until both requested actions are confirmed", async () => {
  const h = harness({ mediaMetadata: true, plan: [{ tool: "generateMedia", input: { prompt: "Mon atelier rénové" } }, { tool: "updateMediaMetadata", input: metadataInput }] });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, messages: [{ role: "user", content: mediaAndMetadataRequest }] });
  assert.equal(h.generations.length, 3);
  assert.equal(h.mediaExecutions, 1);
  assert.equal(h.metadataExecutions.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.metadataExecutions[0])), metadataInput);
  assert.equal(reply.outcome, "completed");
  assert.deepEqual(new Set(reply.taskState?.receipts.map(receipt => receipt.tool)), new Set(["generateMedia", "updateMediaMetadata"]));
});

test("metadata edits retain distinct media identities so a two-image task can finish and resume safely", async () => {
  const message = "Renomme deux images de ma médiathèque : Atelier et Equipe.";
  const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
  const plan = ids.map((mediaId, index) => ({ tool: "updateMediaMetadata", input: { ...metadataInput, instructionQuote: message, mediaId, title: index ? "Equipe" : "Atelier" } }));
  const h = harness({ mediaMetadata: true, plan });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "premium", supabase: {} as never, messages: [{ role: "user", content: message }] });
  assert.equal(h.metadataExecutions.length, 2);
  assert.equal(reply.outcome, "completed");
  assert.equal(reply.taskState?.requiredCalls?.updateMediaMetadata, 2);
  assert.deepEqual(reply.taskState?.receipts.filter(receipt => receipt.tool === "updateMediaMetadata").map(receipt => receipt.recordId).sort(), ids);
});

test("an unfinished metadata step stays partial and a resumed task never creates the same media twice", async () => {
  const first = harness({ mediaMetadata: true, plan: [{ tool: "generateMedia", input: { prompt: "Mon atelier rénové" } }] });
  const partial = await first.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, messages: [{ role: "user", content: mediaAndMetadataRequest }] });
  assert.equal(partial.outcome, "partial");
  assert.ok(partial.taskState);
  assert.equal(first.finalized[0].success, false);
  assert.equal(first.mediaExecutions, 1);
  assert.equal(first.metadataExecutions.length, 0);
  const second = harness({ mediaMetadata: true, plan: [{ tool: "updateMediaMetadata", input: metadataInput }] });
  const completed = await second.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, actionInstruction: mediaAndMetadataRequest, taskContext: partial.taskState, messages: [{ role: "user", content: "Continue" }] });
  assert.equal(completed.outcome, "completed");
  assert.equal(second.mediaExecutions, 0);
  assert.equal(second.metadataExecutions.length, 1);
  assert.equal(toolNames(second.generations[0].params).includes("generateMedia"), false);
});

const twoContactRequest = "Ajoute deux contacts CRM : Alice avec alice@example.invalid et Bob avec bob@example.invalid.";
const contactFields = { displayName: null, companyName: null, email: null, phone: null, address: null, billingAddress: null, deliveryAddress: null, postalCode: null, city: null, siret: null, vatNumber: null, category: null, contactType: null, notes: null, important: null };
const contactPlan = ["Alice", "Bob"].map(reference => ({ tool: "manageCrmContact", input: { action: "create", instructionQuote: twoContactRequest, reference, contactId: null, fields: { ...contactFields, displayName: reference, email: `${reference.toLowerCase()}@example.invalid` } } }));
const contactIds = ["10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"];

test("capability discovery exposes callable native tools beyond the initial keywords without inventing account scope",async()=>{
  for (const scenario of [
    { instruction: "Ajoute une fiche pour Alice avec alice@example.invalid.", query: "contact", domain: "crm" },
    { instruction: "Enregistre Alice Martin, alice@example.invalid, dans mon carnet d’adresses.", query: "carnet d’adresses", domain: null },
  ]) {
  const instruction=scenario.instruction;
  const create={...contactPlan[0],input:{...contactPlan[0].input,instructionQuote:instruction}};
  const h=harness({crmIds:contactIds,plan:[{tool:"discoverCapabilities",input:{query:scenario.query,domain:scenario.domain,offset:0}},{tool:"searchCrmContacts"},create]});
  const reply=await h.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:instruction}]});
  assert.equal(toolNames(h.generations[0].params).includes("manageCrmContact"),false);
  assert.ok(toolNames(h.generations[1].params).includes("manageCrmContact"));
  assert.equal(h.crmExecutions.length,1);assert.equal(reply.outcome,"completed");assert.ok(h.generations.length<=4);
  }
});

test("discovery in an advice-only turn activates readers and never upgrades it to permission to write",async()=>{
  const h=harness({crmIds:contactIds,plan:[{tool:"discoverCapabilities",input:{query:"contact",domain:"crm",offset:0}},{tool:"searchCrmContacts"}]});
  await h.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:"Explique comment fonctionne la fiche client."}]});
  assert.ok(toolNames(h.generations[1].params).includes("searchCrmContacts"));
  assert.equal(toolNames(h.generations[1].params).includes("manageCrmContact"),false);assert.equal(h.crmExecutions.length,0);
});

test("a discovered native workflow retains a bounded chance to execute after one failed discovery", async () => {
  const instruction = "Enregistre Alice Martin, alice@example.invalid, dans mon carnet d’adresses.";
  const create = { ...contactPlan[0], input: { ...contactPlan[0].input, instructionQuote: instruction } };
  const h = harness({ crmIds: contactIds, plan: [
    { tool: "discoverCapabilities", input: { query: "carnet", domain: "contact", offset: 0 } },
    { tool: "discoverCapabilities", input: { query: "carnet", domain: "crm", offset: 0 } },
    { tool: "searchCrmContacts" }, create,
  ] });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "premium", supabase: {} as never, messages: [{ role: "user", content: instruction }] });
  assert.equal(h.crmExecutions.length, 1);
  assert.equal(reply.outcome, "completed");
  assert.equal(h.generations.length, 5);
  assert.ok(h.generations.length <= 7);
  const discovery = h.generations[0].params.tools?.find(item => item.type === "function" && item.name === "discoverCapabilities");
  assert.ok(discovery && discovery.type === "function");
  assert.match(JSON.stringify(discovery.inputSchema), /"enum":\[.*"crm".*null\]/);
});

test("two separate contact clauses remain active until both distinct receipts exist", async()=>{
  const instruction="Crée un contact CRM nommé Alice et crée un contact CRM nommé Bob.";
  const plan=contactPlan.map(call=>({...call,input:{...call.input,instructionQuote:instruction}}));
  const h=harness({crmIds:contactIds,plan});
  const reply=await h.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:instruction}]});
  assert.equal(h.crmExecutions.length,2);assert.equal(reply.outcome,"completed");
  assert.equal(reply.taskState?.requiredCalls?.manageCrmContact,2);
  assert.ok(toolNames(h.generations[1].params).includes("manageCrmContact"));
});

test("an explicitly requested read after a mutation remains in the plan and cannot be reported completed early", async()=>{
  const instruction="Crée un contact CRM nommé Alice, puis consulte les dernières publications Facebook.";
  const reads:string[]=[];
  const options={crmIds:contactIds,accountRead:(name:string)=>{reads.push(name);return {ok:true,items:[]};}};
  const create={...contactPlan[0],input:{...contactPlan[0].input,instructionQuote:instruction}};
  const h=harness({...options,plan:[create,{tool:"getRecentPublications"}]});
  const reply=await h.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:instruction}]});
  assert.deepEqual(reads,["getRecentPublications"]);assert.equal(h.crmExecutions.length,1);assert.equal(reply.outcome,"completed");
  assert.ok(toolNames(h.generations[1].params).includes("getRecentPublications"));
  const partial=harness({...options,plan:[create]});
  const unfinished=await partial.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:instruction}]});
  assert.equal(unfinished.outcome,"partial");assert.match(unfinished.taskProgress?.remaining.join(" ")??"",/publications/);
  const resumed=harness({...options,plan:[{tool:"getRecentPublications"}]});
  const done=await resumed.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,taskContext:unfinished.taskState,actionInstruction:instruction,messages:[{role:"user",content:"Continue"}]});
  assert.equal(done.outcome,"completed");assert.equal(resumed.crmExecutions.length,0);
});

test("invalid Qwen tool arguments switch to the bounded fallback before executing the read without replaying a saved mutation", async () => {
  const instruction = "Crée un contact CRM nommé Alice, puis consulte les dernières publications Facebook.";
  const reads: unknown[] = [];
  const h = harness({ crmIds: contactIds, plan: [
    { ...contactPlan[0], input: { ...contactPlan[0].input, instructionQuote: instruction } },
    { tool: "getRecentPublications", input: { limit: "8" } },
    { tool: "getRecentPublications", input: { limit: 8 } },
  ], accountRead: (_name, input) => { reads.push(input); return { ok: true, items: [] }; } });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "premium", supabase: {} as never, messages: [{ role: "user", content: instruction }] });
  assert.equal(h.generations[1].model, policy.INR_ASSISTANT_MODELS.qwen);
  assert.equal(h.generations[2].model, policy.INR_ASSISTANT_MODELS.luna);
  assert.deepEqual(reads, [{ limit: 8 }], "The invalid string never reaches or gets coerced by the native executor");
  assert.equal(h.crmExecutions.length, 1);
  assert.equal(reply.outcome, "completed");
  assert.ok(h.generations.length <= 7);
});

test("oversized SDK argument rejection is compacted before fallback while saved CRM facts and later reads survive", async () => {
  const instruction = "Crée deux contacts CRM Alice et Bob, puis consulte les dernières publications Facebook.";
  const first = { ...contactPlan[0], input: { ...contactPlan[0].input, instructionQuote: instruction } };
  const second = { ...contactPlan[1], input: { ...contactPlan[1].input, instructionQuote: instruction } };
  const malformed = { ...second, input: { ...second.input, contactId: { invalidJsonInId: "SDK_REJECTED_UNEXECUTED_".repeat(5000) } } };
  const observedReads: number[] = [];
  const h = harness({ crmIds: contactIds, plan: [first, malformed, second, { tool: "getRecentPublications" }], accountRead: () => { observedReads.push(h.crmExecutions.length); return { ok: true, publications: [{ id: "verified_publication_1" }] }; } });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "premium", supabase: {} as never, messages: [{ role: "user", content: instruction }] });
  assert.equal(reply.outcome, "completed", JSON.stringify({outcome:reply.outcome,diagnostics:h.diagnostics,executions:h.crmExecutions.length,generations:h.generations.length}));
  assert.equal(h.crmExecutions.length, 2, "schema rejection never executes and the first saved contact is not replayed");
  assert.deepEqual(observedReads, [2]);
  assert.equal(h.generations[2].model, policy.INR_ASSISTANT_MODELS.luna);
  const repairedContext = JSON.stringify(h.generations[2].params.prompt);
  assert.doesNotMatch(repairedContext, /SDK_REJECTED_UNEXECUTED_/);
  assert.match(repairedContext, /Arguments rejetés.*AVANT toute exécution/);
  assert.ok(repairedContext.includes(contactIds[0]), "the first verified native record remains available");
  assert.ok(h.generations.length <= 12);
});

test("a native published-history reader obeys the later-read order while drafts cannot satisfy that objective", async () => {
  const instruction = "Crée un contact CRM nommé Alice, puis consulte les dernières publications Facebook.";
  const create = { ...contactPlan[0], input: { ...contactPlan[0].input, instructionQuote: instruction } };
  for (const view of ["history", "drafts", "prepared"]) {
    const read = { tool: "readPublicationWorkspace", input: { view, recordId: null, offset: 0 } };
    const observed: number[] = [];
    const h = harness({ crmIds: contactIds, publicationWorkspaceRead: true, parallelPlan: [read, create], plan: [read, read], accountRead: () => { observed.push(h.crmExecutions.length); return { ok: true, view, records: [], nextOffset: null }; } });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, actorUserId: "actor-a", edition: "premium", supabase: {} as never, messages: [{ role: "user", content: instruction }] });
    assert.deepEqual(observed, [1]);
    assert.equal(toolNames(h.generations[0].params).includes("readPublicationWorkspace"), false);
    assert.equal(reply.outcome, view === "history" ? "completed" : "partial");
    assert.equal(reply.taskState?.receipts.some(receipt => receipt.tool === "getRecentPublications" && receipt.status === "read"), view === "history");
  }
});

test("continuation compacts an oversized public guide before dispatch while retaining native results and IDs", async () => {
  const instruction = "Crée un contact CRM nommé Alice, puis consulte les dernières publications Facebook.";
  const h = harness({ crmIds: contactIds, guideCharacters: 40_000, plan: [
    { tool: "readAppGuide" }, { tool: "searchCrmContacts" },
    { ...contactPlan[0], input: { ...contactPlan[0].input, instructionQuote: instruction } }, { tool: "getRecentPublications" },
  ], accountRead: () => ({ ok: true, items: [] }) });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, requestId: randomUUID(), actorUserId: "actor-a", edition: "premium", supabase: {} as never, messages: [{ role: "user", content: instruction }] });
  assert.equal(h.generations[1].model, policy.INR_ASSISTANT_MODELS.qwen, "Preflight compaction should preserve the economical model instead of triggering a fallback");
  const continuationPrompt = JSON.stringify(h.generations[1].params.prompt);
  assert.match(continuationPrompt, /readAppGuide/);
  assert.match(continuationPrompt, /Extrait du guide/);
  const guideResult = h.generations[1].params.prompt.flatMap(message => message.role === "tool" ? message.content : [])
    .find(part => part.type === "tool-result" && part.toolName === "readAppGuide");
  assert.ok(guideResult?.type === "tool-result" && guideResult.output.type === "json");
  const guides = (guideResult.output.value as { guides: Array<{ content: string }> }).guides;
  assert.ok(guides[0].content.length < 2600, "The guide fits the 2400-character limit plus its explicit truncation notice");
  assert.equal(h.crmExecutions.length, 1);
  assert.equal(reply.outcome, "completed");
  assert.ok(reply.taskState?.receipts.some(receipt => receipt.tool === "manageCrmContact" && receipt.id === contactIds[0]), "The native saved contact identity survives compaction");
  assert.ok(h.generations.every(({ params }) => attachmentPolicy.assistantModelInputBudget({ prompt: params.prompt, tools: params.tools }) + 1024 <= 32_000));
  assert.equal(h.diagnostics.some(diagnostic => diagnostic.phase === "input_limit"), false);
});

test("media pagination follows a progressing cursor past two reads without allowing an unchanged loop",async()=>{
  const offsets:number[]=[];
  const options={accountRead:(name:string,input:unknown)=>{assert.equal(name,"searchMedia");const offset=(input as {offset:number}).offset;offsets.push(offset);return {ok:true,items:[{id:`media-${offset}`}],nextOffset:offset<16?offset+8:null};}};
  const h=harness({...options,plan:[0,8,16].map(offset=>({tool:"searchMedia",input:{query:"toiture",offset,limit:8}}))});
  const reply=await h.runtime.generateInrAssistantReply({...basic,supabase:{} as never,messages:[{role:"user",content:"Retrouve toutes mes photos de toiture."}]});
  assert.deepEqual(offsets,[0,8,16]);assert.ok(toolNames(h.generations[2].params).includes("searchMedia"));assert.equal(reply.outcome,"completed");
  offsets.length=0;
  const stalled=harness({...options,plan:[0,0,0,0].map(offset=>({tool:"searchMedia",input:{query:"toiture",offset,limit:8}}))});
  const failed=await stalled.runtime.generateInrAssistantReply({...basic,supabase:{} as never,messages:[{role:"user",content:"Retrouve toutes mes photos de toiture."}]});
  assert.deepEqual(offsets,[0]);assert.notEqual(failed.outcome,"completed");assert.ok(stalled.generations.length<=7);
});

test("an exhaustive media search cannot skip its first page or jump over a returned cursor", async () => {
  for (const requestedOffsets of [[80], [0, 80]]) {
    const actual: number[] = [];
    const h = harness({ plan: requestedOffsets.map(offset => ({ tool: "searchMedia", input: { query: "toiture", offset, limit: 8 } })), accountRead: (_name, input) => {
      const offset = (input as { offset: number }).offset;
      actual.push(offset);
      return { ok: true, items: [], nextOffset: offset === 0 ? 8 : null };
    } });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, messages: [{ role: "user", content: "Retrouve toutes mes photos de toiture." }] });
    assert.deepEqual(actual, requestedOffsets[0] === 0 ? [0] : []);
    assert.notEqual(reply.outcome, "completed");
  }
});

test("a parallel premature read is deferred without native execution and becomes available after the preceding mutation", async () => {
  const instruction = "Crée un contact CRM nommé Alice, puis consulte les dernières publications Facebook.";
  let readCount = 0;
  const h = harness({ crmIds: contactIds, parallelPlan: [
    { tool: "getRecentPublications" },
    { ...contactPlan[0], input: { ...contactPlan[0].input, instructionQuote: instruction } },
  ], plan: [{ tool: "getRecentPublications" }, { tool: "getRecentPublications" }], accountRead: () => { readCount++; assert.equal(h.crmExecutions.length, 1); return { ok: true, items: [] }; } });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "premium", supabase: {} as never, messages: [{ role: "user", content: instruction }] });
  assert.equal(h.crmExecutions.length, 1);
  assert.equal(readCount, 1, "Only the requested read after mutation executes");
  assert.equal(toolNames(h.generations[0].params).includes("getRecentPublications"), false);
  assert.equal(toolNames(h.generations[1].params).includes("getRecentPublications"), true);
  assert.equal(reply.outcome, "completed");
});

test("a native truncated result without a next cursor never completes an exhaustive request", async () => {
  const h = harness({ plan: [{ tool: "searchMedia", input: { query: "toiture", offset: 0, limit: 8 } }], accountRead: () => ({ ok: true, items: [], truncated: true, nextOffset: null }) });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, messages: [{ role: "user", content: "Retrouve toutes mes photos de toiture." }] });
  assert.notEqual(reply.outcome, "completed");
  assert.ok(reply.taskState?.receipts.some(receipt => receipt.tool === "searchMedia" && receipt.status === "partial"));
});

test("native media reference lookup remains possible before editing while the later explicit listing still runs", async () => {
  const instruction = "Renomme l’image Atelier en Atelier rénové, puis liste mes images.";
  const observed: number[] = [];
  const h = harness({ mediaMetadata: true, plan: [{ tool: "searchMedia" }, { tool: "updateMediaMetadata", input: { ...metadataInput, instructionQuote: instruction } }, { tool: "searchMedia" }],
    accountRead: () => { observed.push(h.metadataExecutions.length); return { ok: true, items: [{ id: metadataInput.mediaId }] }; } });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "premium", supabase: {} as never, messages: [{ role: "user", content: instruction }] });
  assert.deepEqual(observed, [0, 1]);
  assert.equal(h.metadataExecutions.length, 1);
  assert.equal(reply.outcome, "completed");
});

test("a sender lookup before accepted individual mail does not replace the explicit mailbox listing afterwards", async () => {
  let accepted = 0;
  const observed: number[] = [];
  const h = harness({ plan: [{ tool: "listIndividualMailboxes" }, { tool: "sendIndividualMail" }, { tool: "listIndividualMailboxes" }], mailboxFactory: () => ({
    listIndividualMailboxes: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => { observed.push(accepted); return { ok: true, items: [{ id: "sender" }], nextOffset: null }; } }),
    sendIndividualMail: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => { accepted++; return { ok: true, status: "accepted", id: "ia-123456789abc", deliveryVerified: false, message: "Demande d’envoi acceptée ; livraison non confirmée." }; } }),
  }) });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, actorUserId: "actor-a", edition: "premium", supabase: {} as never, messages: [{ role: "user", content: "Envoie un mail individuel à alice@example.invalid, puis liste mes boîtes expéditrices." }] });
  assert.deepEqual(observed, [0, 1]);
  assert.equal(accepted, 1);
  assert.equal(reply.outcome, "completed");
  assert.equal(reply.taskState?.receipts.find(receipt => receipt.tool === "sendIndividualMail")?.status, "accepted");
});

test("mixed advice and an explicit media action retain only the requested action while advice alone stays read-only",async()=>{
  const instruction="Explique comment fonctionne Studio, puis crée une image de notre atelier.";
  const h=harness({media:true,plan:[{tool:"generateMedia",input:{prompt:"Notre atelier"}}]});
  const reply=await h.runtime.generateInrAssistantReply({...basic,supabase:{} as never,messages:[{role:"user",content:instruction}]});
  assert.equal(h.mediaExecutions,1);assert.equal(reply.outcome,"completed");
  for(const content of ["Explique comment créer une image de notre atelier.","Explique Studio, puis ne crée pas d’image."]){
    const guidance=harness({plan:[{tool:"generateMedia",input:{prompt:"Notre atelier"}}]});
    await guidance.runtime.generateInrAssistantReply({...basic,supabase:{} as never,messages:[{role:"user",content}]});
    assert.equal(guidance.mediaExecutions,0);assert.equal(toolNames(guidance.generations[0].params).includes("generateMedia"),false);
  }
});

test("oversized contact batches are blocked before model reservations or native tool construction",async()=>{
  const h=harness({crmIds:contactIds,plan:contactPlan});
  const reply=await h.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:"Crée 26 contacts CRM pour mon entreprise."}]});
  assert.equal(reply.outcome,"blocked");
  assert.match(reply.message,/24 actions/);
  assert.equal(h.generations.length,0);
  assert.equal(h.reservations.length,0);
  assert.equal(h.finalized.length,0);
  assert.equal(h.crmExecutions.length,0);
  assert.deepEqual(h.factories,[]);
  assert.deepEqual(h.actionFactories,[]);
  assert.deepEqual(h.toolScopes,[]);
});

test("a request for two contacts continues until two distinct native CRM receipts are confirmed", async () => {
  const h = harness({ crmIds: contactIds, plan: contactPlan });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "premium", supabase: {} as never, messages: [{ role: "user", content: twoContactRequest }] });
  assert.equal(h.crmExecutions.length, 2);
  assert.equal(h.generations.length, 3);
  assert.equal(toolNames(h.generations[1].params).includes("manageCrmContact"), true, "One completed contact must not remove the second requested operation");
  assert.equal(reply.outcome, "completed");
  assert.deepEqual({ ...reply.taskState?.requiredCalls }, { manageCrmContact: 2 });
  assert.deepEqual(new Set(reply.taskState?.receipts.filter(receipt => receipt.tool === "manageCrmContact").map(receipt => receipt.id)), new Set(contactIds));
});

test("repeated receipts for one contact stay partial and resumption can finish the missing contact", async () => {
  const first = harness({ crmIds: [contactIds[0], contactIds[0]], plan: contactPlan });
  const partial = await first.runtime.generateInrAssistantReply({ ...basic, edition: "premium", supabase: {} as never, messages: [{ role: "user", content: twoContactRequest }] });
  assert.equal(partial.outcome, "partial");
  assert.ok(partial.taskState);
  assert.equal(first.finalized[0].success, false);
  const second = harness({ crmIds: [contactIds[1]], plan: [contactPlan[1]] });
  const completed = await second.runtime.generateInrAssistantReply({ ...basic, edition: "premium", supabase: {} as never, actionInstruction: twoContactRequest, taskContext: partial.taskState, messages: [{ role: "user", content: "Continue" }] });
  assert.equal(second.crmExecutions.length, 1);
  assert.equal(completed.outcome, "completed");
  assert.deepEqual(new Set(completed.taskState?.receipts.filter(receipt => receipt.tool === "manageCrmContact").map(receipt => receipt.id)), new Set(contactIds));
});

test("five dependent SDK tool steps complete a media and publication task without dropping late actions",async()=>{
 const h=harness({media:true,plan:[{tool:"getBusinessDna"},{tool:"searchMedia"},{tool:"generateMedia",input:{prompt:"Une image toiture"}},{tool:"preparePublication",input:{draftId:"stored-draft",mode:"publish"}},{tool:"executePublication",input:{draftId:"stored-draft",mode:"publish"}}]});
 const reply=await h.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:"Lis mon ADN, crée une image puis prépare et publie une publication Facebook maintenant."}]});
 assert.equal(h.generations.length,6);assert.equal(h.mediaExecutions,1);assert.deepEqual(h.publicationExecutions,["preparePublication","executePublication"]);
 assert.equal(reply.outcome,"processing");assert.equal(h.finalized[0].success,false);assert.doesNotMatch(reply.message,/Outil absent/);
});
test("a guide read does not remove an unused DNA read on the next SDK step",async()=>{
 const h=harness({plan:[{tool:"readAppGuide"},{tool:"getBusinessDna"}]});
 const reply=await h.runtime.generateInrAssistantReply({...basic,supabase:{} as never,messages:[{role:"user",content:"Lis le guide puis l’ADN de mon entreprise."}]});
 assert.equal(h.generations.length,3);assert.doesNotMatch(reply.message,/Outil absent/);
});

test("account facts survive tool steps and mutation receipts are checkpointed before a following action",async()=>{
 const ids=["10000000-0000-4000-8000-000000000001","10000000-0000-4000-8000-000000000002"];
 const message="Crée deux contacts CRM : Alice et Bob.";
 const plan=ids.map((_,index)=>({tool:"manageCrmContact",input:{action:"create",instructionQuote:message,reference:`contact-${index}`,contactId:null,fields:{firstName:index?"Bob":"Alice"}}}));
 const h=harness({crmIds:ids,plan});
 const checkpoints:taskPolicy.InrAssistantTaskState[]=[];
 await h.runtime.generateInrAssistantReply({...basic,actorUserId:"actor-a",edition:"premium",supabase:{} as never,accountContext:{business:{company:"Atelier continuité vérifiée"}},messages:[{role:"user",content:message}],onTaskCheckpoint:async(state)=>{
   checkpoints.push(structuredClone(state));
   assert.equal(h.crmExecutions.length,Math.floor(checkpoints.length/2),"Pre-action checkpoint precedes execution; result checkpoint precedes the next executor");
 }});
 assert.equal(checkpoints.length,4);
 assert.equal(checkpoints[0].outcome,"blocked");
 assert.equal(checkpoints[1].outcome,"partial");
 assert.equal(checkpoints[2].receipts.at(-1)?.status,"executing_unconfirmed");
 assert.equal(checkpoints[3].outcome,"completed");
 assert.match(JSON.stringify(h.generations[1].params.prompt),/Atelier continuité vérifiée/);
});

test("a failed durable checkpoint stops remaining mutations without replay or optimistic completion",async()=>{
 const ids=["10000000-0000-4000-8000-000000000001","10000000-0000-4000-8000-000000000002"];
 const message="Crée deux contacts CRM : Alice et Bob.";
 const plan=ids.map((_,index)=>({tool:"manageCrmContact",input:{action:"create",instructionQuote:message,reference:`contact-${index}`,contactId:null,fields:{firstName:index?"Bob":"Alice"}}}));
 const h=harness({crmIds:ids,plan});
 const reply=await h.runtime.generateInrAssistantReply({...basic,actorUserId:"actor-a",edition:"premium",supabase:{} as never,messages:[{role:"user",content:message}],onTaskCheckpoint:async()=>{throw new Error("Synthetic storage unavailable");}});
 assert.equal(h.crmExecutions.length,0);
 assert.equal(reply.outcome,"blocked");
 assert.equal(h.generations.length,1);
 assert.equal(reply.taskProgress?.completed.length,0,"Only one of two contacts exists");
 assert.deepEqual(Array.from(reply.taskProgress?.remaining??[]),["modifier la fiche CRM"]);
});
test("a partial task returns remaining work and resumes without creating its media twice",async()=>{
 const message="Crée une image puis prépare et publie une publication Facebook maintenant.";
 const first=harness({media:true,plan:[{tool:"generateMedia",input:{prompt:"Une image toiture"}}]});
 const partial=await first.runtime.generateInrAssistantReply({...basic,supabase:{} as never,messages:[{role:"user",content:message}]});
 assert.equal(partial.outcome,"partial");assert.equal(first.finalized[0].success,false);assert.match(partial.message,/Il reste à/);assert.ok(partial.taskState);
 const second=harness({media:true,plan:[{tool:"preparePublication",input:{draftId:"stored-draft",mode:"publish"}},{tool:"executePublication",input:{draftId:"stored-draft",mode:"publish"}}]});
 const finished=await second.runtime.generateInrAssistantReply({...basic,supabase:{} as never,messages:[{role:"user",content:"Continue"}],actionInstruction:message,taskContext:partial.taskState});
 assert.equal(second.mediaExecutions,0);assert.deepEqual(second.publicationExecutions,["preparePublication","executePublication"]);assert.equal(finished.outcome,"processing");
 assert.ok(!second.generations[0].params.tools?.some(t=>t.type === "function" && t.name === "generateMedia"));
});

test("Standard routes real phone and website CTA orders through the scoped executor and returns its saved result", async () => {
  for (const [target, current] of [
    ["phone", "Mets mon téléphone 06.12.34.56.78 dans tous mes CTAs."],
    ["website", "Fais tous mes CTA avec mon site https://atelier.example.com/offres."],
  ] as const) {
    const fixture = createCtaToolFixture({ current, pilot: true, website: "https://atelier.example.com/offres" });
    const h = harness({ cta: { definition: fixture.definition, input: { target, instructionQuote: current, channels: null } } });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, accountId: CTA_TEST_ACCOUNT_ID,
      supabase: {} as never, messages: [{ role: "user", content: current }] });
    assert.ok(reply.message.length > 0);
    assert.equal(h.ctaScopes[0].accountId, CTA_TEST_ACCOUNT_ID);
    assert.equal(h.ctaScopes[0].currentUserMessage, current);
    const map = fixture.tables.business_profiles.ai_channel_ctas as Record<string, { choice: string; phone: string; url: string }>;
    const channels = ["site_web", "gmb", "facebook", "instagram", "threads", "linkedin", "x", "tiktok", "youtube_shorts", "pinterest"];
    for (const channel of channels) assert.equal(map[channel].choice, target === "phone" ? "appeler" : "site", channel);
    assert.equal(fixture.calls.filter(call => call.patch).length, 2);
    const transcript = JSON.stringify(h.generations[1].params.prompt);
    assert.match(transcript, /configureBusinessCta/);
    assert.match(transcript, /applied/);
    assert.ok(h.generations.every(generation => generation.model !== policy.INR_ASSISTANT_MODELS.sol));
  }
});

test("Standard CTA guidance and ambiguous destination never persist a guessed configuration", async () => {
  for (const current of ["Comment mettre mon téléphone dans tous mes CTAs ?", "Configure tous mes CTAs avec mon site web ou mon téléphone."]) {
    const fixture = createCtaToolFixture({ current });
    const h = harness({ cta: { definition: fixture.definition, input: { target: "phone", instructionQuote: current, channels: null } } });
    await h.runtime.generateInrAssistantReply({ ...basic, accountId: CTA_TEST_ACCOUNT_ID,
      supabase: {} as never, messages: [{ role: "user", content: current }] });
    assert.equal(fixture.calls.length, 0);
    if (current.startsWith("Comment")) {
      assert.ok(h.generations.every(generation => !generation.params.tools?.some(t => t.type === "function" && t.name === "configureBusinessCta")), "guidance never exposes a mutation tool");
      assert.match(JSON.stringify(h.generations[1].params.prompt), /unavailable tool 'configureBusinessCta'/);
    } else assert.match(JSON.stringify(h.generations[1].params.prompt), /needs_instruction/);
  }
});

test("Basique executes an explicitly requested included manual tool with scoped budget accounting", async () => {
  const h = harness({ media: true });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", messages: [{ role: "user", content: "Génère une image de mon atelier." }] });
  assert.equal(reply.message, "Votre média est enregistré.");
  assert.equal(h.generations.length, 1);
  assert.equal(h.mediaExecutions, 1);
  assert.equal(h.budgetReservations.length, 1);
  assert.equal(h.budgetReservations[0].edition, "basic");
  assert.equal(h.budgetReservations[0].accountId, basic.accountId);
  assert.ok(toolNames(h.generations[0].params).includes("generateMedia"));
  assert.ok(h.generations.every(item => item.model !== policy.INR_ASSISTANT_MODELS.sol));
  assert.equal(h.publicationExecutions.length, 0);
});

test("Basique admits only reviewed manual tools and denies agents, Premium tools and unknown additions", () => {
  const result = editionPolicy.assistantToolsForEdition({
    readAppGuide: {}, getBusinessDna: {}, getAccountDiagnostics: {}, recallPastDiscussions: {},
    generateMedia: {}, preparePublication: {}, executePublication: {}, updateToolSettings: {},
    readPublicationIdeas: {}, managePublicationIdeas: {}, updateAgentAutomation: {}, dispatchAgent: {}, manageCrmContact: {}, dispatchCampaignDraft: {}, manageAdvertisingCampaign: {},
    readAndModifyEverything: {}, newFutureTool: {},
  }, "basic");
  assert.deepEqual(Object.keys(result), ["readAppGuide", "getBusinessDna", "getAccountDiagnostics", "recallPastDiscussions", "generateMedia", "preparePublication", "executePublication", "updateToolSettings"]);
});

test("Basique can ask how to use a tool, with no execution capability exposed", async () => {
  const h = harness();
  await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", messages: [{ role: "user", content: "Comment modifier mon ADN et mes appels à l’action ?" }] });
  assert.ok(h.generations.length > 0);
  for (const generation of h.generations) {
    for (const tool of generation.params.tools ?? []) {
      if (tool.type === "function") assert.ok(!/generate|execute|update|configure|prepare|send|reply|delete/i.test(tool.name), tool.name);
    }
  }
  assert.equal(h.mediaExecutions, 0);
  assert.equal(h.publicationExecutions.length, 0);
});

test("Basique support questions expose requested reads without CTA, DNA or review mutations", async () => {
  const h = harness();
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic",
    messages: [{ role: "user", content: "Comment compléter mon ADN, mettre mon téléphone en CTA et consulter mes avis et statistiques ?" }],
    supabase: { from: () => assert.fail("No unrequested database operation") } as never,
  });
  assert.equal(reply.message, "Voici la prochaine étape.");
  assert.deepEqual(h.factories, []);
  assert.equal(h.mediaExecutions, 0);
  assert.equal(h.publicationExecutions.length, 0);
  assert.ok(h.generations[0].params.tools?.some(definition => definition.type === "function" && definition.name === "getBusinessDna"));
  assert.ok(h.generations[0].params.tools?.every(definition => definition.type !== "function" || /^(?:read|get|search|recall|guide)/.test(definition.name) || ["proposeHumanSupport","discoverCapabilities"].includes(definition.name)), JSON.stringify(toolNames(h.generations[0].params)));
});

test("a reviewed navigation answer is delivered without any provider call or economic reservation", async () => {
  const h = harness({ verifiedNavigation: "Cliquez sur Connecter.", productionNoRedis: true, sol: true });
  const result = await h.runtime.generateInrAssistantReply(basic);
  assert.equal(result.message, "Cliquez sur Connecter.");
  assert.equal(h.generations.length, 0);
  assert.equal(h.reservations.length, 0);
  assert.equal(h.factories.length, 0);
  assert.equal(h.finalized[0].success, true);
});

test("ordinary assistance starts with Qwen and includes canonical product knowledge", async () => {
  const h = harness();
  const reply = await h.runtime.generateInrAssistantReply(basic);
  assert.equal(reply.message, "Voici la prochaine étape.");
  assert.equal(h.generations[0].model, policy.INR_ASSISTANT_MODELS.qwen);
  assert.ok(JSON.stringify(h.generations[0].params.prompt).includes("/dashboard?action=publish"));
  assert.equal(h.reservations[0].feature, "assistant.chat");
  assert.equal(h.finalized[0].success, true);
});

test("Qwen tool loops leave the fourth call to a tool-free economical answer, with actual model accounting", async () => {
  const h = harness({ ignoresToolChoice: true });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic,
    messages: [{ role: "user", content: "AIDE MOI A FAIRE UNE PUBLICATION" }],
  });
  assert.equal(reply.message, "Voici la prochaine étape.");
  assert.deepEqual(h.generations.map(row => row.model), [
    policy.INR_ASSISTANT_MODELS.qwen, policy.INR_ASSISTANT_MODELS.qwen,
    policy.INR_ASSISTANT_MODELS.qwen, policy.INR_ASSISTANT_MODELS.luna,
  ]);
  assert.equal(h.generations[3].params.tools?.length ?? 0, 0);
  assert.equal(h.generations[3].params.toolChoice?.type, "none");
  assert.match(JSON.stringify(h.generations[3].params.prompt), /posez une question courte/);
  assert.equal(h.reservations.length, 4);
  assert.deepEqual(h.commits.map(row => row.model), h.generations.map(row => row.model));
  assert.equal(h.publicationExecutions.length, 0);
  assert.equal(h.mediaExecutions, 0);
  assert.equal(h.finalized[0].success, true);
});

test("workspace and diagnostic tools execute using only the authenticated factory scope", async () => {
  for (const lookup of ["diagnostics", "workspace"] as const) {
    const h = harness({ lookup });
    const result = await h.runtime.generateInrAssistantReply({ ...basic, supabase: { from: () => { throw new Error("Unexpected database access"); } } as never,
      messages: [{ role: "user", content: lookup === "diagnostics" ? "J’ai une erreur de connexion à Facebook" : "Affiche mes statistiques" }],
      clientContext: { source: "untrusted_client", screen: { pathname: "/dashboard/mediatheque", tool: "Mes médias" } } });
    if (lookup === "diagnostics") assert.equal(result.message, "Voici la prochaine étape.");
    else { assert.equal(result.outcome, "partial"); assert.match(result.message, /n’a pas été transmise/); }
    assert.deepEqual(h.toolScopes, [...(lookup === "diagnostics" ? [{ tool: "diagnostics", accountId: "account-a", edition: "standard" }] : []), { tool: "workspace", accountId: "account-a", edition: "standard" } ]);
    assert.equal(h.generations.length, 2);
    const prompt = JSON.stringify(h.generations[1].params.prompt);
    assert.match(prompt, lookup === "diagnostics" ? /limite temporaire/ : /measured/);
    assert.match(prompt, /non fiables/);
    assert.ok(h.generations.every(call => call.model !== policy.INR_ASSISTANT_MODELS.sol));
  }
});

test("the real SDK recalls closed discussions from the pre-scoped reader with bounded, private historical context", async () => {
  const h = harness({ lookup: "memory" });
  const reads: Array<{ account: string; actor: string; input: unknown }> = [];
  const actorScope = "same-professional-only";
  const reader: MemoryTools.InrAssistantMemoryReader = {
    loadRecent: async () => { throw new Error("Unexpected recent read instead of requested search"); },
    search: async (input) => {
      // Scope is closed over by the authenticated reader, never supplied by AI.
      reads.push({ account: basic.accountId, actor: actorScope, input });
      return { available: true, truncated: true, untrustedContent: true, turns: Array.from({ length: 8 }, (_, index) => ({
        conversationId: `PRIVATE_CONVERSATION_${index}`, turnId: index === 0 ? "active-turn" : `PRIVATE_TURN_${index}`,
        userText: `Campagne de Noël ${index} : ${"préparer un sujet utile. ".repeat(200)} SECRET_END_NEVER_SEND`,
        assistantText: `Voici les thèmes ${index} : ${"idée de publication. ".repeat(200)} SECRET_END_NEVER_SEND`, status: "completed" as const,
        createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T11:00:00Z",
      })) };
    },
  };
  const result = await h.runtime.generateInrAssistantReply({ ...basic, memory: reader, turnId: "active-turn",
    messages: [{ role: "user", content: "Reprenons la campagne de Noël dont nous avions parlé hier" }] });
  assert.equal(result.message, "Voici la prochaine étape.");
  assert.equal(reads.length, 1); assert.equal(reads[0].account, basic.accountId); assert.equal(reads[0].actor, actorScope);
  assert.deepEqual(Object.keys(reads[0].input as object).sort(), ["limit", "query"]);
  assert.equal(h.generations.length, 2); assert.equal(h.reservations.length, 2); assert.equal(h.commits.length, 2);
  const prompt = JSON.stringify(h.generations[1].params.prompt);
  assert.match(prompt, /past_private_assistant_discussions/); assert.match(prompt, /historicalOnly/);
  assert.match(prompt, /2026-10-20/); assert.match(prompt, /Campagne de Noël 1/);
  assert.doesNotMatch(prompt, /Campagne de Noël 0|PRIVATE_CONVERSATION|PRIVATE_TURN|SECRET_END_NEVER_SEND|same-professional-only/);
  assert.ok(h.reservations.every((reservation) => reservation.estimatedInputTokens <= 32_000));
  assert.ok(new TextEncoder().encode(prompt).byteLength <= 31_000);
  assert.equal(h.mediaExecutions, 0);
});

test("every Standard fallback excludes Sol even if a stale quota claims it is reserved", async () => {
  const h = harness({ sol: true, fail: 4 });
  await assert.rejects(h.runtime.generateInrAssistantReply({ ...basic, messages: [{ role: "user", content: complex }] }));
  assert.ok(h.generations.length >= 2);
  assert.ok(h.generations.every((args) => args.model !== policy.INR_ASSISTANT_MODELS.sol));
  assert.equal(h.commits.length, h.generations.length);
  assert.equal(h.finalized[0].success, false);
});

test("Sol requires server Premium, real complexity and a reservation", async () => {
  for (const [edition, content, sol, expected] of [
    ["premium", complex, true, policy.INR_ASSISTANT_MODELS.sol],
    ["premium", complex, false, policy.INR_ASSISTANT_MODELS.luna],
    ["premium", basic.messages[0].content, true, policy.INR_ASSISTANT_MODELS.qwen],
    ["standard", complex, true, policy.INR_ASSISTANT_MODELS.luna],
  ] as const) {
    const h = harness({ sol });
    await h.runtime.generateInrAssistantReply({ ...basic, edition, messages: [{ role: "user", content }] });
    assert.equal(h.generations[0].model, expected);
  }
});

test("missing production Redis or reservation failure blocks before provider spend", async () => {
  for (const options of [{ productionNoRedis: true }, { guardError: true }]) {
    const h = harness(options);
    await assert.rejects(h.runtime.generateInrAssistantReply(basic));
    assert.equal(h.generations.length, 0);
  }
});

test("reasoning is not counted twice; a failed dispatch keeps its conservative debit", async () => {
  const h = harness({ fail: 1 });
  await h.runtime.generateInrAssistantReply(basic);
  assert.equal(h.commits[0].usage.outputTokens, h.reservations[0].reservedOutputTokens);
  assert.equal(h.commits[1].usage.outputTokens, 40);
  assert.equal(h.commits[1].usage.totalTokens, 140);
  assert.equal(h.commits.length, 2);
});

test("a commit failure stops rather than spending through a provider fallback", async () => {
  const h = harness({ failCommit: true });
  await assert.rejects(h.runtime.generateInrAssistantReply(basic));
  assert.equal(h.generations.length, 1);
  assert.equal(h.finalized[0].success, false);
});

test("human support remains an explicit proposal without execution or notification", async () => {
  for (const edition of ["basic", "standard"] as const) {
    const h = harness({ handoff: true });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition, messages: [{ role: "user", content: "Je veux parler à une personne" }] });
    assert.equal(reply.needsHuman, true);
    assert.equal(reply.handoffSummary, "Blocage de connexion à vérifier.");
    assert.equal(h.generations.length, 1);
    assert.equal(h.mediaExecutions, 0);
  }
});

test("a confirmed media result ends the SDK loop without paying for a redundant summary", async () => {
  const h = harness({ media: true });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, messages: [{ role: "user", content: "Crée une image de mon atelier" }] });
  assert.equal(reply.media?.status, "completed");
  assert.equal(reply.message, "Votre média est enregistré.");
  assert.equal(h.generations.length, 1);
  assert.equal(h.mediaExecutions, 1);
  assert.equal(h.factories.length, 1);
  assert.equal(h.commits.length, 1);
});

test("the real SDK tool loop reserves and commits each LLM step separately", async () => {
  const h = harness({ followup: true });
  await h.runtime.generateInrAssistantReply({ ...basic, messages: [{ role: "user", content: "Crée une image de mon atelier" }] });
  assert.equal(h.generations.length, 2);
  assert.equal(h.reservations.length, 2);
  assert.equal(h.commits.length, 2);
  assert.equal(h.commits[0].usage.totalTokens, 140);
  assert.equal(h.commits[1].usage.totalTokens, 140);
});

test("a combined media and publication request runs three real SDK tool steps then a tool-free answer", async () => {
  const h = harness({ workflow: true });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic,
    messages: [{ role: "user", content: "Crée une image de mon atelier et publie ce visuel sur Facebook maintenant" }],
    supabase: { from: () => { throw new Error("No database access expected from synthetic tools"); } } as never,
  });
  assert.equal(reply.media?.status, "completed"); assert.equal(reply.message, "Voici la prochaine étape.");
  assert.equal(h.mediaExecutions, 1);
  assert.deepEqual(h.publicationExecutions, ["preparePublication", "executePublication"]);
  assert.equal(h.generations.length, 4); assert.equal(h.reservations.length, 4); assert.equal(h.commits.length, 4);
  assert.equal(h.generations[3].params.tools?.length ?? 0, 0);
  assert.equal(h.generations[3].params.toolChoice?.type, "none");
});

test("a failed summary preserves confirmed media and publication states without another model or repeated action", async () => {
  const h = harness({ workflow: true, failAfterPublication: true });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic,
    messages: [{ role: "user", content: "Crée une image de mon atelier et publie ce visuel sur Facebook maintenant" }],
    supabase: { from: () => { throw new Error("No database access expected from synthetic tools"); } } as never,
  });
  assert.equal(reply.media?.status, "completed");
  assert.match(reply.message, /en file d’attente/); assert.doesNotMatch(reply.message, /a été publiée/);
  assert.equal(h.generations.length, 4);
  assert.equal(h.mediaExecutions, 1); assert.deepEqual(h.publicationExecutions, ["preparePublication", "executePublication"]);
  assert.equal(reply.outcome,"processing");
  assert.equal(h.finalized[0].success, false, "Queued delivery is not a completed business task");
});

test("the real SDK emits publication activity only on execution with no added generation or fabricated publication success", async () => {
  const h = harness({ workflow: true });
  const rows: activity.InrAssistantActivity[] = [];
  await h.runtime.generateInrAssistantReply({ ...basic,
    messages: [{ role: "user", content: "Crée une image de mon atelier et publie ce visuel sur Facebook maintenant" }],
    supabase: { from: () => { throw new Error("No database access expected from synthetic tools"); } } as never,
    onActivity: row => { rows.push(row); },
  });
  assert.deepEqual(rows.map(row => [row.agent, row.status, row.label]), [
    ["publications", "running", "Préparation du brouillon de publication"],
    ["publications", "completed", "Brouillon de publication enregistré"],
    ["publications", "running", "Transmission de la publication"],
    ["publications", "completed", "Publication mise en file"],
  ]);
  assert.equal(rows[0].id, rows[1].id); assert.equal(rows[2].id, rows[3].id); assert.notEqual(rows[0].id, rows[2].id);
  assert.doesNotMatch(JSON.stringify(rows), /account-a|stored-draft|publiée|call-1/);
  assert.equal(h.generations.length, 4); assert.equal(h.reservations.length, 4); assert.equal(h.commits.length, 4);
  assert.deepEqual(h.publicationExecutions, ["preparePublication", "executePublication"]);
});

test("domain words alone and navigation do not invent collaboration", async () => {
  for (const options of [{}, { verifiedNavigation: "Ouvrez iNr’Stats." }]) {
    const h = harness(options);
    const rows: activity.InrAssistantActivity[] = [];
    await h.runtime.generateInrAssistantReply({ ...basic, messages: [{ role: "user", content: "Où se trouvent les statistiques ?" }], onActivity: row => { rows.push(row); } });
    assert.deepEqual(rows, []);
  }
});

test("complete provider context is bounded before dispatch", async () => {
  const h = harness();
  await assert.rejects(h.runtime.generateInrAssistantReply({ ...basic,
    messages: [{ role: "user", content: "界".repeat(20_000) }] }));
  assert.equal(h.generations.length, 0);
});

test("provider timeout diagnostics preserve the original fallback policy and keep the cause private", async () => {
  const providerError = Object.assign(new Error("PRIVATE provider message, https://secret.test?key=SECRET"), { name: "TimeoutError", statusCode: 504 });
  const h = harness({ providerError });
  const requestId = randomUUID();
  await assert.rejects(h.runtime.generateInrAssistantReply({ ...basic, requestId }), error => {
    assert.ok(error instanceof h.runtime.InrAssistantUnavailableError);
    assert.equal(error.diagnostic?.phase, "provider_timeout");
    assert.equal(error.diagnostic?.requestId, requestId);
    assert.equal(error.diagnostic?.statusCode, 504);
    assert.equal(Object.prototype.propertyIsEnumerable.call(error, "diagnostic"), false);
    assert.doesNotMatch(JSON.stringify(error), /provider_timeout|PRIVATE|secret.test|SECRET/);
    return true;
  });
  assert.deepEqual(h.generations.map(row => row.model), policy.getInrAssistantModelChain({ edition: "standard", complexity: "routine", solReserved: false }).map(row => row.model));
  assert.equal(h.commits.length, h.generations.length);
  const timeouts = h.diagnostics.filter(row => row.phase === "provider_timeout");
  assert.equal(timeouts.length, h.generations.length);
  assert.ok(timeouts.every(row => row.requestId === requestId && row.statusCode === 504 && typeof row.durationMs === "number"));
  assert.doesNotMatch(JSON.stringify(h.diagnostics), /PRIVATE|secret.test|SECRET|account-a|Facebook/);
  assert.equal(h.finalized[0].success, false);
});

test("a length-limited provider response is distinguished from an empty output without changing usage", async () => {
  for (const [options, phase, hasText] of [[{ outputLimit: true }, "output_limit", true], [{ emptyText: true }, "empty_output", false]] as const) {
    const h = harness(options);
    await assert.rejects(h.runtime.generateInrAssistantReply({ ...basic, requestId: randomUUID() }), error => {
      assert.ok(error instanceof h.runtime.InrAssistantUnavailableError);
      assert.equal(error.diagnostic?.phase, phase); assert.equal(error.diagnostic?.hasText, hasText); return true;
    });
    assert.ok(h.diagnostics.some(row => row.phase === "provider_completed" && row.hasText === hasText));
    assert.equal(h.diagnostics.filter(row => row.phase === phase).length, h.generations.length);
    assert.equal(h.commits.length, h.generations.length);
    assert.ok(h.commits.every(row => row.usage.totalTokens === 140));
  }
});

test("Redis commit and reservation failures are identified without a paid fallback or changed exception", async () => {
  for (const [options, phase, calls] of [[{ failCommit: true }, "redis_commit", 1], [{ guardError: true }, "redis_reserve", 0]] as const) {
    const h = harness(options);
    await assert.rejects(h.runtime.generateInrAssistantReply({ ...basic, requestId: randomUUID() }), /unavailable/);
    assert.equal(h.generations.length, calls);
    assert.ok(h.diagnostics.some(row => row.phase === phase));
    assert.doesNotMatch(JSON.stringify(h.diagnostics), /commit unavailable|guard unavailable/);
    assert.equal(h.finalized[0].success, false);
  }
});

test("an aborted request before dispatch is diagnosed and never calls a provider", async () => {
  const controller = new AbortController(); controller.abort(new Error("PRIVATE disconnected request"));
  const h = harness();
  await assert.rejects(h.runtime.generateInrAssistantReply({ ...basic, requestId: randomUUID(), signal: controller.signal }), /PRIVATE disconnected request/);
  assert.equal(h.generations.length, 0);
  assert.ok(h.diagnostics.some(row => row.phase === "request_aborted"));
  assert.doesNotMatch(JSON.stringify(h.diagnostics), /PRIVATE|disconnected/);
  assert.equal(h.finalized[0].success, false);
});

test("a browser disconnection after confirmed publication retains its factual result without repeating the action", async () => {
  const controller = new AbortController();
  const h = harness({ workflow: true, abortAfterPublication: controller });
  const result = await h.runtime.generateInrAssistantReply({ ...basic, requestId: randomUUID(), signal: controller.signal,
    messages: [{ role: "user", content: "Crée une image de mon atelier et publie ce visuel sur Facebook maintenant" }],
    supabase: { from: () => { throw new Error("No database access expected from synthetic tools"); } } as never });
  assert.equal(controller.signal.aborted, true);
  assert.match(result.message, /en file d’attente/); assert.doesNotMatch(result.message, /a été publiée/);
  assert.equal(result.media?.status, "completed");
  assert.deepEqual(h.publicationExecutions, ["preparePublication", "executePublication"]);
  assert.equal(h.mediaExecutions, 1); assert.equal(h.generations.length, 3);
  assert.ok(h.diagnostics.some(row => row.phase === "request_aborted"));
  assert.equal(result.outcome,"processing");
  assert.equal(h.finalized[0].success, false);
});


test("two mutations in one SDK step checkpoint between executors and stop on persistence failure", async()=>{
 const message="Crée deux contacts CRM : Alice et Bob.";
 const ids=["10000000-0000-4000-8000-000000000001","10000000-0000-4000-8000-000000000002"];
 const calls=ids.map((_,index)=>({tool:"manageCrmContact",input:{action:"create",instructionQuote:message,reference:`contact-${index}`,contactId:null,fields:{firstName:index?"Bob":"Alice"}}}));
 const h=harness({crmIds:ids,parallelPlan:calls});let checkpoints=0;
 const reply=await h.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:message}],onTaskCheckpoint:async()=>{checkpoints++;if(checkpoints===2)throw new Error("Synthetic result checkpoint failure");}});
 assert.equal(checkpoints,2);assert.equal(h.crmExecutions.length,1);assert.equal(h.generations.length,1);
 assert.equal(reply.outcome,"partial");assert.equal(reply.taskProgress?.completed.length,0);
});

test("signed preview remains private across turns and exact approval fulfills its original goal",async()=>{
 const reference="IA-012345ABCDEF",token="PRIVATE-SIGNED-CAPABILITY-never-in-prompt",eventId="10000000-0000-4000-8000-000000000002";
 const inputSchema=jsonSchema({type:"object",properties:{},additionalProperties:false});
 const first=harness({plan:[{tool:"previewCalendarAction"}],calendarFactory:()=>({previewCalendarAction:tool({inputSchema,execute:async()=>({ok:true,status:"preview_ready",reference,token,approvalKind:"calendar",eventId,message:`Vérifiez le déplacement puis dites Confirme ${reference}.`})})})});
 const initial="Déplace le rendez-vous de demain dans mon agenda à 15h00.";
 const reply=await first.runtime.generateInrAssistantReply({...basic,actorUserId:"actor-a",edition:"premium",supabase:{} as never,messages:[{role:"user",content:initial}]});
 assert.equal(reply.outcome,"needs_input");assert.equal(reply.taskState?.receipts[0].approvalToken,token);
 assert.doesNotMatch(JSON.stringify(first.generations),/PRIVATE-SIGNED-CAPABILITY/);
 const confirmation=`Confirme ${reference}`;
 const effective=taskPolicy.continueInrAssistantTask(confirmation,reply.taskState)!;
 assert.ok(effective);let resolved:string|null=null;
 const second=harness({plan:[{tool:"applyCalendarAction"}],calendarFactory:args=>{
  assert.equal(args.currentApprovalMessage,confirmation,"Approval must use the current turn, not the original appointment date");
  assert.match(String(args.currentUserMessage),/demain/);
  return {applyCalendarAction:tool({inputSchema,execute:async()=>{resolved=(args.resolvePreview as (ref:string)=>string|null)(reference);return {ok:true,status:"updated",action:"update",eventId,message:"Rendez-vous modifié et relu."};}})};
 }});
 const done=await second.runtime.generateInrAssistantReply({...basic,actorUserId:"actor-a",edition:"premium",supabase:{} as never,messages:[{role:"user",content:confirmation}],taskContext:reply.taskState,actionInstruction:effective});
 assert.equal(resolved,token);assert.equal(done.outcome,"completed");
 assert.ok(done.taskState?.receipts.some(receipt=>receipt.tool==="updateCalendarAppointment"&&receipt.status==="updated"));
 assert.doesNotMatch(JSON.stringify(second.generations),/PRIVATE-SIGNED-CAPABILITY/);
});

test("status checks resolve only the same recorded media job and expose no creation executor",async()=>{
 const state:taskPolicy.InrAssistantTaskState={version:1,instruction:"Crée une vidéo de mon atelier.",actionRequestId:randomUUID(),startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),outcome:"processing",requiredTools:["generateMedia"],receipts:[{tool:"generateMedia",ok:true,status:"processing",message:"Création en cours",requestId:"assistant-recorded-job"}],question:""};
 for(const matching of [false,true]) {
  const h=harness({plan:[{tool:"getMediaGeneration",input:{requestId:matching?"assistant-recorded-job":"assistant-other-job"}}],extraTools:{getMediaGeneration:tool({inputSchema:jsonSchema({type:"object",properties:{requestId:{type:"string"}},required:["requestId"]}),execute:async()=>({ok:true,status:"completed",requestId:matching?"assistant-recorded-job":"assistant-other-job",message:"Média enregistré."})})}});
  const instruction=taskPolicy.continueInrAssistantTask("Vérifie",state,Date.now(),"check_status")!;
  const result=await h.runtime.generateInrAssistantReply({...basic,supabase:{} as never,messages:[{role:"user",content:"Vérifie"}],taskContext:state,taskIntent:"check_status",actionInstruction:instruction});
  assert.equal(result.outcome,matching?"completed":"processing");assert.equal(h.mediaExecutions,0);
  assert.ok(h.generations.every(call=>!(call.params.tools??[]).some(tool=>tool.type==="function"&&tool.name==="generateMedia")));
 }
});

test("paid invoice preview stays private and its exact current approval completes only manual status", async () => {
  const reference = "IA-ABCDEF012345", token = "PRIVATE-INVOICE-STATUS-CAPABILITY";
  const inputSchema = jsonSchema({ type: "object", properties: {}, additionalProperties: false });
  const first = harness({ plan: [{ tool: "previewCommercialDocumentAction" }], documentNativeFactory: () => ({ previewCommercialDocumentAction: tool({ inputSchema, execute: async () => ({ ok: true, status: "preview_ready", reference, token, approvalKind: "commercial_document", message: `Confirme ${reference} pour marquer la facture payée, aucun encaissement.` }) }) }) });
  const initial = "Marque la facture F-42 comme payée.";
  const preview = await first.runtime.generateInrAssistantReply({ ...basic, actorUserId: "actor-a", edition: "founder", supabase: {} as never, messages: [{ role: "user", content: initial }] });
  assert.equal(preview.outcome, "needs_input"); assert.equal(preview.taskState?.receipts[0].approvalKind, "commercial_document");
  assert.equal(preview.taskState?.receipts[0].approvalToken, token); assert.doesNotMatch(JSON.stringify(first.generations), /PRIVATE-INVOICE/);
  const confirmation = `Confirme ${reference}`, effective = taskPolicy.continueInrAssistantTask(confirmation, preview.taskState)!;
  assert.ok(effective); let executions = 0;
  const next = harness({ plan: [{ tool: "applyCommercialDocumentAction" }], documentNativeFactory: args => ({ applyCommercialDocumentAction: tool({ inputSchema, execute: async () => {
    assert.equal(args.currentApprovalMessage, confirmation); assert.equal((args.resolvePreview as (value: string) => string | null)(reference), token);
    executions++; return { ok: true, status: "updated", paymentCollected: false, message: "Statut manuel payé enregistré, sans encaissement." };
  } }) }) });
  const done = await next.runtime.generateInrAssistantReply({ ...basic, actorUserId: "actor-a", edition: "founder", supabase: {} as never, messages: [{ role: "user", content: confirmation }], taskContext: preview.taskState, actionInstruction: effective });
  assert.equal(done.outcome, "completed"); assert.equal(executions, 1); assert.doesNotMatch(JSON.stringify(next.generations), /PRIVATE-INVOICE/);
});

test("navigation returns a browser request without a durable business task or resume button",async()=>{
 const target=uiCommands.getInrAssistantNavigation("crm")!;
 const h=harness({plan:[{tool:"navigateApplication"}],extraTools:{navigateApplication:tool({inputSchema:jsonSchema({type:"object",properties:{}}),execute:async()=>({ok:true,status:"navigation_requested",navigation:target,message:"Ouverture du CRM demandée."})})}});
 const reply=await h.runtime.generateInrAssistantReply({...basic,messages:[{role:"user",content:"Ouvre mon CRM."}]});
 assert.equal(reply.navigation?.destination,"crm");assert.equal(reply.outcome,"processing");assert.equal(reply.taskState,undefined);assert.equal(reply.taskProgress,undefined);
});

test("a pure natural-language navigation executes its authenticated tool once without waiting on the unavailable provider", async () => {
  for (const [message, destination] of [["Emmène-moi dans la médiathèque", "media"], ["Peux-tu m’ouvrir l’agenda ?", "calendar"], ["Ouvre le module iNr’Annuaire.", "directory"]]) {
    let opens = 0;
    const target = uiCommands.getInrAssistantNavigation(destination)!;
    const h = harness({ providerError: new Error("Synthetic unavailable provider"), noCredential: true, productionNoRedis: true, extraTools: {
      navigateApplication: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async input => {
        opens++; assert.equal((input as { destination: string }).destination, destination);
        return { ok: true, status: "navigation_requested", navigation: target, message: `Ouverture de ${target.label} demandée.` };
      } }),
    } });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, messages: [{ role: "user", content: message }] });
    assert.equal(opens, 1); assert.equal(h.generations.length, 0); assert.equal(h.reservations.length, 0);
    assert.equal(reply.navigation?.destination, destination); assert.equal(reply.outcome, "processing");
    assert.equal(reply.taskState, undefined); assert.match(reply.message, /demandée/);
    assert.equal(h.finalized.length, 0, "A free route must not manufacture paid-model success allowance");
  }
});

test("Basic full statistics page uses the real authenticated native navigation without a provider", async () => {
  const message = "Ouvre la page complète de mes statistiques.";
  let authReads = 0;
  const [editions, ads, media, mail, studio, stats, website, screenPolicy] = await Promise.all([
    import("../../lib/dashboardEdition.ts"), import("../../lib/inrAssistantAdsUiCommands.ts"), import("../../lib/inrAssistantMediaUiCommands.ts"),
    import("../../lib/inrAssistantMailLifecycle.ts"), import("../../lib/inrAssistantStudioUiCommands.ts"), import("../../lib/inrAssistantStatsUiCommands.ts"), import("../../lib/inrAssistantWebsiteUiCommands.ts"), import("../../lib/inrAssistantScreenCommandPolicy.ts"),
  ]);
  const unused = () => { throw new Error("Only native navigation is expected"); };
  const nativeUi = loadClosedModule<typeof import("../../lib/inrAssistantUiTools.ts")>("inrAssistantUiTools.ts", {
    "server-only": {}, ai: { jsonSchema, tool }, "./requireUser": { requireUser: async () => { authReads++; return { activeUserId: basic.accountId }; } },
    "./dashboardEdition.ts": editions, "./inrAssistantUiCommands.ts": uiCommands,
    "./inrAssistantBusinessFormUiCommands.ts": businessFormUiCommands,
    "./inrAssistantBusinessFormUiTools.ts": loadClosedModule("inrAssistantBusinessFormUiTools.ts", { "server-only": {}, "./requireUser": { requireUser: async () => ({ activeUserId: basic.accountId }) }, "./inrAssistantActionClause.ts": businessFormActionClauses, "./inrAssistantBusinessFormUiCommands.ts": businessFormUiCommands }),
    "./inrAssistantAdsUiCommands.ts": ads, "./inrAssistantMediaUiCommands.ts": media, "./inrAssistantMailLifecycle.ts": mail,
    "./inrAssistantStudioUiCommands.ts": studio, "./inrAssistantStatsUiCommands.ts": stats, "./inrAssistantWebsiteUiCommands.ts": website,
    "./inrAssistantScreenCommandPolicy.ts": screenPolicy, "./inrAssistantMailAttachments.ts": { resolveInrAssistantMailAttachments: unused },
    "./inrAssistantMediaUiTools.ts": { prepareInrAssistantMediaUiAction: unused }, "./inrAssistantAdsUiTools.ts": { prepareInrAssistantAdsUiAction: unused },
    "./inrAssistantStudioUiTools.ts": { prepareInrAssistantStudioUiAction: unused }, "./inrAssistantStatsUiTools.ts": { prepareInrAssistantStatsUiAction: unused },
    "./inrAssistantBadgeUiTools.ts": { prepareInrAssistantBadgeUiAction: unused }, "./inrAssistantWebsiteUiTools.ts": { prepareInrAssistantWebsiteUiAction: unused },
  });
  const tools = nativeUi.createInrAssistantUiTools({ accountId: basic.accountId, edition: "basic", currentUserMessage: message });
  const h = harness({ providerError: new Error("Provider must not be used"), noCredential: true, productionNoRedis: true, extraTools: tools });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", messages: [{ role: "user", content: message }] });
  assert.equal(authReads, 1); assert.equal(reply.navigation?.destination, "stats"); assert.equal(reply.navigation?.href, "/dashboard/stats");
  assert.equal(reply.outcome, "processing"); assert.match(reply.message, /demandée/); assert.equal(h.generations.length, 0); assert.equal(h.reservations.length, 0); assert.equal(h.budgetReservations.length, 0);
});

test("a refused or forged native navigation result remains blocked without asking a model to bypass it", async () => {
  for (const output of [
    { ok: false, status: "blocked", message: "Le compte actif doit être vérifié." },
    { ok: true, status: "navigation_requested", navigation: { ...uiCommands.getInrAssistantNavigation("crm"), href: "/api/delete" }, message: "Navigation non vérifiée." },
  ]) {
    const h = harness({ extraTools: { navigateApplication: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => output }) } });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, messages: [{ role: "user", content: "Ouvre le CRM." }] });
    assert.equal(reply.navigation, undefined); assert.equal(reply.outcome, "blocked"); assert.equal(h.generations.length, 0);
  }
});

test("an aborted pure navigation does not execute its native route or call a provider", async () => {
  const controller = new AbortController(); controller.abort(new Error("Cancelled navigation"));
  let opens = 0;
  const h = harness({ extraTools: { navigateApplication: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => { opens++; return {}; } }) } });
  await assert.rejects(h.runtime.generateInrAssistantReply({ ...basic, signal: controller.signal, messages: [{ role: "user", content: "Ouvre le CRM." }] }), /Cancelled navigation/);
  assert.equal(opens, 0); assert.equal(h.generations.length, 0); assert.equal(h.finalized.length, 0);
});

test("opening a module precedes the requested read, which resumes after its browser acknowledgement",async()=>{
 const target=uiCommands.getInrAssistantNavigation("preferences")!;
 const instruction="Ouvre les préférences de l’application et indique mes réglages de notifications actuellement enregistrés. Lis-les sans rien modifier.";
 let opens=0,reads=0;
 const extraTools={
  navigateApplication:tool({inputSchema:jsonSchema({type:"object",properties:{}}),execute:async()=>{opens++;return {ok:true,status:"navigation_requested",navigation:target,message:"Ouverture des préférences demandée."};}}),
  readToolSettings:tool({inputSchema:jsonSchema({type:"object",properties:{}}),execute:async()=>{reads++;return {ok:true,notifications:{emailEnabled:false}};}}),
 };
 const h=harness({plan:[{tool:"readToolSettings"}],extraTools,settingsTools:{readToolSettings:extraTools.readToolSettings}});
 const reply=await h.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:instruction}]});
 assert.equal(opens,1);assert.equal(reads,0);assert.equal(reply.navigation?.destination,"preferences");
 assert.equal(reply.outcome,"partial");
 const state=structuredClone(reply.taskState!);
 state.uiSteps=uiTask.bindInrAssistantUiSteps(state.uiSteps!,reply.uiActions!,{turnId:randomUUID(),createdAt:new Date().toISOString()});
 const resumed=harness({plan:[{tool:"readToolSettings"}],extraTools,settingsTools:{readToolSettings:extraTools.readToolSettings}});
 await resumed.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,taskContext:state,actionInstruction:instruction,taskIntent:"continue",browserStepResults:[{stepId:state.uiSteps![0].id,status:"applied"}],messages:[{role:"user",content:"Continuer"}]});
 assert.equal(opens,1);assert.equal(reads,1);
 assert.ok(resumed.generations.every(call=>!(call.params.tools??[]).some(tool=>tool.type==="function"&&tool.name==="navigateApplication")));
});

test("an uncertain resolved mutation stops a second parallel SDK action and cannot be resumed blindly",async()=>{
 const message="Crée deux contacts CRM : Alice et Bob.";
 const ids=["10000000-0000-4000-8000-000000000001","10000000-0000-4000-8000-000000000002"];
 const calls=ids.map((_,index)=>({tool:"manageCrmContact",input:{action:"create",instructionQuote:message,reference:`contact-${index}`,contactId:null,fields:{firstName:index?"Bob":"Alice"}}}));
 for(const crmStatus of ["unknown","saved_unconfirmed"]) {
  const h=harness({crmIds:ids,crmStatus,parallelPlan:calls});let checkpoints=0;
  const result=await h.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:message}],onTaskCheckpoint:async()=>{checkpoints++;}});
  assert.equal(h.crmExecutions.length,1);assert.equal(checkpoints,2);assert.equal(h.generations.length,1);assert.equal(result.outcome,"blocked");
  assert.equal(taskPolicy.continueInrAssistantTask("Continue",result.taskState,Date.now(),"continue"),null);
 }
});

test("monthly assistant budget denial stops before the first paid call and does not try a fallback", async () => {
  for (const budgetFailure of ["limit", "unavailable"] as const) {
    const h = harness({ budgetFailure });
    await assert.rejects(h.runtime.generateInrAssistantReply(basic), { code: budgetFailure === "limit" ? "assistant_monthly_budget_reached" : "assistant_budget_unavailable" });
    assert.equal(h.budgetReservations.length, 1); assert.equal(h.generations.length, 0);
    assert.equal(h.reservations.length, 0); assert.equal(h.budgetFinalizations.length, 0);
  }
});

test("a fallback needs its own monthly budget reservation and a failed provider call retains its full cost", async () => {
  const h = harness({ fail: 1, budgetFailure: "limit", budgetFailureAt: 2 });
  await assert.rejects(h.runtime.generateInrAssistantReply(basic), { code: "assistant_monthly_budget_reached" });
  assert.equal(h.generations.length, 1); assert.equal(h.budgetReservations.length, 2);
  assert.equal(h.budgetFinalizations.length, 1); assert.equal(h.budgetFinalizations[0].actualCostMicroUsd, undefined);
  assert.equal(h.commits.length, 1);
});

test("missing or invalid provider usage cannot refund the monthly assistant budget estimate", async () => {
  for (const reportedUsage of [{ input: undefined, output: 10 }, { input: -1, output: 40 }, { input: 100, output: -1 }, { input: 10.5, output: 40 }]) {
    const h = harness({ reportedUsage }); await h.runtime.generateInrAssistantReply(basic);
    assert.equal(h.generations.length, 1); assert.equal(h.budgetFinalizations.length, 1);
    assert.equal(h.budgetFinalizations[0].actualCostMicroUsd, undefined);
  }
  const valid = harness(); await valid.runtime.generateInrAssistantReply(basic);
  assert.ok(Number.isSafeInteger(valid.budgetFinalizations[0].actualCostMicroUsd));
  assert.ok(valid.budgetFinalizations[0].actualCostMicroUsd! > 0);
});

test("attested all-inclusive gatewayCost settles both guards and telemetry, preserving zero and rejecting malformed costs", async () => {
  for (const [reportedGatewayCost, expected] of [["0.000646075", 647], [0, 0], ["0.000000", 0]] as const) {
    const h = harness({ reportedGatewayCost });
    await h.runtime.generateInrAssistantReply(basic);
    assert.equal(h.generations.length, 1);
    assert.equal(h.budgetFinalizations[0].actualCostMicroUsd, expected);
    assert.equal(h.commits[0].actualCostMicroUsd, expected);
    assert.equal(h.operationCalls[0].costMicroUsd, expected);
    assert.ok(h.reservations[0].estimatedCostMicroUsd >= 500, "Upfront estimates retain the reporting-fee margin");
  }
  const unknownUsage = harness({ reportedGatewayCost: "0.000646075", reportedUsage: { input: undefined, output: undefined } });
  await unknownUsage.runtime.generateInrAssistantReply(basic);
  assert.equal(unknownUsage.budgetFinalizations[0].actualCostMicroUsd, 647, "An attested charge remains authoritative when token usage is unknown");
  assert.equal(unknownUsage.operationCalls[0].usageEstimated, true);
  for (const reportedGatewayCost of ["NaN", " ", null, -1]) {
    const h = harness({ reportedGatewayCost });
    await h.runtime.generateInrAssistantReply(basic);
    assert.ok(h.budgetFinalizations[0].actualCostMicroUsd! > 0, "Malformed costs must retain conservative nonzero accounting");
    assert.equal(h.budgetFinalizations[0].actualCostMicroUsd, h.commits[0].actualCostMicroUsd);
  }
});

test("only an unsent provider call releases budget and a budget commit failure prevents tool execution", async () => {
  const notSent = harness({ guardError: true });
  await assert.rejects(notSent.runtime.generateInrAssistantReply(basic), /guard unavailable/);
  assert.equal(notSent.generations.length, 0); assert.equal(notSent.budgetFinalizations[0].actualCostMicroUsd, 0);
  const failedCommit = harness({ media: true, budgetCommitFailure: true });
  await assert.rejects(failedCommit.runtime.generateInrAssistantReply({ ...basic, messages: [{ role: "user", content: "Génère une image de mon atelier." }] }), { code: "assistant_budget_unavailable" });
  assert.equal(failedCommit.generations.length, 1); assert.equal(failedCommit.mediaExecutions, 0);
});

const importAttachmentIds = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
const importedMediaIds = ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"];
function importFixture() {
  const writes: string[] = [], calls: string[] = [];
  const factory = () => ({ importMediaAttachment: tool({ inputSchema: jsonSchema<{ attachmentId: string }>({ type: "object", properties: { attachmentId: { type: "string" } }, required: ["attachmentId"] }), execute: async ({ attachmentId }) => {
    assert.ok(importAttachmentIds.includes(attachmentId)); calls.push(attachmentId);
    const existed = writes.includes(attachmentId); if (!existed) writes.push(attachmentId);
    return { ok: true, status: existed ? "already_processed" : "imported", id: importedMediaIds[importAttachmentIds.indexOf(attachmentId)], message: existed ? "Image déjà importée." : "Image importée." };
  } }) });
  return { writes, calls, factory };
}
const importPlan = importAttachmentIds.map(attachmentId => ({ tool: "importMediaAttachment", input: { attachmentId } }));
const twoImportAttachments = importAttachmentIds.map((id, index) => ({ id, name: `photo-${index + 1}.png`, kind: "image" as const, size: 10 }));

test("two attachment imports require two distinct saved media receipts before the task completes", async () => {
  for (const message of ["Importe ces deux images dans ma médiathèque.", "Importe toutes les images jointes dans ma médiathèque."]) {
    const fixture = importFixture(), h = harness({ mediaLibraryFactory: fixture.factory, plan: importPlan });
    const result = await h.runtime.generateInrAssistantReply({ ...basic, actorUserId: importAttachmentIds[0], edition: "basic", supabase: {} as never, mediaAttachments: twoImportAttachments, messages: [{ role: "user", content: message }] });
    assert.equal(result.outcome, "completed"); assert.deepEqual(fixture.writes, importAttachmentIds);
    assert.equal(result.taskState?.requiredCalls?.importMediaAttachment, 2);
    assert.deepEqual(new Set(result.taskState?.receipts.map(receipt => receipt.id)), new Set(importedMediaIds));
    assert.equal(toolNames(h.generations[1].params).includes("importMediaAttachment"), true, "one saved attachment must not remove the second import");
  }
});

test("repeated receipts for one imported attachment stay partial and a resumed task reconciles it without another upload", async () => {
  const message = "Importe ces deux images dans ma médiathèque.", fixture = importFixture();
  const args = { ...basic, actorUserId: importAttachmentIds[0], supabase: {} as never, mediaAttachments: twoImportAttachments };
  const first = harness({ mediaLibraryFactory: fixture.factory, plan: [importPlan[0], importPlan[0]] });
  const partial = await first.runtime.generateInrAssistantReply({ ...args, messages: [{ role: "user", content: message }] });
  assert.equal(partial.outcome, "partial"); assert.ok(partial.taskState); assert.deepEqual(fixture.writes, [importAttachmentIds[0]]);
  const continuation = taskPolicy.continueInrAssistantTask("Continue", partial.taskState, Date.now(), "continue"); assert.ok(continuation);
  const second = harness({ mediaLibraryFactory: fixture.factory, plan: importPlan });
  const completed = await second.runtime.generateInrAssistantReply({ ...args, actionInstruction: continuation, taskContext: partial.taskState, messages: [{ role: "user", content: "Continue" }] });
  assert.equal(completed.outcome, "completed"); assert.deepEqual(fixture.writes, importAttachmentIds);
  assert.deepEqual(fixture.calls, [importAttachmentIds[0], importAttachmentIds[0], importAttachmentIds[0], importAttachmentIds[1]]);
  assert.deepEqual(new Set(completed.taskState?.receipts.map(receipt => receipt.id)), new Set(importedMediaIds));
});

test("a Google submission without confirmed readback stops later mutations and cannot be resumed", async () => {
  for (const status of ["submitted_unconfirmed", "save_unconfirmed"]) {
    const calls: string[] = [], definition = (name: string, output: Record<string, unknown>) => tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => { calls.push(name); return output; } });
    const h = harness({ parallelPlan: [{ tool: "applyGoogleBusinessProfileUpdate" }, { tool: "setNativeChannelActivation" }], channelActionFactory: () => ({
      applyGoogleBusinessProfileUpdate: definition("google", { ok: false, status, message: "Modification envoyée à Google mais non confirmée." }),
      setNativeChannelActivation: definition("activation", { ok: true, status: "saved", message: "Canal désactivé." }),
    }) });
    const result = await h.runtime.generateInrAssistantReply({ ...basic, actorUserId: importAttachmentIds[0], supabase: {} as never, messages: [{ role: "user", content: "Modifie la description de ma fiche Google Business puis désactive mon annuaire." }], onTaskCheckpoint: async () => {} });
    assert.deepEqual(calls, ["google"]); assert.equal(result.outcome, "blocked"); assert.equal(h.generations.length, 1);
    assert.ok(result.taskState?.receipts.some(receipt => receipt.status === status));
    assert.equal(taskPolicy.continueInrAssistantTask("Continue", result.taskState, Date.now(), "continue"), null);
    const resumed = harness();
    const refused = await resumed.runtime.generateInrAssistantReply({ ...basic, taskContext: result.taskState, actionInstruction: result.taskState!.instruction, messages: [{ role: "user", content: "Continue" }] });
    assert.equal(refused.outcome, "blocked"); assert.equal(resumed.generations.length, 0);
  }
});

test("a compound statistics refresh then PDF download retains and executes both requested actions", async () => {
  const message = "Actualise mes statistiques puis télécharge mon rapport PDF de statistiques.", calls: string[] = [];
  assert.deepEqual(taskPolicy.inrAssistantRequiredTools(message), ["refreshStatsSources", "prepareStatsReportDownload"]);
  assert.deepEqual(taskPolicy.inrAssistantRequiredTools("Désactive mon annuaire et actualise mes statistiques."), ["setNativeChannelActivation", "refreshStatsSources"]);
  assert.deepEqual(taskPolicy.inrAssistantRequiredTools("Importe cette image dans ma médiathèque puis télécharge cette image."), ["importMediaAttachment", "prepareMediaDownload"]);
  const h = harness({ plan: [{ tool: "refreshStatsSources" }, { tool: "prepareStatsReportDownload" }], statsFactory: () => ({
    refreshStatsSources: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => { calls.push("refresh"); return { ok: true, status: "refreshed", message: "Statistiques actualisées." }; } }),
    prepareStatsReportDownload: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => { calls.push("download"); return { ok: true, status: "ui_action_requested", message: "Téléchargement demandé au navigateur.", uiCommand: { command: "download_stats_report", reportId: importedMediaIds[0], selection: { kind: "stats_report", id: importedMediaIds[0] } } }; } }),
  }) });
  const result = await h.runtime.generateInrAssistantReply({ ...basic, actorUserId: importAttachmentIds[0], supabase: {} as never, messages: [{ role: "user", content: message }] });
  assert.deepEqual(calls, ["refresh", "download"]); assert.equal(result.uiCommand?.command, "download_stats_report");
  assert.equal(result.outcome, "processing", "requesting a download is not proof of its reception");
  assert.deepEqual([...(result.taskState?.requiredTools ?? [])], ["refreshStatsSources", "prepareStatsReportDownload"]);
});

const uiBarrierScreen = { pathname: "/dashboard/ads", tool: "Ads", selection: { kind: "campaign" as const, id: "draft_1" }, revision: "rev_1", availableCommands: ["configure_ads_draft" as const] };
const uiBarrierClause = "Renomme cette campagne publicitaire en Promotion été";
const uiBarrierCommand = { command: "configure_ads_draft" as const, selection: uiBarrierScreen.selection, revision: uiBarrierScreen.revision, patch: { name: "Promotion été" } };
function uiBarrierFixture(onExecute = () => {}) {
  return { runScreenCommand: tool({ inputSchema: jsonSchema<{ command: string; instructionQuote: string }>({ type: "object", properties: { command: { type: "string" }, instructionQuote: { type: "string" } }, required: ["command", "instructionQuote"] }), execute: async () => { onExecute(); return { ok: true, status: "ui_action_requested", message: "Modification du formulaire demandée.", uiCommand: uiBarrierCommand }; } }) };
}
const uiBarrierCall = { tool: "runScreenCommand", input: { command: "configure_ads_draft", instructionQuote: uiBarrierClause } };

const statsLiveScreen = { pathname: "/dashboard/stats", tool: "iNr’Stats", selection: { kind: "stats" as const, id: "stats" }, revision: "stats_live_1", availableCommands: ["configure_stats_view" as const] };
function statsScreenFixture(message: string, onExecute: () => void, screen = statsLiveScreen) {
  const native = loadClosedModule<typeof import("../../lib/inrAssistantStatsUiTools.ts")>("inrAssistantStatsUiTools.ts", {
    "server-only": {}, "./requireUser": { requireUser: async () => ({ activeUserId: basic.accountId }) }, "./inrAssistantStatsUiCommands.ts": statsUiCommands,
  });
  return { runScreenCommand: tool({ inputSchema: jsonSchema<{ command: string; instructionQuote: string; patch: Record<string, unknown> }>({ type: "object", properties: { command: { type: "string" }, instructionQuote: { type: "string" }, patch: { type: "object" } }, required: ["command", "instructionQuote", "patch"] }), execute: async input => {
    onExecute(); return native.prepareInrAssistantStatsUiAction(input, { accountId: basic.accountId, currentUserMessage: message, clientContext: { source: "untrusted_client", screen } });
  } }) };
}
function statsLlmContinuation(instruction: string) {
  const clientContext = { source: "untrusted_client" as const, screen: statsLiveScreen };
  return { clientContext, actionInstruction: instruction, taskIntent: "continue" as const,
    taskContext: { version: 1 as const, instruction, actionRequestId: basic.requestId, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), outcome: "partial" as const, requiredTools: [], receipts: [], question: "Reprendre l’étape d’écran demandée.", uiSteps: uiTask.inrAssistantUiSteps(instruction, clientContext) },
    messages: [{ role: "user" as const, content: "Continuer" }] };
}
async function authenticatedStatsScreenFixture(message: string, onAuth: () => void, activeUserId = basic.accountId, screen = statsLiveScreen) {
  const [editions, ads, media, mail, studio, website, screenPolicy] = await Promise.all([
    import("../../lib/dashboardEdition.ts"), import("../../lib/inrAssistantAdsUiCommands.ts"), import("../../lib/inrAssistantMediaUiCommands.ts"),
    import("../../lib/inrAssistantMailLifecycle.ts"), import("../../lib/inrAssistantStudioUiCommands.ts"), import("../../lib/inrAssistantWebsiteUiCommands.ts"), import("../../lib/inrAssistantScreenCommandPolicy.ts"),
  ]);
  const requireUser = async () => { onAuth(); return { activeUserId }; }, unused = () => { throw new Error("Only the native Stats view command is expected"); };
  const nativeStats = loadClosedModule<typeof import("../../lib/inrAssistantStatsUiTools.ts")>("inrAssistantStatsUiTools.ts", { "server-only": {}, "./requireUser": { requireUser }, "./inrAssistantStatsUiCommands.ts": statsUiCommands });
  const nativeUi = loadClosedModule<typeof import("../../lib/inrAssistantUiTools.ts")>("inrAssistantUiTools.ts", {
    "server-only": {}, ai: { jsonSchema, tool }, "./requireUser": { requireUser }, "./dashboardEdition.ts": editions, "./inrAssistantUiCommands.ts": uiCommands,
    "./inrAssistantBusinessFormUiCommands.ts": businessFormUiCommands,
    "./inrAssistantBusinessFormUiTools.ts": loadClosedModule("inrAssistantBusinessFormUiTools.ts", { "server-only": {}, "./requireUser": { requireUser }, "./inrAssistantActionClause.ts": businessFormActionClauses, "./inrAssistantBusinessFormUiCommands.ts": businessFormUiCommands }),
    "./inrAssistantAdsUiCommands.ts": ads, "./inrAssistantMediaUiCommands.ts": media, "./inrAssistantMailLifecycle.ts": mail,
    "./inrAssistantStudioUiCommands.ts": studio, "./inrAssistantStatsUiCommands.ts": statsUiCommands, "./inrAssistantWebsiteUiCommands.ts": website,
    "./inrAssistantScreenCommandPolicy.ts": screenPolicy, "./inrAssistantMailAttachments.ts": { resolveInrAssistantMailAttachments: unused },
    "./inrAssistantMediaUiTools.ts": { prepareInrAssistantMediaUiAction: unused }, "./inrAssistantAdsUiTools.ts": { prepareInrAssistantAdsUiAction: unused },
    "./inrAssistantStudioUiTools.ts": { prepareInrAssistantStudioUiAction: async () => null }, "./inrAssistantStatsUiTools.ts": nativeStats,
    "./inrAssistantBadgeUiTools.ts": { prepareInrAssistantBadgeUiAction: async () => null }, "./inrAssistantWebsiteUiTools.ts": { prepareInrAssistantWebsiteUiAction: async () => null },
  });
  return nativeUi.createInrAssistantUiTools({ accountId: basic.accountId, edition: "basic", currentUserMessage: message, clientContext: { source: "untrusted_client", screen } });
}
test("Basic native Stats Globale and Evolution buttons use the authenticated screen tool without provider or quota", async () => {
  for (const [view, panel] of [["Globale", "all"], ["Évolution", "evolution"]] as const) {
    const message = `Affiche la vue ${view} des statistiques.`;
    let authReads = 0;
    const h = harness({ providerError: new Error("Provider must not be used"), noCredential: true, productionNoRedis: true, extraTools: await authenticatedStatsScreenFixture(message, () => authReads++) });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: statsLiveScreen }, messages: [{ role: "user", content: message }] });
    assert.equal(authReads, 1); assert.equal(reply.uiCommand?.command, "configure_stats_view"); assert.deepEqual(JSON.parse(JSON.stringify(reply.uiCommand)), { command: "configure_stats_view", selection: statsLiveScreen.selection, revision: statsLiveScreen.revision, patch: { panel } });
    assert.equal(reply.outcome, "processing"); assert.equal(reply.taskState, undefined); assert.match(reply.message, /demand|transmis/); assert.doesNotMatch(reply.message, /vue (?:appliquée|modifiée)|succès/);
    assert.equal(h.generations.length, 0); assert.equal(h.quotaReservations.length, 0); assert.equal(h.reservations.length, 0); assert.equal(h.budgetReservations.length, 0); assert.equal(h.finalized.length, 0);
  }
});
test("Basic native Stats rejects forged results and native account refusal without provider fallback", async () => {
  const message = "Affiche la vue Évolution des statistiques.", valid = { command: "configure_stats_view", selection: statsLiveScreen.selection, revision: statsLiveScreen.revision, patch: { panel: "evolution" } };
  for (const output of [
    { ok: false, status: "blocked", message: "Le compte actif doit être vérifié." },
    { ok: true, status: "ui_action_requested", uiCommand: { ...valid, command: "configure_image_retouch" } },
    { ok: true, status: "ui_action_requested", uiCommand: { ...valid, selection: { kind: "stats", id: "other-stats" } } },
    { ok: true, status: "ui_action_requested", uiCommand: { ...valid, revision: "stats_other_revision" } },
    { ok: true, status: "ui_action_requested", uiCommand: { ...valid, patch: { panel: "all" } } },
    { ok: true, status: "ui_action_requested", uiCommand: { ...valid, patch: { panel: "evolution", metric: "clicks" } } },
  ]) {
    const h = harness({ providerError: new Error("Provider must not bypass the native result"), noCredential: true, productionNoRedis: true, extraTools: { runScreenCommand: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => output }) } });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: statsLiveScreen }, messages: [{ role: "user", content: message }] });
    assert.equal(reply.outcome, "blocked", JSON.stringify(output)); assert.equal(reply.uiCommand, undefined); assert.equal(reply.uiActions, undefined); assert.equal(h.generations.length, 0); assert.equal(h.quotaReservations.length, 0); assert.equal(h.reservations.length, 0); assert.equal(h.budgetReservations.length, 0);
  }
  let authReads = 0;
  const h = harness({ noCredential: true, productionNoRedis: true, extraTools: await authenticatedStatsScreenFixture(message, () => authReads++, "another-account") });
  const refused = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: statsLiveScreen }, messages: [{ role: "user", content: message }] });
  assert.equal(authReads, 1); assert.equal(refused.outcome, "blocked"); assert.equal(refused.uiCommand, undefined); assert.equal(h.generations.length, 0); assert.equal(h.quotaReservations.length, 0);
});
const nativeStatsSequenceInstruction = "Affiche la vue Globale des statistiques puis affiche la vue Évolution des statistiques.";
function assertNoStatsProviderOrQuota(h: ReturnType<typeof harness>) {
  assert.deepEqual([h.generations.length, h.quotaReservations.length, h.reservations.length, h.budgetReservations.length, h.finalized.length], [0, 0, 0, 0, 0]);
}
async function startNativeStatsSequence() {
  let authReads = 0;
  const h = harness({ noCredential: true, productionNoRedis: true, extraTools: await authenticatedStatsScreenFixture(nativeStatsSequenceInstruction, () => authReads++) });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: statsLiveScreen }, messages: [{ role: "user", content: nativeStatsSequenceInstruction }] });
  assert.equal(authReads, 1); assertNoStatsProviderOrQuota(h); assert.equal(reply.outcome, "partial"); assert.ok(reply.uiCommand?.command === "configure_stats_view"); assert.equal(reply.uiCommand.patch.panel, "all"); assert.equal(reply.uiActions?.length, 1);
  const state = structuredClone(reply.taskState!); assert.equal(state.uiSteps?.length, 2); assert.equal(state.uiSteps?.[0].actions?.length, 1); assert.equal(state.uiSteps?.[1].actions, undefined);
  state.uiSteps = uiTask.bindInrAssistantUiSteps(state.uiSteps!, reply.uiActions!, { turnId: randomUUID(), createdAt: new Date().toISOString() });
  return state;
}
test("Basic ordered native Stats views wait for each scoped ACK and complete after the second without model or quota", async () => {
  const state = await startNativeStatsSequence(), nextScreen = { ...statsLiveScreen, revision: "stats_sequence_2" };
  let noAckExecutions = 0;
  const waiting = harness({ noCredential: true, productionNoRedis: true, extraTools: await authenticatedStatsScreenFixture(nativeStatsSequenceInstruction, () => noAckExecutions++) });
  const pending = await waiting.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: statsLiveScreen }, taskContext: structuredClone(state), actionInstruction: nativeStatsSequenceInstruction, taskIntent: "continue", messages: [{ role: "user", content: "Continuer" }] });
  assert.equal(noAckExecutions, 0); assert.equal(pending.uiCommand, undefined); assert.equal(pending.uiActions?.length ?? 0, 0); assert.equal(pending.outcome, "partial"); assertNoStatsProviderOrQuota(waiting);
  const firstAck = { stepId: state.uiSteps![0].id, status: "applied" as const, postScreen: { pathname: nextScreen.pathname, selection: nextScreen.selection, revision: nextScreen.revision } };
  let secondExecutions = 0;
  const resumed = harness({ noCredential: true, productionNoRedis: true, extraTools: await authenticatedStatsScreenFixture(nativeStatsSequenceInstruction, () => secondExecutions++, basic.accountId, nextScreen) });
  const second = await resumed.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: nextScreen }, taskContext: structuredClone(state), actionInstruction: nativeStatsSequenceInstruction, taskIntent: "continue", browserStepResults: [firstAck], messages: [{ role: "user", content: "Continuer" }] });
  assert.equal(secondExecutions, 1); assert.equal(second.outcome, "partial"); assert.ok(second.uiCommand?.command === "configure_stats_view"); assert.equal(second.uiCommand.patch.panel, "evolution"); assert.equal(second.uiCommand.revision, nextScreen.revision); assert.equal(second.uiActions?.length, 1); assertNoStatsProviderOrQuota(resumed);
  const secondState = structuredClone(second.taskState!); secondState.uiSteps = uiTask.bindInrAssistantUiSteps(secondState.uiSteps!, second.uiActions!, { turnId: randomUUID(), createdAt: new Date().toISOString() });
  const finalScreen = { ...nextScreen, revision: "stats_sequence_3" };
  let finalExecutions = 0;
  const finished = harness({ noCredential: true, productionNoRedis: true, extraTools: await authenticatedStatsScreenFixture(nativeStatsSequenceInstruction, () => finalExecutions++, basic.accountId, finalScreen) });
  const final = await finished.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: finalScreen }, taskContext: secondState, actionInstruction: nativeStatsSequenceInstruction, taskIntent: "continue", browserStepResults: [firstAck, { stepId: secondState.uiSteps![1].id, status: "applied", postScreen: { pathname: finalScreen.pathname, selection: finalScreen.selection, revision: finalScreen.revision } }], messages: [{ role: "user", content: "Continuer" }] });
  assert.equal(finalExecutions, 0); assert.equal(final.outcome, "completed"); assert.equal(final.uiCommand, undefined); assert.equal(final.uiActions?.length ?? 0, 0); assertNoStatsProviderOrQuota(finished);
});
test("Basic ordered native Stats refuses a mismatched screen scope or revision and an unbound acknowledgement", async () => {
  const state = await startNativeStatsSequence(), nextScreen = { ...statsLiveScreen, revision: "stats_sequence_2" };
  for (const mismatch of ["selection", "revision", "source"] as const) {
    const resumedState = structuredClone(state); if (mismatch === "source") delete resumedState.uiSteps![0].source;
    let executions = 0;
    const h = harness({ noCredential: true, productionNoRedis: true, extraTools: await authenticatedStatsScreenFixture(nativeStatsSequenceInstruction, () => executions++, basic.accountId, nextScreen) });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: nextScreen }, taskContext: resumedState, actionInstruction: nativeStatsSequenceInstruction, taskIntent: "continue", browserStepResults: [{ stepId: state.uiSteps![0].id, status: "applied", postScreen: { pathname: nextScreen.pathname, selection: mismatch === "selection" ? { kind: "stats", id: "other-stats" } : nextScreen.selection, revision: mismatch === "revision" ? "stats_manual_intervening_revision" : nextScreen.revision } }], messages: [{ role: "user", content: "Continuer" }] });
    assert.equal(executions, 0, mismatch); assert.equal(reply.outcome, "blocked", mismatch); assert.equal(reply.uiCommand, undefined); assert.equal(reply.uiActions?.length ?? 0, 0); assertNoStatsProviderOrQuota(h);
  }
});
test("Basic ordered native Stats status checks never emit the next command even with a verified preceding ACK", async () => {
  const state = await startNativeStatsSequence(), nextScreen = { ...statsLiveScreen, revision: "stats_sequence_2" };
  let executions = 0;
  const h = harness({ noCredential: true, productionNoRedis: true, extraTools: await authenticatedStatsScreenFixture(nativeStatsSequenceInstruction, () => executions++, basic.accountId, nextScreen) });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: nextScreen }, taskContext: state, actionInstruction: nativeStatsSequenceInstruction, taskIntent: "check_status", browserStepResults: [{ stepId: state.uiSteps![0].id, status: "applied", postScreen: { pathname: nextScreen.pathname, selection: nextScreen.selection, revision: nextScreen.revision } }], messages: [{ role: "user", content: "Où en est cette demande ?" }] });
  assert.equal(executions, 0); assert.equal(reply.uiCommand, undefined); assert.equal(reply.uiActions?.length ?? 0, 0); assert.notEqual(reply.outcome, "completed"); assertNoStatsProviderOrQuota(h);
});
test("Stats evolution native screen accepts the complete instruction and its unique valid action-object fragment", async () => {
  const instruction = "Affiche la vue Évolution des statistiques.";
  const actual = uiTask.inrAssistantUiSteps(instruction, { source: "untrusted_client", screen: statsLiveScreen }); assert.equal(actual.length, 1); assert.equal(actual[0].command, "configure_stats_view");
  for (const instructionQuote of [instruction, "Affiche la vue Évolution"]) {
    let executed = 0;
    const h = harness({ extraTools: { ...statsScreenFixture(instruction, () => executed++), navigateApplication: tool({ inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }), execute: async (): Promise<{ ok: false; status: "blocked"; message: string }> => { throw new Error("A Stats view change must never navigate"); } }) }, plan: [{ tool: "runScreenCommand", input: { command: "configure_stats_view", instructionQuote, patch: { panel: "evolution" } } }] });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", ...statsLlmContinuation(instruction) });
    assert.equal(executed, 1, instructionQuote); assert.equal(reply.uiActions?.length, 1, instructionQuote); assert.equal(reply.uiCommand?.command, "configure_stats_view"); assert.equal(reply.taskState?.uiSteps?.[0].actions?.length, 1); assert.equal(reply.outcome, "partial", "the native browser ACK is still required");
    assert.ok(toolNames(h.generations[0].params).includes("runScreenCommand")); assert.equal(toolNames(h.generations[0].params).includes("navigateApplication"), false, "a lexical navigation verb must not add an unplanned route");
    const guidance = h.generations[0].params.prompt.filter(message => message.role === "system").map(message => message.content).join("\n").split("\n").find(line => line.startsWith("Parcours UI prévu"));
    assert.ok(guidance); assert.match(guidance, /dans l’ordre : configure_stats_view\./); assert.match(guidance, /instructionQuote = extrait exact.*verbe et objet/); assert.doesNotMatch(guidance, /stats_live_1|ui_0|\/dashboard/);
  }
});
test("Stats evolution composed navigation resumes only its native view command after the verified browser transition", async () => {
  const instruction = "Ouvre la page complète de mes statistiques puis affiche la vue Évolution des statistiques.", target = uiCommands.getInrAssistantNavigation("stats")!;
  let opens = 0, changes = 0;
  const navigateApplication = tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => { opens++; return { ok: true, status: "navigation_requested", navigation: target, message: "Ouverture des statistiques demandée." }; } });
  const first = harness({ extraTools: { navigateApplication, ...statsScreenFixture(instruction, () => changes++) }, plan: [{ tool: "navigateApplication", input: { destination: "stats", instructionQuote: "Ouvre la page complète de mes statistiques" } }, { tool: "runScreenCommand", input: { command: "configure_stats_view", instructionQuote: "affiche la vue Évolution des statistiques", patch: { panel: "evolution" } } }] });
  const initial = await first.runtime.generateInrAssistantReply({ ...basic, edition: "basic", messages: [{ role: "user", content: instruction }] });
  assert.equal(opens, 1); assert.equal(changes, 0); assert.equal(initial.navigation?.destination, "stats"); assert.equal(initial.taskState?.uiSteps?.length, 2); assert.equal(initial.taskState?.uiSteps?.[0].command, "navigateApplication"); assert.equal(initial.taskState?.uiSteps?.[1].command, "configure_stats_view");
  const state = structuredClone(initial.taskState!); state.uiSteps = uiTask.bindInrAssistantUiSteps(state.uiSteps!, initial.uiActions!, { turnId: randomUUID(), createdAt: new Date().toISOString() });
  const resumed = harness({ extraTools: { navigateApplication, ...statsScreenFixture(instruction, () => changes++) }, plan: [{ tool: "runScreenCommand", input: { command: "configure_stats_view", instructionQuote: "affiche la vue Évolution", patch: { panel: "evolution" } } }] });
  const reply = await resumed.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: statsLiveScreen }, taskContext: state, actionInstruction: instruction, taskIntent: "continue", browserStepResults: [{ stepId: state.uiSteps![0].id, status: "applied", postScreen: { pathname: statsLiveScreen.pathname, selection: statsLiveScreen.selection, revision: statsLiveScreen.revision } }], messages: [{ role: "user", content: "Continuer" }] });
  assert.equal(opens, 1); assert.equal(changes, 1); assert.equal(reply.uiCommand?.command, "configure_stats_view"); assert.ok(toolNames(resumed.generations[0].params).includes("runScreenCommand")); assert.equal(toolNames(resumed.generations[0].params).includes("navigateApplication"), false);
});
test("Stats evolution UI refusals identify public command, quote, queue and order failures without leaking scope", async () => {
  const one = "Affiche la vue Évolution des statistiques", call = (instructionQuote: string, command = "configure_stats_view") => ({ tool: "runScreenCommand", input: { command, instructionQuote, patch: { panel: "evolution" } } });
  for (const [instruction, calls, reason, executions] of [
    [one, [call(one, "configure_video_retouch")], "ui_command_mismatch", 0],
    [one, [call("la vue Évolution")], "ui_quote_unmatched", 0],
    [one, [call("Affiche")], "ui_quote_unmatched", 0],
    [`${one} puis affiche la vue Évolution mensuelle de Google Business.`, [call("Affiche la vue Évolution")], "ui_quote_ambiguous", 0],
    [`Affiche les clics des statistiques puis ${one.toLowerCase()}.`, [call(one)], "ui_waiting_prior_step", 0],
    [one, [call(one), call(one)], "ui_step_already_queued", 1],
  ] as const) {
    let executed = 0;
    const h = harness({ extraTools: statsScreenFixture(instruction, () => executed++), parallelPlan: [...calls] });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", ...statsLlmContinuation(instruction) });
    assert.equal(executed, executions, reason); assert.equal(reply.uiActions?.length ?? 0, executions, reason);
    const outputs = h.generations.flatMap(generation => generation.params.prompt.flatMap(message => message.role === "tool" ? message.content : [])).flatMap(part => part.type === "tool-result" && part.toolName === "runScreenCommand" && part.output.type === "json" ? [part.output.value as Record<string, unknown>] : []);
    const refusal = outputs.find(output => output.reason === reason); assert.ok(refusal, `${reason}: ${JSON.stringify(outputs)}`); assert.equal(refusal.ok, false); assert.equal(refusal.status, "deferred"); assert.deepEqual(JSON.parse(JSON.stringify(refusal.expectedCommands)), executions ? [] : ["configure_stats_view"]);
    assert.doesNotMatch(JSON.stringify(refusal), /stats_live_1|ui_0|account-a|\/dashboard|selection|instructionQuote/);
    if (["ui_quote_unmatched", "ui_command_mismatch"].includes(reason)) assert.doesNotMatch(String(refusal.message), /déjà transmise/);
  }
});
test("Stats evolution quotes retain their verb, object, command and unique clause, including coordinated requests", async () => {
  const one = "Affiche la vue Évolution des statistiques.";
  const coordinated = "Affiche la vue Évolution des statistiques puis affiche la vue Évolution mensuelle de Google Business.";
  for (const [instruction, instructionQuote, command] of [
    [one, "Affiche", "configure_stats_view"], [one, "la vue Évolution", "configure_stats_view"], [one, "Affiche les statistiques", "configure_stats_view"],
    [one, "Affiche la vue Évolution", "configure_video_retouch"], [coordinated, "Affiche la vue Évolution", "configure_stats_view"],
  ]) {
    let executed = 0;
    const h = harness({ extraTools: statsScreenFixture(instruction, () => executed++), plan: [{ tool: "runScreenCommand", input: { command, instructionQuote, patch: { panel: "evolution" } } }] });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", ...statsLlmContinuation(instruction) });
    assert.equal(executed, 0, instructionQuote); assert.equal(reply.uiActions?.length ?? 0, 0, instructionQuote);
  }
  const exactFirst = "Affiche la vue Évolution puis affiche la vue Évolution des statistiques.";
  let executed = 0;
  const h = harness({ extraTools: statsScreenFixture(exactFirst, () => executed++), plan: [{ tool: "runScreenCommand", input: { command: "configure_stats_view", instructionQuote: "Affiche la vue Évolution", patch: { panel: "evolution" } } }] });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", ...statsLlmContinuation(exactFirst) });
  assert.equal(executed, 1, "the exact first clause wins over an ambiguous prefix of the second clause"); assert.equal(reply.taskState?.uiSteps?.[0].actions?.length, 1); assert.equal(reply.taskState?.uiSteps?.[1].actions, undefined);
});
test("Stats evolution fragment cannot jump an unacknowledged prior UI step or become unique after its earlier match was transmitted", async () => {
  for (const instruction of ["Ouvre les statistiques puis affiche la vue Évolution des statistiques.", "Affiche les clics des statistiques puis affiche la vue Évolution des statistiques."]) {
    let executed = 0;
    const h = harness({ extraTools: statsScreenFixture(instruction, () => executed++), plan: [{ tool: "runScreenCommand", input: { command: "configure_stats_view", instructionQuote: "affiche la vue Évolution", patch: { panel: "evolution" } } }] });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: statsLiveScreen }, messages: [{ role: "user", content: instruction }] });
    assert.equal(executed, 0); assert.equal(reply.uiActions?.length ?? 0, 0);
  }
  const instruction = "Affiche la vue Évolution des statistiques puis affiche la vue Évolution mensuelle de Google Business.";
  const first = harness({ extraTools: statsScreenFixture(instruction, () => {}), plan: [{ tool: "runScreenCommand", input: { command: "configure_stats_view", instructionQuote: "Affiche la vue Évolution des statistiques", patch: { panel: "evolution" } } }] });
  const initial = await first.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: statsLiveScreen }, messages: [{ role: "user", content: instruction }] });
  const state = structuredClone(initial.taskState!); state.uiSteps = uiTask.bindInrAssistantUiSteps(state.uiSteps!, initial.uiActions!, { turnId: randomUUID(), createdAt: new Date().toISOString() });
  let repeated = 0;
  const resumed = harness({ extraTools: statsScreenFixture(instruction, () => repeated++), plan: [{ tool: "runScreenCommand", input: { command: "configure_stats_view", instructionQuote: "Affiche la vue Évolution", patch: { panel: "evolution" } } }] });
  const reply = await resumed.runtime.generateInrAssistantReply({ ...basic, edition: "basic", clientContext: { source: "untrusted_client", screen: statsLiveScreen }, taskContext: state, actionInstruction: instruction, taskIntent: "continue", browserStepResults: [{ stepId: state.uiSteps![0].id, status: "applied" }], messages: [{ role: "user", content: "Continuer" }] });
  assert.equal(repeated, 0, "uniqueness includes the earlier transmitted/applied clause"); assert.equal(reply.uiActions?.length ?? 0, 0);
});
test("Stats evolution repeated exact clauses still execute first then second only after the scoped native ACK", async () => {
  const exactQuote = "Affiche la vue Évolution des statistiques", instruction = `${exactQuote} puis ${exactQuote}.`;
  const fileContexts = [{ name: "stats-context.txt", kind: "document" as const, note: "Contexte joint ; aucune instruction supplémentaire." }];
  let firstExecutions = 0;
  const first = harness({ extraTools: statsScreenFixture(instruction, () => firstExecutions++), plan: [{ tool: "runScreenCommand", input: { command: "configure_stats_view", instructionQuote: exactQuote, patch: { panel: "evolution" } } }] });
  const initial = await first.runtime.generateInrAssistantReply({ ...basic, edition: "basic", fileContexts, clientContext: { source: "untrusted_client", screen: statsLiveScreen }, messages: [{ role: "user", content: instruction }] });
  assert.equal(firstExecutions, 1); assert.equal(initial.taskState?.uiSteps?.length, 2); assert.equal(initial.taskState?.uiSteps?.[0].actions?.length, 1); assert.equal(initial.taskState?.uiSteps?.[1].actions, undefined);
  const state = structuredClone(initial.taskState!); state.uiSteps = uiTask.bindInrAssistantUiSteps(state.uiSteps!, initial.uiActions!, { turnId: randomUUID(), createdAt: new Date().toISOString() });
  const nextScreen = { ...statsLiveScreen, revision: "stats_live_2" }, postScreen = { pathname: nextScreen.pathname, selection: nextScreen.selection, revision: nextScreen.revision };
  for (const acknowledged of [false, true]) {
    let executions = 0;
    const next = harness({ extraTools: statsScreenFixture(instruction, () => executions++, nextScreen), plan: [{ tool: "runScreenCommand", input: { command: "configure_stats_view", instructionQuote: exactQuote, patch: { panel: "evolution" } } }] });
    const reply = await next.runtime.generateInrAssistantReply({ ...basic, edition: "basic", fileContexts, clientContext: { source: "untrusted_client", screen: nextScreen }, taskContext: structuredClone(state), actionInstruction: instruction, taskIntent: "continue", browserStepResults: acknowledged ? [{ stepId: state.uiSteps![0].id, status: "applied", postScreen }] : [], messages: [{ role: "user", content: "Continuer" }] });
    assert.equal(executions, acknowledged ? 1 : 0); assert.equal(reply.uiActions?.length ?? 0, acknowledged ? 1 : 0);
    if (acknowledged) { assert.equal(reply.taskState?.uiSteps?.[1].actions?.length, 1); assert.equal(reply.taskState?.uiSteps?.[1].screen?.revision, nextScreen.revision); }
  }
});

test("mounted form modification has no phantom campaign mutation and waits for browser confirmation", async () => {
  const h = harness({ extraTools: uiBarrierFixture(), plan: [uiBarrierCall] });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, clientContext: { source: "untrusted_client", screen: uiBarrierScreen }, messages: [{ role: "user", content: uiBarrierClause }] });
  assert.equal(reply.outcome, "partial");
  assert.deepEqual(JSON.parse(JSON.stringify(reply.taskState?.requiredTools)), []);
  assert.equal(reply.uiActions?.length, 1);
  assert.equal(reply.taskState?.uiSteps?.[0].actions?.length, 1);
  assert.equal(reply.taskState?.receipts.length, 0);
  assert.match(reply.message, /confirmation du navigateur/);
});

test("UI then business mutation waits for scoped browser results and Continue without replaying UI", async () => {
  const instruction = `${uiBarrierClause}, puis crée un contact CRM nommé Alice.`;
  const create = { ...contactPlan[0], input: { ...contactPlan[0].input, instructionQuote: instruction } };
  let uiExecutions = 0;
  const h = harness({ crmIds: contactIds, extraTools: uiBarrierFixture(() => uiExecutions++), parallelPlan: [uiBarrierCall, create] });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, clientContext: { source: "untrusted_client", screen: uiBarrierScreen }, messages: [{ role: "user", content: instruction }] });
  assert.equal(uiExecutions, 1);
  assert.equal(h.crmExecutions.length, 0);
  assert.equal(reply.outcome, "partial");
  const state = structuredClone(reply.taskState!);
  state.uiSteps = uiTask.bindInrAssistantUiSteps(state.uiSteps!, reply.uiActions!, { turnId: randomUUID(), createdAt: new Date().toISOString() });
  assert.equal(taskPolicy.continueInrAssistantTask("Continuer", state, Date.now(), "continue"), instruction);
  for (const status of [undefined, "pending", "failed", "cancelled", "applied"] as const) {
    const resumed = harness({ crmIds: contactIds, extraTools: uiBarrierFixture(() => uiExecutions++), parallelPlan: [uiBarrierCall, create] });
    const result = await resumed.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, clientContext: { source: "untrusted_client", screen: uiBarrierScreen }, taskContext: state, actionInstruction: instruction, taskIntent: "continue", ...(status ? { browserStepResults: [{ stepId: state.uiSteps![0].id, status }] } : {}), messages: [{ role: "user", content: "Continuer" }] });
    assert.equal(resumed.crmExecutions.length, status === "applied" ? 1 : 0, String(status));
    assert.equal(result.outcome, status === "applied" ? "completed" : status === "failed" || status === "cancelled" ? "blocked" : "partial");
    assert.equal(result.uiActions, undefined);
    assert.equal(result.taskState?.instruction, instruction);
  }
  assert.equal(uiExecutions, 1, "a delivered screen step is never replayed, including on refusal");
  const unbound = structuredClone(state); delete unbound.uiSteps![0].source;
  const reclaimed = harness({ crmIds: contactIds, extraTools: uiBarrierFixture(() => uiExecutions++), parallelPlan: [uiBarrierCall, create] });
  await reclaimed.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, taskContext: unbound, actionInstruction: instruction, browserStepResults: [{ stepId: unbound.uiSteps![0].id, status: "applied" }], messages: [{ role: "user", content: "Continuer" }] });
  assert.equal(reclaimed.crmExecutions.length, 0, "unbound checkpoint is not a browser acknowledgement");
  const sameTurn = harness({ crmIds: contactIds, extraTools: uiBarrierFixture(() => uiExecutions++), parallelPlan: [uiBarrierCall, create] });
  await sameTurn.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, taskContext: state, actionInstruction: instruction, browserStepResults: [{ stepId: state.uiSteps![0].id, status: "applied" }], messages: [{ role: "user", content: instruction }] });
  assert.equal(sameTurn.crmExecutions.length, 0, "a reclaimed original turn cannot use an acknowledgement as an explicit Continue");
  assert.equal(uiExecutions, 1);
});

test("business before UI must complete before its command can be queued", async () => {
  const instruction = `Crée un contact CRM nommé Alice, puis ${uiBarrierClause.toLowerCase()}.`;
  const create = { ...contactPlan[0], input: { ...contactPlan[0].input, instructionQuote: instruction } };
  const observations: number[] = [];
  const h = harness({ crmIds: contactIds, extraTools: uiBarrierFixture(() => observations.push(h.crmExecutions.length)), parallelPlan: [uiBarrierCall, create], plan: [{ tool: "readAppGuide" }, uiBarrierCall] });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, clientContext: { source: "untrusted_client", screen: uiBarrierScreen }, messages: [{ role: "user", content: instruction }] });
  assert.deepEqual(observations, [1]);
  assert.equal(reply.uiActions?.length, 1);
  assert.equal(reply.outcome, "partial");
  assert.equal(reply.taskState?.receipts.filter(receipt => receipt.tool === "manageCrmContact" && receipt.ok).length, 1);
});

test("two edits of one form wait for separate commits and reject manual edits after the first browser receipt", async () => {
  const secondClause = "Modifie le texte de cette campagne publicitaire en Bonjour";
  const instruction = `${uiBarrierClause}, puis ${secondClause.toLowerCase()}.`;
  const secondCall = { tool: "runScreenCommand", input: { command: "configure_ads_draft", instructionQuote: secondClause } };
  let executed = 0;
  const makeTools = (revision: string) => ({ runScreenCommand: tool({ inputSchema: jsonSchema<{ command: string; instructionQuote: string }>({ type: "object", properties: { command: { type: "string" }, instructionQuote: { type: "string" } }, required: ["command", "instructionQuote"] }), execute: async () => {
    executed++; return { ok: true, status: "ui_action_requested", message: "Modification d’écran demandée.", uiCommand: { ...uiBarrierCommand, revision } };
  } }) });
  const h = harness({ extraTools: makeTools("rev_1"), parallelPlan: [uiBarrierCall, secondCall] });
  const initial = await h.runtime.generateInrAssistantReply({ ...basic, clientContext: { source: "untrusted_client", screen: uiBarrierScreen }, messages: [{ role: "user", content: instruction }] });
  assert.equal(executed, 1); assert.equal(initial.uiActions?.length, 1);
  assert.equal(initial.taskState?.uiSteps?.length, 2);
  const state = structuredClone(initial.taskState!);
  state.uiSteps = uiTask.bindInrAssistantUiSteps(state.uiSteps!, initial.uiActions!, { turnId: randomUUID(), createdAt: new Date().toISOString() });
  const postScreen = { pathname: uiBarrierScreen.pathname, selection: uiBarrierScreen.selection, revision: "rev_2" };
  for (const revision of ["manual_edit_rev_3", "rev_2"]) {
    const before: number = executed;
    const next = harness({ extraTools: makeTools(revision), plan: [secondCall] });
    const reply = await next.runtime.generateInrAssistantReply({ ...basic, clientContext: { source: "untrusted_client", screen: { ...uiBarrierScreen, revision } }, taskContext: state, actionInstruction: instruction, taskIntent: "continue", browserStepResults: [{ stepId: state.uiSteps![0].id, status: "applied", postScreen }], messages: [{ role: "user", content: "Continuer" }] });
    assert.equal(executed - before, revision === "rev_2" ? 1 : 0);
    assert.equal(reply.uiActions?.length ?? 0, revision === "rev_2" ? 1 : 0);
    if (revision === "rev_2") assert.equal(reply.taskState?.uiSteps?.[1].screen?.revision, "rev_2");
  }
});



test("audio attachment groups count only the requested sounds beside an unrelated image", async () => {
  const audios = importAttachmentIds.map((id, index) => ({ id, name: 'sound-' + index + '.mp3', kind: "audio" as const, size: 10 }));
  const mediaAttachments = [...audios, { id: "30000000-0000-4000-8000-000000000003", name: "unrelated.png", kind: "image" as const, size: 10 }];
  for (const message of ["Importe ces deux fichiers audio dans Mes médias.", "Importe tous les audios dans Mes médias.", "Importe ces sons dans ma médiathèque."]) {
    const fixture = importFixture(), h = harness({ mediaLibraryFactory: fixture.factory, plan: importPlan });
    const result = await h.runtime.generateInrAssistantReply({ ...basic, actorUserId: importAttachmentIds[0], edition: "basic", supabase: {} as never, mediaAttachments, messages: [{ role: "user", content: message }] });
    assert.equal(result.outcome, "completed", message);
    assert.equal(result.taskState?.requiredCalls?.importMediaAttachment, 2, message);
    assert.deepEqual(fixture.writes, importAttachmentIds);
    assert.equal(result.taskState?.receipts.filter(receipt => receipt.ok && receipt.tool === "importMediaAttachment").length, 2);
  }
});


test("document mail preparation stays an acknowledged UI handoff without phantom download or send goals", async () => {
  const instruction = "Prépare un mail avec le PDF de ce devis pour client@example.invalid.";
  const command = { command: "prepare_document_mail", selection: { kind: "quote", id: "11111111-1111-4111-8111-111111111111" }, revision: "doc_1", expectedUpdatedAt: "2026-11-02T12:00:00.000Z", recipient: "client@example.invalid" };
  const screen = { pathname: "/dashboard/devis/new", tool: "Devis", selection: command.selection, revision: command.revision, pendingChanges: false, documentVersion: command.expectedUpdatedAt, availableCommands: ["export_document_pdf", "prepare_document_mail"] };
  let executions = 0;
  const definition = tool({ inputSchema: jsonSchema<{ command: string; instructionQuote: string }>({ type: "object", properties: { command: { type: "string" }, instructionQuote: { type: "string" } }, required: ["command", "instructionQuote"] }), execute: async () => { executions++; return { ok: true, status: "ui_action_requested", message: "Ouverture du composeur demandée.", uiCommand: command }; } });
  const h = harness({ extraTools: { runScreenCommand: definition }, plan: [{ tool: "runScreenCommand", input: { command: command.command, instructionQuote: instruction } }] });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, edition: "founder", clientContext: clientScreen.parseInrAssistantClientContext({ screen }), messages: [{ role: "user", content: instruction }] });
  assert.equal(executions, 1); assert.equal(reply.uiActions?.length, 1); assert.equal(reply.outcome, "partial");
  assert.deepEqual(reply.taskState?.uiSteps?.map(step => step.command), ["prepare_document_mail"]);
  assert.ok(!reply.taskState?.requiredTools.some(name => ["sendIndividualMail", "previewIndividualMail", "prepareMediaDownload"].includes(name)));
  assert.equal(reply.taskState?.receipts.length, 0, "a queued browser command is not a saved or sent mail");
});


test("recovery stays unfinished after an ordinary status read and requires verified scoped diagnostics", async () => {
  const instruction = "Ma publication semble bloquée. Vérifie ce qui se passe sans la republier ni créer un nouveau contenu.";
  for (const mode of ["status_only", "complete", "incomplete", "unavailable"] as const) {
    let diagnostics = 0;
    const diagnosticRead = () => {
      diagnostics++; return { ok: mode !== "unavailable", complete: mode === "complete", sources: [{ status: mode === "complete" ? "available" : "unavailable" }], items: [], liveVerified: false };
    };
    const plan = [{ tool: "getRecentPublications", input: { query: "", limit: 8 } }, ...(mode === "status_only" ? [] : [{ tool: "getAccountDiagnostics", input: { area: "publications" } }])];
    const h = harness({ diagnosticRead, plan });
    const reply = await h.runtime.generateInrAssistantReply({ ...basic, supabase: {} as never, messages: [{ role: "user", content: instruction }] });
    if (mode === "complete") assert.equal(reply.outcome, "completed");
    else {
      assert.notEqual(reply.outcome, "completed", mode);
      assert.ok(reply.taskProgress?.remaining.includes("vérifier les signaux du problème signalé"), mode);
    }
    assert.equal(diagnostics, mode === "status_only" ? 0 : 1);
    assert.deepEqual(Array.from(reply.taskState?.requiredTools ?? []), ["getAccountDiagnostics"]);
    assert.equal(reply.taskState?.receipts.some(receipt => receipt.tool === "getAccountDiagnostics" && receipt.status === "read"), mode === "complete");
    assert.equal(h.crmExecutions.length, 0); assert.equal(h.mediaExecutions, 0); assert.equal(h.publicationExecutions.length, 0);
  }
});

test("native document prefill is a UI objective and subsequent PDF waits for its exact committed form", async () => {
  const instruction = "Convertis le devis DEV-001 en facture, puis exporte le PDF de cette facture.";
  const prefill = { operation: "convert_quote" as const, kind: "invoice" as const, sourceId: "11111111-1111-4111-8111-111111111111", expectedUpdatedAt: "2026-11-02T12:00:00.000Z" };
  const navigation = getInrAssistantDocumentPrefillNavigation(prefill);
  let preparations = 0, exports = 0;
  const prepare = { tool: "prepareCommercialDocumentForm", input: { instructionQuote: "Convertis le devis DEV-001 en facture" } };
  const exportCall = { tool: "runScreenCommand", input: { command: "export_document_pdf", instructionQuote: "Exporte le PDF de cette facture" } };
  const field = jsonSchema<{ instructionQuote: string; command?: string }>({ type: "object", properties: { instructionQuote: { type: "string" }, command: { type: "string" } }, required: ["instructionQuote"] });
  const documentNativeFactory = () => ({ prepareCommercialDocumentForm: tool({ inputSchema: field, execute: async () => { preparations++; return { ok: true, status: "navigation_requested", navigation }; } }) });
  const screen = { pathname: "/dashboard/factures/new", tool: "Factures", selection: { kind: "invoice" as const, id: "preview_invoice" }, revision: "new_1", documentPrefill: prefill, availableCommands: ["export_document_pdf" as const] };
  const extraTools = { runScreenCommand: tool({ inputSchema: field, execute: async () => { exports++; return { ok: true, uiCommand: { command: "export_document_pdf", selection: screen.selection, revision: screen.revision } }; } }) };
  const h = harness({ documentNativeFactory, extraTools, parallelPlan: [prepare, exportCall] });
  const initial = await h.runtime.generateInrAssistantReply({ ...basic, actorUserId: "actor-a", edition: "founder", supabase: {} as never, messages: [{ role: "user", content: instruction }] });
  assert.equal(preparations, 1); assert.equal(exports, 0); assert.equal(initial.uiActions?.length, 1); assert.equal(initial.outcome, "partial");
  assert.deepEqual(Array.from(initial.taskState?.requiredTools ?? []), []);
  const state = structuredClone(initial.taskState!);
  state.uiSteps = uiTask.bindInrAssistantUiSteps(state.uiSteps!, initial.uiActions!, { turnId: randomUUID(), createdAt: new Date().toISOString() });
  for (const acknowledged of [false, true]) {
    const before: number = exports;
    const resumed = harness({ documentNativeFactory, extraTools, plan: [exportCall] });
    const reply = await resumed.runtime.generateInrAssistantReply({ ...basic, actorUserId: "actor-a", edition: "founder", supabase: {} as never, taskContext: state, actionInstruction: instruction, taskIntent: "continue", clientContext: { source: "untrusted_client", screen }, browserStepResults: acknowledged ? [{ stepId: state.uiSteps![0].id, status: "applied", postScreen: screen }] : [], messages: [{ role: "user", content: "Continuer" }] });
    assert.equal(exports, before + (acknowledged ? 1 : 0)); assert.equal(reply.uiActions?.length ?? 0, acknowledged ? 1 : 0);
    assert.equal(reply.outcome, "partial", "a requested PDF handoff still waits for its browser result");
  }
  assert.equal(preparations, 1, "the hydrated conversion is never replayed");
});

test("current-document template waits for its confirmed browser result before a later CRM write", async () => {
  const clause = "Crée un modèle nommé Rénovation depuis ce devis";
  const instruction = `${clause}, puis crée un contact CRM nommé Alice.`;
  const screen = { pathname: "/dashboard/devis/new", tool: "Devis", selection: { kind: "quote" as const, id: "preview_template" }, revision: "doc_1", availableCommands: ["create_document_template" as const] };
  let handed = 0;
  const command = { command: "create_document_template", selection: screen.selection, revision: screen.revision, templateName: "Rénovation" };
  const documentNativeFactory = () => ({ prepareCurrentDocumentTemplate: tool({ inputSchema: jsonSchema<{ instructionQuote: string }>({ type: "object", properties: { instructionQuote: { type: "string" } }, required: ["instructionQuote"] }), execute: async () => { handed++; return { ok: true, status: "ui_requested", uiCommand: command }; } }) });
  const call = { tool: "prepareCurrentDocumentTemplate", input: { instructionQuote: clause } };
  const create = { ...contactPlan[0], input: { ...contactPlan[0].input, instructionQuote: instruction } };
  const h = harness({ documentNativeFactory, crmIds: contactIds, parallelPlan: [call, create] });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, actorUserId: "actor-a", edition: "founder", supabase: {} as never, clientContext: { source: "untrusted_client", screen }, messages: [{ role: "user", content: instruction }] });
  assert.equal(handed, 1); assert.equal(reply.uiActions?.length, 1); assert.equal(h.crmExecutions.length, 0); assert.equal(reply.outcome, "partial");
  assert.deepEqual(Array.from(reply.taskState!.requiredTools), ["manageCrmContact"]);
  const state = structuredClone(reply.taskState!); state.uiSteps = uiTask.bindInrAssistantUiSteps(state.uiSteps!, reply.uiActions!, { turnId: randomUUID(), createdAt: new Date().toISOString() });
  const resumed = harness({ documentNativeFactory, crmIds: contactIds, plan: [create] });
  const result = await resumed.runtime.generateInrAssistantReply({ ...basic, actorUserId: "actor-a", edition: "founder", supabase: {} as never, clientContext: { source: "untrusted_client", screen }, taskContext: state, actionInstruction: instruction, taskIntent: "continue", browserStepResults: [{ stepId: state.uiSteps![0].id, status: "applied", postScreen: screen }], messages: [{ role: "user", content: "Continuer" }] });
  assert.equal(resumed.crmExecutions.length, 1); assert.equal(handed, 1); assert.equal(result.outcome, "completed");
});
