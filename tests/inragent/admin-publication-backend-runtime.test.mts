import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runtimeModules } from './runtime-module-loader.mts';
import { sanitizeInrAgentAutomationSettings, sanitizeInrAgentSettings, automationSettingsToDbRow } from '../../lib/inrAgentSettings.ts';
import { buildInrAgentEditorialPlan } from '../../lib/inrAgentEditorialPlanning.ts';
import { inrAgentPublicationMediaAt } from '../../lib/inrAgentEditorialMediaPolicy.ts';
import * as policy from '../../lib/inrAgentAdminPublishPolicy.ts';

// The fixture models arbitrary PostgREST rows and deliberately malformed JSON at its boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const accountId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const actionId = '33333333-3333-4333-8333-333333333333';
const optIn = { version: 1, id: '44444444-4444-4444-8444-444444444444', enabledAt: '2026-11-14T00:00:00.000Z' };
const marker = { version: 1, optInId: optIn.id, accountId, preparedAt: '2026-11-14T00:01:00.000Z' };
const publish = () => sanitizeInrAgentAutomationSettings('publish', { enabled: true, frequency: 'daily', validationMode: 'admin_automatic_publish',
  allowedChannels: ['facebook'], metadata: { adminPublishOptIn: structuredClone(optIn) } });
const source = () => ({ id: actionId, user_id: accountId, automation_key: 'publish', action_type: 'publication', target_tool: 'booster',
  status: 'scheduled', validation_required: false, execution_policy: 'automatic_after_settings', validated_at: null,
  payload: { adminAutomaticPublish: structuredClone(marker) }, metadata: { adminAutomaticPublish: structuredClone(marker) } });
const scheduled = () => ({ id: actionId, user_id: accountId, automation_key: 'publish', action_type: 'publication', target_tool: 'booster', source: 'automatic',
  title: 'Publication de test', summary: 'Fixture isolée', status: 'scheduled', scheduled_at: '2026-11-13T00:00:00.000Z', updated_at: new Date().toISOString(), attempt_count: 0,
  channels: ['facebook'], payload: { kind: 'manual_publish_schedule', sourceActionId: actionId, adminAutomaticPublish: structuredClone(marker),
    publishPayload: { source: 'inr_agent', channels: ['facebook'], postByChannel: { facebook: { title: 'Fixture', content: 'Contenu de test' } } } } });

function database() {
  const tables: Record<string, Row[]> = {
    profiles: [{ user_id: accountId, role: 'admin' }, { user_id: actorId, role: 'admin' }],
    inr_agent_settings: [{ user_id: accountId, global_enabled: true, timezone: 'Europe/Paris', tone: 'professional' }],
    inr_agent_automation_settings: [automationSettingsToDbRow(accountId, 'publish', publish())],
    inr_agent_actions: [source()], inr_agent_scheduled_actions: [scheduled()],
  };
  const reads: string[] = [], writes: Array<{ table: string; patch: Row }> = [];
  let onClaim: (() => void) | undefined;
  const contains = (actual: Row[string], expected: Row[string]): boolean => expected && typeof expected === 'object'
    ? actual != null && Object.entries(expected).every(([key, value]) => contains(actual[key], value)) : actual === expected;
  const client = {
    from(table: string) {
      let patch: Row | undefined;
      let inserted: Row[] | undefined;
      let deleted = false;
      const filters: Array<(row: Row) => boolean> = [];
      const valueAt = (row: Row, key: string): Row[string] => key.includes('->')
        ? key.split(/->>?/).reduce((value, part) => value?.[part], row) ?? null : row[key];
      const run = (single = false) => {
        if (inserted) {
          for (const value of inserted) {
            const index = (tables[table] || []).findIndex(row => value.id && row.id === value.id);
            if (index >= 0) tables[table][index] = structuredClone(value);
            else (tables[table] ||= []).push(structuredClone(value));
          }
          writes.push({ table, patch: { inserted } });
          return { data: structuredClone(single ? inserted[0] : inserted), error: null };
        }
        const rows = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
        if (deleted) { tables[table] = (tables[table] || []).filter(row => !rows.includes(row)); writes.push({ table, patch: { deleted: rows } }); }
        if (patch) {
          writes.push({ table, patch });
          for (const row of rows) Object.assign(row, structuredClone(patch));
          if (table === 'inr_agent_scheduled_actions' && patch.status === 'running') onClaim?.();
        } else reads.push(table);
        return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
      };
      const query = {
        select() { return this; }, order() { return this; }, limit() { return this; },
        update(value: Row) { patch = value; return this; },
        insert(value: Row | Row[]) { inserted = Array.isArray(value) ? value : [value]; return this; },
        upsert(value: Row | Row[]) { return this.insert(value); },
        delete() { deleted = true; return this; },
        eq(key: string, value: unknown) { filters.push(row => valueAt(row, key) === value); return this; },
        in(key: string, values: unknown[]) { filters.push(row => values.includes(valueAt(row, key))); return this; },
        is(key: string, value: unknown) { filters.push(row => (valueAt(row, key) ?? null) === value); return this; },
        not(key: string, operator: string, value: unknown) {
          filters.push(row => operator === 'in'
            ? !String(value).slice(1, -1).split(',').map(item => item.replaceAll('"', '')).includes(valueAt(row, key))
            : valueAt(row, key) !== value); return this;
        },
        lt(key: string, value: Row[string]) { filters.push(row => row[key] < value); return this; },
        lte(key: string, value: Row[string]) { filters.push(row => row[key] <= value); return this; },
        gte(key: string, value: Row[string]) { filters.push(row => row[key] >= value); return this; },
        contains(key: string, value: Row[string]) { filters.push(row => contains(row[key], value)); return this; },
        async maybeSingle() { return run(true); }, async single() { return run(true); },
        then(resolve: (value: ReturnType<typeof run>) => unknown) { return Promise.resolve(run()).then(resolve); },
      };
      return query;
    },
    async rpc(name: string, args: Row) {
      if (name === 'inrcy_patch_app_event_payload') {
        const event = (tables.app_events || []).find(row => row.id === args.p_event_id && row.user_id === args.p_user_id && row.type === args.p_event_type);
        if (!event) return { data: null, error: null };
        event.payload = { ...event.payload, ...structuredClone(args.p_patch) };
        writes.push({ table: 'app_events', patch: { payload: structuredClone(event.payload) } });
        return { data: structuredClone(event.payload), error: null };
      }
      assert.equal(name, 'inrcy_save_inr_agent_settings');
      tables.inr_agent_settings = [structuredClone(args.p_global)];
      tables.inr_agent_automation_settings = structuredClone(args.p_automations);
      writes.push({ table: 'settings-rpc', patch: args });
      return { data: null, error: null };
    },
  };
  return { client, tables, reads, writes, onClaim(callback: () => void) { onClaim = callback; } };
}

function modules(db: ReturnType<typeof database>, extra: Record<string, unknown> = {}) {
  return runtimeModules({
    '@/lib/supabaseAdmin': { supabaseAdmin: db.client }, '@/lib/supabaseServer': {},
    'next/server': { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) }, after() {} },
    '@/lib/cronAuth': { isAuthorizedCronRequest: () => true, getAppOriginFromRequest: () => 'http://isolated.test', buildInternalCronHeaders: () => ({ 'Content-Type': 'application/json' }) },
    '@/lib/notificationWriter': { insertNotificationOnce: async () => ({ inserted: true }) },
    '@/lib/accountSubscriptionAccess': { getActiveSubscriptionAccountIds: async (ids: string[]) => new Set(ids) },
    '@/lib/dashboardEditionServer': { getDashboardEditionsForAccountIds: async (ids: string[]) => new Map(ids.map(id => [id, 'premium'])), getDashboardEditionForAuthUser: async () => 'premium' },
    ...extra,
  });
}

test('admin options preserve manual defaults and never reactivate legacy automatic_publish', () => {
  const defaults = sanitizeInrAgentSettings(null);
  assert.equal(defaults.globalEnabled, false); assert.equal(defaults.automations.publish.validationMode, 'notify_before_validation');
  assert.equal(defaults.automations.publish.frequency, 'weekly');
  assert.equal(sanitizeInrAgentAutomationSettings('publish', { validationMode: 'automatic_publish' as never }).validationMode, 'notify_before_validation');
  assert.equal(publish().validationMode, 'admin_automatic_publish');
  assert.equal(sanitizeInrAgentAutomationSettings('publish', { frequency: 'daily', validationMode: 'notify_before_validation' }).frequency, 'daily');
  for (const key of ['grow', 'loyalty', 'stats'] as const) {
    const sanitized = sanitizeInrAgentAutomationSettings(key, { frequency: 'daily', validationMode: 'admin_automatic_publish' });
    assert.notEqual(sanitized.frequency, 'daily'); assert.notEqual(sanitized.validationMode, 'admin_automatic_publish');
    assert.deepEqual(policy.requestedInrAgentAdminOptions({ automations: { [key]: { frequency: 'daily' } } }), { requested: true, invalidModule: true });
  }
  for (const settings of [{ frequency: 'daily' }, { mode: 'admin_automatic_publish' }]) assert.equal(policy.requestedInrAgentAdminOptions(settings).requested, true);
});

for (const now of ['2026-03-25T00:00:00Z', '2026-10-21T00:00:00Z']) for (const horizon of [7, 15, 30] as const) {
  test(`daily makes one local 09:00 slot per day across DST ${now}, horizon ${horizon}`, () => {
    const automation = { ...publish(), planningHorizonDays: horizon, publicationMediaTypes: { singleImage: true as const, video: true, carousel: true },
      metadata: { scheduleSlots: [{ dayOfWeek: 2, time: '08:00' }, { dayOfWeek: 5, time: '13:00' }] } };
    const plan = buildInrAgentEditorialPlan({ automation, timezone: 'Europe/Paris', now: new Date(now) });
    assert.equal(plan.length, horizon); assert.equal(new Set(plan.map(slot => slot.slotKey)).size, horizon);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const dates = plan.map(slot => Object.fromEntries(local.formatToParts(new Date(slot.scheduledFor)).map(part => [part.type, part.value])));
    assert.equal(new Set(dates.map(parts => `${parts.year}-${parts.month}-${parts.day}`)).size, horizon);
    dates.forEach(parts => { assert.equal(parts.hour, '09'); assert.equal(parts.minute, '00'); });
    plan.forEach((slot, index) => {
      const parts = dates[index];
      const ordinal = Math.floor((Date.UTC(+parts.year, +parts.month - 1, +parts.day) - Date.UTC(2020, 0, 1)) / 86400000) + 1;
      assert.deepEqual({ mediaKind: slot.mediaKind, imageCount: slot.imageCount, ...(slot.videoDurationSeconds ? { videoDurationSeconds: slot.videoDurationSeconds } : {}) }, inrAgentPublicationMediaAt(ordinal, automation.publicationMediaTypes));
    });
    const later = buildInrAgentEditorialPlan({ automation, timezone: 'Europe/Paris', now: new Date(new Date(now).getTime() + 86400000) });
    for (const slot of later) { const prior = plan.find(candidate => candidate.slotKey === slot.slotKey); if (prior) assert.equal(slot.mediaKind, prior.mediaKind); }
  });
}

test('the same opt-in is checked fresh at each boundary; global OFF then ON never revives old provenance', async () => {
  const db = database(); const server = modules(db)<typeof import('../../lib/inrAgentAdminPublishServer.ts')>('lib/inrAgentAdminPublishServer.ts');
  const authorized = () => server.isInrAgentAdminScheduledPublicationAuthorized({ supabase: db.client, row: scheduled(), actorAuthUserId: actorId, isCron: false });
  assert.equal(await authorized(), true);
  for (const mutate of [
    () => { db.tables.profiles[0].role = 'user'; }, () => { db.tables.profiles[1].role = 'user'; },
    () => { db.tables.inr_agent_settings[0].global_enabled = false; }, () => { db.tables.inr_agent_automation_settings[0].enabled = false; },
    () => { db.tables.inr_agent_automation_settings[0].validation_mode = 'notify_before_validation'; },
    () => { db.tables.inr_agent_actions[0].metadata.adminAutomaticPublishManualReview = true; },
    () => { db.tables.inr_agent_actions[0].validated_at = '2026-11-14T00:02:00Z'; },
    () => { db.tables.inr_agent_actions[0].payload.adminAutomaticPublish.optInId = actorId; },
  ]) {
    const initial = structuredClone(db.tables); mutate(); assert.equal(await authorized(), false); Object.assign(db.tables, initial);
  }
  db.tables.inr_agent_settings[0].global_enabled = false; assert.equal(await authorized(), false);
  db.tables.inr_agent_settings[0].global_enabled = true;
  db.tables.inr_agent_automation_settings[0].metadata.adminPublishOptIn.id = actorId;
  assert.equal(await authorized(), false);
  assert.equal(policy.inrAgentAdminMarkerMatchesOptIn({ ...marker, preparedAt: '2026-11-13T00:00:00Z' }, optIn, accountId), false);
  assert.equal(policy.readInrAgentAdminAutomaticPublish({ ...marker, accountId: 'forged' }), null);
});

test('parking automatic content does not touch manually validated actions or jobs', async () => {
  const db = database(); const manualAction = { ...source(), id: actorId, execution_policy: 'manual_validation', validation_required: true, validated_at: '2026-11-13T12:00:00Z' };
  const manualJob = { ...scheduled(), id: actorId, source: 'manual' };
  db.tables.inr_agent_actions.push(structuredClone(manualAction)); db.tables.inr_agent_scheduled_actions.push(structuredClone(manualJob));
  const server = modules(db)<typeof import('../../lib/inrAgentAdminPublishServer.ts')>('lib/inrAgentAdminPublishServer.ts');
  await server.parkInrAgentAdminAutomaticPublications({ supabase: db.client, accountId, optInId: optIn.id });
  assert.equal(db.tables.inr_agent_actions[0].status, 'pending_validation'); assert.equal(db.tables.inr_agent_actions[0].validated_at, null);
  assert.equal(db.tables.inr_agent_scheduled_actions[0].status, 'cancelled');
  assert.deepEqual(db.tables.inr_agent_actions[1], manualAction); assert.deepEqual(db.tables.inr_agent_scheduled_actions[1], manualJob);
  const reads = db.reads.length;
  assert.equal(await server.isInrAgentAdminScheduledPublicationAuthorized({ supabase: db.client, row: manualJob, actorAuthUserId: 'ordinary-user', isCron: false }), true);
  assert.equal(db.reads.length, reads, 'manual jobs do not acquire the privileged automatic gate');
});

for (const revoke of ['before-selection', 'after-claim', 'none'] as const) test(`real scheduled cron blocks revocation ${revoke} before provider and preserves one-time dispatch`, async () => {
  const db = database();
  if (revoke === 'before-selection') db.tables.profiles[0].role = 'user';
  if (revoke === 'after-claim') db.onClaim(() => { db.tables.inr_agent_settings[0].global_enabled = false; });
  const route = modules(db)<typeof import('../../app/api/cron/inr-agent-scheduled-actions/route.ts')>('app/api/cron/inr-agent-scheduled-actions/route.ts');
  const calls: string[] = []; const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url)); assert.equal(String(url), 'http://isolated.test/api/booster/publish-now');
    const body = JSON.parse(String(init?.body));
    assert.ok(body.idempotencyKey); assert.equal(body.origin.source, 'inr_agent'); assert.equal(body.origin.scheduledActionId, actionId);
    return Response.json({ ok: true, accepted: true, queued: true, publicationId: 'fixture-publication' }, { status: 202 });
  };
  try {
    const response = await route.POST(new Request('http://isolated.test/api/cron/inr-agent-scheduled-actions'));
    assert.equal(response.status, 200); const payload = await response.json(); assert.equal(payload.editorialExpirationError, null);
    assert.equal(calls.length, revoke === 'none' ? 1 : 0, JSON.stringify(payload.results));
    assert.equal(db.tables.inr_agent_scheduled_actions[0].status, revoke === 'none' ? 'done' : 'cancelled');
    if (revoke !== 'none') assert.equal(db.tables.inr_agent_actions[0].status, 'pending_validation');
    await route.POST(new Request('http://isolated.test/api/cron/inr-agent-scheduled-actions'));
    assert.equal(calls.length, revoke === 'none' ? 1 : 0);
  } finally { globalThis.fetch = originalFetch; }
});

function settingsRoute(db: ReturnType<typeof database>, options: { impact?: boolean; edition?: 'premium' | 'standard' } = {}) {
  const connectionStates = Object.fromEntries(['site_web', 'gmb', 'facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube_shorts', 'pinterest', 'mails'].map(key => [key, { connected: true, requiresUpdate: false }]));
  return modules(db, {
    '@/lib/dashboardEditionServer': { getDashboardEditionForAuthUser: async () => options.edition ?? 'premium' },
    '@/lib/requireUser': { requireUser: async () => ({ authUserId: actorId, activeUserId: accountId }) },
    '@/lib/observability/withApi': { withApi: (handler: unknown) => handler },
    '@/lib/channelConnectionState': { getChannelConnectionStates: async () => connectionStates },
    '@/lib/inrSearchProvisioning': { ensureSystemManagedInrSearch: async () => ({ inrSearch: { slug: 'fixture' } }) },
    '@/lib/inrSearchPublic': { getInrSearchPublicStatus: async () => ({ published: false }) },
    '@/lib/aiMediaGenerationQuota': { getAiMediaQuotaSnapshot: async () => { throw new Error('No quota operation expected'); } },
    '@/lib/inrAgentManualCreditAvailabilityServer': { getInrAgentManualPublishCreditAvailability: async () => ({ available: true }) },
    '@/lib/aiUsageQuota': {}, '@/lib/inrAgentMediaReferencesServer': { downloadInrAgentReferences: () => { throw new Error('No download expected'); } },
    '@/lib/inrAgentEditorialPlanServer': { analyzeInrAgentEditorialPlanChange: async () => ({ requiresConfirmation: !!options.impact, requiredImages: 0, requiredVideos: 0, requiredVideoSeconds: 0, protectedUntil: '2099-12-31T00:00:00Z' }),
      reconcileInrAgentEditorialPlan: async () => ({ planned: 0 }) },
  })<typeof import('../../app/api/agent/settings/route.ts')>('app/api/agent/settings/route.ts');
}
const save = (route: ReturnType<typeof settingsRoute>, settings: unknown, extra = {}) => route.POST(new Request('http://isolated.test/api/agent/settings', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, ...extra }),
}));

test('raw non-admin requests including legacy fields fail before connected-channel lookup, references and RPC', async () => {
  for (const raw of [{ frequency: 'daily' }, { mode: 'admin_automatic_publish' }, { automations: { publish: { frequency: 'daily' } } }, { automations: { grow: { validationMode: 'admin_automatic_publish' } } }]) {
    const db = database(); db.tables.profiles[0].role = 'user';
    const route = settingsRoute(db); const response = await save(route, raw);
    assert.equal(response.status, 403); assert.equal((await response.json()).code, 'INR_AGENT_ADMIN_OPTIONS_FORBIDDEN');
    assert.equal(db.writes.length, 0); assert.deepEqual([...new Set(db.reads)], ['profiles']);
  }
});

for (const edition of ['premium', 'standard'] as const) test(`${edition} settings mint their own opt-in, preserve it on an unchanged save, clear it on OFF and mint a new one on ON`, async () => {
  const db = database(); db.tables.inr_agent_automation_settings = []; db.tables.inr_agent_settings[0].global_enabled = false;
  const route = settingsRoute(db, { edition });
  const input = () => sanitizeInrAgentSettings({ globalEnabled: true, automations: { ...sanitizeInrAgentSettings(null).automations, publish: publish() } });
  const configured = input(); configured.globalEnabled = false; configured.automations.publish.enabled = false;
  assert.equal((await save(route, configured)).status, 200);
  const savedInactive = db.tables.inr_agent_automation_settings.find(row => row.automation_key === 'publish')!;
  assert.equal(db.tables.inr_agent_settings[0].global_enabled, false, 'saving a preference cannot enable the global scheduler');
  assert.equal(savedInactive.enabled, false, 'saving a preference cannot enable publication automation');
  assert.equal(savedInactive.validation_mode, 'admin_automatic_publish', 'the admin can configure validation before activation');
  assert.equal(savedInactive.metadata.adminPublishOptIn, undefined, 'an inactive preference never mints execution consent');
  const first = await save(route, input()); assert.equal(first.status, 200);
  const firstOptIn = db.tables.inr_agent_automation_settings.find(row => row.automation_key === 'publish')!.metadata.adminPublishOptIn;
  assert.ok(policy.readInrAgentAdminPublishOptIn(firstOptIn)); assert.notEqual(firstOptIn.id, optIn.id, 'a client opt-in UUID is never accepted');
  assert.equal((await save(route, input())).status, 200);
  assert.deepEqual(db.tables.inr_agent_automation_settings.find(row => row.automation_key === 'publish')!.metadata.adminPublishOptIn, firstOptIn);
  const off = input(); off.globalEnabled = false;
  assert.equal((await save(route, off)).status, 200);
  assert.equal(db.tables.inr_agent_settings[0].global_enabled, false);
  const disabled = db.tables.inr_agent_automation_settings.find(row => row.automation_key === 'publish')!;
  assert.equal(disabled.validation_mode, 'admin_automatic_publish', 'pausing preserves the selected preference for a later confirmed activation');
  assert.equal(disabled.metadata.adminPublishOptIn, undefined, 'pausing revokes automatic execution consent');
  assert.equal((await save(route, input())).status, 200);
  assert.notEqual(db.tables.inr_agent_automation_settings.find(row => row.automation_key === 'publish')!.metadata.adminPublishOptIn.id, firstOptIn.id);
});

test('next-cycle calendar deferral cannot defer revocation of automatic approval', async () => {
  const db = database(); const route = settingsRoute(db, { impact: true });
  const next = sanitizeInrAgentSettings({ globalEnabled: true, automations: { ...sanitizeInrAgentSettings(null).automations, publish: { ...publish(), frequency: 'weekly', validationMode: 'notify_before_validation' } } });
  const response = await save(route, next, { editorialPlanApplyMode: 'next_cycle' }); assert.equal(response.status, 200);
  const active = db.tables.inr_agent_automation_settings.find(row => row.automation_key === 'publish')!;
  assert.equal(active.frequency, 'daily', 'the prior calendar remains until the chosen cutover');
  assert.equal(active.validation_mode, 'notify_before_validation'); assert.equal(active.metadata.adminPublishOptIn, undefined);
  assert.equal(db.tables.inr_agent_scheduled_actions[0].status, 'cancelled');
  assert.equal(db.tables.inr_agent_actions[0].status, 'pending_validation');
});

test('real automatic schedule route preserves its New York timezone and UTC date through a durable replay without human validation or duplicates', async () => {
  const db = database(); db.tables.inr_agent_scheduled_actions = [];
  const future = '2099-06-04T09:00:00.000Z';
  Object.assign(db.tables.inr_agent_actions[0], { status: 'prepared', scheduled_for: future,
    target_channels: ['facebook'], payload: { adminAutomaticPublish: structuredClone(marker), editorialPlan: { scheduledFor: future, timezone: 'America/New_York' } } });
  let snapshots = 0, buildCalls = 0;
  const load = modules(db, {
    '@/lib/inrAgentRequest': { resolveInrAgentActionRequest: async () => ({ userId: accountId, authUserId: actorId, isCron: true,
      body: { actionId, executionSource: 'automatic', scheduledAt: '2099-07-01T12:00:00Z', timezone: 'Asia/Tokyo', scheduleSelections: [{ channel: 'facebook', scheduledAt: '2099-07-01T12:00:00Z' }] } }) },
    '@/lib/dashboardEditionServer': { getDashboardEditionForAccountId: async () => 'premium' },
    '@/lib/metaChannelRolloutServer': {}, '@/lib/observability/withApi': { withApi: (handler: unknown) => handler },
    '@/lib/observability/sentry': { captureApiException: (error: unknown) => { throw error; } },
    '@/lib/scheduledPublicationDedupe': { findSimilarScheduledPublication: async () => ({ duplicate: false }) },
    '@/lib/scheduledCampaignDedupe': {}, '@/lib/userFacingErrors': { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
    '@/app/api/booster/publish-now/publishNow.foundations': { normalizeTiktokPublicationSettings: () => null },
    '@/lib/inrAgentSchedulePayloadBuilder': { buildScheduledPayload: async () => { buildCalls++; return { actionType: 'publication', targetTool: 'booster', channels: ['facebook'],
      payload: { kind: 'manual_publish_schedule', sourceActionId: actionId, publishPayload: scheduled().payload.publishPayload } }; } },
    '@/lib/inrAgentScheduledMediaSnapshot': { snapshotAgentScheduledPublicationRows: async ({ rows }: { rows: Row[] }) => { snapshots++; return { rows, createdWorkspaceIds: [] }; } },
  });
  const route = load<typeof import('../../app/api/agent/actions/schedule/route.ts')>('app/api/agent/actions/schedule/route.ts');
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await route.POST(new Request('http://isolated.test/api/agent/actions/schedule', { method: 'POST' }));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  }
  assert.equal(buildCalls, 1); assert.equal(snapshots, 1); assert.equal(db.tables.inr_agent_scheduled_actions.length, 1);
  assert.equal(db.tables.inr_agent_actions[0].status, 'scheduled'); assert.equal(db.tables.inr_agent_actions[0].validated_at, null);
  assert.equal(db.tables.inr_agent_actions[0].validation_required, false);
  const job = db.tables.inr_agent_scheduled_actions[0];
  assert.equal(job.source, 'automatic'); assert.equal(job.scheduled_at, future, 'caller-supplied date and selections cannot replace the planned date');
  assert.equal(job.timezone, 'America/New_York', 'the server planning timezone wins over caller preferences and survives replay');
  assert.deepEqual(job.payload.adminAutomaticPublish, marker);
});

test('a non-admin collaborator cannot run or cancel an authorized automatic job; a revoked account is parked before execute-now', async () => {
  for (const revokedAccount of [false, true]) {
    const db = database(); db.tables.profiles[1].role = 'user';
    if (revokedAccount) db.tables.profiles[0].role = 'user';
    const initial = structuredClone(db.tables.inr_agent_scheduled_actions[0]);
    const route = modules(db, {
      '@/lib/requireUser': { requireUser: async () => ({ authUserId: actorId, activeUserId: accountId }) },
      '@/app/api/agent/actions/execute/route': { POST() { throw new Error('No real action execution'); } },
      '@/app/api/booster/publish-now/route': { POST() { throw new Error('No provider dispatch'); } },
      '@/lib/inrAssistantActionPreview': { scheduledPublicationFingerprint: () => 'fixture' },
    })<typeof import('../../app/api/agent/scheduled-actions/[id]/execute/route.ts')>('app/api/agent/scheduled-actions/[id]/execute/route.ts');
    const response = await route.POST(new Request('http://isolated.test/api/agent/scheduled-actions/fixture/execute', { method: 'POST' }), { params: Promise.resolve({ id: actionId }) });
    assert.equal(response.status, 403);
    if (revokedAccount) {
      assert.equal(db.tables.inr_agent_scheduled_actions[0].status, 'cancelled');
      assert.equal(db.tables.inr_agent_actions[0].status, 'pending_validation');
    } else {
      assert.deepEqual(db.tables.inr_agent_scheduled_actions[0], initial);
      assert.equal(db.writes.length, 0);
    }
  }
});

function editorialModule(db: ReturnType<typeof database>) {
  return modules(db, {
    '@/lib/boosterGenerationContext': { getBoosterGenerationContext: async () => ({ profile: null, business: null, recentPublications: [] }) },
    '@/lib/inrAgentPublicationIdeaLifecycle': { releaseAbandonedInrAgentPublicationIdeas: async () => {}, loadInrAgentPublicationIdeas: async () => [], releaseInrAgentPublicationIdea: async () => {} },
    '@/lib/inrAgentValidationEmailDelivery': {},
  })<typeof import('../../lib/inrAgentEditorialPlanServer.ts')>('lib/inrAgentEditorialPlanServer.ts');
}

test('automatic scheduling retries the ready row without another generation and parks it after revocation', async () => {
  const db = database(); db.tables.inr_agent_actions[0].status = 'prepared'; db.tables.inr_agent_scheduled_actions = [];
  const server = editorialModule(db); const paths: string[] = [];
  const initial = structuredClone(db.tables.inr_agent_actions[0]); const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    paths.push(String(url)); assert.equal(String(url), 'http://isolated.test/api/agent/actions/schedule');
    const body = JSON.parse(String(init?.body)); assert.equal(body.executionSource, 'automatic'); assert.equal(body.actionId, actionId);
    return Response.json({ error: 'isolated scheduling failure' }, { status: 503 });
  };
  try {
    const args = { supabase: db.client, userId: accountId, origin: 'http://isolated.test' };
    for (let attempt = 0; attempt < 2; attempt++) assert.deepEqual(await server.scheduleReadyInrAgentAdminPublications(args), [{ actionId, status: 'retry' }]);
    assert.equal(paths.length, 2);
    assert.deepEqual(db.tables.inr_agent_actions[0].payload, initial.payload);
    assert.deepEqual(db.tables.inr_agent_actions[0].metadata, initial.metadata);
    assert.equal(db.tables.inr_agent_actions[0].status, 'prepared');
    assert.ok(db.tables.inr_agent_actions[0].last_error);
    const retriedAction: Row = { ...initial,
      last_error: db.tables.inr_agent_actions[0].last_error, updated_at: db.tables.inr_agent_actions[0].updated_at };
    assert.deepEqual(db.tables.inr_agent_actions[0], retriedAction);
    db.tables.profiles[0].role = 'user';
    assert.deepEqual(await server.scheduleReadyInrAgentAdminPublications(args), [{ actionId, status: 'parked' }]);
    assert.equal(paths.length, 2); assert.equal(db.tables.inr_agent_actions[0].status, 'pending_validation');
  } finally { globalThis.fetch = originalFetch; }
});

test('switching on admin automation never approves an old pending or refused publication', async () => {
  for (const status of ['pending_validation', 'refused', 'validated']) {
    const db = database(); const automation = { ...publish(), planningHorizonDays: 7 as const };
    const now = new Date('2026-11-14T00:00:00Z'); const first = buildInrAgentEditorialPlan({ automation, timezone: 'Europe/Paris', now })[0];
    const old = { ...source(), status, scheduled_for: first.scheduledFor, execution_policy: 'manual_validation', validation_required: true,
      validated_at: status === 'validated' ? '2026-11-13T23:00:00Z' : null, refused_at: status === 'refused' ? '2026-11-13T23:00:00Z' : null,
      target_channels: ['facebook'], payload: { postByChannel: { facebook: { content: 'Already prepared content' } }, editorialPlan: { ...first, state: 'ready' } },
      metadata: { editorialPlan: true, editorialState: 'ready' } };
    db.tables.inr_agent_actions = [structuredClone(old)];
    await editorialModule(db).reconcileInrAgentEditorialPlan({ supabase: db.client, userId: accountId, automation, timezone: 'Europe/Paris', now });
    const existing = db.tables.inr_agent_actions.find(row => row.id === actionId)!;
    assert.equal(existing.status, status); assert.equal(existing.validation_required, true); assert.equal(existing.execution_policy, 'manual_validation');
    assert.equal(existing.validated_at, old.validated_at); assert.deepEqual(existing.payload, old.payload);
    assert.equal(existing.metadata.adminAutomaticPublishManualReview, true);
    assert.equal(existing.metadata.adminAutomaticPublish, undefined);
    assert.equal(db.tables.inr_agent_actions.filter(row => row.scheduled_for === first.scheduledFor).length, 1, 'an old refusal cannot acquire an automatic replacement');
    assert.ok(db.tables.inr_agent_actions.filter(row => row.id !== actionId).every(row => row.status === 'draft' && row.validation_required === true && !row.metadata.adminAutomaticPublish));
  }
});

test('the real durable worker cancels after enqueue and keeps a terminal marker through role restoration', async () => {
  const db = database(); const parentId = '55555555-5555-4555-8555-555555555555', childId = '66666666-6666-4666-8666-666666666666';
  const body = { source: 'inr_agent', origin: { source: 'inr_agent', scheduledActionId: actionId } };
  db.tables.inr_agent_scheduled_actions[0].status = 'done'; db.tables.inr_agent_actions[0].status = 'completed';
  db.tables.app_events = [
    { id: parentId, user_id: accountId, type: 'publish_async_job', payload: { status: 'queued', channels: ['facebook'], channelEventIds: { facebook: childId },
      preparationRequest: body, parentIdempotencyLockId: 'isolated-parent-lock', finalPayloadBase: {} } },
    { id: childId, user_id: accountId, type: 'publish_async_channel', payload: { publication_id: parentId, channel: 'facebook', status: 'queued' } },
  ];
  let terminalCommits = 0;
  const load = modules(db, {
    '@/lib/executionIdempotency': { completeExecutionIdempotencyLockOrThrow: async () => { terminalCommits++; } },
    '@/lib/mediaWorkspaceConsumption': { syncPublicationWorkspaceContext: async () => {} },
  });
  const worker = load<typeof import('../../lib/inrAgentAdminPublishWorkerServer.ts')>('lib/inrAgentAdminPublishWorkerServer.ts');
  const args = { supabase: db.client, accountId, isCron: true, body, asyncPublicationId: parentId };
  assert.equal((await worker.guardInrAgentAdminBoosterPublication(args)).allowed, true);
  db.tables.profiles[0].role = 'user';
  const result = await worker.guardInrAgentAdminBoosterPublication(args);
  assert.equal(result.allowed, false); assert.equal(result.code, 'inr_agent_admin_authorization_revoked');
  const parent = db.tables.app_events.find(row => row.id === parentId)!;
  assert.equal(parent.type, 'publish'); assert.ok(parent.payload.inrAgentAuthorizationRevokedAt);
  const facebookResult = parent.payload.results.facebook;
  assert.equal(facebookResult.ok, false);
  assert.equal(facebookResult.retryable, false);
  const placementResults = Object.values(facebookResult.placements) as Row[];
  assert.equal(placementResults.length, 1);
  assert.equal(placementResults[0].code, 'inr_agent_admin_authorization_revoked');
  assert.equal(placementResults[0].retryable, false);
  assert.equal(terminalCommits, 1);
  assert.equal(db.tables.app_events.some(row => row.id === childId), false);
  db.tables.profiles[0].role = 'admin';
  assert.equal((await worker.guardInrAgentAdminBoosterPublication(args)).allowed, false, 'restoring a role cannot revive stopped durable work');
  assert.equal(terminalCommits, 1);
});

test('worker ownership comes from the scoped scheduled row; manual jobs and unscheduled human actions stay available', async () => {
  const db = database(); const worker = modules(db, { '@/lib/executionIdempotency': {}, '@/lib/mediaWorkspaceConsumption': {} })<typeof import('../../lib/inrAgentAdminPublishWorkerServer.ts')>('lib/inrAgentAdminPublishWorkerServer.ts');
  const args = { supabase: db.client, accountId, actorAuthUserId: actorId, isCron: false,
    body: { source: 'inr_agent', origin: { source: 'inr_agent', scheduledActionId: actionId }, isCron: true } };
  db.tables.profiles[1].role = 'user';
  assert.equal((await worker.guardInrAgentAdminBoosterPublication(args)).allowed, false, 'a body isCron flag grants no worker authority');
  assert.equal(db.writes.length, 0);
  db.tables.inr_agent_scheduled_actions[0].user_id = actorId;
  assert.equal((await worker.guardInrAgentAdminBoosterPublication({ ...args, isCron: true })).allowed, false, 'foreign scheduled rows cannot authorize this owner');
  assert.equal(db.writes.length, 0);
  db.tables.inr_agent_scheduled_actions[0].user_id = accountId; db.tables.inr_agent_scheduled_actions[0].source = 'manual';
  assert.equal((await worker.guardInrAgentAdminBoosterPublication(args)).allowed, true);
  assert.equal((await worker.guardInrAgentAdminBoosterPublication({ ...args, body: { source: 'inr_agent' } })).allowed, true);
  assert.equal((await worker.guardInrAgentAdminBoosterPublication({ ...args, body: { source: 'manual' } })).allowed, true);
});

test('publish-now invokes the real worker gate after durable hydration and before the provider path', async () => {
  const file = 'app/api/booster/publish-now/route.ts'; const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declaration = sourceFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'publishNowHandler');
  assert.ok(declaration && ts.isFunctionDeclaration(declaration) && declaration.body);
  const tryBlock = declaration.body.statements.find(ts.isTryStatement)!.tryBlock;
  const index = tryBlock.statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(sourceFile) === 'agentAuthorization'));
  assert.ok(index > 0);
  const gateSource = tryBlock.statements.slice(index, index + 2).map(node => node.getText(sourceFile)).join('\n');
  assert.ok(text.indexOf('body = resolvedPreparation.body') < text.indexOf('const agentAuthorization'));
  assert.ok(text.indexOf('const agentAuthorization') < text.indexOf('const ingress = await enqueueBoosterPublication'));
  const code = ts.transpileModule(`async function gate(){${gateSource};return Response.json({providerWouldRun:true});}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const db = database(); db.tables.profiles[0].role = 'user';
  const worker = modules(db, { '@/lib/executionIdempotency': {}, '@/lib/mediaWorkspaceConsumption': {} })<typeof import('../../lib/inrAgentAdminPublishWorkerServer.ts')>('lib/inrAgentAdminPublishWorkerServer.ts');
  const response: Response = await new Function('guardInrAgentAdminBoosterPublication', 'supabaseAdmin', 'userId', 'actorAuthUserId', 'cronUserId', 'body', 'internalAsyncWorkerDispatch', 'asyncPublicationId', 'NextResponse', `${code};return gate();`)(
    worker.guardInrAgentAdminBoosterPublication, db.client, accountId, undefined, accountId,
    { source: 'inr_agent', origin: { source: 'inr_agent', scheduledActionId: actionId } }, false, '', { json: Response.json });
  assert.equal(response.status, 403); const payload = await response.json(); assert.equal(payload.retryable, false); assert.equal(payload.providerWouldRun, undefined);
});
