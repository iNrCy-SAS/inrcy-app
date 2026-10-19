/* eslint-disable @typescript-eslint/no-explicit-any -- JSON database fixtures cover heterogeneous retained payloads. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const ACTION = "00000000-0000-4000-8000-000000000003";
const JOB = "00000000-0000-4000-8000-000000000004";
const signature = "public.inrcy_set_agent_publication_channels(uuid,uuid,text[],timestamptz,uuid,jsonb,jsonb,boolean)";
const migration = ["20261019202159_agent_publication_channel_selection.sql","20261019211214_agent_empty_channel_review.sql"].map(file=>readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),"utf8")).join("\n");
const retained = { selectedChannels: ["facebook", "instagram", "tiktok"], postByChannel: { facebook: { content: "Original Facebook" }, instagram: { content: "Original Instagram" }, tiktok: { content: "Original TikTok" } }, imagesByChannel: { instagram: [{ id: "preserved-image" }] }, videoByChannel: { instagram: { id: "preserved-video" } }, mediaModeByChannel: { facebook: "images", instagram: "images" } };
async function rows(db: PGlite, sql: string, args: unknown[] = []) { return (await db.query<Record<string,any>>(sql,args)).rows; }
async function fixture() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls");
  for (const table of ["ACTIONS", "SCHEDULED_ACTIONS"]) {
    const ddl = readFileSync(new URL(`../../ops/SUPABASE_INR_AGENT_${table}.sql`,import.meta.url),"utf8");
    const schema = ddl.match(/create table if not exists public\.inr_agent_\w+ \([\s\S]*?\n\);/)?.[0];
    assert.ok(schema);
    await db.exec(schema.replace(/references auth\.users\(id\) on delete cascade/g,""));
  }
  await db.exec("grant all on public.inr_agent_actions, public.inr_agent_scheduled_actions to service_role; grant usage on schema public to service_role");
  await db.exec(migration);
  await db.exec("set role service_role");
  return db;
}
async function seed(db: PGlite, scheduled = false) {
  await db.exec("delete from public.inr_agent_scheduled_actions; delete from public.inr_agent_actions");
  await db.query(`insert into public.inr_agent_actions(id,user_id,automation_key,action_type,target_tool,title,target_channels,payload,status,scheduled_for)
    values($1,$2,'publish','publication','booster','Unchanged title',array['facebook','instagram','tiktok'],$3::jsonb,$4,'2099-01-01T12:00:00Z')`, [ACTION,USER,JSON.stringify(retained),scheduled ? "scheduled" : "pending_validation"]);
  if (scheduled) await db.query(`insert into public.inr_agent_scheduled_actions(id,user_id,automation_key,action_type,target_tool,title,scheduled_at,channels,payload)
    values($1,$2,'publish','publication','booster','Unchanged title','2099-01-01T12:00:00Z',array['facebook'],$3::jsonb)`,[JOB,USER,JSON.stringify({ sourceActionId: ACTION, mediaWorkspaceId: "immutable-workspace", retainedPublicationPayload: retained, publishPayload: { mediaWorkspaceId: "immutable-workspace", channels: ["facebook"], postByChannel: { facebook: retained.postByChannel.facebook }, images: [{ id: "shared-image" }], idempotencyKey: "old-row-key" } })]);
}
async function choose(db: PGlite, channels: string[], options: { user?: string; expected?: string; scheduledId?: string; confirm?: boolean } = {}) {
  const scheduled = options.scheduledId;
  const expected = options.expected || (await rows(db,`select updated_at::text as stamp from public.${scheduled ? "inr_agent_scheduled_actions" : "inr_agent_actions"} where id=$1`,[scheduled || ACTION]))[0].stamp;
  return (await rows(db,"select public.inrcy_set_agent_publication_channels($1::uuid,$2::uuid,$3::text[],$4::timestamptz,$5::uuid,null,null,$6::boolean) as result",[options.user || USER,scheduled ? null : ACTION,channels,expected,scheduled || null,options.confirm===true]))[0].result;
}

test("atomic channel selection preserves prepared and validated publications", async t => {
  const db = await fixture();
  try {
    await t.test("RPCs use invoker privileges and only the service can execute", async () => {
      for(const role of ["anon","authenticated"]) assert.equal((await rows(db,"select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,signature]))[0].allowed,false);
      assert.equal((await rows(db,"select prosecdef from pg_proc where oid=$1::regprocedure",[signature]))[0].prosecdef,false);
    });
    await t.test("uncheck, reload, recheck keeps all texts, images, videos and channel membership", async () => {
      await seed(db);
      assert.equal((await choose(db,["facebook"])).outcome,"saved");
      const unselected = (await rows(db,"select * from public.inr_agent_actions"))[0];
      const { publicationChannelSelection, ...payload } = unselected.payload;
      assert.deepEqual(payload,retained);
      assert.deepEqual(publicationChannelSelection.excludedChannels,["instagram","tiktok"]);
      assert.deepEqual(unselected.target_channels,retained.selectedChannels);
      assert.equal((await choose(db,["facebook","instagram","tiktok"])).outcome,"saved");
      assert.deepEqual((await rows(db,"select payload->'publicationChannelSelection' as selection from public.inr_agent_actions"))[0].selection.excludedChannels,[]);
    });
    await t.test("stale screens and other account IDs cannot overwrite the choice", async () => {
      await seed(db);
      const stamp=(await rows(db,"select updated_at::text as stamp from public.inr_agent_actions"))[0].stamp;
      await choose(db,["facebook"]);
      assert.equal((await choose(db,["instagram"],{ expected:stamp })).outcome,"stale");
      assert.equal((await choose(db,["instagram"],{ user:OTHER })).outcome,"not_found");
      assert.equal((await choose(db,["unprepared-network"])).outcome,"invalid_channels");
    });
    await t.test("zero selected pauses a validated schedule and rechecking resumes the same row", async () => {
      await seed(db,true);
      const before=(await rows(db,"select * from public.inr_agent_scheduled_actions"))[0];
      assert.equal((await choose(db,[])).outcome,"saved");
      const paused=(await rows(db,"select * from public.inr_agent_scheduled_actions"))[0];
      assert.equal(paused.status,"cancelled");
      assert.equal(paused.payload.publicationChannelSelectionPaused,true);
      assert.deepEqual(paused.channels,[]);
      assert.deepEqual(paused.payload.publicationChannelSelectionRowChannels,["facebook"]);
      assert.equal((await choose(db,["facebook"])).outcome,"saved");
      const resumed=(await rows(db,"select * from public.inr_agent_scheduled_actions"))[0];
      assert.equal(resumed.id,before.id);
      assert.equal(resumed.status,"scheduled");
      assert.deepEqual(resumed.payload.publishPayload,before.payload.publishPayload);
      assert.equal(String(resumed.scheduled_at),String(before.scheduled_at));
    });
    await t.test("a channel excluded before validation is restored without regenerating content", async () => {
      await seed(db,true);
      const result=await choose(db,["facebook","instagram"]);
      assert.equal(result.outcome,"saved");
      const jobs=await rows(db,"select * from public.inr_agent_scheduled_actions order by channels[1]");
      assert.equal(jobs.length,2);
      const instagram=jobs.find(row=>row.channels.includes("instagram"));
      assert.ok(instagram);
      assert.deepEqual(instagram.payload.publishPayload.postByChannel.instagram,retained.postByChannel.instagram);
      assert.deepEqual(instagram.payload.publishPayload.imagesByChannel.instagram,retained.imagesByChannel.instagram);
      assert.equal(instagram.payload.publishPayload.mediaWorkspaceId,"immutable-workspace");
      assert.equal(instagram.payload.publishPayload.idempotencyKey,undefined);
      const originalJob=jobs.find(row=>row.id===JOB);
      assert.ok(originalJob);
      assert.equal(originalJob.payload.publishPayload.idempotencyKey,"old-row-key");
    });
    await t.test("TikTok consent failure cannot partially create other restored jobs", async () => {
      await seed(db,true);
      assert.equal((await choose(db,["facebook","instagram","tiktok"])).outcome,"tiktok_settings_required");
      assert.equal((await rows(db,"select count(*)::int as n from public.inr_agent_scheduled_actions"))[0].n,1);
      assert.deepEqual((await rows(db,"select payload from public.inr_agent_actions"))[0].payload,retained);
    });
    await t.test("started, completed or cancelled schedules stay immutable", async () => {
      for(const status of ["running","done","failed","cancelled"]) {
        await seed(db,true);
        await db.query("update public.inr_agent_scheduled_actions set status=$1",[status]);
        const before=await rows(db,"select * from public.inr_agent_scheduled_actions");
        assert.notEqual((await choose(db,["instagram"])).outcome,"saved");
        assert.deepEqual(await rows(db,"select * from public.inr_agent_scheduled_actions"),before);
      }
      await seed(db);
      await db.exec("update public.inr_agent_actions set status='completed'");
      assert.equal((await choose(db,["instagram"])).outcome,"publication_started");
    });
    await t.test("editing a scheduled row updates the original selection too", async () => {
      await seed(db,true);
      assert.equal((await choose(db,[],{ scheduledId:JOB })).outcome,"saved");
      assert.deepEqual((await rows(db,"select payload#>'{publicationChannelSelection,excludedChannels}' as excluded from public.inr_agent_actions"))[0].excluded,["facebook","instagram","tiktok"]);
    });
    await t.test("a confirmation prepared before a selection change is rejected atomically", async () => {
      await seed(db);
      await choose(db,["facebook"]);
      const result=(await rows(db,"select public.inrcy_confirm_editorial_publication_schedule($1,$2,$3::jsonb) as result",[ACTION,USER,JSON.stringify([{ channels:["facebook","instagram"],payload:{ sourceActionId:ACTION } }])]))[0].result;
      assert.equal(result.outcome,"channels_changed");
      assert.equal((await rows(db,"select count(*)::int as n from public.inr_agent_scheduled_actions"))[0].n,0);
    });
    await t.test("a newly connected channel retains the existing assets and stays unselected until reviewed", async () => {
      await seed(db,true);
      const stamp=(await rows(db,"select updated_at::text as stamp from public.inr_agent_actions"))[0].stamp;
      const preparation={ channel:"x",post:{ content:"Prepared for X" },imagesByChannel:[{ id:"preserved-image" }],mediaModeByChannel:"images" };
      const result=(await rows(db,"select public.inrcy_set_agent_publication_channels($1,$2,$3::text[],$4,null,$5::jsonb) as result",[USER,ACTION,["facebook"],stamp,JSON.stringify(preparation)]))[0].result;
      assert.equal(result.outcome,"saved");
      assert.ok(result.action.target_channels.includes("x"));
      assert.ok(result.action.payload.publicationChannelSelection.excludedChannels.includes("x"));
      assert.deepEqual(result.action.payload.postByChannel.facebook,retained.postByChannel.facebook);
      assert.equal(result.scheduledActions.length,1);
      assert.equal((await choose(db,["facebook","x"])).outcome,"saved");
      assert.equal((await rows(db,"select count(*)::int as n from public.inr_agent_scheduled_actions where channels @> array['x']"))[0].n,0);
      assert.equal((await choose(db,["facebook","x"],{confirm:true})).outcome,"saved");
      const restored=(await rows(db,"select payload from public.inr_agent_scheduled_actions where channels @> array['x']"))[0];
      assert.deepEqual(restored.payload.publishPayload.postByChannel.x,preparation.post);
      assert.deepEqual(restored.payload.publishPayload.imagesByChannel.x,preparation.imagesByChannel);
    });
    await t.test("selecting an empty channel never creates a dispatch and generation still requires approval on a schedule", async () => {
      for(const scheduled of [false,true]) {
        await seed(db,scheduled);
        const checked=await choose(db,["facebook","x"]);
        assert.equal(checked.outcome,"saved");
        assert.deepEqual(checked.action.payload.publicationChannelSelection.pendingChannels,["x"]);
        assert.equal(checked.action.payload.postByChannel.x,undefined);
        assert.equal((await choose(db,["facebook","x"],{confirm:true})).outcome,"channel_empty");
        const preparation={channel:"x",post:{content:"Review this new caption"},imagesByChannel:[{id:"existing-image"}],mediaModeByChannel:"images"};
        const generated=(await rows(db,"select public.inrcy_set_agent_publication_channels($1,$2,$3::text[],$4,null,$5::jsonb) as result",[USER,ACTION,["facebook","x"],checked.action.updated_at,JSON.stringify(preparation)]))[0].result;
        assert.equal(generated.outcome,"saved");
        assert.equal(generated.action.payload.publicationChannelSelection.pendingChannels,undefined);
        assert.deepEqual(generated.action.payload.postByChannel.facebook,retained.postByChannel.facebook);
        assert.equal((await rows(db,"select count(*)::int as n from public.inr_agent_scheduled_actions where channels @> array['x']"))[0].n,0);
        if(scheduled) {
          assert.deepEqual(generated.action.payload.publicationChannelSelection.unvalidatedChannels,["x"]);
          await choose(db,["facebook"]);
          const rechecked=await choose(db,["facebook","x"]);
          assert.deepEqual(rechecked.action.payload.publicationChannelSelection.unvalidatedChannels,["x"]);
          assert.equal((await choose(db,["facebook","x"],{confirm:true})).outcome,"saved");
          assert.equal((await rows(db,"select count(*)::int as n from public.inr_agent_scheduled_actions where channels @> array['x']"))[0].n,1);
        }
      }
    });
    await t.test("explicit TikTok confirmation can activate a newly prepared future channel", async () => {
      await seed(db,true);
      const stamp=(await rows(db,"select updated_at::text as stamp from public.inr_agent_actions"))[0].stamp;
      const settings={musicUsageConfirmed:true,privacyLevel:"SELF_ONLY",commercialContent:"none"};
      const result=(await rows(db,"select public.inrcy_set_agent_publication_channels($1,$2,$3::text[],$4,null,null,$5::jsonb) as result",[USER,ACTION,["facebook","tiktok"],stamp,JSON.stringify(settings)]))[0].result;
      assert.equal(result.outcome,"saved");
      const tiktok=result.scheduledActions.find((job:any)=>job.channels.includes("tiktok"));
      assert.ok(tiktok);
      assert.deepEqual(tiktok.payload.publishPayload.tiktokPublicationSettings,settings);
    });
  } finally { await db.close(); }
});
