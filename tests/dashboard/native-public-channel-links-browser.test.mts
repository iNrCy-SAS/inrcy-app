import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { chromium } from '@playwright/test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const pkg = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), 'cjs', file), 'utf8');
const sources = {
  react: pkg('react', 'react.production.js'), 'react/jsx-runtime': pkg('react', 'react-jsx-runtime.production.js'), 'react-dom': pkg('react-dom', 'react-dom.production.js'), 'react-dom/client': pkg('react-dom', 'react-dom-client.production.js'), scheduler: pkg('scheduler', 'scheduler.production.js'),
  links: compile('lib/inrAssistantNativeChannelLinks.ts'), driver: compile('lib/inrAssistantLocalInterface.ts'), clauses: compile('lib/inrAssistantRequestClauses.ts'),
  nativeHook: compile('app/dashboard/_hooks/useInrAssistantNativeChannelLinks.ts'), localHook: compile('app/dashboard/_hooks/useInrAssistantLocalInterface.ts'),
  editor: compile('app/dashboard/_components/ChannelPublicLinkEditor.tsx'), field: compile('app/dashboard/_components/EditableChannelUrlField.tsx'),
  url: compile('lib/channelPublicUrl.ts'), position: compile('app/dashboard/_components/channel-popover-position.ts'), saveIcon: compile('app/dashboard/_components/SaveIcon.tsx'),
};
const fixture = `
const sources=${JSON.stringify(sources)}, loaded={};
window.fixtureScope={actor:'actor',account:'account'}; window.fixtureHref='https://facebook.com/owned'; window.fixtureDisabled=false; window.nativeRequests=[];
const aliases={'@/lib/inrAssistantNativeChannelLinks':'links','./inrAssistantNativeChannelLinks.ts':'links','@/lib/inrAssistantLocalInterface':'driver','./inrAssistantRequestClauses.ts':'clauses','../_hooks/useInrAssistantNativeChannelLinks':'nativeHook','./useInrAssistantLocalInterface':'localHook','../_components/DashboardViewerAccessProvider':'viewer','@/lib/channelPublicUrl':'url','./SaveIcon':'saveIcon','./channel-popover-position':'position'};
function require(name){
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(name==='next-intl')return {useTranslations:()=>key=>key};
 if(name==='next/navigation')return {usePathname:()=>'/dashboard'};
 if(name==='viewer'||aliases[name]==='viewer')return {useDashboardViewerAccess:()=>({actorUserId:window.fixtureScope.actor,activeAccountId:window.fixtureScope.account})};
 name=aliases[name]||name;if(loaded[name])return loaded[name].exports;if(!sources[name])throw Error('Unreviewed native-link fixture dependency: '+name);
 const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;
}
const React=require('react'), native=require('nativeHook'), driver=require('driver'), Editor=require('editor').default, Field=require('field').default;
function Fixture(){native.useInrAssistantNativeChannelLinks();return React.createElement(Editor,{channel:'facebook',name:'Facebook',disabled:window.fixtureDisabled},React.createElement(Field,{channel:'facebook',value:window.fixtureHref,onSaved:()=>{throw Error('Unexpected save');},ariaLabel:'Lien Facebook',viewLabel:'Voir Facebook',disabled:window.fixtureDisabled}));}
const root=require('react-dom/client').createRoot(document.getElementById('root'));window.renderFixture=()=>root.render(React.createElement(Fixture));window.renderFixture();
window.hints=()=>driver.getInrAssistantLocalInterfaceHints({actorUserId:window.fixtureScope.actor,accountId:window.fixtureScope.account,pathname:'/dashboard'});
window.command=(id,operation,value)=>{const hint=window.hints()?.find(row=>row.id===id);if(!hint)throw Error('Native link hint missing: '+id);return {command:'control_local_interface',selection:{kind:'account_document',id},operation,value,revision:hint.revision};};
window.run=command=>driver.runInrAssistantLocalInterface(command,{actorUserId:window.fixtureScope.actor,accountId:window.fixtureScope.account,pathname:'/dashboard'},()=>true);
`;

test('Actual channel link editor cancel and public anchor use native scoped state and a real browser handoff', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('https://native-links.test/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await context.route('https://facebook.com/owned', route => route.fulfill({ contentType: 'text/html', body: '<p>Owned fixture destination</p>' }));
    const page = await context.newPage(), errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    context.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
    await page.goto('https://native-links.test/'); await page.addScriptTag({ content: fixture });
    await page.waitForFunction(() => (window as unknown as { hints(): unknown[] }).hints()?.length === 3);
    const opened = await page.evaluate(async () => { const w = window as unknown as { command(id: string, op: string, value: string): unknown; run(command: unknown): Promise<boolean> }; return w.run(w.command('channel_link_editor', 'open', 'facebook')); });
    assert.equal(opened, true); assert.equal(await page.locator('[popover]').evaluate(node => node.matches(':popover-open')), true);
    await page.getByRole('button', { name: 'channel_url_edit', exact: true }).click();
    await page.getByRole('textbox', { name: 'Lien Facebook' }).fill('https://facebook.com/unsaved');
    const cleared = await page.evaluate(async () => { const w = window as unknown as { command(id: string, op: string, value: string): unknown; run(command: unknown): Promise<boolean> }; return w.run(w.command('channel_link_draft', 'clear', 'facebook')); });
    assert.equal(cleared, true); assert.equal(await page.getByRole('textbox', { name: 'Lien Facebook' }).inputValue(), 'https://facebook.com/owned');
    const popup = page.waitForEvent('popup');
    assert.equal(await page.evaluate(async () => { const w = window as unknown as { command(id: string, op: string, value: string): unknown; run(command: unknown): Promise<boolean> }; return w.run(w.command('public_channel_link', 'open', 'facebook')); }), true);
    const destination = await popup; await destination.waitForLoadState(); assert.equal(destination.url(), 'https://facebook.com/owned'); await destination.close();
    const old = await page.evaluate(() => (window as unknown as { command(id: string, op: string, value: string): unknown }).command('channel_link_editor', 'close', 'facebook'));
    await page.evaluate(() => { const w = window as unknown as { fixtureScope: { actor: string }; renderFixture(): void }; w.fixtureScope.actor = 'other-actor'; w.renderFixture(); });
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(command => (window as unknown as { run(command: unknown): Promise<boolean> }).run(command), old), false);
    assert.equal(await page.locator('[popover]').evaluate(node => node.matches(':popover-open')), true);
    assert.equal(await page.evaluate(async () => { const w = window as unknown as { command(id: string, op: string, value: string): unknown; run(command: unknown): Promise<boolean> }; return w.run(w.command('channel_link_editor', 'close', 'facebook')); }), true);
    assert.equal(await page.locator('[popover]').evaluate(node => node.matches(':popover-open')), false);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
