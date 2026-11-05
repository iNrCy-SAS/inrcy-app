import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const mocked = new Set([
  "@/lib/browserAccountCache", "@/lib/supabaseClient",
  "@/lib/boosterGenerationContextClient", "@/lib/inrcyDialog", "@/lib/userFacingErrors",
]);
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");

function modules() {
  const sources: Record<string, string> = {
    react: packageSource("react", "react.development.js"),
    "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
    "react-dom": packageSource("react-dom", "react-dom.development.js"),
    "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
    scheduler: packageSource("scheduler", "scheduler.development.js"),
  };
  const links: Record<string, Record<string, string>> = {};
  function add(file: string): string {
    const id = file.replaceAll("\\", "/");
    if (sources[id]) return id;
    const source = readFileSync(file, "utf8");
    sources[id] = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    links[id] = {};
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of tree.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (mocked.has(specifier) || specifier.endsWith(".css")) continue;
      const base = specifier.startsWith("@/") ? resolve(repo, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(file), specifier) : null;
      if (!base || !base.replaceAll("\\", "/").includes("/lib/") && !/\/_hooks\/useInrAssistant|DashboardAssistant(?:Screen|Command)Context/.test(base.replaceAll("\\", "/"))) continue;
      const target = [base, base + ".ts", base + ".tsx"].find(candidate => existsSync(candidate));
      if (!target) throw Error(`Unresolved fixture import ${specifier}`);
      links[id][specifier] = add(target);
    }
    return id;
  }
  return { sources, links, subject: add(resolve(repo, "app/dashboard/settings/_components/AiConfigurationContent.tsx")) };
}
const fixture = modules();

async function mount(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' }) : route.abort());
  await page.goto("https://ai-configuration-autosave.fixture.invalid/dashboard/personnalisation");
  await page.addScriptTag({ content: `
    const fixture=${JSON.stringify(fixture)},cache={},process={env:{NODE_ENV:'development'}};
    window.writes=[];window.cacheWrites=[];window.authCalls=0;window.manualSaved=0;window.autoSaved=0;window.activeAccount='account-a';window.authAccount='account-a';window.dirty=false;
    const query={select(){return this},eq(){return this},maybeSingle:async()=>({data:{},error:null}),
      upsert(payload){return new Promise(resolve=>window.writes.push({payload,finish:error=>resolve({error:error?{message:error}:null})}))}};
    const client={auth:{getUser:async()=>{window.authCalls++;return{data:{user:{id:window.authAccount}},error:null}}},from:()=>query};
    const mocks={
      '@/lib/browserAccountCache':{resolveActiveBrowserUserId:()=>window.activeAccount,getActiveBrowserUserId:()=>window.activeAccount,readAccountCacheValue:()=>null,writeAccountCacheValue:(key,value,account)=>window.cacheWrites.push({key,value,account})},
      '@/lib/supabaseClient':{createClient:()=>client},
      '@/lib/boosterGenerationContextClient':{invalidateBoosterGenerationContextClient:async()=>{}},
      '@/lib/inrcyDialog':{confirmInrcy:async()=>true},
      '@/lib/userFacingErrors':{getClientUserFacingErrorMessage:(_error,fallback)=>fallback}
    };
    function load(name,parent){
      if(mocks[name])return mocks[name];
      if(name==='next-intl')return{useTranslations:()=>key=>key};
      if(name==='next/navigation')return{usePathname:()=>'/dashboard/personnalisation'};
      if(name.endsWith('DashboardViewerAccessProvider'))return{useDashboardViewerAccess:()=>({actorUserId:window.authAccount,activeAccountId:window.activeAccount,metaPilotEnabled:false})};
      if(name.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
      if(name.endsWith('MediaSubjectVoiceButton'))return{__esModule:true,default:props=>React.createElement('button',{'data-fixture-voice':props.contextLabel,disabled:props.disabled,onClick:()=>{window.voiceOn=!window.voiceOn;props.onBusyChange(window.voiceOn)}},'voice')};
      const id=fixture.links[parent]?.[name]||name;
      if(cache[id])return cache[id].exports;
      if(!fixture.sources[id]){
        if(name.startsWith('.'))return{__esModule:true,default:props=>React.createElement('div',null,props.children)};
        throw Error('Unexpected import '+name+' from '+parent);
      }
      const module=cache[id]={exports:{}};
      new Function('require','module','exports','process',fixture.sources[id])(next=>load(next,id),module,module.exports,process);
      return module.exports;
    }
    const React=load('react'),Subject=load(fixture.subject).default;
    const root=load('react-dom/client').createRoot(document.getElementById('root'));
    window.persistence={current:null};window.fetch=()=>{throw Error('Unexpected network call')};
    root.render(React.createElement(Subject,{workspaceMode:true,hideNavigation:true,hideAiMemoryShortcut:true,initialTab:'instructions',
      onUnsavedChange:value=>{window.dirty=value},onSaved:()=>{window.manualSaved++},onAutoSaved:()=>{window.autoSaved++},persistenceRef:window.persistence}));
    window.flush=()=>window.persistence.current.savePendingChanges();
  ` });
  page.setDefaultTimeout(5_000);
  await page.getByRole("textbox", { name: "customInstructionsLabel", exact: true }).waitFor().catch(error => { assert.deepEqual(errors, [], "The native AI configuration component must mount before the autosave assertions"); throw error; });
  return errors;
}

test("AI configuration autosave keeps newer edits, serializes writes and never closes its workspace", { timeout: 25_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = await mount(page);
    const input = page.getByRole("textbox", { name: "customInstructionsLabel", exact: true });
    await page.waitForTimeout(1_000);
    assert.equal(await page.evaluate("window.writes.length"), 0, "initial hydration does not save defaults");
    await input.fill("First draft");
    await page.waitForFunction("window.writes.length === 1");
    assert.equal(await page.evaluate("window.writes[0].payload.user_id"), "account-a");
    assert.match(await page.evaluate<string>("window.writes[0].payload.ai_custom_instructions"), /First draft/);
    await input.fill("Newer draft while saving");
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate("window.writes.length"), 1, "a pending write blocks a concurrent write");
    await page.evaluate("window.writes[0].finish()");
    await page.waitForFunction("window.autoSaved === 1");
    assert.equal(await input.inputValue(), "Newer draft while saving");
    assert.equal(await page.evaluate("window.dirty"), true);
    await page.waitForFunction("window.writes.length === 2");
    assert.match(await page.evaluate<string>("window.writes[1].payload.ai_custom_instructions"), /Newer draft while saving/);
    await page.evaluate("window.writes[1].finish()");
    await page.waitForFunction("window.dirty === false");
    assert.equal(await page.evaluate("window.manualSaved"), 0);
    assert.equal(await page.evaluate("window.autoSaved"), 2);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("AI configuration retains a failed draft without a retry loop and offers a manual retry", { timeout: 20_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = await mount(page);
    const input = page.getByRole("textbox", { name: "customInstructionsLabel", exact: true });
    await input.fill("Keep this draft offline");
    await page.waitForFunction("window.writes.length === 1");
    await page.evaluate("window.writes[0].finish('Network failed')");
    await page.getByRole("alert").waitFor();
    await page.waitForTimeout(1_800);
    assert.equal(await page.evaluate("window.writes.length"), 1);
    assert.equal(await input.inputValue(), "Keep this draft offline");
    assert.equal(await page.evaluate("window.dirty"), true);
    await page.getByRole("button", { name: "enregistrer_f7c8bcd8", exact: true }).click();
    await page.waitForFunction("window.writes.length === 2");
    await page.evaluate("window.writes[1].finish()");
    await page.waitForFunction("window.manualSaved === 1 && window.dirty === false");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("AI configuration flush saves the current draft before navigation and account switches never receive it", { timeout: 20_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = await mount(page);
    const input = page.getByRole("textbox", { name: "customInstructionsLabel", exact: true });
    await input.fill("Save before leaving");
    await page.evaluate("void window.flush().then(value=>{window.flushed=value})");
    await page.waitForFunction("window.writes.length === 1");
    assert.equal(await page.evaluate("window.flushed"), undefined);
    await page.evaluate("window.writes[0].finish()");
    await page.waitForFunction("window.flushed === true");
    assert.equal(await page.evaluate("window.manualSaved"), 0, "flush does not run a drawer close callback");
    await input.fill("Belongs to the original account");
    await page.evaluate("window.activeAccount='account-b';void window.flush().then(value=>{window.switchedFlush=value})");
    await page.waitForFunction("window.switchedFlush === false");
    await page.waitForTimeout(1_000);
    assert.equal(await page.evaluate("window.writes.length"), 1);
    assert.equal(await page.evaluate("window.cacheWrites.some(entry=>entry.account === 'account-b')"), false);
    assert.equal(await input.inputValue(), "Belongs to the original account");
    assert.equal(await page.evaluate("window.dirty"), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("AI configuration waits for voice dictation before automatic saving", { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = await mount(page);
    await page.getByRole("textbox", { name: "customInstructionsLabel", exact: true }).fill("Waiting for dictation");
    const voice = page.locator('[data-fixture-voice="customInstructionsLabel"]');
    await voice.click();
    await page.waitForTimeout(1_000);
    assert.equal(await page.evaluate("window.writes.length"), 0);
    assert.equal(await page.evaluate("window.flush()"), false);
    await voice.click();
    await page.waitForFunction("window.writes.length === 1");
    await page.evaluate("window.writes[0].finish()");
    await page.waitForFunction("window.dirty === false");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("a delayed manual-save callback never closes over a newer draft", { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = await mount(page);
    const input = page.getByRole("textbox", { name: "customInstructionsLabel", exact: true });
    await input.fill("Manual save");
    await page.getByRole("button", { name: "enregistrer_f7c8bcd8", exact: true }).click();
    await page.waitForFunction("window.writes.length === 1");
    await page.evaluate("window.writes[0].finish()");
    await page.waitForFunction("window.dirty === false");
    await input.fill("Continue editing after the manual save");
    await page.waitForTimeout(1_100);
    assert.equal(await page.evaluate("window.manualSaved"), 0);
    assert.equal(await input.inputValue(), "Continue editing after the manual save");
    await page.waitForFunction("window.writes.length === 2");
    await page.evaluate("window.writes[1].finish()");
    await page.waitForFunction("window.dirty === false");
    assert.equal(await page.evaluate("window.manualSaved"), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
