-- iNrCy -- Validation explicite des médias IA avant Médiathèque.
--
-- Migration additive et idempotente :
--   * les nouveaux résultats IA sont des lignes privées/inactives temporaires ;
--   * le quota est consommé atomiquement dès l'inscription du brouillon réussi ;
--   * la promotion et la purge physique restent pilotées par les routes serveur ;
--   * les médias IA historiques actifs ne sont jamais modifiés.
--
-- Ordre d'exécution :
--   1. 2026-08-31_ai_media_generation_quota.sql (installation first-run) ;
--   2. 2026-08-31_ai_media_generation_studio_all_plans.sql ;
--   3. ce fichier ;
--   4. 2026-08-31_ai_media_generation_temporary_drafts_postflight_read_only.sql.

begin;

do $$
begin
  if to_regclass('public.pro_media_library') is null
     or to_regclass('public.ai_media_generation_jobs') is null
     or to_regclass('public.ai_media_monthly_usage') is null
     or to_regprocedure('public.complete_ai_media_generation(uuid,uuid,uuid,jsonb)') is null then
    raise exception 'AI_MEDIA_DRAFT_PATCH_PREREQUISITE_MISSING';
  end if;
end
$$;

create index if not exists pro_media_library_ai_draft_expiration_idx
  on public.pro_media_library (created_at, id)
  where source = 'ai_media_generation_draft'
    and is_active is false
    and upload_status in ('uploaded', 'removed');

comment on index public.pro_media_library_ai_draft_expiration_idx is
  'Accélère la purge horaire des aperçus IA non validés après 24 heures.';

-- La Function Vercel appelle également complete_ai_media_generation après
-- l'INSERT. Ce trigger ferme surtout la fenêtre de panne entre l'inscription
-- Storage/registre et cet appel : un résultat réellement produit compte même
-- si le processus disparaît juste après la réponse Supabase.
create or replace function public.ai_media_complete_temporary_draft_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.ai_media_generation_jobs%rowtype;
  v_job_id uuid;
  v_used integer;
  v_reserved integer;
begin
  if new.source <> 'ai_media_generation_draft'
     or new.is_active is distinct from false
     or new.upload_status <> 'uploaded' then
    return new;
  end if;

  if new.client_media_key is null
     or new.client_media_key !~ '^ai-media:[0-9a-fA-F-]{36}$' then
    raise exception 'AI_MEDIA_DRAFT_JOB_KEY_INVALID';
  end if;
  v_job_id := substring(new.client_media_key from 10)::uuid;

  select j.* into v_job
  from public.ai_media_generation_jobs j
  where j.id = v_job_id
    and j.account_id = new.user_id
  for update;

  if not found then
    raise exception 'AI_MEDIA_DRAFT_JOB_NOT_FOUND';
  end if;
  if v_job.media_kind <> new.media_type then
    raise exception 'AI_MEDIA_DRAFT_KIND_MISMATCH';
  end if;

  if v_job.status = 'completed' then
    if v_job.output_media_id is distinct from new.id then
      raise exception 'AI_MEDIA_DRAFT_COMPLETION_CONFLICT';
    end if;
    return new;
  end if;
  if v_job.status in ('failed', 'expired') then
    raise exception 'AI_MEDIA_DRAFT_JOB_TERMINAL';
  end if;

  select u.used_count, u.reserved_count
    into v_used, v_reserved
  from public.ai_media_monthly_usage u
  where u.account_id = v_job.account_id
    and u.period_start = v_job.quota_period_start
    and u.media_kind = v_job.media_kind
  for update;

  if not found or v_reserved < 1 then
    raise exception 'AI_MEDIA_DRAFT_RESERVATION_INVARIANT_BROKEN';
  end if;

  update public.ai_media_monthly_usage u
  set used_count = u.used_count + 1,
      reserved_count = u.reserved_count - 1
  where u.account_id = v_job.account_id
    and u.period_start = v_job.quota_period_start
    and u.media_kind = v_job.media_kind;

  update public.ai_media_generation_jobs j
  set status = 'completed',
      output_media_id = new.id,
      completed_at = now(),
      failed_at = null,
      error_code = null,
      error_message = null,
      metadata = j.metadata || jsonb_strip_nulls(jsonb_build_object(
        'temporary_draft_created', true,
        'temporary_draft_created_at', now(),
        'model', new.media_metadata #>> '{gateway,model}',
        'prompt_version', new.media_metadata #>> '{provenance,prompt_version}',
        'prompt_sha256', new.media_metadata #>> '{provenance,prompt_sha256}',
        'soundtrack_id', new.media_metadata #>> '{soundtrack,id}'
      ))
  where j.id = v_job.id;

  return new;
end;
$$;

revoke all on function public.ai_media_complete_temporary_draft_quota()
  from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.pro_media_library'::regclass
      and t.tgname = 'ai_media_complete_temporary_draft_quota'
      and not t.tgisinternal
  ) then
    create trigger ai_media_complete_temporary_draft_quota
    after insert or update of source, is_active, upload_status
    on public.pro_media_library
    for each row
    execute function public.ai_media_complete_temporary_draft_quota();
  end if;
end
$$;

comment on function public.ai_media_complete_temporary_draft_quota() is
  'Solde sans remboursement le quota dès qu un aperçu IA temporaire a été produit et stocké.';

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.pro_media_library'::regclass
      and t.tgname = 'ai_media_complete_temporary_draft_quota'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgfoid = to_regprocedure('public.ai_media_complete_temporary_draft_quota()')
  ) then
    raise exception 'AI_MEDIA_DRAFT_PATCH_VERIFICATION_FAILED';
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.ai_media_complete_temporary_draft_quota()')
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%ai_media_generation_draft%'
      and pg_get_functiondef(p.oid) like '%used_count = u.used_count + 1%'
      and pg_get_functiondef(p.oid) like '%reserved_count = u.reserved_count - 1%'
  ) then
    raise exception 'AI_MEDIA_DRAFT_FUNCTION_VERIFICATION_FAILED';
  end if;
end
$$;

commit;
