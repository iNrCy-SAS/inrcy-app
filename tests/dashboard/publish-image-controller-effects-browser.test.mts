import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function declarations(file: string, names: string[]) {
  const source = read(file);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = tree.statements.filter(statement =>
    (ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text || "")) ||
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(tree)))),
  );
  assert.equal(selected.length, names.length, "Every real shared declaration must be included");
  return selected.map(statement => statement.getText(tree)).join("\n");
}
const sharedFile = "app/dashboard/booster/publier/publishModal.shared.tsx";
// Use the real synchronization, transformation and channel-policy functions,
// without importing unrelated upload/render service dependencies into the fixture.
const sharedSource = [
  'import {getBoosterImageDisplayPlan,getBoosterImageSafetyBackgroundMode} from "@/lib/boosterImageDecision";',
  'import {mergeBoosterChannelImageSelection} from "@/lib/boosterChannelImageSelection";',
  'import {computeImageCanvasLayout} from "@/lib/imageTransformGeometry";',
  'import {INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT} from "@/lib/mediaRules";',
  declarations("lib/xChannel.ts", ["X_POST_MAX_IMAGES"]),
  declarations(sharedFile, [
    "BOOSTER_CHANNEL_ORDER", "CHANNEL_LABELS", "CHANNEL_PRESETS", "BOOSTER_MAX_IMAGE_COUNT",
    "channelSupportsImages", "getBoosterMaxImageCountForChannel", "makeImageKey", "clamp",
    "getEffectiveTransformZoom", "getBackgroundMode", "withBackgroundMode", "getBackgroundFill",
    "computePreviewLayout", "getDefaultTransform", "getOptimizedTransform", "syncChannelImageEditors",
  ]),
].join("\n");
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(name + "/package.json")), "cjs", file), "utf8");
const sources: Record<string, string> = {
  react: packageSource("react", "react.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"),
  "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"),
  scheduler: packageSource("scheduler", "scheduler.production.js"),
  [sharedFile]: compile(sharedSource),
};
const controllerFile = "app/dashboard/booster/publier/usePublishImageController.ts";
for (const file of [controllerFile, "app/dashboard/booster/publier/imageChannelAssignment.ts", "app/dashboard/booster/publier/publishImageRecovery.ts", "lib/boosterImageDecision.ts", "lib/boosterImageCustomization.ts", "lib/boosterChannelImageSelection.ts", "lib/imageOverlay.ts", "lib/imageInteractions.ts", "lib/imageTransformGeometry.ts", "lib/mediaRules.ts"]) sources[file] = compile(read(file));

async function mount(page: Page) {
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: `
const sources=${JSON.stringify(sources)},cache={};
window.errors=[];window.syncCalls=0;window.renders=0;window.committed=0;
window.addEventListener('error',event=>window.errors.push(event.message));
const translate=key=>key;
window.fetch=()=>{throw Error('No network operation expected')};
function load(name,from=''){
 if(name==='next-intl')return {useTranslations:()=>translate};
 if(name==='@/lib/inrcyDialog')return {confirmInrcy:()=>{throw Error('No destructive action expected')}};
 if(name.startsWith('@/'))name=name.slice(2);
 else if(name.startsWith('.')){const parts=from.split('/');parts.pop();for(const part of name.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part)}name=parts.join('/')}
 if(!sources[name])name=[name+'.ts',name+'.tsx'].find(candidate=>sources[candidate])||name;
 if(cache[name])return cache[name].exports;
 if(!sources[name])throw Error('Unexpected dependency '+name);
 const entry=cache[name]={exports:{}};new Function('require','module','exports',sources[name])(next=>load(next,name),entry,entry.exports);
 if(name===${JSON.stringify(sharedFile)}){const sync=entry.exports.syncChannelImageEditors;entry.exports.syncChannelImageEditors=params=>{window.syncCalls++;return sync(params)};}
 return entry.exports;
}
const React=load('react'),shared=load(${JSON.stringify(sharedFile)}),useController=load(${JSON.stringify(controllerFile)}).default;
const makeFile=index=>new File(['fixture-'+index],'image-'+index+'.jpg',{type:'image/jpeg',lastModified:index});
const initialFiles=[makeFile(1),makeFile(2)];
const initialMeta=Object.fromEntries(initialFiles.map(file=>[shared.makeImageKey(file),{width:1200,height:800,ratio:1.5}]));
function Fixture(){
 if(++window.renders>100)throw Error('Controller synchronization did not settle');
 const[revision,bump]=React.useState(0),[images,setImages]=React.useState(initialFiles),[metadata,setMetadata]=React.useState(initialMeta);
 const[channels,setChannels]=React.useState(['facebook','instagram']),[previews,setImagePreviews]=React.useState(['blob:first','blob:second']);
 const[editors,setChannelImageEditors]=React.useState({}),[active,setActiveImageKeyByChannel]=React.useState({});
 const[activeImageChannel,setActiveImageChannel]=React.useState('facebook'),[useImagesForAI,setUseImagesForAI]=React.useState(true);
 const[dragging,setIsDraggingImage]=React.useState(false),[error,setImgError]=React.useState(''),[card,setActiveCard]=React.useState('facebook');
 const[,setPublicationMediaType]=React.useState('images'),[,setChannelMediaModes]=React.useState({});
 const fileInputRef=React.useRef(null),previewStageRef=React.useRef(null);
 const controller=useController({fileInputRef,previewStageRef,selectedChannels:[...channels],images:[...images],
  setImages,imagePreviews:[...previews],setImagePreviews,useImagesForAI,setUseImagesForAI,
  imageMetaByKey:JSON.parse(JSON.stringify(metadata)),setImageMetaByKey:setMetadata,channelImageEditors:editors,setChannelImageEditors,
  activeImageChannel,setActiveImageChannel,activeImageKeyByChannel:active,setActiveImageKeyByChannel,isDraggingImage:dragging,setIsDraggingImage,
  hasVideoMedia:false,setImgError,setActiveCard,setPublicationMediaType,setChannelMediaModes,preservePublishScroll(){},restorePublishScroll(){}});
 window.fixture={controller,editors,active,channels,activeImageChannel,card,metadata,error,keys:controller.imageKeys,
  rerender:()=>bump(value=>value+1),setChannels,
  changeMetadata:patch=>setMetadata(current=>({...current,[controller.imageKeys[1]]:{...current[controller.imageKeys[1]],...patch}})),
  addSources:()=>setImages(current=>[...current,makeFile(3),makeFile(4),makeFile(5)])};
 React.useEffect(()=>{window.committed=revision},[revision]);
 return React.createElement('div',{ref:previewStageRef,style:{width:320,height:240}},revision);
}
window.root=load('react-dom/client').createRoot(document.getElementById('root'));window.root.render(React.createElement(Fixture));
` });
  page.setDefaultTimeout(5_000);
  await page.waitForFunction("window.fixture?.editors.facebook?.imageKeys.length === 2 || window.errors.length");
  assert.deepEqual(await page.evaluate("window.errors"), []);
  await settle(page);
}
async function settle(page: Page) {
  await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  assert.deepEqual(await page.evaluate("window.errors"), []);
}
async function customize(page: Page) {
  await page.evaluate("window.fixture.controller.toggleChannelImage('facebook',window.fixture.keys[0]);window.fixture.controller.updateChannelTransform('facebook',window.fixture.keys[1],{fit:'cover',zoom:1.7,offsetX:21,offsetY:-12})");
  await settle(page);
}

test("real image controller settles with equivalent inputs and preserves per-channel selection and manual crop", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await mount(page);
    assert.equal(await page.evaluate("window.syncCalls"), 1);
    await customize(page);
    const before = await page.evaluate("JSON.stringify({editors:window.fixture.editors,active:window.fixture.active})");
    for (let revision = 1; revision <= 4; revision++) {
      await page.evaluate("window.fixture.rerender()");
      await page.waitForFunction(value => (window as unknown as { committed: number }).committed === value, revision);
      await settle(page);
    }
    assert.equal(await page.evaluate("window.syncCalls"), 1, "new equivalent arrays/maps cannot restart synchronization");
    assert.equal(await page.evaluate("JSON.stringify({editors:window.fixture.editors,active:window.fixture.active})"), before);
    const selected = await page.evaluate<{ keys: string[]; facebook: string[]; instagram: string[]; crop: { zoom: number }; customized: string[] }>("({keys:window.fixture.keys,facebook:window.fixture.editors.facebook.imageKeys,instagram:window.fixture.editors.instagram.imageKeys,crop:window.fixture.editors.facebook.transforms[window.fixture.keys[1]],customized:window.fixture.editors.facebook.customizedImageKeys})");
    assert.deepEqual(selected.facebook, [selected.keys[1]]);
    assert.deepEqual(selected.instagram, selected.keys);
    assert.equal(selected.crop.zoom, 1.7);
    assert.deepEqual(selected.customized, [selected.keys[1]]);
    assert.equal(await page.evaluate("window.fixture.controller.activeEditorDecisionMode"), "customized");
  } finally { await browser.close(); }
});

test("metadata and channel changes retain manual crops/subsets and honor supported-image channel limits", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await mount(page);
    await customize(page);
    const crop = await page.evaluate("JSON.stringify(window.fixture.editors.facebook.transforms[window.fixture.keys[1]])");
    await page.evaluate("window.fixture.changeMetadata({ratio:1.4,interactions:{version:1,items:[{text:'Learn more',linkUrl:'https://example.invalid',x:25,y:30}]}})");
    await settle(page);
    assert.equal(await page.evaluate("window.syncCalls"), 2, "same dimensions with updated ratio/interactions are consumed");
    assert.equal(await page.evaluate("window.fixture.controller.activeEditorMeta.ratio"), 1.4);
    assert.equal(await page.evaluate("window.fixture.controller.activeEditorMeta.interactions.items[0].text"), "Learn more");
    assert.equal(await page.evaluate("JSON.stringify(window.fixture.editors.facebook.transforms[window.fixture.keys[1]])"), crop);
    await page.evaluate("window.fixture.addSources()");
    await settle(page);
    assert.equal(await page.evaluate("window.fixture.editors.facebook.imageKeys.length"), 1);
    assert.equal(await page.evaluate("window.fixture.editors.instagram.imageKeys.length"), 2);
    await page.evaluate("window.fixture.setChannels(['facebook','instagram','x','youtube_shorts'])");
    await settle(page);
    assert.equal(await page.evaluate("window.fixture.editors.x.imageKeys.length"), 4);
    assert.deepEqual(await page.evaluate("window.fixture.editors.youtube_shorts.imageKeys"), []);
    assert.equal(await page.evaluate("JSON.stringify(window.fixture.editors.facebook.transforms[window.fixture.keys[1]])"), crop);
    assert.equal(await page.evaluate("window.fixture.editors.facebook.customizedImageKeys.length"), 1);
    await page.evaluate("window.fixture.setChannels(['instagram','x','youtube_shorts'])");
    await settle(page);
    assert.equal(await page.evaluate("window.fixture.editors.facebook"), undefined);
    assert.equal(await page.evaluate("window.fixture.active.facebook"), undefined);
    assert.equal(await page.evaluate("window.fixture.activeImageChannel"), "instagram");
    assert.equal(await page.evaluate("window.fixture.card"), "instagram");
    const syncCalls = await page.evaluate("window.syncCalls");
    await page.evaluate("window.fixture.rerender()");
    await settle(page);
    assert.equal(await page.evaluate("window.syncCalls"), syncCalls);
    assert.deepEqual(await page.evaluate("window.errors"), []);
  } finally { await browser.close(); }
});
