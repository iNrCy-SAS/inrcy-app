import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium, type Browser } from "@playwright/test";

const read=(file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),"utf8");
const original=read("ops/wordpress-meta-attribution/inrcy-meta-attribution.js"),dedicated=read("ops/wordpress-basic-signup/basic-meta-attribution.js");
const template=read("ops/wordpress-basic-signup/templates/signup-form.php");
const publicMarkup=template.match(/<form name="inrcy_basic_signup"[\s\S]*?<\/form>/)?.[0].replace(/<\?php[\s\S]*?\?>/g,"");
assert.ok(publicMarkup,"use the actual Basic public form");
const email="synthetic+tracking@example.invalid",password="Synthetic-PrivatePassword42!",ticket="synthetic-private-access-ticket";
type PixelCall=[string,string,Record<string,unknown>,{eventID:string}];
type TrackingWindow=Window&{__pixelCalls:PixelCall[];__guardBeforeGlobal:boolean;__privateEntries:Array<[string,string]>;cmplz_has_consent:(category:string)=>boolean;jQuery:(target:Element)=>{trigger(name:string,args?:unknown[]):void}};

async function fixture(browser:Browser,consent:boolean,basic=true) {
  const context=await browser.newContext({viewport:{width:1000,height:850}}),page=await context.newPage();
  const errors:string[]=[],external:string[]=[],publicPosts:Array<Record<string,string>>=[],privatePosts:Array<{url:string;body:string}>=[];
  page.on("pageerror",error=>errors.push(error.message));
  const bootstrap=`
    var handlers=[];window.__pixelCalls=[];window.fbq=function(){window.__pixelCalls.push(Array.from(arguments));};
    window.cmplz_has_consent=function(category){if(category!=='marketing')throw Error('Unexpected consent category');return ${consent};};
    document.cookie='cmplz_marketing=allow;path=/';document.cookie='_fbp=fb.1.123.synthetic-browser;path=/';document.cookie='_fbc=fb.1.123.synthetic-click;path=/';
    window.jQuery=function(target){return{on:function(name,callback){var type=name.split('.')[0],listener=function(event){callback(event,...(event.detail||[]));};handlers.push({target,name,listener});target.addEventListener(type,listener);return this;},
      off:function(name){handlers=handlers.filter(function(item){if(item.target===target&&item.name===name){target.removeEventListener(name.split('.')[0],item.listener);return false;}return true;});return this;},
      trigger:function(name,args){target.dispatchEvent(new CustomEvent(name.split('.')[0],{bubbles:true,detail:args||[]}));return this;}};};
    window.inrcyBasicSignupAccessConfig={showBooking:'',signupFormName:'inrcy_basic_signup'};
    window.inrcyBasicSignupConfig={ajaxUrl:'https://inrcy.com/wp-admin/admin-ajax.php',nonce:'synthetic-public-nonce'};
  `;
  await context.route("**/*",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==="GET"&&url.origin==="https://inrcy.com"&&url.pathname===(basic?"/basique/inscription/":"/inscription/")) {
      const markup=basic?publicMarkup:publicMarkup!.replace('name="inrcy_basic_signup"','name="inrcy_trial_signup" class="elementor-form"');
      await route.fulfill({contentType:"text/html",body:`<!doctype html><html><head><meta charset="utf-8">${basic?`<script>${dedicated}</script>`:""}</head><body>${markup}<a id="basic-signup-link" href="/basique/inscription/">Basic signup</a><a id="general-signup-link" href="/inscription/">General signup</a><script>${bootstrap}window.__guardBeforeGlobal=window.__inrcyMetaAttributionInitialized===true;</script><script>${original}</script>${basic?`<script>${read("ops/wordpress-basic-signup/basic-access.js")}</script><script>${read("ops/wordpress-basic-signup/basic-signup.js")}</script>`:""}</body></html>`});return;
    }
    if(request.method()==="POST"&&url.origin==="https://inrcy.com"&&url.pathname==="/wp-admin/admin-ajax.php") {
      const form=await new Request(request.url(),{method:"POST",headers:request.headers(),body:request.postData()||""}).formData();
      publicPosts.push(Object.fromEntries([...form].map(([name,value])=>[name,String(value)])));
      await route.fulfill({json:{success:true,data:{direct_signup:true,activation_required:true,trial_days:0,trial_end_at:null,inrcy_signup_access:{email,password,ticket,expires_at:new Date(Date.now()+3600000).toISOString(),login_url:"https://app.inrcy.com/api/auth/signup-access"}}}});return;
    }
    if(request.method()==="POST"&&url.origin==="https://app.inrcy.com"&&url.pathname==="/api/auth/signup-access") {
      privatePosts.push({url:request.url(),body:request.postData()||""});await route.fulfill({contentType:"text/html",body:"<h1>Synthetic private account</h1>"});return;
    }
    external.push(request.url());await route.abort();
  });
  await page.goto(`https://inrcy.com${basic?"/basique/inscription/":"/inscription/"}?utm_source=fb&utm_campaign=synthetic-campaign&campaign_id=synthetic-campaign-id&fbclid=synthetic-click`);
  await page.locator('[name="form_fields[last_name]"]').fill("Synthetic");await page.locator('[name="form_fields[first_name]"]').fill("Tracking");
  await page.locator('[name="form_fields[email]"]').fill(email);await page.locator('[name="form_fields[phone]"]').fill("0102030405");await page.locator('[name="form_fields[consent]"]').check();
  page.setDefaultTimeout(7000);
  return{context,page,errors,external,publicPosts,privatePosts};
}

for(const consent of [true,false])test(`dedicated head tracking isolates the real private handoff and emits ${consent?"one consented Basic Lead":"no Lead without marketing consent"} despite the old footer script`,async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const f=await fixture(browser,consent);
    assert.equal(await f.page.evaluate(()=>(window as unknown as TrackingWindow).__guardBeforeGlobal),true);
    const decorated=new URL((await f.page.locator("#basic-signup-link").getAttribute("href"))!,"https://inrcy.com");assert.equal(decorated.searchParams.get("utm_campaign"),"synthetic-campaign");
    assert.equal(await f.page.locator("#general-signup-link").getAttribute("href"),"/inscription/","the unchanged global footer did not initialize");
    await f.page.evaluate(()=>{const form=document.querySelector('form[name="inrcy_basic_signup"]') as HTMLFormElement;form.requestSubmit();form.requestSubmit();});
    await f.page.getByRole("heading",{name:"Votre compte est prêt !"}).waitFor();
    assert.equal(f.publicPosts.length,1);const fields=f.publicPosts[0],eventId=fields["form_fields[event_id]"];
    assert.ok(eventId);assert.equal(fields["form_fields[utm_campaign]"],"synthetic-campaign");assert.equal(fields["form_fields[campaign_id]"],"synthetic-campaign-id");
    assert.equal(fields["form_fields[meta_tracking_consent]"],String(consent));assert.equal(fields["form_fields[fbp]"],consent?"fb.1.123.synthetic-browser":"");
    assert.equal(fields["form_fields[fbc]"],consent?"fb.1.123.synthetic-click":"");
    const privateForm=f.page.locator("form.inrcy-signup-access-form");await privateForm.waitFor();
    await f.page.waitForTimeout(160); // Exercise the real MutationObserver refresh after modal insertion.
    assert.deepEqual(await privateForm.locator("[name]").evaluateAll(nodes=>nodes.map(node=>node.getAttribute("name"))),[]);
    assert.equal(await privateForm.getAttribute("data-inrcy-attribution-bound"),null);
    const pixels=await f.page.evaluate(()=>(window as unknown as TrackingWindow).__pixelCalls);
    assert.equal(pixels.length,consent?1:0);
    if(consent){assert.deepEqual(pixels[0],["track","Lead",{content_name:"Inscription iNrCy",content_category:"Abonnement Basique",currency:"EUR",value:0},{eventID:eventId}]);}
    await privateForm.evaluate(form=>{form.addEventListener("submit",()=>{(window as unknown as TrackingWindow).__privateEntries=[...new FormData(form as HTMLFormElement)].map(([key,value])=>[key,String(value)]);});});
    const popup=f.context.waitForEvent("page");await privateForm.getByRole("button",{name:"Accéder à mon compte"}).click();const account=await popup;
    await account.getByRole("heading",{name:"Synthetic private account"}).waitFor();
    assert.equal(f.privatePosts.length,1);assert.deepEqual([...new URLSearchParams(f.privatePosts[0].body)],[["ticket",ticket]]);
    assert.deepEqual(await f.page.evaluate(()=>(window as unknown as TrackingWindow).__privateEntries),[["ticket",ticket]]);
    await f.page.evaluate(()=>{const w=window as unknown as TrackingWindow,form=document.querySelector('form.inrcy-signup-access-form')!;w.cmplz_has_consent=()=>true;w.jQuery(form).trigger("submit_success",[{}]);});
    assert.equal((await f.page.evaluate(()=>(window as unknown as TrackingWindow).__pixelCalls)).length,consent?1:0,"a private success cannot trigger or backfill Lead");
    const stored=await f.page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage},tracking:(window as unknown as TrackingWindow).__pixelCalls}));
    assert.equal(stored.includes(password)||stored.includes(ticket),false);assert.deepEqual(f.external,[]);assert.deepEqual(f.errors,[]);
  }finally{await browser.close();}
});

test("the original global campaign script retains its existing trial label and Pixel event-ID contract",async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const f=await fixture(browser,true,false);assert.equal(await f.page.evaluate(()=>(window as unknown as TrackingWindow).__guardBeforeGlobal),false);
    await f.page.evaluate(()=>{const form=document.querySelector('form[name="inrcy_trial_signup"]') as HTMLFormElement;form.addEventListener("submit",event=>event.preventDefault());form.requestSubmit();(window as unknown as TrackingWindow).jQuery(form).trigger("submit_success",[{}]);});
    const pixels=await f.page.evaluate(()=>(window as unknown as TrackingWindow).__pixelCalls);assert.equal(pixels.length,1);
    assert.equal(pixels[0][2].content_category,"Essai gratuit 21 jours");
    assert.equal(pixels[0][3].eventID,await f.page.locator('[name="form_fields[event_id]"]').inputValue());
    assert.deepEqual(f.publicPosts,[]);assert.deepEqual(f.privatePosts,[]);assert.deepEqual(f.errors,[]);assert.deepEqual(f.external,[]);
  }finally{await browser.close();}
});
