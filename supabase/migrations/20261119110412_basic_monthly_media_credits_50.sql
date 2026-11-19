-- Basic receives 50 native media credits through the existing common wallet.
-- Legacy image/second allowances, purchases, jobs and other plans are unchanged.
begin;

create or replace function public.ai_media_credit_plan(p_account_id uuid,p_edition text)
returns table(base_limit integer,rollover_cap integer,studio_enabled boolean)
language plpgsql stable security invoker set search_path='' as $$
declare v_plan public.ai_media_plan_limits%rowtype; v_overrides public.ai_media_account_limits%rowtype;
  v_image integer; v_video integer; v_native integer;
begin
  select * into v_plan from public.ai_media_plan_limits where edition=p_edition;
  if not found then raise exception 'AI_MEDIA_INVALID_EDITION'; end if;
  select * into v_overrides from public.ai_media_account_limits where account_id=p_account_id;
  v_image:=coalesce(v_overrides.image_monthly_limit_override,v_plan.image_monthly_limit);
  v_video:=coalesce(v_overrides.video_monthly_limit_override,v_plan.video_monthly_limit);
  v_native:=case when p_edition='basic' then 50 else 0 end;
  return query select v_native+v_image*7+v_video*10,
    case when p_edition='basic' then v_native+v_image*7+v_video*10 else
      greatest(v_image,case when p_edition='premium' then 150 else 70 end)*7
        +greatest(v_video,case when p_edition='standard' then 168 else 480 end)*10 end,
    v_plan.studio_enabled;
end $$;

-- On first wallet import the native allowance must be included in both the
-- period allocation and its ledger entry. Existing periods receive the uplift
-- exactly once through the normal base-limit reconciliation on their next read.
-- Preserve the shared-pool wrapper and its locks/permissions when installed.
do $$
declare
  v_function regprocedure;
  v_source text;
  v_old text:='v_image.included_limit_count*7+v_video.included_limit_count*10';
  v_new text:='(v_image.included_limit_count*7+v_video.included_limit_count*10 + case when p_edition=''basic'' then 50 else 0 end /* basic_monthly_media_credits_50 */)';
begin
  v_function:=coalesce(
    to_regprocedure('public.ai_media_credit_prepare_unpooled_v1(uuid,uuid,text)'),
    to_regprocedure('public.ai_media_credit_prepare(uuid,uuid,text)'));
  if v_function is null then raise exception 'BASIC_MEDIA_CREDITS_PREPARE_MISSING'; end if;
  v_source:=pg_get_functiondef(v_function);
  if position('basic_monthly_media_credits_50' in v_source)=0 then
    if (length(v_source)-length(replace(v_source,v_old,'')))/length(v_old)<>2 then
      raise exception 'BASIC_MEDIA_CREDITS_PREPARE_SOURCE_CHANGED';
    end if;
    execute replace(v_source,v_old,v_new);
  end if;
end $$;

commit;
