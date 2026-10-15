import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import { buildAiMediaFreeDnaContext, normalizeAiMediaBusinessUrl, selectAiMediaFreeDnaEvidence, AI_MEDIA_FREE_DNA_MAX_CHARS } from "../../lib/aiMediaFreeDnaContext.ts";
import { buildAiMediaFreeBusinessContext, buildAiMediaFreeImagePrompt, buildAiMediaFreeVideoPrompt, buildAiMediaFreeVideoScenePrompt, getAiMediaFreeBrandPolicy, getAiMediaFreeLogoPlacement } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { normalizeAiMediaGenerationRequest, AiMediaRequestValidationError } from "../../lib/aiMediaGenerationContracts.ts";
import { buildAiMediaVideoProviderContract } from "../../lib/aiMediaVideoProviderContract.ts";
import * as dna from "../../lib/aiMediaFreeDnaContext.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";

const profile = {
  business: { companyName: "Atelier Cosmos", phone: "01 23 45 67 89", city: "Arras", postalCode: "62000",
    professionLabel: "Artisan", description: "Atelier artisanal.", services: ["Ateliers poterie"], strengths: [], interventionZones: ["Arras"], customerTypologies: [] },
  memory: { targetAudiences: [], differentiators: [], recentNewsItems: [],
    detailedDescription: "Des créations artisanales.",
    referenceDocuments: [{ name: "Prestations et tarifs", extractedText: "Atelier poterie : 49,90 € TTC par personne.\nVisite de l’atelier : 15 € TTC." }] },
  preferences: { language: "fr", premiumEnabled: false, customInstructions: "GUIDED_INSTRUCTION_MUST_NOT_APPEAR" },
} as unknown as NormalizedAiGenerationProfile;
const publicProfile = { company_legal_name: "Atelier Cosmos", phone: "01 23 45 67 89", contact_email: "contact@cosmos.example",
  email: "private-login@example.invalid", hq_address: "12 rue du Soleil", hq_zip: "62000", hq_city: "Arras", access_token_enc: "SECRET_MUST_NOT_APPEAR" };
const context = buildAiMediaFreeDnaContext({ profile, publicProfile, publicLinks: { site_web: "https://cosmos.example/reserver", instagram: "https://www.instagram.com/cosmos/" }, prompt: "Annonce notre atelier poterie avec le tarif et le lien du site." });

test("ADN exclusions stay attached to their object and an attached logo overrides the official file", () => {
  for (const brief of ["Sans texte, avec notre logo", "Ne pas oublier le logo", "Sans texte aux couleurs de notre entreprise"]) {
    assert.equal(getAiMediaFreeBrandPolicy(brief, "Atelier Cosmos", true).useLogo, true, brief);
    assert.equal(getAiMediaFreeBrandPolicy(brief, "Atelier Cosmos", true).useBrandColors, true, brief);
  }
  assert.equal(getAiMediaFreeBrandPolicy("Utilise le logo ci-joint", "Atelier Cosmos", true).useLogo, false);
  assert.equal(getAiMediaFreeBrandPolicy("Une photo sans logo", "Atelier Cosmos", true).useLogo, false);
  assert.equal(getAiMediaFreeBrandPolicy("Ne pas ajouter le logo", "Atelier Cosmos", true).useLogo, false);
  assert.equal(getAiMediaFreeBrandPolicy("Ne jamais utiliser notre logo", "Atelier Cosmos", true).useLogo, false);
  assert.equal(getAiMediaFreeBrandPolicy("Une photo sans couleurs de marque", "Atelier Cosmos", true).useBrandColors, false);
  assert.deepEqual(getAiMediaFreeLogoPlacement("Notre logo en grand en bas à gauche."), { horizontal: "left", vertical: "bottom", size: "large" });
  assert.equal(getAiMediaFreeLogoPlacement("Une belle image avec notre logo."), undefined);
  assert.equal(getAiMediaFreeLogoPlacement("Une grande affiche avec notre logo."), undefined);
  assert.equal(getAiMediaFreeLogoPlacement("Notre logo et un grand titre à droite."), undefined);
  assert.deepEqual(getAiMediaFreeLogoPlacement("Notre logo en bas à gauche, un grand titre en haut à droite."), { horizontal: "left", vertical: "bottom" });
  assert.equal(getAiMediaFreeLogoPlacement("Notre logo pas en haut à droite."), undefined);
});

test("Recraft reserves its complete prompt budget without truncating a 4000-character brief or exact business facts", () => {
  const brief = (`Une affiche avec notre logo. Afficher 49,90 € et le téléphone exact. ${"Matières et ombres raffinées. ".repeat(160)}`).slice(0, 4_000);
  const richProfile = { ...profile, memory: { ...profile.memory, detailedDescription: "Histoire de notre atelier. ".repeat(400) } } as NormalizedAiGenerationProfile;
  const result = buildAiMediaFreeImagePrompt({ request: request({ imageEngine: "recraft", freePrompt: brief }), profile: richProfile, businessDnaContext: context, brandColors: ["#123456"], logoComposedLocally: true });
  assert.ok(result.length <= 9_000, String(result.length));
  assert.ok(result.includes(brief));
  for (const exact of ["49,90 €", "01 23 45 67 89", "https://cosmos.example/reserver"]) assert.ok(result.includes(exact), exact);
});
function request(overrides: Record<string, unknown> = {}) {
  return normalizeAiMediaGenerationRequest({ requestId: "business-dna-context-test", source: "studio", operation: "generate", creationMode: "free",
    kind: "image", freePrompt: "Un flyer pour notre atelier avec mon téléphone et le lien de mon site.", format: "story", useBusinessDna: true, ...overrides });
}

test("l’ADN connaît les coordonnées publiques, le site et les tarifs sans réutiliser un email de connexion ni un secret", () => {
  assert.equal(context.coordonnees.telephone, publicProfile.phone);
  assert.equal(context.coordonnees.email, publicProfile.contact_email);
  assert.equal(context.coordonnees.adresse, publicProfile.hq_address);
  assert.equal(context.liens.site_web, "https://cosmos.example/reserver");
  assert.match(context.informations_demandees.join("\n"), /49,90 € TTC/);
  assert.doesNotMatch(JSON.stringify(context), /private-login|SECRET|access_token|GUIDED_INSTRUCTION/);
});

test("aucune coordonnée manquante n’est inventée, et les URL de connexion ou signées sont rejetées", () => {
  const withoutEmail = buildAiMediaFreeDnaContext({ profile, publicProfile: { email: "auth-only@example.invalid" }, publicLinks: {}, prompt: "Notre atelier" });
  assert.equal(withoutEmail.coordonnees.email, undefined);
  for (const value of ["javascript:alert(1)", "http://localhost/", "https://user:secret@cosmos.example/", "https://cosmos.example/?access_token=secret", "https://storage.example/storage/v1/object/sign/private?token=secret", "https://cosmos.example/" + "x".repeat(650)]) assert.equal(normalizeAiMediaBusinessUrl(value), "", value);
  assert.equal(normalizeAiMediaBusinessUrl("cosmos.example"), "https://cosmos.example/");
});

test("le contexte riche garde téléphone, URL et tarif intacts dans le budget des moteurs", () => {
  const richProfile = { ...profile, memory: { ...profile.memory, detailedDescription: "Présentation générale. ".repeat(400), referenceDocuments: [
    { name: "Autres prestations", extractedText: "Autres descriptions. ".repeat(100) },
    { name: "Tarifs poterie", extractedText: "Atelier poterie : 49,90 € TTC par personne." },
  ] } } as NormalizedAiGenerationProfile;
  const richContext = buildAiMediaFreeDnaContext({ profile: richProfile, publicProfile, publicLinks: { ...context.liens }, prompt: "Tarif atelier poterie et téléphone" });
  const args = { request: request(), profile: richProfile, businessDnaContext: richContext, brandColors: ["#123456"], logoComposedLocally: true };
  const serialized = JSON.stringify(buildAiMediaFreeBusinessContext(args));
  assert.ok(serialized.length <= AI_MEDIA_FREE_DNA_MAX_CHARS, serialized.length.toString());
  for (const literal of ["01 23 45 67 89", "https://cosmos.example/reserver", "49,90 € TTC"]) assert.ok(serialized.includes(literal), literal);
  for (const build of [buildAiMediaFreeImagePrompt, buildAiMediaFreeVideoPrompt]) {
    const prompt = build(args);
    assert.match(prompt, /uniquement si le professionnel demande/);
    assert.match(prompt, /coordonnée ou exclusion demandée/);
    assert.match(prompt, /#123456/);
    assert.ok(prompt.length < 11_800);
  }
});

test("décocher ignore le supplément ADN et conserve exactement le prompt libre", () => {
  const input = { request: request({ useBusinessDna: false, freePrompt: "Une galaxie dessinée, une baleine bleue." }), profile };
  assert.equal(buildAiMediaFreeImagePrompt({ ...input, businessDnaContext: context, brandColors: ["#123456"], logoComposedLocally: true }), buildAiMediaFreeImagePrompt(input));
  assert.doesNotMatch(buildAiMediaFreeImagePrompt({ ...input, businessDnaContext: context }), /cosmos\.example|01 23|49,90/);
});

test("logo et palette sont des valeurs par défaut remplaçables par les exclusions du brief", () => {
  assert.deepEqual(getAiMediaFreeBrandPolicy("Une affiche créative", "Atelier Cosmos", true), { useCompanyContext: true, useLogo: true, useBrandColors: true });
  for (const freePrompt of ["Une affiche sans logo", "Un nouveau logo pour mon entreprise", "Utilise le logo fourni dans la référence"]) assert.equal(getAiMediaFreeBrandPolicy(freePrompt, "Atelier Cosmos", true).useLogo, false, freePrompt);
  for (const freePrompt of ["Une affiche sans charte", "Une affiche en noir et blanc", "Palette rouge et noir", "Couleur principale #ff0011"]) assert.equal(getAiMediaFreeBrandPolicy(freePrompt, "Atelier Cosmos", true).useBrandColors, false, freePrompt);
  assert.equal(getAiMediaFreeBrandPolicy("Une baleine bleue", "Atelier Cosmos", true).useBrandColors, true);
});

test("le tarif est retrouvé dans les documents et les détails de prestation selon le sujet demandé", () => {
  const selected = selectAiMediaFreeDnaEvidence(profile, "Affiche le tarif de la formation sculpture", { sculpture: "Formation sculpture : 225 € TTC pour deux jours." });
  assert.match(selected.join("\n"), /225 € TTC/);
  assert.doesNotMatch(selected.join("\n"), /GUIDED_INSTRUCTION/);
});

test("la même direction ADN atteint chaque moteur vidéo sans imposer de sous-titres", () => {
  for (const videoEngine of ["omni", "veo", "veo-lite", "minimax-h3", "wan3", "wan-flash", "grok", "grok-lite"] as const) {
    const input = request({ kind: "video", videoEngine, durationSeconds: 8, withNarration: false, freePrompt: "Un vase se forme lentement." });
    const args = { request: input, plan: { subline: "Un vase se forme lentement.", scenes: [{ visualBrief: "Une main façonne le vase." }] },
      providerContract: buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: ["#123456"] }),
      businessDnaDirection: "Official palette #123456. Exact logo added locally; do not draw it. No contact text unless requested." } as unknown as AiVideoProviderGenerationArgs;
    const prompt = buildAiMediaFreeVideoScenePrompt(args, 0, 8);
    assert.match(prompt, /#123456/);
    assert.match(prompt, /no subtitles, captions or quote cards unless requested/);
    assert.ok(prompt.length <= 3_200);
    const unchecked = { ...args, request: { ...input, useBusinessDna: false } };
    assert.doesNotMatch(buildAiMediaFreeVideoScenePrompt(unchecked, 0, 8), /BUSINESS IDENTITY|#123456/);
  }
});

function loadServer() {
  const source = readFileSync(new URL("../../lib/aiMediaFreeDnaContextServer.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} as typeof import("../../lib/aiMediaFreeDnaContextServer.ts") };
  const nativeRequire = createRequire(import.meta.url);
  const modules = new Map<string, unknown>([["server-only", {}], ["./aiMediaFreeDnaContext.ts", dna], ["./aiMediaGenerationContracts.ts", { AiMediaRequestValidationError }]]);
  new Function("module", "exports", "require", output)(moduleRecord, moduleRecord.exports, (id: string) => {
    if (id.startsWith("node:")) return nativeRequire(id);
    assert.ok(modules.has(id), id); return modules.get(id);
  });
  return moduleRecord.exports.loadAiMediaFreeDnaContext;
}

test("les lectures ADN sont bornées au compte actif et sélectionnent seulement les liens publics", async () => {
  const queries: Array<{ table: string; select: string; owner?: string }> = [];
  const supabase = { from(table: string) {
    const query = { table, select: "", owner: undefined as string | undefined }; queries.push(query);
    const result = table === "pro_tools_configs" ? { data: { website: "https://cosmos.example/", google_business: "https://maps.google.com/?cid=123" }, error: null }
      : { data: [{ source: "instagram", profile_url: "https://www.instagram.com/cosmos/" }, { source: "x", username: "@atelier_cosmos" }, { source: "mail", profile_url: "https://private-mail.example/" }], error: null };
    const builder = { select(value: string) { query.select = value; return builder; }, eq(column: string, value: string) { assert.equal(column, "user_id"); query.owner = value; return builder; }, order() { return builder; }, limit(count: number) { assert.equal(count, 40); return builder; }, maybeSingle: async () => result,
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result).then(resolve); } };
    return builder;
  } };
  const result = await loadServer()({ supabase: supabase as never, accountId: "active-professional-account", profile, publicProfile, business: null, prompt: "Le lien du site et Instagram" });
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.equal(query.owner, "active-professional-account");
    assert.doesNotMatch(query.select, /\*|access_token|refresh_token|email_address|account_email/);
  }
  assert.equal(result.liens.site_web, "https://cosmos.example/");
  assert.equal(result.liens.instagram, "https://www.instagram.com/cosmos/");
  assert.equal(result.liens.google_business, "https://maps.google.com/?cid=123");
  assert.equal(result.liens.x, "https://x.com/atelier_cosmos");
  assert.doesNotMatch(JSON.stringify(result), /private-mail/);
});

test("une panne de lecture de l’ADN explique quoi faire au lieu d’inventer des faits", async () => {
  const builder = { select() { return builder; }, eq() { return builder; }, order() { return builder; }, limit() { return builder; }, maybeSingle: async () => ({ error: new Error("database unavailable"), data: null }), then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  await assert.rejects(loadServer()({ supabase: { from: () => builder } as never, accountId: "active-account", profile, publicProfile, business: null, prompt: "Mon site" }), /informations de votre entreprise.*Réessayez/);
});
