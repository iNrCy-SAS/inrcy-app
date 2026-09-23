import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  mergeImageInteractionOverlays,
  normalizeImageInteractions,
} from "../../lib/imageInteractions.ts";
import { getImageOverlayLinkHotspots } from "../../lib/imageOverlay.ts";

const renderSource = readFileSync(
  path.resolve("app/embed/actus/_lib/render.ts"),
  "utf8",
);

test("chaque bloc texte lié produit une zone cliquable avec sa propre géométrie", () => {
  const links = getImageOverlayLinkHotspots({
    items: [
      {
        id: "catalogue",
        text: "Voir le catalogue",
        linkUrl: "https://example.com/catalogue",
        x: 25,
        y: 30,
        width: 32,
        height: 14,
      },
      {
        id: "contact",
        text: "Nous contacter",
        linkUrl: "https://example.com/contact",
        x: 72,
        y: 78,
        width: 36,
        height: 16,
      },
    ],
  });

  assert.equal(links.length, 2);
  assert.deepEqual(links[0], {
    url: "https://example.com/catalogue",
    label: "Voir le catalogue",
    geometry: { x: 25, y: 30, width: 32, height: 14 },
  });
  assert.deepEqual(links[1], {
    url: "https://example.com/contact",
    label: "Nous contacter",
    geometry: { x: 72, y: 78, width: 36, height: 16 },
  });
});

test("les protocoles dangereux sont rejetés et l'ancien lien global reste identifiable", () => {
  const links = getImageOverlayLinkHotspots({
    items: [
      { text: "Dangereux", linkUrl: "javascript:alert(1)", x: 50, y: 50, width: 30, height: 10 },
      { text: "Ancien CTA", linkUrl: "https://example.com/legacy", position: "bottom" },
    ],
  });

  assert.deepEqual(links, [
    {
      url: "https://example.com/legacy",
      label: "Ancien CTA",
    },
  ]);
});

test("le contrat d'interactions conserve plusieurs liens sans demander de redessiner le texte", () => {
  const interactions = normalizeImageInteractions({
    version: 1,
    items: [
      { text: "Offre", linkUrl: "https://example.com/offre", x: 35, y: 20, width: 40, height: 12 },
      { text: "Réserver", linkUrl: "https://example.com/reserver", x: 65, y: 80, width: 30, height: 14 },
      { text: "Ignoré", linkUrl: "data:text/html,bad" },
    ],
  });

  assert.equal(interactions?.items.length, 2);
  assert.equal(interactions?.items[0]?.linkUrl, "https://example.com/offre");
  assert.equal(interactions?.items[1]?.linkUrl, "https://example.com/reserver");
});

test("un lien Studio et un lien ajouté par l'adaptateur restent tous les deux cliquables", () => {
  const merged = mergeImageInteractionOverlays(
    {
      items: [
        {
          id: "studio-offer",
          text: "Voir l'offre",
          linkUrl: "https://example.com/offre",
          x: 30,
          y: 25,
          width: 32,
          height: 12,
        },
      ],
    },
    {
      items: [
        {
          id: "studio-offer",
          text: "Voir l'offre",
          linkUrl: "https://example.com/offre",
          x: 30,
          y: 25,
          width: 32,
          height: 12,
        },
        {
          id: "channel-booking",
          text: "Réserver",
          linkUrl: "https://example.com/reserver",
          x: 72,
          y: 80,
          width: 28,
          height: 10,
        },
      ],
    },
  );
  const links = getImageOverlayLinkHotspots(merged);

  assert.equal(links.length, 2);
  assert.deepEqual(links.map((item) => item.url), [
    "https://example.com/offre",
    "https://example.com/reserver",
  ]);
});

test("les doublons sont retirés avant la limite afin de ne pas évincer un lien unique", () => {
  const duplicate = {
    id: "studio-offer",
    text: "Voir l'offre",
    linkUrl: "https://example.com/offre",
    x: 30,
    y: 25,
    width: 32,
    height: 12,
  };
  const merged = mergeImageInteractionOverlays(
    { items: Array.from({ length: 6 }, () => ({ ...duplicate })) },
    {
      items: [
        {
          id: "channel-booking",
          text: "Réserver",
          linkUrl: "https://example.com/reserver",
          x: 72,
          y: 80,
          width: 28,
          height: 10,
        },
      ],
    },
  );

  assert.deepEqual(
    getImageOverlayLinkHotspots(merged).map((item) => item.url),
    ["https://example.com/offre", "https://example.com/reserver"],
  );
});

test("le widget d'actualités rend des hotspots accessibles et conserve le fallback legacy", () => {
  assert.match(renderSource, /metadata\.imageInteractions \|\| metadata\.image_interactions/);
  assert.match(renderSource, /normalizeImageInteractions\(entry\.interactions \|\| entry\)/);
  assert.match(renderSource, /const overlays = metadata\.imageOverlays \|\| metadata\.image_overlays/);
  assert.match(renderSource, /mergeImageInteractionOverlays\(/);
  assert.match(renderSource, /getImageInteractionLinkHotspots\(overlay\)/);
  assert.match(renderSource, /class="mediaLinkHotspot"/);
  assert.match(renderSource, /data-media-link-hotspot/);
  assert.match(renderSource, /class="mediaLinkLegacy"/);
  assert.match(renderSource, /data-media-link-legacy/);
  assert.match(renderSource, /target="_blank" rel="noopener noreferrer" aria-label=/);
  assert.match(renderSource, /left:\$\{x\}%;top:\$\{y\}%;width:\$\{width\}%;height:\$\{height\}%/);
  assert.match(renderSource, /\.mediaLinkHotspot\{[^}]*transform:translate\(-50%,-50%\)/);
  assert.match(renderSource, /\.mediaLinkLegacy:focus-visible,\.mediaLinkHotspot:focus-visible/);
  assert.doesNotMatch(renderSource, /class="mediaLink"/);
});
