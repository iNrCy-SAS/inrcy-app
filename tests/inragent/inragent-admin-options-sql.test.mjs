import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createInrAgentAdminDatabase } from '../helpers/inragent-admin-sql-fixture.mjs';

test('admin publication options enforce real PostgreSQL authorization, consent and safe lifecycle transitions', async t => {
  const db = await createInrAgentAdminDatabase();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const asRole = async (role, operation) => {
    assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
    await db.exec(`set role ${role}`);
    try { return await operation(); } finally { await db.exec('reset role'); }
  };
  const account = async (role = 'admin', id = randomUUID()) => {
    await db.query('insert into auth.users values($1)', [id]);
    await db.query('insert into public.profiles values($1,$2)', [id, role]);
    return { id, optIn: { version: 1, id: randomUUID(), enabledAt: '2026-11-14T00:00:00.000Z' } };
  };
  const automation = (a, overrides = {}) => ({
    user_id: a.id, automation_key: 'publish', enabled: true, frequency: 'weekly', day_of_week: 1, time: '09:00',
    validation_mode: 'notify_before_validation', allowed_channels: ['site_web'], allowed_themes: ['conseils'],
    use_image_bank: true, image_required: false, recipient_scope: 'none', source_strategy: 'mixed', metadata: {}, ...overrides,
  });
  const saveRows = (a, rows, global = {}) => asRole('service_role', () => one(
    'select public.inrcy_save_inr_agent_settings($1::jsonb,$2::jsonb) result',
    [JSON.stringify({ user_id: a.id, global_enabled: true, tone: 'professional', timezone: 'Europe/Paris', metadata: {}, ...global }), JSON.stringify(rows)],
  ));
  const enable = (a, overrides = {}) => saveRows(a, [automation(a, {
    validation_mode: 'admin_automatic_publish', metadata: { adminPublishOptIn: a.optIn }, ...overrides,
  })]);
  const marker = (a, overrides = {}) => ({ version: 1, optInId: a.optIn.id, accountId: a.id, preparedAt: '2026-11-14T00:00:01.000Z', ...overrides });
  const action = async (a, overrides = {}) => {
    const row = { id: randomUUID(), user_id: a.id, automation_key: 'publish', action_type: 'publication', target_tool: 'booster',
      title: 'Information du cabinet', status: 'prepared', validation_required: false, execution_policy: 'automatic_after_settings',
      validated_at: null, scheduled_for: new Date(Date.now() + 86400000).toISOString(),
      metadata: { editorialPlan: true, adminAutomaticPublish: marker(a) }, payload: {}, preview_text: '', image_assets: [], ...overrides };
    await asRole('service_role', () => db.query(`insert into public.inr_agent_actions
      (id,user_id,automation_key,action_type,target_tool,title,status,validation_required,execution_policy,validated_at,scheduled_for,metadata,payload,preview_text,image_assets)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb)`,
    [row.id,row.user_id,row.automation_key,row.action_type,row.target_tool,row.title,row.status,row.validation_required,row.execution_policy,row.validated_at,row.scheduled_for,JSON.stringify(row.metadata),JSON.stringify(row.payload),row.preview_text,JSON.stringify(row.image_assets)]));
    return row;
  };
  const scheduled = async (a, sourceAction, overrides = {}) => {
    const row = { id: randomUUID(), user_id: a.id, automation_key: 'publish', action_type: 'publication', target_tool: 'booster',
      source: 'automatic', status: 'scheduled', payload: { sourceActionId: sourceAction.id, adminAutomaticPublish: marker(a) }, ...overrides };
    await asRole('service_role', () => db.query(`insert into public.inr_agent_scheduled_actions
      (id,user_id,automation_key,action_type,target_tool,source,title,scheduled_at,channels,payload,status)
      values($1,$2,$3,$4,$5,$6,'Publication',now()+interval '1 day',array['site_web'],$7::jsonb,$8)`,
    [row.id,row.user_id,row.automation_key,row.action_type,row.target_tool,row.source,JSON.stringify(row.payload),row.status]));
    return row;
  };
  const write = (sql, args = []) => asRole('service_role', () => db.query(sql, args));
  const snapshot = () => one(`select
    (select jsonb_agg(to_jsonb(x) order by user_id) from public.inr_agent_settings x) globals,
    (select jsonb_agg(to_jsonb(x) order by user_id,automation_key) from public.inr_agent_automation_settings x) automations,
    (select jsonb_agg(to_jsonb(x) order by id) from public.inr_agent_actions x) actions,
    (select jsonb_agg(to_jsonb(x) order by id) from public.inr_agent_scheduled_actions x) schedules`);
  const security = () => db.query(`select c.relname,c.relrowsecurity,c.relacl::text,
    (select jsonb_agg(to_jsonb(p) order by p.policyname) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and c.relname in ('inr_agent_settings','inr_agent_automation_settings','inr_agent_actions','inr_agent_scheduled_actions') order by c.relname`);
  try {
    const existing = await account('user');
    await saveRows(existing, [automation(existing)]);
    await action(existing, { status: 'pending_validation', validation_required: true, execution_policy: 'manual_validation', metadata: { editorialPlan: true } });
    const before = await snapshot(), beforeSecurity = (await security()).rows;
    const manualRpc = await one("select pg_get_functiondef('public.inrcy_confirm_editorial_publication_schedule(uuid,uuid,jsonb,jsonb)'::regprocedure) body");
    await db.exec(await readFile(new URL('../../supabase/migrations/20261114000100_inr_agent_admin_publication_options.sql', import.meta.url), 'utf8'));

    await t.test('migration leaves existing rows, manual confirmation RPC, table ACLs and RLS unchanged', async () => {
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual((await security()).rows, beforeSecurity);
      assert.deepEqual(await one("select pg_get_functiondef('public.inrcy_confirm_editorial_publication_schedule(uuid,uuid,jsonb,jsonb)'::regprocedure) body"), manualRpc);
      const defaults = await one("select column_default value from information_schema.columns where table_schema='public' and table_name='inr_agent_automation_settings' and column_name='validation_mode'");
      assert.match(defaults.value, /notify_before_validation/);
    });

    await t.test('only application admins can persist daily or automatic publication; all ordinary roles retain manual settings', async () => {
      for (const role of ['user', 'staff', 'reviewer', 'admin']) {
        const a = await account(role);
        await saveRows(a, [automation(a)]);
        assert.equal((await one('select public.inrcy_is_inr_agent_admin_account($1) allowed', [a.id])).allowed, role === 'admin');
        if (role === 'admin') {
          await saveRows(a, [automation(a, { frequency: 'daily' })]);
          await enable(a, { frequency: 'daily' });
        } else {
          await assert.rejects(saveRows(a, [automation(a, { frequency: 'daily' })]), /INR_AGENT_ADMIN_OPTIONS_REQUIRED/);
          await assert.rejects(enable(a), /INR_AGENT_ADMIN_OPTIONS_REQUIRED/);
          assert.equal((await one('select validation_mode from public.inr_agent_automation_settings where user_id=$1', [a.id])).validation_mode, 'notify_before_validation');
        }
      }
      const roleSource = await readFile(new URL('../../lib/roles.ts', import.meta.url), 'utf8');
      const allowList = JSON.parse(roleSource.match(/ADMIN_USER_IDS\s*=\s*(\[[^\]]+\])/)[1]);
      for (const id of allowList) { const a = await account('user', id); await enable(a, { frequency: 'daily' }); }
    });

    await t.test('privileged frequencies and mode stay confined to publish, while other automation modes remain available', async () => {
      const a = await account();
      for (const moduleKey of ['grow', 'loyalty', 'stats']) {
        await assert.rejects(saveRows(a, [automation(a, { automation_key: moduleKey, frequency: 'daily', validation_mode: 'validation_required' })]), /INR_AGENT_ADMIN_OPTIONS_REQUIRED|inr_agent_frequency_check/);
        await assert.rejects(saveRows(a, [automation(a, { automation_key: moduleKey, validation_mode: 'admin_automatic_publish', metadata: { adminPublishOptIn: a.optIn } })]), /INR_AGENT_ADMIN_OPTIONS_REQUIRED|inr_agent_validation_mode_check/);
      }
      await saveRows(a, [automation(a), automation(a, { automation_key: 'stats', validation_mode: 'automatic_report' })]);
      assert.equal((await one("select validation_mode from public.inr_agent_automation_settings where user_id=$1 and automation_key='stats'", [a.id])).validation_mode, 'automatic_report');
    });

    await t.test('RPC and authorization helpers expose no browser execute privilege and preserve service-only writes', async () => {
      const a = await account();
      const signatures = ['inrcy_save_inr_agent_settings(jsonb,jsonb)', 'inrcy_is_inr_agent_admin_account(uuid)',
        'inrcy_inr_agent_admin_opt_in_valid(jsonb)', 'inrcy_inr_agent_admin_marker_valid(uuid,jsonb)', 'inrcy_inr_agent_admin_publish_authorized(uuid,jsonb)'];
      for (const signature of signatures) {
        const grants = await one("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", [`public.${signature}`]);
        assert.deepEqual(grants, { anon: false, authenticated: false, service: true }, signature);
      }
      const attrs = await one("select prosecdef,proconfig from pg_proc where oid='public.inrcy_save_inr_agent_settings(jsonb,jsonb)'::regprocedure");
      assert.deepEqual(attrs, { prosecdef: true, proconfig: ['search_path=""'] });
      for (const role of ['anon', 'authenticated']) await asRole(role, async () => {
        await assert.rejects(db.query('select public.inrcy_save_inr_agent_settings($1::jsonb,$2::jsonb)', [JSON.stringify({ user_id: a.id }), '[]']), /permission denied/);
        await assert.rejects(db.query('insert into public.inr_agent_settings(user_id) values($1)', [a.id]), /permission denied/);
        await assert.rejects(db.query('select public.inrcy_is_inr_agent_admin_account($1)', [a.id]), /permission denied/);
      });
      await enable(a);
    });

    await t.test('automatic consent rejects SQL/JSON nulls, malformed markers and disabled settings', async () => {
      const a = await account();
      for (const optIn of [undefined, null, [], {}, { ...a.optIn, version: '1' }, { ...a.optIn, id: null },
        { ...a.optIn, id: 'not-a-uuid' }, { ...a.optIn, enabledAt: null }, { ...a.optIn, enabledAt: 'not-a-date' },
        { ...a.optIn, enabledAt: '2026-02-30T00:00:00Z' }]) {
        await assert.rejects(enable(a, { metadata: { adminPublishOptIn: optIn } }), /INR_AGENT_ADMIN_OPT_IN_REQUIRED/);
      }
      for (const metadata of [null, [], 'value']) await assert.rejects(enable(a, { metadata }), /INR_AGENT_ADMIN_OPT_IN_REQUIRED/);
      await assert.rejects(enable(a, { enabled: false }), /INR_AGENT_ADMIN_OPT_IN_REQUIRED/);
      await assert.rejects(saveRows(a, [automation(a, { validation_mode: 'admin_automatic_publish', metadata: { adminPublishOptIn: a.optIn } })], { global_enabled: false }), /INR_AGENT_ADMIN_OPT_IN_REQUIRED/);
      for (const [global, rows] of [[null, '[]'], ['null', '[]'], [JSON.stringify({ user_id: a.id }), null], [JSON.stringify({ user_id: a.id }), 'null']]) {
        await assert.rejects(asRole('service_role', () => db.query('select public.inrcy_save_inr_agent_settings($1::jsonb,$2::jsonb)', [global, rows])), /must be a JSON/);
      }
    });

    await t.test('automatic actions and durable schedules require matching current consent, scope and source action', async () => {
      const a = await account(), other = await account();
      await enable(a); await enable(other);
      const prepared = await action(a), job = await scheduled(a, prepared);
      await write("update public.inr_agent_scheduled_actions set status='running' where id=$1", [job.id]);
      for (const invalid of [null, {}, [], marker(a, { version: '1' }), marker(a, { accountId: other.id }),
        marker(a, { optInId: randomUUID() }), marker(a, { preparedAt: null }), marker(a, { preparedAt: '2026-11-13T00:00:00Z' })]) {
        await assert.rejects(action(a, { metadata: { editorialPlan: true, adminAutomaticPublish: invalid } }), /INR_AGENT_ADMIN_AUTOMATIC_PUBLICATION_DENIED|inr_agent_editorial_manual_validation_check/);
        await assert.rejects(scheduled(a, prepared, { payload: { sourceActionId: prepared.id, adminAutomaticPublish: invalid } }), /INR_AGENT_ADMIN_AUTOMATIC_SCHEDULE_DENIED/);
      }
      for (const overrides of [{ validation_required: true }, { validated_at: new Date().toISOString() }, { target_tool: 'mails' }, { action_type: 'campaign' }]) {
        await assert.rejects(action(a, overrides), /INR_AGENT_ADMIN_AUTOMATIC_PUBLICATION_DENIED|inr_agent_editorial_manual_validation_check/);
      }
      await assert.rejects(scheduled(a, prepared, { payload: { sourceActionId: randomUUID(), adminAutomaticPublish: marker(a) } }), /INR_AGENT_ADMIN_AUTOMATIC_SOURCE_ACTION_DENIED/);
      const foreign = await action(other);
      await assert.rejects(scheduled(a, foreign), /INR_AGENT_ADMIN_AUTOMATIC_SOURCE_ACTION_DENIED/);
      await assert.rejects(scheduled(a, prepared, { payload: { sourceActionId: null, adminAutomaticPublish: marker(a) } }), /INR_AGENT_ADMIN_AUTOMATIC_SCHEDULE_DENIED/);
    });

    await t.test('revoking the role blocks automatic work while cancellation, parking and explicit manual validation still work', async () => {
      const a = await account(); await enable(a);
      const prepared = await action(a), job = await scheduled(a, prepared);
      await db.query("update public.profiles set role='user' where user_id=$1", [a.id]);
      await assert.rejects(write("update public.inr_agent_scheduled_actions set status='running' where id=$1", [job.id]), /INR_AGENT_ADMIN_AUTOMATIC_SCHEDULE_DENIED/);
      await assert.rejects(write("update public.inr_agent_actions set status='executing' where id=$1", [prepared.id]), /INR_AGENT_ADMIN_AUTOMATIC_PUBLICATION_DENIED/);
      await write("update public.inr_agent_scheduled_actions set status='cancelled' where id=$1", [job.id]);
      await write("update public.inr_agent_actions set status='pending_validation',validation_required=true,execution_policy='manual_validation',validated_at=null where id=$1", [prepared.id]);
      await write("update public.inr_agent_actions set status='scheduled',validated_at=now() where id=$1", [prepared.id]);
      await scheduled(a, prepared, { source: 'manual', payload: { sourceActionId: prepared.id } });
      assert.equal((await one('select execution_policy from public.inr_agent_actions where id=$1', [prepared.id])).execution_policy, 'manual_validation');
      await saveRows(a, [automation(a)]);
    });

    await t.test('completed source actions support sibling channel jobs without permitting new terminal provenance or retroactive approval', async () => {
      const a = await account(); await enable(a);
      const prepared = await action(a), first = await scheduled(a, prepared), sibling = await scheduled(a, prepared);
      await write("update public.inr_agent_scheduled_actions set status='done' where id=$1", [first.id]);
      await write("update public.inr_agent_actions set status='completed' where id=$1", [prepared.id]);
      await write("update public.inr_agent_scheduled_actions set status='running' where id=$1", [sibling.id]);
      await write("update public.inr_agent_scheduled_actions set status='done' where id=$1", [sibling.id]);
      await write("update public.inr_agent_actions set status='failed' where id=$1", [prepared.id]);
      await write("update public.inr_agent_scheduled_actions set status='scheduled' where id=$1", [sibling.id]);
      await write("update public.inr_agent_scheduled_actions set status='running' where id=$1", [sibling.id]);
      await write("update public.inr_agent_scheduled_actions set status='done' where id=$1", [sibling.id]);
      await write("update public.inr_agent_actions set status='completed' where id=$1", [prepared.id]);
      await assert.rejects(action(a, { status: 'completed' }), /INR_AGENT_ADMIN_TERMINAL_PROVENANCE_DENIED/);
      await assert.rejects(write('update public.inr_agent_actions set metadata=$2::jsonb where id=$1', [prepared.id,
        JSON.stringify({ editorialPlan: true, adminAutomaticPublish: marker(a, { preparedAt: '2026-11-14T00:00:02.000Z' }) })]), /INR_AGENT_ADMIN_TERMINAL_PROVENANCE_DENIED/);
      const historical = await action(a, { status: 'completed', validation_required: true, execution_policy: 'manual_validation', metadata: { editorialPlan: true } });
      await assert.rejects(write("update public.inr_agent_actions set validation_required=false,execution_policy='automatic_after_settings',metadata=$2::jsonb where id=$1", [historical.id,
        JSON.stringify({ editorialPlan: true, adminAutomaticPublish: marker(a) })]), /INR_AGENT_ADMIN_TERMINAL_PROVENANCE_DENIED/);
      await write("update public.inr_agent_actions set status='pending_validation' where id=$1", [historical.id]);
      await assert.rejects(write("update public.inr_agent_actions set status='prepared',validation_required=false,execution_policy='automatic_after_settings',metadata=$2::jsonb where id=$1", [historical.id,
        JSON.stringify({ editorialPlan: true, adminAutomaticPublish: marker(a) })]), /INR_AGENT_ADMIN_AUTOMATIC_PUBLICATION_DENIED/);
      await db.query("update public.profiles set role='user' where user_id=$1", [a.id]);
      await write("update public.inr_agent_actions set last_error='archived diagnostic' where id=$1", [prepared.id]);
      await assert.rejects(write("update public.inr_agent_scheduled_actions set status='running' where id=$1", [sibling.id]), /INR_AGENT_ADMIN_AUTOMATIC_SCHEDULE_DENIED/);
    });

    await t.test('revoking or rotating consent blocks old work and never grants retroactive approval', async () => {
      const a = await account(); await enable(a);
      const prepared = await action(a), job = await scheduled(a, prepared);
      await write('update public.inr_agent_settings set global_enabled=false where user_id=$1', [a.id]);
      await assert.rejects(write("update public.inr_agent_scheduled_actions set status='running' where id=$1", [job.id]), /INR_AGENT_ADMIN_AUTOMATIC_SCHEDULE_DENIED/);
      await write("update public.inr_agent_scheduled_actions set status='cancelled' where id=$1", [job.id]);
      await write("update public.inr_agent_actions set status='failed' where id=$1", [prepared.id]);
      const renewed = { ...a, optIn: { ...a.optIn, id: randomUUID(), enabledAt: '2026-11-14T00:00:00.500Z' } };
      await enable(renewed);
      await assert.rejects(write("update public.inr_agent_actions set status='prepared' where id=$1", [prepared.id]), /INR_AGENT_ADMIN_AUTOMATIC_PUBLICATION_DENIED/);
      await assert.rejects(scheduled(a, prepared), /INR_AGENT_ADMIN_AUTOMATIC_SCHEDULE_DENIED/);
      await action(renewed);
      const manual = await action(renewed, { status: 'pending_validation', validation_required: true, execution_policy: 'manual_validation', metadata: { editorialPlan: true, adminAutomaticPublishManualReview: true } });
      await write("update public.inr_agent_actions set metadata='{}'::jsonb where id=$1", [manual.id]);
      assert.equal((await one('select metadata from public.inr_agent_actions where id=$1', [manual.id])).metadata.adminAutomaticPublishManualReview, true);
      await assert.rejects(write("update public.inr_agent_actions set status='prepared',validation_required=false,execution_policy='automatic_after_settings',metadata=$2::jsonb where id=$1", [manual.id, JSON.stringify({ editorialPlan: true, adminAutomaticPublish: marker(renewed) })]), /INR_AGENT_ADMIN_AUTOMATIC_PUBLICATION_DENIED/);
      await write("update public.inr_agent_actions set status='cancelled',metadata='{}'::jsonb where id=$1", [manual.id]);
    });

    await t.test('unmarked manual content and parked automatic content cannot be reapproved, while empty queued placeholders can be freshly prepared', async () => {
      const a = await account(); await enable(a);
      const toAutomatic = row => write("update public.inr_agent_actions set status='prepared',validation_required=false,execution_policy='automatic_after_settings',validated_at=null,metadata=$2::jsonb where id=$1",
        [row.id, JSON.stringify({ editorialPlan: true, editorialState: 'ready', adminAutomaticPublish: marker(a) })]);
      const manual = await action(a, { status: 'pending_validation', validation_required: true, execution_policy: 'manual_validation', metadata: { editorialPlan: true } });
      await assert.rejects(toAutomatic(manual), /INR_AGENT_ADMIN_AUTOMATIC_PUBLICATION_DENIED/);
      const parked = await action(a);
      await write("update public.inr_agent_actions set status='pending_validation',validation_required=true,execution_policy='manual_validation',validated_at=null where id=$1", [parked.id]);
      assert.equal((await one('select metadata from public.inr_agent_actions where id=$1', [parked.id])).metadata.adminAutomaticPublishManualReview, true);
      await assert.rejects(toAutomatic(parked), /INR_AGENT_ADMIN_AUTOMATIC_PUBLICATION_DENIED/);
      for (const existingContent of [
        { metadata: { editorialPlan: true, editorialState: 'ready' } },
        { metadata: { editorialPlan: true, editorialGeneratedAt: '2026-11-14T00:00:01.000Z' } },
        { payload: { editorialPlan: { state: 'ready' } } },
        { payload: { postByChannel: { facebook: { title: 'Contenu préparé', content: 'Texte déjà rédigé' } } } },
        { payload: { publishPayload: { postByChannel: { site_web: { title: 'Contenu préparé' } } } } },
        { image_assets: [{ storagePath: 'owned/generated-image.png' }] },
      ]) for (const status of ['draft', 'executing']) {
        const oldContent = await action(a, { status, validation_required: true, execution_policy: 'manual_validation', metadata: { editorialPlan: true, editorialState: 'generating' }, ...existingContent });
        await assert.rejects(toAutomatic(oldContent), /INR_AGENT_ADMIN_AUTOMATIC_PUBLICATION_DENIED/, `${status}/${JSON.stringify(existingContent)}`);
      }
      for (const status of ['draft', 'executing']) {
        const placeholder = await action(a, { status, validation_required: true, execution_policy: 'manual_validation',
          preview_text: 'iNr’Agent prépare ce contenu à l’avance selon vos critères.',
          metadata: { editorialPlan: true, editorialState: status === 'draft' ? 'queued' : 'generating' },
          payload: { editorialPlan: { state: status === 'draft' ? 'queued' : 'generating' } },
        });
        await toAutomatic(placeholder);
        assert.equal((await one('select execution_policy from public.inr_agent_actions where id=$1', [placeholder.id])).execution_policy, 'automatic_after_settings');
      }
    });

    await t.test('manual editorial confirmation remains executable for a non-admin and atomic settings saves roll back completely', async () => {
      const a = await account('user'); await saveRows(a, [automation(a)]);
      const manual = await action(a, { status: 'pending_validation', validation_required: true, execution_policy: 'manual_validation', metadata: { editorialPlan: true } });
      const confirmation = await asRole('service_role', () => one('select public.inrcy_confirm_editorial_publication_schedule($1,$2,$3::jsonb) result',
        [manual.id,a.id,JSON.stringify([{ channels: ['site_web'], payload: { sourceActionId: manual.id } }])]));
      assert.equal(confirmation.result.outcome, 'scheduled');
      assert.equal(confirmation.result.scheduledActions[0].source, 'manual');
      assert.ok(confirmation.result.action.validated_at);
      const admin = await account(), other = await account(); await saveRows(admin, [automation(admin)]);
      const beforeSave = await snapshot();
      await assert.rejects(saveRows(admin, [automation(admin, { time: '12:00' }), automation(admin, { automation_key: 'grow', frequency: 'daily', validation_mode: 'validation_required' })], { tone: 'dynamic' }), /INR_AGENT_ADMIN_OPTIONS_REQUIRED|inr_agent_frequency_check/);
      assert.deepEqual(await snapshot(), beforeSave);
      await assert.rejects(saveRows(admin, [automation(admin, { time: '12:00' }), automation(other)], { tone: 'dynamic' }), /automation rows do not all belong/);
      assert.deepEqual(await snapshot(), beforeSave);
    });
  } finally { await db.close(); }
});
