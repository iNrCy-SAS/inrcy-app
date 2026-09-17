import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("iNrStudio garde quatre cadres desktop fixes sans défilement", () => {
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");
  const modalStyles = read(
    "app/dashboard/_components/MediaGeneratorModal.module.css"
  );

  assert.match(
    styles,
    /@media \(min-width: 1101px\)[\s\S]*?\.essentialGrid\s*\{[\s\S]*?grid-template-rows:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?overflow:\s*hidden;/
  );
  assert.match(
    styles,
    /@media \(min-width: 1101px\)[\s\S]*?\.essentialCard\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*hidden;/
  );
  assert.doesNotMatch(
    styles,
    /@media \(min-width: 1101px\)[\s\S]*?\.essentialGrid\s*\{[^}]*overflow-y:\s*auto/
  );
  assert.match(
    modalStyles,
    /@media \(min-width: 1101px\)[\s\S]*?\.body\s*\{[\s\S]*?overflow:\s*hidden;/
  );
});

test("les contenus courts gardent une largeur compacte dans les cadres", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.match(generator, /data-media-kind=\{kind\}/);
  assert.match(generator, /data-subject-source=\{subjectSource\}/);
  assert.match(generator, /data-source-mode=\{mediaSourceMode\}/);
  assert.match(generator, /data-character-count=\{realCharacterCount\}/);
  assert.match(generator, /data-with-text=\{withText \? "true" : "false"\}/);
  assert.match(
    styles,
    /\.essentialSegmented\s*\{[\s\S]*?width:\s*fit-content;/
  );
  assert.match(styles, /\.studioSelect\s*\{[\s\S]*?width:\s*auto;/);
  assert.match(
    styles,
    /\.essentialSplitFields\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(150px, 220px\)\)/
  );
  assert.match(
    styles,
    /\.creationCard\[data-media-kind="video"\]\s*\{[\s\S]*?"format subject"[\s\S]*?"instruction instruction"/
  );
  assert.match(
    styles,
    /\.creationCard\[data-media-kind="video"\]\[data-subject-source="custom"\]\s*\{[\s\S]*?"format subject"[\s\S]*?"custom instruction"/
  );
  assert.match(
    styles,
    /\.referenceSlots\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(150px, 220px\)\)/
  );
  assert.match(generator, /className=\{styles\.generatorAlerts\}/);
  assert.match(styles, /\.generatorAlerts\s*\{[\s\S]*?position:\s*absolute/);
});
