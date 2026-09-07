import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import {
  aiMediaDialogueSignature,
  selectAiMediaDialogueLine,
} from "../../lib/aiMediaDialogue.ts";
import { getAiMediaVideoSegmentCount } from "../../lib/aiMediaVideoTimeline.ts";

const ROOT = process.cwd();

function loadCreativePlanBuilder() {
  const filename = path.join(ROOT, "lib/aiMediaCreativePlan.ts");
  const source = readFileSync(filename, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const copy = {
    professionalFallback: "Professionnel",
    sublineFallback: "Une expertise au service de votre projet",
    supportingEyebrow: "Notre expertise",
    supportingTitle: "Une méthode concrète",
    supportingBody: "Une action claire et professionnelle",
    headlines: { service: "Une expertise pensée pour vous" },
    ctas: { appeler: "Contactez-nous", none: "En savoir plus" },
  };
  const stubs = new Map<string, unknown>([
    ["@/lib/aiMediaDialogue", { aiMediaDialogueSignature, selectAiMediaDialogueLine }],
    ["@/lib/aiMediaLanguage", { getAiMediaLanguageCopy: () => copy }],
    ["@/lib/aiMediaVideoTimeline", { getAiMediaVideoSegmentCount }],
  ]);
  const localRequire = (specifier: string) => {
    if (stubs.has(specifier)) return stubs.get(specifier);
    throw new Error(`unexpected_test_dependency:${specifier}`);
  };
  const commonJsModule = { exports: {} as Record<string, unknown> };
  const factory = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {${transpiled}\n})`,
    { filename: "aiMediaCreativePlan.runtime.cjs" },
  ) as (
    exports: Record<string, unknown>,
    require: (specifier: string) => unknown,
    module: { exports: Record<string, unknown> },
    filename: string,
    dirname: string,
  ) => void;
  factory(
    commonJsModule.exports,
    localRequire,
    commonJsModule,
    filename,
    path.dirname(filename),
  );
  return commonJsModule.exports.buildAiMediaCreativePlan as (args: Record<string, unknown>) => {
    headline: string;
    scenes: Array<{ layout: string; title: string; visualBrief: string }>;
  };
}

test("les films 16/24 s gardent leur nombre d'actes et finissent par une vraie conclusion liée au sujet", () => {
  const buildAiMediaCreativePlan = loadCreativePlanBuilder();
  const profile = {
    preferences: { language: "fr", preferredCta: "appeler" },
    business: {
      companyName: "Atelier Horizon",
      professionLabel: "Agence de communication",
      sectorLabel: "Communication",
      description: "Une agence qui centralise la création et la publication.",
      services: ["Création de contenus", "Publication multicanale", "Analyse des résultats"],
      strengths: ["Accompagnement sur mesure"],
      customerTypologies: ["Entreprises locales"],
      interventionZones: ["France"],
      city: "Arras",
      openingHours: "",
    },
  };
  const idea = "partir d'une page blanche, publier une campagne puis observer les résultats";

  for (const durationSeconds of [16, 24] as const) {
    const plan = buildAiMediaCreativePlan({
      request: {
        requestId: `story-${durationSeconds}`,
        durationSeconds,
        subjectSource: "custom",
        idea,
        aiInstruction: "",
        withText: false,
        textKeywords: [],
        typology: "service",
      },
      profile,
      recentPublications: [],
    });
    assert.equal(plan.scenes.length, durationSeconds / 8);
    assert.match(plan.headline, /page blanche/i);
    assert.notEqual(
      plan.headline.toLocaleLowerCase(),
      idea.toLocaleLowerCase(),
      "l'idée doit orienter l'accroche sans être recopiée telle quelle",
    );
    assert.equal(
      plan.headline.includes("…"),
      false,
      "le secours local doit reformuler l'idée plutôt que la tronquer",
    );
    assert.equal(plan.scenes.at(-1)?.layout, "cta");
    assert.match(plan.scenes.at(-1)?.visualBrief || "", /page blanche/i);
    assert.match(plan.scenes.at(-1)?.visualBrief || "", /résultat concret/i);
  }
});

test("une collision entre prestation et CTA ne peut jamais supprimer la conclusion", () => {
  const buildAiMediaCreativePlan = loadCreativePlanBuilder();
  const profile = {
    preferences: { language: "fr", preferredCta: "appeler" },
    business: {
      companyName: "Atelier Horizon",
      professionLabel: "Contactez-nous",
      sectorLabel: "Services",
      description: "Un accompagnement professionnel.",
      services: ["Contactez-nous"],
      strengths: [],
      customerTypologies: [],
      interventionZones: [],
      city: "Arras",
      openingHours: "",
    },
  };
  let duplicateTitlePlan:
    | ReturnType<typeof buildAiMediaCreativePlan>
    | undefined;
  for (let index = 0; index < 100 && !duplicateTitlePlan; index += 1) {
    const plan = buildAiMediaCreativePlan({
      request: {
        requestId: `cta-collision-${index}`,
        durationSeconds: 16,
        subjectSource: "profile",
        idea: "",
        aiInstruction: "",
        withText: false,
        textKeywords: [],
        typology: "service",
      },
      profile,
      recentPublications: [],
    });
    if (plan.scenes[0]?.title === "Contactez-nous") duplicateTitlePlan = plan;
  }

  assert.ok(duplicateTitlePlan, "le scénario de collision doit être atteint");
  assert.equal(duplicateTitlePlan.scenes.length, 2);
  assert.equal(duplicateTitlePlan.scenes.at(-1)?.layout, "cta");
});

test("une idée formulée comme une action devient une accroche française naturelle", () => {
  const buildAiMediaCreativePlan = loadCreativePlanBuilder();
  const idea = "un artisan reçoit une demande urgente";
  const profile = {
    preferences: { language: "fr", preferredCta: "appeler" },
    business: {
      companyName: "Atelier Horizon",
      professionLabel: "Artisan",
      sectorLabel: "Artisanat",
      description: "Un artisan disponible pour les demandes urgentes.",
      services: ["Intervention artisanale"],
      strengths: [],
      customerTypologies: [],
      interventionZones: ["Arras"],
      city: "Arras",
      openingHours: "",
    },
  };

  for (let index = 0; index < 12; index += 1) {
    const plan = buildAiMediaCreativePlan({
      request: {
        requestId: `artisan-urgent-${index}`,
        durationSeconds: 8,
        subjectSource: "custom",
        idea,
        aiInstruction: "",
        withText: true,
        textKeywords: [],
        typology: "service",
      },
      profile,
      recentPublications: [],
    });
    assert.match(plan.headline, /artisan|demande urgente/i);
    assert.doesNotMatch(
      plan.headline,
      /^(?:cap sur )?un artisan reçoit une demande urgente(?: prend vie|, autrement)?$/i,
    );
    assert.equal(plan.headline.includes("…"), false);
  }
});

test("le secours local conserve les noms propres entiers et corrige le sujet peinture", () => {
  const buildAiMediaCreativePlan = loadCreativePlanBuilder();
  const idea = "peinture réalisées dans une école à Guyancourt";
  const profile = {
    preferences: { language: "fr", preferredCta: "appeler" },
    business: {
      companyName: "Agira Bâtiments",
      professionLabel: "Entreprise de peinture",
      sectorLabel: "Bâtiment",
      description: "Travaux de peinture pour les professionnels.",
      services: ["Peinture intérieure"],
      strengths: [],
      customerTypologies: ["Écoles"],
      interventionZones: ["Guyancourt"],
      city: "Guyancourt",
      openingHours: "",
    },
  };

  for (let index = 0; index < 12; index += 1) {
    const plan = buildAiMediaCreativePlan({
      request: {
        requestId: `guyancourt-${index}`,
        durationSeconds: 8,
        subjectSource: "custom",
        idea,
        aiInstruction: "",
        withText: true,
        textKeywords: [],
        typology: "service",
      },
      profile,
      recentPublications: [],
    });
    assert.match(plan.headline, /Guyancourt/);
    assert.doesNotMatch(plan.headline, /Guyanc(?:\s|$|[,.!?])/);
    assert.doesNotMatch(plan.headline, /peinture réalisées/i);
  }
});
