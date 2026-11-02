import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as routing from "../../lib/inrAssistantToolRouting.ts";
import type * as Registry from "../../lib/inrAssistantToolRegistry.ts";

type Scope = Record<string, unknown>;
function harness() {
  const calls: Array<{ factory: string; scope: Scope }> = [];
  const executions: string[] = [];
  const source = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantToolRegistry.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`)((name: string) => {
    if (name === "server-only") return {};
    if (name === "./inrAssistantToolRouting.ts") return routing;
    const match = name.match(/^\.\/(inrAssistant\w+Tools)\.ts$/);
    assert.ok(match, `Unexpected registry dependency ${name}`);
    const factory = `createI${match[1].slice(1)}`;
    return { [factory]: (scope: Scope) => {
      calls.push({ factory, scope });
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
    assert.equal(Object.keys(registry.publicationTools).length, 0);
    if(changes.args) assert.ok(!h.calls.some(call => call.factory === "createInrAssistantPublicationTools"));
  }
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
