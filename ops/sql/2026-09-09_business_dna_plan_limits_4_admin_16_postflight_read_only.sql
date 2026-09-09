begin transaction read only;

do $$
begin
  if to_regclass('public.business_dna_analysis_plan_limits') is null then
    raise exception 'BUSINESS_DNA_PLAN_LIMITS_POSTFLIGHT_FAILED: table des plafonds absente.';
  end if;

  if not exists (
    select 1 from public.business_dna_analysis_plan_limits
    where edition = 'standard' and monthly_limit = 4
  ) or not exists (
    select 1 from public.business_dna_analysis_plan_limits
    where edition = 'premium' and monthly_limit = 4
  ) or not exists (
    select 1 from public.business_dna_analysis_plan_limits
    where edition = 'founder' and monthly_limit = 4
  ) or not exists (
    select 1 from public.business_dna_analysis_plan_limits
    where edition = 'admin' and monthly_limit = 16
  ) then
    raise exception 'BUSINESS_DNA_PLAN_LIMITS_POSTFLIGHT_FAILED: plafonds invalides.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'business_dna_analysis_plan_limits'
      and c.conname = 'business_dna_analysis_plan_limits_edition_check'
      and pg_get_constraintdef(c.oid) ilike '%admin%'
  ) then
    raise exception 'BUSINESS_DNA_PLAN_LIMITS_POSTFLIGHT_FAILED: édition Admin non autorisée.';
  end if;
end;
$$;

rollback;
