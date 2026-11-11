import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve("lib");
const nativeRequire = createRequire(import.meta.url);
const loaded = new Map<string, { exports: Record<string, unknown> }>();
/** Actual pure normalizer, publication adapter and image/video prompt builders. */
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
    if (specifier === "server-only") return {};
    if (specifier.startsWith("node:")) return nativeRequire(specifier);
    const local = specifier.startsWith("@/lib/") ? path.join(root, specifier.slice(6))
      : specifier.startsWith(".") ? path.resolve(path.dirname(resolved), specifier) : null;
    assert.ok(local, `Unexpected pure prompt dependency: ${specifier}`);
    return load(local.endsWith(".ts") ? local : `${local}.ts`);
  });
  return record.exports as T;
}
const { buildInrAgentMediaGenerationRequest } = load<typeof import("../../lib/inrAgentMediaRequest.ts")>("inrAgentMediaRequest.ts");
const { resolveInrAgentMediaMix } = load<typeof import("../../lib/inrAgentMediaMix.ts")>("inrAgentMediaMix.ts");
const { buildNormalizedAiGenerationProfile } = load<typeof import("../../lib/aiGenerationProfile.ts")>("aiGenerationProfile.ts");
const { normalizeAiMediaGenerationRequest } = load<typeof import("../../lib/aiMediaGenerationContracts.ts")>("aiMediaGenerationContracts.ts");
const { buildAiMediaPrompt } = load<typeof import("../../lib/aiMediaGenerationPrompt.ts")>("aiMediaGenerationPrompt.ts");
const { AI_MEDIA_COMPILED_PROMPT_MAX_CHARS } = load<typeof import("../../lib/aiMediaPromptShared.ts")>("aiMediaPromptShared.ts");
const { buildInrAgentEditorialFocusPlan } = load<typeof import("../../lib/inrAgentEditorialVariation.ts")>("inrAgentEditorialVariation.ts");
const { buildAgentIdea } = load<typeof import("../../lib/inrAgentPublicationPreparationPolicy.ts")>("inrAgentPublicationPreparationPolicy.ts");

function trainingBusiness(rich = false) {
  return {
      sector: "[[SECTOR:services_entreprises]] Formation",
      business_description: "Centre de formation spécialisé dans le CAP Esthétique Cosmétique Parfumerie : soins du visage, maquillage et épilation.",
      services: ["Formation inter", "Formation intra", "Atelier", "Coaching", "Prépa apprentissage (parcours de 300 heures)"],
      ai_memory: {
        detailedDescription: "Centre de formation spécialisé dans le CAP Esthétique Cosmétique Parfumerie. " + (rich ? "Enseignement théorique et pratique, accompagnement et suivi personnalisé. ".repeat(60) : ""),
        specialties: ["Soins du visage, des mains et des pieds", "Maquillage professionnel", "Épilation"],
        targetAudiences: ["Apprenants des métiers de la beauté"],
        customerNeeds: ["Répéter les gestes professionnels"],
        values: rich ? Array.from({ length: 12 }, (_, i) => `Valeur pédagogique ${i} : ${"accompagnement ".repeat(12)}`) : [],
      },
  };
}
function profile(rich = false) {
  return buildNormalizedAiGenerationProfile({
    profile: { company_legal_name: "Centre formation exemple", hq_city: "Ville exemple" },
    business: trainingBusiness(rich),
  });
}

// The reported path had its first explicit profession mention after character
// 2,000. This anonymized brief keeps the same ambiguity without customer data.
const focus = "Prépa apprentissage (parcours de 300 heures) : Progresser grâce à la répétition des gestes en conditions réelles";
const longIdea = `Publication pour un professionnel Formation. FOCUS ÉDITORIAL : ${focus}. ${"Conserver ce sujet et son angle pédagogique. ".repeat(65)}Historique : formation en esthétique.`;

for (const kind of ["image", "video"] as const) {
  test(`iNrAgent ${kind}: a broad publication focus retains the ADN profession after the brief limit`, () => {
    const mediaMix = resolveInrAgentMediaMix({ kind, theme: "recrutement", studioMediaPreferencePercent: 0, seed: "generic-training-focus" });
    assert.ok(longIdea.length > 2_678, "the historical incident had 2,678 characters before normalization");
    assert.ok(longIdea.indexOf("esthétique") > 2_185, "the profession is beyond the same clipped portion as in the real incident");
    const request = buildInrAgentMediaGenerationRequest({ requestId: `publication-dna-${kind}`, idea: longIdea, theme: "recrutement", kind, mediaMix });
    assert.equal(request.idea.length, 2_000);
    assert.doesNotMatch(request.idea, /esthétique/i);
    assert.ok(request.idea.includes(focus));
    const compiled = buildAiMediaPrompt({ request, profile: profile() });
    assert.match(compiled, /CAP Esthétique Cosmétique Parfumerie/);
    assert.ok(compiled.includes(focus), "the ADN may clarify the profession without replacing the selected subject");
    assert.doesNotMatch(compiled, /Sujet personnalisé : ne pas importer le métier/);
    assert.ok(compiled.length <= AI_MEDIA_COMPILED_PROMPT_MAX_CHARS);
    const legacyCustom = buildAiMediaPrompt({ request: { ...request, subjectSource: "custom" }, profile: profile() });
    assert.doesNotMatch(legacyCustom, /CAP Esthétique Cosmétique Parfumerie/, "a custom-source classification loses the only profession evidence");
    assert.equal(request.source, "booster");
    assert.equal(request.withText, false);
    assert.equal(request.identityConsent, false);
  });
}

test("a long publication brief and rich ADN still retain the concrete profession within the image prompt budget", () => {
  const mediaMix = resolveInrAgentMediaMix({ kind: "image", theme: "conseils", studioMediaPreferencePercent: 100, seed: "rich-training-dna" });
  const request = buildInrAgentMediaGenerationRequest({ requestId: "publication-dna-rich", idea: longIdea, theme: "conseils", kind: "image", mediaMix });
  const compiled = buildAiMediaPrompt({ request, profile: profile(true) });
  assert.match(compiled, /CAP Esthétique Cosmétique Parfumerie/);
  assert.ok(compiled.includes(focus));
  assert.ok(compiled.length <= AI_MEDIA_COMPILED_PROMPT_MAX_CHARS);
});

test("the selected ADN service and focus stay identical from editorial planning to text idea and image prompt", () => {
  const business = trainingBusiness();
  const accountProfile = { company_legal_name: "Centre formation exemple", hq_city: "Ville exemple" };
  const slots = Array.from({ length: business.services.length }, (_, index) => ({ slotKey: `dna-slot-${index}`, sequence: index + 1, theme: "conseils" }));
  const plan = buildInrAgentEditorialFocusPlan({ slots, business, profile: accountProfile, seed: "training-dna-chain" });
  assert.ok(plan.every(slot => slot.focus.source === "business_dna"));
  assert.ok(plan.every(slot => business.services.includes(slot.focus.service)), "no service may be invented by the planning picker");
  const chosen = plan.find(slot => slot.focus.service === "Prépa apprentissage (parcours de 300 heures)");
  assert.ok(chosen, "the actual registered pre-apprenticeship service participates in the plan");
  const textIdea = buildAgentIdea({ business, profile: accountProfile, theme: "conseils", recentPublications: [], focus: chosen.focus });
  assert.ok(textIdea.includes(chosen.focus.subject));
  assert.ok(textIdea.includes(chosen.focus.service));
  const request = buildInrAgentMediaGenerationRequest({ requestId: "planning-text-image-dna-chain", idea: `${textIdea}\n${"Mémoire éditoriale secondaire. ".repeat(100)}`, theme: "conseils", kind: "image", mediaMix: resolveInrAgentMediaMix({ kind: "image", theme: "conseils", studioMediaPreferencePercent: 0, seed: "training-dna-chain" }) });
  const compiled = buildAiMediaPrompt({ request, profile: profile() });
  assert.ok(request.idea.includes(chosen.focus.subject));
  assert.ok(request.idea.includes(chosen.focus.service));
  assert.ok(compiled.includes(chosen.focus.subject));
  assert.ok(compiled.includes(chosen.focus.service));
  assert.match(compiled, /CAP Esthétique Cosmétique Parfumerie/);
  assert.match(compiled, /ne jamais le remplacer par une scène générique issue de l’ADN/);
});

test("Studio custom and unchecked free ADN retain their independent subject isolation", () => {
  for (const input of [
    { subjectSource: "custom", idea: "Une démonstration de pliage de papier origami." },
    { creationMode: "free", freePrompt: "Une démonstration de pliage de papier origami.", useBusinessDna: false },
  ]) {
    const request = normalizeAiMediaGenerationRequest({ requestId: "independent-studio-subject", source: "studio", kind: "image", operation: "generate", format: "square", ...input });
    const compiled = buildAiMediaPrompt({ request, profile: profile() });
    assert.match(compiled, /pliage de papier origami/);
    assert.doesNotMatch(compiled, /CAP Esthétique Cosmétique Parfumerie|Soins du visage/);
  }
});
