import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../../supabase/migrations/20261122005355_outlook_mail_transfer_budget.sql", import.meta.url), "utf8");
const userA = "aaaaaaaa-0000-4000-8000-000000000001";
const userB = "bbbbbbbb-0000-4000-8000-000000000002";
const account = "00000000-0000-4000-8000-000000000001";
const alias = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
const legacy = "00000000-0000-4000-8000-000000000004";
const events = "public.outlook_mail_transfer_events";
const aliases = "public.outlook_mail_transfer_aliases";
const signatures = [
  "public.reserve_outlook_mail_transfer(uuid,uuid,integer,integer)",
  "public.defer_outlook_mail_transfer(uuid,uuid,timestamptz)",
  "public.lock_outlook_mail_transfer_identity(uuid,uuid)",
];
let db: PGlite;
type Decision = { allowed: boolean; retry_at: Date | null; reason: string };
const allowed = { allowed: true, retry_at: null, reason: "reserved" };

describe("Outlook transfer reservations", () => {
  before(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.integrations(id uuid primary key,user_id uuid,provider text,category text,status text,provider_account_id text,account_email text);
      grant select on public.integrations to service_role;`);
    await db.exec(migration);
  });
  beforeEach(async () => {
    await db.exec(`reset role; truncate ${events}, ${aliases}, public.integrations;`);
    for (const [id, owner, graph, email] of [
      [account, userA, "Graph-A", "box@example.test"],
      [alias, userB, "Graph-A", "alias@example.test"],
      [other, userB, "Graph-B", "other@example.test"],
      [legacy, userA, null, "  ALIAS@example.test  "],
    ]) {
      await db.query("insert into public.integrations values ($1,$2,'microsoft','mail','connected',$3,$4)", [id, owner, graph, email]);
    }
    await db.exec("set role service_role");
  });
  after(async () => { await db.close(); });

  async function reserve(bytes: number | null, spacing: number | null = 0, id = account, user = userA) {
    const { rows } = await db.query<Decision>("select * from public.reserve_outlook_mail_transfer($1,$2,$3,$4)", [id, user, bytes, spacing]);
    assert.equal(rows.length, 1);
    return rows[0];
  }
  async function defer(date: Date | string | null, id = account, user = userA) {
    const { rows } = await db.query<{ recorded: boolean }>("select public.defer_outlook_mail_transfer($1,$2,$3) recorded", [id, user, date]);
    return rows[0].recorded;
  }

  test("overlapping requests share a decimal 100 MB allowance across connections to one Microsoft mailbox", async () => {
    const decisions = await Promise.all([reserve(60_000_000), reserve(50_000_000, 0, alias, userB)]);
    assert.equal(decisions.filter((result) => result.allowed).length, 1);
    assert.equal(decisions.find((result) => !result.allowed)?.reason, "pacing");
    const { rows } = await db.query<{ used: number }>(`select sum(payload_bytes)::integer as used from ${events}`);
    assert.ok([50_000_000, 60_000_000].includes(rows[0].used));
    assert.deepEqual(await reserve(100_000_000 - rows[0].used, 0, legacy), allowed);
    assert.equal((await reserve(1)).reason, "pacing");
    assert.deepEqual(await reserve(100_000_000, 0, other, userB), allowed);
  });

  test("Graph user ids are opaque, so two differently cased ids keep separate budgets", async () => {
    await db.exec(`reset role; update public.integrations set provider_account_id='graph-a' where id='${other}'; set role service_role`);
    assert.deepEqual(await reserve(100_000_000), allowed);
    assert.deepEqual(await reserve(100_000_000, 0, other, userB), allowed);
  });

  test("a rolling five-minute window retries at the first expiry that frees enough bytes", async () => {
    for (const bytes of [20_000_000, 35_000_000, 45_000_000]) assert.deepEqual(await reserve(bytes), allowed);
    const { rows } = await db.query<{ payload_bytes: number; expires_at: Date }>(`update ${events}
      set reserved_at=statement_timestamp()-case payload_bytes when 20000000 then interval '4 minutes'
        when 35000000 then interval '2 minutes' else interval '1 minute' end,
      expires_at=statement_timestamp()+case payload_bytes when 20000000 then interval '1 minute'
        when 35000000 then interval '3 minutes' else interval '4 minutes' end returning payload_bytes,expires_at`);
    for (const [requested, expiresWith] of [[1, 20_000_000], [55_000_000, 35_000_000], [55_000_001, 45_000_000]]) {
      const result = await reserve(requested);
      assert.equal(result.reason, "pacing");
      assert.equal(result.retry_at?.getTime(), rows.find((row) => row.payload_bytes === expiresWith)?.expires_at.getTime());
    }
    await db.exec(`update ${events} set reserved_at=statement_timestamp()-interval '5 minutes',expires_at=statement_timestamp() where payload_bytes=20000000`);
    assert.deepEqual(await reserve(20_000_000), allowed);
    assert.equal((await reserve(1)).reason, "pacing");
  });

  test("campaign cadence protects both the previous and the next transfer, even across intervening direct sends", async () => {
    assert.deepEqual(await reserve(100, 75_000), allowed);
    await db.exec(`update ${events} set reserved_at=statement_timestamp()-interval '25 seconds',expires_at=statement_timestamp()+interval '275 seconds'`);
    assert.deepEqual(await reserve(20, 0, alias, userB), allowed);
    const previous = await db.query<{ until: Date }>(`select reserved_at + interval '75 seconds' as until from ${events} where payload_bytes=100`);
    const next = await db.query<{ until: Date }>(`select max(reserved_at) + interval '90 seconds' as until from ${events}`);
    assert.equal((await reserve(1, 8_000)).retry_at?.getTime(), previous.rows[0].until.getTime());
    assert.equal((await reserve(1, 90_000)).retry_at?.getTime(), next.rows[0].until.getTime());
    assert.deepEqual(await reserve(1, 8_000, other, userB), allowed);
  });

  test("real provider cooldowns cover every alias and direct send, retain the longest deadline, and expire", async () => {
    const long = new Date(Date.now() + 20 * 60_000);
    assert.deepEqual(await reserve(100_000_000), allowed);
    assert.equal(await defer(new Date(Date.now() + 20_000)), true);
    const firstRetry = await reserve(1);
    assert.equal(firstRetry.reason, "provider_cooldown");
    assert.ok(firstRetry.retry_at && firstRetry.retry_at.getTime() > Date.now() + 4 * 60_000);
    assert.equal(await defer(long, alias, userB), true);
    assert.equal(await defer(new Date(Date.now() + 80_000), legacy), true);
    for (const distance of [0, 8_000]) {
      const result = await reserve(1, distance);
      assert.equal(result.reason, "provider_cooldown");
      assert.equal(result.retry_at?.getTime(), long.getTime());
    }
    assert.deepEqual(await reserve(1, 0, other, userB), allowed);
    await db.exec(`update ${events} set expires_at=clock_timestamp() where payload_bytes=0`);
    assert.equal((await reserve(1)).reason, "pacing");
    await db.exec(`update ${events} set expires_at=clock_timestamp()`);
    assert.deepEqual(await reserve(1), allowed);
  });

  test("legacy email-only reservations and cooldowns survive reconnection with a Graph id and changes of address", async () => {
    await db.exec(`reset role; update public.integrations set provider_account_id=null where id='${alias}'; set role service_role`);
    assert.deepEqual(await reserve(70_000_000, 0, legacy), allowed);
    const retry = new Date(Date.now() + 6 * 60_000);
    assert.equal(await defer(retry, legacy), true);
    await db.exec(`reset role; update public.integrations set provider_account_id='Graph-A' where id='${alias}'; set role service_role`);
    // The first request after linking the legacy address arrives through an
    // already-connected, differently named alias of the same Graph mailbox.
    assert.equal((await reserve(40_000_000)).retry_at?.getTime(), retry.getTime());
    assert.equal((await reserve(40_000_000, 0, alias, userB)).retry_at?.getTime(), retry.getTime());
    await db.exec(`reset role; update public.integrations set account_email='new@example.test' where id='${alias}'; set role service_role`);
    await db.exec(`update ${events} set expires_at=clock_timestamp() where payload_bytes=0`);
    assert.equal((await reserve(40_000_000, 0, legacy)).reason, "pacing");
    assert.deepEqual(await reserve(30_000_000, 0, alias, userB), allowed);
  });

  test("invalid payloads, stale cooldowns and foreign, disconnected or non-Microsoft integrations leave no reservations", async () => {
    for (const bytes of [null, -1, 0, 100_000_001]) assert.deepEqual(await reserve(bytes), { allowed: false, retry_at: null, reason: "invalid_payload" });
    for (const ms of [null, -1, 300_001]) assert.equal((await reserve(1, ms)).reason, "invalid_payload");
    for (const date of [null, "infinity", new Date(0)]) assert.equal(await defer(date), false);
    assert.equal((await reserve(1, 0, account, userB)).reason, "unknown_mailbox");
    assert.equal(await defer(new Date(Date.now() + 100_000), account, userB), false);
    for (const patch of ["category='social'", "category='mail',provider='gmail'", "provider='microsoft',status='disconnected'", "status='connected',provider_account_id=null,account_email='  '"]) {
      await db.exec(`reset role; update public.integrations set ${patch} where id='${account}'; set role service_role`);
      assert.equal((await reserve(1)).reason, "unknown_mailbox");
    }
    const { rows } = await db.query<{ count: number }>(`select count(*)::integer as count from ${events}`);
    assert.equal(rows[0].count, 0);
  });

  test("private invoker RPCs and RLS-protected tables cannot be used from browser roles", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const signature of signatures) {
        const { rows } = await db.query<{ can_call: boolean; prosecdef: boolean }>(
          "select has_function_privilege($1,$2,'execute') as can_call,prosecdef from pg_proc where oid=$2::regprocedure", [role, signature]);
        assert.equal(rows[0].can_call, role === "service_role");
        assert.equal(rows[0].prosecdef, false);
      }
      for (const table of [events, aliases]) {
        const { rows } = await db.query<{ has_access: boolean; relrowsecurity: boolean }>(
          "select has_table_privilege($1,$2,'select,insert,update,delete') as has_access,relrowsecurity from pg_class where oid=$2::regclass", [role, table]);
        assert.equal(rows[0].has_access, role === "service_role");
        assert.equal(rows[0].relrowsecurity, true);
      }
    }
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(reserve(1), /permission denied for function/);
      await assert.rejects(defer(new Date(Date.now() + 60_000)), /permission denied for function/);
    }
  });
});
