import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { AI_CTA_CHANNELS } from "../../lib/aiChannelCtaPreferences.ts";
import * as policy from "../../lib/personalizationCompletion.ts";

type Scores = ReturnType<typeof import("../../app/dashboard/_hooks/useDashboardPreparationScores.ts").useDashboardPreparationScores>;
type MemoryPayload = { ok: boolean; accountId: string; memory: Record<string, unknown>; businessKnowledge: Record<string, unknown>; completionContext: policy.PersonalizationCompanyContext };
type BusinessResult = { data: Record<string, unknown> | null; error: unknown };
const ACCOUNT = "account-a", OTHER = "account-b", KEY = "inrcy_dashboard_preparation_scores_v2";
const ctas = Object.fromEntries(AI_CTA_CHANNELS.map(({ key }) => [key,
  { choice: "site", mode: "website", url: "https://example.test", label: "Découvrir", phone: "" },
]));
const destinations = { preferredWebsiteUrl: "https://example.test", siteWebUrl: "https://example.test", phone: "0612345678" };
function memoryPayload(accountId = ACCOUNT, company = true, strategy = true): MemoryPayload {
  return { ok: true, accountId,
    memory: {
      ...(company ? { detailedDescription: "Une entreprise spécialisée dans la création de contenus pour les professionnels et leur communication quotidienne.",
        mission: "Simplifier la communication des professionnels avec des outils adaptés.", specialties: ["Publication", "Automatisation"],
        targetAudiences: ["Professionnels"], customerNeeds: ["Visibilité"], differentiators: ["Accompagnement"], values: ["Clarté"],
        brandPersonality: ["Accessible"], commitments: ["Réactivité"] } : {}),
      ...(strategy ? { offersAndArguments: "Des offres adaptées aux besoins de communication des professionnels.",
        keyArguments: "Un outil centralisé pour la communication quotidienne.", proofsAndObjections: "Des exemples d’utilisation permettent de découvrir les fonctions disponibles.",
        objectionResponses: "L’accompagnement aide à prendre en main les fonctions.", editorialStrategy: "Présenter les usages concrets et les bénéfices de chaque service.",
        campaignCalendar: "Une publication quotidienne adaptée aux besoins du professionnel." } : {}),
    },
    businessKnowledge: company ? { services: ["Communication"], interventionZones: ["France entière"], strengths: ["Accompagnement"],
      customerTypes: ["professionnels"], weeklySchedule: { notes: "Sur rendez-vous" } } : {},
    completionContext: company ? { companyName: "Entreprise", phone: "0612345678", contactEmail: "contact@example.test",
      logoPath: "logo.png", postalCode: "75001", city: "Paris", sector: "Numérique", profession: "Logiciel en ligne" } : {},
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Small deterministic hook host; production hook, policy and async flow execute unchanged. */
function harness(options: { pilot?: boolean; cache?: Array<[string, string, unknown]> } = {}) {
  type Cell = { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void };
  const cells: Cell[] = [], effects: Array<() => void> = [], cache = new Map<string, string>();
  const cacheReads: Array<{ key: string; account: string }> = [], cacheWrites: Array<{ key: string; account: string; value: unknown }> = [];
  const reads: Array<{ source: string; account: string }> = [], listeners = new Map<string, () => void>();
  let activeAccount = ACCOUNT, pilot = options.pilot ?? true, cursor = 0, dirty = false, scores: Scores;
  let readMemory: (account: string) => Promise<MemoryPayload> = async account => memoryPayload(account);
  let readBusiness: (account: string) => Promise<BusinessResult> = async account => ({ data: { user_id: account, ai_channel_ctas: structuredClone(ctas) }, error: null });
  let readDestinations: (account: string) => Promise<typeof destinations & { accountId: string }> = async account => ({ ...structuredClone(destinations), accountId: account });
  for (const [key, account, value] of options.cache || []) cache.set(`${key}:${account}`, JSON.stringify(value));
  const changed = (previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) =>
    !previous || !next || previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: typeof initial === "function" ? initial() : initial };
      return [cells[index].value, (next: unknown) => {
        cells[index].value = typeof next === "function" ? next(cells[index].value) : next; dirty = true;
      }];
    },
    useRef(value: unknown) { const index = cursor++; cells[index] ||= { value: { current: value } }; return cells[index].value; },
    useCallback(value: unknown, dependencies: readonly unknown[]) {
      const index = cursor++;
      if (!cells[index] || changed(cells[index].dependencies, dependencies)) cells[index] = { value, dependencies };
      return cells[index].value;
    },
    useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
      const index = cursor++, cell = cells[index] ||= {};
      if (!changed(cell.dependencies, dependencies)) return;
      cell.dependencies = dependencies;
      effects.push(() => { cell.cleanup?.(); cell.cleanup = effect() || undefined; });
    },
  };
  const supabase = { from(table: string) {
    assert.equal(table, "business_profiles"); let account = "";
    return {
      select(columns: string) { assert.equal(columns, "user_id,ai_channel_ctas"); return this; },
      eq(column: string, value: string) { assert.equal(column, "user_id"); account = value; return this; },
      async maybeSingle() { reads.push({ source: "business", account }); return readBusiness(account); },
    };
  } };
  const fetch = async (input: string, init: RequestInit) => {
    assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "include");
    assert.ok(!init.method || init.method === "GET", "score calculation never mutates account data");
    const account = activeAccount;
    if (input === "/api/ai-memory") { reads.push({ source: "memory", account }); return Response.json(await readMemory(account)); }
    assert.equal(input, "/api/booster/cta-defaults"); reads.push({ source: "destinations", account });
    return Response.json(await readDestinations(account));
  };
  const modules: Record<string, unknown> = {
    react,
    "@/lib/supabaseClient": { createClient: () => supabase },
    "../_components/DashboardViewerAccessProvider": { useDashboardViewerAccess: () => ({ metaPilotEnabled: pilot }) },
    "@/lib/personalizationCompletion": policy,
    "@/lib/browserAccountCache": {
      getActiveBrowserUserId: () => activeAccount,
      readAccountCacheValue: (key: string, account: string) => { cacheReads.push({ key, account }); return cache.get(`${key}:${account}`) ?? null; },
      writeAccountCacheValue: (key: string, value: string, account: string) => { cacheWrites.push({ key, value: JSON.parse(value), account }); cache.set(`${key}:${account}`, value); },
    },
  };
  const source = readFileSync(new URL("../../app/dashboard/_hooks/useDashboardPreparationScores.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const subject = {} as { useDashboardPreparationScores: (value: { accountId: string; edition: "standard" }) => Scores };
  new Function("exports", "require", "fetch", "window", javascript)(subject, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected hook boundary ${name}`); return modules[name];
  }, fetch, { addEventListener: (name: string, handler: () => void) => listeners.set(name, handler), removeEventListener: (name: string) => listeners.delete(name) });
  const render = () => { cursor = 0; dirty = false; scores = subject.useDashboardPreparationScores({ accountId: ACCOUNT, edition: "standard" }); return scores; };
  const flush = async () => {
    for (let iteration = 0; iteration < 10; iteration++) {
      if (dirty) render();
      while (effects.length) effects.shift()!();
      await new Promise<void>(resolve => setImmediate(resolve));
      if (!dirty && !effects.length) return;
    }
    assert.fail("The native score hook did not settle");
  };
  render();
  return {
    current: () => scores, render, flush, reads, cacheReads, cacheWrites, cache,
    memory(reader: typeof readMemory) { readMemory = reader; },
    business(reader: typeof readBusiness) { readBusiness = reader; },
    destinations(reader: typeof readDestinations) { readDestinations = reader; },
    switchAccount(account: string) { activeAccount = account; render(); },
    switchPilot(value: boolean) { pilot = value; render(); },
    dispatch(name: string) { listeners.get(name)?.(); },
  };
}

test("the native score hook hydrates only its version 2 account cache before refreshing", async () => {
  const h = harness({ cache: [["inrcy_dashboard_preparation_scores_v1", ACCOUNT, { dnaScore: 91, aiScore: 82 }],
    [KEY, ACCOUNT, { companyPercent: 80, ctaPercent: 50, strategyPercent: 20, metaPilotEnabled: true }]] });
  assert.deepEqual([h.current().companyScore, h.current().ctaScore, h.current().strategyScore, h.current().personalizationScore], [80, 50, 20, 70]);
  assert.equal(h.current().scoresKnown, true); assert.equal(h.reads.length, 0);
  assert.ok(h.cacheReads.every(read => read.key === KEY && read.account === ACCOUNT));
  await h.flush();
  assert.equal(h.current().personalizationScore, 100);
  assert.ok(h.cacheWrites.every(write => write.key === KEY && write.account === ACCOUNT));
});

test("a legacy score is never mistaken for the new 75 / 15 / 10 formula", () => {
  const h = harness({ cache: [["inrcy_dashboard_preparation_scores_v1", ACCOUNT, { dnaScore: 100, aiScore: 100 }]] });
  assert.equal(h.current().scoresKnown, false); assert.equal(h.current().personalizationScore, 0);
  assert.ok(h.cacheReads.every(read => read.key === KEY));
});

test("actual saved company, strategy and explicit usable CTA data produce the three complete groups", async () => {
  const h = harness(); await h.flush();
  assert.deepEqual([h.current().companyScore, h.current().ctaScore, h.current().strategyScore, h.current().personalizationScore], [100, 100, 100, 100]);
  assert.equal(h.current().scoresKnown, true);
  assert.deepEqual(h.reads.map(read => read.source).sort(), ["business", "destinations", "memory"]);
});

for (const group of ["company", "cta", "strategy"] as const) {
  test(`the real hook gives only ${group === "company" ? 75 : group === "cta" ? 15 : 10} points to the ${group} group`, async () => {
    const h = harness(); h.memory(async account => memoryPayload(account, group === "company", group === "strategy"));
    h.business(async account => ({ data: { user_id: account, ai_channel_ctas: group === "cta" ? ctas : {} }, error: null }));
    await h.flush();
    assert.equal(h.current().personalizationScore, group === "company" ? 75 : group === "cta" ? 15 : 10);
  });
}

test("writing defaults, instructions, interdictions, examples and vocabulary never change any score", async () => {
  const h = harness(); await h.flush(); const before = h.current();
  h.memory(async account => { const payload = memoryPayload(account); Object.assign(payload.memory, { preferredVocabulary: ["Conseil"], forbiddenVocabulary: ["Promesse"],
    instructions: "Consignes facultatives", forbiddenStyle: "Interdictions facultatives", likedExample: "Exemple un", likedExample2: "Exemple deux" }); return payload; });
  h.business(async account => ({ data: { user_id: account, ai_channel_ctas: ctas, ai_main_goal: "visibility", ai_preferred_angle: "price", tone: "fun", ai_voice: "je",
    ai_liked_example: "Exemple un", ai_liked_example_2: "Exemple deux", ai_custom_instructions: "Des consignes facultatives" }, error: null }));
  await before.refreshPreparationScores(); h.render();
  for (const key of ["companyScore", "ctaScore", "strategyScore", "personalizationScore"] as const) assert.equal(h.current()[key], before[key]);
});

test("transient memory, database and destination failures preserve previously known results", async () => {
  const h = harness(); await h.flush(); const before = h.current(), writes = h.cacheWrites.length;
  h.memory(async () => { throw Error("memory temporarily unavailable"); });
  h.business(async () => ({ data: null, error: { message: "database temporarily unavailable" } }));
  h.destinations(async () => { throw Error("destinations temporarily unavailable"); });
  await before.refreshPreparationScores(); h.render();
  assert.equal(h.current().scoresKnown, true); assert.equal(h.current().personalizationScore, before.personalizationScore);
  assert.equal(h.cacheWrites.length, writes, "failures never replace a valid cache with invented zeroes");
});

test("an ADN response for another account cannot complete company or strategy", async () => {
  const h = harness(); h.memory(async () => memoryPayload(OTHER)); await h.flush();
  assert.equal(h.current().companyKnown, false); assert.equal(h.current().strategyKnown, false);
  assert.equal(h.current().ctaKnown, true); assert.equal(h.current().personalizationScore, 15);
});

test("a business profile for another account cannot supply its CTA selections", async () => {
  const h = harness(); h.business(async () => ({ data: { user_id: OTHER, ai_channel_ctas: ctas }, error: null })); await h.flush();
  assert.equal(h.current().companyKnown, true); assert.equal(h.current().strategyKnown, true);
  assert.equal(h.current().ctaKnown, false); assert.equal(h.current().personalizationScore, 85);
});

test("CTA destinations for another account never validate the active company's CTA choices", async () => {
  const h = harness(); h.destinations(async () => ({ ...destinations, accountId: OTHER })); await h.flush();
  assert.equal(h.current().companyKnown, true); assert.equal(h.current().strategyKnown, true);
  assert.equal(h.current().ctaKnown, false); assert.equal(h.current().personalizationScore, 85);
});

test("a late response from a previous account never overwrites the newly active account or its cache", async () => {
  const h = harness(); await h.flush();
  const old = deferred<MemoryPayload>();
  h.memory(account => account === ACCOUNT ? old.promise : Promise.resolve(memoryPayload(account, false, false)));
  h.business(async account => ({ data: { user_id: account, ai_channel_ctas: account === ACCOUNT ? ctas : {} }, error: null }));
  const pending = h.current().refreshPreparationScores();
  h.switchAccount(OTHER); await h.flush();
  assert.equal(h.current().personalizationScore, 0); assert.equal(h.current().scoresKnown, true);
  const writes = h.cacheWrites.length; old.resolve(memoryPayload(ACCOUNT)); await pending; h.render();
  assert.equal(h.current().personalizationScore, 0); assert.equal(h.cacheWrites.length, writes);
  assert.ok(h.cacheWrites.slice(-1).every(write => write.account === OTHER));
});

test("a newer refresh wins when older company data arrives afterwards", async () => {
  const h = harness(); await h.flush(); const old = deferred<MemoryPayload>(); let request = 0;
  h.memory(async account => ++request === 1 ? old.promise : memoryPayload(account, false, false));
  const pending = h.current().refreshPreparationScores();
  await h.current().refreshPreparationScores(); h.render(); assert.equal(h.current().personalizationScore, 15);
  const writes = h.cacheWrites.length; old.resolve(memoryPayload(ACCOUNT)); await pending; h.render();
  assert.equal(h.current().personalizationScore, 15); assert.equal(h.cacheWrites.length, writes);
});

test("pilot visibility invalidates only cached CTA data and recalculates its actual denominator", async () => {
  const h = harness({ pilot: false });
  const withoutThreads = structuredClone(ctas); delete withoutThreads.threads;
  h.business(async account => ({ data: { user_id: account, ai_channel_ctas: withoutThreads }, error: null }));
  await h.flush(); assert.equal(h.current().ctaScore, 100); assert.equal(h.current().personalizationScore, 100);
  h.switchPilot(true);
  assert.equal(h.current().companyKnown, true); assert.equal(h.current().strategyKnown, true); assert.equal(h.current().ctaKnown, false);
  await h.flush(); assert.equal(h.current().ctaScore, 90); assert.equal(h.current().personalizationScore, 99);
});

test("usable profile destinations matter, while automatic unrecorded CTA choices earn no points", async () => {
  const h = harness(); h.business(async account => ({ data: { user_id: account, ai_channel_ctas: {} }, error: null }));
  await h.flush(); assert.equal(h.current().ctaScore, 0);
  h.business(async account => ({ data: { user_id: account, ai_channel_ctas: { facebook: { choice: "site" } } }, error: null }));
  h.destinations(async account => ({ preferredWebsiteUrl: "", siteWebUrl: "", phone: "", accountId: account }));
  await h.current().refreshPreparationScores(); h.render(); assert.equal(h.current().ctaScore, 0);
  h.destinations(async account => ({ ...destinations, accountId: account }));
  await h.current().refreshPreparationScores(); h.render(); assert.equal(h.current().ctaScore, 10);
});

test("cached component fractions survive hydration and the final weighted score rounds only once", async () => {
  const h = harness(); h.memory(async account => { const payload = memoryPayload(account); delete payload.completionContext.logoPath; return payload; });
  await h.flush(); assert.equal(h.current().companyScore, 99); assert.equal(h.current().personalizationScore, 99);
  const cached = JSON.parse(h.cache.get(`${KEY}:${ACCOUNT}`)!) as { companyPercent: number; ctaPercent: number; strategyPercent: number; metaPilotEnabled: boolean };
  assert.ok(cached.companyPercent > 98 && cached.companyPercent < 99);
  const hydrated = harness({ cache: [[KEY, ACCOUNT, cached]] });
  assert.equal(hydrated.current().personalizationScore, h.current().personalizationScore);
});
