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
  './inrAssistantAgentSettingsUi.ts': compile('lib/inrAssistantAgentSettingsUi.ts'), './inrAssistantActionClause.ts': compile('lib/inrAssistantActionClause.ts'),
  nativeHook: compile('app/dashboard/_hooks/useInrAssistantNativeChannelLinks.ts'), localHook: compile('app/dashboard/_hooks/useInrAssistantLocalInterface.ts'),
  editor: compile('app/dashboard/_components/ChannelPublicLinkEditor.tsx'), field: compile('app/dashboard/_components/EditableChannelUrlField.tsx'),
  url: compile('lib/channelPublicUrl.ts'), position: compile('app/dashboard/_components/channel-popover-position.ts'), saveIcon: compile('app/dashboard/_components/SaveIcon.tsx'),
  compatiblePopover: compile('app/dashboard/_components/CompatiblePopover.tsx'), browserPopover: compile('lib/browserPopover.ts'),
  nativePopoverHook: compile('app/dashboard/_hooks/useInrAssistantNativePopover.ts'), publicationTypes: compile('app/dashboard/_components/ChannelPublicationTypes.tsx'),
};
const fixture = `
const sources=${JSON.stringify(sources)}, loaded={};
window.fixtureScope={actor:'actor',account:'account'}; window.fixtureHref=window.fixtureHref||'https://facebook.com/owned'; window.fixtureDisabled=false; window.nativeRequests=[];
const aliases={'@/lib/inrAssistantNativeChannelLinks':'links','./inrAssistantNativeChannelLinks.ts':'links','@/lib/inrAssistantLocalInterface':'driver','./inrAssistantRequestClauses.ts':'clauses','../_hooks/useInrAssistantNativeChannelLinks':'nativeHook','./useInrAssistantLocalInterface':'localHook','../_components/DashboardViewerAccessProvider':'viewer','@/lib/channelPublicUrl':'url','./SaveIcon':'saveIcon','./channel-popover-position':'position','./CompatiblePopover':'compatiblePopover','@/lib/browserPopover':'browserPopover','../_hooks/useInrAssistantNativePopover':'nativePopoverHook'};
function require(name){
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(name==='next-intl')return {useTranslations:()=>key=>key};
 if(name==='next/navigation')return {usePathname:()=>'/dashboard'};
 if(name==='viewer'||aliases[name]==='viewer')return {useDashboardViewerAccess:()=>({actorUserId:window.fixtureScope.actor,activeAccountId:window.fixtureScope.account})};
 name=aliases[name]||name;if(loaded[name])return loaded[name].exports;if(!sources[name])throw Error('Unreviewed native-link fixture dependency: '+name);
 const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;
}
const React=require('react'), native=require('nativeHook'), driver=require('driver'), Editor=require('editor').default, Field=require('field').default;
function Fixture(){native.useInrAssistantNativeChannelLinks();const channel=window.fixtureChannel||'facebook';const children=[React.createElement(Editor,{key:'editor',channel,name:window.fixtureName||'Facebook',disabled:window.fixtureDisabled},React.createElement(Field,{channel,value:window.fixtureHref,onSaved:()=>{throw Error('Unexpected save');},ariaLabel:'Lien Facebook',viewLabel:'Voir Facebook',disabled:window.fixtureDisabled,editorOnly:window.fixtureEditorOnly})),React.createElement('button',{key:'connect',id:'connect-facebook',onClick:()=>{window.fixtureFormats=true;window.renderFixture();}},'Connecter Facebook'),window.fixtureFormats?React.createElement(require('publicationTypes').default,{key:'formats',name:'Facebook',channel:'facebook',settings:{value:{reelsEnabled:true,storiesEnabled:true,defaultMode:'classic'},onLoad:async()=>{},onChange:()=>{throw Error('Unexpected preference write');}}}):null];return window.fixtureNested?React.createElement('dialog',{id:'cockpit',onCancel:event=>{event.preventDefault();window.fixtureOuterCancelled=true;}},children):React.createElement(React.Fragment,null,children);}
const root=require('react-dom/client').createRoot(document.getElementById('root'));window.renderFixture=()=>root.render(React.createElement(Fixture));window.renderFixture();
window.unmountFixture=()=>root.unmount();
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

test('Firefox 115 without Popover API keeps the real nested channel editor dismissible and mounts Facebook controls without a crash', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      for (const key of ['showPopover', 'hidePopover', 'togglePopover']) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, writable: true, value: undefined });
      const matches = Element.prototype.matches;
      Element.prototype.matches = function(selector: string) {
        if (selector.includes(':popover-open')) throw new DOMException("Element.matches: ':popover-open' is not a valid selector", 'SyntaxError');
        return matches.call(this, selector);
      };
    });
    await context.route('https://native-links.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>dialog{width:720px;height:480px}dialog[popover]{position:fixed;width:420px;height:auto;padding:16px;margin:0}dialog[popover]::backdrop{background:transparent}</style><div id="root"></div>' }));
    const page = await context.newPage();
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    context.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
    await page.goto('https://native-links.test/');
    await page.evaluate("window.fixtureNested=true;window.fixtureEditorOnly=true;window.fixtureChannel='gmb';window.fixtureName='Google Business';window.fixtureHref='https://maps.google.com/?q=fixture';");
    await page.addScriptTag({ content: fixture });
    await page.waitForFunction("window.hints?.()?.some(row=>row.id==='channel_link_editor')");
    await page.evaluate("document.getElementById('cockpit').showModal()");
    const editor = page.locator('dialog[popover]').first();
    const open = async () => {
      await page.getByRole('button', { name: /^editPublicLink — / }).click();
      await page.waitForFunction("document.querySelector('dialog[popover]').open === true");
      assert.equal(await editor.evaluate(node => (node as HTMLDialogElement).open), true);
    };
    const closed = async () => {
      await page.waitForFunction("document.querySelector('dialog[popover]').open === false");
      assert.equal(await editor.isVisible(), false);
      assert.equal(await page.locator('#cockpit').evaluate(node => (node as HTMLDialogElement).open), true);
    };
    assert.equal(await editor.isVisible(), false, 'unsupported popovers must start hidden');
    await open();
    await editor.getByRole('button', { name: 'close', exact: true }).click();
    await closed();
    await open();
    await editor.getByRole('textbox').fill('https://maps.google.com/?q=changed');
    await editor.getByRole('button', { name: 'annuler_49ba3292', exact: true }).click();
    await closed();
    await open();
    await page.keyboard.press('Escape');
    await closed();
    assert.equal(await page.evaluate('Boolean(window.fixtureOuterCancelled)'), false, 'Escape closes only the nested editor');
    await open();
    await page.mouse.click(2, 2);
    await closed();
    await open();
    assert.equal(await page.evaluate("window.run(window.command('channel_link_editor','close','gmb'))"), true, 'assistant ACK follows the real fallback dialog state');
    await closed();
    await open();
    await page.evaluate("window.fixtureChannel='facebook';window.fixtureName='Facebook';window.renderFixture()");
    await closed();
    await page.getByRole('button', { name: 'Connecter Facebook', exact: true }).click();
    await page.waitForFunction("document.querySelectorAll('dialog[popover]').length === 2");
    await page.getByRole('button', { name: 'publicationTypes — Facebook', exact: true }).click();
    await page.waitForFunction("document.querySelectorAll('dialog[popover]')[1].open === true");
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate("document.getElementById('cockpit').open"), true);
    await open();
    await page.evaluate('window.unmountFixture()');
    assert.equal(await page.locator('dialog[popover]').count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
  } finally { await browser.close(); }
});
