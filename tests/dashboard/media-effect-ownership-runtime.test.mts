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

async function setup(page: Page, componentFile: string, fixture: string, mocks = "{}") {
  const sources = {
    react: packageSource("react", "react.development.js"),
    "react/jsx-runtime": packageSource("react", "react-jsx-runtime.development.js"),
    "react-dom": packageSource("react-dom", "react-dom.development.js"),
    "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"),
    scheduler: packageSource("scheduler", "scheduler.development.js"),
    subject: compile(componentFile),
  };
  await page.route("**/*", route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div><button id="outside">Outside</button></body></html>');
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},cache={},process={env:{NODE_ENV:'development'}},translate=key=>key;
    const fixtureModules=${mocks};
    function require(name){
      if(Object.hasOwn(fixtureModules,name))return fixtureModules[name];
      if(name.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
      if(name==='next-intl')return{useTranslations:()=>translate,useLocale:()=>'fr-FR'};
      if(name==='@/lib/multicompte/constants')return{ACTIVE_INRCY_ACCOUNT_EVENT:'fixture-account-change'};
      if(name==='@/lib/aiMediaGenerationPreferences')return{normalizeAiMediaGeneratorPreferences:value=>value||{version:1,blocks:{1:{saved:false},2:{saved:false}}}};
      if(cache[name])return cache[name].exports;
      if(!sources[name])throw Error('Unexpected fixture import '+name);
      const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;
    }
    const React=require('react'),Subject=require('subject').default,root=require('react-dom/client').createRoot(document.getElementById('root'));
    ${fixture}
  ` });
  page.setDefaultTimeout(3_000);
}

test("media pickers restore their opening trigger after rerender and Escape", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [file, trigger] of [
      ["app/dashboard/_components/LocalMediaUploadChoice.tsx", '[data-testid="fixture-trigger"]'],
      ["app/dashboard/booster/publier/components/PublishReferencePicker.tsx", '[data-testid="booster-reference-add"]'],
    ]) {
      const page = await browser.newPage();
      await setup(page, file, `
        window.selected=[];window.config={disabled:false,testId:'fixture-trigger',image:{onSelect:()=>window.selected.push('image')},video:{onSelect:()=>window.selected.push('video')},documentDetail:'Documents',onPickDocument:()=>{},onGenerateMedia:()=>{},onOpenMediaLibrary:()=>{}};
        window.render=()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Subject,{...window.config})));
        window.render();
      `);
      await page.locator(trigger).click();
      await page.getByRole("dialog").waitFor();
      await page.evaluate("window.render()");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      assert.equal(await page.locator(trigger).evaluate(element => document.activeElement === element), true);
      assert.equal(await page.evaluate("document.body.style.overflow"), "");
      assert.deepEqual(await page.evaluate("window.selected"), []);
      await page.locator(trigger).click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(trigger).evaluate(element => document.activeElement === element), true);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("preference cleanup aborts PATCH controllers added after mount, including after an account change", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "app/dashboard/_hooks/useAiMediaGeneratorPreferences.ts", `
      window.requests=[];window.fetch=(url,options)=>new Promise(resolve=>window.requests.push({method:options.method,signal:options.signal,reply:preferences=>resolve(Response.json({ok:true,preferences}))}));
      function Harness(){window.hook=Subject();return React.createElement('output',null,JSON.stringify(window.hook.preferences));}
      root.render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
      window.unmount=()=>root.unmount();
    `);
    await page.waitForFunction("window.requests.length === 2");
    await page.evaluate("window.requests.at(-1).reply({version:1,blocks:{1:{saved:false},2:{saved:false}}})");
    await page.waitForFunction("window.hook.loaded");
    await page.evaluate("void window.hook.saveBlock(1,true,{kind:'image',subjectSource:'profile'})");
    await page.waitForFunction("window.requests.some(r=>r.method === 'PATCH')");
    await page.evaluate("window.dispatchEvent(new Event('fixture-account-change'))");
    await page.waitForFunction("window.hook.accountEpoch === 1 && window.requests.at(-1).method === 'GET'");
    assert.equal(await page.evaluate("window.requests.find(r=>r.method === 'PATCH').signal.aborted"), true);
    await page.evaluate("window.requests.at(-1).reply({version:1,blocks:{1:{saved:false},2:{saved:false}}});window.requests.find(r=>r.method === 'PATCH').reply({version:1,blocks:{1:{saved:true},2:{saved:false}}})");
    await page.waitForFunction("window.hook.loaded && window.hook.savingBlockIds.size === 0");
    assert.equal(await page.evaluate("window.hook.preferences.blocks[1].saved"), false, "late previous-account saves cannot apply");
    await page.evaluate("void window.hook.saveBlock(2,true,{typology:'company'})");
    await page.waitForFunction("window.requests.filter(r=>r.method === 'PATCH').length === 2");
    await page.evaluate("window.unmount()");
    assert.equal(await page.evaluate("window.requests.at(-1).signal.aborted"), true, "unmount sees the live Set, including newly added requests");
  } finally { await browser.close(); }
});

test("manual-credit refresh rejects earlier requests after focus, scope changes and cleanup", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "app/dashboard/agent/_hooks/useAgentManualCredits.ts", `
      window.requests=[];window.fetch=()=>new Promise(resolve=>window.requests.push(remaining=>resolve(Response.json({manualPublishCredits:{ready:true,allowed:remaining>0,unlimited:false,remaining,required:7}}))));
      const useCredits=require('subject').useAgentManualCredits;
      function Harness({scope}){window.hook=useCredits(scope);return React.createElement('output',null,JSON.stringify(window.hook.availability));}
      window.render=scope=>root.render(React.createElement(Harness,{scope}));window.unmount=()=>root.unmount();window.render('a');
    `);
    await page.waitForFunction("window.requests.length === 1");
    await page.evaluate("window.dispatchEvent(new Event('focus'))");
    await page.waitForFunction("window.requests.length === 2");
    await page.evaluate("window.requests[1](20)");
    await page.waitForFunction("window.hook.availability?.remaining === 20");
    await page.evaluate("window.requests[0](999); window.render('b')");
    await page.waitForFunction("window.requests.length === 3 && window.hook.availability === null");
    await page.evaluate("window.dispatchEvent(new Event('focus'))");
    await page.waitForFunction("window.requests.length === 4");
    await page.evaluate("window.requests[3](0)");
    await page.waitForFunction("window.hook.availability?.remaining === 0");
    await page.evaluate("window.requests[2](999)");
    assert.equal(await page.evaluate("window.hook.availability.allowed"), false);
    await page.evaluate("void window.hook.refresh()");
    await page.waitForFunction("window.requests.length === 5");
    await page.evaluate("window.unmount();window.requests[4](999)");
    assert.equal(await page.locator("output").count(), 0);
  } finally { await browser.close(); }
});

test("attachment reset and actor/account changes invalidate the current upload revision", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "app/dashboard/_hooks/useAssistantAttachments.ts", `
      window.requests=[];window.fetch=(_url,options)=>new Promise(resolve=>window.requests.push({signal:options.signal,reply:name=>resolve(Response.json({accountId:window.account,attachments:[{id:name,name,size:1}]}))}));
      const useAttachments=require('subject').useAssistantAttachments;window.account='a';
      function Harness({actor}){window.hook=useAttachments({accountId:window.account,actorUserId:actor,locale:'fr',ensureConversation:()=> 'conversation'});return React.createElement('output',null,JSON.stringify(window.hook.attachments));}
      window.render=actor=>root.render(React.createElement(Harness,{actor}));window.render('actor-a');
    `, `{
      '@/lib/supabaseClient':{createClient:()=>{throw Error('No storage upload in this fixture')}},
      '@/lib/browserAccountCache':{getActiveBrowserUserId:()=>window.account},
      '@/lib/inrAssistantAttachments':{ASSISTANT_ATTACHMENT_MAX_COUNT:5,ASSISTANT_ATTACHMENT_TOTAL_BYTES:1000,AssistantAttachmentError:class extends Error{},parseAssistantAttachments:value=>value},
      '../_components/dashboardAssistantAttachmentCopy':{assistantAttachmentErrorCopy:()=> 'error'}
    }`);
    await page.waitForFunction("Boolean(window.hook)");
    await page.evaluate("void window.hook.addLibrary(['first'])");
    await page.waitForFunction("window.requests.length === 1");
    await page.evaluate("window.hook.reset()");
    assert.equal(await page.evaluate("window.requests[0].signal.aborted"), true);
    await page.evaluate("void window.hook.addLibrary(['second'])");
    await page.waitForFunction("window.requests.length === 2");
    await page.evaluate("window.requests[0].reply('stale-reset')");
    assert.equal(await page.evaluate("window.hook.busy"), true, "old request cannot unlock the replacement operation");
    await page.evaluate("window.render('actor-b')");
    await page.waitForFunction("window.requests[1].signal.aborted");
    await page.evaluate("window.requests[1].reply('stale-actor')");
    await page.waitForFunction("!window.hook.busy");
    assert.deepEqual(await page.evaluate("window.hook.attachments"), []);
    await page.evaluate("void window.hook.addLibrary(['third'])");
    await page.waitForFunction("window.requests.length === 3");
    await page.evaluate("window.account='b';window.render('actor-b')");
    await page.waitForFunction("window.requests[2].signal.aborted");
    await page.evaluate("window.requests[2].reply('stale-account')");
    await page.waitForFunction("!window.hook.busy");
    assert.deepEqual(await page.evaluate("window.hook.attachments"), []);
    await page.evaluate("void window.hook.addLibrary(['current'])");
    await page.waitForFunction("window.requests.length === 4");
    await page.evaluate("window.requests[3].reply('current-account')");
    await page.waitForFunction("window.hook.attachments.length === 1");
    assert.equal(await page.evaluate("window.hook.attachments[0].name"), "current-account");
  } finally { await browser.close(); }
});

test("real attachment hook accepts native audio from device and the audio library without generating or interpreting it", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const audio = compile("lib/mediaLibraryAudio.ts"), attachment = compile("lib/inrAssistantAttachments.ts");
    const policy = `(()=>{const audio={exports:{}};new Function('module','exports',${JSON.stringify(audio)})(audio,audio.exports);const policy={exports:{}};new Function('require','module','exports',${JSON.stringify(attachment)})(name=>{if(name==='./mediaLibraryAudio.ts')return audio.exports;throw Error(name)},policy,policy.exports);return policy.exports})()`;
    await setup(page, "app/dashboard/_hooks/useAssistantAttachments.ts", `
      window.requests=[];window.transfers=[];window.account='account-a';
      const ref={id:'11111111-1111-4111-8111-111111111111',token:'fixture-token',name:'recording.mp3',kind:'audio',size:12};
      window.fetch=async(url,options)=>{const body=JSON.parse(options.body);window.requests.push({url,body});
        if(body.action==='prepare')return Response.json({accountId:window.account,prepared:[{attachment:ref,upload:{path:'private/audio',token:'upload-fixture',contentType:'audio/mpeg'}}]});
        return Response.json({accountId:window.account,attachments:[body.action==='library'?{...ref,id:'22222222-2222-4222-8222-222222222222',name:'library.mp3'}:ref]});
      };
      function Harness(){window.hook=require('subject').useAssistantAttachments({accountId:window.account,actorUserId:'actor-a',locale:'fr',ensureConversation:()=> 'conversation'});return React.createElement('output',null,JSON.stringify({attachments:window.hook.attachments,mode:window.hook.libraryMode,open:window.hook.libraryOpen}));}
      root.render(React.createElement(Harness));
    `, `{
      '@/lib/supabaseClient':{createClient:()=>({storage:{from:bucket=>({uploadToSignedUrl:async(path,token,file)=>{window.transfers.push({bucket,path,token,name:file.name,size:file.size,type:file.type});return {error:null}}})}})},
      '@/lib/browserAccountCache':{getActiveBrowserUserId:()=>window.account},
      '@/lib/inrAssistantAttachments':${policy},
      '../_components/dashboardAssistantAttachmentCopy':{assistantAttachmentErrorCopy:()=> 'attachment-error'}
    }`);
    await page.waitForFunction("Boolean(window.hook)");
    await page.evaluate("window.hook.addDevice([new File(['ID3fixture12'],'recording.mp3',{type:'audio/mpeg'})])");
    await page.waitForFunction("window.hook.attachments.length === 1");
    assert.equal(await page.evaluate("window.hook.attachments[0].kind"), "audio");
    assert.equal(await page.evaluate("window.transfers.length"), 1);
    await page.evaluate("window.hook.selectAudioLibrary()");
    await page.waitForFunction("window.hook.libraryOpen && window.hook.libraryMode === 'audio'");
    await page.evaluate("window.hook.addLibrary(['22222222-2222-4222-8222-222222222222'])");
    await page.waitForFunction("window.hook.attachments.length === 2");
    await page.evaluate("window.hook.addDevice([new File([new Uint8Array(3*1024*1024+1)],'too-big.mp3',{type:'audio/mpeg'})])");
    await page.waitForFunction("window.hook.error === 'attachment-error'");
    assert.equal(await page.evaluate("window.transfers.length"), 1, "oversize audio never reaches storage");
    assert.deepEqual(await page.evaluate("window.requests.map(value=>value.body.action)"), ["prepare", "finalize", "library"]);
    await page.evaluate("window.hook.selectLibrary()");
    await page.waitForFunction("window.hook.libraryMode === 'visual'");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("a checkout reply from an invalidated account closes its tab without navigating", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "app/dashboard/_components/VideoCreditRecharge.tsx", `
      window.requests=[];window.tabs=[];window.open=()=>{const tab={opener:{},location:{href:'about:blank'},closed:false,close(){this.closed=true}};window.tabs.push(tab);return tab};
      if(!crypto.randomUUID)crypto.randomUUID=()=>'fixture-request';
      window.fetch=(url,options)=>url==='/api/media-generation/quota'?Promise.resolve(Response.json({})):new Promise(resolve=>window.requests.push({url,method:options?.method||'GET',reply:data=>resolve(Response.json(data))}));
      const Panel=require('subject').VideoCreditPacksPanel;
      root.render(React.createElement(Panel));
      window.catalogue=accountId=>({accountId,actorAuthUserId:'actor',canPurchase:true,packs:[{key:'starter',available:true}],orders:[]});
    `, `{
      '@/lib/clientSubscriptionBilling':{detectClientBillingPlatform:()=> 'web'},
      '@/lib/boutique/videoCreditPacks':{VIDEO_CREDIT_PACKS:[{key:'starter',credits:100,priceEurHt:10}],isStripeCheckoutUrl:url=>url==='https://checkout.stripe.com/test'},
      '@/lib/boutique/imageCreditPacks':{IMAGE_CREDIT_PACKS:[{key:'starter',credits:100,priceEurHt:10}]}
    }`);
    await page.waitForFunction("window.requests.length === 1");
    await page.evaluate("window.dispatchEvent(new Event('fixture-account-change'))");
    await page.waitForFunction("window.requests.length === 2");
    await page.evaluate("window.requests[1].reply(window.catalogue('b'))");
    await page.getByRole("button", { name: /video_credit_buy/ }).click();
    await page.waitForFunction("window.requests.length === 3");
    await page.evaluate("window.requests[0].reply({...window.catalogue('a'),canPurchase:false});window.dispatchEvent(new Event('fixture-account-change'))");
    await page.waitForFunction("window.requests.length === 4");
    await page.evaluate("window.requests[3].reply(window.catalogue('c'));window.requests[2].reply({url:'https://checkout.stripe.com/test'})");
    await page.waitForFunction("window.tabs[0].closed");
    assert.equal(await page.evaluate("window.tabs[0].location.href"), "about:blank");
    assert.equal(await page.getByRole("link", { name: "video_credit_continue" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /video_credit_buy/ }).isEnabled(), true);
  } finally { await browser.close(); }
});

test("schedule initialization preserves edits across presentation rerenders and reloads only on opening or selection replacement", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "app/dashboard/_components/PublishScheduleModal.tsx", `
      window.config={open:true,styles:{},items:[{channel:'facebook',label:'Facebook',mediaLabel:'Image',blockers:[]}],initialSelections:[{channel:'facebook',scheduledAt:'2099-04-05T12:45:00Z'}],isMobile:false,saving:false,error:'',onClose:()=>{},onConfirm:()=>{}};
      window.configure=patch=>{window.config={...window.config,...patch};root.render(React.createElement(Subject,window.config))};window.configure({});
    `, `{
      'next/image':props=>React.createElement('img',props),'next/dynamic':()=>()=>null,
      '@/lib/inrcyDialog':{confirmInrcy:async()=>false},
      '../_hooks/useUnsavedExitGuard':{useUnsavedExitGuard:props=>{window.exitGuard=props;return{confirmExit:()=>{}}}},
      './PublishExecutionProgress':()=>null,
      '../booster/publier/components/publishChannelIdentity':{PUBLISH_CHANNEL_IDENTITY:{facebook:{}}}
    }`);
    const date = page.locator('input[type="date"]').first();
    await page.waitForFunction("document.querySelector('input[type=date]')?.value === '2099-04-05'");
    await date.fill("2099-05-20");
    await page.waitForFunction("window.exitGuard.shouldBlock");
    await page.evaluate("window.configure({items:[{channel:'facebook',label:'Nouveau libellé',mediaLabel:'Vidéo',blockers:[],warnings:['Actualisé']}],initialSelections:[...window.config.initialSelections]})");
    assert.equal(await date.inputValue(), "2099-05-20");
    assert.equal(await page.evaluate("window.exitGuard.shouldBlock"), true);
    await page.evaluate("window.configure({open:false})");
    await date.waitFor({ state: "detached" });
    await page.evaluate("window.configure({open:true})");
    await page.waitForFunction("document.querySelector('input[type=date]')?.value === '2099-04-05' && !window.exitGuard.shouldBlock");
    await page.evaluate("window.configure({initialSelections:[{channel:'facebook',scheduledAt:'2099-06-07T08:30:00Z'}]})");
    await page.waitForFunction("document.querySelector('input[type=date]')?.value === '2099-06-07' && !window.exitGuard.shouldBlock");
  } finally { await browser.close(); }
});

test("image adapter retains its opening baseline while edits arrive and refreshes it on reopen", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "app/dashboard/_components/channel-image-adapter/modal.tsx", `
      const Adapter=require('subject').ChannelImageAdapterModal;
      window.config={open:true,title:'Image',aspectRatio:'1/1',backgroundMode:'solid',backgroundColor:'#ffffff',fitLabel:'Fit',zoomLabel:'100%',previewRef:{current:null},onClose:()=>{}};
      window.configure=patch=>{window.config={...window.config,...patch};root.render(React.createElement(Adapter,window.config))};window.configure({});
    `, `{
      '../../_hooks/useUnsavedExitGuard':{useUnsavedExitGuard:props=>{window.exitGuard=props;return{confirmExit:()=>{}}}},
      '@/lib/imageOverlay':{getImageOverlayItems:()=>[],normalizeImageOverlay:()=>null,MAX_IMAGE_OVERLAY_ITEMS:5},
      '@/lib/imageOverlayLayout':{},
      './utils':{legacyColorFromMode:()=> '#fff',normalizedMode:value=>value,previewBackgroundStyle:()=>({}),MOBILE_DOCK_HEIGHT:80}
    }`);
    await page.waitForFunction("Boolean(window.exitGuard) && !window.exitGuard.shouldBlock");
    await page.evaluate("window.configure({backgroundColor:'#000000'})");
    await page.waitForFunction("window.exitGuard.shouldBlock");
    await page.evaluate("window.configure({title:'Image modifiée'})");
    assert.equal(await page.evaluate("window.exitGuard.shouldBlock"), true);
    await page.evaluate("window.configure({open:false})");
    await page.waitForFunction("!window.exitGuard.active");
    await page.evaluate("window.configure({open:true})");
    await page.waitForFunction("window.exitGuard.active && !window.exitGuard.shouldBlock");
    await page.evaluate("window.configure({backgroundColor:'#ffffff'})");
    await page.waitForFunction("window.exitGuard.shouldBlock");
  } finally { await browser.close(); }
});

test("provided image dimensions supersede late decoding without reacting to equivalent object identities", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "app/dashboard/_components/channel-image-adapter/hooks.ts", `
      window.images=[];window.Image=class{constructor(){window.images.push(this)}naturalWidth=640;naturalHeight=480;};
      const useMeta=require('subject').useNaturalImageMeta;
      function Harness(props){window.meta=useMeta(props.src,props.provided);return React.createElement('output',null,JSON.stringify(window.meta))}
      window.config={src:'first'};window.configure=patch=>{window.config={...window.config,...patch};root.render(React.createElement(Harness,window.config))};window.configure({});
    `);
    await page.waitForFunction("window.images.length === 1");
    await page.evaluate("window.configure({provided:{width:100,height:200}})");
    await page.waitForFunction("window.meta?.width === 100");
    await page.evaluate("window.images[0].onload();window.configure({provided:{width:100,height:200}})");
    assert.deepEqual(await page.evaluate("window.meta"), { width: 100, height: 200 });
    assert.equal(await page.evaluate("window.images.length"), 1);
    await page.evaluate("window.configure({src:'second',provided:undefined})");
    await page.waitForFunction("window.images.length === 2");
    await page.evaluate("window.images[1].onload()");
    await page.waitForFunction("window.meta?.width === 640");
    await page.evaluate("window.images[0].onerror()");
    assert.deepEqual(await page.evaluate("window.meta"), { width: 640, height: 480 });
  } finally { await browser.close(); }
});

test("camera translations update without restarting the stream or clearing a capture failure", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "app/dashboard/_components/InrcyCameraCaptureModal.tsx", `
      window.cameraStarts=0;window.cameraStops=0;window.translator=key=>'fr:'+key;
      const track={stop:()=>window.cameraStops++,getCapabilities:()=>({})};const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
      Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.cameraStarts++;return stream},enumerateDevices:async()=>[{kind:'videoinput'}]}});
      Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{configurable:true,writable:true,value:null});HTMLMediaElement.prototype.play=()=>Promise.resolve();HTMLMediaElement.prototype.pause=()=>{};
      HTMLCanvasElement.prototype.getContext=()=>null;
      window.config={open:true,onClose:()=>{},onCapture:()=>{},initialMode:'photo'};
      window.configure=patch=>{window.config={...window.config,...patch};root.render(React.createElement(Subject,window.config))};window.configure({});
    `, `{'next-intl':{useTranslations:()=>window.translator},'@/lib/mediaRules':{INR_MEDIA_VIDEO_SOURCE_MAX_BYTES:10000000}}`);
    const capture = page.getByRole("button", { name: "fr:capture_take_photo" });
    await capture.waitFor();
    await page.waitForFunction("window.cameraStarts === 1");
    await page.evaluate("window.translator=key=>'en:'+key;window.configure({})");
    await page.getByRole("button", { name: "en:capture_take_photo" }).click();
    await page.getByText("en:capture_impossible_sur_ce_navigateur_85e428b9", { exact: true }).waitFor();
    await page.evaluate("window.translator=key=>'de:'+key;window.configure({})");
    await page.getByText("de:capture_impossible_sur_ce_navigateur_85e428b9", { exact: true }).waitFor();
    assert.equal(await page.evaluate("window.cameraStarts"), 1);
    assert.equal(await page.evaluate("window.cameraStops"), 0);
    await page.evaluate("window.configure({open:false})");
    await page.waitForFunction("window.cameraStops === 1");
  } finally { await browser.close(); }
});

test("dictation rerenders keep recording alive and unmount restores the draft through current callbacks", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "app/dashboard/_components/MediaSubjectVoiceButton.tsx", `
      Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});
      Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:undefined});
      window.recognitions=[];window.stops=0;window.changes=[];window.busy=[];
      window.SpeechRecognition=class{constructor(){window.recognitions.push(this)}start(){}stop(){window.stops++}abort(){window.stops++}};
      window.config={value:'Texte initial',onChange:value=>window.changes.push(['initial',value]),onBusyChange:value=>window.busy.push(['initial',value])};
      window.configure=patch=>{window.config={...window.config,...patch};root.render(React.createElement(Subject,window.config))};window.unmount=()=>root.unmount();window.configure({});
    `);
    await page.getByRole("button", { name: "voice_subject_title" }).click();
    await page.waitForFunction("window.recognitions.length === 1 && document.querySelector('button').getAttribute('data-recording') === 'true'");
    await page.evaluate("window.recognitions[0].onresult({results:[[{transcript:'Bonjour'}]]})");
    await page.waitForFunction("window.changes.length === 1");
    await page.evaluate("window.configure({value:'Texte initial Bonjour',onChange:value=>window.changes.push(['current',value]),onBusyChange:value=>window.busy.push(['current',value])})");
    assert.equal(await page.locator("#root button").getAttribute("data-recording"), "true");
    assert.equal(await page.evaluate("window.stops"), 0);
    await page.evaluate("window.unmount()");
    assert.deepEqual(await page.evaluate("window.changes.at(-1)"), ["current", "Texte initial"]);
    assert.deepEqual(await page.evaluate("window.busy.at(-1)"), ["current", false]);
    assert.equal(await page.evaluate("window.stops"), 1);
  } finally { await browser.close(); }
});

test("Agent responses and editorial polls use current view policy without refetching on every render", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, "app/dashboard/agent/_hooks/useAgentRuntimeData.ts", `
      window.metaEnabled=false;window.requests=[];window.activeIntervals=new Map();let nextInterval=0;
      window.setInterval=callback=>{window.activeIntervals.set(++nextInterval,callback);return nextInterval};window.clearInterval=id=>window.activeIntervals.delete(id);
      window.fetch=(url)=>new Promise(resolve=>window.requests.push({url,reply:body=>resolve(Response.json(body))}));
      const useData=require('subject').useAgentRuntimeData;
      function Harness(props){window.hook=useData(props);return React.createElement('output',null,window.hook.loadState)}
      window.config={standardMode:false};window.configure=patch=>{window.config={...window.config,...patch};root.render(React.createElement(Harness,window.config))};window.configure({});
    `, `{
      '../../_components/DashboardViewerAccessProvider':{useDashboardViewerAccess:()=>({metaPilotEnabled:window.metaEnabled})},
      '@/lib/metaChannelUiAccess':{filterMetaPilotPayload:value=>value,filterMetaPilotItems:(items,enabled)=>items.filter(item=>enabled||!item.meta)},
      '@/lib/browserAccountCache':{getActiveBrowserUserId:()=> 'account-a',readAccountCacheValue:()=>null,writeAccountCacheValue:()=>{}},
      '@/lib/channelConnectionUpdates':{subscribeToChannelConnectionUpdates:()=>()=>{}},
      '@/lib/inrAgentSettings':{INR_AGENT_DEFAULT_SETTINGS:{automations:{}},sanitizeInrAgentSettings:value=>value},
      '../_lib/agent.config':{DASHBOARD_CHANNEL_STATE_CACHE_KEY:'channels',INR_AGENT_VIEW_CACHE_KEY:'view',INR_AGENT_VIEW_CACHE_MAX_AGE_MS:100000},
      '../_lib/agent.settings':{settingsToConfigs:()=>({}),normalizeConfigsForConnectedChannels:current=>current,sanitizeCachedConnectedChannels:value=>value,isCachedPreparedAction:()=>true,isCachedScheduledAction:()=>true},
      '../_lib/agent.utils':{asRecord:value=>value&&typeof value==='object'?value:null},
      '@/lib/inrAgentPublicationHistory':{agentPublicationHistoryWindow:()=>({from:'start',to:'end'})},
      '@/lib/standardAgentPolicy':{restrictInrAgentSettingsForStandard:value=>({...value,standard:true}),filterStandardAgentItems:items=>items.filter(item=>item.standard!==false)}
    }`);
    await page.waitForFunction("window.requests.length === 5");
    await page.evaluate("window.metaEnabled=true;window.configure({standardMode:true})");
    assert.equal(await page.evaluate("window.requests.length"), 5, "view-only rerenders do not restart background reads");
    await page.evaluate("window.requests.find(r=>r.url==='/api/agent/settings').reply({settings:{automations:{},marker:'loaded'}});window.requests.find(r=>r.url==='/api/integrations/channel-states').reply({threads:{connected:true}})");
    await page.waitForFunction("window.hook.agentSettings.marker === 'loaded' && window.hook.agentConnectedChannels?.threads === true");
    assert.equal(await page.evaluate("window.hook.agentSettings.standard"), true, "the pending response applies the latest standard policy");
    await page.evaluate("window.requests.find(r=>r.url==='/api/agent/actions').reply({actions:[{id:'preparing',automationKey:'publish',status:'draft',payload:{editorialPlan:{}}}]});window.requests.find(r=>r.url==='/api/agent/scheduled-actions').reply({scheduledActions:[]});window.requests.find(r=>r.url.startsWith('/api/agent/publication-history')).reply({historyPublications:[]})");
    await page.waitForFunction("window.activeIntervals.size === 1");
    await page.evaluate("window.configure({standardMode:true})");
    await page.evaluate("[...window.activeIntervals.values()][0]()");
    await page.waitForFunction("window.requests.length === 6");
    assert.equal(await page.evaluate("window.requests[5].url"), "/api/agent/actions", "poll does not refresh unrelated history");
    await page.evaluate("window.requests[5].reply({actions:[{id:'restricted',standard:false,automationKey:'publish',status:'draft',payload:{editorialPlan:{}}}]})");
    await page.waitForFunction("window.hook.actions.length === 0 && window.activeIntervals.size === 0");
  } finally { await browser.close(); }
});
