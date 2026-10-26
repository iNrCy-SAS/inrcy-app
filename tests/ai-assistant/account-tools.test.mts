import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { normalizeAiMemory } from "../../lib/aiMemory.ts";
import { fitPromptPayloadToJsonBudget } from "../../lib/aiPromptBudget.ts";
import type * as AccountTools from "../../lib/inrAssistantAccountTools.ts";

const accountA = "account-a";
const accountB = "account-b";
type Row = Record<string, unknown>;
type Query = { table: string; select: string; filters: Array<[string, string, unknown]>; limit?: number };
type TestTool = { execute: (input: unknown) => Promise<Row>; inputSchema: { validate?: (input: unknown) => { success: boolean } } };

function harness(options: { overrides?: Record<string, Row[]>; errors?: string[] } = {}) {
  const queries: Query[] = [];
  const tables: Record<string, Row[]> = {
    profiles: [{ user_id: accountA, company_legal_name: "Atelier A", hq_city: "Paris", password: "private-profile-password" }],
    business_profiles: [{ user_id: accountA, sector: "services", business_description: "Réparation locale", services: ["Toiture"], tone: "warm", updated_at: "2026-10-25T10:00:00Z", provider_token: "private-business-token" }],
    business_ai_memories: [{ account_id: accountA, completion_score: 84, updated_at: "2026-10-25T10:00:00Z", memory: { mission: "Servir les habitants", values: ["Proximité"], referenceDocuments: [{ path: "private/reference.pdf", bucket: "private" }], access_token: "private-memory-token" } }],
    pro_media_library: [
      { id: "media-a", user_id: accountA, is_active: true, source: "mediatheque", title: "Chantier A", tags: ["Toiture", "été"], media_type: "image", mime_type: "image/jpeg", width: 1080, height: 1350, size_bytes: 500_000, created_at: "2026-10-25T10:00:00Z", signed_url: "https://private.invalid?token=hidden", storage_path: "private/storage-a" },
      { id: "media-b", user_id: accountB, is_active: true, source: "mediatheque", title: "FOREIGN MEDIA", media_type: "image" },
      { id: "draft-a", user_id: accountA, is_active: true, source: "ai_media_generation_draft", title: "UNACCEPTED DRAFT", media_type: "image" },
      { id: "hidden-a", user_id: accountA, is_active: false, source: "mediatheque", title: "HIDDEN MEDIA", media_type: "image" },
    ],
    publications: [
      { id: "publication-a", user_id: accountA, title: "Publication A", content: "Nos chantiers de toiture", idea: "Conseils", created_at: "2026-10-25T10:00:00Z", video_url: "private-video-url", media_metadata: { access_token: "private-publication-token" } },
      { id: "publication-b", user_id: accountB, title: "FOREIGN PUBLICATION", content: "Texte privé" },
    ],
    publication_deliveries: [
      { user_id: accountA, publication_id: "publication-a", channel: "facebook", status: "delivered", error: "PRIVATE ERROR DETAILS" },
      { user_id: accountA, publication_id: "publication-a", channel: "tiktok", status: "failed", error: "PRIVATE ERROR DETAILS" },
      { user_id: accountB, publication_id: "publication-a", channel: "FOREIGN CHANNEL", status: "delivered" },
    ],
    ...options.overrides,
  };
  const supabase = { from: (table: string) => {
    const query: Query = { table, select: "", filters: [] }; queries.push(query);
    const result = () => {
      if (options.errors?.includes(table)) return { data: null, error: { message: "PRIVATE DATABASE ERROR" } };
      let rows = (tables[table] || []).filter((row) => query.filters.every(([kind, key, value]) =>
        kind === "eq" ? row[key] === value : kind === "neq" ? row[key] !== value : (value as unknown[]).includes(row[key])));
      if (query.limit !== undefined) rows = rows.slice(0, query.limit);
      return { data: rows, error: null };
    };
    const builder = {
      select: (fields: string) => { query.select = fields; return builder; },
      eq: (key: string, value: unknown) => { query.filters.push(["eq", key, value]); return builder; },
      neq: (key: string, value: unknown) => { query.filters.push(["neq", key, value]); return builder; },
      in: (key: string, value: unknown[]) => { query.filters.push(["in", key, value]); return builder; },
      order: () => builder,
      limit: (limit: number) => { query.limit = limit; return builder; },
      maybeSingle: async () => { const read = result(); return { ...read, data: read.data?.[0] ?? null }; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  } };
  const stubs: Record<string, unknown> = {
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (schema: unknown, config: unknown) => ({ schema, ...config as object }) },
    "./aiMemory.ts": { normalizeAiMemory }, "./aiPromptBudget.ts": { fitPromptPayloadToJsonBudget },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantAccountTools.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Date, TextEncoder })((id: string) => {
    if (!(id in stubs)) throw new Error(`Unexpected dependency: ${id}`); return stubs[id];
  }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as typeof AccountTools;
  const tools = runtime.createInrAssistantAccountTools({ accountId: accountA, supabase: supabase as never });
  return { tools: tools as unknown as Record<keyof typeof tools, TestTool>, queries, runtime };
}

test("ADN uses authenticated account scope on every table and excludes private documents and unknown columns", async () => {
  const h = harness();
  const result = await h.tools.getBusinessDna.execute({});
  assert.equal(result.ok, true);
  assert.equal(result.untrustedContent, true);
  assert.equal(result.completionPercent, 84);
  assert.equal((result.knowledge as Row).company, "Atelier A");
  const body = JSON.stringify(result);
  for (const secret of ["private-reference", "reference.pdf", "private-profile-password", "private-business-token", "private-memory-token"]) assert.equal(body.includes(secret), false);
  for (const query of h.queries) assert.ok(query.filters.some(([kind, key, value]) => kind === "eq" && ["user_id", "account_id"].includes(key) && value === accountA));
});

test("large and escaped ADN stays below six thousand serialized characters", async () => {
  const h = harness({ overrides: { business_ai_memories: [{ account_id: accountA, memory: {
    detailedDescription: '"Longue description" '.repeat(500), mission: "a".repeat(800),
    specialties: Array.from({ length: 20 }, (_, i) => `${i}${"S".repeat(100)}`), offersAndArguments: "b".repeat(5_000),
    keyArguments: "c".repeat(3_000), proofsAndObjections: "d".repeat(5_000), editorialStrategy: "e".repeat(5_000),
    targetAudiences: Array.from({ length: 20 }, (_, i) => `${i}${"T".repeat(100)}`), values: Array.from({ length: 20 }, (_, i) => `${i}${"V".repeat(100)}`),
    customerNeeds: Array.from({ length: 20 }, (_, i) => `${i}${"N".repeat(100)}`), differentiators: Array.from({ length: 20 }, (_, i) => `${i}${"D".repeat(100)}`),
  } }] } });
  const result = await h.tools.getBusinessDna.execute({});
  assert.equal(result.truncated, true);
  assert.ok(JSON.stringify(result).length <= 6_000);
});

test("multilingual and escaped DNA remains a valid structured projection below its UTF-8 budget", async () => {
  for (const sample of ["企业提供屋顶翻修服务并帮助当地客户。", "บริษัทให้บริการซ่อมแซมหลังคาและดูแลลูกค้าในพื้นที่", '🏠🔨 "rénover" \\ toiture']) {
    const h = harness({ overrides: {
      business_profiles: [{ user_id: accountA, sector: "services", business_description: sample.repeat(100), services: Array.from({ length: 8 }, () => sample.repeat(8)) }],
      business_ai_memories: [{ account_id: accountA, memory: { mission: sample.repeat(100), offersAndArguments: sample.repeat(300),
        keyArguments: sample.repeat(200), proofsAndObjections: sample.repeat(300), objectionResponses: sample.repeat(200),
        editorialStrategy: sample.repeat(300), campaignCalendar: sample.repeat(200),
        values: Array.from({ length: 16 }, () => sample.repeat(8)), customerNeeds: Array.from({ length: 16 }, () => sample.repeat(8)),
      } }],
    } });
    const result = await h.tools.getBusinessDna.execute({});
    assert.equal(result.ok, true); assert.equal(result.truncated, true); assert.equal(result.untrustedContent, true);
    assert.ok(new TextEncoder().encode(JSON.stringify(result.knowledge)).byteLength <= 5_200);
    assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 6_000);
    const knowledge = result.knowledge as Row;
    assert.equal(knowledge.company, "Atelier A");
    assert.ok(typeof knowledge.description === "string" && knowledge.description.length > 0);
    for (const value of Object.values(knowledge)) assert.ok(typeof value === "string" || Array.isArray(value) && value.every(item => typeof item === "string"));
    assert.deepEqual(JSON.parse(JSON.stringify(knowledge)), JSON.parse(JSON.stringify(result)).knowledge);
  }
});

test("pasted credentials are redacted inside allowed business text", async () => {
  const h = harness({ overrides: { business_ai_memories: [{ account_id: accountA, memory: { mission: "api_key=my-private-key Bearer abcdefghijklmnopqrst https://private.invalid/?token=private-preview" } }] } });
  const body = JSON.stringify(await h.tools.getBusinessDna.execute({}));
  for (const secret of ["my-private-key", "abcdefghijklmnopqrst", "private-preview"]) assert.equal(body.includes(secret), false);
});

test("unavailable DNA is unknown rather than empty", async () => {
  const h = harness({ errors: ["business_ai_memories"] });
  const result = await h.tools.getBusinessDna.execute({});
  assert.equal(result.ok, false);
  assert.equal(result.knowledge, undefined);
  assert.equal(JSON.stringify(result).includes("PRIVATE DATABASE ERROR"), false);
});

test("media tag search is accent tolerant and cannot expose other accounts, hidden rows or unaccepted drafts", async () => {
  const h = harness();
  const result = await h.tools.searchMedia.execute({ query: "ete", type: "image", limit: 8 });
  assert.equal(result.ok, true);
  assert.equal((result.items as Row[]).length, 1);
  assert.equal((result.items as Row[])[0].id, "media-a");
  const body = JSON.stringify(result);
  for (const secret of ["FOREIGN", "HIDDEN", "UNACCEPTED", "hidden", "private/storage", "signed_url"]) assert.equal(body.includes(secret), false);
  assert.ok(h.queries[0].filters.some((filter) => filter[1] === "is_active" && filter[2] === true));
  assert.ok(h.queries[0].filters.some((filter) => filter[0] === "neq" && filter[1] === "source"));
});

test("media and publication limits are capped at eight, including direct runtime input", async () => {
  const media = Array.from({ length: 30 }, (_, index) => ({ id: `media-${index}`, user_id: accountA, is_active: true, source: "mediatheque", media_type: "video", title: "Clip" }));
  const publications = Array.from({ length: 30 }, (_, index) => ({ id: `publication-${index}`, user_id: accountA, title: "Post", content: "Contenu" }));
  const h = harness({ overrides: { pro_media_library: media, publications } });
  assert.equal(((await h.tools.searchMedia.execute({ query: null, type: "video", limit: 999 })).items as Row[]).length, 8);
  assert.equal(((await h.tools.getRecentPublications.execute({ query: null, limit: 999 })).items as Row[]).length, 8);
  assert.equal(h.queries.find((query) => query.table === "pro_media_library")?.limit, 8);
});

test("a bounded media search does not pretend to exhaust older items", async () => {
  const media = Array.from({ length: 500 }, (_, index) => ({ id: `media-${index}`, user_id: accountA, is_active: true, source: "mediatheque", media_type: "image", title: "Photo récente" }));
  const h = harness({ overrides: { pro_media_library: media } });
  const result = await h.tools.searchMedia.execute({ query: "ancien chantier", type: "all", limit: 8 });
  assert.equal((result.items as Row[]).length, 0);
  assert.equal(result.olderItemsMayExist, true);
  assert.equal(result.searchedRecentItems, 500);
});

test("media metadata never includes signed URLs or storage/provider fields", async () => {
  const h = harness();
  const result = await h.tools.searchMedia.execute({ query: null, type: null, limit: null });
  const media = (result.items as Row[])[0];
  assert.equal(media.width, 1080);
  assert.equal(media.height, 1350);
  assert.equal(media.sizeBytes, 500_000);
  assert.equal(media.signed_url, undefined);
  assert.equal(media.storage_path, undefined);
  assert.doesNotMatch(h.queries[0].select, /signed|storage|metadata|token|\*/);
});

test("recent publications preserve actual channel states without provider error details", async () => {
  const h = harness();
  const result = await h.tools.getRecentPublications.execute({ query: "toiture", limit: 8 });
  const publication = (result.items as Row[])[0];
  assert.equal(publication.id, "publication-a");
  assert.equal(publication.channelsKnown, true);
  assert.deepEqual(JSON.parse(JSON.stringify(publication.channels)), [{ channel: "facebook", status: "delivered" }, { channel: "tiktok", status: "failed" }]);
  const body = JSON.stringify(result);
  for (const secret of ["FOREIGN", "PRIVATE ERROR", "private-publication-token", "private-video-url"]) assert.equal(body.includes(secret), false);
  for (const query of h.queries) assert.ok(query.filters.some(([kind, key, value]) => kind === "eq" && key === "user_id" && value === accountA));
});

test("unavailable channel states remain unknown and do not become a successful publication", async () => {
  const h = harness({ errors: ["publication_deliveries"] });
  const result = await h.tools.getRecentPublications.execute({ query: null, limit: 8 });
  assert.equal(result.channelsKnown, false);
  assert.equal(((result.items as Row[])[0].channels as Row[]).length, 0);
  assert.equal((result.items as Row[])[0].status, undefined);
});

test("database read errors cannot become invented empty media/publication results", async () => {
  const h = harness({ errors: ["publications", "pro_media_library"] });
  for (const result of [await h.tools.searchMedia.execute({ query: null, type: null, limit: null }), await h.tools.getRecentPublications.execute({ query: null, limit: null })]) {
    assert.equal(result.ok, false);
    assert.equal(result.items, undefined);
    assert.equal(JSON.stringify(result).includes("PRIVATE DATABASE ERROR"), false);
  }
});

test("model scope injection and invalid criteria fail before database reads", async () => {
  for (const key of ["searchMedia", "getRecentPublications"] as const) {
    const h = harness();
    await assert.rejects(h.tools[key].execute({ query: "x", accountId: accountB }), /invalides/);
    assert.equal(h.queries.length, 0);
  }
  const h = harness();
  assert.equal(h.tools.getBusinessDna.inputSchema.validate?.({ accountId: accountB }).success, false);
  await assert.rejects(h.tools.searchMedia.execute({ query: "x".repeat(121) }), /invalides/);
  assert.equal(h.queries.length, 0);
});

test("filter metacharacters are never interpolated into a database expression", async () => {
  const h = harness();
  await h.tools.searchMedia.execute({ query: "%,user_id.eq.account-b", type: "all", limit: 8 });
  for (const query of h.queries) for (const filter of query.filters) assert.equal(String(filter[2]).includes("%,user_id"), false);
});
