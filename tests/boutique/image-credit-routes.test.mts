import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Row = Record<string, unknown>;
const account = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
function load<T>(path: string, modules: Record<string, unknown>): T {
  const output=ts.transpileModule(readFileSync(new URL(`../../${path}`,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const runtime={exports:{} as T};
  new Function("module","exports","require","console",output)(runtime,runtime.exports,(name: string)=>{
    assert.ok(Object.hasOwn(modules,name),"Unmocked dependency "+name);return modules[name];
  },{error(){}});
  return runtime.exports;
}
function fixture({role="owner",activeAccount=account,owned=true,pending=false}:{role?:string;activeAccount?:string;owned?:boolean;pending?:boolean}={}) {
  const calls: Row[]=[];
  const auth={activeUserId:activeAccount,authUserId:actor,activeAccount:{role},user:{email:"test@example.invalid"},errorResponse:null};
  const order={id:"33333333-3333-4333-8333-333333333333",account_id:account,images:20,status:"pending",granted_at:null as string|null,
    stripe_checkout_session_id:"cs_test",revoked_images:0,pack_key:"image_20",created_at:new Date().toISOString()};
  const modules={
    "next/server":{NextResponse:{json:(body: unknown,init?:ResponseInit)=>Response.json(body,init)}},
    "@/lib/requireUser":{requireUser:async()=>auth},
    "@/lib/boutique/imageCreditPayments":{
      startImageCreditCheckout:async(args: Row)=>{calls.push({type:"checkout",...args});return {url:"https://checkout.stripe.com/c/pay/test",completed:false};},
      getImageCreditOrder:async(id: string,accountId: string)=>{calls.push({type:"read",id,accountId});return owned && accountId===account ? {...order} : null;},
      fulfillImageCreditCheckout:async(id: string)=>{calls.push({type:"fulfill",id});if(!pending)order.granted_at=new Date().toISOString();return !pending;},
    },
  };
  const checkout=load<{POST(req:Request):Promise<Response>}>("app/api/boutique/image-credits/checkout/route.ts",modules);
  const returnRoute=load<{GET(req:Request,ctx:{params:Promise<{orderId:string}>}):Promise<Response>}>("app/api/boutique/image-credits/orders/[orderId]/route.ts",modules);
  return {calls,
    post:(body: Row)=>checkout.POST(new Request("https://example.invalid/api",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})),
    get:()=>returnRoute.GET(new Request("https://example.invalid/api"),{params:Promise.resolve({orderId:order.id})})};
}
test("checkout uses authenticated account and actor; browser amount and images are ignored",async()=>{
  const f=fixture();const result=await f.post({accountId:account,packKey:"image_20",requestKey:"safe-intent",images:200,amountHt:1});
  assert.equal(result.status,200);assert.equal(f.calls[0].accountId,account);assert.equal(f.calls[0].actorAuthUserId,actor);
  assert.equal(Object.hasOwn(f.calls[0],"amountHt"),false);assert.equal(Object.hasOwn(f.calls[0],"images"),false);
});
test("checkout blocks a member and an account changed since the displayed catalogue",async()=>{
  const member=fixture({role:"member"});assert.equal((await member.post({accountId:account,requestKey:"safe-intent"})).status,403);assert.equal(member.calls.length,0);
  const changed=fixture({activeAccount:"another-account"});assert.equal((await changed.post({accountId:account,requestKey:"safe-intent"})).status,409);assert.equal(changed.calls.length,0);
});
test("checkout rejects an invalid key before opening a Stripe payment",async()=>{
  const f=fixture();assert.equal((await f.post({accountId:account,requestKey:"x"})).status,400);assert.equal(f.calls.length,0);
});
test("return never confirms an order outside the active account or calls Stripe for it",async()=>{
  const f=fixture({owned:false});assert.equal((await f.get()).status,404);assert.equal(f.calls.length,1);assert.equal(f.calls[0].type,"read");
});
test("authenticated return is confirmed only after verified server fulfillment",async()=>{
  const f=fixture();const response=await f.get();assert.equal((await response.json()).order.granted,true);
  assert.deepEqual(f.calls.map(c=>c.type),["read","fulfill","read"]);
  const pending=fixture({pending:true});assert.equal((await (await pending.get()).json()).order.granted,false);
});
