import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as routing from "../../lib/inrAssistantToolRouting.ts";
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
import { inrAssistantObjectives, inrAssistantReadMatchesObjective } from "../../lib/inrAssistantObjectives.ts";
import type * as Registry from "../../lib/inrAssistantToolRegistry.ts";

type Scope = Record<string, unknown>;
function harness(unavailableUiTools: string[] = []) {
  const calls: Array<{ factory: string; scope: Scope }> = [];
  const executions: string[] = [];
  const source = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantToolRegistry.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`)((name: string) => {
    if (name === "server-only") return {};
    if (name === "./inrAssistantToolRouting.ts") return routing;
    if (name === "./inrAssistantLocalInterface.ts") return localInterfaces;
    if (name === "./inrAssistantApplicationPreferences.ts") return applicationPreferences;
    if (name === "./inrAssistantStudioDraftReview.ts") return studioDraftReview;
    if (name === "./inrAssistantContentReport.ts") return contentReport;
    if (name === "./inrAssistantBusinessRichText.ts") return richText;
    if (name === "./inrAssistantCreditOrderReconciliation.ts") return creditReconciliation;
    if (name === "./inrAssistantGoogleBusinessDraftReview.ts") return googleDraftReview;
    if (name === "./inrAssistantStudioPreferenceIntent.ts") return studioPreferenceIntent;
    if (name === "./inrAssistantBadgeIdentityTheme.ts") return badgeIdentityTheme;
    if (name === "./inrAssistantNotificationNavigation.ts") return notificationNavigation;
    if (name === "./inrAssistantSendPublicationIntent.ts") return sendPublicationIntent;
    if (name === "./inrAssistantAccountUiIntent.ts") return accountUiIntent;
    if (name === "./inrAssistantBasicShopRead.ts") return basicShopRead;
    const match = name.match(/^\.\/(inrAssistant\w+Tools)\.ts$/);
    assert.ok(match, `Unexpected registry dependency ${name}`);
    const factory = `createI${match[1].slice(1)}`;
    return { [factory]: (scope: Scope) => {
      calls.push({ factory, scope });
      if (factory === "createInrAssistantUiTools") return Object.fromEntries(["navigateApplication", "runScreenCommand"]
        .filter(name => !unavailableUiTools.includes(name)).map(name => [name, { execute: () => { executions.push(name); } }]));
      const definitions: Record<string, { execute: () => void }> = {};
      return new Proxy(definitions, { get(target, key: string) {
        return target[key] ??= { execute: () => { executions.push(key); } };
      } });
    } };
  }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as typeof Registry;
  const context: Registry.InrAssistantToolRegistryContext = {
    args: { accountId: "trusted-account", actorUserId: "trusted-actor", displayName: "Fixture", edition: "standard", requestId: "server-turn", actionRequestId: "server-action",
      request: new Request("https://fixture.invalid/api/assistant/chat"), messages: [{ role: "user", content: "Question" }], supabase: { from: () => { throw new Error("No database execution"); } } as never },
    latestRequest: "Question", spokenRequest: "Question", families: new Set(), requiredTools: [], canExecute: true,
    draftOnly: false, statusOnly: false, navigationRequested: false, screenCommandRequested: false,
    remainingTimeMs: () => 30_000, onMediaStarted: () => {}, onMediaResult: () => {}, onPublicationResult: () => {}, resolvePreview: () => null,
  };
  return { context, calls, executions, build: (changes: Partial<Registry.InrAssistantToolRegistryContext> = {}) => runtime.createInrAssistantToolRegistry({ ...context, ...changes }) };
}

test("Basic Inertia and prestation questions retain their exact read-only account view without credit or purchase authority", () => {
  for (const [message, view] of [["Lis mon solde d’Unités d’Inertie", "inertia"], ["Mes commandes de prestations", "shop_orders"]] as const) {
    assert.equal(basicShopRead.getInrAssistantBasicShopReadView(message), view);
    const plan = inrAssistantObjectives(message); assert.equal(plan.length, 1); assert.equal(plan[0].kind, "read"); assert.equal(plan[0].tool, "readAccountServices");
    assert.equal(inrAssistantReadMatchesObjective(plan[0], "readAccountServices", { view, offset: 0 }), true);
    for (const wrongView of ["credits", "credit_orders", view === "inertia" ? "shop_orders" : "inertia"]) assert.equal(inrAssistantReadMatchesObjective(plan[0], "readAccountServices", { view: wrongView, offset: 0 }), false);
    const h = harness(), selected = h.build({ args: { ...h.context.args, edition: "basic" }, latestRequest: message, spokenRequest: message, canExecute: false, families: new Set(["management"]), requiredTools: ["readAccountServices"] });
    assert.deepEqual(Object.keys(selected.additionalTools), ["readAccountServices"]); assert.equal(h.executions.length, 0); assert.ok(h.calls.some(call => call.factory === "createInrAssistantAccountServiceTools"));
  }
});

test("Basic exposes only the native UI tools required by its navigation and screen plan", () => {
  for (const [navigationRequested, screenCommandRequested, expected] of [
    [true, false, ["navigateApplication"]],
    [false, true, ["runScreenCommand"]],
    [true, true, ["navigateApplication", "runScreenCommand"]],
    [false, false, []],
  ] as const) {
    const h = harness(), clientContext = { source: "untrusted_client" as const, screen: { pathname: "/dashboard/stats", tool: "iNr’Stats", selection: { kind: "stats" as const, id: "stats" }, revision: "stats_1", availableCommands: ["configure_stats_view" as const] } };
    const args = { ...h.context.args, edition: "basic" as const, clientContext };
    const registry = h.build({ args, latestRequest: "Affiche la vue Évolution des statistiques.", navigationRequested, screenCommandRequested });
    assert.deepEqual(Object.keys(registry.uiTools), expected);
    const uiCalls = h.calls.filter(call => call.factory === "createInrAssistantUiTools");
    assert.equal(uiCalls.length, expected.length ? 1 : 0);
    if (uiCalls.length) {
      assert.equal(uiCalls[0].scope.accountId, args.accountId);
      assert.equal(uiCalls[0].scope.edition, "basic");
      assert.equal(uiCalls[0].scope.clientContext, clientContext);
      assert.equal(uiCalls[0].scope.currentUserMessage, "Affiche la vue Évolution des statistiques.");
    }
    assert.deepEqual(h.executions, []);
  }
});

test("UI selection never advertises a native handler missing from the factory", () => {
  const h = harness(["navigateApplication"]);
  const registry = h.build({ args: { ...h.context.args, edition: "basic" }, navigationRequested: true, screenCommandRequested: true });
  assert.deepEqual(Object.keys(registry.uiTools), ["runScreenCommand"]);
  assert.equal(Object.hasOwn(registry.uiTools, "navigateApplication"), false);
  assert.deepEqual(h.executions, []);
});

test("monthly visibility and clicks requests expose their required native reader without the word statistics", () => {
  for (const message of ["Compare ma visibilité sur les trois derniers mois", "Compare les clics mois par mois"]) {
    const h = harness(), requiredTools = inrAssistantObjectives(message).map(objective => objective.tool);
    assert.ok(requiredTools.includes("readStatsEvolution"), message);
    const registry = h.build({ args: { ...h.context.args, edition: "basic" }, latestRequest: message, spokenRequest: message, requiredTools, canExecute: false });
    assert.ok(Object.hasOwn(registry.additionalTools, "readStatsEvolution"), message);
    assert.equal(Object.hasOwn(registry.additionalTools, "sendStatsReport"), false);
    assert.deepEqual(h.executions, []);
  }
});

test("an explicit subscription invoice download exposes its native browser preparation in Basic", () => {
  const h = harness(), message = "Download ma facture d’abonnement INV-001", requiredTools = routing.inrAssistantRequiredTools(message);
  assert.deepEqual(requiredTools, ["prepareAccountDocumentDownload"]);
  const base = { args: { ...h.context.args, edition: "basic" as const }, latestRequest: message, spokenRequest: message, requiredTools };
  assert.ok(Object.hasOwn(h.build(base).additionalTools, "prepareAccountDocumentDownload"));
  assert.equal(Object.hasOwn(h.build({ ...base, canExecute: false }).additionalTools, "prepareAccountDocumentDownload"), false);
  assert.deepEqual(h.executions, []);
});

test("registry construction retains the server scope and never executes a handler", () => {
  const h = harness();
  h.build({ latestRequest: "Erreur de connexion", navigationRequested: true });
  const names = h.calls.map(call => call.factory);
  assert.ok(names.includes("createInrAssistantUiTools"));
  assert.ok(names.includes("createInrAssistantDiagnosticsTools"));
  assert.ok(names.includes("createInrAssistantWorkspaceTools"));
  assert.ok(!names.includes("createInrAssistantMediaTools"));
  assert.ok(!names.includes("createInrAssistantPublicationTools"));
  for (const { scope } of h.calls) {
    assert.equal(scope.accountId, h.context.args.accountId);
    if (scope.supabase) assert.equal(scope.supabase, h.context.args.supabase);
    if (scope.request) assert.equal(scope.request, h.context.args.request);
  }
  assert.deepEqual(h.executions, []);
});

test("a preview button context reaches the media factory as a target restriction and cannot supply save authority", () => {
  const h = harness(), mediaPreview = { requestId: "assistant_owned_preview", mediaId: "20000000-0000-4000-8000-000000000002" };
  h.context.args.clientContext = { source: "untrusted_client", mediaPreview, saveAuthorizedRequestIds: [mediaPreview.requestId] } as Registry.InrAssistantToolRegistryContext["args"]["clientContext"];
  h.build({ families: new Set(["media"]), latestRequest: "Save this preview to my media.", spokenRequest: "Save this preview to my media.", requiredTools: ["acceptMediaGeneration"] });
  const scope = h.calls.find(call => call.factory === "createInrAssistantMediaTools")!.scope;
  assert.deepEqual(scope.previewTarget, mediaPreview); assert.equal(Array.isArray(scope.saveAuthorizedRequestIds) && scope.saveAuthorizedRequestIds.includes(mediaPreview.requestId), false);
  assert.equal(scope.currentUserMessage, "Save this preview to my media."); assert.deepEqual(h.executions, []);
});

test("campaign advice retains scoped readers and never proposes a write", () => {
  const h = harness();
  const registry = h.build({ latestRequest: "Explique les boîtes expéditrices de campagne", canExecute: false, families: new Set(["workspace"]), requiredTools: ["readCampaignDeliveryStatus"] });
  assert.ok("listCampaignMailboxes" in registry.campaignTools);
  assert.ok("readCampaignDeliveryStatus" in registry.campaignTools);
  for (const name of ["selectCampaignMailbox", "previewCampaignAudience", "dispatchCampaignAudience"])
    assert.ok(!(name in registry.campaignTools));
  assert.deepEqual(h.executions, []);
  const campaignOnly = h.build({ latestRequest: "Prépare une campagne mail pour mes contacts CRM", families: new Set(["workspace"]), requiredTools: ["prepareCampaignEmail"] });
  assert.equal(Object.keys(campaignOnly.mailboxTools).length, 0, "Individual mail schemas do not consume a campaign request’s input budget");
});

test("media and publication callbacks preserve live deadlines, continuation flags and action identity", () => {
  const h = harness();
  h.context.args.taskContext = { version: 1, instruction: "Crée une image puis publie", actionRequestId: "server-action",
    startedAt: "2026-11-02T10:00:00Z", expiresAt: "2026-11-02T11:00:00Z", outcome: "processing",
    requiredTools: ["generateMedia", "executePublication"], receipts: [], question: "" };
  let remaining = 25_000;
  const started: string[] = [], media: unknown[] = [], publications: unknown[] = [];
  h.build({ families: new Set(["media", "publication"]), requiredTools: ["executePublication"], statusOnly: true,
    remainingTimeMs: () => remaining, onMediaStarted: id => started.push(id), onMediaResult: result => media.push(result), onPublicationResult: result => publications.push(result) });
  const mediaScope = h.calls.find(call => call.factory === "createInrAssistantMediaTools")!.scope;
  const publicationScope = h.calls.find(call => call.factory === "createInrAssistantPublicationTools")!.scope;
  assert.equal(mediaScope.requestId, "server-action");
  assert.equal(mediaScope.statusReadOnly, true);
  assert.equal(publicationScope.statusReadOnly, true);
  assert.equal((mediaScope.canStartWork as () => boolean)(), true);
  remaining = 20_000;
  assert.equal((mediaScope.canStartWork as () => boolean)(), false);
  assert.equal((publicationScope.canStartWork as () => boolean)(), true);
  remaining = 15_000;
  assert.equal((publicationScope.canStartWork as () => boolean)(), false);
  const result = { ok: true };
  (mediaScope.onWorkStarted as (id: string) => void)("existing-job");
  (mediaScope.onResult as (value: unknown) => void)(result);
  (publicationScope.onResult as (value: unknown) => void)(result);
  assert.deepEqual(started, ["existing-job"]);
  assert.equal(media[0], result);
  assert.equal(publications[0], result);
  const continued = harness();
  continued.context.args.taskContext = h.context.args.taskContext;
  continued.context.args.taskIntent = "continue";
  continued.context.args.actionRequestId = undefined;
  continued.build({ families: new Set(["media"]), statusOnly: true });
  const continuedScope = continued.calls.find(call => call.factory === "createInrAssistantMediaTools")!.scope;
  assert.equal(continuedScope.statusReadOnly, false);
  assert.equal(continuedScope.requestId, "server-turn");
});

test("a new registry cannot retain another account or its signed approval resolver", () => {
  const h = harness();
  const resolver = (reference: string) => reference === "IA-123456ABCDEF" ? "private-capability" : null;
  const first = h.build({ requiredTools: ["confirmCalendarAppointment"], spokenRequest: "Confirme IA-123456ABCDEF", resolvePreview: resolver });
  assert.ok(Object.hasOwn(first.calendarTools, "applyCalendarAction"));
  const initial = h.calls.find(call => call.factory === "createInrAssistantCalendarTools")!.scope;
  assert.equal(initial.actorUserId, "trusted-actor");
  assert.equal(initial.currentApprovalMessage, "Confirme IA-123456ABCDEF");
  assert.equal(initial.currentUserMessage, "Question");
  assert.equal(initial.resolvePreview, resolver);
  const second = h.build({ args: { ...h.context.args, accountId: "other-account", actorUserId: "other-actor" }, requiredTools: ["confirmCalendarAppointment"], spokenRequest: "oui" });
  assert.ok(!Object.hasOwn(second.calendarTools, "applyCalendarAction"));
  const other = h.calls.filter(call => call.factory === "createInrAssistantCalendarTools").at(-1)!.scope;
  assert.equal(other.accountId, "other-account");
  assert.equal(other.actorUserId, "other-actor");
  assert.notEqual(other.resolvePreview, resolver);
  assert.deepEqual(h.executions, []);
});

test("the registry keeps write gates while allowing scoped reader construction", () => {
  for (const changes of [
    { canExecute: false },
    { args: { ...harness().context.args, supabase: undefined } },
  ]) {
    const h = harness();
    const registry = h.build({ families: new Set(["publication"]), requiredTools: ["executePublication"], ...changes });
    assert.deepEqual(Object.keys(registry.publicationTools), []);
    if(changes.args) assert.ok(!h.calls.some(call => call.factory === "createInrAssistantPublicationTools"));
  }
});

test("invoice status and event reminder goals expose only their native scoped confirmation tools", () => {
  const h = harness();
  const message = "Marque la facture F-42 comme payée";
  assert.deepEqual(routing.inrAssistantRequiredTools(message), ["applyCommercialDocumentAction"]);
  assert.deepEqual(routing.inrAssistantRequiredTools("Refuse la demande de rendez-vous Alice"), ["rejectCalendarAppointment"]);
  assert.deepEqual(routing.inrAssistantRequiredTools("Désactive les rappels de ce rendez-vous"), ["updateCalendarAppointment"]);
  assert.deepEqual(routing.inrAssistantRequiredTools("Désactive les rappels par défaut de tous les rendez-vous"), ["updateToolSettings"]);
  assert.deepEqual(routing.inrAssistantRequiredTools("Ajoute alice@example.test aux invités du rendez-vous"), ["updateCalendarAppointment"]);
  for (const edition of ["basic", "standard", "premium", "founder"] as const) {
    const registry = h.build({ args: { ...h.context.args, edition }, latestRequest: message, requiredTools: ["applyCommercialDocumentAction"], families: new Set(["commercial"]) });
    assert.equal(Object.hasOwn(registry.additionalTools, "previewCommercialDocumentAction"), edition === "founder");
    assert.equal(Object.hasOwn(registry.additionalTools, "applyCommercialDocumentAction"), false);
  }
  const approved = h.build({ args: { ...h.context.args, edition: "founder" }, latestRequest: message, spokenRequest: "Confirme IA-123456ABCDEF", requiredTools: ["applyCommercialDocumentAction"] });
  assert.ok(Object.hasOwn(approved.additionalTools, "applyCommercialDocumentAction"));
  assert.deepEqual(h.executions, []);
});

test("advice can inspect CRM, campaign, scheduled publication and advertising readers without exposing their writes",()=>{
  const h=harness();
  const r=h.build({canExecute:false,families:new Set(["workspace","commercial","publication","advertising"]),latestRequest:"Pourquoi ma campagne mail ne fonctionne pas ? Vérifie mon CRM et mes publications programmées ainsi que mes ADS.",requiredTools:[]});
  assert.ok(r.workspaceActionTools.searchCrmContacts);
  assert.ok(r.communicationTools.readCommunicationRecords);
  assert.ok("readScheduledPublications" in r.scheduledTools);
  assert.ok("readAdvertisingCampaigns" in r.advertisingTools);
  assert.equal("manageCrmContact" in r.commercialTools,false);
  assert.equal("dispatchCampaignDraft" in r.communicationTools,false);
  assert.equal("manageAdvertisingCampaign" in r.advertisingTools,false);
  assert.deepEqual(h.executions,[]);
});

test("document templates expose a bounded reader while form preparation retains explicit goal, edition and actor gates", () => {
  const h = harness(), args = { ...h.context.args, edition: "founder" as const };
  const base = { args, families: new Set<Parameters<typeof h.build>[0] extends never ? never : "commercial">(["commercial"]), latestRequest: "Liste mes modèles de devis" };
  const read = h.build({ ...base, canExecute: false });
  assert.ok(Object.hasOwn(read.additionalTools, "readCommercialTemplates"));
  assert.ok(!Object.hasOwn(read.additionalTools, "prepareCommercialDocumentForm"));
  const prepare = h.build({ ...base, latestRequest: "Applique le modèle de devis", requiredTools: ["prepareCommercialDocumentForm"] });
  assert.ok(Object.hasOwn(prepare.additionalTools, "prepareCommercialDocumentForm"));
  for (const scope of [{ ...args, edition: "premium" as const }, { ...args, actorUserId: undefined }, { ...args, supabase: undefined }]) {
    const denied = h.build({ ...base, args: scope, requiredTools: ["prepareCommercialDocumentForm"] });
    assert.ok(!Object.hasOwn(denied.additionalTools, "prepareCommercialDocumentForm"));
    assert.ok(!Object.hasOwn(denied.additionalTools, "readCommercialTemplates"));
  }
  assert.deepEqual(h.executions, []);
});

test("saved template mutations use their own signed preview while current form templates use a browser handoff", () => {
  const h = harness(), args = { ...h.context.args, edition: "founder" as const };
  for (const instruction of ["Crée un modèle nommé Rénovation depuis le devis DEV-001.", "Supprime le modèle de devis Rénovation."])
    assert.deepEqual(routing.inrAssistantRequiredTools(instruction), ["applyCommercialTemplateAction"]);
  const preview = h.build({ args, families: new Set(["commercial"]), requiredTools: ["applyCommercialTemplateAction"] });
  assert.ok(Object.hasOwn(preview.additionalTools, "previewCommercialTemplateAction"));
  assert.ok(!Object.hasOwn(preview.additionalTools, "applyCommercialTemplateAction"));
  const approved = h.build({ args, requiredTools: ["applyCommercialTemplateAction"], spokenRequest: "Confirme IA-ABCDEF123456" });
  assert.ok(Object.hasOwn(approved.additionalTools, "applyCommercialTemplateAction"));
  const current = h.build({ args, requiredTools: ["prepareCurrentDocumentTemplate"] });
  assert.ok(Object.hasOwn(current.additionalTools, "prepareCurrentDocumentTemplate"));
  assert.ok(!Object.hasOwn(current.additionalTools, "applyCommercialTemplateAction"));
  assert.ok(!Object.hasOwn(h.build({ args, canExecute: false, requiredTools: ["prepareCurrentDocumentTemplate", "applyCommercialTemplateAction"] }).additionalTools, "prepareCurrentDocumentTemplate"));
});
