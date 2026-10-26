import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { asSchema, generateText, jsonSchema, stepCountIs, tool, wrapLanguageModel } from "ai";
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import * as policy from "../../lib/inrAssistantPolicy.ts";
import * as conversation from "../../lib/inrAssistantConversation.ts";
import * as routing from "../../lib/inrAssistantToolRouting.ts";
import * as activity from "../../lib/inrAssistantActivity.ts";
import type * as Gateway from "../../lib/inrAssistantGateway.ts";
import type { InrAssistantMediaResult } from "../../lib/inrAssistantMediaTools.ts";
import type { InrAssistantPublicationResult } from "../../lib/inrAssistantPublicationTools.ts";
import type * as Memory from "../../lib/inrAssistantMemory.ts";
import type * as MemoryTools from "../../lib/inrAssistantMemoryTools.ts";

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
  productionNoRedis?: boolean; handoff?: boolean; media?: boolean; followup?: boolean; workflow?: boolean; failAfterPublication?: boolean; verifiedNavigation?: string; lookup?: "diagnostics" | "workspace" | "memory" } = {}) {
  const generations: { model: string; params: LanguageModelV3CallOptions }[] = [];
  const reservations: { feature: string; reservedOutputTokens: number; estimatedInputTokens: number }[] = [];
  const commits: { usage: { inputTokens: number; outputTokens: number; totalTokens: number } }[] = [];
  const finalized: { success: boolean }[] = [];
  const factories: string[] = [];
  const publicationExecutions: string[] = [];
  const toolScopes: { tool: string; accountId: string; edition: string }[] = [];
  let mediaExecutions = 0;
  const stubs: Record<string, unknown> = {
    "server-only": {}, "./dashboardEdition.ts": {},
    ai: { asSchema, generateText, jsonSchema, stepCountIs, tool, wrapLanguageModel,
      createGateway: () => (id: string): LanguageModelV3 => ({
        specificationVersion: "v3", provider: "test", modelId: id, supportedUrls: {},
        doGenerate: async (params) => {
          generations.push({ model: id, params });
          if (generations.length <= (options.fail ?? 0)) throw Object.assign(new Error("Unavailable"), { statusCode: 503 });
          if (options.failAfterPublication && generations.length > 3) throw Object.assign(new Error("Summary unavailable after publication"), { statusCode: 503 });
          const callTool = options.workflow ? generations.length <= 3 : options.handoff || options.media || ((options.followup || options.lookup) && generations.length === 1);
          const toolName = options.workflow ? ["generateMedia", "preparePublication", "executePublication"][generations.length - 1] : options.lookup === "memory" ? "recallPastDiscussions" : options.lookup === "diagnostics" ? "getAccountDiagnostics" : options.lookup === "workspace" ? "readWorkspaceSection" : options.handoff ? "proposeHumanSupport" : "generateMedia";
          const input = options.workflow && generations.length > 1 ? { draftId: "stored-draft", mode: "publish" } : options.lookup === "memory" ? { query: "campagne de Noël", limit: 4 } : options.lookup === "diagnostics" ? { area: "all" } : options.lookup === "workspace" ? { section: "stats" } : options.handoff ? { message: "Vous pouvez faire vérifier ce blocage.", summary: "Blocage de connexion à vérifier." } : { prompt: "Une image" };
          return {
            content: callTool ? [{ type: "tool-call", toolCallId: "call-1", toolName, input: JSON.stringify(input) }]
              : [{ type: "text", text: "Voici la prochaine étape." }],
            finishReason: { unified: callTool ? "tool-calls" : "stop", raw: "test" },
            usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 40, text: 10, reasoning: 30 } }, warnings: [],
          };
        },
        doStream: async () => { throw new Error("Streaming not expected"); },
      }) },
    "@/lib/aiGatewayConfig": { getAiGatewayCredential: () => "synthetic" },
    "@/lib/aiGatewayAccountGuard": { AiGatewayGuardUnavailableError: class extends Error {},
      reserveAiGatewayAccountAttempt: async (_id: string, args: { feature: string; reservedOutputTokens: number; estimatedInputTokens: number }) => {
        if (options.guardError) throw new Error("guard unavailable");
        reservations.push(args); return { id: reservations.length };
      }, commitAiGatewayAccountAttempt: async (args: { usage: { inputTokens: number; outputTokens: number; totalTokens: number } }) => {
        commits.push(args); if (options.failCommit) throw new Error("commit unavailable");
      }, recordAiGatewayAccountFailure: async () => {} },
    "@/lib/aiGatewayEconomics": { getConfiguredAiGatewayModelPricing: () => null },
    "@/lib/aiGatewayOperationTelemetry": { recordAiGatewayOperationCall: () => {} },
    "@/lib/upstashMode": { isUpstashEnabled: () => !options.productionNoRedis },
    "./inrAssistantPolicy.ts": policy,
    "./inrAssistantQuota.ts": { reserveInrAssistantRequest: async () => ({ solReserved: options.sol ?? false }),
      finalizeInrAssistantRequest: async (_quota: unknown, outcome: { success: boolean }) => { finalized.push(outcome); } },
    "./inrAssistantConversation.ts": conversation,
    "./inrAssistantToolRouting.ts": routing,
    "./inrAssistantActivity.ts": activity,
    "./inrAssistantBusinessTools.ts": { createInrAssistantBusinessTools: () => Object.fromEntries(["updateBusinessDna", "updateAiConfiguration", "guideChannelConnection"].map(name => [name, tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => ({ available: true }) })])) },
    "./inrAssistantCtaTools.ts": { createInrAssistantCtaTools: () => ({}) },
    "./inrAssistantDnaAnalysisTools.ts": { createInrAssistantDnaAnalysisTools: () => ({}) },
    "./inrAssistantManagementTools.ts": { createInrAssistantManagementTools: () => ({}) },
    "./inrAssistantCommercialTools.ts": { createInrAssistantCommercialTools: () => ({}) },
    "./inrAssistantCommunicationTools.ts": { createInrAssistantCommunicationTools: () => ({}) },
    "./inrAssistantAdvertisingTools.ts": { createInrAssistantAdvertisingTools: () => ({}) },
    "./inrAssistantSettingsTools.ts": { createInrAssistantSettingsTools: () => ({}) },
    "./inrAssistantPublicationTools.ts": { createInrAssistantPublicationTools: (args: { onResult?: (result: InrAssistantPublicationResult) => void }) => Object.fromEntries(["preparePublication", "executePublication"].map(name => [name,
      tool({ inputSchema: jsonSchema({ type: "object", properties: { draftId: { type: "string" }, mode: { type: "string" } }, required: ["draftId", "mode"] }), execute: async () => {
        publicationExecutions.push(name);
        const result: InrAssistantPublicationResult = { action: name === "preparePublication" ? "prepare" : "publish", ok: true,
          status: name === "preparePublication" ? "draft" : "queued", message: name === "preparePublication" ? "Le brouillon est enregistré." : "La publication est en file d’attente.",
          toolUrl: "/dashboard/send", checkedAt: "2026-10-26T12:00:00Z", draftId: "stored-draft" };
        args.onResult?.(result); return result;
      } }),
    ])) },
    "./inrAssistantWorkspaceActionTools.ts": { createInrAssistantWorkspaceActionTools: () => ({}) },
    "./inrAssistantInsightsTools.ts": { createInrAssistantInsightsTools: () => Object.fromEntries(["readStatsSnapshots", "readGoogleReviews", "replyToGoogleReview"].map(name => [name, tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => ({ available: true }) })])) },
    "./inrAssistantAppGuides.ts": { getInrAssistantAppKnowledge: () => "Documentation officielle : /dashboard?action=publish", getVerifiedInrAssistantNavigation: () => options.verifiedNavigation ?? null, createInrAssistantAppGuideTool: () => tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => ({ found: true }) }) },
    "./inrAssistantAccountTools.ts": { createInrAssistantAccountTools: () => Object.fromEntries(["getBusinessDna", "searchMedia", "getRecentPublications"].map(name => [name,
      tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => ({ available: true }) }),
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
    "./inrAssistantMediaTools.ts": { createInrAssistantMediaTools: (args: { requestId: string;
      onWorkStarted: (id: string) => void; onResult: (result: InrAssistantMediaResult) => void }) => {
      factories.push(args.requestId);
      return { generateMedia: tool({ inputSchema: jsonSchema<{ prompt: string }>({ type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] }),
        execute: async () => {
          mediaExecutions++;
          args.onWorkStarted("assistant-server-id-media");
          const result: InrAssistantMediaResult = { ok: true, status: "completed", requestId: "assistant-server-id-media",
            message: "Votre média est enregistré.", libraryUrl: "/dashboard/mediatheque", mediaType: "image" };
          if (!options.followup) args.onResult(result);
          return result;
        } }) };
    } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantGateway.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    Date, TextEncoder, AbortSignal, console, process: { env: { NODE_ENV: options.productionNoRedis ? "production" : "test" } },
  })((name: string) => { if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`); return stubs[name]; }, moduleRecord, moduleRecord.exports);
  return { runtime: moduleRecord.exports as typeof Gateway, generations, reservations, commits, finalized, factories, toolScopes, publicationExecutions, get mediaExecutions() { return mediaExecutions; } };
}

const basic = { accountId: "account-a", displayName: "Entreprise A", edition: "standard" as const,
  requestId: "server-id", request: new Request("https://inrcy.test/api/assistant/chat"),
  messages: [{ role: "user" as const, content: "Aide-moi à connecter Facebook" }] };
const complex = "Analyse mes résultats, compare les stratégies et prépare un calendrier de publications pour chaque canal sur un mois avec un budget maximum de 100 euros.";

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
  const h = harness({ handoff: true });
  const reply = await h.runtime.generateInrAssistantReply({ ...basic, messages: [{ role: "user", content: "Je veux parler à une personne" }] });
  assert.equal(reply.needsHuman, true);
  assert.equal(reply.handoffSummary, "Blocage de connexion à vérifier.");
  assert.equal(h.generations.length, 1);
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
  assert.equal(h.finalized[0].success, true);
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
