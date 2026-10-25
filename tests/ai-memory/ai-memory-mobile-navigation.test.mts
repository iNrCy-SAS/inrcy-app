import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../../app/dashboard/settings/_components/AiMemoryContent.tsx", import.meta.url),
  "utf8",
);

test("Business DNA exposes one compact mobile selector while retaining swipe navigation", () => {
  assert.match(source, /<DashboardMobileSelect[\s\S]*?value={activeTab}[\s\S]*?onChange={selectTab}[\s\S]*?disabled={voiceBusy}/);
  assert.doesNotMatch(source, /data-ai-memory-mobile-tabs|mobileTabArrowStyle/);
  assert.match(source, /onTouchStart=/);
  assert.match(source, /onTouchEnd=/);
  assert.match(source, /Math\.abs\(deltaX\) < 54/);
  assert.match(source, /@media \(max-width: 1100px\) \{\s*nav\[data-ai-memory-desktop-tabs\] \{ display: none !important; \}/);
});

const parsed = ts.createSourceFile("AiMemoryContent.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string) {
  let result: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) result = node;
    else ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(result?.initializer, name);
  return result.initializer.getText(parsed);
}
function evaluate(expression: string, globals: Record<string, unknown>) {
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, globals);
}

test("every DNA selector destination retains unsaved edits through the existing autosave handler", () => {
  const tabs = evaluate(declaration("tabs"), { t: (key: string) => key, profileLabel: "Profil" });
  assert.deepEqual(Array.from(tabs, (tab: { key: string }) => tab.key), ["analysis", "documents", "profile", "activity", "audience", "local", "identity", "news", "strategy"]);
  for (const target of tabs) {
    const events: string[] = [];
    const selectTab = evaluate(declaration("selectTab"), {
      voiceTargetRef: { current: null }, activeTab: "previous", hasWorkspaceChanges: true,
      saveWorkspace: ({ reason }: { reason: string }) => { events.push(`save:${reason}`); return Promise.resolve(); },
      changeTab: (key: string) => events.push(`tab:${key}`),
    });
    selectTab(target.key);
    assert.deepEqual(events, ["save:tab-change", `tab:${target.key}`]);
  }
});

test("DNA navigation remains locked during voice input and is a no-op for the current tab", () => {
  for (const voice of [null, "mission"]) {
    const events: string[] = [];
    const selectTab = evaluate(declaration("selectTab"), {
      voiceTargetRef: { current: voice }, activeTab: "analysis", hasWorkspaceChanges: true,
      saveWorkspace: () => events.push("save"), changeTab: () => events.push("change"),
    });
    selectTab(voice ? "documents" : "analysis");
    assert.deepEqual(events, []);
  }
});

test("AI configuration mobile options keep all three sections and the existing state handler", () => {
  const configuration = readFileSync(new URL("../../app/dashboard/settings/_components/AiConfigurationContent.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("AiConfigurationContent.tsx", configuration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let selector: ts.JsxSelfClosingElement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "DashboardMobileSelect") selector = node;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(selector);
  for (const busy of [false, true]) {
    const updates: string[] = [];
    const result = evaluate(selector.getText(file), {
      React: { createElement: (_tag: unknown, props: unknown) => props }, DashboardMobileSelect: "selector",
      activeTab: "parameters", configurationT: (key: string) => key, voiceBusy: busy,
      setActiveTab: (key: string) => updates.push(key),
    });
    assert.equal(result.disabled, busy);
    assert.equal(result.value, "parameters");
    assert.deepEqual(Array.from(result.options, (option: { value: string }) => option.value), ["parameters", "ctas", "instructions"]);
    if (!busy) for (const option of result.options) result.onChange(option.value);
    assert.deepEqual(updates, busy ? [] : ["parameters", "ctas", "instructions"]);
  }
  assert.match(configuration, /@media \(max-width: 1100px\) \{\s*nav\[data-ai-configuration-desktop-tabs\] \{ display: none !important; \}/);
});

test("mobile Business DNA channels wrap inside the analysis card", () => {
  assert.match(source, /\[data-business-dna-channel-states\][\s\S]*?flex-wrap: wrap !important/);
  assert.doesNotMatch(
    source.slice(source.indexOf("@media (max-width: 720px)")),
    /\[data-business-dna-channel-states\][\s\S]{0,220}flex-wrap: nowrap/,
  );
});

test("mobile DNA score keeps a dedicated gap above the illustration", () => {
  const mobileStyles = source.slice(source.indexOf("@media (max-width: 720px)"));

  assert.match(
    mobileStyles,
    /\[data-business-dna-analysis-orb\][\s\S]{0,220}height: 270px !important;[\s\S]{0,160}padding-top: 52px/,
  );
  assert.match(mobileStyles, /\[data-dna-score-summary\] \{ top: 6px !important; \}/);
  assert.match(mobileStyles, /\[data-dna-assembly\] \{ margin-top: 16px; \}/);
});
