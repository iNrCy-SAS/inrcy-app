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
function initializer(domain: string) {
  const source = read(`app/dashboard/${domain}/new/page.tsx`), tree = ts.createSourceFile(domain, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let value: ts.Expression | undefined;
  const walk = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "saveAsTemplate") value = node.initializer; ts.forEachChild(node, walk); }; walk(tree);
  assert.ok(value); return value.getText(tree);
}
const sources = {
  react: packageSource("react", "react.development.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
  "react-dom": packageSource("react-dom", "react-dom.development.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"), scheduler: packageSource("scheduler", "scheduler.development.js"),
  hook: compile(read("app/dashboard/_hooks/useInrAssistantDocumentTemplate.ts")), preview: compile(read("app/dashboard/_hooks/useInrAssistantDocumentPreview.ts")),
  persistence: compile(read("app/dashboard/_documents/documentTemplatePersistence.ts")), template: compile(read("lib/commercialDocumentTemplate.ts")),
};
async function mount(page: Page, domain: "devis" | "factures", saved = false) {
  page.on("pageerror", error => console.error("template fixture browser error:", error.message));
  await page.route("**/*", route => route.request().url() === "https://template.invalid/" ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
  await page.goto("https://template.invalid/");
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},cache={},process={env:{NODE_ENV:'development'}};
    window.account='A';window.handlers=new Map();window.events=[];window.writes=[];window.stage='';window.block='';window.accept=true;window.refreshCount=0;
    const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    async function checkpoint(stage){window.stage=stage;window.events.push(stage);if(window.block===stage)await new Promise(resolve=>window.release=resolve);}
    function load(name){
      if(name==='next/navigation')return{usePathname:()=>'/dashboard/${domain}/new'};
      if(name==='@/lib/browserAccountCache')return{getActiveBrowserUserId:()=>window.account};
      if(name.endsWith('DashboardAssistantCommandContext'))return{DashboardAssistantCommandContext:window.context};
      if(name.endsWith('DashboardAssistantScreenContext'))return{useInrAssistantScreen:value=>window.screen=value};
      if(cache[name])return cache[name].exports;if(!sources[name])throw Error(name);
      const mod=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(load,mod,mod.exports,process);return mod.exports;
    }
    const React=load('react');window.context=React.createContext((key,value)=>value?window.handlers.set(key,value):window.handlers.delete(key));
    const useTemplate=load('hook').useInrAssistantDocumentTemplate,preview=load('preview').useInrAssistantDocumentPreview,persist=load('persistence').persistDocumentTemplate;
    const defaults={clientName:'PRIVATE',providerOverride:{name:'Provider'},vatDispense:false,operationCategory:'service',serviceDateMode:'period',serviceDate:'2026-10-01',servicePeriodStart:'2026-10-01',servicePeriodEnd:'2026-10-31',purchaseOrderReference:'PO',depositKind:'percent',depositValue:'25',paymentMethod:'transfer',paymentDetails:'BANK',notes:'Note',quoteMention:'Quote terms',validityDays:30,vatOnDebits:false,lateFeeRate:5,fixedRecoveryFee40:true,documentKind:'invoice',invoiceMention:'Invoice terms',lines:[{id:'source-line',label:'Service',qty:2,unitPrice:90,vatRate:20,details:'Details'}],discountKind:'percent',discountValue:'5',discountDetails:'Discount'};
    function Editor(){
      const[id,setId]=React.useState(${saved ? "'saved_A'" : "''"}),[form,setForm]=React.useState(defaults),[nonce,setNonce]=React.useState(0);
      const assistantDocument=preview('${domain === "devis" ? "quote" : "invoice"}',id,form,true);
      const context={...form,assistantDocument,getActiveBrowserUserId:()=>window.account,i18nT:key=>key,
        hasReusableDocumentLine:lines=>lines.some(line=>line.label.trim()&&line.qty>0&&line.unitPrice>=0),
        cloneDocumentLines:lines=>lines.map((line,index)=>({...line,id:'copy_'+index})),prepareTemplateSnapshot:load('template').prepareCommercialTemplateSnapshot,
        promptInrcy:async()=>{await checkpoint('prompt');return window.accept?'Mensuel':null},confirmInrcy:async()=>{await checkpoint('confirm');return window.accept},
        setFieldErrors:()=>{},setFormMessage:value=>window.message=value,setDocumentsTab:value=>window.tab=value,setDraftsOpen:value=>window.templatesOpen=value,
        refreshSaves:()=>{window.refreshCount++;return new Promise(()=>{})},
        persistDocumentTemplate:options=>persist({...options,fetcher:async(url,init)=>{
          const body=JSON.parse(init.body);window.writes.push(body);window.headers=init.headers;await checkpoint('fetch');if(window.networkError)throw Error('fixture');
          return{ok:!window.invalid,status:window.invalid?503:200,json:async()=>{await checkpoint('json');return{ok:!window.invalid,status:'created',id:'11111111-1111-4111-8111-111111111111',kind:body.kind,name:window.wrongName?'OTHER':body.name,documentCreated:false}}};
        }}),
      };
      const create=new Function(...Object.keys(context),${JSON.stringify(compile("return " + initializer(domain)))})(...Object.values(context));
      useTemplate({selection:assistantDocument.selection,revision:assistantDocument.revision,create:(templateName,stillCurrent,started)=>create({templateName,stillCurrent,started})});
      React.useLayoutEffect(()=>{window.state={id,form,nonce};window.edit=()=>setForm(previous=>({...previous,notes:'Changed'}));window.changeDocument=()=>{setId('B');setForm({...defaults,clientName:'B'})};window.rerender=()=>setNonce(n=>n+1);window.native=()=>create();
        window.run=async()=>{const handler=[...window.handlers.values()][0];window.result=await handler.run(()=>true,{command:'create_document_template',selection:assistantDocument.selection,revision:assistantDocument.revision,templateName:'Mensuel'},()=>true);window.done=true;};});
      return React.createElement('output',null,id);
    }
    const root=load('react-dom/client').createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();root.render(React.createElement(Editor));
  ` });
  page.setDefaultTimeout(5000); await page.waitForFunction("!!window.state && window.handlers.size===1");
}
for (const domain of ["devis", "factures"] as const) {
  test(`${domain}: native handler confirms then persists saved or unsaved form without changing fields; ACK does not wait for history`, async () => {
    const browser = await chromium.launch({ headless: true });
    try { for (const saved of [false, true]) {
      const page = await browser.newPage(); await mount(page, domain, saved); const before = await page.evaluate("JSON.stringify(window.state)");
      await page.evaluate("void window.run()"); await page.waitForFunction("window.done");
      assert.equal(await page.evaluate("window.result"), true); assert.equal(await page.evaluate("JSON.stringify(window.state)"), before);
      const writes = await page.evaluate("window.writes") as { snapshot: Record<string, unknown>; operation: string; source: string; kind: string }[];
      assert.equal(writes.length, 1); assert.equal(writes[0].operation, "create"); assert.equal(writes[0].source, "form");
      assert.equal(writes[0].snapshot.clientName, ""); assert.equal(writes[0].snapshot.number, ""); assert.equal(writes[0].snapshot.isFinalized, false);
      assert.equal(writes[0].snapshot.serviceDate, ""); assert.equal(writes[0].snapshot.servicePeriodEnd, "2026-10-31"); assert.equal(writes[0].snapshot.discountValue, 5);
      assert.equal(writes[0].snapshot[domain === "devis" ? "quoteMention" : "invoiceMention"], domain === "devis" ? "Quote terms" : "Invoice terms");
      assert.equal(await page.evaluate("window.refreshCount"), 1); assert.doesNotMatch(await page.evaluate("JSON.stringify(window.screen)"), /PRIVATE|unitPrice|BANK/);
      await page.evaluate("window.done=false;void window.run()"); await page.waitForFunction("window.done"); assert.equal(await page.evaluate("window.result"), false); assert.equal(await page.evaluate("window.writes.length"), 1); await page.close();
    } } finally { await browser.close(); }
  });
  test(`${domain}: cancellation is inert and can be reconsidered; duplicate delivery while confirming is inert`, async () => {
    const browser = await chromium.launch({ headless: true });
    try { const page = await browser.newPage(); await mount(page, domain);
      await page.evaluate("window.accept=false;void window.run()"); await page.waitForFunction("window.done"); assert.equal(await page.evaluate("window.writes.length"), 0);
      await page.evaluate("window.accept=true;window.block='confirm';window.done=false;void window.run()"); await page.waitForFunction("window.stage==='confirm'&&typeof window.release==='function'");
      await page.evaluate("void window.run()"); await page.waitForFunction("window.done"); assert.equal(await page.evaluate("window.result"), false);
      await page.evaluate("window.done=false;window.release()"); await page.waitForFunction("window.done"); assert.equal(await page.evaluate("window.result"), true); assert.equal(await page.evaluate("window.writes.length"), 1);
    } finally { await browser.close(); }
  });
  test(`${domain}: changes during confirmation/transport/readback invalidate results and never replace another form`, async () => {
    const browser = await chromium.launch({ headless: true });
    try { for (const stage of ["confirm", "fetch", "json"]) for (const change of ["edit", "account", "document", "unmount"]) {
      const page = await browser.newPage(); await mount(page, domain); await page.evaluate(stage => { const w = window as unknown as { block: string; run(): void }; w.block = stage; void w.run(); }, stage);
      await page.waitForFunction(stage => (window as unknown as { stage: string }).stage === stage, stage);
      await page.evaluate(change => { const w = window as unknown as { account: string; edit(): void; changeDocument(): void; unmount(): void }; if (change === "account") w.account = "B"; else if (change === "edit") w.edit(); else if (change === "document") w.changeDocument(); else w.unmount(); }, change);
      await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); await page.evaluate("window.release()"); await page.waitForFunction("window.done");
      assert.equal(await page.evaluate("window.result"), false, `${stage}/${change}`); assert.equal(await page.evaluate("window.writes.length"), stage === "confirm" ? 0 : 1); assert.equal(await page.evaluate("!!window.templatesOpen"), false); await page.close();
    } } finally { await browser.close(); }
  });
  test(`${domain}: transport error, invalid receipt and changed name cannot ACK or cause automatic replay`, async () => {
    const browser = await chromium.launch({ headless: true });
    try { for (const failure of ["networkError", "invalid", "wrongName"]) {
      const page = await browser.newPage(); await mount(page, domain); await page.evaluate(failure => { (window as unknown as Record<string, unknown>)[failure] = true; }, failure);
      await page.evaluate("void window.run()"); await page.waitForFunction("window.done"); assert.equal(await page.evaluate("window.result"), false);
      await page.evaluate("window.done=false;window.rerender()"); await page.waitForFunction("window.state.nonce===1"); await page.evaluate("void window.run()"); await page.waitForFunction("window.done");
      assert.equal(await page.evaluate("window.result"), false); assert.equal(await page.evaluate("window.writes.length"), 1); await page.close();
    } } finally { await browser.close(); }
  });
  test(`${domain}: native name prompt protects local edits too`, async () => {
    const browser = await chromium.launch({ headless: true });
    try { const page = await browser.newPage(); await mount(page, domain); await page.evaluate("window.block='prompt';void window.native().then(result=>{window.result=result;window.done=true})");
      await page.waitForFunction("window.stage==='prompt'"); await page.evaluate("window.edit()"); await page.waitForFunction("window.state.form.notes==='Changed'"); await page.evaluate("window.release()"); await page.waitForFunction("window.done");
      assert.equal(await page.evaluate("window.result"), false); assert.equal(await page.evaluate("window.writes.length"), 0);
    } finally { await browser.close(); }
  });
}
