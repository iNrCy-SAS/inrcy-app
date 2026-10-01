begin;

-- Only the two atomic RPCs below may change the nested document collection.
-- Other full-memory writers keep the latest stored collection, even when
-- their payload was prepared from an older snapshot.
create or replace function public.inrcy_preserve_ai_memory_reference_documents()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_documents jsonb;
begin
  if pg_catalog.current_setting(
    'inrcy.reference_documents_atomic_write',
    true
  ) = 'on' then
    return new;
  end if;

  if jsonb_typeof(new.memory) is distinct from 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_MEMORY_REFERENCE_DOCUMENT_MEMORY_INVALID';
  end if;

  if tg_op = 'INSERT' then
    v_documents := '[]'::jsonb;
  else
    if jsonb_typeof(old.memory) is distinct from 'object' then
      raise exception using
        errcode = 'P0001',
        message = 'AI_MEMORY_REFERENCE_DOCUMENT_MEMORY_INVALID';
    end if;
    v_documents := old.memory -> 'referenceDocuments';
    if v_documents is null or jsonb_typeof(v_documents) = 'null' then
      v_documents := old.memory -> 'reference_documents';
    end if;
    if v_documents is null or jsonb_typeof(v_documents) = 'null' then
      v_documents := '[]'::jsonb;
    elsif jsonb_typeof(v_documents) <> 'array' then
      raise exception using
        errcode = 'P0001',
        message = 'AI_MEMORY_REFERENCE_DOCUMENTS_INVALID';
    end if;
  end if;

  new.memory := jsonb_set(
    new.memory - 'reference_documents',
    '{referenceDocuments}',
    v_documents,
    true
  );
  return new;
end;
$$;

drop trigger if exists business_ai_memories_preserve_reference_documents
on public.business_ai_memories;
create trigger business_ai_memories_preserve_reference_documents
before insert or update of memory on public.business_ai_memories
for each row execute function public.inrcy_preserve_ai_memory_reference_documents();

-- Reference documents live inside a shared JSONB memory row. All additions
-- must merge under a row lock so concurrent finalisations cannot replace one
-- another or validate quotas against an obsolete snapshot.
create or replace function public.inrcy_add_ai_memory_reference_document(
  p_account_id uuid,
  p_document jsonb,
  p_max_items integer,
  p_max_total_bytes bigint
)
returns table (
  result_status text,
  result_memory jsonb,
  result_completion_score smallint,
  result_document jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_memory jsonb;
  v_documents jsonb;
  v_completion_score smallint;
  v_entry jsonb;
  v_existing jsonb;
  v_incoming_size bigint;
  v_total_bytes bigint := 0;
begin
  if p_account_id is null
    or p_max_items is null
    or p_max_items < 1
    or p_max_items > 100
    or p_max_total_bytes is null
    or p_max_total_bytes < 1
    or p_max_total_bytes > 1099511627776
  then
    raise exception using
      errcode = '22023',
      message = 'AI_MEMORY_REFERENCE_DOCUMENT_LIMITS_INVALID';
  end if;

  if jsonb_typeof(p_document) is distinct from 'object'
    or coalesce(btrim(p_document ->> 'id'), '') = ''
    or coalesce(btrim(p_document ->> 'bucket'), '') = ''
    or coalesce(btrim(p_document ->> 'path'), '') = ''
    or jsonb_typeof(p_document -> 'size') is distinct from 'number'
    or coalesce(p_document ->> 'size', '') !~ '^[0-9]+$'
  then
    raise exception using
      errcode = '22023',
      message = 'AI_MEMORY_REFERENCE_DOCUMENT_INVALID';
  end if;

  v_incoming_size := (p_document ->> 'size')::bigint;
  if v_incoming_size <= 0 then
    raise exception using
      errcode = '22023',
      message = 'AI_MEMORY_REFERENCE_DOCUMENT_INVALID';
  end if;

  insert into public.business_ai_memories (
    account_id,
    schema_version,
    memory,
    completion_score
  )
  values (p_account_id, 1, '{}'::jsonb, 0)
  on conflict (account_id) do nothing;

  select memory_row.memory, memory_row.completion_score
  into v_memory, v_completion_score
  from public.business_ai_memories as memory_row
  where memory_row.account_id = p_account_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'AI_MEMORY_REFERENCE_DOCUMENT_MEMORY_MISSING';
  end if;

  if jsonb_typeof(v_memory) is distinct from 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_MEMORY_REFERENCE_DOCUMENT_MEMORY_INVALID';
  end if;

  v_documents := v_memory -> 'referenceDocuments';
  if v_documents is null or jsonb_typeof(v_documents) = 'null' then
    v_documents := v_memory -> 'reference_documents';
  end if;
  if v_documents is null or jsonb_typeof(v_documents) = 'null' then
    v_documents := '[]'::jsonb;
  elsif jsonb_typeof(v_documents) <> 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_MEMORY_REFERENCE_DOCUMENTS_INVALID';
  end if;

  select entry.value
  into v_existing
  from jsonb_array_elements(v_documents) as entry(value)
  where entry.value ->> 'id' = p_document ->> 'id'
  limit 1;

  if found then
    return query
    select 'exists'::text, v_memory, v_completion_score, v_existing;
    return;
  end if;

  -- A Storage object may belong to only one logical document. Returning a
  -- distinct status is essential: the caller must not delete an object that
  -- is already referenced by the stored memory.
  select entry.value
  into v_existing
  from jsonb_array_elements(v_documents) as entry(value)
  where entry.value ->> 'bucket' = p_document ->> 'bucket'
    and entry.value ->> 'path' = p_document ->> 'path'
  limit 1;

  if found then
    return query
    select 'conflict_path'::text, v_memory, v_completion_score, v_existing;
    return;
  end if;

  if jsonb_array_length(v_documents) >= p_max_items then
    return query
    select 'limit_items'::text, v_memory, v_completion_score, null::jsonb;
    return;
  end if;

  for v_entry in
    select entry.value
    from jsonb_array_elements(v_documents) as entry(value)
  loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or jsonb_typeof(v_entry -> 'size') is distinct from 'number'
      or coalesce(v_entry ->> 'size', '') !~ '^[0-9]+$'
    then
      raise exception using
        errcode = 'P0001',
        message = 'AI_MEMORY_REFERENCE_DOCUMENTS_INVALID';
    end if;
    v_total_bytes := v_total_bytes + (v_entry ->> 'size')::bigint;
  end loop;

  if v_total_bytes > p_max_total_bytes
    or v_incoming_size > p_max_total_bytes - v_total_bytes
  then
    return query
    select 'limit_bytes'::text, v_memory, v_completion_score, null::jsonb;
    return;
  end if;

  v_documents := v_documents || jsonb_build_array(p_document);
  v_memory := jsonb_set(
    v_memory - 'reference_documents',
    '{referenceDocuments}',
    v_documents,
    true
  );

  perform pg_catalog.set_config(
    'inrcy.reference_documents_atomic_write',
    'on',
    true
  );
  update public.business_ai_memories as memory_row
  set memory = v_memory,
      updated_at = clock_timestamp()
  where memory_row.account_id = p_account_id;

  return query
  select 'inserted'::text, v_memory, v_completion_score, p_document;
end;
$$;

create or replace function public.inrcy_remove_ai_memory_reference_document(
  p_account_id uuid,
  p_document_id text
)
returns table (
  result_status text,
  result_memory jsonb,
  result_completion_score smallint,
  result_document jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_memory jsonb;
  v_documents jsonb;
  v_completion_score smallint;
  v_removed jsonb;
begin
  if p_account_id is null or coalesce(btrim(p_document_id), '') = '' then
    raise exception using
      errcode = '22023',
      message = 'AI_MEMORY_REFERENCE_DOCUMENT_INVALID';
  end if;

  select memory_row.memory, memory_row.completion_score
  into v_memory, v_completion_score
  from public.business_ai_memories as memory_row
  where memory_row.account_id = p_account_id
  for update;

  if not found then
    return query
    select 'not_found'::text, null::jsonb, null::smallint, null::jsonb;
    return;
  end if;

  if jsonb_typeof(v_memory) is distinct from 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_MEMORY_REFERENCE_DOCUMENT_MEMORY_INVALID';
  end if;

  v_documents := v_memory -> 'referenceDocuments';
  if v_documents is null or jsonb_typeof(v_documents) = 'null' then
    v_documents := v_memory -> 'reference_documents';
  end if;
  if v_documents is null or jsonb_typeof(v_documents) = 'null' then
    v_documents := '[]'::jsonb;
  elsif jsonb_typeof(v_documents) <> 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_MEMORY_REFERENCE_DOCUMENTS_INVALID';
  end if;

  select entry.value
  into v_removed
  from jsonb_array_elements(v_documents) as entry(value)
  where entry.value ->> 'id' = p_document_id
  limit 1;

  if not found then
    return query
    select 'not_found'::text, v_memory, v_completion_score, null::jsonb;
    return;
  end if;

  select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
  into v_documents
  from jsonb_array_elements(v_documents) with ordinality as entry(value, ordinality)
  where entry.value ->> 'id' is distinct from p_document_id;

  v_memory := jsonb_set(
    v_memory - 'reference_documents',
    '{referenceDocuments}',
    v_documents,
    true
  );
  perform pg_catalog.set_config(
    'inrcy.reference_documents_atomic_write',
    'on',
    true
  );
  update public.business_ai_memories as memory_row
  set memory = v_memory,
      updated_at = clock_timestamp()
  where memory_row.account_id = p_account_id;

  return query
  select 'removed'::text, v_memory, v_completion_score, v_removed;
end;
$$;

revoke all on function public.inrcy_add_ai_memory_reference_document(uuid, jsonb, integer, bigint)
from public, anon, authenticated, service_role;
grant execute on function public.inrcy_add_ai_memory_reference_document(uuid, jsonb, integer, bigint)
to service_role;

revoke all on function public.inrcy_remove_ai_memory_reference_document(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.inrcy_remove_ai_memory_reference_document(uuid, text)
to service_role;

revoke all on function public.inrcy_preserve_ai_memory_reference_documents()
from public, anon, authenticated, service_role;

commit;
