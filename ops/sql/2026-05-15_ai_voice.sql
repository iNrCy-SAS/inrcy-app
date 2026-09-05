-- Ajout de la voix de l'entreprise pour la Configuration IA Booster / Publier.
-- À exécuter dans Supabase SQL Editor avant de déployer le zip.

alter table public.business_profiles
  add column if not exists ai_voice text not null default 'auto';

comment on column public.business_profiles.ai_voice is 'Voix de l entreprise utilisée par l IA : auto, je, nous, vous ou neutral.';

-- Sécurité : si d anciennes lignes ont une valeur vide ou invalide, on repasse en automatique.
update public.business_profiles
set ai_voice = 'auto'
where ai_voice is null
   or ai_voice not in ('auto', 'je', 'nous', 'vous', 'neutral');
