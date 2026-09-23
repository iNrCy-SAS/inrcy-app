import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getImageInteractionLinkHotspots,
  mergeImageInteractionOverlays,
  normalizeImageInteractions,
  transformImageInteractionsForLayout,
} from "../../lib/imageInteractions.ts";
import { computeImageCanvasLayout } from "../../lib/imageTransformGeometry.ts";

function interactions(items: Array<Record<string, unknown>>) {
  return normalizeImageInteractions({ version: 1, items })!;
}

function close(actual: number | undefined, expected: number, epsilon = 1e-7) {
  assert.equal(typeof actual, "number");
  assert.ok(
    Math.abs((actual as number) - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

const centered = {
  id: "cta",
  text: "Découvrir",
  linkUrl: "https://example.com/offre",
  x: 50,
  y: 50,
  width: 20,
  height: 20,
};

test("an identity canvas leaves every interaction exactly unchanged", () => {
  const source = interactions([centered]);
  const layout = computeImageCanvasLayout({
    canvasWidth: 1000,
    canvasHeight: 1000,
    imageWidth: 1000,
    imageHeight: 1000,
    transform: { fit: "contain", zoom: 1, offsetX: 0, offsetY: 0 },
  });
  const result = transformImageInteractionsForLayout(source, layout);

  assert.deepEqual(result, source);
  assert.equal("overlay" in (result || {}), false);
});

test("contain maps source rectangles inside letterbox padding", () => {
  const source = interactions([{ ...centered, width: 40 }]);
  const layout = computeImageCanvasLayout({
    canvasWidth: 1000,
    canvasHeight: 1000,
    imageWidth: 1600,
    imageHeight: 900,
    transform: { fit: "contain", zoom: 1, offsetX: 0, offsetY: 0 },
  });
  const item = transformImageInteractionsForLayout(source, layout)?.items[0];

  close(layout.drawWidth, 1000);
  close(layout.drawHeight, 562.5);
  close(layout.drawY, 218.75);
  close(item?.x, 50);
  close(item?.y, 50);
  close(item?.width, 40);
  close(item?.height, 11.25);
});

test("contain offsets move hotspots by the same available padding travel", () => {
  const source = interactions([centered]);
  const layout = computeImageCanvasLayout({
    canvasWidth: 1000,
    canvasHeight: 1000,
    imageWidth: 1600,
    imageHeight: 900,
    transform: { fit: "contain", zoom: 1, offsetX: 0, offsetY: 100 },
  });
  const item = transformImageInteractionsForLayout(source, layout)?.items[0];

  close(layout.drawY, 0);
  close(item?.y, 28.125);
  close(item?.height, 11.25);
});

test("cover clips partial rectangles and drops rectangles outside the canvas", () => {
  const source = interactions([
    { ...centered, id: "partial", x: 25, width: 20 },
    { ...centered, id: "outside", x: 5, width: 10 },
  ]);
  const layout = computeImageCanvasLayout({
    canvasWidth: 1000,
    canvasHeight: 1000,
    imageWidth: 1600,
    imageHeight: 900,
    transform: { fit: "cover", zoom: 1, offsetX: 0, offsetY: 0 },
  });
  const result = transformImageInteractionsForLayout(source, layout);

  assert.equal(result?.items.length, 1);
  assert.equal(result?.items[0]?.id, "partial");
  close(result?.items[0]?.x, 11.6666666667);
  close(result?.items[0]?.width, 23.3333333333);
  close(result?.items[0]?.y, 50);
  close(result?.items[0]?.height, 20);
});

test("a clipped hotspot keeps its exact sub-editor-minimum geometry through the web merge", () => {
  const merged = mergeImageInteractionOverlays({
    version: 1,
    items: [{
      ...centered,
      x: 1.25,
      width: 2.5,
      y: 4,
      height: 3,
    }],
  });
  const hotspot = getImageInteractionLinkHotspots(merged)[0];

  close(hotspot?.geometry?.x, 1.25);
  close(hotspot?.geometry?.width, 2.5);
  close(hotspot?.geometry?.y, 4);
  close(hotspot?.geometry?.height, 3);
});

test("zoom scales hotspot geometry with the rendered pixels", () => {
  const source = interactions([centered]);
  const containLayout = computeImageCanvasLayout({
    canvasWidth: 1000,
    canvasHeight: 1000,
    imageWidth: 1600,
    imageHeight: 900,
    transform: { fit: "contain", zoom: 0.5, offsetX: 0, offsetY: 0 },
  });
  const containItem = transformImageInteractionsForLayout(
    source,
    containLayout,
  )?.items[0];
  close(containItem?.width, 10);
  close(containItem?.height, 5.625);

  const coverLayout = computeImageCanvasLayout({
    canvasWidth: 1000,
    canvasHeight: 1000,
    imageWidth: 1600,
    imageHeight: 900,
    transform: { fit: "cover", zoom: 2, offsetX: 0, offsetY: 0 },
  });
  const coverItem = transformImageInteractionsForLayout(
    source,
    coverLayout,
  )?.items[0];
  close(coverItem?.width, 71.1111111111);
  close(coverItem?.height, 40);
});

test("browser and server publication paths persist transformed metadata without redrawing it", () => {
  const shared = readFileSync(
    "app/dashboard/booster/publier/publishModal.shared.tsx",
    "utf8",
  );
  const controller = readFileSync(
    "app/dashboard/booster/publier/usePublishImageController.ts",
    "utf8",
  );
  const publish = readFileSync(
    "app/dashboard/booster/publier/PublishModal.tsx",
    "utf8",
  );
  const server = readFileSync("lib/boosterImageServerPreparation.ts", "utf8");

  assert.match(shared, /transformImageInteractionsForLayout\(\s*imageMeta\?\.interactions,\s*layout/);
  assert.match(controller, /imageMeta:\s*payload\.imageMeta \|\| imageMeta/);
  assert.equal(
    (publish.match(/image\.imageMeta \|\|/g) || []).length,
    2,
    "immediate and scheduled uploads must keep rendered geometry",
  );
  assert.match(server, /imageMetaForRenderedCanvas/);
  assert.match(server, /transformImageInteractionsForLayout\(/);
  assert.doesNotMatch(server, /transformImageInteractionsForLayout\([\s\S]{0,180}overlay/);
});
