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
  "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
);
const videoAdapter = read(
  "app/dashboard/booster/publier/components/PublishVideoAdapterPanel.tsx",
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
  assert.doesNotMatch(publishModal, /\[ctaDefaults, postsByChannel\]/);
  assert.match(publishModal, /\}, \[ctaDefaults\]\);/);
});

test("block 4 exposes scoped media removal and global video removal", () => {
  assert.match(publishModal, /removeVideo=\{removeVideo\}/);
  assert.match(imagesPanel, /removeVideo: \(\) => void/);
  assert.match(imagesPanel, /onDeleteVideo=\{removeVideo\}/);
  assert.match(videoAdapter, /onClick=\{onDeleteVideo\}/);
  assert.match(publishModal, /removeMediaFromChannel/);
  assert.match(imagesPanel, /onRemoveMediaFromChannel/);
  assert.match(videoAdapter, /onRemoveMediaFromChannel/);
  assert.match(videoAdapter, /i18nT\("retirer_de_ce_canal_76fbf864"\)/);
  assert.match(videoAdapter, /i18nT\("supprimer_partout_dfb790c4"\)/);
  assert.match(videoAdapter, /onRetouchVideo\(activeChannel\)/);
  assert.doesNotMatch(videoAdapter, /BoosterVideoFormatManager/);
});

test("a scoped removal keeps an explicit empty media mode", () => {
  assert.match(publishModal, /if \(explicit === "none"\) return "none"/);
  assert.match(imagesPanel, /if \(explicit === "none"\) return "none"/);
  assert.match(publishModal, /current === "none" \|\|/);
});
