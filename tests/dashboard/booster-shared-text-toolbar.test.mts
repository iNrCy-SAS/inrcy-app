import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile(
  "PublishContentEditorPanel.tsx",
  readFileSync("app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx", "utf8"),
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX,
);

function callback(name: string, scope: Record<string, unknown>) {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, `Missing editor callback: ${name}`);
  const code = ts.transpileModule(`const callback = (${expression.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(scope), `${code}\nreturn callback;`)(...Object.values(scope));
}

test("content duplication and reporting stay available together in the footer for both creation modes", () => {
  const text = source.getFullText();
  const footer = text.slice(text.indexOf("const footerActions ="), text.indexOf("\n  return (", text.indexOf("const footerActions =")));
  assert.match(footer, /data-publish-content-footer-actions/);
  assert.match(footer, /<AiContentReportButton/);
  assert.doesNotMatch(footer, /creationMode === "ai"/);
  assert.match(footer, /\{duplicateAction\}/);
  assert.equal((text.match(/\{duplicateAction\}/g) || []).length, 1);
  assert.match(text, /data-publish-duplicate-action/);
  assert.match(text, /createPortal\(footerActions, actionsContainer\)/);
  assert.match(text, /disabled=\{displayCards\.length < 2 \|\| voiceBusy\}/);
  assert.match(text, /role=\{duplicateFeedback\.kind === "error" \? "alert" : "status"\}/);
  const css = readFileSync("app/dashboard/booster/publier/components/PublishContentEditorPanel.module.css", "utf8");
  assert.match(css, /\.duplicateButton\s*\{[^}]*white-space:\s*nowrap/);
});

test("shared formatting restores the last selection in the targeted field after toolbar keyboard focus", () => {
  for (const activeTextField of ["title", "content"]) {
    const calls: string[] = [];
    const titleNode = {};
    const contentNode = {};
    const ranges = { title: { commonAncestorContainer: titleNode }, content: { commonAncestorContainer: contentNode } };
    const editor = (field: "title" | "content", node: object) => ({
      focus: () => calls.push(`focus:${field}`),
      contains: (candidate: object) => candidate === node,
    });
    callback("applyActiveTextFormat", {
      activeTextField, activeCard: "site_web", voiceBusy: false, activeStoryOnly: false,
      isSiteDisplayKey: () => true,
      titleEditorRef: { current: editor("title", titleNode) },
      siteContentEditorRef: { current: editor("content", contentNode) },
      titleEmojiRangeRef: { current: ranges.title }, siteEmojiSelectionRef: { current: ranges.content },
      window: { getSelection: () => ({ removeAllRanges: () => calls.push("clear"), addRange: (range: unknown) => {
        assert.equal(range, ranges[activeTextField as "title" | "content"]);
        calls.push("restore");
      } }) },
      applyTitleFormat: (kind: string) => calls.push(`title:${kind}`),
      applySiteContentFormat: (kind: string) => calls.push(`content:${kind}`),
      rememberTextSelection: (field: string) => calls.push(`remember:${field}`),
    })("bold");
    assert.deepEqual(calls, [`focus:${activeTextField}`, "clear", "restore", `${activeTextField}:bold`, `remember:${activeTextField}`]);
  }
});

test("formatting cannot mutate social text, story-only text or an active voice target", () => {
  for (const restriction of [{ site: false }, { voiceBusy: true }, { activeStoryOnly: true }]) {
    callback("applyActiveTextFormat", {
      activeCard: "facebook", voiceBusy: false, activeStoryOnly: false,
      isSiteDisplayKey: () => restriction.site !== false,
      ...restriction,
      titleEditorRef: { get current() { throw new Error("Blocked formatting must not access an editor"); } },
    })("underline");
  }
});

test("moving keyboard focus outside the title preserves its stored rich-text selection", () => {
  const savedRange = {};
  const titleEmojiRangeRef = { current: savedRange };
  callback("saveTitleEmojiSelection", {
    activeCard: "site_web", isSiteDisplayKey: () => true,
    window: { getSelection: () => ({ rangeCount: 1, getRangeAt: () => ({ commonAncestorContainer: {} }) }) },
    titleEditorRef: { current: { contains: () => false } }, titleEmojiRangeRef,
  })();
  assert.equal(titleEmojiRangeRef.current, savedRange);
});

test("shared emoji insertion replaces the selected title or body text and restores the cursor", () => {
  for (const field of ["title", "content"]) {
    const patches: unknown[] = [];
    const cursorPositions: unknown[] = [];
    const input = { selectionStart: 0, selectionEnd: 0, focus: () => {}, setSelectionRange: (...args: unknown[]) => cursorPositions.push(args) };
    const selection = { current: { start: 6, end: 11 } };
    callback(field === "title" ? "insertTitleEmoji" : "insertEmoji", {
      activeCard: "facebook", isSiteDisplayKey: () => false,
      titleInputRef: { current: input }, contentTextAreaRef: { current: input },
      titleEmojiSelectionRef: selection, plainEmojiSelectionRef: selection,
      getDisplayPost: () => ({ title: "Hello world!", content: "Hello world!" }),
      updatePost: (_channel: string, patch: unknown) => patches.push(patch),
      window: { requestAnimationFrame: (run: () => void) => run() },
    })("✨");
    assert.deepEqual(patches, [{ [field]: "Hello ✨!" }]);
    assert.deepEqual(cursorPositions, [[7, 7]]);
    assert.deepEqual(selection.current, { start: 7, end: 7 });
  }
});
