import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { Script } from "node:vm";
import { chromium } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources = {
  react: packageSource("react", "react.production.js"), "react-dom": packageSource("react-dom", "react-dom.production.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"),
  generation: compile("app/dashboard/booster/publier/useBoosterGeneration.ts"),
  phases: compile("lib/boosterProgressPhases.ts"),
};
const fixture = `
const sources=${JSON.stringify(sources)},loaded={};
window.fixtureErrors=[];window.addEventListener('error',event=>window.fixtureErrors.push(event.message));
window.calls=[];window.recoveries=[];window.reports=[];window.commits=[];window.startedIds=0;window.activeAccount='account-a';
const noop=()=>{},unexpected=()=>{throw Error('Unexpected external operation')};
const translate=(key)=>key;
function require(name){
 if(name==='@/lib/boosterProgressPhases')return require('phases');
 if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=>window.activeAccount,resolveActiveBrowserUserId:()=>window.activeAccount};
 if(name==='@/lib/boosterContentAdjustment')return {normalizeBoosterContentAdjustment:unexpected,mergeBoosterContentAdjustment:unexpected};
 if(name==='@/lib/supabaseClient')return {createClient:unexpected};
 if(name==='@/lib/boosterGenerationTransportClient')return {buildBoosterGenerationRequest:payload=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})};
 if(name==='@/lib/boosterDocumentAttachmentPolicy')return {getBoosterDocumentMimeType:unexpected,validateBoosterDocumentSelection:unexpected};
 if(name==='@/lib/boosterPdfAttachmentPolicy')return {BOOSTER_PDF_STORAGE_BUCKET:'fixture',BOOSTER_PDF_STORAGE_FOLDER:'fixture'};
 if(name==='@/lib/boosterGenerationRecoveryClient')return {createBoosterGenerationRequestId:()=> 'request-'+(++window.startedIds),isBoosterGenerationTransportLoss:()=>true,
 recoverBoosterGenerationResult:async input=>{window.recoveries.push(input);return {status:'ready',payload:{versions:{facebook:{title:'Recovered',content:'Saved'}}},attempts:1,elapsedMs:1}},reportBoosterGenerationResponseLoss:input=>window.reports.push(input)};
 if(name==='@/lib/boosterGenerationErrorPolicy')return {getBoosterGenerationSpecialErrorMessage:()=>null,isAutomaticBoosterGenerationRetryEligible:()=>false};
 if(name==='@/lib/userFacingErrors')return {getClientUserFacingErrorMessage:(error,fallback)=>String(error||fallback)};
 if(name==='@/lib/aiEnginePreference')return {getAiEngineOption:()=>({shortLabel:'Fixture'}),getAutomaticAiRetryEngine:unexpected};
 if(name==='@/lib/inrcyDialog')return {confirmInrcy:unexpected};
 if(name==='./publishModal.shared')return {buildBoosterVideoGenerationContext:()=>null,parseInstagramHashtagsInput:()=>[]};
 if(name==='./publishModal.foundations')return {sanitizePostsForEditor:versions=>versions};
 if(name==='./publishModal.clientResilience')return {settleOptionalMediaEnrichment:unexpected};
 if(name==='@/lib/boosterCreationMode')return {shouldPrepareBoosterMediaForAi:()=>false};
 if(loaded[name])return loaded[name].exports;if(!sources[name])throw Error('Unexpected dependency '+name);
 const record=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,record,record.exports);return record.exports;
}
window.fetch=(url,options)=>{
 window.calls.push({url,payload:JSON.parse(options.body)});
 if(window.transportLoss)return Promise.reject(new TypeError('Failed to fetch'));
 return new Promise(resolve=>{window.resolveGeneration=()=>resolve({ok:true,json:async()=>({versions:{facebook:{title:'New content',content:'Generated'}}})})});
};
const React=require('react'),jsx=React.createElement;
function Fixture(){
 const[idea,setIdea]=React.useState(''),[account,setAccount]=React.useState('account-a'),[posts,setPosts]=React.useState({});
 const scope=React.useRef({actorUserId:'actor-a',accountId:account}),currentPosts=React.useRef(posts);currentPosts.current=posts;
 const generation=require('generation').useBoosterGeneration({i18nT:translate,runtimeT:translate,readContext:()=>({
 intent:{creationMode:'ai',idea,publicationInstruction:'',selectedForGeneration:['facebook'],selectedChannels:['facebook'],selectedAiPreferredEngine:'gemini',hasWrittenChannelContent:false,theme:'',contentStyle:'equilibre'},
 media:{videoFile:null,videoPreviewUrl:'',videoDurationSeconds:null,videoStorageContext:null,images:[],useImagesForAI:false,documentFiles:[],videoAiContextRef:null,getOrPrepareAiImagePayload:unexpected,getOrPrepareVideoFramesForAI:unexpected},
 workspace:{unifiedMediaConsumptionClientAvailable:true,mediaWorkspaceId:'workspace-a',persistentMediaWorkspaceEnabled:true,mediaPipelineCutoverEnabled:true,waitForPersistentWorkspaceReadiness:unexpected,startPersistentAiMediaPreparation:unexpected,ensurePersistentMediaWorkspace:unexpected},
 editor:{publicationActorScopeRef:scope,currentPostsRef:currentPosts,getDisplayPost:()=>({}),getLiveInstagramHashtags:()=>[],xHashtagsInput:'',ctaDefaults:null,setImgError:noop,setDuplicateFeedback:noop,
 setPostsByChannel:value=>{window.commits.push({account:scope.current.accountId,value});setPosts(value)},setIdea,setPublicationInstruction:noop,setXHashtagsInput:noop,setContentAdjustmentSession:noop,setDocumentFiles:noop,setPdfAttachmentError:noop,pdfInputRef:{current:null},setContentWorkspaceOpen:noop,setSynchronizedActiveChannel:noop,scrollToContentWorkspace:noop}
 })});
 window.state=()=>({busy:generation.generating,error:generation.genError,notice:generation.generationNotice,progress:generation.generationProgress,account,posts});
 return jsx('div',null,jsx('button',{onClick:()=>void generation.onGenerate()},'Generate'),jsx('button',{onClick:()=>setIdea('New project')},'Set subject'),jsx('button',{onClick:()=>{scope.current={actorUserId:'actor-b',accountId:'account-b'};window.activeAccount='account-b';setAccount('account-b')}},'Switch account'));
}
window.root=require('react-dom/client').createRoot(document.getElementById('root'));window.root.render(jsx(Fixture));
`;
new Script(fixture);

test("the real generation controller guards double clicks and drops a result after the account changes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: fixture });
    await page.waitForFunction("document.querySelector('button') || window.fixtureErrors.length");
    assert.deepEqual(await page.evaluate("window.fixtureErrors"), []);
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    assert.equal(await page.evaluate("window.calls.length"), 0);
    assert.equal(await page.evaluate("window.state().error"), "ecrivez_une_phrase_ex_chantier_termine_b7125e40");
    await page.getByRole("button", { name: "Set subject", exact: true }).click();
    await page.getByRole("button", { name: "Generate", exact: true }).dblclick();
    await page.waitForFunction("window.calls.length === 1 || window.state().error");
    assert.equal(await page.evaluate("window.state().error"), "");
    assert.equal(await page.evaluate("window.state().busy"), true);
    assert.equal(await page.evaluate("window.startedIds"), 1);
    await page.getByRole("button", { name: "Switch account", exact: true }).click();
    await page.evaluate("window.resolveGeneration()");
    await page.waitForFunction("window.state().busy === false");
    assert.equal(await page.evaluate("window.commits.length"), 0);
    assert.deepEqual(await page.evaluate("window.state().posts"), {});
    assert.equal(await page.evaluate("window.state().progress"), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("a lost generation response recovers the same operation without another request and commits its result once", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: fixture });
    await page.waitForFunction("document.querySelector('button') || window.fixtureErrors.length");
    assert.deepEqual(await page.evaluate("window.fixtureErrors"), []);
    await page.evaluate("window.transportLoss=true");
    await page.getByRole("button", { name: "Set subject", exact: true }).click();
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await page.waitForFunction("window.commits.length === 1 && !window.state().busy || window.state().error");
    assert.equal(await page.evaluate("window.state().error"), "");
    const result = await page.evaluate<{ calls: { payload: { generationRequestId: string } }[]; recoveries: { requestId: string; workspaceId: string }[]; reports: { recovered: boolean }[]; commits: { account: string }[]; state: { posts: { facebook: { title: string } }; progress: number } }>("({calls:window.calls,recoveries:window.recoveries,reports:window.reports,commits:window.commits,state:window.state()})");
    assert.equal(result.calls.length, 1);
    assert.equal(result.recoveries.length, 1);
    assert.equal(result.recoveries[0].requestId, result.calls[0].payload.generationRequestId);
    assert.equal(result.recoveries[0].workspaceId, "workspace-a");
    assert.equal(result.reports[0].recovered, true);
    assert.equal(result.commits[0].account, "account-a");
    assert.equal(result.state.posts.facebook.title, "Recovered");
    assert.equal(result.state.progress, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
