import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

type FixtureRequest = { url: string; settled: boolean; body: unknown; credentials: string; cache: string };
type BrowserFixture = Window & {
  requests: FixtureRequest[];
  arrivals: number;
  reply: (index: number, payload: unknown, status?: number) => void;
  render: (patch: Record<string, unknown>) => void;
};

const require = createRequire(import.meta.url);
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const messages = JSON.parse(readFileSync(new URL("../../messages/fr-FR/auth.json", import.meta.url), "utf8")).password;
const sources = {
  react: packageSource("react", "react.development.js"),
  "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
  "react-dom": packageSource("react-dom", "react-dom.development.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
  scheduler: packageSource("scheduler", "scheduler.development.js"),
  component: compile("app/dashboard/_components/TemporaryPasswordWelcomeGate.tsx"),
  policy: compile("lib/passwordPolicy.ts"),
  arrival: compile("app/dashboard/_hooks/useAssistantFirstArrival.ts"),
};

async function setup(page: Page, props: Record<string, unknown> = {}) {
  const errors: string[] = [], routes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    routes.push(route.request().url());
    if (route.request().url().startsWith("https://app.example.invalid/")) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
    return route.abort();
  });
  await page.goto("https://app.example.invalid/dashboard");
  await page.addStyleTag({ content: readFileSync(new URL("../../app/dashboard/_components/TemporaryPasswordWelcomeGate.module.css", import.meta.url), "utf8") });
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)}, messages=${JSON.stringify(messages)},cache={},process={env:{NODE_ENV:'development'}};
    window.requests=[];window.arrivals=0;window.childMounts=0;window.props={actorUserId:'actor-a',temporaryPasswordWelcomeId:'welcome-a',email:'new@example.com',...${JSON.stringify(props)}};
    const modules={
      'next-intl':{useTranslations:()=>key=>{if(typeof messages[key]!=='string')throw Error('Missing translation '+key);return messages[key]}},
      '@/lib/passwordPolicy':null,
      '@/lib/supabaseClient':{createClient:()=>({auth:{getUser:async()=>({data:{user:{id:window.props.actorUserId}}})}})},
      './TemporaryPasswordWelcomeGate.module.css':{default:new Proxy({},{get:(_,key)=>String(key)})},
      '@/lib/browserAccountCache':{getActiveBrowserUserId:()=>window.props.actorUserId},
      '@/lib/browserSignOutState':{BROWSER_SIGN_OUT_START_EVENT:'fixture-signout',isBrowserSignOutInProgress:()=>false},
      '@/lib/multicompte/constants':{ACTIVE_INRCY_ACCOUNT_EVENT:'fixture-account'}
    };
    function require(name){
      if(name==='@/lib/passwordPolicy')return require('policy');
      if(Object.hasOwn(modules,name))return modules[name];if(cache[name])return cache[name].exports;
      if(!Object.hasOwn(sources,name))throw Error('Unexpected import '+name);
      const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;
    }
    window.fetch=(url,options={})=>new Promise((resolve,reject)=>{
      window.requests.push({url:String(url),method:options.method||'GET',credentials:options.credentials,cache:options.cache,body:options.body?JSON.parse(options.body):null,resolve,reject,settled:false});
    });
    window.reply=(index,payload,status=200)=>{const request=window.requests[index];request.settled=true;request.resolve(Response.json(payload,{status}));};
    window.fail=index=>{window.requests[index].settled=true;window.requests[index].reject(Error('synthetic outage'));};
    const React=require('react'), Gate=require('component').default,useArrival=require('arrival').useAssistantFirstArrival,root=require('react-dom/client').createRoot(document.getElementById('root'));
    function Child(){
      React.useEffect(()=>{window.childMounts++},[]);
      const welcome=React.useCallback(()=>{window.arrivals++},[]);
      useArrival({actorUserId:window.props.actorUserId,accountId:window.props.actorUserId,enabled:true,onWelcome:welcome});
      return React.createElement('div',{'data-normal-onboarding':true},'Accueil habituel');
    }
    window.render=patch=>{window.props={...window.props,...patch};root.render(React.createElement(React.StrictMode,null,React.createElement(Gate,window.props,React.createElement(Child))))};
    window.render({});
  ` });
  page.setDefaultTimeout(5000);
  return { errors, routes };
}

async function pending(page: Page, url: string) {
  await page.waitForFunction(path => (window as unknown as BrowserFixture).requests.some((request: FixtureRequest) => request.url === path && !request.settled), url);
  return page.evaluate(path => (window as unknown as BrowserFixture).requests.findIndex((request: FixtureRequest) => request.url === path && !request.settled), url);
}
async function answerWelcome(page: Page, value: unknown, status = 200) {
  // The cookie-bearing request is shared by Strict Mode subscribers.
  await page.waitForFunction(() => (window as unknown as BrowserFixture).requests.some((request: FixtureRequest) => request.url === "/api/auth/signup-access/password"));
  await page.evaluate(({ payload, code }) => {
    const fixture = window as unknown as BrowserFixture;
    fixture.requests.forEach((request: FixtureRequest, index: number) => { if (request.url === "/api/auth/signup-access/password" && !request.settled) fixture.reply(index, payload, code); });
  }, { payload: value, code: status });
}

test("new-account password change precedes normal assistant arrival, retries preserve the form and confirmation is exact", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const f = await setup(page);
    await answerWelcome(page, { required: true, currentPassword: "Old-Temporary42!", email: "new@example.com" });
    assert.equal(await page.evaluate(() => (window as unknown as BrowserFixture).requests.filter((r: FixtureRequest) => r.url === "/api/auth/signup-access/password").length), 1);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    assert.equal(await page.locator("[data-normal-onboarding]").count(), 0);
    assert.equal(await page.getByLabel("Mot de passe provisoire", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => (window as unknown as BrowserFixture).requests.some((r: FixtureRequest) => r.url === "/api/dashboard/setup-intro")), false);
    const bounds = await dialog.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.width <= 390 && bounds.y >= 0 && bounds.height <= 844);
    await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("New-Password42!");
    await page.getByLabel("Confirmez le mot de passe", { exact: true }).fill("Different-Password42!");
    await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
    await page.getByRole("alert").filter({ hasText: "Les deux mots de passe" }).waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as BrowserFixture).requests.some((r: FixtureRequest) => r.url === "/api/auth/change-password")), false);
    await page.getByLabel("Confirmez le mot de passe", { exact: true }).fill("New-Password42!");
    await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
    const first = await pending(page, "/api/auth/change-password");
    assert.deepEqual(await page.evaluate(index => { const r = (window as unknown as BrowserFixture).requests[index]; return { body: r.body, credentials: r.credentials, cache: r.cache }; }, first), {
      body: { currentPassword: "Old-Temporary42!", password: "New-Password42!" }, credentials: "same-origin", cache: "no-store",
    });
    await page.evaluate(index => (window as unknown as BrowserFixture).reply(index, { ok: false, code: "password_update_failed" }, 503), first);
    await page.getByRole("alert").filter({ hasText: "Impossible de mettre" }).waitFor();
    assert.equal(await page.getByLabel("Nouveau mot de passe", { exact: true }).inputValue(), "New-Password42!");
    assert.equal(await page.locator("[data-normal-onboarding]").count(), 0);
    await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
    const second = await pending(page, "/api/auth/change-password");
    await page.evaluate(index => (window as unknown as BrowserFixture).reply(index, { ok: true, requires_login: false }), second);
    await page.locator("[data-normal-onboarding]").waitFor();
    const arrival = await pending(page, "/api/dashboard/setup-intro");
    await page.evaluate(index => (window as unknown as BrowserFixture).reply(index, { accountId: "actor-a", show: true }), arrival);
    await page.waitForFunction(() => (window as unknown as BrowserFixture).arrivals === 1);
    assert.equal(await dialog.count(), 0);
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("failed handoff offers manual temporary password and Later still resumes onboarding without a password write", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const f = await setup(page);
    await answerWelcome(page, { error: "unavailable" }, 503);
    await page.getByLabel("Mot de passe provisoire", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Plus tard" }).click();
    await page.locator("[data-normal-onboarding]").waitFor();
    await pending(page, "/api/dashboard/setup-intro");
    assert.equal(await page.evaluate(() => (window as unknown as BrowserFixture).requests.some((r: FixtureRequest) => r.url === "/api/auth/change-password")), false);
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("permanent accounts skip the endpoint and an authoritative required=false resumes directly", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page, { temporaryPasswordWelcomeId: null });
    await page.locator("[data-normal-onboarding]").waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as BrowserFixture).requests.some((r: FixtureRequest) => r.url === "/api/auth/signup-access/password")), false);
    const changed = await browser.newPage(); await setup(changed);
    await answerWelcome(changed, { required: false });
    await changed.locator("[data-normal-onboarding]").waitFor();
    assert.equal(await changed.getByRole("dialog").count(), 0);
  } finally { await browser.close(); }
});

test("password success requiring login navigates without secrets and without consuming assistant arrival", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const f = await setup(page);
    await answerWelcome(page, { required: true, currentPassword: "Old-Temporary42!" });
    await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("New-Password42!");
    await page.getByLabel("Confirmez le mot de passe", { exact: true }).fill("New-Password42!");
    await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
    const change = await pending(page, "/api/auth/change-password");
    assert.equal(await page.evaluate(() => (window as unknown as BrowserFixture).requests.some((r: FixtureRequest) => r.url === "/api/dashboard/setup-intro")), false);
    await page.evaluate(index => (window as unknown as BrowserFixture).reply(index, { ok: true, requires_login: true }), change);
    await page.waitForURL("**/login?email=new%40example.com");
    assert.equal(f.routes.some(url => /Old-Temporary|New-Password/.test(url)), false);
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("an actor change discards the previous handoff response and credentials", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const f = await setup(page);
    const first = await pending(page, "/api/auth/signup-access/password");
    await page.evaluate(() => (window as unknown as BrowserFixture).render({ actorUserId: "actor-b", temporaryPasswordWelcomeId: "welcome-b", email: "second@example.com" }));
    await page.waitForFunction(() => (window as unknown as BrowserFixture).requests.filter(r => r.url === "/api/auth/signup-access/password").length === 2);
    await page.evaluate(index => (window as unknown as BrowserFixture).reply(index, { required: true, currentPassword: "Previous-Temporary42!" }), first);
    assert.equal(await page.getByRole("dialog").isVisible(), false);
    await answerWelcome(page, { required: true, currentPassword: "Second-Temporary42!" });
    await page.getByRole("dialog").waitFor({ state: "visible" });
    assert.equal(await page.getByText("second@example.com", { exact: true }).count(), 1);
    assert.equal(await page.getByText("new@example.com", { exact: true }).count(), 0);
    await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("New-Password42!");
    await page.getByLabel("Confirmez le mot de passe", { exact: true }).fill("New-Password42!");
    await page.getByRole("button", { name: "Enregistrer et continuer" }).click();
    const change = await pending(page, "/api/auth/change-password");
    assert.deepEqual(await page.evaluate(index => (window as unknown as BrowserFixture).requests[index].body, change), { currentPassword: "Second-Temporary42!", password: "New-Password42!" });
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});
