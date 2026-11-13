import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const packageSource = (name: string, file: string) => readFileSync(join(dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const browserSources = Object.fromEntries([
  "app/dashboard/agent/_hooks/useScheduledStudioCredits.ts",
  "app/dashboard/agent/_hooks/useAgentRuntimeData.ts",
  "app/dashboard/_hooks/useMediaCreditQuote.ts",
  "app/dashboard/_hooks/useMediaEnginePreference.ts",
  "app/dashboard/agent/_lib/agent.utils.ts",
  "lib/aiMediaModelCatalog.ts", "lib/aiMediaCreditsPricing.ts", "lib/aiMediaVideoTimeline.ts", "lib/aiMediaCharacterVoices.ts",
  "lib/inrAgentSettings.ts", "lib/siteWebChannel.ts", "lib/standardAgentPolicy.ts", "lib/metaChannelUiAccess.ts", "lib/inrAgentPublicationHistory.ts",
  "lib/userFacingErrors.ts", "lib/appLanguage.ts", "lib/publicationErrorFrench.ts", "lib/metaGraphErrorClassification.ts",
  "lib/aiMediaGenerationPublicErrorI18n.ts", "lib/aiMediaGenerationPublicErrorCopy.ts",
].map(file => [file, compile(file)]));
browserSources["intl-messageformat"] = ts.transpileModule(readFileSync(join(dirname(require.resolve("intl-messageformat")), "intl-messageformat.iife.js"), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const agentMessages = JSON.parse(readFileSync(new URL("../../messages/fr-FR/agent.json", import.meta.url), "utf8"));

async function setup(page: Page) {
  const networkRequests: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => { networkRequests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><html><body><main id="root"></main></body></html>');
  const sources = { ...browserSources,
    react: packageSource("react", "react.development.js"),
    "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
    "react-dom": packageSource("react-dom", "react-dom.development.js"),
    "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
    scheduler: packageSource("scheduler", "scheduler.development.js"),
  };
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},cache={},process={env:{NODE_ENV:'development'}},accountCache=new Map(),messages=${JSON.stringify(agentMessages)},formats=new Map();
    window.account='account-a';window.requests=[];window.unexpected=[];window.clicks={generate:0,modify:0,import:0,retouch:0};
    const modules={
      'next-intl':{useTranslations:namespace=>{if(namespace!=='agent')throw Error('Unexpected Basic catalogue '+namespace);return(key,values)=>{const message=key.split('.').reduce((value,part)=>value?.[part],messages);if(typeof message!=='string')throw Error('Missing Basic catalogue message '+key);if(!formats.has(key))formats.set(key,new (require('intl-messageformat').IntlMessageFormat)(message,'fr-FR'));return formats.get(key).format(values)}}},
      'app/dashboard/_components/DashboardViewerAccessProvider':{useDashboardViewerAccess:()=>({metaPilotEnabled:true})},
      'lib/multicompte/constants':{ACTIVE_INRCY_ACCOUNT_EVENT:'fixture-account-change'},
      'lib/browserAccountCache':{
        getActiveBrowserUserId:()=>window.account,
        readAccountCacheValue:key=>accountCache.get(window.account+':'+key)||null,
        writeAccountCacheValue:(key,value)=>accountCache.set(window.account+':'+key,value)
      },
      'lib/channelConnectionUpdates':{subscribeToChannelConnectionUpdates:()=>()=>{}},
      'app/dashboard/agent/_lib/agent.config':{
        DASHBOARD_CHANNEL_STATE_CACHE_KEY:'fixture-channels',INR_AGENT_VIEW_CACHE_KEY:'fixture-agent',INR_AGENT_VIEW_CACHE_MAX_AGE_MS:60000
      },
      // Form conversion and cache validation are separate from the network/credit guards under test.
      'app/dashboard/agent/_lib/agent.settings':{
        isCachedPreparedAction:value=>Boolean(value?.id),isCachedScheduledAction:value=>Boolean(value?.id),
        sanitizeCachedConnectedChannels:value=>value||null,
        settingsToConfigs:()=>({publish:{},stats:{},grow:{},loyalty:{}}),normalizeConfigsForConnectedChannels:value=>value
      }
    };
    function resolve(name,parent){
      let path=name.startsWith('@/')?name.slice(2):name;
      if(name.startsWith('.')){
        const parts=parent.split('/');parts.pop();
        for(const part of name.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part)}path=parts.join('/');
      }
      return Object.hasOwn(sources,path)?path:Object.hasOwn(sources,path+'.ts')?path+'.ts':path;
    }
    function require(name,parent=''){
      const id=resolve(name,parent);if(Object.hasOwn(modules,id))return modules[id];if(cache[id])return cache[id].exports;
      if(!Object.hasOwn(sources,id))throw Error('Unexpected Basic fixture import '+id);
      const module=cache[id]={exports:{}};new Function('require','module','exports','process',sources[id])(child=>require(child,id),module,module.exports,process);return module.exports;
    }
    window.fetch=(url,options={})=>{
      const path=String(url),method=options.method||'GET';
      const allowed=method==='GET'&&['/api/agent/scheduled-actions','/api/integrations/channel-states','/api/media-generation/quota'].includes(path)
        ||method==='POST'&&path==='/api/media-generation/quote';
      return new Promise((resolve,reject)=>{
        const entry={url:path,method,accountId:window.account,body:options.body?JSON.parse(options.body):null,signal:options.signal,settled:false,resolve,reject};
        window.requests.push(entry);
        if(!allowed){window.unexpected.push({url:path,method});entry.settled=true;reject(Error('Forbidden Basic fixture request '+path));}
      });
    };
    window.reply=(index,payload,status=200)=>{const request=window.requests[index];if(request.settled)throw Error('Request already settled');request.settled=true;request.resolve(Response.json(payload,{status}));};
    window.pending=url=>window.requests.map((request,index)=>({...request,index})).filter(request=>request.url===url&&!request.settled);
    window.replyQuotas=(remaining,overrides={},accountId=window.account)=>{
      for(const request of window.pending('/api/media-generation/quota').filter(request=>request.accountId===accountId))
        window.reply(request.index,{quota:{accountId,edition:'basic',unlimited:false,studioEnabled:true,creditsReady:true,
          credits:{unit:'credit',remaining,limit:remaining,used:0,reserved:0},...overrides}});
    };
    window.replyQuotes=(remaining,status=200,accountId=window.account)=>{
      for(const request of window.pending('/api/media-generation/quote').filter(request=>request.accountId===accountId))
        window.reply(request.index,status===200?{quote:{...require('lib/aiMediaCreditsPricing.ts').quoteAiMediaCredits(request.body),quoteId:accountId+':quote:'+request.index},credits:{remaining}}:{error:'Quote temporarily unavailable'},status);
    };
    window.replyPlanning=()=>{
      for(const request of window.pending('/api/integrations/channel-states'))window.reply(request.index,{facebook:{connected:true}});
      for(const request of window.pending('/api/agent/scheduled-actions'))window.reply(request.index,{scheduledActions:[
        {id:request.accountId+':manual',source:'manual',actionType:'publication',targetTool:'booster',automationKey:'publish',payload:{kind:'manual_publish_schedule',publishPayload:{source:'booster_scheduled'}}},
        {id:request.accountId+':automatic',source:'agent',actionType:'publication',targetTool:'booster',automationKey:'publish',payload:{editorialPlan:{}}},
        {id:request.accountId+':mail',source:'manual',actionType:'mail_campaign',targetTool:'mails',automationKey:'grow',payload:{}}
      ]});
    };
    const React=require('react'),root=require('react-dom/client').createRoot(document.getElementById('root'));
    const useCredits=require('app/dashboard/agent/_hooks/useScheduledStudioCredits.ts').useScheduledStudioCredits;
    const useRuntime=require('app/dashboard/agent/_hooks/useAgentRuntimeData.ts').useAgentRuntimeData;
    window.options={enabled:true,accountId:window.account,kind:'image'};
    function Runtime(){const runtime=useRuntime({standardMode:true,manualPlanningOnly:true});window.runtime=runtime;
      return React.createElement('output',{'data-planning':true},JSON.stringify({scheduled:runtime.scheduledActions.map(action=>action.id),actions:runtime.actions.length,history:runtime.historyPublications.length,state:runtime.actionsLoadState}));}
    function Credits(props){const credits=useCredits(props);window.credits=credits;
      window.creditState={generateAllowed:credits.generateAllowed,modifyAllowed:credits.modifyAllowed,generateReady:credits.generate.ready,modifyReady:credits.modify.ready,unavailable:credits.unavailable,
        generateInsufficient:credits.generate.insufficient,modifyInsufficient:credits.modify.insufficient,
        generateQuote:credits.generate.quote?.quoteId||null,modifyQuote:credits.modify.quote?.quoteId||null};
      return React.createElement('section',null,
        React.createElement('button',{disabled:!credits.generateAllowed,onClick:()=>window.clicks.generate++},'Générer avec IA'),
        React.createElement('button',{disabled:!credits.modifyAllowed,onClick:()=>window.clicks.modify++},'Modifier avec IA'),
        React.createElement('button',{onClick:()=>window.clicks.import++},'Importer mon média'),
        React.createElement('button',{onClick:()=>window.clicks.retouch++},'Retoucher manuellement'),
        React.createElement('output',{'data-credits':true},JSON.stringify(window.creditState)));
    }
    window.render=patch=>{window.options={...window.options,...patch};window.account=window.options.accountId;
      root.render(React.createElement(React.StrictMode,null,React.createElement(Runtime,{key:window.account}),React.createElement(Credits,window.options)));};
    window.render({});
  ` });
  page.setDefaultTimeout(4_000);
  await page.waitForFunction("window.pending('/api/media-generation/quota').length > 0 && window.pending('/api/agent/scheduled-actions').length > 0");
  return { networkRequests, errors };
}

async function assertBlocked(page: Page) {
  assert.equal(await page.getByRole("button", { name: "Générer avec IA", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Modifier avec IA", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Importer mon média", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Retoucher manuellement", exact: true }).isEnabled(), true);
}

async function waitQuotes(page: Page, accountId = "account-a") {
  await page.waitForFunction(`window.pending('/api/media-generation/quote').filter(request => request.accountId === ${JSON.stringify(accountId)}).length >= 2`);
}

async function assertNoExternalWork(page: Page, fixture: Awaited<ReturnType<typeof setup>>) {
  assert.deepEqual(await page.evaluate("window.unexpected"), [], "Basic never fetches agent settings/actions, generates paid media or writes data");
  assert.deepEqual(fixture.networkRequests, [], "all HTTP responses are simulated and no real service is contacted");
  assert.deepEqual(fixture.errors, []);
}

test("Basic loads its real manual planning and Studio wallet; loading, zero and insufficient credits keep only personal media actions usable", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), fixture = await setup(page);
    await assertBlocked(page);
    await page.evaluate("window.replyPlanning();window.replyQuotas(0)");
    await page.waitForFunction("window.runtime.actionsLoadState==='ready' && window.runtime.scheduledActions.length===1");
    assert.deepEqual(await page.evaluate("window.runtime.scheduledActions.map(action=>action.id)"), ["account-a:manual"]);
    assert.equal(await page.evaluate("window.runtime.actions.length+window.runtime.historyPublications.length"), 0);
    await waitQuotes(page);
    await assertBlocked(page);
    await page.evaluate("window.replyQuotes(0)");
    await page.waitForFunction("window.creditState.generateReady && window.creditState.modifyReady");
    await assertBlocked(page);
    assert.equal(await page.evaluate("window.creditState.generateInsufficient && window.creditState.modifyInsufficient"), true);

    await page.evaluate("void window.credits.refresh()");
    await page.waitForFunction("window.pending('/api/media-generation/quota').length>0");
    await page.evaluate("window.replyQuotas(1)");
    await waitQuotes(page);
    await assertBlocked(page);
    await page.evaluate("window.replyQuotes(1)");
    await page.waitForFunction("window.creditState.generateReady && window.creditState.modifyReady");
    await assertBlocked(page);

    await page.evaluate("void window.credits.refresh();void window.runtime.refreshActions();void window.runtime.refreshPublicationHistory();void window.runtime.refreshAssistantData(()=>true)");
    await page.waitForFunction("window.pending('/api/media-generation/quota').length>0");
    await page.evaluate("window.replyPlanning();window.replyQuotas(100)");
    await waitQuotes(page);
    await assertBlocked(page);
    await page.evaluate("window.replyQuotes(100)");
    await page.waitForFunction("window.creditState.generateAllowed && window.creditState.modifyAllowed");
    await page.getByRole("button", { name: "Générer avec IA", exact: true }).click();
    await page.getByRole("button", { name: "Modifier avec IA", exact: true }).click();
    await page.getByRole("button", { name: "Importer mon média", exact: true }).click();
    assert.deepEqual(await page.evaluate("window.clicks"), { generate: 1, modify: 1, import: 1, retouch: 0 });
    await assertNoExternalWork(page, fixture);
  } finally { await browser.close(); }
});

test("Basic blocks IA while its wallet is unavailable or a price is unconfirmed/failed, and recovers only after a confirmed affordable quote", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), fixture = await setup(page);
    await page.evaluate("window.replyPlanning();window.replyQuotas(100,{creditsReady:false})");
    await page.waitForFunction("window.creditState.unavailable");
    await assertBlocked(page);
    assert.equal(await page.evaluate("window.pending('/api/media-generation/quote').length"), 0);
    await page.evaluate("void window.credits.refresh()");
    await page.waitForFunction("window.pending('/api/media-generation/quota').length>0");
    await page.evaluate("for(const request of window.pending('/api/media-generation/quota'))window.reply(request.index,{error:'Wallet unavailable'},503)");
    await page.waitForFunction("window.creditState.unavailable");
    await assertBlocked(page);

    await page.evaluate("void window.credits.refresh()");
    await page.waitForFunction("window.pending('/api/media-generation/quota').length>0");
    await page.evaluate("window.replyQuotas(100)");
    await waitQuotes(page);
    await assertBlocked(page);
    await page.evaluate("window.replyQuotes(100,503)");
    await page.waitForFunction("Boolean(window.credits.generate.error && window.credits.modify.error)");
    await assertBlocked(page);
    await page.evaluate("window.credits.generate.retry();window.credits.modify.retry()");
    await waitQuotes(page);
    await page.evaluate("window.replyQuotes(100)");
    await page.waitForFunction("window.creditState.generateAllowed && window.creditState.modifyAllowed");
    await assertNoExternalWork(page, fixture);
  } finally { await browser.close(); }
});

test("switching the active Basic account invalidates old wallet replies and late quote authorizations", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), fixture = await setup(page);
    await page.evaluate("window.replyPlanning();window.replyQuotas(100)");
    await waitQuotes(page);
    await page.evaluate("window.replyQuotes(100)");
    await page.waitForFunction("window.creditState.generateAllowed && window.creditState.modifyAllowed");

    await page.evaluate("void window.credits.refresh()");
    await page.waitForFunction("window.pending('/api/media-generation/quota').length>0");
    await page.evaluate("window.replyQuotas(99)");
    await waitQuotes(page);
    await page.evaluate("void window.credits.refresh()");
    await page.waitForFunction("window.pending('/api/media-generation/quota').some(request=>request.accountId==='account-a')");
    await page.evaluate("window.render({accountId:'account-b'});window.dispatchEvent(new Event('fixture-account-change'))");
    await page.waitForFunction("window.pending('/api/media-generation/quota').some(request=>request.accountId==='account-b')");
    await assertBlocked(page);
    await page.evaluate("window.replyQuotas(999,{},'account-a');window.replyQuotes(999,200,'account-a');window.replyPlanning()");
    await assertBlocked(page);
    assert.equal(await page.evaluate("window.creditState.generateQuote"), null);
    assert.equal(await page.evaluate("window.creditState.modifyQuote"), null);
    await page.evaluate("window.replyQuotas(0,{},'account-b')");
    await waitQuotes(page, "account-b");
    await page.evaluate("window.replyQuotes(0,200,'account-b')");
    await page.waitForFunction("window.creditState.generateReady && window.creditState.modifyReady");
    await assertBlocked(page);
    assert.match(await page.evaluate("window.creditState.generateQuote"), /^account-b:/);
    assert.deepEqual(await page.evaluate("window.runtime.scheduledActions.map(action=>action.id)"), ["account-b:manual"]);
    await assertNoExternalWork(page, fixture);
  } finally { await browser.close(); }
});
