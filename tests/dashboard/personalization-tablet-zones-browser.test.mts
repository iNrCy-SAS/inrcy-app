import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium, webkit } from "@playwright/test";
import { ROOT, fixture, html } from "./personalization-browser-fixture.mts";

const engine = process.env.INRCY_PERSONALIZATION_BROWSER === "webkit" ? webkit : chromium;
const viewports = [
  { width: 600, height: 960 }, { width: 768, height: 1024 },
  { width: 820, height: 1180 }, { width: 834, height: 1194 },
  { width: 1024, height: 1366 },
  { width: 1024, height: 768 }, { width: 1180, height: 820 },
];

test("tablet service areas and populated hours stay visible, editable and reachable", { timeout: 60_000 }, async t => {
  const browser = await engine.launch({ headless: true });
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport, hasTouch: true });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        if (route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html", body: html });
        const asset = path.resolve(ROOT, "public", `.${new URL(route.request().url()).pathname}`);
        if (asset.startsWith(path.resolve(ROOT, "public") + path.sep) && existsSync(asset)) return route.fulfill({ contentType: asset.endsWith(".svg") ? "image/svg+xml" : "image/png", body: readFileSync(asset) });
        return route.abort();
      });
      await page.goto("https://personalization.fixture.invalid/dashboard/personnalisation");
      await page.evaluate(()=>{(window as unknown as {fixtureOpenWeeklySchedule:boolean}).fixtureOpenWeeklySchedule=true;});
      await page.addScriptTag({ content: fixture });
      await page.locator("[data-business-dna-channel-analysis]").waitFor();
      await page.locator("[data-dashboard-workspace-navigation]").getByRole("button", { name: "Mon entreprise", exact: true }).click();
      await page.getByRole("navigation", { name: "Mon entreprise", exact: true }).getByRole("button", { name: "Zones & Horaires", exact: true }).click();
      await page.locator("[data-local-zones]").waitFor();
      const measurements = await page.locator('[data-ai-memory-tab="local"]').evaluate(root => {
        const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height }; };
        const zones = root.querySelector("[data-local-zones]")!;
        const schedule = root.querySelector("[data-local-schedule]")!;
        const tags = zones.querySelector("[data-editable-tags-list]")!;
        return { local:rect(root),zones:rect(zones),schedule:rect(schedule),tags:rect(tags),tagText:tags.textContent,
          horizontal:document.documentElement.scrollWidth>innerWidth+1,
          zoneVisible:getComputedStyle(zones).display!=="none"&&zones.getClientRects().length>0,
          scheduleOverflow:schedule.scrollWidth>schedule.clientWidth+1,
          scheduleControlsFit:[...schedule.querySelectorAll('input,button,textarea')].every(e=>{const r=e.getBoundingClientRect(),p=schedule.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right+1;}),
          columns:getComputedStyle(root.querySelector("[data-local-presence-grid]")!).gridTemplateColumns,
        };
      });
      t.diagnostic(JSON.stringify({viewport,...measurements}));
      assert.equal(measurements.zoneVisible,true,"the service-area card is rendered");
      assert.ok(measurements.tags.height>=30,"the service-area tags keep a visible row");
      assert.match(measurements.tagText||"",/Arras/);
      assert.match(measurements.tagText||"",/Lens/);
      assert.equal(measurements.horizontal,false,"no geographic or schedule content is clipped horizontally");
      assert.equal(measurements.scheduleOverflow,false,"the schedule fits its column");
      assert.equal(measurements.scheduleControlsFit,true,"opened hours and their actions fit inside the schedule card");
      if(viewport.height>viewport.width){
        assert.ok(measurements.zones.width>=measurements.local.width-40,"portrait tablets give service areas the full available width");
        assert.ok(measurements.schedule.top>=measurements.zones.bottom+8,"portrait tablets place the schedule after service areas");
      }
      assert.ok(measurements.zones.right<=viewport.width+1&&measurements.zones.left>=0);
      assert.ok(measurements.zones.bottom<=measurements.schedule.top+1||measurements.zones.right<=measurements.schedule.left+1||measurements.schedule.right<=measurements.zones.left+1,"service areas and the schedule do not overlap");
      const addZone = page.locator("[data-local-zones]").getByRole("button",{name:/Ajouter une zone/});
      await addZone.click();
      const input = page.locator("[data-local-zones] input");
      await input.waitFor();
      await input.fill("Lille");
      assert.equal(await input.inputValue(),"Lille");
      await input.press("Escape");
      await page.getByLabel("Précisions utiles",{exact:true}).scrollIntoViewIfNeeded();
      assert.equal(await page.getByLabel("Précisions utiles",{exact:true}).isVisible(),true);
      assert.equal(await page.evaluate(()=>(window as unknown as {mutations:number}).mutations),0,"layout inspection never writes real or fixture business information");
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("portrait tablets expose every long service area through page scrolling without a nested tag scroller", { timeout:60_000 }, async t=>{
  const browser=await engine.launch({headless:true});
  try{
    for(const viewport of viewports.filter(viewport=>viewport.height>viewport.width&&viewport.width>=768)){
      const page=await browser.newPage({viewport,hasTouch:true});
      const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
      await page.route("**/*",route=>{
        if(route.request().resourceType()==="document")return route.fulfill({contentType:"text/html",body:html});
        const asset=path.resolve(ROOT,"public",`.${new URL(route.request().url()).pathname}`);
        if(asset.startsWith(path.resolve(ROOT,"public")+path.sep)&&existsSync(asset))return route.fulfill({contentType:asset.endsWith(".svg")?"image/svg+xml":"image/png",body:readFileSync(asset)});
        return route.abort();
      });
      await page.goto("https://personalization.fixture.invalid/dashboard/personnalisation");
      await page.evaluate(()=>{
        (window as unknown as {fixtureOpenWeeklySchedule:boolean}).fixtureOpenWeeklySchedule=true;
        (window as unknown as {fixtureStressContent:boolean}).fixtureStressContent=true;
      });
      await page.addScriptTag({content:fixture});
      await page.locator("[data-business-dna-channel-analysis]").waitFor();
      const primary=page.locator("[data-dashboard-workspace-navigation]");
      await primary.getByRole("button",{name:"Mon entreprise",exact:true}).click();
      const nav=page.getByRole("navigation",{name:"Mon entreprise",exact:true});
      for(const label of ["Activité","Clients","Zones & Horaires"]){
        const button=nav.getByRole("button",{name:label,exact:true});
        await button.click();
        assert.ok(await button.evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.height>=36;}),"the company tab remains reachable inside the tablet width");
      }
      const list=page.locator("[data-local-zones] [data-editable-tags-list]");
      await list.waitFor();
      assert.equal(await list.locator("[data-editable-tag]").count(),30);
      const before=await list.evaluate(element=>({height:element.clientHeight,scrollHeight:element.scrollHeight,top:element.scrollTop,overflow:getComputedStyle(element).overflowY}));
      assert.ok(before.height>=before.scrollHeight-1,"all geographic areas contribute to page height");
      assert.equal(before.overflow,"visible","the service-area list does not intercept the page gesture");
      const last=list.locator("[data-editable-tag]").last();
      await last.scrollIntoViewIfNeeded();
      const reachability=await last.evaluate(element=>{
        const r=element.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewportHeight:innerHeight,pageScroll:document.scrollingElement!.scrollTop,hit:element.contains(document.elementFromPoint(x,y))};
      });
      assert.ok(reachability.top>=0&&reachability.bottom<=reachability.viewportHeight+1,"the final area is fully visible after scrolling the page");
      assert.equal(reachability.hit,true,"no header, schedule or parent overlay covers the final service area");
      assert.ok(reachability.pageScroll>0,"the page owns the long-list scroll");
      assert.equal(await list.evaluate(element=>element.scrollTop),0,"the tag list has no internal scroll offset");
      await page.getByLabel("Précisions utiles",{exact:true}).scrollIntoViewIfNeeded();
      assert.equal(await page.getByLabel("Précisions utiles",{exact:true}).inputValue(),"Sur rendez-vous uniquement");
      assert.equal(await page.evaluate(()=>(window as unknown as {mutations:number}).mutations),0);
      assert.deepEqual(errors,[]);
      t.diagnostic(JSON.stringify({viewport,list:before,last:reachability}));
      await page.close();
    }
  }finally{await browser.close();}
});
