import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const transpile = (source: string, jsx = false) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: jsx ? ts.JsxEmit.ReactJSX : undefined, esModuleInterop: true } }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const modal = ts.createSourceFile("PublishModal.tsx", read("app/dashboard/booster/publier/PublishModal.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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

test("Contents and Validation bind the same four controlled channel states and real parent callbacks preserve touched preferences", () => {
  const bindings = new Map<string, Map<string, string>>();
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ["PublishContentEditorPanel", "PublishValidationChannelOptions"].includes(node.tagName.getText(modal))) {
      bindings.set(node.tagName.getText(modal), new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(modal), attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression?.getText(modal) || "" : ""])));
    }
    ts.forEachChild(node, visit);
  }
  visit(modal); assert.equal(bindings.size, 2);
  for (const prop of ["pinterestBoards", "pinterestBoardId", "pinterestBoardsLoading", "pinterestBoardsError", "onPinterestBoardChange", "threadsPublicationMode", "threadsPublicationPreferences", "threadsPreferencesLoading", "threadsPreferencesFailed", "onThreadsPublicationModeChange", "facebookPublicationPlacement", "facebookStoryEnabled", "facebookPublicationPreferences", "onFacebookPublicationPlacementChange", "onFacebookStoryEnabledChange", "instagramPublicationPlacement", "instagramStoryEnabled", "instagramPublicationPreferences", "onInstagramPublicationPlacementChange", "onInstagramStoryEnabledChange"]) {
    const value = bindings.get("PublishContentEditorPanel")!.get(prop);
    assert.ok(value, `Contents must expose ${prop}`); assert.equal(bindings.get("PublishValidationChannelOptions")!.get(prop), value, `${prop} must share a single parent binding in both directions`);
  }
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
  callback("onPinterestBoardChange", { pinterestBoards: [{ id: "board-one", name: "Vitrine" }, { id: "board-two", name: "Projets" }], setPinterestBoardId: (value: string) => { board.id = value; }, setPinterestBoardName: (value: string) => { board.name = value; }, setPinterestBoardsError: (value: string) => { board.error = value; } })(" board-two ");
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
      const row = page.locator(`[data-channel-validation-options="${channel}"]`), select = row.getByRole("combobox"), story = row.getByRole("checkbox");
      await page.evaluate(channel => (window as unknown as FixtureState).replaceValues({ [`${channel}PublicationPlacement`]: "reel", [`${channel}StoryEnabled`]: true }), channel);
      await page.waitForFunction(channel => (document.querySelector(`[data-channel-validation-options="${channel}"] select`) as HTMLSelectElement)?.value === "reel", channel); assert.equal(await story.isChecked(), true);
      await select.selectOption("story"); assert.equal(await story.count(), 0); assert.equal(await page.evaluate(channel => (window as unknown as FixtureState).values[`${channel}StoryEnabled`], channel), false);
      await select.selectOption("classic"); assert.equal(await story.isChecked(), false); await story.check(); assert.equal(await page.evaluate(channel => (window as unknown as FixtureState).values[`${channel}StoryEnabled`], channel), true);
      await page.evaluate(channel => (window as unknown as FixtureState).configure({ [`${channel}PublicationPreferences`]: { reelsEnabled: false, storiesEnabled: false } }), channel);
      await page.waitForFunction(channel => !document.querySelector(`[data-channel-validation-options="${channel}"] option[value="reel"]`), channel);
      assert.equal(await select.locator('option[value="reel"]').count(), 0); assert.equal(await select.locator('option[value="story"]').count(), 0); assert.equal(await story.isDisabled(), true);
    }
    const pinterest = page.locator('[data-channel-validation-options="pinterest"] select'); await pinterest.selectOption("board-two"); assert.equal(await page.evaluate(() => (window as unknown as FixtureState).values.pinterestBoardId), "board-two");
    await page.evaluate(() => (window as unknown as FixtureState).replaceValues({ pinterestBoardId: "board-one" })); await page.waitForFunction(() => (document.querySelector('[data-channel-validation-options="pinterest"] select') as HTMLSelectElement)?.value === "board-one");
    await page.evaluate(() => (window as unknown as FixtureState).configure({ pinterestBoardsLoading: true })); await page.waitForFunction(() => (document.querySelector('[data-channel-validation-options="pinterest"] select') as HTMLSelectElement)?.disabled); assert.equal(await pinterest.isDisabled(), true);
    await page.evaluate(() => (window as unknown as FixtureState).configure({ pinterestBoardsLoading: false, pinterestBoards: [] })); await page.waitForFunction(() => document.querySelectorAll('[data-channel-validation-options="pinterest"] option').length === 1); assert.equal(await pinterest.isDisabled(), true);
    const threads = page.locator('[data-channel-validation-options="threads"] select'); await threads.selectOption("ghost"); assert.equal(await page.evaluate(() => (window as unknown as FixtureState).values.threadsPublicationMode), "ghost");
    await page.evaluate(() => (window as unknown as FixtureState).replaceValues({ threadsPublicationMode: "classic" })); await page.waitForFunction(() => (document.querySelector('[data-channel-validation-options="threads"] select') as HTMLSelectElement)?.value === "classic");
    for (const config of [{ threadsPreferencesLoading: true }, { threadsPreferencesLoading: false, threadsPreferencesFailed: true }, { threadsPreferencesFailed: false, threadsPublicationPreferences: { ghostEnabled: false } }]) {
      await page.evaluate(() => (window as unknown as FixtureState).configure({ threadsPreferencesLoading: false, threadsPreferencesFailed: false, threadsPublicationPreferences: { ghostEnabled: true } }));
      await page.waitForFunction(() => (document.querySelector('[data-channel-validation-options="threads"] option[value="ghost"]') as HTMLOptionElement)?.disabled === false);
      await page.evaluate(config => (window as unknown as FixtureState).configure(config), config); await page.waitForFunction(() => (document.querySelector('[data-channel-validation-options="threads"] option[value="ghost"]') as HTMLOptionElement)?.disabled); assert.equal(await threads.locator('option[value="ghost"]').isDisabled(), true);
    }
    await page.evaluate(() => (window as unknown as FixtureState).configure({ disabled: true })); await page.waitForFunction(() => Array.from(document.querySelectorAll('select')).every(select => select.disabled)); for (const select of await page.getByRole("combobox").all()) assert.equal(await select.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => (window as unknown as FixtureState).requests), []); assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); }
});
