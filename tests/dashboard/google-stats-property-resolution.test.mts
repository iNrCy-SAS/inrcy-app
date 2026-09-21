import assert from "node:assert/strict";
import test from "node:test";

import { selectGa4PropertyForDomain } from "../../lib/googleStatsGa4Selection.ts";
import {
  doesGscPropertyCoverSite,
  selectGscPropertyForSite,
} from "../../lib/googleStatsGscSelection.ts";

test("GA4 considère www et le domaine nu comme le même site", () => {
  const result = selectGa4PropertyForDomain("www.exemple.fr", [
    {
      propertyId: "123",
      measurementId: "G-EXEMPLE",
      defaultUri: "https://exemple.fr",
    },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.candidate.propertyId, "123");
  assert.equal(result.resolution, "exact_domain");
});

test("GA4 choisit l'unique propriété Web accessible si son URL de flux est absente ou obsolète", () => {
  const result = selectGa4PropertyForDomain("www.exemple.fr", [
    {
      propertyId: "456",
      measurementId: "G-UNIQUE",
      defaultUri: "https://ancien-domaine.fr",
    },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.candidate.propertyId, "456");
  assert.equal(result.resolution, "single_accessible_property");
});

test("GA4 ne choisit jamais arbitrairement entre plusieurs propriétés étrangères", () => {
  const result = selectGa4PropertyForDomain("exemple.fr", [
    { propertyId: "111", defaultUri: "https://autre.fr" },
    { propertyId: "222", defaultUri: "https://encore-autre.fr" },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.accessiblePropertyCount, 2);
});

test("GA4 déduplique les différents flux Web d'une même propriété", () => {
  const result = selectGa4PropertyForDomain("exemple.fr", [
    { propertyId: "123", measurementId: "G-PREMIER", defaultUri: "https://www.exemple.fr" },
    { propertyId: "123", measurementId: "G-DEUXIEME", defaultUri: "https://exemple.fr" },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.accessiblePropertyCount, 1);
  assert.equal(result.candidate.propertyId, "123");
  assert.equal(result.candidate.measurementId, undefined);
});

test("GSC accepte une propriété de domaine racine pour un sous-domaine", () => {
  const result = selectGscPropertyForSite(
    [{ siteUrl: "sc-domain:exemple.fr" }],
    "boutique.exemple.fr",
    "https://boutique.exemple.fr",
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.property, "sc-domain:exemple.fr");
  assert.equal(result.resolution, "parent_domain_property");
});

test("GSC préfère la propriété de domaine la plus précise", () => {
  const result = selectGscPropertyForSite(
    [
      { siteUrl: "sc-domain:exemple.fr" },
      { siteUrl: "sc-domain:boutique.exemple.fr" },
    ],
    "www.boutique.exemple.fr",
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.property, "sc-domain:boutique.exemple.fr");
  assert.equal(result.resolution, "exact_domain_property");
});

test("GSC rapproche les variantes www/non-www d'un préfixe URL", () => {
  const result = selectGscPropertyForSite(
    [{ siteUrl: "https://exemple.fr/" }],
    "www.exemple.fr",
    "https://www.exemple.fr/",
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.property, "https://exemple.fr/");
  assert.equal(result.resolution, "equivalent_url_prefix");
});

test("GSC refuse une propriété sans rapport avec le site", () => {
  const result = selectGscPropertyForSite(
    [{ siteUrl: "sc-domain:autre.fr" }],
    "exemple.fr",
    "https://exemple.fr",
  );

  assert.equal(result.ok, false);
  assert.equal(doesGscPropertyCoverSite("https://autre.fr/", "exemple.fr"), false);
});
