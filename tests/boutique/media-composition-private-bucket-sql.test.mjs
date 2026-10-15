import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createMediaCreditDatabase} from '../helpers/media-credit-sql-fixture.mjs';

test('private composition storage supports exact payload types without opening the media library',async(t)=>{
 const db=await createMediaCreditDatabase({preferences:true});
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 try{
  await db.exec(`create schema storage;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key,bucket_id text,name text,created_at timestamptz);
   alter table storage.buckets enable row level security;alter table storage.objects enable row level security;
   grant usage on schema storage to anon,authenticated,service_role;
   grant select,insert,update,delete on storage.buckets,storage.objects to anon,authenticated,service_role;
   create policy broad_objects on storage.objects for all to anon,authenticated using(true) with check(true);
   create policy broad_buckets on storage.buckets for all to anon,authenticated using(true) with check(true);
   insert into storage.buckets values('inrcy-pro-media','inrcy-pro-media',false,314572800,array['video/mp4','image/png','audio/mpeg']);`);
  for(const name of ['20261013100955_unified_media_credits.sql','20261015174302_ai_media_reliability_finalization_and_temp_cleanup.sql','20261015175225_ai_media_composition_recovery.sql'])
   await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
  const account=randomUUID(),actor=randomUUID();
  await db.query('insert into auth.users values($1),($2)',[account,actor]);
  await db.query('insert into public.inrcy_accounts(id) values($1)',[account]);
  await db.query("insert into public.inrcy_account_members values($1,$2,'owner')",[account,actor]);
  await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)",[account]);
  const reserve=()=>one("select * from public.reserve_ai_media_generation_v3($1,$2,$3,$4,'video','studio','standard',80,3600,null,'{}')",[account,actor,randomUUID(),'a'.repeat(64)]);
  const legacy=await reserve(),legacyToken=randomUUID();
  await db.query('select public.start_ai_media_composition_checkpoint($1,$2,$3,$4)',[account,legacy.job_id,actor,legacyToken]);
  const priorBucket=await one("select * from storage.buckets where id='inrcy-pro-media'");
  await db.exec(await readFile(new URL('../../supabase/migrations/20261015184433_ai_media_composition_private_bucket.sql',import.meta.url),'utf8'));

  await t.test('private bucket has exactly the audio/manifest formats and bounded size; legacy bucket unchanged',async()=>{
   const bucket=await one("select * from storage.buckets where id='inrcy-ai-composition'");
   assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),134217728);
   assert.deepEqual(bucket.allowed_mime_types,['video/mp4','image/png','audio/wav','audio/mpeg','audio/ogg','audio/aac','application/json']);
   assert.deepEqual(await one("select * from storage.buckets where id='inrcy-pro-media'"),priorBucket);
  });

  await t.test('restrictive policies deny all user access even with broad permissive policies',async()=>{
   const object=randomUUID();
   await db.query("insert into storage.objects values($1,'inrcy-ai-composition','private-test',now())",[object]);
   for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    assert.equal((await db.query("select * from storage.buckets where id='inrcy-ai-composition'")).rows.length,0);
    assert.equal((await db.query('select * from storage.objects where id=$1',[object])).rows.length,0);
    await assert.rejects(db.query("insert into storage.objects values($1,'inrcy-ai-composition','unauthorized',now())",[randomUUID()]),/row-level security/);
    assert.equal((await db.query("update storage.buckets set public=true where id='inrcy-ai-composition' returning id")).rows.length,0);
    assert.equal((await db.query('delete from storage.objects where id=$1 returning id',[object])).rows.length,0);
    assert.equal((await db.query("select * from storage.buckets where id='inrcy-pro-media'")).rows.length,1);
    await db.exec('reset role');
   }
   await db.exec('set role service_role');
   assert.equal((await db.query('select * from storage.objects where id=$1',[object])).rows.length,1);
   await db.exec('reset role');
  });

  await t.test('old and new writers keep their actual bucket and old workers cannot claim new inputs',async()=>{
   assert.equal((await one('select storage_bucket from public.ai_media_composition_checkpoints where job_id=$1',[legacy.job_id])).storage_bucket,'inrcy-pro-media');
   const fresh=await reserve(),freshToken=randomUUID();
   await db.query('select public.start_ai_media_composition_checkpoint_v2($1,$2,$3,$4)',[account,fresh.job_id,actor,freshToken]);
   assert.equal((await one('select storage_bucket from public.ai_media_composition_checkpoints where job_id=$1',[fresh.job_id])).storage_bucket,'inrcy-ai-composition');
   for(const [job,token]of [[legacy,legacyToken],[fresh,freshToken]]){
    await db.query('select public.ready_ai_media_composition_checkpoint($1,$2,$3,$4)',[account,job.job_id,token,`${account}/_composition-recovery/${job.job_id}/${randomUUID()}/manifest.json`]);
    await db.query('select public.release_ai_media_composition_checkpoint($1,$2,$3)',[account,job.job_id,token]);
   }
   assert.equal((await one('select * from public.claim_ai_media_composition_checkpoint()')).job_id,legacy.job_id);
   assert.equal(await one('select * from public.claim_ai_media_composition_checkpoint()'),undefined);
   const claimed=await one('select * from public.claim_ai_media_composition_checkpoint_v2()');
   assert.equal(claimed.job_id,fresh.job_id);assert.equal(claimed.storage_bucket,'inrcy-ai-composition');assert.equal(claimed.attempts,1);
   assert.equal(await one('select * from public.claim_ai_media_composition_checkpoint_v2()'),undefined);
   const laterLegacy=await reserve();
   await db.query('select public.start_ai_media_composition_checkpoint($1,$2,$3,$4)',[account,laterLegacy.job_id,actor,randomUUID()]);
   assert.equal((await one('select storage_bucket from public.ai_media_composition_checkpoints where job_id=$1',[laterLegacy.job_id])).storage_bucket,'inrcy-pro-media');
  });

  await t.test('cleanup keeps legacy partial uploads bounded and excludes fresh, final or unrelated objects',async()=>{
   const folder=`${account}/_composition-recovery/${randomUUID()}/${randomUUID()}`;
   for(const [bucket,name,hours]of [
    ['inrcy-pro-media',`${folder}/clip-0.mp4`,27],['inrcy-ai-composition',`${folder}/manifest.json`,26],
    ['inrcy-ai-composition',`${folder}/narration.wav`,1],['inrcy-ai-composition',`users/${account}/ai-generated/video/final.mp4`,30],
    ['unrelated',`${folder}/manifest.json`,30],['inrcy-pro-media',`${folder}/nested/clip-1.mp4`,30]])
    await db.query("insert into storage.objects values($1,$2,$3,now()-($4||' hours')::interval)",[randomUUID(),bucket,name,hours]);
   assert.deepEqual((await db.query('select * from public.list_expired_ai_media_composition_objects_v2(100)')).rows,[
    {storage_bucket:'inrcy-pro-media',storage_path:`${folder}/clip-0.mp4`},
    {storage_bucket:'inrcy-ai-composition',storage_path:`${folder}/manifest.json`}]);
   assert.equal((await db.query('select * from public.list_expired_ai_media_composition_objects(100)')).rows.length,1);
   assert.equal((await db.query('select * from public.list_expired_ai_media_composition_objects_v2(0)')).rows.length,1);
  });

  await t.test('new RPCs are service-only with fixed search paths',async()=>{
   for(const signature of ['public.start_ai_media_composition_checkpoint_v2(uuid,uuid,uuid,uuid)','public.claim_ai_media_composition_checkpoint_v2()','public.list_expired_ai_media_composition_objects_v2(integer)']){
    for(const role of ['anon','authenticated','service_role'])assert.equal((await one("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).ok,role==='service_role');
    assert.ok((await one('select proconfig from pg_proc where oid=$1::regprocedure',[signature])).proconfig.includes('search_path=""'));
   }
  });
 }finally{await db.close();}
});
