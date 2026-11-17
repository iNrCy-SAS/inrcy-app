import assert from "node:assert/strict";
import test from "node:test";
import { getAiWorkspaceCompletionScore } from "../../lib/aiMemory.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
type Fixture = { profile?: Record<string, unknown> | null; profileError?: boolean; unauthorized?: boolean; edition?: string };

function routeFixture(options: Fixture = {}) {
  const queries: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }> = [];
  const profile = options.profile === undefined ? {
    company_legal_name: " Entreprise active ", phone: " +33 6 11 22 33 44 ",
    contact_email: " societe@example.test ", logo_path: " company/logo.png ",
    logo_url: " https://media.example.test/company/logo.png ", hq_zip: " 75001 ", hq_city: " Paris ",
    role: "never-expose-profile-role", private_actor_field: "never-expose-profile-secret",
  } : options.profile;
  const memory = { detailedDescription: "Présentation de l’entreprise active suffisamment détaillée pour servir de contexte à ses contenus professionnels.",
    mission: "Accompagner ses clients avec des services adaptés à leurs besoins.", specialties: ["Conseil", "Accompagnement"] };
  const business = { sector: "", business_description: memory.detailedDescription,
    services: ["Conseil"], intervention_zones: ["France entière"], customer_typologies: ["professionnels"] };
  let editionReads = 0;
  const supabase = { from(table: string) {
    const request = { table, columns: "", filters: [] as Array<[string, unknown]> };
    queries.push(request);
    return {
      select(columns: string) { request.columns = columns; return this; },
      eq(column: string, value: unknown) { request.filters.push([column, value]); return this; },
      order() { return this; }, limit() { return this; },
      async maybeSingle() {
        assert.deepEqual(request.filters, [[table === "business_ai_memories" ? "account_id" : "user_id", ACCOUNT]], "every read belongs to the active establishment, never the actor");
        if (table === "business_ai_memories") return { data: { memory, completion_score: 3, updated_at: "2026-11-18T00:00:00Z" }, error: null };
        if (table === "business_profiles") return { data: business, error: null };
        assert.equal(table, "profiles");
        return { data: profile, error: options.profileError ? { message: "private database diagnostic" } : null };
      },
    };
  } };
  const load = runtimeModules({
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/requireUser": { requireUser: async () => ({ supabase, activeUserId: ACCOUNT, authUserId: ACTOR,
      user: { id: ACTOR, email: "actor-must-not-be-company@example.test" },
      errorResponse: options.unauthorized ? Response.json({ error: "auth_required" }, { status: 401 }) : null }) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async (id: string) => {
      assert.equal(id, ACCOUNT); editionReads += 1; return options.edition || "standard";
    } },
    "@/lib/boosterGenerationContext": { invalidateBoosterGenerationContext: () => assert.fail("A score read must not invalidate or write data") },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: (_error: unknown, init: { status: number }) => Response.json({ error: "safe_read_failure" }, init) },
  });
  const route = load<typeof import("../../app/api/ai-memory/route.ts")>("app/api/ai-memory/route.ts");
  return { route, queries, editionReads: () => editionReads };
}

test("the native ADN read exposes only the active company's score context without additional queries or writes", async () => {
  const fixture = routeFixture();
  const response = await fixture.route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.equal(result.accountId, ACCOUNT);
  assert.deepEqual(result.completionContext, {
    companyName: "Entreprise active", phone: "+33 6 11 22 33 44", contactEmail: "societe@example.test",
    logoPath: "company/logo.png", logoUrl: "https://media.example.test/company/logo.png", postalCode: "75001", city: "Paris",
    sector: result.profileFoundation.sector, profession: result.profileFoundation.profession,
  });
  assert.equal(fixture.queries.length, 3);
  const selectedProfile = fixture.queries.find(query => query.table === "profiles");
  assert.deepEqual(selectedProfile?.columns.split(","), ["company_legal_name", "phone", "contact_email", "logo_path", "logo_url", "hq_zip", "hq_city"]);
  assert.doesNotMatch(JSON.stringify(result.completionContext), /actor-must|private_actor|never-expose|role/);
  assert.equal(result.completionScore, getAiWorkspaceCompletionScore(result.memory, result.businessKnowledge, { includePremium: true }), "legacy memory completion remains backward compatible");
});

test("missing company contacts never fall back to the actor's login email", async () => {
  const response = await routeFixture({ profile: null }).route.GET();
  assert.equal(response.status, 200);
  const result = await response.json();
  for (const key of ["phone", "contactEmail", "logoPath", "logoUrl", "postalCode", "city"]) assert.equal(result.completionContext[key], "");
  assert.doesNotMatch(JSON.stringify(result.completionContext), /actor-must/);
});

test("malformed optional profile values remain empty strings instead of becoming score-completing text", async () => {
  const response = await routeFixture({ profile: { company_legal_name: "Entreprise", phone: 42, contact_email: {},
    logo_path: [], logo_url: false, hq_zip: null, hq_city: { city: "Wrong shape" } } }).route.GET();
  assert.equal(response.status, 200);
  const result = await response.json();
  for (const key of ["phone", "contactEmail", "logoPath", "logoUrl", "postalCode", "city"]) assert.equal(result.completionContext[key], "");
});

for (const edition of ["basic", "standard", "premium", "founder"]) {
  test(`score context is additive for the ${edition} edition`, async () => {
    const response = await routeFixture({ edition }).route.GET();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.edition, edition); assert.equal(result.strategyEnabled, true);
    assert.equal(result.completionContext.companyName, "Entreprise active");
    assert.equal(result.completionContext.city, "Paris");
  });
}

test("unauthenticated reads return before any edition or company data lookup", async () => {
  const fixture = routeFixture({ unauthorized: true });
  const response = await fixture.route.GET();
  assert.equal(response.status, 401); assert.equal(fixture.editionReads(), 0); assert.equal(fixture.queries.length, 0);
});

test("profile failures fail closed without exposing a partially loaded company score context", async () => {
  const response = await routeFixture({ profileError: true }).route.GET();
  assert.equal(response.status, 500);
  const result = await response.json();
  assert.equal(result.completionContext, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private database diagnostic|Entreprise active/);
});

test("the native CTA destination read identifies and loads the active company, never the actor", async () => {
  const calls: unknown[] = [], supabase = { marker: "authenticated-scoped-client" };
  const load = runtimeModules({
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/requireUser": { requireUser: async () => ({ supabase, activeUserId: ACCOUNT, authUserId: ACTOR, errorResponse: null }) },
    "@/lib/boosterCtaDefaultsServer": { loadBoosterCtaDefaults: async (args: unknown) => {
      calls.push(args); return { accountId: ACTOR, phone: "0612345678", siteWebUrl: "https://example.test" };
    } },
  });
  const route = load<typeof import("../../app/api/booster/cta-defaults/route.ts")>("app/api/booster/cta-defaults/route.ts");
  const response = await route.GET(); assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ supabase, userId: ACCOUNT }]);
  const result = await response.json();
  assert.equal(result.accountId, ACCOUNT); assert.equal(result.phone, "0612345678");
  assert.equal(result.siteWebUrl, "https://example.test", "existing CTA destinations stay compatible");
});

test("unauthenticated CTA destination reads never resolve another company's defaults", async () => {
  const load = runtimeModules({
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/requireUser": { requireUser: async () => ({ errorResponse: Response.json({ error: "auth_required" }, { status: 401 }) }) },
    "@/lib/boosterCtaDefaultsServer": { loadBoosterCtaDefaults: () => assert.fail("Unauthenticated request reached company data") },
  });
  const route = load<typeof import("../../app/api/booster/cta-defaults/route.ts")>("app/api/booster/cta-defaults/route.ts");
  assert.equal((await route.GET()).status, 401);
});
