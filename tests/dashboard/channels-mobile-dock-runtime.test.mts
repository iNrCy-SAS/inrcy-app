import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import ts from "typescript";

const require=createRequire(import.meta.url),read=(file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),"utf8");
const compile=(text:string)=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const source=ts.createSourceFile("ResponsiveBottomNav.tsx",read("app/dashboard/_components/ResponsiveBottomNav.tsx"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let nav:ts.JsxElement|undefined;
const find=(node:ts.Node)=>{if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(source)==="nav"&&node.openingElement.getText(source).includes("data-dashboard-mobile-nav"))nav=node;else ts.forEachChild(node,find)};find(source);assert.ok(nav);
const packageSource=(name:string,file:string)=>readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)),"cjs",file),"utf8");
const modules={react:packageSource("react","react.production.js"),"react/jsx-runtime":packageSource("react","react-jsx-runtime.production.js"),"react-dom":packageSource("react-dom","react-dom.production.js"),"react-dom/client":packageSource("react-dom","react-dom-client.production.js"),scheduler:packageSource("scheduler","scheduler.production.js"),channels:compile(read("app/dashboard/_components/DashboardChannelsModal.tsx")),nav:compile(`export default function Dock(){return (${nav!.getText(source)});}`)};
const fixture=`
const sources=${JSON.stringify(modules)},loaded={};window.fixtureError=null;window.addEventListener("error",event=>window.fixtureError=String(event.error?.stack||event.message));
function require(name){
 if(loaded[name])return loaded[name].exports;
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>'channels-'+String(key)})};
 if(name==='next/image')return {__esModule:true,default:({unoptimized,...props})=>React.createElement('img',props)};
 if(name==='./DashboardAssistantTrigger')return {__esModule:true,default:()=>React.createElement('span',null)};
 if(name==='./DashboardAssistantScreenContext')return {useInrAssistantScreen(){}};
 if(name==='./DashboardFluxBubble')return {__esModule:true,default:({item})=>React.createElement('article',{style:{height:300,display:'grid',placeItems:'center'}},item.name)};
 if(name==='./dashboard-channel-presentation')return {getChannelTone:()=> 'connected',getChannelSceneLayout:()=>({centerSize:300,centerY:220,satelliteSize:120,slots:Array.from({length:13},()=>({x:20,y:20,size:100}))})};
 if(name==='./DashboardUnsavedNavigationProvider')return {useDashboardUnsavedNavigation:()=>({requestNavigation:async action=>{window.guardCalls++;if(window.allowClose){await action();return true}return false}})};
 if(['./GoogleOAuthConsentBanner','./MetaOAuthCallbackNotice'].includes(name))return {__esModule:true,default:()=>null};
 if(!sources[name])throw Error('Unexpected channels fixture module '+name);
 const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;
}
const React=require('react'),Channels=require('channels').default,root=require('react-dom/client').createRoot(document.getElementById('root'));
window.allowClose=true;window.guardCalls=0;window.homeNavigations=0;window.assistantClicks=0;window.menuClicks=0;
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#67d3ff"/></svg>');
const items=Array.from({length:14},(_,index)=>({key:index===0?'gmb':'channel-'+index,name:'Canal '+index,logoSrc:image,bubbleStatusText:'Connecté',onConfigure(){}}));
function Fixture(){
 const [open,setOpen]=React.useState(true),[menuOpen,setMenuOpen]=React.useState(false);
 const icon=()=>React.createElement('svg',{width:24,height:24},React.createElement('circle',{cx:12,cy:12,r:9}));
 const scope={styles:new Proxy({},{get:(_,key)=>'nav-'+String(key)}),hidden:false,t:{topbar:{openMenu:'Menu'}},i18nT:()=> 'Navigation mobile',labels:{home:'Accueil'},homeActive:true,navigate:()=>window.homeNavigations++,HomeIcon:icon,assistantLabel:'Assistant',assistantOpen:false,assistantPending:false,assistantBadgeState:'idle',closeMobileOverlays(){setMenuOpen(false)},toggleAssistant(){window.assistantClicks++;document.getElementById('inrcy-assistant-dialog').show()},Image:({unoptimized,...props})=>React.createElement('img',props),DashboardAssistantBadge:()=>null,generatorState:{isActive:false},DashboardGeneratorOrb:()=>React.createElement('span',null,'Bulle'),NotificationMenu:()=>React.createElement('button',{type:'button','aria-label':'Notifications'},'N'),notificationsApi:{notificationsCount:0,unreadNotificationsCount:0},notificationMenuOpen:false,setNotificationMenuOpen(){},openDashboardPanel(){},DashboardNavigationIcon:icon,menuOpen,setMenuOpen:value=>{window.menuClicks++;setMenuOpen(value)},setLanguageOpen(){},hasMenuWarning:false,MenuIcon:icon};
 const record={exports:{}};new Function('require','module','exports',...Object.keys(scope),sources.nav)(require,record,record.exports,...Object.values(scope));
 return React.createElement(React.Fragment,null,React.createElement('button',{id:'background',onClick:()=>setOpen(true)},'Arrière-plan'),open?React.createElement(Channels,{items,onClose:()=>setOpen(false)}):null,React.createElement(record.exports.default),menuOpen?React.createElement('div',{'data-dashboard-mobile-nav-menu':true,role:'menu',style:{position:'fixed',zIndex:130,left:20,bottom:80,padding:15,background:'#14334f'}},React.createElement('button',{role:'menuitem',onClick:()=>setMenuOpen(false)},'Fermer le menu')):null);
}
root.render(React.createElement(Fixture));
`;
const prefix=(text:string,name:string)=>text.replace(/\.([a-zA-Z_][\w-]*)/g,`.${name}-$1`);
const css=prefix(read("app/dashboard/_components/DashboardChannelsModal.module.css"),"channels")+prefix(read("app/dashboard/_components/ResponsiveBottomNav.module.css"),"nav");
const html=`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0}html{--inrcy-safe-area-bottom:20px;--inrcy-safe-area-left:0px;--inrcy-safe-area-right:0px;--inrcy-safe-area-top:0px;--inrcy-mobile-bottom-nav-total-height:calc(50px + var(--inrcy-safe-area-bottom))}body{background:#050c22;color:#fff;font:14px Arial}button{font:inherit}${css}</style></head><body style="overflow:auto"><div id="root"></div><dialog id="blocking"><button onclick="this.parentElement.close()">Fermer la confirmation</button></dialog><dialog id="inrcy-assistant-dialog" style="position:fixed;inset:30px 10px 90px;z-index:1000;width:calc(100vw - 20px);height:200px"><input aria-label="Message assistant"><button onclick="this.parentElement.close()">Fermer Assistant</button></dialog></body></html>`;

test("Mes canaux keeps the actual five-item mobile dock above its scroll area and respects native blocking dialogs",async t=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:390,height:844},{width:1100,height:768}]){
  const page=await browser.newPage({viewport}),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});await page.waitForFunction(()=>document.querySelector("[data-dashboard-channels-dialog]")||Boolean((window as unknown as {fixtureError:string|null}).fixtureError));assert.equal(await page.evaluate(()=>(window as unknown as {fixtureError:string|null}).fixtureError),null);
  const channels=page.locator('[data-dashboard-channels-dialog]'),dock=page.locator('[data-dashboard-mobile-nav]'),home=dock.locator('[data-dashboard-mobile-home]');await channels.waitFor();assert.equal(await channels.evaluate(element=>element.matches(':modal')),false);
  const bounds=await channels.boundingBox(),bar=await page.locator('.nav-bar').boundingBox();assert.ok(bounds&&bar);assert.ok(Math.abs(bounds.height-(viewport.height-70))<1);assert.ok(Math.abs(bar.y+bar.height-viewport.height)<1);
  assert.ok(bounds.y+bounds.height<=bar.y+1,"Channel scrolling stops before the navigation and its safe area");
  const logos=channels.locator('[data-channel-mini]');assert.equal(await logos.count(),14);
  const logoBounds=await logos.evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return {top:Math.round(box.top),bottom:box.bottom}}));
  const rows=new Map<number,number>();for(const box of logoBounds)rows.set(box.top,(rows.get(box.top)||0)+1);
  assert.deepEqual([...rows.values()],[7,7],"All fourteen channels remain reachable in the compact two-row chooser");
  assert.ok(Math.max(...logoBounds.map(box=>box.bottom))<=bar.y+1,"The compact chooser fits above the dock before any scrolling");
  // A real long feedback block must still be scrollable without moving the dock.
  await channels.locator('.channels-selectedBubble').evaluate(element=>{
    const feedback=document.createElement('div');feedback.setAttribute('data-channel-feedback','error');feedback.setAttribute('role','alert');
    feedback.style.cssText='padding:14px;line-height:1.6;font-size:13px;white-space:pre-line';
    feedback.textContent=Array.from({length:24},()=> 'La connexion a expiré. Reconnectez le canal pour continuer.').join('\n');element.append(feedback);
  });
  const scrollArea=channels.locator('.channels-surface');
  assert.ok(await scrollArea.evaluate(element=>element.scrollHeight>element.clientHeight),"Long channel feedback must remain reachable through the workspace scroll area");
  await scrollArea.evaluate(element=>element.scrollTop=element.scrollHeight);assert.ok(await scrollArea.evaluate(element=>element.scrollTop>0));
  const afterScrollBar=await page.locator('.nav-bar').boundingBox(),lastLogo=await logos.last().boundingBox();assert.ok(afterScrollBar&&lastLogo);
  assert.ok(Math.abs(afterScrollBar.y-bar.y)<1,"The dock never moves with long channel feedback");
  assert.ok(lastLogo.y+lastLogo.height<=afterScrollBar.y+1,"The last chooser row remains reachable above the dock after scrolling");
  assert.equal(await home.isVisible(),true);
  await page.locator('#background').evaluate(element=>(element as HTMLElement).focus());assert.equal(await channels.getByRole('button',{name:'Fermer les canaux'}).evaluate(element=>element===document.activeElement),true,"Keyboard focus cannot enter covered dashboard content");
  await dock.getByRole('button',{name:'Assistant',exact:true}).click();await page.locator('#inrcy-assistant-dialog input').fill('Message');assert.equal(await page.evaluate(()=>(window as unknown as {assistantClicks:number}).assistantClicks),1);await page.getByRole('button',{name:'Fermer Assistant',exact:true}).click();
  await page.evaluate(()=>document.querySelector<HTMLDialogElement>('#blocking')!.showModal());await assert.rejects(home.click({timeout:350}),/Timeout/);assert.equal(await channels.isVisible(),true);await page.getByRole('button',{name:'Fermer la confirmation'}).click();
  await dock.getByRole('button').last().click();await page.getByRole('menu').waitFor();assert.equal(await channels.isVisible(),true);await page.getByRole('menuitem').click();
  await page.evaluate(()=>(window as unknown as {allowClose:boolean}).allowClose=false);await home.click();assert.equal(await channels.isVisible(),true,"The same unsaved-change guard protects Home");assert.equal(await page.evaluate(()=>(window as unknown as {homeNavigations:number}).homeNavigations),0);
  await page.evaluate(()=>(window as unknown as {allowClose:boolean}).allowClose=true);await home.click();await channels.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'auto');assert.deepEqual(errors,[]);t.diagnostic(JSON.stringify({viewport,channels:bounds,dock:bar}));await page.close();
 }}finally{await browser.close()}
});

test("Mes canaux switches desktop modal semantics at the dock breakpoint without covering an active confirmation",async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});await page.route("**/*",route=>route.abort());await page.setContent(html);await page.addScriptTag({content:fixture});await page.waitForFunction(()=>document.querySelector("[data-dashboard-channels-dialog]")||Boolean((window as unknown as {fixtureError:string|null}).fixtureError));assert.equal(await page.evaluate(()=>(window as unknown as {fixtureError:string|null}).fixtureError),null);const channels=page.locator('[data-dashboard-channels-dialog]');await channels.waitFor();assert.equal(await channels.evaluate(element=>element.matches(':modal')),true);assert.equal(await page.locator('[data-dashboard-mobile-nav]').isVisible(),false);
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('[data-dashboard-channels-dialog]')?.matches(':modal')===false);assert.equal(await page.locator('[data-dashboard-mobile-nav]').isVisible(),true);
  await page.evaluate(()=>document.querySelector<HTMLDialogElement>('#blocking')!.showModal());await page.setViewportSize({width:1440,height:900});assert.equal(await page.locator('#blocking').evaluate(element=>element.matches(':modal')),true);assert.equal(await channels.evaluate(element=>element.matches(':modal')),false,"A resize must not raise the channel cockpit over the confirmation");await page.getByRole('button',{name:'Fermer la confirmation'}).click();await page.waitForFunction(()=>document.querySelector('[data-dashboard-channels-dialog]')?.matches(':modal')===true);await page.close();
 }finally{await browser.close()}
});
