import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { IMAGE_CREDIT_PACKS } from "../../lib/boutique/imageCreditPacks.ts";

type Row=Record<string,unknown>;
const account="11111111-1111-4111-8111-111111111111";
const actor="22222222-2222-4222-8222-222222222222";
const output=ts.transpileModule(readFileSync(new URL("../../app/api/boutique/image-credits/route.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
function fixture({role="owner",status="active",unavailable=false,authenticated=true}:{role?:string;status?:string;unavailable?:boolean;authenticated?:boolean}={}) {
  const reads:Row[]=[];
  const history=[{id:"synthetic-order",account_id:account,images:20,revoked_images:0,held_images:2,dispute_revoked_images:0}];
  const from=(table:string)=>{
    const query={
      select(columns:string){reads.push({table,columns});return query;},
      eq(key:string,value:unknown){reads.push({table,key,value});return query;},
      order(){return query;},
      async limit(){return {data:history,error:unavailable?{message:"synthetic unavailable"}:null};},
      async maybeSingle(){return {data:{status},error:null};},
    };return query;
  };
  const modules:Record<string,unknown>={
    "next/server":{NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)}},
    "@/lib/requireUser":{requireUser:async()=>authenticated?{activeUserId:account,authUserId:actor,activeAccount:{role},errorResponse:null}:{errorResponse:Response.json({error:"Unauthorized"},{status:401})}},
    "@/lib/supabaseAdmin":{supabaseAdmin:{from}},
    "@/lib/boutique/imageCreditPacks":{IMAGE_CREDIT_PACKS},
  };
  const runtime={exports:{} as {GET():Promise<Response>}};
  new Function("module","exports","require",output)(runtime,runtime.exports,(name:string)=>{
    assert.ok(Object.hasOwn(modules,name));return modules[name];
  });return {reads,history,get:()=>runtime.exports.GET()};
}

test("image catalogue scopes history to the active establishment and returns exact image fields",async()=>{
  const f=fixture(),response=await f.get(),body=await response.json();
  assert.equal(response.status,200);assert.match(response.headers.get("cache-control")??"",/no-store/);
  assert.equal(body.accountId,account);assert.equal(body.actorAuthUserId,actor);assert.equal(body.canPurchase,false);
  assert.deepEqual(body.packs,[]);
  assert.deepEqual(body.orders,f.history.map(order=>({...order,credits:140})));
  assert.ok(f.reads.some(row=>row.table==="ai_media_image_credit_orders" && row.key==="account_id" && row.value===account));
  assert.ok(!f.reads.some(row=>String(row.table).includes("video_credit")));
});
test("readable image catalogue does not offer purchase permission to members or suspended subscriptions",async()=>{
  for(const options of [{role:"member"},{status:"past_due"},{status:"canceled"}]) {
    assert.equal((await (await fixture(options).get()).json()).canPurchase,false);
  }
  assert.equal((await (await fixture({role:"admin",status:"trialing"}).get()).json()).canPurchase,false);
});
test("unauthenticated or failed history read cannot expose an image catalogue",async()=>{
  const auth=fixture({authenticated:false});assert.equal((await auth.get()).status,401);assert.equal(auth.reads.length,0);
  assert.equal((await fixture({unavailable:true}).get()).status,503);
});
