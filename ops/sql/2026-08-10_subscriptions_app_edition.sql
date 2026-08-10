-- iNrCy Standard / Premium : sépare l'édition de l'application du plan de facturation.
-- Déploiement additif : tous les comptes déjà présents restent Premium ;
-- toute future ligne subscriptions reçoit Standard par défaut.

begin;

alter table public.subscriptions
  add column if not exists app_edition text;

-- Au premier passage, toutes les lignes historiques ont app_edition = null.
-- Elles restent donc Premium, quel que soit leur plan Trial / Starter / Accel / Speed.
update public.subscriptions
set app_edition = 'premium'
where app_edition is null
   or lower(btrim(app_edition)) not in ('standard', 'premium');

update public.subscriptions
set app_edition = lower(btrim(app_edition))
where app_edition <> lower(btrim(app_edition));

alter table public.subscriptions
  alter column app_edition set default 'standard',
  alter column app_edition set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_app_edition_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_app_edition_check
      check (app_edition in ('standard', 'premium'));
  end if;
end
$$;

comment on column public.subscriptions.app_edition is
  'Édition fonctionnelle iNrCy : standard ou premium. Indépendante de plan et status.';

commit;

