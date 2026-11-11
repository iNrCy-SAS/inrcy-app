import assert from "node:assert/strict";
import test from "node:test";
import { generateText } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { bindInrAssistantUiSteps, inrAssistantUiStepResult, inrAssistantUiSteps, rebindInrAssistantUiStep, type InrAssistantUiStepResult } from "../../lib/inrAssistantUiTask.ts";
import { getInrAssistantNavigation } from "../../lib/inrAssistantUiCommands.ts";
import { resolveInrAssistantUiTaskResults } from "../../lib/inrAssistantUiTaskContinuation.ts";
import { verifiedInrAssistantUiCompletion, type InrAssistantVerifiedUiCompletionInput } from "../../lib/inrAssistantVerifiedUiCompletion.ts";
import { inrAssistantUiSuccessStatus, parseInrAssistantUiActions, type InrAssistantUiAction, type InrAssistantUiResult } from "../../lib/inrAssistantUiActions.ts";
import type { InrAssistantClientContext, InrAssistantClientScreen } from "../../lib/inrAssistantClientContext.ts";

const instruction = "Ouvre la médiathèque et affiche uniquement les images.";
const source1 = { turnId: "10000000-0000-4000-8000-000000000001", createdAt: "2026-11-11T08:00:00.000Z" };
const source2 = { ...source1, turnId: "10000000-0000-4000-8000-000000000002" };
const mounted: InrAssistantClientScreen = { pathname: "/dashboard/mediatheque", tool: "Mes médias", selection: { kind: "media", id: "library" }, revision: "library_1", availableCommands: ["configure_media_library"] };
const finalScreen = { ...mounted, revision: "library_2" };
const context = (screen: InrAssistantClientScreen): InrAssistantClientContext => ({ source: "untrusted_client", screen: structuredClone(screen) });
const postScreen = (screen: InrAssistantClientScreen) => ({ pathname: screen.pathname, selection: structuredClone(screen.selection!), revision: screen.revision! });

function fixture(): InrAssistantVerifiedUiCompletionInput {
  let steps = inrAssistantUiSteps(instruction, context({ pathname: "/dashboard", tool: "Accueil" }));
  assert.equal(steps.length, 2);
  const navigate: InrAssistantUiAction = { id: "open_library", type: "navigate", navigation: getInrAssistantNavigation("media")! };
  steps[0].actions = [navigate];
  steps = bindInrAssistantUiSteps(steps, [navigate], source1);
  const first: InrAssistantUiStepResult = { stepId: steps[0].id, status: "applied", postScreen: postScreen(mounted) };
  steps = rebindInrAssistantUiStep(steps, [first], context(mounted));
  const filter: InrAssistantUiAction = { id: "filter_library", type: "command", command: { command: "configure_media_library", selection: mounted.selection as { kind: "media"; id: string }, revision: mounted.revision!, patch: { typeFilter: "image" } } };
  steps[1].actions = [filter];
  steps = bindInrAssistantUiSteps(steps, [filter], source2);
  return { instruction, uiSteps: steps, verifiedResults: [first, { stepId: steps[1].id, status: "applied", postScreen: postScreen(finalScreen) }], clientContext: context(finalScreen), requiredTools: ["navigateApplication", "runScreenCommand"], objectives: [{ kind: "ui" }, { kind: "ui" }], receipts: [], hasIndependentWork: false };
}

test("the scoped immutable browser reader resolves both library ACKs and yields the exact native completion", async () => {
  const input = fixture();
  const byTurn = new Map(input.uiSteps.map((step, index) => [step.source!.turnId, { source: step.source!, uiActions: step.actions!, results: step.actions!.map(action => ({ actionId: action.id, source: "browser_reported", status: "applied", postScreen: input.verifiedResults[index].postScreen } satisfies InrAssistantUiResult)) }]));
  input.verifiedResults = await resolveInrAssistantUiTaskResults(input.uiSteps, async source => {
    const stored = byTurn.get(source.turnId)!; assert.deepEqual(source, stored.source); return stored;
  }, async (source, actions) => {
    const stored = byTurn.get(source.turnId)!; assert.deepEqual(actions, stored.uiActions); return stored.results;
  });
  assert.deepEqual(verifiedInrAssistantUiCompletion(input), { message: "La médiathèque est ouverte et le filtre Type : Images est appliqué.", completed: ["ouvrir la médiathèque", "appliquer le filtre Type : Images"] });
});

test("real SDK false prose cannot replace the deterministic summary of a wholly acknowledged UI task", async () => {
  const falseText = "Je ne peux pas ouvrir l’écran depuis cette conversation. Dans iNrCy, allez à Accueil puis à Médiathèque.";
  const model: LanguageModelV3 = { specificationVersion: "v3", provider: "offline-ui-probe", modelId: "fixture", supportedUrls: {},
    doGenerate: async () => ({ content: [{ type: "text", text: falseText }], finishReason: { unified: "stop", raw: "fixture" }, usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } }, warnings: [] }),
    doStream: async () => { throw new Error("No provider transport"); },
  };
  const generated = await generateText({ model, prompt: "Les deux actions d’écran ont reçu leur ACK vérifié." });
  assert.equal(generated.text, falseText);
  const confirmed = verifiedInrAssistantUiCompletion(fixture());
  assert.ok(confirmed); assert.notEqual(confirmed.message, generated.text);
  assert.doesNotMatch(confirmed.message, /impossible|ne peux|envoi|publication|sauvegard|enregistr|médias? trouvé/i);
});

test("every UI step needs its own applied server-bound ACK and unknown, duplicate or unbound results never complete", () => {
  for (const kind of ["pending", "failed", "cancelled", "missing", "unknown", "duplicate", "unbound", "no-actions", "no-post-screen", "wrong-action"] as const) {
    const input = fixture();
    if (["pending", "failed", "cancelled"].includes(kind)) input.verifiedResults[1].status = kind as "pending" | "failed" | "cancelled";
    if (kind === "missing") input.verifiedResults.pop();
    if (kind === "unknown") input.verifiedResults[1].stepId = "ui_9";
    if (kind === "duplicate") input.verifiedResults[1].stepId = input.verifiedResults[0].stepId;
    if (kind === "unbound") delete input.uiSteps[1].source;
    if (kind === "no-actions") delete input.uiSteps[1].actions;
    if (kind === "no-post-screen") delete input.verifiedResults[1].postScreen;
    if (kind === "wrong-action") input.uiSteps[1].actions = input.uiSteps[0].actions;
    assert.equal(verifiedInrAssistantUiCompletion(input), null, kind);
  }
});

test("changed screen, selection, revision, a foreign result target or unsaved edits leave native guards authoritative", () => {
  for (const kind of ["path", "selection", "revision", "dirty", "foreign-target", "missing-current"] as const) {
    const input = fixture(), screen = input.clientContext!.screen!;
    if (kind === "path") screen.pathname = "/dashboard/stats";
    if (kind === "selection") screen.selection = { kind: "media", id: "another_library" };
    if (kind === "revision") screen.revision = "manually_changed_revision";
    if (kind === "dirty") screen.pendingChanges = true;
    if (kind === "foreign-target") input.verifiedResults[1].postScreen!.selection = { kind: "media", id: "another_library" };
    if (kind === "missing-current") input.clientContext = null;
    assert.equal(verifiedInrAssistantUiCompletion(input), null, kind);
  }
});

test("independent file, advice, account read, mutation or business receipt cannot disappear behind UI completion", () => {
  for (const kind of ["explicit", "file", "read-objective", "action-objective", "tool", "receipt", "extra-clause", "inline-question", "inline-advice"] as const) {
    const input = fixture();
    if (kind === "explicit" || kind === "file") input.hasIndependentWork = true;
    if (kind === "read-objective") input.objectives = [...input.objectives, { kind: "read" }];
    if (kind === "action-objective") input.objectives = [...input.objectives, { kind: "action" }];
    if (kind === "tool") input.requiredTools = [...input.requiredTools, "readStatsSnapshots"];
    if (kind === "receipt") input.receipts = [{ tool: "sendIndividualMail" }];
    if (kind === "extra-clause") input.instruction += " Puis lis mes statistiques.";
    if (kind === "inline-question") input.instruction += " Combien sont-elles ?";
    if (kind === "inline-advice") input.instruction += " et recommande un moteur adapté";
    assert.equal(verifiedInrAssistantUiCompletion(input), null, kind);
  }
});

test("a different native filter never receives the Images success sentence or a guessed media count", () => {
  const input = fixture(), action = input.uiSteps[1].actions![0];
  assert.ok(action.type === "command" && action.command.command === "configure_media_library");
  input.instruction = input.instruction.replace("images", "vidéos");
  input.uiSteps[1].instruction = input.uiSteps[1].instruction.replace("images", "videos");
  action.command.patch = { typeFilter: "video" };
  const confirmed = verifiedInrAssistantUiCompletion(input);
  assert.equal(confirmed?.message, "2 étapes d’écran confirmées par le navigateur.");
  assert.doesNotMatch(confirmed!.message, /images|aucun|\b0\b|vidéo trouvée/i);
});

test("a browser download handoff is never described as an applied screen change or file received", () => {
  const input = fixture(), quote: InrAssistantClientScreen = { pathname: "/dashboard/devis/new", tool: "Devis", selection: { kind: "quote", id: "quote_1" }, revision: "quote_2", availableCommands: ["export_document_pdf"] };
  input.instruction = "Exporte ce devis en PDF.";
  const actions: InrAssistantUiAction[] = [{ id: "download", type: "command", command: { command: "export_document_pdf", selection: { kind: "quote", id: "quote_1" }, revision: "quote_2" } }];
  assert.ok(parseInrAssistantUiActions(actions)); assert.equal(inrAssistantUiSuccessStatus(actions[0]), "handed_to_browser");
  const steps = inrAssistantUiSteps(input.instruction, context(quote)); assert.equal(steps.length, 1); steps[0].actions = actions;
  input.uiSteps = bindInrAssistantUiSteps(steps, actions, source1);
  input.verifiedResults = [inrAssistantUiStepResult(input.uiSteps[0], [{ actionId: "download", source: "browser_reported", status: "handed_to_browser" }])];
  assert.equal(input.verifiedResults[0].status, "applied", "The resolver normalizes a valid handoff into completion bookkeeping, not file receipt");
  input.clientContext = context(quote); input.requiredTools = ["runScreenCommand"]; input.objectives = [{ kind: "ui" }];
  assert.equal(verifiedInrAssistantUiCompletion(input), null);
});

test("another completed native view receives only a sober screen acknowledgement without business claims", () => {
  const input = fixture(), stats: InrAssistantClientScreen = { pathname: "/dashboard/stats", tool: "iNr’Stats", selection: { kind: "stats", id: "stats" }, revision: "stats_1", availableCommands: ["configure_stats_view"] };
  input.instruction = "Affiche la vue Évolution des statistiques.";
  const steps = inrAssistantUiSteps(input.instruction, context(stats)); assert.equal(steps.length, 1);
  const actions: InrAssistantUiAction[] = [{ id: "view", type: "command", command: { command: "configure_stats_view", selection: { kind: "stats", id: "stats" }, revision: "stats_1", patch: { panel: "evolution" } } }];
  steps[0].actions = actions; input.uiSteps = bindInrAssistantUiSteps(steps, actions, source1);
  const current = { ...stats, revision: "stats_2" };
  input.verifiedResults = [{ stepId: steps[0].id, status: "applied", postScreen: postScreen(current) }]; input.clientContext = context(current); input.requiredTools = ["runScreenCommand"]; input.objectives = [{ kind: "ui" }];
  assert.equal(verifiedInrAssistantUiCompletion(input)?.message, "1 étape d’écran confirmée par le navigateur.");
});

test("action identities retain their signed turn scope when successive native edits reuse a tool-call ID", () => {
  const input = fixture();
  input.instruction = "Affiche uniquement les images puis affiche uniquement les vidéos.";
  let steps = inrAssistantUiSteps(input.instruction, context(mounted)); assert.equal(steps.length, 2);
  const first: InrAssistantUiAction = { id: "same_call", type: "command", command: { command: "configure_media_library", selection: { kind: "media", id: "library" }, revision: "library_1", patch: { typeFilter: "image" } } };
  steps[0].actions = [first]; steps = bindInrAssistantUiSteps(steps, [first], source1);
  const firstResult: InrAssistantUiStepResult = { stepId: steps[0].id, status: "applied", postScreen: postScreen(finalScreen) };
  steps = rebindInrAssistantUiStep(steps, [firstResult], context(finalScreen));
  const second: InrAssistantUiAction = { id: "same_call", type: "command", command: { command: "configure_media_library", selection: { kind: "media", id: "library" }, revision: "library_2", patch: { typeFilter: "video" } } };
  steps[1].actions = [second]; steps = bindInrAssistantUiSteps(steps, [second], source2);
  const current = { ...finalScreen, revision: "library_3" };
  input.uiSteps = steps; input.clientContext = context(current); input.verifiedResults = [firstResult, { stepId: steps[1].id, status: "applied", postScreen: postScreen(current) }];
  assert.equal(verifiedInrAssistantUiCompletion(input)?.message, "2 étapes d’écran confirmées par le navigateur.");
  input.uiSteps[1].source = input.uiSteps[0].source;
  assert.equal(verifiedInrAssistantUiCompletion(input), null, "The same ID within the same immutable source is still not two distinct actions");
});

test("UI confirmations are display facts and cannot repair missing or changed immutable server replay", async () => {
  const input = fixture();
  await assert.rejects(resolveInrAssistantUiTaskResults(input.uiSteps, async () => null, async () => []), /unavailable/);
  await assert.rejects(resolveInrAssistantUiTaskResults(input.uiSteps, async () => ({ uiActions: [] }), async () => []), /unavailable/);
});

test("a settings panel closed at the same route and revision cannot reuse the earlier open-panel proof", () => {
  const input = fixture();
  input.instruction = "Ouvre les réglages de l’Agent Publications.";
  const navigation = getInrAssistantNavigation("publication_agent_settings")!;
  const actions: InrAssistantUiAction[] = [{ id: "settings", type: "navigate", navigation }];
  const steps = inrAssistantUiSteps(input.instruction); steps[0].actions = actions;
  input.uiSteps = bindInrAssistantUiSteps(steps, actions, source1);
  const screen: InrAssistantClientScreen = { pathname: navigation.href, tool: "Agent Publications", selection: { kind: "publication", id: "agent_publish" }, revision: "settings_2", agentSettings: "publish" };
  input.clientContext = context(screen); input.verifiedResults = [{ stepId: steps[0].id, status: "applied", postScreen: { ...postScreen(screen), agentSettings: "publish" } }]; input.requiredTools = ["navigateApplication"]; input.objectives = [{ kind: "ui" }];
  assert.ok(verifiedInrAssistantUiCompletion(input));
  delete input.clientContext!.screen!.agentSettings;
  assert.equal(verifiedInrAssistantUiCompletion(input), null);
});
