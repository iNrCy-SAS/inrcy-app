import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
type MailFixture = Window & {
  block: string; stage: string; done: boolean; account: string;
  run: () => Promise<void>; load: (id: string) => void; change: () => void; locale: () => void;
  state: { id: string; form: { clientName: string }; dirty: boolean; locale: string };
};
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
function initializer(domain: string, name: string) {
  const source = read(`app/dashboard/${domain}/new/page.tsx`);
  const tree = ts.createSourceFile(domain, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Expression | undefined;
  const walk = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) found = node.initializer; ts.forEachChild(node, walk); };
  walk(tree); assert.ok(found, `${domain}.${name} exists`); return found.getText(tree);
}
const sources = {
  react: packageSource("react", "react.development.js"),
  "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
  "react-dom": packageSource("react-dom", "react-dom.development.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
  scheduler: packageSource("scheduler", "scheduler.development.js"),
  edits: compile(read("app/dashboard/_hooks/useDocumentUnsavedChanges.ts")),
  preview: compile(read("app/dashboard/_hooks/useInrAssistantDocumentPreview.ts")),
  prepare: compile(read("app/dashboard/_documents/documentMailPreparation.ts")),
};

async function mount(page: Page, domain: string) {
  await page.route("**/*", route => route.request().url() === "https://document-mail.invalid/"
    ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
  await page.goto("https://document-mail.invalid/");
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},cache={},process={env:{NODE_ENV:'development'}};
    window.account='account-A';window.events=[];window.block='';window.stage='';window.navigations=[];
    const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    async function checkpoint(name){window.events.push(name);window.stage=name;if(window.block===name)await new Promise(resolve=>window.release=resolve);}
    function load(name){
      if(name==='@/lib/browserAccountCache')return{getActiveBrowserUserId:()=>window.account};
      if(name==='@/lib/inrcyDialog')return{confirmInrcy:async()=>false};
      if(name.endsWith('DashboardUnsavedNavigationProvider'))return{useDashboardUnsavedNavigation:()=>({registerGuard:()=>()=>{},requestNavigation:async action=>{await checkpoint('navigation');action();return true;}})};
      if(name.endsWith('DashboardAssistantScreenContext'))return{useInrAssistantScreen:()=>{}};
      if(cache[name])return cache[name].exports;
      if(!sources[name])throw Error('Unexpected import '+name);
      const module=cache[name]={exports:{}};
      new Function('require','module','exports','process',sources[name])(load,module,module.exports,process);return module.exports;
    }
    const React=load('react'),guard=load('edits').useDocumentUnsavedChanges,previewHook=load('preview').useInrAssistantDocumentPreview;
    const prepareDocumentMail=load('prepare').prepareDocumentMail;
    const handlerSource=${JSON.stringify(compile("return " + initializer(domain, "uploadPdfAndOpenCompose")))};
    function Editor(){
      const [id,setId]=React.useState('A'),[form,setForm]=React.useState({number:'TEMP',status:'brouillon',clientName:'Client A'});
      const [finalized,setFinalized]=React.useState(false),[locale,setLocale]=React.useState('fr');
      const documentEdits=guard(id,form),assistantDocument=previewHook(${JSON.stringify(domain === "devis" ? "quote" : "invoice")},id,{...form,isFinalized:finalized,finalizedAt:finalized?'date':'',locale},documentEdits.dirty);
      const saveDraft=async options=>{
        const version=documentEdits.captureSave({number:form.number||'TEMP'}),savedId=id||'NEW';
        await checkpoint('save');
        if(!documentEdits.markSaved(version,savedId))return null;
        setId(savedId);options.onSavedVersion({...version,documentId:savedId});
        if(options.asFinalized)setFinalized(true);
        await tick();return savedId;
      };
      const finalizeInvoice=async docSaveId=>{
        await checkpoint('finalize');
        if(!documentEdits.isCurrentSave({...documentEdits.captureSave(),documentId:docSaveId}))return null;
        documentEdits.markPersistedFields(documentEdits.captureSave(),{number:'OFFICIAL',status:'envoye'});
        setForm(previous=>({...previous,number:'OFFICIAL',status:'envoye'}));setFinalized(true);await tick();
        return{number:'OFFICIAL',status:'envoye'};
      };
      const context={documentEdits,assistantDocument,saveDraft,finalizeInvoice,prepareDocumentMail,
        supabase:{auth:{getUser:async()=>{await checkpoint('auth');return{data:{user:{id:'actor'}},error:null}}},storage:{from:()=>({upload:async(key,pdf,options)=>{window.upload={key,type:pdf.type,options};await checkpoint('upload');return{error:null}}})}},
        resolveActiveBrowserUserId:()=>window.account,setFormMessage:message=>window.message=message,setFinalizing:()=>{},
        waitForDomUpdate:async()=>{await checkpoint('dom');await tick()},
        buildPdfBlob:async()=>{await checkpoint('pdf');return new Blob(['%PDF-test'],{type:window.invalidPdf?'text/plain':'application/pdf'})},
        buildDocumentMailTexts:(kind,prefs,client,number)=>({subject:kind+' '+number,text:client}),clientExchangePreferences:{},clientName:form.clientName,
        status:form.status,ATTACH_BUCKET:'mail-attachments',router:{push:path=>window.navigations.push(path)},i18nT:key=>key,
      };
      const run=new Function(...Object.keys(context),handlerSource)(...Object.values(context));
      React.useLayoutEffect(()=>{
        window.state={id,form,dirty:documentEdits.dirty,locale};window.run=()=>run('client@example.test','document.pdf');
        window.change=()=>setForm(previous=>({...previous,clientName:'Edited'}));window.locale=()=>setLocale('en');
        window.load=nextId=>{documentEdits.markHydrated();setId(nextId);setForm({number:'TEMP',status:'brouillon',clientName:'Client '+nextId});setFinalized(false)};
      });
      return React.createElement('output',null,id);
    }
    const root=load('react-dom/client').createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();root.render(React.createElement(Editor));
  ` });
  page.setDefaultTimeout(5000);
  await page.waitForFunction("!!window.run");
}

for (const domain of ["devis", "factures"]) {
  test(`${domain}: native save/finalize then preparation opens exactly the matching PDF composer, including a new document`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
      await mount(page, domain); await page.evaluate("window.load('')"); await page.waitForFunction("window.state.id===''");
      await page.evaluate("window.run()");
      const result = await page.evaluate("({paths:window.navigations,upload:window.upload,events:window.events,state:window.state})") as {
        paths: string[]; upload: { key: string; options: { upsert: boolean } }; state: { dirty: boolean };
      };
      assert.equal(result.paths.length, 1); const params = new URL(result.paths[0], "https://fixture.invalid").searchParams;
      assert.equal(params.get("docSaveId"), "NEW"); assert.equal(params.get("docType"), domain === "devis" ? "devis" : "facture");
      assert.equal(params.get("docNumber"), domain === "devis" ? "TEMP" : "OFFICIAL");
      assert.equal(params.get("to"), "client@example.test"); assert.equal(params.get("attachKey"), result.upload.key);
      assert.match(result.upload.key, new RegExp(`^account-A/${domain === "devis" ? "devis" : "factures"}/`));
      assert.equal(result.upload.options.upsert, false); assert.equal(result.state.dirty, false); assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });

  test(`${domain}: document, account, local edits and PDF preferences changing during awaits never open a mismatched composer`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const stages = ["auth", "save", ...(domain === "factures" ? ["finalize"] : []), "dom", "pdf", "upload", "navigation"];
      for (const stage of stages) for (const change of ["document", "account", "edit", "preferences"]) {
        const page = await browser.newPage(); await mount(page, domain);
        await page.evaluate(stage => { const w = window as MailFixture; w.block = stage; void w.run().then(() => { w.done = true; }); }, stage);
        await page.waitForFunction(stage => (window as MailFixture).stage === stage, stage);
        await page.evaluate(change => { const w = window as MailFixture; if (change === "document") w.load("B"); else if (change === "account") w.account = "account-B"; else if (change === "edit") w.change(); else w.locale(); }, change);
        if (change !== "account") await page.waitForFunction(change => { const s = (window as MailFixture).state; return change === "document" ? s.id === "B" : change === "edit" ? s.form.clientName === "Edited" : s.locale === "en"; }, change);
        await page.evaluate("window.release()"); await page.waitForFunction("window.done");
        assert.deepEqual(await page.evaluate("window.navigations"), [], `${domain}/${stage}/${change}`);
        if (["auth", "save", "finalize", "dom", "pdf"].includes(stage)) assert.equal(await page.evaluate("window.events.includes('upload')"), false, `${domain}/${stage}/${change}: no stale upload`);
        await page.close();
      }
    } finally { await browser.close(); }
  });
}

test("the reusable preparation has no save/finalize/send dependency and refuses non-PDF output", async () => {
  const subject = { exports: {} as typeof import("../../app/dashboard/_documents/documentMailPreparation.ts") };
  new Function("module", "exports", sources.prepare)(subject, subject.exports);
  let uploads = 0, navigations = 0;
  const options: Parameters<typeof subject.exports.prepareDocumentMail>[0] = { accountId: "A", documentId: "D", kind: "devis", number: "N", filename: "N.pdf", recipient: "c@example.test", clientName: "C", subject: "S", text: "T", isCurrent: () => true,
    buildPdf: async () => new Blob(["html"], { type: "text/html" }), upload: async () => { uploads++; return { error: null }; }, requestNavigation: async (fn: () => void) => { fn(); return true; }, navigate: () => { navigations++; } };
  assert.equal(await subject.exports.prepareDocumentMail(options), "pdf_failed"); assert.equal(uploads, 0); assert.equal(navigations, 0);
  assert.equal(await subject.exports.prepareDocumentMail({ ...options, recipient: "invalid" }), "invalid_recipient");
});
