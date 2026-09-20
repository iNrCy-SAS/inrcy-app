-- Keep the database enum aligned with the commercial offers persisted by
-- Stripe Checkout, Stripe webhooks, and native RevenueCat webhooks.
alter type public.subscription_plan add value if not exists 'Standard';
alter type public.subscription_plan add value if not exists 'Premium';
