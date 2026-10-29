import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { resolveAiContentLocation, buildAiContentLocationInstruction } from "../../lib/aiContentLocation.ts";
import { buildAiMediaBusinessDnaPayload, buildAiMediaVideoDnaBrief, AI_MEDIA_DNA_PAYLOAD_MAX_CHARS } from "../../lib/aiMediaBusinessDna.ts";
import { buildAiMediaFreeDnaContext } from "../../lib/aiMediaFreeDnaContext.ts";
import { buildAiMediaFreeBusinessContext } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import type * as Profile from "../../lib/aiGenerationProfile.ts";
import type * as Booster from "../../lib/boosterPrompt.ts";
import type * as Creative from "../../lib/aiMediaCreativePlan.ts";
import type * as Writing from "../../lib/aiWritingProfile.ts";

const root = path.resolve(import.meta.dirname, "../..");
const nativeRequire = createRequire(import.meta.url);
const cache = new Map<string, Record<string, unknown>>();
// Execute production modules with alias resolution; no providers or database calls.
function load<T>(relative: string): T {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file) as T;
  const moduleRecord = { exports: {} as Record<string, unknown> };
  cache.set(file, moduleRecord.exports);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = (id: string) => {
    if (id === "server-only") return {};
    if (id.startsWith("@/") || id.startsWith(".")) {
      const target = id.startsWith("@/") ? path.resolve(root, id.slice(2)) : path.resolve(path.dirname(file), id);
      return load(existsSync(target) ? target : `${target}.ts`);
    }
    return nativeRequire(id);
  };
  new Function("module", "exports", "require", code)(moduleRecord, moduleRecord.exports, require);
  return moduleRecord.exports as T;
}
const { buildNormalizedAiGenerationProfile } = load<typeof Profile>("lib/aiGenerationProfile.ts");
function profile(preference?: { useHeadquarters: boolean; primaryArea: string }) {
  return buildNormalizedAiGenerationProfile({
    profile: { company_legal_name: "Atelier Cosmos", hq_city: "Bailleul-Sir-Berthoult", hq_zip: "62580" },
    business: { profession: "Artisan", intervention_zones: ["Lens", "Arras"],
      ai_memory: preference ? { contentLocation: preference } : {} },
  });
}
function structuredDna(p: Profile.NormalizedAiGenerationProfile) {
  return buildAiMediaBusinessDnaPayload(p) as {
    localisation_editoriale: { zone_principale_contenus: string; regle: string };
    zones_et_horaires: { lieu_implantation: Record<string, string>; ville: string; zone_principale: string };
  };
}

test("commercial content area stays separate from the real headquarters and its postcode", () => {
  const p = profile({ useHeadquarters: false, primaryArea: "Arras" });
  assert.equal(p.business.city, "Bailleul-Sir-Berthoult");
  assert.equal(p.business.postalCode, "62580");
  assert.equal(resolveAiContentLocation(p)?.primaryArea, "Arras");
  const payload = structuredDna(p);
  assert.equal(payload.localisation_editoriale.zone_principale_contenus, "Arras");
  assert.equal(payload.zones_et_horaires.lieu_implantation.ville, "Bailleul-Sir-Berthoult");
  assert.equal(payload.zones_et_horaires.lieu_implantation.code_postal, "62580");
  assert.match(buildAiContentLocationInstruction(p), /pas la ville du siège/);
  assert.match(buildAiContentLocationInstruction(p), /ne prétends jamais que le siège y est implanté/);
  const brief = buildAiMediaVideoDnaBrief(p);
  assert.match(brief, /Zone commerciale principale des contenus : « Arras »/);
  assert.doesNotMatch(brief, /Bailleul-Sir-Berthoult|62580/);
});

test("headquarters checkbox wins over intervention areas; legacy keeps its old defaults", () => {
  const checked = profile({ useHeadquarters: true, primaryArea: "Arras" });
  assert.equal(resolveAiContentLocation(checked)?.primaryArea, "Bailleul-Sir-Berthoult");
  assert.equal(structuredDna(checked).zones_et_horaires.zone_principale, "Bailleul-Sir-Berthoult");
  const legacy = profile();
  assert.equal(resolveAiContentLocation(legacy), undefined);
  assert.equal(buildAiContentLocationInstruction(legacy), "");
  const payload = structuredDna(legacy);
  assert.equal(payload.zones_et_horaires.ville, "Bailleul-Sir-Berthoult");
  assert.equal(payload.zones_et_horaires.zone_principale, "Lens");
  assert.equal("localisation_editoriale" in payload, false);
});

test("unchecked empty preference falls back only to intervention zones, never to headquarters", () => {
  const p = profile({ useHeadquarters: false, primaryArea: "" });
  assert.equal(resolveAiContentLocation(p)?.primaryArea, "Lens");
  p.business.interventionZones = [];
  assert.equal(resolveAiContentLocation(p)?.primaryArea, "");
  assert.match(buildAiContentLocationInstruction(p), /n'ajoute aucune ville par défaut/);
  assert.equal("zone_principale" in structuredDna(p).zones_et_horaires, false);
});

test("Booster, shared agent writing and email rules honor the area while keeping a one-off place authoritative", () => {
  const p = profile({ useHeadquarters: false, primaryArea: "Arras" });
  const booster = load<typeof Booster>("lib/boosterPrompt.ts");
  const result = booster.compileBoosterGenerationPrompt({
    idea: "Un chantier réalisé à Lille", publicationInstruction: "Conserver Lille, lieu du chantier.",
    theme: "realisation", style: "equilibre", channels: ["facebook"], generationProfile: p,
  });
  assert.match(result.input, /Zone commerciale principale des contenus : « Arras »/);
  assert.match(result.input, /Un chantier réalisé à Lille/);
  assert.match(result.input, /Le sujet et la consigne ponctuelle restent prioritaires/);
  assert.match(result.input, /"lieu_implantation":\{"ville":"Bailleul-Sir-Berthoult","code_postal":"62580"\}/);
  assert.match(load<typeof Writing>("lib/aiWritingProfile.ts").buildAiWritingProfileRules(p), /Zone commerciale principale des contenus : « Arras »/);
});

test("Studio free ADN protects editorial selection under compaction and retains exact physical contact data", () => {
  const p = profile({ useHeadquarters: false, primaryArea: "Arras" });
  p.memory.detailedDescription = "Une longue présentation. ".repeat(300);
  p.business.services = Array.from({ length: 15 }, (_, n) => `Prestation ${n} ${"x".repeat(100)}`);
  const payload = structuredDna(p);
  assert.ok(JSON.stringify(payload).length <= AI_MEDIA_DNA_PAYLOAD_MAX_CHARS);
  assert.equal(payload.localisation_editoriale.zone_principale_contenus, "Arras");
  assert.match(payload.localisation_editoriale.regle, /ne lui associe jamais le code postal du siège/);
  const context = buildAiMediaFreeDnaContext({ profile: p, publicProfile: null, publicLinks: {}, prompt: "Un flyer avec mon adresse" });
  assert.equal(context.coordonnees.ville, "Bailleul-Sir-Berthoult");
  assert.equal(context.coordonnees.code_postal, "62580");
  assert.equal(context.localisation_editoriale?.zone_principale_contenus, "Arras");
  const request = normalizeAiMediaGenerationRequest({ requestId: "location-free-context", source: "studio", operation: "generate", creationMode: "free", kind: "image", freePrompt: "Un flyer avec mon adresse", format: "square", useBusinessDna: true });
  const free = buildAiMediaFreeBusinessContext({ profile: p, request, businessDnaContext: context }) as {
    localisation_editoriale: Record<string, string>; coordonnees: Record<string, string>;
  };
  assert.equal(free.localisation_editoriale.zone_principale_contenus, "Arras");
  assert.equal(free.coordonnees.ville, "Bailleul-Sir-Berthoult");
});

test("the deterministic Studio fallback no longer adds the village after opting out", () => {
  const p = profile({ useHeadquarters: false, primaryArea: "Arras" });
  const request = normalizeAiMediaGenerationRequest({ requestId: "location-creative-fallback", source: "studio", operation: "generate", creationMode: "guided", kind: "video", durationSeconds: 16, format: "landscape", idea: "Un meuble réalisé sur mesure" });
  const plan = load<typeof Creative>("lib/aiMediaCreativePlan.ts").buildAiMediaCreativePlan({ profile: p, request });
  assert.match(JSON.stringify(plan), /Arras/);
  assert.doesNotMatch(JSON.stringify(plan), /Bailleul-Sir-Berthoult|62580/);
});
