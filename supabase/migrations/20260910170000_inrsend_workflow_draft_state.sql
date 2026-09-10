-- iNrSend / Campagnes — état riche et versionné des brouillons.
-- Les colonnes relationnelles restent la source de vérité pour le mail ; ce JSONB
-- ne contient que les réglages d'interface nécessaires à une reprise exacte.

alter table public.send_items
  add column if not exists draft_state jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.send_items'::regclass
      and conname = 'send_items_draft_state_object_check'
  ) then
    alter table public.send_items
      add constraint send_items_draft_state_object_check
      check (jsonb_typeof(draft_state) = 'object');
  end if;
end $$;

comment on column public.send_items.draft_state is
  'État UI versionné d’un brouillon iNrSend/campagne (étape, moteur IA, ciblage et contexte de reprise).';
