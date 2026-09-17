-- iNrCy — protège l'écriture des notifications contre les comptes supprimés.
-- Un destinataire absent est ignoré proprement au lieu de générer une erreur
-- 23503 / REST 409 à chaque nouvelle exécution du cron.

begin;

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
  v_recipient_id uuid := nullif(p_notification ->> 'user_id', '')::uuid;
  v_inserted public.notifications%rowtype;
begin
  if v_recipient_id is null then
    return null;
  end if;

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
  select
    v_recipient_id,
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
  from public.inrcy_accounts as recipient
  where recipient.id = v_recipient_id
  on conflict do nothing
  returning * into v_inserted;

  if v_inserted.id is null then
    return null;
  end if;
  return to_jsonb(v_inserted);
exception
  when foreign_key_violation then
    -- Le compte a pu être supprimé entre la vérification et l'insertion.
    return null;
end;
$$;

revoke all on function public.inrcy_insert_notification_once(jsonb)
  from public, anon, authenticated;
grant execute on function public.inrcy_insert_notification_once(jsonb)
  to service_role;

commit;
