import assert from "node:assert/strict";
import test from "node:test";
import { adsCopyList, adsCopyLooksIncomplete, adsPlanGeographyConflicts, adsPlanQualityRepairInstructions, adsPlanRepairDetails, canRepairAdsPlanQuality, selectAdsPlanLocations } from "../lib/adsPlanQuality.ts";
import { normalizeAdsCampaignPlan, assessAdsCampaignPlanReview, isPossiblyTruncatedLinkedInSignal, presentAdsCampaignRationale } from "../lib/adsCampaignPlan.ts";
import { generateAdsCampaignWithFallback } from "../lib/adsCampaignIntelligence.ts";

const context = {
  provider: "google" as const,
  companyName: "Atelier Nord",
  services: ["Réparation de vélos"],
  locations: ["Hauts-de-France", "France", "Arras", "Lille", "Valenciennes"],
};
const googleCopy = {
  name: "Réparation de vélos à Lille",
  offer: "Réparation de vélos",
  rationale: "La campagne propose la réparation aux cyclistes qui cherchent un atelier dans les villes desservies. Search permet de répondre à cette demande précise et d’inviter à prendre rendez-vous ; le suivi de cette action devra être confirmé.",
  campaignType: "search",
  conversionGoal: "website_visit",
  headlines: ["Réparation de vélos", "Votre atelier à Lille", "Prenez rendez-vous", "Réglage de freins", "Entretien de votre vélo", "Atelier Nord à Lille"],
  descriptions: ["Faites réparer votre vélo dans notre atelier à Lille.", "Réglage de freins et entretien de vélos. Prenez rendez-vous.", "Découvrez les services de notre atelier et contactez notre équipe."],
  keywords: ["réparation vélo Lille", "atelier vélo Lille", "entretien vélo Lille", "réglage freins vélo", "réparation vélo Arras", "révision vélo Lille"],
};

test("local zones reject national campaign claims without confusing country qualifiers or negation", () => {
  const base = { targetLocations: ["Arras, Hauts-de-France, France", "Lille, France"], name: "Plombier à Arras", rationale: "La campagne cible les deux villes sélectionnées." };
  assert.equal(adsPlanGeographyConflicts(base), false);
  for (const rationale of ["Le ciblage national est cohérent avec l’offre SaaS.", "La campagne est nationale.", "La diffusion vise toute la France."]) {
    assert.equal(adsPlanGeographyConflicts({ ...base, rationale }), true, rationale);
  }
  assert.equal(adsPlanGeographyConflicts({ ...base, name: "Search – Pros – France" }), true);
  assert.equal(adsPlanGeographyConflicts({ ...base, name: "Search – Hauts-de-France" }), false);
  for (const rationale of ["Nous évitons tout ciblage national et privilégions Arras.", "Sans campagne nationale, les deux villes restent ciblées.", "Il ne faut pas cibler toute la France.", "Le ciblage n’est pas national."]) {
    assert.equal(adsPlanGeographyConflicts({ ...base, rationale }), false, rationale);
  }
  assert.equal(adsPlanGeographyConflicts({ ...base, targetLocations: ["France"], rationale: "Le ciblage national est cohérent." }), false);
  assert.match(adsPlanQualityRepairInstructions(["geography_scope_conflict"]), /zones de campagne/);
});

test("primary editorial repair leaves time for fallbacks and only handles identified quality defects", () => {
  assert.equal(canRepairAdsPlanQuality(["description_too_long"], 45_000), true);
  assert.equal(canRepairAdsPlanQuality(["geography_scope_conflict", "search_headlines_repetitive"], 70_000), true);
  assert.equal(canRepairAdsPlanQuality(["description_too_long"], 44_999), false);
  assert.equal(canRepairAdsPlanQuality([], 80_000), false);
  assert.equal(canRepairAdsPlanQuality(["native_draft_missing"], 80_000), false);
});

test("repair feedback contains measured failed copy intact, without mislabelling valid assets", () => {
  const overlong = "Réparation de fuites sur robinetterie et canalisations intérieures à Arras. Prenez rendez-vous.";
  const plan = normalizeAdsCampaignPlan({ ...googleCopy, descriptions: [overlong, ...googleCopy.descriptions] }, context);
  const details = JSON.parse(adsPlanRepairDetails(plan, "google"));
  assert.equal(details.rejectedFields.length, 1);
  assert.equal(details.rejectedFields[0].text, overlong);
  assert.equal(details.rejectedFields[0].actual, Array.from(overlong).length);
  assert.equal(details.rejectedFields[0].maximum, 90);
  assert.deepEqual(details.selectedLocations, ["Arras", "Lille", "Valenciennes"]);
});

test("saved rationale renders platform enums as business language without altering campaign data", () => {
  const rationale = "Un format REGULAR avec objectif website_traffic et maximize_clicks pour Arras.";
  assert.equal(presentAdsCampaignRationale(rationale), "Un format image unique avec objectif visites du site et maximisation des clics pour Arras.");
  assert.equal(presentAdsCampaignRationale("REGULARITY : campagne locale à Arras."), "REGULARITY : campagne locale à Arras.");
});

test("LinkedIn keeps complete targeting ideas beyond 80 characters without cutting a word", () => {
  const complete = "Professionnels souhaitant centraliser leur communication digitale et publier sur plusieurs canaux depuis un même espace.";
  const overlong = "Professionnels qui souhaitent centraliser leur communication et organiser leurs publications. ".repeat(5).trim();
  assert.ok(complete.length > 80 && complete.length < 300);
  assert.ok(overlong.length > 300);
  const plan = normalizeAdsCampaignPlan({ keywords: [complete, overlong] }, { ...context, provider: "linkedin" });
  assert.deepEqual(plan.keywords, [complete]);
  assert.equal(plan.keywords.some((signal) => signal === overlong.slice(0, 300)), false);
  assert.equal(isPossiblyTruncatedLinkedInSignal(complete), false);
  for (const fragment of [
    "Professionnels recherchant un moyen de centraliser leur communication digitale, ",
    "Professionnels souhaitant centraliser leur communication digitale et publier sur",
    "Essai gratuit de 21 jours sans engagement pour tester iNrCy, une plateforme de p",
  ]) {
    assert.equal(fragment.length, 80);
    assert.equal(isPossiblyTruncatedLinkedInSignal(fragment), true);
  }
});

test("Google fills a missing main message from complete copy without adding commercial claims", () => {
  const plan = normalizeAdsCampaignPlan(googleCopy, context);
  assert.equal(plan.primaryText, googleCopy.descriptions.join(" "));
  assert.equal(plan.callToAction, "En savoir plus");
  assert.equal(assessAdsCampaignPlanReview(plan, "google").reviewable, true);
  assert.deepEqual(plan.targetLocations, ["Arras", "Lille", "Valenciennes"]);
});

test("an overlong sentence triggers a new model proposal instead of a partial word", async () => {
  const tooLong = "Publiez sur douze canaux en un seul clic";
  const accepted = "Publiez sur douze canaux";
  let calls = 0;
  const result = await generateAdsCampaignWithFallback({
    generate: async (_model, index) => {
      calls += 1;
      return { ...googleCopy, headlines: [index === 0 ? tooLong : accepted, ...googleCopy.headlines.slice(1)] };
    },
    validate: (raw) => {
      const plan = normalizeAdsCampaignPlan(raw, context);
      if (calls === 1) {
        assert.equal(plan.headlines[0], tooLong);
        assert.ok(assessAdsCampaignPlanReview(plan, "google").issueCodes.includes("headline_too_long"));
      }
      return assessAdsCampaignPlanReview(plan, "google").reviewable ? plan : null;
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.plan.headlines[0], accepted);
});

test("copy punctuation is not treated as an asset separator and incomplete endings are rejected", () => {
  assert.deepEqual(adsCopyList("Une offre, un atelier ; un conseil.\nPrenez rendez-vous.", 4), ["Une offre, un atelier ; un conseil.", "Prenez rendez-vous."]);
  for (const text of ["Découvrez notre offre pour", "Réparez votre vélo…", "Contactez notre", "Une offre avec", "Votre service d’"]) {
    assert.equal(adsCopyLooksIncomplete(text), true, text);
  }
  for (const text of ["Un atelier pour votre vélo", "Prenez rendez-vous", "En savoir plus", "Vélos à Lille", "Découvrez https://exemple.de"]) {
    assert.equal(adsCopyLooksIncomplete(text), false, text);
  }
});

test("country and regional overlap are removed for a local campaign on every channel", () => {
  assert.deepEqual(selectAdsPlanLocations(context), ["Arras", "Lille", "Valenciennes"]);
  assert.deepEqual(selectAdsPlanLocations({ locations: ["France", "Hauts-de-France"], city: "Lille" }), ["Lille"]);
  assert.deepEqual(selectAdsPlanLocations({ locations: ["France", "Hauts-de-France"] }), ["Hauts-de-France"]);
  assert.deepEqual(selectAdsPlanLocations({ locations: ["Lille, France"], country: "France" }), ["Lille, France"]);
  assert.deepEqual(selectAdsPlanLocations({ locations: ["Hauts-de-France", "et toute la France", "Arras", "Lille"], city: "Sallaumines", country: "France" }), ["Arras", "Lille"]);
  assert.deepEqual(selectAdsPlanLocations({ locations: ["dans toute la France", "Lille"] }), ["Lille"]);
  assert.deepEqual(selectAdsPlanLocations({ locations: [], country: "France" }), []);
  assert.deepEqual(normalizeAdsCampaignPlan({ targetLocations: ["France"] }, { provider: "google" }).targetLocations, []);
});

test("an explicit national brief uses the trusted country, while negated national requests stay local", () => {
  assert.deepEqual(selectAdsPlanLocations({ ...context, intent: "Je veux une campagne sur toute la France." }), ["France"]);
  assert.deepEqual(selectAdsPlanLocations({ locations: ["Lille"], country: "France", intent: "Campagne nationale pour notre service en ligne." }), ["France"]);
  assert.deepEqual(selectAdsPlanLocations({ ...context, intent: "Je ne veux pas cibler toute la France, seulement les villes locales." }), ["Arras", "Lille", "Valenciennes"]);
});

test("Pinterest descriptions between 500 and 800 characters remain intact in both representations", () => {
  const description = "Découvrez les étapes pour préparer votre projet avec notre équipe. ".repeat(9).trim();
  assert.ok(description.length > 500 && description.length < 800);
  const plan = normalizeAdsCampaignPlan({
    name: "Préparer votre projet",
    offer: "Accompagnement de projet",
    rationale: "L’épingle présente aux professionnels locaux les étapes de préparation de leur projet. Cette approche visuelle encourage la découverte du service, sans supposer qu’un suivi de conversion existe.",
    primaryText: description,
    channelDraft: {
      schemaVersion: 1, channel: "pinterest", name: "Préparer votre projet",
      budget: { amount: 10, currency: "EUR", period: "daily", level: "campaign" },
      audience: { audienceBrief: "Professionnels préparant leur projet local" },
      objectiveType: "AWARENESS", intendedPromotionType: "STANDARD_AD", targetingMode: "automatic", creativeType: "REGULAR",
      creative: { pinTitle: "Préparez votre projet local", pinDescription: description, visualBrief: "Illustrer les étapes de préparation d’un projet professionnel." },
    },
  }, { ...context, provider: "pinterest" });
  assert.equal(plan.primaryText, description);
  assert.equal(plan.channelDraft?.channel === "pinterest" ? plan.channelDraft.creative.pinDescription : null, description);
  assert.equal(assessAdsCampaignPlanReview(plan, "pinterest").reviewable, true);
});

test("strategy review rejects missing rationale and self-defeating negative keywords", () => {
  const unexplained = normalizeAdsCampaignPlan({ ...googleCopy, rationale: "Bonne campagne." }, context);
  assert.ok(assessAdsCampaignPlanReview(unexplained, "google").issueCodes.includes("missing_strategy_explanation"));
  const conflict = normalizeAdsCampaignPlan({ ...googleCopy, negativeKeywords: ["vélo"] }, context);
  const review = assessAdsCampaignPlanReview(conflict, "google");
  assert.equal(review.reviewable, false);
  assert.ok(review.issueCodes.includes("search_negative_keywords_conflict"));
  const relevantExclusion = normalizeAdsCampaignPlan({ ...googleCopy, negativeKeywords: ["emploi", "formation mécanique"] }, context);
  assert.equal(assessAdsCampaignPlanReview(relevantExclusion, "google").reviewable, true);
});

test("changing punctuation or word order does not create sufficiently varied Search headlines", () => {
  const plan = normalizeAdsCampaignPlan({
    ...googleCopy,
    headlines: ["Réparation vélo Lille", "Lille réparation vélo", "Réparation vélo, Lille !", "Votre atelier à Lille", "Prenez rendez-vous", "Réglage de freins"],
  }, context);
  const issues = assessAdsCampaignPlanReview(plan, "google").issueCodes;
  assert.ok(issues.includes("search_headlines_repetitive"));
  const correction = adsPlanQualityRepairInstructions([...issues, "search_negative_keywords_conflict", "missing_strategy_explanation"]);
  assert.match(correction, /Varie réellement les angles/);
  assert.match(correction, /aucun mot-clé négatif ne doit bloquer/);
  assert.match(correction, /offre attestée/);
});
