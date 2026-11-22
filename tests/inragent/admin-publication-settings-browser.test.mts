import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, expect, type Locator, type Page } from "@playwright/test";
import { IntlMessageFormat } from "intl-messageformat";
import postcss from "postcss";
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
let settingsOverlay: ts.JsxElement | undefined, planning: ts.JsxElement | undefined, validation: ts.JsxElement | undefined, legacyPlanning: ts.JsxElement | undefined, access: ts.VariableDeclaration | undefined;
const findUi = (node: ts.Node) => {
  if (ts.isJsxElement(node)) {
    const opening = node.openingElement.getText(agent);
    if (opening.includes("styles.settingsCanvasBackdrop")) settingsOverlay = node;
    if (node.openingElement.tagName.getText(agent) === "section" && opening.includes("styles.settingsScheduleGrid")) planning = node;
    if (opening.includes("styles.settingsValidationCard")) validation = node;
    if (node.openingElement.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(agent) === "data-settings-panel" && prop.initializer && ts.isStringLiteral(prop.initializer) && prop.initializer.text === "planning")) legacyPlanning = node;
  }
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(agent) === "useDashboardViewerAccess") access = node;
  ts.forEachChild(node, findUi);
};
findUi(agent); assert.ok(planning, "actual publication Planning section"); assert.ok(validation, "actual publication Validation section"); assert.ok(legacyPlanning); assert.ok(access);
assert.ok(settingsOverlay, "actual publication settings modal including header, scroll area and footer");
const workspaceClient = agent.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AgentWorkspaceClient") as ts.FunctionDeclaration;
const rescheduleFromCalendar = workspaceClient.body?.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "configPatchFromScheduledAt");
assert.ok(rescheduleFromCalendar, "actual recurrence editor used by the calendar");
const api = ts.createSourceFile("settings-route.ts", read("app/api/agent/settings/route.ts"), ts.ScriptTarget.Latest, true);
let inactiveMode: ts.IfStatement | undefined;
const findInactiveMode = (node: ts.Node) => {
  if (ts.isIfStatement(node) && ["!settings.globalEnabled", "!requestedPublish.enabled", "requestedPublish.validationMode"].every(part => node.expression.getText(api).includes(part))) inactiveMode = node;
  ts.forEachChild(node, findInactiveMode);
};
findInactiveMode(api); assert.equal(inactiveMode, undefined, "the actual API preserves the selected validation mode before activation");
const controller = ts.createSourceFile("controller.ts", read("app/dashboard/agent/_hooks/useAgentAutomationController.ts"), ts.ScriptTarget.Latest, true);
const functions = ["updateConfig", "updateConfigFrequency", "updateConfigScheduleSlot", "updateConfigMonthScheduleSlot", "updateConfigMonthDay", "persistSettings", "saveSettings"].map(name => {
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
  const [open,setSettingsKey]=React.useState(true);
  const i18nT=translate,runtimeT=i18nT,agentConnectedChannels=null;
  const AgentSchedulePopover=require('app/dashboard/agent/_components/AgentSchedulePopover.tsx').default;
  const {CalendarMetaIcon,ShieldLineIcon,SparkSettingsIcon,TextMetaIcon,ImageMetaIcon,SendPlaneIcon}=require('app/dashboard/agent/_components/AgentVisuals.tsx');
  const setNotice=noOp,setTableMissing=noOp,setSettingsPlanImpact=noOp,writeCachedAgentViewSnapshot=noOp,refreshActions=async()=>{},showNotice=noOp;
  const { useDashboardSubscriptionEdition } = require("app/dashboard/_components/DashboardEditionProvider.tsx");
  const { getInrAgentPublicationOptionAccess, isInrAgentHighPublicationFrequency } = require("lib/inrAgentAdminPublishPolicy.ts");
  const { apiToDay }=require("app/dashboard/agent/_lib/agent.config.ts");
  const serverPublicationOptionAccess=window.adminSettings.serverPublicationOptionAccess;
  ${["settingsMonthlyDateCount", "subscriptionEdition", "publicationOptionAccess", "settingsPublishDaily", "settingsPublishWithoutApproval", "settingsMonthDays"].map(declaration).join("\n")}
  ${functions}
  ${rescheduleFromCalendar.getText(agent)}
  React.useLayoutEffect(()=>{window.adminSettings.configs=configs;window.adminSettings.save=()=>persistSettings();window.adminSettings.saveState=saveState});
  React.useLayoutEffect(()=>{window.adminSettings.moveCalendarSlot=(target,source)=>configPatchFromScheduledAt(configs.publish,target,source)});
  if (window.completeSettingsModal) {
    const {automations,channelOptions}=require("app/dashboard/agent/_lib/agent.config.ts");
    const {agentAutomationSettingsTitle,agentSourceLabel,agentChannelLabel,agentThemeLabel}=require("app/dashboard/agent/_lib/agent.i18n.ts");
    const {toggleItem}=require("app/dashboard/agent/_lib/agent.utils.ts");
    const {toggleChannelItem}=require("app/dashboard/agent/_lib/agent.settings.ts");
    const {normalizeInrAgentPublicationMediaTypes,normalizeInrAgentStudioMediaPreferencePercent:studioMediaPreferenceStep,INR_AGENT_STUDIO_MEDIA_PREFERENCE_DEFAULT}=require("lib/inrAgentSettings.ts");
    const AgentSettingsMultiSelect=require("app/dashboard/agent/_components/AgentSettingsMultiSelect.tsx").default;
    const AgentMediaReferences=require("app/dashboard/agent/_components/AgentMediaReferences.tsx").default;
    const publish=automations.find(item=>item.key==="publish");
    const settingsAvailableThemes=publish.availableThemes,settingsAvailableChannels=publish.availableChannels,settingsDisplayedChannels=publish.availableChannels;
    const connectedChannelsLoadState="ready",settingsConnectedChannelMessage=null,settingsNoConnectedChannelBlock=false;
    const publicationIdeasOpen=false,setPublicationIdeasOpen=noOp,settingsPublicationIdeaVoiceBusy=false,publicationIdeasSaveState="idle",loadState="ready",testNowKey=null;
    const agentReferenceBusy=false,setAgentReferenceBusy=noOp;
    ${["STUDIO_MEDIA_PREFERENCE_DESCRIPTION_KEYS","settingsStudioMediaPreferenceStep","settingsPublicationMediaTypes","settingsSingleImagePercent"].map(declaration).join("\n")}
    return open ? <main className={styles.agentPage+" "+styles.agentWorkspace} data-agent-workspace="publications">${settingsOverlay.getText(agent)}</main> : null;
  }
  return automationKey==='publish' ? (<>${planning.getText(agent)}${validation.getText(agent)}</>) : (${legacyPlanning.getText(agent)});
}`);

const sources: Record<string, string> = {}, links: Record<string, Record<string, string>> = {};
const mocks = new Set(["react", "react/jsx-runtime", "react-dom", "next-intl", "@/lib/browserAccountCache", "@/lib/mediaGenerationReferenceClient", "@/lib/userFacingErrors"]);
const moduleCss: string[] = [];
function scopedStylesheet(id: string) {
  const mapping: Record<string, string> = {}, prefix = id.split("/").pop()!.split(".")[0] + "_";
  const sheet = postcss.parse(read(id));
  sheet.walkRules(rule => {
    rule.selector = rule.selector.replace(/:global\(([^)]+)\)|\.([a-zA-Z_][\w-]*)/g, (_, global: string, local: string) => global || `.${mapping[local] = prefix + local}`);
  });
  moduleCss.push(sheet.toString());
  return mapping;
}
const agentStyles = scopedStylesheet("app/dashboard/agent/agent.module.css");
function addSource(base: string): string {
  const file = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(file => existsSync(file) && statSync(file).isFile());
  assert.ok(file, `Resolve ${base}`);
  const local = relative(repo, file);
  assert.ok(!isAbsolute(local) && local !== ".." && !local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
  const id = local.replaceAll("\\", "/"); if (sources[id]) return id;
  assert.ok(id.startsWith("lib/") || id.startsWith("app/dashboard/agent/_lib/") || /^app\/dashboard\/agent\/_components\/Agent(SchedulePopover|SettingsPopover|SettingsMultiSelect|MediaReferences|Visuals)\./.test(id) || /^app\/dashboard\/_components\/(DashboardEditionProvider|DashboardViewerAccessProvider|MediaReferenceInputs|MediaLibraryPickerModal|MediaGenerator|CompatiblePopover)\./.test(id), `Unexpected fixture surface ${id}`);
  sources[id] = id.endsWith(".css") ? `module.exports={__esModule:true,default:${JSON.stringify(scopedStylesheet(id))}};` : compile(readFileSync(file, "utf8")); links[id] = {};
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
const editionProviderId = addSource(resolve(repo, "app/dashboard/_components/DashboardEditionProvider.tsx"));
addSource(resolve(repo, "lib/inrAgentAdminPublishPolicy.ts"));
for (const name of ["AgentSchedulePopover", "AgentSettingsMultiSelect", "AgentMediaReferences", "AgentVisuals"]) addSource(resolve(repo, `app/dashboard/agent/_components/${name}.tsx`));
addSource(resolve(repo, "app/dashboard/agent/_lib/agent.utils.ts"));
for (const [name, file] of [["react", "react.development.js"], ["react/jsx-runtime", "react-jsx-runtime.development.js"], ["react-dom", "react-dom.development.js"], ["react-dom/client", "react-dom-client.development.js"], ["scheduler", "scheduler.development.js"]]) {
  const pkg = name === "react/jsx-runtime" ? "react" : name === "react-dom/client" ? "react-dom" : name;
  sources[name] = readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), "cjs", file), "utf8");
}
sources["intl-messageformat"] = compile(readFileSync(join(dirname(require.resolve("intl-messageformat")), "intl-messageformat.iife.js"), "utf8"));
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"] as const;
const catalog = (locale: string) => JSON.parse(read(`messages/${locale}/agent.json`)) as Record<string, string>;
const t = (locale: string, key: string) => String(new IntlMessageFormat(catalog(locale)[key], locale).format());
type SavedSettings = { globalEnabled: boolean; automations: Record<string, { enabled: boolean; frequency: string; validationMode: string; time: string; metadata: Record<string, unknown> }> };
type Snapshot = { writes: Array<{ settings: SavedSettings }>; saved: SavedSettings; saveState: string };
async function mount(page: Page, { admin = true, edition = "basic", serverAccess = null as { highFrequency: boolean; automaticPublish: boolean } | null, locale = "fr-FR", automationKey = "publish", browserAccount = "account-admin", enabled = false, complete = false } = {}) {
  const errors: string[] = [], network: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (complete && url.origin === "https://settings.test" && /^\/icons\/[\w.-]+\.(?:png|svg|jpg|webp)$/.test(url.pathname)) {
      return route.fulfill({ path: join(repo, "public", url.pathname) });
    }
    network.push(url.href);
    return route.abort();
  });
  await page.setContent('<!doctype html><html><head><base href="https://settings.test/"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
  if (complete) await page.addStyleTag({ content: readFileSync(require.resolve("tailwindcss/preflight.css"), "utf8") + read("app/globals.css").replace(/^@import[^;]*;/gm,"") });
  await page.addStyleTag({ content: complete ? moduleCss.join("\n") : moduleCss.find(sheet => sheet.includes(".AgentSchedulePopover_")) || "" });
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},links=${JSON.stringify(links)},cache={},process={env:{NODE_ENV:'development'}},messages=${JSON.stringify(catalog(locale))},locale=${JSON.stringify(locale)},automationKey=${JSON.stringify(automationKey)},formats=new Map(),noOp=()=>{};
    window.completeSettingsModal=${JSON.stringify(complete)};
    const mediaMessages=${complete ? read(`messages/${locale}/media.json`) : "{}"};
    let browserAccount=${JSON.stringify(browserAccount)},writes=[],key=0;
    function load(name,parent=''){
      if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=>browserAccount};
      if(name==="next-intl")return {useLocale:()=>locale,useTranslations:namespace=>namespace==="media"?translateMedia:translate};
      if(name==="@/lib/mediaGenerationReferenceClient")return {};
      if(name==="@/lib/userFacingErrors")return {getLocalizedErrorMessage:(error,locale,fallback)=>error?.message || fallback};
      const id=links[parent]?.[name]||name;if(cache[id])return cache[id].exports;if(!sources[id])throw Error('Unexpected settings fixture import '+name);
      const record=cache[id]={exports:{}};new Function('require','module','exports','process',sources[id])(child=>load(child,id),record,record.exports,process);return record.exports;
    }
    const React=load('react'),provider=load(${JSON.stringify(providerId)}),useDashboardViewerAccess=provider.useDashboardViewerAccess;
    const {settingsToConfigs,configsToSettings,normalizeConfigScheduleSlots,normalizeConfigMonthScheduleSlots,dayOffsetLabel,normalizeConfigsForConnectedChannels}=load(${JSON.stringify(settingsId)});
    const {settingsOptions,hourOptions,weekDays}=load(${JSON.stringify(configId)}),{agentFrequencyLabel,agentValidationLabel,agentWeekdayLabel}=load(${JSON.stringify(i18nId)});
    const {inrAgentMonthlyDateCount,normalizeInrAgentMonthDays,normalizeInrAgentMonthScheduleSlots}=load(${JSON.stringify(scheduleId)}),{INR_AGENT_DEFAULT_SETTINGS,sanitizeInrAgentSettings}=load(${JSON.stringify(defaultsId)});
    let saved=structuredClone(INR_AGENT_DEFAULT_SETTINGS);saved.globalEnabled=${JSON.stringify(enabled)};saved.enabled=${JSON.stringify(enabled)};saved.automations.publish.enabled=${JSON.stringify(enabled)};
    const translate=(name,values={})=>{if(!Object.hasOwn(messages,name))throw Error('Missing agent translation '+name);if(!formats.has(name))formats.set(name,new(load('intl-messageformat').IntlMessageFormat)(messages[name],locale));return formats.get(name).format(values)};
    const translateMedia=(name,values={})=>{const id="media."+name;if(!formats.has(id))formats.set(id,new(load('intl-messageformat').IntlMessageFormat)(mediaMessages[name],locale));return formats.get(id).format(values)};
    const styles=${JSON.stringify(agentStyles)},fetch=async(url,options)=>{
      if (window.completeSettingsModal && url.startsWith("/api/media-library/items?")) return Response.json({ok:true,items:[]});
      if(url!=='/api/agent/settings'||options.method!=='POST')throw Error('No publication/provider request is allowed');
      const body=JSON.parse(options.body);writes.push(body);saved=sanitizeInrAgentSettings(structuredClone(body.settings));return Response.json({settings:structuredClone(saved)});
    };
    window.adminSettings={serverPublicationOptionAccess:${JSON.stringify(serverAccess)},snapshot:()=>structuredClone({writes,saved,saveState:window.adminSettings.saveState}),switchBrowserAccount(id){browserAccount=id;window.dispatchEvent(new Event(load('lib/multicompte/constants.ts').ACTIVE_INRCY_ACCOUNT_EVENT))},remount(){key++;render()}};
    const module={exports:{}};new Function('require','module','exports','React','useDashboardViewerAccess','settingsToConfigs','configsToSettings','normalizeConfigScheduleSlots','normalizeConfigMonthScheduleSlots','dayOffsetLabel','normalizeConfigsForConnectedChannels','settingsOptions','hourOptions','weekDays','agentFrequencyLabel','agentValidationLabel','agentWeekdayLabel','inrAgentMonthlyDateCount','normalizeInrAgentMonthDays','normalizeInrAgentMonthScheduleSlots','sanitizeInrAgentSettings','translate','styles','noOp','fetch','automationKey','getSaved',${JSON.stringify(controls.replaceAll("structuredClone(saved)", "structuredClone(getSaved())").replaceAll("settingsToConfigs(saved)", "settingsToConfigs(getSaved())"))})(load,module,module.exports,React,useDashboardViewerAccess,settingsToConfigs,configsToSettings,normalizeConfigScheduleSlots,normalizeConfigMonthScheduleSlots,dayOffsetLabel,normalizeConfigsForConnectedChannels,settingsOptions,hourOptions,weekDays,agentFrequencyLabel,agentValidationLabel,agentWeekdayLabel,inrAgentMonthlyDateCount,normalizeInrAgentMonthDays,normalizeInrAgentMonthScheduleSlots,sanitizeInrAgentSettings,translate,styles,noOp,fetch,automationKey,()=>saved);
    const root=load('react-dom/client').createRoot(document.getElementById('root'));
    function render(){root.render(React.createElement(load(${JSON.stringify(editionProviderId)}).default,{edition:'premium',subscriptionEdition:${JSON.stringify(edition)}},React.createElement(provider.default,{viewerIsAdmin:${JSON.stringify(admin)},viewerMetaPilotEnabled:true,actorUserId:'actor-admin',activeAccountId:'account-admin'},React.createElement(module.exports.default,{key}))))}render();
  ` });
  page.setDefaultTimeout(5_000);
  await page.getByRole("combobox", { name: new RegExp(`^${t(locale, "frequence_bafbfba7")}`) }).waitFor().catch(error => { throw errors.length ? new Error(errors.join(", ")) : error; });
  assert.deepEqual(errors, []); return { errors, network };
}
const snapshot = (page: Page) => page.evaluate("window.adminSettings.snapshot()") as Promise<Snapshot>;

async function expectHitTarget(target: Locator, minimumHeight = 0) {
  await target.scrollIntoViewIfNeeded();
  const result = await target.evaluate((element, minimum) => {
    const box = element.getBoundingClientRect(), center = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      visible: box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1,
      tappable: box.width >= 20 && box.height + 0.01 >= minimum,
      hit: element.contains(center), actual: center?.tagName, size: [Math.round(box.width), Math.round(box.height)],
    };
  }, minimumHeight);
  assert.ok(result.visible && result.hit && result.tappable, `${target}: ${JSON.stringify(result)}`);
}

test("complete publication settings modal keeps its cards, text, popup selections and footer usable at phone, tablet and desktop sizes", async context => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[320, 568], [375, 667], [400, 811], [768, 1024], [1440, 900]]) {
      await context.test(`${width} × ${height}`, async () => {
        const page = await browser.newPage({ viewport: { width, height } });
        try {
          const { errors } = await mount(page, { complete: true });
          const dialog = page.getByRole("dialog", { name: "Réglages — Publier", exact: true });
          const scrollArea = dialog.locator(`.${agentStyles.publishSettingsLayout}`);
          const save = dialog.getByRole("button", { name: "Enregistrer les réglages" });
          const close = dialog.getByRole("button", { name: "Fermer", exact: true });
          const cards = ["settingsScheduleGrid", "settingsPreferredMediaFullWidth", "settingsChannelsCard", "settingsThemesCard", "settingsReferenceCard", "settingsValidationCard"].map(key => dialog.locator(`.${agentStyles[key]}`));
          assert.equal(await dialog.isVisible(), true);
          await expectHitTarget(close, width <= 1100 ? 44 : 32);
          await expectHitTarget(save, 40);
          const fixedFooter = await save.boundingBox();
          assert.equal(await scrollArea.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, "no horizontal scroll inside settings");
          const rects = await Promise.all(cards.map(card => card.boundingBox()));
          for (const [index, rect] of rects.entries()) {
            assert.ok(rect && rect.width > 0 && rect.height > 0 && rect.x >= -1 && rect.x + rect.width <= width + 1, `card ${index} inside the viewport width`);
            for (const next of rects.slice(index + 1)) {
              assert.ok(next && (rect.y + rect.height <= next.y + 1 || next.y + next.height <= rect.y + 1 || rect.x + rect.width <= next.x + 1 || next.x + next.width <= rect.x + 1), `card ${index} overlaps a sibling`);
            }
          }
          const frequency = dialog.getByRole("combobox", { name: /^Fréquence/i });
          const horizon = dialog.getByRole("combobox", { name: /Contenus préparés à l’avance/i });
          await expectHitTarget(frequency, 40);
          await frequency.selectOption({ label: t("fr-FR", "agent_admin_publish_daily") });
          await expectHitTarget(horizon, 40);
          await horizon.selectOption("30");
          for (const control of [frequency, horizon]) {
            const textFits = await control.evaluate(element => {
              const select = element as HTMLSelectElement, css = getComputedStyle(select);
              const canvas = document.createElement("canvas").getContext("2d")!;
              canvas.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
              return { font: parseFloat(css.fontSize), text: canvas.measureText(select.selectedOptions[0].text).width, available: select.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) };
            });
            assert.ok(textFits.font >= 12 && textFits.text <= textFits.available + 1, `selected text must fit ${control}: ${JSON.stringify(textFits)}`);
          }
          for (const [index, label] of ["Planning", "Canaux", "Thèmes"].entries()) {
            const card = cards[[0, 2, 3][index]], trigger = card.getByRole("button", { name: new RegExp(`^${label}`) });
            const panel = page.getByRole("dialog", { name: label, exact: true });
            await expectHitTarget(trigger, width <= 400 ? 44 : 32);
            const closedHeight = (await card.boundingBox())!.height;
            await trigger.click();
            await panel.waitFor();
            const box = await panel.boundingBox();
            const frame = (await dialog.boundingBox())!;
            assert.ok(box && box.x >= frame.x - 1 && box.y >= frame.y - 1 && box.x + box.width <= frame.x + frame.width + 1 && box.y + box.height <= frame.y + frame.height + 1, `${label} stays inside the settings frame above mobile navigation`);
            assert.equal((await card.boundingBox())!.height, closedHeight, `${label} opens above the cards`);
            if (index === 0) {
              const last = panel.getByRole("combobox", { name: "Horaire 7", exact: true });
              await expectHitTarget(last, 32);
              await last.selectOption("14:00");
              assert.equal(await last.inputValue(), "14:00");
            } else {
              const option = panel.getByRole("checkbox").last();
              const row = option.locator("xpath=ancestor::label[1]");
              await expectHitTarget(row, 32);
              const wasSelected = await option.isChecked();
              await row.click();
              assert.equal(await option.isChecked(), !wasSelected, label);
            }
            await page.keyboard.press("Escape");
            await panel.waitFor({ state: "hidden" });
            await expect(trigger).toHaveAttribute("aria-expanded", "false");
            await expect(trigger).toBeFocused();
          }
          const generation = cards[1].getByRole("button", { name: "Génération IA", exact: true });
          await expectHitTarget(generation, width <= 400 ? 40 : 32);
          await generation.click();
          const stepper = cards[1].getByRole("group", { name: t("fr-FR", "studio_media_preference_title") });
          const before = await stepper.locator("output").innerText();
          if (width <= 400) for (const button of await stepper.getByRole("button").all()) {
            const box = (await button.boundingBox())!;
            assert.ok(box.width + 0.01 >= 44 && box.height + 0.01 >= 44, "both percentage buttons have a 44 px touch target");
          }
          await stepper.locator("button:enabled").first().click();
          await expect(stepper.locator("output")).not.toHaveText(before);
          const informationLabel = JSON.parse(read("messages/fr-FR/media.json")).ai_generator_reference_information;
          const referenceHelp = cards[4].getByRole("button", { name: informationLabel, exact: true });
          await expect(referenceHelp).toHaveCount(2);
          for (const help of await referenceHelp.all()) {
            await expectHitTarget(help, width <= 400 ? 44 : 20);
            await help.click();
            const tip = page.getByRole("dialog", { name: informationLabel, exact: true });
            await expect(tip).toBeVisible();
            await expectHitTarget(tip.locator("p"));
            await page.keyboard.press("Escape");
            await expect(tip).toBeHidden();
          }
          const library = cards[4].getByRole("button", { name: "Médiathèque", exact: true });
          await library.click();
          const libraryDialog = page.locator("[data-media-library-picker]");
          await expect(libraryDialog).toBeVisible();
          const libraryClose = libraryDialog.getByRole("button", { name: "Fermer", exact: true }).first();
          await expectHitTarget(libraryClose);
          await libraryClose.click();
          await expect(libraryDialog).toBeHidden();
          await expect(library).toBeFocused();
          await scrollArea.evaluate(element => { element.scrollTop = element.scrollHeight; });
          if (width <= 400) assert.ok(await scrollArea.evaluate(element => element.scrollTop > 0), "the settings body scrolls to the final cards");
          const footerAfterScroll = (await save.boundingBox())!;
          assert.ok(fixedFooter && Math.abs(fixedFooter.y - footerAfterScroll.y) <= 1, "save stays visible while settings scroll");
          const validationSelect = cards[5].getByRole("combobox");
          await expectHitTarget(validationSelect, 40);
          await validationSelect.selectOption({ label: t("fr-FR", "agent_admin_publish_without_approval") });
          await expectHitTarget(save, 40);
          assert.deepEqual((await snapshot(page)).writes, []);
          await save.click();
          await page.waitForFunction("window.adminSettings.snapshot().writes.length === 1");
          const publish = (await snapshot(page)).saved.automations.publish;
          assert.equal(publish.validationMode, "admin_automatic_publish");
          assert.equal(publish.frequency, "daily");
          await expect(dialog).toBeHidden();
          await page.evaluate("window.adminSettings.remount()");
          await expect(dialog).toBeVisible();
          await expect(horizon).toHaveValue("30");
          await expectHitTarget(close, width <= 1100 ? 44 : 32);
          await close.click();
          await dialog.waitFor({ state: "hidden" });
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
    }
  } finally { await browser.close(); }
});

test("Basic keeps manual publication, except for the existing scoped administrator access", async () => {
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

test("Standard shows two disabled Premium frequencies and can save automatic approval in all nine languages", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of locales) {
      const page = await browser.newPage({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });
      try {
        const h = await mount(page, { admin: false, edition: "standard", locale });
        const frequency = page.getByRole("combobox", { name: new RegExp(`^${t(locale, "frequence_bafbfba7")}`) });
        for (const key of ["agent_publish_five_times_weekly", "agent_admin_publish_daily"]) {
          const label = new IntlMessageFormat(catalog(locale).agent_publish_premium_frequency, locale).format({ frequency: t(locale, key) });
          await expect(frequency.getByRole("option", { name: String(label), exact: true })).toHaveJSProperty("disabled", true);
        }
        const validation = page.getByRole("combobox", { name: new RegExp(`^${t(locale, "validation_dd74d182")}`) });
        await validation.selectOption({ label: t(locale, "agent_admin_publish_without_approval") });
        assert.equal(await page.evaluate("window.adminSettings.save()"), true);
        const saved = (await snapshot(page)).saved;
        assert.equal(saved.automations.publish.frequency, "weekly");
        assert.equal(saved.automations.publish.validationMode, "admin_automatic_publish");
        assert.equal(saved.globalEnabled, false);
        await page.evaluate("window.adminSettings.remount()");
        await expect(validation).toHaveValue("Publier sans validation préalable");
        assert.deepEqual(h.errors, []);
      } finally { await page.close(); }
    }
    const downgraded = await browser.newPage();
    try {
      await mount(downgraded, { admin: false, edition: "premium", serverAccess: { highFrequency: false, automaticPublish: true } });
      await expect(downgraded.getByRole("option", { name: "5 fois par semaine — Premium", exact: true })).toHaveJSProperty("disabled", true);
      await expect(downgraded.getByRole("option", { name: "Publier sans validation préalable", exact: true })).toHaveJSProperty("disabled", false);
    } finally { await downgraded.close(); }
  } finally { await browser.close(); }
});

test("Premium and Founder accounts can edit five distinct weekly days, save their times and reopen the schedule", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const edition of ["premium", "founder"]) {
      const page = await browser.newPage({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });
      try {
        const h = await mount(page, { admin: false, edition, complete: true });
        const frequency = page.getByRole("combobox", { name: /^Fréquence/ });
        await expect(frequency.getByRole("option", { name: "Publier tous les jours", exact: true })).toHaveJSProperty("disabled", false);
        await frequency.selectOption({ label: "5 fois par semaine" });
        const planning = page.getByRole("button", { name: "Planning", exact: true });
        await planning.click();
        const weekdays = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
        for (const [index, day] of weekdays.entries()) {
          await expect(page.getByRole("combobox", { name: `Jour ${index + 1}`, exact: true })).toHaveValue(day);
        }
        const fifthDay = page.getByRole("combobox", { name: "Jour 5", exact: true });
        const fifthTime = page.getByRole("combobox", { name: "Horaire 5", exact: true });
        await expect(fifthDay.getByRole("option", { name: "Lundi", exact: true })).toHaveJSProperty("disabled", true);
        await fifthDay.selectOption("Samedi");
        await fifthTime.selectOption("14:00");
        await fifthTime.press("Escape");
        assert.equal(await page.evaluate("window.adminSettings.save()"), true);
        const publish = (await snapshot(page)).saved.automations.publish;
        assert.equal(publish.frequency, "five_times_weekly");
        assert.equal((publish.metadata.scheduleSlots as unknown[]).length, 5);
        const moved = await page.evaluate("window.adminSettings.moveCalendarSlot('2030-01-13T16:30:00','2030-01-08T09:00:00')") as { scheduleSlots: { day: string; time: string }[] };
        assert.deepEqual(moved.scheduleSlots.map(slot => slot.day), ["Lundi", "Dimanche", "Mercredi", "Jeudi", "Samedi"]);
        assert.deepEqual(moved.scheduleSlots[1], { day: "Dimanche", time: "16:30" });
        assert.deepEqual(moved.scheduleSlots[4], { day: "Samedi", time: "14:00" });
        await page.evaluate("window.adminSettings.remount()");
        await expect(frequency).toHaveValue("5 fois par semaine");
        await planning.click();
        await expect(fifthDay).toHaveValue("Samedi");
        await expect(fifthTime).toHaveValue("14:00");
        assert.deepEqual(h.errors, []);
      } finally { await page.close(); }
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
      await page.getByRole("button", { name: t(locale, "settings_section_planning"), exact: true }).click();
      const time = page.getByRole("combobox", { name: `${t(locale, "horaire_db0addb3")} 1`, exact: true });
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
      await page.getByRole("button", { name: t(locale, "settings_section_planning"), exact: true }).click();
      assert.equal(await time.inputValue(), "14:00", locale);
      assert.equal((await snapshot(page)).writes.length, 1);
      assert.deepEqual(h.errors, []); assert.deepEqual(h.network, []); await page.close();
    }
  } finally { await browser.close(); }
});

test("inactive admin publication automation saves both preferences before activation without enabling or authorizing execution in every language", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of locales) {
      const page = await browser.newPage(), h = await mount(page, { locale });
      const validation = page.getByRole("combobox", { name: new RegExp(`^${t(locale, "validation_dd74d182")}`) });
      const automatic = validation.getByRole("option", { name: t(locale, "agent_admin_publish_without_approval"), exact: true });
      assert.equal(await automatic.evaluate(option => option instanceof HTMLOptionElement && option.disabled), false, locale);
      await validation.selectOption({ label: t(locale, "agent_admin_publish_without_approval") });
      assert.equal(await validation.getAttribute("aria-describedby"), "agent-publish-without-approval-hint");
      await page.getByRole("combobox", { name: new RegExp(`^${t(locale, "frequence_bafbfba7")}`) }).selectOption({ label: t(locale, "agent_admin_publish_daily") });
      assert.deepEqual((await snapshot(page)).writes, [], "choosing the daily rhythm does not autosave");
      assert.equal(await page.evaluate("window.adminSettings.save()"), true);
      const state = await snapshot(page), publish = state.saved.automations.publish;
      assert.equal(state.saved.globalEnabled, false); assert.equal(publish.enabled, false); assert.equal(publish.frequency, "daily"); assert.equal(publish.validationMode, "admin_automatic_publish");
      assert.equal(publish.metadata.adminPublishOptIn, undefined, "saving preferences cannot authorize automatic publication");
      await page.evaluate("window.adminSettings.remount()");
      await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('select')?.value === "Publier tous les jours");
      assert.equal(await validation.inputValue(), "Publier sans validation préalable", locale);
      assert.equal(await automatic.evaluate(option => option instanceof HTMLOptionElement && option.disabled), false, locale);
      assert.equal((await snapshot(page)).writes.length, 1);
      assert.deepEqual(h.errors, []); assert.deepEqual(h.network, []); await page.close();
    }
  } finally { await browser.close(); }
});
