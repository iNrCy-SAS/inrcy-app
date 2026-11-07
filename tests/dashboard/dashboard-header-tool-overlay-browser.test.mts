import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import postcss from "postcss";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
function cssModule(file: string, prefix: string) {
  const classes: Record<string, string> = {}, css = postcss.parse(read(file));
  css.walkRules(rule => { rule.selector = rule.selector.replace(/:global\(([^)]+)\)/g, "$1").replace(/\.([A-Za-z_][\w-]*)/g, (_all, name: string) => { classes[name] = `${prefix}_${name}`; return `.${classes[name]}`; }); });
  return { classes, css: css.toString() };
}

async function mount(page: Page) {
  page.setDefaultTimeout(8_000);
  const dashboard = cssModule("app/dashboard/dashboard.module.css", "dash"), dock = cssModule("app/dashboard/_components/DashboardDesktopDock.module.css", "dock"), agent = cssModule("app/dashboard/agent/agent.module.css", "agent");
  const globals = postcss.parse(read("app/globals.css"));
  globals.walkRules(rule => { if (!rule.selector.includes("[data-inrcy-tool-")) rule.remove(); });
  const messages = { dashboard: JSON.parse(read("messages/fr-FR/dashboard.json")), shell: JSON.parse(read("messages/fr-FR/shell.json")), agent: JSON.parse(read("messages/fr-FR/agent.json")) };
  const sources = {
    react: packageSource("react", "react.development.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
    "react-dom": packageSource("react-dom", "react-dom.development.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"), scheduler: packageSource("scheduler", "scheduler.development.js"),
    Header: compile("app/dashboard/_components/DashboardTopbar.tsx"), Planning: compile("app/dashboard/agent/_components/AgentActionModals.tsx"),
    "../_hooks/useDashboardToolOverlayOpen": compile("app/dashboard/_hooks/useDashboardToolOverlayOpen.ts"),
    "@/lib/inrAgentPublicationHistory": compile("lib/inrAgentPublicationHistory.ts"),
    "@/lib/dashboardEdition": compile("lib/dashboardEdition.ts"),
    "./reviewerAccess.ts": compile("lib/reviewerAccess.ts"),
  };
  const cssModules = { "../dashboard.module.css": dashboard.classes, "./DashboardDesktopDock.module.css": dock.classes, "../agent.module.css": agent.classes };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div><div id="left-host"></div><div id="right-host"></div></body></html>');
  await page.addStyleTag({ content: `*{box-sizing:border-box}:root{--inrcy-safe-area-top:0px;--inrcy-safe-area-right:0px;--inrcy-safe-area-bottom:0px;--inrcy-safe-area-left:0px}body{margin:0;font-family:Arial;background:#07112a}#left-host,#right-host{position:relative;z-index:6}button{font:inherit}${globals.toString()}${dashboard.css}${dock.css}${agent.css}` });
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)}, cssModules=${JSON.stringify(cssModules)}, messages=${JSON.stringify(messages)};
    const cache={},process={env:{NODE_ENV:'development'}};
    const text=(namespace,key)=>String((namespace+'.'+key).split('.').reduce((value,part)=>value?.[part],messages)??key);
    function require(name){
      if(cssModules[name])return{__esModule:true,default:cssModules[name]};
      if(name==='next-intl')return{useTranslations:namespace=>key=>text(namespace,key),useLocale:()=>'fr-FR'};
      if(name==='next/navigation')return{useRouter:()=>({prefetch(){}})};
      if(name==='next/image')return{__esModule:true,default:props=>require('react').createElement('img',props)};
      if(name==='../_hooks/useDashboardI18n')return{useDashboardI18n:()=>({...messages.dashboard,locale:'fr-FR'})};
      if(name==='../_hooks/useInrAgentPendingCount')return{useInrAgentPendingCount:()=>0};
      if(name==='./DashboardEditionProvider')return{useDashboardEdition:()=> 'basic'};
      if(name==='./DashboardAssistantProvider')return{useDashboardAssistant:()=>({toggleAssistant(){},assistantLabel:'Ouvrir iNrAssistant',assistantOpen:false})};
      if(name==='./DashboardAssistantTrigger')return{DashboardAssistantBadge:()=>null};
      if(name==='./DashboardNavigationIcon')return{__esModule:true,default:()=>null};
      if(name==='./NotificationMenu')return{__esModule:true,default:()=>require('react').createElement('button',null,'Notifications')};
      if(name==='./EstablishmentMenu')return{__esModule:true,default:props=>require('react').createElement('div',null,require('react').createElement('button',{className:props.buttonClassName,'data-header-business':true},'Établissements'),require('react').createElement('div',{style:{position:'absolute',zIndex:130},'data-header-menu':true},'Établissement courant'))};
      if(name==='./LanguageSelector')return{__esModule:true,default:()=>require('react').createElement('button',{'data-header-language':true},'Langue')};
      if(name.endsWith('/useInrAssistantLocalInterface'))return{useInrAssistantLocalInterface(){}};
      if(name==='@/lib/inrAssistantHistoryUiSelection')return{};
      if(name==='../../_components/MediaLibraryPickerModal')return{__esModule:true,default:()=>null};
      if(name==='../_lib/agent.config')return{channelOptions:{}};
      if(name==='../_lib/agent.campaign-preview')return{};
      if(cache[name])return cache[name].exports;
      if(!sources[name])throw Error('Unexpected overlay fixture import '+name);
      const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;
    }
    const React=require('react'),Header=require('Header').default,Planning=require('Planning').AgentScheduleModal;
    const root=require('react-dom/client').createRoot(document.getElementById('root'));
    window.calls={account:0,logout:0};window.fixture={setOpen:null};
    function App(){
      const[open,setOpen]=React.useState(false);window.fixture.setOpen=setOpen;
      return React.createElement('main',{className:${JSON.stringify(dashboard.classes.page)}},React.createElement(Header,{
        desktopLeftHost:document.getElementById('left-host'),desktopRightHost:document.getElementById('right-host'),
        desktopNotificationMenuRef:{current:null},mobileNotificationMenuRef:{current:null},userMenuRef:{current:null},
        notificationMenuOpen:false,setNotificationMenuOpen(){},unreadNotificationsCount:0,refreshNotifications(){},notificationsLoading:false,notifications:[],notificationsError:null,
        markAllNotificationsRead(){},markNotificationRead(){},deleteNotification(){},onNavigateCta(){},openPanel(){window.calls.account++},inrAgentEnabled:false,showInrAgent:false,isAdmin:false,
        userEmail:null,userFirstLetter:'Q',profileIncomplete:false,activityIncomplete:false,userMenuOpen:false,setUserMenuOpen(){},onOpenHelp(){},handleLogout(){window.calls.logout++}
      }),React.createElement('button',{'data-open-planning':true,style:{position:'fixed',bottom:20,left:20},onClick:()=>setOpen(true)},'Ouvrir le planning'),React.createElement(Planning,{
        open,items:[],mutationState:'idle',showStats:false,showCampaigns:false,onClose:()=>setOpen(false),onOpenContent(){},onReschedule(){},onDelete(){}
      }));
    }
    window.unmount=()=>root.unmount();root.render(React.createElement(React.StrictMode,null,React.createElement(App)));
  ` });
  try { await page.locator("[data-dashboard-topbar]").waitFor({ state: "attached" }); } catch (error) { if (errors.length) throw new Error(errors.join("\n")); throw error; }
  return { errors, title: messages.agent.actions_programmees_77ae2684 };
}

for (const width of [1366, 1707, 390]) {
  test(`the real dashboard header leaves the planning screen, accessibility tree and tab order at ${width}px and returns on close`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 842 } });
      const { errors, title } = await mount(page);
      const header = page.locator("[data-dashboard-topbar]"), account = page.locator('[data-dashboard-action="account"]');
      const initiallyVisible = await header.isVisible();
      const before = await header.boundingBox();
      if (width > 1100) assert.ok(before);
      assert.equal(await header.getAttribute("inert"), null);
      if (width > 1100) {
        assert.equal(await page.getByRole("button", { name: "Mon compte", exact: true }).count(), 1);
        assert.equal(await page.getByRole("button", { name: "Ouvrir iNrAssistant", exact: true }).count(), 1, "the real desktop portal is accessible on the dashboard");
        await account.click(); assert.equal(await page.evaluate(() => (window as unknown as { calls: { account: number } }).calls.account), 1);
      }
      await page.locator("[data-open-planning]").click();
      const planning = page.getByRole("dialog", { name: title, exact: true });
      await planning.waitFor();
      await page.waitForFunction(() => document.querySelector("[data-dashboard-topbar]")?.hasAttribute("inert"));
      assert.equal(await header.isVisible(), false);
      assert.equal(await header.getAttribute("aria-hidden"), "true");
      for (const dock of await page.locator("[data-dashboard-desktop-dock]").all()) {
        assert.equal(await dock.getAttribute("inert"), "");
        assert.equal(await dock.getAttribute("aria-hidden"), "true");
      }
      assert.equal(await page.getByRole("button", { name: "Mon compte", exact: true }).count(), 0, "the background account action is absent from the accessibility tree");
      assert.equal(await page.getByRole("button", { name: "Ouvrir iNrAssistant", exact: true }).count(), 0, "portal controls outside the header DOM are also excluded");
      if (width > 1100) assert.equal(await account.evaluate(element => {
        const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return Boolean(hit?.closest("[data-inrcy-tool-overlay]"));
      }), true, "the planning receives pointer events at the former header position");
      await account.evaluate(element => (element as HTMLElement).focus());
      assert.equal(await account.evaluate(element => document.activeElement === element), false, "inert also prevents programmatic focus on the background header");
      const firstAction = planning.locator("button").first(); await firstAction.focus();
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-dashboard-topbar], [data-dashboard-desktop-dock]'))), false);
      }
      await page.evaluate(() => (window as unknown as { fixture: { setOpen: (open: boolean) => void } }).fixture.setOpen(false));
      await planning.waitFor({ state: "detached" });
      await page.waitForFunction(() => !document.querySelector("[data-dashboard-topbar]")?.hasAttribute("inert"));
      assert.equal(await header.isVisible(), initiallyVisible, "the mobile header keeps its original responsive visibility");
      assert.equal(await header.getAttribute("inert"), null);
      assert.deepEqual(await header.boundingBox(), before, "suppression preserves the dashboard layout instead of removing its header height");
      if (width > 1100) { assert.equal(await page.getByRole("button", { name: "Mon compte", exact: true }).count(), 1); await account.click(); assert.equal(await page.evaluate(() => (window as unknown as { calls: { account: number } }).calls.account), 2); }
      assert.deepEqual(errors, []);
      await browser.close();
    } finally { if (browser.isConnected()) await browser.close(); }
  });
}

test("the real overlay hook keeps the dashboard suppressed until the final visible workspace closes, and ignores compact or hidden workspaces", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 842 } });
    const { errors } = await mount(page);
    const header = page.locator("[data-dashboard-topbar]");
    await page.evaluate(() => { const compact = document.createElement("div"); compact.id = "compact"; compact.setAttribute("role", "dialog"); document.body.append(compact); });
    assert.equal(await header.getAttribute("inert"), null, "ordinary menus and compact confirmations do not suppress the dashboard");
    await page.evaluate(() => { const hidden = document.createElement("div"); hidden.id = "cached"; hidden.hidden = true; hidden.innerHTML = '<div data-inrcy-tool-overlay></div>'; document.body.append(hidden); });
    assert.equal(await header.getAttribute("inert"), null, "a cached hidden workspace is inactive");
    await page.evaluate(() => { const first = document.createElement("div"); first.id = "workspace-a"; first.setAttribute("data-inrcy-tool-overlay", ""); document.body.append(first); });
    await page.waitForFunction(() => document.querySelector("[data-dashboard-topbar]")?.hasAttribute("inert"));
    await page.evaluate(() => { const second = document.createElement("div"); second.id = "workspace-b"; second.setAttribute("data-inrcy-tool-overlay", ""); document.body.append(second); document.getElementById("workspace-a")?.remove(); });
    assert.equal(await header.getAttribute("inert"), "");
    await page.evaluate(() => document.getElementById("workspace-b")?.removeAttribute("data-inrcy-tool-overlay"));
    await header.waitFor({ state: "visible" });
    assert.equal(await header.getAttribute("inert"), null, "removing the final opt-in marker restores the header too");
    await page.evaluate(() => (window as unknown as { unmount: () => void }).unmount());
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
