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

test("le desktop confortable aère les informations et hiérarchise Image et Vidéo", () => {
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");
  const frenchMedia = read("messages/fr-FR/media.json");

  assert.match(
    styles,
    /@media \(min-width: 1101px\) and \(min-height: 840px\)[\s\S]*?\.essentialCard\s*\{[\s\S]*?padding:\s*clamp\(13px, 1\.6dvh, 18px\)/
  );
  assert.match(
    styles,
    /@media \(min-width: 1101px\) and \(min-height: 840px\)[\s\S]*?grid-template-rows:\s*minmax\(0, 1\.1fr\) minmax\(0, 0\.9fr\)/,
    "la rangée haute doit afficher ses aides et ses médias sans les couper",
  );
  assert.match(
    styles,
    /\.creationTypeField \.essentialSegmented\s*\{[\s\S]*?width:\s*min\(100%, 390px\);[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(120px, 1fr\)\)/
  );
  assert.match(
    styles,
    /\.creationTypeField \.essentialSegmented button\s*\{[\s\S]*?min-height:\s*54px;[\s\S]*?font-size:\s*13px/
  );
  assert.match(
    styles,
    /\.mediaModeField\s*\{[\s\S]*?width:\s*min\(100%, 460px\);[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    styles,
    /\.studioSelect\s*\{[\s\S]*?background-color:\s*#10244a;[\s\S]*?background-image:\s*url\([\s\S]*?background-position:\s*right 13px center;/,
  );
  assert.match(
    styles,
    /\.soundCard\[data-media-kind="image"\] > \.noAudioNotice\s*\{[\s\S]*?align-self:\s*center;[\s\S]*?justify-self:\s*center/
  );
  assert.match(
    styles,
    /@media \(min-width: 1101px\) and \(min-height: 840px\)[\s\S]*?\.messageCard\s*\{[\s\S]*?align-content:\s*space-between/,
  );
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

  assert.match(generator, /aria-invalid=\{customIdea\.trim\(\)\.length < 3\}/);
  assert.match(generator, /customIdea\.trim\(\)\.length < 3 \? \(/);
  assert.match(generator, /className=\{styles\.fieldAlert\}[\s\S]*?role="alert"/);
  assert.match(styles, /\.essentialTextareaField > \.fieldAlert\s*\{/);
  assert.match(
    frenchMedia,
    /"ai_generator_custom_too_short":\s*"Ajoutez votre idée pour activer la génération\."/,
  );
});
