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
  assistantProps: { screen: { availableCommands: string[]; selection: { id: string }; selectedMediaIds?: string[]; revision: string; pendingChanges?: boolean }; onUiActions: (actions: InrAssistantUiAction[]) => Promise<InrAssistantUiResult[]> };
  result: InrAssistantUiResult[]; requestedHref: string; pdfBuilds: string[]; exports: unknown[];
  fixtureScope: { account: string; documentId: string; selectedMediaIds: string[]; text: string; blocked: boolean }; allowNavigation: boolean; deferPdf: boolean; deferDownload: boolean;
  releaseDownload: () => void; requests: Array<{ url: string; body: string }>;
  startActions: (actions: InrAssistantUiAction[]) => void; mountTarget: () => void; renderFixture: () => void;
  deferClaim: boolean; releaseClaim: () => void;
  editNative: (name: string) => void; nativeState: { name: string; primaryText: string; confirmedSpend: boolean; format: string; adaptationMode: string; saved: boolean; step: number; sourceId: string };
  videoLoads: string[]; videoSaves: number; deferVideoLoad: boolean; deferVideoSave: boolean; releaseVideoLoad: () => void; releaseVideoSave: () => void; replaceNativeSource: (id: string) => void;
  authCallback: (event: string, session: null) => void; releasePdf: () => void;
};

const require = createRequire(import.meta.url);
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
function nativeBridgeSource(file: string) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const calls: ts.CallExpression[] = []; let update = "";
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && ["useInrAssistantNativeDraft", "useInrAssistantVideoCommands"].includes(node.expression.getText(parsed))) calls.push(node); if (ts.isFunctionDeclaration(node) && node.name?.text === "updateDraft") update = node.getText(parsed); ts.forEachChild(node, visit); }; visit(parsed);
  assert.equal(calls.length, 1, `one active native bridge in ${file}`);
  return { call: ts.transpileModule(calls[0].getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    update: ts.transpileModule(update, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText };
}
const adsBridge = nativeBridgeSource("app/dashboard/ads/AdsClient.tsx");
const videoBridge = nativeBridgeSource("app/dashboard/_components/MediaVideoRetoucher.tsx");
const mailBridge = nativeBridgeSource("app/dashboard/mails/MailboxClient.tsx");
const sources = {
  react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"),
  provider: compile("app/dashboard/_components/DashboardAssistantProvider.tsx"),
  "./DashboardAssistantScreenContext": compile("app/dashboard/_components/DashboardAssistantScreenContext.tsx"),
  "./DashboardAssistantCommandContext": compile("app/dashboard/_components/DashboardAssistantCommandContext.tsx"),
  "native": compile("app/dashboard/_hooks/useInrAssistantNativeDraft.ts"),
  "video-native": compile("app/dashboard/_hooks/useInrAssistantVideoCommands.ts"),
  "preview": compile("app/dashboard/_hooks/useInrAssistantDocumentPreview.ts"),
  ...Object.fromEntries(["inrAssistantMediaUiCommands", "inrAssistantMailCompose", "inrAssistantUiCommands", "inrAssistantUiActions", "inrAssistantClientContext", "inrAssistantNavigation", "inrAssistantStudioDraft", "inrAssistantStudioHandoff"].map(name => [`@/lib/${name}`, compile(`lib/${name}.ts`)])),
};
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const fixture = `
const sources=${JSON.stringify(sources)},loaded={};
window.fixtureScope={actor:'actor-a',account:'account-a',pathname:location.pathname,query:location.search.includes('new=1')?'':'saveId=${A}',documentId:location.search.includes('new=1')?'':'${A}',selectedMediaIds:['${A}','${B}'],text:'Private form text'};
window.exports=[];window.pdfBuilds=[];window.requests=[];window.allowNavigation=true;window.deferNavigation=true;
const router={push(href){window.requestedHref=href;if(!window.deferNavigation)window.mountTarget()}};
function require(name){
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(name==='../_components/DashboardAssistantScreenContext')return require('./DashboardAssistantScreenContext');
 if(name==='../_components/DashboardAssistantCommandContext')return require('./DashboardAssistantCommandContext');
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
window.fetch=async(url,init)=>{window.requests.push({url,body:init?.body});if(window.deferDownload)await new Promise(resolve=>window.releaseDownload=resolve);return new Response(JSON.stringify({ok:true,downloadUrl:'/api/media-library/download?bundle=test'}),{headers:{'Content-Type':'application/json'}})};
HTMLAnchorElement.prototype.click=function(){window.exports.push({id:window.fixtureScope.documentId,href:this.href})};
const React=require('react'),screen=require('./DashboardAssistantScreenContext'),command=require('./DashboardAssistantCommandContext');
function Document(){
 const preview=require('preview').useInrAssistantDocumentPreview('quote',window.fixtureScope.documentId,{text:window.fixtureScope.text});
 const id=preview.selection.id;
 command.useInrAssistantDocumentPdf(preview.selection,async()=>{window.pdfBuilds.push(id);if(window.deferPdf)await new Promise(resolve=>window.releasePdf=resolve);return new Blob(['PDF fixture'],{type:'application/pdf'})},'devis',preview.revision);
 return React.createElement('output',{id:'mounted-document'},id);
}
function Library(){screen.useInrAssistantScreen({selectedMediaIds:window.fixtureScope.selectedMediaIds});return React.createElement('output',null,'Library')}
function AdsDraft(){
 const[draft,setDraft]=React.useState({name:'Original campaign',primaryText:'Original text'}),[dirty,setDirty]=React.useState(false),[confirmedSpend,setConfirmedSpend]=React.useState(true),[step,setStep]=React.useState(0);
 const channelId='meta',creating=true,creationPath='manual',busy=window.fixtureScope.blocked?'saving':null,savedId=window.fixtureScope.documentId,stepKeys=['foundations','creative','budget'];
 const reachedStepKeys=['foundations'],analysisStep=-1,planProgress=100;
 const linkedInManualGroupId=React.useRef(null),linkedInPlanEndIsExplicit=React.useRef(false),linkedInLaunchConsent=React.useRef({approved:true});
 function setConfirmedDestinationUrl(){} function applyDraftEdit(current,patch){return {...current,...patch}} function navigateToStep(next){setStep(next)}
 ${adsBridge.update}
 const useInrAssistantNativeDraft=require('native').useInrAssistantNativeDraft;
 ${adsBridge.call}
 window.editNative=name=>updateDraft({name}); window.nativeState={...draft,confirmedSpend,step,dirty};
 return React.createElement('output',{id:'native-state'},JSON.stringify(window.nativeState));
}
function VideoDraft(){
 const [source,setSource]=React.useState({libraryItem:{id:window.fixtureScope.documentId},url:'local-video'}),[format,setFormat]=React.useState('original'),[adaptationMode,setAdaptationMode]=React.useState('safe_frame'),[saved,setSaved]=React.useState(false);
 const [operationBusy,setOperationBusy]=React.useState(false);
 const channel='site_web',saving=operationBusy||Boolean(window.fixtureScope.blocked),initialSourceLoading=false,acceptMode='library';
 const normalizeVideoFormat=(_channel,value)=>['original','9_16','1_1','16_9'].includes(value)?value:'original';
 const clearOwnedUrl=()=>{},setError=()=>{};
 const sourceFromLibraryItem=item=>({libraryItem:item,url:'owned-library-video'});
 const loadInrAssistantLibraryVideo=async(id,stillCurrent)=>{window.videoLoads=(window.videoLoads||[]).concat(id);if(window.deferVideoLoad)await new Promise(resolve=>window.releaseVideoLoad=resolve);return stillCurrent()?{id,media_type:'video'}:null};
 const save=async(options)=>{setOperationBusy(true);try{window.videoSaves=(window.videoSaves||0)+1;if(window.deferVideoSave)await new Promise(resolve=>window.releaseVideoSave=resolve);if(!options.isCurrent())return false;setSaved(true);return true}finally{setOperationBusy(false)}};
 const useInrAssistantVideoCommands=require('video-native').useInrAssistantVideoCommands;
 ${videoBridge.call}
 window.editNative=value=>setFormat(value); window.replaceNativeSource=id=>setSource({libraryItem:{id},url:'user-replacement'});window.nativeState={format,adaptationMode,saved,sourceId:source.libraryItem.id};
 return React.createElement('output',{id:'native-state'},JSON.stringify(window.nativeState));
}
function MailDraft(){
 const [to,setTo]=React.useState('original@example.invalid'),[subject,setSubject]=React.useState('Original'),[text,setText]=React.useState('Original text'),[html,setHtml]=React.useState('<p>Original text</p>');
 const draftId=window.fixtureScope.documentId,composeOpen=true,sendBusy=Boolean(window.fixtureScope.blocked),scheduleBusy=false,attachBusy=false,scheduledMailEditSaving=false,scheduledMailEdit=null;
 const currentComposeSnapshot=JSON.stringify({to,subject,text,html}),lastSavedComposeSnapshot=null;
 const useInrAssistantNativeDraft=require('native').useInrAssistantNativeDraft;
 ${mailBridge.call}
 window.editNative=value=>setSubject(value);window.nativeState={to,subject,text,html};
 return React.createElement('output',{id:'native-state'},JSON.stringify(window.nativeState));
}
function Fixture(){const[,render]=React.useState(0);window.renderFixture=()=>render(n=>n+1);return React.createElement(require('provider').default,null,React.createElement(window.fixtureScope.pathname==='/dashboard/mails'?MailDraft:window.fixtureScope.pathname==='/dashboard/ads'?AdsDraft:window.fixtureScope.pathname==='/dashboard/generer-media'?VideoDraft:window.fixtureScope.pathname==='/dashboard/mediatheque'?Library:Document))}
window.mountTarget=()=>{const url=new URL(window.requestedHref,location.origin);window.fixtureScope={...window.fixtureScope,pathname:url.pathname,query:url.search.slice(1),documentId:url.searchParams.get('saveId')};window.renderFixture()};
window.startActions=actions=>{window.result=null;window.assistantProps.onUiActions(actions,undefined,window.deferClaim?()=>new Promise(resolve=>window.releaseClaim=()=>resolve(true)):undefined).then(value=>window.result=value)};
require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const actions = inrAssistantUiActionsFromToolResult("pdf-b", { ok: true, navigation: getInrAssistantNavigation("quotes", B), uiCommand: { command: "export_document_pdf", selection: { kind: "quote", id: B } } });
async function setup(page: Page, library = false, unsaved = false, native?: "ads" | "generer-media" | "mails") {
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }) : route.abort());
  await page.goto(native ? `https://fixture.invalid/dashboard/${native}` : library ? "https://fixture.invalid/dashboard/mediatheque" : `https://fixture.invalid/dashboard/devis/new${unsaved ? "?new=1" : ""}`);
  await page.addScriptTag({ content: fixture });
  await page.waitForFunction(() => Boolean((window as unknown as UiFixture).assistantProps?.screen?.availableCommands?.length || (window as unknown as UiFixture).assistantProps?.screen?.selectedMediaIds?.length));
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

test("native mail draft applies committed fields without saving/sending and invalidates stale edits", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, false, "mails");
    const current = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const make = (patch: Record<string, string>) => inrAssistantUiActionsFromToolResult("mail", { ok: true, uiCommand: { command: "configure_mail_draft", selection: { kind: "mail", id: current.selection.id }, revision: current.revision, patch } });
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), make({ subject: "Nouveau sujet" }));
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied");
    assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).nativeState), { to: "original@example.invalid", subject: "Nouveau sujet", text: "Original text", html: "<p>Original text</p>" });
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), make({ bodyText: "Late obsolete text" }));
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "failed");
    const updated = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const body = inrAssistantUiActionsFromToolResult("mail-body", { ok: true, uiCommand: { command: "configure_mail_draft", selection: { kind: "mail", id: updated.selection.id }, revision: updated.revision, patch: { bodyText: "Bonjour Alice" } } });
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), body);
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied");
    assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).nativeState), { to: "original@example.invalid", subject: "Nouveau sujet", text: "Bonjour Alice", html: "" });
    assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).requests), []);
  } finally { await browser.close(); }
});

test("native mail pending edit is refused if account or form becomes busy before claim", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ["account", "busy"]) {
      const page = await browser.newPage(); await setup(page, false, false, "mails");
      const current = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const actions = inrAssistantUiActionsFromToolResult("mail-late", { ok: true, uiCommand: { command: "configure_mail_draft", selection: { kind: "mail", id: current.selection.id }, revision: current.revision, patch: { subject: "Late subject" } } });
      await page.evaluate(actions => { const f = window as unknown as UiFixture; f.deferClaim = true; f.startActions(actions); }, actions);
      await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseClaim));
      await page.evaluate(mode => { const f = window as unknown as UiFixture; if (mode === "account") { f.fixtureScope.account = "account-b"; window.dispatchEvent(new Event("fixture-account-change")); } else { f.fixtureScope.blocked = true; f.renderFixture(); } }, mode);
      await page.waitForTimeout(100);
      await page.evaluate(() => (window as unknown as UiFixture).releaseClaim());
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), mode === "account" ? "cancelled" : "failed");
      assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).requests), []);
      await page.close();
    }
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

test("real provider downloads all checked media and rejects a changed selection during preparation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, true);
    const selected = inrAssistantUiActionsFromToolResult("selection", { ok: true, uiCommand: { command: "download_media", selection: { kind: "media", id: A }, mediaIds: [A, B], pathname: "/dashboard/mediatheque", selectionMode: "current" } });
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), selected);
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.deepEqual(await page.evaluate(() => JSON.parse((window as unknown as UiFixture).requests[0].body).ids), [A, B]);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).exports.length), 1);
    await page.evaluate(() => { (window as unknown as UiFixture).deferDownload = true; });
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), selected);
    await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseDownload));
    await page.evaluate(id => { (window as unknown as UiFixture).fixtureScope.selectedMediaIds = [id]; (window as unknown as UiFixture).renderFixture(); }, B);
    await page.waitForFunction(() => (window as unknown as UiFixture).assistantProps.screen.selectedMediaIds?.length === 1);
    await page.evaluate(() => (window as unknown as UiFixture).releaseDownload());
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).exports.length), 1, "Late ZIP must not be downloaded for the old selection");
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "failed");
  } finally { await browser.close(); }
});

test("new unsaved document exports its native preview without saving and rejects an older form revision", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, true);
    const initial = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    assert.match(initial.selection.id, /^preview_/);
    assert.equal(initial.pendingChanges, true);
    assert.ok(!JSON.stringify(initial).includes("Private form text"));
    const previewActions = inrAssistantUiActionsFromToolResult("preview", { ok: true, uiCommand: { command: "export_document_pdf", selection: { kind: "quote", id: initial.selection.id }, revision: initial.revision } });
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), previewActions);
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).exports.length), 1);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).requests.length), 0, "Preview export must not create/finalize/save a document");
    await page.evaluate(() => { (window as unknown as UiFixture).fixtureScope.text = "Edited local form"; (window as unknown as UiFixture).renderFixture(); });
    await page.waitForFunction(revision => (window as unknown as UiFixture).assistantProps.screen.revision !== revision, initial.revision);
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), previewActions);
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "failed");
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).exports.length), 1);
  } finally { await browser.close(); }
});

for (const kind of ["ads", "generer-media"] as const) {
  test(`${kind}: actual native callbacks commit requested fields, keep guards, and reject stale commands`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage(), errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await setup(page, false, false, kind);
      const initial = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const command = kind === "ads" ? "configure_ads_draft" : "configure_video_retouch";
      const patch = kind === "ads" ? { name: "Edited campaign", primaryText: "Requested copy", step: "creative" } : { format: "9_16", adaptationMode: "cover_crop" };
      const request = inrAssistantUiActionsFromToolResult("native", { ok: true, uiCommand: { command, selection: { kind: kind === "ads" ? "campaign" : "media", id: initial.selection.id }, revision: initial.revision, patch } });
      assert.equal(request.length, 1);
      await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), request);
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied");
      const state = await page.evaluate(() => (window as unknown as UiFixture).nativeState);
      if (kind === "ads") { assert.equal(state.name, "Edited campaign"); assert.equal(state.primaryText, "Requested copy"); assert.equal(state.confirmedSpend, false, "Native edit revokes paid-launch consent"); assert.equal(state.step, 1); }
      else { assert.equal(state.format, "9_16"); assert.equal(state.adaptationMode, "cover_crop"); assert.equal(state.saved, false, "Retouch remains unsaved"); }
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).requests.length), 0);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).exports.length), 0);
      await page.evaluate(kind => (window as unknown as UiFixture).editNative(kind === "ads" ? "User later edit" : "16_9"), kind);
      await page.waitForFunction(revision => (window as unknown as UiFixture).assistantProps.screen.revision !== revision, initial.revision);
      await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), request);
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "failed");
      assert.equal(await page.evaluate(kind => kind === "ads" ? (window as unknown as UiFixture).nativeState.name : (window as unknown as UiFixture).nativeState.format, kind), kind === "ads" ? "User later edit" : "16_9");
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

test("native changes arriving after a claim wait cannot cross a form revision or account", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const invalidation of ["revision", "selection", "busy", "account"]) {
      const page = await browser.newPage(); await setup(page, false, false, "ads");
      const current = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const request = inrAssistantUiActionsFromToolResult("late", { ok: true, uiCommand: { command: "configure_ads_draft", selection: { kind: "campaign", id: current.selection.id }, revision: current.revision, patch: { name: "Late assistant edit" } } });
      await page.evaluate(actions => { const fixture = window as unknown as UiFixture; fixture.deferClaim = true; fixture.startActions(actions); }, request);
      await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseClaim));
      await page.evaluate(mode => { const f = window as unknown as UiFixture;
        if (mode === "revision") f.editNative("User latest edit");
        if (mode === "selection") { f.fixtureScope.documentId = "another-campaign"; f.renderFixture(); }
        if (mode === "busy") { f.fixtureScope.blocked = true; f.renderFixture(); }
        if (mode === "account") { f.fixtureScope.account = "account-b"; window.dispatchEvent(new Event("fixture-account-change")); }
      }, invalidation);
      if (invalidation !== "account") await page.waitForFunction(old => { const screen = (window as unknown as UiFixture).assistantProps.screen; return screen.revision !== old.revision || screen.selection?.id !== old.selection.id; }, current);
      await page.evaluate(() => (window as unknown as UiFixture).releaseClaim());
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.notEqual(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied", invalidation);
      assert.notEqual(await page.evaluate(() => (window as unknown as UiFixture).nativeState.name), "Late assistant edit", invalidation);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("native Ads rejects locked steps and channel text limits before applying any field", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, false, "ads");
    for (const patch of [{ name: "Must not apply", step: "budget" }, { name: "Must not apply", primaryText: "x".repeat(501) }]) {
      const current = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const request = inrAssistantUiActionsFromToolResult("guard", { ok: true, uiCommand: { command: "configure_ads_draft", selection: { kind: "campaign", id: current.selection.id }, revision: current.revision, patch } });
      await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), request);
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "failed");
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).nativeState.name), "Original campaign");
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).nativeState.confirmedSpend), true);
    }
  } finally { await browser.close(); }
});

test("a concurrent native batch cannot overtake the pending claim or apply twice", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, false, "ads");
    const current = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const request = inrAssistantUiActionsFromToolResult("first", { ok: true, uiCommand: { command: "configure_ads_draft", selection: { kind: "campaign", id: current.selection.id }, revision: current.revision, patch: { name: "First edit" } } });
    await page.evaluate(actions => { const f = window as unknown as UiFixture; f.deferClaim = true; f.startActions(actions); }, request);
    await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseClaim));
    const second = await page.evaluate(actions => (window as unknown as UiFixture).assistantProps.onUiActions(actions), request);
    assert.equal(second[0].status, "cancelled");
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).nativeState.name), "Original campaign");
    await page.evaluate(() => (window as unknown as UiFixture).releaseClaim());
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied");
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).nativeState.name), "First edit");
  } finally { await browser.close(); }
});

test("video source selection waits for the real editor commit and preserves its format/crop", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await setup(page, false, false, "generer-media");
    await page.evaluate(() => (window as unknown as UiFixture).editNative("9_16"));
    await page.waitForFunction(() => (window as unknown as UiFixture).nativeState.format === "9_16");
    const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const request = inrAssistantUiActionsFromToolResult("select-video", { ok: true, uiCommand: { command: "select_video_source", selection: screen.selection, revision: screen.revision, mediaId: B } });
    await page.evaluate(actions => { const f = window as unknown as UiFixture; f.deferVideoLoad = true; f.startActions(actions); }, request);
    await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseVideoLoad));
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).nativeState.sourceId), A);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result), null);
    await page.evaluate(() => (window as unknown as UiFixture).releaseVideoLoad());
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    const state = await page.evaluate(() => (window as unknown as UiFixture).nativeState);
    assert.equal(state.sourceId, B); assert.equal(state.format, "9_16"); assert.equal(state.adaptationMode, "safe_frame");
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen.selection.id), screen.selection.id, "editor identity remains stable while its source changes");
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("late source lookup cannot overwrite a user-selected source or cross account/actor scope", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ["source", "account", "actor"]) {
      const page = await browser.newPage(); await setup(page, false, false, "generer-media");
      const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const request = inrAssistantUiActionsFromToolResult("late-source", { ok: true, uiCommand: { command: "select_video_source", selection: screen.selection, revision: screen.revision, mediaId: B } });
      await page.evaluate(actions => { const f = window as unknown as UiFixture; f.deferVideoLoad = true; f.startActions(actions); }, request);
      await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseVideoLoad));
      await page.evaluate(mode => { const f = window as unknown as UiFixture;
        if (mode === "source") f.replaceNativeSource("user-choice");
        else if (mode === "account") { f.fixtureScope.account = "account-b"; window.dispatchEvent(new Event("fixture-account-change")); }
        else f.authCallback("SIGNED_OUT", null);
      }, mode);
      if (mode === "source") await page.waitForFunction(() => (window as unknown as UiFixture).nativeState.sourceId === "user-choice");
      await page.evaluate(() => (window as unknown as UiFixture).releaseVideoLoad());
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.notEqual(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied", mode);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).nativeState.sourceId), mode === "source" ? "user-choice" : A, mode);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("video save acknowledgement waits for the native save and the saved state commit", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, false, "generer-media");
    const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const request = inrAssistantUiActionsFromToolResult("save-video", { ok: true, uiCommand: { command: "save_video_retouch", selection: screen.selection, revision: screen.revision } });
    await page.evaluate(actions => { const f = window as unknown as UiFixture; f.deferVideoSave = true; f.startActions(actions); }, request);
    await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseVideoSave));
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result), null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).nativeState.saved), false);
    await page.evaluate(() => (window as unknown as UiFixture).releaseVideoSave());
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).nativeState.saved), true);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied");
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).videoSaves), 1);
    await page.waitForFunction(() => !(window as unknown as UiFixture).assistantProps.screen.availableCommands.includes("save_video_retouch"));
  } finally { await browser.close(); }
});
