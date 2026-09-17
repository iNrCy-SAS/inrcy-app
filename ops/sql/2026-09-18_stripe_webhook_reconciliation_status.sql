-- Keep paid Stripe events actionable when they cannot yet be mapped to a
-- local iNrCy subscription. The webhook still acknowledges Stripe with 2xx,
-- while a later manual redelivery can retry the same ledger entry.

begin;

alter table public.stripe_webhook_events
  drop constraint if exists stripe_webhook_events_status_check;

alter table public.stripe_webhook_events
  add constraint stripe_webhook_events_status_check
  check (status in ('processing', 'completed', 'failed', 'needs_reconciliation'))
  not valid;

alter table public.stripe_webhook_events
  validate constraint stripe_webhook_events_status_check;

comment on column public.stripe_webhook_events.status is
  'Webhook lifecycle: processing, completed, failed, or needs_reconciliation when a paid Stripe subscription has no unique local account yet.';

commit;
