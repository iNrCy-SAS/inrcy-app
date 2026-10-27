import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string, extra = "") => ts.transpileModule(read(file) + extra, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources = {
  react: packageSource("react", "react.production.js"),
  "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"),
  scheduler: packageSource("scheduler", "scheduler.production.js"),
  session: compile("app/dashboard/_components/DashboardAssistantProvider.tsx", "\nexport { AssistantSession as TestSession };"),
  "./dashboardAssistantCopy": compile("app/dashboard/_components/dashboardAssistantCopy.ts"),
  "./dashboardAssistantErrorCopy": compile("app/dashboard/_components/dashboardAssistantErrorCopy.ts"),
  "./dashboardAssistantAttachmentCopy": compile("app/dashboard/_components/dashboardAssistantAttachmentCopy.ts"),
  "@/lib/inrAssistantAttachments": compile("lib/inrAssistantAttachments.ts"),
  "@/lib/inrAssistantClientContext": compile("lib/inrAssistantClientContext.ts"),
  "./inrAssistantNavigation.ts": compile("lib/inrAssistantNavigation.ts"),
};
const fixture = `
const sources=${JSON.stringify(sources)}, loaded={};
function require(name) {
  if(name.endsWith('.css')) return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
  if(name==='next-intl') return {useLocale:()=> 'fr-FR'};
  if(name==='next/image') return {__esModule:true,default:props=>require('react').createElement('img',props)};
  if(name==='next/dynamic') return {__esModule:true,default:()=>()=>null};
  if(name==='next/navigation') return {usePathname:()=>'/dashboard',useSearchParams:()=>new URLSearchParams(),useRouter:()=>({push(){}})};
  if(name==='@/lib/browserAccountCache') return {getActiveBrowserUserId:()=> 'account-fixture'};
  if(name==='@/lib/multicompte/constants') return {ACTIVE_INRCY_ACCOUNT_EVENT:'fixture-account-change'};
  if(name==='@/lib/supabaseClient') return {};
  if(name==='@/lib/inrAssistantClientStream') return {readInrAssistantResponse(){throw Error('No chat request expected')}};
  if(name==='@/lib/inrAssistantContextualHelp') return {getInrAssistantContextualHelp:()=>null};
  if(name==='./DashboardViewerAccessProvider') return {};
  if(name==='./DashboardAssistantMessageContent') return {__esModule:true,default:()=>null};
  if(name==='./DashboardUnsavedNavigationProvider') return {useDashboardUnsavedNavigation:()=>({requestNavigation:async callback=>callback()})};
  if(name.endsWith('/useAssistantFirstArrival')) return {useAssistantFirstArrival(){}};
  if(name.endsWith('/useAssistantAttachments')) return {useAssistantAttachments:()=>({attachments:[],setAttachments(){},busy:false,error:null,menuOpen:false,libraryOpen:false,inputRef:{current:null},reset(){}})};
  if(loaded[name]) return loaded[name].exports;
  if(!sources[name]) throw Error('Unexpected viewport fixture module '+name);
  const module=loaded[name]={exports:{}};
  new Function('require','module','exports',sources[name])(require,module,module.exports);
  return module.exports;
}
window.fetch=async()=>new Response(JSON.stringify({available:true,conversation:null}),{headers:{'Content-Type':'application/json'}});
const viewport=new EventTarget();
Object.assign(viewport,{width:innerWidth,height:innerHeight,offsetTop:0,offsetLeft:0,scale:1});
Object.defineProperty(window,'visualViewport',{configurable:true,value:location.search.includes('fallback')?undefined:viewport});
window.updateViewport=(bounds,event='resize')=>{Object.assign(viewport,bounds);viewport.dispatchEvent(new Event(event))};
const React=require('react');
function Fixture() {
  const [open,setOpen]=React.useState(true);
  return React.createElement(require('session').TestSession,{actorUserId:'actor-fixture',activeAccountId:'account-fixture',allowed:true,open,close:()=>setOpen(false),minimize:()=>setOpen(false),onHumanContact(){}});
}
require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const css = read("app/dashboard/_components/DashboardAssistantProvider.module.css");
const avatar = readFileSync(new URL("../../public/agent/agent-assist-pink-v2.png", import.meta.url));
const html = `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
${css}
:root{--inrcy-mobile-bottom-nav-total-height:66px;--inrcy-safe-area-top:0px;--inrcy-safe-area-bottom:0px}
body{margin:0;background:#080c22;font:16px Arial;color:#fff}button,textarea{font-family:inherit}
#navigation{position:fixed;bottom:0;height:66px;width:100%;background:#503950}
</style></head><body><div id="navigation">Navigation mobile</div><div id="root"></div></body></html>`;

type Bounds = { x: number; y: number; width: number; height: number };
async function assertBounds(page: Page, expected: Bounds) {
  await page.waitForFunction(bounds => {
    const rect = document.querySelector("dialog")?.getBoundingClientRect();
    return rect && Object.entries(bounds).every(([key, value]) => Math.abs(rect[key as keyof DOMRect] as number - value) < 1);
  }, expected);
  const dialog = await page.getByRole("dialog").boundingBox();
  assert.ok(dialog);
  for (const key of ["x", "y", "width", "height"] as const) assert.ok(Math.abs(dialog[key] - expected[key]) < 1, key);
  const input = await page.getByRole("textbox").boundingBox();
  assert.ok(input && input.y >= expected.y && input.y + input.height <= expected.y + expected.height, "The composer stays inside the visible viewport");
  assert.equal(await page.getByRole("textbox").evaluate(element => element === document.activeElement), true, "Viewport updates must preserve typing focus");
}

test("mobile assistant fills the visible viewport across keyboard resize, browser pan, orientation and safe areas", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: html }) : route.request().url().endsWith("agent-assist-pink-v2.png") ? route.fulfill({ contentType: "image/png", body: avatar }) : route.abort());
    await page.goto("https://fixture.invalid/assistant");
    await page.addScriptTag({ content: fixture });
    assert.deepEqual(errors, []);
    await assertBounds(page, { x: 0, y: 0, width: 390, height: 844 });
    await page.getByRole("textbox").fill("Prépare une publication pour mes canaux.");
    const update = (bounds: object, event = "resize") => page.evaluate(({ bounds, event }) => {
      (window as unknown as { updateViewport: (bounds: object, event: string) => void }).updateViewport(bounds, event);
    }, { bounds, event });
    await update({ height: 430 });
    await assertBounds(page, { x: 0, y: 0, width: 390, height: 430 });
    await update({ offsetTop: 55 }, "scroll");
    await assertBounds(page, { x: 0, y: 55, width: 390, height: 430 });
    await update({ width: 360, offsetLeft: 15 });
    await assertBounds(page, { x: 15, y: 55, width: 360, height: 430 });
    await update({ offsetTop: 0, offsetLeft: 0, width: 390 });
    await page.evaluate(() => { document.documentElement.style.setProperty("--inrcy-safe-area-top", "16px"); document.documentElement.style.setProperty("--inrcy-safe-area-bottom", "34px"); });
    await assertBounds(page, { x: 0, y: 0, width: 390, height: 430 });
    assert.equal(await page.locator(".header").evaluate(element => getComputedStyle(element).paddingTop), "16px");
    assert.equal(await page.locator(".composer").evaluate(element => getComputedStyle(element).paddingBottom), "34px");
    assert.equal(await page.getByRole("textbox").inputValue(), "Prépare une publication pour mes canaux.");
    if (process.env.INRCY_ASSISTANT_VIEWPORT_PROOF) {
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--inrcy-safe-area-top", "0px"); document.documentElement.style.setProperty("--inrcy-safe-area-bottom", "0px");
        const keyboard = document.createElement("div"); keyboard.textContent = "Clavier simulé — espace visible : 390 × 430";
        keyboard.style.cssText = "position:fixed;inset:430px 0 0;background:#d9dce5;color:#17213b;padding:28px 15px;text-align:center;font:14px Arial";
        document.body.append(keyboard);
      });
      await page.screenshot({ path: process.env.INRCY_ASSISTANT_VIEWPORT_PROOF });
    }
    await update({ height: 844 });
    await assertBounds(page, { x: 0, y: 0, width: 390, height: 844 });
    await page.setViewportSize({ width: 844, height: 390 });
    await update({ width: 844, height: 390 });
    await assertBounds(page, { x: 0, y: 0, width: 844, height: 390 });
    await page.getByRole("button", { name: /^Fermer/ }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.deepEqual(errors, []);
    await page.close();

    const fallback = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await fallback.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
    await fallback.goto("https://fixture.invalid/assistant?fallback");
    await fallback.addScriptTag({ content: fixture });
    await assertBounds(fallback, { x: 0, y: 0, width: 390, height: 844 });
    await fallback.setViewportSize({ width: 390, height: 430 });
    await assertBounds(fallback, { x: 0, y: 0, width: 390, height: 430 });
    await fallback.close();

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await desktop.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
    await desktop.goto("https://fixture.invalid/assistant");
    await desktop.addScriptTag({ content: fixture });
    await desktop.getByRole("dialog").waitFor({ state: "visible" });
    const rect = await desktop.getByRole("dialog").boundingBox();
    assert.ok(rect && rect.x > 800 && rect.y === 16 && Math.abs(rect.height - 868) <= 2, "Desktop retains its floating window layout");
  } finally { await browser.close(); }
});
