import assert from "node:assert/strict";
import test from "node:test";
import { historicalVisibilityRewardRanges as ranges, historicalVisibilityRewardMonths as months, historicalRewardReportsToVerify as reportsToVerify } from "../../lib/inrstats/visibilityRewardHistory.ts";
import { buildSnapshotWindow } from "../../lib/stats/snapshotWindow.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
const now = new Date("2026-10-24T17:00:00Z");
function report(end="2026-09-30", days=30) {
  const w=buildSnapshotWindow({days,snapshotDate:end,now});
  return {days,meta:{snapshotDate:end},sources:{facebook:{connected:true,metrics:{range:{since:w.start.toISOString(),until:w.end.toISOString()},totals:{views:0}}}}};
}
test("a real zero-valued provider range establishes history without inventing index values",()=>{
  assert.deepEqual(ranges(report(),now),[{channel_key:"facebook",starts_on:"2026-09-01",ends_on:"2026-09-30"}]);
});
test("current followers, missing/invalid totals and mismatched/preserved ranges cannot establish past history",()=>{
  for(const totals of [{followers:5000},{views:null},{views:""},{views:-1},{views:false},{views:Infinity}]) {const p=report();p.sources.facebook.metrics.totals=totals as {views:number};assert.deepEqual(ranges(p,now),[]);}
  for(const patch of [{error:"unavailable"},{needs_reconnect:true},{range:{since:"2026-01-01",until:"2026-01-31"}}]) {const p=report();Object.assign(p.sources.facebook.metrics,patch);assert.deepEqual(ranges(p,now),[]);}
  const saved=report();Object.assign(saved.meta,{preservedReason:"technical_refresh_failure"});assert.deepEqual(ranges(saved,now),[]);
  assert.deepEqual(ranges(report("2026-11-30"),now),[]);assert.deepEqual(ranges(report("2024-09-30"),now),[]);
});
test("Paris provider date bounds work across both daylight saving changes",()=>{
  assert.deepEqual(ranges(report("2026-03-31",31),now).map(r=>r.starts_on),["2026-03-01"]);
  assert.deepEqual(ranges(report("2026-10-24",24),now).map(r=>r.starts_on),["2026-10-01"]);
  assert.deepEqual(ranges(report("2025-10-31",31),now).map(r=>r.starts_on),["2025-10-01"]);
});
const coverage=(start:string,end:string)=>({channel_key:"facebook",starts_on:start,ends_on:end});
test("historical bonuses require both account age and sufficient calendar coverage",()=>{
  const full=[coverage("2026-07-01","2026-07-31"),coverage("2026-08-01","2026-08-31"),coverage("2026-09-01","2026-09-30")];
  assert.deepEqual(months(full,"2026-01-01",now),[1,3]);
  assert.deepEqual(months(full,"2026-10-01",now),[]);
  assert.deepEqual(months(full,"2026-09-15",now),[]);
  assert.deepEqual(months([],"2020-01-01",now),[]);
});
test("duplicate, nested, overlapping and cross-channel reports cannot multiply seniority",()=>{
  const one=coverage("2026-09-01","2026-09-30");
  assert.deepEqual(months(Array(30).fill(one),"2020-01-01",now),[1]);
  const full=[coverage("2026-07-01","2026-09-30"),coverage("2026-07-05","2026-07-10"),{...coverage("2026-09-25","2026-10-24"),channel_key:"gmb"}];
  assert.deepEqual(months(full,"2020-01-01",now),[1,3]);
  assert.deepEqual(months([coverage("2026-07-01","2026-07-31"),coverage("2026-09-01","2026-09-30")],"2020-01-01",now),[1]);
});
test("calendar anniversaries clamp at month ends and old earned periods remain eligible",()=>{
  assert.deepEqual(months([coverage("2026-01-31","2026-02-27")],"2020-01-01",now),[1]);
  assert.deepEqual(months([coverage("2025-10-24","2026-10-23")],"2020-01-01",now),[1,3,6,12]);
  assert.deepEqual(months([coverage("2026-09-24","2026-10-24")],"2026-09-25",now),[]);
});
test("browser-writable legacy caches are never imported as trusted reward evidence",async()=>{
  let updated=false;
  const q={select(){return q;},eq(key:string,id:string){assert.equal(key,"user_id");assert.equal(id,"account");return q;},maybeSingle:async()=>({data:{reward_history_checked_at:null},error:null}),update(){updated=true;return q;},then(resolve:(r:unknown)=>unknown){return Promise.resolve(resolve({error:null}));}};
  const load=runtimeModules({"@/lib/supabaseAdmin":{supabaseAdmin:{from(table:string){assert.equal(table,"inrstats_visibility_tracking");return q;},rpc:async(name:string)=>{assert.equal(name,"inrstats_reward_cache_is_trusted");return {data:false,error:null};}}}});
  await load<{backfillVisibilityRewardHistory:(id:string)=>Promise<void>}>("lib/inrstats/visibilityRewardBackfill.ts").backfillVisibilityRewardHistory("account");
  assert.equal(updated,true);
});
test("backfill errors cannot mark the history as successfully checked",async()=>{
  const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:null,error:null})};
  const load=runtimeModules({"@/lib/supabaseAdmin":{supabaseAdmin:{from(table:string){assert.equal(table,"inrstats_visibility_tracking");return q;},rpc:async()=>({error:{message:"unavailable"}})}}});
  await assert.rejects(load<{backfillVisibilityRewardHistory:(id:string)=>Promise<void>}>("lib/inrstats/visibilityRewardBackfill.ts").backfillVisibilityRewardHistory("account"),/history_unavailable/);
});


test("fresh verification uses a minimal complete report chain, never duplicates or gaps",()=>{
  const all=[coverage("2026-08-01","2026-08-31"),coverage("2026-09-01","2026-09-15"),coverage("2026-09-01","2026-09-30"),{...coverage("2026-09-01","2026-09-30"),channel_key:"gmb"}];
  assert.deepEqual(reportsToVerify(all,"2020-01-01",now),[{...coverage("2026-09-01","2026-09-30"),channel_key:"gmb"}]);
  const full=[coverage("2026-07-01","2026-07-31"),coverage("2026-08-01","2026-08-31"),coverage("2026-09-01","2026-09-30")];
  assert.deepEqual(reportsToVerify(full,"2020-01-01",now),full);
  assert.deepEqual(reportsToVerify([coverage("2026-09-01","2026-09-14"),coverage("2026-09-16","2026-09-30")],"2020-01-01",now),[]);
  assert.deepEqual(reportsToVerify(full,"2026-10-01",now),[]);
});
