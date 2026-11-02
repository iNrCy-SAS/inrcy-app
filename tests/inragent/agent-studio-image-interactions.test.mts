import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { mediaPatchFromLibraryItem } from "../../app/dashboard/agent/_lib/agent.publish-media-foundations.ts";
import { imageInteractionsFromOverlay } from "../../lib/imageInteractions.ts";

const interactions = imageInteractionsFromOverlay({
  items: [
    {
      id: "details",
      text: "Voir les détails",
      linkUrl: "https://example.test/details",
      x: 42,
      y: 63,
      width: 36,
      height: 14,
    },
  ],
});

test("iNrAgent action patch keeps Studio links as interaction-only metadata", () => {
  const patch = mediaPatchFromLibraryItem({
    id: "studio-image",
    bucket_name: "inrcy-pro-media",
    storage_path: "account/studio-image.jpg",
    media_type: "image",
    mime_type: "image/jpeg",
    size_bytes: 123,
    title: "Studio image",
    tags: null,
    width: 1200,
    height: 800,
    duration_seconds: null,
    created_at: null,
    signed_url: "https://example.test/studio-image.jpg",
    image_interactions: interactions,
  });

  assert.deepEqual(patch.image_interactions, interactions);
  assert.deepEqual(patch.imageMeta?.interactions, interactions);
  assert.equal(patch.imageMeta?.ratio, 1.5);
  assert.equal("transform" in patch, false);
});

test("agent execution preserves interactions through every image source branch", () => {
  const draftFoundations = readFileSync(
    "app/api/agent/actions/actionPublishDraft.foundations.ts",
    "utf8",
  );
  const execute = readFileSync(
    "app/api/agent/actions/execute/route.ts",
    "utf8",
  );
  const preparation = readFileSync(
    "lib/boosterImageServerPreparation.ts",
    "utf8",
  );

  assert.match(
    draftFoundations,
    /getMediaImageInteractions\(record\)[\s\S]*?\{ imageMeta \}/,
  );
  assert.match(
    draftFoundations,
    /\{ image_interactions: imageInteractions \}/,
  );
  assert.match(
    execute,
    /normalizeImageInteractions\(imageMeta\.interactions\)[\s\S]*?getMediaImageInteractions\(media\)/,
  );
  assert.equal(
    (execute.match(/\.\.\.preservedImageMeta/g) || []).length,
    3,
  );
  assert.match(
    preparation,
    /imageMeta: mergeImageMeta\(entry\.image\.imageMeta, entry\.meta\)/,
  );
});


test("historical Studio return is consumed once and removes only its URL parameter across rerenders", () => {
  const file = ts.createSourceFile("AgentClient.tsx", readFileSync("app/dashboard/agent/AgentClient.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let event: ts.Expression | undefined, effect: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "onHistoricalStudioReturn" && node.initializer && ts.isCallExpression(node.initializer)) event = node.initializer.arguments[0];
    if (ts.isCallExpression(node) && node.expression.getText(file) === "useEffect" && node.arguments[0]?.getText(file).includes("historicalStudioReturnHandledRef")) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(file); assert.ok(event && effect);
  const code = ts.transpileModule(`const onHistoricalStudioReturn = (${event.getText(file)}); (${effect.getText(file)})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const consumed: string[] = [], applied: unknown[] = [], urls: string[] = [];
  const scope = {
    historicalStudioReturnHandledRef: { current: false },
    window: { location: { search: "?studio_return=result-key&other=kept", pathname: "/dashboard/agent", hash: "#media" }, history: { state: {}, replaceState: (_state: unknown, _title: string, url: string) => urls.push(url) } },
    consumeInrStudioReturn: (key: string) => { consumed.push(key); return { item: { id: "media" } }; },
    showNotice: () => assert.fail("a valid return must not show an error"), i18nT: (key: string) => key,
    applyInrStudioReturn: (value: unknown) => applied.push(value),
  };
  for (let render = 0; render < 3; render++) new Function(...Object.keys(scope), code)(...Object.values(scope));
  assert.deepEqual(consumed, ["result-key"]);
  assert.equal(applied.length, 1);
  assert.deepEqual(urls, ["/dashboard/agent?other=kept#media"]);
});
