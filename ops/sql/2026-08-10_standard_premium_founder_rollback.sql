-- Emergency rollback to the previous Standard / Premium text model.
-- Run only together with a rollback of the application code.
-- The Stripe webhook ledger is deliberately retained: it is harmless and
-- preserving event history is safer than deleting it. billing_cycle is also
-- retained because dropping a populated billing field would destroy data.

begin;

update public.subscriptions
set app_edition = 'premium',
    updated_at = now()
where app_edition = 'founder';

alter table public.subscriptions
  alter column app_edition set default 'standard',
  alter column app_edition set not null;

alter table public.subscriptions
  drop constraint if exists subscriptions_app_edition_check;

alter table public.subscriptions
  add constraint subscriptions_app_edition_check
  check (app_edition in ('standard', 'premium'));

comment on column public.subscriptions.app_edition is
  'Edition fonctionnelle iNrCy: standard ou premium.';

commit;
