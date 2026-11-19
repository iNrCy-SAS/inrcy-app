import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createSignupAttributionSnapshot, createMetaBrowserMatch } from "../../lib/signupAttribution.ts";
import type { MetaConversionInput, MetaCapiResult } from "../../lib/metaConversionsApi.ts";

const code = ts.transpileModule(readFileSync("lib/metaConversionsApi.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
type Payload = { data: Array<{event_name: string;event_id: string;custom_data: Record<string, unknown>;user_data: Record<string, unknown>}> };
function fixture() {
  const requests: Payload[] = [];
  const dependencies: Record<string, unknown> = { "server-only": {}, "node:crypto": crypto, "@/lib/metaGraphApi": { buildMetaGraphUrl: (path: string) => `https://meta.example.invalid/${path}` } };
  const result = { exports: {} as {sendMetaConversion(input: MetaConversionInput): Promise<MetaCapiResult>;sendMetaLeadConversion(input: Omit<MetaConversionInput,"eventName"|"eventId"|"occurredAt">):Promise<MetaCapiResult>} };
  new Function("module", "exports", "require", "process", "fetch", code)(result, result.exports, (name: string) => { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; },
    {env:{META_PIXEL_ID:"synthetic-pixel",META_CONVERSIONS_API_ACCESS_TOKEN:"synthetic-no-provider-token"}},
    async (_url: string, options: RequestInit) => { requests.push(JSON.parse(String(options.body))); return Response.json({events_received:1}); });
  return { ...result.exports, requests };
}
function input(formSource: string, eventName: MetaConversionInput["eventName"]): MetaConversionInput {
  return {eventName,eventId:"inrcy-lead-synthetic-stable",occurredAt:"2026-11-19T12:00:00.000Z",userId:"synthetic-user",email:"synthetic@example.invalid",phone:"",firstName:"Synthetic",lastName:"Basic",
    attribution:createSignupAttributionSnapshot({formSource,eventId:"inrcy-lead-synthetic-stable",marketingConsent:true,utmSource:"fb",utmCampaign:"synthetic-campaign"}),browserMatch:createMetaBrowserMatch({}),valueCents:0,currency:"EUR"};
}

test("real Meta payload changes only Basic Lead and registration taxonomy and preserves original campaign payloads", async () => {
  const f = fixture();
  for (const source of ["wordpress-basique", "wordpress-elementor", "", "wordpress-basique-other"]) {
    for (const eventName of ["Lead", "CompleteRegistration", "Subscribe"] as const) {
      const sent = input(source,eventName); assert.equal((await f.sendMetaConversion(sent)).status,"sent");
      const event=f.requests.at(-1)!.data[0], basic=source==="wordpress-basique";
      assert.equal(event.event_name,eventName);assert.equal(event.event_id,sent.eventId);
      const expected = eventName==="Lead"
        ? {content_name:"Inscription iNrCy",content_category:basic?"Abonnement Basique":"Essai gratuit 21 jours",lead_type:basic?"basic_signup":"trial_signup"}
        : eventName==="CompleteRegistration"
          ? {content_name:"Activation du compte iNrCy",content_category:basic?"Abonnement Basique":"Essai gratuit 21 jours",registration_method:basic?"direct_signup":"email_invitation"}
          : {content_name:"Abonnement iNrCy",content_category:"Abonnement"};
      assert.deepEqual(event.custom_data,{...expected,currency:"EUR",value:0,utm_source:"fb",utm_campaign:"synthetic-campaign"});
      assert.equal(JSON.stringify(event.user_data).includes(sent.email),false);
    }
  }
});

test("the Lead wrapper retains the Pixel event ID and never tracks without marketing consent", async () => {
  const f=fixture(), sent=input("wordpress-basique","Lead");
  assert.equal((await f.sendMetaLeadConversion(sent)).status,"sent");
  assert.equal(f.requests[0].data[0].event_id,sent.attribution.eventId);
  for(const source of ["wordpress-basique","wordpress-elementor"]) {
    const denied=input(source,"Lead");denied.attribution={...denied.attribution,marketingConsent:false};
    assert.equal((await f.sendMetaConversion(denied)).status,"skipped");
  }
  assert.equal(f.requests.length,1);
  assert.equal(JSON.stringify(f.requests).includes("password"),false);assert.equal(JSON.stringify(f.requests).includes("ticket"),false);
});
