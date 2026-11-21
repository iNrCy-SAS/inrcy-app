import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  INR_AGENT_EDITORIAL_GENERATION_LEASE_MS,
  withInrAgentEditorialGenerationLease,
} from "../../lib/inrAgentEditorialGenerationLease.ts";

type Row = Record<string, unknown>;
function database(options: { unavailable?: boolean; omitId?: boolean } = {}) {
  const locks: Row[] = [];
  const actions: Row[] = [];
  const releases: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      let inserted: Row | null = null;
      let patch: Row | null = null;
      const equal: Record<string, unknown> = {};
      const filters: Array<(row: Row) => boolean> = [];
      const rows = table === "execution_idempotency_locks" ? locks : actions;
      const run = (single = false) => {
        if (table === "execution_idempotency_locks" && options.unavailable) return { data: null, error: { code: "42P01", message: "lease storage unavailable" } };
        if (inserted) {
          const prior = rows.find(row => row.user_id === inserted!.user_id && row.scope === inserted!.scope && row.idempotency_key === inserted!.idempotency_key);
          if (prior) return { data: [], error: null };
          const row = { ...inserted, ...(options.omitId ? {} : { id: `lease-${locks.length + 1}` }) };
          rows.push(row);
          return { data: structuredClone(single ? row : [row]), error: null };
        }
        const matching = rows.filter(row => filters.every(filter => filter(row)));
        if (patch) {
          if (patch.status === "expired") releases.push({ ...equal });
          matching.forEach(row => Object.assign(row, structuredClone(patch)));
        }
        return { data: structuredClone(single ? matching[0] ?? null : matching), error: null };
      };
      const query = {
        select() { return this; }, limit() { return this; },
        upsert(value: Row) { inserted = value; return this; },
        update(value: Row) { patch = value; return this; },
        eq(key: string, value: unknown) {
          equal[key] = value;
          filters.push(row => key === "metadata->>editorialPlan"
            ? String((row.metadata as Row | undefined)?.editorialPlan) === value
            : row[key] === value);
          return this;
        },
        in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return this; },
        lt(key: string, value: string) { filters.push(row => String(row[key]) < value); return this; },
        async maybeSingle() { return run(true); },
        then(resolve: (value: ReturnType<typeof run>) => unknown) { return Promise.resolve(run()).then(resolve); },
      };
      return query;
    },
  };
  return { client, locks, actions, releases };
}

test("activation and cron cannot prepare two slots concurrently for the same account", async () => {
  const db = database();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0;
  const first = withInrAgentEditorialGenerationLease({ supabase: db.client, userId: "account" }, async () => {
    calls++; entered(); await pending; return { status: "prepared" };
  });
  await started;
  const concurrent = await withInrAgentEditorialGenerationLease({ supabase: db.client, userId: "account" }, async () => { calls++; return { status: "prepared" }; });
  assert.equal(concurrent.status, "idle");
  assert.equal(calls, 1);
  assert.equal(db.locks[0].status, "running");
  const other = await withInrAgentEditorialGenerationLease({ supabase: db.client, userId: "other-account" }, async () => ({ status: "prepared" }));
  assert.equal(other.status, "prepared", "the lock is scoped to an account, not the whole service");
  finish(); await first;
  assert.equal(db.locks[0].status, "expired");
  const next = await withInrAgentEditorialGenerationLease({ supabase: db.client, userId: "account" }, async () => { calls++; return { status: "prepared" }; });
  assert.equal(next.status, "prepared");
  assert.equal(calls, 2, "a successful lease release permits the next cron passage");
});

test("unavailable lease storage or a claim without an id fails closed", async () => {
  for (const options of [{ unavailable: true }, { omitId: true }]) {
    const db = database(options);
    let calls = 0;
    const result = await withInrAgentEditorialGenerationLease({ supabase: db.client, userId: "account" }, async () => { calls++; return { status: "prepared" }; });
    assert.equal(result.status, "failed");
    assert.equal(calls, 0);
  }
});

test("an older executing editorial worker prevents a new generation and releases the acquired lease", async () => {
  const db = database();
  db.actions.push({ id: "legacy", user_id: "account", automation_key: "publish", status: "executing", metadata: { editorialPlan: true } });
  let calls = 0;
  const result = await withInrAgentEditorialGenerationLease({ supabase: db.client, userId: "account" }, async () => { calls++; return { status: "prepared" }; });
  assert.equal(result.status, "idle");
  assert.equal(calls, 0);
  assert.equal(db.locks[0].status, "expired");
});

test("an expired running lease is recovered with a fresh twenty-minute ownership token", async () => {
  const db = database();
  const oldLockedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  db.locks.push({ id: "existing", user_id: "account", scope: "inr_agent_editorial_generation", idempotency_key: "account", status: "running", locked_at: oldLockedAt, expires_at: new Date(Date.now() - 1_000).toISOString() });
  let recovered: Row | undefined;
  await withInrAgentEditorialGenerationLease({ supabase: db.client, userId: "account" }, async () => { recovered = { ...db.locks[0] }; return { status: "prepared" }; });
  assert.notEqual(recovered!.locked_at, oldLockedAt);
  assert.equal(Date.parse(String(recovered!.expires_at)) - Date.parse(String(recovered!.locked_at)), 20 * 60_000);
  assert.equal(db.locks[0].status, "expired");
  assert.ok(INR_AGENT_EDITORIAL_GENERATION_LEASE_MS >= 800_000);
});

test("a late generation cannot release a newer owner's lease", async () => {
  const db = database();
  const newerLockedAt = new Date(Date.now() + 1_000).toISOString();
  const newerExpiresAt = new Date(Date.now() + 21 * 60_000).toISOString();
  await withInrAgentEditorialGenerationLease({ supabase: db.client, userId: "account" }, async () => {
    Object.assign(db.locks[0], { locked_at: newerLockedAt, expires_at: newerExpiresAt });
    return { status: "prepared" };
  });
  assert.equal(db.locks[0].status, "running");
  assert.equal(db.locks[0].locked_at, newerLockedAt);
  assert.equal(db.locks[0].expires_at, newerExpiresAt);
  const release = db.releases[0];
  assert.equal(release.user_id, "account");
  assert.equal(release.status, "running");
  assert.notEqual(release.locked_at, newerLockedAt);
  assert.notEqual(release.expires_at, newerExpiresAt);
});

test("preparation errors release only the owned running lease and preserve the original error", async () => {
  const db = database();
  await assert.rejects(withInrAgentEditorialGenerationLease({ supabase: db.client, userId: "account" }, async () => { throw new Error("generation failed"); }), /generation failed/);
  assert.equal(db.locks[0].status, "expired");
  assert.equal(db.releases[0].scope, "inr_agent_editorial_generation");
  assert.equal(db.releases[0].idempotency_key, "account");
});

test("the existing coordinator keeps its action CAS inside the account lease and the cron visits pages each minute", () => {
  const source = readFileSync(new URL("../../lib/inrAgentEditorialPlanServer.ts", import.meta.url), "utf8");
  const prepare = source.slice(source.indexOf("export async function prepareNextInrAgentEditorialSlot"));
  assert.match(prepare, /return withInrAgentEditorialGenerationLease\(args, async \(\) =>/);
  assert.match(prepare, /\.eq\("id", candidate\.id\)[\s\S]*?\.eq\("user_id", args\.userId\)[\s\S]*?\.eq\("status", "draft"\)/);
  const cron = readFileSync(new URL("../../app/api/cron/inr-agent-editorial-plan/route.ts", import.meta.url), "utf8");
  assert.match(cron, /const pageIndex = Math\.floor\(now\.getTime\(\) \/ \(60 \* 1000\)\) % pageCount/);
  assert.match(cron, /tick: Math\.floor\(now\.getTime\(\) \/ \(60 \* 1000\)\)/);
  assert.match(cron, /if \(generationAttempts >= maxGenerations\) break/);
});
