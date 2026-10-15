import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('late completion enriches a charged draft once and temp cleanup inventory stays scoped', async (t) => {
  const db = await createMediaCreditDatabase({ preferences: true });
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    await db.exec(await readFile(new URL('../../supabase/migrations/20261013100955_unified_media_credits.sql', import.meta.url), 'utf8'));
    await db.exec('create schema storage; create table storage.objects(id uuid primary key,bucket_id text,name text,created_at timestamptz);');
    const migration = await readFile(new URL('../../supabase/migrations/20261015174302_ai_media_reliability_finalization_and_temp_cleanup.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    const account = randomUUID(), actor = randomUUID(), media = randomUUID();
    await db.query('insert into auth.users values($1),($2)', [account, actor]);
    await db.query('insert into public.inrcy_accounts(id) values($1)', [account]);
    await db.query("insert into public.inrcy_account_members values($1,$2,'owner')", [account, actor]);
    await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)", [account]);
    const job = await one(`select * from public.reserve_ai_media_generation_v3($1,$2,$3,$4,'image','studio','standard',7,3600,null,'{"quote_version":"reserved-quote"}')`,
      [account, actor, randomUUID(), 'a'.repeat(64)]);
    await db.query(`insert into public.pro_media_library(id,user_id,account_id,client_media_key,media_type,source,upload_protocol,upload_status,is_active)
      values($1,$2,$2,$3,'image','ai_media_generation_draft','server_legacy','uploaded',false)`, [media, account, `ai-media:${job.job_id}`]);

    await t.test('draft trigger debit remains unchanged by repeated metadata enrichment', async () => {
      const before = await one('select status,metadata,completed_at from public.ai_media_generation_jobs where id=$1', [job.job_id]);
      assert.equal(before.status, 'completed');
      const financial = () => one(`select (select count(*) from public.ai_media_credit_ledger where job_id=$1)::integer ledger_count,
        (select used_count from public.ai_media_credit_periods where account_id=$2) used,
        (select reserved_count from public.ai_media_credit_periods where account_id=$2) reserved,
        (select purchased_used from public.ai_media_credit_wallets where account_id=$2) purchased_used`, [job.job_id, account]);
      const baseline = await financial();
      const metadata = { model: 'test-model', prompt_version: 'v1', prompt_sha256: 'b'.repeat(64), casting_variant_key: 'variant-1',
        soundtrack_id: 'music-1', video_engine_result: { engine: 'test' }, pipeline_timings_ms: { composition: 12 },
        quote_version: 'must-not-overwrite', arbitrary_user_prompt: 'must-not-persist' };
      for (let i = 0; i < 3; i++) await one('select * from public.complete_ai_media_generation_v3($1,$2,$3,$4)', [account, job.job_id, media, JSON.stringify(metadata)]);
      const after = await one('select status,metadata,completed_at from public.ai_media_generation_jobs where id=$1', [job.job_id]);
      assert.equal(after.metadata.quote_version, 'reserved-quote');
      assert.equal(after.metadata.casting_variant_key, 'variant-1');
      assert.equal(after.metadata.soundtrack_id, 'music-1');
      assert.deepEqual(after.metadata.pipeline_timings_ms, { composition: 12 });
      assert.equal(after.metadata.temporary_draft_created, true);
      assert.equal(Object.hasOwn(after.metadata, 'arbitrary_user_prompt'), false);
      assert.deepEqual(after.completed_at, before.completed_at);
      assert.deepEqual(await financial(), baseline);
      assert.equal(baseline.used, 7);
      assert.equal(baseline.reserved, 0);
      await assert.rejects(one("select * from public.complete_ai_media_generation_v3($1,$2,$3,'{}')", [account, job.job_id, randomUUID()]), /COMPLETION_CONFLICT/);
      await assert.rejects(one("select * from public.fail_ai_media_generation_v3($1,$2,'failed','failed','{}')", [account, job.job_id]), /JOB_TERMINAL/);
      await assert.rejects(one("select * from public.complete_ai_media_generation_v3($1,$2,$3,'{}')", [randomUUID(), job.job_id, media]), /JOB_NOT_FOUND/);
    });

    await t.test('inventory returns only old provider images with bounded batches and deterministic order', async () => {
      const folder = `${account}/_provider-temp/${randomUUID()}`;
      const old1 = `${folder}/0.jpg`, old2 = `${folder}/1.webp`;
      const candidates = [
        [old1, 'inrcy-pro-media', 4], [old2, 'inrcy-pro-media', 3],
        [`${folder}/2.png`, 'inrcy-pro-media', 1], [`${folder}/3.png`, 'other-bucket', 5],
        [`${account}/library/4.png`, 'inrcy-pro-media', 5], [`prefix/${folder}/5.jpg`, 'inrcy-pro-media', 5],
        [`not-a-uuid/_provider-temp/${randomUUID()}/6.jpg`, 'inrcy-pro-media', 5],
        [`${folder}/7.mp4`, 'inrcy-pro-media', 5], [`${folder}/nested/8.jpg`, 'inrcy-pro-media', 5],
      ];
      for (const [name, bucket, hours] of candidates) await db.query("insert into storage.objects values($1,$2,$3,now()-($4||' hours')::interval)", [randomUUID(), bucket, name, hours]);
      const inventory = (limit) => db.query('select * from public.list_expired_ai_media_provider_images($1)', [limit]);
      assert.deepEqual((await inventory(100)).rows.map(row => row.storage_path), [old1, old2]);
      assert.deepEqual((await inventory(0)).rows.map(row => row.storage_path), [old1]);
      for (let i = 0; i < 105; i++) await db.query("insert into storage.objects values($1,'inrcy-pro-media',$2,now()-interval '3 hours')", [randomUUID(), `${folder}/${i + 10}.png`]);
      assert.equal((await inventory(10000)).rows.length, 100);
      assert.equal((await one('select count(*)::integer count from storage.objects')).count, 114, 'inventory never deletes SQL storage rows');
    });

    await t.test('both functions remain service-only and cleanup does not expose the Storage table', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        await assert.rejects(db.query('select * from public.list_expired_ai_media_provider_images()'), /permission denied/);
        await assert.rejects(one("select * from public.ai_media_credit_finish($1,$2,$3,'completed',null,null,'{}')", [account, job.job_id, media]), /permission denied/);
        await db.exec('reset role');
      }
      await db.exec('set role service_role');
      assert.equal((await db.query('select * from public.list_expired_ai_media_provider_images(1)')).rows.length, 1);
      await assert.rejects(db.query('select * from storage.objects'), /permission denied/);
      await db.exec('reset role');
    });
  } finally { await db.close(); }
});
