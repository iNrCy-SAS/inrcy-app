import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { buildAiMediaFreeImagePrompt, buildAiMediaFreeVideoPrompt } from "../../lib/aiMediaFreeGenerationPrompt.ts";

const load = runtimeModules();
const { buildNormalizedAiGenerationProfile } = load<typeof import("../../lib/aiGenerationProfile.ts")>("lib/aiGenerationProfile.ts");
const { buildAiMediaImageGenerationPrompt } = load<typeof import("../../lib/aiMediaImageGenerationPrompt.ts")>("lib/aiMediaImageGenerationPrompt.ts");
const profile = () => buildNormalizedAiGenerationProfile({
  business: { company_name: "Atelier Horizon", profession: "Ébéniste", description: "Mobilier sur mesure.", services: ["Bibliothèques"], city: "Arras" },
  preferences: { language: "fr" },
});
const request = (overrides: Record<string, unknown> = {}) => normalizeAiMediaGenerationRequest({
  requestId: "native-logo-prompt-fixture", source: "studio", kind: "image", operation: "generate",
  creationMode: "guided", inputMode: "essential", subjectSource: "custom", idea: "Une bibliothèque dans un atelier.",
  format: "square", imageEngine: "openai", withText: false, textMode: "none", logoMode: "visible", ...overrides,
});
const forbiddenLocalLogo = /logo officiel sera placé exactement au montage|COMPOSITION LOCALE DU TEXTE ET DU LOGO|coordonnées ni logo|ZONE RÉSERVÉE AU LOGO FINAL/;

test("guided image prompts ask for native integration of the supplied logo in each image engine", () => {
  for (const imageEngine of ["openai", "gemini", "flux", "grok"]) {
    const prompt = buildAiMediaImageGenerationPrompt({ request: request({ imageEngine, aiInstruction: "Ajoute notre logo en haut à gauche, en petit." }), profile: profile(), hasLogo: true });
    assert.match(prompt, /INTÉGRATION NATIVE DU LOGO/);
    assert.match(prompt, /UNE SEULE FOIS/);
    assert.match(prompt, /forme, ses couleurs, ses proportions et l’orthographe/);
    assert.match(prompt, /position et la taille demandées/);
    assert.match(prompt, /en haut à gauche, en petit/);
    assert.match(prompt, /ne sera pas ajouté après la génération/);
    assert.doesNotMatch(prompt, forbiddenLocalLogo);
  }
});

test("local editorial text remains private while the attached logo is already part of the provider output", () => {
  const exactText = "OFFRE_CONFIDENTIELLE_24_SEPTEMBRE";
  const prompt = buildAiMediaImageGenerationPrompt({
    request: request({ withText: true, textMode: "exact", exactText, imagePurpose: "flyer" }),
    profile: profile(), hasLogo: true, deferVisibleElementsToComposer: true,
  });
  assert.match(prompt, /COMPOSITION LOCALE DU TEXTE/);
  assert.match(prompt, /conservée hors du prompt fournisseur/);
  assert.match(prompt, /logo officiel joint déjà intégré/);
  assert.match(prompt, /Préserver les lettres présentes dans le logo/);
  assert.doesNotMatch(prompt, new RegExp(exactText));
  assert.doesNotMatch(prompt, forbiddenLocalLogo);
});

test("native logo intent and private exact copy survive maximum-context prompt compaction", () => {
  const rich = profile();
  const background = "Un atelier équipé de matières et outils variés. ".repeat(100);
  rich.business.description = background;
  rich.preferences.customInstructions = background.slice(0, 1200);
  const exactText = "PRIX_EDITEUR_CONFIDENTIEL_1234";
  const prompt = buildAiMediaImageGenerationPrompt({
    request: request({ idea: background.slice(0, 2000), aiInstruction: background.slice(0, 2400),
      withText: true, textMode: "exact", exactText, imagePurpose: "flyer", format: "story" }),
    profile: rich, hasLogo: true, deferVisibleElementsToComposer: true,
    recentPublications: Array.from({ length: 5 }, (_, index) => ({ title: `Historique ${index} ${background}` })),
  });
  assert.ok(prompt.length <= 11_800);
  assert.match(prompt, /LOGO OFFICIEL FOURNI SÉPARÉMENT/);
  assert.match(prompt, /INTÉGRATION NATIVE DU LOGO/);
  assert.match(prompt, /logo officiel joint déjà intégré/);
  assert.doesNotMatch(prompt, new RegExp(exactText));
  assert.doesNotMatch(prompt, forbiddenLocalLogo);
});

test("an image without an attached logo does not acquire a native logo instruction", () => {
  const prompt = buildAiMediaImageGenerationPrompt({ request: request({ logoMode: "none", withText: true, textMode: "ai" }),
    profile: profile(), hasLogo: false, deferVisibleElementsToComposer: true, copy: { headline: "ACCROCHE_PRIVEE" } });
  assert.match(prompt, /Aucun logo n’est fourni/);
  assert.match(prompt, /produire exclusivement le fond sans texte/);
  assert.doesNotMatch(prompt, /INTÉGRATION NATIVE DU LOGO|ACCROCHE_PRIVEE/);
});

test("free ADN images integrate the logo natively even if an older caller still supplies the local flag", () => {
  const prompt = buildAiMediaFreeImagePrompt({ request: request({ creationMode: "free", useBusinessDna: true,
    freePrompt: "Une photographie de notre atelier avec notre logo en bas à droite." }),
    profile: profile(), hasLogo: true, logoComposedLocally: true });
  assert.match(prompt, /dernier fichier de référence est le logo officiel/);
  assert.match(prompt, /UNE SEULE FOIS/);
  assert.match(prompt, /Le logo fait partie du rendu du fournisseur/);
  assert.match(prompt, /en bas à droite/);
  assert.doesNotMatch(prompt, forbiddenLocalLogo);
});

test("free video keeps its existing local branding direction", () => {
  const prompt = buildAiMediaFreeVideoPrompt({ request: request({ creationMode: "free", kind: "video", imageEngine: undefined,
    videoEngine: "omni", durationSeconds: 8, withNarration: false, useBusinessDna: true, freePrompt: "Une équipe travaille avec notre logo." }),
    profile: profile(), hasLogo: false, logoComposedLocally: true });
  assert.match(prompt, /logo officiel sera placé exactement au montage/);
  assert.doesNotMatch(prompt, /Le logo fait partie du rendu du fournisseur/);
});
