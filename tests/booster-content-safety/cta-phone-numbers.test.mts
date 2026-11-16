import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { dialCtaPhone, normalizeCtaCallPhones, normalizeSingleCtaPhone, parseCtaPhoneNumbers } from "../../lib/ctaPhoneNumbers.ts";
import { normalizeAiChannelCtaMap, resolveAiChannelCtaMap, isAiChannelCtaComplete } from "../../lib/aiChannelCtaPreferences.ts";
import { getBoosterPhoneDisplayValue, sanitizeBoosterPostForStructuredCta } from "../../lib/boosterPublicationSafety.ts";
import { buildBoosterWhatsAppUrl } from "../../lib/boosterWhatsappCta.ts";
import type * as Preferences from "../../lib/boosterCtaPreferences.ts";
import type * as Cta from "../../lib/boosterCta.ts";
import type * as Schedule from "../../lib/inrAgentSchedulePolicy.ts";

const phones = "+243981837026 / +8618666071730";
const root = process.cwd(), nativeRequire = createRequire(import.meta.url);
function runtime() {
  const cache = new Map<string,{exports: unknown}>();
  function load<T>(file: string): T {
    file = path.resolve(root,file);
    if(cache.has(file))return cache.get(file)!.exports as T;
    const mod={exports:{}};cache.set(file,mod);
    const code=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    new Function("require","module","exports",code)((id:string)=>{
      if(id==="server-only")return{};
      if(id.startsWith("@/")||id.startsWith(".")) {
        const target=id.startsWith("@/")?path.resolve(root,id.slice(2)):path.resolve(path.dirname(file),id);
        const resolved=[target,target+".ts",target+".json"].find(p=>existsSync(p)&&statSync(p).isFile());
        assert.ok(resolved,id);return resolved.endsWith(".json")?JSON.parse(readFileSync(resolved,"utf8")):load(resolved);
      }
      return nativeRequire(id);
    },mod,mod.exports);
    return mod.exports as T;
  }
  return {preferences:load<typeof Preferences>("lib/boosterCtaPreferences.ts"),cta:load<typeof Cta>("lib/boosterCta.ts"),schedule:load<typeof Schedule>("lib/inrAgentSchedulePolicy.ts")};
}

test("legacy profile telephone lists keep two independently valid destinations",()=>{
  assert.deepEqual(parseCtaPhoneNumbers(phones),["+243981837026","+8618666071730"]);
  assert.equal(normalizeCtaCallPhones("+243981837026\n+8618666071730"),phones);
  assert.equal(normalizeCtaCallPhones("+243981837026 ; +8618666071730"),phones);
  assert.equal(normalizeSingleCtaPhone(phones),"");
  assert.equal(dialCtaPhone(phones),"");
  assert.equal(normalizeCtaCallPhones("+33 (0)6 12 34 56 78"),"+33 (0)6 12 34 56 78");
  assert.equal(dialCtaPhone("+33 (0)6 12 34 56 78"),"+33612345678");
  assert.equal(dialCtaPhone("0033 (0)6 12 34 56 78"),"+33612345678");
  assert.deepEqual(parseCtaPhoneNumbers("0033 6 12 34 56 78 / +33612345678"),["+33612345678"]);
  assert.deepEqual(parseCtaPhoneNumbers("+243981837026 / wrong"),[]);
  assert.deepEqual(parseCtaPhoneNumbers(phones+" / +33123456789"),[]);
  assert.deepEqual(parseCtaPhoneNumbers("+243981837026 +8618666071730"),[]);
  assert.equal(normalizeCtaCallPhones("06 12 34 56 78 / 0612345678"),"0612345678");
});

test("saving and reloading a two-phone call CTA works on every compatible channel from explicit and profile destinations",()=>{
  for(const channel of ["site_web","gmb","facebook","instagram","threads","linkedin","x","tiktok","youtube_shorts","pinterest"] as const) {
    const source={[channel]:{choice:"appeler",mode:"call",label:"Appeler",phone:phones,url:""}};
    const normalized=normalizeAiChannelCtaMap(source);
    assert.equal(normalized[channel]?.phone,phones);
    assert.equal(isAiChannelCtaComplete(channel,normalized[channel],null),true);
    assert.deepEqual(normalizeAiChannelCtaMap(JSON.parse(JSON.stringify(normalized))),normalized);
    const inherited=resolveAiChannelCtaMap({}, {phone:phones});
    assert.equal(inherited[channel]?.choice,"appeler");
    assert.equal(isAiChannelCtaComplete(channel,inherited[channel],{phone:phones}),true);
  }
});

test("both numbers survive generated posts and captions, and Google keeps its native CALL payload",()=>{
  const h=runtime();
  const defaults={phone:phones,preferredWebsiteUrl:"",preferredWebsiteLabel:"",siteWebUrl:"",preferredCta:"appeler" as const};
  for(const channel of ["site_web","facebook","instagram","threads","linkedin","x","tiktok","youtube_shorts","pinterest"] as const){
    const post=h.preferences.applySafePreferredCta<Cta.BoosterPostLike>({channel,post:{title:"Notre activité",content:"Notre actualité"},defaults,preserveExplicit:false});
    assert.equal(post.ctaPhone,phones);
    assert.equal(h.cta.getCtaPhone(post),phones);
    const actual=h.cta.buildBoosterMessage(channel,JSON.parse(JSON.stringify(post)));
    assert.ok(actual.includes("+243981837026")&&actual.includes("+8618666071730"),channel);
    assert.equal((actual.match(/243981837026/g)||[]).length,1,channel);
    assert.equal((actual.match(/8618666071730/g)||[]).length,1,channel);
  }
  const call={ctaMode:"call",cta:"Appeler",ctaPhone:phones};
  assert.deepEqual(h.cta.getBoosterGmbCallToAction(call),{actionType:"CALL"});
  assert.equal(h.cta.buildCtaTextForChannel("gmb",call),"");
});

test("structured contact cleanup and WhatsApp never fuse phone lists",()=>{
  assert.equal(getBoosterPhoneDisplayValue({ctaPhone:phones}),phones);
  const cleaned=sanitizeBoosterPostForStructuredCta({title:"Notre actualité",content:"Appelez +243981837026 ou +8618666071730",cta:"Appeler",ctaPhone:phones},"call");
  assert.doesNotMatch(String(cleaned.content),/243981837026|8618666071730/);
  assert.equal(buildBoosterWhatsAppUrl(phones),"");
  assert.equal(buildBoosterWhatsAppUrl("+243981837026"),"https://wa.me/243981837026");
  assert.equal(buildBoosterWhatsAppUrl("12345678 / 8765432"),"");
  assert.equal(isAiChannelCtaComplete("facebook",{choice:"appeler",mode:"call",phone:"12 / wrong",label:"Appeler",url:""},{phone:phones}),false);
  assert.equal(isAiChannelCtaComplete("facebook",{choice:"whatsapp",mode:"custom",phone:phones,label:"WhatsApp",url:""},{phone:"+243981837026"}),false);
  const h=runtime();
  assert.equal(h.schedule.normalizePost({title:"Prévu",ctaMode:"call",ctaPhone:phones}).ctaPhone,phones);
  assert.equal(h.schedule.normalizePost({title:"Prévu",ctaMode:"custom",ctaPhone:phones}).ctaPhone,undefined,"WhatsApp and other single destinations remain single");
});
