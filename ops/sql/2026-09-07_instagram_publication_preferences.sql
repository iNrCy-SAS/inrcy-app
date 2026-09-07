begin;

create or replace function public.inrcy_set_instagram_publication_preferences(
  p_account_id uuid,
  p_preferences jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_root jsonb;
  v_instagram jsonb;
  v_default_mode text;
  v_result jsonb;
begin
  if (select auth.uid()) is null
    or p_account_id is null
    or not coalesce(public.inrcy_can_access_account(p_account_id), false)
  then
    raise exception using
      errcode = '42501',
      message = 'INSTAGRAM_PUBLICATION_PREFERENCES_ACCOUNT_FORBIDDEN';
  end if;

  if p_preferences is null
    or jsonb_typeof(p_preferences) <> 'object'
    or jsonb_typeof(p_preferences -> 'reelsEnabled') is distinct from 'boolean'
    or jsonb_typeof(p_preferences -> 'storiesEnabled') is distinct from 'boolean'
    or coalesce(p_preferences ->> 'defaultMode' not in ('classic', 'reel', 'story'), true)
  then
    raise exception using
      errcode = '22023',
      message = 'INSTAGRAM_PUBLICATION_PREFERENCES_INVALID';
  end if;

  v_default_mode := p_preferences ->> 'defaultMode';
  if (v_default_mode = 'reel' and not (p_preferences ->> 'reelsEnabled')::boolean)
    or (v_default_mode = 'story' and not (p_preferences ->> 'storiesEnabled')::boolean)
  then
    v_default_mode := 'classic';
  end if;

  v_result := jsonb_build_object(
    'version', 1,
    'reelsEnabled', (p_preferences ->> 'reelsEnabled')::boolean,
    'storiesEnabled', (p_preferences ->> 'storiesEnabled')::boolean,
    'defaultMode', v_default_mode
  );

  insert into public.pro_tools_configs (user_id, settings)
  values (p_account_id, '{}'::jsonb)
  on conflict (user_id) do nothing;

  select coalesce(config.settings, '{}'::jsonb)
  into v_root
  from public.pro_tools_configs as config
  where config.user_id = p_account_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'INSTAGRAM_PUBLICATION_PREFERENCES_ACCOUNT_FORBIDDEN';
  end if;

  if jsonb_typeof(v_root) <> 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'INSTAGRAM_PUBLICATION_PREFERENCES_SETTINGS_INVALID';
  end if;

  v_instagram := v_root -> 'instagram';
  if v_instagram is null or jsonb_typeof(v_instagram) = 'null' then
    v_instagram := '{}'::jsonb;
  elsif jsonb_typeof(v_instagram) <> 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'INSTAGRAM_PUBLICATION_PREFERENCES_SETTINGS_INVALID';
  end if;

  v_instagram := jsonb_set(
    v_instagram,
    '{publicationPreferences}',
    v_result,
    true
  );
  v_root := jsonb_set(v_root, '{instagram}', v_instagram, true);

  update public.pro_tools_configs as config
  set settings = v_root
  where config.user_id = p_account_id
  returning config.settings -> 'instagram' -> 'publicationPreferences'
  into v_result;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'INSTAGRAM_PUBLICATION_PREFERENCES_ACCOUNT_FORBIDDEN';
  end if;

  return v_result;
end;
$$;

comment on function public.inrcy_set_instagram_publication_preferences(uuid, jsonb)
is 'Atomically stores Instagram publication modes for an accessible active account.';

revoke all on function public.inrcy_set_instagram_publication_preferences(uuid, jsonb)
from public, anon, authenticated, service_role;

grant execute on function public.inrcy_set_instagram_publication_preferences(uuid, jsonb)
to authenticated;

commit;
