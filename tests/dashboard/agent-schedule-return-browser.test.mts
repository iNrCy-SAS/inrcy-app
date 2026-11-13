import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import postcss from "postcss";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const pkg = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
function stylesheet(file: string, prefix: string) {
  const classes: Record<string, string> = {}, css = postcss.parse(read(file));
  css.walkRules(rule => { rule.selector = rule.selector.replace(/:global\(([^)]+)\)/g, "$1").replace(/\.([A-Za-z_][\w-]*)/g, (_match, name: string) => { classes[name] = prefix + name; return "." + classes[name]; }); });
  return { classes, css: css.toString() };
}
const agent = stylesheet("app/dashboard/agent/agent.module.css", "agent_"), sheet = stylesheet("app/dashboard/_components/CampaignScheduleModal.module.css", "sheet_"), dashboard = stylesheet("app/dashboard/dashboard.module.css", "dashboard_");
const client = ts.createSourceFile("AgentClient.tsx", read("app/dashboard/agent/AgentClient.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = client.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "AgentWorkspaceClient");
assert.ok(component?.body);
const handler = (name: string) => {
  const value = component!.body!.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(value, name); return value.getText(client);
};
let calendar = "", dateSheet = "";
function find(n: ts.Node) {
  if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(client) === "AgentScheduleModal") calendar = n.getText(client);
  if (ts.isJsxExpression(n) && n.expression && ts.isBinaryExpression(n.expression) && n.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && n.expression.left.getText(client) === "scheduleOnlyEdit") dateSheet = n.getText(client);
  ts.forEachChild(n, find);
}
find(component);
assert.ok(calendar, "the actual AgentClient calendar JSX is selected");
assert.ok(dateSheet, "the actual AgentClient date-sheet conditional JSX is selected");
const harness = compile(`import React,{useState}from'react';import{useLocale,useTranslations}from'next-intl';import{AgentScheduleModal}from'./AgentActionModals';import CampaignScheduleModal from'./CampaignScheduleModal';import DialogProvider from'./DialogProvider';import styles from'./agent.module.css';
export default function Harness(){
 const locale=useLocale(),i18nT=useTranslations('agent');
 const[scheduleOpen,setScheduleOpen]=useState(true),[scheduledActions,setScheduledActions]=useState(window.fixtureActions),[scheduleOnlyEdit,setScheduleOnlyEdit]=useState(null),[scheduleOnlyEditError,setScheduleOnlyEditError]=useState(null),[scheduleMutationState,setScheduleMutationState]=useState('idle');
 const[automationScheduleEdit,setAutomationScheduleEdit]=useState(null),[,setAutomationScheduleEditError]=useState(null);
 const workspace='publications',manualPlanningOnly=false,upcomingScheduleItems=window.fixtureItems,scheduledEditSession=null;
 const showNotice=message=>window.calls.notices.push(message),refreshActions=async()=>{},refreshScheduledActions=async()=>{},setActions=()=>{};
 const patchScheduledAction=async(id,patch)=>{window.calls.patches.push({id,patch});return{...scheduledActions.find(action=>action.id===id),...patch}};
 const exitScheduledEditSession=()=>true,handleScheduleRowOpenContent=()=>{},handleScheduleRowDelete=()=>{};
 ${handler("handleScheduleRowReschedule")}
 ${handler("saveScheduleOnlyEdit")}
 return <main><div data-testid="agent-home">Agent home</div>${calendar}${dateSheet}<DialogProvider/></main>;
}`);
const modules = {
  react: pkg("react", "react.development.js"), "react/jsx-runtime": pkg("react", "react-jsx-runtime.development.js"), "react-dom": pkg("react-dom", "react-dom.development.js"), "react-dom/client": pkg("react-dom", "react-dom-client.development.js"), scheduler: pkg("scheduler", "scheduler.development.js"),
  harness,
  "./AgentActionModals": compile(read("app/dashboard/agent/_components/AgentActionModals.tsx")),
  "./CampaignScheduleModal": compile(read("app/dashboard/_components/CampaignScheduleModal.tsx")),
  "./DialogProvider": compile(read("app/_components/InrcyDialogProvider.tsx")),
  "../_hooks/useUnsavedExitGuard": compile(read("app/dashboard/_hooks/useUnsavedExitGuard.ts")),
  "../_components/DashboardUnsavedNavigationProvider": compile(read("app/dashboard/_components/DashboardUnsavedNavigationProvider.tsx")),
  "@/lib/inrAgentPublicationHistory": compile(read("lib/inrAgentPublicationHistory.ts")),
  "@/lib/inrAssistantHistoryUiSelection": compile(read("lib/inrAssistantHistoryUiSelection.ts")),
  "@/lib/inrcyDialog": compile(read("lib/inrcyDialog.ts")),
  "@/lib/elementStyleLock": compile(read("lib/elementStyleLock.ts")),
  "@/lib/userFacingErrors": compile(read("lib/userFacingErrors.ts")),
  "@/lib/appLanguage": compile(read("lib/appLanguage.ts")),
  "@/lib/publicationErrorFrench": compile(read("lib/publicationErrorFrench.ts")),
  "@/lib/metaGraphErrorClassification": compile(read("lib/metaGraphErrorClassification.ts")),
};

async function setup(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-13T12:00:00Z"));
  const messages = Object.fromEntries(["agent", "booster", "shell"].map(namespace => [namespace, JSON.parse(read(`messages/fr-FR/${namespace}.json`))]));
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    requests.push(route.request().url());
    return route.request().url() === "http://fixture.test/dashboard/agent/publications"
      ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body></body></html>' })
      : route.abort();
  });
  await page.goto("http://fixture.test/dashboard/agent/publications");
  await page.setContent('<!doctype html><html lang="fr"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: `${read("app/globals.css").replace(/^@import[^;]+;/gm, "")}*{box-sizing:border-box}body{margin:0;background:#07112a;font-family:Arial,sans-serif}button{font:inherit}${agent.css}${sheet.css}${dashboard.css}` });
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(modules)},agentClasses=${JSON.stringify(agent.classes)},sheetClasses=${JSON.stringify(sheet.classes)},dashboardClasses=${JSON.stringify(dashboard.classes)},messages=${JSON.stringify(messages)},cache={},process={env:{NODE_ENV:'development'}};
    const translate=Object.fromEntries(Object.entries(messages).map(([namespace,values])=>[namespace,(key,params={})=>(values[key]||key).replace(/\\{(\\w+)\\}/g,(token,name)=>name in params?String(params[name]):token)]));
    function require(name){
      if(name.endsWith('CampaignScheduleModal.module.css'))return{__esModule:true,default:sheetClasses};
      if(name.endsWith('dashboard.module.css'))return{__esModule:true,default:dashboardClasses};
      if(name.endsWith('.module.css'))return{__esModule:true,default:agentClasses};
      if(name==='next-intl')return{useLocale:()=> 'fr-FR',useTranslations:namespace=>translate[namespace]};
      if(name==='next/navigation')return{useRouter:()=>({push:()=>{throw Error('Unexpected route navigation')}})};
      if(name.endsWith('useInrAssistantLocalInterface'))return{useInrAssistantLocalInterface(){}};
      if(name.includes('MediaLibraryPickerModal'))return{__esModule:true,default:()=>null};
      if(name.endsWith('agent.config'))return{channelOptions:{facebook:{name:'Facebook'},instagram:{name:'Instagram'}}};
      if(name.endsWith('agent.campaign-preview'))return{};
      if(cache[name])return cache[name].exports;if(!sources[name])throw Error('Unexpected schedule return dependency '+name);
      const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;
    }
    const React=require('react'),root=require('react-dom/client').createRoot(document.getElementById('root'));
    window.calls={patches:[],notices:[]};
    window.fixtureItems=Array.from({length:22},(_,index)=>{const date=index===0?new Date('2026-11-15T17:00:00Z'):new Date(Date.UTC(2026,11,index,17));return{id:'publication-'+index,scheduledActionId:'scheduled-'+index,automationKey:'publish',action:'Conseils',contentTitle:'Une publication programmée pour vérifier le retour au même planning',date:date.getDate()+'/'+(date.getMonth()+1)+'/'+date.getFullYear(),time:'18:00',typeLabel:'Publication',channelLabel:'Facebook',channelLabels:['Facebook','Instagram','LinkedIn','TikTok','Pinterest','X','Google Business'],originLabel:'Programmé',source:'manual',status:'Scheduled',statusKey:'scheduled',scheduledAtIso:date.toISOString(),editable:true,removable:true,mediaKind:'image'}});
    window.fixtureActions=window.fixtureItems.map(item=>({id:item.scheduledActionId,scheduledAt:item.scheduledAtIso}));
    root.render(React.createElement(require('harness').default));
  ` });
  page.setDefaultTimeout(4_000);
  await page.getByRole("dialog", { name: messages.agent.actions_programmees_77ae2684 }).waitFor();
  assert.equal(errors.length, 0);
  return { messages, errors, requests };
}

for (const [width, touch] of [[320, true], [390, false], [768, true], [1093, false], [1366, false]] as const) {
  test(`planning reschedule returns to the same month and scroll at ${width}px ${touch ? "touch" : "mouse"}`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 740 }, hasTouch: touch, timezoneId: "Europe/Paris" });
      const { messages, errors, requests } = await setup(page);
      const planning = page.getByRole("dialog", { name: messages.agent.actions_programmees_77ae2684 });
      await planning.getByRole("button", { name: messages.agent.mois_suivant, exact: true }).click();
      await page.waitForFunction(className => document.querySelectorAll('.' + className).length === 21, agent.classes.scheduleCalendarCard);
      const month = await planning.locator('.' + agent.classes.scheduleMonthNavigation + ' strong').textContent();
      const card = planning.locator('.' + agent.classes.scheduleCalendarCard).last();
      const disclosure = card.locator('.' + agent.classes.scheduleCalendarCardMobileActions);
      if (width <= 760) await (touch ? disclosure.locator("summary").tap() : disclosure.locator("summary").click());
      const trigger = card.locator(width <= 760 ? '[data-schedule-action="reschedule"]' : '.' + agent.classes.scheduleCalendarCardDesktopActions + ' [data-schedule-action="reschedule"]').last();
      await trigger.scrollIntoViewIfNeeded();
      if (width <= 760) {
        const geometry = await card.evaluate(element => {
          const disclosure = element.querySelector('details:last-child')!, summary = disclosure.querySelector('summary')!.getBoundingClientRect(), row = disclosure.getBoundingClientRect();
          const badges = [...element.querySelector('[class*="scheduleCalendarMetaBadges"]')!.children].map(child => child.getBoundingClientRect());
          return { summary: { width: summary.width, height: summary.height, center: summary.x + summary.width / 2 }, center: row.x + row.width / 2,
            badges: badges.map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })) };
        });
        assert.equal(geometry.summary.width, 48);
        assert.equal(geometry.summary.height, 48);
        assert.ok(Math.abs(geometry.summary.center - geometry.center) < 1, "Agir remains a centered circular target");
        assert.equal(geometry.badges.length, 3, "channels, media and origin share the badge group");
        assert.ok(geometry.badges.every((a, index) => geometry.badges.every((b, other) => index === other || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)), "the three badges never overlap");
      }
      const scroll = await planning.locator('.' + agent.classes.scheduleCalendarViewport).evaluate(element => element.scrollTop);
      await (touch ? trigger.tap() : trigger.click());
      const dateSheet = page.getByRole("dialog", { name: messages.agent.modifier_la_programmation_2bdd7cdc, exact: true });
      await dateSheet.waitFor();
      const hit = await dateSheet.getByRole("button", { name: messages.booster.fermer_5ab4ec64, exact: true }).evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { reachesButton: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)), width: rect.width, height: rect.height };
      });
      if (process.env.INRCY_SCHEDULE_RETURN_ARTIFACT_DIR) {
        mkdirSync(process.env.INRCY_SCHEDULE_RETURN_ARTIFACT_DIR, { recursive: true });
        writeFileSync(join(process.env.INRCY_SCHEDULE_RETURN_ARTIFACT_DIR, `stack-${width}.json`), JSON.stringify(hit, null, 2));
        await page.screenshot({ path: join(process.env.INRCY_SCHEDULE_RETURN_ARTIFACT_DIR, `date-sheet-${width}.png`) });
      }
      assert.equal(hit.reachesButton, true, "the date sheet must be above the planning and receive a real pointer click");
      assert.ok(hit.width >= 44 && hit.height >= 44, "the date sheet close control has a reliable touch target");
      const pickers = await dateSheet.locator('input[type="date"], input[type="time"]').evaluateAll(inputs => inputs.map(input => {
        const field = input.parentElement!, button = field.querySelector('button')!, rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }));
      assert.ok(pickers.every(picker => picker.width >= 44 && picker.height >= 44), "both native picker controls retain reliable touch targets");
      await dateSheet.locator('input[type="date"]').evaluate(input => {
        (window as unknown as { nativePickerCalls: number }).nativePickerCalls = 0;
        Object.defineProperty(input, "showPicker", { value: () => { (window as unknown as { nativePickerCalls: number }).nativePickerCalls += 1; } });
      });
      await dateSheet.getByRole("button", { name: messages.booster.ouvrir_le_calendrier_68d7da0b, exact: true }).click();
      assert.equal(await page.evaluate("window.nativePickerCalls"), 1, "the custom calendar still invokes the native date picker");
      for (const close of ["close", "cancel", "back"] as const) {
        if (close !== "close") await (touch ? trigger.tap() : trigger.click());
        await dateSheet.waitFor();
        if (close === "back") {
          await page.evaluate(() => window.history.back());
        } else {
          const name = close === "close" ? messages.booster.fermer_5ab4ec64 : messages.booster.annuler_49ba3292;
          await (touch ? dateSheet.getByRole("button", { name, exact: true }).tap() : dateSheet.getByRole("button", { name, exact: true }).click());
        }
        await dateSheet.waitFor({ state: "detached" });
        assert.equal(await planning.isVisible(), true);
        assert.equal(await planning.locator('.' + agent.classes.scheduleMonthNavigation + ' strong').textContent(), month);
        assert.equal(await planning.locator('.' + agent.classes.scheduleCalendarViewport).evaluate(element => element.scrollTop), scroll);
        assert.equal(await trigger.evaluate(element => document.activeElement === element), true, "returning restores focus without scrolling the planning");
        assert.deepEqual(await page.evaluate("window.calls.patches"), [], "closing/cancelling/back never writes a schedule");
      }
      await (touch ? trigger.tap() : trigger.click());
      await dateSheet.locator('input[type="time"]').fill("18:10");
      await dateSheet.getByRole("button", { name: messages.booster.annuler_49ba3292, exact: true }).click();
      const confirmation = page.getByRole("dialog", { name: messages.booster.quitter_sans_enregistrer_6208bd94, exact: true });
      await confirmation.getByRole("button", { name: messages.booster.continuer_l_edition_0f0075bb, exact: true }).click();
      assert.equal(await dateSheet.isVisible(), true, "keeping edits retains the date sheet");
      await dateSheet.getByRole("button", { name: messages.booster.annuler_49ba3292, exact: true }).click();
      await confirmation.getByRole("button", { name: messages.booster.fermer_sans_enregistrer_15fdc373, exact: true }).click();
      await dateSheet.waitFor({ state: "detached" });
      assert.equal(await planning.locator('.' + agent.classes.scheduleCalendarViewport).evaluate(element => element.scrollTop), scroll);
      assert.deepEqual(await page.evaluate("window.calls.patches"), []);
      await (touch ? trigger.tap() : trigger.click());
      await dateSheet.locator('input[type="date"]').fill("2026-12-27");
      await dateSheet.locator('input[type="time"]').fill("18:30");
      await dateSheet.getByRole("button", { name: messages.agent.enregistrer_f7c8bcd8, exact: true }).click();
      await dateSheet.waitFor({ state: "detached" });
      assert.deepEqual(await page.evaluate("window.calls.patches"), [{ id: "scheduled-21", patch: { scheduledAt: "2026-12-27T17:30:00.000Z" } }]);
      assert.equal(await planning.isVisible(), true);
      assert.equal(await planning.locator('.' + agent.classes.scheduleMonthNavigation + ' strong').textContent(), month);
      assert.equal(await planning.locator('.' + agent.classes.scheduleCalendarViewport).evaluate(element => element.scrollTop), scroll);
      assert.equal(page.url(), "http://fixture.test/dashboard/agent/publications");
      if (process.env.INRCY_SCHEDULE_RETURN_ARTIFACT_DIR) await page.screenshot({ path: join(process.env.INRCY_SCHEDULE_RETURN_ARTIFACT_DIR, `planning-return-${width}.png`) });
      assert.deepEqual(errors, []);
      assert.equal(requests.filter(url => !url.startsWith("http://fixture.test/")).length, 0);
    } finally { await browser.close(); }
  });
}
