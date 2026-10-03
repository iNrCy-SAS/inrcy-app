-- Valeur additive pour preparer la migration sans interrompre les webhooks
-- Stripe de la version actuellement deployee.
alter type public.subscription_plan add value if not exists 'Founder';
