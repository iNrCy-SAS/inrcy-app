import assert from "node:assert/strict";
import test from "node:test";
import { addLinkedInAudienceTarget, linkedInCallToActionFromLabel, normalizeLinkedInAudienceSuggestions, normalizeLinkedInBudgetSuggestion, uniqueLinkedInAudienceMatch } from "../lib/adsLinkedInAudienceSuggestions.ts";
import type { LinkedInProfessionalTarget } from "../lib/adsLinkedInCampaignSettings.ts";

const owner: LinkedInProfessionalTarget = { facet: "seniorities", urn: "urn:li:seniority:10", name: "Propriétaire" };
const title: LinkedInProfessionalTarget = { facet: "titles", urn: "urn:li:title:100", name: "Directeur" };
const small: LinkedInProfessionalTarget = { facet: "companySizes", urn: "urn:li:staffCountRange:(2,10)", name: "2 à 10 employés" };
const empty = () => ({ include: [] as LinkedInProfessionalTarget[], exclude: [] as LinkedInProfessionalTarget[] });

test("l’IA propose des libellés humains bornés et aucune URN, même en majuscules", () => {
  assert.deepEqual(normalizeLinkedInAudienceSuggestions([{ facet: "companySizes", terms: ["2-10", "URN:li:title:7", "x".repeat(81), " 2-10 "] }, { facet: "invented", terms: ["test"] }]), [{ facet: "companySizes", terms: ["2-10"] }]);
});
test("le plan IA ne propose pas titres ET niveaux hiérarchiques incompatibles", () => {
  assert.deepEqual(normalizeLinkedInAudienceSuggestions([{ facet: "titles", terms: ["Directeur"] }, { facet: "seniorities", terms: ["Propriétaire"] }, { facet: "functions", terms: ["Ventes"] }]), [{ facet: "titles", terms: ["Directeur"] }]);
});
test("une correspondance exacte et unique accepte accents et ponctuation", () => {
  assert.equal(uniqueLinkedInAudienceMatch("proprietaire", [owner]), owner);
});
test("un alias français accepte le nom natif anglais mais ne crée jamais de ressource", () => {
  const native = { name: "Owner", urn: "urn:li:seniority:10" };
  assert.equal(uniqueLinkedInAudienceMatch("propriétaire", [native]), native);
  assert.equal(uniqueLinkedInAudienceMatch("propriétaire", []), null);
});
test("une proposition ambiguë reste à confirmer au lieu de sélectionner le premier résultat", () => {
  assert.equal(uniqueLinkedInAudienceMatch("propriétaire", [owner, { ...owner, urn: "urn:li:seniority:11" }]), null);
  assert.equal(uniqueLinkedInAudienceMatch("directeur", [{ name: "Directeur commercial" }]), null);
});
test("les tranches natives en français et anglais sont reconnues sans fabriquer d’URN", () => {
  assert.equal(uniqueLinkedInAudienceMatch("2-10", [small]), small);
  const larger = { name: "51–200 employees" };
  assert.equal(uniqueLinkedInAudienceMatch("51-200", [larger]), larger);
});
test("les ajouts automatiques successifs respectent le ciblage existant", () => {
  const a = addLinkedInAudienceTarget(empty(), title, "include");
  const b = addLinkedInAudienceTarget(a.targeting, owner, "include");
  assert.match(b.error || "", /ne peuvent pas être combinées/);
  assert.deepEqual(b.targeting.include, [title]);
});
test("une taille exclue bloque toutes les tailles incluses, même différentes", () => {
  const a = addLinkedInAudienceTarget(empty(), small, "exclude");
  const other = { ...small, urn: "urn:li:staffCountRange:(11,50)" };
  const b = addLinkedInAudienceTarget(a.targeting, other, "include");
  assert.match(b.error || "", /inclusion ou en exclusion/);
  assert.deepEqual(b.targeting, a.targeting);
});
test("un même critère ne peut pas être inclus et exclu", () => {
  const a = addLinkedInAudienceTarget(empty(), owner, "exclude");
  assert.match(addLinkedInAudienceTarget(a.targeting, owner, "include").error || "", /sélection opposée/);
});
test("les doublons ne consomment pas le quota et les sélections ne sont pas mutées", () => {
  const original = empty();
  const next = addLinkedInAudienceTarget(original, owner, "include");
  assert.deepEqual(original, empty());
  assert.equal(addLinkedInAudienceTarget(next.targeting, owner, "include").targeting, next.targeting);
  const full = { include: Array.from({ length: 100 }, (_, i) => ({ ...owner, urn: `urn:li:seniority:${i + 100}` })), exclude: [] };
  assert.match(addLinkedInAudienceTarget(full, owner, "include").error || "", /100 critères/);
});
test("le CTA proposé en français devient le bouton natif correspondant", () => {
  assert.equal(linkedInCallToActionFromLabel("S’inscrire"), "SIGN_UP");
  assert.equal(linkedInCallToActionFromLabel("Demander une démonstration"), "REQUEST_DEMO");
  assert.equal(linkedInCallToActionFromLabel("Demander un devis"), "VIEW_QUOTE");
  assert.equal(linkedInCallToActionFromLabel("libellé inconnu"), "LEARN_MORE");
});

test("l’enveloppe IA explicite est conservée comme total, sans coercition de montant", () => {
  assert.deepEqual(normalizeLinkedInBudgetSuggestion({ type: "total", totalEuros: 200 }), { type: "total", totalEuros: 200 });
  assert.deepEqual(normalizeLinkedInBudgetSuggestion({ type: "daily", totalEuros: 200 }), { type: "daily", totalEuros: null });
  for (const amount of ["200", 4, 45001, 12.001, NaN, Infinity]) assert.equal(normalizeLinkedInBudgetSuggestion({ type: "total", totalEuros: amount }), null);
});


test("un conseil anglais Owner résout l’unique libellé Propriétaire réellement renvoyé par LinkedIn en français", () => {
  assert.equal(uniqueLinkedInAudienceMatch("Owner", [owner, { ...owner, name: "Directeur", urn: "urn:li:seniority:6" }]), owner);
  assert.equal(uniqueLinkedInAudienceMatch("Owner", []), null);
  assert.equal(uniqueLinkedInAudienceMatch("Owner", [owner, { ...owner, urn: "urn:li:seniority:11" }]), null);
});
