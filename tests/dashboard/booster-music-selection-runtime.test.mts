import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { normalizeMediaSoundtrackByChannel } from "../../lib/mediaSoundtrackSelection.ts";
import { buildStorySequenceResumeByChannel } from "../../lib/publicationStorySequenceRetry.ts";

const require=createRequire(import.meta.url),read=(file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),"utf8");
const compile=(file:string)=>ts.transpileModule(read(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const packageSource=(name:string,file:string)=>readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)),"cjs",file),"utf8");
const modules={react:packageSource("react","react.production.js"),"react/jsx-runtime":packageSource("react","react-jsx-runtime.production.js"),"react-dom":packageSource("react-dom","react-dom.production.js"),"react-dom/client":packageSource("react-dom","react-dom-client.production.js"),scheduler:packageSource("scheduler","scheduler.production.js"),selector:compile("app/dashboard/_components/MediaSoundtrackSelector.tsx"),"@/lib/mediaSoundtrackSelection":compile("lib/mediaSoundtrackSelection.ts")};
const actual=runtimeModules(),catalogue=actual<typeof import("../../lib/boosterSoundtracks.ts")>("lib/boosterSoundtracks.ts").getBoosterSoundtrackCatalog();
const fixture=`
const sources=${JSON.stringify(modules)},messages=${read("messages/fr-FR/booster.json")},catalogue=${JSON.stringify(catalogue)},loaded={};
function require(name){
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(name==='next-intl')return {useTranslations:()=> (key,args={})=>Object.entries(args).reduce((text,[name,value])=>text.replaceAll('{'+name+'}',String(value)),messages[key]||key)};
 if(loaded[name])return loaded[name].exports;if(!sources[name])throw Error('Unexpected music fixture module '+name);
 const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;
}
const React=require('react'),Selector=require('selector').default,root=require('react-dom/client').createRoot(document.getElementById('root'));
window.activeAudio=new Set();window.audioEvents=[];window.selectionEvents=[];window.channelSelectionEvents=[];window.catalogueCalls=0;window.otherCalls=[];window.failPreview=false;window.catalogueFailure=false;window.maxPlaying=0;
HTMLMediaElement.prototype.play=function(){window.audioEvents.push({kind:'play',src:this.getAttribute('src')});if(window.failPreview)return Promise.reject(Error('Synthetic audio failure'));window.activeAudio.add(this);window.maxPlaying=Math.max(window.maxPlaying,window.activeAudio.size);return Promise.resolve()};
HTMLMediaElement.prototype.pause=function(){window.audioEvents.push({kind:'pause',src:this.getAttribute('src')});window.activeAudio.delete(this)};
HTMLMediaElement.prototype.load=function(){this.currentTime=0};
window.fetch=async(url,options)=>{if(url!=='/api/booster/soundtracks'){window.otherCalls.push(url);throw Error('No generation, media upload or native publication request allowed')}window.catalogueCalls++;if(options.credentials!=='same-origin')throw Error('Catalogue must use same-origin credentials');return Response.json(window.catalogueFailure?{ok:false}: {ok:true,soundtracks:catalogue},{status:window.catalogueFailure?503:200})};
let config={scopeKey:'actor:account-a',disabled:false,selectionLocked:false};
function Fixture(props){const [id,setId]=React.useState(null);return React.createElement(Selector,{...props,soundtrackId:id,onChange:value=>{window.selectionEvents.push(value);setId(value)}})}
function PairFixture(props){const [selection,setSelection]=React.useState({facebook:null,instagram:null});return React.createElement('div',null,['facebook','instagram'].map(channel=>React.createElement('section',{'data-music-channel':channel,key:channel},React.createElement(Selector,{...props,compact:true,channelLabel:channel==='facebook'?'Facebook':'Instagram',scopeKey:props.scopeKey+':'+channel,selectionLocked:props.lockedChannel===channel,soundtrackId:selection[channel],onChange:id=>{window.channelSelectionEvents.push({channel,id});setSelection(previous=>({...previous,[channel]:id}))}}))))}
window.configure=patch=>{config={...config,...patch};root.render(React.createElement(config.paired?PairFixture:Fixture,config))};window.unmountFixture=()=>root.unmount();window.configure({});
`;
const css=read("app/dashboard/_components/MediaSoundtrackSelector.module.css");
// Match the application's reset instead of accidentally relying on the user
// agent's dialog margin:auto, which hid the production top-left positioning bug.
const html=`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,::before,::after{box-sizing:border-box;margin:0;padding:0}dialog{margin:0}${css}body{margin:0;padding:24px;background:#080c22;color:white;font:14px Arial}button,select{font-family:inherit}</style></head><body><div id="root"></div></body></html>`;
type FixtureState={activeAudio:Set<HTMLAudioElement>;audioEvents:Array<{kind:string;src:string|null}>;selectionEvents:Array<string|null>;channelSelectionEvents:Array<{channel:string;id:string|null}>;catalogueCalls:number;otherCalls:string[];failPreview:boolean;catalogueFailure:boolean;maxPlaying:number;configure:(patch:Record<string,unknown>)=>void;unmountFixture:()=>void};

test("the real compact selector stays centered under the app reset, offers Auto plus 24 tracks and stops previews on every lifecycle boundary",async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});
  const trigger=page.locator('button[aria-haspopup="dialog"]'),dialog=page.getByRole("dialog");await trigger.waitFor();
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).catalogueCalls),0);
  await trigger.click();await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('dialog select')?.querySelectorAll('option').length===25);
  const select=dialog.getByRole("combobox"),preview=dialog.locator(".preview");
  assert.equal(await select.inputValue(),"");assert.equal(await dialog.getByRole("radio").count(),0);assert.equal(await preview.count(),1);assert.equal(await preview.isDisabled(),true);
  const bounds=await dialog.boundingBox();assert.ok(bounds);
  assert.ok(Math.abs(bounds.x+bounds.width/2-viewport.width/2)<=3,`Dialog must be horizontally centered after margin reset: ${JSON.stringify(bounds)}`);
  assert.ok(Math.abs(bounds.y+bounds.height/2-viewport.height/2)<=3,`Dialog must be vertically centered after margin reset: ${JSON.stringify(bounds)}`);
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1);
  assert.ok(bounds.height<=Math.min(600,viewport.height-24),"The collapsed 24-track list must fit in a compact modal");
  assert.equal(await select.evaluate(element=>(element as HTMLSelectElement).size<=1),true);
  assert.equal(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.INRCY_MUSIC_LAYOUT_PROOF)await page.screenshot({path:`${process.env.INRCY_MUSIC_LAYOUT_PROOF}-${viewport.width}.png`});
  await select.selectOption(catalogue[0].id);await preview.click();assert.equal(await preview.getAttribute("aria-pressed"),"true");
  await preview.click();assert.equal(await preview.getAttribute("aria-pressed"),"false");assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  await preview.click();await select.selectOption(catalogue[1].id);assert.equal(await preview.getAttribute("aria-pressed"),"false");assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);await preview.click();
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),1);assert.equal(await page.locator("audio").count(),1);
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue[0].id,catalogue[1].id]);
  await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);assert.equal(await trigger.evaluate(element=>element===document.activeElement),true);
  await trigger.click();await dialog.waitFor();assert.equal(await select.inputValue(),catalogue[1].id);
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).catalogueCalls),1,"A reopened selector retains its validated catalogue");
  await select.selectOption("");assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue[0].id,catalogue[1].id,null]);assert.equal(await preview.isDisabled(),true);
  await select.selectOption(catalogue[0].id);await preview.click();await page.evaluate(()=>(window as unknown as FixtureState).configure({scopeKey:"actor:account-b"}));await dialog.waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  await trigger.click();await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('dialog select')?.querySelectorAll('option').length===25);await preview.click();
  await page.evaluate(()=>(window as unknown as FixtureState).configure({disabled:true}));await dialog.waitFor({state:"hidden"});assert.equal(await trigger.isDisabled(),true);assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  await page.evaluate(()=>(window as unknown as FixtureState).configure({disabled:false,selectionLocked:true}));await trigger.click();await dialog.waitFor();
  assert.equal(await select.isDisabled(),true);
  await dialog.locator("header button").click();await page.evaluate(()=>(window as unknown as FixtureState).configure({selectionLocked:false}));await trigger.click();await dialog.waitFor();
  await preview.click();await page.evaluate(()=>(window as unknown as FixtureState).unmountFixture());
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0,"Unmount must stop the captured audio even after React clears its ref");
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).maxPlaying),1);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close()}
});

test("preview or catalogue failures remain local and cannot trigger generation or publish requests",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});
  await page.locator('button[aria-haspopup="dialog"]').click();const dialog=page.getByRole("dialog");await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('dialog select')?.querySelectorAll('option').length===25);
  await dialog.getByRole("combobox").selectOption(catalogue[0].id);await page.evaluate(()=>(window as unknown as FixtureState).failPreview=true);await dialog.locator(".preview").click();await dialog.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);assert.equal(await dialog.locator('.preview[aria-pressed="true"]').count(),0);
  await dialog.locator("header button").click();await page.evaluate(()=>{const fixture=window as unknown as FixtureState;fixture.catalogueFailure=true;fixture.configure({scopeKey:"failed-catalogue"})});
  await page.locator('button[aria-haspopup="dialog"]').click();await dialog.waitFor();await dialog.getByRole("alert").waitFor();assert.equal(await dialog.locator("select option").count(),2);assert.equal(await dialog.locator(`select option[value="${catalogue[0].id}"]`).isDisabled(),true,"A failed reload retains the saved selection marker without offering an unverified track");assert.equal(await dialog.locator(".preview").isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue[0].id]);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);
  await page.close();
 }finally{await browser.close()}
});

test("Facebook and Instagram selectors preserve independent choices and only one instance can play a preview",async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});await page.evaluate(()=>(window as unknown as FixtureState).configure({paired:true}));
  const facebook=page.locator('[data-music-channel="facebook"] button[aria-haspopup="dialog"]'),instagram=page.locator('[data-music-channel="instagram"] button[aria-haspopup="dialog"]');await facebook.waitFor();
  await facebook.click();let dialog=page.getByRole("dialog");await page.waitForFunction(()=>document.querySelector('dialog select')?.querySelectorAll('option').length===25);
  await dialog.getByRole("combobox").selectOption(catalogue[0].id);await dialog.locator(".preview").click();assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),1);
  await instagram.evaluate(element=>(element as HTMLButtonElement).click());await page.waitForFunction(()=>document.querySelector('dialog[open] h2')?.textContent?.includes('Instagram'));
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0,"Opening the other channel stops and closes the first preview");assert.equal(await page.locator('dialog[open]').count(),1);
  dialog=page.getByRole("dialog");await page.waitForFunction(()=>document.querySelector('dialog select')?.querySelectorAll('option').length===25);await dialog.getByRole("combobox").selectOption(catalogue[1].id);await dialog.locator(".preview").click();
  await dialog.locator("header button").click();await facebook.click();dialog=page.getByRole("dialog");assert.equal(await dialog.getByRole("combobox").inputValue(),catalogue[0].id);await dialog.locator("header button").click();
  await instagram.click();dialog=page.getByRole("dialog");assert.equal(await dialog.getByRole("combobox").inputValue(),catalogue[1].id);await dialog.getByRole("combobox").selectOption("");await dialog.locator("header button").click();
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).channelSelectionEvents),[{channel:"facebook",id:catalogue[0].id},{channel:"instagram",id:catalogue[1].id},{channel:"instagram",id:null}]);
  await page.evaluate(()=>(window as unknown as FixtureState).configure({lockedChannel:"facebook"}));await facebook.click();dialog=page.getByRole("dialog");assert.equal(await dialog.getByRole("combobox").isDisabled(),true);await dialog.locator("header button").click();await instagram.click();dialog=page.getByRole("dialog");assert.equal(await dialog.getByRole("combobox").isDisabled(),false);await dialog.locator("header button").click();
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).maxPlaying),1);assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close()}
});

test("an unavailable music icon remains visible and explains its restriction on hover, focus and touch without opening a chooser",async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport,hasTouch:true});await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});
  await page.evaluate(()=>(window as unknown as FixtureState).configure({unavailableHint:"Réservé aux Stories et Reels"}));
  const trigger=page.locator('button.trigger'),hint=page.getByRole("tooltip");await trigger.waitFor();
  assert.equal(await trigger.isVisible(),true);assert.equal(await trigger.getAttribute("aria-disabled"),"true");
  await trigger.hover();await hint.waitFor({state:"visible"});assert.equal(await hint.textContent(),"Réservé aux Stories et Reels");
  await page.mouse.move(0,0);await trigger.focus();await hint.waitFor({state:"visible"});
  await page.evaluate(()=>{(document.activeElement as HTMLElement|null)?.blur()});await page.mouse.move(0,0);
  const bounds=await trigger.boundingBox();assert.ok(bounds);await page.touchscreen.tap(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await hint.waitFor({state:"visible"});
  await page.keyboard.press("Enter");assert.equal(await page.getByRole("dialog").count(),0);
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).catalogueCalls),0);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[]);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);
  await page.close();
 }}finally{await browser.close()}
});

test("actual Booster payloads preserve per-channel draft choices and filter publish or schedule music to generated Meta media",()=>{
 const source=ts.createSourceFile("PublishModal.tsx",read("app/dashboard/booster/publier/PublishModal.tsx"),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 const contexts=new Map<string,ts.ObjectLiteralExpression>(),expressions=new Map<string,ts.Expression>();let restoration:ts.Expression|undefined;
 const visit=(node:ts.Node)=>{
  if(ts.isVariableDeclaration(node)&&node.initializer){const name=node.name.getText(source);if(name==="nextSoundtrackByChannel")restoration=node.initializer;if(["channelUsesGeneratedSoundtrack","getPublicationSoundtracks"].includes(name))expressions.set(name,node.initializer)}
  if(ts.isObjectLiteralExpression(node)&&node.properties.some(property=>(ts.isShorthandPropertyAssignment(property)||ts.isPropertyAssignment(property))&&property.name.getText(source)==="soundtrackByChannel")){
   const parent=node.parent;
   if(ts.isCallExpression(parent)&&parent.expression.getText(source)==="JSON.stringify"&&node.properties.some(property=>ts.isShorthandPropertyAssignment(property)&&property.name.text==="soundtrackByChannel"))contexts.set("snapshot",node);
   if(ts.isCallExpression(parent)&&parent.expression.getText(source)==="trackEvent"&&parent.arguments[0]?.getText(source)==='"publish"')contexts.set("publish",node);
   if(ts.isPropertyAssignment(parent)&&parent.name.getText(source)==="payload"&&node.properties.some(property=>ts.isPropertyAssignment(property)&&property.name.getText(source)==="status"&&property.initializer.getText(source)==='"draft"'))contexts.set("draft",node);
   if(ts.isPropertyAssignment(parent)&&parent.name.getText(source)==="publishPayload")contexts.set("schedule",node);
  }
  ts.forEachChild(node,visit);
 };visit(source);
 assert.deepEqual([...contexts.keys()].sort(),["draft","publish","schedule","snapshot"]);
 const evaluate=(expression:string,scope:Record<string,unknown>)=>{
  const code=ts.transpileModule(`const value=(${expression});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function(...Object.keys(scope),`${code}\nreturn value;`)(...Object.values(scope));
 };
 const reference="11111111-1111-4111-8111-111111111111",summary={entries:[{channel:"instagram",ok:false,status:"failed",retryable:true,story_sequence_resume_ref:reference}]};
 const selection={facebook:catalogue[3].id,instagram:catalogue[7].id};assert.ok(expressions.has("channelUsesGeneratedSoundtrack")&&expressions.has("getPublicationSoundtracks"));
 const isGenerated=(modes:Record<string,string>,facebookPlacement:string,instagramPlacement:string,facebookStoryEnabled=false,instagramStoryEnabled=false)=>evaluate(expressions.get("channelUsesGeneratedSoundtrack")!.getText(source),{resolveChannelMediaMode:(channel:string)=>modes[channel]||"images",facebookPublicationPlacement:facebookPlacement,instagramPublicationPlacement:instagramPlacement,facebookStoryEnabled,instagramStoryEnabled}) as (channel:string)=>boolean;
 const select=(predicate:(channel:string)=>boolean,soundtrackByChannel:Record<string,string|null>)=>evaluate(expressions.get("getPublicationSoundtracks")!.getText(source),{channelUsesGeneratedSoundtrack:predicate,soundtrackByChannel}) as (channels:string[])=>Record<string,string|null>;
 const mixedChannels=["facebook","instagram","gmb","threads","tiktok"],eligible=isGenerated({},"reel","story");
 assert.deepEqual(mixedChannels.map(eligible),[true,true,false,false,false]);
 assert.deepEqual(select(isGenerated({facebook:"video"},"reel","feed"),selection)(mixedChannels),{});
 assert.deepEqual(select(isGenerated({},"feed","feed",true),selection)(mixedChannels),{facebook:selection.facebook});
 assert.deepEqual(select(eligible,{facebook:null,instagram:selection.instagram})(mixedChannels),{facebook:null,instagram:selection.instagram});
 for(const [name,node] of contexts){
  const properties=node.properties.filter(property=>(ts.isPropertyAssignment(property)||ts.isShorthandPropertyAssignment(property))&&["soundtrackByChannel","storySequenceResumeByChannel"].includes(property.name.getText(source)));
  for(const soundtrackByChannel of [selection,{facebook:null,instagram:selection.instagram}]){
   const payload=evaluate(`({${properties.map(property=>property.getText(source)).join(",")}})`,{soundtrackByChannel,getPublicationSoundtracks:select(eligible,soundtrackByChannel),options:{retryPreviousSummary:summary},buildStorySequenceResumeByChannel,publishTargetChannels:mixedChannels,groupChannels:["instagram","gmb","threads","tiktok"]});
   assert.deepEqual(payload.soundtrackByChannel,name==="schedule"?{instagram:soundtrackByChannel.instagram}:soundtrackByChannel,`${name} must preserve independent music and explicit null Auto without extending non-Meta channels`);
   if(name==="publish")assert.deepEqual(payload.storySequenceResumeByChannel,{instagram:reference});
  }
 }
 assert.ok(restoration);
 for(const [payload,expected] of [[{soundtrackByChannel:selection},selection],[{soundtrackId:selection.facebook},{facebook:selection.facebook,instagram:selection.facebook}],[{soundtrackId:selection.facebook,soundtrackByChannel:{facebook:null}},{facebook:null,instagram:selection.facebook}],[{soundtrackByChannel:{instagram:"https://external.invalid/audio.wav"}},{facebook:null,instagram:null}],[{},{facebook:null,instagram:null}]] as const){
  const restored=evaluate(restoration.getText(source),{payload,normalizeMediaSoundtrackByChannel});assert.deepEqual(restored,expected);
 }
 assert.match(source.text,/setSoundtrackByChannel\(nextSoundtrackByChannel\)/);
 assert.match(source.text,/isSoundtrackLocked=\{\(channel\) => Boolean\(publicationSummaryForActions\?\.entries\?\.some\(entry => entry\.channel === channel && publicationStorySequenceResumeRef\(entry\.story_sequence_resume_ref\)\)\)\}/);
 const selectors:ts.JsxOpeningLikeElement[]=[];const find=(node:ts.Node)=>{if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(source).includes("Soundtrack"))selectors.push(node);ts.forEachChild(node,find)};find(source);assert.equal(selectors.length,0,"Music controls belong inside Validation cards, not Content or Media screens");
});
