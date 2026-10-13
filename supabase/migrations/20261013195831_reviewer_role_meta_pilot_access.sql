begin;
set local lock_timeout = '10s';

-- Add the named role only; no profile, subscription or membership is changed.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user','staff','admin','reviewer'));

-- Preserve the complete deployed RPC definitions and privileges. The only
-- changed predicate adds the explicitly approved existing Meta reviewer.
-- Fail rather than modifying an unexpected/newer function definition.
do $migration$
declare
  v_signature text;
  v_definition text;
  v_guard text := 'role=''admin'' or user_id=''670b527d-5e08-42b4-ba95-e58e812339eb''::uuid';
  v_reviewer_guard text := 'role=''admin'' or (role=''reviewer'' and user_id=''dc41bc01-bfb1-43b3-9a1f-060def1f893f''::uuid) or user_id=''670b527d-5e08-42b4-ba95-e58e812339eb''::uuid';
begin
  foreach v_signature in array array[
    'public.save_meta_direct_connection(uuid,text,jsonb,jsonb,boolean)',
    'public.disconnect_meta_direct_connection(uuid,text,boolean)',
    'public.inrcy_set_threads_publication_preferences(uuid,jsonb,boolean)'
  ] loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if position(v_reviewer_guard in v_definition)>0 then continue; end if;
    if position(v_guard in v_definition)=0 then
      raise exception 'Unexpected Meta pilot guard in %; reconcile explicitly',v_signature;
    end if;
    execute replace(v_definition,v_guard,v_reviewer_guard);
  end loop;
end;
$migration$;

-- Existing server-only grants, role-write protection, RLS and default bubble
-- provisioning remain in force. Root sets the approved review account's role,
-- Premium plan and tool visibility separately after verification.
commit;
