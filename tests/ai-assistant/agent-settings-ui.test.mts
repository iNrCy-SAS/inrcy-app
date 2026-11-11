import assert from "node:assert/strict";
import test from "node:test";
import { getInrAssistantAgentSettingsRequest } from "../../lib/inrAssistantAgentSettingsUi.ts";
import { openInrAssistantAgentSettingsAfterNavigation } from "../../lib/inrAssistantAgentSettingsNavigation.ts";
import { getDirectInrAssistantNavigationRequest, getInrAssistantNavigation, getPureInrAssistantNavigationRequest } from "../../lib/inrAssistantUiCommands.ts";
import { inrAssistantUiSteps } from "../../lib/inrAssistantUiTask.ts";
import { inrAssistantRequiredTools } from "../../lib/inrAssistantTaskPolicy.ts";
import { inrAssistantUiPostScreenMatchesAction, parseInrAssistantUiPostScreen } from "../../lib/inrAssistantUiPostScreen.ts";
import { registerInrAssistantLocalInterface, runInrAssistantLocalInterface, type InrAssistantLocalInterfaceRegistration } from "../../lib/inrAssistantLocalInterface.ts";
import type { InrAssistantClientScreen } from "../../lib/inrAssistantClientContext.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const actual = ["Ouvre les réglages de l’agent Publications pour que je puisse les consulter. Ne modifie rien et ne lance aucune publication.", "Dans l’Agent Publications déjà ouvert, affiche maintenant le panneau Réglages. Ne change aucune valeur."];
const scope = { actorUserId: "settings_actor", accountId: "settings_account", pathname: "/dashboard/agent/publications" };
const base: InrAssistantClientScreen = { pathname: scope.pathname, tool: "Agent Publications" };
const visible: InrAssistantClientScreen = { ...base, selection: { kind: "publication", id: "agent_publish" }, revision: "settings_open_2", agentSettings: "publish" };

test("both actual Standard requests resolve the settings panel rather than Agents IA or a settings mutation", () => {
  for (const prompt of actual) {
    assert.deepEqual(getInrAssistantAgentSettingsRequest(prompt), { agent: "publish", operation: "open" });
    assert.equal(getDirectInrAssistantNavigationRequest(prompt)?.destination, "publication_agent_settings");
    assert.equal(getPureInrAssistantNavigationRequest(prompt)?.destination, "publication_agent_settings");
    assert.deepEqual(inrAssistantRequiredTools(prompt), []);
    const steps = inrAssistantUiSteps(prompt, { source: "untrusted_client", screen: base });
    assert.equal(steps.length, 1); assert.equal(steps[0].command, "navigateApplication");
  }
  assert.equal(getDirectInrAssistantNavigationRequest("Ouvre les réglages de l’Agent Stats.")?.destination, "stats_agent_settings");
  assert.deepEqual(getInrAssistantAgentSettingsRequest("Ferme les réglages de l’Agent Publications."), { agent: "publish", operation: "close" });
  for (const prompt of ["Ne ferme pas les réglages de l’Agent Publications.", "Si Julie confirme, ouvre les réglages de l’Agent Publications.", "Le client dit « ouvre les réglages de l’Agent Publications ».", "Comment ouvrir les réglages de l’Agent Publications ?"]) assert.equal(getInrAssistantAgentSettingsRequest(prompt), null, prompt);
  assert.equal(getPureInrAssistantNavigationRequest(`${actual[0]} Puis lis mes statistiques.`), null, "A separate read remains independent");
  assert.equal(getPureInrAssistantNavigationRequest(`${actual[0]} Puis publie une image sur Facebook.`), null, "A separate publication remains independent");
  assert.equal(getPureInrAssistantNavigationRequest("Ouvre les réglages de l’agent Publications pour consulter mes statistiques."), null, "A different consultation purpose is not silently removed");
});

test("the exact Premium CRM purpose and denial of writes remain a pure scoped navigation", () => {
  const prompt = "Ouvre iNr’CRM pour consulter la liste. Ne crée et ne modifie aucune fiche.";
  assert.equal(getDirectInrAssistantNavigationRequest(prompt)?.destination, "crm");
  assert.equal(getPureInrAssistantNavigationRequest(prompt)?.destination, "crm");
  assert.equal(inrAssistantUiSteps(prompt).at(0)?.command, "navigateApplication");
  assert.equal(getPureInrAssistantNavigationRequest(`${prompt} Puis crée une fiche Alice.`), null);
});

test("a settings navigation ACK needs its exact committed panel proof, never a page-only mount", () => {
  const action = { id: "settings", type: "navigate" as const, navigation: getInrAssistantNavigation("publication_agent_settings")! };
  const committed = parseInrAssistantUiPostScreen(visible); assert.ok(committed);
  assert.equal(inrAssistantUiPostScreenMatchesAction(action, committed), true);
  for (const changed of [{ ...committed, agentSettings: undefined }, { ...committed, agentSettings: "stats" as const }, { ...committed, pathname: "/dashboard/agent/stats" }, { ...committed, selection: { kind: "publication" as const, id: "other_agent" } }]) assert.equal(inrAssistantUiPostScreenMatchesAction(action, changed), false);
});

test("the native bridge waits for the real settings callback and committed panel while preserving a cancelled dirty confirmation", async () => {
  let screen = base, resolveDecision: (accept: boolean) => void = () => {}, calls = 0;
  const native: InrAssistantLocalInterfaceRegistration = { ...scope, id: "agent_settings", revision: "closed_1", snapshot: { open: false }, handlers: { open: {
    invoke: async (_value, valid) => { calls++; const accepted = await new Promise<boolean>(resolve => { resolveDecision = resolve; }); if (!accepted || !valid()) throw new Error("native_exit_cancelled"); screen = visible; registerInrAssistantLocalInterface("settings_bridge", { ...native, revision: "open_2", snapshot: { open: true }, handlers: { close: { invoke() {}, matches: () => false } } }); },
    matches: snapshot => snapshot !== null && typeof snapshot === "object" && "open" in snapshot && snapshot.open === true,
  } } };
  registerInrAssistantLocalInterface("settings_bridge", native);
  try {
    let settled = false;
    const pending = openInrAssistantAgentSettingsAfterNavigation("publication_agent_settings", scope, () => screen, () => true).then(value => { settled = true; return value; });
    await Promise.resolve(); assert.equal(calls, 1); assert.equal(settled, false); assert.equal(screen.agentSettings, undefined);
    resolveDecision(false); assert.equal(await pending, null); assert.equal(screen.agentSettings, undefined);
    const accepted = openInrAssistantAgentSettingsAfterNavigation("publication_agent_settings", scope, () => screen, () => true);
    await Promise.resolve(); resolveDecision(true); assert.equal((await accepted)?.agentSettings, "publish");
  } finally { registerInrAssistantLocalInterface("settings_bridge", null); }
});

test("an unavailable control, foreign scope, stale revision or page-only callback cannot produce a settings ACK", async () => {
  assert.equal(await openInrAssistantAgentSettingsAfterNavigation("publication_agent_settings", scope, () => base, () => true, 0), null);
  let calls = 0;
  const native: InrAssistantLocalInterfaceRegistration = { ...scope, id: "agent_settings", revision: "closed_1", snapshot: { open: false }, handlers: { open: { invoke: () => { calls++; }, matches: () => true, immediate: true } } };
  registerInrAssistantLocalInterface("settings_refusal", native);
  try {
    assert.equal(await openInrAssistantAgentSettingsAfterNavigation("publication_agent_settings", { ...scope, accountId: "foreign" }, () => base, () => true, 0), null);
    assert.equal(await openInrAssistantAgentSettingsAfterNavigation("stats_agent_settings", scope, () => base, () => true, 0), null);
    assert.equal(await openInrAssistantAgentSettingsAfterNavigation("publication_agent_settings", scope, () => base, () => false, 0), null);
    assert.equal(calls, 0);
    assert.equal(await runInrAssistantLocalInterface({ command: "control_local_interface", selection: { kind: "account_document", id: "agent_settings" }, operation: "open", revision: "stale", value: null }, scope, () => true), false);
    assert.equal(await openInrAssistantAgentSettingsAfterNavigation("publication_agent_settings", scope, () => base, () => true, 0), null);
    assert.equal(calls, 1, "A callback invocation alone cannot claim a visible settings panel");
  } finally { registerInrAssistantLocalInterface("settings_refusal", null); }
});

test("the server local control authenticates its actor and never accepts a value or a settings mutation", async () => {
  let actor = scope.actorUserId;
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: scope.accountId, authUserId: actor }) } });
  const runtime = load<typeof import("../../lib/inrAssistantLocalInterfaceTools.ts")>("lib/inrAssistantLocalInterfaceTools.ts");
  const prompt = "Ferme les réglages de l’Agent Publications.";
  const tool = runtime.createInrAssistantLocalInterfaceTools({ accountId: scope.accountId, actorUserId: scope.actorUserId, currentUserMessage: prompt, clientContext: { source: "untrusted_client", screen: visible, interfaces: [{ id: "agent_settings", revision: "settings_1", operations: ["close"] }] } }).controlLocalInterface;
  const input = { interface: "agent_settings" as const, operation: "close" as const, revision: "settings_1", instructionQuote: prompt, value: null };
  assert.equal((await tool.execute!(input, {} as never) as { status: string }).status, "ui_action_requested");
  actor = "foreign"; assert.equal((await tool.execute!(input, {} as never) as { status: string }).status, "blocked");
  actor = scope.actorUserId; assert.equal((await tool.execute!({ ...input, value: "enabled:true" }, {} as never) as { status: string }).status, "navigation_required");
});
