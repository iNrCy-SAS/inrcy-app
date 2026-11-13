import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, webkit } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),"utf8");
const names = {
  MailboxHeader:"app/dashboard/mails/_components/MailboxHeader.tsx",
  FolderTabs:"app/dashboard/mails/_components/FolderTabs.tsx",
  MailboxToolbar:"app/dashboard/mails/_components/MailboxToolbar.tsx",
  MailboxList:"app/dashboard/mails/_components/MailboxList.tsx",
  DashboardToolHeading:"app/dashboard/_components/DashboardToolHeading.tsx",
  DashboardMobileSelect:"app/dashboard/_components/DashboardMobileSelect.tsx",
  ResponsiveActionButton:"app/dashboard/_components/ResponsiveActionButton.tsx",
  HelpButton:"app/dashboard/_components/HelpButton.tsx",
};
const compiled=new Map(Object.entries(names).map(([name,file])=>[name,ts.transpileModule(read(file),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText]));
function scopedCss(file:string,prefix:string){
  const globals:string[]=[];
  return read(file).replace(/:global\(([^)]+)\)/g,(_,selector)=>`___GLOBAL_${globals.push(selector)-1}___`)
    .replace(/\.([A-Za-z_][\w-]*)/g,(_,name)=>`.${prefix}${name}`)
    .replace(/___GLOBAL_(\d+)___/g,(_,index)=>globals[Number(index)]);
}
const css=[
  scopedCss("app/dashboard/dashboard.module.css","dash-"),
  scopedCss("app/dashboard/_components/ResponsiveBottomNav.module.css","dock-"),
  scopedCss("app/dashboard/mails/mails.module.css","mail-"),
  scopedCss("app/dashboard/_components/DashboardToolHeading.module.css","heading-"),
  scopedCss("app/dashboard/_components/DashboardMobileSelect.module.css","select-"),
  scopedCss("app/dashboard/_components/ResponsiveActionButton.module.css","action-"),
].join("\n");

/** The actual inbox presentation components/styles and shell/dock structure;
 * account reads, routing and closed settings/help panels are isolated. */
function markup(){
  const messages=JSON.parse(read("messages/fr-FR/mails.json"));
  const noop=()=>{};
  const folders=["publications","mails","propulsions","fidelisations","recoltes","offres","informations","suivis","enquetes"];
  const labels:Record<string,string>={publications:"Publications",mails:"Mails",propulsions:"Propulsions",fidelisations:"Fidélisations",recoltes:"Récoltes",offres:"Offres",informations:"Informations",suivis:"Suivis",enquetes:"Enquêtes"};
  const cache=new Map<string,{exports:{default?:ComponentType<Record<string,unknown>>}}>();
  const load=(name:string)=>{
    if(cache.has(name))return cache.get(name)!.exports;
    assert.ok(compiled.has(name),`Unexpected mailbox presentation component ${name}`);
    const record:{exports:{default?:ComponentType<Record<string,unknown>>}}={exports:{}};cache.set(name,record);
    new Function("module","exports","require",compiled.get(name)!)(record,record.exports,(id:string):unknown=>{
      if(id==="react"||id==="react/jsx-runtime")return require(id);
      if(id==="next/image")return {__esModule:true,default:({src,alt,width,height,className}:Record<string,unknown>)=>createElement("img",{src,alt,width,height,className})};
      if(id==="next/link")return {__esModule:true,default:({children,...props}:Record<string,unknown>)=>createElement("a",props,children as ReactNode)};
      if(id==="next-intl")return {useLocale:()=>"fr-FR",useTranslations:()=> (key:string,args:Record<string,string>={})=>Object.entries(args).reduce((value,[name,arg])=>value.replaceAll(`{${name}}`,arg),messages[key]||key)};
      if(id.endsWith(".module.css")){
        const prefix=id.includes("DashboardToolHeading")?"heading-":id.includes("DashboardMobileSelect")?"select-":id.includes("ResponsiveActionButton")?"action-":"mail-";
        return {__esModule:true,default:new Proxy({},{get:(_,key)=>prefix+String(key)})};
      }
      if(id.includes("useUnsavedExitGuard"))return {useUnsavedExitGuard:()=>({confirmExit:noop})};
      if(id.includes("useInrAssistantLocalInterface"))return {useInrAssistantLocalInterface:noop};
      if(id.includes("inrsendRetention"))return {getInrSendRetentionLabel:()=>"30 jours"};
      if(id.includes("instagramDeletionStatus"))return {isInstagramDeletionUnconfirmed:()=>false};
      if(id.endsWith("SettingsDrawer")||id.endsWith("HelpModal")||id.endsWith("DashboardAssistantTrigger"))return {__esModule:true,default:()=>null};
      if(id.endsWith("MailsSettingsContent"))return {MailSignatureSettingsContent:()=>null};
      if(id.endsWith("mailboxPhase1"))return {MAILBOX_PAGE_SIZE:20,ALL_FOLDERS:folders,folderLabel:(folder:string)=>labels[folder],folderTheme:()=>({}),toolbarActionTheme:()=>({}),isGroupedActionFolder:()=>false,listGridTemplateColumns:()=>"minmax(0,1fr) minmax(0,1fr) 90px 40px"};
      return load(id.split("/").at(-1)!);
    });
    return record.exports;
  };
  const Header=load("MailboxHeader").default!,Tabs=load("FolderTabs").default!,Toolbar=load("MailboxToolbar").default!,List=load("MailboxList").default!;
  return renderToStaticMarkup(createElement("div",{className:"dash-shell inrcy-dashboard-shell"},
    createElement("div",{className:"dash-mobileViewport"},
      createElement("div",{className:"mail-page"},createElement("div",{className:"mail-wrap"},
        createElement(Header,{standardMode:false,helpOpen:false,settingsOpen:false,onOpenHelp:noop,onCloseHelp:noop,onOpenSettings:noop,onCloseSettings:noop}),
        createElement("div",{className:"mail-grid"},createElement("div",{className:"mail-card mail-listCard"},
          createElement(Tabs,{folders,folder:"publications",counts:{},onSelectFolder:noop}),
          createElement(Toolbar,{folder:"publications",filterAccountId:"",setFilterAccountId:noop,mailAccounts:[],searchOpen:false,historyQuery:"",setSearchOpen:noop,loadHistory:noop,toolCfg:{label:"Publier"},resetCompose:noop,setComposeOpen:noop,boxView:"sent",onBoxViewChange:noop,draftCount:0}),
          createElement(List,{folder:"publications",boxView:"sent",loading:false,visibleItems:[],selectedId:null,openItem:noop,openDetails:noop,mailAccounts:[],itemMailAccountId:()=>null,filteredItemsLength:0,historyPage:2,historyTotalCount:60,historyHasMorePotential:true,historyPageCount:3,loadHistory:noop,refreshHistory:noop,historyQuery:""}),
        )),
      )),
    ),createElement("div",{className:"dock-root"},createElement("nav",{className:"dock-bar","aria-label":"Dock mobile"})),
  ));
}

test("inbox pagination and refresh stay fully reachable above the tablet dock",{timeout:60_000},async t=>{
  const engine=process.env.INRCY_PERSONALIZATION_BROWSER==="webkit"?webkit:chromium;
  const browser=await engine.launch({headless:true});
  const body=markup();
  try{
    for(const viewport of [{width:360,height:800},{width:390,height:844},{width:768,height:1024},{width:820,height:1180},{width:834,height:1194},{width:1024,height:1366},{width:1024,height:768},{width:1366,height:768}]){
      for(const safeArea of viewport.width<=1100?[0,20]:[0]){
        const page=await browser.newPage({viewport,hasTouch:viewport.width<=1100});
        await page.route("**/*",route=>route.abort());
        await page.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}:root{--inrcy-safe-area-top:0px;--inrcy-safe-area-right:0px;--inrcy-safe-area-bottom:${safeArea}px;--inrcy-safe-area-left:0px}html,body{margin:0;min-width:0;font:14px Arial,sans-serif}button,input,select{font:inherit}${css}</style></head><body>${body}</body></html>`);
        const footer=page.locator(".mail-listFooter");
        const initial=await footer.evaluate(element=>{const viewport=document.querySelector('.dash-mobileViewport')!,dock=document.querySelector('.dock-bar')!.getBoundingClientRect();return {footerBottom:element.getBoundingClientRect().bottom,dockTop:dock.top,viewportRange:viewport.scrollHeight-viewport.clientHeight,viewportScrollTop:viewport.scrollTop};});
        if(viewport.width>640&&viewport.width<=1100){
          t.diagnostic(JSON.stringify({viewport,safeArea,initial}));
          assert.ok(initial.footerBottom<=initial.dockTop+1,"tablet pagination is fully above the dock on the first display");
          assert.ok(initial.viewportRange<=1,"the mailbox does not require a compensating page-wrapper scroll");
        }
        await footer.scrollIntoViewIfNeeded();
        const measurements=await footer.evaluate(element=>{
          const r=element.getBoundingClientRect(),dock=document.querySelector('.dock-bar')!.getBoundingClientRect();
          const dockVisible=!!document.querySelector('.dock-root')!.getClientRects().length;
          const buttons=[...element.querySelectorAll('button')].map(button=>{const b=button.getBoundingClientRect();return {label:button.getAttribute('aria-label'),left:b.left,right:b.right,top:b.top,bottom:b.bottom,hit:button.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2))};});
          return {footerBottom:r.bottom,dockTop:dockVisible?dock.top:innerHeight,dockVisible,buttons,horizontal:document.documentElement.scrollWidth>innerWidth+1,documentRange:document.documentElement.scrollHeight-innerHeight};
        });
        t.diagnostic(JSON.stringify({viewport,safeArea,initial,...measurements}));
        assert.equal(measurements.horizontal,false,"the mailbox fits the viewport width");
        assert.equal(measurements.buttons.length,3,"previous, next and refresh actions stay present");
        for(const button of measurements.buttons){
          assert.ok(button.top>=0&&button.bottom<=measurements.dockTop+1,`${viewport.width}px: ${button.label} is fully above the dock`);
          assert.ok(button.left>=0&&button.right<=viewport.width+1);
          if(viewport.width<=1100) assert.ok(button.right-button.left>=44&&button.bottom-button.top>=44,`${viewport.width}px: ${button.label} keeps a usable touch target`);
          assert.equal(button.hit,true,`${viewport.width}px: ${button.label} receives the touch target`);
        }
        assert.ok(measurements.footerBottom<=measurements.dockTop+1,"the entire footer stays above the dock");
        await page.close();
      }
    }
  }finally{await browser.close();}
});
