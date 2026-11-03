import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "../..");
const screens = {
  agenda: ["app/dashboard/agenda/AgendaClient.tsx", "AgendaClient", "rdvOpen,rdvSummary,rdvEventId,rdvMode,rdvRemindersEnabled,setRdvSummary,openCreateRdv,openEditRdv,selectedDate"],
  reviews: ["app/dashboard/e-reputation/EReputationReviewsClient.tsx", "EReputationReviewsClient", "replyText,selectedId,detailsOpen,refreshing,publishing,setReplyText,setPublishing,openDetails,items"],
  memory: ["app/dashboard/settings/_components/AiMemoryContent.tsx", "AiMemoryContent", "loaded,memory,analysisJob,analyzing,analysisProgress,workspaceSaving,autoSaveState,setField,setAnalysisProgress,discardAllWorkspaceChanges,saveWorkspace"],
} as const;

function compile(file: string, screen?: keyof typeof screens) {
  let source = readFileSync(path.join(root, file), "utf8");
  if (screen) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let component: ts.FunctionDeclaration | ts.FunctionExpression | undefined;
    const visit = (node: ts.Node) => {
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name?.text === screens[screen][1]) component = node;
      ts.forEachChild(node, visit);
    };
    visit(ast);
    const finalReturn = component?.body?.statements.findLast(ts.isReturnStatement);
    assert.ok(finalReturn, "Missing component return in " + file);
    // Keep the real component controller and every hook, replacing only its view.
    source = source.slice(0, finalReturn.getStart(ast)) + "window.screenState={" + screens[screen][2] + "}; return null;" + source.slice(finalReturn.end);
  }
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
}
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(name + "/package.json")), "cjs", file), "utf8");
const sources: Record<string, string> = {
  react: packageSource("react", "react.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"),
  "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  scheduler: packageSource("scheduler", "scheduler.production.js"),
};
for (const file of ["app/dashboard/agenda/agenda.shared.ts", "lib/inrCalendarGoogleSyncConstants.ts", "lib/visioAppointmentLifecycle.ts", "lib/aiMemory.ts", "lib/businessDnaRichText.ts", "lib/businessWeeklySchedule.ts", "lib/aiPromptBudget.ts", "lib/businessDnaManualAnalysisJob.ts", "lib/businessDnaChannelAvailability.ts", "lib/reconcileSavedDraft.ts", "app/dashboard/e-reputation/review-page-cache.ts"]) sources[file] = compile(file);

async function setup(page: Page, screen: keyof typeof screens, scenario = "") {
  await page.clock.install();
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.evaluate(({ bundled, screenFile, screenName, scenarioName }) => {
    Object.assign(window, { bundledSources: bundled, screenFile, screenName, scenario: scenarioName });
  }, { bundled: { ...sources, [screens[screen][0]]: compile(screens[screen][0], screen) }, screenFile: screens[screen][0], screenName: screen, scenarioName: scenario });
  await page.addScriptTag({ content: readFileSync(path.join(import.meta.dirname, "fixtures/reserved-screen-effects.js"), "utf8") });
  await page.waitForFunction("window.screenState || window.errors.length");
  assert.deepEqual(await page.evaluate("window.errors"), []);
}

test("agenda routed drafts survive settings hydration and request links do not reopen on form updates", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of ["new", "request"]) {
      const page = await browser.newPage();
      await setup(page, "agenda", scenario);
      await page.waitForFunction("window.screenState.rdvOpen && window.replaces.length === 1");
      await page.evaluate("window.screenState.setRdvSummary('Unsaved appointment')");
      await page.waitForFunction("window.screenState.rdvSummary === 'Unsaved appointment'");
      await page.evaluate("window.resolveSettings()");
      await page.waitForFunction("window.screenState.rdvRemindersEnabled === false");
      assert.equal(await page.evaluate("window.screenState.rdvSummary"), "Unsaved appointment");
      assert.equal(await page.evaluate("window.replaces.length"), 1);
      assert.deepEqual(await page.evaluate("window.errors"), []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("review refresh preserves a reply and keyboard navigation sees live busy and dirty state", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "reviews");
    await page.evaluate("window.screenState.openDetails(window.screenState.items[0])");
    await page.waitForFunction("window.screenState.detailsOpen");
    await page.evaluate("window.screenState.setReplyText('My unsaved reply')");
    await page.waitForFunction("window.screenState.replyText === 'My unsaved reply'");
    await page.evaluate("window.resolveReviews()");
    await page.waitForFunction("window.screenState.refreshing === false");
    assert.equal(await page.evaluate("window.screenState.replyText"), "My unsaved reply");
    await page.evaluate("window.screenState.setPublishing(true)");
    await page.waitForFunction("window.screenState.publishing");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate("window.screenState.selectedId"), "google:locations/a/reviews/a");
    await page.evaluate("window.screenState.setPublishing(false);window.allowConfirm=false");
    await page.waitForFunction("!window.screenState.publishing");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction("window.confirmations.length === 1");
    assert.equal(await page.evaluate("window.screenState.selectedId"), "google:locations/a/reviews/a");
    await page.evaluate("window.allowConfirm=true");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction("window.screenState.selectedId === 'google:locations/a/reviews/b'");
    assert.notEqual(await page.evaluate("window.screenState.replyText"), "My unsaved reply");
    assert.deepEqual(await page.evaluate("window.errors"), []);
  } finally { await browser.close(); }
});

test("ADN autosave survives unrelated renders, writes once and cancels a discarded draft", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "memory");
    await page.waitForFunction("window.screenState.loaded");
    await page.evaluate("window.screenState.setField('mission','New mission')");
    await page.waitForFunction("window.screenState.autoSaveState === 'scheduled'");
    await page.clock.runFor(900);
    await page.evaluate("window.screenState.setAnalysisProgress(9)");
    await page.waitForFunction("window.screenState.analysisProgress === 9");
    await page.clock.runFor(101);
    await page.waitForFunction("window.calls.filter(c=>c.method==='PUT').length === 1 && !window.screenState.workspaceSaving");
    await page.clock.runFor(2000);
    assert.equal(await page.evaluate("window.calls.filter(c=>c.method==='PUT').length"), 1);
    await page.evaluate("window.screenState.setField('mission','Discard this')");
    await page.waitForFunction("window.screenState.autoSaveState === 'scheduled'");
    await page.evaluate("window.screenState.discardAllWorkspaceChanges()");
    await page.clock.runFor(1200);
    assert.equal(await page.evaluate("window.screenState.memory.mission"), "New mission");
    assert.equal(await page.evaluate("window.calls.filter(c=>c.method==='PUT').length"), 1);
    assert.deepEqual(await page.evaluate("window.errors"), []);
  } finally { await browser.close(); }
});

test("ADN polling does not loop on equivalent job objects and stops after completion", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "memory", "poll");
    await page.waitForFunction("window.screenState.loaded && window.calls.filter(c=>c.url.endsWith('analyze-channels')).length === 2");
    await page.clock.runFor(2900);
    assert.equal(await page.evaluate("window.calls.filter(c=>c.url.endsWith('analyze-channels')).length"), 2);
    await page.evaluate("window.job={...window.job,status:'succeeded'};window.serverMemory={mission:'Analyzed mission'}");
    await page.clock.runFor(101);
    await page.waitForFunction("window.screenState.analysisJob.status === 'succeeded'");
    assert.equal(await page.evaluate("window.screenState.memory.mission"), "Analyzed mission");
    await page.clock.runFor(6000);
    assert.equal(await page.evaluate("window.calls.filter(c=>c.url.endsWith('analyze-channels')).length"), 3);
    assert.deepEqual(await page.evaluate("window.errors"), []);
  } finally { await browser.close(); }
});
