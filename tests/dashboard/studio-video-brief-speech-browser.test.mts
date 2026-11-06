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
const messages = JSON.parse(read("messages/fr-FR/media.json"));
const catalogs = Object.fromEntries(["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"].map(locale => [locale, JSON.parse(read(`messages/${locale}/media.json`))]));
const fixture = `
const sources=${JSON.stringify(sources)},catalogs=${JSON.stringify(catalogs)},loaded={};
window.studioRequests=[];window.studioQuotes=[];window.networkCalls=0;window.fixtureLocale='fr-FR';
window.fixtureUseRealWorkspace=false;window.fixtureRecovery={pending:false,checking:false,cancelling:false};window.recoveryOperations={reads:0,pauses:0,cancels:0};
window.fetch=()=>{window.networkCalls++;throw Error('This local fixture never calls a remote API')};
const noOp=()=>{};
function require(name){
 if(loaded[name])return loaded[name].exports;
 if(name==='next-intl')return {useLocale:()=>window.fixtureLocale,useTranslations:()=> (key,values={})=>(catalogs[window.fixtureLocale][key]||key).replace(/\\{(\\w+)\\}/g,(_,key)=>String(values[key]??'{'+key+'}'))};
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
 if(name.endsWith('useInrAssistantLocalInterface'))return {useInrAssistantLocalInterface:noOp};
 if(name==='@/lib/mediaGenerationReferenceClient')return {prepareMediaGenerationImageReference(){throw Error('No uploads allowed')},prepareMediaGenerationLibraryReferenceFile(){throw Error('No uploads allowed')}};
 if(name==='./MediaGenerationCreationWorkspace')return {__esModule:true,default:props=>window.fixtureUseRealWorkspace?React.createElement(require('app/dashboard/_components/MediaGenerationCreationWorkspace.tsx').default,props):React.createElement('div',{'data-media-creation-stage':true,style:{padding:24}},'Aperçu de votre vidéo'),MediaGenerationSettingsTabs:props=>window.fixtureUseRealWorkspace?React.createElement(require('app/dashboard/_components/MediaGenerationCreationWorkspace.tsx').MediaGenerationSettingsTabs,props):React.createElement('div',{className:'editor-tabs',role:'tablist'},props.tabs.map(tab=>React.createElement('button',{key:tab.id,id:props.idPrefix+'-tab-'+tab.id,role:'tab','aria-selected':props.activeTab===tab.id,onClick:()=>props.onChange(tab.id)},tab.label)))};
 if(name==='next/image')return {__esModule:true,default:props=>React.createElement('img',props)};
 if(name==='@/app/dashboard/_hooks/useMediaResultReveal')return {useMediaResultReveal:()=>({reviewRef:React.useRef(null),headingRef:React.useRef(null)})};
 if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=>null};
 if(name==='./MediaResultViewer')return {__esModule:true,default:()=>null};
 if(name==='./DashboardMobileSelect')return {__esModule:true,default:props=>React.createElement('select',{'aria-label':props.ariaLabel,value:props.value,onChange:event=>props.onChange(event.target.value)},props.options.map(option=>React.createElement('option',{key:option.value,value:option.value},option.label)))};
 if(name==='./MediaSubjectVoiceButton')return {__esModule:true,default:()=>React.createElement('button',{type:'button',style:{width:28,height:28},'aria-label':'Dicter'},'🎙')};
 if(name==='./MediaBusinessDnaHelp'||name==='./MediaLibraryPickerModal'||name==='./MediaCharacterVoiceInput'||name==='./MediaCharacterVoiceLibraryPicker'||name==='./MediaQuotaSummary')return {__esModule:true,default:()=>null};
 if(name.endsWith('.css')){const prefix=name.includes('FreeGenerator')?'free-':name.includes('CreationWorkspace')?'editor-':name.includes('EngineCreditControls')?'engine-':name.includes('PromptHelp')?'help-':name.includes('MediaGenerator.module')?'gen-':'other-';return {__esModule:true,default:new Proxy({},{get:(_,key)=>prefix+String(key)})};}
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
const css = prefix(read("app/dashboard/_components/MediaFreeGenerator.module.css"), "free") + prefix(read("app/dashboard/_components/MediaGenerationCreationWorkspace.module.css"), "editor") + prefix(read("app/dashboard/_components/MediaEngineCreditControls.module.css"), "engine") + prefix(read("app/dashboard/_components/MediaGeneratorModal.module.css"), "modal") + prefix(read("app/dashboard/_components/MediaPromptHelp.module.css"), "help") + prefix(read("app/dashboard/_components/MediaGenerator.module.css"), "gen");
// Same viewport-fitting modal/body CSS as production, including its real header
// allowance and footer controls. Do not force a tall editor or auto workspace.
const html = `<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#08122d;color:#f5f7ff;font:14px Arial}.fixture-header{min-height:72px;display:flex;align-items:center;justify-content:space-between;padding:12px 20px}.fixture-header h1{font-size:20px;margin:0}@media(max-width:760px){.fixture-header{min-height:64px}}</style><style>${css}</style></head><body><div class="modal-layer"><main class="modal-dialog" data-studio-tab="generate"><header class="fixture-header"><h1>iNrStudio — création vidéo</h1><span>Créer · Modifier · Retoucher</span></header><div class="modal-body"><div id="root" class="modal-generationWorkspace"></div></div></main></div><script>${fixture.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;

type FixtureWindow = Window & { studioRequests: Array<Record<string, unknown>>; networkCalls: number; fixtureLocale: string; renderStudio(prompt?: string, kind?: string): void; fixtureUseRealWorkspace: boolean; fixtureRecovery: { pending: boolean; checking: boolean; cancelling: boolean }; refreshRecovery(): void; recoveryOperations: { reads: number; pauses: number; cancels: number } };
async function mount(page: Page) {
  mkdirSync(path.join(taskRoot, "outputs"), { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
  await page.goto("http://studio-fixture.test/");
  await page.getByLabel("Consignes visuelles", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  return errors;
}

async function assertBothFramesFit(page: Page, context: string) {
  const layout = await page.evaluate(() => {
    const panels = document.querySelector<HTMLElement>(".free-videoSettingsPane .editor-settingsPanels")!;
    const bounds = panels.getBoundingClientRect();
    const targets = ["[data-video-brief-frame]", ".free-spokenScriptSection", 'textarea[id$="-prompt"]', 'textarea[id$="-spoken-script"]', '[id$="-prompt-count"]', '[id$="-spoken-script-count"]'].map(selector => ({ selector, element: document.querySelector<HTMLElement>(selector)! }));
    targets.push(...Array.from(document.querySelectorAll<HTMLElement>(".free-promptPanel [role=alert]")).map((element, index) => ({ selector: `validation error ${index + 1}`, element })));
    const fields = targets.map(({ selector, element }) => {
      const rect = element.getBoundingClientRect();
      const frameBounds = element.closest("[data-video-brief-frame], .free-spokenScriptSection")?.getBoundingClientRect();
      return { selector, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, frameBottom: frameBounds?.bottom };
    });
    return { scrollHeight: panels.scrollHeight, clientHeight: panels.clientHeight, scrollTop: panels.scrollTop, top: bounds.top, bottom: bounds.bottom, viewportHeight: innerHeight, fields };
  });
  assert.ok(layout.scrollHeight <= layout.clientHeight + 1, `${context}: left panel scrolls ${JSON.stringify(layout)}`);
  assert.equal(layout.scrollTop, 0, `${context}: left panel starts without scrolling`);
  for (const field of layout.fields) {
    assert.ok(field.width > (field.selector.includes("-count") ? 20 : 100) && field.height >= (field.selector.startsWith("textarea") ? 60 : 1), `${context}: usable ${field.selector}`);
    assert.ok(field.top >= layout.top - 1 && field.bottom <= layout.bottom + 1 && field.bottom <= layout.viewportHeight, `${context}: both frames, editors and counters fit ${JSON.stringify(field)}`);
    if (field.frameBottom) assert.ok(field.bottom <= field.frameBottom + 1, `${context}: content stays within its frame ${JSON.stringify(field)}`);
  }
}

test("both real video frames and counters fit reduced desktop viewports without a scrolling left panel", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1707, height: 842 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      const errors = await mount(page);
      await assertBothFramesFit(page, `${viewport.width}x${viewport.height} automatic`);
      const visual = page.getByLabel("Consignes visuelles", { exact: true });
      const speech = page.getByLabel("Paroles à prononcer", { exact: true });
      await speech.fill("Bonjour, nous prenons soin de votre jardin.");
      await assertBothFramesFit(page, `${viewport.width}x${viewport.height} exact speech`);
      await page.screenshot({ path: path.join(taskRoot, `outputs/studio-video-compact-${viewport.width}x${viewport.height}.png`) });
      // Historical and over-budget drafts stay fully editable; counters and
      // errors remain available while long values scroll inside the inputs.
      await visual.fill("x".repeat(501));
      await speech.fill("mot ".repeat(1000));
      assert.equal(await visual.inputValue(), "x".repeat(501));
      assert.equal(await speech.inputValue(), "mot ".repeat(1000));
      assert.equal(await page.locator("[data-media-primary-action]").isDisabled(), true);
      await assertBothFramesFit(page, `${viewport.width}x${viewport.height} long draft errors`);
      await page.locator("[data-media-prompt-help]").click();
      await page.getByRole("dialog").waitFor();
      await page.getByText(messages.ai_generator_video_visual_brief_hint, { exact: true }).waitFor();
      await page.getByText(messages.ai_generator_video_speech_frame_hint, { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await speech.inputValue(), "mot ".repeat(1000));
      assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).networkCalls), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("compact video instructions fit all nine locales while image guidance remains unchanged", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = await mount(page);
    for (const locale of Object.keys(catalogs)) {
      await page.evaluate(locale => { (window as unknown as FixtureWindow).fixtureLocale = locale; (window as unknown as FixtureWindow).renderStudio(); }, locale);
      await page.getByLabel(catalogs[locale].ai_generator_video_visual_brief_title, { exact: true }).waitFor();
      await assertBothFramesFit(page, locale);
      assert.equal(await page.locator('[id$="-prompt-count"]').getAttribute("aria-live"), "polite");
      assert.equal(await page.locator('[id$="-spoken-script-count"]').getAttribute("aria-live"), "polite");
    }
    await page.evaluate(() => { (window as unknown as FixtureWindow).fixtureLocale = "fr-FR"; (window as unknown as FixtureWindow).renderStudio("x".repeat(3900), "image"); });
    const imagePrompt = page.locator('textarea[id$="-prompt"]');
    await imagePrompt.waitFor();
    assert.equal(await imagePrompt.inputValue(), "x".repeat(3900));
    assert.equal(await imagePrompt.getAttribute("maxlength"), "4000");
    await page.getByText(messages.ai_generator_free_prompt_hint, { exact: true }).waitFor();
    assert.equal(await page.locator("[data-video-brief-frame]").count(), 0);
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
      const speech = page.getByLabel("Paroles à prononcer", { exact: true });
      assert.equal(await visual.isEditable(), true);
      assert.equal(await speech.isEditable(), true);
      await visual.fill("Un nouveau jardin, en lumière naturelle.");
      await speech.fill("Bonjour, nous prenons soin de votre jardin.");
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
      const speech = page.getByLabel("Paroles à prononcer", { exact: true });
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
