-- Premium: 70 images rechargees par mois, avec report plafonne a 150.
-- Standard, Founder, overrides individuels et usages existants ne changent pas.
begin;

do $$
begin
  if to_regclass('public.ai_media_plan_limits') is null then
    raise exception 'AI_MEDIA_PREMIUM_IMAGE_LIMITS_MISSING_TABLE';
  end if;
  if (select count(*) from public.ai_media_plan_limits where edition = 'premium') <> 1 then
    raise exception 'AI_MEDIA_PREMIUM_IMAGE_LIMITS_MISSING_PLAN';
  end if;
  if exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'premium' and image_monthly_limit not in (50, 70)
  ) then
    raise exception 'AI_MEDIA_PREMIUM_IMAGE_LIMITS_UNEXPECTED_BASE';
  end if;
end;
$$;

update public.ai_media_plan_limits
set image_monthly_limit = 70,
    updated_at = pg_catalog.now()
where edition = 'premium'
  and image_monthly_limit is distinct from 70;

-- Les deux chemins serveur (lecture du quota et reservation) passaient 70 en
-- dur. Une substitution ciblee et fail-closed evite de recopier des centaines
-- de lignes de fonctions de securite critiques tout en gardant leurs grants.
do $$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.get_ai_media_generation_quota_v2(uuid,uuid,text)'::regprocedure
  ) into v_source;
  v_old := E'    v_image_base,\n    70,\n    v_period_start';
  v_new := E'    v_image_base,\n    case when v_plan.edition = ''premium'' then 150 else 70 end,\n    v_period_start';
  if pg_catalog.strpos(v_source, v_new) = 0 then
    if pg_catalog.strpos(v_source, v_old) = 0
       or pg_catalog.strpos(pg_catalog.substr(v_source, pg_catalog.strpos(v_source, v_old) + pg_catalog.length(v_old)), v_old) > 0 then
      raise exception 'AI_MEDIA_PREMIUM_IMAGE_QUOTA_FUNCTION_DRIFT';
    end if;
    execute pg_catalog.replace(v_source, v_old, v_new);
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.reserve_ai_media_generation_v2(uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb)'::regprocedure
  ) into v_source;
  v_old := 'when v_media_kind = ''image'' then 70';
  v_new := E'when v_media_kind = ''image'' and v_plan.edition = ''premium'' then 150\n      when v_media_kind = ''image'' then 70';
  if pg_catalog.strpos(v_source, v_new) = 0 then
    if pg_catalog.strpos(v_source, v_old) = 0
       or pg_catalog.strpos(pg_catalog.substr(v_source, pg_catalog.strpos(v_source, v_old) + pg_catalog.length(v_old)), v_old) > 0 then
      raise exception 'AI_MEDIA_PREMIUM_IMAGE_RESERVATION_FUNCTION_DRIFT';
    end if;
    execute pg_catalog.replace(v_source, v_old, v_new);
  end if;
end;
$$;

do $$
begin
  if (select count(*) from public.ai_media_plan_limits
      where edition = 'premium' and image_monthly_limit = 70) <> 1 then
    raise exception 'AI_MEDIA_PREMIUM_IMAGE_LIMITS_POSTFLIGHT_FAILED';
  end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'public.get_ai_media_generation_quota_v2(uuid,uuid,text)'::regprocedure
    ), 'case when v_plan.edition = ''premium'' then 150 else 70 end') = 0 then
    raise exception 'AI_MEDIA_PREMIUM_IMAGE_QUOTA_POSTFLIGHT_FAILED';
  end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'public.reserve_ai_media_generation_v2(uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb)'::regprocedure
    ), 'when v_media_kind = ''image'' and v_plan.edition = ''premium'' then 150') = 0 then
    raise exception 'AI_MEDIA_PREMIUM_IMAGE_RESERVATION_POSTFLIGHT_FAILED';
  end if;
end;
$$;

comment on column public.ai_media_monthly_usage.rollover_cap is
  'Plafond de cagnotte: 70 images Standard/Founder, 150 images Premium; 168 s Standard, 480 s Premium/Founder.';

commit;
