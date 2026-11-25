import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

type FixtureWindow = Window & {
  fixtureLocked: boolean;
  fixtureSubscription: Record<string, unknown>;
  errors: string[];
};

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
const dialogProvider = add(resolve(repo, "app/_components/InrcyDialogProvider.tsx"));
const messages = {
  settings: JSON.parse(read("messages/fr-FR/settings.json")),
  shell: JSON.parse(read("messages/fr-FR/shell.json")),
  "auth.directSignup": JSON.parse(read("messages/fr-FR/auth.json")).directSignup,
};
const script = `
const sources=${JSON.stringify(sources)},links=${JSON.stringify(links)},panel=${JSON.stringify(panel)},dialogProvider=${JSON.stringify(dialogProvider)},messages=${JSON.stringify(messages)},loaded={},process={env:{NODE_ENV:'production'}};
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
const React=load('react'),Component=load(panel).default,DialogProvider=load(dialogProvider).default,root=load('react-dom/client').createRoot(document.getElementById('root'));
root.render(React.createElement(React.Fragment,null,React.createElement(DialogProvider),React.createElement(Component,{onOpenContact:()=>{throw Error('unexpected contact')}})));
`;
async function mount(page: Page, locked: boolean, subscription: Record<string, unknown>) {
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/billing/checkout") {
      requests.push({ path: url.pathname, method: request.method(), body: JSON.parse(request.postData() || "null") });
      await route.fulfill({ json: { url: "https://checkout.stripe.com/synthetic" } }); return;
    }
    if (url.pathname === "/api/billing/cancel" && request.method() === "POST") {
      const renewal = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 32 * 86_400_000).toISOString().slice(0, 10);
      const dates = { next_renewal_date: renewal, end_date: end };
      await page.evaluate((dates) => {
        const fixture = window as unknown as FixtureWindow;
        fixture.fixtureSubscription = { ...fixture.fixtureSubscription, ...dates, cancel_requested_at: new Date().toISOString() };
      }, dates);
      requests.push({ path: url.pathname, method: request.method(), body: null });
      await route.fulfill({ json: { ...dates, ok: true, cancellation_policy: "one_additional_monthly_renewal" } });
      return;
    }
    if (url.pathname === "/api/billing/change-plan") {
      if (request.method() === "GET" && url.searchParams.get("target") === "Basic" && url.searchParams.has("billingCycle")) {
        const renewalAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
        await route.fulfill({ json: { changeType: "scheduled", targetPlan: "Basic", billingCycle: "monthly", targetPriceId: "price_basic", currentPriceId: "price_current", renewalAt } });
        return;
      }
      if (request.method() === "POST") {
        requests.push({ path: url.pathname, method: request.method(), body: JSON.parse(request.postData() || "null") });
        await route.fulfill({ json: { scheduled: true, renewalAt: new Date(Date.now() + 2 * 86_400_000).toISOString() } });
        return;
      }
    }
    if (url.hostname === "checkout.stripe.com") { await route.fulfill({ contentType: "text/html", body: "<h1>Checkout synthétique</h1>" }); return; }
    if (url.pathname.startsWith("/api/")) { requests.push({ path: url.pathname, method: request.method(), body: null }); await route.fulfill({ json: {} }); return; }
    await route.fulfill({ contentType: "text/html", body: "<html><body><div id='root'></div></body></html>" });
  });
  await page.goto("https://subscription.fixture.invalid/dashboard?panel=abonnement");
  await page.evaluate(({ locked, subscription }) => { (window as unknown as FixtureWindow).fixtureLocked = locked; (window as unknown as FixtureWindow).fixtureSubscription = subscription; }, { locked, subscription });
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
    assert.deepEqual(await paid.evaluate(() => (window as unknown as FixtureWindow).errors), []);
  } finally { await browser.close(); }
});

test("Standard can choose Basic, and Premium can directly confirm cancellation with one month's notice", async () => {
  const browser = await chromium.launch({ headless: true });
  const settings = messages.settings;
  const paid = { status: "active", stripe_subscription_id: "sub_synthetic", billing_provider: "stripe", billing_cycle: "monthly" };
  try {
    const standard = await browser.newPage();
    const standardRequests = await mount(standard, false, { ...paid, plan: "Standard", app_edition: "standard" });
    await standard.getByRole("button", { name: settings.gerer_ma_facturation_dc5027ac }).click();
    await standard.getByRole("button", { name: settings.programmer_ma_resiliation_d074ca2d }).click();
    const standardConfirmation = standard.getByRole("dialog", { name: settings.confirmer_la_resiliation_893151df });
    await standardConfirmation.getByText(settings.subscription_cancel_notice_monthly).waitFor();
    assert.ok(await standardConfirmation.getByRole("button", { name: settings.resilier_1b922dae, exact: true }).isEnabled());
    await standardConfirmation.getByRole("button", { name: settings.subscription_cancel_view_basic }).click();

    const basicCard = standard.getByRole("region", { name: "iNrCy Basique" });
    await standard.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "iNrCy Basique");
    assert.equal(standardRequests.some(r => r.method === "POST"), false);
    await basicCard.getByRole("button", { name: settings.subscription_basic_change }).click();
    await basicCard.getByRole("button", { name: settings.subscription_confirm_change }).click();
    await basicCard.getByText(/Passage à Basique le/).waitFor();
    assert.deepEqual(standardRequests.filter(r => r.method === "POST").map(r => [r.path, (r.body as { targetPlan?: string })?.targetPlan]), [["/api/billing/change-plan", "Basic"]]);

    const premium = await browser.newPage();
    const premiumRequests = await mount(premium, false, { ...paid, plan: "Premium", app_edition: "premium" });
    await premium.getByRole("button", { name: settings.gerer_ma_facturation_dc5027ac }).click();
    await premium.getByRole("button", { name: settings.programmer_ma_resiliation_d074ca2d }).click();
    const premiumConfirmation = premium.getByRole("dialog", { name: settings.confirmer_la_resiliation_893151df });
    await premiumConfirmation.getByRole("button", { name: settings.subscription_cancel_view_basic }).waitFor();
    assert.equal(premiumRequests.some(r => r.method === "POST"), false);
    const [response] = await Promise.all([
      premium.waitForResponse((response) => new URL(response.url()).pathname === "/api/billing/cancel"),
      premiumConfirmation.getByRole("button", { name: settings.resilier_1b922dae, exact: true }).click(),
    ]);
    assert.equal(response.status(), 200);
    await premium.getByRole("button", { name: settings.annuler_ma_resiliation_902e43a0 }).waitFor();
    await premium.getByText(settings.derniere_mensualite_prevue_le_f3d69894, { exact: false }).waitFor();
    assert.deepEqual(premiumRequests.filter(r => r.method === "POST").map(r => r.path), ["/api/billing/cancel"]);
    assert.deepEqual(await standard.evaluate(() => (window as unknown as FixtureWindow).errors), []);
    assert.deepEqual(await premium.evaluate(() => (window as unknown as FixtureWindow).errors), []);
  } finally {
    await browser.close();
  }
});
