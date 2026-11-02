import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";
import { getInrAssistantNavigation } from "../../lib/inrAssistantUiCommands.ts";
import { inrAssistantUiActionsFromToolResult, type InrAssistantUiAction, type InrAssistantUiResult } from "../../lib/inrAssistantUiActions.ts";

type UiFixture = Window & {
  assistantProps: { screen: { availableCommands: string[]; selection: { id: string } } };
  result: InrAssistantUiResult[]; requestedHref: string; pdfBuilds: string[]; exports: unknown[];
  fixtureScope: { account: string; documentId: string }; allowNavigation: boolean; deferPdf: boolean;
  startActions: (actions: InrAssistantUiAction[]) => void; mountTarget: () => void; renderFixture: () => void;
  authCallback: (event: string, session: null) => void; releasePdf: () => void;
};

const require = createRequire(import.meta.url);
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources = {
  react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"),
  provider: compile("app/dashboard/_components/DashboardAssistantProvider.tsx"),
  "./DashboardAssistantScreenContext": compile("app/dashboard/_components/DashboardAssistantScreenContext.tsx"),
  "./DashboardAssistantCommandContext": compile("app/dashboard/_components/DashboardAssistantCommandContext.tsx"),
  ...Object.fromEntries(["inrAssistantUiCommands", "inrAssistantUiActions", "inrAssistantClientContext", "inrAssistantNavigation", "inrAssistantStudioDraft", "inrAssistantStudioHandoff"].map(name => [`@/lib/${name}`, compile(`lib/${name}.ts`)])),
};
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const fixture = `
const sources=${JSON.stringify(sources)},loaded={};
window.fixtureScope={actor:'actor-a',account:'account-a',pathname:'/dashboard/devis/new',query:'saveId=${A}',documentId:'${A}'};
window.exports=[];window.pdfBuilds=[];window.requests=[];window.allowNavigation=true;window.deferNavigation=true;
const router={push(href){window.requestedHref=href;if(!window.deferNavigation)window.mountTarget()}};
function require(name){
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(name.startsWith('./')&&sources['@/lib/'+name.slice(2).replace(/\\.ts$/,'')])return require('@/lib/'+name.slice(2).replace(/\\.ts$/,''));
 if(name==='next-intl')return {useLocale:()=> 'fr-FR'};
 if(name==='next/navigation')return {usePathname:()=>window.fixtureScope.pathname,useSearchParams:()=>new URLSearchParams(window.fixtureScope.query),useRouter:()=>router};
 if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=>window.fixtureScope.account};
 if(name==='@/lib/multicompte/constants')return {ACTIVE_INRCY_ACCOUNT_EVENT:'fixture-account-change'};
 if(name==='@/lib/supabaseClient')return {createClient:()=>({auth:{onAuthStateChange(callback){window.authCallback=callback;return {data:{subscription:{unsubscribe(){}}}}}}})};
 if(name==='./DashboardViewerAccessProvider')return {useDashboardViewerAccess:()=>({actorUserId:window.fixtureScope.actor,activeAccountId:window.fixtureScope.account})};
 if(name==='./DashboardUnsavedNavigationProvider')return {useDashboardUnsavedNavigation:()=>({requestNavigation:async callback=>{if(!window.allowNavigation)return false;await callback();return true}})};
 if(name==='./dashboardAssistantCopy')return {dashboardAssistantCopy:()=>({open:'Open',restore:'Restore',minimize:'Minimize'})};
 if(name==='./dashboardAssistantSessionState')return {clearActorSessions(){}};
 if(name.endsWith('/useAssistantFirstArrival'))return {useAssistantFirstArrival(){}};
 if(name==='./DashboardAssistantSession')return {__esModule:true,default:props=>{window.assistantProps=props;return null}};
 if(loaded[name])return loaded[name].exports;
 if(!sources[name])throw Error('Unexpected UI fixture module '+name);
 const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;
}
window.fetch=async(url,init)=>{window.requests.push({url,body:init?.body});return new Response(JSON.stringify({ok:true,downloadUrl:'/api/media-library/download?bundle=test'}),{headers:{'Content-Type':'application/json'}})};
HTMLAnchorElement.prototype.click=function(){window.exports.push({id:window.fixtureScope.documentId,href:this.href})};
const React=require('react'),screen=require('./DashboardAssistantScreenContext'),command=require('./DashboardAssistantCommandContext');
function Document(){
 const id=window.fixtureScope.documentId;
 screen.useInrAssistantScreen({selection:{kind:'quote',id},availableCommands:['export_document_pdf']});
 command.useInrAssistantDocumentPdf({kind:'quote',id},async()=>{window.pdfBuilds.push(id);if(window.deferPdf)await new Promise(resolve=>window.releasePdf=resolve);return new Blob(['PDF fixture'],{type:'application/pdf'})},'devis');
 return React.createElement('output',{id:'mounted-document'},id);
}
function Fixture(){const[,render]=React.useState(0);window.renderFixture=()=>render(n=>n+1);return React.createElement(require('provider').default,null,React.createElement(Document))}
window.mountTarget=()=>{const url=new URL(window.requestedHref,location.origin);window.fixtureScope={...window.fixtureScope,pathname:url.pathname,query:url.search.slice(1),documentId:url.searchParams.get('saveId')};window.renderFixture()};
window.startActions=actions=>{window.result=null;window.assistantProps.onUiActions(actions).then(value=>window.result=value)};
require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const actions = inrAssistantUiActionsFromToolResult("pdf-b", { ok: true, navigation: getInrAssistantNavigation("quotes", B), uiCommand: { command: "export_document_pdf", selection: { kind: "quote", id: B } } });
async function setup(page: Page) {
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }) : route.abort());
  await page.goto("https://fixture.invalid/dashboard/devis/new");
  await page.addScriptTag({ content: fixture });
  await page.waitForFunction(() => Boolean((window as unknown as UiFixture).assistantProps?.screen?.availableCommands?.length));
}

test("real React provider waits for B to mount and exports B once, never initial A", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await setup(page);
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), actions);
    await page.waitForFunction(() => Boolean((window as unknown as UiFixture).requestedHref));
    assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).pdfBuilds), []);
    await page.evaluate(() => (window as unknown as UiFixture).mountTarget());
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).pdfBuilds), [B]);
    assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).result.map((row: InrAssistantUiResult) => row.status)), ["applied", "handed_to_browser"]);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).exports.length), 1);
    await page.evaluate(() => (window as unknown as UiFixture).renderFixture());
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).exports.length), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("real dirty guard refusal and account invalidation cancel dependent exports", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ["dirty", "account", "actor"]) {
      const page = await browser.newPage(); await setup(page);
      if (mode === "dirty") await page.evaluate(() => { (window as unknown as UiFixture).allowNavigation = false; });
      await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), actions);
      if (mode !== "dirty") {
        await page.waitForFunction(() => Boolean((window as unknown as UiFixture).requestedHref));
        await page.evaluate(mode => {
          if (mode === "account") { (window as unknown as UiFixture).fixtureScope.account = "account-b"; window.dispatchEvent(new Event("fixture-account-change")); }
          else (window as unknown as UiFixture).authCallback("SIGNED_OUT", null);
        }, mode);
      }
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).exports.length), 0, mode);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).pdfBuilds.length), 0, mode);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result.at(-1)?.status), "cancelled", mode);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("selection change during asynchronous PDF build prevents stale download", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page);
    await page.evaluate(() => { (window as unknown as UiFixture).deferPdf = true; });
    const exportA = inrAssistantUiActionsFromToolResult("pdf-a", { ok: true, uiCommand: { command: "export_document_pdf", selection: { kind: "quote", id: A } } });
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), exportA);
    await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releasePdf));
    await page.evaluate(id => { (window as unknown as UiFixture).fixtureScope.documentId = id; (window as unknown as UiFixture).renderFixture(); }, B);
    await page.waitForFunction(id => document.querySelector("#mounted-document")?.textContent === id && (window as unknown as UiFixture).assistantProps.screen.selection.id === id, B);
    await page.evaluate(() => (window as unknown as UiFixture).releasePdf());
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).exports.length), 0);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "failed");
  } finally { await browser.close(); }
});
