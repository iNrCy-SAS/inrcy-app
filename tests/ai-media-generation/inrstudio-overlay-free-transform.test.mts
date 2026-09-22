import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  normalizeImageOverlay,
  resolveImageOverlayCoordinates,
} from "../../lib/imageOverlay.ts";

function read(relativePath: string) {
  return readFileSync(path.resolve(relativePath), "utf8");
}

const modal = read(
  "app/dashboard/_components/channel-image-adapter/modal.tsx",
);
const frames = read(
  "app/dashboard/_components/channel-image-adapter/frames.tsx",
);
const clientRenderer = read("lib/mediaRetoucherRenderClient.ts");
const serverRenderer = read("lib/boosterImageServerPreparation.ts");

test("ImageOverlay conserve les anciennes positions et borne la géométrie libre", () => {
  assert.deepEqual(resolveImageOverlayCoordinates({ text: "Avant", position: "top" }), {
    x: 50,
    y: 12,
  });
  assert.deepEqual(
    resolveImageOverlayCoordinates({ text: "Avant", position: "bottom" }),
    { x: 50, y: 88 },
  );

  const overlay = normalizeImageOverlay({
    text: "Offre spéciale",
    x: 140,
    y: -20,
    width: 4,
    height: 130,
  });
  assert.equal(overlay?.x, 100);
  assert.equal(overlay?.y, 0);
  assert.equal(overlay?.width, 16);
  assert.equal(overlay?.height, 92);
});

test("l'atelier déplace et redimensionne le bandeau à la souris comme au tactile", () => {
  assert.match(modal, /data-image-overlay="true"/);
  assert.match(modal, /beginOverlayGesture\(event, "move"\)/);
  assert.match(modal, /beginOverlayGesture\(event, "resize"\)/);
  assert.match(modal, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(modal, /touchAction:\s*"none"/);
  assert.match(modal, /aria-label="Redimensionner le bandeau"/);
  assert.doesNotMatch(modal, /retoucher_position_top/);
  assert.doesNotMatch(modal, /retoucher_position_bottom/);
});

test("les aperçus et les rendus client et serveur respectent position et dimensions", () => {
  assert.match(frames, /resolveImageOverlayCoordinates\(overlay\)/);
  assert.match(frames, /width:\s*`\$\{overlay\.width \?\? 84\}%`/);
  assert.match(frames, /height:\s*overlay\.height/);

  for (const renderer of [clientRenderer, serverRenderer]) {
    assert.match(renderer, /resolveImageOverlayCoordinates\(overlay\)/);
    assert.match(renderer, /overlay\.width/);
    assert.match(renderer, /overlay\.height/);
  }
  assert.match(clientRenderer, /blockX \+ blockWidth \/ 2/);
  assert.match(serverRenderer, /panelX \+ panelWidth \/ 2/);
});

test("sans sidebar le desktop utilise deux colonnes et ne rend aucune colonne vide", () => {
  assert.match(modal, /const hasSidebar = Boolean\(sidebarItems\?\.length\)/);
  assert.match(
    modal,
    /!isMobile && !isCompact && !hasSidebar[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(modal, /\{sidebarItems\?\.length \? \([\s\S]*?\) : null\}/);
});
