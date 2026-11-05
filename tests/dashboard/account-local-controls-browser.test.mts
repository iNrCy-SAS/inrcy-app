import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url), repo = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) => readFileSync(resolve(repo, file), "utf8");
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources: Record<string, string> = { react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"), "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js") };
const links: Record<string, Record<string, string>> = {};
function add(file: string) {
  const id = file.replaceAll("\\", "/"); if (sources[id]) return id;
  const raw = readFileSync(file, "utf8"); sources[id] = ts.transpileModule(raw, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText; links[id] = {};
  const ast = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
    const name = node.moduleSpecifier.text;
    if (name.endsWith(".css") || ["@/lib/supabaseClient", "@/lib/browserAccountCache", "@/lib/inrcyDialog", "@/lib/clientSubscriptionBilling"].includes(name)) continue;
    const base = name.startsWith("@/") ? resolve(repo, name.slice(2)) : name.startsWith(".") ? resolve(dirname(file), name) : "";
    if (!base || !base.replaceAll("\\", "/").includes("/lib/") && !base.includes("useInrAssistantLocalInterface")) continue;
    const target = [base, base + ".ts", base + ".tsx"].find(path => existsSync(path)); assert.ok(target, name); links[id][name] = add(target);
  }
  return id;
}
const components = Object.fromEntries(["InertiaContent", "BoutiqueContent", "SubscriptionInvoicesPanel", "SubscriptionWorkspace"].map(name => [name, add(resolve(repo, `app/dashboard/settings/_components/${name}.tsx`))]));
const nativeModule = add(resolve(repo, "lib/inrAssistantLocalInterface.ts"));
const messages = { settings: JSON.parse(read("messages/fr-FR/settings.json")), shell: JSON.parse(read("messages/fr-FR/shell.json")) };
const fixture = `
const sources=${JSON.stringify(sources)},links=${JSON.stringify(links)},components=${JSON.stringify(components)},messages=${JSON.stringify(messages)},nativeModule=${JSON.stringify(nativeModule)},loaded={},process={env:{}};
window.account='account-a';window.actor='actor-a';window.ordersReads=0;window.failOrders=false;window.routes=[];window.errors=[];window.addEventListener('error',event=>window.errors.push(String(event.error?.stack||event.message)));
const translated={};function translate(namespace){return translated[namespace]??=(key,values={})=>String(messages[namespace]?.[key]??key).replace(/\\{(\\w+)\\}/g,(_,name)=>values[name]??'')}
const client={auth:{getUser:async()=>({data:{user:{id:window.actor}}})},from(table){const query={select(){return query},eq(){return query},order(){return query},limit(){return query},async maybeSingle(){return{data:table==='profiles'?{role:'user'}:{balance:12},error:null}},then(done){if(table==='boutique_orders')window.ordersReads++;const value={data:table==='boutique_orders'?[{id:'native-order',product_key:'synthetic',product_name:'Synthetic existing order',method:'EUR',status:'processed',created_at:'2026-11-05T10:00:00Z'}]:[],error:table==='boutique_orders'&&window.failOrders?{message:'Native order read failed'}:null};return Promise.resolve(value).then(done)}};return query}};
function load(id){if(loaded[id])return loaded[id].exports;const module=loaded[id]={exports:{}};const localRequire=name=>{
 if(name==='react'||name==='react/jsx-runtime'||name==='react-dom'||name==='react-dom/client'||name==='scheduler')return load(name);
 if(name.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(name==='next-intl')return{useTranslations:namespace=>translate(namespace),useLocale:()=> 'fr-FR'};
 if(name==='next/navigation')return{usePathname:()=>'/dashboard',useRouter:()=>({push:path=>window.routes.push(path)})};
 if(name.endsWith('DashboardViewerAccessProvider'))return{useDashboardViewerAccess:()=>({actorUserId:window.actor,activeAccountId:window.account})};
 if(name.endsWith('DrawerHeaderTabs'))return{__esModule:true,default:({children})=>children,DrawerHeaderDetails:({children})=>children,DrawerHeaderActions:({children})=>children};
 if(name==='@/lib/browserAccountCache')return{getActiveBrowserUserId:()=>window.account,resolveActiveBrowserUserId:()=>window.account};
 if(name==='@/lib/supabaseClient')return{createClient:()=>client};
 if(name==='@/lib/clientSubscriptionBilling')return{detectClientBillingPlatform:()=> 'web'};
 if(name==='@/lib/inrcyDialog')return{confirmInrcy:async()=>{throw Error('No transaction confirmation is allowed in this fixture')}};
 if(name==='@/app/dashboard/_components/VideoCreditRecharge')return{MediaCreditRechargeButton:()=>null};
 const target=links[id]?.[name]??name;if(!sources[target])throw Error('Unexpected account fixture dependency '+name);return load(target);
 };new Function('require','module','exports','process',sources[id])(localRequire,module,module.exports,process);return module.exports}
const React=load('react'),root=load('react-dom/client').createRoot(document.getElementById('root')),Inertia=load(components.InertiaContent).default,Boutique=load(components.BoutiqueContent).default,Invoices=load(components.SubscriptionInvoicesPanel).default,Details=load(components.SubscriptionWorkspace).SubscriptionDetails;
window.renderFixture=()=>root.render(React.createElement(React.Fragment,null,React.createElement('section',{'data-part':'inertia'},React.createElement(Inertia,{edition:'basic',snapshot:{multiplier:1,connectedCount:0,totalChannels:12,breakdown:[],maxMultiplier:2}})),React.createElement('section',{'data-part':'boutique'},React.createElement(Boutique)),React.createElement('section',{'data-part':'invoices'},React.createElement(Invoices)),React.createElement(Details,{title:'Native billing details',assistantBilling:true},'Native billing explanation')));
window.renderFixture();window.nativeHints=()=>load(nativeModule).getInrAssistantLocalInterfaceHints({actorUserId:window.actor,accountId:window.account,pathname:'/dashboard'});
window.runNative=(id,operation,value=null,revision)=>{const native=load(nativeModule),scope={actorUserId:window.actor,accountId:window.account,pathname:'/dashboard'},hint=window.nativeHints()?.find(hint=>hint.id===id);if(!hint)return Promise.resolve(false);return native.runInrAssistantLocalInterface({command:'control_local_interface',selection:{kind:'account_document',id},revision:revision||hint.revision,operation,value},scope,()=>scope.actorUserId===window.actor&&scope.accountId===window.account)};
`;
async function mount(page: Page, initialFailures = 0) {
  let invoiceReads = 0; const mutations: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()); if (request.method() !== "GET") { mutations.push(url.pathname); await route.abort(); return; }
    if (url.pathname === "/api/billing/invoices") { invoiceReads++; await route.fulfill(invoiceReads <= initialFailures ? { status: 503, json: { error: "Synthetic invoice read unavailable" } } : { json: { invoices: Array.from({ length: 12 }, (_, i) => ({ id: `invoice-${i}`, number: `N-${i}`, currency: "eur", status: "paid", total: 1000, amountPaid: 1000, created: 1793872800, hostedInvoiceUrl: null, invoicePdf: null })) } }); return; }
    if (url.pathname === "/api/loyalty/weekly-summary") { await route.fulfill({ json: { ok: true } }); return; }
    await route.fulfill({ contentType: "text/html", body: "<html><body><div id='root'></div></body></html>" });
  });
  await page.goto("https://account-local.fixture.invalid/dashboard"); await page.addScriptTag({ content: fixture }); await page.waitForFunction("window.errors.length||window.nativeHints()?.some(hint=>hint.id==='boutique_views')"); assert.deepEqual(await page.evaluate("window.errors"), []);
  await page.waitForFunction("window.ordersReads>0"); return { mutations };
}

test("Basic actual account views help billing dialog invoice pages and order refresh require native committed state and never start a transaction", async () => {
  const browser = await chromium.launch({ headless: true }); try { const page = await browser.newPage(), h = await mount(page);
    assert.equal(await page.evaluate("window.runNative('inertia_views','select','history')"), true); assert.equal(await page.locator('[data-part="inertia"] button[aria-pressed="true"]').textContent(), messages.settings.historique_34f3a06a);
    assert.equal(await page.evaluate("window.runNative('boutique_views','select','orders')"), true); await page.getByText(/^Synthetic existing order/).waitFor();
    assert.equal(await page.evaluate("window.runNative('boutique_help','open')"), true); assert.equal(await page.locator('[data-part="boutique"] button[aria-expanded]').getAttribute("aria-expanded"), "true"); assert.equal(await page.evaluate("window.runNative('boutique_help','close')"), true);
    const before = await page.evaluate("window.ordersReads") as number; const duplicates = await page.evaluate("Promise.all([window.runNative('boutique_views','retry'),window.runNative('boutique_views','retry')])") as boolean[]; assert.deepEqual(duplicates, [true, false]); assert.equal(await page.evaluate("window.ordersReads"), before + 1);
    await page.evaluate("window.failOrders=true"); assert.equal(await page.evaluate("window.runNative('boutique_views','retry')"), false); assert.equal(await page.getByText(/^Synthetic existing order/).count(), 1);
    assert.equal(await page.evaluate("window.runNative('subscription_details','open')"), true); assert.equal(await page.getByRole("dialog", { name: "Native billing details" }).isVisible(), true); assert.equal(await page.evaluate("window.runNative('subscription_details','close')"), true); assert.equal(await page.getByRole("dialog", { name: "Native billing details" }).isVisible(), false);
    await page.waitForFunction("window.nativeHints()?.some(hint=>hint.id==='subscription_invoices')"); const old = await page.evaluate("window.nativeHints().find(hint=>hint.id==='subscription_invoices').revision") as string;
    assert.equal(await page.evaluate("window.runNative('subscription_invoices','next')"), true); assert.equal(await page.locator('[data-part="invoices"] tbody tr').first().locator('td').first().textContent(), "N-5");
    assert.equal(await page.evaluate(revision => (window as unknown as { runNative: (id: string, op: string, value: null, revision: string) => Promise<boolean> }).runNative("subscription_invoices", "previous", null, revision), old), false);
    assert.equal(await page.evaluate("window.runNative('subscription_invoices','next')"), true); assert.equal(await page.locator('[data-part="invoices"] tbody tr').count(), 2); assert.equal(await page.evaluate("window.runNative('subscription_invoices','next')"), false); assert.equal(await page.evaluate("window.runNative('subscription_invoices','previous')"), true);
    assert.equal(await page.evaluate("window.runNative('inertia_views','select','invented')"), false); assert.equal(await page.evaluate("window.runNative('boutique_views','select','invented')"), false); assert.deepEqual(h.mutations, []); assert.deepEqual(await page.evaluate("window.errors"), []);
  } finally { await browser.close(); }
});

test("Basic actual subscription invoice retry refuses an unavailable native response and acknowledges only loaded invoices after rendering", async () => {
  const browser = await chromium.launch({ headless: true }); try { for (const failures of [1, 2]) { const page = await browser.newPage(), h = await mount(page, failures); await page.getByRole("alert").filter({ hasText: "Synthetic invoice read unavailable" }).waitFor(); assert.equal(await page.evaluate("window.runNative('subscription_invoices','retry')"), failures === 1); if (failures === 1) assert.equal(await page.locator('[data-part="invoices"] tbody tr').count(), 5); assert.deepEqual(h.mutations, []); assert.deepEqual(await page.evaluate("window.errors"), []); await page.close(); } } finally { await browser.close(); }
});
