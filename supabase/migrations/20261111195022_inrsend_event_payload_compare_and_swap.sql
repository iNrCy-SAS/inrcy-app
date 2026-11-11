-- Keep the expected JSON in the request body, not a potentially oversized URL.
-- This is the same atomic ownership and snapshot check used by the server.
create or replace function public.inrsend_compare_and_swap_event_payload(
  p_user_id uuid,
  p_event_id uuid,
  p_publication_id text,
  p_expected_payload jsonb,
  p_next_payload jsonb
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with changed as (
    update public.app_events
    set payload = p_next_payload
    where id = p_event_id
      and user_id = p_user_id
      and module = 'booster'
      and type = 'publish'
      and payload is not distinct from p_expected_payload
      and payload ->> 'publication_id' = p_publication_id
      and p_next_payload ->> 'publication_id' = p_publication_id
    returning id
  )
  select exists(select 1 from changed);
$$;

revoke all on function public.inrsend_compare_and_swap_event_payload(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.inrsend_compare_and_swap_event_payload(uuid, uuid, text, jsonb, jsonb) to service_role;
