import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  canSwitchInrStudioMediaType,
  isInrStudioTabUnavailable,
} from "../../lib/inrStudioModalPolicy.ts";

const read = (relativePath: string) =>
  readFileSync(path.resolve(relativePath), "utf8");

test("un handoff Générer sans source garde Image et Vidéo disponibles", () => {
  assert.equal(canSwitchInrStudioMediaType("generate", true), true);
  assert.equal(
    isInrStudioTabUnavailable("generate", {
      hasExternalHandoff: true,
      hasSourceMedia: false,
    }),
    false
  );
});

test("un handoff Générer sans source grise Modifier et Retoucher", () => {
  for (const tab of ["modify", "retouch"] as const) {
    assert.equal(
      isInrStudioTabUnavailable(tab, {
        hasExternalHandoff: true,
        hasSourceMedia: false,
      }),
      true
    );
  }
  assert.equal(
    isInrStudioTabUnavailable("retouch", {
      hasExternalHandoff: true,
      hasSourceMedia: true,
    }),
    false
  );
});

test("Booster ouvre le générateur sans fabriquer de média source", () => {
  const publishModal = read(
    "app/dashboard/booster/publier/PublishModal.tsx"
  );
  const start = publishModal.indexOf("const openInrStudioGenerator");
  const end = publishModal.indexOf("const openInrStudioImageTool", start);
  const generatorEntry = publishModal.slice(start, end);

  assert.match(generatorEntry, /tab:\s*"generate"/);
  assert.match(generatorEntry, /origin:\s*"booster-publish"/);
  assert.doesNotMatch(generatorEntry, /source:\s*\{/);
  assert.match(generatorEntry, /openStudio\(href\)/);
});

test("le client transmet explicitement la présence de la source au modal", () => {
  const client = read(
    "app/dashboard/generer-media/MediaGeneratorStudioClient.tsx"
  );
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");

  assert.match(
    client,
    /initialSourceAvailable=\{Boolean\(handoff\?\.source\)\}/
  );
  assert.match(
    modal,
    /disabled=\{locked \|\| hasPendingWork \|\| unavailable\}/
  );
  assert.match(
    modal,
    /canSwitchInrStudioMediaType\(studioTab, hasExternalHandoff\)/
  );
});
