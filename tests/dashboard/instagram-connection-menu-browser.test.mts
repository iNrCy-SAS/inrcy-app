import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const modules = {
  react: packageSource("react", "react.production.js"),
  "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"),
  scheduler: packageSource("scheduler", "scheduler.production.js"),
  menu: compile("app/dashboard/_components/ChannelConnectionMenu.tsx"),
  dialog: compile("app/dashboard/_components/ChannelParametersDialog.tsx"),
};
const css = read("app/dashboard/_components/ChannelParametersDialog.module.css")
  + read("app/dashboard/_components/DashboardChannelBubble.module.css");

/** Run the real components and React lifecycle in Chromium, with no remote service. */
const fixture = `
const sources = ${JSON.stringify(modules)};
const loaded = {};
function require(name) {
  if(name.endsWith('.css')) return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
  if(name === 'next-intl') return {useTranslations:()=>key=>({close:'Fermer',loading:'Chargement…'})[key]||key};
  if(loaded[name]) return loaded[name].exports;
  if(!sources[name]) throw Error('Unexpected browser module '+name);
  const module=loaded[name]={exports:{}};
  new Function('require','module','exports',sources[name])(require,module,module.exports);
  return module.exports;
}
const React=require('react'), Menu=require('menu').default, Dialog=require('dialog').default;
window.calls=[];
function Fixture({disabled=false}) {
  const [open,setOpen]=React.useState(true);
  return open ? React.createElement(Dialog,{name:'Instagram',title:'Connecter — Instagram',onClose:()=>setOpen(false)},
    React.createElement('div',{className:'connectChoices'},
      React.createElement('button',{type:'button',className:'connectPrimary',disabled,onClick:()=>window.calls.push('direct')},'Connexion directe'),
      React.createElement(Menu,{label:'Connexion via Facebook',disabled,options:[{label:'Connexion classique',onConnect:()=>window.calls.push('classic')},{label:'Connexion Business',onConnect:()=>window.calls.push('business')}],onChoose:option=>option.onConnect()})
    )) : React.createElement('button',{onClick:()=>setOpen(true)},'Ouvrir');
}
const root=require('react-dom/client').createRoot(document.getElementById('root'));
window.renderFixture=disabled=>root.render(React.createElement(Fixture,{disabled}));
window.renderFixture(false);
`;

test("Instagram menu keeps both Facebook flows, keyboard focus and the parent dialog on desktop and mobile", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setContent(`<html><head><style>${css}body{background:#080c22;font:16px Arial}button{min-height:44px;padding:10px 18px;color:#fff;background:#283756;border:1px solid #8585dc70;border-radius:24px;cursor:pointer}</style></head><body><div id="root"></div></body></html>`);
      await page.addScriptTag({ content: fixture });
      const dialog = page.getByRole("dialog", { name: "Connecter — Instagram", exact: true });
      await dialog.waitFor();
      const trigger = page.getByRole("button", { name: "Connexion via Facebook", exact: true });
      assert.equal(await dialog.getByRole("button").count(), 3, "Only close, direct and Facebook are initially visible");
      await page.getByRole("button", { name: "Connexion directe", exact: true }).click();
      await trigger.click();
      assert.equal(await trigger.getAttribute("aria-expanded"), "true");
      await page.getByRole("button", { name: "Connexion classique", exact: true }).click();
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      await trigger.click();
      await page.getByRole("button", { name: "Connexion Business", exact: true }).click();
      assert.deepEqual(await page.evaluate(() => (window as unknown as { calls: string[] }).calls), ["direct", "classic", "business"]);
      await trigger.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      assert.equal(await page.getByRole("button", { name: "Connexion classique", exact: true }).evaluate(element => element === document.activeElement), true);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.isVisible(), true, "Escape first closes the disclosure, keeping the dialog open");
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
      await trigger.press("ArrowDown");
      await page.getByRole("heading", { name: "Connecter — Instagram", exact: true }).click();
      assert.equal(await trigger.getAttribute("aria-expanded"), "false", "Clicking outside closes the choices");
      await trigger.click();
      const business = page.getByRole("button", { name: "Connexion Business", exact: true });
      const bounds = await business.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, "Choices fit the viewport");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Ouvrir", exact: true }).click();
      await page.evaluate(() => (window as unknown as { renderFixture: (disabled: boolean) => void }).renderFixture(true));
      await page.locator("button[disabled]").first().waitFor();
      assert.equal(await trigger.isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Connexion directe", exact: true }).isDisabled(), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
