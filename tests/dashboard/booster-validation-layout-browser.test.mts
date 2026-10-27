import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources = {
  react: packageSource("react", "react.production.js"),
  "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"),
  scheduler: packageSource("scheduler", "scheduler.production.js"),
  board: compile("app/dashboard/booster/publier/components/PublishValidationBoard.tsx"),
  options: compile("app/dashboard/booster/publier/components/PublishValidationChannelOptions.tsx"),
  "@/lib/metaImageMotionTiming": compile("lib/metaImageMotionTiming.ts"),
  "@/app/dashboard/_components/MediaSoundtrackSelector": compile("app/dashboard/_components/MediaSoundtrackSelector.tsx"),
  "@/lib/mediaSoundtrackSelection": compile("lib/mediaSoundtrackSelection.ts"),
  "./publishChannelIdentity": compile("app/dashboard/booster/publier/components/publishChannelIdentity.ts"),
};
const messages = JSON.parse(read("messages/fr-FR/booster.json"));
const catalogue = runtimeModules()<typeof import("../../lib/boosterSoundtracks.ts")>("lib/boosterSoundtracks.ts").getBoosterSoundtrackCatalog();
const icons = new Map([...read("app/dashboard/booster/publier/components/publishChannelIdentity.ts").matchAll(/icon: "([^"]+)"/g)].map(([,name]) => [name,readFileSync(new URL(`../../public${name}`,import.meta.url))]));
const fixture = `
const sources=${JSON.stringify(sources)},messages=${JSON.stringify(messages)},catalogue=${JSON.stringify(catalogue)},loaded={};
function require(name){
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>(name.includes('MediaSoundtrackSelector')?'music-':name.includes('PublishValidationChannelOptions')?'opts-':'')+String(key)})};
 if(name==='next-intl')return {useTranslations:()=> (key,args={})=>Object.entries(args).reduce((text,[name,value])=>text.replaceAll('{'+name+'}',String(value)),messages[key]||key)};
 if(name==='../publishModal.shared')return {channelSupportsImages:channel=>channel!=='youtube_shorts',getBoosterMaxImageCountForChannel:channel=>channel==='youtube_shorts'?1:5};
 if(name==='@/app/dashboard/_components/ChannelImageAdapterTool')return {ChannelPublicationPreview:({preview})=>require('react').createElement('section',{'data-native-preview':true,style:{overflow:'auto',width:'100%'}},preview.channelLabel+' — contenu complet de la publication')};
 if(name==='@/app/dashboard/_components/channel-image-adapter/native-publication-preview')return {PublicationPreviewDeviceTabs:()=>null};
 if(loaded[name])return loaded[name].exports;
 if(!sources[name])throw Error('Unexpected validation layout fixture module '+name);
 const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;
}
const React=require('react'),Board=require('board').default,ChannelOptions=require('options').default,identities=require('./publishChannelIdentity').PUBLISH_CHANNEL_IDENTITY;
// Two synthetic identities stress the requested 13-card layout alongside all
// real channels, without adding a channel or capability to the application.
identities.fixture12={...identities.facebook};identities.fixture13={...identities.instagram};
const labels={site_web:'Site web',gmb:'Google Business',inr_search:'iNr’Search',facebook:'Facebook',instagram:'Instagram',threads:'Threads',linkedin:'LinkedIn',tiktok:'TikTok',youtube_shorts:'YouTube',pinterest:'Pinterest',x:'X',fixture12:'Canal 12',fixture13:'Canal 13'};
const channels=['facebook','instagram','threads',...Object.keys(labels).filter(channel=>!['facebook','instagram','threads'].includes(channel))],image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#408bc4"/></svg>');
const root=require('react-dom/client').createRoot(document.getElementById('root'));
window.nativeCalls=0;window.catalogueCalls=0;window.activeAudio=new Set();let fixtureConfig={count:13,modes:{},eligible:{},optionValues:{},blocked:false};
HTMLMediaElement.prototype.play=function(){window.activeAudio.add(this);return Promise.resolve()};HTMLMediaElement.prototype.pause=function(){window.activeAudio.delete(this)};HTMLMediaElement.prototype.load=function(){};
function Fixture({count,modes,eligible,optionValues,blocked}){
 const [active,setActive]=React.useState('site_web');
 const [settings,setSettings]=React.useState({}),[selection,setSelection]=React.useState({facebook:null,instagram:null});
 const change=(name,value)=>setSettings(previous=>({...previous,[name]:value}));
 window.patchContents=patch=>setSettings(previous=>({...previous,...patch}));
 const optionProps={facebookPublicationPlacement:'reel',facebookStoryEnabled:true,facebookPublicationPreferences:{reelsEnabled:true,storiesEnabled:true},facebookMediaMode:modes.facebook||'images',facebookImageCount:1,instagramPublicationPlacement:'classic',instagramStoryEnabled:false,instagramPublicationPreferences:{reelsEnabled:true,storiesEnabled:true},instagramMediaMode:modes.instagram||'images',instagramImageCount:1,pinterestBoards:[{id:'board-one',name:'Mon tableau Pinterest avec une très longue description de mon activité professionnelle'},{id:'board-two',name:'Autre tableau'}],pinterestBoardId:'board-one',pinterestBoardsLoading:false,pinterestBoardsError:'',threadsPublicationMode:'classic',threadsPublicationPreferences:{ghostEnabled:true},threadsPreferencesLoading:false,threadsPreferencesFailed:false,...optionValues,...settings,onFacebookPublicationPlacementChange:value=>change('facebookPublicationPlacement',value),onFacebookStoryEnabledChange:value=>change('facebookStoryEnabled',value),onInstagramPublicationPlacementChange:value=>change('instagramPublicationPlacement',value),onInstagramStoryEnabledChange:value=>change('instagramStoryEnabled',value),onPinterestBoardChange:value=>change('pinterestBoardId',value),onThreadsPublicationModeChange:value=>change('threadsPublicationMode',value)};
 window.contentsValues={...optionProps,soundtrackByChannel:selection};
 const items=channels.slice(0,count).map(channel=>({channel,label:labels[channel],hasText:!blocked,blockers:[],warnings:[],contentBlockers:blocked?['Le contenu doit être complété avant de pouvoir publier sur ce canal.']:[],contentWarnings:[],mediaBlockers:channel==='youtube_shorts'?['Ajoutez une vidéo pour ce canal.']:[],mediaWarnings:[],mediaBlockerCodes:channel==='youtube_shorts'?['youtube_video_required']:[]}));
 return React.createElement(Board,{items,imageKeys:['first','second'],previewByKey:{first:image,second:image},videoPreviewUrl:'',getMode:channel=>modes[channel]||(channel==='youtube_shorts'?'none':'images'),getSelectedImageKeys:()=>['first'],onModeChange(){},onToggleImage(){},onAddImage(){},onReorderImage(){},onOpenMediaPool(){},onSelectChannel:setActive,activePreview:{channelKey:active,channelLabel:labels[active]},disabled:false,renderChannelOptions:channel=>React.createElement(ChannelOptions,{channel,...optionProps}),soundtrackByChannel:selection,soundtrackScopeKey:'actor:account',canSelectSoundtrack:channel=>eligible[channel]??(channel==='facebook'?optionProps.facebookPublicationPlacement!=='classic'||optionProps.facebookStoryEnabled:channel==='instagram'?optionProps.instagramPublicationPlacement!=='classic'||optionProps.instagramStoryEnabled:false),onSoundtrackChange:(channel,id)=>setSelection(previous=>({...previous,[channel]:id})),isSoundtrackLocked:()=>false});
}
window.renderFixture=(count,patch={})=>{fixtureConfig={...fixtureConfig,...patch,count};root.render(React.createElement(Fixture,fixtureConfig))};
window.renderFixture(13);
window.fetch=url=>{if(url==='/api/booster/soundtracks'){window.catalogueCalls++;return Promise.resolve(Response.json({ok:true,soundtracks:catalogue}))}window.nativeCalls++;throw Error('No native publication or provider call allowed')};
`;
const css = ["app/dashboard/booster/publier/components/publishWizard.module.css", "app/dashboard/booster/publier/components/PublishValidationBoard.module.css"].map(read).join("\n").replace(/:global\(([^)]+)\)/g,"$1")+read("app/dashboard/_components/MediaSoundtrackSelector.module.css").replace(/\.([a-zA-Z_][\w-]*)/g,".music-$1")+read("app/dashboard/booster/publier/components/PublishValidationChannelOptions.module.css").replace(/\.([a-zA-Z_][\w-]*)/g,".opts-$1");
const html = `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,::before,::after{box-sizing:border-box;margin:0;padding:0}dialog{margin:0}${css}
*{box-sizing:border-box}body{margin:0;padding:16px;background:#080c22;font:14px Arial;color:#fff;height:100dvh}button{font-family:inherit}.wizard{height:100%}.progress{min-height:50px}.footer{min-height:56px}.instruction{min-height:26px}
</style></head><body><div class="wizard" data-current-step="control"><nav class="progress">Validation</nav><div class="workspace"><p class="instruction">Vérifiez vos canaux avant publication.</p><div class="body" tabindex="0"><section class="screen" data-wizard-screen="control"><div id="root"></div></section></div></div><footer class="footer">Étape précédente · Continuer</footer></div></body></html>`;

test("Validation keeps the same compact card dimensions with 1, 3 or 13 channels in portrait and landscape",async t=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const viewport of [{width:1440,height:1000},{width:1280,height:720},{width:1024,height:768},{width:768,height:1024},{width:844,height:390},{width:390,height:844}]){
   const page=await browser.newPage({viewport});
   const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
   await page.route("**/*",route=>{
    const name=new URL(route.request().url()).pathname,icon=icons.get(name);
    if(route.request().resourceType()==="document")return route.fulfill({contentType:"text/html",body:html});
    if(icon)return route.fulfill({contentType:name.endsWith(".svg")?"image/svg+xml":name.endsWith(".png")?"image/png":"image/jpeg",body:icon});
    return route.abort();
   });
   await page.goto("https://validation.fixture.invalid/");await page.addScriptTag({content:fixture});
   let reference:{width:number;height:number}|undefined;
   for(const count of [13,3,1]){
    await page.evaluate(count=>(window as unknown as {renderFixture:(count:number)=>void}).renderFixture(count),count);
    await page.waitForFunction(count=>document.querySelectorAll('[data-publish-validation-board] > article').length===count,count);
    assert.equal(await page.locator('[data-channel-settings-trigger]').count(),count===13?4:count===3?3:1,"Only channels with options expose the settings gear");
    assert.equal(await page.locator('[data-publish-validation-board] button.music-trigger, [data-publish-validation-board] select, [data-publish-validation-board] input').count(),0,"Cards keep their name, settings and preview actions without embedded option rows");
    assert.equal(await page.locator('[data-publish-validation-board] > article[data-has-options], [data-channel-validation-options]').count(),0,"No placeholder options row or closed modal content reserves card space");
    assert.equal(await page.locator('[data-channel="gmb"] [data-channel-settings-trigger], [data-channel="tiktok"] [data-channel-settings-trigger]').count(),0);
    const measurements=await page.locator('[data-publish-validation-board] > article').evaluateAll(cards=>cards.map(card=>{
     const rect=card.getBoundingClientRect();
     const controls=Array.from(card.querySelectorAll('button,select,input')).filter(button=>button.getClientRects().length).map(button=>{const b=button.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom}});
     return {channel:card.getAttribute('data-channel'),width:rect.width,height:rect.height,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,controls};
    }));
    reference??={width:measurements[0].width,height:measurements[0].height};
    for(const card of measurements){
     assert.ok(Math.abs(card.width-reference.width)<1,`${viewport.width}px/${count}: channel count must not change card width`);
     assert.ok(Math.abs(card.height-reference.height)<1,`${viewport.width}px/${count}/${card.channel}: card height ${card.height} differs from compact reference ${reference.height}`);
     assert.ok(Math.abs(card.height-(viewport.width<=600?200:172))<=1,`${viewport.width}px/${count}: card height ${card.height}px must keep 172px desktop or 200px mobile with native options`);
     for(const button of card.controls)assert.ok(button.left>=card.left-1&&button.right<=card.right+1&&button.top>=card.top-1&&button.bottom<=card.bottom+1,"Every card action stays inside its compact frame");
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"No horizontal page overflow");
    const last=page.locator('[data-publish-validation-board] > article').last();
    await last.locator('header .cardActions > button').last().click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    assert.equal(await dialog.locator('[data-native-preview]').isVisible(),true,"A compact card keeps access to the full preview");
    const bounds=await dialog.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1);
    await dialog.locator('header > button').click();await dialog.waitFor({state:'hidden'});
    if(process.env.INRCY_VALIDATION_LAYOUT_PROOF&&[1440,390].includes(viewport.width)&&count!==1){
     await page.locator('.body').evaluate(element=>{element.scrollTop=0});
     await page.screenshot({path:`${process.env.INRCY_VALIDATION_LAYOUT_PROOF}-${viewport.width}-${count}.png`});
    }
    t.diagnostic(JSON.stringify({viewport,count,card:reference}));
   }
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>(window as unknown as {nativeCalls:number}).nativeCalls),0);
   await page.close();
  }
 }finally{await browser.close()}
});

test("channel settings open from a gear, preserve all content states and synchronize controlled formats, boards, Threads and music",async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport,hasTouch:true}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",route=>{
   const name=new URL(route.request().url()).pathname,icon=icons.get(name);
   if(route.request().resourceType()==="document")return route.fulfill({contentType:"text/html",body:html});
   if(icon)return route.fulfill({contentType:name.endsWith(".svg")?"image/svg+xml":"image/png",body:icon});
   return route.abort();
  });
  await page.goto("https://validation.fixture.invalid/");await page.addScriptTag({content:fixture});
  await page.evaluate(()=>(window as unknown as {renderFixture:(count:number,patch:Record<string,unknown>)=>void}).renderFixture(13,{blocked:true}));
  const facebook=page.locator('[data-channel-settings-trigger="facebook"]');await facebook.waitFor();
  assert.equal(await page.locator('[data-publish-validation-board] .statusLine').count(),26,"Every channel retains both full-width content and media status lines");
  assert.ok((await page.locator('[data-publish-validation-board] > article').evaluateAll(cards=>cards.map(card=>card.getBoundingClientRect().height))).every(height=>Math.abs(height-(viewport.width<=600?200:172))<=1),'Incomplete content keeps all cards the same compact height');
  await facebook.click();let dialog=page.locator('[data-channel-settings-dialog="facebook"]');await dialog.waitFor();
  const bounds=await dialog.boundingBox();assert.ok(bounds);assert.ok(Math.abs(bounds.x+bounds.width/2-viewport.width/2)<=3);assert.ok(Math.abs(bounds.y+bounds.height/2-viewport.height/2)<=3);
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1);
  assert.equal(await page.getByRole("dialog").count(),1,"Settings contain inline music without a nested modal");assert.equal(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
  await dialog.locator('header button').focus();await page.keyboard.press('Shift+Tab');assert.equal(await dialog.evaluate(element=>element.contains(document.activeElement)),true,'Settings trap keyboard focus inside the modal');
  const format=dialog.getByRole('combobox',{name:messages.facebook_publication_format});await format.selectOption('classic');
  await dialog.getByRole('checkbox').uncheck();
  const music=dialog.locator('[data-soundtrack-inline]'),musicSelect=music.getByRole('combobox');assert.equal(await musicSelect.getAttribute('aria-disabled'),'true');
  await format.selectOption('reel');await musicSelect.click();await dialog.getByRole('listbox').waitFor();
  await dialog.getByRole('option',{name:catalogue[2].label,exact:true}).click();await music.locator('.music-preview').click();
  assert.equal(await page.evaluate(()=>(window as unknown as {activeAudio:Set<unknown>}).activeAudio.size),1);
  const openBounds=await dialog.boundingBox(),listBounds=await dialog.getByRole('listbox').boundingBox();assert.ok(openBounds&&listBounds);assert.ok(listBounds.y>=openBounds.y&&listBounds.y+listBounds.height<=openBounds.y+openBounds.height,'Open music choices remain inside Settings');assert.ok(openBounds.y>=0&&openBounds.y+openBounds.height<=viewport.height+1);
  await page.keyboard.press('Escape');
  // The dropdown consumes its own Escape first; a second Escape closes Settings.
  if(await dialog.isVisible())await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>(window as unknown as {activeAudio:Set<unknown>}).activeAudio.size),0);
  assert.equal(await facebook.evaluate(element=>element===document.activeElement),true,"Closing settings returns focus to its gear");
  const values=await page.evaluate(()=>(window as unknown as {contentsValues:Record<string,unknown>}).contentsValues);
  assert.equal(values.facebookPublicationPlacement,'reel');assert.equal(values.facebookStoryEnabled,false);assert.deepEqual(values.soundtrackByChannel,{facebook:catalogue[2].id,instagram:null});
  await page.evaluate(()=>(window as unknown as {patchContents:(patch:Record<string,unknown>)=>void}).patchContents({facebookPublicationPlacement:'classic',facebookStoryEnabled:true}));
  await facebook.click();dialog=page.locator('[data-channel-settings-dialog="facebook"]');await dialog.waitFor();assert.equal(await dialog.getByRole('combobox',{name:messages.facebook_publication_format}).inputValue(),'classic');assert.equal(await dialog.getByRole('checkbox').isChecked(),true);
  await page.mouse.click(1,1);await dialog.waitFor({state:'hidden'});
  await page.locator('[data-channel-settings-trigger="pinterest"]').click();dialog=page.locator('[data-channel-settings-dialog="pinterest"]');await dialog.waitFor();await dialog.getByRole('combobox').selectOption('board-two');
  assert.equal(await dialog.locator('[data-soundtrack-inline]').count(),0);assert.equal(await page.evaluate(()=>(window as unknown as {contentsValues:{pinterestBoardId:string}}).contentsValues.pinterestBoardId),'board-two');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  await page.locator('[data-channel-settings-trigger="threads"]').click();dialog=page.locator('[data-channel-settings-dialog="threads"]');await dialog.waitFor();await dialog.getByRole('combobox').selectOption('ghost');
  assert.equal(await page.evaluate(()=>(window as unknown as {contentsValues:{threadsPublicationMode:string}}).contentsValues.threadsPublicationMode),'ghost');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  await page.locator('[data-channel-settings-trigger="instagram"]').click();dialog=page.locator('[data-channel-settings-dialog="instagram"]');await dialog.waitFor();assert.equal(await dialog.locator('[data-soundtrack-inline]').getByRole('combobox').getAttribute('aria-disabled'),'true');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.INRCY_VALIDATION_LAYOUT_PROOF)await page.screenshot({path:`${process.env.INRCY_VALIDATION_LAYOUT_PROOF}-settings-${viewport.width}.png`});
  await dialog.locator("header button").click();assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>(window as unknown as {nativeCalls:number}).nativeCalls),0);await page.close();
 }}finally{await browser.close()}
});
