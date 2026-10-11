import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
export async function createMediaCreditDatabase() {
  const db = new PGlite();
  try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.inrcy_accounts(id uuid primary key,created_at timestamptz not null default now());
    create table public.inrcy_account_members(account_id uuid,auth_user_id uuid,role text not null default 'owner',primary key(account_id,auth_user_id));
    create table public.subscriptions(user_id uuid primary key,start_date date,status text not null default 'active');
    create table public.pro_media_library(id uuid primary key,user_id uuid,account_id uuid,client_media_key text,media_type text,source text,
      upload_protocol text,upload_status text,is_active boolean default true,media_metadata jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.auth_user',true),'')::uuid $$;
    create function public.inrcy_can_access_account(uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.inrcy_account_members where account_id=$1 and auth_user_id=auth.uid()) $$;
    create function public.inrcy_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
    grant usage on schema auth to service_role,authenticated;
    grant select on public.inrcy_account_members,public.subscriptions to service_role;
  `);
  const migrations = [
    'ops/sql/2026-08-31_ai_media_generation_quota.sql',
    'ops/sql/2026-09-02_ai_media_account_limits_20_5_30_6.sql',
    'ops/sql/2026-09-02_ai_media_video_durations_8_16_24.sql',
    'supabase/migrations/20260914183000_ai_media_quota_rollover.sql',
    'supabase/migrations/20260914184500_ai_media_quota_rollover_subscription_anchor.sql',
    'supabase/migrations/20260922164725_ai_media_video_seconds_quota.sql',
    'supabase/migrations/20260930151303_ai_media_image_limits_25_50.sql',
    'supabase/migrations/20261003163341_ai_media_premium_video_196_seconds.sql',
    'supabase/migrations/20261003165614_ai_media_premium_images_70_rollover_150.sql',
    'supabase/migrations/20261011121940_video_credit_recharges.sql',
    'supabase/migrations/20261011171132_image_credit_recharges.sql',
  ];
  for (const file of migrations) {
    try { await db.exec((await readFile(new URL(file, root),'utf8')).replaceAll('\r\n','\n')); }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`, { cause: error }); }
  }

    return db;
  } catch (error) { await db.close(); throw error; }
}
