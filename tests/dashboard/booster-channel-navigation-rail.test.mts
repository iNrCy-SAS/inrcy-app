import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const rail = read(
  "app/dashboard/booster/publier/components/ChannelNavigationRail.tsx",
);
const railStyles = read(
  "app/dashboard/booster/publier/components/ChannelNavigationRail.module.css",
);
const contentPanel = read(
  "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
);
const mediaPanel = read(
  "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
);
const previewPanel = read(
  "app/dashboard/booster/publier/components/PublishPreviewPanel.tsx",
);

test("les trois étapes Booster partagent une seule navigation de canaux", () => {
  for (const source of [contentPanel, mediaPanel, previewPanel]) {
    assert.match(source, /import ChannelNavigationRail from "\.\/ChannelNavigationRail"/);
    assert.match(source, /<ChannelNavigationRail/);
    assert.match(source, /setSynchronizedActiveChannel/);
  }

  assert.match(contentPanel, /items=\{displayCards\}/);
  assert.match(mediaPanel, /items=\{selectedChannels\}/);
  assert.match(
    previewPanel,
    /items=\{previewReadinessTabs\.map\(\(tab\) => tab\.key\)\}/,
  );
});

test("les flèches sont accessibles, bornées et centrent le canal actif", () => {
  assert.match(rail, /disabled=\{disabled \|\| !hasPrevious\}/);
  assert.match(rail, /disabled=\{disabled \|\| !hasNext\}/);
  assert.match(rail, /aria-label=\{shellT\("element_precedent_358f9c1e"\)\}/);
  assert.match(rail, /aria-label=\{shellT\("element_suivant_9d61e569"\)\}/);
  assert.doesNotMatch(rail, /scrollIntoView/);
  assert.match(rail, /track\.scrollTo\(\{ left: Math\.max\(0, centeredLeft\), behavior \}\)/);
  assert.match(rail, /track\.scrollLeft/);
  assert.match(rail, /event\.preventDefault\(\)/);
  assert.match(rail, /event\.stopPropagation\(\)/);
  assert.match(rail, /window\.matchMedia\(DESKTOP_CHANNEL_NAVIGATION_QUERY\)\.matches/);
});

test("le nouveau rendu est strictement réservé au desktop", () => {
  assert.match(railStyles, /\.root\s*\{\s*display:\s*contents;/);
  assert.match(railStyles, /\.arrow\s*\{\s*display:\s*none;/);
  assert.match(railStyles, /@media \(min-width: 1181px\)/);
  assert.match(railStyles, /display:\s*flex !important/);
  assert.match(railStyles, /overflow-x:\s*auto !important/);
  assert.match(railStyles, /justify-content:\s*center/);
  assert.match(railStyles, /scroll-snap-align:\s*center/);

  // La grille historique mobile/tablette reste fournie telle quelle aux trois rails.
  for (const source of [contentPanel, mediaPanel, previewPanel]) {
    assert.match(source, /isMobile\s*\?\s*"repeat\(2, minmax\(0, 1fr\)\)"/);
  }
  // Le fallback hors mobile suit le nombre réel de canaux ; il reste donc juste
  // quand X ou de futurs canaux portent le rail à 10, 11 ou 12 éléments.
  assert.match(contentPanel, /displayCards\.length/);
  assert.match(mediaPanel, /selectedChannels\.length/);
  assert.match(previewPanel, /previewReadinessTabs\.length/);
});

test("le rail adapte sa densité jusqu'à douze canaux sans colonnes figées", () => {
  assert.match(rail, /items\.length >= 12/);
  assert.match(rail, /items\.length >= 10/);
  assert.match(rail, /data-channel-count=\{items\.length\}/);
  assert.match(rail, /data-channel-density=\{density\}/);
  assert.match(railStyles, /flex-wrap:\s*nowrap/);
  assert.match(railStyles, /flex:\s*1 1 0/);
  assert.match(railStyles, /min-width:\s*0 !important/);
  assert.match(railStyles, /data-channel-density="dense"/);
  assert.doesNotMatch(rail, /repeat\((?:9|10|11|12),/);
  assert.doesNotMatch(railStyles, /repeat\((?:9|10|11|12),/);
});
