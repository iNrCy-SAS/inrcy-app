import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../../supabase/migrations/20261111195022_inrsend_event_payload_compare_and_swap.sql", import.meta.url), "utf8");
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const eventId = "00000000-0000-4000-8000-000000000003";
const original = { publication_id: "publication", post: { content: "Esthétique, soins du visage. ".repeat(1300) }, results: { facebook: { external_id: "post" } } };
const next = { ...original, post: { content: "Contenu modifié" } };

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.app_events(id uuid primary key,user_id uuid,module text,type text,payload jsonb);
    alter table public.app_events enable row level security;
    grant select,update on public.app_events to service_role;`);
  await db.query("insert into public.app_events values ($1,$2,'booster','publish',$3)", [eventId, owner, original]);
  await db.exec(migration);
  return db;
}

async function save(db: PGlite, userId = owner, expected: unknown = original, replacement: unknown = next, publicationId = "publication") {
  const result = await db.query<{ saved: boolean }>("select public.inrsend_compare_and_swap_event_payload($1,$2,$3,$4,$5) as saved", [userId,eventId,publicationId,expected,replacement]);
  return result.rows[0].saved;
}

test("large publication snapshots save atomically through body parameters and reject a stale retry", async () => {
  const db = await fixture();
  try {
    assert.ok(Buffer.byteLength(JSON.stringify(original)) > 27000);
    await db.exec("set role service_role");
    assert.equal(await save(db), true);
    assert.equal(await save(db), false);
    const result = await db.query<{payload: unknown}>("select payload from public.app_events where id=$1", [eventId]);
    assert.deepEqual(result.rows[0].payload, next);
  } finally { await db.close(); }
});

test("snapshot persistence rejects another owner, publication, module, type, or changed payload", async () => {
  const db = await fixture();
  try {
    assert.equal(await save(db, other), false);
    assert.equal(await save(db, owner, { ...original, changed: true }), false);
    assert.equal(await save(db, owner, original, next, "other-publication"), false);
    assert.equal(await save(db, owner, original, { ...next, publication_id: "other-publication" }), false);
    for (const field of ["module", "type"]) {
      await db.exec(`update public.app_events set ${field}='other'`);
      assert.equal(await save(db), false);
      await db.exec(`update public.app_events set ${field}='${field === "module" ? "booster" : "publish"}'`);
    }
    const result = await db.query<{payload: unknown}>("select payload from public.app_events where id=$1", [eventId]);
    assert.deepEqual(result.rows[0].payload, original);
  } finally { await db.close(); }
});

test("the RPC keeps invoker rights and is executable only by the existing service role", async () => {
  const db = await fixture();
  try {
    const signature = "public.inrsend_compare_and_swap_event_payload(uuid,uuid,text,jsonb,jsonb)";
    for (const role of ["anon", "authenticated", "service_role"]) {
      const result = await db.query<{allowed: boolean}>("select has_function_privilege($1,$2,'execute') as allowed", [role, signature]);
      assert.equal(result.rows[0].allowed, role === "service_role");
    }
    const config = await db.query<{prosecdef: boolean}>("select prosecdef from pg_proc where oid=$1::regprocedure", [signature]);
    assert.equal(config.rows[0].prosecdef, false);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(save(db), /permission denied for function/);
      await db.exec("reset role");
    }
  } finally { await db.close(); }
});
