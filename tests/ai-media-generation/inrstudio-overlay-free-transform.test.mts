import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  hasImageOverlay,
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

test("ImageOverlay conserve les espaces, les retours à la ligne et les styles de chaque texte", () => {
  const text = "  Offre  spéciale  \nSans engagement ";
  const overlay = normalizeImageOverlay({
    items: [
      {
        id: "titre",
        text,
        fontFamily: "georgia",
        fontSize: 5.5,
        bold: false,
        italic: true,
        underline: true,
        color: "#fef3c7",
        borderWidth: 4,
        borderColor: "#38bdf8",
      },
      { id: "cta", text: "Découvrir", linkUrl: "https://inrcy.com" },
    ],
  });

  assert.equal(overlay?.items?.length, 2);
  assert.equal(overlay?.items?.[0]?.text, text);
  assert.equal(overlay?.items?.[0]?.fontFamily, "georgia");
  assert.equal(overlay?.items?.[0]?.borderWidth, 4);
  assert.equal(overlay?.items?.[1]?.linkUrl, "https://inrcy.com");
});

test("un bloc sélectionné peut être vidé puis réécrit sans disparaître", () => {
  const draft = normalizeImageOverlay({
    items: [{ id: "draft-title", text: "", x: 50, y: 50 }],
  });
  assert.equal(draft?.items?.length, 1);
  assert.equal(draft?.items?.[0]?.id, "draft-title");
  assert.equal(draft?.items?.[0]?.text, undefined);
  assert.equal(hasImageOverlay(draft), false);
});

test("l'atelier déplace et redimensionne le bandeau à la souris comme au tactile", () => {
  assert.match(modal, /data-image-overlay="true"/);
  assert.match(modal, /beginOverlayGesture\(event, "move", overlayIndex\)/);
  assert.match(modal, /beginOverlayGesture\(event, "resize", overlayIndex\)/);
  assert.match(modal, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(modal, /touchAction:\s*"none"/);
  assert.match(modal, /aria-label="Redimensionner ce texte"/);
  assert.match(modal, /right:\s*-14/);
  assert.match(modal, /bottom:\s*-14/);
  assert.doesNotMatch(modal, /retoucher_position_top/);
  assert.doesNotMatch(modal, /retoucher_position_bottom/);
});

test("les blocs texte restent déplaçables et redimensionnables au clavier", () => {
  assert.match(modal, /tabIndex=\{0\}/);
  assert.match(modal, /aria-describedby=\{overlayKeyboardInstructionsId\}/);
  assert.match(modal, /handleOverlayKeyDown\(event, overlayIndex\)/);
  assert.match(modal, /if \(event\.target !== event\.currentTarget\) return/);
  assert.match(modal, /event\.key !== "ArrowLeft"/);
  assert.match(modal, /if \(event\.shiftKey\)/);
  assert.match(modal, /Utilisez les flèches pour déplacer ce texte/);
  assert.match(
    modal,
    /onChange=\{\(event\) => updateOverlay\(\{ text: event\.target\.value \}\)\}/,
    "le champ conserve les espaces et retours à la ligne sans trim",
  );
});

test("les aperçus et les rendus client et serveur respectent position et dimensions", () => {
  assert.match(frames, /getImageOverlayItems\(transform\.overlay\)/);
  assert.match(frames, /resolveImageOverlayCoordinates\(overlay\)/);
  assert.match(frames, /width:\s*`\$\{overlay\.width \?\? 68\}%`/);
  assert.match(frames, /height:\s*overlay\.height/);

  for (const renderer of [clientRenderer, serverRenderer]) {
    assert.match(renderer, /getImageOverlayItems/);
    assert.match(renderer, /resolveImageOverlayCoordinates\(overlay\)/);
    assert.match(renderer, /overlay\.width/);
    assert.match(renderer, /overlay\.height/);
  }
  assert.match(clientRenderer, /blockX \+ blockWidth \/ 2/);
  assert.match(serverRenderer, /panelX \+ panelWidth \/ 2/);
});

test("les listes déroulantes de l'atelier suivent le thème sombre iNrStudio", () => {
  assert.match(modal, /const studioSelectStyle/);
  assert.match(modal, /backgroundColor:\s*"#11182d"/);
  assert.match(modal, /colorScheme:\s*"dark"/);
  assert.match(modal, /#67e8f9/);
  assert.match(modal, /style=\{studioSelectStyle\}/);
  assert.match(modal, /style=\{studioOptionStyle\}/);
});

test("sans sidebar le desktop utilise deux colonnes et ne rend aucune colonne vide", () => {
  assert.match(modal, /const hasSidebar = Boolean\(sidebarItems\?\.length\)/);
  assert.match(
    modal,
    /!isMobile && !isCompact && !hasSidebar[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(modal, /\{sidebarItems\?\.length \? \([\s\S]*?\) : null\}/);
});

test("l'atelier embarqué mesure son conteneur et ne coupe pas la disposition empilée", () => {
  assert.match(modal, /const containerRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(modal, /new ResizeObserver\(update\)/);
  assert.match(modal, /const embeddedStacked = embedded && isCompact/);
  assert.match(modal, /overflow: embeddedStacked \? "visible" : "hidden"/);
  assert.match(
    modal,
    /overflowY: embedded \? \(isCompact \? "visible" : "hidden"\) : "auto"/,
  );
});
