import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as sdk from "ai";
import { normalizeAiMemory } from "../../lib/aiMemory.ts";
import { fitPromptPayloadToJsonBudget } from "../../lib/aiPromptBudget.ts";
import { getAssistantInternalDestination } from "../../lib/inrAssistantNavigation.ts";
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type * as Gateway from "../../lib/inrAssistantGateway.ts";
import type * as Conversation from "../../lib/inrAssistantConversation.ts";
import type * as Guides from "../../lib/inrAssistantAppGuides.ts";
import type { InrAssistantActivity } from "../../lib/inrAssistantActivity.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000001";
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
type Row = Record<string, unknown>;

/** Only local schema factories/public guides run; no action executor, DB or paid provider. */
function harness(options: { guideFollowup?: boolean; dnaFollowup?: boolean; dnaLanguage?: "fr" | "zh"; actionThenInputError?: boolean; ctaPartialThenInputError?: boolean } = {}) {
  const modules = new Map<string, Row>();
  const definitions = new Map<unknown, { name: string; description?: string }>();
  const schemas: Array<{ name: string; description?: string; schema: unknown }> = [];
  const providerCalls: LanguageModelV3CallOptions[] = [], reservations: Row[] = [];
  const generatedInputs: Array<{ system?: string; messages?: unknown }> = [];
  let actionExecutions = 0;
  const untouched = () => { assert.fail("Schema budget matrix must not execute a private operation or provider request"); };
  const common: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { createHash, randomUUID },
    "@/lib/requireUser": { requireUser: untouched }, "./requireUser": { requireUser: untouched },
    "@/lib/aiGatewayConfig": { getAiGatewayCredential: () => "synthetic-no-network" },
    "@/lib/aiGatewayAccountGuard": { AiGatewayGuardUnavailableError: class extends Error {},
      reserveAiGatewayAccountAttempt: async (_account: string, value: Row) => { reservations.push(value); return { id: reservations.length }; },
      commitAiGatewayAccountAttempt: async () => {}, recordAiGatewayAccountFailure: async () => {},
    },
    "@/lib/aiGatewayEconomics": { getConfiguredAiGatewayModelPricing: () => null },
    "@/lib/aiGatewayOperationTelemetry": { recordAiGatewayOperationCall() {} },
    "@/lib/upstashMode": { isUpstashEnabled: () => true },
    "./inrAssistantQuota.ts": { reserveInrAssistantRequest: async () => ({ solReserved: false }), finalizeInrAssistantRequest: async () => {} },
    "./aiMemory.ts": { normalizeAiMemory }, "./aiPromptBudget.ts": { fitPromptPayloadToJsonBudget },
    "./aiMediaGenerationContracts.ts": { normalizeAiMediaGenerationRequest: untouched },
    "./aiMediaModelCatalog.ts": { getAiMediaImageModel: untouched, getAiMediaVideoModel: untouched, isAiMediaVideoEngineAvailable: untouched },
    "./standardAgentPolicy.ts": { isStandardAgentActionDescriptor: untouched },
    "./adsAccessPolicy.ts": { ADS_PUBLIC_CHANNELS: [] }, "./aiMediaGenerationPublicErrors.ts": { getAiMediaGenerationPublicError: untouched },
    "./observability/accountDiagnostics.ts": { readAccountDiagnosticEvents: untouched },
    "./inrstats/visibilityIndexModel.ts": { VISIBILITY_INDEX_MODEL: {} },
    "./inrAssistantCodeIndex.generated.ts": { INR_ASSISTANT_CODE_INDEX: { sourceDigest: "schema-matrix-public-guide-only" } },
    "./boosterCtaPreferences": { getPreferredCtaLabel: untouched, normalizeCtaPhone: untouched },
    "./inrBadgeSettings.ts": { normalizeInrBadgeShareSettings: untouched },
    "./channelPublicUrl.ts": { normalizeChannelPublicUrl: untouched },
    "./metaChannelRolloutServer": { isMetaChannelPilotEnabledForActorAndAccount: untouched },
    "@/lib/accountSubscriptionAccess": { getActiveSubscriptionAccountIds: untouched },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: untouched },
    "./adsValidation.ts": { parseAdsCampaignInput: untouched },
    "./adsCampaignMetrics.ts": { isAdsCampaignMetrics: untouched },
    "./adsCampaignLifecycle.ts": { parseAdsCampaignLifecycleRequest: untouched },
  };
  const ai = {
    ...sdk,
    generateText: ((options: Parameters<typeof sdk.generateText>[0]) => {
      generatedInputs.push({ system: typeof options.system === "string" ? options.system : undefined, messages: options.messages });
      return sdk.generateText(options);
    }) as typeof sdk.generateText,
    tool: ((definition: Parameters<typeof sdk.tool>[0]) => {
      const result = sdk.tool(definition);
      definitions.set(result.inputSchema, { name: "proposeHumanSupport", description: result.description });
      return result;
    }) as typeof sdk.tool,
    asSchema(input: Parameters<typeof sdk.asSchema>[0]) {
      const schema = sdk.asSchema(input);
      const identity = definitions.get(input) ?? { name: "proposeHumanSupport" };
      void Promise.resolve(schema.jsonSchema).then(value => schemas.push({ ...identity, schema: value }));
      return schema;
    },
    createGateway: () => (modelId: string): LanguageModelV3 => ({ specificationVersion: "v3", provider: "schema-matrix", modelId, supportedUrls: {},
      doGenerate: async params => {
        providerCalls.push(params);
        if (options.actionThenInputError || options.ctaPartialThenInputError) {
          if (providerCalls.length > 1) {
            const errors = load("lib/inrAssistantConversation.ts") as typeof Conversation;
            throw new errors.InrAssistantInputError("Le contexte est trop long.");
          }
          const toolName = options.ctaPartialThenInputError ? "configureBusinessCta" : "prepareCampaignEmail";
          const input = options.ctaPartialThenInputError ? { instructionQuote: "Mets mon numéro professionnel comme CTA dans tous mes canaux.", target: "phone", channels: null } : {
            instructionQuote: "Prépare une campagne mail pour mon offre de toiture.", track: "promo_mail", subject: "Toiture", bodyText: "Notre offre de couverture.",
          };
          return { content: [{ type: "tool-call", toolCallId: "saved-action-1", toolName, input: JSON.stringify(input) }], finishReason: { unified: "tool-calls", raw: "test" },
            usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } }, warnings: [] };
        }
        if ((options.guideFollowup || options.dnaFollowup) && providerCalls.length === 1) return {
          content: [{ type: "tool-call", toolCallId: "guide-budget-1", toolName: options.dnaFollowup ? "getBusinessDna" : "readAppGuide", input: JSON.stringify(options.dnaFollowup ? {} : { topic: "business-dna" }) }],
          finishReason: { unified: "tool-calls", raw: "test" },
          usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } }, warnings: [],
        };
        return { content: [{ type: "text", text: "Réponse synthétique de test." }], finishReason: { unified: "stop", raw: "test" },
          usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } }, warnings: [] };
      }, doStream: async () => { throw new Error("No streaming in schema matrix"); },
    }),
  };
  function load(file: string): Row {
    const path = resolve(ROOT, file);
    if (modules.has(path)) return modules.get(path)!;
    assert.ok(path.startsWith(ROOT), "Only a fixed dependency beneath the repository is allowed");
    const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const moduleRecord = { exports: {} as Row }; modules.set(path, moduleRecord.exports);
    const dependency = (id: string): unknown => {
      if (id === "ai") return ai;
      if (Object.hasOwn(common, id)) return common[id];
      if (id.startsWith(".")) {
        if (/^\.\.\/messages\/fr-FR\/[a-zA-Z-]+\.json$/.test(id)) return { default: JSON.parse(readFileSync(resolve(dirname(path), id), "utf8")) };
        const target = resolve(dirname(path), id.endsWith(".ts") ? id : `${id}.ts`);
        const name = basename(target);
        assert.ok(/^inrAssistant[A-Za-z.]+\.ts$/.test(name) || ["commercialDocumentDraft.ts", "inrAgentSettings.ts", "inrAgentMonthSchedule.ts", "siteWebChannel.ts", "subscriptionOffers.ts", "boosterPublicationPolicy.ts", "boosterChannelRules.ts", "boosterPublicationOutcome.ts", "aiContentLength.ts", "aiInstructionSections.ts", "dashboard.channel-setup.ts", "aiChannelCtaPreferences.ts", "boosterWhatsappCta.ts"].includes(name), `Unexpected dependency ${id}`);
        return load(target);
      }
      assert.fail(`Unexpected schema dependency ${id}`);
    };
    vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {
      Date, Intl, URL, Request, Response, Headers, TextEncoder, AbortSignal, setTimeout, clearTimeout, console,
      process: { env: { NODE_ENV: "test" } }, fetch: untouched,
    })(dependency, moduleRecord, moduleRecord.exports);
    for (const [name, factory] of Object.entries(moduleRecord.exports)) if (/^createInrAssistant.*Tools$|^createInrAssistantAppGuideTool$/.test(name) && typeof factory === "function") {
      moduleRecord.exports[name] = (...args: unknown[]) => {
        if (options.dnaFollowup && name === "createInrAssistantAccountTools") {
          // Execute the real projection with account-scoped synthetic SQL rows.
          const text = (maximum: number) => (options.dnaLanguage === "zh" ? "企业提供屋顶翻修服务并帮助当地客户。" : "Notre entreprise française rénove les toitures et accompagne ses clients. ").repeat(100).slice(0, maximum);
          const data: Record<string, Row> = {
            profiles: { user_id: ACCOUNT, company_legal_name: "Entreprise Toitures", hq_city: "Paris" },
            business_profiles: { user_id: ACCOUNT, business_description: text(1_100), services: Array.from({ length: 5 }, () => text(80)) },
            business_ai_memories: { account_id: ACCOUNT, completion_score: 90, memory: { mission: text(350), offersAndArguments: text(650), keyArguments: text(450),
              proofsAndObjections: text(500), objectionResponses: text(400), editorialStrategy: text(550), campaignCalendar: text(300) } },
          };
          const synthetic = { from(table: string) {
            assert.ok(Object.hasOwn(data, table));
            const builder = { select: () => builder, order: () => builder, limit: () => builder,
              eq(key: string, value: unknown) { assert.equal(value, ACCOUNT); assert.equal(key, table === "business_ai_memories" ? "account_id" : "user_id"); return builder; },
              maybeSingle: async () => ({ data: data[table], error: null }),
            }; return builder;
          } };
          args[0] = { ...args[0] as Row, supabase: synthetic };
        }
        const result = factory(...args) as Row;
        if (options.actionThenInputError && name === "createInrAssistantWorkspaceActionTools") result.prepareCampaignEmail = {
          ...result.prepareCampaignEmail as object,
          execute: async () => { actionExecutions++; return { ok: true, status: "draft", draftId: "30000000-0000-4000-8000-000000000001",
            message: "Le brouillon a été enregistré dans iNr’Send. Aucun envoi n’a été effectué.",
            nextAction: { label: "iNr’Send — Brouillons", href: "/dashboard/mails?folder=propulsions&boxView=drafts" } }; },
        };
        if (options.ctaPartialThenInputError && name === "createInrAssistantCtaTools") result.configureBusinessCta = {
          ...result.configureBusinessCta as object,
          execute: async () => { actionExecutions++; return { ok: true, status: "partial", message: "Certains réglages n’ont pas pu être appliqués.",
            items: [
              { tool: "Booster / Agent Publications", channel: "facebook", status: "applied", message: "L’appel à l’action téléphonique a été enregistré." },
              { tool: "Booster / Agent Publications", channel: "instagram", status: "blocked", message: "Ce canal refuse ce type d’appel à l’action ; son réglage est conservé." },
              { tool: "Booster / Agent Publications", channel: "gmb", status: "unknown", message: "L’enregistrement n’a pas pu être confirmé ; vérifiez le réglage." },
            ],
            nextAction: { label: "Configuration IA — Appels à l’action", href: "/dashboard/configuration-ia" },
            existingContentChanged: false, externalProfilesChanged: false, privateMetadata: "PRIVATE PHONE OR TOKEN NEVER SHOW",
          }; },
        };
        const tools = name === "createInrAssistantAppGuideTool" ? { readAppGuide: result } : result;
        for (const [toolName, value] of Object.entries(tools)) { const definition = value as { inputSchema: unknown; description?: string }; definitions.set(definition.inputSchema, { name: toolName, description: definition.description }); }
        return result;
      };
    }
    modules.set(path, moduleRecord.exports); return moduleRecord.exports;
  }
  const runtime = load("lib/inrAssistantGateway.ts") as typeof Gateway;
  return { runtime, providerCalls, reservations, schemas, generatedInputs, get actionExecutions() { return actionExecutions; },
    conversation: load("lib/inrAssistantConversation.ts") as typeof Conversation,
    guides: load("lib/inrAssistantAppGuides.ts") as typeof Guides };
}

const scenarios = [
  { name: "routine", prompt: "Que dois-je faire maintenant pour commencer dans mon compte ?", required: ["readWorkspaceSection"] },
  { name: "crm-write", prompt: "Ajoute un contact CRM : Claire, claire@example.invalid, téléphone 0102030405.", required: ["manageCrmContact", "searchCrmContacts"] },
  { name: "commercial-draft", prompt: "Prépare un devis de rénovation pour mon client avec une ligne à 300 euros HT et TVA 20 %.", required: ["prepareCommercialDocument"] },
  { name: "campaign-dispatch", prompt: "Retrouve mon brouillon de campagne mail puis envoie-le à claire@example.invalid.", required: ["readCommunicationRecords", "dispatchCampaignDraft"] },
  { name: "calendar-edit", prompt: "Déplace le rendez-vous de demain dans mon agenda à 15h00.", required: ["readCommunicationRecords", "updateCalendarAppointment"] },
  { name: "studio-settings", prompt: "Modifie les réglages par défaut du Studio : format portrait et couleurs de marque.", required: ["readToolSettings", "updateToolSettings"] },
  { name: "ads-draft", prompt: "Prépare un brouillon ADS sur Google avec un budget de 20 euros par jour jusqu’au 2026-12-01.", required: ["readAdvertisingCampaigns", "prepareAdvertisingCampaign"] },
  { name: "business-dna", prompt: "Complète l’ADN de mon entreprise et règle son ton chaleureux avec les services de rénovation de toiture.", required: ["updateBusinessDna", "updateAiConfiguration"] },
  { name: "cta-phone", prompt: "Mets mon numéro professionnel comme CTA dans toutes mes publications.", required: ["configureBusinessCta"] },
  { name: "cta-website", prompt: "Configure les appels à l’action vers mon site dans tous les canaux.", required: ["configureBusinessCta"] },
  { name: "dna-source-analysis", prompt: "Complète automatiquement mon ADN en analysant mes canaux, puis indique-moi ce qui manque.", required: ["startBusinessDnaAnalysis", "getBusinessDnaAnalysis", "getBusinessDna"] },
  { name: "publication-and-media", prompt: "Crée une image pour notre offre toiture puis prépare et programme une publication Facebook pour demain à neuf heures, à partir de mon ADN.", required: ["generateMedia", "preparePublication", "executePublication", "getBusinessDna", "searchMedia"] },
  { name: "composed-workspace", prompt: "Complète mon ADN, crée une image et prépare une publication Facebook. Configure l’agent Stats chaque lundi à neuf heures, analyse mes statistiques et prépare une campagne mail avec mes contacts CRM.", required: ["updateBusinessDna", "generateMedia", "preparePublication", "configureAgentAutomation", "readStatsSnapshots", "prepareCampaignEmail", "searchCrmContacts"] },
  { name: "composed-workspace-long-history", prompt: "Complète mon ADN, crée une image et prépare une publication Facebook. Configure l’agent Stats chaque lundi à neuf heures, analyse mes statistiques et prépare une campagne mail avec mes contacts CRM.", required: ["updateBusinessDna", "generateMedia", "preparePublication", "configureAgentAutomation", "readStatsSnapshots", "prepareCampaignEmail", "searchCrmContacts"], history: true },
  { name: "cta-dna-analysis-composed", prompt: "Complète mon ADN avec mes canaux et mets mon numéro comme CTA partout. Crée une image puis prépare une publication Facebook ; configure l’agent Stats chaque lundi à neuf heures et prépare une campagne mail pour mes contacts CRM.", required: ["configureBusinessCta", "startBusinessDnaAnalysis", "getBusinessDnaAnalysis", "generateMedia", "preparePublication", "configureAgentAutomation", "prepareCampaignEmail", "searchCrmContacts"] },
] as const;

for (const scenario of scenarios) test(`real schema budget matrix: ${scenario.name}`, async t => {
  const h = harness();
  const accountContext = { source: "authenticated_account", business: { description: "Entreprise artisanale de couverture. ".repeat(85) }, setup: { channels: { connected: 3, total: 13 }, dna: { readiness: "partial" }, ai: { readiness: "ready" } } };
  const input = { accountId: ACCOUNT, actorUserId: ACTOR, displayName: "Entreprise Toitures", edition: "premium" as const,
    requestId: randomUUID(), actionRequestId: `${ACCOUNT}_${randomUUID()}`, request: new Request("https://app.inrcy.com/api/assistant/chat"),
    supabase: { from: () => assert.fail("No SQL in schema matrix") } as never,
    memory: { loadRecent: async () => assert.fail("No memory read in schema matrix"), search: async () => assert.fail("No memory read in schema matrix") },
    messages: [...("history" in scenario ? Array.from({ length: 5 }, (_, index) => [
      { role: "user" as const, content: `Ancien sujet ${index}. ${"Préparons une communication utile pour notre entreprise. ".repeat(10)}` },
      { role: "assistant" as const, content: `Ancienne réponse ${index}. ${"Des idées de publications locales et professionnelles. ".repeat(35)}` },
    ]).flat() : []), { role: "user" as const, content: scenario.prompt }], accountContext,
    clientContext: { source: "untrusted_client" as const, screen: { pathname: "/dashboard", tool: "Cockpit" } },
  };
  let failure: unknown;
  try { await h.runtime.generateInrAssistantReply(input); } catch (error) { failure = error; }
  const system = h.conversation.buildInrAssistantSystemPrompt(input.displayName, accountContext, h.guides.getInrAssistantAppKnowledge(scenario.prompt), input.edition, input.clientContext);
  const providerSchemas = h.schemas.map(({ name, description, schema }) => ({ type: "function", name, description, inputSchema: schema }));
  const compacted = h.generatedInputs[0];
  const preflightBytes = bytes({ system: compacted?.system ?? system, messages: compacted?.messages ?? input.messages }) + bytes(providerSchemas) + 2048;
  t.diagnostic(JSON.stringify({ scenario: scenario.name, systemBytes: bytes(system), schemaBytes: bytes(providerSchemas), preflightBytes,
    providerBytes: h.providerCalls.map(params => bytes({ prompt: params.prompt, tools: params.tools }) + 1024),
    tools: h.schemas.map(({ name, description, schema }) => ({ name, bytes: bytes({ name, description, inputSchema: schema }) })) }));
  assert.equal(failure, undefined, `Actual Gateway rejects a normal ${scenario.name} request before any external operation: ${String(failure)}`);
  assert.equal(h.providerCalls.length, 1);
  for (const name of scenario.required) assert.ok(h.schemas.some(schema => schema.name === name), `Compaction must retain the ${name} action actually requested`);
  const sent = h.generatedInputs[0];
  assert.match(sent.system ?? "", /Entreprise Toitures/); assert.match(sent.system ?? "", /premium/);
  assert.equal((sent.messages as Array<{ content: string }>).at(-1)?.content, scenario.prompt, "Compaction never discards the latest request");
  if ("history" in scenario) assert.ok((sent.messages as unknown[]).length < input.messages.length, "Old chat text should compact before refusing an ordinary request");
  assert.ok(preflightBytes <= 31_000, `Preflight ${preflightBytes} exceeds the actual 31K UTF-8 guard`);
  assert.ok(h.reservations.every(item => Number(item.estimatedInputTokens) <= 32_000));
});

test("real guide result fits the second SDK step without losing its call/result pair or exceeding the input guard", async t => {
  const h = harness({ guideFollowup: true });
  const prompt = "Explique mon ADN puis complète la description de mon entreprise avec les prestations de toiture.";
  const messages = [{ role: "user" as const, content: prompt }];
  await h.runtime.generateInrAssistantReply({ accountId: ACCOUNT, actorUserId: ACTOR, displayName: "Entreprise Toitures", edition: "premium",
    requestId: randomUUID(), actionRequestId: `${ACCOUNT}_${randomUUID()}`, request: new Request("https://app.inrcy.com/api/assistant/chat"),
    supabase: { from: () => assert.fail("No SQL in public guide test") } as never, messages,
    accountContext: { source: "authenticated_account", setup: { dna: { readiness: "partial" } } },
  });
  assert.equal(h.providerCalls.length, 2);
  assert.equal(h.reservations.length, 2);
  const second = JSON.stringify(h.providerCalls[1].prompt);
  assert.match(second, /guide-budget-1/); assert.match(second, /reviewed_current_application_code/);
  assert.match(second, /business-dna/); assert.match(second, /toiture/);
  const sizes = h.providerCalls.map(params => bytes({ prompt: params.prompt, tools: params.tools }) + 1024);
  t.diagnostic(JSON.stringify({ guideFollowupProviderBytes: sizes }));
  assert.ok(sizes.every(size => size <= 32_000));
});

for (const language of ["fr", "zh"] as const) test(`publication plus media accepts a full bounded ${language} DNA summary on its second SDK step`, async t => {
  const h = harness({ dnaFollowup: true, dnaLanguage: language });
  const prompt = "Crée une image et prépare une publication Facebook pour notre toiture en suivant mon ADN.";
  await h.runtime.generateInrAssistantReply({ accountId: ACCOUNT, actorUserId: ACTOR, displayName: "Entreprise Toitures", edition: "premium",
    requestId: randomUUID(), actionRequestId: `${ACCOUNT}_${randomUUID()}`, request: new Request("https://app.inrcy.com/api/assistant/chat"),
    supabase: { from: () => assert.fail("No real SQL in bounded DNA step") } as never,
    messages: [{ role: "user", content: prompt }], accountContext: { source: "authenticated_account" },
  });
  assert.equal(h.providerCalls.length, 2);
  const second = JSON.stringify(h.providerCalls[1].prompt);
  assert.match(second, /bounded_dna_summary/); assert.ok(second.includes(language === "fr" ? "Notre entreprise française" : "企业提供屋顶翻修服务"));
  const sizes = h.providerCalls.map(params => bytes({ prompt: params.prompt, tools: params.tools }) + 1024);
  t.diagnostic(JSON.stringify({ boundedDnaFollowupProviderBytes: sizes }));
  assert.ok(sizes.every(size => size <= 32_000));
});

test("a saved mail draft survives a later summary InputError without another executor or model fallback", async () => {
  const h = harness({ actionThenInputError: true });
  const reply = await h.runtime.generateInrAssistantReply({ accountId: ACCOUNT, actorUserId: ACTOR, displayName: "Entreprise Toitures", edition: "premium",
    requestId: randomUUID(), actionRequestId: `${ACCOUNT}_${randomUUID()}`, request: new Request("https://app.inrcy.com/api/assistant/chat"),
    supabase: { from: () => assert.fail("No SQL for synthetic saved draft") } as never,
    messages: [{ role: "user", content: "Prépare une campagne mail pour mon offre de toiture." }],
  });
  assert.equal(h.actionExecutions, 1);
  assert.equal(h.providerCalls.length, 2, "Only the first attempt and its failed summary run; no model fallback may replay the draft");
  assert.match(reply.message, /brouillon a été enregistré/); assert.match(reply.message, /Aucun envoi/);
  assert.match(reply.message, /iNr’Send/); assert.doesNotMatch(reply.message, /campagne.*envoyée|503|contexte est trop long/);
});

test("real tool progress adds no schema, model context, inference or repeated action to a saved email draft", async () => {
  const runs: ReturnType<typeof harness>[] = [];
  const activities: InrAssistantActivity[] = [];
  for (const progress of [false, true]) {
    const h = harness({ actionThenInputError: true });
    runs.push(h);
    const reply = await h.runtime.generateInrAssistantReply({ accountId: ACCOUNT, actorUserId: ACTOR, displayName: "Entreprise Toitures", edition: "premium",
      requestId: randomUUID(), actionRequestId: `${ACCOUNT}_${randomUUID()}`, request: new Request("https://app.inrcy.com/api/assistant/chat"),
      supabase: { from: () => assert.fail("No SQL for synthetic email progress") } as never,
      messages: [{ role: "user", content: "Prépare une campagne mail pour mon offre de toiture." }],
      ...(progress ? { onActivity: (activity: InrAssistantActivity) => { activities.push(activity); } } : {}),
    });
    assert.match(reply.message, /brouillon a été enregistré/); assert.match(reply.message, /Aucun envoi/);
    assert.equal(h.actionExecutions, 1); assert.equal(h.providerCalls.length, 2);
    assert.ok(h.providerCalls.every(params => bytes({ prompt: params.prompt, tools: params.tools }) + 1024 <= 32_000));
  }
  assert.deepEqual(activities.map(activity => activity.agent), ["emailing", "emailing"]);
  assert.deepEqual(activities.map(activity => activity.status), ["running", "completed"]);
  assert.equal(activities[0].id, activities[1].id);
  assert.deepEqual(JSON.parse(JSON.stringify(runs[0].providerCalls.map(params => params.tools))), JSON.parse(JSON.stringify(runs[1].providerCalls.map(params => params.tools))),
    "A server callback must not add or duplicate any model-visible tool schema");
  assert.deepEqual(runs[0].providerCalls.map(params => bytes(params.prompt)), runs[1].providerCalls.map(params => bytes(params.prompt)),
    "User-facing activity is not injected into paid model context");
  assert.deepEqual(runs[0].reservations.map(item => item.estimatedInputTokens), runs[1].reservations.map(item => item.estimatedInputTokens));
  assert.doesNotMatch(JSON.stringify(activities), /draftId|instructionQuote|toolCallId|accountId|requestId|Toiture|Notre offre/);
});

test("partial CTA results retain applied, blocked and unconfirmed channels after a summary InputError without repeating the action", async () => {
  const h = harness({ ctaPartialThenInputError: true });
  const reply = await h.runtime.generateInrAssistantReply({ accountId: ACCOUNT, actorUserId: ACTOR, displayName: "Entreprise Toitures", edition: "premium",
    requestId: randomUUID(), actionRequestId: `${ACCOUNT}_${randomUUID()}`, request: new Request("https://app.inrcy.com/api/assistant/chat"),
    supabase: { from: () => assert.fail("No real SQL for synthetic partial CTA") } as never,
    messages: [{ role: "user", content: "Mets mon numéro professionnel comme CTA dans tous mes canaux." }],
  });
  assert.equal(h.actionExecutions, 1); assert.equal(h.providerCalls.length, 2);
  assert.match(reply.message, /partie/); assert.match(reply.message, /Facebook/); assert.match(reply.message, /Instagram/); assert.match(reply.message, /Google Business/);
  assert.match(reply.message, /téléphonique a été enregistré/); assert.match(reply.message, /refuse ce type/); assert.match(reply.message, /n’a pas pu être confirmé/);
  assert.doesNotMatch(reply.message, /PRIVATE|TOKEN|PHONE|503|contexte est trop long|tout.*appliqué/);
  assert.ok(new TextEncoder().encode(reply.message).byteLength <= 7_000);
});

test("every professional page and legacy alias has a reviewed guide and public in-app navigation name", async () => {
  const h = harness();
  const registry: Record<string, string> = {
    "/dashboard": "dashboard-navigation", "/dashboard/adn-entreprise": "business-dna", "/dashboard/ads": "ads",
    "/dashboard/agenda": "calendar", "/dashboard/agent": "agents", "/dashboard/agent/campagnes-mails": "agents",
    "/dashboard/agent/publications": "agents", "/dashboard/agent/stats": "agents", "/dashboard/booster": "booster",
    "/dashboard/boutique/recharges": "shop-inertia", "/dashboard/configuration-ia": "ai-configuration", "/dashboard/crm": "crm",
    "/dashboard/devis": "quotes", "/dashboard/devis/new": "quotes", "/dashboard/e-reputation": "reputation",
    "/dashboard/factures": "invoices", "/dashboard/factures/new": "invoices", "/dashboard/fideliser": "emailing",
    "/dashboard/generer-media": "studio-create", "/dashboard/gps": "help", "/dashboard/interventions": "calendar",
    "/dashboard/mails": "send", "/dashboard/mediatheque": "media-library", "/dashboard/mon-profil": "business-dna",
    "/dashboard/propulser": "emailing", "/dashboard/settings/abonnement": "subscription", "/dashboard/settings/activite": "business-dna",
    "/dashboard/settings/contact": "help", "/dashboard/settings/ia": "ai-configuration",
    "/dashboard/settings/preferences": "account-preferences-privacy", "/dashboard/settings/profil": "business-dna", "/dashboard/stats": "stats",
  };
  const pages: string[] = [];
  const visit = (directory: string, route: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== "admin") visit(resolve(directory, entry.name), `${route}/${entry.name}`);
      if (entry.isFile() && entry.name === "page.tsx") pages.push(route);
    }
  };
  visit(resolve(ROOT, "app/dashboard"), "/dashboard");
  assert.deepEqual(pages.sort(), Object.keys(registry).sort(), "A new pro page must receive a reviewed guide and visible navigation label");
  const readGuide = h.guides.createInrAssistantAppGuideTool();
  for (const [route, guideId] of Object.entries(registry)) {
    const destination = getAssistantInternalDestination(route);
    assert.equal(destination?.href, route); assert.ok(destination?.label && !destination.label.includes("/dashboard"), route);
    assert.ok(h.guides.INR_ASSISTANT_APP_GUIDES.some(guide => guide.id === guideId), `${route}: ${guideId}`);
    const guide = await readGuide.execute!({ topic: guideId }, { toolCallId: `registry-${guideId}`, messages: [] });
    assert.ok(guide && typeof guide === "object" && "found" in guide, "The public guide executor returns one materialized result, never a stream");
    assert.equal(guide.found, true);
    assert.doesNotMatch(JSON.stringify(guide), /sourceFiles|app\/dashboard|\/api\/|process\.env|supabaseAdmin|Bearer\s+[A-Za-z0-9]/, "Only the reviewed public procedure is exposed, not source code, private settings or API routes");
  }
  const recharge = h.guides.INR_ASSISTANT_APP_GUIDES.find(guide => guide.id === "shop-inertia")!;
  assert.ok(recharge.sourceFiles.includes("app/dashboard/boutique/recharges/page.tsx"));
  assert.match(recharge.content, /\/dashboard\/boutique\/recharges/); assert.match(recharge.content, /paiement Stripe/);
  assert.match(recharge.content, /en attente ne prouve pas/);
  for (const route of ["/dashboard/admin", "/dashboard/admin/users", "/dashboard/settings/invented", "/api/private", "/equipe/agenda"]) {
    assert.equal(getAssistantInternalDestination(route), undefined);
  }
});
