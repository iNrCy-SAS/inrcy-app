-- Le plan est l'unique source des droits: Trial/Standard -> standard,
-- Premium -> premium, Founder -> founder. Aucun prix ni identifiant Stripe
-- n'est modifie. Cette phase tolerante precede le deploiement du webhook.
begin;

do $$
begin
  if to_regclass('public.subscriptions') is null then
    raise exception 'SUBSCRIPTION_PLAN_SOURCE_MISSING_TABLE';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_enum e
    where e.enumtypid = 'public.subscription_plan'::regtype
      and e.enumlabel = 'Founder'
  ) then
    raise exception 'SUBSCRIPTION_PLAN_SOURCE_FOUNDER_NOT_ADDED';
  end if;
  if exists (
    select 1 from public.subscriptions
    where app_edition not in ('standard', 'premium', 'founder')
  ) then
    raise exception 'SUBSCRIPTION_PLAN_SOURCE_UNKNOWN_EDITION';
  end if;
end;
$$;

-- Conserver les droits en cours pour les anciens libelles. Un Trial reste
-- Standard, y compris quand un futur paiement Premium est programme.
update public.subscriptions s
set plan = case
      when s.plan::text = 'Trial' then 'Trial'::public.subscription_plan
      when s.app_edition = 'founder' then 'Founder'::public.subscription_plan
      when s.app_edition = 'premium' then 'Premium'::public.subscription_plan
      else 'Standard'::public.subscription_plan
    end,
    scheduled_plan = case
      when s.scheduled_plan::text in ('Starter', 'Accel', 'Speed') then
        case s.app_edition
          when 'founder' then 'Founder'::public.subscription_plan
          when 'premium' then 'Premium'::public.subscription_plan
          else 'Standard'::public.subscription_plan
        end
      else s.scheduled_plan
    end,
    requested_plan = case
      when s.requested_plan::text in ('Starter', 'Accel', 'Speed') then
        case s.app_edition
          when 'founder' then 'Founder'::public.subscription_plan
          when 'premium' then 'Premium'::public.subscription_plan
          else 'Standard'::public.subscription_plan
        end
      else s.requested_plan
    end
where s.plan::text in ('Starter', 'Accel', 'Speed')
   or (s.plan::text = 'Premium' and s.app_edition = 'standard')
   or (s.plan::text = 'Standard' and s.app_edition in ('premium', 'founder'))
   or s.scheduled_plan::text in ('Starter', 'Accel', 'Speed')
   or s.requested_plan::text in ('Starter', 'Accel', 'Speed');

create or replace function public.sync_subscription_app_edition_from_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Tolerance de transition pour un ancien webhook qui enverrait encore un
  -- libelle legacy tant que le remplacement de l'enum n'est pas termine.
  if new.plan::text in ('Starter', 'Accel', 'Speed') then
    new.plan := case pg_catalog.lower(pg_catalog.btrim(new.app_edition))
      when 'founder' then 'Founder'::public.subscription_plan
      when 'premium' then 'Premium'::public.subscription_plan
      else 'Standard'::public.subscription_plan
    end;
  end if;

  if new.scheduled_plan::text in ('Starter', 'Accel', 'Speed') then
    new.scheduled_plan := case pg_catalog.lower(pg_catalog.btrim(new.app_edition))
      when 'founder' then 'Founder'::public.subscription_plan
      when 'premium' then 'Premium'::public.subscription_plan
      else 'Standard'::public.subscription_plan
    end;
  end if;
  if new.requested_plan::text in ('Starter', 'Accel', 'Speed') then
    new.requested_plan := case pg_catalog.lower(pg_catalog.btrim(new.app_edition))
      when 'founder' then 'Founder'::public.subscription_plan
      when 'premium' then 'Premium'::public.subscription_plan
      else 'Standard'::public.subscription_plan
    end;
  end if;

  new.app_edition := case new.plan::text
    when 'Trial' then 'standard'
    when 'Standard' then 'standard'
    when 'Premium' then 'premium'
    when 'Founder' then 'founder'
    else null
  end;
  if new.app_edition is null then
    raise exception 'SUBSCRIPTION_PLAN_UNKNOWN_VALUE';
  end if;
  return new;
end;
$$;

revoke all on function public.sync_subscription_app_edition_from_plan()
from public, anon, authenticated;

drop trigger if exists trg_sync_subscription_app_edition_from_plan
on public.subscriptions;
create trigger trg_sync_subscription_app_edition_from_plan
before insert or update of plan, scheduled_plan, requested_plan, app_edition
on public.subscriptions
for each row execute function public.sync_subscription_app_edition_from_plan();

update public.subscriptions s
set app_edition = case s.plan::text
      when 'Trial' then 'standard'
      when 'Standard' then 'standard'
      when 'Premium' then 'premium'
      when 'Founder' then 'founder'
    end
where s.app_edition is distinct from case s.plan::text
      when 'Trial' then 'standard'
      when 'Standard' then 'standard'
      when 'Premium' then 'premium'
      when 'Founder' then 'founder'
    end;

do $$
begin
  if exists (
    select 1 from public.subscriptions s
    where s.plan::text in ('Starter', 'Accel', 'Speed')
       or s.scheduled_plan::text in ('Starter', 'Accel', 'Speed')
       or s.requested_plan::text in ('Starter', 'Accel', 'Speed')
       or s.app_edition is distinct from case s.plan::text
            when 'Trial' then 'standard'
            when 'Standard' then 'standard'
            when 'Premium' then 'premium'
            when 'Founder' then 'founder'
          end
  ) then
    raise exception 'SUBSCRIPTION_PLAN_SOURCE_POSTFLIGHT_FAILED';
  end if;
end;
$$;

comment on column public.subscriptions.app_edition is
  'Droits derives automatiquement du plan: Trial/Standard=standard, Premium=premium, Founder=founder. Ne pas editer directement.';

commit;
