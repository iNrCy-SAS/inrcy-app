import { readAgentPublicationPreparationSource } from "../inragent/prepare-publication-sources.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const helper = read("lib/inrAgentVideoPreparation.ts");
const route = readAgentPublicationPreparationSource();
const multicompte = read("tests/multicompte/account-scope-step5.test.mts");

test("iNrAgent télécharge une seule fois la vidéo puis prépare images et audio en parallèle", () => {
  assert.match(helper, /const sourceBuffer = await downloadVideo\(args\.source\)/);
  assert.match(helper, /await writeFile\(inputPath, sourceBuffer\)/);
  assert.match(helper, /Promise\.allSettled\(\[/);
  assert.match(helper, /extractFrames\(\{/);
  assert.match(helper, /extractAndTranscribeAudio\(\{/);
  assert.equal((helper.match(/downloadVideo\(args\.source\)/g) || []).length, 1);
});

test("le moteur vidéo reste non bloquant et nettoie toujours les fichiers temporaires", () => {
  assert.match(helper, /status: "unavailable"/);
  assert.match(helper, /warnings\.push\(/);
  assert.match(helper, /finally \{/);
  assert.match(helper, /rm\(tempDirectory, \{ recursive: true, force: true \}\)/);
});

test("iNrAgent transmet les captures et la transcription au moteur Booster partagé", () => {
  assert.match(route, /getOrPrepareInrAgentVideoForAi\(\{/);
  assert.match(route, /imagesForAI = video\s*\?/);
  assert.match(route, /videoPreparation\?\.frames \|\| \[\]/);
  assert.match(route, /Transcription audio détectée dans la vidéo/);
  assert.match(route, /mediaContext: selectedMediaContext/);
});


test("le quota vidéo est réservé avant toute transcription iNrAgent", () => {
  const httpRoute = read("app/api/agent/actions/prepare-publish/route.ts");
  const reservationIndex = httpRoute.indexOf("reserveAiCredits({");
  const preparationIndex = httpRoute.indexOf("await prepareInrAgentSelectedMediaAnalysis({");
  assert.ok(reservationIndex >= 0);
  assert.ok(preparationIndex >= 0);
  assert.ok(reservationIndex < preparationIndex);
});

test("le test multicompte ne dépend plus de Trustpilot retiré de l'application", () => {
  assert.doesNotMatch(multicompte, /trustpilotAi/i);
  assert.doesNotMatch(multicompte, /e-reputation\/trustpilot/i);
  assert.match(multicompte, /Google e-réputation/);
});
