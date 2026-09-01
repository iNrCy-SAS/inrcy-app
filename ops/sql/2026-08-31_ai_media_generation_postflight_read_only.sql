-- iNrCy -- Postflight strict et integralement READ ONLY du ledger media IA.
--
-- A executer uniquement apres la migration first-run. Le resultat attendu est
-- une ligne verdict=PASS, failed_checks=[] et checked_objects=37.
-- Ce script ne cree, ne modifie et ne supprime aucun objet ni aucune donnee.

begin transaction read only;

with
target_tables(table_name, qualified_name, relation_oid) as (
  values
    (
      'ai_media_plan_limits'::text,
      'public.ai_media_plan_limits'::text,
      to_regclass('public.ai_media_plan_limits')
    ),
    (
      'ai_media_monthly_usage'::text,
      'public.ai_media_monthly_usage'::text,
      to_regclass('public.ai_media_monthly_usage')
    ),
    (
      'ai_media_generation_jobs'::text,
      'public.ai_media_generation_jobs'::text,
      to_regclass('public.ai_media_generation_jobs')
    )
),
expected_functions(function_name, signature) as (
  values
    (
      'ai_media_assert_account_actor'::text,
      'public.ai_media_assert_account_actor(uuid,uuid)'::text
    ),
    (
      'ai_media_expire_account_reservations'::text,
      'public.ai_media_expire_account_reservations(uuid,integer)'::text
    ),
    (
      'get_ai_media_generation_quota'::text,
      'public.get_ai_media_generation_quota(uuid,uuid,text)'::text
    ),
    (
      'reserve_ai_media_generation'::text,
      'public.reserve_ai_media_generation(uuid,uuid,text,text,text,text,text,integer,integer,jsonb)'::text
    ),
    (
      'complete_ai_media_generation'::text,
      'public.complete_ai_media_generation(uuid,uuid,uuid,jsonb)'::text
    ),
    (
      'fail_ai_media_generation'::text,
      'public.fail_ai_media_generation(uuid,uuid,text,text,jsonb)'::text
    ),
    (
      'expire_ai_media_generation_reservations'::text,
      'public.expire_ai_media_generation_reservations(integer)'::text
    )
),
expected_triggers(trigger_name, table_name) as (
  values
    ('ai_media_plan_limits_touch_updated_at'::text, 'ai_media_plan_limits'::text),
    ('ai_media_monthly_usage_touch_updated_at'::text, 'ai_media_monthly_usage'::text),
    ('ai_media_generation_jobs_touch_updated_at'::text, 'ai_media_generation_jobs'::text)
),
expected_policies(policy_name, table_name, predicate_kind) as (
  values
    (
      'ai_media_plan_limits_authenticated_read'::text,
      'ai_media_plan_limits'::text,
      'public_read'::text
    ),
    (
      'ai_media_monthly_usage_account_read'::text,
      'ai_media_monthly_usage'::text,
      'account_read'::text
    ),
    (
      'ai_media_generation_jobs_account_read'::text,
      'ai_media_generation_jobs'::text,
      'account_read'::text
    )
),
target_roles(authenticated_oid, anon_oid, service_role_oid) as (
  select
    (select r.oid from pg_roles r where r.rolname = 'authenticated'),
    (select r.oid from pg_roles r where r.rolname = 'anon'),
    (select r.oid from pg_roles r where r.rolname = 'service_role')
),
plan_shape(ok) as (
  select
    to_regclass('public.ai_media_plan_limits') is not null
    and count(*) filter (
      where a.attname = 'edition' and a.atttypid = 'text'::regtype
    ) = 1
    and count(*) filter (
      where a.attname = 'image_monthly_limit' and a.atttypid = 'integer'::regtype
    ) = 1
    and count(*) filter (
      where a.attname = 'video_monthly_limit' and a.atttypid = 'integer'::regtype
    ) = 1
    and count(*) filter (
      where a.attname = 'studio_enabled' and a.atttypid = 'boolean'::regtype
    ) = 1
  from pg_attribute a
  where a.attrelid = to_regclass('public.ai_media_plan_limits')
    and a.attnum > 0
    and not a.attisdropped
),
-- query_to_xml permet de retourner FAIL, plutot qu'une erreur SQL, meme si la
-- table ou ses colonnes sont absentes. La requete dynamique reste un SELECT pur.
plan_probe(document) as (
  select case
    when not s.ok then
      xmlparse(document '<table/>')
    else
      query_to_xml(
        $query$
          select (
            count(*) = 3
            and count(*) filter (
              where edition = 'standard'
                and image_monthly_limit = 40
                and video_monthly_limit = 3
                and studio_enabled = false
            ) = 1
            and count(*) filter (
              where edition = 'premium'
                and image_monthly_limit = 100
                and video_monthly_limit = 9
                and studio_enabled = true
            ) = 1
            and count(*) filter (
              where edition = 'founder'
                and image_monthly_limit = 150
                and video_monthly_limit = 12
                and studio_enabled = true
            ) = 1
          ) as ok
          from public.ai_media_plan_limits
        $query$,
        false,
        false,
        ''
      )
  end
  from plan_shape s
),
table_checks(check_name, ok, detail) as (
  select
    format('table %s existe', t.qualified_name),
    t.relation_oid is not null,
    'Les trois tables first-run doivent exister'
  from target_tables t

  union all

  select
    format('RLS %s activee', t.qualified_name),
    exists (
      select 1
      from pg_class c
      where c.oid = t.relation_oid
        and c.relrowsecurity
    ),
    'relrowsecurity doit etre true'
  from target_tables t
),
table_count_check(check_name, ok, detail) as (
  select
    'exactement 3 tables ai_media_*',
    count(*) = 3,
    format('%s table(s) trouvee(s)', count(*))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and left(c.relname, 9) = 'ai_media_'
),
plan_check(check_name, ok, detail) as (
  select
    '3 plans et plafonds exacts',
    coalesce(
      cardinality(xpath('/table/row/ok[text()="true"]', p.document)) = 1,
      false
    ),
    'Standard 40/3 false, Premium 100/9 true, Founder 150/12 true'
  from plan_probe p
),
function_checks(check_name, ok, detail) as (
  select
    format('function %s', f.signature),
    to_regprocedure(f.signature) is not null,
    'Signature RPC attendue'
  from expected_functions f
),
function_count_check(check_name, ok, detail) as (
  select
    'exactement 7 fonctions media IA attendues',
    count(*) = 7,
    format('%s fonction(s) trouvee(s)', count(*))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (select f.function_name from expected_functions f)
),
trigger_checks(check_name, ok, detail) as (
  select
    format('trigger %s sur public.%s', e.trigger_name, e.table_name),
    exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = e.table_name
        and t.tgname = e.trigger_name
        and not t.tgisinternal
        and t.tgenabled <> 'D'
        and t.tgfoid = to_regprocedure('public.inrcy_touch_updated_at()')
    ),
    'Trigger updated_at present, actif et relie a inrcy_touch_updated_at()'
  from expected_triggers e
),
trigger_count_check(check_name, ok, detail) as (
  select
    'exactement 3 triggers ai_media_*',
    count(*) = 3,
    format('%s trigger(s) trouve(s)', count(*))
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal
    and left(t.tgname, 9) = 'ai_media_'
),
policy_checks(check_name, ok, detail) as (
  select
    format('policy %s sur public.%s', e.policy_name, e.table_name),
    exists (
      select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = e.table_name
        and p.polname = e.policy_name
        and p.polcmd = 'r'
        and p.polpermissive
        and p.polroles = array[roles.authenticated_oid]::oid[]
        and p.polwithcheck is null
        and case e.predicate_kind
          when 'public_read' then pg_get_expr(p.polqual, p.polrelid) = 'true'
          when 'account_read' then
            pg_get_expr(p.polqual, p.polrelid)
              ~ 'inrcy_can_access_account\(\s*account_id\s*\)'
          else false
        end
    ),
    'Policy SELECT permissive, uniquement authenticated, avec USING attendu'
  from expected_policies e
  cross join target_roles roles
),
policy_count_check(check_name, ok, detail) as (
  select
    'exactement 3 policies ai_media_*',
    count(*) = 3,
    format('%s policy/policies trouvee(s)', count(*))
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and left(p.polname, 9) = 'ai_media_'
),
authenticated_privilege_checks(check_name, ok, detail) as (
  select
    format('authenticated lecture seule sur %s', t.qualified_name),
    coalesce(has_table_privilege(roles.authenticated_oid, t.relation_oid, 'SELECT'), false)
      and not coalesce(has_table_privilege(roles.authenticated_oid, t.relation_oid, 'INSERT'), false)
      and not coalesce(has_table_privilege(roles.authenticated_oid, t.relation_oid, 'UPDATE'), false)
      and not coalesce(has_table_privilege(roles.authenticated_oid, t.relation_oid, 'DELETE'), false),
    'SELECT=true, INSERT/UPDATE/DELETE=false'
  from target_tables t
  cross join target_roles roles
),
service_table_privilege_checks(check_name, ok, detail) as (
  select
    format('service_role acces table %s', t.qualified_name),
    coalesce(has_table_privilege(roles.service_role_oid, t.relation_oid, 'SELECT'), false)
      and coalesce(has_table_privilege(roles.service_role_oid, t.relation_oid, 'INSERT'), false)
      and coalesce(has_table_privilege(roles.service_role_oid, t.relation_oid, 'UPDATE'), false)
      and coalesce(has_table_privilege(roles.service_role_oid, t.relation_oid, 'DELETE'), false),
    'service_role doit lire et muter les tables du ledger'
  from target_tables t
  cross join target_roles roles
),
function_privilege_checks(check_name, ok, detail) as (
  select
    format('service_role seul execute %s', f.signature),
    coalesce(
      has_function_privilege(
        roles.service_role_oid,
        to_regprocedure(f.signature),
        'EXECUTE'
      ),
      false
    )
      and not coalesce(
        has_function_privilege(
          roles.authenticated_oid,
          to_regprocedure(f.signature),
          'EXECUTE'
        ),
        false
      )
      and not coalesce(
        has_function_privilege(roles.anon_oid, to_regprocedure(f.signature), 'EXECUTE'),
        false
      )
      and not exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(
          coalesce(p.proacl, acldefault('f', p.proowner))
        ) acl
        where p.oid = to_regprocedure(f.signature)
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      ),
    'EXECUTE=true pour service_role et false pour PUBLIC/anon/authenticated'
  from expected_functions f
  cross join target_roles roles
),
all_checks as (
  select * from table_checks
  union all select * from table_count_check
  union all select * from plan_check
  union all select * from function_checks
  union all select * from function_count_check
  union all select * from trigger_checks
  union all select * from trigger_count_check
  union all select * from policy_checks
  union all select * from policy_count_check
  union all select * from authenticated_privilege_checks
  union all select * from service_table_privilege_checks
  union all select * from function_privilege_checks
),
normalized_checks as (
  select check_name, coalesce(ok, false) as ok, detail
  from all_checks
)
select
  case when bool_and(c.ok) then 'PASS' else 'FAIL' end as verdict,
  count(*)::integer as checked_objects,
  count(*) filter (where not c.ok)::integer as failed_count,
  coalesce(
    jsonb_agg(
      jsonb_build_object('check', c.check_name, 'detail', c.detail)
      order by c.check_name
    ) filter (where not c.ok),
    '[]'::jsonb
  ) as failed_checks
from normalized_checks c;

commit;
