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

test("Facebook instructions select the live direct connection flow over obsolete configure commands", () => {
  const text = runtime.getInrAssistantAppKnowledge("Comment connecter ma Page Facebook ?");
  assert.match(text, /\/dashboard\?action=channels/);
  assert.match(text, /Connexion Facebook/);
  assert.match(text, /Connexion Business/);
  assert.match(text, /Choisir une page/);
  assert.doesNotMatch(text, /puis cliquer sur.*Configurer|puis clique.*Configurer/);
  assert.ok(text.length <= 4800);
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
  assert.match(text, /Canaux actifs/);
  assert.match(text, /\/dashboard\/adn-entreprise/);
  assert.match(text, /\/dashboard\?action=publish/);
});

test("source guides keep Founder billing tools separate from subscription billing", () => {
  const invoice = runtime.INR_ASSISTANT_APP_GUIDES.find(({ id }) => id === "invoices")!;
  assert.match(invoice.content, /Founder/);
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
  assert.match(dna.content, /stratégie commerciale.*disponible en Standard \(essai compris\), Premium et Founder/);
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
