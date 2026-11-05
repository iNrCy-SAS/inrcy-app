import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeModules } from '../inragent/runtime-module-loader.mts';
const account = '10000000-0000-4000-8000-000000000001', actor = '20000000-0000-4000-8000-000000000002', other = '30000000-0000-4000-8000-000000000003';
test('persistent ADN reset refuses a changed dialog account or actor before any read deletion or storage operation', async () => {
  let reads = 0;
  const forbidden = () => { reads++; throw new Error('No business operation is allowed for a stale confirmation'); };
  const load = runtimeModules({ 'next/server': { NextResponse: { json: Response.json } }, '@/lib/requireUser': { requireUser: async () => ({ activeUserId: account, authUserId: actor, supabase: { from: forbidden } }) }, '@/lib/supabaseAdmin': { supabaseAdmin: { rpc: forbidden, storage: { from: forbidden } } }, '@/lib/boosterGenerationContext': { invalidateBoosterGenerationContext: forbidden } });
  const route = load<typeof import('../../app/api/ai-memory/reset/route.ts')>('app/api/ai-memory/reset/route.ts');
  for (const body of [{ tab: 'all', expectedAccountId: other, expectedActorUserId: actor }, { tab: 'documents', expectedAccountId: account, expectedActorUserId: other }, { tab: 'profile', expectedAccountId: account }, { tab: 'all', expectedAccountId: 'not-a-scope', expectedActorUserId: actor }]) {
    const response = await route.POST(new Request('https://app.test/api/ai-memory/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'reset_scope_changed');
  }
  assert.equal(reads, 0);
});
