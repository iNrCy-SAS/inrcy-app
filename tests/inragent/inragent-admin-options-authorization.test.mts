import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = process.cwd();
const cache = new Map<string, { exports: unknown }>();
function load<T>(file: string): T {
  if (cache.has(file)) return cache.get(file)!.exports as T;
  const record = { exports: {} };
  cache.set(file, record);
  const source = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('module', 'exports', 'require', source)(record, record.exports, (name: string) => {
    if (name === 'server-only') return {};
    if (name === '@/lib/roles') return load('lib/roles.ts');
    if (name === '@/lib/supabaseServer') return { createSupabaseServer() { throw new Error('No live session or database access in this role test'); } };
    throw new Error(`Unexpected authorization dependency: ${name}`);
  });
  return record.exports as T;
}

const policy = load<typeof import('../../lib/inrAgentAdminOptionsServer.ts')>('lib/inrAgentAdminOptionsServer.ts');
const roles = load<typeof import('../../lib/roles.ts')>('lib/roles.ts');
type StoredResult = { data: unknown; error?: unknown } | Error;
function database(initial: Record<string, unknown> = {}) {
  const profiles = new Map<string, StoredResult>(Object.entries(initial).map(([id, role]) => [id, { data: { role } }]));
  const queries: Array<{ table: string; columns: string; column: string; id: string }> = [];
  const client = {
    from(table: 'profiles') {
      assert.equal(table, 'profiles');
      return { select(columns: 'role') {
        assert.equal(columns, 'role');
        return { eq(column: 'user_id', id: string) {
          assert.equal(column, 'user_id');
          return { async maybeSingle() {
            queries.push({ table, columns, column, id });
            const result = profiles.get(id) || { data: null };
            if (result instanceof Error) throw result;
            return result;
          } };
        } };
      } };
    },
  };
  return { client, profiles, queries };
}

test('admin publication options require both the real API actor and active account to be admins', async () => {
  for (const actorRole of ['user', 'staff', 'reviewer', 'admin']) for (const accountRole of ['user', 'staff', 'reviewer', 'admin']) {
    const fixture = database({ actor: actorRole, account: accountRole });
    assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'account', actorAuthUserId: 'actor' }), actorRole === 'admin' && accountRole === 'admin', `${actorRole}/${accountRole}`);
    assert.deepEqual(fixture.queries.map(query => query.id).sort(), ['account', 'actor']);
  }
});

test('the same admin actor and account need one fresh role read without changing the existing allow-list definition', async () => {
  const fixture = database({ actor: 'admin' });
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'actor', actorAuthUserId: 'actor' }), true);
  assert.equal(fixture.queries.length, 1);
  const allowListedId = roles.ADMIN_USER_IDS[0];
  assert.ok(allowListedId);
  fixture.profiles.set(allowListedId, { data: { role: 'user' } });
  assert.equal(await policy.isInrAgentAdminAccount(fixture.client, allowListedId), true);
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: allowListedId, actorAuthUserId: allowListedId }), true);
  assert.equal(fixture.queries.length, 1, 'the canonical hard allow-list behaves exactly as getMyRole');
  fixture.profiles.set('pro', { data: { role: 'user' } });
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'pro', actorAuthUserId: allowListedId }), false, 'an admin visiting a professional account is denied');
});

test('edition, membership and user metadata cannot turn a professional into an application admin', async () => {
  const fixture = database();
  fixture.profiles.set('professional', { data: {
    role: 'user', app_edition: 'founder', plan: 'Premium',
    membership: { role: 'admin' }, user_metadata: { role: 'admin', isAdmin: true }, app_metadata: { role: 'admin' },
  } });
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'professional', actorAuthUserId: 'professional' }), false);
  assert.deepEqual(fixture.queries, [{ table: 'profiles', columns: 'role', column: 'user_id', id: 'professional' }]);
});

test('cron checks only its current target account and never treats a synthetic actor as an admin grant', async () => {
  const fixture = database({ adminAccount: 'admin', professional: 'user' });
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'professional', actorAuthUserId: roles.ADMIN_USER_IDS[0], isCron: true }), false);
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'adminAccount', actorAuthUserId: 'professional', isCron: true }), true);
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'adminAccount', isCron: true }), true);
  assert.deepEqual(fixture.queries.map(query => query.id), ['professional', 'adminAccount', 'adminAccount']);
});

test('missing API identity, missing active account and non-boolean cron flags fail closed before lookup', async () => {
  const fixture = database({ adminAccount: 'admin' });
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'adminAccount' }), false);
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: '', actorAuthUserId: 'adminAccount' }), false);
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'adminAccount', isCron: 'true' as never }), false);
  assert.deepEqual(fixture.queries, []);
});

test('role revocation is effective on the next API or cron check without trusting a prior positive result', async () => {
  const fixture = database({ actor: 'admin', account: 'admin' });
  const request = { accountId: 'account', actorAuthUserId: 'actor' };
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, request), true);
  fixture.profiles.set('actor', { data: { role: 'user' } });
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, request), false);
  fixture.profiles.set('actor', { data: { role: 'admin' } });
  fixture.profiles.set('account', { data: { role: 'reviewer' } });
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, request), false);
  assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'account', isCron: true }), false);
  assert.equal(fixture.queries.length, 7);
});

test('missing profiles, unexpected role payloads, read errors and exceptions never grant admin options', async () => {
  for (const result of [
    { data: null }, { data: { role: 'ADMIN' } }, { data: { role: true } }, { data: [{ role: 'admin' }] },
    { data: { user_metadata: { role: 'admin' } } }, { data: { role: 'admin' }, error: { message: 'read failed' } },
    new Error('database unavailable'),
  ]) {
    const fixture = database();
    fixture.profiles.set('account', result);
    assert.equal(await policy.isInrAgentAdminAccount(fixture.client, 'account'), false);
    assert.equal(await policy.canUseInrAgentAdminOptions(fixture.client, { accountId: 'account', isCron: true }), false);
  }
});
