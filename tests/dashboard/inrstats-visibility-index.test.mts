import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { visibilityIndexBasis, visibilityIndexCoefficient, type VisibilityIndexChannel } from "../../lib/inrstats/visibilityIndexModel.ts";
import { recordedVisibilitySnapshots, visibilityIndexPeriods, visibilityIndexPeriodPoints, visibilityDay, shiftVisibilityMonths, type VisibilityIndexSnapshot } from "../../lib/inrstats/visibilityIndexSnapshots.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const input: VisibilityIndexChannel = { key: "facebook", connected: true, ready: true, audience: 1000, posts: 10, visibility: 2000, contacts: 20, potential: 30 };
const inputs = visibilityIndexBasis([input]).inputs;
const now = "2026-10-24T18:00:00Z";
function history(from: string, to = "2026-10-24"): VisibilityIndexSnapshot[] {
  const result: VisibilityIndexSnapshot[] = [];
  for (let at = Date.parse(from + "T12:00:00Z"); at <= Date.parse(to + "T12:00:00Z"); at += 86_400_000) result.push({ date: new Date(at).toISOString().slice(0, 10), value: 100, inputs });
  return result;
}
test("the versioned index combines six signals without changing measured inputs", () => {
  const before = structuredClone(input), basis = visibilityIndexBasis([input]);
  for (const key of ["audience", "posts", "visibility", "contacts", "potential"] as const) assert.ok(visibilityIndexBasis([{ ...input, [key]: input[key]! * 2 }]).base > basis.base, key);
  assert.ok(visibilityIndexBasis([input, { ...input, key: "instagram" }]).base > basis.base);
  assert.equal(Object.keys(basis.contributions).length, 6);
  assert.deepEqual(input, before);
  assert.equal(visibilityIndexBasis([{ ...input, connected: false }]).base, 0);
  assert.equal(visibilityIndexBasis([{ ...input, ready: false }]).base, 0);
  assert.equal(visibilityIndexBasis([{ ...input, audience: NaN }]).inputs.audience, null);
});
test("account age affects today's computed score only", () => {
  assert.equal(visibilityIndexCoefficient("2026-01-01T12:00:00Z", new Date("2026-01-01T12:00:00Z")), 1);
  assert.ok(visibilityIndexCoefficient("2025-01-01", new Date("2026-01-01"))! > 1.11);
  assert.equal(visibilityIndexCoefficient("invalid", new Date()), null);
  assert.equal(visibilityIndexCoefficient("2028-01-01", new Date(now)), null);
});
test("a new account and an old account without recordings both have no eligible periods", () => {
  assert.deepEqual(visibilityIndexPeriods([], "2020-01-01", now).map(p => p.available), [false, false, false, false]);
  assert.deepEqual(visibilityIndexPeriods(history("2026-10-24"), now, now).map(p => p.available), [false, false, false, false]);
  assert.deepEqual(visibilityIndexPeriods(history("2026-10-01"), "2020-01-01", now).map(p => p.available), [false, false, false, false]);
});
test("1/3/6/12-month milestones require corresponding real recorded history", () => {
  for (const [from, expected] of [["2026-09-24", [true,false,false,false]], ["2026-07-24", [true,true,false,false]], ["2026-04-24", [true,true,true,false]], ["2025-10-24", [true,true,true,true]]] as const) assert.deepEqual(visibilityIndexPeriods(history(from), "2020-01-01", now).map(p=>p.available), expected);
  // An imported row cannot extend history before the account existed.
  assert.deepEqual(visibilityIndexPeriods(history("2025-10-24"), "2026-09-24", now).map(p=>p.available), [true,false,false,false]);
});
test("calendar anniversaries handle month ends and Paris daylight-saving boundaries", () => {
  assert.equal(shiftVisibilityMonths("2024-01-31",1), "2024-02-29");
  assert.equal(shiftVisibilityMonths("2024-02-29",12), "2025-02-28");
  assert.equal(visibilityIndexPeriods(history("2024-01-31","2024-02-29"),"2024-01-31","2024-02-29T20:00:00Z")[0].available,true);
  assert.equal(visibilityDay(new Date("2026-10-24T22:30:00Z")),"2026-10-25");
  assert.equal(visibilityDay(new Date("2026-10-25T23:30:00Z")),"2026-10-26");
});
test("sparse, stale and future-dated rows cannot unlock a misleading long period", () => {
  assert.equal(visibilityIndexPeriods(history("2026-09-24").filter((_,i)=>i%3===0),"2020-01-01",now)[0].available,false);
  assert.equal(visibilityIndexPeriods(history("2026-09-24","2026-10-23"),"2020-01-01",now)[0].available,false);
  const gap=history("2025-10-24").filter(row=>row.date < "2026-08-01" || row.date > "2026-08-20");
  assert.equal(visibilityIndexPeriods(gap,"2020-01-01",now)[3].available,false);
  assert.equal(visibilityIndexPeriods(gap,"2020-01-01",now)[0].available,true);
});
test("the curve preserves saved rises, falls and missing dates with no reconstruction", () => {
  const saved=[{date:"2026-10-20",value:91,inputs},{date:"2026-10-22",value:77,inputs},{date:"2026-10-24",value:95,inputs}];
  const valid=recordedVisibilitySnapshots([...saved,{date:"2026-10-25",value:999,inputs},{date:"2026-02-31",value:999,inputs}],"2026-01-01",now);
  assert.deepEqual(valid,saved);
  assert.deepEqual(visibilityIndexPeriodPoints(valid,1,now),saved.map(({date,value})=>({date,value})));
  assert.deepEqual(recordedVisibilitySnapshots(saved,"2027-01-01",now),[]);
});
test("the recorded history API scopes every read to the trusted active account", async () => {
  const filters:Record<string,unknown>={};
  const query={select(columns:string){assert.equal(columns,"observed_on,score,inputs");return query;},eq(k:string,v:unknown){filters[k]=v;return query;},gte(){return query;},lte(){return query;},order(){return query;},limit(){return query;},then(resolve:(v:unknown)=>unknown){return Promise.resolve(resolve({data:[],error:null}));}};
  const load=runtimeModules({"@/lib/requireUser":{requireUser:async()=>({user:{id:"actor",created_at:"2000-01-01"},activeUserId:"account",errorResponse:null})},"@/lib/supabaseAdmin":{supabaseAdmin:{from(table:string){if(table==="inrstats_visibility_tracking")return {upsert:async(row:{user_id:string})=>{assert.equal(row.user_id,"account");return {error:null};}};if(table==="inrcy_accounts") {const accountQuery={select(){return accountQuery;},eq(k:string,id:string){assert.equal(k,"id");assert.equal(id,"account");return accountQuery;},maybeSingle:async()=>({data:{created_at:"2025-01-01"},error:null})};return accountQuery;}assert.equal(table,"inrstats_visibility_snapshots");return query;},auth:{admin:{getUserById(){throw new Error("company ids are not auth user ids");}}}}},"@/lib/inrstats/visibilityIndexRewards":{readVisibilityRewards:async()=>[],reconcileVisibilityRewards:async()=>"standard"},"next/server":{NextResponse:{json:(body:unknown)=>body}}});
  const route=load<{GET:(req:Request)=>Promise<Record<string,unknown>>}>("app/api/inrstats/visibility-index/route.ts");
  const data=await route.GET(new Request("https://app.test/api/inrstats/visibility-index?channel=facebook&userId=intruder"));
  assert.equal(filters.user_id,"account");assert.equal(filters.channel_key,"facebook");assert.equal(filters.model_version,"v1");
  assert.equal(data.scope,"account");assert.equal(data.createdAt,"2025-01-01");assert.equal(data.email,undefined);assert.deepEqual(data.records,[]);
  const unauthorized=runtimeModules({"@/lib/requireUser":{requireUser:async()=>({errorResponse:"unauthorized"})},"@/lib/supabaseAdmin":{supabaseAdmin:{from(){throw new Error("must not query");}}}});
  assert.equal(await unauthorized<{GET:(req:Request)=>Promise<unknown>}>("app/api/inrstats/visibility-index/route.ts").GET(new Request("https://app.test")),"unauthorized");
});
test("milestone shop bonuses use the commercial tier and the requested coefficients", () => {
  const {visibilityRewardTier,visibilityRewardMultiplier,VISIBILITY_MILESTONE_REWARDS}=runtimeModules({"@/lib/supabaseAdmin":{supabaseAdmin:{}}})<{visibilityRewardTier:(p:unknown,e:unknown)=>string|null;visibilityRewardMultiplier:(t:string)=>number;VISIBILITY_MILESTONE_REWARDS:Array<{months:number;amount:number}>}>("lib/inrstats/visibilityIndexRewards.ts");
  assert.equal(visibilityRewardTier("Basique","premium"),"basic");assert.equal(visibilityRewardTier("Standard","premium"),"standard");assert.equal(visibilityRewardTier("Premium","standard"),"premium");assert.equal(visibilityRewardTier("unknown","unknown"),null);
  for(const [tier,amounts] of [["basic",[25,50,100,250]],["standard",[50,100,200,500]],["premium",[75,150,300,750]]] as const) assert.deepEqual(VISIBILITY_MILESTONE_REWARDS.map(r=>r.amount*visibilityRewardMultiplier(tier)),amounts);
});
test("storage only accepts current captures, atomically deduplicates loyalty and denies browser writes", () => {
  const sql=fs.readFileSync(new URL("../../supabase/migrations/20261024161645_inrstats_visibility_snapshots.sql",import.meta.url),"utf8");
  assert.match(sql,/primary key \(user_id, channel_key, model_version, observed_on\)/);
  assert.match(sql,/visibility_observation_must_be_current/);assert.match(sql,/current\.observed_at < excluded\.observed_at/);
  assert.match(sql,/on conflict \(user_id,action_key,source_id\) do nothing returning amount/);
  assert.match(sql,/balance = balance\.balance \+ excluded\.balance/);
  assert.match(sql,/when 'basic' then 0\.5 when 'standard' then 1 when 'premium' then 1\.5/);
  assert.doesNotMatch(sql,/security definer/i);
  assert.match(sql,/revoke all on function public\.award_inrstats_visibility_milestones\(uuid,text\) from public,anon,authenticated/);
});
