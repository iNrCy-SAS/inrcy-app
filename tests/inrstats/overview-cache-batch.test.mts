import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { createOverviewCacheBatch } from "../../lib/stats/overviewCacheBatch.ts";

const userId = "owned-account";
const source = "overview";
const expiresAt = "2099-10-25T12:00:00.000Z";
const prefixFor = (include: string, days = 30) => `metaPilot=0|days=${days}|include=${include}|snapshot=2026-11-25|conn=`;
const connectionSignature = "cache_schema:4|profession=Étude (A+B) [expert].*?|website=https://example.test/a,b\\c"
  + "|activity=photos:0,0,0,0|history=complete".repeat(36);
const linkedinSuffix = "|liDateRange=restli2|providerRefusal=2";

function clientWithFetch(fetchStats: (url: URL, init?: RequestInit) => Promise<Response> | Response) {
  return createClient("https://supabase.test", "anonymous-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => fetchStats(new URL(String(input)), init) },
  });
}

test("a normal nine-channel cache wave becomes two exact reads with existing cache keys", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create table stats_cache(user_id text, source text, range_key text, payload jsonb, expires_at timestamptz)");
  const channels = ["site_web_ga4,site_web_gsc", "gmb", "facebook", "instagram", "tiktok", "youtube_shorts", "pinterest", "x", "linkedin"];
  const suffixFor = (channel: string) => channel === "linkedin" ? linkedinSuffix : "";
  const keyFor = (channel: string) => `${prefixFor(channel)}${connectionSignature}${suffixFor(channel)}`;
  for (const channel of channels) {
    await db.query("insert into stats_cache values ($1, $2, $3, $4::jsonb, $5)", [userId, source, keyFor(channel), JSON.stringify({ channel }), expiresAt]);
  }
  const otherRows = [
    ["foreign-account", source, keyFor("x"), "foreign", "2099-10-29"],
    [userId, "overview_last_good", keyFor("x"), "last good", "2099-10-29"],
    [userId, source, keyFor("x"), "expired", "2020-01-01"],
    [userId, source, keyFor("x").replace("cache_schema:4", "cache_schema:3"), "old signature", "2099-10-29"],
    [userId, source, prefixFor("x", 7) + connectionSignature, "other period", "2099-10-29"],
    [userId, source, keyFor("instagram") + linkedinSuffix, "other suffix", "2099-10-29"],
  ];
  for (const [account, kind, key, payload, expiry] of otherRows) {
    await db.query("insert into stats_cache values ($1, $2, $3, $4::jsonb, $5)", [account, kind, key, JSON.stringify({ channel: payload }), expiry]);
  }

  const calls: Array<{ url: URL; matched: number }> = [];
  const supabase = clientWithFetch(async (url, init) => {
    assert.equal(url.pathname, "/rest/v1/stats_cache");
    const query = url.searchParams;
    const rangeFilter = query.get("range_key")!;
    const batch = rangeFilter.startsWith("match.");
    assert.equal(query.get("user_id"), `eq.${userId}`);
    assert.equal(query.get("source"), `eq.${source}`);
    assert.equal(query.get("order"), "expires_at.desc");
    assert.equal(query.get("limit"), batch ? "8" : "1");
    assert.equal(new Headers(init?.headers).get("prefer"), batch ? "count=exact" : null);
    const data = await db.query<{ match_count: number }>(
      `select range_key, payload, expires_at, count(*) over ()::int as match_count
       from stats_cache where user_id = $1 and source = $2 and range_key ${batch ? "~" : "="} $3
       and expires_at > $4 order by expires_at desc limit $5`,
      [userId, source, rangeFilter.slice(batch ? "match.".length : "eq.".length), query.get("expires_at")!.slice("gt.".length), Number(query.get("limit"))],
    );
    const matched = data.rows[0]?.match_count ?? 0;
    calls.push({ url, matched });
    return Response.json(data.rows.map(({ match_count, ...row }) => {
      assert.equal(match_count, matched);
      return row;
    }), { headers: batch ? { "content-range": `0-${data.rows.length - 1}/${matched}` } : undefined });
  });

  const batchRead = createOverviewCacheBatch({ supabase, userId, source });
  const rows = await Promise.all(channels.map((channel) => batchRead(
    supabase,
    userId,
    { prefix: prefixFor(channel), connectionSignature, suffix: suffixFor(channel) },
    async () => {
      const { data, error } = await supabase
        .from("stats_cache").select("payload, expires_at").eq("user_id", userId).eq("source", source)
        .eq("range_key", keyFor(channel)).gt("expires_at", new Date().toISOString()).order("expires_at", { ascending: false }).limit(1).maybeSingle();
      assert.equal(error, null);
      return data;
    },
  )));
  assert.deepEqual(rows.map((row) => row?.payload), channels.map((channel) => ({ channel })));
  assert.equal(calls.length, 2);
  const batch = calls.find((call) => call.url.searchParams.get("range_key")?.startsWith("match."));
  assert.equal(batch?.matched, 8);
  assert.ok(batch.url.searchParams.get("range_key")?.startsWith("match.^metaPilot=0\\|days=30\\|include=("));
  assert.ok(batch.url.href.length < 8_000);
  assert.equal(calls.find((call) => call !== batch)?.url.searchParams.get("range_key"), `eq.${keyFor("linkedin")}`);
});

test("a complete batch keeps only the newest exact hit and treats an empty key as a cache miss", async () => {
  const prefix = prefixFor("x");
  const laterExpiry = "2099-10-31T12:00:00.000Z";
  const supabase = clientWithFetch(() => Response.json([
    { range_key: prefix + connectionSignature, payload: "latest", expires_at: laterExpiry },
    { range_key: prefix + connectionSignature, payload: "older", expires_at: expiresAt },
  ], { headers: { "content-range": "0-1/2" } }));
  const batchRead = createOverviewCacheBatch({ supabase, userId, source });
  const noFallback = async () => assert.fail("complete batch should not require an exact retry");
  const [hit, miss] = await Promise.all([
    batchRead(supabase, userId, { prefix, connectionSignature, suffix: "" }, noFallback),
    batchRead(supabase, userId, { prefix: prefixFor("pinterest"), connectionSignature, suffix: "" }, noFallback),
  ]);
  assert.deepEqual(hit?.payload, "latest");
  assert.equal(miss, null);
});

test("a truncated batch falls back only for missing keys and an HTTP failure retries exact keys", async () => {
  for (const failing of [false, true]) {
    const fallbacks: string[] = [];
    const x = prefixFor("x");
    const pinterest = prefixFor("pinterest");
    const supabase = clientWithFetch(() => failing
      ? Response.json({ message: "Batch unavailable", code: "test_unavailable" }, { status: 400 })
      : Response.json([{ range_key: x + connectionSignature, payload: "hit", expires_at: expiresAt }], { headers: { "content-range": "0-0/3" } }));
    const batchRead = createOverviewCacheBatch({ supabase, userId, source });
    const rows = await Promise.all([x, pinterest].map((prefix) => batchRead(supabase, userId, { prefix, connectionSignature, suffix: "" }, async () => {
      fallbacks.push(prefix);
      return { payload: prefix, expires_at: expiresAt };
    })));
    assert.deepEqual(fallbacks, failing ? [x, pinterest] : [pinterest]);
    assert.deepEqual(rows.map((row) => row?.payload), [failing ? x : "hit", pinterest]);
  }
});

test("the batch is request scoped and only wired into dashboard bulk non-fresh reads", () => {
  const supabase = clientWithFetch(() => assert.fail("a mismatched scope must not query stats cache"));
  const other = clientWithFetch(() => assert.fail("a mismatched client must not query stats cache"));
  const batchRead = createOverviewCacheBatch({ supabase, userId, source });
  const key = { prefix: prefixFor("x"), connectionSignature, suffix: "" };
  const readOne = async () => assert.fail("a mismatched scope must not fall back");
  assert.throws(() => batchRead(other, userId, key, readOne), /autre requête ou un autre compte/);
  assert.throws(() => batchRead(supabase, "other-account", key, readOne), /autre requête ou un autre compte/);

  const bulk = readFileSync(new URL("../../app/api/stats/dashboard-bulk/route.ts", import.meta.url), "utf8");
  const builder = readFileSync(new URL("../../lib/stats/buildOverview.ts", import.meta.url), "utf8");
  assert.match(bulk, /readOverviewCache: createOverviewCacheBatch/);
  assert.equal(bulk.match(/\n\s*overviewContext,/g)?.length, 3);
  assert.match(builder, /if \(!fresh\)\s+try \{[\s\S]*?const batchRead = args\.overviewContext\?\.readOverviewCache;/);
});
