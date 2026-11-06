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
const stubNames = new Set(["next-intl", "@/app/dashboard/_hooks/useMediaGeneration", "../_hooks/useMediaGeneration", "../_hooks/useMediaEnginePreference", "../_hooks/useMediaCreditQuote", "../_hooks/useInrAssistantLocalInterface", "@/lib/mediaGenerationReferenceClient", "./MediaLibraryPickerModal", "./MediaSubjectVoiceButton", "./MediaCharacterVoiceInput", "./MediaPromptHelp", "./MediaBusinessDnaHelp", "./MediaQuotaSummary", "./MediaCharacterVoiceLibraryPicker", "./MediaGenerationCreationWorkspace"]);
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
const messages = JSON.parse(read("messages/fr-FR/media.json"));
const fixture = `
const sources=${JSON.stringify(sources)},messages=${JSON.stringify(messages)},loaded={};
window.studioRequests=[];window.studioQuotes=[];window.networkCalls=0;window.fixtureLocale='fr-FR';
window.fetch=()=>{window.networkCalls++;throw Error('This local fixture never calls a remote API')};
const noOp=()=>{};
function require(name){
 if(loaded[name])return loaded[name].exports;
 if(name==='next-intl')return {useLocale:()=>window.fixtureLocale,useTranslations:()=> (key,values={})=>(messages[key]||key).replace(/\\{(\\w+)\\}/g,(_,key)=>String(values[key]??'{'+key+'}'))};
 if(name.endsWith('useMediaGeneration'))return {__esModule:true,default:()=>({quota:{accountId:'fixture',creditsReady:true,unlimited:true,studioEnabled:true,credits:{remaining:10000},videoMaxDurationSeconds:30},quotaLoading:false,busy:false,progress:0,error:'',result:null,canRecover:false,loadQuota:noOp,generate:async request=>{window.studioRequests.push(request)},MediaGenerationAccountChangedError:class extends Error{},MediaGenerationCancelledError:class extends Error{}}),MediaGenerationAccountChangedError:class extends Error{},MediaGenerationCancelledError:class extends Error{}};
 if(name.endsWith('useMediaEnginePreference'))return {__esModule:true,default:()=>{const[value,setValue]=React.useState({imageEngine:'openai',videoEngine:'wan3',videoResolution:'720p'});return {...value,update:patch=>setValue(current=>({...current,...patch}))}}};
 if(name.endsWith('useMediaCreditQuote'))return {__esModule:true,default:input=>{window.studioQuotes.push(input);return {ready:true,insufficient:false,authorization:{expectedCredits:88,creditQuoteId:'fixture-quote'},quote:{totalCredits:88}}}};
 if(name.endsWith('useInrAssistantLocalInterface'))return {useInrAssistantLocalInterface:noOp};
 if(name==='@/lib/mediaGenerationReferenceClient')return {prepareMediaGenerationImageReference(){throw Error('No uploads allowed')},prepareMediaGenerationLibraryReferenceFile(){throw Error('No uploads allowed')}};
 if(name==='./MediaGenerationCreationWorkspace')return {__esModule:true,default:()=>React.createElement('div',{style:{padding:24}},'Aperçu de votre vidéo'),MediaGenerationSettingsTabs:({idPrefix,tabs,activeTab,onChange})=>React.createElement('div',{className:'editor-tabs',role:'tablist'},tabs.map(tab=>React.createElement('button',{key:tab.id,id:idPrefix+'-tab-'+tab.id,role:'tab','aria-selected':activeTab===tab.id,onClick:()=>onChange(tab.id)},tab.label)))};
 if(name==='./MediaSubjectVoiceButton'||name==='./MediaPromptHelp'||name==='./MediaBusinessDnaHelp'||name==='./MediaLibraryPickerModal'||name==='./MediaCharacterVoiceInput'||name==='./MediaCharacterVoiceLibraryPicker'||name==='./MediaQuotaSummary')return {__esModule:true,default:()=>null};
 if(name.endsWith('.css')){const prefix=name.includes('FreeGenerator')?'free-':name.includes('CreationWorkspace')?'editor-':name.includes('EngineCreditControls')?'engine-':'other-';return {__esModule:true,default:new Proxy({},{get:(_,key)=>prefix+String(key)})};}
 if(name==='app/dashboard/_components/MediaEngineCreditControls.ts')name='app/dashboard/_components/MediaEngineCreditControls.tsx';
 if(!sources[name])throw Error('Missing browser fixture module '+name);
 const record=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,record,record.exports);return record.exports;
}
const React=require('react'),Free=require('app/dashboard/_components/MediaFreeGenerator.tsx').default;
window.fixtureRoot=require('react-dom/client').createRoot(document.getElementById('root'));
window.renderStudio=(prompt='Un jardinier taille une haie. Lumière naturelle, plan rapproché.',kind='video')=>window.fixtureRoot.render(React.createElement(Free,{key:kind,source:'studio',acceptMode:'library',mediaType:kind,initialPrompt:prompt,onAccepted:noOp}));
window.renderStudio();
`;
const prefix = (css: string, name: string) => css.replace(/\.([a-zA-Z_][\w-]*)/g, `.${name}-$1`);
const css = prefix(read("app/dashboard/_components/MediaFreeGenerator.module.css"), "free") + prefix(read("app/dashboard/_components/MediaGenerationCreationWorkspace.module.css"), "editor") + prefix(read("app/dashboard/_components/MediaEngineCreditControls.module.css"), "engine");
const html = `<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#08122d;color:#f5f7ff;font:14px Arial}main{max-width:1160px;margin:auto;padding:18px}h1{font-size:22px;margin:0 0 16px}.editor-editorBody{min-height:680px}.free-workspace[data-view=editor]{height:auto}@media(max-width:760px){main{padding:10px}.editor-editorBody{min-height:0}}</style><style>${css}</style></head><body><main><h1>iNrStudio — création vidéo</h1><div id="root"></div></main><script>${fixture.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;

type FixtureWindow = Window & { studioRequests: Array<Record<string, unknown>>; networkCalls: number; fixtureLocale: string; renderStudio(prompt?: string, kind?: string): void };
async function mount(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
  await page.goto("http://studio-fixture.test/");
  await page.getByLabel("Consignes visuelles", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  return errors;
}

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
