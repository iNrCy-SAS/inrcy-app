import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const reactSources = {
  react: packageSource("react", "react.development.js"),
  "react-dom": packageSource("react-dom", "react-dom.development.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
  scheduler: packageSource("scheduler", "scheduler.development.js"),
};

// Execute the actual owner statements in a normal mounted React function, as in
// the source pages. React itself owns state, commit timing and Effect Events.
function statements(path: string, names: string[], effectMarker: string) {
  const source = readFileSync(new URL(`../../app/dashboard/${path}`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(tree)))) selected.push(node.getText(tree));
    else if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === "useEffect" && node.getText(tree).includes(effectMarker)) selected.push(node.getText(tree));
    else ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(selected.length > names.length, "include actual request effect(s)");
  return selected.join("\n");
}

async function mount(page: Page, source: string, setup: string, propNames: string[], envNames: string[]) {
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  const subject = ts.transpileModule(`
    const { useEffect, useEffectEvent } = React;
    const { ${envNames.join(",")} } = env;
    return function Subject(props) {
      const { ${propNames.join(",")} } = props;
      ${source}
      useEffect(() => { globalThis.fixtureCommitted = props.tick; }, [props.tick]);
      return React.createElement("output", null, props.tick);
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(reactSources)},cache={},process={env:{NODE_ENV:'development'}};
    function load(name) { if(cache[name])return cache[name].exports; const module=cache[name]={exports:{}};
      new Function('require','module','exports','process',sources[name])(load,module,module.exports,process);return module.exports; }
    const React=load('react');window.props={};window.env={};window.requests=[];window.applied=[];window.counter=0;
    ${setup}
    const Subject=new Function('React','env',${JSON.stringify(subject)})(React,window.env);
    const root=load('react-dom/client').createRoot(document.getElementById('root'));
    window.render=()=>root.render(React.createElement(Subject,{...window.props,tick:++window.counter}));
    window.unmount=()=>root.unmount();window.render();
  ` });
  page.setDefaultTimeout(5_000);
  await page.waitForFunction("window.fixtureCommitted === window.counter");
}
async function update(page: Page, code: string) {
  await page.evaluate(`${code};window.render()`);
  await page.waitForFunction("window.fixtureCommitted === window.counter");
}

for (const area of ["devis", "factures"]) test(`${area}: React delayed defaults use current form values and later edits never reload defaults`, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const source = statements(`${area}/new/page.tsx`, ["onDocumentSettingsLoaded"], "const loadSettings");
    await mount(page, source, `
      window.props={searchParams:new URLSearchParams(),setDocumentsSettings(){},applyDocumentDefaults:()=>window.applied.push('initial VAT')};
      window.env={fetch:()=>new Promise(resolve=>window.requests.push(payload=>resolve(Response.json(payload)))),normalizeInrDocumentsSettings:value=>value,INRDOCUMENTS_SETTINGS_UPDATED_EVENT:'fixture-settings',window};
    `, ["searchParams", "setDocumentsSettings", "applyDocumentDefaults"], ["fetch", "normalizeInrDocumentsSettings", "INRDOCUMENTS_SETTINGS_UPDATED_EVENT", "window"]);
    await update(page, "window.props.applyDocumentDefaults=()=>window.applied.push('current VAT')");
    assert.equal(await page.evaluate("window.requests.length"), 1);
    await page.evaluate("window.requests[0]({settings:{}})");
    await page.waitForFunction("window.applied.length === 1");
    assert.deepEqual(await page.evaluate("window.applied"), ["current VAT"]);
    await update(page, "window.props.applyDocumentDefaults=()=>window.applied.push('overwritten edit')");
    assert.equal(await page.evaluate("window.requests.length"), 1);
    assert.equal(await page.evaluate("window.applied.length"), 1);
    await page.evaluate("window.unmount()");
  } finally { await browser.close(); }
});

test("React template selection preserves edits on same-key context updates and cancels superseded responses", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const source = statements("fideliser/components/informer/InformerModal.tsx", ["onTemplateSelectionChanged"], "[selected?.key]");
    await mount(page, source, `
      window.view={subject:'',text:''};
      window.props={selected:{key:'a',subject:'A',body:'A body'},restoredWorkflowKeyRef:{current:''},setAiContentGenerated(){},setSubject:value=>window.view.subject=value,setBody:value=>window.view.text=value,setBodyHtml(){}};
      window.env={fetch:()=>new Promise(resolve=>window.requests.push(payload=>resolve(Response.json(payload)))),textToRichMailHtml:text=>'<p>'+text+'</p>'};
    `, ["selected", "restoredWorkflowKeyRef", "setAiContentGenerated", "setSubject", "setBody", "setBodyHtml"], ["fetch", "textToRichMailHtml"]);
    await page.evaluate("window.requests[0]({subject:'rendered A',body_text:'rendered A body'})");
    await page.waitForFunction("window.view.subject === 'rendered A'");
    await update(page, "window.view.subject='professional edit';window.props.selected={key:'a',subject:'refreshed A',body:'refreshed body'}");
    assert.equal(await page.evaluate("window.view.subject"), "professional edit");
    assert.equal(await page.evaluate("window.requests.length"), 1);
    await update(page, "window.props.selected={key:'b',subject:'B',body:'B body'}");
    await update(page, "window.props.selected={key:'c',subject:'C',body:'C body'}");
    assert.equal(await page.evaluate("window.requests.length"), 3);
    await page.evaluate("window.requests[1]({subject:'obsolete B'});window.requests[2]({subject:'current C'})");
    await page.waitForFunction("window.view.subject === 'current C'");
    await page.evaluate("window.unmount()");
  } finally { await browser.close(); }
});

test("React campaign health updates do not loop; polling reads current metadata and stops at terminal status", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const source = statements("mails/MailboxClient.tsx", ["detailsItemId", "detailsItemSource", "detailsCampaignStatus", "onCampaignHealthRequested"], "onCampaignHealthRequested");
    await mount(page, source, `
      window.timers=new Map();window.serial=0;window.recipients=[];
      window.props={detailsItem:{id:'campaign-a',source:'mail_campaigns',raw:{status:'sending',revision:1}},detailsOpen:true,campaignReport:null,campaignRecipientsPage:1,campaignRecipientsFilter:'all',setCampaignReport(){},setCampaignHealth(){},setCampaignHealthLoading(){},loadCampaignHealth:async(id,raw)=>window.applied.push({id,revision:raw.revision}),loadCampaignRecipients:async(...args)=>window.recipients.push(args)};
      window.env={window:{setTimeout:fn=>{window.timers.set(++window.serial,fn);return window.serial},clearTimeout:id=>window.timers.delete(id)},document:{hidden:false,addEventListener(){},removeEventListener(){}}};
    `, ["detailsItem", "detailsOpen", "campaignReport", "campaignRecipientsPage", "campaignRecipientsFilter", "setCampaignReport", "setCampaignHealth", "setCampaignHealthLoading", "loadCampaignHealth", "loadCampaignRecipients"], ["window", "document"]);
    assert.equal(await page.evaluate("window.applied.length"), 1);
    const timerId = await page.evaluate("[...window.timers.keys()][0]");
    await update(page, "window.props.detailsItem={...window.props.detailsItem,raw:{status:'sending',revision:2}}");
    assert.equal(await page.evaluate("window.applied.length"), 1);
    assert.equal(await page.evaluate("[...window.timers.keys()][0]"), timerId);
    await page.evaluate("const [id,run]=[...window.timers][0];window.timers.delete(id);run()");
    await page.waitForFunction("window.applied.length === 2 && window.timers.size === 1");
    assert.deepEqual(await page.evaluate("window.applied[1]"), { id: "campaign-a", revision: 2 });
    await update(page, "window.props.campaignReport={status:'sent'}");
    assert.equal(await page.evaluate("window.timers.size"), 0);
    await update(page, "window.props.detailsItem={id:'campaign-b',source:'mail_campaigns',raw:{status:'sending',revision:3}};window.props.campaignReport=null");
    assert.deepEqual(await page.evaluate("window.applied[2]"), { id: "campaign-b", revision: 3 });
    await page.evaluate("window.unmount()");
    assert.equal(await page.evaluate("window.timers.size"), 0);
  } finally { await browser.close(); }
});

test("React scheduled-mail restoration uses current callbacks once and does not replay over subsequent edits", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const source = statements("mails/MailboxClient.tsx", ["onScheduledMailEditLoaded", "onScheduledMailEditLoadFailed", "onScheduledMailEditMissing"], 'get("scheduled_edit_id")');
    const setters = [...new Set(source.match(/\bset[A-Z]\w+/g))];
    await mount(page, source, `
      window.values={};window.routes=[];
      window.props={standardMode:false,searchParams:new URLSearchParams({scheduled_edit_id:'scheduled-a'}),scheduledMailEditLoadRef:{current:''},i18nT:key=>'fr:'+key,router:{replace:(...args)=>window.routes.push(args)},makeComposeSnapshot:value=>JSON.stringify(value)};
      for(const name of ${JSON.stringify(setters)})window.props[name]=value=>window.values[name]=value;
      window.env={fetch:()=>new Promise(resolve=>window.requests.push(payload=>resolve(Response.json(payload)))),asScheduledRecord:value=>value||{},normalizeMailSubject:value=>value,normalizeRichMailHtmlForSend:(_text,html)=>html,normalizeCampaignAttachments:value=>value||[],getClientUserFacingErrorMessage:(_error,fallback)=>fallback};
    `, ["standardMode", "searchParams", "scheduledMailEditLoadRef", "i18nT", "router", "makeComposeSnapshot", ...setters], ["fetch", "asScheduledRecord", "normalizeMailSubject", "normalizeRichMailHtmlForSend", "normalizeCampaignAttachments", "getClientUserFacingErrorMessage"]);
    await update(page, "window.props.i18nT=key=>'en:'+key;window.props.makeComposeSnapshot=value=>JSON.stringify({...value,currentCallback:true})");
    assert.equal(await page.evaluate("window.requests.length"), 1);
    await page.evaluate("window.requests[0]({scheduledAction:{payload:{campaign:{accountId:'mailbox-a',subject:'Scheduled subject',text:'Saved body',recipients:['test@example.invalid']}}}})");
    await page.waitForFunction("window.values.setComposeOpen === true");
    assert.equal(await page.evaluate("window.values.setSelectedAccountId"), "mailbox-a");
    assert.equal(await page.evaluate("window.values.setTo"), "test@example.invalid");
    assert.equal(await page.evaluate("JSON.parse(window.values.setLastSavedComposeSnapshot).currentCallback"), true);
    assert.ok(String(await page.evaluate("window.values.setToast")).startsWith("en:"));
    await update(page, "window.values.setSubject='professional edit';window.props.makeComposeSnapshot=value=>JSON.stringify({...value,laterEdit:true})");
    assert.equal(await page.evaluate("window.values.setSubject"), "professional edit");
    assert.equal(await page.evaluate("window.requests.length"), 1);
    assert.equal(await page.evaluate("window.routes.length"), 1);
    await page.evaluate("window.unmount()");
  } finally { await browser.close(); }
});
