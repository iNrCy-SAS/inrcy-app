import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { TxMail } from "../../lib/txMailer.ts";

type Receipt = {messageId:string; accepted:string[]; rejected:string[]};
function runtime(options: {smtpError?: unknown; circuitError?: unknown; noKey?: boolean; provider?: (url: URL, init: RequestInit) => Promise<Response>} = {}) {
  const requests: Array<{url: URL; init: RequestInit; payload: Record<string, unknown>}> = [];
  const waits: number[] = [];
  let smtpSends = 0;
  const env: Record<string, string> = {NODE_ENV:"production", TX_SMTP_HOST:"smtp.example.test", TX_SMTP_PORT:"587", TX_SMTP_USER:"sender@example.test", TX_SMTP_PASS:"fixture-password", TX_MAIL_FROM:"iNrCy <sender@example.test>", ...(options.noKey ? {} : {RESEND_API_KEY:"re_fixture_only"})};
  const record = (e: unknown) => e as {code?: string; responseCode?: number};
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:crypto": crypto,
    "nodemailer": {createTransport: () => ({sendMail: async () => {smtpSends++; if(options.smtpError) throw options.smtpError; return {messageId:"smtp-accepted",accepted:["recipient@example.test"],rejected:[]};},close() {}})},
    "@/lib/env": {optionalEnv: (key: string, fallback = "") => env[key] ?? fallback, requireEnv: (key: string) => {assert.ok(env[key],key); return env[key];}},
    "@/lib/health/smtpRetryPolicy": {createSmtpHandshakeRetryGuard: () => ({}), withSmtpHandshakeRetry: (send: (attempt: number) => unknown) => send(1)},
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
    new Function("exports","require","process","fetch","setTimeout",code)(exports,(id: string) => {assert.ok(id in dependencies,id); return dependencies[id];},{env},fetch,(callback: () => void, ms: number) => {waits.push(ms); callback(); return 0;});
    return exports;
  }
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
  type Health = {ok:boolean; error?:string; warning?:string; details?:{provider?:string; smtp_auth_blocked?:boolean}};
  const health = () => new Function(...Object.keys(healthBindings),healthCode)(...Object.values(healthBindings)) as Promise<Health>;
  // The SMTP verifier itself is substituted below; it never authenticates or sends.
  (dependencies.nodemailer as {createTransport: () => unknown}).createTransport = () => ({
    sendMail:async () => {smtpSends++; if(options.smtpError) throw options.smtpError; return {messageId:"smtp-accepted",accepted:[mail.to],rejected:[]};},verify:async () => {},close() {},
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
  await assert.rejects(h.send(mail),/Provider refused/); assert.equal(h.requests.length,status === 429 ? 3 : 1);
});
test("a provider rate limit waits before retrying the same idempotency key and confirms one acceptance",async () => {
  let calls = 0;
  const h = runtime({smtpError:authError,provider:async () => ++calls === 1
    ? Response.json({message:"Too many requests"},{status:429,headers:{"Retry-After":"2"}})
    : Response.json({id:"accepted-after-wait"})});
  assert.equal((await h.send(mail)).messageId,"accepted-after-wait");
  assert.deepEqual(h.waits,[2_000]); assert.equal(h.smtpSends(),1);
  assert.equal(new Headers(h.requests[0].init.headers).get("Idempotency-Key"),new Headers(h.requests[1].init.headers).get("Idempotency-Key"));
  assert.equal(h.requests[0].init.body,h.requests[1].init.body);
});
test("persistent rate limiting is bounded and leaves the email pending rather than claiming success",async () => {
  const h = runtime({smtpError:authError,provider:async () => Response.json({message:"Still limited"},{status:429,headers:{"Retry-After":"9999"}})});
  await assert.rejects(h.send(mail),/Still limited/); assert.equal(h.requests.length,3); assert.deepEqual(h.waits,[5_000,5_000]);
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
  const result = await h.health(); assert.equal(result.ok,false); assert.match(result.error || "",/Key is invalid/);
});
test("deep health does not hide a non-authentication SMTP failure behind the fallback",async () => {
  const h = runtime({smtpError:new Error("SMTP connection timed out")}); const result = await h.health();
  assert.equal(result.ok,false); assert.equal(h.requests.length,0);
});
