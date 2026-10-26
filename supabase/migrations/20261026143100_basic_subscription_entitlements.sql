-- Add Basique without rewriting any existing subscription, balance or order.
begin;

alter table public.subscriptions drop constraint if exists subscriptions_app_edition_check;
alter table public.subscriptions add constraint subscriptions_app_edition_check
  check (app_edition in ('basic', 'standard', 'premium', 'founder'));

-- Retain the established trigger, including all legacy mappings and Trial rights.
do $$
declare source text;
begin
  source := pg_get_functiondef('public.sync_subscription_app_edition_from_plan()'::regprocedure);
  if position('when ''Basic'' then ''basic''' in source) = 0 then
    if position('when ''Trial'' then ''standard''' in source) = 0
       or position('when ''Standard'' then ''standard''' in source) = 0 then
      raise exception 'BASIC_SUBSCRIPTION_TRIGGER_SOURCE_CHANGED';
    end if;
    execute replace(source, 'when ''Standard'' then ''standard''',
      'when ''Basic'' then ''basic'' when ''Standard'' then ''standard''');
  end if;
end $$;

alter table public.ai_media_plan_limits drop constraint ai_media_plan_limits_edition_check;
alter table public.ai_media_plan_limits add constraint ai_media_plan_limits_edition_check
  check (edition in ('basic', 'standard', 'premium', 'founder'));
alter table public.ai_media_plan_limits drop constraint ai_media_plan_limits_image_check;
alter table public.ai_media_plan_limits add constraint ai_media_plan_limits_image_check
  check ((edition = 'basic' and image_monthly_limit = 0)
    or (edition <> 'basic' and image_monthly_limit between 1 and 10000));
alter table public.ai_media_plan_limits drop constraint ai_media_plan_limits_video_check;
alter table public.ai_media_plan_limits add constraint ai_media_plan_limits_video_check
  check ((edition = 'basic' and video_monthly_limit = 0)
    or (edition <> 'basic' and video_monthly_limit between 1 and 10000));
alter table public.ai_media_generation_jobs drop constraint ai_media_generation_jobs_edition_check;
alter table public.ai_media_generation_jobs add constraint ai_media_generation_jobs_edition_check
  check (edition in ('basic', 'standard', 'premium', 'founder'));

insert into public.ai_media_plan_limits(edition,image_monthly_limit,video_monthly_limit,studio_enabled,video_max_duration_seconds)
values ('basic',0,0,true,30)
on conflict (edition) do update set image_monthly_limit=0,video_monthly_limit=0,
  studio_enabled=true,video_max_duration_seconds=30,updated_at=now();

alter table public.business_dna_analysis_plan_limits drop constraint business_dna_analysis_plan_limits_edition_check;
alter table public.business_dna_analysis_plan_limits add constraint business_dna_analysis_plan_limits_edition_check
  check (edition in ('basic','standard','premium','founder','admin'));
insert into public.business_dna_analysis_plan_limits(edition,monthly_limit) values ('basic',3)
on conflict (edition) do nothing;

create or replace function public.ai_media_credit_plan(p_account_id uuid,p_edition text)
returns table(base_limit integer,rollover_cap integer,studio_enabled boolean)
language plpgsql stable security invoker set search_path='' as $$
declare v_plan public.ai_media_plan_limits%rowtype; v_overrides public.ai_media_account_limits%rowtype; v_image integer; v_video integer;
begin
  select * into v_plan from public.ai_media_plan_limits where edition=p_edition;
  if not found then raise exception 'AI_MEDIA_INVALID_EDITION'; end if;
  select * into v_overrides from public.ai_media_account_limits where account_id=p_account_id;
  v_image:=coalesce(v_overrides.image_monthly_limit_override,v_plan.image_monthly_limit);
  v_video:=coalesce(v_overrides.video_monthly_limit_override,v_plan.video_monthly_limit);
  return query select v_image*7+v_video*10,
    case when p_edition='basic' then v_image*7+v_video*10 else
      greatest(v_image,case when p_edition='premium' then 150 else 70 end)*7
        +greatest(v_video,case when p_edition='standard' then 168 else 480 end)*10 end,
    v_plan.studio_enabled;
end $$;

-- A zero allowance does not disable purchased credits. A deliberate per-account
-- zero override still disables its media kind, as it did before Basique existed.
-- Automatic editorial borrowing and server-side allowance overrides stay unavailable.
do $$
declare source text; old_guard text := 'if v_kind_limit=0 or (p_surface=''studio'' and not v_plan.studio_enabled) then';
begin
  source := pg_get_functiondef('public.ai_media_credit_reserve_for_context(uuid,uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb)'::regprocedure);
  if position('AI_MEDIA_BASIC_AGENT_DENIED' in source) = 0 then
    if position(old_guard in source) = 0 or position('if p_editorial_action_id is not null and (' in source) = 0 then
      raise exception 'BASIC_MEDIA_RESERVATION_SOURCE_CHANGED';
    end if;
    source := replace(source, 'if p_editorial_action_id is not null and (',
      'if p_edition=''basic'' and (p_editorial_action_id is not null or p_limit_override is not null) then
         raise exception ''AI_MEDIA_BASIC_AGENT_DENIED'';
       end if;
       if p_editorial_action_id is not null and (');
    source := replace(source, old_guard,
      'if (v_kind_limit=0 and (p_edition<>''basic'' or exists (
        select 1 from public.ai_media_account_limits a where a.account_id=p_account_id
          and case p_media_kind when ''image'' then a.image_monthly_limit_override else a.video_monthly_limit_override end = 0
      ))) or (p_surface=''studio'' and not v_plan.studio_enabled) then');
    execute source;
  end if;
end $$;

commit;
