import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
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
const css = postcss.parse(source("app/dashboard/agent/agent.module.css"));
const classes: Record<string, string> = {};
css.walkRules(rule => {
  rule.selector = rule.selector.replace(/:global\(([^)]+)\)/g, "$1").replace(/\.([A-Za-z_][\w-]*)/g, (_match, name: string) => {
    classes[name] = `agent_${name}`;
    return `.${classes[name]}`;
  });
});
const sources = {
  react: packageSource("react", "react.development.js"),
  "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
  "react-dom": packageSource("react-dom", "react-dom.development.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
  scheduler: packageSource("scheduler", "scheduler.development.js"),
  subject: compile("app/dashboard/agent/_components/AgentActionModals.tsx"),
  "@/lib/inrAgentPublicationHistory": compile("lib/inrAgentPublicationHistory.ts"),
  "@/lib/inrAssistantHistoryUiSelection": compile("lib/inrAssistantHistoryUiSelection.ts"),
};

async function setup(page: Page, locale: string) {
  // Keep every scheduled item in the same visible monthly window, including
  // when CI runs at a month boundary. Normal browser timers keep running.
  await page.clock.setFixedTime(new Date("2026-11-13T12:00:00Z"));
  const messages = JSON.parse(source(`messages/${locale}/agent.json`));
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><html><body><main id="root"></main></body></html>');
  await page.addStyleTag({ content: `${source("app/globals.css").replace(/^@import[^;]+;/gm, "")}*{box-sizing:border-box}body{margin:0;background:#07112a;font-family:Arial,sans-serif}button{font:inherit}${css.toString()}` });
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},classes=${JSON.stringify(classes)},messages=${JSON.stringify(messages)},cache={},process={env:{NODE_ENV:'development'}};
    function require(name){
      if(name.endsWith('.module.css'))return{__esModule:true,default:classes};
      if(name==='next-intl')return{useLocale:()=>${JSON.stringify(locale)},useTranslations:()=>key=>messages[key]??key};
      if(name.endsWith('useInrAssistantLocalInterface'))return{useInrAssistantLocalInterface(){}};
      if(name.includes('MediaLibraryPickerModal'))return{__esModule:true,default:()=>null};
      if(name.endsWith('agent.config'))return{channelOptions:{facebook:{name:'Facebook'},instagram:{name:'Instagram'}}};
      if(name.endsWith('agent.campaign-preview'))return{};
      if(cache[name])return cache[name].exports;
      if(!sources[name])throw Error('Unexpected schedule fixture import '+name);
      const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;
    }
    const React=require('react'),Modal=require('subject').AgentScheduleModal,root=require('react-dom/client').createRoot(document.getElementById('root'));
    const items=Array.from({length:7},(_,index)=>{
      const date=new Date();date.setDate(15+index);
      return{id:'publication-'+index,scheduledActionId:'scheduled-'+index,automationKey:'publish',action:'Conseils professionnels',
        contentTitle:'Une publication programmée avec un titre complet pour vérifier la place des actions',
        date:date.getDate()+'/'+(date.getMonth()+1)+'/'+date.getFullYear(),time:'18:00',typeLabel:'Publication',
        channelLabel:'Facebook',channelLabels:['Facebook','Instagram'],originLabel:'Booster',source:'manual',status:'Scheduled',statusKey:'scheduled',
        scheduledAtIso:date.toISOString(),editable:true,removable:true,mediaKind:'image'};
    });
    window.calls={edit:[],reschedule:[],delete:[]};
    root.render(React.createElement(Modal,{open:true,items,mutationState:'idle',onClose(){},
      onOpenContent:item=>window.calls.edit.push(item.id),onReschedule:item=>window.calls.reschedule.push(item.id),onDelete:item=>window.calls.delete.push(item.id)}));
  ` });
  page.setDefaultTimeout(5_000);
  await page.getByRole("dialog", { name: messages.actions_programmees_77ae2684 }).waitFor();
  assert.equal(await page.locator(`.${classes.scheduleCalendarCard}`).count(), 7, "all seven scheduled cards share the visible month");
  return { messages, requests, errors };
}

for (const [locale, width] of [["fr-FR", 320], ["fr-FR", 390], ["fr-FR", 760], ["en-GB", 390], ["de-DE", 320]] as const) {
  test(`scheduled action rows remain usable on the last mobile card in ${locale} at ${width}px`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 740 } });
      const { messages, requests, errors } = await setup(page, locale);
      const card = page.locator(`.${classes.scheduleCalendarCard}`).last();
      const disclosure = card.locator(`.${classes.scheduleCalendarCardMobileActions}`);
      const summary = disclosure.locator("summary");
      const headerClear = await page.evaluate(classNames => {
        const separated = (first: Element, second: Element) => {
          const a = first.getBoundingClientRect(), b = second.getBoundingClientRect();
          return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
        };
        const title = document.querySelector(`.${classNames.scheduleModalTitle}`)!;
        const controls = document.querySelector(`.${classNames.scheduleModalHeaderActions}`)!;
        const days = [...document.querySelectorAll(`.${classNames.scheduleDayHeader}`)];
        return separated(title, controls) && days.every(day => separated(day.querySelector(`.${classNames.scheduleDayDate}`)!, day.querySelector(`.${classNames.scheduleDayCarouselControls}`)!));
      }, classes);
      assert.equal(headerClear, true, "the title, controls, day and carousel never overlap on narrow screens");
      await summary.click();
      const menu = disclosure.getByRole("group", { name: messages.planning_actions_menu, exact: true });
      await menu.waitFor();
      for (const action of ["edit", "reschedule", "delete"]) {
        const button = menu.locator(`[data-schedule-action="${action}"]`);
        await button.scrollIntoViewIfNeeded();
        const geometry = await button.evaluate(element => {
          const rect = element.getBoundingClientRect(), icon = element.querySelector("svg")!.getBoundingClientRect();
          const label = element.querySelector("span")!.getBoundingClientRect();
          const card = element.closest("article")!.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
            iconRight: icon.right, labelLeft: label.left, cardBottom: card.bottom, cardRight: card.right, labelRight: label.right,
            display: getComputedStyle(element).display, position: getComputedStyle(element.parentElement!).position };
        });
        assert.equal(geometry.display, "flex", "the icon and label share a horizontal row");
        assert.equal(geometry.position, "static", "the action list expands the card instead of overlaying its content");
        assert.ok(geometry.height >= 44 && geometry.width > 120, "each action is a full-width touch target");
        assert.ok(geometry.iconRight < geometry.labelLeft, "the icon stays to the left of the label");
        assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.labelRight <= geometry.cardRight, "long labels remain inside the screen");
        assert.ok(geometry.bottom <= geometry.cardBottom && geometry.top >= 0 && geometry.bottom <= 740, "the last action can be scrolled fully into view");
      }
      if (process.env.INRCY_SCHEDULE_ACTIONS_SCREENSHOT_DIR && locale === "fr-FR") {
        mkdirSync(process.env.INRCY_SCHEDULE_ACTIONS_SCREENSHOT_DIR, { recursive: true });
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(process.env.INRCY_SCHEDULE_ACTIONS_SCREENSHOT_DIR, `schedule-actions-${width}.png`) });
      }
      await menu.locator('[data-schedule-action="edit"]').focus();
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      assert.equal(await summary.evaluate(element => document.activeElement === element), true, "Escape restores focus to the disclosure");
      await summary.press("Enter");
      for (const action of ["edit", "reschedule", "delete"]) await menu.locator(`[data-schedule-action="${action}"]`).click();
      assert.deepEqual(await page.evaluate("window.calls"), { edit: ["publication-6"], reschedule: ["publication-6"], delete: ["publication-6"] });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page overflow");
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, [], "the isolated UI test never accesses a real account or API");
    } finally { await browser.close(); }
  });
}

for (const width of [768, 1366]) test(`the desktop planning keeps its original compact action controls at ${width}px`, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const { requests, errors } = await setup(page, "fr-FR");
    const card = page.locator(`.${classes.scheduleCalendarCard}`).last();
    assert.equal(await card.locator(`.${classes.scheduleCalendarCardMobileActions}`).isVisible(), false);
    const actions = card.locator(`.${classes.scheduleCalendarCardDesktopActions}`);
    await actions.locator('[data-schedule-action="reschedule"]').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page overflow");
    assert.deepEqual(await page.evaluate("window.calls.reschedule"), ["publication-6"]);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  } finally { await browser.close(); }
});
