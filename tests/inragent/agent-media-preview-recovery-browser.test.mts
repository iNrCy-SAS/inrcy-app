import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources = {
  react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"),
  image: compile("app/dashboard/agent/_components/AgentMediaImage.tsx"),
  recovery: compile("app/dashboard/agent/_lib/agent.media-preview-recovery.ts"),
  "./agent.publish-preview": compile("app/dashboard/agent/_lib/agent.publish-preview.ts"),
  "./agent.utils": compile("app/dashboard/agent/_lib/agent.utils.ts"),
};
const expired = "/api/storage/content?bucket=inrcy-pro-media&path=account-a%2Fold.png&token=fixture";
const fresh = "/api/media-library/items/10000000-0000-4000-8000-000000000001/content?token=fixture-fresh";
const png = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="blue"/></svg>';
const action = (url = fresh, id = "media-a") => ({ id: "action-a", imageAssets: [], payload: { publishPayload: { imagesByChannel: { facebook: [{ id, url, mimeType: "image/png" }] } } } });
type FixtureWindow = Window & { activeAccount: string; renderMedia(value: { src?: string; sourceKey?: string; record?: Record<string, unknown>; compact?: boolean; duplicate?: boolean }): void; changeAccount(account: string): void; recoverForTest(args: Record<string, unknown>): Promise<string | null> };

const fixture = `
const sources=${JSON.stringify(sources)},loaded={},messages=${JSON.stringify(JSON.parse(read("messages/fr-FR/media.json")))};
window.activeAccount='account-a';const noOp=()=>{};
function require(name){
 if(name==='next-intl')return {useTranslations:()=>key=>messages[key]||key};
 if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=>window.activeAccount};
 if(name==='@/lib/multicompte/constants')return {ACTIVE_INRCY_ACCOUNT_EVENT:'fixture-account-change'};
 if(name==='@/lib/inrAgentThreadsPublication')return {readInrAgentThreadsPublicationSettings:()=>({mode:'standard'})};
 if(name==='./agent.config')return {channelPayloadKeys:{facebook:['facebook'],instagram:['instagram']}};
 if(name==='./agent.settings')return {recordValueForUiChannel:(record,channel)=>record[channel],boosterChannelKeyFromAgentChannel:value=>value,normalizeAgentCtaMode:value=>value};
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(loaded[name])return loaded[name].exports;
 if(!sources[name])throw Error('Unexpected image fixture dependency '+name);
 const record=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,record,record.exports);return record.exports;
}
const React=require('react'),Image=require('image').default,recover=require('recovery').recoverAgentMediaPreviewUrl;
window.recoverForTest=args=>recover({...args,signal:new AbortController().signal});
function Fixture(){
 const [state,setState]=React.useState({src:${JSON.stringify(expired)},sourceKey:'action-a:facebook:0',record:{id:'media-a'},compact:false,duplicate:false});
 const [text,setText]=React.useState('Texte local non enregistré');
 window.renderMedia=patch=>setState(current=>({...current,...patch}));
 window.changeAccount=account=>{window.activeAccount=account;window.dispatchEvent(new Event('fixture-account-change'))};
 const props={src:state.src,accountId:'account-a',sourceKey:state.sourceKey,alt:'Photo de démonstration',compact:state.compact,
  recoverUrl:signal=>recover({accountId:'account-a',actionId:'action-a',channel:'facebook',record:state.record,signal})};
 return React.createElement(React.Fragment,null,React.createElement('textarea',{value:text,onChange:event=>setText(event.target.value),'aria-label':'Texte de publication'}),
  React.createElement('div',{'data-preview':true},state.compact?React.createElement('button',{'aria-label':'Afficher le média'},React.createElement(Image,props)):React.createElement(Image,props)),
  state.duplicate?React.createElement('div',{'data-other-preview':true},React.createElement(Image,{...props,sourceKey:'modal'})):null);
}
require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

async function setup(page: Page, options: { payload?: unknown; image: (url: URL, count: number) => number; deferMetadata?: boolean } ) {
  const requests: Array<{ url: string; method: string }> = [], errors: string[] = [];
  let metadataRelease: (() => void) | undefined;
  const metadataGate = options.deferMetadata ? new Promise<void>(resolve => { metadataRelease = resolve; }) : Promise.resolve();
  page.setDefaultTimeout(4000); page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.resourceType() === "document") return route.fulfill({ contentType: "text/html", body: `<html><head><style>${read("app/dashboard/agent/_components/AgentMediaImage.module.css")}</style></head><body><div id="root"></div></body></html>` });
    requests.push({ url: request.url(), method: request.method() });
    if (url.pathname === "/api/agent/actions") {
      await metadataGate;
      await page.waitForTimeout(30);
      return route.fulfill({ json: options.payload || { actions: [action()] } });
    }
    const count = requests.filter(entry => new URL(entry.url).pathname !== "/api/agent/actions").length;
    const status = options.image(url, count);
    return route.fulfill({ status, contentType: status === 200 ? "image/svg+xml" : "text/plain", body: status === 200 ? png : "Unavailable", headers: { "cache-control": "no-store" } });
  });
  await page.goto("https://fixture.invalid/dashboard/agent/publications");
  await page.addScriptTag({ content: fixture });
  await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).renderMedia));
  return { requests, errors, release: () => metadataRelease?.() };
}
async function loaded(page: Page, selector = '[data-preview] img') {
  await page.waitForFunction(selector => { const image = document.querySelector<HTMLImageElement>(selector); return image?.complete && image.naturalWidth === 24; }, selector);
}

test("a failed cached URL recovers the same nested channel media without replacing unsaved publication text", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const { requests, errors } = await setup(page, { image: url => url.pathname.startsWith('/api/media-library/items/') ? 200 : 404 });
    await page.getByRole('textbox').fill('Mon texte en cours de saisie reste intact');
    await loaded(page);
    assert.equal(await page.getByRole('textbox').inputValue(), 'Mon texte en cours de saisie reste intact');
    const source = new URL(await page.locator('[data-preview] img').getAttribute('src') || '', 'https://fixture.invalid');
    assert.equal(source.pathname, new URL(fresh, source).pathname);
    assert.equal(source.searchParams.get('token'), 'fixture-fresh'); assert.ok(source.searchParams.get('previewRetry'));
    assert.equal(requests.filter(request => new URL(request.url).pathname === '/api/agent/actions').length, 1);
    assert.equal(requests.filter(request => new URL(request.url).pathname !== '/api/agent/actions').length, 2);
    assert.ok(requests.every(request => request.method === 'GET')); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("a missing media stops after one automatic retry, stays explicit and retries only on user request", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); let available = false;
    const { requests, errors } = await setup(page, { payload: { actions: [action(fresh, 'different-media')] }, image: () => available ? 200 : 404 });
    await page.getByText('Aperçu indisponible', { exact: true }).waitFor();
    await page.waitForTimeout(150);
    assert.equal(requests.filter(request => new URL(request.url).pathname !== '/api/agent/actions').length, 2, 'No background retry loop');
    assert.equal(await page.locator('[data-preview] img').count(), 0, 'No broken-image icon remains');
    assert.ok(requests.every(request => !request.url.includes('/api/media-library/')), 'An unrelated media must never replace the missing one');
    available = true; await page.getByRole('button', { name: 'Réessayer', exact: true }).click(); await loaded(page);
    assert.equal(requests.filter(request => new URL(request.url).pathname !== '/api/agent/actions').length, 3);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("unmatched external failures are not requested again and a thumbnail fallback never nests interactive controls", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const { requests, errors } = await setup(page, { image: () => 404 });
    await page.getByText('Aperçu indisponible', { exact: true }).waitFor();
    requests.length = 0;
    await page.evaluate(() => (window as unknown as FixtureWindow).renderMedia({ src: 'https://external.invalid/deleted.jpg', record: { id: 'unknown-media' }, compact: true }));
    await page.locator('[data-preview] .compact[title]').waitFor();
    assert.equal(requests.filter(request => new URL(request.url).hostname === 'external.invalid').length, 1);
    assert.equal(requests.filter(request => new URL(request.url).pathname === '/api/agent/actions').length, 1, 'Only the native metadata read may resolve a cached external URL');
    assert.equal(await page.locator('[data-preview] button button').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Afficher le média' }).count(), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("an expired signed storage URL cached externally recovers only through the same media's fresh native URL", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const { requests, errors } = await setup(page, { image: url => url.pathname.startsWith('/api/media-library/items/') ? 200 : 403 });
    await loaded(page); requests.length = 0;
    await page.evaluate(() => (window as unknown as FixtureWindow).renderMedia({ src: 'https://storage.invalid/storage/v1/object/sign/old.png?token=expired-fixture' }));
    await loaded(page);
    assert.equal(requests.filter(request => new URL(request.url).hostname === 'storage.invalid').length, 1);
    assert.equal(requests.filter(request => new URL(request.url).pathname === '/api/agent/actions').length, 1);
    assert.equal(requests.filter(request => new URL(request.url).pathname.startsWith('/api/media-library/items/')).length, 1);
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("a response arriving after switching account cannot retry or restore the previous account image", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const context = await setup(page, { deferMetadata: true, image: () => 404 });
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes('Chargement'));
    await page.evaluate(() => (window as unknown as FixtureWindow).changeAccount('account-b'));
    context.release(); await page.waitForTimeout(120);
    assert.equal(await page.locator('[data-preview] img').count(), 0);
    assert.equal(context.requests.filter(request => new URL(request.url).pathname !== '/api/agent/actions').length, 1);
    assert.deepEqual(context.errors, []);
  } finally { await browser.close(); }
});

test("late recovery is ignored after selecting another media, and simultaneous previews share the read", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const context = await setup(page, { deferMetadata: true, image: url => url.pathname === '/new-selection.png' ? 200 : 404 });
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes('Chargement'));
    await page.evaluate(() => (window as unknown as FixtureWindow).renderMedia({ duplicate: true }));
    await page.locator('[data-other-preview] [role="status"]').waitFor();
    await page.evaluate(() => (window as unknown as FixtureWindow).renderMedia({ src: '/new-selection.png', sourceKey: 'action-b', duplicate: false }));
    await loaded(page); context.release(); await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-preview] img').getAttribute('src'), '/new-selection.png');
    assert.equal(context.requests.filter(request => new URL(request.url).pathname === '/api/agent/actions').length, 1);
    assert.ok(!context.requests.some(request => request.url.includes('/api/media-library/')));
    assert.deepEqual(context.errors, []);
  } finally { await browser.close(); }
});

test("all four Agent content image surfaces use the recovery component with an account and action identity", () => {
  const source = ts.createSourceFile('AgentClient.tsx', read('app/dashboard/agent/AgentClient.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const surfaces: ts.JsxSelfClosingElement[] = [];
  const visit = (node: ts.Node) => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'AgentMediaImage') surfaces.push(node); ts.forEachChild(node, visit); };
  visit(source); assert.equal(surfaces.length, 4);
  for (const node of surfaces) for (const name of ['accountId', 'sourceKey', 'recoverUrl', 'alt']) assert.ok(node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === name));
});
