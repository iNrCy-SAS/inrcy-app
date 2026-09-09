begin;

do $$
begin
  if to_regclass('public.business_dna_analysis_plan_limits') is null then
    raise exception 'BUSINESS_DNA_PLAN_LIMITS_PREFLIGHT_FAILED: table des plafonds absente.';
  end if;
end;
$$;

-- Le rôle applicatif Admin est distinct de l'édition commerciale Founder.
-- Les professionnels Standard, Premium et Founder disposent tous de quatre
-- analyses mensuelles ; seul un acteur Admin reçoit le plafond de seize.
alter table public.business_dna_analysis_plan_limits
  drop constraint if exists business_dna_analysis_plan_limits_edition_check;

alter table public.business_dna_analysis_plan_limits
  add constraint business_dna_analysis_plan_limits_edition_check
  check (edition in ('standard', 'premium', 'founder', 'admin'));

insert into public.business_dna_analysis_plan_limits (edition, monthly_limit)
values
  ('standard', 4),
  ('premium', 4),
  ('founder', 4),
  ('admin', 16)
on conflict (edition) do update
set monthly_limit = excluded.monthly_limit,
    updated_at = now();

do $$
begin
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
    raise exception 'BUSINESS_DNA_PLAN_LIMITS_VERIFICATION_FAILED: plafonds invalides.';
  end if;
end;
$$;

commit;
