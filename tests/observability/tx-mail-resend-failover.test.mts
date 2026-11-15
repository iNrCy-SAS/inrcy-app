import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { TxMail } from "../../lib/txMailer.ts";
import * as resendPolicy from "../../lib/resendFailurePolicy.ts";

type Receipt = {messageId:string; accepted:string[]; rejected:string[]};
function runtime(options: {smtpError?: unknown; circuitError?: unknown; hangSmtp?: boolean; handshakeComplete?: boolean; noKey?: boolean; noSharedStorage?: boolean; redisFailure?: boolean; quotaStore?: Map<string, unknown>; provider?: (url: URL, init: RequestInit) => Promise<Response>} = {}) {
  const requests: Array<{url: URL; init: RequestInit; payload: Record<string, unknown>}> = [];
  const waits: number[] = [];
  const quotaStore = options.quotaStore ?? new Map<string, unknown>();
  const quotaGlobals = {};
  let smtpSends = 0;
  const env: Record<string, string> = {NODE_ENV:"production", KV_REST_API_URL:"https://quota.invalid",KV_REST_API_TOKEN:"fixture-only", TX_SMTP_HOST:"smtp.example.test", TX_SMTP_PORT:"587", TX_SMTP_USER:"sender@example.test", TX_SMTP_PASS:"fixture-password", TX_MAIL_FROM:"iNrCy <sender@example.test>", ...(options.noKey ? {} : {RESEND_API_KEY:"re_fixture_only"})};
  const record = (e: unknown) => e as {code?: string; responseCode?: number};
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/resendFailurePolicy": resendPolicy,
    "@/lib/upstashMode": {shouldBypassUpstashInCurrentEnv: () => options.noSharedStorage === true},
    "@upstash/redis": {Redis: class {constructor(config: {retry: boolean; signal: () => AbortSignal}) {assert.equal(config.retry,false); assert.ok(config.signal() instanceof AbortSignal);} async get(key: string) {if(options.redisFailure) throw Error("Redis unavailable"); return quotaStore.get(key) ?? null;} async set(key: string, value: unknown) {if(options.redisFailure) throw Error("Redis unavailable"); quotaStore.set(key,structuredClone(value));}}},
    "nodemailer": {createTransport: () => ({sendMail: async () => {smtpSends++; if(options.smtpError) throw options.smtpError; return {messageId:"smtp-accepted",accepted:["recipient@example.test"],rejected:[]};},close() {}})},
    "@/lib/env": {optionalEnv: (key: string, fallback = "") => env[key] ?? fallback, requireEnv: (key: string) => {assert.ok(env[key],key); return env[key];}},
    "@/lib/health/smtpRetryPolicy": {createSmtpHandshakeRetryGuard: () => ({canRetry:()=>options.handshakeComplete!==true}), withSmtpHandshakeRetry: (send: (attempt: number) => unknown) => send(1)},
    "@/lib/txSmtpCircuit": {assertTxSmtpCircuitClosed: async () => {if(options.circuitError) throw options.circuitError;},clearTxSmtpCircuit: async () => {},openTxSmtpCircuit: async () => {},
      isTxSmtpAuthenticationFailure: (e: unknown) => record(e)?.code === "EAUTH" || record(e)?.responseCode === 535,
      isTxSmtpCircuitOpenError: (e: unknown) => record(e)?.code === "TX_SMTP_AUTH_BACKOFF"},
  };
  const fetch = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    requests.push({url,init,payload:init.body ? JSON.parse(String(init.body)) : {}});
    return options.provider ? options.provider(url,init) : Response.json({id:"resend-accepted"});
  };
  function load(file: string) {
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
    new Function("exports","require","process","fetch","setTimeout","globalThis",code)(exports,(id: string) => {assert.ok(id in dependencies,id); return dependencies[id];},{env},fetch,(callback: () => void, ms: number) => {waits.push(ms); callback(); return 0;},quotaGlobals);
    return exports;
  }
  dependencies["@/lib/txResendQuota"] = load("lib/txResendQuota.ts");
  dependencies["@/lib/txResend"] = load("lib/txResend.ts");
  const mailer = load("lib/txMailer.ts") as {sendTxMail: (mail: TxMail) => Promise<Receipt>};
  const provider = dependencies["@/lib/txResend"] as {verifyTxResendFallback: (from: string) => Promise<void>};
  const healthSource = readFileSync(new URL("../../lib/health/checks.ts",import.meta.url),"utf8");
  const healthAst = ts.createSourceFile("health.ts",healthSource,ts.ScriptTarget.Latest,true);
  const fragments = ["canCheckSmtp","timeCheck","checkSmtp"].map(name => {
    const declaration = healthAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration,name); return declaration.getText(healthAst);
  });
  const healthBindings = {...dependencies["@/lib/txSmtpCircuit"] as object,...dependencies["@/lib/txResend"] as object,...dependencies["@/lib/env"] as object,
    nodemailer:dependencies.nodemailer,process:{env},normalizeError:(e: Error) => e.message,
    verifySmtpWithHandshakeRetry:async (verify: (attempt: number) => Promise<unknown>) => {if(options.smtpError) throw options.smtpError; await verify(1);}};
  const healthCode = ts.transpileModule(fragments.join("\n")+"\nreturn checkSmtp();",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  type Health = {ok:boolean; error?:string; warning?:string; details?:{provider?:string; smtp_auth_blocked?:boolean; quota_scope?:string; retry_at?:string; retry_at_is_estimate?:boolean; quota_state_storage?:string}};
  const health = () => new Function(...Object.keys(healthBindings),healthCode)(...Object.values(healthBindings)) as Promise<Health>;
  // The SMTP verifier itself is substituted below; it never authenticates or sends.
  (dependencies.nodemailer as {createTransport: () => unknown}).createTransport = () => ({
    sendMail:async () => {smtpSends++; if(options.smtpError) throw options.smtpError; if(options.hangSmtp)return new Promise<never>(()=>{}); return {messageId:"smtp-accepted",accepted:[mail.to],rejected:[]};},verify:async () => {},close() {},
  });
  return {requests,waits,env,send:mailer.sendTxMail,verify:provider.verifyTxResendFallback,health,smtpSends:() => smtpSends};
}
const mail: TxMail = {to:"recipient@example.test",subject:"Fictitious reminder",text:"Synthetic content only",idempotencyKey:"trial/fixture/end/marker"};
const authError = {code:"EAUTH",responseCode:535,command:"AUTH PLAIN"};

test("normal SMTP success does not send a second email through Resend",async () => {
  const h = runtime(); assert.equal((await h.send(mail)).messageId,"smtp-accepted"); assert.equal(h.requests.length,0);
});
test("a confirmed SMTP AUTH refusal uses the same sender and recipient through Resend",async () => {
  const h = runtime({smtpError:authError}); const receipt = await h.send(mail);
  assert.equal(h.smtpSends(),1); assert.equal(h.requests.length,1); assert.equal(receipt.messageId,"resend-accepted");
  assert.equal(h.requests[0].payload.from,h.env.TX_MAIL_FROM); assert.deepEqual(h.requests[0].payload.to,[mail.to]);
  assert.deepEqual(receipt.accepted,[mail.to]);
});
test("an open authentication circuit goes straight to Resend without another SMTP attempt",async () => {
  const h = runtime({circuitError:{code:"TX_SMTP_AUTH_BACKOFF"}}); await h.send(mail);
  assert.equal(h.smtpSends(),0); assert.equal(h.requests.length,1);
});
for (const error of [{code:"ETIMEDOUT",command:"DATA"},{code:"ECONNRESET",command:"DATA"},{code:"EENVELOPE",command:"RCPT TO"},{code:"EAUTH",responseCode:535,command:"DATA"}]) test(`an ambiguous or recipient failure at ${error.command}/${error.code} cannot cross providers`,async () => {
  const h = runtime({smtpError:error}); await assert.rejects(h.send(mail),e => e === error); assert.equal(h.requests.length,0);
});
test("absence of a configured fallback preserves the original authentication failure",async () => {
  const h = runtime({smtpError:authError,noKey:true}); await assert.rejects(h.send(mail),e => e === authError); assert.equal(h.requests.length,0);
});

test("only an attested pre-authentication CONN failure is definitely retryable without provider failover",async () => {
  for(const handshakeComplete of [false,true]) {
    const error=Object.assign(Error("SMTP timeout"),{code:"ETIMEDOUT",command:"CONN"});
    const h=runtime({smtpError:error,handshakeComplete});
    await assert.rejects(h.send(mail),failure=>{
      assert.equal((failure as {deliveryState?:string}).deliveryState,handshakeComplete?undefined:"rejected"); return true;
    });
    assert.equal(h.requests.length,0);
  }
});

test("worker deadlines after send invocation remain unknown even when AUTH has not yet been observed",async () => {
  for(const handshakeComplete of [false,true]) {
    const h=runtime({hangSmtp:true,handshakeComplete});
    await assert.rejects(h.send({...mail,deadlineAt:Date.now()+1000}),failure=>{
      assert.equal((failure as {code:string}).code,"TX_SMTP_DELIVERY_DEADLINE");
      assert.equal((failure as {deliveryState:string}).deliveryState,"unknown");assert.equal((failure as {retryable:boolean}).retryable,false);return true;
    });
    assert.equal(h.requests.length,0);assert.equal(h.smtpSends(),1);
  }
  const before=runtime({hangSmtp:true});
  await assert.rejects(before.send({...mail,deadlineAt:Date.now()-1}),failure=>(failure as {deliveryState:string}).deliveryState==="rejected");
  assert.equal(before.smtpSends(),0,"an expired worker never starts a new SMTP operation");
});

test("a negative DATA reply certifies non-delivery while an absent or inconsistent reply stays unknown",async()=>{
  for(const response of ["451 4.3.0 Temporary processing failure",undefined,"250 Message accepted"]){
    const error=Object.assign(Error("SMTP DATA failure"),{code:"EMESSAGE",command:"DATA",responseCode:451,response});
    const h=runtime({smtpError:error,handshakeComplete:true});
    await assert.rejects(h.send(mail),failure=>{assert.equal((failure as {deliveryState?:string}).deliveryState,response?.startsWith("451")?"rejected":undefined);return true;});
    assert.equal(h.requests.length,0,"a DATA response never crosses to another provider");
  }
});
test("a stable event key protects retries while another reminder gets a different key",async () => {
  const h = runtime({smtpError:authError}); await h.send(mail); await h.send(mail); await h.send({...mail,idempotencyKey:"trial/fixture/another-end/marker"});
  const keys = h.requests.map(r => new Headers(r.init.headers).get("Idempotency-Key"));
  assert.equal(keys[0],keys[1]); assert.notEqual(keys[0],keys[2]); assert.ok(keys[0] && !keys[0].includes(mail.to));
});
test("inline logos and attached files retain their content and CID",async () => {
  const h = runtime({smtpError:authError}); await h.send({...mail,attachments:[{filename:"logo.png",mimeType:"image/png",content:Buffer.from("logo"),inline:true,cid:"brand-logo"},{filename:"invoice.pdf",mimeType:"application/pdf",content:Buffer.from("pdf")}]});
  const attachments = h.requests[0].payload.attachments as Array<Record<string,unknown>>;
  assert.equal(attachments[0].content_id,"brand-logo"); assert.equal(Buffer.from(String(attachments[0].content),"base64").toString(),"logo"); assert.equal(attachments[1].content_id,undefined);
});
for (const status of [401,429,500]) test(`a Resend ${status} response is a failure, never a delivery receipt`,async () => {
  const h = runtime({smtpError:authError,provider:async () => Response.json({message:"Provider refused"},{status})});
  await assert.rejects(h.send(mail),error => (error as {responseCode:number}).responseCode === status); assert.equal(h.requests.length,1);
});
test("a provider rate limit waits before retrying the same idempotency key and confirms one acceptance",async () => {
  let calls = 0;
  const h = runtime({smtpError:authError,provider:async () => ++calls === 1
    ? Response.json({name:"rate_limit_exceeded",message:"Too many requests"},{status:429,headers:{"Retry-After":"2"}})
    : Response.json({id:"accepted-after-wait"})});
  assert.equal((await h.send(mail)).messageId,"accepted-after-wait");
  assert.deepEqual(h.waits,[2_000]); assert.equal(h.smtpSends(),1);
  assert.equal(new Headers(h.requests[0].init.headers).get("Idempotency-Key"),new Headers(h.requests[1].init.headers).get("Idempotency-Key"));
  assert.equal(h.requests[0].init.body,h.requests[1].init.body);
});
test("a long provider Retry-After is returned without retrying earlier than the permitted time",async () => {
  const h = runtime({smtpError:authError,provider:async () => Response.json({name:"rate_limit_exceeded",message:"Still limited"},{status:429,headers:{"Retry-After":"9999"}})});
  await assert.rejects(h.send(mail),error => (error as {retryAfterSeconds:number}).retryAfterSeconds === 9999); assert.equal(h.requests.length,1); assert.deepEqual(h.waits,[]);
});
test("a successful response without a provider message ID cannot confirm delivery",async () => {
  const h = runtime({smtpError:authError,provider:async () => Response.json({})}); await assert.rejects(h.send(mail),/pas confirmée/);
});
test("health verifies the configured sender domain using GET only",async () => {
  const h = runtime({provider:async () => Response.json({data:[{name:"example.test",status:"verified"}]})});
  await h.verify(h.env.TX_MAIL_FROM); assert.equal(h.requests[0].init.method,"GET"); assert.equal(h.requests[0].url.pathname,"/domains"); assert.equal(h.smtpSends(),0);
});
test("an unverified fallback domain is not considered healthy",async () => {
  const h = runtime({provider:async () => Response.json({data:[{name:"example.test",status:"pending"}]})}); await assert.rejects(h.verify(h.env.TX_MAIL_FROM),/pas validé/);
});

test("deep health reports a usable Resend fallback and keeps the SMTP warning visible",async () => {
  const h = runtime({circuitError:{code:"TX_SMTP_AUTH_BACKOFF"},provider:async () => Response.json({data:[{name:"example.test",status:"verified"}]})});
  const result = await h.health();
  assert.equal(result.ok,true); assert.equal(result.details?.provider,"resend"); assert.equal(result.details?.smtp_auth_blocked,true); assert.ok(result.warning);
  assert.equal(h.requests[0].init.method,"GET"); assert.equal(h.smtpSends(),0);
});
test("deep health stays degraded if both the SMTP authentication and the fallback fail",async () => {
  const h = runtime({smtpError:authError,provider:async () => Response.json({message:"Key is invalid"},{status:401})});
  const result = await h.health(); assert.equal(result.ok,false); assert.match(result.error || "",/HTTP 401/);
});

test("deferrable mail never consumes the backup provider while SMTP authentication is unavailable",async () => {
  const h = runtime({smtpError:authError});
  await assert.rejects(h.send({...mail,fallbackPolicy:"defer"}),error => {
    const failure = error as {code:string;retryAt:string;retryable:boolean;deliveryState:string};
    assert.equal(failure.code,"TX_MAIL_FALLBACK_DEFERRED"); assert.equal(failure.retryable,true); assert.equal(failure.deliveryState,"rejected");
    assert.ok(Date.parse(failure.retryAt) > Date.now()); return true;
  });
  assert.equal(h.requests.length,0); assert.equal(h.smtpSends(),1);
  const healthy = runtime(); assert.equal((await healthy.send({...mail,fallbackPolicy:"defer"})).messageId,"smtp-accepted"); assert.equal(healthy.requests.length,0);
});

for (const scope of ["daily","monthly"] as const) test(`${scope} quota is not a burst and blocks later instances through shared state`,async () => {
  const quotaStore = new Map<string,unknown>();
  const first = runtime({smtpError:authError,quotaStore,provider:async () => Response.json({name:`${scope}_quota_exceeded`,message:"private re_fixture_only recipient@example.test"},{status:429,headers:{"Retry-After":"1"}})});
  await assert.rejects(first.send(mail),error => {
    const failure = error as resendPolicy.TxResendDeliveryError;
    assert.equal(failure.code,"TX_RESEND_QUOTA_EXCEEDED"); assert.equal(failure.quotaScope,scope); assert.equal(failure.quotaStateStorage,"shared");
    assert.equal(failure.retryAtIsEstimate,scope === "monthly"); assert.ok(failure.retryAfterSeconds! > 1);
    assert.doesNotMatch(JSON.stringify(failure)+failure.message,/re_fixture_only|recipient@example|private/); return true;
  });
  assert.equal(first.requests.length,1); assert.deepEqual(first.waits,[]);
  const later = runtime({circuitError:{code:"TX_SMTP_AUTH_BACKOFF"},quotaStore});
  await assert.rejects(later.send(mail),error => (error as resendPolicy.TxResendDeliveryError).quotaScope === scope);
  assert.equal(later.requests.length,0,"a fresh serverless instance shares the backoff"); assert.equal(later.smtpSends(),0);
  const health = await later.health(); assert.equal(health.ok,false); assert.equal(health.details?.quota_scope,scope); assert.equal(health.details?.quota_state_storage,"shared");
  assert.equal(later.requests.length,0,"a verified domain cannot hide exhausted sending quota");
});

test("quota persistence limitations remain explicit instead of claiming a shared circuit",async () => {
  const h = runtime({smtpError:authError,noSharedStorage:true,provider:async () => Response.json({name:"daily_quota_exceeded"},{status:429})});
  await assert.rejects(h.send(mail),error => (error as resendPolicy.TxResendDeliveryError).quotaStateStorage === "instance");
  const health = await h.health(); assert.equal(health.ok,false); assert.equal(health.details?.quota_state_storage,"instance");
  assert.equal(h.requests.length,1);
  const failedRedis = runtime({smtpError:authError,redisFailure:true,provider:async () => Response.json({name:"daily_quota_exceeded"},{status:429})});
  await assert.rejects(failedRedis.send(mail),error => (error as resendPolicy.TxResendDeliveryError).quotaStateStorage === "instance");
  await assert.rejects(failedRedis.send(mail)); assert.equal(failedRedis.requests.length,1,"a failed shared backend still honors the local observation");
  const unknown = runtime({circuitError:{code:"TX_SMTP_AUTH_BACKOFF"},redisFailure:true,provider:async () => Response.json({data:[{name:"example.test",status:"verified"}]})});
  const unknownHealth = await unknown.health(); assert.equal(unknownHealth.details?.quota_state_storage,"unavailable"); assert.match(unknownHealth.warning || "",/quotas inconnu/);
});

test("an expired shared observation permits a later send and API key isolation never stores the credential",async () => {
  const quotaStore = new Map<string,unknown>();
  const blocked = runtime({smtpError:authError,quotaStore,provider:async () => Response.json({name:"daily_quota_exceeded"},{status:429})});
  await assert.rejects(blocked.send(mail));
  assert.doesNotMatch(JSON.stringify([...quotaStore]),/re_fixture_only|recipient@example/);
  const rotated = runtime({smtpError:authError,quotaStore}); rotated.env.RESEND_API_KEY = "re_rotated_fixture";
  assert.equal((await rotated.send(mail)).messageId,"resend-accepted");
  for (const [key,value] of quotaStore) quotaStore.set(key,{...value as object,retryAt:"2020-01-01T00:00:00Z"});
  const recovered = runtime({smtpError:authError,quotaStore}); assert.equal((await recovered.send(mail)).messageId,"resend-accepted"); assert.equal(recovered.requests.length,1);
});

test("transport and malformed-response failures remain unconfirmed with safe structured errors",async () => {
  for (const provider of [async () => {throw Error("re_fixture_only recipient@example.test");},async () => new Response("not JSON",{status:200})]) {
    const h = runtime({smtpError:authError,provider});
    await assert.rejects(h.send(mail),error => {
      const failure = error as resendPolicy.TxResendDeliveryError;
      assert.equal(failure.deliveryState,"unknown"); assert.equal(failure.provider,"resend"); assert.equal(failure.retryable,true);
      assert.doesNotMatch(JSON.stringify(failure)+failure.message,/re_fixture_only|recipient@example|not JSON/); return true;
    });
    assert.equal(h.requests.length,1); assert.deepEqual(h.waits,[]);
  }
});

test("a persistent explicit burst limit has at most two retries with the same body",async () => {
  const h = runtime({smtpError:authError,provider:async () => Response.json({name:"rate_limit_exceeded"},{status:429,headers:{"Retry-After":"2"}})});
  await assert.rejects(h.send(mail),error => (error as resendPolicy.TxResendDeliveryError).code === "TX_RESEND_RATE_LIMITED");
  assert.equal(h.requests.length,3); assert.deepEqual(h.waits,[2000,2000]);
  assert.ok(h.requests.every(request => request.init.body === h.requests[0].init.body));
});

test("daily reset uses midnight UTC while monthly retry is explicitly an estimated recheck",() => {
  const now = Date.parse("2026-11-15T23:59:30Z");
  const daily = resendPolicy.resendFailureDetails(429,"daily_quota_exceeded","1",now);
  assert.equal(daily.retryAt,"2026-11-16T00:00:00.000Z"); assert.equal(daily.retryAfterSeconds,30); assert.equal(daily.retryAtIsEstimate,false);
  const monthly = resendPolicy.resendFailureDetails(429,"monthly_quota_exceeded",null,now);
  assert.equal(monthly.retryAt,"2026-11-16T00:59:30.000Z"); assert.equal(monthly.retryAtIsEstimate,true);
  assert.equal(resendPolicy.resendRetryAfterSeconds("Sun, 15 Nov 2026 23:59:35 GMT",now),5);
  assert.equal(resendPolicy.resendFailureDetails(409,"concurrent_idempotent_requests",null,now).deliveryState,"unknown");
});
test("deep health does not hide a non-authentication SMTP failure behind the fallback",async () => {
  const h = runtime({smtpError:new Error("SMTP connection timed out")}); const result = await h.health();
  assert.equal(result.ok,false); assert.equal(h.requests.length,0);
});
