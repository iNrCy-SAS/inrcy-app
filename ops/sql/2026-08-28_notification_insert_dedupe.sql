-- iNrCy — insertion atomique des notifications dédupliquées
-- Supprime les 23505 / REST 409 attendus lors d'un retry de cron ou d'API.

begin;

do $$
begin
  if to_regclass('public.notifications') is null then
    raise exception 'public.notifications is missing';
  end if;
end;
$$;

create or replace function public.inrcy_insert_notification_once(
  p_notification jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_inserted public.notifications%rowtype;
begin
  insert into public.notifications (
    user_id,
    category,
    kind,
    title,
    body,
    cta_label,
    cta_url,
    read_at,
    meta,
    dedupe_key
  )
  values (
    nullif(p_notification ->> 'user_id', '')::uuid,
    p_notification ->> 'category',
    p_notification ->> 'kind',
    p_notification ->> 'title',
    p_notification ->> 'body',
    nullif(p_notification ->> 'cta_label', ''),
    nullif(p_notification ->> 'cta_url', ''),
    nullif(p_notification ->> 'read_at', '')::timestamptz,
    case
      when jsonb_typeof(p_notification -> 'meta') = 'object'
        then p_notification -> 'meta'
      else '{}'::jsonb
    end,
    nullif(p_notification ->> 'dedupe_key', '')
  )
  on conflict do nothing
  returning * into v_inserted;

  if v_inserted.id is null then
    return null;
  end if;
  return to_jsonb(v_inserted);
end;
$$;

revoke all on function public.inrcy_insert_notification_once(jsonb)
  from public, anon, authenticated;
grant execute on function public.inrcy_insert_notification_once(jsonb)
  to service_role;

commit;
