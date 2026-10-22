import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as references from "../../lib/inrAgentMediaReferences.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { buildInrAgentMediaGenerationRequest } from "../../lib/inrAgentMediaRequest.ts";
import { resolveInrAgentMediaMix } from "../../lib/inrAgentMediaMix.ts";
import { normalizeAiMediaGeneratorPreferences } from "../../lib/aiMediaGenerationPreferences.ts";

const account = "863fe7b1-d7e2-4f74-b2f7-f939707853b2";
const id = "bbbbbbbb-1111-4111-8111-111111111111";
const otherId = "cccccccc-1111-4111-8111-111111111111";
const item = { id, name: "Portrait", role: "character", usage: "required" } as const;
const configuration = (overrides = {}) => references.parseInrAgentMediaReferences({ version: 1, items: [item], authorized: true, ...overrides });
const image = { mimeType: "image/jpeg" as const, data: Buffer.alloc(60, 1).toString("base64"), role: "character" as const, usage: "required" as const, characterIndex: 1 as const };
const makeRequest = (options: Partial<Parameters<typeof buildInrAgentMediaGenerationRequest>[0]> = {}) => buildInrAgentMediaGenerationRequest({
  requestId: "references-test-1", idea: "Conseils pour préparer une séance de relaxation", theme: "conseils", kind: "image",
  mediaMix: resolveInrAgentMediaMix({ kind: "image", theme: "conseils", studioMediaPreferencePercent: 0, seed: "scene-1" }),
  inspirationImages: [image], identityConsent: true, identityReferenceSetId: "reference-test-set-1", ...options,
});

test("les anciens comptes sans références gardent un réglage vide", () => {
  assert.deepEqual(references.parseInrAgentMediaReferences(undefined), references.emptyInrAgentMediaReferences());
});
test("le réglage conserve seulement les identifiants, rôles et usages", () => {
  const result = configuration({ items: [{ ...item, data: "secret-image", url: "https://attacker.test/", accountId: "other" }], malicious: true });
  assert.deepEqual(result.items, [item]);
  assert.equal(JSON.stringify(result).includes("secret-image"), false);
  assert.equal(result.authorized, true);
});
test("identifiants forgés, doublons, versions inconnues et trop de références sont refusés", () => {
  for (const bad of [{ version: 2, items: [] }, { items: [] }, { version: 1, items: [{ ...item, id: "../someone" }] },
    { version: 1, items: [item, item] }, { version: 1, items: Array(6).fill(item) }, { version: 1, items: [{ ...item, role: "admin" }] }]) {
    assert.throws(() => references.parseInrAgentMediaReferences(bad), /reference_invalid/);
  }
});
test("une liste vide ne conserve aucune autorisation", () => {
  assert.equal(configuration({ items: [] }).authorized, false);
});
test("les chemins privés sont toujours dérivés du compte authentifié", () => {
  assert.equal(references.inrAgentReferenceStoragePath(account, id), `users/${account}/agent-generation-references/${id}.jpg`);
  assert.throws(() => references.inrAgentReferenceStoragePath("../other", id));
  assert.equal(references.inrAgentReferencePreviewUrl("https://attacker.test"), "");
});
test("un portrait obligatoire est transmis et active l'identité fidèle", () => {
  const request = makeRequest();
  assert.equal(request.generationMode, "inspiration");
  assert.equal(request.identityMode, "professional");
  assert.equal(request.inspirationImages[0].data, image.data);
  assert.equal(request.inspirationImages[0].usage, "required");
  assert.match(request.aiInstruction, /nouvelle mise en scène/);
  assert.match(request.idea, /relaxation/);
});
test("la présence obligatoire prime sur un ancien réglage Studio sans personnage, à 0 comme à 100 %", () => {
  const preferences = normalizeAiMediaGeneratorPreferences(null);
  preferences.blocks[5].saved = true; preferences.blocks[5].defaults.peopleMode = "none";
  const before = JSON.stringify(preferences);
  for (const percent of [0, 100]) {
    const request = makeRequest({ mediaMix: resolveInrAgentMediaMix({ kind: "image", theme: "services", studioMediaPreferencePercent: percent, studioPreferences: preferences, seed: "consistent" }) });
    assert.equal(request.identityMode, "professional"); assert.equal(request.peopleMode, "auto");
  }
  assert.equal(JSON.stringify(preferences), before, "les réglages Studio restent indépendants");
});
test("une inspiration n'impose pas l'identité et un décor obligatoire garde son rôle", () => {
  const inspiration = makeRequest({ inspirationImages: [{ ...image, usage: "inspiration" }], identityConsent: false });
  assert.equal(inspiration.identityMode, "auto");
  const environment = makeRequest({ inspirationImages: [{ ...image, role: "environment", characterIndex: undefined }], identityConsent: false });
  assert.equal(environment.identityMode, "auto"); assert.equal(environment.inspirationImages[0].usage, "required");
  assert.equal(environment.inspirationImages[0].role, "environment");
});
test("un portrait ne peut pas partir sans autorisation explicite", () => {
  assert.throws(() => makeRequest({ identityConsent: false }), /autorisé/);
});
test("deux publications gardent les références mais reçoivent leur propre sujet et leur propre requête", () => {
  const first = makeRequest(); const second = makeRequest({ requestId: "references-test-2", idea: "Présentation du cabinet et de son cadre calme", theme: "services" });
  assert.deepEqual(first.inspirationImages, second.inspirationImages);
  assert.notEqual(first.requestId, second.requestId); assert.notEqual(first.idea, second.idea);
  assert.match(second.aiInstruction, /cadrage.*action.*composition/);
});
test("le changement de rôle, d'usage, de photo ou le retrait d'autorisation change la signature", () => {
  const original = references.inrAgentReferencesSignature(configuration());
  for (const next of [configuration({ items: [{ ...item, role: "environment" }] }), configuration({ items: [{ ...item, usage: "inspiration" }] }),
    configuration({ items: [{ ...item, id: otherId }] }), configuration({ authorized: false })]) assert.notEqual(references.inrAgentReferencesSignature(next), original);
});
test("une animation de groupe demande l'accord pour le moteur exact", () => {
  const images = [image, { ...image, characterIndex: 2 as const }];
  const mediaMix = resolveInrAgentMediaMix({ kind: "video", theme: "services", studioMediaPreferencePercent: 0, seed: "video" });
  assert.throws(() => makeRequest({ kind: "video", mediaMix, inspirationImages: images }), /Confirmez l’animation/);
  assert.throws(() => makeRequest({ kind: "video", mediaMix, inspirationImages: images, animationProviderConsent: "other-engine" }), /Confirmez l’animation/);
  const request = makeRequest({ kind: "video", mediaMix, inspirationImages: images, animationProviderConsent: "veo-lite" });
  assert.equal(request.teamVideoProviderConsent, "veo-lite"); assert.equal(request.teamVideoSpeechMode, "voiceover");
});
test("un échec, un quota insuffisant ou une réponse incertaine ne remplacent jamais une référence obligatoire", () => {
  for (const outcome of ["quota_reached", "generation_failed", "finalization_failed", "content_rejected"]) {
    assert.equal(references.blocksInrAgentReferenceFallback({ outcome, item: null, referencesRequired: true }), true);
    assert.equal(references.blocksInrAgentReferenceFallback({ outcome, item: null, referencesRequired: false }), false);
  }
  assert.equal(references.blocksInrAgentReferenceFallback({ outcome: "reference_unavailable" }), true);
  assert.equal(references.blocksInrAgentReferenceFallback({ outcome: "generated", item: { id }, referencesRequired: true }), false);
});

type Download = (path: string) => Promise<{ data: Blob | null; error: unknown }>;
type FakeClient = { from: (table: string) => unknown; storage: { from: (bucket: string) => { download: Download } } };
function serverModule() {
  const source = readFileSync(new URL("../../lib/inrAgentMediaReferencesServer.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const dependencies: Record<string, unknown> = { "server-only": {}, "./aiMediaGenerationContracts.ts": contracts, "./inrAgentMediaReferences.ts": references };
  const result: { loadInrAgentMediaReferences?: (args: { supabase: FakeClient; accountId: string }) => Promise<{ images: contracts.AiMediaInspirationImage[] }> } = {};
  new Function("require", "exports", compiled)((id: string) => { assert.ok(id in dependencies, id); return dependencies[id]; }, result);
  return result.loadInrAgentMediaReferences!;
}
test("le chargement conserve l'ordre et les usages depuis le stockage privé du bon compte", async () => {
  const paths: string[] = []; const checked: string[][] = [];
  const fake = { from: (table: string) => { assert.equal(table, "inr_agent_automation_settings"); return { select: () => ({ eq: (key: string, value: string) => {
    checked.push([key, value]); return { eq: (key: string, value: string) => { checked.push([key, value]); return { maybeSingle: async () => ({ data: { metadata: { mediaGenerationReferences: configuration({ items: [item, { ...item, id: otherId, role: "environment" }] }) } }, error: null }) }; } };
  } }) }; }, storage: { from: (bucket: string) => { assert.equal(bucket, "inrcy-pro-media"); return { download: async (path: string) => {
    paths.push(path); return { data: new Blob([Buffer.concat([Buffer.from([255,216,255]), Buffer.alloc(60)])]), error: null };
  } }; } } };
  const result = await serverModule()({ supabase: fake, accountId: account });
  assert.deepEqual(result.images.map((image) => [image.role, image.usage, image.characterIndex]), [["character", "required", 1], ["environment", "required", undefined]]);
  assert.ok(paths.every((path) => path.startsWith(`users/${account}/`)));
  assert.deepEqual(checked, [["user_id", account], ["automation_key", "publish"]]);
});
test("une lecture indisponible ou une autorisation retirée bloque avant le téléchargement", async () => {
  for (const mode of ["read-error", "withdrawn"]) {
    let downloads = 0;
    const fake = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata: { mediaGenerationReferences: configuration({ authorized: false }) } }, error: mode === "read-error" ? {} : null }) }) }) }) }),
      storage: { from: () => ({ download: async () => { downloads++; return { data: null, error: {} }; } }) } };
    await assert.rejects(serverModule()({ supabase: fake, accountId: account }), mode === "read-error" ? /settings_unavailable/ : /authorization_required/);
    assert.equal(downloads, 0);
  }
});
test("une photo supprimée ou corrompue bloque la génération", async () => {
  for (const data of [null, new Blob(["bad-image"])]) {
    const fake = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata: { mediaGenerationReferences: configuration() } }, error: null }) }) }) }) }),
      storage: { from: () => ({ download: async () => ({ data, error: null }) }) } };
    await assert.rejects(serverModule()({ supabase: fake, accountId: account }), /reference_unavailable/);
  }
});
