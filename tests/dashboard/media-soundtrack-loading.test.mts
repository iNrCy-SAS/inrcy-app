import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const track = { id: "jazz-velours", label: "Jazz velours", description: "Piano, basse et batterie", durationSeconds: 24,
  audioPreview: "/api/booster/soundtracks/jazz-velours/preview?v=24" };
type FixtureState = {
  catalogueRequests: Array<{ scope: string; aborted: boolean }>;
  otherRequests: string[];
  configure: (patch: Record<string, unknown>) => void;
  replyLatest: () => void;
  replyHangingBody: () => void;
  autoReply: boolean;
  choices: Array<string | null>;
};

async function setup(page: Page, config: { inline?: boolean; soundtrackId?: string | null; fastTimeout?: boolean } = {}) {
  const sources = {
    react: packageSource("react", "react.development.js"),
    "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
    "react-dom": packageSource("react-dom", "react-dom.development.js"),
    "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
    scheduler: packageSource("scheduler", "scheduler.development.js"),
    selector: compile("app/dashboard/_components/MediaSoundtrackSelector.tsx"),
    "@/lib/mediaSoundtrackSelection": compile("lib/mediaSoundtrackSelection.ts"),
  };
  await page.route("**/*", route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},cache={},process={env:{NODE_ENV:'development'}};
    function require(name){
      if(name.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
      if(name==='next-intl')return{useTranslations:()=>key=>key};
      if(cache[name])return cache[name].exports;
      if(!sources[name])throw Error('Unexpected development fixture import '+name);
      const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;
    }
    const React=require('react'),Selector=require('selector').default,root=require('react-dom/client').createRoot(document.getElementById('root'));
    window.catalogueRequests=[];window.otherRequests=[];window.choices=[];window.autoReply=false;window.config={inline:true,scopeKey:'first',soundtrackId:'jazz-velours',onChange:id=>window.choices.push(id),...${JSON.stringify(config)}};
    const originalSetTimeout=window.setTimeout;
    if(window.config.fastTimeout)window.setTimeout=(callback,delay,...args)=>originalSetTimeout(callback,delay>=1000?150:delay,...args);
    HTMLMediaElement.prototype.play=()=>Promise.resolve();HTMLMediaElement.prototype.pause=()=>{};HTMLMediaElement.prototype.load=()=>{};
    window.fetch=(url,options)=>{
      if(url!=='/api/booster/soundtracks'){window.otherRequests.push(url);throw Error('Only a synthetic catalogue request is permitted')}
      return new Promise((resolve,reject)=>{
        const entry={scope:window.config.scopeKey,aborted:false,signal:options.signal,resolve:value=>resolve(Response.json(value)),resolveHangingBody:()=>resolve({ok:true,json:()=>new Promise(()=>{})}),reject};
        window.catalogueRequests.push(entry);
        options.signal.addEventListener('abort',()=>{entry.aborted=true;reject(new DOMException('Fixture cancelled','AbortError'))},{once:true});
        if(window.autoReply)entry.resolve({ok:true,soundtracks:[${JSON.stringify(track)}]});
      });
    };
    window.configure=patch=>{window.config={...window.config,...patch};root.render(React.createElement(React.StrictMode,null,React.createElement(Selector,window.config)))};
    window.replyLatest=()=>window.catalogueRequests.at(-1).resolve({ok:true,soundtracks:[${JSON.stringify(track)}]});
    window.replyHangingBody=()=>window.catalogueRequests.at(-1).resolveHangingBody();
    window.configure({});
  ` });
  page.setDefaultTimeout(3_000);
}

test("React development StrictMode cancels its first catalogue load and completes the replayed request", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const config of [{ inline: true }, { inline: false, soundtrackId: "jazz-velours" }]) {
      const page = await browser.newPage();
      await setup(page, config);
      await page.waitForFunction(() => (window as unknown as FixtureState).catalogueRequests.length >= 2);
      assert.equal(await page.evaluate(() => (window as unknown as FixtureState).catalogueRequests[0].aborted), true);
      await page.evaluate(() => (window as unknown as FixtureState).replyLatest());
      if (config.inline) await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.getAttribute("aria-busy") === "false");
      else await page.getByRole("button", { name: /publication_music_title/ }).click();
      assert.equal(await page.getByRole("option", { name: "Jazz velours" }).count(), config.inline ? 0 : 1);
      assert.equal(await page.getByText("publication_music_loading", { exact: true }).count(), 0);
      assert.deepEqual(await page.evaluate(() => (window as unknown as FixtureState).otherRequests), []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("a scope change during loading cancels the old request and loads the new channel in development", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page);
    await page.waitForFunction(() => (window as unknown as FixtureState).catalogueRequests.length >= 2);
    await page.evaluate(() => (window as unknown as FixtureState).configure({ scopeKey: "second" }));
    await page.waitForFunction(() => (window as unknown as FixtureState).catalogueRequests.at(-1)?.scope === "second");
    await page.evaluate(() => (window as unknown as FixtureState).replyLatest());
    await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.getAttribute("aria-busy") === "false");
    assert.match(await page.getByRole("combobox").innerText(), /Jazz velours/);
    assert.deepEqual(await page.evaluate(() => (window as unknown as FixtureState).otherRequests), []);
  } finally { await browser.close(); }
});

test("a catalogue request that never replies cannot leave the selector loading forever", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, { inline: false, soundtrackId: null, fastTimeout: true });
    await page.getByRole("button", { name: /publication_music_title/ }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByText("publication_music_loading", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("option", { name: "publication_music_auto", exact: false }).count(), 1);
    assert.deepEqual(await page.evaluate(() => (window as unknown as FixtureState).choices), [], "A failed catalogue never changes a saved/default selection");
    await page.getByRole("option", { name: "publication_music_auto", exact: false }).click();
    assert.deepEqual(await page.evaluate(() => (window as unknown as FixtureState).choices), [null], "Auto remains usable after failure");
    await page.evaluate(() => { (window as unknown as FixtureState).autoReply = true; });
    await page.locator("[data-soundtrack-retry]").click();
    await page.getByRole("option", { name: "Jazz velours" }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0, "Retry completes without closing or remounting the modal");
    assert.deepEqual(await page.evaluate(() => (window as unknown as FixtureState).otherRequests), []);
  } finally { await browser.close(); }
});

test("the same deadline covers a response whose JSON body never finishes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, { inline: false, soundtrackId: null, fastTimeout: true });
    await page.getByRole("button", { name: /publication_music_title/ }).click();
    await page.waitForFunction(() => (window as unknown as FixtureState).catalogueRequests.length === 1);
    await page.evaluate(() => (window as unknown as FixtureState).replyHangingBody());
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByText("publication_music_loading", { exact: true }).count(), 0);
    assert.deepEqual(await page.evaluate(() => (window as unknown as FixtureState).choices), []);
    await page.evaluate(() => { (window as unknown as FixtureState).autoReply = true; });
    await page.locator("[data-soundtrack-retry]").click();
    await page.getByRole("option", { name: "Jazz velours" }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.deepEqual(await page.evaluate(() => (window as unknown as FixtureState).otherRequests), []);
  } finally { await browser.close(); }
});
