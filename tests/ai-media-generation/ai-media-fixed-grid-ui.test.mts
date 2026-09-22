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

test("les champs courts restent proportionnés dans les cadres", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.match(generator, /data-media-kind=\{kind\}/);
  assert.match(generator, /data-subject-source=\{subjectSource\}/);
  assert.match(generator, /data-source-mode=\{mediaSourceMode\}/);
  assert.match(generator, /data-character-count=\{effectiveCharacterCount\}/);
  assert.deepEqual(
    Array.from(generator.matchAll(/data-generator-block="([^"]+)"/g), (match) => match[1]),
    ["subject", "selection", "direction", "finish"]
  );
  assert.match(
    styles,
    /\.essentialSegmented\s*\{[\s\S]*?width:\s*fit-content;/
  );
  assert.match(styles, /\.studioSelect\s*\{[\s\S]*?width:\s*auto;/);
  assert.match(styles, /\.aiCriteriaGrid\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.referenceCollection\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.directionSettings\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(generator, /className=\{styles\.generatorAlerts\}/);
  assert.match(styles, /\.generatorAlerts\s*\{[\s\S]*?position:\s*absolute/);
});

test("le desktop confortable aère les quatre blocs Image et Vidéo", () => {
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");
  const frenchMedia = read("messages/fr-FR/media.json");

  assert.match(styles, /\.subjectSourceChoices\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.creativeBriefField textarea\s*\{[\s\S]*?height:\s*clamp\(94px, 12dvh, 142px\)/);
  assert.match(styles, /\.mediaModeField\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(
    styles,
    /\.studioSelect\s*\{[\s\S]*?background-color:\s*#10244a;[\s\S]*?background-image:\s*url\([\s\S]*?background-position:\s*right 13px center;/,
  );
  assert.match(styles, /\.finishCard\[data-media-kind="image"\]\s*\{[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(styles, /\.finishCard\[data-media-kind="video"\]\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(
    frenchMedia,
    /"ai_generator_instruction_hint":\s*"Pour cette création uniquement — non enregistrée\."/,
  );
});

test("les quatre blocs possèdent des identités colorées distinctes", () => {
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.match(styles, /\.creationCard\s*\{[\s\S]*?--card-accent:\s*45, 205, 255/);
  assert.match(styles, /\.mediaCard\s*\{[\s\S]*?--card-accent:\s*238, 76, 167/);
  assert.match(styles, /\.messageCard\s*\{[\s\S]*?--card-accent:\s*246, 169, 72/);
  assert.match(styles, /\.soundCard\s*\{[\s\S]*?--card-accent:\s*139, 109, 247/);
});

test("Autre sujet explique immédiatement pourquoi la génération est bloquée", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");
  const frenchMedia = read("messages/fr-FR/media.json");

  assert.match(
    generator,
    /aria-invalid=\{[\s\S]*?subjectSource === "custom" && creativeBrief\.trim\(\)\.length < 3/
  );
  assert.match(generator, /subjectSource === "custom" && creativeBrief\.trim\(\)\.length < 3 \? \(/);
  assert.match(generator, /className=\{styles\.fieldAlert\}[\s\S]*?role="alert"/);
  assert.match(styles, /\.essentialTextareaField > \.fieldAlert\s*\{/);
  assert.match(
    frenchMedia,
    /"ai_generator_custom_too_short":\s*"Ajoutez votre idée pour activer la génération\."/,
  );
});
