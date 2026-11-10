import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../lib/inrSearchDisplaySettings.ts";
import * as identity from "../../lib/professionalBusinessIdentity.ts";
import * as badge from "../../lib/inrBadge.ts";

const ACCOUNT = "00000000-0000-4000-8000-000000000011";
const PHONE = "06 12 34 56 78";
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- controlled offline module harness
type Dict = Record<string, any>;

function publicLoader(config: Dict = {}, options: { profile?: Dict | null; business?: Dict; ownerProfile?: Dict; profileError?: boolean; allowed?: boolean } = {}) {
  const profile = options.profile === undefined ? { user_id: ACCOUNT, company_legal_name: "Entreprise exemple", first_name: "Jean", last_name: "Durand", phone: PHONE, contact_email: "prive@example.com", hq_address: "15 rue Privée", hq_zip: "75001", hq_city: "Paris", hq_country: "France" } : options.profile;
  const business = options.business ?? { sector: "artisan", business_description: "Appelez le 06 12 34 56 78 ou +33 6 12 34 56 78. Écrivez à prive@example.com au 15 rue Privée 75001.", services: ["Prestation"], intervention_zones: ["Région parisienne"], strengths: ["Expérience"], customer_typologies: ["Particuliers"] };
  const settings = { inrSearch: { enabled: true, slug: "exemple", pageTitle: "Entreprise exemple", ...config } };
  const db = { from(table: string) {
    const value = table === "pro_tools_configs" ? { user_id: ACCOUNT, settings } : table === "profiles" ? [profile, options.ownerProfile].filter(Boolean) : table === "business_profiles" ? business : [];
    const result = { data: value, error: table === "profiles" && options.profileError ? new Error("profile read unavailable") : null };
    const query: Dict = {};
    for (const method of ["select", "contains", "eq", "in", "order", "limit"]) query[method] = () => query;
    query.maybeSingle = async () => result;
    query.then = (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve);
    return query;
  } };
  const channels: Dict = Object.fromEntries(["site_web", "gmb", "facebook", "instagram", "threads", "linkedin", "x", "tiktok", "youtube_shorts", "pinterest"].map(key => [key, {}]));
  channels.site_web.url = "https://business.example.com";
  channels.gmb.url = "https://maps.example.com/lieu";
  const deps: Dict = {
    react: { cache: (fn: unknown) => fn }, "next/cache": { unstable_cache: (fn: unknown) => fn },
    "@/lib/inrSearchDisplaySettings": policy,
    "@/lib/activitySectors": { getActivitySectorLabel: () => "Artisanat", decodeBusinessSector: () => ({ sectorCategory: "artisan", profession: "Artisan" }) },
    "@/lib/channelConnectionState": { getChannelConnectionStates: async () => channels },
    "@/lib/nativeChannelActivation": { getNativeChannelMissingFields: () => ({ inr_search: [] }) },
    "@/lib/inrSearchEligibility": { getInrSearchPublicationEligibility: async () => ({ allowed: options.allowed !== false, authUserId: options.ownerProfile?.user_id || ACCOUNT }), filterEligibleInrSearchAccountIds: async () => new Set([ACCOUNT]) },
    "@/lib/profileLogo": { LOGO_BUCKET: "logos", resolveProfileLogoUrl: async () => ({ logoUrl: "https://business.example.com/logo.png", logoPath: "" }) },
    "@/lib/safeStorageSignedUrl": {}, "@/lib/inrBadge": badge,
    "@/lib/frenchGeography": { resolveFrenchGeography: () => null },
    "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/openingSchedule": { combineOpeningSchedule: () => "Lundi 9h–17h" },
    "@/lib/inrSearchPublicationFeed": { hasSuccessfulInrSearchChannel: () => true, mergeInrSearchPublicationFeeds: () => [] },
    "@/lib/inrSearchStorageMediaResolver": {},
    "@/lib/professionalBusinessIdentity": identity,
  };
  const loaded = { exports: {} as Dict };
  new Function("module", "exports", "require", compile("lib/inrSearchPublic.ts"))(loaded, loaded.exports, (name: string) => {
    assert.ok(name in deps, `unexpected public-loader import ${name}`); return deps[name];
  });
  return { load: () => loaded.exports.loadInrSearchPublicPage("exemple"), status: () => loaded.exports.getInrSearchPublicStatus("exemple"), privateProfile: profile, privateBusiness: business };
}

test("an activated Search page is usable without a profile, keeps its URL and enriches from the account's latest data", async () => {
  const config = { activationVersion: 1, activationRequested: true, enabled: false, publicationReady: false,
    systemManaged: true, identityProvisional: true, pageTitle: "Votre entreprise" };
  const ownerProfile = { user_id: "00000000-0000-4000-8000-000000000099", company_legal_name: "Private owner company", phone: "0700000000", contact_email: "owner-private@example.test" };
  const empty = publicLoader(config, { profile: null, business: {}, ownerProfile });
  const page = await empty.load();
  assert.ok(page);
  assert.equal(page.companyName, "Utilisateur");
  assert.equal(page.pageTitle, "Utilisateur");
  assert.equal(page.slug, "exemple");
  for (const key of ["phone", "email", "address", "zip", "city", "country", "profession", "sectorLabel"]) assert.equal(page[key], "", key);
  assert.doesNotMatch(JSON.stringify(page), /Private owner|owner-private|0700000000/);
  assert.equal((await empty.status()).published, true);
  const profile: Dict = { user_id: ACCOUNT, company_legal_name: "Nouvel atelier", hq_city: "Arras", hq_zip: "62000" };
  const enriched = publicLoader(config, { profile, business: { sector: "artisan", business_description: "Notre nouvelle présentation." } });
  assert.equal((await enriched.load()).companyName, "Nouvel atelier");
  assert.equal((await enriched.load()).pageTitle, "Nouvel atelier");
  assert.equal((await enriched.load()).city, "Arras");
  assert.equal((await enriched.load()).slug, page.slug);
  profile.company_legal_name = "";
  profile.hq_city = "";
  assert.equal((await enriched.load()).companyName, "Utilisateur");
  assert.equal((await enriched.status()).published, true, "clearing a field never withdraws consent");
  assert.equal(await publicLoader({ ...config, activationRequested: false }, { profile: null, business: {} }).load(), null);
  assert.equal(await publicLoader(config, { profile: null, business: {}, allowed: false }).load(), null);
  assert.equal(await publicLoader(config, { profile: null, business: {}, profileError: true }).load(), null);
});

function schemas(data: Dict) {
  const loaded = { exports: {} as Dict };
  const code = `${compile("app/entreprises/[slug]/page.tsx")}\nexports.__schema = buildJsonLd; exports.__faq = buildFaqJsonLd; exports.__news = buildNewsJsonLd;`;
  const translator = (key: string) => key;
  new Function("module", "exports", "require", code)(loaded, loaded.exports, (name: string) => {
    if (name === "@/lib/inrSearchPublic") return { buildInrSearchPublicUrl: () => "https://app.inrcy.com/entreprises/exemple" };
    if (name === "@/lib/openingSchedule") return { buildOpeningHoursSpecifications: () => [] };
    return {};
  });
  return { business: loaded.exports.__schema(data, translator, "fr-FR"), faq: loaded.exports.__faq(data), news: loaded.exports.__news(data, translator, "fr-FR") };
}

test("old pages retain their public information unless the professional chooses otherwise", async () => {
  assert.deepEqual(policy.normalizeInrSearchDisplaySettings(undefined), { phone: true, email: true, address: true, contactName: true, logo: true, badge: true, website: true, socials: true });
  assert.equal(policy.normalizeInrSearchDisplaySettings({ phone: false, email: "false", unknown: false }).phone, false);
  assert.equal(policy.normalizeInrSearchDisplaySettings({ email: "false" }).email, true);
  const data = await publicLoader().load();
  assert.equal(data.phone, PHONE);
  assert.ok(data.faq.some((item: Dict) => item.answer.includes(PHONE)));
  assert.equal(schemas(data).business.telephone, "+33612345678");
});

test("a hidden telephone is absent from the real public DTO, repeated text, FAQ and JSON-LD", async () => {
  const h = publicLoader({ display: { phone: false }, pageTitleOverride: "Notre titre", pageDescriptionOverride: "Téléphone : +33 6 12 34 56 78" });
  const before = structuredClone(h.privateProfile);
  const data = await h.load();
  const output = JSON.stringify({ data, schema: schemas(data) });
  assert.equal(data.phone, "");
  assert.equal(data.pageTitle, "Notre titre");
  for (const secret of [PHONE, "0612345678", "+33 6 12 34 56 78", "+33612345678"]) assert.ok(!output.includes(secret), `hidden telephone leaked: ${secret}`);
  assert.equal(schemas(data).business.telephone, undefined);
  assert.equal(schemas(data).business.contactPoint.telephone, undefined);
  assert.deepEqual(h.privateProfile, before, "the private profile is unchanged");
});

test("hidden telephone variants include French international formatting and optional trunk prefix", () => {
  const sanitize = policy.createInrSearchPublicTextSanitizer({ phone: false }, { phone: PHONE });
  for (const value of ["06.12.34.56.78", "+33 (0)6 12 34 56 78", "0033 (0)6 12 34 56 78", "tel:+33612345678"]) assert.equal(sanitize(value), "", value);
  assert.equal(sanitize("Une prestation à 120 €"), "Une prestation à 120 €");
});

test("contact and media choices remove their corresponding public data rather than only CSS", async () => {
  const data = await publicLoader({ display: { phone: false, email: false, address: false, contactName: false, logo: false, badge: false, website: false, socials: false } }).load();
  for (const key of ["phone", "email", "address", "zip", "city", "country", "addressLine", "contactName", "logoUrl", "inrBadgeUrl", "inrBadgeQrUrl", "websiteUrl", "googleBusinessUrl"]) assert.equal(data[key], "", key);
  assert.deepEqual(data.socialLinks, []);
  const output = JSON.stringify({ data, schema: schemas(data) });
  for (const secret of [PHONE, "prive@example.com", "15 rue Privée", "75001", "Jean Durand"]) assert.ok(!output.includes(secret), secret);
  assert.equal(schemas(data).business.contactPoint, undefined);
  assert.equal(schemas(data).business.address, undefined);
});

test("disabled rubriques do not reappear in FAQs or structured data", async () => {
  const sections = Object.fromEntries(Object.keys(policy.DEFAULT_INR_SEARCH_SECTIONS).map(key => [key, false]));
  const data = await publicLoader({ sections }).load();
  assert.equal(data.phone, ""); assert.equal(data.description, ""); assert.equal(data.profession, ""); assert.equal(data.openingHours, "");
  for (const key of ["services", "zones", "strengths", "media", "publications", "socialLinks", "faq"]) assert.deepEqual(data[key], [], key);
  const schema = schemas(data);
  assert.equal(schema.faq, null); assert.equal(schema.news, null);
  assert.equal(schema.business.hasOfferCatalog, undefined); assert.equal(schema.business.potentialAction, undefined);
});
