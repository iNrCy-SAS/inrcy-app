import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { DashboardEdition } from "../../lib/dashboardEdition.ts";

const root = process.cwd();
const ts = createRequire(join(root, "package.json"))("typescript") as typeof import("typescript");
const modelFile = resolve(root, "app/dashboard/_components/dashboardUsageGuideModel.ts");
const modelSource = fileURLToPath(new URL("../../app/dashboard/_components/dashboardUsageGuideModel.ts", import.meta.url));
const cache = new Map<string, Record<string, unknown>>();

// Execute the actual model and its source dependencies, including the existing GPS policy.
// The optional source location also lets this test run against the staging deliverable.
function loadModule(file: string): Record<string, unknown> {
  if (cache.has(file)) return cache.get(file)!;
  const loadedModule = { exports: {} as Record<string, unknown> };
  cache.set(file, loadedModule.exports);
  const compiled = ts.transpileModule(readFileSync(file === modelFile ? modelSource : file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = (specifier: string) => {
    const base = specifier.startsWith("@/")
      ? resolve(root, specifier.slice(2))
      : resolve(dirname(file), specifier);
    const candidate = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
    assert.ok(candidate, `Source dependency must resolve: ${specifier}`);
    return loadModule(candidate);
  };
  new Function("require", "module", "exports", "process", compiled)(require, loadedModule, loadedModule.exports, process);
  return loadedModule.exports;
}

const model = loadModule(modelFile) as typeof import("../../app/dashboard/_components/dashboardUsageGuideModel.ts");
const workspaces = loadModule(resolve(root, "lib/inrAgentWorkspaces.ts")) as typeof import("../../lib/inrAgentWorkspaces.ts");
const editions: DashboardEdition[] = ["standard", "premium", "founder"];

test("all six help goals and three setup steps lead to existing detailed articles", () => {
  assert.deepEqual(model.HELP_GOALS, ["publish", "media", "grow", "reviews", "contacts", "stats"]);
  assert.deepEqual(model.HELP_SETUP, ["channels", "dna", "ai"]);
  const articles = model.getHelpArticles("founder", true);
  const available = new Set(articles.map(({ article }) => article.id));
  assert.equal(available.size, articles.length, "The flattened help list has no duplicated articles");
  for (const goal of model.HELP_GOALS) {
    const ids = model.getHelpGoalArticleIds(goal);
    assert.ok(ids.length > 0, goal);
    for (const id of ids) assert.ok(available.has(id), `${goal}: ${id} exists in the GPS source`);
  }
  for (const step of model.HELP_SETUP) {
    const ids = model.getHelpSetupArticleIds(step);
    assert.ok(ids.length > 0, step);
    for (const id of ids) assert.ok(available.has(id), `${step}: ${id} exists in the GPS source`);
  }
});

test("the unified help preserves Founder-only accounting and the Standard article overrides", () => {
  const founder = model.getHelpArticles("founder");
  assert.deepEqual(founder.filter(item => item.sectionId === "documents").map(item => item.article.id), ["documents-express", "documents-legal"]);
  for (const edition of ["standard", "premium"] as const) {
    assert.ok(model.getHelpArticles(edition).every(item => item.sectionId !== "documents"));
  }
  const standardHistory = model.getHelpArticles("standard").find(item => item.article.id === "inrsend-express")!.article;
  assert.equal(standardHistory.intro, "avec_standard_inr_send_conserve_la_7cc5afc7");
  assert.deepEqual(standardHistory.links?.map(link => link.href), ["/dashboard/mails?folder=publications&boxView=sent"]);
  const premiumHistory = model.getHelpArticles("premium").find(item => item.article.id === "inrsend-express")!.article;
  assert.equal(premiumHistory.intro, "inr_send_non_founder_intro_2026");
});

test("Threads guides follow the Meta pilot without leaking into subsequent non-pilot requests", () => {
  for (const edition of editions) {
    assert.ok(!model.getHelpArticles(edition, false).some(item => item.article.id === "canaux-threads"));
    const threads = model.getHelpArticles(edition, true).filter(item => item.article.id === "canaux-threads");
    assert.equal(threads.length, 1);
    assert.equal(threads[0].sectionId, "canaux");
    assert.equal(threads[0].article.links?.[0].href, "/dashboard?panel=threads");
    assert.ok(!model.getHelpArticles(edition).some(item => item.article.id === "canaux-threads"));
  }
});

test("Standard keeps its publication history and locks CRM, Calendar and campaign tools", () => {
  const contacts = model.getHelpGoalTools("contacts", "standard", true);
  assert.deepEqual(contacts.map(({ href, premium }) => ({ href, premium })), [
    { href: "/dashboard/mails?folder=publications&boxView=sent", premium: false },
    { href: "/dashboard/crm", premium: true },
    { href: "/dashboard/agenda", premium: true },
  ]);
  const growth = model.getHelpGoalTools("grow", "standard", true);
  assert.deepEqual(growth.map(item => item.href), ["/dashboard/ads", "/dashboard/propulser", "/dashboard/fideliser"]);
  assert.ok(growth.every(item => item.premium));
  for (const goal of ["publish", "media", "reviews", "stats"] as const) {
    assert.ok(model.getHelpGoalTools(goal, "standard", true).every(item => !item.premium), goal);
  }
});

test("Premium and Founder retain all appropriate tools without premium locks", () => {
  for (const edition of ["premium", "founder"] as const) {
    for (const goal of model.HELP_GOALS) {
      assert.ok(model.getHelpGoalTools(goal, edition, true).every(item => !item.premium), `${edition}/${goal}`);
    }
    assert.equal(model.getHelpGoalTools("contacts", edition, true)[0].href, "/dashboard/mails");
    assert.ok(model.getHelpGoalTools("grow", edition, true).some(item => item.href === "/dashboard/agent/campagnes-mails"));
  }
});

test("agent entry points use the existing routes and artwork and disappear when disabled", () => {
  for (const edition of editions) {
    for (const goal of model.HELP_GOALS) {
      const withoutAgent = model.getHelpGoalTools(goal, edition, false);
      assert.ok(withoutAgent.every(item => !item.agentImage && !item.href.startsWith("/dashboard/agent/")));
    }
  }
  for (const [goal, workspace] of [["publish", "publications"], ["grow", "campaigns"], ["stats", "stats"]] as const) {
    const agent = model.getHelpGoalTools(goal, "premium", true).find(item => item.agentImage)!;
    assert.ok(agent, goal);
    assert.equal(agent.href, workspaces.INR_AGENT_WORKSPACES[workspace].href);
    assert.equal(agent.agentImage, workspaces.INR_AGENT_WORKSPACES[workspace].icon);
    assert.ok(existsSync(join(root, "public", agent.agentImage!)), agent.agentImage);
  }
});

test("all help tools use existing application pages and the current publication and media routes", () => {
  for (const edition of editions) {
    for (const goal of model.HELP_GOALS) {
      for (const tool of model.getHelpGoalTools(goal, edition, true)) {
        const url = new URL(tool.href, "https://app.inrcy.local");
        assert.ok(existsSync(join(root, "app", url.pathname, "page.tsx")), `${edition}/${goal}: ${tool.href}`);
      }
    }
  }
  assert.equal(model.getHelpGoalTools("publish", "standard", false)[0].href, "/dashboard?action=publish");
  assert.deepEqual(model.getHelpGoalTools("media", "standard", false).map(item => item.href), ["/dashboard/generer-media", "/dashboard/mediatheque"]);
});

test("legacy guide links open the channel workspace and current business DNA page without rewriting other links", () => {
  assert.equal(model.getHelpArticleDestination("/dashboard"), "/dashboard?helpAction=channels");
  assert.equal(model.getHelpArticleDestination("/dashboard/"), "/dashboard?helpAction=channels");
  assert.equal(model.getHelpArticleDestination("/dashboard/profil-entreprise"), "/dashboard/adn-entreprise");
  assert.equal(model.getHelpArticleDestination("/dashboard/profil-entreprise?section=offers#details"), "/dashboard/adn-entreprise?section=offers#details");
  for (const href of ["/dashboard?panel=threads", "/dashboard?action=publish", "/dashboard?panel=documents&panelSource=gps", "/dashboard/mon-profil", "/dashboard/profil-entreprise-other", "https://inrcy.com/dashboard"]) {
    assert.equal(model.getHelpArticleDestination(href), href);
  }
});

test("help search ignores accents, case and extra whitespace while keeping non-Latin text searchable", () => {
  assert.equal(model.normalizeHelpSearch("  MÉDIATHÈQUE   RéPutation  "), "mediatheque reputation");
  assert.equal(model.normalizeHelpSearch("Cre\u0301er\nune\tVIDÉO"), "creer une video");
  assert.equal(model.normalizeHelpSearch("  视频  AI  "), "视频 ai");
  assert.equal(model.normalizeHelpSearch("  ค้นหา  AI  "), "ค้นหา ai");
  assert.equal(model.normalizeHelpSearch(""), "");
});

test("legacy article actions open their named workspace rather than an ambiguous homepage or duplicate entry", () => {
  for (const edition of editions) {
    for (const pilot of [false, true]) {
      const articles = model.getHelpArticles(edition, pilot);
      const generator = articles.find(({ article }) => article.id === "generateur-express")!.article;
      assert.equal(generator.links?.find(link => link.label === "ouvrir_generateur_b31221be")?.href, "/dashboard?helpAction=generator-settings");
      const channels = articles.find(({ article }) => article.id === "canaux-express")!.article;
      assert.equal(model.getHelpArticleDestination(channels.links![0].href), "/dashboard?helpAction=channels");
      const calendar = articles.find(({ article }) => article.id === "agenda-express")!.article;
      assert.equal(calendar.links?.find(link => link.label === "nouvel_evenement_4b838182")?.href, "/dashboard/agenda?action=new");
      const crm = articles.find(({ article }) => article.id === "crm-express")!.article;
      assert.equal(crm.links?.filter(link => link.href === "/dashboard/crm").length, 1, "The CRM has no URL action to create or import; retain its truthful Open CRM entry");
      for (const { article } of articles) {
        assert.equal(new Set(article.links?.map(link => link.href)).size, article.links?.length ?? 0, article.id);
      }
    }
  }
  const source = readFileSync(join(root, "app/dashboard/gps/noticeContent.ts"), "utf8");
  assert.match(source, /label: "ouvrir_generateur_b31221be", href: "\/dashboard"/, "The legacy GPS source stays unchanged for other consumers");
  const calendarPage = readFileSync(join(root, "app/dashboard/agenda/AgendaClient.tsx"), "utf8");
  assert.match(calendarPage, /if \(action !== "new"\) return;/);
  assert.match(calendarPage, /openCreateRdv\(selectedDate\)/);
});

test("one help consumer cannot mutate the article selections or tool list seen by another", () => {
  const firstGoal = model.getHelpGoalArticleIds("publish") as string[];
  firstGoal.splice(0, firstGoal.length);
  assert.ok(model.getHelpGoalArticleIds("publish").includes("booster-express"));
  const firstSetup = model.getHelpSetupArticleIds("channels") as string[];
  firstSetup.push("missing-guide");
  assert.ok(!model.getHelpSetupArticleIds("channels").includes("missing-guide"));
  const firstTools = model.getHelpGoalTools("media", "standard", false);
  firstTools[0].href = "/dashboard/factures";
  assert.equal(model.getHelpGoalTools("media", "standard", false)[0].href, "/dashboard/generer-media");
});
