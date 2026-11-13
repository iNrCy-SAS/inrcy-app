import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

// Execute the production effects themselves, including their early returns and
// native dialog lifecycle, while isolating them from account/network services.
function effect(file: string) {
  const raw = read(file), source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("acquireElementStyleLock")) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(callback, `Missing production scroll effect: ${file}`);
  return compile(`return (${callback.getText(source)});`);
}
const effects = {
  channels: effect("app/dashboard/_components/DashboardChannelsModal.tsx"),
  drawer: effect("app/dashboard/SettingsDrawer.tsx"),
  studio: effect("app/dashboard/_components/MediaGeneratorModal.tsx"),
  assistant: effect("app/dashboard/_hooks/useAssistantDialogViewport.ts"),
  confirmation: effect("app/_components/InrcyDialogProvider.tsx"),
};
const fixture = `
const module={exports:{}};new Function('module','exports',${JSON.stringify(compile(read("lib/elementStyleLock.ts")))})(module,module.exports);
const acquireElementStyleLock=module.exports.acquireElementStyleLock,effects=${JSON.stringify(effects)},releases={};
window.lockStyle=acquireElementStyleLock;
window.openOverlay=(name,overrides={})=>{
 const dialogElement=document.getElementById(name);
 const scope={acquireElementStyleLock,dialogRef:{current:dialogElement},closeButtonRef:{current:null},composerRef:{current:null},previousFocusRef:{current:null},isOpen:true,open:true,mounted:true,portalTarget:document.body,dialog:{type:'alert',options:{}},finish(){},inputRef:{current:null},...overrides};
 const run=new Function(...Object.keys(scope),effects[name])(...Object.values(scope));
 releases[name]=run();
};
window.closeOverlay=name=>releases[name]?.();
`;
async function setup(page: Page) {
  await page.route("**/*", route => route.abort());
  await page.setContent('<!doctype html><html><head><style>html{scroll-behavior:auto}body{margin:0}main{height:2600px;background:linear-gradient(#07132b,#1f466e)}footer{height:80px}dialog{width:200px;height:80px}</style></head><body><main>Long dashboard</main><footer id="bottom">Dashboard footer</footer><dialog id="channels">Channels</dialog><dialog id="assistant">Assistant</dialog></body></html>');
  await page.addScriptTag({ content: fixture });
}
const state = (page: Page) => page.evaluate(() => ({ body: document.body.style.overflow, html: document.documentElement.style.overflow, overscroll: document.documentElement.style.overscrollBehavior }));

test("actual overlapping channels, settings and studio effects retain scrolling ownership in every close order", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const order of [["channels", "drawer", "studio"], ["channels", "studio", "drawer"], ["drawer", "channels", "studio"], ["drawer", "studio", "channels"], ["studio", "channels", "drawer"], ["studio", "drawer", "channels"]]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 768 } });
      await setup(page);
      await page.evaluate("openOverlay('channels');openOverlay('drawer');openOverlay('studio')");
      for (const [index, name] of order.entries()) {
        await page.evaluate(name => (window as unknown as { closeOverlay: (name: string) => void }).closeOverlay(name), name);
        const current = await state(page);
        assert.equal(current.body, index === 2 ? "" : "hidden", `${order}: body after ${name}`);
        assert.equal(current.html, index === 2 ? "" : "hidden", `${order}: root after ${name}`);
        if (index < 2) {
          await page.mouse.move(20, 20); await page.mouse.wheel(0, 6000);
          await page.waitForTimeout(75);
          assert.equal(await page.evaluate(() => window.scrollY), 0, "An open overlay still locks background wheel scrolling");
        }
      }
      assert.equal((await state(page)).overscroll, "");
      await page.mouse.move(20, 20); await page.mouse.wheel(0, 6000);
      await page.waitForFunction(() => document.querySelector("footer")!.getBoundingClientRect().bottom <= window.innerHeight + 1);
      assert.ok(await page.evaluate(() => window.scrollY > 0), "The last cleanup releases the real wheel path to the long dashboard footer");
      await page.close();
    }
  } finally { await browser.close(); }
});

test("actual mobile assistant and confirmation effects keep their ownership after the parent closes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await setup(page);
    await page.evaluate("openOverlay('channels');openOverlay('assistant');closeOverlay('channels')");
    assert.deepEqual(await state(page), { body: "hidden", html: "", overscroll: "" }, "Only the mobile assistant's original body-only lock remains");
    await page.evaluate("closeOverlay('assistant');openOverlay('drawer');openOverlay('confirmation');closeOverlay('drawer')");
    assert.deepEqual(await state(page), { body: "hidden", html: "hidden", overscroll: "" });
    assert.equal(await page.evaluate(() => document.body.style.touchAction), "none");
    await page.evaluate("closeOverlay('confirmation')");
    assert.deepEqual(await state(page), { body: "", html: "", overscroll: "" });
    assert.equal(await page.evaluate(() => document.body.style.touchAction), "");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate("openOverlay('assistant')");
    assert.equal((await state(page)).body, "", "Desktop assistant still acquires no body lock");
    await page.evaluate("closeOverlay('assistant')");
  } finally { await browser.close(); }
});

test("style ownership preserves original values and priorities, external edits and StrictMode cleanup", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page);
    await page.evaluate("document.body.style.setProperty('overflow','scroll','important');document.documentElement.style.overflow='auto';document.documentElement.style.overscrollBehavior='contain';document.body.style.color='red'");
    await page.evaluate("openOverlay('drawer');closeOverlay('drawer');closeOverlay('drawer');openOverlay('drawer');openOverlay('studio');closeOverlay('drawer');closeOverlay('drawer')");
    assert.equal((await state(page)).body, "hidden", "Repeated cleanup cannot release a different owner's lock");
    await page.evaluate("closeOverlay('studio')");
    assert.deepEqual(await state(page), { body: "scroll", html: "auto", overscroll: "contain" });
    assert.equal(await page.evaluate(() => document.body.style.getPropertyPriority("overflow")), "important");
    assert.equal(await page.evaluate(() => document.body.style.color), "red", "Unrelated declarations are never replaced");
    await page.evaluate("openOverlay('drawer');document.body.style.overflow='clip';document.documentElement.style.overscrollBehavior='auto';closeOverlay('drawer')");
    assert.deepEqual(await state(page), { body: "clip", html: "auto", overscroll: "auto" }, "Cleanup does not overwrite deliberate external style changes");
    await page.evaluate("openOverlay('drawer');closeOverlay('drawer')");
    assert.equal((await state(page)).body, "clip", "A later open captures its own fresh baseline");
    await page.evaluate("openOverlay('drawer',{isOpen:false});openOverlay('studio',{open:false});openOverlay('assistant',{open:false});openOverlay('confirmation',{dialog:null})");
    assert.equal((await state(page)).body, "clip", "Inactive effects never acquire ownership");
  } finally { await browser.close(); }
});
