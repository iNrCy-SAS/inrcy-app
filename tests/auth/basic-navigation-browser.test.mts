import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Browser } from "@playwright/test";
import ts from "typescript";
import { BASIC_RESET_PRESENTATION_ROUTES } from "../../lib/basicNavigation.ts";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const catalogs = { auth: JSON.parse(read("messages/fr-FR/auth.json")), public: JSON.parse(read("messages/fr-FR/public.json")), shell: JSON.parse(read("messages/fr-FR/shell.json")) };
const sources = {
  react: packageSource("react", "react.development.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
  "react-dom": packageSource("react-dom", "react-dom.development.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"), scheduler: packageSource("scheduler", "scheduler.development.js"),
  login: compile("app/login/page.tsx"), finish: compile("app/auth/_components/FinishEmailLinkClient.tsx"), basicReset: compile("app/auth/_components/BasicResetPage.tsx"),
  diagnostic: compile("app/diagnostic/DiagnosticClient.tsx"), recovery: compile("app/diagnostic/ConnectionRecovery.tsx"), cookies: compile("app/_components/CookieConsentBanner.tsx"),
  navigation: compile("lib/basicNavigation.ts"), emailLinks: compile("lib/authEmailLinks.ts"), password: compile("lib/passwordPolicy.ts"), linkCheck: compile("lib/authPasswordLinkCheck.ts"),
  recoveryPolicy: compile("lib/connectionRecovery.ts"), temporary: compile("lib/temporaryPasswordPolicy.ts"), i18n: compile("i18n/config.ts"),
  ...Object.fromEntries(Object.entries(BASIC_RESET_PRESENTATION_ROUTES).map(([path, language]) => [`alias-${language}`, compile(`app${path}/page.tsx`)])),
};

async function fixture(browser: Browser, path: string, component: string) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors: string[] = [], routes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => { routes.push(route.request().url()); return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' }); });
  await page.goto(`https://app.example.invalid${path}`);
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},catalogs=${JSON.stringify(catalogs)},cache={},process={env:{NODE_ENV:'development'}};
    const translators={};function catalog(namespace){return namespace.split('.').reduce((value,key)=>value[key],catalogs)};
    function translator(namespace){if(translators[namespace])return translators[namespace];const messages=catalog(namespace);const t=(key,args={})=>{let value=key.split('.').reduce((value,part)=>value?.[part],messages);if(typeof value!=='string')throw Error('Missing translation '+namespace+'.'+key);return Object.entries(args).reduce((text,[name,value])=>text.split('{'+name+'}').join(String(value)),value)};t.rich=t;return translators[namespace]=t};
    window.requests=[];window.resetRequests=[];
    const auth={getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:null},error:{name:'AuthSessionMissingError',status:401}}),
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null}),
      resetPasswordForEmail:async(email,options)=>{window.resetRequests.push({email,...options});return {error:null}}};
    const aliases={'@/lib/basicNavigation':'navigation','@/lib/authEmailLinks':'emailLinks','@/lib/passwordPolicy':'password','@/lib/authPasswordLinkCheck':'linkCheck',
      '@/lib/temporaryPasswordPolicy':'temporary','@/i18n/config':'i18n','@/lib/connectionRecovery':'recoveryPolicy',
      '@/app/auth/_components/BasicResetPage':'basicReset','./FinishEmailLinkClient':'finish','./ConnectionRecovery':'recovery'};
    function require(name){
      if(aliases[name])return require(aliases[name]);
      if(name==='next-intl')return {useTranslations:translator,useLocale:()=> 'fr-FR'};
      if(name==='next/navigation')return {useSearchParams:()=>new URLSearchParams(location.search),usePathname:()=>location.pathname};
      if(name==='next/link')return {__esModule:true,default:props=>require('react').createElement('a',props)};
      if(name==='next/image')return {__esModule:true,default:props=>require('react').createElement('img',props)};
      if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
      if(name.endsWith('/AuthLanguageSelector')||name==='./AuthLanguageSelector')return {__esModule:true,default:()=>null};
      if(name==='@/lib/supabaseClient')return {createClient:()=>({auth})};
      if(name==='@/lib/browserAccountCache')return {purgeAllBrowserAccountCaches(){},setActiveBrowserUserId(){}};
      if(name==='@/lib/browserAuthSessionReady')return {waitForServerAuthSession:async()=>false};
      if(name==='@/lib/loginAuthError')return {classifyLoginError:()=>({kind:'technical'})};
      if(name==='@/lib/loginFailureAlertClient')return {reportLoginFailure:async()=>{},reportLoginSuccess:async()=>{}};
      if(name==='@/lib/userFacingErrors')return {getClientUserFacingErrorMessage:(_error,fallback)=>fallback};
      if(name==='@/lib/inrAssistantCookieOptions')return {registerInrAssistantCookieOptions(){}};
      if(cache[name])return cache[name].exports;if(!Object.hasOwn(sources,name))throw Error('Unexpected navigation fixture import '+name);
      const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;
    }
    window.fetch=async(url,options={})=>{
      const request={url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null};window.requests.push(request);
      if(request.url==='/api/auth/password-link-status')return Response.json({valid:true,expires_at:new Date(Date.now()+600000).toISOString()});
      if(request.url==='/api/auth/finish-password'&&request.method==='POST')return Response.json({ok:true,user_id:'actor',email:'synthetic@example.invalid'});
      throw Error('Unexpected synthetic request '+request.url);
    };
    const React=require('react'),Component=require(${JSON.stringify(component)}).default;
    require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Component)));
  ` });
  page.setDefaultTimeout(6000);
  return { page, errors, routes };
}

test("real login keeps Basic signup, help and forgotten-password links explicit while normal login stays unchanged", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const basic of [true, false]) {
      const f = await fixture(browser, `/login${basic ? "?entry=basique" : ""}`, "login");
      assert.equal(await f.page.getByRole("link", { name: catalogs.auth.login.signUp, exact: true }).getAttribute("href"), basic ? "https://inrcy.com/basique/inscription/" : "https://inrcy.com/inscription");
      assert.equal(await f.page.getByRole("link", { name: catalogs.auth.login.needHelp, exact: true }).getAttribute("href"), `/diagnostic?from=login${basic ? "&entry=basique" : ""}`);
      await f.page.getByTestId("login-email").fill("synthetic@example.invalid");
      await f.page.getByTestId("forgot-password").click();
      await f.page.waitForFunction(() => (window as unknown as {resetRequests: unknown[]}).resetRequests.length === 1);
      const sent = await f.page.evaluate(() => (window as unknown as {resetRequests: Array<{email: string; redirectTo: string}>}).resetRequests[0]);
      assert.equal(sent.email, "synthetic@example.invalid");
      assert.equal(sent.redirectTo, basic ? "https://app.example.invalid/reset-basique-fr" : "https://app.example.invalid/auth/finish-reset/fr");
      assert.deepEqual(f.errors, []); assert.ok(f.routes.every(url => url.startsWith("https://app.example.invalid/"))); await f.page.close();
    }
  } finally { await browser.close(); }
});

test("each real Basic alias uses the existing reset screen and keeps its language and login context even for an expired link", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [path, language] of Object.entries(BASIC_RESET_PRESENTATION_ROUTES)) {
      const f = await fixture(browser, `${path}?error=otp_expired`, `alias-${language}`);
      const back = f.page.getByRole("link", { name: catalogs.auth.password.backToLogin, exact: true }); await back.waitFor();
      assert.equal(await back.getAttribute("href"), `/login?lang=${language}&entry=basique`);
      assert.deepEqual(f.errors, []); assert.equal(await f.page.evaluate(() => (window as unknown as {requests: unknown[]}).requests.length), 0); await f.page.close();
    }
    const normal = await fixture(browser, "/auth/finish-reset?error=otp_expired&lang=fr", "finish");
    assert.equal(await normal.page.getByRole("link", { name: catalogs.auth.password.backToLogin, exact: true }).getAttribute("href"), "/login?lang=fr");
    assert.deepEqual(normal.errors, []);
  } finally { await browser.close(); }
});

test("a valid Basic alias submits the unchanged recovery payload and preserves only presentation context on fallback login", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const token = "abcdefghijklmnopqrstuvwxyz012345";
    const f = await fixture(browser, `/reset-basique-fr?token_hash=${token}&type=recovery&email=synthetic%40example.invalid&next=%2Fdashboard`, "alias-fr");
    const password = "Synthetic-NewPassword42!";
    await f.page.locator('input[autocomplete="new-password"]').nth(0).fill(password);
    await f.page.locator('input[autocomplete="new-password"]').nth(1).fill(password);
    await f.page.getByRole("button", { name: catalogs.auth.password.resetPassword, exact: true }).click();
    const requests = await f.page.evaluate(() => (window as unknown as {requests: Array<{url: string; body: unknown}>}).requests);
    const completion = requests.filter(request => request.url === "/api/auth/finish-password"); assert.equal(completion.length, 1);
    assert.deepEqual(completion[0].body, {mode:"reset",type:"recovery",token_hash:token,continuation:null,email:"synthetic@example.invalid",password,language:"fr"});
    await f.page.waitForURL("https://app.example.invalid/login?lang=fr&entry=basique");
    assert.deepEqual(f.errors, []); assert.ok(f.routes.every(url => url.startsWith("https://app.example.invalid/")));
  } finally { await browser.close(); }
});

test("diagnostic and cookie privacy links stay in the explicit Basic presentation without changing normal pages", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const basic of [true, false]) {
      const f = await fixture(browser, `/diagnostic?from=login${basic ? "&entry=basique" : ""}`, "diagnostic");
      for (const link of await f.page.getByRole("link", { name: catalogs.public.retour_connexion_a1ee2d62, exact: true }).all()) assert.equal(await link.getAttribute("href"), `/login${basic ? "?entry=basique" : ""}`);
      assert.ok(await f.page.getByRole("link", { name: catalogs.public.retour_connexion_a1ee2d62, exact: true }).count() > 0);
      assert.deepEqual(f.errors, []); await f.page.close();
      const cookies = await fixture(browser, basic ? "/activer-mon-compte" : "/dashboard", "cookies");
      assert.equal(await cookies.page.getByRole("link", { name: catalogs.shell.politique_de_confidentialite_42b0e51e, exact: true }).getAttribute("href"), basic ? "https://inrcy.com/basique/confidentialite/" : "/legal/confidentialite");
      assert.deepEqual(cookies.errors, []); await cookies.page.close();
    }
  } finally { await browser.close(); }
});
