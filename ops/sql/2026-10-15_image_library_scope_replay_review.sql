-- PROCEDURE A RELIRE, NON EXECUTEE PAR L'AUDIT.
-- Incident : le worker refusait users/<compte>/image/ avant e18c0595.
-- Ne changer aucune policy RLS, bucket, autorisation ou chemin pour ce cas.
-- 1. Confirmer le correctif worker déployé, le compte actif et les dates d'échec.
-- 2. Inventorier ci-dessous puis vérifier la présence/lisibilité des originaux
--    par un outil de lecture Storage scoped au compte. storage.objects seul
--    atteste l'inscription, pas nécessairement les octets du backend.
--    Eviter GET /media-library/items/:id/content pour cette vérification : il
--    désactive une ligne lorsque le probe conclut que l'objet est manquant.
-- 3. Renseigner UN compte et la liste EXPLICITE des médias vérifiés/approuvés.
--    Les valeurs par défaut ne ciblent rien. Ne pas reprendre les autres codes.
-- 4. Exécuter d'abord en simulation : ROLLBACK est volontaire en fin de fichier.
-- 5. Après examen des lignes et accord, remplacer uniquement le ROLLBACK final
--    par COMMIT. Observer ensuite le worker et les variantes ; pas de replay
--    automatique en boucle. Garder cet inventaire et le résultat comme preuve.
-- Aucun objet original n'est déplacé/supprimé, aucun quota IA n'est consommé.

begin;

create temporary table image_scope_replay_request on commit drop as
select null::uuid as account_id, array[]::uuid[] as approved_media_ids;

-- Inventaire lecture seule dans la transaction : remplir account_id suffit
-- pour voir les candidats, sans autoriser leur reprise.
select m.id, m.user_id, m.storage_path, m.source,
       m.processing_status, m.processing_completed_at,
       j.id as job_id, j.error_code, j.updated_at as failed_job_updated_at,
       exists(select 1 from storage.objects o where o.bucket_id = m.bucket_name and o.name = m.storage_path) as storage_registry_exists
from public.pro_media_library m
join public.media_processing_jobs j on j.media_id = m.id and j.account_id = m.user_id
join image_scope_replay_request r on r.account_id = m.user_id
where m.media_type = 'image' and m.upload_status = 'uploaded'
  and m.is_active = true and m.bucket_name = 'inrcy-pro-media'
  and m.storage_path like 'users/' || m.user_id::text || '/image/%'
  and m.processing_status = 'failed_terminal'
  and m.processing_error_code = 'image_source_scope_invalid'
  and j.job_type = 'image_normalize_v1' and j.status = 'failed'
  and j.error_code = 'image_source_scope_invalid';

-- La transaction verrouille seulement la liste approuvée. Aucune sélection
-- par date seule, nom de fichier, email utilisateur ou préfixe d'autre compte.
do $replay$
declare candidate record;
begin
  for candidate in
    select j.id as job_id, m.id as media_id, m.user_id as account_id
    from public.pro_media_library m
    join public.media_processing_jobs j on j.media_id = m.id and j.account_id = m.user_id
    join image_scope_replay_request r on r.account_id = m.user_id
    where m.id = any(r.approved_media_ids)
      and m.media_type = 'image' and m.upload_status = 'uploaded' and m.is_active = true
      and m.bucket_name = 'inrcy-pro-media'
      and m.storage_path like 'users/' || m.user_id::text || '/image/%'
      and m.processing_status = 'failed_terminal' and m.processing_error_code = 'image_source_scope_invalid'
      and j.job_type = 'image_normalize_v1' and j.status = 'failed' and j.error_code = 'image_source_scope_invalid'
      and exists(select 1 from storage.objects o where o.bucket_id = m.bucket_name and o.name = m.storage_path)
    for update of m, j skip locked
  loop
    update public.media_variants set status = 'pending', error_code = null, error_message = null, updated_at = now()
    where media_id = candidate.media_id and account_id = candidate.account_id
      and status = 'failed' and error_code = 'image_source_scope_invalid';

    update public.pro_media_library set processing_status = 'queued',
      publication_status = case when publication_status = 'failed' then 'processing' else publication_status end,
      processing_progress = 0, processing_error_code = null, processing_error_message = null,
      processing_completed_at = null, updated_at = now()
    where id = candidate.media_id and user_id = candidate.account_id;

    update public.media_processing_jobs set status = 'retry_wait', attempt_count = 0,
      progress = 0, available_at = now(), error_code = null, error_message = null,
      completed_at = null, locked_at = null, lock_expires_at = null, locked_by = null, updated_at = now()
    where id = candidate.job_id and account_id = candidate.account_id;
    raise notice 'Reprise ciblée média %, compte %, job %', candidate.media_id, candidate.account_id, candidate.job_id;
  end loop;
end;
$replay$;

select m.id, m.processing_status, m.publication_status, j.id as job_id, j.status, j.error_code
from image_scope_replay_request r
join public.pro_media_library m on m.user_id = r.account_id and m.id = any(r.approved_media_ids)
join public.media_processing_jobs j on j.media_id = m.id and j.account_id = m.user_id
where j.job_type = 'image_normalize_v1';

rollback;
