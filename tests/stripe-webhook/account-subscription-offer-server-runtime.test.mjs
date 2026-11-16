import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeModules } from '../inragent/runtime-module-loader.mts';

const OWNER='10000000-0000-4000-8000-000000000001';
const SECONDARY='10000000-0000-4000-8000-000000000002';
const OTHER='20000000-0000-4000-8000-000000000001';
const clone = value => structuredClone(value);
const bindings = () => [
  {account_id:OWNER,auth_user_id:OWNER,stripe_customer_id:'cus_Approved',stripe_subscription_id:'sub_Primary',stripe_price_id:'price_Standard58',plan:'Premium',app_edition:'premium',status:'active',monthly_price_eur:58,monthly_price_tax_behavior:'exclusive',billing_cycle:'monthly',billing_provider:'stripe',start_date:'2026-11-10',next_renewal_date:'2026-12-10',cancel_requested_at:null,end_date:null},
  {account_id:SECONDARY,auth_user_id:OWNER,stripe_customer_id:'cus_Approved',stripe_subscription_id:'sub_Secondary',stripe_price_id:'price_Standard58',plan:'Premium',app_edition:'premium',status:'active',monthly_price_eur:58,monthly_price_tax_behavior:'exclusive',billing_cycle:'monthly',billing_provider:'stripe',start_date:'2026-11-16',next_renewal_date:'2026-12-16',cancel_requested_at:null,end_date:null},
  {account_id:OTHER,auth_user_id:OTHER,stripe_customer_id:'cus_Other',stripe_subscription_id:'sub_Other',stripe_price_id:'price_Other',plan:'Premium',app_edition:'premium',status:'active',monthly_price_eur:69,monthly_price_tax_behavior:'exclusive',billing_cycle:'monthly',billing_provider:'stripe',start_date:'2026-11-01',next_renewal_date:'2026-12-01',cancel_requested_at:null,end_date:null},
];

function fixture() {
  const rows=bindings(), members=[{account_id:OWNER,auth_user_id:OWNER,role:'owner'}, {account_id:SECONDARY,auth_user_id:OWNER,role:'owner'}, {account_id:OTHER,auth_user_id:OTHER,role:'owner'}];
  const calls=[],faults=[];
  const control={beforeUpdate:null};
  const db={from(table) {
    let operation='select',patch=null,columns='*'; const filters=[];
    const run=async single=>{
      calls.push({table,operation,patch:clone(patch),filters:clone(filters)});
      const faultIndex=faults.findIndex(fault=>fault.table===table&&(!fault.operation||fault.operation===operation));
      if(faultIndex>=0) return {data:null,error:faults.splice(faultIndex,1)[0].error};
      const source=table==='inrcy_account_subscriptions'?rows:table==='inrcy_account_members'?members:null;
      assert.ok(source,`unexpected table ${table}`);
      const matches=source.filter(row=>filters.every(([kind,key,value])=>kind==='eq'?row[key]===value:value.includes(row[key])));
      if(operation==='update') {
        // The real SQL test verifies this trigger. Reflect its ownership guard
        // here so a stateful fake never silently bypasses database enforcement.
        if(matches.some(row=>!members.some(member=>member.account_id===row.account_id&&member.auth_user_id===row.auth_user_id&&member.role==='owner'))) return {data:null,error:{code:'P0001',message:'ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED'}};
        for(const row of matches) Object.assign(row,clone(patch));
      }
      const project=row=>columns==='*'?clone(row):Object.fromEntries(columns.split(',').filter(key=>Object.hasOwn(row,key)).map(key=>[key,clone(row[key])]));
      const data=matches.map(project);
      return {data:single?(data[0]??null):data,error:null};
    };
    const query={
      select(value){columns=value;return query;},
      eq(key,value){filters.push(['eq',key,value]);return query;},
      in(key,value){filters.push(['in',key,value]);return query;},
      update(value){operation='update';patch=value;control.beforeUpdate?.();return query;},
      maybeSingle(){return run(true);},
      then(resolve,reject){return run(false).then(resolve,reject);},
    };
    return query;
  }};
  const load=runtimeModules({'@/lib/supabaseAdmin':{supabaseAdmin:db}});
  const api=load('lib/accountBillingSubscriptionServer.ts');
  const stripe=load('lib/adminSubscriberStripe.ts');
  return {api,stripe,rows,members,calls,faults,control,fail(table,code,operation){faults.push({table,operation,error:{code,message:'synthetic backend error'}});}};
}

function liveSubscription(overrides={}) {
  return {
    id:'sub_Secondary',object:'subscription',livemode:true,created:Date.parse('2026-11-16T12:00:00Z')/1000,
    customer:{id:'cus_Approved',name:'Same business label'},status:'active',
    metadata:{plan:'Standard',company:'Same business label'},current_period_end:Date.parse('2026-12-20T00:00:00Z')/1000,
    cancel_at_period_end:false,cancel_at:null,canceled_at:null,ended_at:null,
    items:{has_more:false,data:[{quantity:1,current_period_end:Date.parse('2026-12-16T00:00:00Z')/1000,
      price:{id:'price_Standard58',currency:'eur',billing_scheme:'per_unit',tax_behavior:'exclusive',unit_amount:5800,recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]},
    ...overrides,
  };
}

test('approved subscriptions are read only for the exact establishment/payer and a current owner membership',async()=>{
  const f=fixture();
  assert.equal((await f.api.getApprovedAccountSubscription(OWNER,OWNER)).stripe_subscription_id,'sub_Primary');
  assert.equal((await f.api.getApprovedAccountSubscription(SECONDARY,OWNER)).stripe_subscription_id,'sub_Secondary');
  assert.equal(await f.api.getApprovedAccountSubscription(SECONDARY,OTHER),null);
  assert.equal(await f.api.getApprovedAccountSubscription('unknown-account',OWNER),null);
  f.members.find(row=>row.account_id===SECONDARY).role='admin';
  await assert.rejects(f.api.getApprovedAccountSubscription(SECONDARY,OWNER),/ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED/);
  assert.ok(f.calls.filter(call=>call.table==='inrcy_account_subscriptions').every(call=>call.filters.some(([kind,key])=>kind==='eq'&&key==='account_id')&&call.filters.some(([kind,key])=>kind==='eq'&&key==='auth_user_id')));
});

test('lookup by Stripe id resolves its actual account and rechecks the exact current owner',async()=>{
  const f=fixture();
  assert.equal((await f.api.getApprovedAccountSubscriptionByStripeId('sub_Secondary')).account_id,SECONDARY);
  assert.equal(await f.api.getApprovedAccountSubscriptionByStripeId('sub_Unapproved'),null);
  f.members.splice(f.members.findIndex(row=>row.account_id===SECONDARY),1);
  await assert.rejects(f.api.getApprovedAccountSubscriptionByStripeId('sub_Secondary'),/ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED/);
});

test('batch lookup is scoped to requested accounts and refuses incomplete or unavailable owner evidence',async()=>{
  const f=fixture();
  assert.deepEqual([...await f.api.getApprovedAccountSubscriptionsForAccounts([])],[]);
  assert.equal(f.calls.length,0);
  const accounts=await f.api.getApprovedAccountSubscriptionsForAccounts([OWNER,SECONDARY]);
  assert.deepEqual([...accounts.keys()],[OWNER,SECONDARY]);
  assert.equal(accounts.get(OWNER).monthly_price_eur,58);
  assert.equal(accounts.get(SECONDARY).monthly_price_eur,58);
  assert.equal(accounts.has(OTHER),false);
  f.fail('inrcy_account_members','XX000');
  await assert.rejects(f.api.getApprovedAccountSubscriptionsForAccounts([OWNER,SECONDARY]),/ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED/);
  f.members.find(row=>row.account_id===SECONDARY).auth_user_id=OTHER;
  await assert.rejects(f.api.getApprovedAccountSubscriptionsForAccounts([OWNER,SECONDARY]),/ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED/);
});

test('only a missing migration permits legacy fallback; real database failures fail closed',async()=>{
  for(const code of ['42P01','PGRST205']) {
    const f=fixture();
    const operations=[
      [()=>f.api.getApprovedAccountSubscription(OWNER,OWNER),null],
      [()=>f.api.getApprovedAccountSubscriptionByStripeId('sub_Primary'),null],
      [()=>f.api.getApprovedAccountSubscriptionsForAccounts([OWNER]),new Map()],
      [()=>f.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription()),null],
      [()=>f.api.syncApprovedAccountSubscriptionSnapshots([]),[]],
    ];
    for(const [operation,expected] of operations) {f.fail('inrcy_account_subscriptions',code);assert.deepEqual(await operation(),expected);}
    assert.equal(f.calls.filter(call=>call.operation==='update').length,0);
  }
  for(const operation of [
    f=>f.api.getApprovedAccountSubscription(OWNER,OWNER),
    f=>f.api.getApprovedAccountSubscriptionByStripeId('sub_Primary'),
    f=>f.api.getApprovedAccountSubscriptionsForAccounts([OWNER]),
    f=>f.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription()),
    f=>f.api.syncApprovedAccountSubscriptionSnapshots([]),
  ]) {const f=fixture();f.fail('inrcy_account_subscriptions','42501');await assert.rejects(operation(f),/ACCOUNT_SUBSCRIPTION_READ_UNAVAILABLE/);}
});

test('live Standard Stripe terms update only the exact secondary contract and preserve Premium at 58 HT',async()=>{
  const f=fixture(),before=clone(f.rows);
  const result=await f.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription({status:'past_due'}));
  assert.deepEqual(result,{account_id:SECONDARY,auth_user_id:OWNER});
  const updated=f.rows.find(row=>row.account_id===SECONDARY);
  assert.equal(updated.plan,'Premium');assert.equal(updated.app_edition,'premium');
  assert.equal(updated.monthly_price_eur,58);assert.equal(updated.monthly_price_tax_behavior,'exclusive');
  assert.equal(updated.billing_cycle,'monthly');assert.equal(updated.stripe_price_id,'price_Standard58');
  assert.equal(updated.status,'past_due');assert.equal(updated.next_renewal_date,'2026-12-16');
  assert.deepEqual(f.rows.find(row=>row.account_id===OWNER),before[0]);
  assert.deepEqual(f.rows.find(row=>row.account_id===OTHER),before[2]);
  for(const call of f.calls.filter(call=>call.operation==='update')) {
    assert.deepEqual(call.filters,[['eq','account_id',SECONDARY],['eq','stripe_subscription_id','sub_Secondary'],['eq','stripe_customer_id','cus_Approved']]);
    for(const immutable of ['plan','app_edition','account_id','auth_user_id','stripe_customer_id','stripe_subscription_id']) assert.equal(Object.hasOwn(call.patch,immutable),false,immutable);
  }
});

test('shared names or customer ids do not authorize a different contract, and conflicts never write',async()=>{
  const f=fixture(),before=clone(f.rows);
  assert.equal(await f.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription({id:'sub_UnapprovedSameCustomer'})),null);
  await assert.rejects(f.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription({customer:'cus_Wrong'})),/ACCOUNT_SUBSCRIPTION_IDENTITY_CONFLICT/);
  await assert.rejects(f.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription({status:'unknown-status'})),/ACCOUNT_SUBSCRIPTION_IDENTITY_CONFLICT/);
  assert.deepEqual(f.rows,before);
  assert.equal(f.calls.filter(call=>call.operation==='update').length,0);
});

test('both monthly and annual Stripe terms use real amount normalization without assigning a second Premium allowance',async()=>{
  const f=fixture();
  const annual=liveSubscription({id:'sub_Primary',customer:'cus_Approved'});
  annual.items.data[0].price.unit_amount=69600;
  annual.items.data[0].price.recurring.interval='year';
  annual.items.data[0].price.id='price_Standard58Annual';
  await f.api.syncApprovedAccountSubscriptionFromStripe(annual);
  const row=f.rows.find(value=>value.account_id===OWNER);
  assert.equal(row.monthly_price_eur,58);assert.equal(row.billing_cycle,'yearly');
  assert.equal(row.plan,'Premium');assert.equal(row.app_edition,'premium');
  assert.equal(row.stripe_price_id,'price_Standard58Annual');
  assert.ok(f.calls.every(call=>['inrcy_account_subscriptions','inrcy_account_members'].includes(call.table)),'subscription synchronization does not mint credits or touch quota tables');
});

test('cancellation and resumption stay scoped to the exact secondary contract and keep functional rights and price intact',async()=>{
  const f=fixture(),before=clone(f.rows);
  const canceledAt=Date.parse('2026-11-20T12:00:00Z')/1000;
  await f.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription({cancel_at_period_end:true,canceled_at:canceledAt}));
  const row=f.rows.find(value=>value.account_id===SECONDARY);
  assert.equal(row.cancel_requested_at,'2026-11-20T12:00:00.000Z');assert.equal(row.end_date,'2026-12-16');
  assert.equal(row.status,'active');assert.equal(row.plan,'Premium');assert.equal(row.monthly_price_eur,58);
  await f.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription());
  assert.equal(row.cancel_requested_at,null);assert.equal(row.end_date,null);
  assert.deepEqual(f.rows[0],before[0]);assert.deepEqual(f.rows[2],before[2]);
});

test('write failures or revoked ownership prevent a successful synchronization receipt',async()=>{
  const unavailable=fixture(),before=clone(unavailable.rows);
  unavailable.fail('inrcy_account_subscriptions','XX000','update');
  await assert.rejects(unavailable.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription()),/ACCOUNT_SUBSCRIPTION_SYNC_UNAVAILABLE/);
  assert.deepEqual(unavailable.rows,before);
  const revoked=fixture();revoked.members.find(row=>row.account_id===SECONDARY).role='member';
  await assert.rejects(revoked.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription()),/ACCOUNT_SUBSCRIPTION_SYNC_UNAVAILABLE/);
  assert.deepEqual(revoked.rows,bindings());
});

test('batch Stripe reconciliation synchronizes only existing approved exact ids and preserves unrelated contracts',async()=>{
  const f=fixture(),before=clone(f.rows);
  const known=f.stripe.stripeAdminSubscriberSnapshot(liveSubscription({status:'past_due'}));
  const unknown=f.stripe.stripeAdminSubscriberSnapshot(liveSubscription({id:'sub_UnapprovedSameCustomer',status:'canceled'}));
  assert.ok(known);assert.ok(unknown);
  assert.deepEqual(await f.api.syncApprovedAccountSubscriptionSnapshots([unknown,known]),['sub_Secondary']);
  assert.equal(f.rows[1].status,'past_due');assert.equal(f.rows[1].plan,'Premium');assert.equal(f.rows[1].monthly_price_eur,58);
  assert.deepEqual(f.rows[0],before[0]);assert.deepEqual(f.rows[2],before[2]);
});

test('a newer verified webhook wins over an older cron snapshot',async()=>{
  const f=fixture();f.rows[1].updated_at='2026-11-16T15:00:02.000Z';
  const stale=f.stripe.stripeAdminSubscriberSnapshot(liveSubscription({status:'past_due'}));
  assert.deepEqual(await f.api.syncApprovedAccountSubscriptionSnapshots([stale],Date.parse('2026-11-16T15:00:01Z')),['sub_Secondary']);
  assert.equal(f.rows[1].status,'active');assert.equal(f.calls.filter(call=>call.operation==='update').length,0);
});

test('a concurrent contract update consumes the compare-and-swap without splitting lifecycle and status writes',async()=>{
  const f=fixture();f.rows[1].updated_at='2026-11-16T15:00:01Z';
  f.control.beforeUpdate=()=>{f.rows[1].updated_at='2026-11-16T15:00:02Z';f.rows[1].status='active';};
  assert.equal(await f.api.syncApprovedAccountSubscriptionFromStripe(liveSubscription({status:'past_due',cancel_at_period_end:true})),null);
  assert.equal(f.rows[1].status,'active');assert.equal(f.rows[1].cancel_requested_at,null);
  assert.equal(f.calls.filter(call=>call.operation==='update').length,1);
  assert.ok(f.calls.find(call=>call.operation==='update').filters.some(([,key,value])=>key==='updated_at'&&value==='2026-11-16T15:00:01Z'));
});
