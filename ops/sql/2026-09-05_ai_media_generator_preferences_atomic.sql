begin;

-- Patch one allow-listed media-generator block while holding the account row
-- lock. This preserves every unrelated pro_tools_configs.settings key and
-- serializes concurrent saves for the same active account.
create or replace function public.inrcy_patch_ai_media_generator_preferences(
  p_account_id uuid,
  p_block_id integer,
  p_saved boolean,
  p_defaults jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_supported_version constant integer := 1;
  v_root_settings jsonb;
  v_namespace jsonb;
  v_blocks jsonb;
  v_defaults jsonb := '{}'::jsonb;
  v_stored_version integer := 0;
  v_result jsonb;
begin
  if (select auth.uid()) is null
    or p_account_id is null
    or not coalesce(public.inrcy_can_access_account(p_account_id), false)
  then
    raise exception using
      errcode = '42501',
      message = 'AI_MEDIA_PREFERENCES_ACCOUNT_FORBIDDEN';
  end if;

  if p_block_id is null
    or p_block_id < 1
    or p_block_id > 6
    or p_saved is null
  then
    raise exception using
      errcode = '22023',
      message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
  end if;

  if p_saved then
    if p_defaults is null or jsonb_typeof(p_defaults) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
    end if;

    case p_block_id
      when 1 then
        if coalesce(p_defaults ->> 'kind' not in ('image', 'video'), true)
          or coalesce(
            p_defaults ->> 'subjectSource' not in ('profile', 'publication'),
            true
          )
        then
          raise exception using
            errcode = '22023',
            message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
        end if;
        v_defaults := jsonb_build_object(
          'kind', p_defaults ->> 'kind',
          'subjectSource', p_defaults ->> 'subjectSource'
        );

      when 2 then
        if coalesce(
          p_defaults ->> 'typology' not in (
            'company',
            'service',
            'advice',
            'showcase',
            'offer',
            'event',
            'behind_scenes',
            'recruitment'
          ),
          true
        )
          or coalesce(
            p_defaults ->> 'format' not in (
              'square',
              'portrait',
              'story',
              'landscape'
            ),
            true
          )
        then
          raise exception using
            errcode = '22023',
            message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
        end if;
        v_defaults := jsonb_build_object(
          'typology', p_defaults ->> 'typology',
          'format', p_defaults ->> 'format'
        );

      when 3 then
        if coalesce(
          p_defaults ->> 'visualStyle' not in (
            'brand',
            'clean',
            'premium',
            'warm',
            'dynamic',
            'expert',
            'local',
            'colorful'
          ),
          true
        )
          or coalesce(
            p_defaults ->> 'creativity' not in ('faithful', 'bold'),
            true
          )
          or jsonb_typeof(p_defaults -> 'useBrandColors') is distinct from 'boolean'
          or coalesce(
            p_defaults ->> 'logoMode' not in ('discreet', 'visible', 'none'),
            true
          )
        then
          raise exception using
            errcode = '22023',
            message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
        end if;
        v_defaults := jsonb_build_object(
          'visualStyle', p_defaults ->> 'visualStyle',
          'creativity', p_defaults ->> 'creativity',
          'useBrandColors', (p_defaults ->> 'useBrandColors')::boolean,
          'logoMode', p_defaults ->> 'logoMode'
        );

      when 4 then
        if coalesce(
          p_defaults ->> 'imageStyle' not in (
            'photo',
            'illustration',
            'three_d',
            'graphic'
          ),
          true
        )
          or coalesce(
            p_defaults ->> 'shotType' not in ('auto', 'close', 'medium', 'wide'),
            true
          )
        then
          raise exception using
            errcode = '22023',
            message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
        end if;
        v_defaults := jsonb_build_object(
          'imageStyle', p_defaults ->> 'imageStyle',
          'shotType', p_defaults ->> 'shotType'
        );

      when 5 then
        if coalesce(
          p_defaults ->> 'peopleMode' not in ('auto', 'none', 'solo', 'team'),
          true
        )
          or coalesce(
            p_defaults ->> 'identityMode' not in (
              'auto',
              'professional',
              'brand_avatar',
              'reference_team'
            ),
            true
          )
        then
          raise exception using
            errcode = '22023',
            message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
        end if;
        v_defaults := jsonb_build_object(
          'peopleMode', case
            when p_defaults ->> 'identityMode' = 'reference_team' then 'team'
            else p_defaults ->> 'peopleMode'
          end,
          'identityMode', p_defaults ->> 'identityMode'
        );

      when 6 then
        if jsonb_typeof(p_defaults -> 'durationSeconds') is distinct from 'number'
          or coalesce(p_defaults ->> 'durationSeconds' not in ('8', '16', '24'), true)
          or jsonb_typeof(p_defaults -> 'withText') is distinct from 'boolean'
          or jsonb_typeof(p_defaults -> 'withMusic') is distinct from 'boolean'
          or jsonb_typeof(p_defaults -> 'withNarration') is distinct from 'boolean'
          or coalesce(
            p_defaults ->> 'narrationVoice' not in ('female', 'male'),
            true
          )
        then
          raise exception using
            errcode = '22023',
            message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
        end if;
        v_defaults := jsonb_build_object(
          'durationSeconds', (p_defaults ->> 'durationSeconds')::integer,
          'withText', (p_defaults ->> 'withText')::boolean,
          'withMusic', (p_defaults ->> 'withMusic')::boolean,
          'withNarration', (p_defaults ->> 'withNarration')::boolean,
          'narrationVoice', p_defaults ->> 'narrationVoice'
        );
    end case;
  end if;

  -- Ensure the row exists. RLS and the explicit membership check above both
  -- apply. ON CONFLICT handles two first saves racing for the same account.
  insert into public.pro_tools_configs (user_id, settings)
  values (p_account_id, '{}'::jsonb)
  on conflict (user_id) do nothing;

  select coalesce(config.settings, '{}'::jsonb)
  into v_root_settings
  from public.pro_tools_configs as config
  where config.user_id = p_account_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'AI_MEDIA_PREFERENCES_ACCOUNT_FORBIDDEN';
  end if;

  -- Fail closed rather than replacing malformed legacy data.
  if jsonb_typeof(v_root_settings) <> 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_MEDIA_PREFERENCES_SETTINGS_INVALID';
  end if;

  v_namespace := v_root_settings -> 'ai_media_generator';
  if v_namespace is null or jsonb_typeof(v_namespace) = 'null' then
    v_namespace := '{}'::jsonb;
  elsif jsonb_typeof(v_namespace) <> 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_MEDIA_PREFERENCES_SETTINGS_INVALID';
  end if;

  if v_namespace ? 'version' then
    if jsonb_typeof(v_namespace -> 'version') <> 'number'
      or (v_namespace ->> 'version') !~ '^[0-9]+$'
    then
      raise exception using
        errcode = 'P0001',
        message = 'AI_MEDIA_PREFERENCES_SETTINGS_INVALID';
    end if;
    v_stored_version := (v_namespace ->> 'version')::integer;
    if v_stored_version > v_supported_version then
      raise exception using
        errcode = 'P0001',
        message = 'AI_MEDIA_PREFERENCES_VERSION_UNSUPPORTED';
    end if;
  end if;

  v_blocks := v_namespace -> 'blocks';
  if v_blocks is null or jsonb_typeof(v_blocks) = 'null' then
    v_blocks := '{}'::jsonb;
  elsif jsonb_typeof(v_blocks) <> 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_MEDIA_PREFERENCES_SETTINGS_INVALID';
  end if;

  if p_saved then
    v_blocks := jsonb_set(
      v_blocks,
      array[p_block_id::text],
      jsonb_build_object('saved', true, 'defaults', v_defaults),
      true
    );
  else
    v_blocks := v_blocks - p_block_id::text;
  end if;

  -- Keep unknown v1 namespace keys for forward-compatible additive changes,
  -- while updating only the requested block.
  v_namespace := jsonb_set(
    jsonb_set(
      v_namespace,
      '{version}',
      to_jsonb(v_supported_version),
      true
    ),
    '{blocks}',
    v_blocks,
    true
  );
  v_root_settings := jsonb_set(
    v_root_settings,
    '{ai_media_generator}',
    v_namespace,
    true
  );

  update public.pro_tools_configs as config
  set settings = v_root_settings
  where config.user_id = p_account_id
  returning config.settings -> 'ai_media_generator' into v_result;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'AI_MEDIA_PREFERENCES_ACCOUNT_FORBIDDEN';
  end if;

  return v_result;
end;
$$;

comment on function public.inrcy_patch_ai_media_generator_preferences(
  uuid,
  integer,
  boolean,
  jsonb
) is
  'Atomically patches one allow-listed AI media preference block for an accessible account.';

revoke all on function public.inrcy_patch_ai_media_generator_preferences(
  uuid,
  integer,
  boolean,
  jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.inrcy_patch_ai_media_generator_preferences(
  uuid,
  integer,
  boolean,
  jsonb
) to authenticated;

commit;
