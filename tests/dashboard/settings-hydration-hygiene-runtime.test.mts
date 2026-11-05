import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const mocked = new Set([
  "@/lib/browserAccountCache", "@/lib/supabaseClient", "@/lib/profileLogo",
  "@/lib/boosterGenerationContextClient", "@/lib/publicProfileRefreshClient",
  "@/lib/inrcyDialog", "@/lib/userFacingErrors",
]);
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");

function modules(component: string) {
  const sources: Record<string, string> = {
    react: packageSource("react", "react.development.js"),
    "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
    "react-dom": packageSource("react-dom", "react-dom.development.js"),
    "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
    scheduler: packageSource("scheduler", "scheduler.development.js"),
  };
  const links: Record<string, Record<string, string>> = {};
  function add(file: string) {
    const id = file.replaceAll("\\", "/");
    if (sources[id]) return id;
    const source = readFileSync(file, "utf8");
    sources[id] = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    links[id] = {};
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of tree.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (mocked.has(specifier) || specifier.endsWith(".css") || specifier.endsWith("channel-workspace-snapshot")) continue;
      const base = specifier.startsWith("@/") ? resolve(repo, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(file), specifier) : null;
      if (!base || !base.replaceAll("\\", "/").includes("/lib/") && !/\/_hooks\/useInrAssistant|DashboardAssistant(?:Screen|Command)Context/.test(base.replaceAll("\\", "/"))) continue;
      const target = [base, base + ".ts", base + ".tsx"].find(candidate => existsSync(candidate));
      if (!target) throw Error(`Unresolved fixture import ${specifier}`);
      links[id][specifier] = add(target);
    }
    return id;
  }
  return { sources, links, subject: add(resolve(repo, `app/dashboard/settings/_components/${component}.tsx`)) };
}

async function mount(page: Page, component: string) {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.stack || error.message));
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' }) : route.abort());
  await page.goto("https://settings-hydration.fixture.invalid/dashboard/settings/ia");
  await page.addScriptTag({ content: `
    const fixture=${JSON.stringify(modules(component))},cache={},process={env:{NODE_ENV:'development'}};
    window.requests=[];window.authRequests=0;window.locale='fr';window.edition='standard';window.account='account-1';window.snapshots=[];
    const query={select(){return this},eq(){return this},maybeSingle(){return new Promise((resolve,reject)=>window.requests.push({resolve:data=>resolve({data,error:null}),reject}))}};
    const client={auth:{getUser:async()=>{window.authRequests++;return{data:{user:{id:window.account,email:'test@example.invalid'}},error:null}}},from:()=>query};
    const translate={fr:key=>'fr:'+key,en:key=>'en:'+key};
    const mocks={
      '@/lib/browserAccountCache':{resolveActiveBrowserUserId:id=>id,getActiveBrowserUserId:()=>window.account,readAccountCacheValue:()=>null,writeAccountCacheValue:()=>{}},
      '@/lib/supabaseClient':{createClient:()=>client},
      '@/lib/profileLogo':{LOGO_BUCKET:'fixture',resolveProfileLogoUrl:async()=>({logoUrl:'',logoPath:''}),getProfileLogoDisplayUrl:value=>value,revokeBlobUrl(){}},
      '@/lib/boosterGenerationContextClient':{invalidateBoosterGenerationContextClient:async()=>{}},
      '@/lib/publicProfileRefreshClient':{refreshPublicProfileDependents:async()=>{}},
      '@/lib/inrcyDialog':{confirmInrcy:async()=>false,chooseInrcy:async()=>null},
      '@/lib/userFacingErrors':{getClientUserFacingErrorMessage:(_error,fallback)=>fallback}
    };
    function load(name,parent){
      if(mocks[name])return mocks[name];
      if(name==='next-intl')return{useTranslations:()=>React.useContext(Locale),useLocale:()=>window.locale};
      if(name==='next/navigation')return{usePathname:()=>'/dashboard/settings/ia'};
      if(name.endsWith('DashboardViewerAccessProvider'))return{useDashboardViewerAccess:()=>({actorUserId:'',activeAccountId:'',metaPilotEnabled:false})};
      if(name.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
      if(name.endsWith('channel-workspace-snapshot'))return{readChannelWorkspaceSnapshot:(_key,fallback)=>fallback,writeChannelWorkspaceSnapshot:(_key,value)=>window.snapshots.push(value)};
      const id=fixture.links[parent]?.[name]||name;
      if(cache[id])return cache[id].exports;
      if(!fixture.sources[id]){
        if(name.startsWith('.')||name.startsWith('@/app/'))return{__esModule:true,default:props=>React.createElement('div',null,props.children)};
        throw Error('Unexpected import '+name+' from '+parent);
      }
      const module=cache[id]={exports:{}};
      new Function('require','module','exports','process',fixture.sources[id])(next=>load(next,id),module,module.exports,process);
      return module.exports;
    }
    const React=load('react'),Locale=React.createContext(translate.fr),Subject=load(fixture.subject).default;
    const root=load('react-dom/client').createRoot(document.getElementById('root'));
    window.fetch=url=>new Promise((resolve,reject)=>window.requests.push({url,resolve:payload=>resolve(Response.json(payload)),reject}));
    const onUnsavedChange=value=>{window.dirty=value};
    window.render=()=>root.render(React.createElement(Locale.Provider,{value:translate[window.locale]},React.createElement(Subject,{edition:window.edition,onUnsavedChange,renderBubble:model=>React.createElement('div',null,model.parameters)})));
    window.unmount=()=>root.unmount();window.render();
  ` });
  page.setDefaultTimeout(5_000);
  await page.waitForFunction("window.requests.length === 1").catch(error => { assert.deepEqual(errors, [], `${component}: browser runtime`); throw error; });
}

for (const [component, errorKey] of [
  ["ProfilContent", "profile_load_failed"],
  ["ActivityContent", "profile_load_failed"],
  ["BusinessLegalSettingsCard", "business_legal_load_failed"],
  ["AiConfigurationContent", "ai_configuration_load_failed"],
]) {
  test(`${component}: changing language preserves one load and reports a delayed failure in the current language`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await mount(page, component);
      await page.evaluate("window.locale='en';window.render()");
      await page.getByText(/en:/).first().waitFor();
      assert.equal(await page.evaluate("window.requests.length"), 1);
      await page.evaluate("window.requests[0].reject(new Error('fixture failure'))");
      try { await page.getByText(`en:${errorKey}`, { exact: true }).waitFor(); }
      catch (error) {
        throw new Error(JSON.stringify({ component, errors, renderedErrors: await page.locator('body').innerText() }), { cause: error });
      }
      assert.equal(await page.evaluate("window.authRequests"), 1);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

test("profile and legal drafts survive a language change after loading", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const component of ["ProfilContent", "BusinessLegalSettingsCard"]) {
      const page = await browser.newPage();
      await mount(page, component);
      await page.evaluate("window.requests[0].resolve({first_name:'Initial',company_legal_name:'Initial',legal_form:'EI'})");
      await page.locator('input[value="Initial"]').first().waitFor();
      const index = await page.locator('input').evaluateAll(inputs => inputs.findIndex(input => (input as HTMLInputElement).value === "Initial"));
      const input = page.locator('input').nth(index);
      await input.fill("My unsaved draft");
      await page.evaluate("window.locale='en';window.render()");
      await page.getByText(/en:/).first().waitFor();
      assert.equal(await input.inputValue(), "My unsaved draft");
      assert.equal(await page.evaluate("window.requests.length"), 1);
      assert.equal(await page.evaluate("window.dirty"), true);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("YouTube preferences survive language changes without refetching the saved settings", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await mount(page, "YoutubeShortsSettingsContent");
    await page.evaluate("window.requests[0].resolve({ok:true,youtube_shorts:{connected:true,accountConnected:true,defaultVisibility:'public'}})");
    await page.locator('select').selectOption('private');
    await page.evaluate("window.locale='en';window.render()");
    await page.getByText(/en:/).first().waitFor();
    assert.equal(await page.locator('select').inputValue(), 'private');
    assert.equal(await page.evaluate("window.requests.length"), 1);
    assert.equal(await page.evaluate("window.dirty"), true);
    await page.evaluate("window.unmount()");
  } finally { await browser.close(); }
});

test("Pinterest keeps the board draft and does not reload status or boards when language changes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await mount(page, "PinterestSettingsContent");
    await page.evaluate("window.requests[0].resolve({ok:true,connected:true,username:'fixture',boards:[{id:'board-1',name:'Existing board'}],defaultBoardId:'board-1'})");
    await page.waitForFunction("window.requests.length === 3");
    await page.evaluate("window.requests.slice(1).forEach(request=>request.resolve({ok:true,connected:true,username:'fixture',boards:[{id:'board-1',name:'Existing board'}],defaultBoardId:'board-1'}))");
    const input = page.locator('input').first();
    await input.fill('Unsaved board');
    const requestsBefore = await page.evaluate<string[]>("window.requests.map(request=>request.url)");
    await page.evaluate("window.locale='en';window.render()");
    await page.getByText(/en:/).first().waitFor();
    await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(await input.inputValue(), 'Unsaved board');
    assert.deepEqual(await page.evaluate("window.requests.map(request=>request.url)"), requestsBefore);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
