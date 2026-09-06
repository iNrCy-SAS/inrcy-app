begin;

do $$
begin
  if to_regclass('public.business_dna_analysis_plan_limits') is null then
    raise exception 'BUSINESS_DNA_PREMIUM_LIMIT_PREFLIGHT_FAILED: table des plafonds absente.';
  end if;
end;
$$;

-- Une analyse multicanale est normalement ponctuelle. Le plafond Premium
-- passe de 16 a 5 sans modifier les consommations deja comptabilisees ni les
-- avantages Standard/Fondateur.
insert into public.business_dna_analysis_plan_limits (edition, monthly_limit)
values ('premium', 5)
on conflict (edition) do update
set monthly_limit = excluded.monthly_limit,
    updated_at = now();

do $$
begin
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
    raise exception 'BUSINESS_DNA_PREMIUM_LIMIT_VERIFICATION_FAILED: plafonds invalides.';
  end if;
end;
$$;

commit;
