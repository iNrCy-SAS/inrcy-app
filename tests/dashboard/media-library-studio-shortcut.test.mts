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

test("le header mobile garde Médias, Helper, importer, Studio et fermer sur une ligne", () => {
  const styles = read("app/dashboard/mediatheque/mediaLibrary.module.css");

  assert.match(styles, /\.studioButton\s*\{[\s\S]*?display:inline-flex/);
  assert.match(styles, /\.studioButton:focus-visible/);
  assert.match(
    styles,
    /@media \(max-width:760px\)[\s\S]*?\.heroCard\{[^}]*grid-template-columns:minmax\(0,1fr\) repeat\(4,44px\)/,
  );
  assert.match(styles, /\.headerActions\{[^}]*display:contents/);
  assert.match(styles, /\.headerActions \.ghostButton,\.headerActions \.importLabel,\.headerActions \.studioButton>span:last-child\{display:none;?\}/);
  assert.match(styles, /\.studioButton\{[^}]*grid-column:4[^}]*width:44px[^}]*height:44px/);
  assert.match(styles, /\.filters\{[^}]*grid-template-columns:minmax\(0,1fr\) 44px 44px/);
});
