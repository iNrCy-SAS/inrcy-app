import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const ID = "11111111-1111-4111-8111-111111111111", VERSION = "2026-11-02T12:00:00Z";
const sources = {
  react: packageSource("react", "react.development.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
  "react-dom": packageSource("react-dom", "react-dom.development.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"), scheduler: packageSource("scheduler", "scheduler.development.js"),
  guard: compile(read("app/dashboard/_hooks/useDocumentUnsavedChanges.ts")), prefill: compile(read("app/dashboard/_hooks/useDocumentAssistantPrefill.ts")),
  commands: compile(read("lib/inrAssistantDocumentUiCommands.ts")), provider: compile(read("app/dashboard/_components/DashboardUnsavedNavigationProvider.tsx")),
};
async function mount(page: Page, operation: "apply_template" | "convert_quote") {
  await page.route("**/*", route => route.request().url() === "https://prefill.invalid/" ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
  await page.goto("https://prefill.invalid/");
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},cache={},process={env:{NODE_ENV:'development'}};
    window.account='A';window.operations=[];window.events=[];window.prompts=[];window.failures=0;window.stage='';window.block='';
    async function checkpoint(name){window.events.push(name);window.stage=name;if(window.block===name)await new Promise(resolve=>window.release=resolve);}
    function load(name){
      if(name==='next/navigation')return{useRouter:()=>({push(){}})};
      if(name==='@/lib/browserAccountCache')return{getActiveBrowserUserId:()=>window.account,resolveActiveBrowserUserId:()=>window.account};
      if(name==='@/lib/inrcyDialog')return{confirmInrcy:()=>new Promise(resolve=>window.prompts.push(resolve))};
      if(name==='@/lib/inrAssistantDocumentUiCommands')name='commands';
      if(name.endsWith('DashboardUnsavedNavigationProvider'))name='provider';
      if(cache[name])return cache[name].exports;if(!sources[name])throw Error(name);
      const mod=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(load,mod,mod.exports,process);return mod.exports;
    }
    const React=load('react'),useGuard=load('guard').useDocumentUnsavedChanges,usePrefill=load('prefill').useDocumentAssistantPrefill,Provider=load('provider').default;
    const params=new URLSearchParams({assistantPrefill:'1',${operation === "convert_quote" ? "fromDevisSaveId" : "templateSaveId"}:'${ID}',sourceVersion:'${VERSION}'});
    const supabase={auth:{getUser:async()=>{await checkpoint('auth');return{data:{user:{id:'actor'}},error:null}}},from:()=>{
      const filters={};const q={select:()=>q,eq:(key,value)=>{filters[key]=value;return q},maybeSingle:async()=>{await checkpoint('read');return{data:{id:filters.id,user_id:window.foreign?'B':filters.user_id,type:filters.type,updated_at:window.stale?'old':'${VERSION}',payload:{isTemplate:${operation === "apply_template"},clientName:'Source',lines:[{qty:2,unitPrice:80}]}},error:window.readError?{}:null}}};return q;
    }};
    function Editor(){
      const[id,setId]=React.useState('target'),[form,setForm]=React.useState({clientName:'Old',lines:[]}),[ready,setReady]=React.useState(false),[configuration,setConfiguration]=React.useState('settings1'),[tick,setTick]=React.useState(0);
      const edits=useGuard(id,form);
      const apply=payload=>{window.operations.push(payload);edits.markHydrated();setId('');setForm(payload)};
      const source=usePrefill({kind:'invoice',params,supabase,ready,documentId:id,configurationVersion:configuration,edits,applyTemplate:apply,applyConversion:apply,onFailure:()=>window.failures++});
      React.useLayoutEffect(()=>{window.state={id,form,dirty:edits.dirty,source,tick,ready,configuration};window.ready=()=>setReady(true);window.edit=()=>setForm(previous=>({...previous,clientName:'My edits'}));window.loadB=()=>{edits.markHydrated();setId('B');setForm({clientName:'B',lines:[]})};window.config=()=>setConfiguration('settings2');window.rerender=()=>setTick(n=>n+1);window.navigate=()=>edits.requestNavigation(()=>window.navigated=true);window.save=()=>{const version=edits.captureSave();if(edits.markSaved(version,'saved'))setId('saved')};});
      return React.createElement('output',null,id);
    }
    const root=load('react-dom/client').createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();root.render(React.createElement(Provider,null,React.createElement(Editor)));
  ` });
  page.setDefaultTimeout(5000); await page.waitForFunction("!!window.state");
}
for (const operation of ["apply_template", "convert_quote"] as const) {
  test(`${operation}: native hydration waits for readiness, acknowledges only committed form, protects unsaved prefill and never repeats on form/settings renders`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage(); await mount(page, operation); assert.deepEqual(await page.evaluate("window.events"), []);
      await page.evaluate("window.ready()"); await page.waitForFunction("!!window.state.source");
      assert.deepEqual(await page.evaluate("[window.state.id,window.state.dirty,window.state.source.sourceId,window.operations.length]"), ["", true, ID, 1]);
      assert.equal(await page.evaluate("!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))"), true);
      await page.evaluate("window.rerender();window.config()"); await page.waitForFunction("window.state.tick===1");
      assert.equal(await page.evaluate("window.operations.length"), 1);
      await page.evaluate("void window.navigate()"); await page.waitForFunction("window.prompts.length===1");
      await page.evaluate("window.prompts[0](false)"); assert.equal(await page.evaluate("!!window.navigated"), false);
      await page.evaluate("window.save()"); await page.waitForFunction("window.state.id==='saved'&&!window.state.dirty");
      assert.equal(await page.evaluate("!!window.state.source"), false);
    } finally { await browser.close(); }
  });
  test(`${operation}: current unsaved form must be confirmed before replacement`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const accept of [false, true]) {
        const page = await browser.newPage(); await mount(page, operation); await page.evaluate("window.edit()"); await page.waitForFunction("window.state.dirty");
        await page.evaluate("window.ready()"); await page.waitForFunction("window.prompts.length===1"); assert.equal(await page.evaluate("window.operations.length"), 0);
        await page.evaluate(accept => (window as unknown as { prompts: ((value: boolean) => void)[] }).prompts[0](accept), accept);
        if (accept) await page.waitForFunction("!!window.state.source");
        else await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        assert.equal(await page.evaluate("window.operations.length"), accept ? 1 : 0); assert.equal(await page.evaluate("window.state.dirty"), true);
        await page.close();
      }
    } finally { await browser.close(); }
  });
  test(`${operation}: stale auth/read continuations cannot overwrite document, account, newer edits or configuration`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const phase of ["auth", "read"]) for (const change of ["document", "account", "edit", "configuration", "unmount"]) {
        const page = await browser.newPage(); await mount(page, operation);
        await page.evaluate(phase => { const w = window as unknown as { block: string; ready: () => void }; w.block = phase; w.ready(); }, phase);
        await page.waitForFunction(phase => (window as unknown as { stage: string }).stage === phase, phase);
        await page.evaluate(change => { const w = window as unknown as { account: string; loadB: () => void; edit: () => void; config: () => void; unmount: () => void }; if (change === "document") w.loadB(); else if (change === "account") w.account = "B"; else if (change === "edit") w.edit(); else if (change === "configuration") w.config(); else w.unmount(); }, change);
        await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); await page.evaluate("window.release()");
        await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        assert.deepEqual(await page.evaluate("window.operations"), [], `${phase}/${change}`); assert.equal(await page.evaluate("!!window.state.source"), false);
        await page.close();
      }
    } finally { await browser.close(); }
  });
  test(`${operation}: server version/ownership errors never become hydration receipts`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const failure of ["stale", "foreign", "readError"]) {
        const page = await browser.newPage(); await mount(page, operation);
        await page.evaluate(failure => { (window as unknown as Record<string, unknown>)[failure] = true; (window as unknown as { ready: () => void }).ready(); }, failure);
        await page.waitForFunction("window.failures===1"); assert.deepEqual(await page.evaluate("window.operations"), []); assert.equal(await page.evaluate("!!window.state.source"), false); await page.close();
      }
    } finally { await browser.close(); }
  });
}

test("both native pages wire their actual template/conversion mappers, never a parallel incomplete business mapping", () => {
  for (const domain of ["devis", "factures"]) {
    const source = read(`app/dashboard/${domain}/new/page.tsx`);
    const file = ts.createSourceFile(domain, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const calls: ts.CallExpression[] = [];
    const walk = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(file) === "useDocumentAssistantPrefill") calls.push(node); ts.forEachChild(node, walk); }; walk(file);
    assert.equal(calls.length, 1); const call = calls[0].getText(file);
    assert.match(call, /applyTemplateSnapshot\(payload/); assert.match(call, /documentSettingsReady && !!profile/);
    if (domain === "factures") assert.match(call, /applyDevisConversionSnapshot\(payload/);
    assert.doesNotMatch(call, /saveDraft|finalizeInvoice|\.insert\(|\.update\(/);
  }
});
