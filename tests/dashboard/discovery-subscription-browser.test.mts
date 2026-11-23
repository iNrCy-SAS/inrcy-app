import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

// Run from the repository root. React, plan cards, policies and the web checkout
// helper are production code; Supabase and Stripe are synthetic and stay offline.
const repo = process.cwd(), require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(resolve(repo, file), "utf8");
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources: Record<string, string> = {
  react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"),
};
const links: Record<string, Record<string, string>> = {};
function add(file: string): string {
  const id = file.replaceAll("\\", "/"); if (sources[id]) return id;
  const raw = readFileSync(file, "utf8");
  sources[id] = ts.transpileModule(raw, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  links[id] = {};
  const ast = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
    const name = node.moduleSpecifier.text;
    if (name.endsWith(".css") || name.endsWith("DashboardViewerAccessProvider") || name.endsWith("useInrAssistantLocalInterface") || /(?:^|\/)nativeBilling(?:\.ts)?$/.test(name) || ["@/lib/supabaseClient"].includes(name)) continue;
    const base = name.startsWith("@/") ? resolve(repo, name.slice(2)) : name.startsWith(".") ? resolve(dirname(file), name) : "";
    if (!base) continue;
    const target = [base, base + ".ts", base + ".tsx"].find(path => existsSync(path));
    assert.ok(target, `missing dependency ${name} in ${file}`); links[id][name] = add(target);
  }
  return id;
}
const panel = add(resolve(repo, "app/dashboard/settings/_components/StandardSubscriptionContent.tsx"));
const messages = { settings: JSON.parse(read("messages/fr-FR/settings.json")), "auth.directSignup": JSON.parse(read("messages/fr-FR/auth.json")).directSignup };
const script = `
const sources=${JSON.stringify(sources)},links=${JSON.stringify(links)},panel=${JSON.stringify(panel)},messages=${JSON.stringify(messages)},loaded={},process={env:{NODE_ENV:'production'}};
window.errors=[];window.requests=[];window.addEventListener('error',e=>window.errors.push(String(e.error?.stack||e.message)));
const translated={};function translate(ns){return translated[ns]??=(key,values={})=>String(messages[ns]?.[key]??key).replace(/\\{(\\w+)\\}/g,(_,name)=>values[name]??'')}
const client={auth:{getUser:async()=>({data:{user:{id:'synthetic-account'}},error:null})},from(table){if(table!=='subscriptions')throw Error('unexpected table '+table);const query={select(){return query},eq(){return query},async maybeSingle(){return {data:window.fixtureSubscription,error:null}}};return query}};
function load(id){if(loaded[id])return loaded[id].exports;const module=loaded[id]={exports:{}};const localRequire=name=>{
 if(['react','react/jsx-runtime','react-dom','react-dom/client','scheduler'].includes(name))return load(name);
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(name==='next-intl')return {useTranslations:ns=>translate(ns),useLocale:()=> 'fr-FR'};
 if(name==='next/navigation')return {useSearchParams:()=>new URLSearchParams(),useRouter:()=>({push(){}}),usePathname:()=>'/dashboard'};
 if(name.endsWith('DashboardViewerAccessProvider'))return {useDashboardViewerAccess:()=>({paidActionsLocked:window.fixtureLocked})};
 if(name.endsWith('useInrAssistantLocalInterface'))return {useInrAssistantLocalInterface:()=>{}};
 if(name==='@/lib/supabaseClient')return {createClient:()=>client};
 if(name==='@capacitor/core')return {Capacitor:{isNativePlatform:()=>false,getPlatform:()=> 'web'}};
 if(/(?:^|\\/)nativeBilling(?:\\.ts)?$/.test(name))return {getNativeSubscriptionPriceLabels:()=>{throw Error('unexpected native prices')},startNativeSubscriptionPurchase:()=>{throw Error('unexpected native purchase')}};
 const target=links[id]?.[name]??name;if(!sources[target])throw Error('Unexpected fixture dependency '+name+' from '+id);return load(target);
 };new Function('require','module','exports','process',sources[id])(localRequire,module,module.exports,process);return module.exports}
const React=load('react'),Component=load(panel).default,root=load('react-dom/client').createRoot(document.getElementById('root'));
root.render(React.createElement(Component,{onOpenContact:()=>{throw Error('unexpected contact')}}));
`;
async function mount(page: Page, locked: boolean, subscription: Record<string, unknown>) {
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/billing/checkout") {
      requests.push({ path: url.pathname, method: request.method(), body: JSON.parse(request.postData() || "null") });
      await route.fulfill({ json: { url: "https://checkout.stripe.com/synthetic" } }); return;
    }
    if (url.hostname === "checkout.stripe.com") { await route.fulfill({ contentType: "text/html", body: "<h1>Checkout synthétique</h1>" }); return; }
    if (url.pathname.startsWith("/api/")) { requests.push({ path: url.pathname, method: request.method(), body: null }); await route.fulfill({ json: {} }); return; }
    await route.fulfill({ contentType: "text/html", body: "<html><body><div id='root'></div></body></html>" });
  });
  await page.goto("https://subscription.fixture.invalid/dashboard?panel=abonnement");
  await page.evaluate(({ locked, subscription }) => { (window as any).fixtureLocked = locked; (window as any).fixtureSubscription = subscription; }, { locked, subscription });
  await page.addScriptTag({ content: script });
  await page.getByRole("heading", { name: "iNrCy Basique" }).waitFor();
  return requests;
}

test("discovery incomplete can subscribe to Basic without claiming a current plan; confirmed active Basic is presented as current", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const discovery = await browser.newPage();
    const requests = await mount(discovery, true, { plan: "Basic", status: "incomplete", stripe_subscription_id: null, native_product_id: null, billing_cycle: "monthly" });
    const card = discovery.getByRole("region", { name: "iNrCy Basique" });
    const subscribe = card.getByRole("button", { name: /S’abonner/ }); await subscribe.waitFor();
    assert.equal(await subscribe.isEnabled(), true);
    assert.equal(await discovery.getByText(messages.settings.subscription_current_plan, { exact: true }).count(), 0);
    assert.equal(await discovery.getByText(messages.settings.subscription_selected_plan, { exact: true }).count(), 0);
    await subscribe.click();
    await discovery.waitForURL("https://checkout.stripe.com/synthetic");
    assert.deepEqual(requests.filter(r => r.path === "/api/billing/checkout"), [{ path: "/api/billing/checkout", method: "POST", body: { plan: "Basic", billingCycle: "monthly" } }]);
    const paid = await browser.newPage();
    const paidRequests = await mount(paid, false, { plan: "Basic", status: "active", stripe_subscription_id: "sub_synthetic", billing_provider: "stripe", billing_cycle: "monthly" });
    const paidCard = paid.getByRole("region", { name: "iNrCy Basique" });
    await paidCard.getByText(messages.settings.subscription_current_plan, { exact: true }).waitFor();
    assert.equal(await paidCard.getByRole("button", { name: /S’abonner/ }).count(), 0);
    assert.equal(paidRequests.filter(r => r.path === "/api/billing/checkout").length, 0);
    assert.deepEqual(await paid.evaluate(() => (window as any).errors), []);
  } finally { await browser.close(); }
});
