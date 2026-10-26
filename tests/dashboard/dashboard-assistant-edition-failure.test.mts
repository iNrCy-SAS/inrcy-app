import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../../lib/dashboardEdition.ts";
import type * as Server from "../../lib/dashboardEditionServer.ts";
function fixture(failure:"none"|"membership"|"subscription"|"missing"|"malformed",plan="basic"){
 const moduleRecord={exports:{}};
 const client={from(table:string){
  const result=table === "inrcy_account_members" ? {data:[{account_id:"account-basic",auth_user_id:"owner-basic",role:"owner"}],error:failure === "membership"?{}:null}
    :table === "subscriptions"?{data:failure === "missing"?[]:[{user_id:"owner-basic",plan:failure === "malformed"?"unknown":plan,app_edition:failure === "malformed"?null:plan}],error:failure === "subscription"?{}:null}
    :{data:[{user_id:"account-basic",role:"user"}],error:null};
  const builder={select(){return builder;},in(){return Promise.resolve(result);}};return builder;
 }};
 const code=ts.transpileModule(readFileSync(new URL("../../lib/dashboardEditionServer.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(`(function(require,module,exports){${code}\n})`,{process:{env:{NODE_ENV:"production"}}})((name:string)=>{
  if(name === "server-only")return {};
  if(name === "next/server")return {NextResponse:{}};
  if(name === "@/lib/dashboardEdition")return policy;
  if(name === "@/lib/supabaseAdmin")return {supabaseAdmin:client};
  assert.fail(name);
 },moduleRecord,moduleRecord.exports);
 return moduleRecord.exports as typeof Server;
}
test("unknown subscription rights never grant assistant execution",async()=>{
 for(const failure of ["membership","subscription","missing","malformed"] as const){const edition=await fixture(failure).getDashboardEditionForAccountId("account-basic");assert.equal(edition,"basic",failure);assert.equal(policy.hasAgentAutomationAccess(edition),false);}
});
test("verified Basic, trial Standard and Premium retain their intended rights",async()=>{
 for(const [plan,expected] of [["basic","basic"],["trial","standard"],["standard","standard"],["premium","premium"],["founder","founder"]] as const) assert.equal(await fixture("none",plan).getDashboardEditionForAccountId("account-basic"),expected);
});
