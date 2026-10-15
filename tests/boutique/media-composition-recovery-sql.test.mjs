import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('composition checkpoint SQL fences workers, owns accounts, preserves quota and completes once', async (t) => {
  const db = await createMediaCreditDatabase({ preferences: true });
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    await db.exec('create schema storage; create table storage.objects(id uuid primary key,bucket_id text,name text,created_at timestamptz);');
    const legacyAccount = randomUUID(), legacyActor = randomUUID();
    await db.query('insert into auth.users values($1),($2)', [legacyAccount, legacyActor]);
    await db.query('insert into public.inrcy_accounts(id) values($1)', [legacyAccount]);
    await db.query("insert into public.inrcy_account_members values($1,$2,'owner')", [legacyAccount, legacyActor]);
    await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)", [legacyAccount]);
    const legacy = await one("select * from public.reserve_ai_media_generation_v2($1,$2,$3,$4,'video','studio','standard',8,3600,null,'{}')", [legacyAccount, legacyActor, randomUUID(), 'b'.repeat(64)]);
    for (const migration of ['20261013100955_unified_media_credits.sql','20261015174302_ai_media_reliability_finalization_and_temp_cleanup.sql','20261015175225_ai_media_composition_recovery.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
    }
    const account = randomUUID(), actor = randomUUID();
    await db.query('insert into auth.users values($1),($2)', [account, actor]);
    await db.query('insert into public.inrcy_accounts(id) values($1)', [account]);
    await db.query("insert into public.inrcy_account_members values($1,$2,'owner')", [account, actor]);
    await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)", [account]);
    const reserve = () => one(`select * from public.reserve_ai_media_generation_v3($1,$2,$3,$4,'video','studio','standard',80,3600,null,'{}')`, [account, actor, randomUUID(), 'a'.repeat(64)]);
    const start = (job, token) => one('select public.start_ai_media_composition_checkpoint($1,$2,$3,$4) value', [account, job.job_id, actor, token]);
    const ready = (job, token) => one('select public.ready_ai_media_composition_checkpoint($1,$2,$3,$4) value', [account, job.job_id, token, `${account}/_composition-recovery/${job.job_id}/${randomUUID()}/manifest.json`]);
    const release = (job, token) => one('select public.release_ai_media_composition_checkpoint($1,$2,$3) value', [account, job.job_id, token]);
    const claim = () => one('select * from public.claim_ai_media_composition_checkpoint()');
    const has = (job) => one('select public.has_ai_media_composition_checkpoint($1,$2) value', [account, job.job_id]);

    await t.test('initial owner lease excludes cron and checks tenant, actor, path and token', async () => {
      const job = await reserve(), token = randomUUID();
      await assert.rejects(one('select public.start_ai_media_composition_checkpoint($1,$2,$3,$4)', [randomUUID(), job.job_id, actor, token]), /SCOPE_MISMATCH/);
      await assert.rejects(one('select public.start_ai_media_composition_checkpoint($1,$2,$3,$4)', [account, job.job_id, randomUUID(), token]), /SCOPE_MISMATCH/);
      await start(job, token);
      await assert.rejects(start(job, randomUUID()), /LEASE_CONFLICT/);
      await assert.rejects(one('select public.ready_ai_media_composition_checkpoint($1,$2,$3,$4)', [account, job.job_id, token, `${randomUUID()}/_composition-recovery/${job.job_id}/${randomUUID()}/manifest.json`]), /PATH_INVALID/);
      await ready(job, token);
      assert.equal(await claim(), undefined);
      assert.equal((await release(job, randomUUID())).value, false);
      await db.query("update public.ai_media_generation_jobs set reservation_expires_at=now()-interval '1 second' where id=$1", [job.job_id]);
      await db.query('select public.expire_ai_media_credit_reservations(100,$1)', [account]);
      assert.equal((await one('select status from public.ai_media_generation_jobs where id=$1', [job.job_id])).status, 'reserved');
      await release(job, token);
      const worker = await claim();
      assert.equal(worker.job_id, job.job_id);
      assert.notEqual(worker.lease_token, token);
      assert.equal(await claim(), undefined, 'a second worker cannot claim an active lease');
      await assert.rejects(one('select public.assert_ai_media_composition_lease($1,$2,$3)', [account, job.job_id, token]), /LEASE_CONFLICT/);
      const media = randomUUID();
      await db.query(`insert into public.pro_media_library(id,user_id,account_id,client_media_key,media_type,source,upload_protocol,upload_status,is_active)
        values($1,$2,$2,$3,'video','ai_media_generation_draft','server_legacy','uploaded',false)`, [media, account, `ai-media:${job.job_id}`]);
      for (let i = 0; i < 3; i++) await db.query("select * from public.complete_ai_media_generation_v3($1,$2,$3,'{}')", [account, job.job_id, media]);
      assert.equal((await one("select count(*)::integer count from public.ai_media_credit_ledger where job_id=$1 and kind='completion'", [job.job_id])).count, 1);
      assert.equal((await one('select used_count from public.ai_media_credit_periods where account_id=$1', [account])).used_count, 80);
      await one('select public.finish_ai_media_composition_checkpoint($1,$2,$3)', [account, job.job_id, worker.lease_token]);
      assert.equal((await has(job)).value, false);
    });
    await t.test('crashed lease can be reclaimed, third failed attempt releases exactly one reservation', async () => {
      const job = await reserve(), token = randomUUID();
      await start(job, token); await ready(job, token);
      await db.query("update public.ai_media_composition_checkpoints set lease_until=now()-interval '1 second' where job_id=$1", [job.job_id]);
      for (let i = 1; i <= 3; i++) {
        const worker = await claim();
        assert.equal(worker.attempts, i);
        if (i === 3) assert.equal((await has(job)).value, true, 'last worker remains protected while holding its lease');
        await release(job, worker.lease_token);
      }
      assert.equal((await has(job)).value, false);
      assert.equal(await claim(), undefined);
      await db.query('select public.expire_ai_media_credit_reservations(100,$1)', [account]);
      assert.equal((await one('select status from public.ai_media_generation_jobs where id=$1', [job.job_id])).status, 'expired');
      assert.equal((await one('select reserved_count from public.ai_media_credit_periods where account_id=$1', [account])).reserved_count, 0);
    });
    await t.test('TTL expires an unclaimed checkpoint and incomplete uploads can be released', async () => {
      const job = await reserve(), token = randomUUID();
      await start(job, token); await ready(job, token);
      await db.query("update public.ai_media_composition_checkpoints set expires_at=now()-interval '1 second' where job_id=$1", [job.job_id]);
      await db.query("update public.ai_media_generation_jobs set reservation_expires_at=now()-interval '1 second' where id=$1", [job.job_id]);
      await db.query('select public.expire_ai_media_credit_reservations(100,$1)', [account]);
      assert.equal((await one('select status from public.ai_media_generation_jobs where id=$1', [job.job_id])).status, 'expired');
      const partial = await reserve(), partialToken = randomUUID();
      await start(partial, partialToken);
      await one('select public.abandon_ai_media_composition_checkpoint($1,$2,$3)', [account, partial.job_id, partialToken]);
      const expiry = await one('select reservation_expires_at>now()+interval \'14 minutes\' and reservation_expires_at<=now()+interval \'15 minutes\' safe from public.ai_media_generation_jobs where id=$1', [partial.job_id]);
      assert.equal(expiry.safe, true, 'advisory failure lets the healthy original request finish without stranding credits for 24h');
      assert.equal((await has(partial)).value, false);
      assert.equal(await claim(), undefined);
    });
    await t.test('every checkpoint function and table is inaccessible to user roles', async () => {
      const signatures = (await db.query(`select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname like '%ai_media_composition%'`)).rows;
      for (const role of ['anon','authenticated']) for (const f of signatures) {
        assert.equal((await one('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, f.signature])).allowed, false, `${role} ${f.signature}`);
      }
      await db.exec('set role authenticated');
      await assert.rejects(db.query('select * from public.ai_media_composition_checkpoints'), /permission denied/);
      await db.exec('reset role');
    });
    await t.test('hard crash during upload or final retry releases stranded reservations after lease expiry', async () => {
      for (const finalRetry of [false, true]) {
        const stranded = await reserve(), token = randomUUID();
        await start(stranded, token);
        if (finalRetry) {
          await ready(stranded, token);
          await db.query('update public.ai_media_composition_checkpoints set attempts=3 where job_id=$1', [stranded.job_id]);
        }
        await db.query("update public.ai_media_composition_checkpoints set lease_until=now()-interval '1 second' where job_id=$1", [stranded.job_id]);
        assert.equal(await claim(), undefined);
        await db.query('select public.expire_ai_media_credit_reservations(100,$1)', [account]);
        assert.equal((await one('select status from public.ai_media_generation_jobs where id=$1', [stranded.job_id])).status, 'expired');
      }
    });
    await t.test('legacy lazy and global expiry also protect an active checkpoint', async () => {
      const token = randomUUID();
      await one('select public.start_ai_media_composition_checkpoint($1,$2,$3,$4)', [legacyAccount, legacy.job_id, legacyActor, token]);
      await one('select public.ready_ai_media_composition_checkpoint($1,$2,$3,$4)', [legacyAccount, legacy.job_id, token, `${legacyAccount}/_composition-recovery/${legacy.job_id}/${randomUUID()}/manifest.json`]);
      await db.query("update public.ai_media_generation_jobs set reservation_expires_at=now()-interval '1 second' where id=$1", [legacy.job_id]);
      await db.query('select public.ai_media_expire_account_reservations($1,100)', [legacyAccount]);
      await db.query('select public.expire_ai_media_generation_reservations(100)');
      assert.equal((await one('select status from public.ai_media_generation_jobs where id=$1', [legacy.job_id])).status, 'reserved');
    });
    await t.test('completed then discarded draft is finalized without claiming another composition', async () => {
      const job = await reserve(), token = randomUUID(), media = randomUUID();
      await start(job, token); await ready(job, token);
      await db.query(`insert into public.pro_media_library(id,user_id,account_id,client_media_key,media_type,source,upload_protocol,upload_status,is_active)
        values($1,$2,$2,$3,'video','ai_media_generation_draft','server_legacy','uploaded',false)`, [media, account, `ai-media:${job.job_id}`]);
      await db.query('delete from public.pro_media_library where id=$1', [media]);
      await db.query("update public.ai_media_composition_checkpoints set lease_until=now()-interval '1 second' where job_id=$1", [job.job_id]);
      assert.equal(await claim(), undefined, 'cron has no payload to recompose or upload');
      assert.equal((await one('select state from public.ai_media_composition_checkpoints where job_id=$1', [job.job_id])).state, 'finished');
      assert.equal((await one('select output_media_id from public.ai_media_generation_jobs where id=$1', [job.job_id])).output_media_id, null);
    });
  } finally { await db.close(); }
});
