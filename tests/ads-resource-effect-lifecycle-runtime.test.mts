import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "AdsClient");
assert.ok(component?.body);
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
function actualEffect(declarations: string[], marker: string) {
  const selected = component!.body!.statements.filter(node => {
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(value => declarations.includes(value.name.getText(source)));
    return ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === "useEffect" && node.getText(source).includes(marker);
  });
  assert.equal(selected.length, declarations.length + 1, `complete source selection for ${marker}`);
  return selected.map(node => node.getText(source)).join("\n");
}

async function setup(page: Page, declarations: string[], marker: string, bindings: string[], fixture: string) {
  const code = `import React, {useEffect,useEffectEvent} from 'react';export default function Harness(props){const {${bindings.join(",")}}=props;${actualEffect(declarations,marker)}return null;}`;
  const sources = {
    react: packageSource("react", "react.development.js"),
    "react-dom": packageSource("react-dom", "react-dom.development.js"),
    "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
    scheduler: packageSource("scheduler", "scheduler.development.js"),
    subject: ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
  };
  await page.route("**/*", route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},cache={},process={env:{NODE_ENV:'development'}};
    function require(name){if(cache[name])return cache[name].exports;if(!sources[name])throw Error('Unexpected fixture import '+name);const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;}
    const React=require('react'),Harness=require('subject').default,root=require('react-dom/client').createRoot(document.getElementById('root'));
    window.requests=[];window.fetch=(url,options)=>new Promise(resolve=>window.requests.push({url,signal:options.signal,reply:body=>resolve(Response.json(body))}));
    window.config={};window.configure=patch=>{window.config={...window.config,...patch};root.render(React.createElement(Harness,window.config))};
    ${fixture}
  ` });
  page.setDefaultTimeout(3_000);
}

test("Ads resource requests use the latest staged search only on explicit refresh or context changes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, ["openaiLocationsKey", "onOpenaiResourcesRequested"], "void onOpenaiResourcesRequested(", ["draft", "creating", "channelId", "openaiResourceAccountId", "openaiGeoQuery", "openaiResourcesRevision", "readJson", "setOpenaiResources", "setOpenaiResourcesLoad", "setOpenaiResourcesError", "setConfirmedSpend", "linkedInLaunchConsent"], `
      window.resources=[];window.configure({draft:{targetLocations:['Lille']},creating:true,channelId:'openai',openaiResourceAccountId:'a',openaiGeoQuery:'Lille',openaiResourcesRevision:0,readJson:r=>r.json(),setOpenaiResources:value=>window.resources.push(value),setOpenaiResourcesLoad:()=>{},setOpenaiResourcesError:()=>{},setConfirmedSpend:()=>{},linkedInLaunchConsent:{current:null}});
    `);
    await page.waitForFunction("window.requests.length === 1");
    await page.evaluate("window.configure({openaiGeoQuery:'Paris',draft:{targetLocations:['Lille']}})");
    assert.equal(await page.evaluate("window.requests.length"), 1);
    assert.equal(await page.evaluate("window.requests[0].signal.aborted"), false);
    await page.evaluate("window.configure({openaiResourcesRevision:1})");
    await page.waitForFunction("window.requests.length === 2");
    assert.match(await page.evaluate<string>("window.requests[1].url"), /&q=Paris$/);
    await page.evaluate("window.configure({openaiGeoQuery:'Lyon',openaiResourceAccountId:'b'})");
    await page.waitForFunction("window.requests.length === 3");
    assert.equal(await page.evaluate("window.requests[1].signal.aborted"), true);
    assert.match(await page.evaluate<string>("window.requests[2].url"), /accountId=b.*&q=Lyon$/);
    await page.evaluate("window.requests[2].reply({selectedAccountId:'b',account:{id:'b'}});window.requests[1].reply({selectedAccountId:'a',account:{id:'a'}})");
    await page.waitForFunction("window.resources.at(-1)?.selectedAccountId === 'b'");
    assert.deepEqual(await page.evaluate("window.resources.filter(Boolean).map(value=>value.selectedAccountId)"), ["b"]);
  } finally { await browser.close(); }
});

test("external account discovery follows only the active channel connection identity", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, ["activeExternalConnected", "activeExternalAccountId"], "if (!activeExternalConnected)", ["channelId", "externalStatuses", "isExternalChannel", "pilotChannelsEnabled", "isAdsPublicChannel", "stopExternalAccountsLoading", "loadExternalAccounts", "cancelExternalAccountsLoad"], `
      window.loads=[];window.cancelled=0;window.stopped=0;
      window.configure({channelId:'pinterest',externalStatuses:{pinterest:{connected:true,selectedAccountId:'a'},linkedin:{connected:true,selectedAccountId:'other'}},isExternalChannel:()=>true,pilotChannelsEnabled:false,isAdsPublicChannel:()=>true,stopExternalAccountsLoading:()=>window.stopped++,loadExternalAccounts:(channel,id)=>window.loads.push([channel,id]),cancelExternalAccountsLoad:()=>window.cancelled++});
    `);
    await page.waitForFunction("window.loads.length === 1");
    await page.evaluate("window.configure({externalStatuses:{...window.config.externalStatuses,linkedin:{connected:false,selectedAccountId:'changed'}}})");
    assert.deepEqual(await page.evaluate("window.loads"), [["pinterest", "a"]]);
    await page.evaluate("window.configure({externalStatuses:{...window.config.externalStatuses,pinterest:{connected:false,selectedAccountId:'a'}}})");
    await page.waitForFunction("window.stopped === 1 && window.cancelled === 1");
    await page.evaluate("window.configure({externalStatuses:{...window.config.externalStatuses,pinterest:{connected:true,selectedAccountId:'b'}}})");
    await page.waitForFunction("window.loads.length === 2");
    assert.deepEqual(await page.evaluate("window.loads"), [["pinterest", "a"], ["pinterest", "b"]]);
  } finally { await browser.close(); }
});

test("a route draft response uses the current reopen policy without repeating its fetch", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, ["onRouteDraftLoaded"], "/api/ads/campaigns/", ["initialEditCampaignId", "editLoadId", "reopen", "readJson", "setNotice"], `
      window.opened=[];window.configure({initialEditCampaignId:'draft-a',editLoadId:{current:''},reopen:campaign=>window.opened.push(['first',campaign.id]),readJson:r=>r.json(),setNotice:()=>{}});
    `);
    await page.waitForFunction("window.requests.length === 1");
    await page.evaluate("window.configure({reopen:campaign=>window.opened.push(['current',campaign.id])})");
    assert.equal(await page.evaluate("window.requests.length"), 1);
    await page.evaluate("window.requests[0].reply({campaign:{id:'draft-a',status:'draft'}})");
    await page.waitForFunction("window.opened.length === 1");
    assert.deepEqual(await page.evaluate("window.opened"), [["current", "draft-a"]]);
  } finally { await browser.close(); }
});

test("Google geography holds the exact requested locations across rerenders and rejects a late old result", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, ["googleLocationsKey", "googleGeoKey"], "/api/ads/google/geography", ["draft", "creating", "channelId", "googleResourceAccountId", "googleResolvedGeoKey", "googleGeoRevision", "configuredAccountId", "setGoogleGeoState", "setConfirmedSpend", "linkedInLaunchConsent", "readJson", "setDraft", "setDirty"], `
      window.configure({draft:{provider:'google',campaignType:'search',adAccountId:'a',targetLocations:['Lille']},creating:true,channelId:'google',googleResourceAccountId:'a',googleResolvedGeoKey:{current:''},googleGeoRevision:0,configuredAccountId:'a',setGoogleGeoState:value=>window.geo=value,setConfirmedSpend:()=>{},linkedInLaunchConsent:{current:null},readJson:r=>r.json(),setDraft:update=>window.configure({draft:update(window.config.draft)}),setDirty:()=>{}});
    `);
    await page.waitForFunction("window.requests.length === 1");
    await page.evaluate("window.configure({draft:{...window.config.draft,targetLocations:['Lille']}})");
    assert.equal(await page.evaluate("window.requests.length"), 1);
    await page.evaluate("window.configure({draft:{...window.config.draft,targetLocations:['Paris']}})");
    await page.waitForFunction("window.requests.length === 2");
    assert.equal(await page.evaluate("window.requests[0].signal.aborted"), true);
    await page.evaluate("window.requests[1].reply({selectedAccountId:'a',locations:[{resourceName:'geoTargetConstants/2',label:'Paris, France',countryCode:'FR'}]})");
    await page.waitForFunction("window.config.draft.targetLocations[0] === 'Paris, France'");
    await page.evaluate("window.requests[0].reply({selectedAccountId:'a',locations:[{resourceName:'geoTargetConstants/1',label:'Lille, France',countryCode:'FR'}]})");
    assert.deepEqual(await page.evaluate("window.config.draft.targetLocations"), ["Paris, France"]);
  } finally { await browser.close(); }
});
