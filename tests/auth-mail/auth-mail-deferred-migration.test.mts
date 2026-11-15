import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read = (file: string) => readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
const migration = read("20261115175646_auth_mail_deferred_quota_retry.sql");
const userId = "10000000-0000-4000-8000-000000000001";
const deliveryKey = `v1:${"b".repeat(64)}`;

test("the actual auth deferral migration keeps known rejections retryable and service-only", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role; create role supabase_auth_admin; create schema auth; create table auth.users(id uuid primary key);");
    await db.exec(read("20260914221305_auth_email_delivery_tracking.sql"));
    const welcome = read("20261026091546_temporary_signup_passwords.sql");
    await db.exec(welcome.slice(welcome.indexOf("create table if not exists public.signup_welcome_credentials"), welcome.indexOf("create schema if not exists inrcy_signup_private")));
    await db.exec(migration);
    await db.exec(migration); // Deployment replay must remain idempotent.
    const reserve = () => db.query<{ status: string; send_attempt_count: number; retry_at: string | null }>(
      "select * from public.reserve_auth_email_delivery($1,'hook-local',0::smallint,$2::uuid,'synthetic@example.test','signup')", [deliveryKey, userId],
    );
    await reserve();
    await db.query("select * from public.defer_auth_email_delivery($1,'daily_quota_exceeded','Safe quota diagnosis',now()+interval '1 hour')", [deliveryKey]);
    const beforeDue = (await reserve()).rows[0];
    assert.equal(beforeDue.status, "deferred"); assert.equal(beforeDue.send_attempt_count, 1);
    await db.query("update public.auth_email_deliveries set last_send_attempt_at=now()-interval '20 minutes' where delivery_key=$1", [deliveryKey]);
    assert.equal((await db.query("select * from public.claim_auth_email_delivery_alerts()" )).rows.length, 0);
    assert.equal((await db.query<{ status: string }>("select status from public.auth_email_deliveries where delivery_key=$1", [deliveryKey])).rows[0].status, "deferred", "stale-pending reconciliation must not reinterpret a confirmed rejection as uncertainty");
    await db.query("update public.auth_email_deliveries set retry_at=now()-interval '1 second' where delivery_key=$1", [deliveryKey]);
    const due = (await reserve()).rows[0];
    assert.equal(due.status, "pending"); assert.equal(due.retry_at, null); assert.equal(due.send_attempt_count, 2);
    await db.query("select * from public.accept_auth_email_delivery($1,'provider-local-accepted')", [deliveryKey]);
    const afterAcceptance = await db.query<{ status: string }>("select * from public.defer_auth_email_delivery($1,'daily_quota_exceeded','Late refusal',now()+interval '1 hour')", [deliveryKey]);
    assert.equal(afterAcceptance.rows[0].status, "accepted", "a late rejection cannot overwrite provider acceptance");
    const privileges = (await db.query<{ anon_can_defer: boolean; authenticated_can_defer: boolean; service_can_defer: boolean; rls_enabled: boolean }>(
      "select has_function_privilege('anon','public.defer_auth_email_delivery(text,text,text,timestamptz)','execute') as anon_can_defer, has_function_privilege('authenticated','public.defer_auth_email_delivery(text,text,text,timestamptz)','execute') as authenticated_can_defer, has_function_privilege('service_role','public.defer_auth_email_delivery(text,text,text,timestamptz)','execute') as service_can_defer, (select relrowsecurity from pg_class where oid='public.auth_email_deliveries'::regclass) as rls_enabled",
    )).rows[0];
    assert.deepEqual(privileges, { anon_can_defer: false, authenticated_can_defer: false, service_can_defer: true, rls_enabled: true });
    const unknownKey = `v1:${"c".repeat(64)}`;
    await db.query("select * from public.reserve_auth_email_delivery($1,'hook-unknown',0::smallint,$2::uuid,'synthetic@example.test','signup')", [unknownKey, userId]);
    await db.query("update public.auth_email_deliveries set last_send_attempt_at=now()-interval '20 minutes' where delivery_key=$1", [unknownKey]);
    assert.equal((await db.query("select * from public.claim_auth_email_delivery_alerts()" )).rows.length, 1);
    assert.equal((await db.query<{ status: string }>("select status from public.auth_email_deliveries where delivery_key=$1", [unknownKey])).rows[0].status, "acceptance_uncertain", "the existing ambiguous-send guard must remain active for genuinely pending work");

    await db.query("insert into auth.users(id) values ($1)", [userId]);
    await db.query("insert into public.signup_welcome_credentials(id,user_id,recipient_email,app_language,encrypted_password,expires_at,ready_at,retry_at) values ($1,$1,'synthetic@example.test','fr',$2,now()+interval '30 days',now(),now()+interval '1 hour')", [userId, "x".repeat(80)]);
    assert.equal((await db.query("select * from public.claim_signup_welcome_credentials(10)" )).rows.length, 0);
    await db.query("update public.signup_welcome_credentials set retry_at=now()-interval '1 second'");
    assert.equal((await db.query("select * from public.claim_signup_welcome_credentials(10)" )).rows.length, 1);
    assert.equal((await db.query("select * from public.claim_signup_welcome_credentials(10)" )).rows.length, 0, "the existing durable lease still excludes another worker");
    await db.query("update public.signup_welcome_credentials set lease_until=null,created_at=now()-interval '1 day',expires_at=now()-interval '1 second'");
    assert.equal((await db.query("select * from public.claim_signup_welcome_credentials(10)" )).rows.length, 0, "a deferred credential cannot outlive its existing expiry");
    assert.doesNotMatch(migration, /\bsecurity\s+definer\b|add\s+column[^;]*\b(?:token_hash|raw_payload|password)\b/i);
  } finally { await db.close(); }
});
