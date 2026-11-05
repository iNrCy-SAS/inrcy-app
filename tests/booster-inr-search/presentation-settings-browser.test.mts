import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const messages = JSON.parse(read("messages/fr-FR/dashboard.json")).inrSearchPresentation;
function clientLibSources(entry: string, output: Record<string, string> = {}) {
  const key = "@/lib/" + entry; if (output[key]) return output; const file = "lib/" + entry + ".ts", raw = read(file); output[key] = compile(file);
  const ast = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) { const name = node.moduleSpecifier.text; if (name.startsWith("./") && name.endsWith(".ts")) clientLibSources(name.slice(2, -3), output); }
  return output;
}
const componentModules = {
  react: packageSource("react", "react.production.js"),
  "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"),
  scheduler: packageSource("scheduler", "scheduler.production.js"),
  subject: compile("app/dashboard/settings/_components/InrSearchPresentationSettings.tsx"),
  "@/lib/inrSearchDisplaySettings": compile("lib/inrSearchDisplaySettings.ts"),
  "@/lib/multicompte/constants": compile("lib/multicompte/constants.ts"),
  "../../_hooks/useInrAssistantLocalInterface": compile("app/dashboard/_hooks/useInrAssistantLocalInterface.ts"),
  ...clientLibSources("inrAssistantLocalInterface"),
};
const css = read("app/dashboard/settings/_components/InrSearchPresentationSettings.module.css");
const fixture = `
  const sources=${JSON.stringify(componentModules)},messages=${JSON.stringify(messages)},loaded={};
  window.account='account-a';window.calls={dirty:false,routes:[]};
  function require(name){
    if(name.startsWith('./')&&name.endsWith('.ts'))name='@/lib/'+name.slice(2,-3);
    if(name.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
    if(name==='next-intl')return{useTranslations:()=>window.translate};
    if(name==='next/navigation')return{useRouter:()=>({push:path=>window.calls.routes.push(path)}),usePathname:()=>'/dashboard'};
    if(name.endsWith('DashboardViewerAccessProvider'))return{useDashboardViewerAccess:()=>({actorUserId:'actor-a',activeAccountId:window.account})};
    if(name==='@/lib/browserAccountCache')return{getActiveBrowserUserId:()=>window.account};
    if(name.endsWith('DashboardUnsavedNavigationProvider'))return{useDashboardUnsavedNavigation:()=>({requestNavigation:async fn=>{if(!window.calls.dirty)fn()}})};
    if(loaded[name])return loaded[name].exports;
    if(!sources[name])throw Error('Unexpected presentation fixture import '+name);
    const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;
  }
  window.translate=key=>{if(typeof messages[key]!=='string')throw Error('Missing presentation translation '+key);return messages[key]};
  const React=require('react'),Component=require('subject').default,root=require('react-dom/client').createRoot(document.getElementById('root'));
  root.render(React.createElement(Component,{onDirtyChange:value=>window.calls.dirty=value}));
  window.switchAccount=account=>{window.account=account;window.dispatchEvent(new Event('inrcy:active-account-changed'))};
  window.nativeHints=()=>require('@/lib/inrAssistantLocalInterface').getInrAssistantLocalInterfaceHints({actorUserId:'actor-a',accountId:window.account,pathname:'/dashboard'});
  window.runNative=(operation,value=null,revision)=>{const native=require('@/lib/inrAssistantLocalInterface'),scope={actorUserId:'actor-a',accountId:window.account,pathname:'/dashboard'},hint=window.nativeHints()?.find(hint=>hint.id==='search_presentation');if(!hint)return Promise.resolve(false);return native.runInrAssistantLocalInterface({command:'control_local_interface',selection:{kind:'account_document',id:'search_presentation'},operation,value,revision:revision||hint.revision},scope,()=>scope.accountId===window.account)};
`;

async function setup(page: Page, failedInitialReads = 0) {
  const writes: Record<string, unknown>[] = [];
  const pageErrors: string[] = [];
  let accountId = "account-a";
  let failNextPost = false;
  let pendingPost: (() => void) | null = null;
  let holdPost = false;
  let reads = 0;
  const policy = new Function("require", "module", "exports", componentModules["@/lib/inrSearchDisplaySettings"]);
  const settingsModule = { exports: {} as Record<string, unknown> };
  policy(require, settingsModule, settingsModule.exports);
  const initial = () => ({ display: structuredClone(settingsModule.exports.DEFAULT_INR_SEARCH_DISPLAY_SETTINGS), sections: structuredClone(settingsModule.exports.DEFAULT_INR_SEARCH_SECTIONS), pageTitleOverride: "", pageDescriptionOverride: "" });
  const records = new Map<string, Record<string, unknown>>([["account-a", initial()], ["account-b", initial()]]);
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("https://inrcy-fixture.test/**", async route => {
    if (new URL(route.request().url()).pathname !== "/api/inr-search/settings") {
      await route.fulfill({ contentType: "text/html", body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}*{box-sizing:border-box}body{margin:0;background:#091126;color:#edf4ff;font:16px Arial}#root{padding:16px}</style></head><body><div id="root"></div></body></html>` });
      return;
    }
    const requestedAccount = accountId;
    if (route.request().method() === "GET" && ++reads <= failedInitialReads) { await route.fulfill({ status: 503, json: { ok: false } }); return; }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      if (holdPost) await new Promise<void>(resolve => { pendingPost = resolve; });
      if (failNextPost) { failNextPost = false; await route.fulfill({ status: 503, json: { ok: false } }).catch(() => {}); return; }
      records.set(requestedAccount, { display: body.display, sections: body.sections, pageTitleOverride: body.pageTitleOverride, pageDescriptionOverride: body.pageDescriptionOverride });
    }
    await route.fulfill({ json: { ok: true, accountId: requestedAccount, inrSearch: records.get(requestedAccount) } }).catch(() => {});
  });
  await page.goto("https://inrcy-fixture.test/settings");
  await page.addScriptTag({ content: fixture });
  if (failedInitialReads) await page.getByRole("alert").waitFor(); else await page.getByRole("switch", { name: messages.phone, exact: true }).waitFor();
  page.setDefaultTimeout(5000);
  return { writes, pageErrors,
    failNext() { failNextPost = true; },
    block() { holdPost = true; },
    release() { holdPost = false; pendingPost?.(); pendingPost = null; },
    async changeAccount() { accountId = "account-b"; await page.evaluate("window.switchAccount('account-b')"); },
  };
}

test("Basic real iNrSearch native tab controls preserve unsaved presentation and retry only a completed successful native read", async () => {
  const browser = await chromium.launch({ headless: true }); try {
    const page = await browser.newPage(), h = await setup(page); await page.waitForFunction("window.nativeHints()?.some(hint=>hint.id==='search_presentation')");
    await page.getByRole("switch", { name: messages.phone, exact: true }).uncheck(); assert.equal(await page.evaluate("window.runNative('select','texts')"), true); assert.equal(await page.getByRole("tab", { name: messages.textsTab, exact: true }).getAttribute("aria-selected"), "true");
    await page.getByRole("textbox", { name: messages.pageTitle }).fill("Keep this unsaved title"); assert.equal(await page.evaluate("window.runNative('select','contact')"), true); assert.equal(await page.getByRole("switch", { name: messages.phone, exact: true }).isChecked(), false);
    const old = await page.evaluate("window.nativeHints().find(hint=>hint.id==='search_presentation').revision") as string; await page.getByRole("tab", { name: messages.sectionsTab, exact: true }).click(); assert.equal(await page.evaluate(revision => (window as unknown as { runNative: (op: string, value: string, revision: string) => Promise<boolean> }).runNative("select", "texts", revision), old), false);
    assert.equal(await page.evaluate("window.runNative('select','invented')"), false); assert.equal(await page.evaluate("window.runNative('select','texts')"), true); assert.equal(await page.getByRole("textbox", { name: messages.pageTitle }).inputValue(), "Keep this unsaved title"); assert.equal(h.writes.length, 0); assert.equal(await page.evaluate("window.calls.dirty"), true); assert.deepEqual(h.pageErrors, []); await page.close();
    for (const failures of [1, 2]) { const retryPage = await browser.newPage(), retry = await setup(retryPage, failures); await retryPage.waitForFunction("window.nativeHints()?.some(hint=>hint.id==='search_presentation')"); assert.equal(await retryPage.evaluate("window.runNative('retry')"), failures === 1); assert.equal(retry.writes.length, 0); assert.deepEqual(retry.pageErrors, []); await retryPage.close(); }
  } finally { await browser.close(); }
});

test("iNrSearch presentation saves explicit choices, keeps all tabs usable and isolates an in-flight account switch", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const h = await setup(page);
      const save = page.getByRole("button", { name: messages.save, exact: true });
      assert.equal(await save.isDisabled(), true);
      await page.getByRole("switch", { name: messages.phone, exact: true }).uncheck();
      assert.equal(await page.evaluate("window.calls.dirty"), true);
      assert.equal(h.writes.length, 0, "Toggles do not publish partially edited presentation settings");
      await save.click();
      await page.getByRole("status").filter({ hasText: messages.saved }).waitFor();
      assert.equal(h.writes[0].action, "presentation");
      assert.equal(h.writes[0].accountId, "account-a");
      assert.equal((h.writes[0].display as Record<string, unknown>).phone, false);
      assert.equal(await page.evaluate("window.calls.dirty"), false);
      await page.getByRole("tab", { name: messages.sectionsTab, exact: true }).click();
      assert.equal(await page.getByRole("switch").count(), 13);
      await page.getByRole("switch", { name: messages.media, exact: true }).uncheck();
      await save.click();
      await page.getByRole("status").filter({ hasText: messages.saved }).waitFor();
      assert.equal((h.writes[1].sections as Record<string, unknown>).media, false);
      await page.getByRole("tab", { name: messages.sectionsTab, exact: true }).press("ArrowRight");
      const texts = page.getByRole("tab", { name: messages.textsTab, exact: true });
      assert.equal(await texts.getAttribute("aria-selected"), "true");
      assert.equal(await texts.evaluate(element => element === document.activeElement), true);
      await page.getByRole("textbox", { name: messages.pageTitle }).fill("Mon atelier près de chez vous");
      await page.getByRole("textbox", { name: messages.pageDescription }).fill("Une présentation personnalisée de mon activité.");
      h.failNext();
      await save.click();
      await page.getByRole("alert").filter({ hasText: messages.saveFailed }).waitFor();
      assert.equal(await page.evaluate("window.calls.dirty"), true, "Failure retains edited text and dirty state");
      await save.click();
      await page.getByRole("status").filter({ hasText: messages.saved }).waitFor();
      assert.equal(h.writes[3].pageTitleOverride, "Mon atelier près de chez vous");
      await page.getByRole("textbox", { name: messages.pageTitle }).fill("");
      await page.getByRole("textbox", { name: messages.pageDescription }).fill("");
      await save.click();
      await page.getByRole("status").filter({ hasText: messages.saved }).waitFor();
      assert.equal(h.writes[4].pageTitleOverride, "", "Empty override restores automatic ADN titles");
      for (const name of [messages.contactTab, messages.sectionsTab, messages.textsTab]) {
        await page.getByRole("tab", { name, exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} stays within the ${width}px screen`);
        const evidence = process.env.INRCY_SEARCH_PRESENTATION_EVIDENCE_DIR;
        if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, `search-settings-${width}-${name === messages.contactTab ? "contact" : name === messages.sectionsTab ? "sections" : "texts"}.png`), fullPage: true }); }
      }
      await page.getByRole("tab", { name: messages.contactTab, exact: true }).click();
      await page.getByRole("switch", { name: messages.email, exact: true }).uncheck();
      h.block();
      await save.click();
      await page.waitForFunction(() => document.querySelector('[aria-busy="true"]'));
      await h.changeAccount();
      await page.waitForFunction(label => [...document.querySelectorAll("label")].some(node => node.textContent === label && node.querySelector("input")?.checked === true), messages.phone);
      h.release();
      assert.equal(await page.getByRole("switch", { name: messages.email, exact: true }).isChecked(), true);
      assert.equal(await page.getByRole("switch", { name: messages.phone, exact: true }).isChecked(), true, "The previous account's hidden phone cannot leak into this account's settings");
      assert.equal(await save.isDisabled(), true);
      assert.deepEqual(h.pageErrors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
