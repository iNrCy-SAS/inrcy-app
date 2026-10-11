import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as packs from "../../lib/boutique/videoCreditPacks.ts";

type Row = Record<string, unknown>;
const accountId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const kind = "inrcy_video_credits_v1";
const hints = { kind, order_id: orderId, account_id: accountId, actor_auth_user_id: actorId, pack_key: "video_50" };
const source = readFileSync(new URL("../../lib/boutique/videoCreditPayments.ts",import.meta.url),"utf8");
const output = ts.transpileModule(source,{ compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText;

function fixture(options: { paid?: boolean; expired?: boolean; prepared?: boolean; uncertain?: boolean; customerAccount?: string; mutateSession?: (row: Row) => void; mutatePrice?: (row: Row) => void; refunded?: number; disputed?: boolean; disputes?: Row[] } = {}) {
  const price: Row = { id:"price_video_50",currency:"eur",unit_amount:800,tax_behavior:"exclusive",type:"one_time",active:true,livemode:false };
  options.mutatePrice?.(price);
  const order: Row = { id:orderId,account_id:accountId,actor_auth_user_id:actorId,pack_key:"video_50",seconds:50,amount_ht_cents:800,
    currency:"eur",tax_behavior:"exclusive",stripe_price_id:price.id,status:"pending",stripe_customer_id:"cus_test",stripe_livemode:false,
    stripe_checkout_session_id:options.prepared ? "cs_test" : null,stripe_payment_intent_id:null,granted_at:null,
    checkout_attempted_at: options.prepared || options.uncertain ? new Date(Date.now()-(options.uncertain ? 24*60*60*1000 : 0)).toISOString() : null,
    checkout_params:options.prepared || options.uncertain ? "mode=payment&customer=cus_test" : null,
    refunded_amount_cents:0,revoked_seconds:0,held_seconds:0,dispute_revoked_seconds:0,created_at:new Date().toISOString() };
  const session: Row = { id:"cs_test",mode:"payment",client_reference_id:accountId,metadata:{...hints},customer:"cus_test",livemode:false,
    status: options.expired ? "expired" : options.paid ? "complete" : "open",payment_status:options.paid ? "paid" : "unpaid",
    url:"https://checkout.stripe.com/c/pay/test",currency:"eur",amount_subtotal:800,amount_total:960,total_details:{amount_discount:0},
    automatic_tax:{enabled:true,status:"complete"},payment_intent:"pi_test" };
  options.mutateSession?.(session);
  const intent: Row = { id:"pi_test",status:"succeeded",currency:"eur",amount_received:960,customer:"cus_test",livemode:false,metadata:{...hints},
    latest_charge:{id:"ch_test",payment_intent:"pi_test",currency:"eur",paid:true,amount:960,amount_refunded:options.refunded ?? 0,livemode:false,disputed:options.disputed ?? false} };
  const disputes = options.disputes ?? [{id:"du_test",charge:"ch_test",payment_intent:"pi_test",amount:960,currency:"eur",livemode:false,status:"needs_response"}];
  const calls: Array<{ name: string; args: Row }> = [];
  const posts: Array<{ path: string; params: string; config: unknown }> = [];
  const reads: string[] = [];
  const from = (table: string) => {
    const filters: Row = {};
    let update: Row | undefined;
    const query = {
      select() { return query; }, eq(key: string,value: unknown) { filters[key]=value; return query; },
      is(key: string,value: unknown) { filters[key]=value; return query; },
      update(data: Row) { update=data; return query; },
      async maybeSingle() { return {error:null,data: table === "subscriptions" ? {stripe_customer_id:"cus_test"} :
        (!filters.account_id || filters.account_id===order.account_id) && (!filters.id || filters.id===order.id) ? {...order} : null}; },
      async limit() { return {error:null,data:[{user_id:accountId}]}; },
      then(resolve: (value: unknown) => unknown,reject: (error: unknown) => unknown) {
        if (update && (!Object.hasOwn(filters,"stripe_checkout_session_id") || order.stripe_checkout_session_id===null)
            && (!Object.hasOwn(filters,"granted_at") || order.granted_at===null)) Object.assign(order,update);
        return Promise.resolve({error:null}).then(resolve,reject);
      },
    };
    return query;
  };
  const modules: Record<string,unknown> = {
    "server-only":{}, "@/lib/boutique/videoCreditPacks":packs,
    "@/lib/supabaseAdmin": {supabaseAdmin:{ from, async rpc(name: string,args: Row) {
      calls.push({name,args});
      if (name==="create_ai_media_video_credit_order") return {data:[{...order}],error:null};
      if (name==="prepare_ai_media_video_credit_checkout") {
        if (!order.checkout_params) Object.assign(order,{checkout_params:args.p_params,checkout_attempted_at:new Date().toISOString(),stripe_customer_id:args.p_customer_id,stripe_livemode:args.p_livemode});
        return {data:[{...order}],error:null};
      }
      if (name==="fulfill_ai_media_video_credit_order") { order.granted_at=new Date().toISOString(); return {data:true,error:null}; }
      if (name==="refund_ai_media_video_credit_order") return {data:true,error:null};
      if (name==="reconcile_ai_media_video_credit_dispute") return {data:true,error:null};
      throw new Error("Unexpected RPC "+name);
    }}},
    "@/lib/stripeRest":{ getAppUrl:()=>"https://example.invalid", async stripeGet(path: string) {
      reads.push(path);
      if (path==="/prices/price_video_50") return {...price};
      if (path==="/customers/cus_test") return {id:"cus_test",metadata:{user_id:options.customerAccount ?? accountId}};
      if (path==="/checkout/sessions/cs_test") return structuredClone(session);
      if (path==="/checkout/sessions/cs_test/line_items?limit=100") return {has_more:false,data:[{quantity:1,price:{...price}}]};
      if (path.startsWith("/payment_intents/pi_test")) return structuredClone(intent);
      if (path==="/charges/ch_test") return structuredClone(intent.latest_charge);
      if (path==="/disputes?charge=ch_test&limit=100") return {has_more:false,data:structuredClone(disputes)};
      if (path==="/disputes/du_test") return structuredClone(disputes[0]);
      throw new Error("Unexpected Stripe GET "+path);
    },async stripePost(path: string,params: URLSearchParams,config: unknown) {
      posts.push({path,params:params.toString(),config}); assert.equal(path,"/checkout/sessions"); return structuredClone(session);
    }},
  };
  const runtime = {exports:{} as {startVideoCreditCheckout:(args: Row)=>Promise<Row>;fulfillVideoCreditCheckout:(session: string,event: string)=>Promise<boolean>;reconcileVideoCreditRefund:(charge: string,event: string)=>Promise<boolean>;reconcileVideoCreditDispute:(dispute: string,event: string)=>Promise<boolean>}};
  new Function("module","exports","require",output)(runtime,runtime.exports,(name: string)=>{
    assert.ok(Object.hasOwn(modules,name),"Unmocked dependency "+name); return modules[name];
  });
  return {order,session,intent,price,calls,posts,reads,disputes,api:runtime.exports,
    start:()=>runtime.exports.startVideoCreditCheckout({req:new Request("https://example.invalid/api"),accountId,actorAuthUserId:actorId,packKey:"video_50",requestKey:"same-intent",email:"test@example.invalid"})};
}
process.env.STRIPE_VIDEO_CREDITS_50_PRICE_ID="price_video_50";
process.env.STRIPE_SECRET_KEY="sk_test_SYNTHETIC_NOT_A_CREDENTIAL";

test("the four accepted packs use HT amounts and exact seconds",()=>{
  assert.deepEqual(packs.VIDEO_CREDIT_PACKS.map(({seconds,priceEurHt})=>[seconds,priceEurHt]),[[50,8],[100,15],[200,29],[500,69]]);
});
test("unpaid completed checkout remains pending and never grants seconds",async()=>{
  const f=fixture({prepared:true,mutateSession:s=>{s.status="complete";}});
  const result=await f.start(); assert.equal(result.completed,false); assert.equal(result.pending,true);
  assert.ok(!f.calls.some(c=>c.name==="fulfill_ai_media_video_credit_order"));
});
test("server verified payment checks line items, intent and charge before grant",async()=>{
  const f=fixture({paid:true,prepared:true});
  assert.equal((await f.start()).completed,true);
  const grant=f.calls.find(c=>c.name==="fulfill_ai_media_video_credit_order");
  assert.equal(grant?.args.p_amount_subtotal_cents,800); assert.equal(grant?.args.p_amount_total_cents,960);
  assert.equal(grant?.args.p_account_id,accountId); assert.equal(grant?.args.p_refunded_amount_cents,0);
  assert.ok(f.reads.some(p=>p.includes("/line_items"))); assert.ok(f.reads.some(p=>p.includes("/payment_intents")));
});
test("already refunded Stripe charge is reconciled atomically at fulfillment",async()=>{
  const f=fixture({paid:true,refunded:960});
  await f.api.fulfillVideoCreditCheckout("cs_test","evt_again");
  assert.equal(f.calls.find(c=>c.name==="fulfill_ai_media_video_credit_order")?.args.p_refunded_amount_cents,960);
});
test("paid historic order retains its original amount after a later catalogue price update",async()=>{
  const f=fixture({paid:true});
  f.order.amount_ht_cents=700;f.price.unit_amount=700;
  f.session.amount_subtotal=700;f.session.amount_total=840;
  f.intent.amount_received=840;(f.intent.latest_charge as Row).amount=840;
  await f.api.fulfillVideoCreditCheckout("cs_test","evt_original_price");
  assert.equal(f.calls.find(c=>c.name==="fulfill_ai_media_video_credit_order")?.args.p_amount_subtotal_cents,700);
});
test("Stripe checkout uses frozen server amounts, tax/invoice setup and account metadata",async()=>{
  const f=fixture(); const result=await f.start(); assert.equal(result.url,f.session.url);
  const params=new URLSearchParams(f.posts[0].params);
  assert.equal(params.get("mode"),"payment"); assert.equal(params.get("line_items[0][price]"),"price_video_50");
  assert.equal(params.get("line_items[0][quantity]"),"1"); assert.equal(params.get("automatic_tax[enabled]"),"true");
  assert.equal(params.get("invoice_creation[enabled]"),"true"); assert.equal(params.get("metadata[account_id]"),accountId);
  assert.deepEqual(f.posts[0].config,{idempotencyKey:`video-credit-checkout-v1-${orderId}`});
  assert.equal(f.order.stripe_checkout_session_id,"cs_test");
  await f.start(); assert.equal(f.posts.length,1);
});
test("verified expired checkout returns a safe reset signal; uncertain timeout stays fenced",async()=>{
  const expired=fixture({prepared:true,expired:true});
  assert.equal((await expired.start()).expired,true); assert.equal(expired.order.status,"expired");
  assert.equal(expired.posts.length,0);
  const uncertain=fixture({uncertain:true});
  await assert.rejects(uncertain.start(),/RECONCILIATION_REQUIRED/); assert.equal(uncertain.posts.length,0);
});
test("complete unpaid session is bound to its order for later authenticated reconciliation",async()=>{
  const f=fixture({mutateSession:s=>{s.status="complete";}});
  const result=await f.start(); assert.equal(result.pending,true); assert.equal(f.order.stripe_checkout_session_id,"cs_test");
});
for (const [label,mutate] of [
  ["wrong account",(s: Row)=>{(s.metadata as Row).account_id="other-account";}],
  ["wrong customer",(s: Row)=>{s.customer="cus_other";}],
  ["wrong initiating actor",(s: Row)=>{(s.metadata as Row).actor_auth_user_id="other-actor";}],
  ["another Stripe mode",(s: Row)=>{s.livemode=true;}],
  ["tampered subtotal",(s: Row)=>{s.amount_subtotal=1;}],
  ["unexpected discount",(s: Row)=>{(s.total_details as Row).amount_discount=1;}],
  ["unfinished tax",(s: Row)=>{(s.automatic_tax as Row).status="requires_location_inputs";}],
] as const) test(`reject ${label} without fulfillment`,async()=>{
  const f=fixture({paid:true,mutateSession:mutate});
  await assert.rejects(f.api.fulfillVideoCreditCheckout("cs_test","evt_bad"),/PAYMENT_SCOPE_MISMATCH/);
  assert.ok(!f.calls.some(c=>c.name==="fulfill_ai_media_video_credit_order"));
});
test("wrong recurring/inclusive or modified Stripe prices cannot create a checkout",async()=>{
  for (const mutation of [(p: Row)=>{p.unit_amount=1;},(p: Row)=>{p.tax_behavior="inclusive";},(p: Row)=>{p.type="recurring";},(p: Row)=>{p.active=false;}]) {
    const f=fixture({mutatePrice:mutation}); await assert.rejects(f.start(),/PRICE_CONFIGURATION_INVALID/); assert.equal(f.calls.length,0); assert.equal(f.posts.length,0);
  }
});
test("a customer linked to another account is rejected without email recovery",async()=>{
  const f=fixture({customerAccount:"other-account"}); await assert.rejects(f.start(),/CUSTOMER_SCOPE_MISMATCH/); assert.equal(f.posts.length,0);
});
test("refund uses the current live cumulative Stripe charge",async()=>{
  const f=fixture({paid:true,refunded:480}); await f.api.reconcileVideoCreditRefund("ch_test","evt_refund");
  assert.equal(f.calls.find(c=>c.name==="refund_ai_media_video_credit_order")?.args.p_refunded_amount_cents,480);
});
test("fulfillment atomically reconciles current disputed funds before making credits available",async()=>{
  const f=fixture({paid:true,disputed:true});
  await f.api.fulfillVideoCreditCheckout("cs_test","evt_credit");
  assert.deepEqual(f.calls.find(c=>c.name==="fulfill_ai_media_video_credit_order")?.args.p_disputes,
    [{id:"du_test",charge_id:"ch_test",amount:960,currency:"eur",status:"needs_response"}]);
  assert.ok(f.reads.includes("/disputes?charge=ch_test&limit=100"));
  const uncertain=fixture({paid:true,disputed:true,disputes:[]});
  await assert.rejects(uncertain.api.fulfillVideoCreditCheckout("cs_test","evt_missing"),/DISPUTE_STATE_UNCERTAIN/);
  assert.ok(!uncertain.calls.some(c=>c.name==="fulfill_ai_media_video_credit_order"));
});
test("a dispute handler rereads Stripe current status instead of replaying event hints",async()=>{
  const f=fixture({paid:true});f.disputes[0].status="won";
  await f.api.reconcileVideoCreditDispute("du_test","evt_old_withdrawal");
  const change=f.calls.find(c=>c.name==="reconcile_ai_media_video_credit_dispute");
  assert.equal(change?.args.p_status,"won");assert.equal(change?.args.p_account_id,accountId);
  assert.equal(change?.args.p_charge_amount_cents,960);
  assert.deepEqual(f.reads,["/disputes/du_test","/charges/ch_test","/payment_intents/pi_test"]);
});
test("dispute validation blocks another charge, customer, mode or account without altering credit",async()=>{
  for (const mutate of [
    (f: ReturnType<typeof fixture>)=>{f.disputes[0].charge="ch_other";},
    (f: ReturnType<typeof fixture>)=>{f.disputes[0].payment_intent="pi_other";},
    (f: ReturnType<typeof fixture>)=>{f.disputes[0].livemode=true;},
    (f: ReturnType<typeof fixture>)=>{f.intent.customer="cus_other";},
    (f: ReturnType<typeof fixture>)=>{(f.intent.metadata as Row).account_id="another-account";},
  ]) {
    const f=fixture({paid:true});mutate(f);
    await assert.rejects(f.api.reconcileVideoCreditDispute("du_test","evt_bad"));
    assert.ok(!f.calls.some(c=>c.name==="reconcile_ai_media_video_credit_dispute"));
  }
});
test("existing suspended credit is reread even when charge.disputed becomes false",async()=>{
  const f=fixture({paid:true});f.order.held_seconds=50;f.disputes[0].status="prevented";
  await f.api.fulfillVideoCreditCheckout("cs_test","evt_return");
  assert.equal((f.calls.find(c=>c.name==="fulfill_ai_media_video_credit_order")?.args.p_disputes as Row[])[0].status,"prevented");
});
test("confirmed asynchronous failure resets safely while processing and transient errors remain pending",async()=>{
  const f=fixture({prepared:true,mutateSession:s=>{s.status="complete";}});
  f.intent.status="requires_payment_method";f.intent.last_payment_error={code:"payment_failed"};
  let result=await f.start();assert.equal(result.failed,true);assert.equal(result.pending,false);assert.equal(f.order.status,"failed");
  assert.ok(!f.calls.some(c=>c.name==="fulfill_ai_media_video_credit_order"));
  const pending=fixture({prepared:true,mutateSession:s=>{s.status="complete";}});
  pending.intent.status="processing";
  result=await pending.start();assert.equal(result.pending,true);assert.equal(result.failed,false);assert.equal(pending.order.status,"pending");
});
test("verified checkout expiration can be persisted through the same server reconciliation",async()=>{
  const f=fixture({prepared:true,expired:true});
  assert.equal(await f.api.fulfillVideoCreditCheckout("cs_test","evt_expired"),false);
  assert.equal(f.order.status,"expired");assert.equal(f.posts.length,0);
});
test("redirect validation accepts only HTTPS Stripe Checkout without userinfo",()=>{
  assert.equal(packs.isStripeCheckoutUrl("https://checkout.stripe.com/c/pay/test"),true);
  for (const url of ["https://checkout.stripe.com.evil.invalid/c/pay/test","http://checkout.stripe.com/c/pay/test","https://user@checkout.stripe.com/c/pay/test","javascript:alert(1)"]) assert.equal(packs.isStripeCheckoutUrl(url),false);
});
