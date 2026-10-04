-- Apply before deploying the Boutique HT catalogue/order handler.
-- Additive only: no historical amount is recalculated or relabelled.
begin;

alter table public.boutique_orders
  add column if not exists amount_eur_tax_behavior text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.boutique_orders'::regclass
      and conname = 'boutique_orders_amount_eur_tax_behavior_check'
  ) then
    alter table public.boutique_orders
      add constraint boutique_orders_amount_eur_tax_behavior_check
      check (amount_eur_tax_behavior is null or amount_eur_tax_behavior in ('inclusive', 'exclusive'));
  end if;
end;
$$;

comment on column public.boutique_orders.amount_eur_tax_behavior is
  'Tax basis of the stored amount_eur: exclusive (HT), inclusive (TTC), or NULL for unqualified historical orders. Never infer it from the current catalogue.';

commit;

