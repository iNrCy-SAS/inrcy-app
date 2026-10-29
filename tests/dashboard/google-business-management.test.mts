import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { discoverGoogleBusinessLocations } from "../../lib/googleBusinessLocations.ts";
import { buildGoogleBusinessProfilePatch, editableGoogleBusinessProfile, stableGoogleBusinessValue } from "../../lib/googleBusinessProfile.ts";

test("discovery includes inactive and active locations across every account and pagination page", async () => {
  const calls: string[] = [];
  const result = await discoverGoogleBusinessLocations("fixture", null, async input => {
    const url = new URL(String(input)); calls.push(url.pathname + url.search);
    if (url.pathname === "/v1/accounts") return Response.json(url.searchParams.has("pageToken") ? { accounts: [{ name: "accounts/second" }] } : { accounts: [{ name: "accounts/first" }], nextPageToken: "second-account-page" });
    if (url.pathname.includes("accounts/first")) return Response.json(url.searchParams.has("pageToken") ? { locations: [{name:"locations/unverified",title:"Unverified"}] } : { locations: [{name:"locations/closed",title:"Inactive",openInfo:{status:"CLOSED_PERMANENTLY"}}],nextPageToken:"second-location-page" });
    return Response.json({ locations: [{name:"locations/open",title:"Active",openInfo:{status:"OPEN"}}] });
  });
  assert.equal(result.complete, true);
  assert.deepEqual(new Set(result.locations.map(row=>row.name)), new Set(["locations/closed","locations/unverified","locations/open"]));
  assert.equal(result.locations.find(row=>row.name==="locations/open")?.accountName,"accounts/second");
  assert.equal(result.locations.find(row=>row.name==="locations/closed")?.status,"CLOSED_PERMANENTLY");
  assert.equal(calls.filter(url=>url.includes("pageToken=")).length,2);
});

test("duplicate locations retain their saved account, and partial failures are explicit", async () => {
  const result = await discoverGoogleBusinessLocations("fixture", "accounts/preferred", async input => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/accounts") return Response.json({ accounts:[{name:"accounts/other"},{name:"accounts/preferred"},{name:"accounts/denied"}] });
    if (url.pathname.includes("denied")) return Response.json({error:{message:"Forbidden"}},{status:403});
    return Response.json({locations:[{name:"locations/shared",title:"Shared"}]});
  });
  assert.equal(result.locations.length,1);
  assert.equal(result.locations[0].accountName,"accounts/preferred");
  assert.equal(result.complete,false);
  assert.deepEqual(result.errors,[{accountName:"accounts/denied"}]);
});

const original = { name:"locations/chosen", title:"My business", phoneNumbers:{primaryPhone:"+33123456789",additionalPhones:["+33987654321"]},websiteUri:"https://example.com",profile:{description:"Existing description"},regularHours:{periods:[{openDay:"MONDAY",openTime:{},closeDay:"MONDAY",closeTime:{hours:24}}]} };
const editable = editableGoogleBusinessProfile(original);
const digest = (value: unknown) => createHash("sha256").update(stableGoogleBusinessValue(value)).digest("hex");

test("partial profile edits preserve unrelated fields, secondary phones and midnight hours", () => {
  assert.deepEqual(buildGoogleBusinessProfilePatch(editable,{...editable,description:"New description"}),{location:{profile:{description:"New description"}},updateMask:["profile.description"]});
  assert.deepEqual(buildGoogleBusinessProfilePatch(editable,{primaryPhone:"+33456789123"}).updateMask,["phoneNumbers.primaryPhone"]);
  assert.deepEqual(buildGoogleBusinessProfilePatch(editable,editable).updateMask,[]);
  assert.throws(()=>buildGoogleBusinessProfilePatch(editable,{websiteUri:"javascript:alert(1)"}),/invalide/);
  assert.throws(()=>buildGoogleBusinessProfilePatch(editable,{description:"x".repeat(751)}),/trop longue/);
  assert.throws(()=>buildGoogleBusinessProfilePatch(editable,{regularHours:{periods:[{openDay:"MONDAY",closeDay:"MONDAY",openTime:{hours:18},closeTime:{hours:9}}]}}),/fermeture/);
});

test("exceptional closures validate actual dates and do not create an exposed address", () => {
  const patch = buildGoogleBusinessProfilePatch(editable,{specialHours:{specialHourPeriods:[{startDate:{year:2026,month:12,day:25},closed:true}]}});
  assert.deepEqual(patch.updateMask,["specialHours"]);
  assert.throws(()=>buildGoogleBusinessProfilePatch(editable,{specialHours:{specialHourPeriods:[{startDate:{year:2026,month:2,day:31},closed:true}]}}),/invalide/);
  assert.throws(()=>buildGoogleBusinessProfilePatch(editable,{storefrontAddress:{regionCode:"FR",addressLines:["Private address"]}}),/pas affichée/);
});

function profileRoute(options: { versionChanged?: boolean; changedTarget?: boolean; denyValidation?: boolean } = {}) {
  const writes: Array<{ url:string; body:Record<string,unknown> }> = [];
  let scopes = 0;
  const ctx = { current:{supabase:{},user:{id:"actor"},scope:{activeUserId:"account"}},token:{accessToken:"fixture",row:{meta:{account:"accounts/parent"},resource_id:"locations/chosen"}} };
  const code = ts.transpileModule(readFileSync("app/api/integrations/google-business/profile/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const modules: Record<string,unknown> = {
    "node:crypto":{createHash}, "next/server":{NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)}},
    "@/lib/multicompte/server":{getCurrentInrcyAccountScope:async()=>{scopes++;return ctx.current;}},
    "@/lib/googleBusiness":{getGmbToken:async()=>options.changedTarget&&scopes>1?{...ctx.token,row:{...ctx.token.row,resource_id:"locations/other"}}:ctx.token},
    "@/lib/googleBusinessReviews":{getGmbReviewTargetFromRow:(row:typeof ctx.token.row)=>({accountName:row.meta.account,locationName:row.resource_id})},
    "@/lib/googleBusinessLocations":{listAllGoogleBusinessLocations:async()=>[{name:"locations/chosen"}]},
    "@/lib/googleBusinessProfile":{buildGoogleBusinessProfilePatch,editableGoogleBusinessProfile,googleBusinessRecord:(v:unknown)=>v&&typeof v==="object"?v:{},stableGoogleBusinessValue},
    "@/lib/rateLimit":{enforceRateLimit:async()=>null},
  };
  const exports: { PATCH?: (request:Request)=>Promise<Response> } = {};
  new Function("require","exports","fetch",code)((name:string)=>{assert.ok(name in modules,`Unexpected module ${name}`);return modules[name];},exports,async(input:URL,init:RequestInit)=>{
    if(init.method==="PATCH") {writes.push({url:String(input),body:JSON.parse(String(init.body))});return options.denyValidation&&String(input).includes("validateOnly=true")?Response.json({error:{}},{status:403}):Response.json({...original,profile:{description:"Updated"}});}
    return Response.json(options.versionChanged?{...original,title:"Concurrent change"}:original);
  });
  const request = (accountId="account") => new Request("https://app.inrcy.com/api/integrations/google-business/profile",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountId,accountName:"accounts/parent",locationName:"locations/chosen",version:digest(editable),profile:{...editable,description:"Updated"}})});
  return { writes, run:(accountId?:string)=>exports.PATCH!(request(accountId)) };
}

test("profile saves validate with Google before writing only the selected changed field",async()=>{
  const fixture=profileRoute();
  assert.equal((await fixture.run()).status,200);
  assert.equal(fixture.writes.length,2);
  assert.ok(fixture.writes[0].url.includes("validateOnly=true"));
  assert.ok(!fixture.writes[1].url.includes("validateOnly"));
  assert.equal(new URL(fixture.writes[1].url).searchParams.get("updateMask"),"profile.description");
  assert.deepEqual(fixture.writes[1].body,{name:"locations/chosen",profile:{description:"Updated"}});
});

test("wrong account, concurrent edits, Google refusal and a changed selection block remote writes",async()=>{
  const wrong=profileRoute();assert.equal((await wrong.run("another-account")).status,409);assert.equal(wrong.writes.length,0);
  const stale=profileRoute({versionChanged:true});assert.equal((await stale.run()).status,409);assert.equal(stale.writes.length,0);
  const changed=profileRoute({changedTarget:true});assert.equal((await changed.run()).status,409);assert.equal(changed.writes.length,1);assert.ok(changed.writes[0].url.includes("validateOnly=true"));
  const denied=profileRoute({denyValidation:true});assert.equal((await denied.run()).status,502);assert.equal(denied.writes.length,1);
});

test("statistics never recover by selecting an unrelated establishment",async()=>{
  const code=ts.transpileModule(readFileSync("lib/googleBusiness.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:{gmbFetchDailyMetricsNormalizedWithRecovery?:(args:unknown)=>Promise<unknown>}={};let calls=0;
  new Function("require","exports","fetch",code)((name:string)=>{if(name==="@/lib/googleStats"||name==="@/lib/googleBusinessPostTransport"||name==="@/lib/googleBusinessLocations")return{};throw Error(name);},exports,async()=>{calls++;return Response.json({error:{message:"NOT_FOUND"}},{status:404});});
  await assert.rejects(exports.gmbFetchDailyMetricsNormalizedWithRecovery!({accessToken:"fixture",locationName:"locations/chosen",preferredAccountName:"accounts/parent",start:new Date("2026-10-01"),end:new Date("2026-10-28")}));
  assert.equal(calls,1,"A missing selected location must not trigger discovery or choose another business");
});

test("an explicit inactive establishment choice persists its own parent and Google's real title", async () => {
  const writes: Array<{ table: string; value: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const admin = { from(table: string) {
    const filters: Record<string, unknown> = {};
    let value: Record<string, unknown> = {};
    const query = {
      select() { return query; },
      eq(key: string, input: unknown) { filters[key] = input; return query; },
      update(input: Record<string, unknown>) { value = input; writes.push({ table, value, filters }); return query; },
      async maybeSingle() { return { data: table === "integrations" ? { id: "integration", meta: { preserved: true } } : { settings: { unrelated: true } }, error: null }; },
      async single() { return { data: { id: "integration", ...value }, error: null }; },
      async upsert(input: Record<string, unknown>) { writes.push({ table, value: input, filters }); return { error: null }; },
    };
    return query;
  } };
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) } }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: admin },
    "@/lib/tsSafe": { asRecord: (value: unknown) => value && typeof value === "object" ? value : {} },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ error: "unexpected" }, { status: 500 }) },
    "@/lib/statsCache": { clearAllToolCaches: async () => undefined },
    "@/lib/connectionVersions": { withCurrentConnectionVersion: (_: unknown, value: unknown) => value },
    "@/lib/multicompte/server": { resolveActiveInrcyAccountId: async () => "active-company" },
    "@/lib/googleBusiness": { getGmbToken: async (options: { userId: string }) => { assert.equal(options.userId, "active-company"); return { accessToken: "fixture", row: { email_address: "linked@example.test" } }; } },
    "@/lib/googleBusinessLocations": {
      listAllGoogleBusinessAccounts: async () => [{ name: "accounts/first" }, { name: "accounts/second" }],
      listAllGoogleBusinessLocations: async (_: string, account: string) => { assert.equal(account, "accounts/second"); return [{ name: "locations/inactive", title: "Real inactive title", status: "CLOSED_PERMANENTLY", mapsUri: "https://maps.google.com/?cid=fixture" }]; },
    },
  };
  const code = ts.transpileModule(readFileSync("app/api/integrations/google-business/select-location/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  new Function("require", "exports", code)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  const request = (accountName: string, locationName = "locations/inactive") => new Request("https://example.test/select", { method: "POST", body: JSON.stringify({ accountName, locationName, locationTitle: "Forged client title" }) });
  assert.equal((await exports.POST!(request("accounts/second"))).status, 200);
  assert.equal(writes[0].value.resource_id, "locations/inactive");
  assert.equal(writes[0].value.resource_label, "Real inactive title");
  assert.deepEqual(writes[0].filters, { id: "integration", user_id: "active-company", email_address: "linked@example.test" });
  assert.deepEqual(writes[0].value.meta, { preserved: true, account: "accounts/second" });
  writes.length = 0;
  assert.equal((await exports.POST!(request("accounts/foreign"))).status, 403);
  assert.equal((await exports.POST!(request("accounts/second", "locations/foreign"))).status, 409);
  assert.equal(writes.length, 0, "An inaccessible choice never guesses or writes another establishment");
});

test("review reads reject a changed selection and identify the exact establishment in their cache response", async () => {
  const calls: unknown[][] = [];
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/requireUser": { requireUser: async () => ({ errorResponse: null }) },
    "@/lib/googleBusiness": { getGmbToken: async () => ({ accessToken: "fixture", row: {} }) },
    "@/lib/googleBusinessReviews": {
      getGmbReviewTargetFromRow: () => ({ accountName: "accounts/chosen", locationName: "locations/chosen", locationTitle: "Chosen" }),
      gmbListReviews: async (...args: unknown[]) => { calls.push(args); return { reviews: [], totalReviewCount: 0 }; },
    },
    "@/lib/tsSafe": { asRecord: (value: unknown) => value && typeof value === "object" ? value : {}, asString: (value: unknown) => typeof value === "string" ? value : "" },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({}, { status: 500 }) },
  };
  const code = ts.transpileModule(readFileSync("app/api/e-reputation/google/reviews/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  new Function("require", "exports", code)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  assert.equal((await exports.GET!(new Request("https://example.test/reviews?locationName=locations/old"))).status, 409);
  assert.equal(calls.length, 0);
  const response = await exports.GET!(new Request("https://example.test/reviews?locationName=locations/chosen"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).locationName, "locations/chosen");
  assert.equal(calls[0][1], "accounts/chosen");
  assert.equal(calls[0][2], "locations/chosen");
});
