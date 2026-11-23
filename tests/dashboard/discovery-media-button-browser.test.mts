import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import ts from "typescript";

// Execute the real media button and subscription-navigation hook in a browser.
// The surrounding media picker, account context and navigation are synthetic.
const repo = process.cwd(), require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(resolve(repo, file), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources: Record<string, string> = {
  react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"),
  panel: compile("app/dashboard/booster/publier/components/PublishMediaPoolPanel.tsx"),
  gate: compile("app/dashboard/_hooks/usePaidMediaAction.ts"),
};
const messages = Object.fromEntries(["booster", "shell", "dashboard", "auth"].map(name => [name, JSON.parse(read(`messages/fr-FR/${name}.json`))]));
const script = `
const sources=${JSON.stringify(sources)},messages=${JSON.stringify(messages)},loaded={},process={env:{NODE_ENV:'production'}};
window.routes=[];window.generated=[];window.errors=[];window.guardCalls=0;
window.addEventListener('error',event=>window.errors.push(String(event.error?.stack||event.message)));
const translators={};function translate(ns){return translators[ns]??=((key,values={})=>{let v=key.split('.').reduce((obj,k)=>obj?.[k],messages[ns]);return String(v??key).replace(/\\{(\\w+)\\}/g,(_,k)=>values[k]??'')})}
function load(id){if(loaded[id])return loaded[id].exports;const module=loaded[id]={exports:{}};const req=name=>{
 if(['react','react/jsx-runtime','react-dom','react-dom/client','scheduler'].includes(name))return load(name);
 if(name.endsWith('usePaidMediaAction'))return load('gate');
 if(name.endsWith('DashboardViewerAccessProvider'))return {useDashboardViewerAccess:()=>({paidActionsLocked:window.fixtureLocked})};
 if(name.endsWith('DashboardUnsavedNavigationProvider'))return {useDashboardUnsavedNavigation:()=>({requestNavigation:async action=>{window.guardCalls++;action();return true}})};
 if(name==='next/navigation')return {useRouter:()=>({push:path=>window.routes.push(path)})};
 if(name==='next-intl')return {useTranslations:ns=>translate(ns)};
 if(name.endsWith('.module.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(name==='./MediaPoolImagePreview')return {__esModule:true,default:()=>null};
 if(name==='../publishModal.shared')return {BOOSTER_MAX_IMAGE_COUNT:4,makeImageKey:()=>'',getLocalizedBoosterImageLimits:()=>'',getLocalizedBoosterImageFormats:()=>'',getLocalizedBoosterVideoLimits:()=>'',getLocalizedBoosterVideoFormats:()=>'',getLocalizedBoosterRecommendedVideoDuration:()=>''};
 throw Error('Unexpected dependency '+name);
 };new Function('require','module','exports','process',sources[id])(req,module,module.exports,process);return module.exports}
const React=load('react'),Panel=load('panel').default,root=load('react-dom/client').createRoot(document.getElementById('root'));
const noop=()=>{};root.render(React.createElement(Panel,{images:[],imagePreviews:[],videoFile:null,videoPreviewUrl:'',isMobile:false,
 onPickImages:noop,onPickVideo:noop,onGenerate:kind=>window.generated.push(kind),onLibrary:noop,onCamera:noop,onRemoveImage:noop,onRemoveVideo:noop,onReorderImage:noop,onModifyImage:noop,onRetouchImage:noop,onRetouchVideo:noop}));
`;

test("a locked media-generation button opens Mon abonnement, while a subscribed account enters the normal media flow", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locked of [true, false]) {
      const page = await browser.newPage(); const paidRequests: string[] = [];
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.startsWith("/api/") && request.method() !== "GET") paidRequests.push(url.pathname);
        await route.fulfill({ contentType: "text/html", body: "<html><body><div id='root'></div></body></html>" });
      });
      await page.goto("https://media.fixture.invalid/dashboard/booster/publier");
      await page.evaluate(value => { (window as any).fixtureLocked = value; }, locked);
      await page.addScriptTag({ content: script });
      const imageSection = page.getByRole("region", { name: messages.booster.wizard_pool_images });
      const button = imageSection.getByRole("button", { name: new RegExp(messages.booster.wizard_generate_media) });
      await button.waitFor(); assert.equal(await button.isEnabled(), true);
      if (locked) assert.equal(await button.evaluate(node => getComputedStyle(node).filter), "grayscale(1)");
      await button.click();
      if (locked) {
        assert.deepEqual(await page.evaluate(() => (window as any).routes), ["/dashboard?panel=abonnement"]);
        assert.equal(await page.evaluate(() => (window as any).guardCalls), 1);
        assert.deepEqual(await page.evaluate(() => (window as any).generated), []);
      } else {
        assert.deepEqual(await page.evaluate(() => (window as any).routes), []);
        assert.deepEqual(await page.evaluate(() => (window as any).generated), ["image"]);
      }
      assert.deepEqual(paidRequests, []); assert.deepEqual(await page.evaluate(() => (window as any).errors), []);
      await page.close();
    }
  } finally { await browser.close(); }
});
