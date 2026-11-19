import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { durationReviewItems } from "./booster-duration-readiness-fixture.mts";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources = {
  react: packageSource("react", "react.production.js"),
  "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"),
  scheduler: packageSource("scheduler", "scheduler.production.js"),
  board: compile("app/dashboard/booster/publier/components/PublishValidationBoard.tsx"),
  options: compile("app/dashboard/booster/publier/components/PublishValidationChannelOptions.tsx"),
  "@/lib/metaImageMotionTiming": compile("lib/metaImageMotionTiming.ts"),
  "@/app/dashboard/_components/MediaSoundtrackSelector": compile("app/dashboard/_components/MediaSoundtrackSelector.tsx"),
  "@/lib/mediaSoundtrackSelection": compile("lib/mediaSoundtrackSelection.ts"),
  "./publishChannelIdentity": compile("app/dashboard/booster/publier/components/publishChannelIdentity.ts"),
};
const messages = JSON.parse(read("messages/fr-FR/booster.json"));
const catalogue = runtimeModules()<typeof import("../../lib/boosterSoundtracks.ts")>("lib/boosterSoundtracks.ts").getBoosterSoundtrackCatalog();
const icons = new Map([...read("app/dashboard/booster/publier/components/publishChannelIdentity.ts").matchAll(/icon: "([^"]+)"/g)].map(([,name]) => [name,readFileSync(new URL(`../../public${name}`,import.meta.url))]));
const fixture = `
const sources=${JSON.stringify(sources)},messages=${JSON.stringify(messages)},catalogue=${JSON.stringify(catalogue)},loaded={};
function require(name){
 if(name.endsWith('useInrAssistantLocalInterface'))return {useInrAssistantLocalInterface(){}};
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>(name.includes('MediaSoundtrackSelector')?'music-':name.includes('PublishValidationChannelOptions')?'opts-':'')+String(key)})};
 if(name==='next-intl')return {useTranslations:()=> (key,args={})=>{const text=Object.entries(args).reduce((text,[name,value])=>text.replaceAll('{'+name+'}',String(value)),messages[key]||key);if(key==='wizard_summary_ready')return args.count+' '+(args.count===1?'prêt':'prêts');if(key==='wizard_summary_alerts')return 'dont '+args.count+' '+(args.count===1?'alerte':'alertes');return text;}};
 if(name==='../publishModal.shared')return {channelSupportsImages:channel=>channel!=='youtube_shorts',getBoosterMaxImageCountForChannel:channel=>channel==='youtube_shorts'?1:5};
 if(name==='@/app/dashboard/_components/ChannelImageAdapterTool')return {ChannelPublicationPreview:({preview})=>require('react').createElement('section',{'data-native-preview':true,style:{overflow:'auto',width:'100%'}},preview.channelLabel+' — contenu complet de la publication')};
 if(name==='@/app/dashboard/_components/channel-image-adapter/native-publication-preview')return {PublicationPreviewDeviceTabs:()=>null};
 if(loaded[name])return loaded[name].exports;
 if(!sources[name])throw Error('Unexpected validation layout fixture module '+name);
 const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;
}
const React=require('react'),Board=require('board').default,ChannelOptions=require('options').default,identities=require('./publishChannelIdentity').PUBLISH_CHANNEL_IDENTITY;
// Two synthetic identities stress the requested 13-card layout alongside all
// real channels, without adding a channel or capability to the application.
identities.fixture12={...identities.facebook};identities.fixture13={...identities.instagram};
const labels={site_web:'Site web',gmb:'Google Business',inr_search:'iNr’Search',facebook:'Facebook',instagram:'Instagram',threads:'Threads',linkedin:'LinkedIn',tiktok:'TikTok',youtube_shorts:'YouTube',pinterest:'Pinterest',x:'X',fixture12:'Canal 12',fixture13:'Canal 13'};
const channels=['facebook','instagram','threads',...Object.keys(labels).filter(channel=>!['facebook','instagram','threads'].includes(channel))],image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#408bc4"/></svg>');
const root=require('react-dom/client').createRoot(document.getElementById('root'));
window.nativeCalls=0;window.catalogueCalls=0;window.activeAudio=new Set();let fixtureConfig={count:13,modes:{},eligible:{},optionValues:{},blocked:false,summaryVisible:true,disabled:false,soundtrackScopeKey:"actor:account",optionWarningsByChannel:{}};
HTMLMediaElement.prototype.play=function(){window.activeAudio.add(this);return Promise.resolve()};HTMLMediaElement.prototype.pause=function(){window.activeAudio.delete(this)};HTMLMediaElement.prototype.load=function(){};
function Fixture({count,modes,eligible,optionValues,blocked,reviewItems,videoPreviewUrl='',disabled,soundtrackScopeKey,optionWarningsByChannel,summaryVisible}){
 const [active,setActive]=React.useState('site_web');
 const [settings,setSettings]=React.useState({}),[selection,setSelection]=React.useState({facebook:null,instagram:null});
 const change=(name,value)=>setSettings(previous=>({...previous,[name]:value}));
 window.patchContents=patch=>setSettings(previous=>({...previous,...patch}));
 const optionProps={facebookPublicationPlacement:'reel',facebookStoryEnabled:true,facebookPublicationPreferences:{reelsEnabled:true,storiesEnabled:true},facebookMediaMode:modes.facebook||'images',facebookImageCount:1,instagramPublicationPlacement:'classic',instagramStoryEnabled:false,instagramPublicationPreferences:{reelsEnabled:true,storiesEnabled:true},instagramMediaMode:modes.instagram||'images',instagramImageCount:1,pinterestBoards:[{id:'board-one',name:'Mon tableau Pinterest avec une très longue description de mon activité professionnelle'},{id:'board-two',name:'Autre tableau'}],pinterestBoardId:'board-one',pinterestBoardsLoading:false,pinterestBoardsError:'',threadsPublicationMode:'classic',threadsPublicationPreferences:{ghostEnabled:true},threadsPreferencesLoading:false,threadsPreferencesFailed:false,...optionValues,...settings,onFacebookPublicationPlacementChange:value=>change('facebookPublicationPlacement',value),onFacebookStoryEnabledChange:value=>change('facebookStoryEnabled',value),onInstagramPublicationPlacementChange:value=>change('instagramPublicationPlacement',value),onInstagramStoryEnabledChange:value=>change('instagramStoryEnabled',value),onPinterestBoardChange:value=>change('pinterestBoardId',value),onThreadsPublicationModeChange:value=>change('threadsPublicationMode',value)};
 window.contentsValues={...optionProps,soundtrackByChannel:selection};
 const items=reviewItems||channels.slice(0,count).map(channel=>({channel,label:labels[channel],hasText:!blocked,blockers:[],warnings:[],contentBlockers:blocked?['Le contenu doit être complété avant de pouvoir publier sur ce canal.']:[],contentWarnings:[],mediaBlockers:channel==='youtube_shorts'?['Ajoutez une vidéo pour ce canal.']:[],mediaWarnings:[],mediaBlockerCodes:channel==='youtube_shorts'?['youtube_video_required']:[]}));
 return React.createElement(Board,{summaryContainer:summaryVisible?document.getElementById("validation-summary"):null,items,imageKeys:['first','second'],previewByKey:{first:image,second:image},videoPreviewUrl,getMode:channel=>modes[channel]||(channel==='youtube_shorts'?'none':'images'),getSelectedImageKeys:()=>['first'],onModeChange(){},onToggleImage(){},onAddImage(){},onReorderImage(){},onOpenMediaPool(){},onSelectChannel:setActive,activePreview:{channelKey:active,channelLabel:labels[active]},disabled,optionWarningsByChannel,renderChannelOptions:channel=>React.createElement(ChannelOptions,{channel,...optionProps,disabled}),soundtrackByChannel:selection,soundtrackScopeKey,canSelectSoundtrack:channel=>eligible[channel]??(channel==='facebook'?optionProps.facebookPublicationPlacement!=='classic'||optionProps.facebookStoryEnabled:channel==='instagram'?optionProps.instagramPublicationPlacement!=='classic'||optionProps.instagramStoryEnabled:false),onSoundtrackChange:(channel,id)=>setSelection(previous=>({...previous,[channel]:id})),isSoundtrackLocked:()=>false});
}
window.renderFixture=(count,patch={})=>{fixtureConfig={...fixtureConfig,...patch,count};root.render(React.createElement(Fixture,fixtureConfig))};
window.renderFixture(13);
window.fetch=url=>{if(url==='/api/booster/soundtracks'){window.catalogueCalls++;return Promise.resolve(Response.json({ok:true,soundtracks:catalogue}))}window.nativeCalls++;throw Error('No native publication or provider call allowed')};
`;
const css = ["app/dashboard/booster/publier/components/publishWizard.module.css", "app/dashboard/booster/publier/components/PublishValidationBoard.module.css"].map(read).join("\n").replace(/:global\(([^)]+)\)/g,"$1")+read("app/dashboard/_components/MediaSoundtrackSelector.module.css").replace(/\.([a-zA-Z_][\w-]*)/g,".music-$1")+read("app/dashboard/booster/publier/components/PublishValidationChannelOptions.module.css").replace(/\.([a-zA-Z_][\w-]*)/g,".opts-$1");
const html = `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,::before,::after{box-sizing:border-box;margin:0;padding:0}dialog{margin:0}${css}
*{box-sizing:border-box}body{margin:0;padding:16px;background:#080c22;font:14px Arial;color:#fff;height:100dvh}button{font-family:inherit}.wizard{height:100%}.progress{min-height:50px}.footer{min-height:56px}.instruction{min-height:26px}
</style></head><body><div class="wizard" data-current-step="control"><nav class="progress">Validation</nav><div class="workspace"><p class="instruction">Vérifiez vos canaux avant publication.</p><div class="body" tabindex="0"><section class="screen" data-wizard-screen="control"><div id="root"></div></section></div></div><footer class="footer" data-has-summary="true"><div>Étape précédente</div><div class="footerSummary"><div id="validation-summary"></div></div><div class="footerActions">Continuer</div></footer></div></body></html>`;

type FixtureWindow = {
 renderFixture: (count: number, patch?: Record<string, unknown>) => void;
 patchContents: (patch: Record<string, unknown>) => void;
 contentsValues: Record<string, unknown> & {soundtrackByChannel: {facebook: string | null; instagram: string | null}};
 nativeCalls: number;
 activeAudio: Set<unknown>;
};

async function openFixture(page: import("@playwright/test").Page) {
 await page.route("**/*", route => {
  const name = new URL(route.request().url()).pathname, icon = icons.get(name);
  if (route.request().resourceType() === "document") return route.fulfill({contentType: "text/html", body: html});
  if (icon) return route.fulfill({contentType: name.endsWith(".svg") ? "image/svg+xml" : "image/png", body: icon});
  return route.abort();
 });
 await page.goto("https://validation.fixture.invalid/");
 await page.addScriptTag({content: fixture});
 await page.locator('[data-channel-global-status]').first().waitFor();
}

async function assertStatusAppearance(status: import("@playwright/test").Locator, tone: "ready" | "warning" | "blocked") {
 const label = status.locator(tone === 'blocked' ? 'button' : '.state');
 await expect(label).toHaveText(messages[tone === 'blocked' ? 'wizard_status_refused' : 'wizard_ready']);
 assert.equal(await status.locator('svg').count(), tone === 'warning' ? 1 : 0);
 const appearance = await label.evaluate(element => {
  const style = getComputedStyle(element), before = getComputedStyle(element, '::before'), after = getComputedStyle(element, '::after');
  return {color: style.color, fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight), direction: style.flexDirection, before: before.content, after: after.content, dotColor: after.backgroundColor, dotBorder: after.borderColor, dotWidth: parseFloat(after.width), dotHeight: parseFloat(after.height), dotRadius: after.borderRadius};
 });
 const colors = {ready: {text: 'rgb(100, 217, 177)', dot: 'rgb(71, 216, 171)'}, warning: {text: 'rgb(100, 217, 177)', dot: 'rgb(71, 216, 171)'}, blocked: {text: 'rgb(248, 113, 113)', dot: 'rgba(0, 0, 0, 0)'}};
 assert.equal(appearance.color, colors[tone].text); assert.equal(appearance.dotColor, colors[tone].dot);
 assert.ok(appearance.fontSize >= 13 && appearance.fontWeight >= 650, "Every status remains equally readable and bold");
 assert.equal(appearance.before, 'none'); assert.equal(appearance.direction, 'row', "The generated indicator follows the word");
 assert.equal(appearance.after, tone === 'blocked' ? '"i"' : '""');
 assert.ok(appearance.dotWidth >= 6 && appearance.dotWidth <= 14 && appearance.dotHeight === appearance.dotWidth && appearance.dotRadius === '50%', "The trailing indicator is round");
 if (tone === 'blocked') assert.equal(appearance.dotBorder, colors.blocked.text, "Refus ends with a red information circle");
 if (tone === 'warning') {
  const triangle = status.getByRole('button'); await expect(triangle).toHaveAttribute('aria-label', new RegExp(`^${messages.wizard_status_alert}`));
  assert.equal(await triangle.locator('svg').evaluate(element => getComputedStyle(element).color), 'rgb(244, 175, 83)');
  assert.equal(await triangle.evaluate(element => getComputedStyle(element, '::after').content), 'none', "The orange triangle supplements the green ready dot");
 }
}

async function assertSummaryCounts(page: import("@playwright/test").Page) {
 const summary = page.locator('#validation-summary [data-publish-validation-summary]'); await expect(summary).toBeVisible();
 assert.equal(await summary.getAttribute('role'), 'status'); assert.equal(await summary.getAttribute('aria-live'), 'polite');
 const cardTones = await page.locator('[data-channel-global-status]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tone')));
 const expected = {ready: 0, warning: 0, blocked: 0}; for (const tone of cardTones) {assert.ok(tone === 'ready' || tone === 'warning' || tone === 'blocked'); expected[tone]++; if (tone === 'warning') expected.ready++;}
 const counts = {ready: 0, warning: 0, blocked: 0};
 for (const tone of ['ready', 'warning', 'blocked'] as const) counts[tone] = Number(await summary.locator(`[data-tone="${tone}"][data-count]`).getAttribute('data-count'));
 assert.deepEqual(counts, expected, "Ready includes channels with non-blocking alerts; alert count is a subset of ready");
 assert.equal(counts.ready + counts.blocked, cardTones.length); assert.ok(counts.warning <= counts.ready);
 return counts;
}

test("one header status aggregates content, media, format and option alerts while the detail rows stay simple", async () => {
 const browser = await chromium.launch({headless: true});
 try {
  const page = await browser.newPage(); await openFixture(page);
  const item = (channel: string, extra: Record<string, unknown> = {}) => ({channel, label: channel, hasText: true, blockers: [], warnings: [], contentBlockers: [], contentWarnings: [], mediaBlockers: [], mediaWarnings: [], mediaBlockerCodes: [], ...extra});
  const reviewItems = [
   item('instagram', {mediaWarnings: ['La Story utilise uniquement les médias.']}),
   item('youtube_shorts', {mediaBlockers: ['Ajoutez une vidéo pour ce canal.'], mediaBlockerCodes: ['youtube_video_required']}),
   item('facebook', {blockers: ['Contenu trop long.'], contentBlockers: ['Contenu trop long.'], mediaBlockers: ['Format vidéo incompatible.'], contentWarnings: ['Relisez le titre.'], placementReviews: [{placement: 'story', targetKey: 'facebook:story', label: 'Facebook · Stories', blockers: ['Ajoutez un média pour les Stories.'], warnings: ['Vérifiez la durée.']}]})
  ];
  await page.evaluate(items => (window as unknown as FixtureWindow).renderFixture(3, {reviewItems: items, modes: {instagram: 'images', youtube_shorts: 'none', facebook: 'images'}, optionWarningsByChannel: {facebook: ['Le catalogue est temporairement indisponible.']}}), reviewItems);
  const status = (channel: string) => page.locator(`[data-channel="${channel}"] header [data-channel-global-status]`);
  await expect(status('instagram')).toHaveAttribute('data-tone', 'warning');
  await expect(status('youtube_shorts')).toHaveAttribute('data-tone', 'blocked');
  await expect(status('facebook')).toHaveAttribute('data-tone', 'blocked');
  await assertStatusAppearance(status('instagram'), 'warning'); await assertStatusAppearance(status('youtube_shorts'), 'blocked');
  assert.deepEqual(await assertSummaryCounts(page), {ready: 1, warning: 1, blocked: 2});
  await status('facebook').getByRole('button').click();
  const tooltip = status('facebook').getByRole('tooltip'); await expect(tooltip).toBeVisible();
  for (const message of ['Contenu trop long.', 'Format vidéo incompatible.', 'Ajoutez un média pour les Stories.', 'Relisez le titre.', 'Vérifiez la durée.', 'Le catalogue est temporairement indisponible.']) await expect(tooltip).toContainText(message);
  assert.equal(await tooltip.locator('span').filter({hasText: /^Contenu trop long\.$/}).count(), 1, "The same blocker is listed once");
  for (const card of await page.locator('[data-publish-validation-board] > article').all()) {
   assert.equal(await card.locator('[data-channel-global-status]').count(), 1);
   assert.equal(await card.locator(':scope > :not(header) [data-validation-warning]').count(), 0, "Warnings only appear in the global header status");
   assert.equal(await card.locator('.statusLine .state').count(), 0, "Rows do not repeat the readiness label");
  }
  await status('instagram').getByRole('button').click();
  await expect(status('instagram').getByRole('tooltip')).toHaveText('La Story utilise uniquement les médias.');
  const updated = [item('site_web'), item('threads', {contentWarnings: ['Relisez le contenu.']}), item('youtube_shorts', {mediaBlockers: ['Ajoutez une vidéo pour ce canal.'], mediaBlockerCodes: ['youtube_video_required']})];
  await page.evaluate(items => (window as unknown as FixtureWindow).renderFixture(3, {reviewItems: items, modes: {site_web: 'none', threads: 'none', youtube_shorts: 'none'}}), updated);
  await expect(page.locator('[data-channel="site_web"] [data-channel-global-status]')).toHaveAttribute('data-tone', 'ready');
  assert.deepEqual(await assertSummaryCounts(page), {ready: 2, warning: 1, blocked: 1});
  await page.evaluate(() => (window as unknown as FixtureWindow).renderFixture(3, {summaryVisible: false})); await expect(page.locator('[data-publish-validation-summary]')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as FixtureWindow).renderFixture(3, {summaryVisible: true})); assert.deepEqual(await assertSummaryCounts(page), {ready: 2, warning: 1, blocked: 1});
  assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).nativeCalls), 0);
 } finally { await browser.close(); }
});

test("the single header blocker clears when the actual video duration policy reaches its valid boundary", async () => {
 const browser = await chromium.launch({headless: true});
 try {
  const page = await browser.newPage(); await openFixture(page);
  const render = async (duration: number) => {
   const reviewItems = durationReviewItems(duration);
   await page.evaluate(items => (window as unknown as FixtureWindow).renderFixture(2, {reviewItems: items, modes: {facebook: 'none', gmb: 'video'}, videoPreviewUrl: 'blob:fixture-video'}), reviewItems);
  };
  await render(31);
  const status = page.locator('[data-channel="gmb"] [data-channel-global-status]');
  await expect(status).toHaveAttribute('data-tone', 'blocked');
  const notice = status.locator('[data-validation-warning]');
  await assertStatusAppearance(status, 'blocked');
  const message = durationReviewItems(31).find(item => item.channel === 'gmb')!.mediaBlockers[0]; assert.ok(message.length);
  const trigger = notice.getByRole('button'); await trigger.click();
  const tooltip = status.getByRole('tooltip'); await expect(tooltip).toBeVisible(); await expect(tooltip).toHaveText(message);
  assert.equal(await trigger.getAttribute('aria-describedby'), await tooltip.getAttribute('id'));
  await expect(page.locator('[data-channel="facebook"] [data-channel-global-status]')).toHaveAttribute('data-tone', 'ready');
  await assertStatusAppearance(page.locator('[data-channel="facebook"] [data-channel-global-status]'), 'ready');
  await render(30);
  await expect(status).toHaveAttribute('data-tone', 'ready');
  assert.equal(await status.locator('.state').count(), 1, "One ready status replaces the blocker");
  await expect(status).toHaveText(messages.wizard_ready);
  assert.equal(await page.locator('[data-channel="gmb"] .statusLine .state').count(), 0);
 } finally { await browser.close(); }
});

test("the global status distinguishes a blocked extra Story from a wholly blocked channel", async () => {
 const browser = await chromium.launch({headless: true});
 try {
  const page = await browser.newPage(); await openFixture(page);
  const storyProblem = 'La Story nécessite une image ou une vidéo.';
  const classicProblem = 'Le format de la publication classique est incompatible.';
  const classic = {targetKey: 'facebook:classic', placement: 'classic', label: 'Facebook · Classique', blockers: [] as string[], warnings: []};
  const story = {targetKey: 'facebook:story', placement: 'story', label: 'Facebook · Stories', blockers: [storyProblem], warnings: []};
  const item = {channel: 'facebook', label: 'Facebook', hasText: true, blockers: [] as string[], channelBlockers: [] as string[], warnings: [storyProblem], contentBlockers: [], contentWarnings: [], mediaBlockers: [] as string[], mediaWarnings: [storyProblem], mediaBlockerCodes: [], placementReviews: [classic, story], publishable: true};
  await page.evaluate(item => (window as unknown as FixtureWindow).renderFixture(1, {reviewItems: [item], modes: {facebook: 'none'}}), item);
  const status = page.locator('[data-channel="facebook"] [data-channel-global-status]');
  await expect(status).toHaveAttribute('data-tone', 'warning');
  await status.getByRole('button').click(); await expect(status.getByRole('tooltip')).toHaveText(storyProblem);
  const blocked = {...item, blockers: [classicProblem, storyProblem], mediaBlockers: [classicProblem, storyProblem], warnings: [], mediaWarnings: [], placementReviews: [{...classic, blockers: [classicProblem]}, story], publishable: false};
  await page.evaluate(item => (window as unknown as FixtureWindow).renderFixture(1, {reviewItems: [item], modes: {facebook: 'none'}}), blocked);
  await expect(status).toHaveAttribute('data-tone', 'blocked'); await expect(status.getByRole('tooltip')).toContainText(classicProblem); await expect(status.getByRole('tooltip')).toContainText(storyProblem);
  assert.equal(await page.locator('[data-channel="facebook"] .statusLine [data-validation-warning]').count(), 0);
  assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).nativeCalls), 0);
 } finally { await browser.close(); }
});

test("inline Validation cards share one size, show full channel names and keep a centered status with 1, 3 or 13 channels", async t => {
 const browser = await chromium.launch({headless: true});
 try {
  for (const viewport of [{width: 1440, height: 1000}, {width: 1280, height: 720}, {width: 1024, height: 768}, {width: 768, height: 1024}, {width: 844, height: 390}, {width: 390, height: 844}]) {
   const page = await browser.newPage({viewport}), errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await openFixture(page);
   let referenceWidth: number | undefined;
   for (const count of [13, 3, 1]) {
    await page.evaluate(count => (window as unknown as FixtureWindow).renderFixture(count, {optionValues: {threadsPublicationMode: 'ghost', facebookImageCount: 5, instagramImageCount: 5}}), count);
    await expect(page.locator('[data-publish-validation-board] > article')).toHaveCount(count);
    assert.equal(await page.locator('[data-channel-settings-trigger], [data-channel-settings-dialog]').count(), 0, "Options never require a settings popup");
    assert.equal(await page.locator('[data-channel-inline-options]').count(), count === 13 ? 4 : count === 3 ? 3 : 1);
    assert.equal(await page.locator('[data-channel-global-status]').count(), count);
    for (const channel of ['facebook', 'instagram']) {
     const card = page.locator(`[data-channel="${channel}"]`); if (!(await card.count())) continue;
     const modeLabel = card.locator('.optionsLabel').filter({hasText: new RegExp(`^${messages.wizard_step_mode}$`)}), musicLabel = card.locator('.optionsLabel').filter({hasText: new RegExp(`^${messages.publication_music_label}$`)});
     await expect(modeLabel).toBeVisible(); await expect(musicLabel).toBeVisible();
     const modeBounds = await modeLabel.boundingBox(), musicBounds = await musicLabel.boundingBox(), pickerBounds = await card.locator('[data-soundtrack-inline]').boundingBox();
     assert.ok(modeBounds && musicBounds && pickerBounds && Math.abs(modeBounds.x - musicBounds.x) < 1 && musicBounds.y > modeBounds.y && pickerBounds.x >= musicBounds.x + musicBounds.width, "Music has its own visible row aligned with the Mode label");
    }
    const measurements = await page.locator('[data-publish-validation-board] > article').evaluateAll(cards => cards.map(card => {
     const rect = card.getBoundingClientRect(), header = card.querySelector('header')!.getBoundingClientRect(), status = card.querySelector('[data-channel-global-status]')!.getBoundingClientRect();
     const name = card.querySelector('.brand strong') as HTMLElement, nameStyle = getComputedStyle(name), media = card.querySelector('.mediaLine')!.getBoundingClientRect(), thumbnails = card.querySelector('.thumbnails')!.getBoundingClientRect();
     const controls = Array.from(card.querySelectorAll('button,select,input')).filter(control => control.getClientRects().length).map(control => {const b = control.getBoundingClientRect(); return {left: b.left, right: b.right, top: b.top, bottom: b.bottom};});
     return {channel: card.getAttribute('data-channel'), width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, headerCenter: header.x + header.width / 2, statusCenter: status.x + status.width / 2, controls, fullName: name.textContent, expectedName: name.title, nameFits: name.scrollWidth <= name.clientWidth + 1 && name.scrollHeight <= name.clientHeight + 1, nameEllipsis: nameStyle.textOverflow === 'ellipsis', mediaOffset: media.bottom - rect.top, thumbnailsBottom: thumbnails.bottom - rect.top};
    }));
    referenceWidth ??= measurements[0].width;
    const reference = measurements[0];
    for (const card of measurements) {
     assert.ok(Math.abs(card.width - referenceWidth) < 1, `${viewport.width}px/${count}: channel count must not change card width`);
     assert.ok(Math.abs(card.height - reference.height) < 1, `${viewport.width}px/${count}/${card.channel}: every card must share the same height, including channels without options`);
     assert.ok(card.height >= 160 && card.height <= 390, `${viewport.width}px/${count}/${card.channel}: inline options fit a compact natural card (${card.height}px)`);
     assert.equal(card.fullName, card.expectedName, `${card.channel}: the complete channel name stays in the heading`);
     assert.equal(card.nameFits, true, `${viewport.width}px/${card.channel}: the full name must fit without clipping`);
     assert.equal(card.nameEllipsis, false, `${card.channel}: the name must never be replaced by an ellipsis`);
     assert.ok(Math.abs(card.mediaOffset - reference.mediaOffset) < 1 && Math.abs(card.thumbnailsBottom - reference.thumbnailsBottom) < 1, `${card.channel}: media controls and thumbnails align across cards with or without options`);
     assert.ok(Math.abs(card.headerCenter - card.statusCenter) < 1, `${card.channel}: the global status is centered in the header`);
     for (const control of card.controls) assert.ok(control.left >= card.left - 1 && control.right <= card.right + 1 && control.top >= card.top - 1 && control.bottom <= card.bottom + 1, `${viewport.width}px/${card.channel}: actions remain within their card ${JSON.stringify({card,control})}`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No horizontal page overflow");
    const eye = page.locator('[data-publish-validation-board] > article').last().locator('header .cardActions > button'); await eye.click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); await expect(dialog.locator('[data-native-preview]')).toBeVisible();
    const bounds = await dialog.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1);
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); assert.equal(await eye.evaluate(element => element === document.activeElement), true, "Preview restores focus to its eye button");
    if (process.env.INRCY_VALIDATION_LAYOUT_PROOF && [1440, 390].includes(viewport.width) && count !== 1) {
     await page.locator('.body').evaluate(element => {element.scrollTop = 0;});
     await page.screenshot({path: `${process.env.INRCY_VALIDATION_LAYOUT_PROOF}-${viewport.width}-${count}.png`});
    }
    t.diagnostic(JSON.stringify({viewport, count, card: {width: reference.width, height: reference.height}}));
   }
   assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).nativeCalls), 0); await page.close();
  }
 } finally { await browser.close(); }
});

test("visible options stay controlled across formats, boards, Threads, music and account or step changes", async () => {
 const browser = await chromium.launch({headless: true});
 try { for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}]) {
  const page = await browser.newPage({viewport, hasTouch: true}), errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await openFixture(page);
  await page.evaluate(() => (window as unknown as FixtureWindow).renderFixture(13, {blocked: true}));
  const facebook = page.locator('[data-channel="facebook"]'), format = facebook.getByRole('radio', {name: messages.instagram_classic, exact: true}), reel = facebook.getByRole('radio', {name: messages.wizard_reel_option, exact: true});
  await expect(format).toBeVisible(); assert.equal(await page.getByRole('dialog').count(), 0);
  await format.check(); await facebook.getByRole('checkbox').uncheck();
  const music = facebook.locator('[data-soundtrack-inline]'), picker = music.getByRole('combobox');
  await expect(picker).toHaveAttribute('aria-disabled', 'true');
  await reel.check(); await expect(picker).toHaveAttribute('aria-busy', 'false'); await picker.click();
  const choices = facebook.getByRole('listbox'); await expect(choices).toBeVisible();
  const choice = choices.getByRole('option', {name: catalogue[2].label, exact: true});
  await choice.hover(); await expect(choice).toHaveAttribute('data-active', 'true'); await choice.click(); await expect(choice).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).contentsValues.soundtrackByChannel.facebook)).toBe(catalogue[2].id);
  const play = music.locator('.music-preview'); await expect(play).toBeEnabled(); await play.click();
  assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).activeAudio.size), 1);
  await picker.press('Escape'); await expect(choices).toBeHidden(); assert.equal(await page.getByRole('dialog').count(), 0, "Escape closes the inline list without opening or closing another dialog");
  await page.evaluate(() => (window as unknown as FixtureWindow).renderFixture(13, {soundtrackScopeKey: 'actor:other-account'}));
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).activeAudio.size)).toBe(0);
  await expect(picker).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => (window as unknown as FixtureWindow).patchContents({facebookPublicationPlacement: 'classic', facebookStoryEnabled: true}));
  await expect(format).toBeChecked(); await expect(facebook.getByRole('checkbox')).toBeChecked();
  const pinterest = page.locator('[data-channel="pinterest"]'); await pinterest.getByRole('combobox').selectOption('board-two');
  assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).contentsValues.pinterestBoardId), 'board-two'); assert.equal(await pinterest.locator('[data-soundtrack-inline]').count(), 0);
  await page.locator('[data-channel="threads"]').getByRole('radio', {name: messages.threads_ghost, exact: true}).check();
  assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).contentsValues.threadsPublicationMode), 'ghost');
  const gmb = page.locator('[data-channel="gmb"]'), gmbHint = gmb.locator('[data-gmb-first-image-hint]');
  await expect(gmbHint).toHaveText(messages.wizard_google_business_first_image); await expect(gmbHint).toBeVisible();
  assert.equal(await gmb.locator('.thumbnails > *').count(), 5, "The information hint does not reduce the existing five image slots");
  assert.equal(await page.locator('[data-channel]:not([data-channel="gmb"]) [data-gmb-first-image-hint]').count(), 0);
  for (const mode of ['video', 'none']) {
   await page.evaluate(mode => (window as unknown as FixtureWindow).renderFixture(13, {modes: {gmb: mode}, videoPreviewUrl: mode === 'video' ? 'blob:fixture-video' : ''}), mode);
   await expect(gmbHint).toHaveCount(0);
  }
  await page.evaluate(() => (window as unknown as FixtureWindow).renderFixture(13, {modes: {}, videoPreviewUrl: ''})); await expect(gmbHint).toBeVisible(); assert.equal(await gmb.locator('.thumbnails > *').count(), 5);
  await expect(page.locator('[data-channel="instagram"] [data-soundtrack-inline]').getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
  await reel.check(); await picker.click(); await expect(choices).toBeVisible(); await choices.getByRole('option', {name: catalogue[2].label, exact: true}).click(); await play.click();
  await page.evaluate(() => (window as unknown as FixtureWindow).renderFixture(13, {disabled: true}));
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).activeAudio.size)).toBe(0); await expect(choices).toBeHidden(); await expect(format).toBeDisabled();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).nativeCalls), 0); await page.close();
 }} finally { await browser.close(); }
});
