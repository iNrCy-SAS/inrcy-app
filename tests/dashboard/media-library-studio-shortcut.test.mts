import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function read(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("la Médiathèque ouvre le générateur partagé via un raccourci iNr’Studio accessible", () => {
  const source = read("app/dashboard/mediatheque/MediaLibraryClient.tsx");

  assert.match(
    source,
    /<Link[\s\S]*?href="\/dashboard\/generer-media"[\s\S]*?className=\{styles\.studioButton\}/,
  );
  assert.match(source, /ai_generator_made_inrcy/);
  assert.match(source, /ai_generator_generate_media/);
  assert.match(source, /aria-label=/);
  assert.doesNotMatch(source, /<MediaGeneratorModal/);
});

test("le raccourci iNr’Studio reste lisible et correctement rangé sur mobile", () => {
  const styles = read("app/dashboard/mediatheque/mediaLibrary.module.css");

  assert.match(styles, /\.studioButton\s*\{[\s\S]*?display:inline-flex/);
  assert.match(styles, /\.studioButton:focus-visible/);
  assert.match(
    styles,
    /@media \(max-width:680px\)[\s\S]*?grid-template-columns:38px minmax\(0, 1fr\) 38px 38px;[\s\S]*?\.studioButton\s*\{[\s\S]*?width:100%/,
  );
});
