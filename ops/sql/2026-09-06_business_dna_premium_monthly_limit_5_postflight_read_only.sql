begin transaction read only;

do $$
begin
  if to_regclass('public.business_dna_analysis_plan_limits') is null then
    raise exception 'BUSINESS_DNA_PREMIUM_LIMIT_POSTFLIGHT_FAILED: table des plafonds absente.';
  end if;

  if not exists (
    select 1
    from public.business_dna_analysis_plan_limits
    where edition = 'standard' and monthly_limit = 4
  ) or not exists (
    select 1
    from public.business_dna_analysis_plan_limits
    where edition = 'premium' and monthly_limit = 5
  ) or not exists (
    select 1
    from public.business_dna_analysis_plan_limits
    where edition = 'founder' and monthly_limit = 16
  ) then
    raise exception 'BUSINESS_DNA_PREMIUM_LIMIT_POSTFLIGHT_FAILED: plafonds invalides.';
  end if;
end;
$$;

rollback;
