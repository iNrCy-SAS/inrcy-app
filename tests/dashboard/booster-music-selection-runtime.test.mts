import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { normalizeMediaSoundtrackId } from "../../lib/mediaSoundtrackSelection.ts";
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
window.activeAudio=new Set();window.audioEvents=[];window.selectionEvents=[];window.catalogueCalls=0;window.otherCalls=[];window.failPreview=false;window.catalogueFailure=false;window.maxPlaying=0;
HTMLMediaElement.prototype.play=function(){window.audioEvents.push({kind:'play',src:this.getAttribute('src')});if(window.failPreview)return Promise.reject(Error('Synthetic audio failure'));window.activeAudio.add(this);window.maxPlaying=Math.max(window.maxPlaying,window.activeAudio.size);return Promise.resolve()};
HTMLMediaElement.prototype.pause=function(){window.audioEvents.push({kind:'pause',src:this.getAttribute('src')});window.activeAudio.delete(this)};
HTMLMediaElement.prototype.load=function(){this.currentTime=0};
window.fetch=async(url,options)=>{if(url!=='/api/booster/soundtracks'){window.otherCalls.push(url);throw Error('No generation, media upload or native publication request allowed')}window.catalogueCalls++;if(options.credentials!=='same-origin')throw Error('Catalogue must use same-origin credentials');return Response.json(window.catalogueFailure?{ok:false}: {ok:true,soundtracks:catalogue},{status:window.catalogueFailure?503:200})};
let config={scopeKey:'actor:account-a',disabled:false,selectionLocked:false};
function Fixture(props){const [id,setId]=React.useState(null);return React.createElement(Selector,{...props,soundtrackId:id,onChange:value=>{window.selectionEvents.push(value);setId(value)}})}
window.configure=patch=>{config={...config,...patch};root.render(React.createElement(Fixture,config))};window.unmountFixture=()=>root.unmount();window.configure({});
`;
const css=read("app/dashboard/_components/MediaSoundtrackSelector.module.css");
const html=`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;padding:24px;background:#080c22;color:white;font:14px Arial}button{font-family:inherit}</style></head><body><div id="root"></div></body></html>`;
type FixtureState={activeAudio:Set<HTMLAudioElement>;audioEvents:Array<{kind:string;src:string|null}>;selectionEvents:Array<string|null>;catalogueCalls:number;otherCalls:string[];failPreview:boolean;catalogueFailure:boolean;maxPlaying:number;configure:(patch:Record<string,unknown>)=>void;unmountFixture:()=>void};

test("the real selector offers Auto and 24 tracks, keeps a single preview and stops it on every lifecycle boundary",async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});
  const trigger=page.locator('button[aria-haspopup="dialog"]'),dialog=page.getByRole("dialog");await trigger.waitFor();
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).catalogueCalls),0);
  await trigger.click();await dialog.waitFor();await page.waitForFunction(()=>document.querySelectorAll('dialog input[type="radio"]').length===25);
  assert.equal(await dialog.locator('input[value=""]').isChecked(),true);
  const first=dialog.locator(`.track:has(input[value="${catalogue[0].id}"])`),second=dialog.locator(`.track:has(input[value="${catalogue[1].id}"])`);
  await first.locator(".preview").click();assert.equal(await first.locator(".preview").getAttribute("aria-pressed"),"true");
  await second.locator(".preview").click();assert.equal(await first.locator(".preview").getAttribute("aria-pressed"),"false");
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),1);assert.equal(await page.locator("audio").count(),1);
  await first.getByRole("radio").check();assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue[0].id]);
  await first.locator(".preview").click();await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);assert.equal(await trigger.evaluate(element=>element===document.activeElement),true);
  await trigger.click();await dialog.waitFor();assert.equal(await first.getByRole("radio").isChecked(),true);
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).catalogueCalls),1,"A reopened selector retains its validated catalogue");
  await dialog.locator('input[value=""]').check();assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue[0].id,null]);
  await first.locator(".preview").click();await page.evaluate(()=>(window as unknown as FixtureState).configure({scopeKey:"actor:account-b"}));await dialog.waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  await trigger.click();await dialog.waitFor();await first.getByRole("radio").waitFor();await first.locator(".preview").click();
  await page.evaluate(()=>(window as unknown as FixtureState).configure({disabled:true}));await dialog.waitFor({state:"hidden"});assert.equal(await trigger.isDisabled(),true);assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  await page.evaluate(()=>(window as unknown as FixtureState).configure({disabled:false,selectionLocked:true}));await trigger.click();await dialog.waitFor();
  assert.equal(await first.getByRole("radio").isDisabled(),true);assert.equal(await dialog.locator('input[value=""]').isDisabled(),true);
  await dialog.locator("header button").click();await page.evaluate(()=>(window as unknown as FixtureState).configure({selectionLocked:false}));await trigger.click();await dialog.waitFor();
  await first.locator(".preview").click();await page.evaluate(()=>(window as unknown as FixtureState).unmountFixture());
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0,"Unmount must stop the captured audio even after React clears its ref");
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).maxPlaying),1);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close()}
});

test("preview or catalogue failures remain local and cannot trigger generation or publish requests",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});
  await page.locator('button[aria-haspopup="dialog"]').click();const dialog=page.getByRole("dialog");await dialog.waitFor();await page.waitForFunction(()=>document.querySelectorAll('dialog input[type="radio"]').length===25);
  await page.evaluate(()=>(window as unknown as FixtureState).failPreview=true);await dialog.locator(".preview").first().click();await dialog.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);assert.equal(await dialog.locator('.preview[aria-pressed="true"]').count(),0);
  await dialog.locator("header button").click();await page.evaluate(()=>{const fixture=window as unknown as FixtureState;fixture.catalogueFailure=true;fixture.configure({scopeKey:"failed-catalogue"})});
  await page.locator('button[aria-haspopup="dialog"]').click();await dialog.waitFor();await dialog.getByRole("alert").waitFor();assert.equal(await dialog.getByRole("radio").count(),1);
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[]);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);
  await page.close();
 }finally{await browser.close()}
});

test("the actual Booster draft, schedule and publish payloads transport manual selection, explicit Auto and the saved retry reference",()=>{
 const source=ts.createSourceFile("PublishModal.tsx",read("app/dashboard/booster/publier/PublishModal.tsx"),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 const contexts=new Map<string,ts.ObjectLiteralExpression>();let restoration:ts.Expression|undefined;
 const visit=(node:ts.Node)=>{
  if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="nextSoundtrackId")restoration=node.initializer;
  if(ts.isObjectLiteralExpression(node)&&node.properties.some(property=>ts.isShorthandPropertyAssignment(property)&&property.name.text==="soundtrackId")){
   const parent=node.parent;
   if(ts.isCallExpression(parent)&&parent.expression.getText(source)==="JSON.stringify")contexts.set("snapshot",node);
   if(ts.isCallExpression(parent)&&parent.expression.getText(source)==="trackEvent"&&parent.arguments[0]?.getText(source)==='"publish"')contexts.set("publish",node);
   if(ts.isPropertyAssignment(parent)&&parent.name.getText(source)==="payload"&&node.properties.some(property=>ts.isPropertyAssignment(property)&&property.name.getText(source)==="status"&&property.initializer.getText(source)==='"draft"'))contexts.set("draft",node);
   if(ts.isPropertyAssignment(parent)&&parent.name.getText(source)==="publishPayload")contexts.set("schedule",node);
  }
  ts.forEachChild(node,visit);
 };visit(source);
 assert.deepEqual([...contexts.keys()].sort(),["draft","publish","schedule","snapshot"]);
 const evaluate=(expression:string,scope:Record<string,unknown>)=>{
  const code=ts.transpileModule(`const value=(${expression});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function(...Object.keys(scope),`${code}\nreturn value;`)(...Object.values(scope)) as Record<string,unknown>;
 };
 const reference="11111111-1111-4111-8111-111111111111",summary={entries:[{channel:"instagram",ok:false,status:"failed",retryable:true,story_sequence_resume_ref:reference}]};
 for(const [name,node] of contexts){
  const properties=node.properties.filter(property=>(ts.isPropertyAssignment(property)||ts.isShorthandPropertyAssignment(property))&&["soundtrackId","storySequenceResumeByChannel"].includes(property.name.getText(source)));
  for(const soundtrackId of [catalogue[3].id,null]){
   const payload=evaluate(`({${properties.map(property=>property.getText(source)).join(",")}})`,{soundtrackId,options:{retryPreviousSummary:summary},buildStorySequenceResumeByChannel,publishTargetChannels:["instagram"]});
   assert.equal(payload.soundtrackId,soundtrackId,`${name} must preserve explicit null Auto as well as a manual ID`);
   if(name==="publish")assert.deepEqual(payload.storySequenceResumeByChannel,{instagram:reference});
  }
 }
 assert.ok(restoration);
 for(const [saved,expected] of [[catalogue[3].id,catalogue[3].id],[undefined,null],["https://external.invalid/audio.wav",null]] as const){
  const restored=evaluate(`({soundtrackId:${restoration.getText(source)}})`,{payload:{soundtrackId:saved},normalizeMediaSoundtrackId});assert.equal(restored.soundtrackId,expected);
 }
 assert.match(source.text,/setSoundtrackId\(nextSoundtrackId\)/);
 assert.match(source.text,/soundtrackSelectionLocked=\{Boolean\(publicationSummaryForActions\?\.entries\?\.some\(entry => publicationStorySequenceResumeRef\(entry\.story_sequence_resume_ref\)\)\)\}/);
});
