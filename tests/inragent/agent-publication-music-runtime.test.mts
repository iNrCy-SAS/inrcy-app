import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import ts from "typescript";
import { runtimeModules } from "./runtime-module-loader.mts";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compileText = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const catalogue = runtimeModules()<typeof import("../../lib/boosterSoundtracks.ts")>("lib/boosterSoundtracks.ts").getBoosterSoundtrackCatalog();

function agentSource() { return ts.createSourceFile("AgentClient.tsx", read("app/dashboard/agent/AgentClient.tsx"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX); }
function optionsJsx() {
  const source = agentSource(); let result: ts.JsxElement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "article" && node.openingElement.attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.getText(source) === "className" && property.initializer?.getText(source).includes("styles.publicationFormatCard"))) result = node;
    ts.forEachChild(node, visit);
  }; visit(source); assert.ok(result, "Render the actual Agent Options card rather than a parallel implementation"); return result.getText(source);
}

function saveFunction() {
  const source = agentSource(); let result: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'savePublishSoundtrack') result = node; ts.forEachChild(node, visit); };
  visit(source); assert.ok(result); return result.getText(source).replace('savePublishSoundtrack(', 'actualSavePublishSoundtrack(');
}

function agentExpression(name: string) {
  const source = agentSource(); let result: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) result = node.initializer; ts.forEachChild(node, visit); };
  visit(source); assert.ok(result, `${name} must come from the actual Agent component`); return result.getText(source);
}

function fixture() {
  const sources = {
    react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
    "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"),
    selector: compileText(read("app/dashboard/_components/MediaSoundtrackSelector.tsx")), "@/lib/mediaSoundtrackSelection": compileText(read("lib/mediaSoundtrackSelection.ts")),
    identity: compileText(read("app/dashboard/booster/publier/components/publishChannelIdentity.ts")),
    queue: compileText(read("lib/inrAgentPublicationSoundtrackSaveQueue.ts")),
    soundtrack: compileText(read("lib/inrAgentPublicationSoundtrack.ts")),
    "./mediaSoundtrackSelection.ts": compileText(read("lib/mediaSoundtrackSelection.ts")),
    "./inrAgentPublicationPlacement.ts": compileText(read("lib/inrAgentPublicationPlacement.ts")),
    "./metaPublicationTargets.ts": compileText(read("lib/metaPublicationTargets.ts")),
  };
  const compiled = compileText(`const React=require('react'),styles=new Proxy({},{get:(_,key)=>String(key)}),MediaSoundtrackSelector=require('selector').default,PUBLISH_CHANNEL_IDENTITY=require('identity').PUBLISH_CHANNEL_IDENTITY;
    const {createInrAgentPublicationSoundtrackSaveQueue}=require('queue'),{readInrAgentPublicationSoundtrack,applyInrAgentPublicationSoundtrack}=require('soundtrack');
    const AutomationSettingsIcon=()=>React.createElement('span',null,'⚙');
    exports.default=function AgentOptions(props){
      const [channel,setChannel]=React.useState('facebook'),[placement,setPlacement]=React.useState('classic'),[story,setStory]=React.useState(false),[selection,setSelection]=React.useState({facebook:null,instagram:null});
      const [publishSoundtrackDrafts,setPublishSoundtrackDrafts]=React.useState({}),publishSoundtrackVersionsRef=React.useRef(new Map()),publishSoundtrackQueuesRef=React.useRef(new Map()),publishSoundtrackSavedActionsRef=React.useRef(new Map());
      window.changeChannel=setChannel;window.setPlacement=setPlacement;window.restoreMusic=(key,id)=>setSelection(previous=>({...previous,[key]:id}));window.confirmedMusic=selection;
      const activePreviewChannel=channel,activeMetaPublicationChannel=channel==='facebook'||channel==='instagram'?channel:null,publishPlacement=placement,publishIncludeStory=story;
      const publishContentFormat=${agentExpression('publishContentFormat')};window.currentPlacement={primaryPlacement:placement,includeStory:story};
      const publishPlacementOptions=['classic','reel','story'],publishPlacementEnabled=true,publishStoryOptionEnabled=true,selectedPreparedAction={id:'action-one',payload:{soundtrackByChannel:selection}},actionMutationState=props.busy?'saving':'idle';
      const publishSoundtrackDraftKey=${agentExpression('publishSoundtrackDraftKey')},publishSoundtrackId=${agentExpression('publishSoundtrackId')};
      window.currentMusic={...selection,[channel]:publishSoundtrackId};window.flushMusic=()=>publishSoundtrackQueuesRef.current.get('action-one')?.flush();
      const publishSoundtrackEligible=!!activeMetaPublicationChannel&&(placement==='reel'||placement==='story'||story)&&!props.importedVideo,publishSoundtrackLocked=!!props.resumeLocked,canEditPublicationSoundtrack=!props.locked,publishPlacementSaveState='idle',publishChannelSelectionSaving=false,isAgentActionAwaitingValidation=()=>true;
      const canReviewSelectedAction=${agentExpression('canReviewSelectedAction')};
      const savePublishPlacement=(next,include)=>{window.placementCalls.push({primaryPlacement:next,includeStory:include});setPlacement(next);setStory(include);},savePublishSoundtrack=props.actualSave?actualSavePublishSoundtrack:id=>{if(activeMetaPublicationChannel)setSelection(previous=>({...previous,[activeMetaPublicationChannel]:id}));};
      const secondaryStoryAvailable=false,showingSecondaryStory=false,secondaryStoryKey='',setPublishStoryPreviewKey=()=>{},publishMediaPreview={kind:'image'},asRecord=value=>value,scheduledEditSession=null;
      const canReviseInrAgentPublication=()=>true,scheduledEditDirty=false,saveState='idle',publishSaveState='idle',prepareActionState='idle',testNowKey=null,publishRegeneration=null,publishPreparationInProgress=false;
      const canEditSelectedPublication=${agentExpression('canEditSelectedPublication')},canRegenerateSelectedPublication=${agentExpression('canRegenerateSelectedPublication')},agentWorking=${agentExpression('agentWorking')};
      window.actionGates={canReviewSelectedAction,canEditSelectedPublication,canRegenerateSelectedPublication,agentWorking};
      const saveTiktokPhotoFormat=()=>{},metaPilotEnabled=false,activeThreadsPublicationMode='classic',threadsModeEnabled=true,threadsModeSaveState='idle',threadsPublicationPreferences={},getEnabledThreadsPublicationModes=()=>['classic'],saveThreadsPublicationMode=()=>{};
      const activePinterestBoardId='board-one',savePublishPinterestBoard=()=>{},pinterestBoardsLoading=false,pinterestBoardSaveState='idle',pinterestBoards=[{id:'board-one',name:'Mon tableau'}],pinterestBoardsError='';
      const i18nT=key=>messages.agent[key]||key,boosterRuntimeT=key=>messages.booster[key]||key,boosterT=boosterRuntimeT,runtimeT=i18nT,agentChannelLabel=key=>({facebook:'Facebook',instagram:'Instagram'}[key]||key);
      const setNotice=value=>window.notice=value,showNotice=value=>window.notice=value,setActions=updater=>setSelection(current=>updater([{...selectedPreparedAction,payload:{soundtrackByChannel:current}}])[0].payload.soundtrackByChannel),inrAgentPublicationNeedsRevisionReview=()=>false,refreshScheduledActions=async()=>{};
      ${saveFunction()}
      return ${optionsJsx()};
    };`);
  return `const sources=${JSON.stringify({ ...sources, options: compiled })},messages=${JSON.stringify({ agent: JSON.parse(read("messages/fr-FR/agent.json")), booster: JSON.parse(read("messages/fr-FR/booster.json")) })},catalogue=${JSON.stringify(catalogue)},loaded={};
    function require(name){if(name.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>'music-'+String(key)})};if(name==='next-intl')return{useTranslations:namespace=>(key,args={})=>Object.entries(args).reduce((text,[name,value])=>text.replaceAll('{'+name+'}',String(value)),messages[namespace][key]||key)};if(loaded[name])return loaded[name].exports;if(!sources[name])throw Error('Unexpected Agent music fixture import '+name);const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;}
    const React=require('react'),Options=require('options').default,root=require('react-dom/client').createRoot(document.getElementById('root'));let config={locked:false,busy:false};window.configure=patch=>{config={...config,...patch};root.render(React.createElement(Options,config))};window.activeAudio=new Set();window.catalogueCalls=0;window.otherCalls=[];window.patchCalls=[];window.placementCalls=[];window.serverMusic={facebook:null,instagram:null};const pendingSaves=[];let responseVersion=0;
    HTMLMediaElement.prototype.play=function(){window.activeAudio.add(this);return Promise.resolve()};HTMLMediaElement.prototype.pause=function(){window.activeAudio.delete(this)};HTMLMediaElement.prototype.load=function(){};
    window.completeSave=ok=>{const pending=pendingSaves.shift();if(!pending)throw Error('No pending mocked save');const {body,resolve}=pending;if(ok)window.serverMusic={...window.serverMusic,[body.channel]:body.soundtrackId};resolve(Response.json(ok?{action:{id:body.actionId,updatedAt:new Date(++responseVersion*1000).toISOString(),payload:{soundtrackByChannel:{...window.serverMusic}}}}:{error:'Synthetic soundtrack update failure'},{status:ok?200:503}))};
    window.fetch=async(url,options)=>{if(url==='/api/agent/actions'&&config.actualSave){if(options.method!=='PATCH')throw Error('Only mocked soundtrack PATCH is allowed');const body=JSON.parse(options.body);window.patchCalls.push(body);return new Promise(resolve=>pendingSaves.push({body,resolve}))}if(url!=='/api/booster/soundtracks'){window.otherCalls.push(url);throw Error('No actual publication, AI generation or persistence allowed')}window.catalogueCalls++;if(options.credentials!=='same-origin')throw Error('Catalogue credentials are required');return Response.json({ok:true,soundtracks:catalogue})};window.configure({});`;
}

type State = { changeChannel: (channel: string) => void; setPlacement: (placement: string) => void; restoreMusic: (channel: string, id: string | null) => void; configure: (patch: Record<string, unknown>) => void; currentMusic: Record<string, string | null>; confirmedMusic: Record<string, string | null>; serverMusic: Record<string, string | null>; flushMusic: () => Promise<void>; actionGates: { canReviewSelectedAction: boolean; canEditSelectedPublication: boolean; canRegenerateSelectedPublication: boolean; agentWorking: boolean }; currentPlacement: { primaryPlacement: string; includeStory: boolean }; placementCalls: Array<{ primaryPlacement: string; includeStory: boolean }>; activeAudio: Set<unknown>; otherCalls: string[]; catalogueCalls: number; patchCalls: Array<Record<string, unknown>>; completeSave: (ok: boolean) => void; notice: string | null };
async function setup(page: Page) {
  page.setDefaultTimeout(5_000);
  const css = read("app/dashboard/agent/agent.module.css").replace(/:global\(([^)]+)\)/g, "$1") + read("app/dashboard/_components/MediaSoundtrackSelector.module.css").replace(/\.([a-zA-Z_][\w-]*)/g, ".music-$1");
  await page.route("**/*", route => route.abort());
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,::before,::after{box-sizing:border-box;margin:0;padding:0}dialog{margin:0}${css}body{padding:16px;background:#080c22;color:white;font:14px Arial}.publishPreview{max-width:1180px;margin:auto}[data-following-preview]{position:relative;z-index:1;min-height:250px;margin-top:12px;background:#15274a}</style></head><body><div class="publishPreview"><div class="publishInfoGrid publishInfoGridWithFormat"><article class="campaignInfoCard">Date</article><article class="campaignInfoCard">Sujet</article><article class="campaignInfoCard">Canal</article><article class="campaignInfoCard">Média</article><div id="root" style="display:contents"></div></div><section class="publishPostCarousel" data-following-preview>Publication preview</section></div></body></html>`);
  await page.addScriptTag({ content: fixture() });
}

test("Agent Options keeps both menus on one row inside the original equal desktop cards and 76px height", async () => {
  const browser = await chromium.launch({ headless: true });
  try { for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 844, height: 700 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: true }), errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); await setup(page);
    const card = page.locator('.publicationFormatCard'), field = card.locator('[data-soundtrack-inline]'), trigger = field.getByRole('combobox'), format = card.locator('select'); await trigger.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-soundtrack-inline] [role="combobox"]')?.getAttribute('aria-busy') === 'false');
    assert.equal(await trigger.getAttribute('aria-disabled'), 'false'); assert.equal(await trigger.getAttribute('data-unavailable'), 'true', 'Classic keeps a grey but usable preparation field'); assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await card.getByRole('checkbox').count(), 0, 'The combined format selector replaces the separate Story checkbox');
    assert.deepEqual(await format.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), ['classic', 'reel', 'story', 'classic_story', 'reel_story']);
    assert.deepEqual(await page.evaluate(() => (window as unknown as State).currentMusic), { facebook: null, instagram: null }, 'Auto is the default for both Meta channels');
    const bounds = await card.boundingBox(), buttonBounds = await trigger.boundingBox(), selectBounds = await format.boundingBox(), playBounds = await field.locator('.music-preview').boundingBox(); assert.ok(bounds && buttonBounds && selectBounds && playBounds);
    for (const control of [buttonBounds, selectBounds, playBounds]) assert.ok(control.x >= bounds.x - 1 && control.x + control.width <= bounds.x + bounds.width + 1 && control.y >= bounds.y - 1 && control.y + control.height <= bounds.y + bounds.height + 1, 'Every Options control remains within its card');
    assert.ok(Math.abs(buttonBounds.y - selectBounds.y) <= 1, `Format and music always stay on the same row: ${JSON.stringify({ viewport, selectBounds, buttonBounds })}`);
    assert.ok(Math.abs(buttonBounds.width - selectBounds.width) <= 1, `The format selector and actual music combobox have identical widths: ${JSON.stringify({ viewport, selectBounds, buttonBounds })}`);
    assert.ok(buttonBounds.x >= selectBounds.x + selectBounds.width - 1, 'The music menu follows the format menu horizontally');
    assert.ok(Math.abs(bounds.height - 76) <= 1, 'Options retains the original 76px card height');
    if (viewport.width > 1250) { const widths = await page.locator('.publishInfoGrid > article').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().width)); assert.ok(widths.every(width => Math.abs(width - bounds.width) <= 1), 'Options never widens at the expense of neighboring cards'); }
    await trigger.click(); const list = field.getByRole('listbox'); await list.waitFor(); assert.equal(await list.getByRole('option').count(), catalogue.length + 1);
    const listBounds = await list.boundingBox(); assert.ok(listBounds && listBounds.height <= 176 && listBounds.x >= 0 && listBounds.x + listBounds.width <= viewport.width + 1);
    const clipping = await list.evaluate(element => { const rect = element.getBoundingClientRect(), clipped: string[] = []; for (let parent = element.parentElement; parent; parent = parent.parentElement) { const style = getComputedStyle(parent), box = parent.getBoundingClientRect(); if (style.overflowX !== 'visible' && (rect.left < box.left - 1 || rect.right > box.right + 1) || style.overflowY !== 'visible' && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) clipped.push(parent.className); } return clipped; }); assert.deepEqual(clipping, [], 'The dropdown is not clipped by Options or its grid');
    assert.equal(await list.evaluate(element => { const bounds = element.getBoundingClientRect(); return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + Math.min(bounds.height / 2, 50))?.closest('[role="listbox"]') === element; }), true, 'Music choices stay above the neighboring publication preview');
    await field.getByRole('option', { name: catalogue[2].label, exact: true }).click(); await field.locator('.music-preview').click(); assert.equal(await list.isVisible(), true); assert.equal(await page.evaluate(() => (window as unknown as State).activeAudio.size), 1);
    if (process.env.INRCY_AGENT_MUSIC_PROOF) await page.screenshot({ path: `${process.env.INRCY_AGENT_MUSIC_PROOF}-inline-options-${viewport.width}.png` });
    assert.ok((await trigger.getAttribute('aria-label'))?.includes(catalogue[2].label), 'A truncated music name remains available in its full accessible label');
    await page.keyboard.press('Escape'); await list.waitFor({ state: 'hidden' });
    for (const channel of ['gmb', 'threads', 'pinterest', 'tiktok']) { await page.evaluate(channel => (window as unknown as State).changeChannel(channel), channel); await page.waitForFunction(() => document.querySelectorAll('.publicationFormatCard [data-soundtrack-inline]').length === 0); }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => (window as unknown as State).otherCalls), []); await page.close();
  } } finally { await browser.close(); }
});

test("Agent's inline music list remains visible during selection and listening and retains independent choices", async () => {
  const browser = await chromium.launch({ headless: true });
  try { for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }), errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await setup(page);
    await page.evaluate(() => (window as unknown as State).setPlacement('reel'));
    const field = page.locator('.publicationFormatCard [data-soundtrack-inline]'), trigger = field.getByRole('combobox'); await page.waitForFunction(() => (document.querySelector('.publicationFormatCard select') as HTMLSelectElement)?.value === 'reel'); await trigger.click();
    const list = field.getByRole('listbox'), preview = field.locator('.music-preview'); await list.waitFor(); assert.equal(await list.getByRole('option').count(), catalogue.length + 1); assert.equal(await page.getByRole('dialog').count(), 0);
    const listBounds = await list.boundingBox(); assert.ok(listBounds && listBounds.height <= 176);
    await field.getByRole('option', { name: catalogue[0].label, exact: true }).click(); await preview.click(); assert.equal(await list.isVisible(), true); assert.equal(await page.evaluate(() => (window as unknown as State).activeAudio.size), 1);
    await list.focus(); await list.press('End'); await list.press('Enter'); assert.equal(await list.isVisible(), true); assert.equal(await page.evaluate(() => (window as unknown as State).activeAudio.size), 0);
    await page.keyboard.press('Escape'); await list.waitFor({ state: 'hidden' }); assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    assert.equal(await page.evaluate(() => (window as unknown as State).currentMusic.facebook), catalogue.at(-1)!.id);
    await page.evaluate(() => (window as unknown as State).changeChannel('instagram')); await page.locator('[data-agent-publication-music="instagram"]').waitFor(); await trigger.click(); await list.waitFor(); assert.equal((await trigger.textContent())?.trim(), 'Auto'); await field.getByRole('option', { name: catalogue[1].label, exact: true }).click(); await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => (window as unknown as State).currentMusic), { facebook: catalogue.at(-1)!.id, instagram: catalogue[1].id });
    await page.evaluate(() => (window as unknown as State).restoreMusic('instagram', 'legacy-saved-track')); await trigger.click(); await list.waitFor();
    const previousLabel = JSON.parse(read('messages/fr-FR/booster.json')).publication_music_previous; await field.getByRole('option', { name: previousLabel, exact: true }).waitFor(); assert.equal(await field.getByRole('option', { name: previousLabel, exact: true }).getAttribute('aria-disabled'), 'true');
    await page.evaluate(() => (window as unknown as State).configure({ resumeLocked: true })); await page.waitForFunction(() => document.querySelector('[data-soundtrack-inline] [role="listbox"]')?.getAttribute('aria-disabled') === 'true');
    assert.equal(await preview.isDisabled(), true); assert.equal(await page.evaluate(() => (window as unknown as State).currentMusic.instagram), 'legacy-saved-track'); await page.keyboard.press('Escape');
    await page.evaluate(() => (window as unknown as State).configure({ busy: true })); await page.waitForFunction(() => (document.querySelector('.publicationFormatCard [data-soundtrack-inline] [role="combobox"]') as HTMLButtonElement)?.disabled === true);
    assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => (window as unknown as State).otherCalls), []); await page.close();
  } } finally { await browser.close(); }
});

test("the actual Agent callback selects optimistically, coalesces rapid choices, and rolls back to Auto after an API failure", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await setup(page);
    await page.evaluate(() => (window as unknown as State).configure({ actualSave: true }));
    const field = page.locator('.publicationFormatCard [data-soundtrack-inline]'), trigger = field.getByRole('combobox'), preview = field.locator('.music-preview'), format = page.locator('.publicationFormatCard select'); await trigger.click();
    const list = field.getByRole('listbox'); await list.waitFor(); await field.getByRole('option', { name: catalogue[0].label, exact: true }).click();
    await page.waitForFunction(() => (window as unknown as State).patchCalls.length === 1);
    assert.equal((await trigger.textContent())?.trim(), catalogue[0].label, 'The label changes before the network response');
    assert.equal(await page.evaluate(() => (window as unknown as State).confirmedMusic.facebook), null, 'Only a response updates the saved action');
    assert.deepEqual(await page.evaluate(() => (window as unknown as State).patchCalls[0]), { actionId: 'action-one', editType: 'publish_channel_soundtrack', channel: 'facebook', soundtrackId: catalogue[0].id });
    for (const track of [catalogue[1], catalogue[2]]) {
      await field.getByRole('option', { name: track.label, exact: true }).click();
      assert.equal((await trigger.textContent())?.trim(), track.label);
      assert.equal(await list.isVisible(), true); assert.equal(await list.getAttribute('aria-disabled'), 'false');
      assert.equal(await trigger.isEnabled(), true); assert.equal(await preview.isEnabled(), true); assert.equal(await format.isEnabled(), true, 'A soundtrack save never freezes the format selector');
      assert.deepEqual(await page.evaluate(() => (window as unknown as State).actionGates), { canReviewSelectedAction: true, canEditSelectedPublication: true, canRegenerateSelectedPublication: true, agentWorking: false }, 'The actual review, edit, regeneration and working guards remain idle during music saves');
      await preview.click(); assert.equal(await page.evaluate(() => (window as unknown as State).activeAudio.size), 1, 'A new optimistic selection can be previewed while requests are pending');
    }
    assert.equal(await page.evaluate(() => (window as unknown as State).patchCalls.length), 1, 'Later choices wait behind the active save');
    await page.evaluate(() => (window as unknown as State).completeSave(true)); await page.waitForFunction(() => (window as unknown as State).patchCalls.length === 2);
    assert.equal((await trigger.textContent())?.trim(), catalogue[2].label, 'The older response cannot overwrite the newest selection');
    assert.equal(await page.evaluate(() => (window as unknown as State).confirmedMusic.facebook), catalogue[0].id);
    assert.deepEqual(await page.evaluate(() => (window as unknown as State).patchCalls.map(call => call.soundtrackId)), [catalogue[0].id, catalogue[2].id], 'The real queue coalesces the middle choice');
    assert.equal(await list.isVisible(), true); assert.equal(await preview.isEnabled(), true); assert.equal(await format.isEnabled(), true);
    await page.evaluate(() => (window as unknown as State).completeSave(true)); await page.evaluate(() => (window as unknown as State).flushMusic());
    await page.waitForFunction(id => (window as unknown as State).confirmedMusic.facebook === id, catalogue[2].id);
    assert.equal(await page.evaluate(() => (window as unknown as State).serverMusic.facebook), catalogue[2].id, 'The last choice is the final persisted value');
    await field.getByRole('option', { name: 'Auto', exact: true }).click(); await page.waitForFunction(() => (window as unknown as State).patchCalls.length === 3);
    assert.equal((await trigger.textContent())?.trim(), 'Auto'); assert.equal(await page.evaluate(() => (window as unknown as State).patchCalls[2].soundtrackId), null, 'Auto is sent as explicit null');
    await page.evaluate(() => (window as unknown as State).completeSave(true)); await page.evaluate(() => (window as unknown as State).flushMusic()); await page.waitForFunction(() => (window as unknown as State).confirmedMusic.facebook === null);
    await field.getByRole('option', { name: catalogue[3].label, exact: true }).click(); await page.waitForFunction(() => (window as unknown as State).patchCalls.length === 4);
    assert.equal((await trigger.textContent())?.trim(), catalogue[3].label); await preview.click(); assert.equal(await page.evaluate(() => (window as unknown as State).activeAudio.size), 1);
    await page.evaluate(() => (window as unknown as State).completeSave(false)); await page.waitForFunction(() => (window as unknown as State).notice === 'Synthetic soundtrack update failure');
    await page.waitForFunction(() => (window as unknown as State).currentMusic.facebook === null); await page.evaluate(() => (window as unknown as State).flushMusic());
    assert.equal((await trigger.textContent())?.trim(), 'Auto', 'An unsuccessful newest choice rolls back to the confirmed Auto value');
    assert.equal(await page.evaluate(() => (window as unknown as State).serverMusic.facebook), null); assert.equal(await list.isVisible(), true); assert.equal(await format.isEnabled(), true); assert.equal(await trigger.isEnabled(), true);
    assert.equal(await page.evaluate(() => (window as unknown as State).activeAudio.size), 0, 'Rollback stops the discarded track preview');
    assert.deepEqual(await page.evaluate(() => (window as unknown as State).otherCalls), []); assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); }
});

test("the five combined formats send their exact placement and Story pair without changing the saved music", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await setup(page); const format = page.locator('.publicationFormatCard select'); await format.waitFor();
    await page.evaluate(id => (window as unknown as State).restoreMusic('facebook', id), catalogue[4].id);
    const cases = [
      ['classic', 'classic', false], ['reel', 'reel', false], ['story', 'story', false], ['classic_story', 'classic', true], ['reel_story', 'reel', true],
    ] as const;
    for (const [value, primaryPlacement, includeStory] of cases) {
      await format.selectOption(value); await page.waitForFunction(expected => { const state = window as unknown as State; return state.currentPlacement.primaryPlacement === expected.primaryPlacement && state.currentPlacement.includeStory === expected.includeStory; }, { primaryPlacement, includeStory });
      assert.equal(await format.inputValue(), value); assert.deepEqual(await page.evaluate(() => (window as unknown as State).placementCalls.at(-1)), { primaryPlacement, includeStory });
      assert.deepEqual(await page.evaluate(() => (window as unknown as State).currentMusic), { facebook: catalogue[4].id, instagram: null });
    }
    assert.equal(await page.locator('.publicationFormatCard input[type="checkbox"]').count(), 0); assert.deepEqual(await page.evaluate(() => (window as unknown as State).otherCalls), []); await page.close();
  } finally { await browser.close(); }
});
