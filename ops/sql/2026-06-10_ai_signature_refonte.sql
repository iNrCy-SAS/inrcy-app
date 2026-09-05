-- Refonte Configuration IA / Signature IA iNrCy
-- À exécuter dans Supabase SQL Editor avant de déployer le zip.
-- Conserve la logique SEO automatique existante et ajoute les réglages éditoriaux globaux.

alter table public.business_profiles
  add column if not exists ai_commercial_level text not null default 'balanced',
  add column if not exists ai_main_goal text not null default 'contacts',
  add column if not exists ai_preferred_angle text not null default 'trust',
  add column if not exists ai_liked_example text not null default '';

comment on column public.business_profiles.ai_commercial_level is 'Niveau commercial préféré pour les contenus IA : discreet, balanced, direct.';
comment on column public.business_profiles.ai_main_goal is 'Objectif principal des contenus IA : visibility, contacts, reassure, offer.';
comment on column public.business_profiles.ai_preferred_angle is 'Angle éditorial préféré : local, quality, price, speed, trust.';
comment on column public.business_profiles.ai_liked_example is 'Exemple de contenu aimé utilisé comme inspiration de style par l IA sans copie.';

-- Migration douce des anciennes valeurs vers les nouvelles valeurs de Signature IA.
-- L'ancien ton « direct » exprimait surtout une intensité commerciale. On
-- déplace cette intention avant de normaliser le ton, sans écraser un niveau
-- commercial déjà choisi lors d'un éventuel rejeu du script.
update public.business_profiles
set ai_commercial_level = 'direct'
where lower(btrim(coalesce(tone, ''))) = 'direct'
  and ai_commercial_level = 'balanced';

update public.business_profiles
set tone = case
  when tone in ('friendly', 'warm', 'chaleureux') then 'warm'
  when tone = 'premium' then 'premium'
  when tone = 'fun' then 'fun'
  else 'serious'
end
where tone is null or tone not in ('serious', 'warm', 'fun', 'premium');

update public.business_profiles
set communication_style = case
  when communication_style in ('moderne', 'dynamic', 'dynamique') then 'dynamic'
  when communication_style in ('professionnel', 'expert') then 'expert'
  when communication_style in ('coulisses', 'histoire') then 'coulisses'
  when communication_style in ('local-humain') then 'local_humain'
  else 'simple'
end
where communication_style is null or communication_style not in ('simple', 'dynamic', 'expert', 'coulisses', 'local_humain', 'premium');

update public.business_profiles
set ai_creativity = case
  when ai_creativity in ('stable', 'classic', 'classique') then 'classic'
  when ai_creativity in ('creative', 'creatif') then 'creative'
  else 'balanced'
end
where ai_creativity is null or ai_creativity not in ('classic', 'balanced', 'creative');

update public.business_profiles
set emoji_level = case
  when emoji_level = 'none' then 'none'
  when emoji_level in ('dynamic', 'many') then 'dynamic'
  else 'light'
end
where emoji_level is null or emoji_level not in ('none', 'light', 'dynamic');

update public.business_profiles
set ai_voice = case
  when ai_voice = 'auto' then 'auto'
  when ai_voice = 'je' then 'je'
  when ai_voice = 'vous' then 'vous'
  when ai_voice = 'neutral' then 'neutral'
  else 'nous'
end
where ai_voice is null or ai_voice not in ('auto', 'je', 'nous', 'vous', 'neutral');

update public.business_profiles
set address_mode = case when address_mode = 'tu' then 'tu' else 'vous' end
where address_mode is null or address_mode not in ('vous', 'tu');
