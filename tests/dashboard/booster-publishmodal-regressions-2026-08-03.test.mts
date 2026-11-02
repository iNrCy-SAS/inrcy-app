import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const contentEditor = read(
  "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
);
const imagesPanel = read(
  "app/dashboard/booster/publier/components/PublishMediaPoolPanel.tsx",
);

test("channel titles keep raw spaces while the user is typing", () => {
  const source = ts.createSourceFile("editor.tsx", contentEditor, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let onChange: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "TitleControl") {
      const prop = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(source) === "onChange");
      if (prop && ts.isJsxAttribute(prop) && prop.initializer && ts.isJsxExpression(prop.initializer)) onChange = prop.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(onChange);
  const javascript = ts.transpileModule(`const handler = ${onChange.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const changes: unknown[] = [];
  const handler = new Function("updatePost", "activeCard", `${javascript}\nreturn handler;`)(
    (...args: unknown[]) => changes.push(args), "threads",
  );
  handler({ target: { value: "  Un titre avec  des espaces " } });
  handler({ target: { value: "Un titre\r\ncollé sur\nplusieurs lignes" } });
  assert.deepEqual(changes, [
    ["threads", { title: "  Un titre avec  des espaces " }, { sanitize: false }],
    ["threads", { title: "Un titre collé sur plusieurs lignes" }, { sanitize: false }],
  ]);
  assert.doesNotMatch([publishModal, submission].join("\n"), /\[ctaDefaults, postsByChannel\]/);
  assert.match(publishModal, /\}, \[ctaDefaults\]\);/);
});

test("the mounted media pool and validation board separate global and per-channel removal", () => {
  const validationBoard = read("app/dashboard/booster/publier/components/PublishValidationBoard.tsx");
  assert.match(publishModal, /onRemoveVideo=\{removeVideo\}/);
  assert.match(imagesPanel, /onRemoveVideo: \(\) => void/);
  assert.match(imagesPanel, /onClick=\{\(\) => \{ setVideoActionsOpen\(true\); onRemoveVideo\(\); \}\}/);
  assert.match(validationBoard, /onModeChange\(item\.channel,\s*"none"\)/);
  assert.match(publishModal, /if \(mode === "none"\) removeMediaFromChannel\(channel\)/);
  assert.match(validationBoard, /wizard_remove_channel_video/);
  assert.match(imagesPanel, /wizard_pool_remove_video/);
  assert.match(imagesPanel, /onClick=\{onRetouchVideo\}/);
});

test("a scoped removal keeps an explicit empty media mode", () => {
  assert.match(publishModal, /if \(explicit === "none"\) return "none"/);
  assert.match(publishModal, /getMode=\{resolveChannelMediaMode\}/);
  assert.match(publishModal, /current === "none" \|\|/);
});
