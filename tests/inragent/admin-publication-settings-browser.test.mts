import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";

const require = createRequire(import.meta.url), repo = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) => readFileSync(resolve(repo, file), "utf8");
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const agent = ts.createSourceFile("AgentClient.tsx", read("app/dashboard/agent/AgentClient.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string) {
  let result: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(agent) === name) result = node; ts.forEachChild(node, visit); };
  visit(agent); assert.ok(result, `Actual AgentClient declaration ${name}`);
  return `const ${result.getText(agent)};`;
}
let planning: ts.JsxElement | undefined, access: ts.VariableDeclaration | undefined;
const findUi = (node: ts.Node) => {
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(agent) === "data-settings-panel" && prop.initializer && ts.isStringLiteral(prop.initializer) && prop.initializer.text === "planning")) planning = node;
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(agent) === "useDashboardViewerAccess") access = node;
  ts.forEachChild(node, findUi);
};
findUi(agent); assert.ok(planning); assert.ok(access);
const api = ts.createSourceFile("settings-route.ts", read("app/api/agent/settings/route.ts"), ts.ScriptTarget.Latest, true);
let inactiveMode: ts.IfStatement | undefined;
const findInactiveMode = (node: ts.Node) => {
  if (ts.isIfStatement(node) && ["!settings.globalEnabled", "!requestedPublish.enabled", "requestedPublish.validationMode"].every(part => node.expression.getText(api).includes(part))) inactiveMode = node;
  ts.forEachChild(node, findInactiveMode);
};
findInactiveMode(api); assert.ok(inactiveMode, "the fixture must exercise the actual API inactive-mode normalization");
const inactiveModeCode = compile(`function applyApiInactiveMode(settings){const requestedPublish=settings.automations.publish,INR_AGENT_ADMIN_PUBLISH_MODE='admin_automatic_publish';${inactiveMode.getText(api)};return settings;}`);
const controller = ts.createSourceFile("controller.ts", read("app/dashboard/agent/_hooks/useAgentAutomationController.ts"), ts.ScriptTarget.Latest, true);
const functions = ["updateConfig", "updateConfigFrequency", "updateConfigScheduleSlot", "updateConfigMonthDay", "persistSettings"].map(name => {
  const node = controller.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (node) return node.getText(controller);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); };
  visit(controller); assert.ok(found, `Actual controller function ${name}`); return found.getText(controller);
}).join("\n");
const controls = compile(`export default function Controls(){
  const ${access.getText(agent)};
  const [agentSettings,setAgentSettings]=React.useState(()=>structuredClone(saved));
  const [configs,setConfigs]=React.useState(()=>settingsToConfigs(saved));
  const [saveState,setSaveState]=React.useState('idle');
  const pendingPlanConfigsRef=React.useRef(null),settingsAutomation={key:automationKey},settingsConfig=configs[automationKey];
  const i18nT=translate,runtimeT=i18nT,agentConnectedChannels=null;
  const setNotice=noOp,setTableMissing=noOp,setSettingsPlanImpact=noOp,writeCachedAgentViewSnapshot=noOp,refreshActions=async()=>{},showNotice=noOp;
  ${["settingsMonthlyDateCount", "settingsCanUseAdminPublishOptions", "settingsAdminAutomaticAvailable", "settingsPublishDaily", "settingsPublishWithoutApproval", "settingsMonthDays"].map(declaration).join("\n")}
  ${functions}
  React.useLayoutEffect(()=>{window.adminSettings.configs=configs;window.adminSettings.save=()=>persistSettings();window.adminSettings.saveState=saveState});
  return (${planning.getText(agent)});
}`);

const sources: Record<string, string> = {}, links: Record<string, Record<string, string>> = {};
const mocks = new Set(["react", "react/jsx-runtime", "next-intl", "@/lib/browserAccountCache"]);
function addSource(base: string): string {
  const file = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(file => existsSync(file) && statSync(file).isFile());
  assert.ok(file, `Resolve ${base}`);
  const local = relative(repo, file);
  assert.ok(!isAbsolute(local) && local !== ".." && !local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
  const id = local.replaceAll("\\", "/"); if (sources[id]) return id;
  assert.ok(id.startsWith("lib/") || id.startsWith("app/dashboard/agent/_lib/") || id === "app/dashboard/_components/DashboardViewerAccessProvider.tsx", `Unexpected fixture surface ${id}`);
  sources[id] = compile(readFileSync(file, "utf8")); links[id] = {};
  for (const match of sources[id].matchAll(/require\("([^"]+)"\)/g)) {
    const name = match[1]; if (mocks.has(name)) continue;
    const target = name.startsWith("@/") ? resolve(repo, name.slice(2)) : name.startsWith(".") ? resolve(dirname(file), name) : null;
    assert.ok(target, `No service dependency is allowed: ${name}`); links[id][name] = addSource(target);
  }
  return id;
}
const settingsId = addSource(resolve(repo, "app/dashboard/agent/_lib/agent.settings.ts"));
const configId = addSource(resolve(repo, "app/dashboard/agent/_lib/agent.config.ts"));
const i18nId = addSource(resolve(repo, "app/dashboard/agent/_lib/agent.i18n.ts"));
const scheduleId = addSource(resolve(repo, "lib/inrAgentMonthSchedule.ts"));
const defaultsId = addSource(resolve(repo, "lib/inrAgentSettings.ts"));
const providerId = addSource(resolve(repo, "app/dashboard/_components/DashboardViewerAccessProvider.tsx"));
for (const [name, file] of [["react", "react.development.js"], ["react/jsx-runtime", "react-jsx-runtime.development.js"], ["react-dom", "react-dom.development.js"], ["react-dom/client", "react-dom-client.development.js"], ["scheduler", "scheduler.development.js"]]) {
  const pkg = name === "react/jsx-runtime" ? "react" : name === "react-dom/client" ? "react-dom" : name;
  sources[name] = readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), "cjs", file), "utf8");
}
sources["intl-messageformat"] = compile(readFileSync(join(dirname(require.resolve("intl-messageformat")), "intl-messageformat.iife.js"), "utf8"));
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"] as const;
const catalog = (locale: string) => JSON.parse(read(`messages/${locale}/agent.json`)) as Record<string, string>;
const t = (locale: string, key: string) => String(new IntlMessageFormat(catalog(locale)[key], locale).format());
type Snapshot = { writes: Array<{ settings: { automations: Record<string, { enabled: boolean; frequency: string; validationMode: string; time: string }> } }>; saved: { automations: Record<string, { enabled: boolean; frequency: string; validationMode: string; time: string }> }; saveState: string };
async function mount(page: Page, { admin = true, locale = "fr-FR", automationKey = "publish", browserAccount = "account-admin", enabled = false } = {}) {
  const errors: string[] = [], network: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => { network.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><html><body><main id="root"></main></body></html>');
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},links=${JSON.stringify(links)},cache={},process={env:{NODE_ENV:'development'}},messages=${JSON.stringify(catalog(locale))},locale=${JSON.stringify(locale)},automationKey=${JSON.stringify(automationKey)},formats=new Map(),noOp=()=>{};
    let browserAccount=${JSON.stringify(browserAccount)},writes=[],key=0;
    function load(name,parent=''){
      if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=>browserAccount};
      const id=links[parent]?.[name]||name;if(cache[id])return cache[id].exports;if(!sources[id])throw Error('Unexpected settings fixture import '+name);
      const record=cache[id]={exports:{}};new Function('require','module','exports','process',sources[id])(child=>load(child,id),record,record.exports,process);return record.exports;
    }
    const React=load('react'),provider=load(${JSON.stringify(providerId)}),useDashboardViewerAccess=provider.useDashboardViewerAccess;
    const {settingsToConfigs,configsToSettings,normalizeConfigScheduleSlots,dayOffsetLabel,normalizeConfigsForConnectedChannels}=load(${JSON.stringify(settingsId)});
    const {settingsOptions,hourOptions,weekDays}=load(${JSON.stringify(configId)}),{agentFrequencyLabel,agentValidationLabel,agentWeekdayLabel}=load(${JSON.stringify(i18nId)});
    const {inrAgentMonthlyDateCount,normalizeInrAgentMonthDays}=load(${JSON.stringify(scheduleId)}),{INR_AGENT_DEFAULT_SETTINGS,sanitizeInrAgentSettings}=load(${JSON.stringify(defaultsId)});
    let saved=structuredClone(INR_AGENT_DEFAULT_SETTINGS);saved.globalEnabled=${JSON.stringify(enabled)};saved.enabled=${JSON.stringify(enabled)};saved.automations.publish.enabled=${JSON.stringify(enabled)};
    ${inactiveModeCode}
    const translate=(name,values={})=>{if(!Object.hasOwn(messages,name))throw Error('Missing agent translation '+name);if(!formats.has(name))formats.set(name,new(load('intl-messageformat').IntlMessageFormat)(messages[name],locale));return formats.get(name).format(values)};
    const styles=new Proxy({},{get:(_,key)=>String(key)}),fetch=async(url,options)=>{
      if(url!=='/api/agent/settings'||options.method!=='POST')throw Error('No publication/provider request is allowed');
      const body=JSON.parse(options.body);writes.push(body);saved=applyApiInactiveMode(structuredClone(body.settings));return Response.json({settings:structuredClone(saved)});
    };
    window.adminSettings={snapshot:()=>structuredClone({writes,saved,saveState:window.adminSettings.saveState}),switchBrowserAccount(id){browserAccount=id;window.dispatchEvent(new Event(load('lib/multicompte/constants.ts').ACTIVE_INRCY_ACCOUNT_EVENT))},remount(){key++;render()}};
    const module={exports:{}};new Function('require','module','exports','React','useDashboardViewerAccess','settingsToConfigs','configsToSettings','normalizeConfigScheduleSlots','dayOffsetLabel','normalizeConfigsForConnectedChannels','settingsOptions','hourOptions','weekDays','agentFrequencyLabel','agentValidationLabel','agentWeekdayLabel','inrAgentMonthlyDateCount','normalizeInrAgentMonthDays','sanitizeInrAgentSettings','translate','styles','noOp','fetch','automationKey','getSaved',${JSON.stringify(controls.replaceAll("structuredClone(saved)", "structuredClone(getSaved())").replaceAll("settingsToConfigs(saved)", "settingsToConfigs(getSaved())"))})(load,module,module.exports,React,useDashboardViewerAccess,settingsToConfigs,configsToSettings,normalizeConfigScheduleSlots,dayOffsetLabel,normalizeConfigsForConnectedChannels,settingsOptions,hourOptions,weekDays,agentFrequencyLabel,agentValidationLabel,agentWeekdayLabel,inrAgentMonthlyDateCount,normalizeInrAgentMonthDays,sanitizeInrAgentSettings,translate,styles,noOp,fetch,automationKey,()=>saved);
    const root=load('react-dom/client').createRoot(document.getElementById('root'));
    function render(){root.render(React.createElement(provider.default,{viewerIsAdmin:${JSON.stringify(admin)},viewerMetaPilotEnabled:true,actorUserId:'actor-admin',activeAccountId:'account-admin'},React.createElement(module.exports.default,{key})))}render();
  ` });
  page.setDefaultTimeout(5_000);
  await page.getByRole("combobox", { name: new RegExp(`^${t(locale, "frequence_bafbfba7")}`) }).waitFor();
  assert.deepEqual(errors, []); return { errors, network };
}
const snapshot = (page: Page) => page.evaluate("window.adminSettings.snapshot()") as Promise<Snapshot>;

test("actual publication selects expose admin choices only to the trusted admin scope, never to pro, staff, reviewer or an active pro account", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [role, admin, browserAccount] of [["admin", true, "account-admin"], ["pro", false, "account-admin"], ["staff", false, "account-admin"], ["reviewer", false, "account-admin"], ["admin on pro account", false, "account-admin"], ["scope changing to pro", true, "account-pro"]] as const) {
      const page = await browser.newPage(), h = await mount(page, { admin, browserAccount });
      const allowed = role === "admin";
      assert.equal(await page.getByRole("option", { name: t("fr-FR", "agent_admin_publish_daily"), exact: true }).count(), Number(allowed), role);
      assert.equal(await page.getByRole("option", { name: t("fr-FR", "agent_admin_publish_without_approval"), exact: true }).count(), Number(allowed), role);
      const state = await snapshot(page);
      assert.equal(state.saved.automations.publish.enabled, false);
      assert.equal(state.saved.automations.publish.frequency, "weekly");
      assert.equal(state.saved.automations.publish.validationMode, "notify_before_validation");
      assert.deepEqual(state.writes, [], "rendering never enables or saves an option");
      if (allowed) {
        await page.evaluate("window.adminSettings.switchBrowserAccount('account-pro')");
        await page.waitForFunction(() => !Array.from(document.querySelectorAll('option')).some(option => option.value === "Publier tous les jours"));
        assert.equal(await page.getByRole("option", { name: t("fr-FR", "agent_admin_publish_without_approval"), exact: true }).count(), 0, "the real account-change event removes both admin choices");
        assert.deepEqual((await snapshot(page)).writes, [], "account changes never autosave");
      }
      assert.deepEqual(h.errors, []); assert.deepEqual(h.network, []); await page.close();
    }
    for (const automationKey of ["grow", "loyalty", "stats"]) {
      const page = await browser.newPage(); await mount(page, { automationKey });
      assert.equal(await page.getByRole("option", { name: t("fr-FR", "agent_admin_publish_daily"), exact: true }).count(), 0);
      assert.equal(await page.getByRole("option", { name: t("fr-FR", "agent_admin_publish_without_approval"), exact: true }).count(), 0); await page.close();
    }
  } finally { await browser.close(); }
});

test("actual admin controls translate all nine languages and save/reload both opt-ins while preserving an explicitly active automation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of locales) {
      const page = await browser.newPage(), h = await mount(page, { locale, enabled: true });
      const frequency = page.getByRole("combobox", { name: new RegExp(`^${t(locale, "frequence_bafbfba7")}`) });
      const validation = page.getByRole("combobox", { name: new RegExp(`^${t(locale, "validation_dd74d182")}`) });
      await frequency.selectOption({ label: t(locale, "agent_admin_publish_daily") });
      await validation.selectOption({ label: t(locale, "agent_admin_publish_without_approval") });
      assert.equal(await page.getByRole("combobox", { name: t(locale, "jour_240ce85d"), exact: true }).count(), 0, locale);
      const time = page.getByRole("combobox", { name: t(locale, "horaire_db0addb3"), exact: true });
      await time.selectOption("14:00");
      assert.equal(await frequency.getAttribute("aria-describedby"), "agent-publish-daily-hint");
      assert.equal(await validation.getAttribute("aria-describedby"), "agent-publish-without-approval-hint");
      assert.equal(await page.locator("#agent-publish-daily-hint").textContent(), t(locale, "agent_admin_publish_daily_hint"));
      assert.equal(await page.locator("#agent-publish-without-approval-hint").textContent(), t(locale, "agent_admin_publish_without_approval_hint"));
      assert.deepEqual((await snapshot(page)).writes, [], "selecting opt-ins does not autosave");
      assert.equal(await page.evaluate("window.adminSettings.save()"), true);
      const state = await snapshot(page), publish = state.writes[0].settings.automations.publish;
      assert.equal(publish.frequency, "daily", locale); assert.equal(publish.validationMode, "admin_automatic_publish", locale); assert.equal(publish.time, "14:00", locale);
      assert.equal(publish.enabled, true, "saving scheduling preferences preserves the previously enabled automation");
      await page.evaluate("window.adminSettings.remount()");
      await page.waitForFunction(label => document.querySelector<HTMLSelectElement>('select')?.value === label, "Publier tous les jours");
      assert.equal(await validation.inputValue(), "Publier sans validation préalable", locale);
      assert.equal(await time.inputValue(), "14:00", locale);
      assert.equal((await snapshot(page)).writes.length, 1);
      assert.deepEqual(h.errors, []); assert.deepEqual(h.network, []); await page.close();
    }
  } finally { await browser.close(); }
});

test("inactive publication automation explains why automatic approval is unavailable and saves daily preferences without enabling it in every language", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of locales) {
      const page = await browser.newPage(), h = await mount(page, { locale });
      const validation = page.getByRole("combobox", { name: new RegExp(`^${t(locale, "validation_dd74d182")}`) });
      const automatic = validation.getByRole("option", { name: t(locale, "agent_admin_publish_without_approval"), exact: true });
      assert.equal(await automatic.evaluate(option => option instanceof HTMLOptionElement && option.disabled && option.matches(":disabled")), true, locale);
      assert.equal(await validation.getAttribute("aria-describedby"), "agent-publish-requires-enabled-hint");
      assert.equal(await page.locator("#agent-publish-requires-enabled-hint").textContent(), t(locale, "agent_admin_publish_requires_enabled"));
      await page.getByRole("combobox", { name: new RegExp(`^${t(locale, "frequence_bafbfba7")}`) }).selectOption({ label: t(locale, "agent_admin_publish_daily") });
      assert.deepEqual((await snapshot(page)).writes, [], "choosing the daily rhythm does not autosave");
      assert.equal(await page.evaluate("window.adminSettings.save()"), true);
      const state = await snapshot(page), publish = state.saved.automations.publish;
      assert.equal(publish.enabled, false); assert.equal(publish.frequency, "daily"); assert.equal(publish.validationMode, "notify_before_validation");
      await page.evaluate("window.adminSettings.remount()");
      await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('select')?.value === "Publier tous les jours");
      assert.equal(await automatic.evaluate(option => option instanceof HTMLOptionElement && option.disabled && option.matches(":disabled")), true, locale);
      assert.equal((await snapshot(page)).writes.length, 1);
      assert.deepEqual(h.errors, []); assert.deepEqual(h.network, []); await page.close();
    }
  } finally { await browser.close(); }
});
