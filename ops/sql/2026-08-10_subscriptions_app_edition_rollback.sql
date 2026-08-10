-- À exécuter uniquement après retour au code antérieur à app_edition.
-- La suppression ne touche ni plan, ni status, ni les données métier.

begin;

alter table public.subscriptions
  drop constraint if exists subscriptions_app_edition_check;

alter table public.subscriptions
  drop column if exists app_edition;

commit;

