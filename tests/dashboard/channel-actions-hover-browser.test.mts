import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";
import postcss from "postcss";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const sources: Record<string, string> = {};
const aliases: Record<string, Record<string, string>> = {};
const classes: Record<string, Record<string, string>> = {};
const styleTexts: string[] = [];
const boundaries: Record<string, string> = {
  "app/dashboard/_components/DashboardAssistantTrigger.tsx": "nullComponent",
  "app/dashboard/_components/GoogleOAuthConsentBanner.tsx": "nullComponent",
  "app/dashboard/_components/MetaOAuthCallbackNotice.tsx": "nullComponent",
  "app/dashboard/_components/ChannelParametersDialog.tsx": "parameters",
  "app/dashboard/_components/DashboardUnsavedNavigationProvider.tsx": "navigation",
  "app/dashboard/_components/DashboardAssistantScreenContext.tsx": "screen",
  "app/dashboard/_hooks/useInrAssistantLocalInterface.ts": "interface",
  "app/dashboard/_hooks/useInrAssistantNativeChannelLinks.ts": "links",
  "app/dashboard/_hooks/useInrAssistantNativePopover.ts": "popover",
  "lib/userFacingErrors.ts": "errors",
};

/** Real modal, bubble, icon actions, popovers and CSS; isolate account services. */
function add(file: string): string {
  if (boundaries[file]) return `stub:${boundaries[file]}`;
  if (file.endsWith(".css")) {
    if (classes[file]) return file;
    const mapping: Record<string, string> = classes[file] = {};
    const prefix = `fixture${Object.keys(classes).length}_`;
    const ast = postcss.parse(read(file));
    ast.walkAtRules("import", rule => { rule.remove(); });
    ast.walkRules(rule => {
      rule.selector = rule.selector.replace(/:global\(([^)]+)\)/g, "$1").replace(/\.([A-Za-z_][\w-]*)/g, (_match, name: string) => `.${mapping[name] = prefix + name}`);
    });
    styleTexts.push(ast.toString());
    return file;
  }
  if (sources[file]) return file;
  sources[file] = ts.transpileModule(read(file), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const imports: Record<string, string> = aliases[file] = {};
  for (const match of sources[file].matchAll(/require\("([^"]+)"\)/g)) {
    const id = match[1];
    if (!id.startsWith(".") && !id.startsWith("@/")) continue;
    const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(root, path.dirname(file), id);
    const resolved = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map(suffix => base + suffix).find(candidate => existsSync(candidate) && statSync(candidate).isFile());
    assert.ok(resolved, `Resolve ${id} from ${file}`);
    imports[id] = add(path.relative(root, resolved).replaceAll("\\", "/"));
  }
  return file;
}

const subject = add("app/dashboard/_components/DashboardChannelsModal.tsx");
for (const [name, packageName, file] of [
  ["react", "react", "react.development.js"], ["react/jsx-runtime", "react", "react-jsx-runtime.development.js"],
  ["react-dom", "react-dom", "react-dom.development.js"], ["react-dom/client", "react-dom", "react-dom-client.development.js"],
  ["scheduler", "scheduler", "scheduler.development.js"],
]) sources[name] = readFileSync(path.join(path.dirname(require.resolve(`${packageName}/package.json`)), "cjs", file), "utf8");

const bubbleClasses = classes["app/dashboard/_components/DashboardChannelBubble.module.css"];
const modalClasses = classes["app/dashboard/_components/DashboardChannelsModal.module.css"];
const messages = { dashboard: JSON.parse(read("messages/fr-FR/dashboard.json")), shell: JSON.parse(read("messages/fr-FR/shell.json")) };

async function setup(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.abort());
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${read("app/globals.css").replace(/^@import[^;]+;/gm, "")}\n${styleTexts.join("\n")}</style></head><body><div id="root"></div></body></html>`);
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},aliases=${JSON.stringify(aliases)},classes=${JSON.stringify(classes)},messages=${JSON.stringify(messages)},cache={},process={env:{NODE_ENV:'development'}};
    function require(name){
      if(name==='next-intl')return{useTranslations:scope=>key=>[...scope.split('.'),...key.split('.')].reduce((v,k)=>v?.[k],messages)||key};
      if(name==='next/image')return{__esModule:true,default:props=>require('react').createElement('img',props)};
      if(classes[name])return{__esModule:true,default:classes[name]};
      if(name==='stub:nullComponent')return{__esModule:true,default:()=>null};
      if(name==='stub:parameters')return{__esModule:true,default:({children})=>require('react').createElement('section',{'data-parameters':true},children)};
      if(name==='stub:navigation')return{useDashboardUnsavedNavigation:()=>({requestNavigation:async fn=>{fn();return true}})};
      if(name==='stub:screen')return{useInrAssistantScreen(){}};
      if(name==='stub:interface')return{useInrAssistantLocalInterface(){}};
      if(name==='stub:links')return{useInrAssistantRenderedPublicLink(){},useInrAssistantNativeChannelLink(){}};
      if(name==='stub:popover')return{useInrAssistantNativePopover(){}};
      if(name==='stub:errors')return{getClientUserFacingErrorMessage:(_error,fallback)=>fallback};
      if(cache[name])return cache[name].exports;
      if(!sources[name])throw Error('Unexpected channel fixture import '+name);
      const record=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(id=>require(aliases[name]?.[id]||id),record,record.exports,process);return record.exports;
    }
    const React=require('react'),Modal=require(${JSON.stringify(subject)}).default;
    window.fixtureCalls={view:0,disconnect:0,close:0};
    const item={key:'pinterest',name:'Pinterest',description:'Inspire vos clients',accent:'pink',logoSrc:'/pinterest.png',logoAlt:'Pinterest',bubbleStatus:'connected',bubbleStatusText:'Connecté',onConfigure(){},viewAction:{label:'Voir',onClick(){window.fixtureCalls.view++}},connection:{accountConnected:true,accountLabel:'marilyndintrieur',resourceLabel:'actualité',value:'board',options:[{value:'board',label:'actualité'}],onSelect(){},onDisconnect(){window.fixtureCalls.disconnect++},parameters:React.createElement('div',null,'Tableaux'),publicLinks:React.createElement('input',{'aria-label':'Lien Pinterest',defaultValue:'https://pinterest.com/example'})}};
    require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(Modal,{items:[item],initialSelectedKey:'pinterest',onClose(){window.fixtureCalls.close++}}));
  ` });
  await page.locator("dialog[open]").waitFor();
  await page.waitForTimeout(500); // Complete the modal entrance before measuring hit areas.
  assert.deepEqual(errors, []);
  const article = page.locator('[data-channel-bubble="pinterest"]');
  const actions = article.locator(`.${bubbleClasses.iconActions} > .${bubbleClasses.iconAction}`);
  assert.equal(await actions.count(), 4, "the Pinterest fixture renders all four real actions");
  return { article, actions, errors };
}

test("the selected interactive channel stays fixed while its decoration floats", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1366, height: 700 }, { width: 1536, height: 864 }, { width: 1093, height: 614 }, { width: 390, height: 740 }]) {
      const page = await browser.newPage({ viewport });
      const { article } = await setup(page);
      const motion = await article.evaluate(element => {
        const sample = (time: number) => {
          for (const animation of document.getAnimations()) {
            if (animation instanceof CSSAnimation && animation.animationName === "selectedFloat") { animation.pause(); animation.currentTime = time; }
          }
          const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        return { start: sample(0), middle: sample(4500) };
      });
      assert.deepEqual(motion.middle, motion.start, `${viewport.width}px: background motion cannot move the interactive article`);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("all four Pinterest actions keep their lower-edge hit area for repeated 300ms hovers", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1366, height: 700 }, { width: 1093, height: 614 }, { width: 390, height: 740 }]) {
      const page = await browser.newPage({ viewport });
      const { article, actions } = await setup(page);
      // Isolate hover from ambient motion so an independent hover regression cannot hide behind it.
      await page.evaluate(() => { for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 2250; } });
      for (let index = 0; index < 4; index++) {
        const action = actions.nth(index);
        await action.scrollIntoViewIfNeeded();
        for (let repeat = 0; repeat < 2; repeat++) {
          await page.mouse.move(5, 5);
          await page.waitForTimeout(220);
          const box = (await action.boundingBox())!;
          const point = { x: box.x + box.width / 2, y: box.y + box.height - .5 };
          await page.mouse.move(point.x, point.y);
          const stable = await action.evaluate(async (element, point) => {
            const samples: number[] = [], hits: boolean[] = [];
            for (let tick = 0; tick < 15; tick++) {
              await new Promise(resolve => setTimeout(resolve, 20));
              samples.push(element.getBoundingClientRect().y);
              hits.push(element.contains(document.elementFromPoint(point.x, point.y)));
            }
            return { displacement: Math.max(...samples) - Math.min(...samples), hits };
          }, point);
          assert.ok(stable.displacement < .1, `${viewport.width}px action${index + 1}: hover moved its target ${stable.displacement}px`);
          assert.ok(stable.hits.every(Boolean), `${viewport.width}px action${index + 1}: pointer left a stationary lower-edge target`);
        }
      }
      const artifactDirectory = process.env.INRCY_LAYOUT_SCREENSHOT_DIR;
      if (artifactDirectory) { mkdirSync(artifactDirectory, { recursive: true }); await page.screenshot({ path: path.join(artifactDirectory, `pinterest-actions-${viewport.width}.png`) }); }
      assert.ok(await article.isVisible());
      await page.close();
    }
  } finally { await browser.close(); }
});

test("keyboard focus and the public-link popover preserve the stable action row", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 700 } });
    const { actions, errors } = await setup(page);
    await page.mouse.move(5, 5);
    for (let index = 0; index < 4; index++) {
      const action = actions.nth(index);
      await action.focus();
      const before = await action.boundingBox();
      await page.waitForTimeout(300);
      const after = await action.boundingBox();
      assert.ok(before && after, "the focused action remains rendered");
      // Chromium can quantize a transformed ancestor by a fraction of a CSS
      // pixel across platforms. This still rejects the former 1.5–7px jumps.
      for (const coordinate of ["x", "y", "width", "height"] as const) {
        assert.ok(Math.abs(after[coordinate] - before[coordinate]) < .1, `keyboard focus cannot move the action ${coordinate}`);
      }
      assert.equal(await action.evaluate(element => element === document.activeElement), true);
    }
    await page.keyboard.press("Enter");
    const popover = page.locator('[popover]:popover-open');
    await popover.waitFor();
    const halo = page.locator(`.${modalClasses.selectedHalo}`);
    assert.equal(await halo.evaluate(element => getComputedStyle(element).animationPlayState), "paused", "the decorative halo pauses while editing the public link");
    await popover.getByRole("textbox", { name: "Lien Pinterest" }).fill("https://pinterest.com/updated");
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "hidden" });
    assert.equal(await actions.last().evaluate(element => element === document.activeElement), true, "Escape restores the editor trigger");
    assert.equal(await halo.evaluate(element => getComputedStyle(element).animationPlayState), "running");
    const motionButton = page.locator(`.${modalClasses.motionButton}`);
    await motionButton.click();
    assert.equal(await halo.evaluate(element => getComputedStyle(element).animationPlayState), "paused", "the existing Pause control still pauses the decoration");
    await motionButton.click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await halo.evaluate(element => getComputedStyle(element).animationName), "none", "reduced motion disables the decorative animation");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal(await page.locator(`.${modalClasses.selectedArea}`).count(), 1);
    await actions.first().click();
    assert.deepEqual(await page.evaluate(() => (window as Window & { fixtureCalls?: unknown }).fixtureCalls), { view: 1, disconnect: 0, close: 1 });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
