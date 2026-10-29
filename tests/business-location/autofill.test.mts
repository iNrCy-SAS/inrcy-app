import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMissingBusinessLocationPatch,
  resolveBusinessIdentitySuggestions,
  resolveBusinessLocationCandidate,
  validateBusinessLocation,
  type BusinessLocationSource,
} from "../../lib/businessLocationAutofill.ts";

const source = (key: string, payload: unknown, status = "analyzed"): BusinessLocationSource => ({
  key, status, content: typeof payload === "string" ? payload : JSON.stringify(payload),
});
const gmb = (zip = "62440", city = "Harnes") => source("google_business", {
  details: { title: "Entreprise réelle", address: { postalCode: zip, locality: city }, phoneNumbers: { primaryPhone: "06 31 26 08 12" } },
  localPosts: [{ summary: "Adresse client : 75002 Paris" }],
});

test("l’adresse Google sélectionnée prime sur Facebook et les descriptions", () => {
  const result = resolveBusinessLocationCandidate([
    source("facebook", { profile: { location: { zip: "59000", city: "Lille" } } }), gmb(),
  ]);
  assert.deepEqual(result, { postalCode: "62440", city: "Harnes", source: "google_business", priority: 0 });
});

test("serviceArea, avis, publications, documents et sources non analysées ne sont pas une implantation", () => {
  assert.equal(resolveBusinessLocationCandidate([
    source("google_business", { details: { serviceArea: { places: [{ postalCode: "75002", city: "Paris" }] } }, reviews: [{ address: { postalCode: "75002", city: "Paris" } }] }),
    source("instagram", { media: [{ caption: "Adresse : 75002 Paris" }] }),
    source("inr_search", { profile: { location: { zip: "75002", city: "Paris" } } }),
    source("inrcy_publications", { profile: { location: { zip: "75002", city: "Paris" } } }),
    source("facebook", { profile: { location: { zip: "75002", city: "Paris" } } }, "needs_reconnect"),
  ]), null);
});

test("une bio de canal peut donner un siège explicite, mais pas une zone d’intervention", () => {
  assert.equal(resolveBusinessLocationCandidate([source("instagram", { profile: { biography: "Siège social : 12 rue Verte\n62440 Harnes" } })])?.city, "Harnes");
  assert.equal(resolveBusinessLocationCandidate([source("instagram", { profile: { biography: "Zone d’intervention : 59000 Lille, 62440 Harnes" } })]), null);
  assert.equal(resolveBusinessLocationCandidate([source("instagram", { profile: { biography: "Adresse du client : 59000 Lille" } })]), null);
  assert.equal(resolveBusinessLocationCandidate([source("x", { profile: { location: "62440 Harnes" }, posts: [{ text: "75002 Paris" }] })])?.postalCode, "62440");
});

test("site : JSON-LD du propre établissement et mentions légales explicites", () => {
  const schema = { "@type": "LocalBusiness", url: "https://pro.example/", name: "Pro", address: { postalCode: "62440", addressLocality: "Harnes" } };
  assert.equal(resolveBusinessLocationCandidate([source("website", `PAGE https://pro.example/\n${JSON.stringify(schema)}`)])?.city, "Harnes");
  assert.equal(resolveBusinessLocationCandidate([source("website", "PAGE https://pro.example/mentions-legales\nSiège social : 12 rue Verte\n62440 Harnes")])?.city, "Harnes");
  assert.equal(resolveBusinessLocationCandidate([source("website", "PAGE https://pro.example/blog/chantier\nAdresse : 12 rue Verte\n75002 Paris")]), null);
  assert.equal(resolveBusinessLocationCandidate([source("website", "PAGE https://pro.example/mentions-legales\nHébergeur : Prestataire\nAdresse : 12 rue Verte\n75002 Paris")]), null);
  assert.equal(resolveBusinessLocationCandidate([source("website", `PAGE https://pro.example/\n${JSON.stringify({ ...schema, url: "https://hebergeur.example/" })}`)]), null);
});

test("plusieurs adresses également fiables demandent un choix et ne sont pas fusionnées", () => {
  assert.equal(resolveBusinessLocationCandidate([gmb(), gmb("59000", "Lille")]), null);
  assert.equal(resolveBusinessLocationCandidate([source("facebook", { profile: { location: { zip: "62440" } } }),
    source("instagram", { profile: { location: { city: "Harnes" } } })]), null);
});

test("une longue liste de posts tronquée conserve le profil initial sans lire les profils des posts", () => {
  const complete = gmb();
  const truncated = complete.content.slice(0, -1) + ',"localPosts":[{"summary":"' + "x".repeat(35_000);
  assert.equal(resolveBusinessLocationCandidate([source("google_business", truncated)])?.city, "Harnes");
  assert.equal(resolveBusinessIdentitySuggestions([source("google_business", truncated)]).company_legal_name?.value, "Entreprise réelle");
  assert.equal(resolveBusinessLocationCandidate([source("instagram", '{"media":[{"profile":{"location":{"zip":"75002","city":"Paris"}}},')]), null);
});

test("préserve les valeurs existantes et complète seulement une paire cohérente", () => {
  const proposed = { postalCode: "62440", city: "Harnes" };
  assert.deepEqual(buildMissingBusinessLocationPatch({ postalCode: "", city: "" }, proposed), proposed);
  assert.deepEqual(buildMissingBusinessLocationPatch({ postalCode: "62440", city: "" }, proposed), { city: "Harnes" });
  assert.deepEqual(buildMissingBusinessLocationPatch({ postalCode: "", city: " HARNES " }, proposed), { postalCode: "62440" });
  assert.equal(buildMissingBusinessLocationPatch({ postalCode: "59000", city: "" }, proposed), null);
  assert.equal(buildMissingBusinessLocationPatch({ postalCode: "", city: "Lille" }, proposed), null);
  assert.equal(buildMissingBusinessLocationPatch({ postalCode: "59000", city: "Lille" }, proposed), null);
});

test("les saisies manuelles sont bornées et l’effacement explicite est valide", () => {
  assert.deepEqual(validateBusinessLocation({ postalCode: "", city: "" }), { postalCode: "", city: "" });
  assert.deepEqual(validateBusinessLocation({ postalCode: "SW1A 1AA", city: "London" }), { postalCode: "SW1A 1AA", city: "London" });
  assert.equal(validateBusinessLocation({ postalCode: "1".repeat(31), city: "Paris" }), null);
  assert.equal(validateBusinessLocation({ postalCode: "75002", city: "P".repeat(121) }), null);
  assert.equal(validateBusinessLocation({ postalCode: 75002, city: "Paris" }), null);
  assert.equal(validateBusinessLocation({ postalCode: "75002", city: "<script>Paris</script>" }), null);
});

test("identité et contacts viennent des profils publics, pas des posts ni des avis", () => {
  const suggestions = resolveBusinessIdentitySuggestions([
    gmb(), source("facebook", { profile: { name: "Autre nom", phone: "01 22 33 44 55", emails: ["contact@pro.example"] } }),
    source("instagram", { profile: { name: "Nom d’une personne" }, media: [{ caption: "Téléphone : 01 00 00 00 00. email: client@example.com" }] }),
  ]);
  assert.equal(suggestions.company_legal_name?.value, "Entreprise réelle");
  assert.equal(suggestions.phone?.value, "06 31 26 08 12");
  assert.equal(suggestions.contact_email?.value, "contact@pro.example");
  assert.deepEqual(resolveBusinessIdentitySuggestions([source("instagram", { profile: { name: "Personne" } })]), {});
});

test("les contacts ambigus ou invalides restent à compléter manuellement", () => {
  const result = resolveBusinessIdentitySuggestions([source("facebook", { profile: {
    name: "Votre entreprise", phone: "123", emails: ["a@pro.example", "b@pro.example"],
  } })]);
  assert.deepEqual(result, {});
});

test("mentions légales : coordonnées explicites de l’entreprise sans celles de l’hébergeur", () => {
  const result = resolveBusinessIdentitySuggestions([source("website", `PAGE https://pro.example/mentions-legales
Raison sociale : Entreprise réelle
Téléphone : 06 31 26 08 12
Email : contact@pro.example
Hébergeur : Prestataire
Téléphone : 01 00 00 00 00
Email : hebergeur@autre.example`)]);
  assert.equal(result.company_legal_name?.value, "Entreprise réelle");
  assert.equal(result.phone?.value, "06 31 26 08 12");
  assert.equal(result.contact_email?.value, "contact@pro.example");
});
