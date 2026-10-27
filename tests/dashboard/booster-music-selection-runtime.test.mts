import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium, type Locator, type Page } from "playwright";
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
function Fixture(props){const [id,setId]=React.useState(null);window.restoreSoundtrack=value=>setId(value);return React.createElement(Selector,{...props,soundtrackId:id,onChange:value=>{window.selectionEvents.push(value);setId(value)}})}
function PairFixture(props){const [selection,setSelection]=React.useState({facebook:null,instagram:null});return React.createElement('div',null,['facebook','instagram'].map(channel=>React.createElement('section',{'data-music-channel':channel,key:channel},React.createElement(Selector,{...props,compact:true,channelLabel:channel==='facebook'?'Facebook':'Instagram',scopeKey:props.scopeKey+':'+channel,selectionLocked:props.lockedChannel===channel,soundtrackId:selection[channel],onChange:id=>{window.channelSelectionEvents.push({channel,id});setSelection(previous=>({...previous,[channel]:id}))}}))))}
window.configure=patch=>{config={...config,...patch};root.render(React.createElement(config.paired?PairFixture:Fixture,config))};window.unmountFixture=()=>root.unmount();window.configure({});
`;
const css=read("app/dashboard/_components/MediaSoundtrackSelector.module.css");
// Match the application's reset instead of accidentally relying on the user
// agent's dialog margin:auto, which hid the production top-left positioning bug.
const html=`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,::before,::after{box-sizing:border-box;margin:0;padding:0}dialog{margin:0}${css}body{margin:0;padding:24px;background:#080c22;color:white;font:14px Arial}button,select{font-family:inherit}</style></head><body><div id="root"></div></body></html>`;
type FixtureState={activeAudio:Set<HTMLAudioElement>;audioEvents:Array<{kind:string;src:string|null}>;selectionEvents:Array<string|null>;channelSelectionEvents:Array<{channel:string;id:string|null}>;catalogueCalls:number;otherCalls:string[];failPreview:boolean;catalogueFailure:boolean;maxPlaying:number;configure:(patch:Record<string,unknown>)=>void;restoreSoundtrack:(id:string)=>void;unmountFixture:()=>void};

async function waitForCatalogue(page: Page) { await page.waitForFunction(expected => document.querySelector('dialog [role="listbox"]')?.querySelectorAll('[role="option"]').length === expected, catalogue.length + 1); }
async function chooseTrack(dialog: Locator, id: string | null) {
 await dialog.getByRole("option",{name:id?catalogue.find(track=>track.id===id)!.label:"Auto",exact:true}).click();
 assert.equal(await dialog.getByRole("listbox").isVisible(),true,"Selecting a track never collapses the permanent list");
}
async function selectedText(dialog: Locator) { return (await dialog.locator("[data-selected-soundtrack]").textContent())?.trim(); }

test("the real compact selector stays centered under the app reset, offers Auto plus the full catalogue and stops previews on every lifecycle boundary",async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});
  const trigger=page.locator('button[aria-haspopup="dialog"]'),dialog=page.getByRole("dialog");await trigger.waitFor();
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).catalogueCalls),0);
  await trigger.click();await dialog.waitFor();await waitForCatalogue(page);
  const select=dialog.getByRole("listbox"),preview=dialog.locator(".preview");
  assert.equal(await selectedText(dialog),"Auto");assert.equal(await dialog.getByRole("radio").count(),0);assert.equal(await preview.count(),1);assert.equal(await preview.isDisabled(),true);
  const bounds=await dialog.boundingBox();assert.ok(bounds);
  assert.ok(Math.abs(bounds.x+bounds.width/2-viewport.width/2)<=3,`Dialog must be horizontally centered after margin reset: ${JSON.stringify(bounds)}`);
  assert.ok(Math.abs(bounds.y+bounds.height/2-viewport.height/2)<=3,`Dialog must be vertically centered after margin reset: ${JSON.stringify(bounds)}`);
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1);
  assert.ok(bounds.height<=Math.min(600,viewport.height-24),"The permanent music catalogue must fit in a compact modal");
  assert.equal(await select.isVisible(),true);assert.equal(await dialog.getByRole("combobox").count(),0,"The list is visible immediately without a second opener");
  assert.equal(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.INRCY_MUSIC_LAYOUT_PROOF)await page.screenshot({path:`${process.env.INRCY_MUSIC_LAYOUT_PROOF}-${viewport.width}.png`});
  await chooseTrack(dialog,catalogue[0].id);await preview.click();assert.equal(await preview.getAttribute("aria-pressed"),"true");
  await preview.click();assert.equal(await preview.getAttribute("aria-pressed"),"false");assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  await preview.click();await chooseTrack(dialog,catalogue[1].id);assert.equal(await preview.getAttribute("aria-pressed"),"false");assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);await preview.click();
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),1);assert.equal(await page.locator("audio").count(),1);
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue[0].id,catalogue[1].id]);
  await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);assert.equal(await trigger.evaluate(element=>element===document.activeElement),true);
  await trigger.click();await dialog.waitFor();assert.equal(await selectedText(dialog),catalogue[1].label);
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).catalogueCalls),1,"A reopened selector retains its validated catalogue");
  await chooseTrack(dialog,null);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue[0].id,catalogue[1].id,null]);assert.equal(await preview.isDisabled(),true);
  await chooseTrack(dialog,catalogue[0].id);await preview.click();await page.evaluate(()=>(window as unknown as FixtureState).configure({scopeKey:"actor:account-b"}));await dialog.waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  await trigger.click();await dialog.waitFor();await waitForCatalogue(page);await preview.click();
  await page.evaluate(()=>(window as unknown as FixtureState).configure({disabled:true}));await dialog.waitFor({state:"hidden"});assert.equal(await trigger.isDisabled(),true);assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  await page.evaluate(()=>(window as unknown as FixtureState).configure({disabled:false,selectionLocked:true}));await trigger.click();await dialog.waitFor();
  assert.equal(await select.getAttribute("aria-disabled"),"true");
  await dialog.locator("header button").click();await page.evaluate(()=>(window as unknown as FixtureState).configure({selectionLocked:false}));await trigger.click();await dialog.waitFor();
  await preview.click();await page.evaluate(()=>(window as unknown as FixtureState).unmountFixture());
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0,"Unmount must stop the captured audio even after React clears its ref");
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).maxPlaying),1);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close()}
});

test("the music list is visible immediately, keeps four rows inside the modal and never closes after selection, preview or blur",async t=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:1280,height:900},{width:1280,height:720},{width:390,height:844},{width:844,height:390}]){
  const page=await browser.newPage({viewport,hasTouch:true}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});
  await page.locator('button[aria-haspopup="dialog"]').click();const dialog=page.getByRole("dialog");await dialog.waitFor();await waitForCatalogue(page);
  const summary=dialog.locator("[data-selected-soundtrack]"),list=dialog.getByRole("listbox"),preview=dialog.locator(".preview");await list.waitFor();
  assert.equal(await dialog.getByRole("combobox").count(),0,"No collapsed dropdown remains inside the modal");
  const summaryBounds=await summary.boundingBox(),listBounds=await list.boundingBox(),dialogBounds=await dialog.boundingBox();assert.ok(summaryBounds&&listBounds&&dialogBounds);
  assert.ok(listBounds.y>=summaryBounds.y+summaryBounds.height,"The bounded list stays below its selection summary");
  assert.ok(listBounds.x>=dialogBounds.x&&listBounds.x+listBounds.width<=dialogBounds.x+dialogBounds.width&&listBounds.y>=dialogBounds.y&&listBounds.y+listBounds.height<=dialogBounds.y+dialogBounds.height,"The entire list remains inside the modal");
  assert.ok(listBounds.y>=0&&listBounds.y+listBounds.height<=viewport.height,"The list cannot extend outside the screen");assert.ok(listBounds.height<=176,"At most four full rows and a small scroll cue are visible");
  const dimensions=await list.evaluate(element=>({client:element.clientHeight,scroll:element.scrollHeight,visible:[...element.children].filter(option=>{const row=option.getBoundingClientRect(),box=element.getBoundingClientRect();return row.top>=box.top&&row.bottom<=box.bottom}).length}));
  assert.ok(dimensions.scroll>dimensions.client,"All catalogue choices are available through an internal scrollbar");assert.ok(dimensions.visible<=4);if(viewport.height>=720)assert.equal(dimensions.visible,4);
  assert.equal(await dialog.locator("select").count(),0,"No operating-system popup can cover the screen");
  await list.focus();await list.press("End");assert.ok(await list.evaluate(element=>element.scrollTop>0));await list.press("Enter");assert.equal(await list.isVisible(),true);assert.equal(await selectedText(dialog),catalogue.at(-1)!.label);
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue.at(-1)!.id]);
  await preview.click();assert.equal(await list.isVisible(),true,"Previewing does not hide the list");assert.equal(await preview.getAttribute("aria-pressed"),"true");
  await list.focus();await list.press("Home");await list.press("ArrowDown");await list.press("Enter");assert.equal(await selectedText(dialog),catalogue[0].label);assert.equal(await list.isVisible(),true);
  await page.keyboard.type(catalogue[2].label.slice(0,3));await list.press("Enter");assert.equal(await selectedText(dialog),catalogue[2].label,"Typing moves to a matching track before Enter selects it");
  const target=dialog.getByRole("option",{name:catalogue[1].label,exact:true});await target.scrollIntoViewIfNeeded();const targetBounds=await target.boundingBox();assert.ok(targetBounds);await page.touchscreen.tap(targetBounds.x+targetBounds.width/2,targetBounds.y+targetBounds.height/2);assert.equal(await selectedText(dialog),catalogue[1].label);assert.equal(await list.isVisible(),true);
  await preview.focus();assert.equal(await list.isVisible(),true,"Moving focus away from the list never collapses it");
  t.diagnostic(JSON.stringify({viewport,list:listBounds,visibleRows:dimensions.visible,catalogue:catalogue.length}));if(process.env.INRCY_MUSIC_DROPDOWN_PROOF)await page.screenshot({path:`${process.env.INRCY_MUSIC_DROPDOWN_PROOF}-${viewport.width}-${viewport.height}.png`});
  await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);await page.close();
 }}finally{await browser.close()}
});

test("a saved track outside the current catalogue remains explicit and unchanged until an enabled choice is selected",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});
  await page.evaluate(()=>(window as unknown as FixtureState).restoreSoundtrack("legacy-saved-track"));await page.locator('button[aria-haspopup="dialog"]').click();const dialog=page.getByRole("dialog");await dialog.waitFor();
  await page.waitForFunction(expected=>document.querySelector('dialog [role="listbox"]')?.querySelectorAll('[role="option"]').length===expected,catalogue.length+2);
  const marker=JSON.parse(read("messages/fr-FR/booster.json")).publication_music_previous;assert.equal(await selectedText(dialog),marker);
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[],"A catalogue update cannot silently replace a saved soundtrack");
  const control=dialog.getByRole("listbox");await control.focus();assert.equal(await dialog.getByRole("option",{name:marker,exact:true}).getAttribute("aria-disabled"),"true");
  await control.press("Home");await control.press("ArrowDown");await control.press("Enter");assert.equal(await selectedText(dialog),catalogue[0].label,"Keyboard navigation skips the unavailable marker");
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue[0].id]);
  await page.evaluate(()=>(window as unknown as FixtureState).restoreSoundtrack("legacy-saved-track"));await page.evaluate(()=>(window as unknown as FixtureState).configure({selectionLocked:true}));await page.waitForFunction(()=>document.querySelector('dialog [role="listbox"]')?.getAttribute('aria-disabled')==='true');
  assert.equal(await control.getAttribute("aria-disabled"),"true");assert.equal(await selectedText(dialog),marker);assert.equal(await dialog.locator(".preview").isDisabled(),true);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue[0].id]);
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);await page.close();
 }finally{await browser.close()}
});

test("preview or catalogue failures remain local and cannot trigger generation or publish requests",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});
  await page.locator('button[aria-haspopup="dialog"]').click();const dialog=page.getByRole("dialog");await dialog.waitFor();await waitForCatalogue(page);
  await chooseTrack(dialog,catalogue[0].id);await page.evaluate(()=>(window as unknown as FixtureState).failPreview=true);await dialog.locator(".preview").click();await dialog.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);assert.equal(await dialog.locator('.preview[aria-pressed="true"]').count(),0);
  await dialog.locator("header button").click();await page.evaluate(()=>{const fixture=window as unknown as FixtureState;fixture.catalogueFailure=true;fixture.configure({scopeKey:"failed-catalogue"})});
  await page.locator('button[aria-haspopup="dialog"]').click();await dialog.waitFor();await dialog.getByRole("alert").waitFor();assert.equal(await dialog.getByRole("listbox").isVisible(),true);assert.equal(await dialog.getByRole("option").count(),2);assert.equal(await dialog.getByRole("option",{name:JSON.parse(read("messages/fr-FR/booster.json")).publication_music_selected,exact:true}).getAttribute("aria-disabled"),"true","A failed reload retains the saved selection marker without offering an unverified track");assert.equal(await dialog.locator(".preview").isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).selectionEvents),[catalogue[0].id]);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);
  await page.close();
 }finally{await browser.close()}
});

test("Facebook and Instagram selectors preserve independent choices and only one instance can play a preview",async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});await page.evaluate(()=>(window as unknown as FixtureState).configure({paired:true}));
  const facebook=page.locator('[data-music-channel="facebook"] button[aria-haspopup="dialog"]'),instagram=page.locator('[data-music-channel="instagram"] button[aria-haspopup="dialog"]');await facebook.waitFor();
  await facebook.click();let dialog=page.getByRole("dialog");await waitForCatalogue(page);
  await chooseTrack(dialog,catalogue[0].id);await dialog.locator(".preview").click();assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),1);
  await instagram.evaluate(element=>(element as HTMLButtonElement).click());await page.waitForFunction(()=>document.querySelector('dialog[open] h2')?.textContent?.includes('Instagram'));
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0,"Opening the other channel stops and closes the first preview");assert.equal(await page.locator('dialog[open]').count(),1);
  dialog=page.getByRole("dialog");await waitForCatalogue(page);await chooseTrack(dialog,catalogue[1].id);await dialog.locator(".preview").click();
  await dialog.locator("header button").click();await facebook.click();dialog=page.getByRole("dialog");assert.equal(await selectedText(dialog),catalogue[0].label);await dialog.locator("header button").click();
  await instagram.click();dialog=page.getByRole("dialog");assert.equal(await selectedText(dialog),catalogue[1].label);await chooseTrack(dialog,null);await dialog.locator("header button").click();
  assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).channelSelectionEvents),[{channel:"facebook",id:catalogue[0].id},{channel:"instagram",id:catalogue[1].id},{channel:"instagram",id:null}]);
  await page.evaluate(()=>(window as unknown as FixtureState).configure({lockedChannel:"facebook"}));await facebook.click();dialog=page.getByRole("dialog");assert.equal(await dialog.getByRole("listbox").getAttribute("aria-disabled"),"true");await dialog.locator("header button").click();await instagram.click();dialog=page.getByRole("dialog");assert.notEqual(await dialog.getByRole("listbox").getAttribute("aria-disabled"),"true");await dialog.locator("header button").click();
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

test("inline music offers a bounded downward dropdown and preview beside it without creating a second modal",async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport,hasTouch:true}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});
  await page.evaluate(()=>(window as unknown as FixtureState).configure({inline:true,channelLabel:'Facebook'}));
  const field=page.locator('[data-soundtrack-inline]'),combo=field.getByRole('combobox'),preview=field.locator('.preview');await combo.waitFor();
  await page.waitForFunction(()=>(window as unknown as FixtureState).catalogueCalls===1);
  assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await preview.isDisabled(),true);
  await combo.click();const list=field.getByRole('listbox');await list.waitFor();assert.equal(await list.getByRole('option').count(),catalogue.length+1);
  const buttonBounds=await combo.boundingBox(),listBounds=await list.boundingBox(),previewBounds=await preview.boundingBox();assert.ok(buttonBounds&&listBounds&&previewBounds);
  assert.ok(listBounds.y>=buttonBounds.y+buttonBounds.height-1,'The dropdown opens below its field');assert.ok(listBounds.height<=176);assert.ok(listBounds.x>=0&&listBounds.x+listBounds.width<=viewport.width+1);
  assert.ok(previewBounds.x>=buttonBounds.x+buttonBounds.width-1,'Playback stays next to the choice');
  await list.focus();await list.press('End');await list.press('Enter');assert.equal(await combo.textContent(),catalogue.at(-1)!.label);assert.equal(await combo.getAttribute('aria-expanded'),'true','Selecting a track keeps the list available');
  await preview.click();assert.equal(await preview.getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),1);assert.equal(await list.isVisible(),true,'Listening leaves the choice list open');
  await list.focus();await list.press('Home');await list.press('ArrowDown');await list.press('Enter');assert.equal(await combo.textContent(),catalogue[0].label);assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  await page.evaluate(()=>(window as unknown as FixtureState).restoreSoundtrack('legacy-saved-track'));const marker=JSON.parse(read('messages/fr-FR/booster.json')).publication_music_previous;
  assert.equal(await list.getByRole('option',{name:marker,exact:true}).getAttribute('aria-disabled'),'true');await list.press('Home');await list.press('ArrowDown');await list.press('Enter');assert.equal(await combo.textContent(),catalogue[0].label);
  await list.focus();await page.keyboard.press('Escape');assert.equal(await combo.getAttribute('aria-expanded'),'false');assert.equal(await combo.evaluate(element=>element===document.activeElement),true);
  await page.evaluate(()=>(window as unknown as FixtureState).configure({unavailableHint:'Réservé aux Stories et Reels'}));await page.waitForFunction(()=>document.querySelector('[data-soundtrack-inline] [role="combobox"]')?.getAttribute('aria-disabled')==='true');assert.equal(await preview.isDisabled(),true);assert.equal(await combo.textContent(),catalogue[0].label,'Classic preserves the configured soundtrack');
  await combo.evaluate(element=>(element as HTMLButtonElement).click());assert.equal(await combo.getAttribute('aria-expanded'),'false');assert.equal(await page.getByRole('dialog').count(),0);
  await page.evaluate(()=>(window as unknown as FixtureState).configure({unavailableHint:undefined,selectionLocked:true}));assert.equal(await combo.getAttribute('aria-disabled'),'true');assert.equal(await preview.isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);await page.close();
 }}finally{await browser.close()}
});

test("inline channel previews remain exclusive and stop when the account, lock or mounted editor changes",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent(html);await page.addStyleTag({content:'[data-music-channel]{margin-bottom:200px}'});await page.addScriptTag({content:fixture});await page.evaluate(()=>(window as unknown as FixtureState).configure({inline:true,paired:true}));
  const facebook=page.locator('[data-music-channel="facebook"]'),instagram=page.locator('[data-music-channel="instagram"]');
  for(const [field,track] of [[facebook,catalogue[0]],[instagram,catalogue[1]]] as const){await field.getByRole('combobox').click();await field.getByRole('option',{name:track.label,exact:true}).click();await field.locator('.preview').click();assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),1);}
  assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).maxPlaying),1);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).channelSelectionEvents),[{channel:'facebook',id:catalogue[0].id},{channel:'instagram',id:catalogue[1].id}]);
  await page.evaluate(()=>(window as unknown as FixtureState).configure({scopeKey:'actor:account-b'}));await page.waitForFunction(()=>(window as unknown as FixtureState).activeAudio.size===0);
  await instagram.locator('.preview').click();await page.evaluate(()=>(window as unknown as FixtureState).configure({lockedChannel:'instagram'}));await page.waitForFunction(()=>(window as unknown as FixtureState).activeAudio.size===0);
  assert.equal(await instagram.getByRole('combobox').getAttribute('aria-disabled'),'true');await facebook.locator('.preview').click();await page.evaluate(()=>(window as unknown as FixtureState).unmountFixture());assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);
  assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);await page.close();
 }finally{await browser.close()}
});

test("the actual Contents format row places inline music next to Meta formats on desktop and keeps it usable on mobile",async()=>{
 const editor=ts.createSourceFile('PublishContentEditorPanel.tsx',read('app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 let formats:ts.JsxElement|undefined;const find=(node:ts.Node)=>{if(ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(property=>ts.isJsxAttribute(property)&&property.name.getText(editor)==='className'&&property.initializer?.getText(editor)==='{css.publicationFormats}'))formats=node;ts.forEachChild(node,find)};find(editor);assert.ok(formats);
 const controls=editor.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='MetaPublicationFormatControls');assert.ok(controls);
 // Execute the real format-controls declaration and row JSX; unrelated rich
 // text, dictation and report tools are outside this focused layout fixture.
 const compiled=ts.transpileModule(`const React=require('react'),css=require('./PublishContentEditorPanel.module.css').default,Selector=require('selector').default;
 const pillBtn={display:'inline-flex',alignItems:'center',borderRadius:20},darkOptionStyle={},darkSelectStyle={};
 ${controls.getText(editor)}
 exports.default=function ContentFormats(){const [activeCard,setActive]=React.useState('facebook'),[choices,setChoices]=React.useState({facebook:null,instagram:null});window.changeContentChannel=setActive;const [placement,setPlacement]=React.useState('reel');
 const voiceBusy=false,isMobile=innerWidth<=700,i18nT=(key)=>messages[key]||key,pinterestBoards=[],pinterestBoardId='',pinterestBoardsLoading=false,onPinterestBoardChange=()=>{},ThreadsPublicationModeControls=()=>null;
 const instagramPublicationPlacement=placement,facebookPublicationPlacement=placement,instagramStoryEnabled=false,facebookStoryEnabled=false,instagramPublicationPreferences={reelsEnabled:true,storiesEnabled:true},facebookPublicationPreferences=instagramPublicationPreferences;
 const onInstagramPublicationPlacementChange=setPlacement,onFacebookPublicationPlacementChange=setPlacement,onInstagramStoryEnabledChange=()=>{},onFacebookStoryEnabledChange=()=>{};
 const renderChannelSoundtrack=(channel,disabled)=>React.createElement(Selector,{key:channel,inline:true,channelLabel:channel==='facebook'?'Facebook':'Instagram',scopeKey:'actor:account:'+channel,soundtrackId:choices[channel],onChange:id=>setChoices(previous=>({...previous,[channel]:id})),disabled});
 return <div className={css.editor} style={{'--editor-accent':'#4597ff','--editor-rgb':'69,151,255',height:'auto'}}><div className={css.editorTopbar}>${formats.getText(editor)}</div></div>};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());await page.setContent(html);await page.addStyleTag({content:read('app/dashboard/booster/publier/components/PublishContentEditorPanel.module.css').replace(/:global\(([^)]+)\)/g,'$1')});await page.addScriptTag({content:fixture+`sources.contentFormats=${JSON.stringify(compiled)};root.render(React.createElement(require('contentFormats').default));`});
  const row=page.locator('.publicationFormats'),field=page.locator('[data-publish-content-soundtrack="facebook"]'),formatsGroup=row.getByRole('group'),combo=field.getByRole('combobox');await combo.waitFor();
  const groupBounds=await formatsGroup.boundingBox(),fieldBounds=await field.boundingBox();assert.ok(groupBounds&&fieldBounds);
  if(process.env.INRCY_MUSIC_LAYOUT_PROOF)await page.screenshot({path:`${process.env.INRCY_MUSIC_LAYOUT_PROOF}-contents-${viewport.width}.png`});
  if(viewport.width>700){assert.ok(fieldBounds.x>=groupBounds.x+groupBounds.width,`Desktop music follows the format buttons: ${JSON.stringify({groupBounds,fieldBounds})}`);assert.ok(Math.abs(fieldBounds.y-groupBounds.y)<12,'Desktop controls share the same row');}
  else assert.ok(fieldBounds.x>=0&&fieldBounds.x+fieldBounds.width<=viewport.width,'Mobile music stays inside the viewport');
  assert.equal(await row.getByRole('button',{name:'Reels',exact:true}).getAttribute('aria-pressed'),'true');await combo.click();await field.getByRole('option',{name:catalogue[0].label,exact:true}).click();await field.locator('.preview').click();assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),1);
  await page.evaluate(()=>(window as unknown as {changeContentChannel:(channel:string)=>void}).changeContentChannel('instagram'));await page.locator('[data-publish-content-soundtrack="instagram"]').waitFor();assert.equal(await page.evaluate(()=>(window as unknown as FixtureState).activeAudio.size),0);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.INRCY_MUSIC_LAYOUT_PROOF)await page.screenshot({path:`${process.env.INRCY_MUSIC_LAYOUT_PROOF}-contents-${viewport.width}.png`});assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>(window as unknown as FixtureState).otherCalls),[]);await page.close();
 }}finally{await browser.close()}
});

test("actual Booster payloads preserve per-channel draft choices and filter publish or schedule music to generated Meta media",()=>{
 const source=ts.createSourceFile("PublishModal.tsx",read("app/dashboard/booster/publier/PublishModal.tsx"),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 const contexts=new Map<string,ts.ObjectLiteralExpression>(),expressions=new Map<string,ts.Expression>();let restoration:ts.Expression|undefined;
 const visit=(node:ts.Node)=>{
  if(ts.isVariableDeclaration(node)&&node.initializer){const name=node.name.getText(source);if(name==="nextSoundtrackByChannel")restoration=node.initializer;if(["channelUsesGeneratedSoundtrack","canConfigureChannelSoundtrack","getPublicationSoundtracks"].includes(name))expressions.set(name,node.initializer)}
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
 const canConfigure=(mode:string,placement:string)=>evaluate(expressions.get('canConfigureChannelSoundtrack')!.getText(source),{resolveChannelMediaMode:()=>mode,facebookPublicationPlacement:placement,instagramPublicationPlacement:placement,facebookStoryEnabled:false,instagramStoryEnabled:false}) as (channel:string)=>boolean;
 assert.equal(canConfigure('none','reel')('facebook'),true,'Music can be prepared before images are selected');assert.equal(canConfigure('video','reel')('facebook'),false);assert.equal(canConfigure('none','classic')('facebook'),false);assert.equal(canConfigure('images','reel')('threads'),false);assert.equal(isGenerated({facebook:'none'},'reel','story')('facebook'),false,'Preparing a choice never enables generated audio without images');
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
 const selectors:ts.JsxOpeningLikeElement[]=[];const find=(node:ts.Node)=>{if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(source)==='MediaSoundtrackSelector')selectors.push(node);ts.forEachChild(node,find)};find(source);assert.equal(selectors.length,1,'Contents has a single controlled inline music renderer');
 const selector=selectors[0].getText(source);assert.match(selector,/\binline\b/);assert.match(selector,/soundtrackByChannel\[channel\]/);assert.match(selector,/setSoundtrackByChannel/);
 const contentPanel=read('app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx');assert.match(contentPanel,/data-publish-content-soundtrack/);assert.match(contentPanel,/renderChannelSoundtrack\(activeCard/);
});
