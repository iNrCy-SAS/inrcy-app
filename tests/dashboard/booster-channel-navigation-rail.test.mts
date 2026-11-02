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
  "app/dashboard/booster/publier/components/PublishMediaPoolPanel.tsx",
);
const validationBoard = read(
  "app/dashboard/booster/publier/components/PublishValidationBoard.tsx",
);

test("le contenu conserve son rail, le pool est partagé et Validation affiche chaque canal", () => {
  for (const source of [contentPanel]) {
    assert.match(source, /import ChannelNavigationRail from "\.\/ChannelNavigationRail"/);
    assert.match(source, /<ChannelNavigationRail/);
    assert.match(source, /setSynchronizedActiveChannel/);
  }

  assert.match(contentPanel, /items=\{displayCards\}/);
  assert.match(mediaPanel, /data-publish-media-pool/);
  assert.doesNotMatch(mediaPanel, /ChannelNavigationRail/);
  assert.match(validationBoard, /items\.map\(\(item\) =>/);
  assert.match(validationBoard, /data-channel=\{item\.channel\}/);
  assert.match(validationBoard, /onSelectChannel\(channel\)/);
  assert.match(validationBoard, /<ChannelPublicationPreview preview=\{activePreview\}/);
  assert.doesNotMatch(validationBoard, /ChannelNavigationRail/);
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

  // Le contenu conserve son rail mobile/tablette ; les médias restent un pool partagé.
  for (const source of [contentPanel]) {
    assert.match(source, /isMobile\s*\?\s*"repeat\(2, minmax\(0, 1fr\)\)"/);
  }
  // Le fallback hors mobile suit le nombre réel de canaux ; il reste donc juste
  // quand X ou de futurs canaux portent le rail à 10, 11 ou 12 éléments.
  assert.match(contentPanel, /displayCards\.length/);
  assert.match(mediaPanel, /Array\.from\(\{ length: BOOSTER_MAX_IMAGE_COUNT \}/);
  const boardStyles = read("app/dashboard/booster/publier/components/PublishValidationBoard.module.css");
  assert.match(boardStyles, /@media\(max-width:600px\)/);
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
