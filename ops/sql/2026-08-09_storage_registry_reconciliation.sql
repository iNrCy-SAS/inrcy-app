-- iNrCy — Réconciliation sûre du registre média avec Supabase Storage.
--
-- Ce script ne supprime aucun fichier et aucune ligne. Il :
--   1) réactive les références précédemment marquées manquantes si l'objet existe ;
--   2) marque comme failed les variantes "ready" dont l'objet est réellement absent ;
--   3) signale les sources absentes sans modifier leur statut métier, afin de
--      conserver les variantes canoniques encore publiables.

begin;

do $$
begin
  if to_regclass('public.pro_media_library') is null
     or to_regclass('public.media_variants') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Prérequis média ou Storage absent.';
  end if;
end;
$$;

-- Probe exact, non-public object existence without issuing a Storage request.
-- Only the backend service role may call this function.
create or replace function public.inrcy_storage_object_exists(
  p_bucket text,
  p_path text
)
returns boolean
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select
    nullif(btrim(p_bucket), '') is not null
    and nullif(ltrim(coalesce(p_path, ''), '/'), '') is not null
    and exists (
      select 1
      from storage.objects as object
      where object.bucket_id = btrim(p_bucket)
        and object.name = ltrim(p_path, '/')
    );
$$;

revoke all on function public.inrcy_storage_object_exists(text, text)
  from public, anon, authenticated;
grant execute on function public.inrcy_storage_object_exists(text, text)
  to service_role;

-- Une restauration manuelle du fichier doit lever le marqueur sans recréer le média.
update public.pro_media_library as media
set
  upload_error_code = null,
  upload_error_message = null,
  updated_at = now()
where media.upload_error_code = 'storage_object_missing'
  and exists (
    select 1
    from storage.objects as object
    where object.bucket_id = media.bucket_name
      and object.name = ltrim(media.storage_path, '/')
  );

update public.media_variants as variant
set
  status = 'ready',
  error_code = null,
  error_message = null,
  ready_at = coalesce(variant.ready_at, now()),
  updated_at = now()
where variant.error_code = 'storage_object_missing'
  and variant.bucket_name is not null
  and variant.storage_path is not null
  and exists (
    select 1
    from storage.objects as object
    where object.bucket_id = variant.bucket_name
      and object.name = ltrim(variant.storage_path, '/')
  );

create temporary table inrcy_missing_ready_variants
on commit drop
as
select variant.id
from public.media_variants as variant
where variant.status = 'ready'
  and variant.bucket_name is not null
  and variant.storage_path is not null
  and not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = variant.bucket_name
      and object.name = ltrim(variant.storage_path, '/')
  );

create temporary table inrcy_missing_media_sources
on commit drop
as
select media.id
from public.pro_media_library as media
where media.upload_status = 'uploaded'
  and media.original_deleted_at is null
  and media.bucket_name is not null
  and media.storage_path is not null
  and not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = media.bucket_name
      and object.name = ltrim(media.storage_path, '/')
  );

update public.media_variants as variant
set
  status = 'failed',
  error_code = 'storage_object_missing',
  error_message = 'La variante annoncée comme prête est absente du stockage.',
  ready_at = null,
  updated_at = now()
where variant.id in (select id from inrcy_missing_ready_variants)
  and variant.status = 'ready'
  and not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = variant.bucket_name
      and object.name = ltrim(variant.storage_path, '/')
  );

update public.pro_media_library as media
set
  upload_error_code = 'storage_object_missing',
  upload_error_message =
    'Le fichier source est absent du stockage. Un nouvel envoi est nécessaire.',
  updated_at = now()
where media.id in (select id from inrcy_missing_media_sources)
  and media.upload_status = 'uploaded'
  and not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = media.bucket_name
      and object.name = ltrim(media.storage_path, '/')
  );

select
  'variantes_ready_marquees_failed' as resultat,
  count(*)::bigint as lignes
from inrcy_missing_ready_variants
union all
select
  'sources_absentes_signalees' as resultat,
  count(*)::bigint as lignes
from inrcy_missing_media_sources;

commit;
