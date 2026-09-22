import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("chaque action média possède son propre compositeur de prompt", () => {
  const router = read("lib/aiMediaGenerationPrompt.ts");

  assert.match(router, /buildAiMediaImageGenerationPrompt/);
  assert.match(router, /buildAiMediaVideoGenerationPrompt/);
  assert.match(router, /buildAiMediaModificationPrompt/);
  assert.match(router, /request\.operation === "modify"/);
  assert.match(router, /request\.kind === "video"/);
});

test("le copywriter ne reçoit plus de textes de secours à imiter", () => {
  const copywriter = read("lib/aiMediaCopywriter.ts");
  const inputStart = copywriter.indexOf("input: JSON.stringify({");
  const inputEnd = copywriter.indexOf("responseSchema:", inputStart);
  const providerInput = copywriter.slice(inputStart, inputEnd);

  assert.ok(inputStart > 0 && inputEnd > inputStart);
  assert.doesNotMatch(providerInput, /copie_visible_de_secours/);
  assert.doesNotMatch(providerInput, /args\.plan\.headline/);
  assert.doesNotMatch(providerInput, /args\.plan\.cta/);
  assert.match(providerInput, /structure_narrative/);
  assert.match(providerInput, /identifiant_de_variation: args\.request\.requestId/);
  assert.doesNotMatch(providerInput, /recentPublications/);
});

test("les clichés et les quasi-répétitions récentes sont rejetés localement", () => {
  const copywriter = read("lib/aiMediaCopywriter.ts");

  assert.match(copywriter, /votre projet.*entre de bonnes mains/);
  assert.match(copywriter, /donnez\|donner/);
  assert.match(copywriter, /\^cap sur/);
  assert.match(copywriter, /recentCopyFragments/);
  assert.match(copywriter, /shared \/ candidateTokens\.length >= 0\.8/);
  assert.match(copywriter, /repeatsRecentVisibleCopy/);
  assert.match(copywriter, /return removeAiMediaFallbackCopy/);
});

test("le niveau obligatoire ou inspiration atteint réellement le fournisseur", () => {
  const identity = read("lib/aiMediaIdentityReferences.ts");
  const server = read("lib/aiMediaGenerationServer.ts");
  const gateway = read("lib/aiMediaGateway.ts");

  assert.match(identity, /image\.usage \? \{ usage: image\.usage \}/);
  assert.match(server, /\(\{ role, usage, characterIndex \}\)/);
  assert.match(gateway, /"role" \| "usage" \| "characterIndex"/);
  assert.match(gateway, /usage === "inspiration"/);
  assert.match(gateway, /usage === "required"/);
  assert.match(gateway, /Détecter toutes les personnes distinctes visibles/);
  assert.match(gateway, /les mettre naturellement en action/);
});

test("une référence Personnage peut contenir tout un groupe", () => {
  const server = read("lib/aiMediaGenerationServer.ts");

  assert.doesNotMatch(server, /Image 1 = personne 1/);
  assert.doesNotMatch(server, /preparedCharacterBuffers\.length\s*\n?\s*\}\s*adultes/);
  assert.match(
    server,
    /Un même média peut contenir une ou plusieurs personnes/
  );
  assert.match(server, /ne jamais déduire le nombre de personnes du nombre de fichiers/);
  assert.match(server, /dédupliquer une même identité/);
});
