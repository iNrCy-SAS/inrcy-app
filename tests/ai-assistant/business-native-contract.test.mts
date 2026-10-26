import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Row = Record<string, unknown>;
type NativeRoute = { GET(): Promise<Response>; PUT(request: Request): Promise<Response> };
const root = resolve(import.meta.dirname, "../..");
const accountId = "10000000-0000-4000-8000-000000000001";
const list = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);

/** The native GET/PUT and all business normalizers execute unchanged; only authenticated I/O is isolated. */
function harness() {
  let storedMemory: Row = {
    mission: "Accompagner les habitants", values: ["Respect"], editorialStrategy: "Stratégie conservée", offersAndArguments: "Offres conservées",
    richText: { editorialStrategy: "<p>Stratégie conservée</p>" },
    referenceDocuments: [{ id: "document-prive", name: "Notice.pdf", bucket: "inrcy-ai-documents", path: `users/${accountId}/ai-memory-documents/notice.pdf`, mimeType: "application/pdf", size: 1000, status: "analysed", extractedText: "Document de référence conservé", note: "", createdAt: "2026-10-26T00:00:00.000Z" }],
  };
  const business: Row = { user_id: accountId, company_name: "Atelier Horizon", business_description: "Description intacte", sector: "", services: list("Service", 20), intervention_zones: list("Zone", 30), strengths: list("Force", 16), customer_typologies: list("Clientèle", 12), opening_days: "", opening_hours: "", tone: "warm", ai_custom_instructions: "Consigne conservée", ai_channel_ctas: { facebook: { action: "site", target: "https://example.test" } }, updated_at: "2026-10-26T00:00:00Z" };
  const writes: Array<{ table: string; payload: Row }> = [];
  const supabase = { from(table: string) {
    const filters: Array<[string, unknown]> = []; let payload: Row | undefined;
    const read = () => {
      assert.ok(filters.some(([key, value]) => key === (table === "business_ai_memories" ? "account_id" : "user_id") && value === accountId), `Scope ${table}`);
      return table === "business_ai_memories" ? { memory: structuredClone(storedMemory), completion_score: 0, updated_at: "2026-10-26T00:00:00Z" }
        : table === "business_profiles" ? structuredClone(business) : { company_legal_name: "Atelier Horizon" };
    };
    const save = () => {
      assert.ok(payload); assert.equal(payload[table === "business_ai_memories" ? "account_id" : "user_id"], accountId);
      writes.push({ table, payload: structuredClone(payload) });
      if (table === "business_ai_memories") storedMemory = structuredClone(payload.memory as Row);
      else Object.assign(business, structuredClone(payload));
      return table === "business_ai_memories" ? { memory: structuredClone(storedMemory), updated_at: "2026-10-26T01:00:00Z" } : structuredClone(business);
    };
    const builder = {
      select: () => builder, eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; }, order: () => builder, limit: () => builder,
      maybeSingle: async () => ({ data: read(), error: null }),
      upsert: (value: Row) => { payload = value; return builder; },
      single: async () => ({ data: save(), error: null }),
      then: (done: (value: Row) => unknown) => Promise.resolve({ data: payload ? save() : read(), error: null }).then(done),
    };
    return builder;
  } };
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/requireUser": { requireUser: async () => ({ supabase, activeUserId: accountId, errorResponse: null }) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async () => "standard" },
    "@/lib/boosterGenerationContext": { invalidateBoosterGenerationContext: async (id: string) => assert.equal(id, accountId) },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ error: "I/O unavailable" }, { status: 500 }) },
  };
  const cache = new Map<string, { exports: unknown }>();
  function load(file: string): unknown {
    const existing = cache.get(file); if (existing) return existing.exports;
    const loaded = { exports: {} }; cache.set(file, loaded);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Response, Headers, URL, Date, Buffer, structuredClone, console })((name: string) => {
      if (name in mocks) return mocks[name];
      assert.ok(name.startsWith("@/") || name.startsWith("."), `Unexpected external dependency ${name}`);
      let target = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(file), name);
      if (!extname(target)) target = [".ts", ".tsx", ".json"].map(extension => `${target}${extension}`).find(existsSync)!;
      assert.ok(target, `Missing module ${name}`);
      return target.endsWith(".json") ? JSON.parse(readFileSync(target, "utf8")) : load(target);
    }, loaded, loaded.exports);
    return loaded.exports;
  }
  const route = load(resolve(root, "app/api/ai-memory/route.ts")) as NativeRoute;
  return { route, business, writes, memory: () => storedMemory };
}

test("the native ADN GET retains full stored business lists rather than generation-prompt limits", async () => {
  const h = harness(); const response = await h.route.GET(); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.accountId, accountId);
  assert.equal(data.businessKnowledge.services.length, 20); assert.equal(data.businessKnowledge.interventionZones.length, 30);
  assert.equal(data.businessKnowledge.strengths.length, 16); assert.equal(data.businessKnowledge.customerTypes.length, 12);
});

test("native partial PUT preserves omitted ADN, reference documents, business lists and AI settings", async () => {
  const h = harness(); const originalDocs = structuredClone(h.memory().referenceDocuments);
  const response = await h.route.PUT(new Request("https://app.inrcy.test/api/ai-memory", { method: "PUT", body: JSON.stringify({ memory: { mission: "Nouvelle mission" }, businessKnowledge: { weeklySchedule: { days: { monday: { open: true, allDay: false, slots: [{ start: "09:00", end: "17:00" }] } } } } }) }));
  assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.ok, true);
  assert.equal(h.memory().mission, "Nouvelle mission"); assert.equal(h.memory().editorialStrategy, "Stratégie conservée");
  assert.equal(h.memory().offersAndArguments, "Offres conservées"); assert.deepEqual(JSON.parse(JSON.stringify(h.memory().referenceDocuments)), originalDocs);
  assert.equal((h.business.services as unknown[]).length, 20); assert.equal((h.business.intervention_zones as unknown[]).length, 30);
  assert.equal((h.business.strengths as unknown[]).length, 16); assert.equal((h.business.customer_typologies as unknown[]).length, 12);
  assert.equal(h.business.tone, "warm"); assert.equal(h.business.ai_custom_instructions, "Consigne conservée");
  assert.equal(data.businessKnowledge.weeklySchedule.days.monday.slots[0].end, "17:00");
  assert.ok(h.writes.every(write => write.table === "business_profiles" || write.table === "business_ai_memories"));
});

test("native server-owned reference documents cannot be deleted by a stale generic memory payload", async () => {
  const h = harness(); const response = await h.route.PUT(new Request("https://app.inrcy.test/api/ai-memory", { method: "PUT", body: JSON.stringify({ memory: { mission: "Mission actualisée", referenceDocuments: [] } }) }));
  assert.equal(response.status, 200); assert.equal((h.memory().referenceDocuments as unknown[]).length, 1);
  assert.equal(h.writes.some(write => write.table === "business_profiles"), false);
});
