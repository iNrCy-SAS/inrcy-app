import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const transpile = (source: string, jsx = false) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: jsx ? ts.JsxEmit.ReactJSX : undefined, esModuleInterop: true } }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const modal = ts.createSourceFile("PublishModal.tsx", [read("app/dashboard/booster/publier/PublishModal.tsx"), read("app/dashboard/booster/publier/publicationSubmission.ts")].join("\n"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function initializer(name: string) {
  let found: ts.Expression | undefined;
  function visit(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(modal) === name) found = node.initializer; ts.forEachChild(node, visit); }
  visit(modal); assert.ok(found, `Real parent binding ${name} must exist`);
  return ts.isCallExpression(found) && found.expression.getText(modal) === "useCallback" ? found.arguments[0] : found;
}
function callback(name: string, scope: Record<string, unknown>) {
  const expression = initializer(name); assert.ok(expression);
  return new Function(...Object.keys(scope), `${transpile(`const callback=(${expression.getText(modal)});`)};return callback;`)(...Object.values(scope)) as (value: unknown) => void;
}

test("Validation owns the four controlled channel options and real parent callbacks preserve touched preferences", () => {
  const bindings = new Map<string, Map<string, string>>();
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ["PublishContentEditorPanel", "PublishValidationChannelOptions", "PublishValidationBoard"].includes(node.tagName.getText(modal))) {
      bindings.set(node.tagName.getText(modal), new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(modal), attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression?.getText(modal) || "" : ""])));
    }
    ts.forEachChild(node, visit);
  }
  visit(modal); assert.equal(bindings.size, 3);
  const summaryBinding = bindings.get("PublishValidationBoard")!.get("summaryContainer"); assert.ok(summaryBinding);
  const container = {id: "validation-footer"};
  for (const step of ["channels", "intention", "content", "media", "control", "publication", "results"]) {
    const current: unknown = new Function("activeWizardStep", "contentActionsContainer", `${transpile(`const value=(${summaryBinding});`)};return value;`)(step, container);
    assert.equal(current, step === "control" ? container : null, "The actual parent permits the summary portal only in Validation");
  }
  const expectedBindings = { pinterestBoards: "pinterestBoards", pinterestBoardId: "pinterestBoardId", pinterestBoardsLoading: "pinterestBoardsLoading", pinterestBoardsError: "pinterestBoardsError", onPinterestBoardChange: "onPinterestBoardChange", threadsPublicationMode: "threadsPublicationMode", threadsPublicationPreferences: "threadsPublicationPreferences", threadsPreferencesLoading: "threadsPreferencesLoading", threadsPreferencesFailed: "threadsPreferencesFailed", onThreadsPublicationModeChange: "onThreadsPublicationModeChange", facebookPublicationPlacement: "facebookPublicationPlacement", facebookStoryEnabled: "facebookStoryEnabled", facebookPublicationPreferences: "facebookPublicationPreferences", onFacebookPublicationPlacementChange: "changeFacebookPublicationPlacement", onFacebookStoryEnabledChange: "changeFacebookStoryEnabled", instagramPublicationPlacement: "instagramPublicationPlacement", instagramStoryEnabled: "instagramStoryEnabled", instagramPublicationPreferences: "instagramPublicationPreferences", onInstagramPublicationPlacementChange: "changeInstagramPublicationPlacement", onInstagramStoryEnabledChange: "changeInstagramStoryEnabled" };
  for (const [prop, value] of Object.entries(expectedBindings)) {
    assert.equal(bindings.get("PublishValidationChannelOptions")!.get(prop), value, `${prop} must use the existing parent state or guarded callback`);
    if (!["facebookPublicationPlacement", "facebookStoryEnabled", "instagramPublicationPlacement", "instagramStoryEnabled"].includes(prop)) assert.equal(bindings.get("PublishContentEditorPanel")!.has(prop), false, `Contents no longer exposes the ${prop} option`);
  }
  assert.equal(bindings.get("PublishContentEditorPanel")!.has("renderChannelSoundtrack"), false, "Music configuration belongs to Validation");
  for (const channel of ["Facebook", "Instagram"]) {
    const lower = channel.toLowerCase(), touched = { current: false }, preferences = { current: { reelsEnabled: true, storiesEnabled: true } };
    const state: { placement: unknown; includeStory: unknown } = { placement: "classic", includeStory: false };
    const scope = { [`${lower}PlacementTouchedRef`]: touched, [`${lower}PublicationPreferencesRef`]: preferences, [`set${channel}PublicationPlacement`]: (value: unknown) => { state.placement = value; }, [`set${channel}StoryEnabled`]: (value: unknown) => { state.includeStory = value; } };
    const placement = callback(`change${channel}PublicationPlacement`, scope), story = callback(`change${channel}StoryEnabled`, scope);
    story(true); assert.equal(state.includeStory, true); placement("reel"); assert.equal(state.placement, "reel"); assert.equal(state.includeStory, true);
    placement("story"); assert.equal(state.placement, "story"); assert.equal(state.includeStory, false, "Story as primary must never request a second duplicate Story"); assert.equal(touched.current, true);
    preferences.current = { reelsEnabled: false, storiesEnabled: false };
    placement("reel"); assert.equal(state.placement, "classic"); placement("story"); assert.equal(state.placement, "classic"); story(true); assert.equal(state.includeStory, false);
  }
  const board = { id: "", name: "", error: "previous" };
  callback("onPinterestBoardChange", { pinterestBoards: [{ id: "board-one", name: "Vitrine" }, { id: "board-two", name: "Projets" }], setPinterestBoardId: (value: string) => { board.id = value; }, setPinterestBoardName: (value: string) => { board.name = value; }, setPinterestBoardsFailure: (value: unknown) => { board.error = value === null ? "" : String(value); } })(" board-two ");
  assert.deepEqual(board, { id: "board-two", name: "Projets", error: "" });
  const boardPayloads: ts.Expression[] = [];
  function findBoardPayloads(node: ts.Node) { if (ts.isPropertyAssignment(node) && node.name.getText(modal) === "pinterestPublicationSettings") boardPayloads.push(node.initializer); ts.forEachChild(node, findBoardPayloads); }
  findBoardPayloads(modal); assert.equal(boardPayloads.length, 2, "Immediate and scheduled publications must persist the controlled board choice");
  for (const payload of boardPayloads) {
    const create = (channels: string[]) => new Function("publishTargetChannels", "groupChannels", "pinterestBoardId", "pinterestBoardName", `${transpile(`const value=(${payload.getText(modal)});`)};return value;`)(channels, channels, board.id, board.name);
    assert.deepEqual(create(["pinterest"]), { boardId: "board-two", boardName: "Projets" }); assert.equal(create(["gmb"]), null);
  }
  for (const disabled of [{ metaPilotEnabled: false }, { threadsPreferencesLoading: true }, { threadsPreferencesFailed: true }, { threadsPublicationPreferences: { ghostEnabled: false } }]) {
    const touched = { current: false }, calls: unknown[] = [];
    callback("onThreadsPublicationModeChange", { metaPilotEnabled: true, threadsPreferencesLoading: false, threadsPreferencesFailed: false, threadsPublicationPreferences: { ghostEnabled: true }, threadsModeTouchedRef: touched, setThreadsPublicationMode: (value: unknown) => calls.push(value), ...disabled })("ghost");
    assert.deepEqual(calls, []); assert.equal(touched.current, false);
  }
  const touched = { current: false }, calls: unknown[] = [];
  callback("onThreadsPublicationModeChange", { metaPilotEnabled: true, threadsPreferencesLoading: false, threadsPreferencesFailed: false, threadsPublicationPreferences: { ghostEnabled: true }, threadsModeTouchedRef: touched, setThreadsPublicationMode: (value: unknown) => calls.push(value) })("ghost");
  assert.deepEqual(calls, ["ghost"]); assert.equal(touched.current, true);
});

const sources = { react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"), "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"), options: transpile(read("app/dashboard/booster/publier/components/PublishValidationChannelOptions.tsx"), true), "@/lib/metaImageMotionTiming": transpile(read("lib/metaImageMotionTiming.ts")) };
const fixture = `const sources=${JSON.stringify(sources)},messages=${read("messages/fr-FR/booster.json")},loaded={};
function require(name){if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};if(name==='next-intl')return {useTranslations:()=>key=>messages[key]||key};if(loaded[name])return loaded[name].exports;if(!sources[name])throw Error('Unexpected validation-options dependency '+name);const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports}
const React=require('react'),Options=require('options').default,root=require('react-dom/client').createRoot(document.getElementById('root'));
window.events=[];window.requests=[];window.fetch=url=>{window.requests.push(url);throw Error('No provider or publication call permitted')};
let config={disabled:false,pinterestBoards:[{id:'board-one',name:'Vitrine'},{id:'board-two',name:'Projets'}],pinterestBoardsLoading:false,pinterestBoardsError:'',threadsPublicationPreferences:{ghostEnabled:true},threadsPreferencesLoading:false,threadsPreferencesFailed:false,facebookPublicationPreferences:{reelsEnabled:true,storiesEnabled:true},instagramPublicationPreferences:{reelsEnabled:true,storiesEnabled:true}};
function Fixture(props){const [values,setValues]=React.useState({facebookPublicationPlacement:'classic',facebookStoryEnabled:false,instagramPublicationPlacement:'classic',instagramStoryEnabled:false,pinterestBoardId:'board-one',threadsPublicationMode:'classic'});window.values=values;window.replaceValues=patch=>setValues(previous=>({...previous,...patch}));const change=(key,value)=>{window.events.push({key,value});setValues(previous=>({...previous,[key]:value}))};const callbacks={onFacebookPublicationPlacementChange:value=>change('facebookPublicationPlacement',value),onFacebookStoryEnabledChange:value=>change('facebookStoryEnabled',value),onInstagramPublicationPlacementChange:value=>change('instagramPublicationPlacement',value),onInstagramStoryEnabledChange:value=>change('instagramStoryEnabled',value),onPinterestBoardChange:value=>change('pinterestBoardId',value),onThreadsPublicationModeChange:value=>change('threadsPublicationMode',value)};return React.createElement('main',null,['facebook','instagram','pinterest','threads','gmb'].map(channel=>React.createElement(Options,{key:channel,channel,...props,...values,...callbacks})))}
window.configure=patch=>{config={...config,...patch};root.render(React.createElement(Fixture,config))};window.configure({});`;
type FixtureState = { configure: (patch: Record<string, unknown>) => void; replaceValues: (patch: Record<string, unknown>) => void; values: Record<string, string | boolean>; requests: string[] };

test("the actual Validation options remain controlled across external updates, Meta formats, Pinterest boards and Threads preferences", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); await page.route("**/*", route => route.abort());
    await page.setContent(`<style>*{box-sizing:border-box;margin:0;padding:0}${read("app/dashboard/booster/publier/components/PublishValidationChannelOptions.module.css")}body{background:#101b2d;color:white;font:14px Arial;padding:24px}main{display:grid;gap:16px;width:400px}</style><div id="root"></div>`); await page.addScriptTag({ content: fixture });
    await page.locator('[data-channel-validation-options="facebook"]').waitFor(); assert.equal(await page.locator('[data-channel-validation-options]').count(), 4); assert.equal(await page.locator('[data-channel-validation-options="gmb"]').count(), 0);
    for (const channel of ["facebook", "instagram"]) {
      const row = page.locator(`[data-channel-validation-options="${channel}"]`), classic = row.locator('input[type="radio"][value="classic"]'), reel = row.locator('input[type="radio"][value="reel"]'), story = row.getByRole("checkbox");
      await page.evaluate(channel => (window as unknown as FixtureState).replaceValues({ [`${channel}PublicationPlacement`]: "reel", [`${channel}StoryEnabled`]: true }), channel);
      await page.waitForFunction(channel => (document.querySelector(`[data-channel-validation-options="${channel}"] input[value="reel"]`) as HTMLInputElement)?.checked, channel); assert.equal(await story.isChecked(), true);
      await classic.check(); assert.equal(await reel.isChecked(), false); assert.equal(await story.isChecked(), true, "The independent Story choice survives a primary format change");
      await story.uncheck(); assert.equal(await page.evaluate(channel => (window as unknown as FixtureState).values[`${channel}StoryEnabled`], channel), false);
      await page.evaluate(channel => (window as unknown as FixtureState).replaceValues({ [`${channel}PublicationPlacement`]: "story", [`${channel}StoryEnabled`]: false }), channel);
      await page.waitForFunction(channel => !(document.querySelector(`[data-channel-validation-options="${channel}"] input[value="classic"]`) as HTMLInputElement)?.checked, channel);
      assert.equal(await story.isChecked(), true, "A saved Story-only draft keeps its intent visible"); assert.equal(await reel.isChecked(), false);
      await reel.check(); assert.equal(await classic.isChecked(), false); assert.equal(await story.isChecked(), true); assert.equal(await page.evaluate(channel => (window as unknown as FixtureState).values[`${channel}StoryEnabled`], channel), true);
      await page.evaluate(channel => (window as unknown as FixtureState).replaceValues({ [`${channel}PublicationPlacement`]: "story", [`${channel}StoryEnabled`]: false }), channel);
      await page.waitForFunction(channel => !(document.querySelector(`[data-channel-validation-options="${channel}"] input[value="reel"]`) as HTMLInputElement)?.checked, channel);
      await story.uncheck(); assert.equal(await classic.isChecked(), true); assert.equal(await page.evaluate(channel => (window as unknown as FixtureState).values[`${channel}PublicationPlacement`], channel), "classic");
      await page.evaluate(channel => (window as unknown as FixtureState).configure({ [`${channel}PublicationPreferences`]: { reelsEnabled: false, storiesEnabled: false } }), channel);
      await page.waitForFunction(channel => !document.querySelector(`[data-channel-validation-options="${channel}"] input[value="reel"]`), channel);
      assert.equal(await reel.count(), 0); assert.equal(await story.isDisabled(), true);
      await page.evaluate(channel => (window as unknown as FixtureState).replaceValues({ [`${channel}PublicationPlacement`]: "reel" }), channel);
      await reel.waitFor(); assert.equal(await reel.isChecked(), true); assert.equal(await reel.isDisabled(), true, "A previously selected unavailable Reel is not silently converted");
    }
    const pinterest = page.locator('[data-channel-validation-options="pinterest"] select'); await pinterest.selectOption("board-two"); assert.equal(await page.evaluate(() => (window as unknown as FixtureState).values.pinterestBoardId), "board-two");
    await page.evaluate(() => (window as unknown as FixtureState).replaceValues({ pinterestBoardId: "board-one" })); await page.waitForFunction(() => (document.querySelector('[data-channel-validation-options="pinterest"] select') as HTMLSelectElement)?.value === "board-one");
    await page.evaluate(() => (window as unknown as FixtureState).configure({ pinterestBoardsLoading: true })); await page.waitForFunction(() => (document.querySelector('[data-channel-validation-options="pinterest"] select') as HTMLSelectElement)?.disabled); assert.equal(await pinterest.isDisabled(), true);
    await page.evaluate(() => (window as unknown as FixtureState).configure({ pinterestBoardsLoading: false, pinterestBoards: [] })); await page.waitForFunction(() => document.querySelectorAll('[data-channel-validation-options="pinterest"] option').length === 1); assert.equal(await pinterest.isDisabled(), true);
    const threads = page.locator('[data-channel-validation-options="threads"]'), ghost = threads.locator('input[value="ghost"]'), classic = threads.locator('input[value="classic"]'); await ghost.check(); assert.equal(await page.evaluate(() => (window as unknown as FixtureState).values.threadsPublicationMode), "ghost"); assert.equal(await classic.isChecked(), false);
    await page.evaluate(() => (window as unknown as FixtureState).replaceValues({ threadsPublicationMode: "classic" })); await page.waitForFunction(() => (document.querySelector('[data-channel-validation-options="threads"] input[value="classic"]') as HTMLInputElement)?.checked); assert.equal(await ghost.isChecked(), false);
    for (const config of [{ threadsPreferencesLoading: true }, { threadsPreferencesLoading: false, threadsPreferencesFailed: true }, { threadsPreferencesFailed: false, threadsPublicationPreferences: { ghostEnabled: false } }]) {
      await page.evaluate(() => (window as unknown as FixtureState).configure({ threadsPreferencesLoading: false, threadsPreferencesFailed: false, threadsPublicationPreferences: { ghostEnabled: true } }));
      await page.waitForFunction(() => (document.querySelector('[data-channel-validation-options="threads"] input[value="ghost"]') as HTMLInputElement)?.disabled === false);
      await page.evaluate(config => (window as unknown as FixtureState).configure(config), config); await page.waitForFunction(() => (document.querySelector('[data-channel-validation-options="threads"] input[value="ghost"]') as HTMLInputElement)?.disabled);
      assert.equal(await ghost.isDisabled(), true); assert.equal(await classic.isEnabled(), true, "Classic remains available when Ghost is blocked");
      assert.equal(await threads.getByRole('status').count(), 0, "Classic does not display the technical Ghost loading notice");
    }
    await page.evaluate(() => {const state = window as unknown as FixtureState; state.configure({threadsPreferencesLoading: true, threadsPreferencesFailed: false, threadsPublicationPreferences: {ghostEnabled: true}}); state.replaceValues({threadsPublicationMode: 'ghost'});});
    await threads.getByRole('status').waitFor(); assert.equal(await ghost.isChecked(), true); assert.equal(await ghost.isDisabled(), true);
    assert.equal(await threads.getByRole('status').textContent(), (JSON.parse(read('messages/fr-FR/booster.json')) as Record<string, string>).threads_ghost_preferences_loading);
    await classic.check(); await page.waitForFunction(() => !document.querySelector('[data-channel-validation-options="threads"] [role="status"]'));
    await page.evaluate(() => (window as unknown as FixtureState).configure({ disabled: true })); await page.waitForFunction(() => Array.from(document.querySelectorAll('select,input')).every(control => (control as HTMLInputElement).disabled)); for (const control of await page.locator('select,input').all()) assert.equal(await control.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => (window as unknown as FixtureState).requests), []); assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); }
});
