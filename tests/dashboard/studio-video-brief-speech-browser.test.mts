import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const taskRoot = path.resolve(repo, "../..");
const read = (file: string) => readFileSync(path.join(repo, file), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const sources: Record<string, string> = {};
for (const [name, file] of [["react", "react.production.js"], ["react/jsx-runtime", "react-jsx-runtime.production.js"], ["react-dom", "react-dom.production.js"], ["react-dom/client", "react-dom-client.production.js"], ["scheduler", "scheduler.production.js"]]) {
  const packageName = name.startsWith("react-dom") ? "react-dom" : name.startsWith("react") ? "react" : name;
  sources[name] = readFileSync(path.join(path.dirname(require.resolve(`${packageName}/package.json`)), "cjs", file), "utf8");
}
const stubNames = new Set(["next-intl", "@/app/dashboard/_hooks/useMediaGeneration", "../_hooks/useMediaGeneration", "../_hooks/useMediaEnginePreference", "../_hooks/useMediaCreditQuote", "../_hooks/useInrAssistantLocalInterface", "@/lib/mediaGenerationReferenceClient", "./MediaLibraryPickerModal", "./MediaSubjectVoiceButton", "./MediaCharacterVoiceInput", "./MediaBusinessDnaHelp", "./MediaQuotaSummary", "./MediaCharacterVoiceLibraryPicker", "./MediaGenerationCreationWorkspace"]);
for (const name of ["next/image", "@/app/dashboard/_hooks/useMediaResultReveal", "@/lib/browserAccountCache", "./MediaResultViewer", "./DashboardMobileSelect"]) stubNames.add(name);
stubNames.add("./VideoCreditRecharge");
function add(file: string) {
  if (sources[file]) return;
  sources[file] = "";
  sources[file] = compile(read(file)).replace(/\brequire\("([^"\n]+)"\)/g, (original, name: string) => {
    if (stubNames.has(name) || sources[name] && !name.startsWith("lib/")) return original;
    if (name.endsWith(".css")) return `require(${JSON.stringify(name)})`;
    const base = name.startsWith("@/") ? name.slice(2) : name.startsWith(".") ? path.posix.join(path.posix.dirname(file), name) : null;
    assert.ok(base, `Unexpected browser dependency ${name}`);
    const resolved = /\.tsx?$/.test(base) ? base : existsSync(path.join(repo, `${base}.ts`)) ? `${base}.ts` : `${base}.tsx`;
    assert.ok(resolved.startsWith("lib/") || resolved.startsWith("app/dashboard/_components/"), resolved);
    add(resolved);
    return `require(${JSON.stringify(resolved)})`;
  });
}
add("app/dashboard/_components/MediaFreeGenerator.tsx");
// The engine selector is a real interactive component; external IO stays mocked.
add("app/dashboard/_components/MediaEngineCreditControls.tsx");
add("app/dashboard/_components/MediaGenerationCreationWorkspace.tsx");
add("app/dashboard/_components/MediaSubjectVoiceButton.tsx");
add("app/dashboard/_components/MediaQuotaSummary.tsx");
add("app/dashboard/_components/MediaBusinessDnaHelp.tsx");
const messages = JSON.parse(read("messages/fr-FR/media.json"));
const catalogs = Object.fromEntries(["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"].map(locale => [locale, JSON.parse(read(`messages/${locale}/media.json`))]));
const boosterCatalogs = Object.fromEntries(Object.keys(catalogs).map(locale => [locale, JSON.parse(read(`messages/${locale}/booster.json`))]));
const fixture = `
const sources=${JSON.stringify(sources)},catalogs=${JSON.stringify(catalogs)},boosterCatalogs=${JSON.stringify(boosterCatalogs)},loaded={};
window.studioRequests=[];window.studioQuotes=[];window.networkCalls=0;window.fixtureLocale='fr-FR';
window.fixtureUseRealWorkspace=false;window.fixtureRecovery={pending:false,checking:false,cancelling:false};window.recoveryOperations={reads:0,pauses:0,cancels:0};
window.fixtureStudioInterfaces={};window.parentEscapes=0;
window.fixtureReferencePreparationEnabled=false;window.referencePreparations=0;
const fixturePngCanvas=document.createElement('canvas');fixturePngCanvas.width=fixturePngCanvas.height=2;
const fixturePngContext=fixturePngCanvas.getContext('2d');fixturePngContext.fillStyle='#4080c0';fixturePngContext.fillRect(0,0,2,2);window.fixtureReferencePng=fixturePngCanvas.toDataURL('image/png').split(',')[1];
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented)window.parentEscapes++});
window.fetch=()=>{window.networkCalls++;throw Error('This local fixture never calls a remote API')};
const noOp=()=>{};
function require(name){
 if(loaded[name])return loaded[name].exports;
 if(name==='next-intl')return {useLocale:()=>window.fixtureLocale,useTranslations:namespace=> (key,values={})=>((namespace==='booster'?boosterCatalogs:catalogs)[window.fixtureLocale][key]||key).replace(/\\{(\\w+)\\}/g,(_,key)=>String(values[key]??'{'+key+'}'))};
 if(name.endsWith('useMediaGeneration'))return {__esModule:true,default:()=>{
  const[,refresh]=React.useState(0);window.refreshRecovery=()=>refresh(value=>value+1);const state=window.fixtureRecovery;
  return {quota:{accountId:'fixture',creditsReady:true,unlimited:true,studioEnabled:true,credits:{remaining:10000},videoMaxDurationSeconds:30},quotaLoading:false,busy:state.checking,progress:79,error:'',result:null,canRecover:state.pending,recovering:state.checking,canPauseRecovery:state.checking&&!state.cancelling,cancellationPending:state.cancelling,recoveryContext:state.pending?{kind:'video',format:'story'}:null,loadQuota:noOp,
   generate:async request=>{window.studioRequests.push(request)},
   retryRecovery:()=>{window.recoveryOperations.reads++;state.checking=true;window.refreshRecovery();return new Promise((resolve,reject)=>{window.rejectRecovery=reject})},
   pauseRecovery:()=>{if(!state.checking||state.cancelling)return false;window.recoveryOperations.pauses++;state.checking=false;state.pending=true;window.refreshRecovery();if(window.rejectRecovery){const error=new Error('Recovery paused');error.name='MediaGenerationRecoveryPausedError';window.rejectRecovery(error);window.rejectRecovery=null}return true},
   cancelRecovery:async()=>{window.recoveryOperations.cancels++},cancelGeneration:()=>{window.recoveryOperations.cancels++;return false}};
 },MediaGenerationAccountChangedError:class extends Error{},MediaGenerationCancelledError:class extends Error{}};
 if(name.endsWith('useMediaEnginePreference'))return {__esModule:true,default:()=>{const[value,setValue]=React.useState({imageEngine:'openai',videoEngine:'wan3',videoResolution:'720p'});return {...value,update:patch=>setValue(current=>({...current,...patch}))}}};
 if(name.endsWith('useMediaCreditQuote'))return {__esModule:true,default:input=>{window.studioQuotes.push(input);return {ready:true,insufficient:false,authorization:{expectedCredits:88,creditQuoteId:'fixture-quote'},quote:{totalCredits:88}}}};
 if(name.endsWith('useInrAssistantLocalInterface'))return {useInrAssistantLocalInterface:(id,snapshot,handlers,enabled,locked)=>{React.useLayoutEffect(()=>{window.fixtureStudioInterfaces[id]={snapshot,handlers,enabled,locked}})}};
 if(name==='@/lib/mediaGenerationReferenceClient')return {async prepareMediaGenerationImageReference(file){if(!window.fixtureReferencePreparationEnabled)throw Error('No uploads allowed');window.referencePreparations++;return {name:file.name,data:window.fixtureReferencePng,mimeType:'image/png'}},prepareMediaGenerationLibraryReferenceFile(){throw Error('No uploads allowed')}};
 if(name==='./MediaGenerationCreationWorkspace')return {__esModule:true,default:props=>window.fixtureUseRealWorkspace?React.createElement(require('app/dashboard/_components/MediaGenerationCreationWorkspace.tsx').default,props):React.createElement('div',{'data-media-creation-stage':true,style:{padding:24}},'Aperçu de votre vidéo'),MediaGenerationSettingsTabs:props=>window.fixtureUseRealWorkspace?React.createElement(require('app/dashboard/_components/MediaGenerationCreationWorkspace.tsx').MediaGenerationSettingsTabs,props):React.createElement('div',{className:'editor-tabs',role:'tablist'},props.tabs.map(tab=>React.createElement('button',{key:tab.id,id:props.idPrefix+'-tab-'+tab.id,role:'tab','aria-selected':props.activeTab===tab.id,onClick:()=>props.onChange(tab.id)},tab.label)))};
 if(name==='next/image')return {__esModule:true,default:props=>React.createElement('img',props)};
 if(name==='@/app/dashboard/_hooks/useMediaResultReveal')return {useMediaResultReveal:()=>({reviewRef:React.useRef(null),headingRef:React.useRef(null)})};
 if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=>null};
 if(name==='./MediaResultViewer')return {__esModule:true,default:()=>null};
 if(name==='./DashboardMobileSelect')return {__esModule:true,default:props=>React.createElement('select',{'aria-label':props.ariaLabel,value:props.value,onChange:event=>props.onChange(event.target.value)},props.options.map(option=>React.createElement('option',{key:option.value,value:option.value},option.label)))};
 if(name==='./MediaSubjectVoiceButton'||name==='./MediaQuotaSummary'||name==='./MediaBusinessDnaHelp')return {__esModule:true,default:require('app/dashboard/_components/'+name.slice(2)+'.tsx').default};
 if(name==='./VideoCreditRecharge')return {MediaCreditRechargeButton:()=>{throw Error('No credit purchase is available in this fixture')}};
 if(name==='./MediaLibraryPickerModal')return {__esModule:true,default:props=>props.open?React.createElement('section',{'data-fixture-library-open':true},React.createElement('button',{type:'button',onClick:props.onClose},'Fermer la médiathèque de test')):null};
 if(name==='./MediaCharacterVoiceInput'||name==='./MediaCharacterVoiceLibraryPicker')return {__esModule:true,default:()=>null};
 if(name.endsWith('.css')){const prefix=name.includes('FreeGenerator')?'free-':name.includes('CreationWorkspace')?'editor-':name.includes('EngineCreditControls')?'engine-':name.includes('PromptHelp')?'help-':name.includes('QuotaSummary')?'quota-':name.includes('MediaGenerator.module')?'gen-':'other-';return {__esModule:true,default:new Proxy({},{get:(_,key)=>prefix+String(key)})};}
 if(name==='app/dashboard/_components/MediaEngineCreditControls.ts')name='app/dashboard/_components/MediaEngineCreditControls.tsx';
 if(!sources[name])throw Error('Missing browser fixture module '+name);
 const record=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,record,record.exports);return record.exports;
}
const React=require('react'),Free=require('app/dashboard/_components/MediaFreeGenerator.tsx').default;
window.fixtureRoot=require('react-dom/client').createRoot(document.getElementById('root'));
window.renderStudio=(prompt='Un jardinier taille une haie. Lumière naturelle, plan rapproché.',kind='video')=>window.fixtureRoot.render(React.createElement(Free,{key:kind+'-'+window.fixtureLocale,source:'studio',acceptMode:'library',mediaType:kind,initialPrompt:prompt,onAccepted:noOp}));
window.renderStudio();
`;
const prefix = (css: string, name: string) => css.replace(/\.([a-zA-Z_][\w-]*)/g, `.${name}-$1`);
const css = prefix(read("app/dashboard/_components/MediaFreeGenerator.module.css"), "free") + prefix(read("app/dashboard/_components/MediaGenerationCreationWorkspace.module.css"), "editor") + prefix(read("app/dashboard/_components/MediaEngineCreditControls.module.css"), "engine") + prefix(read("app/dashboard/_components/MediaGeneratorModal.module.css"), "modal") + prefix(read("app/dashboard/_components/MediaPromptHelp.module.css"), "help") + prefix(read("app/dashboard/_components/MediaGenerator.module.css"), "gen") + prefix(read("app/dashboard/_components/MediaQuotaSummary.module.css"), "quota");
const globalCss = readFileSync(require.resolve("tailwindcss/preflight.css"), "utf8") + read("app/globals.css").replace('@import "tailwindcss";', "");
// Use the real opted-in tool shell attributes and header classes. Its available
// height follows global workspace CSS and actual navigation content, not a test height.
// Tailwind also resets dialog margins; do not rely on the browser's auto margin.
const html = `<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globalCss}</style><style>${css}</style></head><body><div class="modal-layer" data-inrcy-tool-overlay data-disable-pull-refresh="true"><section class="modal-dialog" data-inrcy-tool-dialog data-studio-tab="generate" data-creation-mode="free"><header class="modal-header"><div class="modal-moduleIdentity"><span class="modal-icon" aria-hidden="true">✦</span><div><div class="modal-studioTitleRow"><strong class="modal-studioWordmark"><span>iNrS</span><b>tudio</b></strong></div><p>${messages.ai_generator_made_inrcy_hint}</p></div></div><div class="modal-heading"><nav class="modal-studioTabs"><button type="button" class="modal-studioTab" data-studio-tab="generate" data-active="true">${messages.ai_generator_studio_tab_generate}</button><button type="button" class="modal-studioTab" data-studio-tab="modify" data-active="false">${messages.ai_generator_studio_tab_modify}</button><button type="button" class="modal-studioTab" data-studio-tab="retouch" data-active="false">${messages.ai_generator_studio_tab_retouch}</button></nav><div class="modal-mediaTypeTabs"><button type="button"><span aria-hidden="true">▣</span>${messages.image_50e19fda}</button><button type="button" data-active="true"><span aria-hidden="true">▶</span>${messages.video_304f6ca4}</button></div></div><div class="modal-headerActions"><a class="modal-mediaLibraryLink"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4.75 5.75h14.5v12.5H4.75z"/><path d="m7.25 15 3.15-3.15 2.35 2.35 1.65-1.65 2.35 2.45"/><circle cx="15.5" cy="9" r="1.35"/></svg><span>${messages.mediatheque_e4fa8e31}</span></a><button type="button" class="modal-close"><span>${messages.fermer_5ab4ec64}</span><i aria-hidden="true">×</i></button></div></header><div class="modal-body"><div id="root" class="modal-generationWorkspace"></div></div></section></div><script>${fixture.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;

type LocalInterface = { snapshot: unknown; handlers: Record<string, { invoke(value: string | null): unknown; matches(snapshot: unknown, value: string | null): boolean }>; enabled: boolean; locked: boolean };
type FixtureWindow = Window & { studioRequests: Array<Record<string, unknown>>; networkCalls: number; fixtureLocale: string; renderStudio(prompt?: string, kind?: string): void; fixtureUseRealWorkspace: boolean; fixtureRecovery: { pending: boolean; checking: boolean; cancelling: boolean }; refreshRecovery(): void; recoveryOperations: { reads: number; pauses: number; cancels: number }; fixtureStudioInterfaces: Record<string, LocalInterface>; parentEscapes: number; fixtureReferencePreparationEnabled: boolean; fixtureReferencePng: string; referencePreparations: number };
async function mount(page: Page) {
  mkdirSync(path.join(taskRoot, "outputs"), { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
  await page.goto("https://studio-fixture.test/");
  await page.getByLabel("Consignes visuelles", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  return errors;
}

async function assertFramesRemainUsable(page: Page, context: string) {
  const layout = await page.evaluate(() => {
    const panels = document.querySelector<HTMLElement>(".free-videoSettingsPane .editor-settingsPanels")!;
    const bounds = panels.getBoundingClientRect();
    const targets = ["[data-video-brief-frame]", ".free-spokenScriptSection", 'textarea[id$="-prompt"]', 'textarea[id$="-spoken-script"]', '[id$="-prompt-count"]', '[id$="-spoken-script-count"]'].flatMap(selector => {
      const element = document.querySelector<HTMLElement>(selector);
      return element ? [{ selector, element }] : [];
    });
    targets.push(...Array.from(document.querySelectorAll<HTMLElement>(".free-promptPanel [role=alert]")).map((element, index) => ({ selector: `validation error ${index + 1}`, element })));
    const fields = targets.map(({ selector, element }) => {
      const rect = element.getBoundingClientRect();
      const frameBounds = element.closest("[data-video-brief-frame], .free-spokenScriptSection")?.getBoundingClientRect();
      return { selector, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, frameTop: frameBounds?.top, frameBottom: frameBounds?.bottom };
    });
    const ancestors: HTMLElement[] = [];
    for (let element: HTMLElement | null = panels; element; element = element.parentElement) ancestors.push(element);
    const canScroll = ancestors.some(element => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight);
    return { scrollHeight: panels.scrollHeight, clientHeight: panels.clientHeight, canScroll, top: bounds.top, bottom: bounds.bottom, viewportHeight: innerHeight, fields, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.ok(layout.clientHeight > 0, `${context}: the real editor has usable height`);
  if (layout.scrollHeight > layout.clientHeight + 1 || layout.fields.some(field => field.bottom > layout.viewportHeight)) {
    assert.equal(layout.canScroll, true, `${context}: content below a short window remains reachable through a real scroll container`);
  }
  assert.equal(layout.horizontalOverflow, false, `${context}: no horizontal overflow`);
  for (const field of layout.fields) {
    assert.ok(field.width > (field.selector.includes("-count") ? 20 : 100) && field.height >= (field.selector.startsWith("textarea") ? 60 : 1), `${context}: usable ${field.selector}`);
    if (field.frameTop !== undefined && field.frameBottom !== undefined) assert.ok(field.top >= field.frameTop - 1 && field.bottom <= field.frameBottom + 1, `${context}: content stays within its frame ${JSON.stringify(field)}`);
  }
}

async function videoGeometry(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.evaluate(() => {
    const panels = document.querySelector<HTMLElement>(".free-videoSettingsPane .editor-settingsPanels")!;
    const prompt = document.querySelector<HTMLTextAreaElement>('textarea[id$="-prompt"]')!;
    const section = document.querySelector<HTMLElement>(".free-spokenScriptSection")!;
    const heading = section.querySelector<HTMLElement>(".free-spokenScriptHeading")!;
    const paneBounds = panels.getBoundingClientRect(), promptBounds = prompt.getBoundingClientRect();
    const sectionBounds = section.getBoundingClientRect(), headingBounds = heading.getBoundingClientRect();
    const style = getComputedStyle(prompt);
    return {
      promptHeight: promptBounds.height,
      usableLines: (promptBounds.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight),
      bannerTop: sectionBounds.top - paneBounds.top + panels.scrollTop,
      controlTop: headingBounds.top - paneBounds.top + panels.scrollTop,
      viewportBannerTop: sectionBounds.top,
      scrollTop: panels.scrollTop,
    };
  });
}

function assertSameVideoGeometry(before: Awaited<ReturnType<typeof videoGeometry>>, after: Awaited<ReturnType<typeof videoGeometry>>, context: string, viewportStable = false) {
  assert.ok(before.usableLines >= 6 && before.usableLines <= 10, `${context}: the real prompt provides roughly eight readable lines (${before.usableLines})`);
  for (const key of ["promptHeight", "bannerTop", "controlTop"] as const) {
    assert.ok(Math.abs(after[key] - before[key]) <= 1, `${context}: ${key} stays constant, ${JSON.stringify({ before, after })}`);
  }
  if (viewportStable) assert.ok(Math.abs(after.viewportBannerTop - before.viewportBannerTop) <= 1, `${context}: switching modes does not move the visible speech banner`);
}

async function assertSpeechHeaderCompact(page: Page, context: string) {
  const layout = await page.locator(".free-spokenScriptSection").evaluate(section => {
    const label = section.querySelector(".free-videoFrameHeading label")!;
    const range = document.createRange(); range.selectNodeContents(label);
    const titleLines = Array.from(range.getClientRects()).filter(rect => rect.width > 0).length;
    const row = section.querySelector<HTMLElement>(".free-spokenScriptHeading")!;
    const rowBounds = row.getBoundingClientRect();
    const controls = Array.from(row.querySelectorAll<HTMLElement>("button,select")).map(element => ({
      height: element.getBoundingClientRect().height,
      fits: element.scrollWidth <= element.clientWidth + 1,
    }));
    return { titleLines, rowHeight: rowBounds.height, controls };
  });
  assert.ok(layout.titleLines >= 1 && layout.titleLines <= 2, `${context}: the sound and speech title remains compact`);
  assert.ok(layout.controls.length >= 1 && layout.controls.length <= 2, `${context}: only audio and Auto/Exact controls appear in the compact row`);
  assert.ok(layout.rowHeight <= 2 * Math.max(...layout.controls.map(control => control.height)) + 10, `${context}: commands occupy at most two compact rows`);
  assert.equal(layout.controls.every(control => control.fits), true, `${context}: speech controls are not clipped`);
}

async function assertFramesNeverOverlap(page: Page, context: string) {
  const layout = await page.evaluate(() => {
    const visual = document.querySelector<HTMLElement>("[data-video-brief-frame]")!;
    const speech = document.querySelector<HTMLElement>(".free-spokenScriptSection")!;
    const rect = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, height: bounds.height };
    };
    const content = [visual, speech].map(frame => ({
      frame: rect(frame),
      fields: Array.from(frame.querySelectorAll<HTMLElement>("textarea,[role=alert],[aria-live=polite]")).map(rect),
    }));
    return { content, visual: rect(visual), speech: rect(speech), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.ok(layout.visual.bottom < layout.speech.top, `${context}: visual and speech frames remain separated`);
  for (const { frame, fields } of layout.content) for (const field of fields) {
    assert.ok(field.top >= frame.top && field.bottom <= frame.bottom + 1, `${context}: editor content stays inside its own frame ${JSON.stringify({ frame, field })}`);
  }
  assert.equal(layout.overflow, false, `${context}: no horizontal overflow`);
}

async function assertUsualDesktopPanelNeedsNoScroll(page: Page, context: string) {
  const layout = await page.locator('.free-videoSettingsPane .editor-settingsPanels').evaluate(panels => {
    const viewport = panels.getBoundingClientRect();
    const fields = Array.from(panels.querySelectorAll<HTMLElement>('textarea,[data-media-tools],.free-spokenScriptSection')).map(field => {
      const bounds = field.getBoundingClientRect();
      return { id: field.id || field.className, top: bounds.top, bottom: bounds.bottom };
    });
    const height = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().height;
    return { top: viewport.top, bottom: viewport.bottom, scrollTop: panels.scrollTop, clientHeight: panels.clientHeight, scrollHeight: panels.scrollHeight, footerHeight: height('[data-media-footer]'), briefHeight: height('[data-video-brief-frame]'), toolbarHeight: height('.free-promptToolbar'), helpHeight: height('[data-media-prompt-help]'), microphoneHeight: height('.gen-voiceInlineControl button'), speechHeight: height('.free-spokenScriptSection'), fields };
  });
  assert.ok(layout.scrollHeight <= layout.clientHeight + 1, `${context}: the usual desktop editor fits without an internal scroll ${JSON.stringify(layout)}`);
  for (const field of layout.fields) assert.ok(field.top >= layout.top - 1 && field.bottom <= layout.bottom + 1, `${context}: every normal input and its settings remain visible ${JSON.stringify({ field, layout })}`);
  return layout;
}

async function fillCommittedStudioText(page: Page, field: "prompt" | "spokenScript", value: string) {
  await page.locator(`textarea[id$="-${field === "prompt" ? "prompt" : "spoken-script"}"]`).fill(value);
  await page.waitForFunction(({ field, value }) => ((window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_form.snapshot as Record<string, unknown>)[field] === value, { field, value });
}

async function assertToolbarFeedbackVisible(page: Page, selector: string, context: string) {
  const feedback = page.locator(selector);
  assert.equal(await feedback.isVisible(), true, `${context}: feedback is actually visible`);
  assert.equal(await feedback.evaluate(element => {
    const rect = element.getBoundingClientRect(), toolbar = element.closest('.free-promptToolbar')!.getBoundingClientRect();
    return rect.top >= toolbar.top - 1 && rect.bottom <= toolbar.bottom + 1 && rect.left >= toolbar.left - 1 && rect.right <= toolbar.right + 1 && element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
  }), true, `${context}: complete feedback fits beside the real microphone without clipping`);
}

test("fixed visual prompts retain the speech banner position across Auto and Exact while both frames remain usable", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1707, height: 842 }, { width: 1707, height: 898 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      const errors = await mount(page);
      await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.fixtureReferencePreparationEnabled = true; fixture.fixtureUseRealWorkspace = true; fixture.refreshRecovery(); });
      const visual = page.getByLabel("Consignes visuelles", { exact: true });
      const speech = page.locator('textarea[id$="-spoken-script"]');
      const mode = page.locator('select[id$="-spoken-script-mode"]');
      const referencePng = await page.evaluate(() => (window as unknown as FixtureWindow).fixtureReferencePng);
      let lastAutomaticGeometry!: Awaited<ReturnType<typeof videoGeometry>>;
      for (let referenceCount = 0; referenceCount <= 5; referenceCount++) {
        if (referenceCount) {
          const role = ["character", "environment", "product", "inspiration", "inspiration"][referenceCount - 1];
          await page.locator(`[data-media-role-add="${role}"]`).click();
          const dialog = page.locator('[data-media-settings-dialog="images"]');
          await dialog.locator('input[type="file"]').setInputFiles({ name: `local-reference-${referenceCount}.png`, mimeType: "image/png", buffer: Buffer.from(referencePng, "base64") });
          await dialog.waitFor({ state: "detached" });
          await page.waitForFunction(count => document.querySelectorAll('[data-media-reference-open]').length === count, referenceCount);
          assert.equal(await page.locator('[data-media-final-authorization]').count(), 1, "a required person reproduces the real permission footer");
        }
        let baseline: Awaited<ReturnType<typeof videoGeometry>> | undefined;
        for (const length of [0, 500, 501]) {
          const context = `${viewport.width}x${viewport.height} ${referenceCount} references ${length} characters`;
          await mode.selectOption("automatic");
          await fillCommittedStudioText(page, "prompt", "x".repeat(length));
          assert.equal(await speech.count(), 0);
          const automatic = await videoGeometry(page); baseline ??= automatic;
          assertSameVideoGeometry(baseline, automatic, `${context} automatic feedback`);
          await assertUsualDesktopPanelNeedsNoScroll(page, `${context} automatic`);
          if (length === 501) await assertToolbarFeedbackVisible(page, '[id$="-visual-brief-error"][role="alert"]', context);
          await mode.selectOption("exact");
          for (const script of ["", "Bonjour, nous prenons soin de votre jardin."]) {
            await fillCommittedStudioText(page, "spokenScript", script);
            assertSameVideoGeometry(baseline, await videoGeometry(page), `${context} Exact ${script ? "short speech" : "empty"}`, viewport.width === 1707);
            await assertFramesRemainUsable(page, context);
            await assertSpeechHeaderCompact(page, context);
            const layout = await assertUsualDesktopPanelNeedsNoScroll(page, `${context} Exact ${script ? "short speech" : "empty"}`);
            if (referenceCount <= 1 && length === 0 && !script) console.info("studio-layout", JSON.stringify({ viewport, referenceCount, clientHeight: layout.clientHeight, scrollHeight: layout.scrollHeight, footer: layout.footerHeight, brief: layout.briefHeight, toolbar: layout.toolbarHeight, help: layout.helpHeight, microphone: layout.microphoneHeight, speech: layout.speechHeight }));
            if (referenceCount === 1 && length === 500 && !script) await page.screenshot({ path: path.join(taskRoot, `outputs/studio-exact-empty-one-photo-${viewport.width}x${viewport.height}.png`) });
          }
          if (length === 501) assert.equal(await page.locator('[data-media-primary-action]').isDisabled(), true);
          await mode.selectOption("automatic");
          assertSameVideoGeometry(baseline, await videoGeometry(page), `${context} automatic again`);
          lastAutomaticGeometry = automatic;
        }
        if (referenceCount === 1) {
          const context = `${viewport.width}x${viewport.height} 1 reference longest oral guidance`;
          await fillCommittedStudioText(page, "prompt", 'Le personnage dit : «Bonjour, notre atelier vous accueille.»');
          await assertToolbarFeedbackVisible(page, '[id$="-visual-brief-error"][role="alert"]', context);
          assertSameVideoGeometry(baseline!, await videoGeometry(page), `${context} automatic`);
          await assertUsualDesktopPanelNeedsNoScroll(page, context);
          await mode.selectOption("exact"); await fillCommittedStudioText(page, "spokenScript", "");
          await assertToolbarFeedbackVisible(page, '.free-videoBriefFeedback > .free-promptHelp', context);
          assertSameVideoGeometry(baseline!, await videoGeometry(page), `${context} explicit empty speech`);
          await assertUsualDesktopPanelNeedsNoScroll(page, context);
          await mode.selectOption("automatic");
        }
      }
      // Historical and over-budget drafts stay fully editable; counters and
      // errors remain available while long values scroll inside the inputs.
      await mode.selectOption("exact");
      await fillCommittedStudioText(page, "prompt", "x".repeat(501));
      await fillCommittedStudioText(page, "spokenScript", "mot ".repeat(1000));
      assert.equal(await visual.inputValue(), "x".repeat(501));
      assert.equal(await speech.inputValue(), "mot ".repeat(1000));
      assert.equal(await page.locator("[data-media-primary-action]").isDisabled(), true);
      await assertFramesRemainUsable(page, `${viewport.width}x${viewport.height} long draft errors`);
      assertSameVideoGeometry(lastAutomaticGeometry, await videoGeometry(page), `${viewport.width}x${viewport.height} long draft feedback`);
      await page.locator("[data-media-prompt-help]").click();
      await page.getByRole("dialog").waitFor();
      await page.getByText(messages.ai_generator_video_visual_brief_hint, { exact: true }).waitFor();
      await page.getByText(messages.ai_generator_video_speech_frame_hint, { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await speech.inputValue(), "mot ".repeat(1000));
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).referencePreparations), 5);
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).studioRequests.length), 0);
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).networkCalls), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("compact video instructions fit all nine locales and retain the image text allowance", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = await mount(page);
    for (const locale of Object.keys(catalogs)) {
      await page.evaluate(locale => { (window as unknown as FixtureWindow).fixtureLocale = locale; (window as unknown as FixtureWindow).renderStudio(); }, locale);
      await page.getByLabel(catalogs[locale].ai_generator_video_visual_brief_title, { exact: true }).waitFor();
      await assertFramesRemainUsable(page, locale);
      await assertSpeechHeaderCompact(page, locale);
      assert.equal(await page.locator('[id$="-prompt-count"]').getAttribute("aria-live"), "polite");
      assert.equal(await page.locator('textarea[id$="-spoken-script"]').count(), 0);
      await page.locator('select[id$="-spoken-script-mode"]').selectOption("exact");
      await assertFramesRemainUsable(page, `${locale} exact`);
      assert.equal(await page.locator('[id$="-spoken-script-count"]').getAttribute("aria-live"), "polite");
    }
    await page.evaluate(() => { (window as unknown as FixtureWindow).fixtureLocale = "fr-FR"; (window as unknown as FixtureWindow).renderStudio("x".repeat(3900), "image"); });
    const imagePrompt = page.locator('textarea[id$="-prompt"]');
    await imagePrompt.waitFor();
    assert.equal(await imagePrompt.inputValue(), "x".repeat(3900));
    assert.equal(await imagePrompt.getAttribute("maxlength"), "4000");
    await page.getByText(messages.ai_generator_free_prompt_help, { exact: true }).waitFor();
    assert.equal(await page.locator("[data-video-brief-frame]").count(), 0);
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).networkCalls), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("the compact Image panel retains 4000 characters, four role launchers and real assistant focus without video audio controls", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors = await mount(page);
    await page.evaluate(() => { (window as unknown as FixtureWindow).fixtureUseRealWorkspace = true; });
    for (const viewport of [{ width: 1707, height: 842 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const locale of Object.keys(catalogs)) {
        await page.evaluate(locale => { const fixture = window as unknown as FixtureWindow; fixture.fixtureLocale = locale; fixture.renderStudio("x".repeat(3900), "image"); }, locale);
        await page.waitForFunction(locale => {
          const snapshot = (window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_form?.snapshot as { kind?: string; language?: string } | undefined;
          return snapshot?.kind === "image" && snapshot.language === locale;
        }, locale);
        const prompt = page.locator('textarea[id$="-prompt"]');
        await prompt.waitFor();
        assert.equal(await prompt.inputValue(), "x".repeat(3900));
        assert.equal(await prompt.getAttribute("maxlength"), "4000");
        assert.equal(await page.locator('[role="tablist"]').count(), 0, "Image and Video both have a single settings view");
        assert.equal(await page.locator('[data-video-audio-button],select[id$="-video-speech-mode"],textarea[id$="-spoken-script"]').count(), 0, "Image never gains video audio options");
        const roleLaunchers = page.locator('[data-media-role-add]');
        assert.equal(await roleLaunchers.count(), 4);
        assert.deepEqual(await roleLaunchers.evaluateAll(buttons => buttons.map(button => button.getAttribute("data-media-role-add"))), ["inspiration", "character", "environment", "product"]);
        const format = page.locator('select[id$="-media-format"]');
        await format.selectOption("landscape"); assert.equal(await prompt.isVisible(), true);
        for (const value of ["criteria", "prompt"]) {
          await format.focus();
          const result = await page.evaluate(value => {
            const entry = (window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_form;
            const encoded = JSON.stringify({ field: "activeTab", value });
            const before = entry.handlers.select.matches(entry.snapshot, encoded); entry.handlers.select.invoke(encoded);
            return { before, focused: document.activeElement?.id.endsWith(value === "criteria" ? "-media-tools" : "-prompt") };
          }, value);
          assert.equal(result.before, false); assert.equal(result.focused, true, `${locale}: legacy image navigation performs real native focus`);
          await page.waitForFunction(value => { const entry = (window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_form; return entry.handlers.select.matches(entry.snapshot, JSON.stringify({ field: "activeTab", value })); }, value);
        }
        await page.locator('[data-media-role-add="character"]').click();
        const dialog = page.locator('[data-media-settings-dialog="images"]'); await dialog.waitFor({ state: "visible" });
        assert.equal(await dialog.locator('[data-reference-add-role],select').count(), 0, "adding a character never asks for its role again");
        assert.equal(await page.evaluate(() => ((window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_media_images.snapshot as { pendingReferenceRole?: string }).pendingReferenceRole), "character");
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
        assert.equal(await prompt.inputValue(), "x".repeat(3900)); assert.equal(await format.inputValue(), "landscape");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${locale}: no horizontal overflow`);
        const imageBounds = await prompt.boundingBox(); assert.ok(imageBounds && imageBounds.height >= 180 && imageBounds.height <= 220, `${locale}: image prompt keeps the fixed compact height`);
        if (viewport.width > 760) {
          const bounds = await page.locator('[data-media-tools]').evaluate(element => element.getBoundingClientRect().bottom);
          assert.ok(bounds <= viewport.height, "usual desktop sizes show image tools without scrolling");
        }
      }
    }
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).studioRequests.length), 0);
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).networkCalls), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("the single video panel keeps the prompt visible while native Images/Audio dialogs isolate Escape and preserve drafts", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 900, height: 460 }, { width: 320, height: 640 }]) {
      const page = await browser.newPage({ viewport });
      const errors = await mount(page);
      const visual = page.locator('textarea[id$="-prompt"]');
      const format = page.locator('select[id$="-media-format"]');
      await format.selectOption("landscape");
      assert.equal(await visual.isVisible(), true);
      assert.equal(await page.locator('[role="tablist"]').count(), 0, "video criteria no longer require a hidden second tab");
      await page.locator('select[id$="-spoken-script-mode"]').selectOption("exact");
      const speech = page.locator('textarea[id$="-spoken-script"]');
      await speech.fill("Bonjour, nous prenons soin de votre jardin.");
      const prompt = await visual.inputValue(), script = await speech.inputValue();
      for (const kind of ["images", "audio"] as const) {
        const button = page.locator(`[${kind === "images" ? "data-media-role-add=\"inspiration\"" : "data-video-audio-button"}]`);
        await button.click();
        const dialog = page.locator(`[data-media-settings-dialog="${kind}"]`);
        await dialog.waitFor({ state: "visible" });
        assert.equal(await button.getAttribute("aria-expanded"), "true");
        assert.equal(await dialog.getAttribute("aria-modal"), "true");
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, "native dialog receives focus");
        const bounds = await dialog.boundingBox();
        assert.ok(bounds && bounds.width <= viewport.width && bounds.height <= viewport.height, "real dialog fits within the viewport");
        const side = Math.min(kind === "images" ? 420 : 560, viewport.width - 32, viewport.height - 32);
        assert.equal(await dialog.getAttribute("data-add-mode"), kind === "images" ? "true" : null, "only reference addition uses the compact chooser");
        assert.ok(Math.abs(bounds.width - side) <= 1 && Math.abs(bounds.height - side) <= 1, `${kind} ${viewport.width}x${viewport.height}: actual dialog is square and bounded by both viewport dimensions ${JSON.stringify(bounds)}`);
        assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) <= 1 && Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2) <= 1, `${kind} ${viewport.width}x${viewport.height}: actual dialog is centered despite the production dialog margin reset ${JSON.stringify(bounds)}`);
        const scrollLayout = await dialog.evaluate(element => {
          const header = element.querySelector<HTMLElement>('.free-mediaSettingsDialogHeader')!;
          const body = element.querySelector<HTMLElement>('.free-mediaSettingsDialogBody')!;
          const before = header.getBoundingClientRect().top;
          body.scrollTop = body.scrollHeight;
          return { before, after: header.getBoundingClientRect().top, overflow: getComputedStyle(body).overflowY, bodyHeight: body.clientHeight };
        });
        assert.equal(scrollLayout.before, scrollLayout.after, "scrolling content preserves the close header position");
        assert.equal(scrollLayout.overflow, "auto"); assert.ok(scrollLayout.bodyHeight > 0);
        if (kind === "images") {
          assert.equal(await dialog.locator('select,[data-reference-add-role]').count(), 0, "the clicked icon owns the add role");
          await dialog.locator('input[type="file"]').setInputFiles([]);
          assert.equal(await dialog.isVisible(), true, "cancelling the file picker keeps the chooser open");
          assert.equal(await page.locator('[data-media-reference-open]').count(), 0, "cancelling cannot append a reference");
          assert.equal(await page.evaluate(() => ((window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_media_images.snapshot as { pendingReferenceRole?: string }).pendingReferenceRole), "inspiration");
        }
        if (kind === "audio") await dialog.locator('[data-media-subtitles]').check();
        const parentEscapes = await page.evaluate(() => (window as unknown as FixtureWindow).parentEscapes);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).parentEscapes), parentEscapes, "child Escape cannot reach or close the parent Studio");
        assert.equal(await button.evaluate(element => document.activeElement === element), true, "focus returns to the opening control");
        assert.equal(await visual.inputValue(), prompt); assert.equal(await speech.inputValue(), script);
        assert.equal(await format.inputValue(), "landscape");
      }
      await page.locator('[data-video-audio-button]').click();
      await page.locator('[data-media-settings-dialog="audio"] [data-media-subtitles]').waitFor();
      assert.equal(await page.locator('[data-media-settings-dialog="audio"] [data-media-subtitles]').isChecked(), true, "closing/reopening retains audio settings");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).parentEscapes), 1, "the parent observer is active outside child dialogs");
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).studioRequests.length), 0);
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).networkCalls), 0);
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
});

test("real assistant callbacks focus the mounted video sections including same-value aliases and open the actual library through Images", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = await mount(page);
    for (const field of ["prompt", "criteria", "prompt"]) {
      await page.locator('select[id$="-media-format"]').focus();
      const before = await page.evaluate(value => {
        const entry = (window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_form;
        const encoded = JSON.stringify({ field: "activeTab", value });
        const before = entry.handlers.select.matches(entry.snapshot, encoded);
        entry.handlers.select.invoke(encoded);
        return { before, focused: document.activeElement?.id.endsWith(value === "criteria" ? "-media-tools" : "-prompt") };
      }, field);
      assert.equal(before.before, false, "a matching logical tab alone cannot acknowledge navigation without focus");
      assert.equal(before.focused, true, "the native callback performs real synchronous focus");
      await page.waitForFunction(value => {
        const entry = (window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_form;
        return entry.handlers.select.matches(entry.snapshot, JSON.stringify({ field: "activeTab", value }));
      }, field);
      assert.equal(await page.locator('textarea[id$="-prompt"]').isVisible(), true, "navigation aliases never hide the one-panel prompt");
    }
    for (const kind of ["images", "audio"] as const) {
      const id = kind === "images" ? "studio_media_images" : "studio_video_audio";
      const before = await page.evaluate(id => {
        const entry = (window as unknown as FixtureWindow).fixtureStudioInterfaces[id];
        const before = entry.handlers.open.matches(entry.snapshot, null); entry.handlers.open.invoke(null);
        return { before, enabled: entry.enabled, locked: entry.locked };
      }, id);
      assert.deepEqual(before, { before: false, enabled: true, locked: false });
      await page.locator(`[data-media-settings-dialog="${kind}"]`).waitFor({ state: "visible" });
      assert.equal(await page.evaluate(id => { const entry = (window as unknown as FixtureWindow).fixtureStudioInterfaces[id]; return entry.handlers.open.matches(entry.snapshot, null); }, id), true);
      await page.evaluate(id => (window as unknown as FixtureWindow).fixtureStudioInterfaces[id].handlers.close.invoke(null), id);
      await page.locator(`[data-media-settings-dialog="${kind}"]`).waitFor({ state: "detached" });
    }
    await page.evaluate(() => (window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_library.handlers.open.invoke(null));
    await page.locator('[data-media-settings-dialog="images"]').waitFor({ state: "visible" });
    await page.locator('[data-fixture-library-open]').waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => { const entry = (window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_library; return entry.handlers.open.matches(entry.snapshot, null); }), true);
    const refusedClose = await page.evaluate(() => { try { (window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_media_images.handlers.close.invoke(null); return false; } catch { return true; } });
    assert.equal(refusedClose, true, "the Images parent cannot disappear while its actual library is open");
    await page.evaluate(() => (window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_library.handlers.close.invoke(null));
    await page.locator('[data-fixture-library-open]').waitFor({ state: "detached" });
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).studioRequests.length), 0);
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).networkCalls), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("real fixed geometry survives 0, 500, 501 and whitespace-heavy visual drafts through Auto→Exact→Auto", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1707, height: 842 }, { width: 1068, height: 570 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = await mount(page);
      const visual = page.getByLabel("Consignes visuelles", { exact: true });
      const mode = page.locator('select[id$="-spoken-script-mode"]');
      const speech = page.locator('textarea[id$="-spoken-script"]');
      const generate = page.locator("[data-media-primary-action]");
      await visual.fill("");
      const emptyGeometry = await videoGeometry(page);
      for (const [name, value, valid] of [
        ["empty", "", false],
        ["500 characters", "x".repeat(500), true],
        ["501 characters", "x".repeat(501), false],
        ["500 plus 50 trailing spaces", `${"x".repeat(500)}${" ".repeat(50)}`, false],
        ["500 whitespace characters", " ".repeat(500), false],
        ["500 with outer whitespace", ` ${"x".repeat(498)} `, true],
      ] as const) {
        const context = `${viewport.width}x${viewport.height} ${name}`;
        await visual.fill(value);
        assert.equal(await visual.inputValue(), value, `${context}: visual draft stays intact`);
        assert.match(await page.locator('[id$="-prompt-count"]').innerText(), new RegExp(`^${value.length}\\s*/\\s*500$`));
        assert.equal(await generate.isDisabled(), !valid, `${context}: raw visual limit still gates generation`);
        if (value.length > 500) assert.equal(await page.locator('[id$="-visual-brief-error"][role="alert"]').isVisible(), true, `${context}: the actual active error is visible`);
        assertSameVideoGeometry(emptyGeometry, await videoGeometry(page), `${context} automatic`);
        assert.equal(await speech.count(), 0);
        await mode.selectOption("exact");
        await speech.fill("Bonjour, nous prenons soin de votre jardin.");
        assert.equal(await speech.inputValue(), "Bonjour, nous prenons soin de votre jardin.");
        assert.equal(await generate.isDisabled(), !valid, `${context}: opening speech never bypasses the visual limit`);
        assertSameVideoGeometry(emptyGeometry, await videoGeometry(page), `${context} exact`);
        await assertFramesRemainUsable(page, `${context} exact`);
        await assertFramesNeverOverlap(page, `${context} exact`);
        await mode.selectOption("automatic");
        assert.equal(await speech.count(), 0);
        assert.equal(await visual.inputValue(), value, `${context}: changing speech mode never clears the visual draft`);
        assertSameVideoGeometry(emptyGeometry, await videoGeometry(page), `${context} automatic again`);
      }
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).studioRequests.length), 0);
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).networkCalls), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("short windows keep both video frames separate and the speech header on two rows in every locale", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = await mount(page);
    await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.fixtureUseRealWorkspace = true; fixture.renderStudio(); });
    for (const viewport of [{ width: 1068, height: 570 }, { width: 1068, height: 768 }, { width: 1024, height: 768 }, { width: 900, height: 768 }, { width: 1100, height: 701 }, { width: 1160, height: 701 }, { width: 1366, height: 701 }, { width: 1024, height: 576 }, { width: 900, height: 460 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
      await page.setViewportSize(viewport);
      for (const locale of Object.keys(catalogs)) {
        await page.evaluate(locale => { const fixture = window as unknown as FixtureWindow; fixture.fixtureLocale = locale; fixture.renderStudio(); }, locale);
        await page.locator('select[id$="-spoken-script-mode"]').waitFor();
        const context = `${viewport.width}x${viewport.height} ${locale}`;
        const automaticGeometry = await videoGeometry(page);
        await assertFramesNeverOverlap(page, context);
        await assertSpeechHeaderCompact(page, context);
        const visual = page.locator('textarea[id$="-prompt"]');
        const originalVisual = await visual.inputValue();
        for (const length of [0, 500, 501]) {
          const value = "x".repeat(length);
          await visual.fill(value);
          assert.equal(await visual.inputValue(), value);
          if (length > 500) assert.equal(await page.locator('[id$="-visual-brief-error"][role="alert"]').isVisible(), true);
          assertSameVideoGeometry(automaticGeometry, await videoGeometry(page), `${context} ${length} characters`);
          await assertFramesNeverOverlap(page, `${context} ${length} characters`);
        }
        await visual.fill(originalVisual);
        const speech = page.locator('textarea[id$="-spoken-script"]');
        assert.equal(await speech.count(), 0, `${context}: automatic mode has no editor`);
        await page.getByText(catalogs[locale].ai_generator_video_speech_automatic_hint, { exact: true }).waitFor();
        await page.locator('select[id$="-spoken-script-mode"]').selectOption("exact");
        await speech.fill("Bonjour, nous prenons soin de votre jardin.");
        await assertFramesNeverOverlap(page, `${context} exact`);
        await assertSpeechHeaderCompact(page, `${context} exact`);
        assertSameVideoGeometry(automaticGeometry, await videoGeometry(page), `${context} Auto→Exact`);
        await page.locator('select[id$="-spoken-script-mode"]').selectOption("automatic");
        assert.equal(await speech.count(), 0);
        assertSameVideoGeometry(automaticGeometry, await videoGeometry(page), `${context} Exact→Auto`);
        await page.locator('select[id$="-spoken-script-mode"]').selectOption("exact");
        assert.equal(await speech.inputValue(), "", "returning to exact starts with the explicitly cleared script");
        await page.locator('select[id$="-spoken-script-mode"]').selectOption("automatic");
        await page.locator('select[id$="-video-speech-mode"]').selectOption("silent");
        await assertSpeechHeaderCompact(page, `${context} silent`);
        await assertFramesNeverOverlap(page, `${context} silent`);
        assert.equal(await speech.count(), 0, "silent mode has no inactive speech editor or 0/0 counter");
        assert.equal(await page.locator('[id$="-spoken-script-count"]').count(), 0);
        assert.equal(await page.locator('select[id$="-spoken-script-mode"]').count(), 0);
        await page.locator('select[id$="-video-speech-mode"]').selectOption("voiceover");
        assert.equal(await page.locator('select[id$="-spoken-script-mode"]').isVisible(), true);
      }
      await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.fixtureLocale = "fr-FR"; fixture.renderStudio(); });
      await page.locator('select[id$="-spoken-script-mode"]').waitFor();
      await page.screenshot({ path: path.join(taskRoot, `outputs/studio-paroles-compact-${viewport.width}x${viewport.height}.png`), fullPage: true });
    }
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).networkCalls), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("real recovery card keeps check and pause visible on desktop and mobile while editing stays available and no generation or cancellation is sent", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = await mount(page);
      await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.fixtureUseRealWorkspace = true; fixture.fixtureRecovery.pending = true; fixture.refreshRecovery(); });
      const card = page.locator("[data-media-recovery-panel]");
      await card.waitFor();
      const check = card.locator("[data-media-recovery-check]");
      const pause = card.locator("[data-media-recovery-pause]");
      for (const action of [check, pause]) {
        const bounds = await action.boundingBox();
        assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, "recovery actions are actually visible without searching in the footer");
      }
      await check.click();
      await page.getByRole("heading", { name: messages.ai_generator_recovery_checking, exact: true }).waitFor();
      assert.equal(await pause.isEnabled(), true);
      const visual = page.getByLabel("Consignes visuelles", { exact: true });
      await page.locator('select[id$="-spoken-script-mode"]').selectOption("exact");
      const speech = page.locator('textarea[id$="-spoken-script"]');
      // Exact intentionally focuses speech on the next frame. Let that native
      // focus finish before Playwright fills a different field in two steps.
      await page.waitForFunction(() => document.activeElement === document.querySelector('textarea[id$="-spoken-script"]'));
      assert.equal(await visual.isEditable(), true);
      assert.equal(await speech.isEditable(), true);
      await visual.fill("Un nouveau jardin, en lumière naturelle.");
      assert.equal(await visual.inputValue(), "Un nouveau jardin, en lumière naturelle.");
      await page.waitForFunction(() => ((window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_form.snapshot as { prompt?: string }).prompt === "Un nouveau jardin, en lumière naturelle.");
      await speech.fill("Bonjour, nous prenons soin de votre jardin.");
      assert.equal(await speech.inputValue(), "Bonjour, nous prenons soin de votre jardin.");
      await page.waitForFunction(() => ((window as unknown as FixtureWindow).fixtureStudioInterfaces.studio_free_form.snapshot as { spokenScript?: string }).spokenScript === "Bonjour, nous prenons soin de votre jardin.");
      const engines = page.locator("[data-media-engine-controls]");
      assert.equal(await engines.locator('select[id$="-engine"]').isEnabled(), true);
      assert.equal(await engines.locator('select[id$="-duration"]').isEnabled(), true);
      await pause.click();
      await check.waitFor({ state: "visible" });
      assert.equal(await check.isEnabled(), true);
      assert.equal(await pause.isDisabled(), true);
      assert.equal(await visual.inputValue(), "Un nouveau jardin, en lumière naturelle.");
      assert.equal(await speech.inputValue(), "Bonjour, nous prenons soin de votre jardin.");
      for (const field of [visual, speech]) {
        const cardBounds = await card.boundingBox(), fieldBounds = await field.boundingBox();
        assert.ok(cardBounds && fieldBounds && (cardBounds.y + cardBounds.height <= fieldBounds.y || fieldBounds.y + fieldBounds.height <= cardBounds.y || cardBounds.x + cardBounds.width <= fieldBounds.x || fieldBounds.x + fieldBounds.width <= cardBounds.x), "the recovery card never overlays either editable field");
      }
      const labelsFit = await page.locator("[data-media-footer] button, [data-media-recovery-panel] button").evaluateAll(buttons => buttons.every(button => {
        const element = button as HTMLElement, bounds = element.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(element); const label = range.getBoundingClientRect();
        return element.scrollWidth <= element.clientWidth + 1 && label.left >= bounds.left - 1 && label.right <= bounds.right + 1;
      }));
      assert.equal(labelsFit, true, "footer and central action labels stay inside their own buttons");
      const activity = await page.evaluate(() => ({ operations: (window as unknown as FixtureWindow).recoveryOperations, generated: (window as unknown as FixtureWindow).studioRequests.length, state: (window as unknown as FixtureWindow).fixtureRecovery }));
      assert.deepEqual(activity.operations, { reads: 1, pauses: 1, cancels: 0 });
      assert.equal(activity.generated, 0); assert.equal(activity.state.pending, true);
      assert.equal(await page.getByRole("alert").count(), 0, "pausing is benign, not a technical error");
      await page.locator(".modal-body").evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: path.join(taskRoot, `outputs/studio-recovery-pause-${viewport.width > 760 ? "desktop" : "mobile"}.png`) });
      // A real cancellation remains a separate explicit action. While its
      // acknowledgement is pending the pause control and editing are locked.
      await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.fixtureRecovery.checking = true; fixture.fixtureRecovery.cancelling = true; fixture.refreshRecovery(); });
      await page.getByRole("heading", { name: messages.ai_generator_editor_stop_pending, exact: true }).waitFor();
      assert.equal(await pause.isDisabled(), true); assert.equal(await visual.isDisabled(), true);
      assert.equal(await card.getByText(messages.ai_generator_recovery_continue, { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).networkCalls), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("real Studio video frames render on desktop and mobile and block oversized exact speech without clearing it", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    mkdirSync(path.join(taskRoot, "work"), { recursive: true });
    mkdirSync(path.join(taskRoot, "outputs"), { recursive: true });
    writeFileSync(path.join(taskRoot, "work/studio-video-brief-speech-fixture.html"), html);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = await mount(page);
      const visual = page.getByLabel("Consignes visuelles", { exact: true });
      await page.locator('select[id$="-spoken-script-mode"]').selectOption("exact");
      const speech = page.locator('textarea[id$="-spoken-script"]');
      await assert.doesNotReject(() => speech.waitFor({ state: "visible" }));
      assert.equal(await visual.getAttribute("maxlength"), null);
      await speech.fill("un deux trois quatre cinq six sept");
      const duration = page.locator('select[id$="-duration"]');
      await duration.selectOption("4:single");
      await page.getByText("7 / 6 mots", { exact: false }).waitFor();
      const generate = page.locator("[data-media-primary-action]");
      assert.equal(await generate.isDisabled(), true);
      await duration.selectOption("8:single");
      assert.equal(await speech.inputValue(), "un deux trois quatre cinq six sept");
      await page.getByText("7 / 14 mots", { exact: false }).waitFor();
      assert.equal(await generate.isDisabled(), false);
      await visual.fill("x".repeat(501));
      assert.equal(await visual.inputValue(), "x".repeat(501));
      assert.equal(await generate.isDisabled(), true);
      await visual.fill("Un jardinier taille une haie. Lumière naturelle, plan rapproché.");
      await speech.fill("Bonjour, nous prenons soin de votre jardin.");
      await page.screenshot({ path: path.join(taskRoot, `outputs/studio-video-cadres-${viewport.width > 760 ? "desktop" : "mobile"}.png`), fullPage: true });
      await generate.click();
      const requests = await page.evaluate(() => (window as unknown as FixtureWindow).studioRequests);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].spokenScript, "Bonjour, nous prenons soin de votre jardin.");
      assert.equal(requests[0].freePrompt, "Un jardinier taille une haie. Lumière naturelle, plan rapproché.");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "mobile frames never overflow horizontally");
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).networkCalls), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
