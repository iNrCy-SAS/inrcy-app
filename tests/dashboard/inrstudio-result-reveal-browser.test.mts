import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const modules = {
  react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"),
  workspace: compile(read("app/dashboard/_components/MediaGenerationCreationWorkspace.tsx")),
  "./MediaResultViewer": compile(read("app/dashboard/_components/MediaResultViewer.tsx")),
  "@/app/dashboard/_hooks/useMediaResultReveal": compile(read("app/dashboard/_hooks/useMediaResultReveal.ts")),
};
const fixture = `
const sources=${JSON.stringify(modules)},loaded={},messages=${JSON.stringify(JSON.parse(read("messages/fr-FR/media.json")))};
window.activeAccount='account-a';window.revealCalls=[];
const originalScroll=Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView=function(options){if(this.hasAttribute('data-media-review'))window.revealCalls.push(options);return originalScroll.call(this,options)};
function require(name){
 if(loaded[name])return loaded[name].exports;
 if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=>window.activeAccount};
 if(name==='@/lib/multicompte/constants')return {ACTIVE_INRCY_ACCOUNT_EVENT:'fixture-account-change'};
 if(name==='next-intl')return {useTranslations:()=>key=>messages[key]||key};
 if(name==='next/image')return {__esModule:true,default:({fill,unoptimized,...props})=>React.createElement('img',props)};
 if(name==='@/lib/aiMediaGenerationContracts')return {resolveAiMediaPreviewFormat:({fallback})=>fallback};
 if(name==='@/lib/aiMediaModelCatalog')return {AI_MEDIA_VIDEO_MODELS:[]};
 if(name==='./MediaEngineCreditControls')return {MediaGenerationActions:({children})=>React.createElement('div',null,children)};
 if(name==='./DashboardMobileSelect')return {__esModule:true,default:()=>null};
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>(name.includes('ResultViewer')?'viewer-':name.includes('CreationWorkspace')?'editor-':'generator-')+String(key)})};
 if(!sources[name])throw Error('Unexpected Studio fixture dependency '+name);
 const record=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,record,record.exports);return record.exports;
}
const React=require('react'),Workspace=require('workspace').default;
const preview='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#395abc"/><text x="70" y="300" fill="white" font-size="60">Résultat prêt</text></svg>');
const base={accountId:'account-a',variant:'embedded',creationStarted:true,generationInProgress:false,kind:'image',format:'square',durationSeconds:8,progress:0,operationLocked:false,finishing:false,generationResult:null,generationCancellable:false,cancelConfirmationOpen:false,setCancelConfirmationOpen(){},handleRequestGenerationStop(){},handleConfirmGenerationStop(){},handleConfirm(){},handleGenerate(){},handleEditCriteria(){},disabled:false,acceptMode:'library'};
function Fixture(){
 const [state,setState]=React.useState(base);
 window.studioFixture={
  start(kind='image'){setState(current=>({...current,kind:kind==='modify'?'image':kind,generationResult:null,generationInProgress:true,operationLocked:true,progress:25,origin:kind==='modify'?'modify':'studio'}))},
  progress(){setState(current=>({...current,progress:75}))},
  complete(kind='image',id='result-1',account='account-a'){setState(current=>({...current,generationInProgress:false,operationLocked:false,generationResult:{item:{id,media_type:kind==='video'?'video':'image',title:'Résultat',width:600,height:600,signed_url:kind==='video'?'':preview},format:'square',quota:{accountId:account},draft:true,videoEngineResult:null}}))},
  save(){setState(current=>({...current,generationResult:{...current.generationResult,draft:false,item:{...current.generationResult.item,signed_url:preview+'#renewed'}}}))},
  switchAccount(account){window.activeAccount=account;setState(current=>({...current,accountId:account,generationInProgress:false,generationResult:null}))},
  reset(){setState(base);window.activeAccount='account-a';window.revealCalls=[]},
 };
 return React.createElement('div',{className:'modal-layer'},React.createElement('section',{className:'modal-dialog',role:'dialog','aria-label':'iNrStudio','data-inrcy-tool-dialog':true},
  React.createElement('header',{className:'modal-header'},React.createElement('div',null,React.createElement('h1',null,'iNrStudio'),React.createElement('small',null,'Test automatisé · résultat simulé'))),
  React.createElement('div',{className:'modal-body'},
  React.createElement('div',{style:{height:600}},'Paramètres du média'),
  React.createElement('div',{className:'editor-previewPane',style:{height:500}},React.createElement(Workspace,state)),
  React.createElement('div',{style:{height:650}},'Consignes et options'),
  React.createElement('button',{id:'bottom',onClick:()=>window.studioFixture.start()},'Générer'),
  React.createElement('div',{style:{height:50}}))));
}
require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const prefix = (text: string, name: string) => text.replace(/\.([a-zA-Z_][\w-]*)/g, `.${name}-$1`);
const css = prefix(read("app/dashboard/_components/MediaGeneratorModal.module.css"), "modal") + prefix(read("app/dashboard/_components/MediaGenerator.module.css"), "generator") + prefix(read("app/dashboard/_components/MediaGenerationCreationWorkspace.module.css"), "editor") + prefix(read("app/dashboard/_components/MediaResultViewer.module.css"), "viewer");
const html = `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#08122d;color:white;font:14px Arial}${css}</style></head><body><div id="root"></div><dialog id="other"><input aria-label="Autre dialogue"></dialog></body></html>`;
type FixtureWindow = Window & { studioFixture: { start(kind?: string): void; progress(): void; complete(kind?: string, id?: string, account?: string): void; save(): void; switchAccount(account: string): void; reset(): void }; revealCalls: ScrollIntoViewOptions[]; activeAccount: string };

const nativeSources = {
  ...modules,
  studio: compile(read("app/dashboard/generer-media/MediaGeneratorStudioClient.tsx")),
  "@/app/dashboard/_components/MediaGeneratorModal": compile(read("app/dashboard/_components/MediaGeneratorModal.tsx")),
  "./MediaFreeGenerator": compile(read("app/dashboard/_components/MediaFreeGenerator.tsx")),
  "./MediaModifier": compile(read("app/dashboard/_components/MediaModifier.tsx")),
  "./MediaGenerationCreationWorkspace": modules.workspace,
  "./DashboardMobileSelect": compile(read("app/dashboard/_components/DashboardMobileSelect.tsx")),
  ...Object.fromEntries(["aiMediaModelCatalog", "aiMediaGenerationContracts", "aiMediaVideoTimeline", "aiMediaVideoClientOptions", "aiMediaNarrationVoices", "mediaRules", "inrStudioModalPolicy", "aiMediaCharacterVoiceClient", "aiMediaCharacterVoices"].map(name => ["@/lib/" + name, compile(read("lib/" + name + ".ts"))])),
};
const nativeFixture = `
const sources=${JSON.stringify(nativeSources)},loaded={},messages=${JSON.stringify(JSON.parse(read("messages/fr-FR/media.json")))};
window.activeAccount='account-a';window.revealCalls=[];window.networkCalls=0;
const noOp=()=>{},originalScroll=Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView=function(options){if(this.hasAttribute('data-media-review'))window.revealCalls.push(options);return originalScroll.call(this,options)};
const preview='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#395abc"/><text x="70" y="300" fill="white" font-size="60">Résultat prêt</text><text x="65" y="370" fill="white" font-size="25">Test automatisé · média simulé</text></svg>');
const preference={imageEngine:'openai',videoEngine:'omni',videoResolution:'720p',update:noOp};
const hookBase={quota:{accountId:'account-a',creditsReady:true,credits:{remaining:697},videoMaxDurationSeconds:30},quotaLoading:false,busy:false,progress:0,result:null,status:'idle',canRecover:false,loadQuota:noOp,reset:noOp,generate(){throw Error('No paid generation allowed')},acceptDraft:async result=>result};
function useGeneration(){
 const [state,setState]=React.useState(hookBase);
 React.useLayoutEffect(()=>{
 window.studioFixture={
  start(){setState(current=>({...current,busy:true,progress:25,result:null}))},
  progress(){setState(current=>({...current,progress:75}))},
  complete(kind='image'){setState(current=>({...current,busy:false,result:{kind,format:'square',quota:hookBase.quota,draft:true,item:{id:'fixture-result',media_type:kind==='video'?'video':'image',title:'Résultat simulé',width:600,height:600,signed_url:kind==='video'?window.fixtureVideoUrl:preview}}}))},
  save(){setState(current=>({...current,result:{...current.result,draft:false}}))},
  switchAccount(account){window.activeAccount=account;window.dispatchEvent(new Event('fixture-account-change'));setState({...hookBase,quota:{...hookBase.quota,accountId:account}})},
 };
 },[setState]);
 return state;
}
function require(name){
 if(name.endsWith('.css')){const prefix=name.includes('MobileSelect')?'select-':name.includes('Modal')?'modal-':name.includes('CreationWorkspace')?'editor-':name.includes('ResultViewer')?'viewer-':name.includes('FreeGenerator')?'free-':name.includes('Modifier')?'modifier-':name.includes('Studio')?'studio-':'generator-';return {__esModule:true,default:new Proxy({},{get:(_,key)=>prefix+String(key)})};}
 if(name.startsWith('./')&&sources['@/lib/'+name.slice(2).replace(/\\.ts$/,'')])return require('@/lib/'+name.slice(2).replace(/\\.ts$/,''));
 if(name==='next-intl')return {useLocale:()=> 'fr-FR',useTranslations:()=> (key,values={})=>String(messages[key]||key).replace(/\\{(\\w+)\\}/g,(_,name)=>String(values[name]??name))};
 if(name==='next/image')return {__esModule:true,default:({fill,unoptimized,...props})=>React.createElement('img',props)};
 if(name==='next/navigation')return {useRouter:()=>({replace:noOp,push:noOp})};
 if(name==='@/app/dashboard/_components/DashboardViewerAccessProvider')return {useDashboardViewerAccess:()=>({actorUserId:'actor-a',activeAccountId:window.activeAccount})};
 if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=>window.activeAccount};
 if(name==='@/lib/multicompte/constants')return {ACTIVE_INRCY_ACCOUNT_EVENT:'fixture-account-change'};
 if(name==='@/lib/inrStudioNavigation')return {readInrStudioHandoff:()=>null,getInrStudioOriginLabel:()=>null};
 if(name==='@/lib/inrAssistantStudioHandoff')return {INR_ASSISTANT_STUDIO_DRAFT_EVENT:'fixture-draft',readInrAssistantStudioDraft:()=>null};
 if(name==='@/app/dashboard/_hooks/useMediaGeneration')return {__esModule:true,default:useGeneration,discardMediaGenerationDraft:async()=>{},MediaGenerationAccountChangedError:Error,MediaGenerationCancelledError:Error};
 if(name==='../_hooks/useMediaEnginePreference')return {__esModule:true,default:()=>preference};
 if(name==='../_hooks/useMediaCreditQuote')return {__esModule:true,default:()=>({ready:true,insufficient:false,quote:{totalCredits:7},authorization:{}})};
 if(name==='./MediaEngineCreditControls')return {__esModule:true,default:()=>null,isMediaVideoReferenceCompatible:()=>true,MediaCreditQuoteSummary:()=>null,MediaRecoveredCreditSummary:()=>null,MediaGenerationActions:props=>props.children};
 if(name==='@/lib/aiMediaModelRecommendation')return {recommendAiMediaModel:()=>null};
 if(name==='./MediaGenerator')return {prepareMediaGenerationImageReference:async()=>{throw Error('No reference preparation expected')}};
 if(['next/link','./DashboardAssistantTrigger','./MediaRetoucher','./MediaVideoRetoucher','./MediaLibraryPickerModal','@/app/dashboard/_components/MediaLibraryPickerModal','./MediaSubjectVoiceButton','./MediaPromptHelp','./MediaQuotaSummary','./MediaCharacterVoiceInput'].includes(name))return {__esModule:true,default:()=>null};
 if(['@/lib/imageOverlay','@/lib/imageInteractions','@/lib/mediaLibraryUploadClient','@/lib/mediaRetoucherRenderClient','@/lib/boosterVideoTransformClient','@/app/dashboard/booster/publier/publishModal.shared','@/lib/mediaGenerationReferenceClient','@/lib/mediaImageEditMasterClient'].includes(name))return {};
 if(loaded[name])return loaded[name].exports;
 if(!sources[name])throw Error('Unexpected native Studio fixture dependency '+name);
 const record=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,record,record.exports);return record.exports;
}
window.fetch=async()=>{window.networkCalls++;throw Error('No API request allowed')};
const React=require('react');
require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(require('studio').default));
`;
const nativeCss = css + prefix(read("app/dashboard/_components/MediaFreeGenerator.module.css"), "free") + prefix(read("app/dashboard/_components/MediaModifier.module.css"), "modifier") + prefix(read("app/dashboard/generer-media/mediaGeneratorStudio.module.css"), "studio") + prefix(read("app/dashboard/_components/DashboardMobileSelect.module.css"), "select");
async function mountNative(page: Page, kind: string) {
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#08122d;color:white;font:14px Arial}${nativeCss}</style></head><body><div id="root"></div></body></html>` }) : route.abort());
  await page.goto(`https://fixture.invalid/dashboard/generer-media${kind === "modify" ? "?studio_tab=modify" : ""}`);
  await page.addScriptTag({ content: nativeFixture });
  await page.locator('[data-inrcy-tool-dialog]').waitFor();
  if (kind === "video") await page.getByRole("radio", { name: "Vidéo", exact: true }).click();
  await page.locator(kind === "modify" ? '.modifier-workspace' : `.free-workspace[data-media-kind="${kind}"]`).waitFor();
  assert.deepEqual(errors, []); return errors;
}
async function swipe(page: Page, fromY: number, toY: number) {
  const cdp = await page.context().newCDPSession(page);
  const x = page.viewportSize()!.width / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: fromY }] });
  for (let step = 1; step <= 12; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: fromY + (toY - fromY) * step / 12 }] });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(180); await cdp.detach();
}

test("native Studio image/video/Modifier remain touch scrollable after completion, save and expanded preview", async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const kind of ["image", "video", "modify"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
      const errors = await mountNative(page, kind);
      await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.start());
      await page.locator('[data-media-creation-stage="progress"]').waitFor();
      const scroller = page.locator('.modal-body');
      await scroller.evaluate(element => element.scrollTop = element.scrollHeight);
      const bottomBefore = await scroller.evaluate(element => element.scrollTop);
      assert.ok(bottomBefore > 100, "The native responsive form must have a real scroll range");
      const evidenceDirectory = process.env.INRCY_STUDIO_RESULT_EVIDENCE_DIR;
      if (kind === 'image' && evidenceDirectory) { mkdirSync(evidenceDirectory, { recursive: true }); await page.screenshot({ path: path.join(evidenceDirectory, 'inrstudio-mobile-avant-resultat-2026-10-28.png') }); }
      if (kind === 'video') await page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 600;
        const context = canvas.getContext('2d')!; context.fillStyle = '#395abc'; context.fillRect(0, 0, 600, 600);
        context.fillStyle = '#fff'; context.font = '40px sans-serif'; context.fillText('Vidéo simulée', 70, 300);
        const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }), chunks: Blob[] = [];
        recorder.ondataavailable = event => chunks.push(event.data);
        const complete = new Promise<Blob>(resolve => { recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); });
        recorder.start();
        for (let frame = 0; frame < 8; frame++) {
          await new Promise(resolve => setTimeout(resolve, 100)); context.fillRect(20 + frame * 40, 500, 30, 30);
        }
        recorder.stop();
        (window as unknown as { fixtureVideoUrl: string }).fixtureVideoUrl = URL.createObjectURL(await complete);
        for (const track of stream.getTracks()) track.stop();
      });
      await page.evaluate(kind => (window as unknown as FixtureWindow).studioFixture.complete(kind), kind);
      await page.locator('[data-media-review]').waitFor();
      await page.waitForTimeout(100);
      if (kind === 'image' && evidenceDirectory) await page.screenshot({ path: path.join(evidenceDirectory, 'inrstudio-mobile-resultat-2026-10-28.png') });
      const before = await scroller.evaluate(element => element.scrollTop);
      const rect = await page.locator('[data-media-preview]').boundingBox(); assert.ok(rect);
      const touchY = Math.max(200, Math.min(650, rect.y + rect.height / 2));
      await swipe(page, touchY, touchY + 150);
      const afterUp = await scroller.evaluate(element => element.scrollTop);
      assert.ok(afterUp < before - 30, `${kind}: touching the result must scroll toward the top (${before} -> ${afterUp})`);
      await swipe(page, 650, 250);
      const afterDown = await scroller.evaluate(element => element.scrollTop);
      assert.ok(afterDown > afterUp + 30, `${kind}: the pro can scroll back down (${afterUp} -> ${afterDown})`);
      await page.evaluate(() => { (window as unknown as FixtureWindow).studioFixture.save(); (window as unknown as FixtureWindow).studioFixture.progress(); });
      await page.waitForTimeout(80);
      assert.equal(await scroller.evaluate(element => element.scrollTop), afterDown, "A save/rerender cannot pin or recenter the pro");
      const eye = page.getByRole('button', { name: 'Agrandir le média' }); await eye.click();
      const enlarged = page.locator('dialog[open]'); await enlarged.waitFor();
      assert.deepEqual(await enlarged.boundingBox(), { x: 0, y: 0, width: 390, height: 844 });
      const returnScroll = await scroller.evaluate(element => element.scrollTop);
      if (kind !== 'video') {
        const canvas = page.locator('[data-media-expanded-canvas]');
        const width = (await canvas.boundingBox())!.width;
        await page.getByRole('button', { name: 'Zoom +', exact: true }).click();
        assert.ok((await canvas.boundingBox())!.width > width * 1.4);
        await swipe(page, 550, 300);
        assert.ok(await page.locator('[data-media-expanded-viewport]').evaluate(element => element.scrollTop) > 30, 'The enlarged image can be panned');
        await page.getByRole('button', { name: 'Zoom 100 %', exact: true }).click();
        assert.equal((await canvas.boundingBox())!.width, width);
      } else {
        assert.equal(await enlarged.locator('video').getAttribute('controls'), '');
        assert.equal(await enlarged.locator('video').getAttribute('autoplay'), null);
        await enlarged.locator('video').evaluate(async element => { const video = element as HTMLVideoElement; await video.play(); });
        assert.equal(await enlarged.locator('video').evaluate(element => (element as HTMLVideoElement).videoWidth), 600);
        await enlarged.getByRole('button', { name: 'Fermer', exact: true }).focus();
        for (let control = 0; control < 2; control++) {
          await page.keyboard.press('Tab');
          assert.equal(await enlarged.locator('video').evaluate(element => element === document.activeElement), true, 'Tab must visit successive native video controls before returning to Close');
        }
      }
      if (kind === 'image' && evidenceDirectory) { mkdirSync(evidenceDirectory, { recursive: true }); await page.screenshot({ path: path.join(evidenceDirectory, 'inrstudio-mobile-apercu-agrandi-2026-10-28.png') }); }
      await enlarged.getByRole('button', { name: 'Fermer', exact: true }).click();
      await enlarged.waitFor({ state: 'detached' });
      assert.equal(await scroller.evaluate(element => element.scrollTop), returnScroll);
      assert.equal(await eye.evaluate(element => element === document.activeElement), true);
      await swipe(page, 400, 650);
      assert.ok(await scroller.evaluate(element => element.scrollTop) < returnScroll - 30, 'Closing the enlarged preview keeps Studio scrollable');
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).revealCalls.length), 1);
      await eye.click(); await enlarged.waitFor();
      await enlarged.getByRole('button', { name: 'Fermer', exact: true }).focus();
      for (let count = 0; count < 7; count++) {
        await page.keyboard.press('Tab');
        assert.equal(await enlarged.evaluate(element => element.contains(document.activeElement)), true, 'Tab stays in the enlarged viewer');
      }
      const beforeEscape = await scroller.evaluate(element => element.scrollTop);
      await page.keyboard.press('Escape'); await enlarged.waitFor({ state: 'detached' });
      assert.equal(await page.locator('[data-inrcy-tool-dialog]').count(), 1, 'Escape closes only the viewer');
      assert.equal(await page.locator('[role="alertdialog"]').count(), 0, 'Escape must not ask to discard the Studio draft');
      assert.equal(await scroller.evaluate(element => element.scrollTop), beforeEscape);
      assert.equal(await eye.evaluate(element => element === document.activeElement), true);
      await eye.click(); await enlarged.waitFor();
      await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.switchAccount('account-b'));
      await enlarged.waitFor({ state: 'detached' });
      assert.equal(await page.locator('[data-media-review]').count(), 0, 'The previous account preview disappears');
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => (window as unknown as Window & { networkCalls: number }).networkCalls), 0);
      t.diagnostic(JSON.stringify({ kind, bottomBefore, before, afterUp, afterDown }));
      await page.close();
    }
  } finally { await browser.close(); }
});

async function mount(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.abort());
  await page.setContent(html); await page.addScriptTag({ content: fixture });
  await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).studioFixture));
  return errors;
}
async function atBottom(page: Page) {
  await page.locator("#bottom").evaluate(element => { element.scrollIntoView({ block: "end", behavior: "instant" }); (element as HTMLButtonElement).focus({ preventScroll: true }); });
  return page.locator(".modal-body").evaluate(element => element.scrollTop);
}
async function readyInView(page: Page) {
  await page.waitForFunction(() => {
    const heading = document.querySelector('[data-media-review-heading] h3');
    const header = document.querySelector('.modal-header');
    if (!heading || !header) return false;
    const bounds = heading.getBoundingClientRect(), top = header.getBoundingClientRect().bottom;
    return bounds.top >= top && bounds.bottom < innerHeight && document.activeElement === heading;
  }, undefined, { timeout: 3000 });
  await page.locator(".modal-body").evaluate(async element => {
    let previous = element.scrollTop, stable = 0;
    for (let frame = 0; frame < 120 && stable < 4; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      stable = Math.abs(element.scrollTop - previous) < 0.1 ? stable + 1 : 0;
      previous = element.scrollTop;
    }
  });
}

test("mobile image, video and modification completion reveals the actual preview below the fixed header once", async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const kind of ["image", "video", "modify"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = await mount(page);
      await page.evaluate(kind => (window as unknown as FixtureWindow).studioFixture.start(kind), kind);
      await page.locator('[data-media-creation-stage="progress"]').waitFor();
      const before = await atBottom(page); assert.ok(before > 500);
      const evidenceDirectory = process.env.INRCY_STUDIO_RESULT_EVIDENCE_DIR;
      if (kind === "image" && evidenceDirectory) {
        mkdirSync(evidenceDirectory, { recursive: true });
        await page.screenshot({ path: path.join(evidenceDirectory, "inrstudio-workspace-avant-resultat-2026-10-28.png") });
      }
      await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.progress());
      assert.equal(await page.locator(".modal-body").evaluate(element => element.scrollTop), before, "progress must not move the pro");
      await page.evaluate(kind => (window as unknown as FixtureWindow).studioFixture.complete(kind), kind);
      await readyInView(page);
      if (kind === "image" && evidenceDirectory) await page.screenshot({ path: path.join(evidenceDirectory, "inrstudio-workspace-resultat-2026-10-28.png") });
      t.diagnostic(JSON.stringify({ kind, before, after: await page.locator(".modal-body").evaluate(element => element.scrollTop), heading: await page.locator("[data-media-review-heading] h3").boundingBox(), preview: await page.locator("[data-media-preview]").boundingBox(), viewport: page.viewportSize() }));
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).revealCalls.length), 1);
      assert.ok(await page.locator("[data-media-preview]").evaluate(element => { const rect = element.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0; }));
      const bottom = await atBottom(page);
      await page.evaluate(() => { (window as unknown as FixtureWindow).studioFixture.save(); (window as unknown as FixtureWindow).studioFixture.progress(); });
      await page.waitForTimeout(80);
      assert.equal(await page.locator(".modal-body").evaluate(element => element.scrollTop), bottom, "saving or refreshing a completed result must not reveal it again");
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).revealCalls.length), 1);
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
});

test("reduced motion is respected and an existing result or another account cannot trigger a reveal", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const errors = await mount(page);
    await atBottom(page);
    await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.complete());
    await page.locator("[data-media-review]").waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).revealCalls.length), 0, "restored results do not steal focus");
    await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.start());
    await page.locator('[data-media-creation-stage="progress"]').waitFor(); await atBottom(page);
    await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.complete("image", "new-result"));
    await readyInView(page);
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).revealCalls[0].behavior), "instant");
    await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.start());
    await page.locator('[data-media-creation-stage="progress"]').waitFor(); await atBottom(page);
    await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.switchAccount("account-b"));
    const previous = await atBottom(page);
    await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.complete("image", "stale-result", "account-a"));
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).revealCalls.length), 1);
    assert.equal(await page.locator(".modal-body").evaluate(element => element.scrollTop), previous);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("desktop and a blocking dialog keep their current scroll and focus when the preview completes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const desktop of [true, false]) {
      const page = await browser.newPage({ viewport: desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 } });
      const errors = await mount(page);
      await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.start());
      await page.locator('[data-media-creation-stage="progress"]').waitFor();
      const previous = await atBottom(page);
      if (!desktop) await page.evaluate(() => document.querySelector<HTMLDialogElement>("#other")!.showModal());
      await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.complete());
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).revealCalls.length), 0);
      assert.equal(await page.locator(".modal-body").evaluate(element => element.scrollTop), previous);
      if (!desktop) assert.equal(await page.locator("#other input").evaluate(element => element === document.activeElement), true);
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
});

test("a browser account switch before the scheduled frame prevents a late result from stealing focus", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = await mount(page);
    await page.evaluate(() => (window as unknown as FixtureWindow).studioFixture.start());
    await page.locator('[data-media-creation-stage="progress"]').waitFor();
    const before = await atBottom(page);
    await page.evaluate(() => {
      const queued = new Map<number, FrameRequestCallback>();
      const originalRequest = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
      let id = 0;
      window.requestAnimationFrame = callback => { queued.set(++id, callback); return id; };
      window.cancelAnimationFrame = frame => { queued.delete(frame); };
      (window as unknown as FixtureWindow & { flushResultFrame: () => number }).flushResultFrame = () => {
        const count = queued.size;
        (window as unknown as FixtureWindow).activeAccount = "account-b";
        window.requestAnimationFrame = originalRequest; window.cancelAnimationFrame = originalCancel;
        for (const callback of queued.values()) callback(performance.now());
        return count;
      };
      (window as unknown as FixtureWindow).studioFixture.complete();
    });
    await page.waitForTimeout(80);
    assert.ok(await page.evaluate(() => (window as unknown as FixtureWindow & { flushResultFrame: () => number }).flushResultFrame()) > 0, "the result reveal must have reached its deferred frame");
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).revealCalls.length), 0);
    assert.equal(await page.locator(".modal-body").evaluate(element => element.scrollTop), before);
    assert.equal(await page.locator("#bottom").evaluate(element => element === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
