begin;

-- Additive v2 wrapper: keep the already deployed v1 RPC untouched for older
-- clients, then enrich only block 5 with the allow-listed teamVideoMode and
-- teamVideoSpeechMode keys.
-- The original function owns account authorization, row creation, version
-- checks and row locking; this wrapper runs in the same transaction.
create or replace function public.inrcy_patch_ai_media_generator_preferences_v2(
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
  v_team_video_mode text := 'montage';
  v_team_video_speech_mode text := 'voiceover';
  v_v1_defaults jsonb := p_defaults;
  v_result jsonb;
begin
  if p_block_id = 5 and p_saved then
    if p_defaults is null or jsonb_typeof(p_defaults) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
    end if;

    v_team_video_mode := coalesce(p_defaults ->> 'teamVideoMode', 'montage');
    if v_team_video_mode not in ('cinematic', 'montage') then
      raise exception using
        errcode = '22023',
        message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
    end if;

    v_team_video_speech_mode := coalesce(
      p_defaults ->> 'teamVideoSpeechMode',
      'voiceover'
    );
    if v_team_video_speech_mode not in ('voiceover', 'characters') then
      raise exception using
        errcode = '22023',
        message = 'AI_MEDIA_PREFERENCES_INVALID_PATCH';
    end if;

    -- Forward only the v1 allow-list. In particular, a caller can never store
    -- photos, free text, identity consent or the one-shot Veo consent here.
    v_v1_defaults := jsonb_build_object(
      'peopleMode', p_defaults ->> 'peopleMode',
      'identityMode', p_defaults ->> 'identityMode'
    );
  end if;

  v_result := public.inrcy_patch_ai_media_generator_preferences(
    p_account_id,
    p_block_id,
    p_saved,
    v_v1_defaults
  );

  if p_block_id = 5 and p_saved then
    update public.pro_tools_configs as config
    set settings = jsonb_set(
      jsonb_set(
        config.settings,
        '{ai_media_generator,blocks,5,defaults,teamVideoMode}',
        to_jsonb(v_team_video_mode),
        true
      ),
      '{ai_media_generator,blocks,5,defaults,teamVideoSpeechMode}',
      to_jsonb(v_team_video_speech_mode),
      true
    )
    where config.user_id = p_account_id
    returning config.settings -> 'ai_media_generator' into v_result;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'AI_MEDIA_PREFERENCES_ACCOUNT_FORBIDDEN';
    end if;
  end if;

  return v_result;
end;
$$;

comment on function public.inrcy_patch_ai_media_generator_preferences_v2(
  uuid,
  integer,
  boolean,
  jsonb
) is
  'Atomically patches one allow-listed AI media preference block and persists optional team video and speech modes.';

revoke all on function public.inrcy_patch_ai_media_generator_preferences_v2(
  uuid,
  integer,
  boolean,
  jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.inrcy_patch_ai_media_generator_preferences_v2(
  uuid,
  integer,
  boolean,
  jsonb
) to authenticated;

commit;
