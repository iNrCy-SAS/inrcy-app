import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { URL, setTimeout, clearTimeout })((name: string) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`);
    return stubs[name];
  }, record, record.exports);
  return record.exports as T;
}
const memoryRuntime = loadClosedModule<typeof Memory>("inrAssistantMemory.ts", { "server-only": {}, "node:crypto": { randomUUID } });
const memoryToolsRuntime = loadClosedModule<typeof MemoryTools>("inrAssistantMemoryTools.ts", {
  "server-only": {}, ai: { jsonSchema, tool }, "./inrAssistantMemory.ts": memoryRuntime,
});

function harness(options: { sol?: boolean; fail?: number; guardError?: boolean; failCommit?: boolean;
  budgetFailure?: "limit" | "unavailable"; budgetFailureAt?: number; budgetCommitFailure?: boolean;
  reportedUsage?: { input: number | undefined; output: number | undefined };
  productionNoRedis?: boolean; noCredential?: boolean; handoff?: boolean; media?: boolean; followup?: boolean; workflow?: boolean; failAfterPublication?: boolean;
  verifiedNavigation?: string; lookup?: "diagnostics" | "workspace" | "memory"; providerError?: Error; outputLimit?: boolean;
  emptyText?: boolean; ignoresToolChoice?: boolean; abortAfterPublication?: AbortController;
  textReply?: string; unexpectedHandoff?: boolean; mediaMetadata?: boolean; crmIds?: string[]; crmStatus?: string;
  plan?: Array<{tool:string;input?:Record<string,unknown>}>;
  parallelPlan?:Array<{tool:string;input?:Record<string,unknown>}>;
  extraTools?:Record<string,unknown>;
  calendarFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  mediaLibraryFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  channelActionFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  statsFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  mailboxFactory?: (args:Record<string,unknown>)=>Record<string,unknown>;
  publicationWorkspaceRead?: boolean;
  guideCharacters?: number;
  accountRead?: (name:string,input:unknown)=>unknown;
  cta?: { definition: ReturnType<typeof createCtaToolFixture>["definition"]; input: { target: "phone" | "website"; instructionQuote: string; channels: string[] | null } } } = {}) {
  const generations: { model: string; params: LanguageModelV3CallOptions }[] = [];
  const reservations: { feature: string; reservedOutputTokens: number; estimatedInputTokens: number }[] = [];
  const commits: { model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }[] = [];
  const finalized: { success: boolean }[] = [];
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
          };
        },
        doStream: async () => { throw new Error("Streaming not expected"); },
      }) },
    "@/lib/aiGatewayConfig": { getAiGatewayCredential: () => options.noCredential ? null : "synthetic" },
    "@/lib/aiGatewayAccountGuard": { AiGatewayGuardUnavailableError: class extends Error {},
      reserveAiGatewayAccountAttempt: async (_id: string, args: { feature: string; reservedOutputTokens: number; estimatedInputTokens: number }) => {
        if (options.guardError) throw new Error("guard unavailable");
        reservations.push(args); return { id: reservations.length };
      }, commitAiGatewayAccountAttempt: async (args: { model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }) => {
        commits.push(args); if (options.failCommit) throw new Error("commit unavailable");
      }, recordAiGatewayAccountFailure: async () => {} },
    "@/lib/aiGatewayEconomics": { getConfiguredAiGatewayModelPricing: () => null },
    "@/lib/aiGatewayOperationTelemetry": { recordAiGatewayOperationCall: () => {} },
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
    "./inrAssistantActionCoverage.ts": actionCoverage,
    "./inrAssistantCommandRegistry.ts": commandRegistry,
    "./inrAssistantUiCommands.ts": uiCommands,
    "./inrAssistantUiTools.ts": { createInrAssistantUiTools: () => options.extraTools??{} },
    "./inrAssistantChannelTools.ts": { createInrAssistantChannelTools: () => ({}) },
    "./inrAssistantCampaignTools.ts": { createInrAssistantCampaignTools: () => ({}) },
    "./inrAssistantMailboxTools.ts": { createInrAssistantMailboxTools: (args:Record<string,unknown>) => options.mailboxFactory?.(args) ?? {} },
    "./inrAssistantDocumentTools.ts": { createInrAssistantDocumentTools: () => ({}) },
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
    "./inrAssistantQuota.ts": { reserveInrAssistantRequest: async () => ({ solReserved: options.sol ?? false }),
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
      }, required: ["action", "instructionQuote", "reference", "contactId", "fields"], additionalProperties: false }), execute: async input => {
        const id = options.crmIds![Math.min(crmExecutions.length, options.crmIds!.length - 1)];
        crmExecutions.push(input);
        return { ok: !options.crmStatus, status: options.crmStatus??"created", id, message: options.crmStatus?"Résultat CRM incertain.":`Fiche CRM enregistrée : ${id}.`, nextAction: { label: "iNr’CRM", href: "/dashboard/crm" } };
      } }),
    } : {} },
    "./inrAssistantCommunicationTools.ts": { createInrAssistantCommunicationTools: () => ({}) },
    "./inrAssistantAdvertisingTools.ts": { createInrAssistantAdvertisingTools: () => ({}) },
    "./inrAssistantSettingsTools.ts": { createInrAssistantSettingsTools: () => ({}) },
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
      return { getAccountDiagnostics: tool({ inputSchema: jsonSchema({ type: "object", properties: { area: { type: "string" } } }), execute: async () => ({ sources: [{ status: "available" }], message: "Une tentative récente a rencontré une limite temporaire." }) }) };
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
  stubs["./inrAssistantToolRegistry.ts"] = loadClosedModule<typeof ToolRegistry>("inrAssistantToolRegistry.ts", stubs);
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantGateway.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    Date, TextEncoder, AbortSignal, console, process: { env: { NODE_ENV: options.productionNoRedis ? "production" : "test" } },
  })((name: string) => { if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`); return stubs[name]; }, moduleRecord, moduleRecord.exports);
  return { runtime: moduleRecord.exports as typeof Gateway, generations, reservations, commits, finalized, budgetReservations, budgetFinalizations, factories, actionFactories, toolScopes, ctaScopes, publicationExecutions, metadataExecutions, crmExecutions, mediaScopes, diagnostics, get mediaExecutions() { return mediaExecutions; } };
}

const basic = { accountId: "account-a", displayName: "Entreprise A", edition: "standard" as const,
  requestId: "server-id", request: new Request("https://inrcy.test/api/assistant/chat"),
  messages: [{ role: "user" as const, content: "Aide-moi à connecter Facebook" }] };
const complex = "Analyse mes résultats, compare les stratégies et prépare un calendrier de publications pour chaque canal sur un mois avec un budget maximum de 100 euros.";

const studioPromptRequest = "Écris un prompt pour créer une image de flyer présentant les offres de mon entreprise.";
const studioPrompt = "Crée un flyer professionnel pour mon entreprise, dans un style moderne bleu et violet, avec un titre lisible et une présentation claire de mes services.";
const studioPromptReply = `Voici le prompt préparé :\n\n> ${studioPrompt}\n\nFormat recommandé : landscape.\n\nVous pouvez l’insérer dans Studio puis vérifier les critères avant de générer.`;
const toolNames = (params: LanguageModelV3CallOptions) => (params.tools ?? []).filter(tool => tool.type === "function").map(tool => tool.name);

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

test("a context-budget fallback retains completed tool results and IDs while shortening only guide prose", async () => {
  const instruction = "Crée un contact CRM nommé Alice, puis consulte les dernières publications Facebook.";
  const h = harness({ crmIds: contactIds, guideCharacters: 40_000, plan: [
    { tool: "readAppGuide" }, { tool: "searchCrmContacts" },
    { ...contactPlan[0], input: { ...contactPlan[0].input, instructionQuote: instruction } }, { tool: "getRecentPublications" },
  ], accountRead: () => ({ ok: true, items: [] }) });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, requestId: randomUUID(), actorUserId: "actor-a", edition: "premium", supabase: {} as never, messages: [{ role: "user", content: instruction }] });
  assert.equal(h.generations[1].model, policy.INR_ASSISTANT_MODELS.luna);
  const fallbackPrompt = JSON.stringify(h.generations[1].params.prompt);
  assert.match(fallbackPrompt, /readAppGuide/);
  assert.match(fallbackPrompt, /Extrait du guide/);
  const guideResult = h.generations[1].params.prompt.flatMap(message => message.role === "tool" ? message.content : [])
    .find(part => part.type === "tool-result" && part.toolName === "readAppGuide");
  assert.ok(guideResult?.type === "tool-result" && guideResult.output.type === "json");
  const guides = (guideResult.output.value as { guides: Array<{ content: string }> }).guides;
  assert.ok(guides[0].content.length < 1400);
  assert.equal(h.crmExecutions.length, 1);
  assert.equal(reply.outcome, "completed");
  assert.ok(h.diagnostics.some(diagnostic => diagnostic.phase === "input_limit"));
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
    const channels = target === "phone" ? ["site_web", "gmb", "facebook", "instagram", "threads", "linkedin", "x", "tiktok", "youtube_shorts", "pinterest"] : ["site_web", "gmb", "facebook", "threads", "linkedin", "youtube_shorts", "pinterest"];
    for (const channel of channels) assert.equal(map[channel].choice, target === "phone" ? "appeler" : "site", channel);
    if (target === "website") assert.equal(map.instagram.choice, "message");
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
    assert.equal(result.message, "Voici la prochaine étape.");
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

test("opening a module plus reading settings performs both even when the model omits navigation",async()=>{
 const target=uiCommands.getInrAssistantNavigation("preferences")!;
 let opens=0,reads=0;
 const h=harness({plan:[{tool:"readToolSettings"}],extraTools:{
  navigateApplication:tool({inputSchema:jsonSchema({type:"object",properties:{}}),execute:async()=>{opens++;return {ok:true,status:"navigation_requested",navigation:target,message:"Ouverture des préférences demandée."};}}),
  readToolSettings:tool({inputSchema:jsonSchema({type:"object",properties:{}}),execute:async()=>{reads++;return {ok:true,notifications:{emailEnabled:false}};}}),
 }});
 const reply=await h.runtime.generateInrAssistantReply({...basic,edition:"premium",supabase:{} as never,messages:[{role:"user",content:"Ouvre les préférences de l’application et indique mes réglages de notifications actuellement enregistrés. Lis-les sans rien modifier."}]});
 assert.equal(opens,1);assert.equal(reads,1);assert.equal(reply.navigation?.destination,"preferences");
 assert.ok(h.generations.length > 0,"The navigation shortcut must not skip the requested read");
 assert.equal(reply.taskState,undefined);
 assert.ok(h.generations.every(call=>!(call.params.tools??[]).some(tool=>tool.type==="function"&&tool.name==="navigateApplication")));
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
