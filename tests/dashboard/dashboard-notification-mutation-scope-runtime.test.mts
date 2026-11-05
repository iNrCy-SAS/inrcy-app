import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources = {
  react: packageSource("react", "react.development.js"), "react-dom": packageSource("react-dom", "react-dom.development.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"), scheduler: packageSource("scheduler", "scheduler.development.js"),
  hook: ts.transpileModule(readFileSync(new URL("../../app/dashboard/_hooks/useDashboardNotifications.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
};

// Execute the production hook with real React commits. Only the cache, viewer
// context and HTTP transport are isolated; no real account/API is contacted.
async function mount(page: Page) {
  await page.route("**/*", route => route.request().url() === "https://notifications.invalid/" ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
  await page.goto("https://notifications.invalid/");
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},cache={},process={env:{NODE_ENV:'development'}};
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    window.scope={actorUserId:'actorA',activeAccountId:'A'};window.browserAccount='A';window.writes=[];window.requests=[];
    window.feed={items:[{id:'one',unread:true},{id:'two',unread:true}],totalCount:7};
    window.cacheValue=JSON.stringify(window.feed);window.deferGet=false;
    window.fetch=async(url,options={})=>{window.requests.push({url,method:options.method||'GET'});
      if((options.method||'GET')==='GET'){
        const snapshot=JSON.parse(JSON.stringify(window.feed));
        if(window.deferGet)await new Promise(resolve=>window.releaseGet=resolve);
        return{ok:true,json:async()=>snapshot};
      }
      return new Promise(resolve=>window.releaseMutation=(ok=true)=>resolve({ok,status:ok?200:500,json:async()=>({})}));
    };
    function load(name){
      if(name==='@/lib/browserAccountCache')return{getActiveBrowserUserId:()=>window.browserAccount,readAccountCacheValue:()=>window.cacheValue,writeAccountCacheValue:(key,value)=>window.writes.push({account:window.browserAccount,key,value:JSON.parse(value)})};
      if(name.endsWith('DashboardViewerAccessProvider'))return{useDashboardViewerAccess:()=>window.scope};
      if(name==='@/lib/multicompte/constants')return{ACTIVE_INRCY_ACCOUNT_EVENT:'active-account'};
      if(name==='@/lib/userFacingErrors')return{getSimpleFrenchApiError:async()=> 'Erreur native',getSimpleFrenchErrorMessage:(_,fallback)=>fallback};
      if(cache[name])return cache[name].exports;if(!sources[name])throw Error('Unexpected import '+name);
      const mod=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(load,mod,mod.exports,process);return mod.exports;
    }
    const React=load('react'),useNotifications=load('hook').useDashboardNotifications;
    function App(){const[tick,setTick]=React.useState(0);const api=useNotifications();
      React.useLayoutEffect(()=>{window.api=api;window.state={items:api.notifications,count:api.notificationsCount,error:api.notificationsError,loading:api.notificationsLoading,tick};window.setScope=(actor,account)=>{window.scope={actorUserId:actor,activeAccountId:account};window.browserAccount=account;setTick(n=>n+1)};});
      return React.createElement('output',null,JSON.stringify(window.state));
    }
    const root=load('react-dom/client').createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();root.render(React.createElement(App));
  ` });
  page.setDefaultTimeout(5000);
  await page.waitForFunction("!!window.api");
}
const settled = (page: Page) => page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");

test("Native notification mark-one and mark-all ignore delayed success and failure after actor, account or mount scope changes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const operation of ["markNotificationRead('one')", "markAllNotificationsRead()"])
      for (const change of ["actor", "account", "unmount"])
        for (const success of [true, false]) {
          const page = await browser.newPage(); await mount(page);
          await page.evaluate(`void(window.pending=window.api.${operation})`); await page.waitForFunction("!!window.releaseMutation");
          if (change === "unmount") await page.evaluate("window.unmount()");
          else {
            await page.evaluate(change === "actor" ? "window.setScope('actorB','A')" : "window.setScope('actorA','B')");
            await page.waitForFunction("window.state.tick===1");
            await page.evaluate("window.feed={items:[{id:'new-scope',unread:true}],totalCount:11};window.api.refreshNotifications()");
            await page.waitForFunction("window.state.count===11");
          }
          const before = await page.evaluate("({state:window.state,writes:window.writes.length,requests:window.requests.length})");
          await page.evaluate(`window.releaseMutation(${success});window.pending`); await settled(page);
          assert.deepEqual(await page.evaluate("({state:window.state,writes:window.writes.length,requests:window.requests.length})"), before, `${operation}/${change}/${success}`);
          await page.close();
        }
  } finally { await browser.close(); }
});

test("Native notification mutations preserve a concurrently refreshed feed and re-read the authoritative count instead of decrementing twice", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const operation of ["markNotificationRead('one')", "markAllNotificationsRead()"] ) {
      const page = await browser.newPage(); await mount(page);
      await page.evaluate(`void(window.pending=window.api.${operation})`); await page.waitForFunction("!!window.releaseMutation");
      await page.evaluate("window.feed={items:[{id:'new-notice',unread:true}],totalCount:4};window.api.refreshNotifications()");
      await page.waitForFunction("window.state.count===4");
      const writes = await page.evaluate("window.writes.length");
      await page.evaluate("window.feed={items:[{id:'new-notice',unread:true}],totalCount:4};window.releaseMutation(true);window.pending"); await settled(page);
      assert.deepEqual(await page.evaluate("[window.state.items.map(item=>item.id),window.state.count,window.state.loading,window.state.error]"), [["new-notice"], 4, false, null]);
      assert.deepEqual(await page.evaluate(`window.writes.slice(${writes}).map(row=>row.value.totalCount)`), [4], "no stale clear or second subtraction before readback");
      await page.close();
    }
    const page = await browser.newPage(); await mount(page);
    await page.evaluate("window.deferGet=true;void(window.oldRead=window.api.refreshNotifications())"); await page.waitForFunction("!!window.releaseGet");
    await page.evaluate("void(window.pending=window.api.markNotificationRead('one'))"); await page.waitForFunction("!!window.releaseMutation");
    await page.evaluate("window.releaseGet();window.oldRead"); await settled(page);
    assert.equal(await page.evaluate("window.writes.length"), 0, "a GET begun before the mutation cannot restore an old unread count");
    await page.evaluate("window.deferGet=false;window.feed={items:[{id:'two',unread:true}],totalCount:6};window.releaseMutation(true);window.pending"); await settled(page);
    assert.deepEqual(await page.evaluate("[window.state.items.map(item=>item.id),window.state.count,window.state.loading]"), [["two"], 6, false]);
  } finally { await browser.close(); }
});

test("Native notification delete never restores another scope or a newer feed when its optimistic request fails", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const change of ["actor", "account", "refresh", "none"]) {
      const page = await browser.newPage(); await mount(page);
      await page.evaluate("void(window.pending=window.api.deleteNotification('one'))"); await page.waitForFunction("!!window.releaseMutation"); await settled(page);
      assert.equal(await page.evaluate("window.state.count"), 6);
      if (change === "actor" || change === "account") {
        await page.evaluate(change === "actor" ? "window.setScope('actorB','A')" : "window.setScope('actorA','B')"); await page.waitForFunction("window.state.tick===1");
      }
      if (change !== "none") {
        await page.evaluate("window.feed={items:[{id:'current',unread:true}],totalCount:12};window.api.refreshNotifications()"); await page.waitForFunction("window.state.count===12");
      }
      await page.evaluate("window.releaseMutation(false);window.pending"); await settled(page);
      assert.deepEqual(await page.evaluate("[window.state.items.map(item=>item.id),window.state.count]"), change === "none" ? [["one", "two"], 7] : [["current"], 12]);
      await page.close();
    }
  } finally { await browser.close(); }
});
