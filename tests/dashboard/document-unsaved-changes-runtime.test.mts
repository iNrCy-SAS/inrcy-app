import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources = {
  react: packageSource("react", "react.development.js"),
  "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
  "react-dom": packageSource("react-dom", "react-dom.development.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
  scheduler: packageSource("scheduler", "scheduler.development.js"),
  provider: compile(read("app/dashboard/_components/DashboardUnsavedNavigationProvider.tsx")),
  subject: compile(read("app/dashboard/_hooks/useDocumentUnsavedChanges.ts")),
};

function initializer(domain: string, name: string) {
  const source = read(`app/dashboard/${domain}/new/page.tsx`);
  const tree = ts.createSourceFile(domain, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result: ts.Expression | undefined;
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) result = node.initializer;
    ts.forEachChild(node, walk);
  };
  walk(tree); assert.ok(result, `${domain}.${name} must exist`);
  return result.getText(tree);
}

async function mount(page: Page, domain = "devis") {
  await page.route("**/*", route => route.request().url() === "https://document-fixture.invalid/"
    ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
  await page.goto("https://document-fixture.invalid/");
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},cache={},process={env:{NODE_ENV:'development'}};
    window.account='account-A';window.prompts=[];window.navigations=[];
    function load(name){
      if(name==='next/navigation')return{useRouter:()=>({push:path=>window.navigations.push(path)})};
      if(name==='@/lib/browserAccountCache')return{getActiveBrowserUserId:()=>window.account};
      if(name==='@/lib/inrcyDialog')return{confirmInrcy:options=>new Promise(resolve=>window.prompts.push({options,resolve}))};
      if(name.endsWith('DashboardUnsavedNavigationProvider'))name='provider';
      if(cache[name])return cache[name].exports;
      if(!sources[name])throw Error('Unexpected import '+name);
      const module=cache[name]={exports:{}};
      new Function('require','module','exports','process',sources[name])(load,module,module.exports,process);
      return module.exports;
    }
    const React=load('react'),Provider=load('provider').default,guard=load('subject').useDocumentUnsavedChanges;
    const openDraftFactory=new Function('documentEdits','applyDraftSnapshot','setCurrentSaveId','setDraftsOpen',${JSON.stringify(compile("return " + initializer(domain, "openDraft")))});
    const settingsFactory=new Function('useEffectEvent','documentEdits','setDocumentsSettings','applyDocumentDefaults',${JSON.stringify(compile("return " + initializer(domain, "onDocumentSettingsLoaded")))});
    function Editor(){
      const [id,setId]=React.useState(''),[form,setForm]=React.useState({name:'',number:'N1',status:'draft'});
      const [tick,setTick]=React.useState(0);
      const edits=guard(id,form);
      React.useLayoutEffect(()=>{
        window.state={id,form,dirty:edits.dirty,tick};
        window.change=patch=>setForm(prev=>({...prev,...patch}));
        window.loadDraft=(nextId,snapshot)=>{edits.markHydrated();setId(nextId);setForm(snapshot)};
        window.openDraft=openDraftFactory(edits,snapshot=>{edits.markHydrated();setForm(snapshot)},setId,()=>{});
        window.settingsLoaded=settingsFactory(fn=>fn,edits,()=>{},snapshot=>{edits.markHydrated();setForm(snapshot)});
        window.navigate=()=>edits.requestNavigation(()=>window.navigations.push('B'));
        window.switchAccount=()=>edits.requestNavigation(()=>{window.account='account-B';edits.markHydrated();setId('B');setForm({name:'B',number:'N2',status:'draft'})});
        window.rerender=()=>setTick(n=>n+1);
        window.beginSave=()=>{window.ticket=edits.captureSave();};
        window.finishSave=(savedId=id)=>{window.saved=edits.markSaved(window.ticket,savedId);if(window.saved)setId(savedId)};
        window.finalize=()=>{const version=edits.captureSave();window.finalizeSaved=edits.markPersistedFields(version,{number:'OFFICIAL',status:'sent'});setForm(prev=>({...prev,number:'OFFICIAL',status:'sent'}))};
      });
      return React.createElement('div',null,React.createElement('output',null,edits.dirty?'dirty':'clean'),React.createElement('a',{href:'/dashboard/other'},'other'));
    }
    const root=load('react-dom/client').createRoot(document.getElementById('root'));
    window.unmount=()=>root.unmount();root.render(React.createElement(Provider,null,React.createElement(Editor)));
  ` });
  page.setDefaultTimeout(5000);
  await page.waitForFunction("!!window.state");
  await page.evaluate("window.loadDraft('A',{name:'Saved A',number:'N1',status:'draft'})");
  await page.waitForFunction("window.state.id==='A'&&!window.state.dirty");
}
const waitDirty = (page: Page, dirty: boolean) => page.waitForFunction(`window.state.dirty===${dirty}`);

for (const domain of ["devis", "factures"]) {
  test(`${domain}: the real native draft opener preserves cancelled edits and hydrates B only after confirmation`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage(); const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await mount(page, domain);
      await page.evaluate("window.change({name:'Edited A'})"); await waitDirty(page, true);
      await page.evaluate("window.openDraft({id:'B',snapshot:{name:'Saved B',number:'N2',status:'draft'}})");
      assert.equal(await page.evaluate("window.prompts.length"), 1);
      await page.evaluate("window.prompts[0].resolve(false)");
      assert.deepEqual(await page.evaluate("[window.state.id,window.state.form.name,window.state.dirty]"), ["A", "Edited A", true]);
      await page.evaluate("window.openDraft({id:'B',snapshot:{name:'Saved B',number:'N2',status:'draft'}})");
      await page.evaluate("window.prompts[1].resolve(true)");
      await page.waitForFunction("window.state.id==='B'&&!window.state.dirty");
      assert.equal(await page.evaluate("window.state.form.name"), "Saved B");
      await page.evaluate("window.rerender()"); await page.waitForFunction("window.state.tick===1");
      assert.equal(await page.evaluate("window.state.dirty"), false);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

test("a delayed successful save acknowledges only its captured version; later edits and failed saves stay dirty", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await mount(page);
    await page.evaluate("window.change({name:'First edit'})"); await waitDirty(page, true);
    await page.evaluate("window.beginSave();window.change({name:'Later edit'})");
    await page.waitForFunction("window.state.form.name==='Later edit'");
    await page.evaluate("window.finishSave()");
    assert.equal(await page.evaluate("window.saved"), true); await waitDirty(page, true);
    await page.evaluate("window.beginSave();window.finishSave()"); await waitDirty(page, false);
    await page.evaluate("window.change({name:'Unsaved after failure'})"); await waitDirty(page, true);
    await page.evaluate("window.beginSave()");
    // A failed request does not acknowledge a save. Finalization only acknowledges its own fields.
    await page.evaluate("window.finalize()"); await waitDirty(page, true);
    assert.equal(await page.evaluate("window.state.form.name"), "Unsaved after failure");
    await page.evaluate("window.beginSave();window.finishSave()"); await waitDirty(page, false);
  } finally { await browser.close(); }
});

for (const domain of ["devis", "factures"]) {
  test(`${domain}: a new document is clean after defaults, protects its first edits and rejects later default overwrites`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage(); await mount(page, domain);
      await page.evaluate("window.loadDraft('',{name:'',number:'N1',status:'draft'})");
      await page.waitForFunction("window.state.id===''"); await waitDirty(page, false);
      await page.evaluate("window.settingsLoaded({name:'Default',number:'N1',status:'draft'},true)");
      await page.waitForFunction("window.state.form.name==='Default'"); await waitDirty(page, false);
      await page.evaluate("window.change({name:'My first client'})"); await waitDirty(page, true);
      await page.evaluate("window.settingsLoaded({name:'Late default',number:'N1',status:'draft'},true)");
      assert.equal(await page.evaluate("window.state.form.name"), "My first client");
      await page.evaluate("void window.navigate().then(value=>window.allowed=value)");
      await page.evaluate("window.prompts[0].resolve(false)"); await page.waitForFunction("window.allowed===false");
      await page.evaluate("window.beginSave();window.finishSave('new-id')");
      await page.waitForFunction("window.state.id==='new-id'"); await waitDirty(page, false);
      assert.equal(await page.evaluate("window.state.form.name"), "My first client");
    } finally { await browser.close(); }
  });
}

test("the actual invoice finalizer refuses A when B is now current, before any request or state update", async () => {
  let requests = 0;
  const factory = new Function("documentEdits", "fetch", compile("return " + initializer("factures", "finalizeInvoice")));
  const finalize = factory({ captureSave: () => ({ documentId: "B" }), isCurrentSave: () => true }, async () => { requests++; });
  assert.equal(await finalize("A"), null);
  assert.equal(requests, 0);
});

test("the actual invoice finalizer cannot apply a late A response after switching documents", async () => {
  let currentId = "A", resolveResponse!: (value: unknown) => void;
  const busy: boolean[] = [];
  const factory = new Function("documentEdits", "fetch", "setFinalizing", compile("return " + initializer("factures", "finalizeInvoice")));
  const finalize = factory({
    captureSave: () => ({ documentId: currentId }), isCurrentSave: () => true,
    markPersistedFields: (version: { documentId: string }) => version.documentId === currentId,
  }, () => new Promise(resolve => { resolveResponse = resolve; }), (value: boolean) => busy.push(value));
  const pending = finalize("A");
  currentId = "B";
  resolveResponse({ ok: true, json: async () => ({ number: "A-OFFICIAL", status: "envoye", finalizedAt: "2026-11-02T12:00:00Z" }) });
  // No document setter is supplied: reaching one would fail this actual handler test.
  assert.equal(await pending, null);
  assert.deepEqual(busy, [true, false]);
});

test("the actual invoice finalizer stops its caller when A changes to B during the final list refresh", async () => {
  let currentId = "A", releaseRefresh!: () => void;
  const assigned: unknown[] = [];
  const refresh = new Promise<void>(resolve => { releaseRefresh = resolve; });
  const context = {
    documentEdits: {
      captureSave: () => ({ documentId: currentId }),
      isCurrentSave: (version: { documentId: string }) => version.documentId === currentId,
      markPersistedFields: () => true,
    },
    fetch: async () => ({ ok: true, json: async () => ({ number: "A-OFFICIAL", status: "envoye", finalizedAt: "2026-11-02T12:00:00Z" }) }),
    setFinalizing() {}, setCurrentSaveId: (id: string) => assigned.push(id),
    setNumber: (number: string) => assigned.push(number), setStatus() {}, setIsFinalized() {}, setFinalizedAt() {},
    refreshSaves: () => refresh,
  };
  const factory = new Function(...Object.keys(context), compile("return " + initializer("factures", "finalizeInvoice")));
  const pending = factory(...Object.values(context))("A");
  // Let the server response apply to A, then change the screen during refreshSaves.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(assigned, ["A", "A-OFFICIAL"]);
  currentId = "B"; releaseRefresh();
  assert.equal(await pending, null, "the caller must not build or send a PDF after its document changed");
});

test("account switching uses the native confirmation and rejects old account/save/dialog results", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await mount(page);
    await page.evaluate("window.change({name:'Keep me'})"); await waitDirty(page, true);
    await page.evaluate("window.beginSave();void window.switchAccount()");
    await page.evaluate("window.prompts[0].resolve(false)");
    assert.deepEqual(await page.evaluate("[window.account,window.state.id,window.state.form.name]"), ["account-A", "A", "Keep me"]);
    await page.evaluate("void window.navigate().then(value=>window.allowed=value)");
    await page.evaluate("window.account='account-B';window.prompts[1].resolve(true)");
    await page.waitForFunction("window.allowed===false");
    await page.evaluate("window.finishSave()"); assert.equal(await page.evaluate("window.saved"), false);
    assert.deepEqual(await page.evaluate("window.navigations"), []);
    await page.evaluate("window.loadDraft('B',{name:'Account B',number:'N2',status:'draft'})"); await waitDirty(page, false);
    await page.evaluate("window.change({name:'B edit'})"); await waitDirty(page, true);
    await page.evaluate("void window.switchAccount()"); await page.evaluate("window.prompts[2].resolve(true)");
    await page.waitForFunction("window.state.form.name==='B'"); await waitDirty(page, false);
  } finally { await browser.close(); }
});

test("reopening the same ID invalidates its pending save; edits during a confirmation require a fresh decision", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await mount(page);
    await page.evaluate("window.beginSave();window.loadDraft('A',{name:'Reloaded A',number:'N1',status:'draft'})");
    await page.waitForFunction("window.state.form.name==='Reloaded A'");
    await page.evaluate("window.finishSave()"); assert.equal(await page.evaluate("window.saved"), false);
    await page.evaluate("window.change({name:'First edit'})"); await waitDirty(page, true);
    await page.evaluate("void window.navigate().then(value=>window.allowed=value);window.change({name:'More edits'})");
    await page.waitForFunction("window.state.form.name==='More edits'");
    await page.evaluate("window.prompts[0].resolve(true)"); await page.waitForFunction("window.allowed===false");
    assert.deepEqual(await page.evaluate("window.navigations"), []);
  } finally { await browser.close(); }
});

test("native links and refresh guard only real saved-document edits and unregister on unmount", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await mount(page);
    const blocked = () => page.evaluate("!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))");
    assert.equal(await blocked(), false);
    await page.evaluate("window.change({name:'Changed'})"); await waitDirty(page, true);
    assert.equal(await blocked(), true);
    await page.getByRole("link", { name: "other" }).click();
    await page.evaluate("window.prompts[0].resolve(false)");
    assert.deepEqual(await page.evaluate("window.navigations"), []);
    await page.evaluate("window.unmount()"); assert.equal(await blocked(), false);
  } finally { await browser.close(); }
});

for (const domain of ["devis", "factures"]) {
  test(`${domain}: editable-field tracking excludes asynchronous account preferences and acknowledges only confirmed native saves`, () => {
    const snapshot = initializer(domain, "documentEdits");
    assert.match(snapshot, /useDocumentUnsavedChanges\(currentSaveId/);
    for (const field of ["clientName", "providerOverride", "lines", "notes", "discountValue", "paymentMethod"]) assert.match(snapshot, new RegExp(`\\b${field}\\b`));
    for (const field of ["profile", "clientExchangePreferences", "documentUiLocale", "documentsSettings", "finalizedAt"]) assert.doesNotMatch(snapshot, new RegExp(`\\b${field}\\b`));
    assert.match(initializer(domain, "applyDraftSnapshot"), /documentEdits\.markHydrated\(\)/);
    const save = initializer(domain, "saveDraft");
    assert.match(save, /captureSave\(\{ number: finalNumber \}\)/);
    assert.match(save, /if \(error \|\| !savedRows\?\.\[0\]\?\.id\)/);
    assert.match(save, /if \(!documentEdits\.markSaved\(saveVersion, savedId\)\) return null/);
    assert.ok(save.indexOf("isCurrentSave(saveVersion)") < save.indexOf("const saveMutation"));
    assert.ok(save.indexOf("isCurrentSave(savedVersion)") > save.indexOf("await refreshSaves()"));
    const pdf = initializer(domain, "buildPdfBlob");
    assert.doesNotMatch(pdf, /saveDraft|finalize|requestNavigation|markSaved/);
    assert.match(initializer(domain, "assistantDocument"), /documentEdits\.dirty\)/);
  });
}
