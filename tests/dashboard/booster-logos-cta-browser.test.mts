import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test, { after, before } from "node:test";
import { chromium, webkit, type Browser } from "@playwright/test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../..");
const nativeRequire = createRequire(import.meta.url);
type FixtureWindow = Window & {
  fixtureScope: { actor: string; account: string };
  saved: Record<string, { choice: string; url: string }>;
  ready: boolean; namesKnown: boolean; mobile: boolean; visible: boolean; draw: () => void;
  imagesBefore: Element[];
};
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const selector = "app/dashboard/booster/publier/components/PublishChannelSelector.tsx";
const panel = "app/dashboard/settings/_components/AiChannelCtaPanel.tsx";
const identity = "app/dashboard/booster/publier/components/publishChannelIdentity.ts";
const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
const order = JSON.parse(`[${shared.match(/export const BOOSTER_CHANNEL_ORDER[^=]*=\s*\[([\s\S]*?)\];/)![1]}]`.replace(/,\s*\]/, "]"));
const sharedAst = ts.createSourceFile("publishModal.shared.tsx", shared, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const channelLabels: Record<string, string> = {};
function collectChannelLabels(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(sharedAst) === "CHANNEL_LABELS" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    for (const property of node.initializer.properties) if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) channelLabels[property.name.getText(sharedAst)] = property.initializer.text;
  }
  ts.forEachChild(node, collectChannelLabels);
}
collectChannelLabels(sharedAst);
assert.equal(Object.keys(channelLabels).length, order.length);
const sources: Record<string, string> = {};
const dependencies: Record<string, Record<string, string>> = {};
const cssFiles = new Set<string>();
for (const [name, pkg, file] of [
  ["react", "react", "react.production.js"],
  ["react/jsx-runtime", "react", "react-jsx-runtime.production.js"],
  ["react-dom", "react-dom", "react-dom.production.js"],
  ["react-dom/client", "react-dom", "react-dom-client.production.js"],
  ["scheduler", "scheduler", "scheduler.production.js"],
]) sources[name] = readFileSync(path.join(path.dirname(nativeRequire.resolve(`${pkg}/package.json`)), "cjs", file), "utf8");

function register(file: string): string {
  file = file.replaceAll("\\", "/");
  if (sources[file]) return file;
  const compiled = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  sources[file] = compiled;
  dependencies[file] = {};
  for (const match of compiled.matchAll(/require\("([^"]+)"\)/g)) {
    const name = match[1];
    if (sources[name]) continue;
    if (name === "next-intl" || name === "next/navigation" || name.endsWith("DashboardViewerAccessProvider") || name === "@/lib/browserAccountCache" || name === "@/lib/multicompte/constants") continue;
    if (file === selector && name === "../publishModal.shared") { dependencies[file][name] = "fixture-shared"; continue; }
    if (!name.startsWith(".") && !name.startsWith("@/")) throw Error(`Unexpected fixture package: ${name}`);
    let target = name.startsWith("@/") ? name.slice(2) : path.relative(root, path.resolve(root, path.dirname(file), name));
    if (name.endsWith(".css")) { cssFiles.add(target); dependencies[file][name] = "fixture-css"; continue; }
    if (!/\.(?:ts|tsx)$/.test(target)) target = [".ts", ".tsx"].map(ext => target + ext).find(candidate => existsSync(path.join(root, candidate)))!;
    assert.ok(target, `${file}: ${name}`);
    dependencies[file][name] = register(target);
  }
  return file;
}
register(selector); register(panel); register(identity);
const css = [...cssFiles].map(read).join("\n");
const fixture = `
const sources=${JSON.stringify(sources)},dependencies=${JSON.stringify(dependencies)},cache={},process={env:{NODE_ENV:'production'}};
window.fixtureScope={actor:'actor-a',account:'account-a'};window.saved={};window.ready=false;window.namesKnown=false;window.mobile=false;window.visible=true;
function load(name,from){
 if(name==='next-intl')return {useLocale:()=> 'fr-FR',useTranslations:()=>key=>key};
 if(name==='next/navigation')return {usePathname:()=>location.pathname};
 if(name.endsWith('DashboardViewerAccessProvider'))return {useDashboardViewerAccess:()=>({actorUserId:window.fixtureScope.actor,activeAccountId:window.fixtureScope.account,metaPilotEnabled:true})};
 if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=>window.fixtureScope.account};
 if(name==='@/lib/multicompte/constants')return {ACTIVE_INRCY_ACCOUNT_EVENT:'fixture-account-change'};
 const key=dependencies[from]?.[name]||name;
 if(key==='fixture-css')return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(key==='fixture-shared')return {BOOSTER_CHANNEL_ORDER:${JSON.stringify(order)},getLocalizedChannelLabel:key=>(${JSON.stringify(channelLabels)})[key]};
 if(cache[key])return cache[key].exports;
 if(!sources[key])throw Error('Unknown browser module '+key+' from '+from);
 const m=cache[key]={exports:{}};new Function('require','module','exports','process',sources[key])(name=>load(name,key),m,m.exports,process);return m.exports;
}
const React=load('react'),dom=load('react-dom'),root=load('react-dom/client').createRoot(document.getElementById('root'));
const Selector=load(${JSON.stringify(selector)}).default,Panel=load(${JSON.stringify(panel)}).default;
const all=Object.fromEntries(${JSON.stringify(order)}.map(key=>[key,true]));
function render(){dom.flushSync(()=>root.render(!window.visible?null:location.pathname==='/logo'?React.createElement(Selector,{styles:{},isMobile:window.mobile,connectionsPending:!window.ready,connected:all,channels:all,channelInfoOpen:null,setChannelInfoOpen(){},toggle(){},setAllChannelsSelected(){},getChannelDetailInfo:()=>({href:null,desktopLabel:'',mobileLabel:'',fullLabel:window.ready||window.namesKnown?'Compte de démonstration':''})}):React.createElement(Panel,{value:window.saved,onChange:value=>{window.saved=value;render()}})));}
window.draw=render;window.warm=()=>load(${JSON.stringify(identity)}).prewarmPublishChannelIcons();window.document.documentElement.dataset.fixture='ready';render();
`;
let server: Server, browser: Browser, origin: string;
const iconRequests = new Map<string, number>();
before(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://fixture.local");
    if (url.pathname.startsWith("/icons/")) {
      iconRequests.set(url.pathname, (iconRequests.get(url.pathname) || 0) + 1);
      await new Promise(resolve => setTimeout(resolve, 80));
      response.writeHead(200, { "Content-Type": url.pathname.endsWith(".svg") ? "image/svg+xml" : url.pathname.endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "public, max-age=86400" });
      response.end(readFileSync(path.join(root, "public", url.pathname))); return;
    }
    if (url.pathname === "/api/booster/cta-defaults") {
      const account = request.headers["x-fixture-account"] || "account-a";
      if (account === "account-a") await new Promise(resolve => setTimeout(resolve, 150));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(account === "account-a" ? { siteWebUrl: "https://account-a.example.test", preferredWebsiteUrl: "https://account-a.example.test", phone: "0612345678" } : { phone: "0698765432" })); return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#0c1120;color:#fff;font:15px system-ui;margin:20px}${css}</style></head><body><div id="root"></div><script>const nativeFetch=window.fetch;window.fetch=(url,options)=>nativeFetch(url,{...options,headers:{...options?.headers,'x-fixture-account':window.fixtureScope.account}});</script><script>${fixture.replaceAll("</script", "<\\/script")}</script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });

test("real Booster logos keep their circular geometry before decode, after account loading and at every reopening", { timeout: 60000 }, async t => {
  for (const engine of [chromium, webkit]) {
    const logosBrowser = engine === chromium ? browser : await engine.launch({ headless: true });
    try {
  for (const width of [390, 700, 701, 768, 820, 1024, 1280]) {
    const mobile = width <= 768;
    const context = await logosBrowser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage(); const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/logo`, { waitUntil: "domcontentloaded" });
    assert.deepEqual(errors, [], "Logo browser module must mount without runtime errors");
    await page.waitForSelector("img");
    // Exercise the parent modal's initial desktop state on a mobile viewport, too.
    const geometry = async () => page.locator("#root img").evaluateAll(images => images.map(image => {
      const img = image as HTMLImageElement, style = getComputedStyle(img);
      return { radius: parseFloat(style.borderRadius), width: parseFloat(style.width), height: parseFloat(style.height), fit: style.objectFit, loading: img.loading, decoding: img.decoding };
    }));
    const boxes = async () => page.locator('.channelCard').evaluateAll(cards => cards.map(card => {
      const image = card.querySelector('img')!.getBoundingClientRect(), bounds = card.getBoundingClientRect();
      return [bounds.x, bounds.y, bounds.width, bounds.height, image.x, image.y, image.width, image.height];
    }));
    const assertStable = (before: number[][], after: number[][]) => {
      assert.equal(after.length, before.length);
      for (let card = 0; card < before.length; card++) for (let field = 0; field < before[card].length; field++) {
        assert.ok(Math.abs(before[card][field] - after[card][field]) <= 1, `Channel ${card}, geometry ${field} moved: ${before[card][field]} → ${after[card][field]}`);
      }
    };
    for (const value of await geometry()) {
      assert(value.radius >= value.width / 2); assert.equal(value.width, mobile ? 24 : 43); assert.equal(value.height, value.width);
      assert.equal(value.loading, "eager"); assert.equal(value.decoding, "sync");
    }
    await page.locator("#root img").evaluateAll(images => Promise.all(images.map(img => (img as HTMLImageElement).decode())));
    const initialCount = await page.locator("#root img").count(); assert.equal(initialCount, order.length);
    const pendingBoxes = await boxes();
    assert.equal(await page.locator('.bulkControl input').isDisabled(), true);
    assert.equal(await page.locator('.channelCard[role="button"]').count(), 0, "Unknown connection cards cannot be activated");
    assert.equal(await page.locator('.desktopConnection[data-connected="true"]').count(), 0, "Pending display must not invent a confirmed connection");
    await page.evaluate(() => { const w = window as unknown as FixtureWindow; w.imagesBefore = [...document.querySelectorAll('#root img')]; w.ready = true; w.namesKnown=true; w.draw(); });
    const sameImages = await page.evaluate(() => { const w = window as unknown as FixtureWindow; return [...document.querySelectorAll('#root img')].every((image, index) => image === w.imagesBefore[index]); });
    assert.equal(sameImages, true, "Decoded logos must survive pending → ready without DOM replacement");
    assertStable(pendingBoxes, await boxes());
    for (let opening = 0; opening < 3; opening++) {
      await page.evaluate((isMobile) => { const w = window as unknown as FixtureWindow; w.visible=false;w.draw();w.mobile=isMobile;w.ready=false;w.visible=true;w.draw(); }, mobile);
      const reopeningBoxes = await boxes();
      assert.equal(await page.locator('.bulkControl input').isDisabled(), true);
      await page.evaluate(() => { const w=window as unknown as FixtureWindow;w.ready=true;w.draw(); });
      await page.locator("#root img").evaluateAll(images => Promise.all(images.map(img => (img as HTMLImageElement).decode())));
      for (const value of await geometry()) { assert(value.radius >= value.width / 2); assert.equal(value.width, mobile ? 24 : 43); }
      assertStable(reopeningBoxes, await boxes());
      assert.equal(await page.locator('.bulkControl input').isEnabled(), true);
    }
    assert.equal(await page.locator("#root img").evaluateAll(images => images.every(img => (img as HTMLImageElement).naturalWidth > 0)), true);
    assert.deepEqual(errors, []); await context.close();
  }
      t.diagnostic(`${engine.name()}: cold opening and three reopenings verified at 390, 700, 701, 768, 820, 1024 and 1280 px`);
    } finally { if (logosBrowser !== browser) await logosBrowser.close(); }
  }
});

test("real CTA settings offer added actions on every compatible channel and preserve an explicit no-CTA after reload", { timeout: 60000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors: string[] = [];page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/cta`);
  assert.deepEqual(errors, [], "CTA browser module must mount without runtime errors");
  await page.getByText("Par défaut", { exact: true }).waitFor({ timeout: 4000 }).catch(async error => { throw new Error(`${error.message}\n${await page.locator('body').innerText()}\n${JSON.stringify(errors)}`); });
  for (const label of ["Site web", "Google Business", "Facebook", "Instagram", "Threads", "LinkedIn", "X", "TikTok", "YouTube", "Pinterest"]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    const menu = page.getByRole("button", { name: "Action à proposer", exact: true });
    assert.match(await menu.innerText(), /Voir le site/);
    await menu.click();
    for (const name of ["Réserver", "Commander", "Acheter", "S’inscrire", "Écrire sur WhatsApp", "Lien personnalisé"]) assert.equal(await page.getByRole("option").filter({ hasText: name }).count(), 1, `${label}/${name}`);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("tab", { name: "Instagram", exact: true }).click();
  await page.getByRole("button", { name: "Action à proposer", exact: true }).click();
  await page.getByRole("option").filter({ hasText: /^.*Aucun CTA/ }).click();
  const saved = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as FixtureWindow).saved)));
  assert.equal(saved.instagram.choice, "none");
  await page.evaluate((value) => { const w=window as unknown as FixtureWindow;w.saved=JSON.parse(JSON.stringify(value));w.visible=false;w.draw();w.visible=true;w.draw(); }, saved);
  await page.getByRole("tab", { name: "Instagram", exact: true }).click();
  assert.match(await page.getByRole("button", { name: "Action à proposer", exact: true }).innerText(), /Aucun CTA/);
  await page.getByRole("tab", { name: "Google Business", exact: true }).click();
  await page.getByRole("button", { name: "Action à proposer", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "Réserver" }).click();
  await page.getByLabel("Lien de l’action · à renseigner").fill("https://booking.example.test/reserver");
  assert.equal((await page.evaluate(() => (window as unknown as FixtureWindow).saved)).gmb.choice, "reserver");
  assert.equal((await page.evaluate(() => (window as unknown as FixtureWindow).saved)).gmb.url, "https://booking.example.test/reserver");
  assert.deepEqual(errors, []);await page.close();
});

test("CTA defaults ignore an old account response after switching accounts", { timeout: 30000 }, async () => {
  const page = await browser.newPage();
  const errors: string[] = [];page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/cta`, { waitUntil: "domcontentloaded" });
  assert.deepEqual(errors, []);
  await page.waitForSelector('[data-ai-section="channel-ctas"]', { timeout: 4000 });
  await page.evaluate(() => { const w=window as unknown as FixtureWindow;w.fixtureScope.account='account-b';window.dispatchEvent(new Event('fixture-account-change'));w.draw(); });
  await page.getByRole("button", { name: "Action à proposer", exact: true }).filter({ hasText: "Appeler" }).waitFor();
  await page.waitForFunction(() => document.body.textContent?.includes('0698765432'));
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)));
  assert.equal((await page.locator("body").innerText()).includes("account-a.example.test"), false);
  assert.match(await page.getByRole("button", { name: "Action à proposer", exact: true }).innerText(), /Appeler/);
  await page.close();
});
