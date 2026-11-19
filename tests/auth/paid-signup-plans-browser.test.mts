import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Browser, type Page } from "@playwright/test";
import ts from "typescript";

type FetchRecord = { url: string; method: string; body: unknown; settled: boolean; credentials: string; cache: string };
type FixtureWindow = Window & { requests: FetchRecord[]; reply(index: number, body: unknown, status?: number): void };
const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const moduleCss = (file: string, prefix: string) => read(file).replace(/\.[a-zA-Z_][a-zA-Z0-9_-]*/g, name => `.${prefix}${name.slice(1)}`);
const globalCss = readFileSync(require.resolve("tailwindcss/preflight.css"), "utf8") + read("app/globals.css").replace('@import "tailwindcss";', "");
const productCss = globalCss + moduleCss("app/activer-mon-compte/activation.module.css", "plans_")
  + moduleCss("app/dashboard/_components/TemporaryPasswordWelcomeGate.module.css", "password_")
  + moduleCss("app/dashboard/settings/_components/subscriptionWorkspace.module.css", "compact_")
  + moduleCss("app/dashboard/settings/_components/settingsContentLayout.module.css", "comparison_");
const authMessages = JSON.parse(read("messages/fr-FR/auth.json"));
const settings = JSON.parse(read("messages/fr-FR/settings.json"));
const sources = {
  react: packageSource("react", "react.development.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
  "react-dom": packageSource("react-dom", "react-dom.development.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"), scheduler: packageSource("scheduler", "scheduler.development.js"),
  plans: compile("app/activer-mon-compte/DirectSignupPlans.tsx"), gate: compile("app/dashboard/_components/TemporaryPasswordWelcomeGate.tsx"),
  offers: compile("lib/subscriptionOffers.ts"), password: compile("lib/passwordPolicy.ts"),
  comparison: compile("app/dashboard/settings/_components/SubscriptionComparison.tsx"), media: compile("lib/aiMediaPlanLimits.ts"),
  edition: compile("lib/dashboardEdition.ts"), reviewer: compile("lib/reviewerAccess.ts"),
};

async function fixture(browser: Browser, options: { temporary?: boolean; checkout?: "success" | "cancel"; mobile?: boolean } = {}) {
  const page = await browser.newPage({ viewport: options.mobile ? { width: 390, height: 844 } : { width: 1200, height: 1000 } });
  const errors: string[] = [], routes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = route.request().url(); routes.push(url);
    return route.fulfill({ contentType: "text/html", body: url.endsWith("/dashboard") ? '<!doctype html><html><body><h1>Authenticated dashboard destination</h1></body></html>' : '<!doctype html><html><body><div id="root"></div></body></html>' });
  });
  await page.goto(`https://app.example.invalid/activer-mon-compte${options.checkout ? `?checkout=${options.checkout}` : ""}`);
  await page.addStyleTag({ content: productCss });
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},catalogs=${JSON.stringify({ "auth.password": authMessages.password, "auth.directSignup": authMessages.directSignup, settings })},cache={},process={env:{NODE_ENV:'development'}};
    window.requests=[];
    const translators={};for(const [namespace,messages] of Object.entries(catalogs)){translators[namespace]=(key,args={})=>{if(typeof messages[key]!=='string')throw Error('Missing translation '+namespace+'.'+key);return Object.entries(args).reduce((text,[name,value])=>text.split('{'+name+'}').join(String(value)),messages[key])}};
    const modules={
      'next-intl':{useTranslations:namespace=>translators[namespace],useLocale:()=> 'fr-FR'},
      './SubscriptionWorkspace':{SubscriptionDetails:()=>{throw Error('Unexpected Founder-only details')}},
      './activation.module.css':{__esModule:true,default:new Proxy({},{get:(_,key)=>'plans_'+String(key)})},
      './TemporaryPasswordWelcomeGate.module.css':{__esModule:true,default:new Proxy({},{get:(_,key)=>'password_'+String(key)})},
      './subscriptionWorkspace.module.css':{__esModule:true,default:new Proxy({},{get:(_,key)=>'compact_'+String(key)})},
      './settingsContentLayout.module.css':{__esModule:true,default:new Proxy({},{get:(_,key)=>'comparison_'+String(key)})}
    };
    modules['@/app/dashboard/settings/_components/settingsContentLayout.module.css']=modules['./settingsContentLayout.module.css'];
    const aliases={'@/lib/subscriptionOffers':'offers','@/lib/passwordPolicy':'password',
      '@/app/dashboard/settings/_components/SubscriptionComparison':'comparison','@/lib/aiMediaPlanLimits':'media',
      '@/lib/dashboardEdition':'edition','./reviewerAccess.ts':'reviewer'};
    function require(name){
      if(aliases[name])return require(aliases[name]);
      if(Object.hasOwn(modules,name))return modules[name];if(cache[name])return cache[name].exports;
      if(!Object.hasOwn(sources,name))throw Error('Unexpected product import '+name);
      const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;
    }
    window.fetch=(url,options={})=>new Promise((resolve,reject)=>{
      const record={url:String(url),method:options.method||'GET',credentials:options.credentials,cache:options.cache,body:options.body?JSON.parse(options.body):null,resolve,reject,settled:false};window.requests.push(record);
      options.signal?.addEventListener('abort',()=>{if(!record.settled){record.settled=true;reject(new DOMException('Aborted','AbortError'))}},{once:true});
    });
    window.reply=(index,body,status=200)=>{const record=window.requests[index];record.settled=true;record.resolve(Response.json(body,{status}))};
    const React=require('react'),Plans=require('plans').default,Gate=require('gate').default,root=require('react-dom/client').createRoot(document.getElementById('root'));
    root.render(React.createElement(React.StrictMode,null,React.createElement(Gate,{actorUserId:'actor',temporaryPasswordWelcomeId:${options.temporary === false ? "null" : "'welcome'"},email:'synthetic@example.invalid'},React.createElement(Plans,{email:'synthetic@example.invalid',checkout:${JSON.stringify(options.checkout ?? null)}}))));
  ` });
  page.setDefaultTimeout(5000);
  return { page, errors, routes };
}

const STATUS = "/api/auth/direct-signup/status", BILLING = "/api/billing/checkout";
async function pending(page: Page, url: string) {
  await page.waitForFunction(path => (window as unknown as FixtureWindow).requests.some(request => request.url === path && !request.settled), url);
  return page.evaluate(path => (window as unknown as FixtureWindow).requests.findIndex(request => request.url === path && !request.settled), url);
}
async function reply(page: Page, url: string, body: unknown, status = 200) {
  const index = await pending(page, url); await page.evaluate(({ index, body, status }) => (window as unknown as FixtureWindow).reply(index, body, status), { index, body, status });
  return index;
}
async function choose(page: Page) {
  await reply(page, STATUS, { directSignup: true, paid: false, status: "incomplete", plan: "Basic" });
  await page.getByRole("radio").first().waitFor();
}
const billingRequests = (page: Page) => page.evaluate(path => (window as unknown as FixtureWindow).requests.filter(request => request.url === path), BILLING);

test("temporary password Later precedes the three real monthly plans and no payment starts on load", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { mobile: true });
    await reply(f.page, "/api/auth/signup-access/password", { required: true, currentPassword: "Synthetic-Temporary123!" });
    await f.page.getByRole("heading", { name: "Choisissez votre mot de passe" }).waitFor();
    assert.equal(await f.page.getByRole("radio").count(), 0);
    assert.equal(await f.page.evaluate(path => (window as unknown as FixtureWindow).requests.some(request => request.url === path), STATUS), false);
    await f.page.getByRole("button", { name: "Plus tard", exact: true }).click();
    await choose(f.page);
    assert.equal(await f.page.getByRole("radio").count(), 3);
    assert.equal(await f.page.locator('input[value="Basic"]').isChecked(), true);
    for (const [plan, amount] of [["Basic", 29], ["Standard", 58], ["Premium", 108]] as const) {
      const card = f.page.locator("section").filter({ has: f.page.locator(`input[value="${plan}"]`) });
      assert.match(await card.innerText(), new RegExp(`${amount}[^0-9]*€`));
    }
    assert.equal(await f.page.locator("footer").getByText(authMessages.directSignup.cancellationNotice, { exact: true }).isVisible(), false);
    assert.equal((await billingRequests(f.page)).length, 0);
    const dialog = f.page.getByRole("dialog");
    const bounds = await dialog.boundingBox(); assert.ok(bounds && bounds.width <= 390 && bounds.x >= 0);
    assert.match(await dialog.evaluate(node => getComputedStyle(node).backgroundImage), /linear-gradient\(145deg/, "the real activation CSS is applied");
    assert.match(await f.page.locator('section[data-selected="true"]').evaluate(node => getComputedStyle(node).backgroundImage), /gradient/, "the shared subscription card CSS is applied");
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= 390));
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("each explicit plan sends its exact monthly choice and double clicks produce one Checkout request", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const plan of ["Basic", "Standard", "Premium"] as const) {
      const f = await fixture(browser, { temporary: false }); await choose(f.page);
      await f.page.locator(`input[value="${plan}"]`).check();
      const button = f.page.getByRole("button", { name: /^Continuer vers Stripe/ });
      await button.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
      const index = await pending(f.page, BILLING); const requests = await billingRequests(f.page);
      assert.equal(requests.length, 1); assert.deepEqual(requests[0].body, { plan, billingCycle: "monthly" });
      assert.equal(requests[0].credentials, "same-origin"); assert.equal(requests[0].cache, "no-store");
      await f.page.evaluate(index => (window as unknown as FixtureWindow).reply(index, { url: "https://checkout.stripe.com/synthetic" }), index);
      await f.page.waitForURL("https://checkout.stripe.com/synthetic");
      assert.deepEqual(f.errors, []); await f.page.close();
    }
  } finally { await browser.close(); }
});

test("checkout errors retain the chosen plan for retry and non-Stripe payment URLs never navigate", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { temporary: false }); await choose(f.page);
    await f.page.locator('input[value="Premium"]').check();
    const button = f.page.getByRole("button", { name: /^Continuer vers Stripe/ }); await button.click();
    await reply(f.page, BILLING, { error: "synthetic unavailable" }, 503);
    await f.page.getByRole("alert").waitFor(); assert.equal(await f.page.locator('input[value="Premium"]').isChecked(), true);
    for (const url of ["https://evil.invalid/collect", "https://checkout.stripe.com.evil.invalid/pay", "http://checkout.stripe.com/pay", "javascript:alert(1)"]) {
      await button.click(); await reply(f.page, BILLING, { url }); await f.page.getByRole("alert").waitFor();
      assert.match(f.page.url(), /^https:\/\/app\.example\.invalid\/activer-mon-compte/);
    }
    assert.equal(f.routes.some(url => /evil\.invalid|^http:\/\/checkout/.test(url)), false);
    assert.equal((await billingRequests(f.page)).length, 5); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("a forged browser success waits for authenticated paid=true before navigating to the dashboard", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { temporary: false, checkout: "success" });
    await reply(f.page, STATUS, { directSignup: true, paid: false, status: "incomplete", nextUrl: "/dashboard" });
    await f.page.getByRole("status").filter({ hasText: "Confirmation de votre paiement" }).waitFor();
    assert.equal(await f.page.getByRole("radio").count(), 0); assert.equal((await billingRequests(f.page)).length, 0);
    const second = await pending(f.page, STATUS);
    assert.match(f.page.url(), /activer-mon-compte/);
    await f.page.evaluate(index => (window as unknown as FixtureWindow).reply(index, { directSignup: true, paid: true, status: "active", plan: "Basic", nextUrl: "https://evil.invalid" }), second);
    await f.page.waitForURL("https://app.example.invalid/dashboard");
    await f.page.getByRole("heading", { name: "Authenticated dashboard destination" }).waitFor();
    assert.equal(f.routes.some(url => url.includes("evil.invalid")), false); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("cancelled checkout preserves the account and lets the professional resume only by explicit choice", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { temporary: false, checkout: "cancel" }); await choose(f.page);
    await f.page.getByRole("status").filter({ hasText: "Votre compte est conservé" }).waitFor();
    assert.equal(await f.page.getByRole("radio").count(), 3); assert.equal((await billingRequests(f.page)).length, 0);
    await f.page.getByRole("button", { name: /^Continuer vers Stripe/ }).click();
    const request = await pending(f.page, BILLING); assert.ok(request >= 0);
    assert.deepEqual((await billingRequests(f.page))[0].body, { plan: "Basic", billingCycle: "monthly" }); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("real Basic features return to the originating control with Return and Escape without starting payment", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { temporary: false, mobile: true }); await choose(f.page);
    const features = f.page.getByRole("button", { name: "Voir les fonctionnalités de Basique", exact: true });
    for (const action of ["return", "escape"] as const) {
      await features.click();
      const heading = f.page.getByRole("heading", { name: "Fonctionnalités de Basique", exact: true }); await heading.waitFor();
      assert.equal(await heading.evaluate(node => document.activeElement === node), true);
      const tools = f.page.getByRole("table", { name: settings.subscription_basic_tools, exact: true });
      assert.match(await tools.innerText(), /50[\s\S]*crédits médias \/ mois/);
      assert.match(await tools.innerText(), /Publication sur 11 canaux/);
      assert.equal(await tools.getAttribute("class"), "comparison_planTools");
      assert.equal(await f.page.getByRole("radio").count(), 0);
      assert.equal(await f.page.getByRole("button", { name: /^Continuer vers Stripe/ }).count(), 0);
      assert.equal((await billingRequests(f.page)).length, 0);
      assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= 390));
      if (action === "return") await f.page.getByRole("button", { name: "Retour aux offres", exact: true }).click();
      else await f.page.keyboard.press("Escape");
      await features.waitFor();
      assert.equal(await features.evaluate(node => document.activeElement === node), true);
      assert.equal(await f.page.locator('input[value="Basic"]').isChecked(), true);
      assert.equal(await f.page.getByRole("dialog").evaluate(node => (node as HTMLDialogElement).open), true);
    }
    assert.equal((await billingRequests(f.page)).length, 0); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("choosing Premium in its feature view selects and focuses that offer without creating a Checkout", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { temporary: false }); await choose(f.page);
    await f.page.getByRole("button", { name: "Voir les fonctionnalités de Premium", exact: true }).click();
    await f.page.getByRole("heading", { name: "Fonctionnalités de Premium", exact: true }).waitFor();
    assert.equal(await f.page.getByText(settings.subscription_standard_plus, { exact: true }).isVisible(), true);
    await f.page.getByRole("table", { name: settings.subscription_premium_tools, exact: true }).waitFor();
    assert.equal(await f.page.getByRole("button", { name: /^Continuer vers Stripe/ }).count(), 0);
    await f.page.getByRole("button", { name: "Choisir Premium", exact: true }).click();
    const selected = f.page.locator('input[value="Premium"]'); await selected.waitFor();
    assert.equal(await selected.isChecked(), true);
    assert.equal(await selected.evaluate(node => document.activeElement === node), true);
    assert.equal(await f.page.getByRole("radio").count(), 3);
    assert.match(await f.page.getByRole("button", { name: /^Continuer vers Stripe/ }).innerText(), /108[^0-9]*€ HT \/ mois/);
    assert.equal((await billingRequests(f.page)).length, 0); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("expandable payment terms preserve trial, renewal, taxes and CGA disclosures without creating payment", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { temporary: false }); await choose(f.page);
    const footer = f.page.locator("footer"), terms = footer.locator("details");
    assert.equal(await terms.evaluate(node => (node as HTMLDetailsElement).open), false);
    const cancellation = terms.getByText(authMessages.directSignup.cancellationNotice, { exact: true });
    assert.equal(await cancellation.count(), 1, "the renewal notice remains in the expandable terms");
    assert.equal(await cancellation.isVisible(), false);
    assert.equal(await terms.getByText(settings.standard_taxes_checkout, { exact: true }).isVisible(), false);
    await terms.locator("summary").getByText("Paiement et conditions", { exact: true }).click();
    assert.equal(await terms.evaluate(node => (node as HTMLDetailsElement).open), true);
    assert.equal(await cancellation.isVisible(), true);
    assert.match(await cancellation.innerText(), /Résiliation avec préavis : un renouvellement mensuel supplémentaire/);
    assert.match(await terms.innerText(), /Sans période d’essai\. Premier paiement aujourd’hui, puis renouvellement mensuel/);
    assert.equal(await terms.getByText(settings.standard_taxes_checkout, { exact: true }).isVisible(), true);
    const cga = terms.getByRole("link", { name: "Conditions d’abonnement", exact: true });
    assert.equal(await cga.getAttribute("href"), "https://inrcy.com/cga-conditions-generales-dabonnement/");
    assert.equal(await cga.getAttribute("target"), "_blank");
    assert.match(await cga.getAttribute("rel") ?? "", /noopener/);
    await terms.locator("summary").click();
    assert.equal(await terms.evaluate(node => (node as HTMLDetailsElement).open), false);
    assert.equal((await billingRequests(f.page)).length, 0); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("an unavailable or malformed authenticated status fails closed and retry never creates payment", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const f = await fixture(browser, { temporary: false }); await reply(f.page, STATUS, { error: "unavailable" }, 503);
    await f.page.getByRole("alert").waitFor(); assert.equal(await f.page.getByRole("radio").count(), 0);
    await f.page.getByRole("button", { name: "Vérifier mon abonnement", exact: true }).click();
    await reply(f.page, STATUS, { directSignup: true, paid: "true" }); await f.page.getByRole("alert").waitFor();
    assert.equal(await f.page.getByRole("radio").count(), 0); assert.equal((await billingRequests(f.page)).length, 0);
    assert.match(f.page.url(), /activer-mon-compte/);
    await f.page.getByRole("button", { name: "Vérifier mon abonnement", exact: true }).click(); await choose(f.page);
    assert.equal(await f.page.getByRole("radio").count(), 3); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});
