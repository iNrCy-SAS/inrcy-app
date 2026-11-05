import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";
const require = createRequire(import.meta.url), repo = fileURLToPath(new URL("../../", import.meta.url));
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002";
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources: Record<string, string> = { react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"), "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js") }, links: Record<string, Record<string, string>> = {};
function add(file: string) {
  const id = file.replaceAll("\\", "/"); if (sources[id]) return id; const raw = readFileSync(file, "utf8"); sources[id] = ts.transpileModule(raw, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText; links[id] = {};
  const ast = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) { const name = node.moduleSpecifier.text; if (name.endsWith(".css") || ["@/lib/browserAccountCache", "@/lib/supabaseClient"].includes(name) || /DashboardViewerAccessProvider|DashboardEditionProvider|DashboardAssistantSession|dashboardAssistantCopy|dashboardAssistantSessionState|useAssistantFirstArrival|DashboardUnsavedNavigationProvider/.test(name)) continue;
    const base = name.startsWith("@/") ? resolve(repo, name.slice(2)) : name.startsWith(".") ? resolve(dirname(file), name) : ""; if (!base) continue; const target = [base, base + ".ts", base + ".tsx"].find(value => existsSync(value)); assert.ok(target, name); links[id][name] = add(target);
  } return id;
}
const component = add(resolve(repo, "app/dashboard/settings/_components/InrBadgeSettingsContent.tsx")), nativeModule = add(resolve(repo, "lib/inrAssistantLocalInterface.ts")), providerModule = add(resolve(repo, "app/dashboard/_components/DashboardAssistantProvider.tsx")), actionsModule = add(resolve(repo, "lib/inrAssistantUiActions.ts")), canvasModule = add(resolve(repo, "lib/inrBadgeThemeClient.ts"));
const messages = JSON.parse(readFileSync(resolve(repo, "messages/fr-FR/settings.json"), "utf8"));
const fixture = `
const sources=${JSON.stringify(sources)},links=${JSON.stringify(links)},subject=${JSON.stringify(component)},nativeId=${JSON.stringify(nativeModule)},providerId=${JSON.stringify(providerModule)},actionsId=${JSON.stringify(actionsModule)},canvasId=${JSON.stringify(canvasModule)},messages=${JSON.stringify(messages)},cache={},process={env:{}};
window.account=${JSON.stringify(ACCOUNT)};window.actor=${JSON.stringify(ACTOR)};window.errors=[];window.canvasReads=0;window.addEventListener('error',event=>window.errors.push(String(event.error?.stack||event.message)));
const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){if(args[0]==='2d')window.canvasReads++;return getContext.apply(this,args)};
const t=(key,values={})=>String(messages[key]??key).replace(/\\{(\\w+)\\}/g,(_,name)=>values[name]??'');
function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};function require(name){
 if(name.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};if(name==='next-intl')return{useTranslations:()=>t,useLocale:()=> 'fr-FR'};if(name==='next/navigation')return{usePathname:()=>'/dashboard',useSearchParams:()=>new URLSearchParams('panel=inrbadge'),useRouter:()=>({refresh(){},push(){throw Error('Badge theme must not navigate')}})};
 if(name==='@/lib/supabaseClient')return{createClient:()=>({auth:{onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}}}})};
 if(name.endsWith('DashboardAssistantSession'))return{__esModule:true,default:props=>{window.assistantProps=props;return null}};if(name.endsWith('dashboardAssistantCopy'))return{dashboardAssistantCopy:()=>({open:'Open',restore:'Restore',minimize:'Minimize'})};if(name.endsWith('dashboardAssistantSessionState'))return{clearActorSessions(){}};if(name.endsWith('useAssistantFirstArrival'))return{useAssistantFirstArrival(){}};if(name.endsWith('DashboardUnsavedNavigationProvider'))return{useDashboardUnsavedNavigation:()=>({requestNavigation:async action=>{await action();return true}})};
 if(name==='@/lib/browserAccountCache')return{getActiveBrowserUserId:()=>window.account};if(name.endsWith('DashboardViewerAccessProvider'))return{useDashboardViewerAccess:()=>({actorUserId:window.actor,activeAccountId:window.account,metaPilotEnabled:false})};if(name.endsWith('DashboardEditionProvider'))return{useDashboardEdition:()=> 'basic'};
 if(name==='@/lib/inrBadgeThemeClient')return load(canvasId);const target=links[id]?.[name]??name;if(!sources[target])throw Error('Unexpected native Badge fixture dependency '+name);return load(target)
 }new Function('require','module','exports','process',sources[id])(require,module,module.exports,process);return module.exports}
const React=load('react'),Component=load(subject).default,Provider=load(providerId).default,root=load('react-dom/client').createRoot(document.getElementById('root')),profile={userId:${JSON.stringify(ACCOUNT)},logoUrl:'https://badge-theme.fixture.invalid/native-logo.svg',companyLegalName:'Synthetic workshop',firstName:'Example',lastName:'Professional',phone:'',contactEmail:''},channels=Object.fromEntries(['inrSearch','siteWeb','googleBusiness','facebook','instagram','threads','linkedin','mails','tiktok','youtubeShorts'].map(key=>[key,{connected:false}]));
window.renderFixture=()=>root.render(React.createElement(Provider,null,React.createElement(Component,{profile,publicUrl:'https://badge-theme.fixture.invalid/badge/native-workshop',profileReady:true,channels,onOpenProfile(){},onOpenCalendarSettings(){}})));window.renderFixture();
window.nativeHint=()=>load(nativeId).getInrAssistantLocalInterfaceHints({actorUserId:window.actor,accountId:window.account,pathname:'/dashboard'})?.find(hint=>hint.id==='badge_identity_theme');
window.runNative=async(revision)=>{const hint=window.nativeHint();if(!hint)return false;const actions=load(actionsId).inrAssistantUiActionsFromToolResult('badge-logo-native',{ok:true,uiCommand:{command:'refresh_badge_theme_from_logo',selection:{kind:'channel',id:'inrbadge'},revision:revision||hint.revision}});window.providerResults=await window.assistantProps.onUiActions(actions);return window.providerResults[0]?.status==='applied'};
`;
async function mount(page: Page, mode: "ok" | "reject" | "wrong_readback" | "switch_actor" = "ok") {
  let theme: Record<string, unknown> = { id: "aurora", identityColors: null }, reads = 0; const writes: Array<Record<string, unknown>> = [], paths: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()); paths.push(url.pathname);
    if (url.pathname.endsWith("/icon.png")) { if (mode === "switch_actor") await page.evaluate("window.actor='different-actor';window.renderFixture()"); await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#de2222"/><rect width="28" height="72" fill="#2255dd"/><rect x="48" width="24" height="72" fill="#22aa55"/></svg>' }); return; }
    if (url.pathname === "/api/inrbadge/settings") {
      if (request.method() === "PATCH") { const body = request.postDataJSON() as Record<string, unknown>; writes.push(body); assert.equal(body.expectedAccountId, ACCOUNT); assert.equal(body.expectedActorUserId, ACTOR); assert.deepEqual(body.expectedTheme, theme); assert.deepEqual(Object.keys(body).sort(), ["theme", "expectedAccountId", "expectedActorUserId", "expectedTheme"].sort());
        if (mode === "reject") { await route.fulfill({ status: 409, json: { ok: false } }); return; } theme = body.theme as Record<string, unknown>;
      } else reads++;
      await route.fulfill({ json: { ok: true, accountId: ACCOUNT, actorAuthUserId: ACTOR, settings: {}, theme: mode === "wrong_readback" && writes.length ? { id: "ocean", identityColors: null } : theme, selectedMailAccountId: "" } }); return;
    }
    if (request.resourceType() === "document") { await route.fulfill({ contentType: "text/html", body: "<html><body><div id='root'></div></body></html>" }); return; }
    await route.abort();
  });
  await page.goto("https://badge-theme.fixture.invalid/dashboard"); await page.addScriptTag({ content: fixture }); await page.waitForFunction("window.errors.length||Boolean(window.nativeHint())"); assert.deepEqual(await page.evaluate("window.errors"), []); return { writes, paths, reads: () => reads, theme: () => theme };
}

test("Basic actual Badge logo operation uses real Canvas colors native scoped CAS persistence and exact readback before rendered acknowledgement", async () => {
  const browser = await chromium.launch({ headless: true }); try { const page = await browser.newPage(), h = await mount(page); const stale = await page.evaluate("window.nativeHint().revision") as string;
    const results = await page.evaluate("Promise.all([window.runNative(),window.runNative()])") as boolean[]; assert.deepEqual(results, [true, false]); assert.equal(h.writes.length, 1); assert.equal(h.theme().id, "identity"); assert.ok(h.theme().identityColors); assert.equal(await page.evaluate("window.canvasReads"), 1); assert.equal(h.reads(), 3);
    assert.equal(await page.getByRole("button", { name: /Identité entreprise/ }).getAttribute("aria-pressed"), "true"); assert.equal(await page.evaluate(revision => (window as unknown as { runNative: (revision: string) => Promise<boolean> }).runNative(revision), stale), false); assert.equal(h.writes.length, 1);
    assert.equal(await page.evaluate("window.runNative()"), true); assert.equal(h.writes.length, 1, "A repeated verified palette needs no second native PATCH"); assert.equal(await page.evaluate("window.canvasReads"), 2); assert.deepEqual(await page.evaluate("window.errors"), []); assert.ok(h.paths.every(path => path === "/dashboard" || path === "/api/inrbadge/settings" || path.endsWith("/icon.png"))); await page.close();
  } finally { await browser.close(); }
});
test("Basic actual Badge logo operation refuses provider rejection wrong persisted readback and actor drift without claiming a saved theme", async () => {
  const browser = await chromium.launch({ headless: true }); try { for (const mode of ["reject", "wrong_readback", "switch_actor"] as const) { const page = await browser.newPage(), h = await mount(page, mode); assert.equal(await page.evaluate("window.runNative()"), false, mode); assert.equal(h.writes.length, mode === "switch_actor" ? 0 : 1); assert.equal(await page.getByRole("button", { name: /Identité entreprise/ }).getAttribute("aria-pressed"), "false"); assert.equal(await page.getByText("Couleurs du logo appliquées au badge.", { exact: true }).count(), 0); assert.deepEqual(await page.evaluate("window.errors"), []); await page.close(); } } finally { await browser.close(); }
});
