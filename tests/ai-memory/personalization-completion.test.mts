import assert from "node:assert/strict";
import test from "node:test";
import { AI_CTA_CHANNELS } from "../../lib/aiChannelCtaPreferences.ts";
import {
  getCompanyCompletion,
  getCtaCompletion,
  getPersonalizationScore,
  getStrategyCompletion,
  type PersonalizationCompanyContext,
} from "../../lib/personalizationCompletion.ts";

const company = {
  detailedDescription: "Présentation de notre entreprise et de ses prestations professionnelles. ".repeat(2),
  mission: "Accompagner les professionnels dans leur communication au quotidien.",
  specialties: ["Communication", "Automatisation"],
  targetAudiences: ["Petites entreprises"], customerNeeds: ["Gagner du temps"],
  differentiators: ["Accompagnement personnalisé"], values: ["Clarté"],
  brandPersonality: ["Accessible"], commitments: ["Réponses précises"],
};
const business = {
  description: company.detailedDescription, services: ["Publication multicanale"],
  customerTypes: ["professionnels"], interventionZones: ["France entière"],
  strengths: ["Accompagnement personnalisé"], weeklySchedule: { notes: "Sur rendez-vous" },
};
const context: PersonalizationCompanyContext = {
  companyName: "Entreprise exemple", phone: "0612345678", contactEmail: "contact@example.com",
  logoPath: "profile/logo.png", postalCode: "75001", city: "Paris",
  sector: "Plateformes et services numériques", profession: "Logiciel en ligne",
};
const strategy = {
  offersAndArguments: "Présentation des offres et des services adaptés à chaque professionnel.",
  keyArguments: "Un point unique pour préparer sa communication.",
  proofsAndObjections: "Des exemples concrets et des démonstrations permettent de découvrir les fonctionnalités.",
  objectionResponses: "Un accompagnement est proposé pour prendre en main les fonctions.",
  editorialStrategy: "Présenter les usages concrets et les bénéfices pour les professionnels.",
  campaignCalendar: "Une publication chaque jour selon les besoins du professionnel.",
};
const ctas = Object.fromEntries(AI_CTA_CHANNELS.map(({ key }) => [key,
  { choice: "site", mode: "website", label: "En savoir plus", url: "https://example.com", phone: "" },
]));
const destinations = { preferredWebsiteUrl: "https://example.com", siteWebUrl: "https://example.com", phone: "0612345678" };

test("les cinq rubriques entreprise valent 75 points et les trois blocs complets donnent 100", () => {
  const actual = getCompanyCompletion(company, business, context);
  assert.equal(actual.points, 75); assert.equal(actual.maxPoints, 75); assert.equal(actual.percent, 100);
  assert.deepEqual(Object.fromEntries(Object.entries(actual.sections).map(([key, value]) => [key, value.maxPoints])),
    { profile: 5, activity: 30, audience: 15, local: 10, identity: 15 });
  for (const value of Object.values(actual.sections)) assert.equal(value.percent, 100);
  const goals = getStrategyCompletion(strategy), cta = getCtaCompletion(ctas, destinations, true);
  assert.equal(goals.points, 10); assert.equal(goals.percent, 100);
  assert.equal(cta.points, 15); assert.equal(cta.percent, 100);
  assert.equal(getPersonalizationScore(actual.percent, cta.percent, goals.percent), 100);
});

test("entreprise, CTA et stratégie contribuent exactement 75, 15 et 10 points séparément", () => {
  assert.equal(getPersonalizationScore(100, 0, 0), 75);
  assert.equal(getPersonalizationScore(0, 100, 0), 15);
  assert.equal(getPersonalizationScore(0, 0, 100), 10);
  assert.equal(getPersonalizationScore(0, 0, 0), 0);
});

test("des données absentes ou malformées ne fabriquent aucun contexte ni CTA", () => {
  for (const empty of [undefined, null, [], "", 42]) {
    assert.equal(getCompanyCompletion(empty, empty).points, 0);
    assert.equal(getStrategyCompletion(empty).points, 0);
    assert.equal(getCtaCompletion(empty, destinations).points, 0);
  }
});

const companyPointCases: Array<{ name: string; memory?: Record<string, unknown>; knowledge?: Record<string, unknown>; context?: PersonalizationCompanyContext; points: number }> = [
  { name: "nom de l’entreprise", context: { companyName: "Entreprise" }, points: 2 },
  { name: "téléphone", context: { phone: "0612345678" }, points: 1 },
  { name: "adresse de contact", context: { contactEmail: "contact@example.com" }, points: 1 },
  { name: "logo", context: { logoPath: "logo.png" }, points: 1 },
  { name: "secteur", context: { sector: "Numérique" }, points: 6 },
  { name: "métier", context: { profession: "Logiciel en ligne" }, points: 6 },
  { name: "présentation", memory: { detailedDescription: "a".repeat(80) }, points: 8 },
  { name: "prestations", knowledge: { services: ["Conseil"] }, points: 6 },
  { name: "spécialités", memory: { specialties: ["Conseil", "Publication"] }, points: 4 },
  { name: "typologies clients", knowledge: { customerTypes: ["professionnels"] }, points: 5 },
  { name: "cibles", memory: { targetAudiences: ["Entrepreneurs"] }, points: 5 },
  { name: "besoins clients", memory: { customerNeeds: ["Visibilité"] }, points: 5 },
  { name: "zones", knowledge: { interventionZones: ["France entière"] }, points: 6 },
  { name: "implantation", context: { postalCode: "75001", city: "Paris" }, points: 2 },
  { name: "horaires", knowledge: { weeklySchedule: { notes: "Sur rendez-vous" } }, points: 2 },
  { name: "différenciation", knowledge: { strengths: ["Accompagnement"] }, points: 5 },
  { name: "mission", memory: { mission: "m".repeat(30) }, points: 3 },
  { name: "valeurs", memory: { values: ["Clarté"] }, points: 2 },
  { name: "personnalité", memory: { brandPersonality: ["Accessible"] }, points: 3 },
  { name: "engagements", memory: { commitments: ["Réactivité"] }, points: 2 },
];
for (const example of companyPointCases) {
  test(`pondération utile à l’IA : ${example.name} = ${example.points} points`, () => {
    assert.equal(getCompanyCompletion(example.memory, example.knowledge, example.context).points, example.points);
  });
}

test("des représentations alternatives ne comptent pas deux fois le même renseignement", () => {
  assert.equal(getCompanyCompletion({}, {}, { logoPath: "logo.png", logoUrl: "https://example.com/logo.png" }).points, 1);
  assert.equal(getCompanyCompletion({ detailedDescription: "a".repeat(80) }, { description: "b".repeat(80) }).points, 8);
  assert.equal(getCompanyCompletion({ differentiators: ["Suivi"] }, { strengths: ["Suivi"] }).points, 5);
});

test("les seuils de contexte portent sur les données normalisées, pas sur des doublons ou des espaces", () => {
  assert.equal(getCompanyCompletion({ detailedDescription: "a".repeat(79), mission: "m".repeat(29), specialties: ["Conseil", " conseil "] }, {}).points, 0);
  assert.equal(getCompanyCompletion({}, {}, { companyName: "  ", city: " ", postalCode: "75001" }).points, 0);
  assert.equal(getCompanyCompletion({}, {}, { city: "Paris" }).points, 0);
  assert.equal(getCompanyCompletion({}, {}, { postalCode: "75001" }).points, 0);
});

test("consignes, interdictions, exemples, vocabulaire et paramètres IA restent sans points", () => {
  const optional = {
    instructions: "Consignes supplémentaires", forbiddenStyle: "Interdictions", likedExample: "Exemple apprécié 1", likedExample2: "Exemple apprécié 2",
    preferredVocabulary: ["Précis"], forbiddenVocabulary: ["Leader"],
    preferredEngine: "some-engine", tone: "warm", mainGoal: "contacts", preferredAngle: "trust", language: "fr",
    recentNewsItems: ["Actualité"], referenceDocuments: [{ name: "Document" }],
    firstName: "Titulaire", lastName: "Du compte",
  };
  assert.equal(getCompanyCompletion(optional, optional).points, 0);
  assert.equal(getStrategyCompletion(optional).points, 0);
  assert.deepEqual(getCompanyCompletion({ ...company, ...optional }, business, context), getCompanyCompletion(company, business, context));
  assert.deepEqual(getStrategyCompletion({ ...strategy, ...optional }), getStrategyCompletion(strategy));
});

test("les six champs de stratégie ne sont jamais recomptés dans Mon entreprise", () => {
  assert.equal(getCompanyCompletion(strategy, {}).points, 0);
  assert.equal(getStrategyCompletion(company).points, 0);
});

for (const edition of ["basic", "standard", "premium", "founder"]) {
  test(`les mêmes données donnent les mêmes scores pour l’édition ${edition}`, () => {
    assert.equal(getCompanyCompletion({ ...company, edition }, business, context).percent, 100);
    assert.equal(getStrategyCompletion({ ...strategy, edition }).percent, 100);
  });
}

test("les seuils existants des six objectifs et stratégies valent chacun un sixième du bloc", () => {
  const thresholds = { offersAndArguments: 40, keyArguments: 30, proofsAndObjections: 40, objectionResponses: 30, editorialStrategy: 40, campaignCalendar: 30 };
  for (const [key, minimum] of Object.entries(thresholds)) {
    assert.equal(getStrategyCompletion({ [key]: "x".repeat(minimum - 1) }).points, 0, key);
    const result = getStrategyCompletion({ [key]: "x".repeat(minimum) });
    assert.equal(result.points, 10 / 6, key);
    assert.equal(result.percent, (10 / 6) / 10 * 100, key);
  }
});

test("un site et un téléphone disponibles ne remplacent pas les choix CTA explicites obligatoires", () => {
  assert.deepEqual(getCtaCompletion({}, destinations, true), { points: 0, maxPoints: 15, percent: 0, configuredCount: 0, totalCount: 10 });
  assert.equal(getCtaCompletion({ facebook: { choice: "none", mode: "none" } }, destinations, true).configuredCount, 0);
  assert.equal(getCtaCompletion({ inconnu: { choice: "site", url: "https://example.com" } }, destinations, true).configuredCount, 0);
});

test("le CTA exige une destination utilisable et refuse les overrides explicitement invalides", () => {
  assert.equal(getCtaCompletion({ facebook: { choice: "site" } }, null, true).configuredCount, 0);
  assert.equal(getCtaCompletion({ facebook: { choice: "site" } }, destinations, true).configuredCount, 1);
  assert.equal(getCtaCompletion({ facebook: { choice: "custom", url: "javascript:alert(1)" } }, destinations, true).configuredCount, 0);
  assert.equal(getCtaCompletion({ facebook: { choice: "appeler", phone: "invalid" } }, destinations, true).configuredCount, 0);
  assert.equal(getCtaCompletion({ facebook: { choice: "appeler", phone: 123 } }, destinations, true).configuredCount, 0);
  assert.equal(getCtaCompletion({ facebook: { choice: "appeler", phone: "+33612345678" } }, null, true).configuredCount, 1);
});

test("Threads est retiré du dénominateur lorsqu’il est masqué, les autres canaux restent tous requis", () => {
  const nineCtas = { ...ctas }; delete nineCtas.threads;
  const hidden = getCtaCompletion(nineCtas, destinations, false);
  assert.equal(hidden.totalCount, 9); assert.equal(hidden.configuredCount, 9); assert.equal(hidden.points, 15);
  const visible = getCtaCompletion(nineCtas, destinations, true);
  assert.equal(visible.totalCount, 10); assert.equal(visible.configuredCount, 9); assert.equal(visible.points, 13.5);
  assert.equal(getCtaCompletion({ threads: ctas.threads }, destinations, false).configuredCount, 0);
  assert.equal(getCtaCompletion({ facebook: ctas.facebook }, destinations, false).totalCount, 9);
});

test("le score global conserve les fractions puis arrondit seulement le résultat final", () => {
  assert.equal(getPersonalizationScore(73 / 75 * 100, 10 / 15 * 100, 5 / 10 * 100), 88);
  assert.equal(getPersonalizationScore(100, 90, 100), 99);
  assert.equal(getCompanyCompletion({}, {}, { phone: "0612345678" }).percent, 1 / 75 * 100);
});

test("les entrées non finies ou hors plage ne peuvent pas produire un pourcentage invalide", () => {
  assert.equal(getPersonalizationScore(Number.NaN, 100, 100), 25);
  assert.equal(getPersonalizationScore(100, Number.POSITIVE_INFINITY, 100), 85);
  assert.equal(getPersonalizationScore(-10, -10, -10), 0);
  assert.equal(getPersonalizationScore(1000, 1000, 1000), 100);
});
