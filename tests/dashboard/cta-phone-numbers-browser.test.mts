import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import { fixture, html } from "./personalization-browser-fixture.mts";

const phones = "+243981837026 / +8618666071730";
type FixtureWindow = Window & { allowWrites: boolean; fixtureWrites: Array<{kind: string; payload: {ai_channel_ctas?: Record<string,{phone?:string;label?:string}>}}> };

async function setup(page: Page, invalidSite = false) {
  page.setDefaultTimeout(7_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
  await page.goto("https://personalization.fixture.invalid/dashboard/personnalisation");
  const call = (phone: string) => ({choice:"appeler",mode:"call",label:"Appeler",url:"",phone});
  const flags = {fixtureProfilePhone: invalidSite ? "" : phones, fixtureCtaDestinations: {phone: invalidSite ? "" : phones,preferredWebsiteUrl:"",siteWebUrl:""},fixtureChannelCtas:{site_web:call(invalidSite ? "12" : ""),facebook:call(phones)}};
  await page.addScriptTag({content:Object.entries(flags).map(([key,value])=>`window.${key}=${JSON.stringify(value)};`).join("\n")+"\n"+fixture});
  await page.locator("[data-business-dna-channel-analysis]").waitFor();
  await page.evaluate(() => { (window as unknown as FixtureWindow).allowWrites = true; });
  await page.locator("[data-dashboard-workspace-navigation]").getByRole("button", {name:"Ma communication",exact:true}).click();
  await page.getByRole("navigation",{name:"Ma communication",exact:true}).getByRole("button",{name:"CTA par canal",exact:true}).click();
  await page.locator("[data-ai-section=channel-ctas]").waitFor();
  return errors;
}

test("legacy two-phone profile populates call preview and saves a paired override on desktop and mobile",{timeout:45_000},async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    for(const viewport of [{width:1366,height:768},{width:390,height:844}]){
      const page=await browser.newPage({viewport});
      const errors=await setup(page);
      const panel=page.locator("[data-cta-channel=site_web]");
      await panel.getByText(`Appeler : ${phones}`,{exact:true}).waitFor();
      const phone=panel.locator('input[type="tel"]');
      assert.equal(await phone.inputValue(),"","blank means profile; no need to re-enter its two numbers");
      const helpId=await phone.getAttribute("aria-describedby");
      assert.ok(helpId);
      assert.match(await page.locator(`[id="${helpId}"]`).innerText(),/2 numéros.*un seul numéro/);
      await phone.fill("12 / wrong");
      await page.getByRole("button",{name:"Enregistrer",exact:true}).click();
      await page.getByText("Complétez le lien ou le numéro du CTA Site web avant d’enregistrer.",{exact:true}).waitFor();
      assert.equal(await phone.inputValue(),"12 / wrong","an invalid override is not silently replaced by the valid profile");
      await phone.fill(phones);
      await page.getByRole("button",{name:"Enregistrer",exact:true}).click();
      await page.waitForFunction(expected=>(window as unknown as FixtureWindow).fixtureWrites.some(write=>write.kind==="business_profiles"&&write.payload.ai_channel_ctas?.site_web?.phone===expected),phones);
      assert.equal(await page.getByText(/Complétez le lien ou le numéro du CTA/).count(),0);
      const dimensions=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:window.innerWidth}));
      assert.ok(dimensions.content<=dimensions.viewport+1,`${viewport.width}px: the two-phone helper fits the workspace`);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally {await browser.close();}
});

test("saving from Facebook opens the incomplete Site web CTA and fixing it clears the stale error",{timeout:30_000},async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1366,height:900}});
    const errors=await setup(page,true);
    await page.getByRole("tab",{name:"Facebook",exact:true}).click();
    await page.locator('[data-cta-channel=facebook] input:not([type="tel"])').fill("Appelez-nous");
    await page.getByRole("button",{name:"Enregistrer",exact:true}).click();
    const panel=page.locator("[data-cta-channel=site_web]");
    await panel.waitFor();
    await page.getByText("Complétez le lien ou le numéro du CTA Site web avant d’enregistrer.",{exact:true}).waitFor();
    assert.equal(await panel.locator('input[type="tel"]').inputValue(),"","the legacy invalid stored destination was normalized away on load");
    assert.equal(await page.evaluate(()=>(window as unknown as FixtureWindow).fixtureWrites.filter(write=>write.kind==="business_profiles").length),0);
    await panel.locator('input[type="tel"]').fill(phones);
    assert.equal(await page.getByText(/Complétez le lien ou le numéro du CTA/).count(),0,"editing clears the previous validation error");
    await page.getByRole("button",{name:"Enregistrer",exact:true}).click();
    await page.waitForFunction(expected=>(window as unknown as FixtureWindow).fixtureWrites.some(write=>write.kind==="business_profiles"&&write.payload.ai_channel_ctas?.site_web?.phone===expected&&write.payload.ai_channel_ctas?.facebook?.label==="Appelez-nous"),phones);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
