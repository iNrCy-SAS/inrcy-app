select jsonb_build_object(
  'column', (
    select jsonb_build_object(
      'data_type', data_type,
      'udt_name', udt_name,
      'is_nullable', is_nullable,
      'column_default', column_default
    )
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscriptions'
      and column_name = 'app_edition'
  ),
  'edition_counts', (
    select coalesce(
      jsonb_agg(jsonb_build_object('edition', app_edition, 'count', total) order by app_edition),
      '[]'::jsonb
    )
    from (
      select app_edition::text as app_edition, count(*) as total
      from public.subscriptions
      group by app_edition
    ) counts
  ),
  'billing_cycle_column', (
    select jsonb_build_object(
      'data_type', data_type,
      'is_nullable', is_nullable
    )
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscriptions'
      and column_name = 'billing_cycle'
  ),
  'invalid_billing_cycles', (
    select count(*)
    from public.subscriptions
    where billing_cycle is not null
      and billing_cycle not in ('monthly', 'yearly')
  ),
  'test_account', (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'user_id', s.user_id,
        'email', u.email,
        'edition', s.app_edition,
        'plan', s.plan,
        'status', s.status
      )),
      '[]'::jsonb
    )
    from public.subscriptions s
    join auth.users u on u.id = s.user_id
    where lower(u.email) = 'testinrcy@gmail.com'
  ),
  'webhook_ledger', (
    select jsonb_build_object(
      'exists', to_regclass('public.stripe_webhook_events') is not null,
      'rls_enabled', coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.stripe_webhook_events'::regclass
      ), false)
    )
  )
) as verification;
