import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);

/** Real existing Agent DDL/RPCs in an isolated PostgreSQL WASM database. */
export async function createInrAgentAdminDatabase() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table public.profiles(user_id uuid primary key references auth.users(id),role text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.auth_user',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated,service_role;
    `);
    for (const file of [
      'ops/SUPABASE_INR_AGENT_V2.sql',
      'ops/SUPABASE_INR_AGENT_SCHEDULED_ACTIONS.sql',
      'ops/sql/2026-09-02_inr_agent_extended_publication_frequencies.sql',
      'ops/sql/2026-09-04_inr_agent_safe_editorial_workflow.sql',
      'ops/sql/2026-09-11_inr_agent_editorial_validation_deadline.sql',
    ]) {
      // gen_random_uuid is built into this PostgreSQL version; PGlite does not
      // need the unrelated pgcrypto extension requested by the old bootstrap.
      const source = (await readFile(new URL(file, root), 'utf8')).replaceAll('create extension if not exists pgcrypto;', '');
      await db.exec(source);
    }
    await db.exec(`
      grant select,insert,update,delete on public.inr_agent_settings,public.inr_agent_automation_settings,
        public.inr_agent_actions,public.inr_agent_scheduled_actions to service_role;
      grant select on public.inr_agent_settings,public.inr_agent_automation_settings,
        public.inr_agent_actions,public.inr_agent_scheduled_actions to authenticated;
    `);
    return db;
  } catch (error) { await db.close(); throw error; }
}
