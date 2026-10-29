import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { buildAiMediaLocalLogoCompositionPrompt } from "../../lib/aiMediaLocalLogoCompositionPrompt.ts";

const root = path.resolve("lib");
const nativeRequire = createRequire(import.meta.url);
const loaded = new Map<string, { exports: Record<string, unknown> }>();
/** Run the actual pure builders, including Next aliases, without a provider call. */
function load<T>(file: string): T {
  const resolved = path.resolve(root, file);
  assert.ok(resolved.startsWith(`${root}${path.sep}`));
  const cached = loaded.get(resolved);
  if (cached) return cached.exports as T;
  const record = { exports: {} as Record<string, unknown> };
  loaded.set(resolved, record);
  const output = ts.transpileModule(readFileSync(resolved, "utf8"), {
    fileName: resolved,
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("module", "exports", "require", output)(record, record.exports, (specifier: string) => {
    if (specifier.startsWith("node:")) return nativeRequire(specifier);
    const local = specifier.startsWith("@/lib/") ? path.join(root, specifier.slice(6))
      : specifier.startsWith(".") ? path.resolve(path.dirname(resolved), specifier) : null;
    assert.ok(local, `Unexpected prompt dependency: ${specifier}`);
    return load(local.endsWith(".ts") ? local : `${local}.ts`);
  });
  return record.exports as T;
}
const { normalizeAiMediaGenerationRequest } = load<typeof import("../../lib/aiMediaGenerationContracts.ts")>("aiMediaGenerationContracts.ts");
const { buildNormalizedAiGenerationProfile } = load<typeof import("../../lib/aiGenerationProfile.ts")>("aiGenerationProfile.ts");
const { buildAiMediaPrompt } = load<typeof import("../../lib/aiMediaGenerationPrompt.ts")>("aiMediaGenerationPrompt.ts");
const profile = buildNormalizedAiGenerationProfile({
  business: { company_name: "Nettoyage Horizon", profession: "Entreprise de nettoyage", description: "Nettoyage de bureaux à Lyon.", city: "Lyon" },
  preferences: { language: "fr" },
});
function request(overrides: Record<string, unknown> = {}) {
  return normalizeAiMediaGenerationRequest({
    requestId: "neutral-production-runtime-0001", source: "studio", inputMode: "essential", operation: "generate", kind: "image",
    subjectSource: "custom", idea: "Une équipe nettoie des bureaux lumineux.", aiInstruction: "Garder les personnes et leur matériel naturels.",
    generationMode: "ai_free", format: "square", typology: "service", visualStyle: "brand", logoMode: "none", textMode: "none",
    withText: false, withMusic: false, withNarration: false, inspirationImages: [], ...overrides,
  });
}
test("free, guided, edit and video instructions carry no unsolicited production brand", () => {
  const variants = [
    {},
    { creationMode: "free", freePrompt: "Une équipe nettoie des bureaux lumineux.", useBusinessDna: false },
    { creationMode: "free", freePrompt: "Une équipe nettoie des bureaux lumineux.", useBusinessDna: true },
    { operation: "modify", aiInstruction: "Changer seulement la couleur des gants.", modificationSourceWidth: 1200, modificationSourceHeight: 900, inspirationImages: [{ mimeType: "image/jpeg", data: Buffer.alloc(96, 31).toString("base64"), role: "inspiration", usage: "required" }] },
    { kind: "video", videoEngine: "omni", durationSeconds: 8 },
  ];
  for (const variant of variants) for (const deferred of [false, true]) {
    const compiled = buildAiMediaPrompt({ request: request(variant), profile, deferVisibleElementsToComposer: deferred, logoComposedLocally: true });
    const prompt = `${compiled}\n${buildAiMediaLocalLogoCompositionPrompt({ operation: variant.operation === "modify" ? "modify" : "generate", logoBrief: "" })}`;
    assert.doesNotMatch(prompt, /inrcy|inr.?studio/i, JSON.stringify(variant));
    assert.match(prompt, /Ne pas dessiner, imiter, réinterpréter ni inventer de logo/);
    assert.doesNotMatch(prompt, /coin supérieur droit/);
  }
});
test("explicit customer brand names survive unchanged rather than being globally stripped", () => {
  const brief = "Une affiche de l’entreprise iNrCy avec le titre exact « iNrStudio » et son logo officiel.";
  for (const variant of [{ idea: brief }, { creationMode: "free", freePrompt: brief }]) {
    const prompt = buildAiMediaPrompt({ request: request(variant), profile });
    assert.ok(prompt.includes(brief));
  }
});
test("local logo instructions preserve explicit placement and requested logo replacement", () => {
  const placed = buildAiMediaLocalLogoCompositionPrompt({ operation: "modify", logoBrief: "Remplacer le faux logo.", logoPlacement: { horizontal: "left", vertical: "bottom" } });
  assert.match(placed, /Retirer l'ancien logo ou le faux logo/);
  assert.match(placed, /à la position demandée pour le logo dans le brief/);
  assert.doesNotMatch(placed, /inrcy|inr.?studio|coin supérieur droit/i);
  const otherEdit = buildAiMediaLocalLogoCompositionPrompt({ operation: "modify", logoBrief: "Éclaircir la photo." });
  assert.doesNotMatch(otherEdit, /Retirer l'ancien logo/);
  assert.match(otherEdit, /Conserver les autres textes et éléments non visés/);
});
