-- The four-step dashboard introduction is an account-opening event, not a
-- reminder driven by profile completion or browser storage.
alter table public.inrcy_accounts
  add column if not exists dashboard_setup_intro_seen_at timestamptz
    default timestamptz '2026-09-28 08:24:04+00';

-- PostgreSQL gives existing rows the constant value without firing UPDATE
-- triggers. Remove the default so every future account starts unseen.
alter table public.inrcy_accounts
  alter column dashboard_setup_intro_seen_at drop default;

comment on column public.inrcy_accounts.dashboard_setup_intro_seen_at is
  'Set once when the first dashboard arrival claims the four-step introduction; pre-existing accounts were backfilled.';
