import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";
import type * as Guides from "../../lib/inrAssistantAppGuides.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cache = new Map<string, { exports: unknown }>();
function load(relativePath: string, parent = root): unknown {
  if (relativePath === "server-only") return {};
  if (relativePath === "ai") return { jsonSchema, tool };
  assert.ok(relativePath.startsWith(".") || relativePath.startsWith("@/"));
  const path = relativePath.startsWith("@/") ? resolve(root, relativePath.slice(2)) : resolve(parent, relativePath);
  const file = extname(path) ? path : `${path}.ts`;
  const previous = cache.get(file);
  if (previous) return previous.exports;
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  const moduleRecord: { exports: unknown } = { exports: {} };
  cache.set(file, moduleRecord);
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { URL, URLSearchParams })(
    (dependency: string) => load(dependency, dirname(file)), moduleRecord, moduleRecord.exports,
  );
  return moduleRecord.exports;
}
const runtime = load("./lib/inrAssistantAppGuides.ts") as typeof Guides;

test("current guides cover each professional tool and retain real source references", () => {
  const ids = runtime.INR_ASSISTANT_APP_GUIDES.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["booster", "studio-create", "studio-edit", "media-library", "ads", "emailing", "agents", "stats", "send", "crm", "calendar", "reputation", "invoices", "quotes", "channel-facebook", "dashboard-navigation"]) assert.ok(ids.includes(id), id);
  for (const guide of runtime.INR_ASSISTANT_APP_GUIDES) {
    assert.ok(guide.content.length > 100 && guide.content.length <= 2500, `${guide.id}: bounded readable guide`);
    assert.ok(guide.sourceFiles.length > 0);
    for (const path of guide.sourceFiles) assert.ok(existsSync(resolve(root, path)), `${guide.id}: ${path}`);
    assert.doesNotMatch(guide.content, /_[a-f0-9]{8}\b|process\.env|Bearer\s+[A-Za-z0-9]/);
  }
});

test("Google photo questions explain the first-photo API rule while keeping the other selections", () => {
  const knowledge = runtime.getInrAssistantAppKnowledge("Google Business : quelle photo publier avec un carrousel de cinq photos ?", 1200);
  assert.match(knowledge, /uniquement la première photo/);
  assert.match(knowledge, /position 1/);
  assert.match(knowledge, /autres canaux gardent leur sélection/);
  assert.ok(knowledge.length <= 1200);
});

test("Facebook instructions select the live direct connection flow over obsolete configure commands", () => {
  const text = runtime.getInrAssistantAppKnowledge("Comment connecter ma Page Facebook ?");
  assert.match(text, /\/dashboard\?action=channels/);
  assert.match(text, /Connexion Facebook/);
  assert.match(text, /Connexion Business/);
  assert.match(text, /Choisir une page/);
  assert.doesNotMatch(text, /puis cliquer sur.*Configurer|puis clique.*Configurer/);
  assert.ok(text.length <= 4800);
});

test("questions about Instagram caption lengths retrieve reviewed generated ranges and the complete-caption limit without inventing extra space", async () => {
  const question = "Combien de caractères pour une légende Instagram, Court ou Approfondi ?";
  const text = runtime.getInrAssistantAppKnowledge(question);
  assert.match(text, /\[publication-lengths\]/);
  assert.match(text, /Instagram : 260–650 \/ 150–280 \/ 300–500 \/ 620–1000 \/ 1000–1800 ; corps max 1800/);
  assert.match(text, /légende finale ne dépasse pas 2200 caractères, titre, CTA, URL ou téléphone, séparateurs et hashtags compris/);
  assert.match(text, /Approfondi \(Premium selon les droits\)/);
  assert.match(text, /saisie manuelle ou déjà validée n’est pas raccourcie automatiquement/);
  const bounded = runtime.getInrAssistantAppKnowledge(question, 1200);
  assert.match(bounded, /légende finale ne dépasse pas 2200 caractères/);
  const tool = runtime.createInrAssistantAppGuideTool();
  const result = await tool.execute!({ topic: question }, { toolCallId: "caption-lengths", messages: [] });
  assert.ok("guides" in result); assert.equal(result.guides[0]?.id, "publication-lengths");
  assert.match(result.guides[0].content, /Pinterest : titre au plus 100 ; description finale au plus 800/);
  assert.doesNotMatch(result.guides[0].content, /Instagram[^\n]*corps max 2200/);
});

test("CTA guidance follows the real mode normalizer and never invents a profile fallback", async () => {
  const cta = load("./lib/aiChannelCtaPreferences.ts") as typeof import("../../lib/aiChannelCtaPreferences.ts");
  const guide = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "publication-cta")!;
  const call = { choice: "appeler", phone: "0612345678" };
  const website = { choice: "site", url: "https://business.example.com/" };
  for (const { key } of cta.AI_CTA_CHANNELS) assert.equal(cta.normalizeAiChannelCtaMap({ [key]: call })[key]?.mode, "call", key);
  for (const { key } of cta.AI_CTA_CHANNELS) assert.equal(cta.normalizeAiChannelCtaMap({ [key]: website })[key]?.mode, "website", key);
  assert.match(guide.content, /Réserver, Commander, Acheter et S’inscrire exigent un lien explicite/);
  assert.match(guide.content, /X accepte les liens HTTP\(S\)/);
  assert.match(guide.content, /Ne dites pas que Facebook, Instagram ou LinkedIn interdisent ce mode/);
  assert.match(guide.content, /Appeler Google utilise le numéro de sa fiche Google/);
  assert.match(guide.content, /futurs contenus.*jamais les publications ou brouillons existants/);
  assert.match(guide.content, /Aucun repli automatique vers un profil ou À propos.*ne l’inventez jamais/);
  assert.match(guide.content, /compatibles, bloqués ou inconnus renvoyés par l’outil/);
  const knowledge = runtime.getInrAssistantAppKnowledge("Mon numéro de téléphone peut-il apparaître dans les CTAs Facebook, Instagram et LinkedIn ?", 1200);
  assert.match(knowledge, /Appeler est un mode accepté/);
  assert.match(knowledge, /Aucun repli automatique/);
  const instructions = readFileSync(resolve(root, "lib/inrAssistantConversation.ts"), "utf8");
  assert.match(instructions, /N’invente aucun repli vers un profil\/À propos ni bouton natif/);
});

test("exact connection navigation is reproduced from the reviewed guide without invented conditions", () => {
  const reply = runtime.getVerifiedInrAssistantNavigation("Quels sont les boutons exacts pour connecter Facebook puis choisir ma Page ?");
  assert.ok(reply);
  assert.match(reply, /Connexion Facebook/);
  assert.match(reply, /Connexion Business/);
  assert.match(reply, /Choisir une page/);
  assert.doesNotMatch(reply, /si un (?:compte|identifiant) (?:apparait|apparaît|est déjà)/);
  for (const request of ["Impossible de connecter Facebook, erreur de permission", "Ma Page Facebook n’apparaît pas", "Génère une image pour ma Page Facebook", "Comment publier une publication sur Facebook une fois connecté ?", "Compare les performances des canaux"]) assert.equal(runtime.getVerifiedInrAssistantNavigation(request), null, request);
});

test("historical questions bypass static navigation so the assistant can recall the professional's actual past discussion", () => {
  for (const request of [
    "Comment connecter Facebook comme nous en avions parlé hier ?",
    "Tu te souviens de notre dernière conversation pour connecter ma Page Facebook ?",
    "Reprends la connexion Facebook dont on parlait la semaine dernière",
    "Comment connecter Facebook selon ce que nous avions convenu ?",
    "Remember our previous Facebook connection conversation",
  ]) assert.equal(runtime.getVerifiedInrAssistantNavigation(request), null, request);
  assert.ok(runtime.getVerifiedInrAssistantNavigation("Comment connecter ma Page Facebook ?"));
});

test("a first vague question receives current cockpit destinations", () => {
  const text = runtime.getInrAssistantAppKnowledge("Je dois faire quoi ?");
  assert.match(text, /Connecter mes canaux/);
  assert.match(text, /Personnaliser/);
  assert.match(text, /\/dashboard\/personnalisation/);
  assert.match(text, /\/dashboard\?action=publish/);
});

test("source guides keep restricted client invoices separate from subscription billing", () => {
  const invoice = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "invoices")!;
  assert.match(invoice.content, /outil comptable à accès restreint/);
  assert.match(invoice.content, /droits comptables/);
  assert.match(invoice.content, /Standard\/essai Standard ET Premium ne débloquent pas cet outil/);
  assert.match(invoice.content, /\/dashboard\/factures/);
  const account = runtime.getInrAssistantAppKnowledge("factures abonnement Stripe");
  assert.match(account, /abonnement/i);
});

test("the runtime knowledge tool exposes bounded procedures, never arbitrary source or file access", async () => {
  const guideTool = runtime.createInrAssistantAppGuideTool();
  const result = await guideTool.execute!({ topic: "channel-facebook" }, { toolCallId: "test", messages: [] });
  assert.ok("found" in result);
  assert.equal(result.found, true);
  assert.ok(result.guides.some(({ id }) => id === "channel-facebook"));
  assert.equal("sourceFiles" in result.guides[0], false);
  assert.ok(JSON.stringify(result).length < 6500);
  const missing = await guideTool.execute!({ topic: "../../.env.local" }, { toolCallId: "test", messages: [] });
  assert.ok("found" in missing);
  assert.equal(missing.found, false);
  assert.match(missing.message ?? "", /ne pas inventer/);
});

test("monthly metrics and remote post restrictions remain explicit in the verified guides", () => {
  const stats = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "stats")!;
  const send = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "send")!;
  assert.match(stats.content, /indisponible, pas zéro/);
  assert.match(stats.content, /potentiel/);
  assert.match(send.content, /TikTok.*pas de modification/);
  assert.match(send.content, /X ne permet pas de modifier/);
});

test("Stats guidance includes real monthly Badge/Search events instead of classifying them as unsupported", () => {
  const stats = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "stats")!;
  assert.match(stats.content, /iNr’Badge et iNr’Search ont des historiques mensuels de vues et clics.*évènements réels/);
  assert.match(stats.content, /TikTok, X et Mails n'exposent pas de mesures mensuelles comparables/);
  assert.doesNotMatch(stats.content, /pas de mesures mensuelles comparables pour[^.]*iNr’(?:Badge|Search)/);
  const loader = readFileSync(resolve(root, "app/dashboard/stats/stats.evolution-loader.ts"), "utf8");
  const api = readFileSync(resolve(root, "app/api/inrstats/evolution/route.ts"), "utf8");
  assert.match(loader, /fetch\("\/api\/inrstats\/evolution"/);
  assert.match(loader, /month\.values\.inrbadge = counts\.inrbadge/);
  assert.match(loader, /month\.values\.inr_search = counts\.inr_search/);
  assert.match(api, /count\("inrbadge", "view"\)/);
  assert.match(api, /count\("inr_search", "page_view"\)/);
  assert.match(api, /\.eq\("user_id", activeUserId\)/);
});

test("business DNA strategy guidance matches the current Standard-accessible UI and API", () => {
  const dna = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "business-dna")!;
  assert.match(dna.content, /stratégie commerciale.*disponible en Standard \(essai compris\) et Premium/);
  assert.doesNotMatch(dna.content, /[Ss]tratégie commerciale.*réservée/);
  const ui = readFileSync(resolve(root, "app/dashboard/settings/_components/AiMemoryContent.tsx"), "utf8");
  const api = readFileSync(resolve(root, "app/api/ai-memory/route.ts"), "utf8");
  assert.match(ui, /const strategyEnabled = true;/);
  assert.match(api, /strategyEnabled:\s*true/);
  assert.match(api, /includePremium:\s*true/);
});

test("legacy intervention and profile URLs describe their real redirect destinations", () => {
  const calendar = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "calendar")!;
  const dna = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "business-dna")!;
  assert.match(calendar.content, /\/dashboard\/interventions est un alias/);
  assert.match(readFileSync(resolve(root, "app/dashboard/interventions/page.tsx"), "utf8"), /redirect\("\/dashboard\/agenda"\)/);
  assert.match(dna.content, /\/dashboard\/mon-profil.*redirige/);
  const profile = readFileSync(resolve(root, "app/dashboard/mon-profil/page.tsx"), "utf8");
  assert.match(profile, /resolved\.section\) === "activity" \? "activity" : "profile"/);
  assert.match(profile, /redirect\(`\/dashboard\/adn-entreprise\?tab=\$\{tab\}`\)/);
});

test("personalization guide describes the unified tabs, automatic saving and document consent", () => {
  const dna = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "business-dna")!;
  const ai = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "ai-configuration")!;
  assert.match(dna.content, /\/dashboard\/personnalisation/);
  assert.match(dna.content, /Analyse, Mon entreprise et Ma communication/);
  assert.match(dna.content, /trombone[\s\S]*?autorisation/);
  assert.match(dna.content, /enregistrées automatiquement/);
  assert.match(dna.content, /sélection personnalisée[\s\S]*?outil ouvert/);
  assert.ok(dna.sourceFiles.includes("app/dashboard/personnalisation/page.tsx"));
  assert.match(ai.content, /Ma communication[\s\S]*?Vocabulaire/);
  assert.match(ai.content, /enregistrement automatique/);
  assert.doesNotMatch(ai.content, /liens site sont incompatibles avec Instagram, TikTok et X/);
});

test("Google reviews questions keep the current bubble path at every real context budget", async () => {
  for (const query of ["Où gérer mes avis Google ?", "Comment répondre à un avis client ?", "Avis client", "Where can I manage my Google reviews?"]) {
    for (const budget of [650, 1200, 1800, 2400]) {
      const knowledge = runtime.getInrAssistantAppKnowledge(query, budget);
      assert.ok(knowledge.length <= budget);
      assert.match(knowledge, /Connecter mes canaux → Google Business → Avis/, `${query}: ${budget}`);
      assert.match(knowledge, /googleReviews=1/);
      assert.doesNotMatch(knowledge, /Menu >|Gérer.*dans Réputation|section Réputation/);
    }
    const result = await runtime.createInrAssistantAppGuideTool().execute!({ topic: query }, { toolCallId: "reviews", messages: [] });
    assert.ok("guides" in result);
    assert.equal(result.guides[0]?.id, "reputation");
    assert.match(result.guides[0]?.content ?? "", /Google Business → Avis/);
  }
});

test("location answers use shared destinations without swallowing actions, diagnosis or past discussions", () => {
  for (const query of ["Où gérer mes avis Google ?", "Où est le bouton pour gérer mes avis Google ?"]) {
    const answer = runtime.getVerifiedInrAssistantNavigation(query);
    assert.match(answer ?? "", /Connecter mes canaux → Google Business → Avis/);
    assert.match(answer ?? "", /googleReviews=1/);
  }
  for (const query of ["Où sont mes avis Google disparus ? J’ai une erreur.", "Où gérer mes avis Google comme nous en avons parlé hier ?", "Où gérer mes avis Google puis publie une réponse ?", "Où trouver Studio et les statistiques ?", "Donne ton avis sur mon image.", "Où supprimer un avis Google ?", "Où sont mes factures ?", "Où générer une image gratuite en Basique ?"]) {
    assert.equal(runtime.getVerifiedInrAssistantNavigation(query), null, query);
  }
});

test("small offer context preserves Basic Studio eligibility and distinguishes subscription invoices", () => {
  for (const budget of [1200, 1800, 2400]) {
    const studio = runtime.getInrAssistantAppKnowledge("Le forfait Basique permet-il de générer une image ?", budget);
    assert.match(studio, /Basique, Standard et Premium ont accès/);
    assert.match(studio, /crédits/);
    assert.doesNotMatch(studio, /Accès : Standard et Premium/);
    const invoices = runtime.getInrAssistantAppKnowledge("Où trouver mes factures d’abonnement Stripe ?", budget);
    assert.match(invoices, /Mon compte → Factures/);
    assert.match(invoices, /panel=factures/);
  }
});

test("media generation intent selects Studio without redirecting publication creation", async () => {
  for (const question of [
    "Le forfait Basique permet-il de générer une image ?",
    "Peut-on générer une vidéo avec le forfait Basique ?",
    "Can Basic generate a picture?",
    "Comment générer une image pour ma publication ?",
  ]) {
    const result = await runtime.createInrAssistantAppGuideTool().execute!({ topic: question }, { toolCallId: "media-guide", messages: [] });
    assert.ok("guides" in result);
    assert.equal(result.guides[0]?.id, "studio-create", question);
    const knowledge = runtime.getInrAssistantAppKnowledge(question, 1200);
    assert.ok(knowledge.length <= 1200);
    assert.match(knowledge, /Basique, Standard et Premium ont accès/);
    assert.match(knowledge, /crédits/);
  }
  const publication = await runtime.createInrAssistantAppGuideTool().execute!({ topic: "Comment générer une publication avec une image ?" }, { toolCallId: "publication-guide", messages: [] });
  assert.ok("guides" in publication);
  assert.notEqual(publication.guides[0]?.id, "studio-create");
});

test("an unknown guide query does not certify a weak incidental body match", async () => {
  const result = await runtime.createInrAssistantAppGuideTool().execute!({ topic: "quantique zorbulator" }, { toolCallId: "unknown", messages: [] });
  assert.ok("found" in result);
  assert.equal(result.found, false);
  assert.match(result.message ?? "", /ne pas inventer/);
});

test("bounded knowledge separates existing documents, business identity and interface language", () => {
  for (const [question, expected] of [
    ["Où sont mes factures clients ?", /\[Mes factures\]\(\/dashboard\/factures\)/],
    ["Où sont mes devis ?", /\[Mes devis\]\(\/dashboard\/devis\)/],
    ["Où modifier le logo de mon entreprise ?", /Mon entreprise/],
    ["Où changer mon numéro de téléphone ?", /Mon entreprise/],
    ["Où répondre aux mails reçus ?", /iNr’Send/],
  ] as const) assert.match(runtime.getInrAssistantAppKnowledge(question, 1200), expected, question);
  const language = runtime.getInrAssistantAppKnowledge("Où changer la langue ?", 1200);
  assert.match(language, /langue de l’interface/);
  assert.match(language, /langue de rédaction/);
  assert.match(language, /demander laquelle/);
  const minimal = runtime.getInrAssistantAppKnowledge("Où gérer mes avis Google ?", 350);
  assert.ok(minimal.length <= 350);
  assert.match(minimal, /Google Business → Avis/);
});
