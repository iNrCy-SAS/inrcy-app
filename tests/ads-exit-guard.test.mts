import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const client = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hook = ts.createSourceFile("useUnsavedExitGuard.ts", readFileSync(new URL("../app/dashboard/_hooks/useUnsavedExitGuard.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);

function find(source: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (predicate(node)) result = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(result);
  return result;
}

function evaluate(expression: string, scope: Record<string, unknown>) {
  const compiled = ts.transpileModule(`const actual = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn actual;`)(...Object.values(scope));
}

function actualFunction(source: ts.SourceFile, name: string, scope: Record<string, unknown>) {
  const node = find(source, (candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name);
  return evaluate(node.getText(source).replace(/^export\s+/, ""), scope);
}

function actualGuardOptions(scope: Record<string, unknown>) {
  const call = find(client, (node) => ts.isCallExpression(node) && node.expression.getText(client) === "useUnsavedExitGuard") as ts.CallExpression;
  return evaluate(call.arguments[0].getText(client), scope);
}

function guardHarness(state: { creating?: boolean; dirty: boolean; creationPath: string; busy: string | null }, accepted = true) {
  let closed = 0;
  let prompts = 0;
  const options = actualGuardOptions({ creating: true, ...state, closeCampaignCreation: () => { closed += 1; } });
  const runGuard = actualFunction(hook, "useUnsavedExitGuard", {
    useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useEffect: () => {},
    makeGuardId: () => "test", useDashboardUnsavedNavigation: () => ({ registerGuard: () => {} }),
    confirmInrcy: async () => { prompts += 1; return accepted; },
  });
  return { options, confirm: runGuard(options).confirmExit, counts: () => ({ closed, prompts }) };
}

test("une édition non enregistrée exige confirmation et Annuler conserve le parcours", async () => {
  for (const creationPath of ["manual", "inrcy"]) {
    const cancelled = guardHarness({ dirty: true, creationPath, busy: null }, false);
    assert.equal(cancelled.options.active, true);
    assert.equal(cancelled.options.shouldBlock, true);
    assert.equal(cancelled.options.variant, "danger");
    assert.equal(await cancelled.confirm(), false);
    assert.deepEqual(cancelled.counts(), { closed: 0, prompts: 1 });
    const accepted = guardHarness({ dirty: true, creationPath, busy: null });
    assert.equal(await accepted.confirm(), true);
    assert.deepEqual(accepted.counts(), { closed: 1, prompts: 1 });
  }
});

test("un brouillon enregistré et le choix initial quittent sans fausse alerte", async () => {
  for (const state of [
    { dirty: false, creationPath: "manual", busy: null },
    { dirty: false, creationPath: "inrcy", busy: null },
    { dirty: true, creationPath: "choice", busy: null },
  ]) {
    const run = guardHarness(state);
    assert.equal(run.options.shouldBlock, false);
    assert.equal(await run.confirm(), true);
    assert.deepEqual(run.counts(), { closed: 1, prompts: 0 });
  }
  assert.equal(guardHarness({ creating: false, dirty: true, creationPath: "manual", busy: null }).options.active, false);
});

test("sauvegarde et publication empêchent de quitter pendant l’envoi, l’analyse reste annulable", async () => {
  for (const busy of ["save", "demo"]) {
    const run = guardHarness({ dirty: false, creationPath: "inrcy", busy });
    assert.equal(run.options.shouldBlock, true);
    assert.equal(await run.confirm(), false);
    assert.deepEqual(run.counts(), { closed: 0, prompts: 0 });
  }
  const analysis = guardHarness({ dirty: false, creationPath: "inrcy", busy: "plan" });
  assert.equal(await analysis.confirm(), true);
  assert.deepEqual(analysis.counts(), { closed: 1, prompts: 1 });
});

test("quitter invalide une réponse d’analyse tardive sans réécrire le parcours fermé", async () => {
  for (const failure of [false, true]) {
    let complete!: (response: Response) => void;
    let reject!: (reason: Error) => void;
    const response = new Promise<Response>((resolve, rejectResponse) => { complete = resolve; reject = rejectResponse; });
    const writes: string[] = [];
    const scope: Record<string, unknown> = {
      planGenerationRevision: { current: 0 }, planResponseReceived: { current: false },
      planProgressTarget: { current: 0 }, planProgressValue: { current: 0 }, completedAnalysisStagesValue: { current: 0 },
      channelId: "google", draft: { destinationUrl: "https://example.test" }, analysisMode: "free", guidedAnalysisObjective: "",
      fetch: () => response, readJson: (result: Response) => result.json(),
      applyCampaignPlan: () => writes.push("apply"), startPlanProgress: () => {}, stopPlanProgress: () => {},
    };
    const functions = ["generateCampaignPlan", "closeCampaignCreation"];
    for (const name of functions) {
      const node = find(client, (candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name);
      for (const setter of node.getText(client).matchAll(/\b(set[A-Z]\w*)\(/g)) {
        scope[setter[1]] = () => writes.push(setter[1]);
      }
    }
    const generate = actualFunction(client, functions[0], scope);
    const close = actualFunction(client, functions[1], scope);
    const pending = generate();
    close();
    const writesAtClose = writes.length;
    if (failure) reject(new Error("Réponse tardive"));
    else complete(Response.json({ plan: { campaignType: "search", rationale: "Analyse terminée" } }));
    await pending;
    assert.equal(writes.length, writesAtClose);
    assert.equal(writes.includes("apply"), false);
  }
});

test("un changement de compte actif remonte AdsClient et isole ses caches", () => {
  const page = readFileSync(new URL("../app/dashboard/ads/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<AdsClient\s+key=\{accountScope\.activeUserId\}/);
});
