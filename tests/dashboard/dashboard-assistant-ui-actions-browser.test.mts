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
  loadNative: (id: string) => void;
  deferOptimization: boolean; releaseOptimization: () => void; optimizationRefreshes: number;
  videoLoads: string[]; videoSaves: number; deferVideoLoad: boolean; deferVideoSave: boolean; releaseVideoLoad: () => void; releaseVideoSave: () => void; replaceNativeSource: (id: string) => void;
  authCallback: (event: string, session: null) => void; releasePdf: () => void;
  allowMailMount: boolean; mailUploads: string[];
  mailAttachments: Array<{ bucket: string; path: string; name: string; type: string; size: number }>;
  mailSaves: number; mailSends: number; mailConfirmations: number; mailScheduleOpen: boolean;
  deferMailSave: boolean; releaseMailSave: () => void; deferMailSend: boolean; releaseMailSend: () => void; refuseMail: boolean;
};

const require = createRequire(import.meta.url);
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { fileName: file, compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
function nativeBridgeSource(file: string) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const calls: ts.CallExpression[] = []; let update = "";
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && ["useInrAssistantNativeDraft", "useInrAssistantVideoCommands", "useInrAssistantMailCommands", "useInrAssistantAdsCommands"].includes(node.expression.getText(parsed))) calls.push(node); if (ts.isFunctionDeclaration(node) && node.name?.text === "updateDraft") update = node.getText(parsed); ts.forEachChild(node, visit); }; visit(parsed);
  assert.equal(calls.length, 1, `one active native bridge in ${file}`);
  return { call: ts.transpileModule(calls[0].getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    update: ts.transpileModule(update, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText };
}
function nativeFunctionSource(file: string, name: string) {
  const raw = readFileSync(file, "utf8"), ast = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }; visit(ast); assert.ok(found, name);
  return ts.transpileModule(found.getText(ast), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const adsSave = nativeFunctionSource("app/dashboard/ads/AdsClient.tsx", "saveDraft");
const adsMedia = nativeFunctionSource("app/dashboard/ads/AdsClient.tsx", "applyCampaignMedia");
const adsBridge = nativeBridgeSource("app/dashboard/ads/AdsClient.tsx");
const videoBridge = nativeBridgeSource("app/dashboard/_components/MediaVideoRetoucher.tsx");
const mailBridge = nativeBridgeSource("app/dashboard/mails/MailboxClient.tsx");
function clientLibSources(entry: string, output: Record<string, string> = {}) {
  const key = '@/lib/' + entry;
  if (output[key]) return output;
  const file = 'lib/' + entry + '.ts';
  const raw = readFileSync(file, 'utf8'); output[key] = compile(file);
  const ast = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
    const name = node.moduleSpecifier.text;
    if (name.startsWith('./') && name.endsWith('.ts')) clientLibSources(name.slice(2, -3), output);
  }
  return output;
}
const sources = {
  react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"),
  provider: compile("app/dashboard/_components/DashboardAssistantProvider.tsx"),
  "./DashboardAssistantScreenContext": compile("app/dashboard/_components/DashboardAssistantScreenContext.tsx"),
  "./DashboardAssistantCommandContext": compile("app/dashboard/_components/DashboardAssistantCommandContext.tsx"),
  "native": compile("app/dashboard/_hooks/useInrAssistantNativeDraft.ts"),
  "mail-native": compile("app/dashboard/_hooks/useInrAssistantMailCommands.ts"),
  "ads-native": compile("app/dashboard/_hooks/useInrAssistantAdsCommands.ts"),
  ...clientLibSources("inrAssistantAdsFormPatch"),
  ...clientLibSources("inrAssistantAdsDraftPersistence"),
  ...clientLibSources("inrAssistantAdsLibraryMedia"),
  ...clientLibSources("inrAssistantAdsUiCommands"),
  "library-optimization": compile("app/dashboard/_hooks/useInrAssistantLibraryOptimization.ts"),
  "video-native": compile("app/dashboard/_hooks/useInrAssistantVideoCommands.ts"),
  "preview": compile("app/dashboard/_hooks/useInrAssistantDocumentPreview.ts"),
  "document-mail": compile("app/dashboard/_hooks/useInrAssistantDocumentMail.ts"),
  "document-mail-preparation": compile("app/dashboard/_documents/documentMailPreparation.ts"),
  ...Object.fromEntries(["inrAssistantMailLifecycle", "inrAssistantUiPostScreen", "inrAssistantDocumentUiCommands", "inrAssistantNativeMediaOptimization", "mediaLibraryOptimizationPolicy", "mediaRules", "inrAssistantMailAttachments", "inrAssistantMailCompose", "inrAssistantMediaUiCommands", "inrAssistantUiCommands", "inrAssistantUiActions", "inrAssistantClientContext", "inrAssistantNavigation", "inrAssistantStudioDraft", "inrAssistantStudioHandoff"].map(name => [`@/lib/${name}`, compile(`lib/${name}.ts`)])),
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
 if(name==='../_components/DashboardViewerAccessProvider')return require('./DashboardViewerAccessProvider');
 if(name==='./DashboardViewerAccessProvider')return {useDashboardViewerAccess:()=>({actorUserId:window.fixtureScope.actor,activeAccountId:window.fixtureScope.account})};
 if(name==='./DashboardUnsavedNavigationProvider')return {useDashboardUnsavedNavigation:()=>({requestNavigation:async callback=>{if(!window.allowNavigation)return false;await callback();return true}})};
 if(name==='./dashboardAssistantCopy')return {dashboardAssistantCopy:()=>({open:'Open',restore:'Restore',minimize:'Minimize'})};
 if(name==='./dashboardAssistantSessionState')return {clearActorSessions(){}};
 if(name.endsWith('/useAssistantFirstArrival'))return {useAssistantFirstArrival(){}};
 if(name==='./DashboardAssistantSession')return {__esModule:true,default:props=>{window.assistantProps=props;return null}};
 if(loaded[name])return loaded[name].exports;
 if(!sources[name])throw Error('Unexpected UI fixture module '+name);
 const module=loaded[name]={exports:{}};try{new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;}catch(error){delete loaded[name];throw error;}
}
window.fetch=async(url,init)=>{
 window.requests.push({url,body:init?.body,idempotencyKey:new Headers(init?.headers).get('Idempotency-Key')});
 if(url==='/api/media-library/items?id=33333333-3333-4333-8333-333333333333'){
  window.adsMediaStarted=true;if(window.deferAdsMedia)await new Promise(resolve=>window.releaseAdsMedia=resolve);
  return Response.json({items:[{id:'33333333-3333-4333-8333-333333333333',media_type:'image',size_bytes:1000,mime_type:'image/jpeg',width:960,height:1200,signed_url:'/api/media-library/items/33333333-3333-4333-8333-333333333333/content?token=fixture'}]});
 }
 if(url==='/api/ads/campaigns'){
  window.nativeSaved=JSON.parse(init.body);window.nativeSavedId=window.nativeSaved.id||'22222222-2222-4222-8222-222222222222';
  window.adsPostStarted=true;if(window.deferAdsSave)await new Promise(resolve=>window.releaseAdsSave=resolve);
  return Response.json({campaign:{id:window.nativeSavedId,status:'draft'}});
 }
 if(String(url).startsWith('/api/ads/campaigns/'))return Response.json({campaign:{id:window.nativeSavedId,status:'draft',provider:window.nativeSaved.provider,draft:window.nativeSaved}});
 if(url==='/api/media-library/optimization'){window.optimizationQueued=true;return Response.json({job:{id:'job-native',media_id:'${A}',status:'queued'}})}
 if(url==='/api/media-library/optimization/run')return Response.json({ok:true});
 if(url==='/api/media-library/items?id=${A}'){
  if(window.optimizationQueued){window.optimizationReadStarted=true;if(window.deferOptimization)await new Promise(resolve=>window.releaseOptimization=resolve)}
  return Response.json({items:[{id:'${A}',media_type:'video',size_bytes:40000000,mime_type:'video/mp4',original_file_name:'source.mp4',...(window.optimizationQueued?{optimization:{id:'job-native',status:'succeeded',result:{outputMediaId:'${B}'}}}:{})}]});
 }
 if(url==='/api/media-library/items?id=${B}')return Response.json({items:[{id:'${B}',media_type:'video',size_bytes:19000000,media_metadata:{library_optimization:{source_media_id:'${A}',job_id:'job-native',target_bytes:20000000}}}]});
 if(window.deferDownload)await new Promise(resolve=>window.releaseDownload=resolve);
 return new Response(JSON.stringify({ok:true,downloadUrl:'/api/media-library/download?bundle=test'}),{headers:{'Content-Type':'application/json'}})
};
HTMLAnchorElement.prototype.click=function(){window.exports.push({id:window.fixtureScope.documentId,href:this.href})};
const React=require('react'),screen=require('./DashboardAssistantScreenContext'),command=require('./DashboardAssistantCommandContext');
function Document(){
 const serverVersion={accountId:window.fixtureScope.account,documentId:window.fixtureScope.documentId,updatedAt:'2026-11-02T12:00:00.000Z'};
 const preview=require('preview').useInrAssistantDocumentPreview('quote',window.fixtureScope.documentId,{text:window.fixtureScope.text},false,{isFinalized:true,serverVersion});
 const id=preview.selection.id;
 command.useInrAssistantDocumentPdf(preview.selection,async()=>{window.pdfBuilds.push(id);if(window.deferPdf)await new Promise(resolve=>window.releasePdf=resolve);return new Blob(['PDF fixture'],{type:'application/pdf'})},'devis',preview.revision);
 require('document-mail').useInrAssistantDocumentMail({selection:preview.selection,revision:preview.revision,serverVersion,enabled:preview.canPrepareMail,prepare:async(value,isCurrent)=>{
   const result=await require('document-mail-preparation').prepareDocumentMail({accountId:window.fixtureScope.account,documentId:id,kind:'devis',number:'DEV-001',filename:'DEV-001.pdf',recipient:value.recipient,clientName:'Client',subject:'Votre devis',text:'Voici le PDF',isCurrent,
     verifyDocument:async()=>true,buildPdf:async()=>new Blob(['PDF fixture'],{type:'application/pdf'}),upload:async key=>{window.mailUploads=(window.mailUploads||[]).concat(key);return {error:null}},
     requestNavigation:async callback=>{if(!window.allowNavigation)return false;callback();return true},navigate:href=>router.push(href)});
   return result==='opened';
 }});
 return React.createElement('output',{id:'mounted-document'},id);
}
function Library(){
 screen.useInrAssistantScreen({selectedMediaIds:window.fixtureScope.selectedMediaIds});
 const target={id:window.fixtureScope.documentId,media_type:'video',size_bytes:40000000,mime_type:'video/mp4',title:'Source',is_active:true};
 const status=require('library-optimization').useInrAssistantLibraryOptimization({target,selectedIds:window.fixtureScope.selectedMediaIds,blocked:Boolean(window.fixtureScope.blocked),refresh:async current=>{if(current())window.optimizationRefreshes=(window.optimizationRefreshes||0)+1}});
 return React.createElement('output',{id:'optimization-state'},JSON.stringify(status));
}
function AdsDraft(){
 const[draft,setDraft]=React.useState(()=>require('@/lib/adsValidation').parseAdsCampaignInput({provider:'meta',accountCurrency:'EUR',dailyBudgetEuros:20,endDate:'2026-12-30',name:'Original campaign',primaryText:'Original text'},{purpose:'draft'}).draft),[dirty,setDirty]=React.useState(false),[confirmedSpend,setConfirmedSpend]=React.useState(true),[step,setStep]=React.useState(0);
 const channelId='meta',creating=true,creationPath='manual',stepKeys=['foundations','creative','budget'];
 const [savedId,setSavedId]=React.useState(window.fixtureScope.documentId),[operationBusy,setBusy]=React.useState(null);
 const busy=window.fixtureScope.blocked?'saving':operationBusy;
 const reachedStepKeys=['foundations'],analysisStep=-1,planProgress=100;
 const linkedInManualGroupId=React.useRef(null),linkedInPlanEndIsExplicit=React.useRef(false),linkedInLaunchConsent=React.useRef({approved:true});
 function setConfirmedDestinationUrl(){} function applyDraftEdit(current,patch){return {...current,...patch}} function navigateToStep(next){setStep(next)}
 ${adsBridge.update}
 const useInrAssistantAdsCommands=require('ads-native').useInrAssistantAdsCommands;
 const {prepareInrAssistantAdsFormPatch,inrAssistantAdsPatchIsApplied}=require('@/lib/inrAssistantAdsFormPatch');
 const adsActorId=window.fixtureScope.actor,adsAccountId=window.fixtureScope.account,campaignMediaUploadBusy=false;
 const pilotChannelsEnabled=true,nativeSettings=null,assistantMedia=React.useRef(null);
 const {persistVerifiedAdsDraft,adsDraftContentKey}=require('@/lib/inrAssistantAdsDraftPersistence');
 const {loadInrAssistantAdsLibraryMedia}=require('@/lib/inrAssistantAdsLibraryMedia');
 const getActiveBrowserUserId=()=>window.fixtureScope.account;
 const adsEditor=React.useRef({draft,savedId,channelId,actorId:adsActorId,accountId:adsAccountId,creating,busy,active:true});
 React.useLayoutEffect(()=>{adsEditor.current={draft,savedId,channelId,actorId:adsActorId,accountId:adsAccountId,creating,busy,active:true}});
 React.useLayoutEffect(()=>()=>{adsEditor.current.active=false},[]);
 const nativeSavePending=React.useRef(false),nativeSaveAttempt=React.useRef(null),adsFormGeneration=React.useRef(0);
 const externalStatuses={},connectionSnapshots={},setNotice=value=>window.adsNotice=value,setDraftsRevision=()=>{};
 const confirmInrcy=async()=>{window.channelConfirmations=(window.channelConfirmations||0)+1;return window.allowChannelChange===true};
 const isAdsPublicChannel=()=>true,CHANNEL_CATALOG=[{id:'meta'},{id:'google'}],selectChannel=index=>{window.channelChanges=(window.channelChanges||0)+1};
 const metaMediaSlot=null,setMetaMediaFormatStatus=()=>{},setCampaignMediaUploadError=value=>window.adsMediaError=value;
 ${adsSave}
 ${adsMedia}
 window.nativeSave=()=>saveDraft();window.newUnsaved=()=>{adsFormGeneration.current++;setSavedId(null);setDirty(true);setDraft(value=>({...value}))};window.loadNative=id=>{adsFormGeneration.current++;setSavedId(id);setDraft(value=>({...value}))};
 ${adsBridge.call}
 window.editNative=name=>updateDraft({name}); window.nativeState={...draft,savedId,confirmedSpend,step,dirty};
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
 const [composeAttachments,setComposeAttachments]=React.useState([{bucket:'inrbox_attachments',path:'existing.pdf',size:400,name:'Facture.pdf',type:'application/pdf'}]);
 const {mergeInrAssistantMailAttachments}=require('@/lib/inrAssistantMailAttachments');
 const draftId=window.fixtureScope.documentId,composeOpen=true,sendBusy=Boolean(window.fixtureScope.blocked),scheduleBusy=false,attachBusy=false,scheduledMailEditSaving=false,scheduledMailEdit=null;
 const currentComposeSnapshot=JSON.stringify({to,subject,text,html,composeAttachments});
 const [lastSavedComposeSnapshot,setLastSavedComposeSnapshot]=React.useState(null),[assistantScheduleOpen,setAssistantScheduleOpen]=React.useState(false),[consumed,setConsumed]=React.useState(false);
 const assistantComposeConsumed=consumed,composeType='mail',setToast=()=>{},i18nT=value=>value,getClientUserFacingErrorMessage=()=>'';
 const saveDraft=async execution=>{execution.started();window.mailSaves=(window.mailSaves||0)+1;if(window.deferMailSave)await new Promise(resolve=>window.releaseMailSave=resolve);if(!execution.isCurrent())return;execution.accepted('saved');setLastSavedComposeSnapshot(currentComposeSnapshot)};
 const assistantMailControls={current:{send:async execution=>{window.mailConfirmations=(window.mailConfirmations||0)+1;if(window.deferMailSend)await new Promise(resolve=>window.releaseMailSend=resolve);if(!execution.isCurrent()||window.refuseMail)return;execution.started();window.mailSends=(window.mailSends||0)+1;execution.accepted('accepted');setConsumed(true)}}};
 const useInrAssistantMailCommands=require('mail-native').useInrAssistantMailCommands;
 ${mailBridge.call}
 window.editNative=value=>setSubject(value);window.nativeState={to,subject,text,html};window.mailAttachments=composeAttachments;window.mailScheduleOpen=assistantScheduleOpen;
 return React.createElement('output',{id:'native-state'},JSON.stringify(window.nativeState));
}
function Fixture(){const[,render]=React.useState(0);window.renderFixture=()=>render(n=>n+1);return React.createElement(require('provider').default,null,window.fixtureScope.pathname==='/dashboard/mails'&&window.allowMailMount===false?null:React.createElement(window.fixtureScope.pathname==='/dashboard/mails'?MailDraft:window.fixtureScope.pathname==='/dashboard/ads'?AdsDraft:window.fixtureScope.pathname==='/dashboard/generer-media'?VideoDraft:window.fixtureScope.pathname==='/dashboard/mediatheque'?Library:Document))}
window.mountTarget=()=>{const url=new URL(window.requestedHref,location.origin);window.fixtureScope={...window.fixtureScope,pathname:url.pathname,query:url.search.slice(1),documentId:url.searchParams.get('saveId')};window.renderFixture()};
window.startActions=actions=>{window.result=null;window.assistantProps.onUiActions(actions,undefined,window.deferClaim?()=>new Promise(resolve=>window.releaseClaim=()=>resolve(true)):undefined).then(value=>window.result=value)};
require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const actions = inrAssistantUiActionsFromToolResult("pdf-b", { ok: true, navigation: getInrAssistantNavigation("quotes", B), uiCommand: { command: "export_document_pdf", selection: { kind: "quote", id: B } } });
async function setup(page: Page, library = false, unsaved = false, native?: "ads" | "generer-media" | "mails") {
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }) : route.abort());
  await page.goto(native ? `https://fixture.invalid/dashboard/${native}` : library ? "https://fixture.invalid/dashboard/mediatheque" : `https://fixture.invalid/dashboard/devis/new${unsaved ? "?new=1" : ""}`);
  await page.addScriptTag({ content: "window.fixtureErrors=[];window.addEventListener('error',event=>window.fixtureErrors.push(event.error?.stack||event.message));" });
  await page.addScriptTag({ content: fixture });
  await page.waitForFunction(() => Boolean((window as unknown as UiFixture).assistantProps?.screen?.availableCommands?.length || (window as unknown as UiFixture).assistantProps?.screen?.selectedMediaIds?.length || (window as unknown as { fixtureErrors: string[] }).fixtureErrors.length));
  assert.deepEqual(await page.evaluate("window.fixtureErrors"), []);
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

test("native mail lifecycle acknowledges saved drafts, confirmed sends and schedule opening separately", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const name of ["save_mail_draft", "send_mail_draft", "open_mail_schedule"] as const) {
      const page = await browser.newPage(); await setup(page, false, false, "mails");
      const current = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const make = (key: string) => inrAssistantUiActionsFromToolResult(key, { ok: true, uiCommand: { command: name, selection: current.selection, revision: current.revision } });
      await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), make("first"));
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied", name);
      const counts = await page.evaluate(() => { const f = window as unknown as UiFixture; return { saves: f.mailSaves || 0, sends: f.mailSends || 0, confirms: f.mailConfirmations || 0, scheduled: f.mailScheduleOpen }; });
      assert.deepEqual(counts, { saves: name === "save_mail_draft" ? 1 : 0, sends: name === "send_mail_draft" ? 1 : 0, confirms: name === "send_mail_draft" ? 1 : 0, scheduled: name === "open_mail_schedule" });
      if (name === "save_mail_draft") assert.equal(await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen.pendingChanges), false);
      if (name !== "open_mail_schedule") {
        await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), make("replay-new-tool-call"));
        await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
        assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "failed");
        assert.equal(await page.evaluate(() => { const f = window as unknown as UiFixture; return (f.mailSaves || 0) + (f.mailSends || 0); }), 1);
      }
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).mailAttachments[0].path), "existing.pdf");
      await page.close();
    }
  } finally { await browser.close(); }
});

test("native mail confirmation refusal and late account/form changes never trigger an outgoing request", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ["refuse", "account", "edit"]) {
      const page = await browser.newPage(); await setup(page, false, false, "mails");
      const current = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const actions = inrAssistantUiActionsFromToolResult("send-guard", { ok: true, uiCommand: { command: "send_mail_draft", selection: current.selection, revision: current.revision } });
      await page.evaluate(({ actions, mode }) => { const f = window as unknown as UiFixture; f.refuseMail = mode === "refuse"; f.deferMailSend = mode !== "refuse"; f.startActions(actions); }, { actions, mode });
      if (mode !== "refuse") {
        await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseMailSend));
        await page.evaluate(mode => { const f = window as unknown as UiFixture; if (mode === "account") { f.fixtureScope.account = "other-account"; window.dispatchEvent(new Event("fixture-account-change")); } else f.editNative("Different message"); }, mode);
        if (mode === "edit") await page.waitForFunction(revision => (window as unknown as UiFixture).assistantProps.screen.revision !== revision, current.revision);
        await page.evaluate(() => (window as unknown as UiFixture).releaseMailSend());
      }
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.notEqual(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied", mode);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).mailSends || 0), 0, mode);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).mailAttachments[0].path), "existing.pdf");
      await page.close();
    }
  } finally { await browser.close(); }
});

test("a native draft save whose result becomes stale cannot be replayed for its original revision", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, false, "mails");
    const current = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const make = (key: string) => inrAssistantUiActionsFromToolResult(key, { ok: true, uiCommand: { command: "save_mail_draft", selection: current.selection, revision: current.revision } });
    await page.evaluate(actions => { const f = window as unknown as UiFixture; f.deferMailSave = true; f.startActions(actions); }, make("save"));
    await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseMailSave));
    await page.evaluate(() => (window as unknown as UiFixture).editNative("Edited during save"));
    await page.waitForFunction(revision => (window as unknown as UiFixture).assistantProps.screen.revision !== revision, current.revision);
    await page.evaluate(() => (window as unknown as UiFixture).releaseMailSave());
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "failed");
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), make("second-save"));
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).mailSaves), 1);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen.pendingChanges), true);
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

test("native mail attachment addition keeps existing PDF and rejects oversize patch atomically", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, false, "mails");
    const sendPatch = async (patch: unknown) => {
      const current = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const actions = inrAssistantUiActionsFromToolResult("mail-attach", { ok: true, uiCommand: { command: "configure_mail_draft", selection: { kind: "mail", id: current.selection.id }, revision: current.revision, patch } });
      await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), actions);
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      return page.evaluate(() => (window as unknown as UiFixture).result[0].status);
    };
    const photo = { bucket: "inrcy-pro-media", path: `users/${A}/photo.jpg`, name: "Photo.jpg", type: "image/jpeg", size: 500 };
    assert.equal(await sendPatch({ attachments: [photo] }), "applied");
    assert.equal(await sendPatch({ attachments: [photo] }), "applied");
    const attachments = await page.evaluate(() => (window as unknown as UiFixture).mailAttachments);
    assert.equal(attachments.length, 2); assert.equal(attachments[0].path, "existing.pdf"); assert.deepEqual(attachments[1], photo);
    assert.equal(await sendPatch({ attachments: [{ ...photo, path: `users/${A}/huge.jpg`, size: 10 * 1024 * 1024 }], subject: "Must not apply" }), "failed");
    assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).mailAttachments), attachments);
    assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).nativeState), { to: "original@example.invalid", subject: "Original", text: "Original text", html: "<p>Original text</p>" });
    assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).requests), []);
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
      const committed = await page.evaluate(() => (window as unknown as UiFixture).result[0].postScreen);
      assert.ok(committed, "the native bridge reports its committed revision, not the pre-action screen snapshot");
      assert.equal(committed.pathname, `/dashboard/${kind}`);
      assert.equal(committed.selection.id, initial.selection.id);
      assert.notEqual(committed.revision, initial.revision);
      const state = await page.evaluate(() => (window as unknown as UiFixture).nativeState);
      if (kind === "ads") { assert.equal(state.name, "Edited campaign"); assert.equal(state.primaryText, "Requested copy"); assert.equal(state.confirmedSpend, false, "Native edit revokes paid-launch consent"); assert.equal(state.step, 1); }
      else { assert.equal(state.format, "9_16"); assert.equal(state.adaptationMode, "cover_crop"); assert.equal(state.saved, false, "Retouch remains unsaved"); }
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).requests.length), 0);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).exports.length), 0);
      await page.evaluate(kind => (window as unknown as UiFixture).editNative(kind === "ads" ? "User later edit" : "16_9"), kind);
      await page.waitForFunction(revision => (window as unknown as UiFixture).assistantProps.screen.revision !== revision, committed.revision);
      const afterCommitRequest = structuredClone(request);
      if (afterCommitRequest[0].type === "command" && "revision" in afterCommitRequest[0].command) afterCommitRequest[0].command.revision = committed.revision;
      await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), afterCommitRequest);
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
        if (mode === "selection") f.loadNative("another-campaign");
        if (mode === "busy") { f.fixtureScope.blocked = true; f.renderFixture(); }
        if (mode === "account") { f.fixtureScope.account = "account-b"; window.dispatchEvent(new Event("fixture-account-change")); }
      }, invalidation);
      if (invalidation === "busy") await page.waitForFunction(() => !(window as unknown as UiFixture).assistantProps.screen.availableCommands?.length);
      else if (invalidation !== "account") await page.waitForFunction(old => { const screen = (window as unknown as UiFixture).assistantProps.screen; return screen.revision !== old.revision || screen.selection?.id !== old.selection.id; }, current);
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

test("Ads native budget changes commit before ACK, preserve other fields and revoke spend consent", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, false, "ads");
    const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const request = inrAssistantUiActionsFromToolResult("budget", { ok: true, uiCommand: { command: "configure_ads_draft", selection: { kind: "campaign", id: screen.selection.id }, revision: screen.revision, patch: { adsChanges: [{ field: "dailyBudgetEuros", valueJson: "35" }, { field: "targetLocations", valueJson: '["Paris"]' }] } } });
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), request);
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate("window.nativeState.dailyBudgetEuros"), 35);
    assert.deepEqual(await page.evaluate("window.nativeState.targetLocations"), ["Paris"]);
    assert.equal(await page.evaluate("window.nativeState.primaryText"), "Original text");
    assert.equal(await page.evaluate("window.nativeState.confirmedSpend"), false);
    assert.equal(await page.evaluate("window.result[0].status"), "applied");
    assert.deepEqual(await page.evaluate("window.requests"), []);
  } finally { await browser.close(); }
});

test("Ads first save executes the real callback, waits for exact native readback and keeps editor identity", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, false, "ads");
    await page.evaluate("window.newUnsaved()"); await page.waitForFunction("window.nativeState.savedId===null");
    const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const request = inrAssistantUiActionsFromToolResult("save", { ok: true, uiCommand: { command: "save_ads_draft", selection: { kind: "campaign", id: screen.selection.id }, revision: screen.revision } });
    await page.evaluate("window.deferAdsSave=true");
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), request);
    await page.waitForFunction("window.adsPostStarted===true");
    assert.equal(await page.evaluate("window.result"), null);
    await page.evaluate("window.releaseAdsSave()"); await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate("window.result[0].status"), "applied");
    assert.equal(await page.evaluate("window.nativeState.savedId"), B); assert.equal(await page.evaluate("window.nativeState.dirty"), false);
    assert.equal(await page.evaluate("window.assistantProps.screen.selection.id"), screen.selection.id);
    assert.notEqual(await page.evaluate("window.assistantProps.screen.revision"), screen.revision);
    assert.deepEqual(await page.evaluate("window.requests.map(row=>row.url)"), ["/api/ads/campaigns", `/api/ads/campaigns/${B}`]);
    const firstKey = await page.evaluate("window.requests[0].idempotencyKey");
    await page.evaluate("window.newUnsaved();window.deferAdsSave=false"); await page.waitForFunction("window.nativeState.savedId===null");
    await page.evaluate("window.nativeSave()");
    assert.notEqual(await page.evaluate("window.requests[2].idempotencyKey"), firstKey, "A deliberately new identical form is a distinct creation");
  } finally { await browser.close(); }
});

test("Ads late native saves never clear edits or acknowledge a different account/actor/document", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const invalidation of ["edit", "account", "actor", "document", "same_document"]) {
      const page = await browser.newPage(); await setup(page, false, false, "ads");
      const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const request = inrAssistantUiActionsFromToolResult("late-save", { ok: true, uiCommand: { command: "save_ads_draft", selection: { kind: "campaign", id: screen.selection.id }, revision: screen.revision } });
      await page.evaluate("window.deferAdsSave=true");
      await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), request); await page.waitForFunction("window.adsPostStarted===true");
      if (invalidation === "edit") { await page.evaluate("window.editNative('New unsaved text')"); await page.waitForFunction("window.nativeState.name==='New unsaved text'"); }
      else if (invalidation === "document") { await page.evaluate("window.newUnsaved()"); await page.waitForFunction("window.nativeState.savedId===null"); }
      else if (invalidation === "same_document") { await page.evaluate(id => (window as unknown as UiFixture).loadNative(id), A); await page.waitForFunction(old => (window as unknown as UiFixture).assistantProps.screen.revision !== old, screen.revision); }
      else { await page.evaluate(field => { const scope = (window as unknown as { fixtureScope: Record<string, string> }).fixtureScope; scope[field] = "other"; (window as unknown as UiFixture).renderFixture(); }, invalidation); await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); }
      await page.evaluate("window.releaseAdsSave()"); await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.notEqual(await page.evaluate("window.result[0].status"), "applied", invalidation);
      assert.equal(await page.evaluate("window.requests.length"), 1, "No read or retry after invalidation");
      if (invalidation === "edit") { assert.equal(await page.evaluate("window.nativeState.name"), "New unsaved text"); assert.equal(await page.evaluate("window.nativeState.dirty"), true); }
      if (invalidation === "document") assert.equal(await page.evaluate("window.nativeState.savedId"), null);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("Ads channel reset cannot discard a dirty form without the native pro confirmation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, false, "ads");
    await page.evaluate("window.editNative('Keep this draft')"); await page.waitForFunction("window.nativeState.dirty===true");
    const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const request = inrAssistantUiActionsFromToolResult("channel", { ok: true, uiCommand: { command: "configure_ads_draft", selection: { kind: "campaign", id: screen.selection.id }, revision: screen.revision, patch: { channel: "google" } } });
    await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), request); await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate("window.channelConfirmations"), 1); assert.equal(await page.evaluate("window.channelChanges||0"), 0);
    assert.equal(await page.evaluate("window.nativeState.name"), "Keep this draft"); assert.notEqual(await page.evaluate("window.result[0].status"), "applied");
    assert.deepEqual(await page.evaluate("window.requests"), []);
  } finally { await browser.close(); }
});

test("Ads native double save claims one write before React commits busy state", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, false, false, "ads");
    await page.evaluate("window.deferAdsSave=true;window.savePair=null;void Promise.all([window.nativeSave(),window.nativeSave()]).then(value=>window.savePair=value)");
    await page.waitForFunction("window.adsPostStarted===true");
    assert.equal(await page.evaluate("window.requests.length"), 1);
    await page.evaluate("window.releaseAdsSave()"); await page.waitForFunction("window.savePair!==null");
    assert.deepEqual(await page.evaluate("window.savePair"), [true, false]);
    assert.equal(await page.evaluate("window.requests.filter(row=>row.url==='/api/ads/campaigns').length"), 1);
  } finally { await browser.close(); }
});

test("Ads selected media uses the real native media callback and cannot overwrite a late form edit", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const late of [false, true]) {
      const page = await browser.newPage(); await setup(page, false, false, "ads");
      const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const request = inrAssistantUiActionsFromToolResult("media", { ok: true, uiCommand: { command: "configure_ads_draft", selection: { kind: "campaign", id: screen.selection.id }, revision: screen.revision, patch: { mediaId: "33333333-3333-4333-8333-333333333333", metaSlot: "feed" } } });
      if (late) await page.evaluate("window.deferAdsMedia=true");
      await page.evaluate(actions => (window as unknown as UiFixture).startActions(actions), request);
      if (late) {
        await page.waitForFunction("window.adsMediaStarted===true"); await page.evaluate("window.editNative('Keep my latest draft')"); await page.waitForFunction("window.nativeState.name==='Keep my latest draft'"); await page.evaluate("window.releaseAdsMedia()");
      }
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.equal(await page.evaluate("window.nativeState.metaCreativeAssets.feedImageUrl"), late ? "" : "/api/media-library/items/33333333-3333-4333-8333-333333333333/content?token=fixture");
      assert.equal(await page.evaluate("window.nativeState.metaCreativeAssets.storyReelImageUrl"), "");
      assert.equal(await page.evaluate("window.result[0].status==='applied'"), !late);
      assert.equal(await page.evaluate("window.nativeState.primaryText"), "Original text");
      assert.equal(await page.evaluate("window.requests.some(row=>row.url.includes('/campaigns'))"), false);
      await page.close();
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
    const committed = await page.evaluate(() => (window as unknown as UiFixture).result[0].postScreen);
    assert.equal(committed?.selection.id, screen.selection.id);
    assert.notEqual(committed?.revision, screen.revision);
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

test("library optimization uses native queue/worker/readback, preserves source and acknowledges only its exact output", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await setup(page, true);
    await page.waitForFunction(() => (window as unknown as UiFixture).assistantProps.screen.availableCommands?.includes("optimize_media"));
    const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const actions = inrAssistantUiActionsFromToolResult("optimize", { ok: true, uiCommand: { command: "optimize_media", selection: screen.selection, revision: screen.revision, targetBytes: 20_000_000 } });
    await page.evaluate(actions => { const f = window as unknown as UiFixture; f.deferOptimization = true; f.startActions(actions); }, actions);
    await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseOptimization));
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result), null);
    assert.equal(await page.locator("#optimization-state").evaluate(node => JSON.parse(node.textContent!).busy), true);
    const duplicate = await page.evaluate(actions => (window as unknown as UiFixture).assistantProps.onUiActions(actions), actions);
    assert.equal(duplicate[0].status, "cancelled");
    await page.evaluate(() => (window as unknown as UiFixture).releaseOptimization());
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied");
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).optimizationRefreshes), 1);
    assert.deepEqual(await page.evaluate(() => (window as unknown as UiFixture).result[0].postScreen), { pathname: "/dashboard/mediatheque", selection: { kind: "media", id: A }, revision: screen.revision });
    assert.match(await page.locator("#optimization-state").textContent() || "", /copie optimisée.*vérifiée/);
    const requests = await page.evaluate(() => (window as unknown as UiFixture).requests);
    assert.equal(requests.filter(row => row.url === "/api/media-library/optimization").length, 1);
    assert.equal(requests.filter(row => row.url === `/api/media-library/items?id=${B}`).length, 1);
    assert.equal(requests.some(row => /delete|cleanup/.test(row.url)), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("late native optimization completion cannot acknowledge another selected source or account", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ["selection", "account"]) {
      const page = await browser.newPage(); await setup(page, true);
      await page.waitForFunction(() => (window as unknown as UiFixture).assistantProps.screen.availableCommands?.includes("optimize_media"));
      const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const actions = inrAssistantUiActionsFromToolResult("optimize-late", { ok: true, uiCommand: { command: "optimize_media", selection: screen.selection, revision: screen.revision, targetBytes: 20_000_000 } });
      await page.evaluate(actions => { const f = window as unknown as UiFixture; f.deferOptimization = true; f.startActions(actions); }, actions);
      await page.waitForFunction(() => Boolean((window as unknown as UiFixture).releaseOptimization));
      await page.evaluate(mode => { const f = window as unknown as UiFixture;
        if (mode === "selection") f.fixtureScope.documentId = "33333333-3333-4333-8333-333333333333";
        else { f.fixtureScope.account = "account-b"; window.dispatchEvent(new Event("fixture-account-change")); }
        f.renderFixture();
      }, mode);
      await page.waitForFunction(revision => (window as unknown as UiFixture).assistantProps.screen.revision !== revision, screen.revision);
      await page.evaluate(() => (window as unknown as UiFixture).releaseOptimization());
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.notEqual(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied");
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).requests.some(row => row.url.endsWith("22222222-2222-4222-8222-222222222222"))), false);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).optimizationRefreshes || 0), 0);
      if (mode === "account") assert.equal(await page.locator("#optimization-state").evaluate(node => JSON.parse(node.textContent!).message), "");
      await page.close();
    }
  } finally { await browser.close(); }
});


test("document mail handoff waits for the exact native composer mount and reports no send", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page);
    await page.waitForFunction(() => (window as unknown as UiFixture).assistantProps.screen.availableCommands.includes("prepare_document_mail"));
    const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
    const batch = inrAssistantUiActionsFromToolResult("document-mail", { ok: true, uiCommand: { command: "prepare_document_mail", selection: screen.selection, revision: screen.revision, expectedUpdatedAt: "2026-11-02T12:00:00.000Z", recipient: "client@example.invalid" } });
    await page.evaluate(batch => { const f = window as unknown as UiFixture; f.allowMailMount = false; f.startActions(batch); }, batch);
    await page.waitForFunction(() => Boolean((window as unknown as UiFixture).requestedHref));
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result), null, "router.push alone is not a mounted composer");
    await page.evaluate(() => (window as unknown as UiFixture).mountTarget());
    await page.waitForFunction(() => !(window as unknown as UiFixture).assistantProps.screen.availableCommands?.length);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result), null, "the URL alone is not a committed native form");
    await page.evaluate(() => { const f = window as unknown as UiFixture; f.allowMailMount = true; f.renderFixture(); });
    await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
    const result = await page.evaluate(() => (window as unknown as UiFixture).result[0]);
    assert.equal(result.status, "applied"); assert.equal(result.postScreen?.pathname, "/dashboard/mails"); assert.equal(result.postScreen?.selection.kind, "mail"); assert.ok(result.postScreen?.revision);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).mailUploads.length), 1);
    assert.equal(await page.evaluate(() => (window as unknown as UiFixture).requests.length), 0, "no save or send request is made by the handoff");
  } finally { await browser.close(); }
});

test("document mail handoff refuses a cancelled guard, changed account, wrong document or substituted recipient", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ["guard", "account", "document", "recipient", "route"]) {
      const page = await browser.newPage(); await setup(page);
      await page.waitForFunction(() => (window as unknown as UiFixture).assistantProps.screen.availableCommands.includes("prepare_document_mail"));
      const screen = await page.evaluate(() => (window as unknown as UiFixture).assistantProps.screen);
      const batch = inrAssistantUiActionsFromToolResult("document-mail-" + mode, { ok: true, uiCommand: { command: "prepare_document_mail", selection: screen.selection, revision: screen.revision, expectedUpdatedAt: "2026-11-02T12:00:00.000Z", recipient: "client@example.invalid" } });
      await page.evaluate(({ batch, mode }) => { const f = window as unknown as UiFixture; if (mode === "guard") f.allowNavigation = false; f.startActions(batch); }, { batch, mode });
      if (mode !== "guard") {
        await page.waitForFunction(() => Boolean((window as unknown as UiFixture).requestedHref));
        await page.evaluate(mode => { const f = window as unknown as UiFixture; const url = new URL(f.requestedHref, location.origin);
          if (mode === "account") { f.fixtureScope.account = "account-b"; window.dispatchEvent(new Event("fixture-account-change")); }
          if (mode === "document") url.searchParams.set("docSaveId", "22222222-2222-4222-8222-222222222222");
          if (mode === "recipient") url.searchParams.set("to", "other@example.invalid");
          if (mode === "route") url.pathname = "/dashboard/ads";
          f.requestedHref = url.pathname + url.search; f.mountTarget();
        }, mode);
      }
      await page.waitForFunction(() => (window as unknown as UiFixture).result !== null);
      assert.notEqual(await page.evaluate(() => (window as unknown as UiFixture).result[0].status), "applied", mode);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).result[0].postScreen), undefined, mode);
      assert.equal(await page.evaluate(() => (window as unknown as UiFixture).requests.length), 0);
      await page.close();
    }
  } finally { await browser.close(); }
});
