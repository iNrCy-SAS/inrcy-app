import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import postcss from "postcss";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(source(file), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");

function cssModule(file: string, prefix: string) {
  const classes: Record<string, string> = {};
  const css = postcss.parse(source(file));
  css.walkRules(rule => {
    rule.selector = rule.selector.replace(/:global\(([^)]+)\)/g, "$1").replace(/\.([A-Za-z_][\w-]*)/g, (_match, name: string) => {
      classes[name] = `${prefix}_${name}`;
      return `.${classes[name]}`;
    });
  });
  return { classes, css: css.toString() };
}

async function setupHeader(page: Page) {
  const styles = [
    cssModule("app/dashboard/agent/agent.module.css", "agent"),
    cssModule("app/dashboard/agent/_components/AgentWorkspaceHeader.module.css", "header"),
    cssModule("app/dashboard/_components/DashboardAssistantTrigger.module.css", "assistant"),
  ];
  const messages = JSON.parse(source("messages/fr-FR/agent.json")).workspaces;
  const robot = readFileSync(new URL("../../public/agent/agent-publications.webp", import.meta.url));
  const assistant = readFileSync(new URL("../../public/agent/agent-assist-pink-v2.png", import.meta.url));
  const sources = {
    react: packageSource("react", "react.development.js"),
    "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
    "react-dom": packageSource("react-dom", "react-dom.development.js"),
    "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
    scheduler: packageSource("scheduler", "scheduler.development.js"),
    subject: compile("app/dashboard/agent/_components/AgentWorkspaceHeader.tsx"),
    "../../_components/HelpButton": compile("app/dashboard/_components/HelpButton.tsx"),
    "../../_components/DashboardAssistantTrigger": compile("app/dashboard/_components/DashboardAssistantTrigger.tsx"),
    "@/lib/inrAgentWorkspaces": compile("lib/inrAgentWorkspaces.ts"),
  };
  const cssModules = {
    "../agent.module.css": styles[0].classes,
    "./AgentWorkspaceHeader.module.css": styles[1].classes,
    "./DashboardAssistantTrigger.module.css": styles[2].classes,
  };
  const networkRequests: string[] = [];
  await page.route("**/*", route => { networkRequests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><html><body><main id="root"></main></body></html>');
  await page.addStyleTag({ content: `*{box-sizing:border-box}body{margin:0;background:#07112a;font-family:Arial,sans-serif}#root{position:relative;padding:14px;min-width:0}button{font:inherit}${styles.map(style => style.css).join("\n")}` });
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)}, cssModules=${JSON.stringify(cssModules)}, messages=${JSON.stringify(messages)};
    const images={'/agent/agent-publications.webp':'data:image/webp;base64,${robot.toString("base64")}','/agent/agent-assist-pink-v2.png':'data:image/png;base64,${assistant.toString("base64")}'};
    const cache={},process={env:{NODE_ENV:'development'}};
    function require(name){
      if(cssModules[name])return{__esModule:true,default:cssModules[name]};
      if(name==='next-intl')return{useTranslations:()=>key=>key.split('.').reduce((value,part)=>value?.[part],messages)??key};
      if(name==='next/image')return{__esModule:true,default:props=>require('react').createElement('img',{...props,src:images[props.src]||props.src})};
      if(name==='./DashboardAssistantProvider')return{useDashboardAssistant:()=>({toggleAssistant:()=>{},assistantLabel:'iNrAssistant',assistantOpen:false,assistantPending:false,assistantBadgeState:null})};
      if(cache[name])return cache[name].exports;
      if(!sources[name])throw Error('Unexpected header fixture import '+name);
      const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;
    }
    const React=require('react'),Subject=require('subject').default,root=require('react-dom/client').createRoot(document.getElementById('root'));
    const definition=require('@/lib/inrAgentWorkspaces').INR_AGENT_WORKSPACES.publications;
    definition.icon=images['/agent/agent-publications.webp'];
    window.calls={planning:0,toggle:0,prepare:0,ideas:0,settings:0};
    const count=key=>()=>window.calls[key]++;
    window.render=manualPlanningOnly=>root.render(React.createElement(React.StrictMode,null,React.createElement(Subject,{
      workspace:'publications',campaignMode:'grow',onCampaignMode:()=>{},onHelp:()=>{},onIdeas:count('ideas'),onPrepare:count('prepare'),
      onPlanning:count('planning'),onSettings:count('settings'),onClose:()=>{},onToggle:count('toggle'),enabled:true,busy:false,
      preparing:false,prepareDisabled:false,manualPlanningOnly
    })));
    window.render(true);
  ` });
  page.setDefaultTimeout(3_000);
  return { messages, networkRequests };
}

for (const width of [390, 1366]) {
  test(`the real publication header keeps Basic manual and Standard automated at ${width}px`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 768 } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const { messages, networkRequests } = await setupHeader(page);
      const header = page.locator('[data-agent-workspace-header="publications"]');
      const automationLabels = [messages.ideas, messages.generate, messages.settings, messages.deactivateAutomation];
      const assertContained = async () => {
        const dimensions = await header.evaluate(element => ({
          right: element.getBoundingClientRect().right,
          scrollWidth: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          // The shared assistant trigger deliberately yields to the mobile dock.
          visibleControls: [...element.querySelectorAll("button")].filter(button => button.getClientRects().length > 0).map(button => {
            const bounds = button.getBoundingClientRect();
            return { label: button.getAttribute("aria-label"), left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
          }),
        }));
        assert.ok(dimensions.right <= width + 1, "the header stays inside the screen");
        assert.ok(dimensions.scrollWidth <= dimensions.viewport + 1, "no horizontal page overflow");
        for (const control of dimensions.visibleControls) {
          assert.ok(control.left >= -1 && control.right <= width + 1, `${control.label} remains on screen`);
          assert.ok(control.width >= 24 && control.height >= 24, `${control.label} remains a usable visible control`);
        }
      };
      const assertBasic = async () => {
        await page.getByRole("heading", { name: messages.publications.manualTitle }).waitFor();
        assert.equal(await header.locator("p").first().textContent(), messages.publications.manualDescription);
        assert.equal(await header.locator("img").first().evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0), true, "the publication robot is displayed");
        await page.getByRole("button", { name: messages.planning, exact: true }).click();
        for (const label of automationLabels) assert.equal(await page.getByRole("button", { name: label, exact: true, includeHidden: true }).count(), 0, `${label} is absent from the Basic DOM`);
        await assertContained();
      };

      await assertBasic();
      assert.equal(await page.evaluate("window.calls.planning"), 1);
      await page.evaluate("window.render(false)");
      await page.getByRole("heading", { name: `Agent ${messages.publications.name}` }).waitFor();
      assert.equal(await header.locator("p").first().textContent(), messages.publications.description);
      for (const label of automationLabels) assert.equal(await page.getByRole("button", { name: label, exact: true }).isVisible(), true, `${label} remains available in Standard`);
      await page.getByRole("button", { name: messages.planning, exact: true }).click();
      await page.getByRole("button", { name: messages.deactivateAutomation, exact: true }).click();
      assert.equal(await page.evaluate("window.calls.planning"), 2);
      assert.equal(await page.evaluate("window.calls.toggle"), 1);
      await assertContained();
      await page.evaluate("window.render(true)");
      await assertBasic();
      assert.deepEqual(errors, []);
      assert.deepEqual(networkRequests, [], "the fixture never contacts an account, API or external asset");
    } finally { await browser.close(); }
  });
}
