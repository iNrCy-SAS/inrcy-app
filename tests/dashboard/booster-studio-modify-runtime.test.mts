import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compile = (file: string) => ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const publish = parse("app/dashboard/booster/publier/PublishModal.tsx");
const controller = parse("app/dashboard/booster/publier/usePublishImageController.ts");
function expression(source: ts.SourceFile, name: string, component?: string) {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (!component && ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer;
    if (component && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === component) {
      const prop = node.attributes.properties.find(entry => ts.isJsxAttribute(entry) && entry.name.getText(source) === name);
      if (prop && ts.isJsxAttribute(prop) && prop.initializer && ts.isJsxExpression(prop.initializer)) found = prop.initializer.expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(found, name);
  return ts.transpileModule(`const handler = (${found.getText(source)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText + "\nreturn handler;";
}
function returnedEffect() {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(publish) === "useEffect" && node.arguments[0]?.getText(publish).includes("const returnedRecord = pendingStudioReturn.item")) found = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(publish); assert.ok(found, "The real Booster Studio return effect must be exercised");
  return ts.transpileModule(`const handler = (${found.getText(publish)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText + "\nreturn handler;";
}
const handlers = {
  openImage: expression(publish, "openInrStudioImageTool"),
  modify: expression(publish, "onModifyImage", "PublishMediaPoolPanel"),
  retouch: expression(publish, "onRetouchImage", "PublishMediaPoolPanel"),
  replace: expression(controller, "replaceImageFile"),
  returned: returnedEffect(),
};
const packageSource = (name: string, file: string) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), "cjs", file), "utf8");
const sources = {
  react: packageSource("react", "react.production.js"), "react/jsx-runtime": packageSource("react", "react-jsx-runtime.production.js"),
  "react-dom": packageSource("react-dom", "react-dom.production.js"), "react-dom/client": packageSource("react-dom", "react-dom-client.production.js"), scheduler: packageSource("scheduler", "scheduler.production.js"),
  pool: compile("app/dashboard/booster/publier/components/PublishMediaPoolPanel.tsx"),
  studio: compile("app/dashboard/generer-media/MediaGeneratorStudioClient.tsx"),
  session: compile("app/dashboard/_hooks/useInrStudioSession.tsx"),
  "@/app/dashboard/_components/MediaGeneratorModal": compile("app/dashboard/_components/MediaGeneratorModal.tsx"),
  "./MediaModifier": compile("app/dashboard/_components/MediaModifier.tsx"),
  ...Object.fromEntries(["inrStudioNavigation", "inrStudioViewport", "inrStudioModalPolicy", "inrAssistantStudioHandoff", "inrAssistantStudioDraft", "aiMediaModelCatalog", "aiMediaGenerationContracts", "aiMediaNarrationVoices", "mediaRules", "aiMediaCharacterVoices"].map(name => ["@/lib/" + name, compile("lib/" + name + ".ts")])),
};
const dictionaries = { booster: JSON.parse(read("messages/fr-FR/booster.json")), media: JSON.parse(read("messages/fr-FR/media.json")), shell: JSON.parse(read("messages/fr-FR/shell.json")) };
const fixture = `
const sources=${JSON.stringify(sources)},handlers=${JSON.stringify(handlers)},dict=${JSON.stringify(dictionaries)},loaded={};
window.generationCalls=0;window.publicationCalls=0;window.handoffs=[];window.errors=[];window.saves=0;
const translate=namespace=>(key,values={})=>String(dict[namespace]?.[key]||key).replace(/\\{(\\w+)\\}/g,(_,name)=>String(values[name]??name));
const noOp=()=>{};let injectResult;
function useGeneration(){const React=require('react');const[result,setResult]=React.useState(null);injectResult=setResult;return {quota:{accountId:'account-a',creditsReady:true,credits:{remaining:697}},quotaLoading:false,busy:false,progress:0,result,status:result?'ready':'idle',canRecover:false,loadQuota:noOp,reset:noOp,acceptDraft:async value=>value,generate(){window.generationCalls++;throw Error('No paid generation is allowed in this test')}};}
const preference={imageEngine:'openai',videoEngine:'omni',videoResolution:'720p',update:noOp};
function makeImageKey(file){return file.name+'__'+file.size+'__'+file.lastModified;}
function require(name){
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
 if(name.startsWith('./')&&sources['@/lib/'+name.slice(2).replace(/\\.ts$/,'')])return require('@/lib/'+name.slice(2).replace(/\\.ts$/,''));
 if(name==='next-intl')return {useLocale:()=> 'fr-FR',useTranslations:translate};
 if(name==='next/navigation')return {useRouter:()=>({replace:noOp,push:noOp})};
 if(name==='next/dynamic')return {__esModule:true,default:()=>require('studio').default};
 if(name==='@/app/dashboard/_components/DashboardViewerAccessProvider')return {useDashboardViewerAccess:()=>({actorUserId:'actor-a',activeAccountId:'account-a'})};
 if(name==='@/lib/browserAccountCache')return {getActiveBrowserUserId:()=> 'account-a'};
 if(name==='@/lib/multicompte/constants')return {ACTIVE_INRCY_ACCOUNT_EVENT:'account-change'};
 if(name==='@/app/dashboard/_hooks/useMediaGeneration')return {__esModule:true,default:useGeneration,discardMediaGenerationDraft:async()=>{},MediaGenerationAccountChangedError:Error,MediaGenerationCancelledError:Error};
 if(name==='../_hooks/useMediaEnginePreference')return {__esModule:true,default:()=>preference};
 if(name==='../_hooks/useMediaCreditQuote')return {__esModule:true,default:()=>({ready:true,insufficient:false,quote:{totalCredits:7},authorization:{}})};
 if(name==='./MediaEngineCreditControls')return {__esModule:true,default:()=>null,MediaCreditQuoteSummary:()=>null,MediaGenerationActions:props=>props.children};
 if(name==='./MediaGenerationCreationWorkspace')return {__esModule:true,default:props=>require('react').createElement('button',{onClick:props.handleConfirm,'data-testid':'accept-tested-media'},'Utiliser ce média')};
 if(name==='./MediaGenerator')return {prepareMediaGenerationImageReference:async()=>{throw Error('No media generation/reference preparation is requested')}};
 if(name==='@/lib/mediaImageEditMasterClient')return {prepareMediaImageEditMaster:async()=>{throw Error('The test PNG should decode directly')}};
 if(name==='@/lib/aiMediaModelRecommendation')return {recommendAiMediaModel:()=>null};
 if(name==='../publishModal.shared')return {makeImageKey,BOOSTER_MAX_IMAGE_COUNT:5,getLocalizedBoosterImageLimits:()=>'',getLocalizedBoosterImageFormats:()=>'',getLocalizedBoosterVideoLimits:()=>'',getLocalizedBoosterVideoFormats:()=>'',getLocalizedBoosterRecommendedVideoDuration:()=>''};
 if(name==='./MediaRetoucher')return {__esModule:true,default:props=>require('react').createElement('div',{'data-testid':'manual-retoucher'},props.initialSource?.name||props.initialPreview?.name)};
 if(['next/link','./DashboardAssistantTrigger','./DashboardMobileSelect','./MediaFreeGenerator','./MediaVideoRetoucher','./MediaPoolImagePreview','@/app/dashboard/_components/MediaLibraryPickerModal','@/app/dashboard/_components/MediaSoundtrackSelector','./MediaSubjectVoiceButton','./MediaQuotaSummary'].includes(name))return {__esModule:true,default:()=>null};
 if(['@/lib/imageOverlay','@/lib/imageInteractions','@/lib/mediaLibraryUploadClient','@/lib/mediaRetoucherRenderClient','@/lib/boosterVideoTransformClient','@/app/dashboard/booster/publier/publishModal.shared'].includes(name))return {};
 if(loaded[name])return loaded[name].exports;if(!sources[name])throw Error('Unexpected modify fixture dependency '+name);
 const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;
}
const React=require('react'),nav=require('@/lib/inrStudioNavigation'),jsx=React.createElement;
function bind(code,scope){return new Function(...Object.keys(scope),code)(...Object.values(scope));}
const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
const original=Array.from({length:5},(_,i)=>new File([bytes],'source-'+(i+1)+'.png',{type:'image/png',lastModified:100+i}));
const keys=original.map(makeImageKey),initialEditors={facebook:{imageKeys:[keys[2],keys[0]],transforms:{},synchronizedImageKeys:keys},instagram:{imageKeys:[keys[1]],transforms:{},synchronizedImageKeys:keys}};
function Fixture(){
 const[images,setImages]=React.useState(original),[imagePreviews,setImagePreviews]=React.useState(original.map(URL.createObjectURL)),[imageMetaByKey,setImageMetaByKey]=React.useState({}),[channelImageEditors,setChannelImageEditors]=React.useState(initialEditors),[activeImageKeyByChannel,setActiveImageKeyByChannel]=React.useState({facebook:keys[2],instagram:keys[1]}),[pendingStudioReturn,setPendingStudioReturn]=React.useState(null);
 const inlineStudioReturnKeyRef=React.useRef(''),studioReturnApplyingKeyRef=React.useRef('');
 const{openStudio,studio,completeReturn}=require('session').useInrStudioSession({onReturned(result){inlineStudioReturnKeyRef.current=result.returnKey;setPendingStudioReturn(result)}});
 const imageKeys=images.map(makeImageKey),previewByKey=Object.fromEntries(imageKeys.map((key,index)=>[key,imagePreviews[index]]));
 const setImgError=message=>{if(message)window.errors.push(message)};
 const replaceImageFile=bind(handlers.replace,{images,imagePreviews,imageMetaByKey,makeImageKey,isBoosterImageFile:file=>file.type==='image/png',BOOSTER_MAX_IMAGE_BYTES:10e6,BOOSTER_MAX_MEDIA_BYTES:50e6,setImgError,i18nT:translate('booster'),buildLocalImagePresentation:async file=>({preview:URL.createObjectURL(file),meta:{width:1,height:1}}),withMediaImageInteractions:meta=>meta,setImages,setImagePreviews,setImageMetaByKey,setChannelImageEditors,setActiveImageKeyByChannel,getOptimizedTransform:()=>({zoom:1}),syncPersistentWorkspaceImages:noOp});
 React.useEffect(()=>bind(handlers.returned,{pendingStudioReturn,inlineStudioReturnKeyRef,loadedPublicationDraftId:'draft-test',studioReturnApplyingKeyRef,setImgError,mediaT:translate('media'),mediaLibraryItemToFile:async()=>new File([bytes],'modified-result.png',{type:'image/png',lastModified:200}),replaceImageFile,setPendingStudioReturn,completeReturn})(),[pendingStudioReturn]);
 const openInrStudioImageTool=bind(handlers.openImage,{images,makeImageKey,previewByKey,imagePreparationItems:[],setImgError,preparePublicationDraftForStudio:async()=>{window.saves++;return {draftId:'draft-test',returnHref:'/dashboard?action=publish&draftId=draft-test'}},createInrStudioHandoff:async input=>{const result=await nav.createInrStudioHandoff(input);window.handoffs.push(result.handoff);return result},openStudio});
 const callbacks={openInrStudioImageTool,activeImageChannel:'facebook',imageKeys};
 window.snapshot=()=>({names:images.map(file=>file.name),keys:imageKeys,editors:channelImageEditors,active:activeImageKeyByChannel});
 window.injectCompletedMedia=()=>injectResult({draft:false,item:{id:'10000000-0000-4000-8000-000000000099',media_type:'image',title:'Modifiée',signed_url:'https://fixture.invalid/result.png'},kind:'image',format:'square'});
 return jsx(React.Fragment,null,jsx('output',{'data-testid':'pool-count'},String(images.length)),jsx(require('pool').default,{images,imagePreviews,videoFile:null,videoPreviewUrl:'',isMobile:false,onPickImages:noOp,onPickVideo:noOp,onGenerate:noOp,onLibrary:noOp,onCamera:noOp,onRemoveImage:noOp,onRemoveVideo:noOp,onReorderImage:noOp,onModifyImage:bind(handlers.modify,callbacks),onRetouchImage:bind(handlers.retouch,callbacks),onRetouchVideo:noOp}),studio);
}
window.fetch=async()=>{window.publicationCalls++;throw Error('No API request is allowed during this UI test')};
require('react-dom/client').createRoot(document.getElementById('root')).render(jsx(Fixture));
`;

test("Booster Modify opens the actual Studio Modifier with the selected source, and returns into the same pool slot/channel", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }));
    await page.goto("https://fixture.invalid/dashboard?action=publish");
    await page.addScriptTag({ content: fixture });
    const modify = page.getByRole("button", { name: "Modifier l’image 3", exact: true });
    assert.match(await modify.locator("svg path").getAttribute("d") || "", /^m12 3 2\.5 6\.5/, "AI modification uses the sparkle icon");
    await modify.click();
    await page.locator('section[data-studio-tab="modify"]').waitFor();
    await page.locator('[data-modifier-preview]').waitFor({ state: "hidden" });
    await page.getByText("source-3.png", { exact: true }).last().waitFor();
    assert.equal(await page.locator('#modifier-source-title').count(), 1, errors.join("\n"));
    const sourceName = await page.locator('.sourceMeta strong').textContent();
    assert.equal(sourceName, "source-3.png");
    const details = await page.evaluate(() => (window as unknown as { handoffs: Array<{ tab: string; source: { name: string }; context: { imageKey: string; channel: string; draftId: string } }> }).handoffs[0]);
    assert.equal(details.tab, "modify"); assert.equal(details.source.name, "source-3.png"); assert.equal(details.context.channel, "facebook"); assert.equal(details.context.draftId, "draft-test");
    await page.evaluate(() => (window as unknown as { injectCompletedMedia: () => void }).injectCompletedMedia());
    await page.getByTestId("accept-tested-media").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="pool-count"]')?.textContent === "5" && !document.querySelector('[data-studio-tab="modify"]'));
    const snapshot = await page.evaluate(() => (window as unknown as { snapshot: () => { names: string[]; keys: string[]; editors: Record<string, { imageKeys: string[] }>; active: Record<string, string> } }).snapshot());
    assert.deepEqual(snapshot.names, ["source-1.png", "source-2.png", "modified-result.png", "source-4.png", "source-5.png"]);
    assert.equal(snapshot.editors.facebook.imageKeys[0], snapshot.keys[2]);
    assert.equal(snapshot.editors.facebook.imageKeys[1], snapshot.keys[0]);
    assert.deepEqual(snapshot.editors.instagram.imageKeys, [snapshot.keys[1]], "Other channel selections are preserved");
    assert.equal(snapshot.active.facebook, snapshot.keys[2]);
    const retouch = page.getByRole("button", { name: "Retoucher l’image 2", exact: true });
    assert.match(await retouch.locator("svg path").getAttribute("d") || "", /^m15 4 5 5M4 20/, "Manual retouching uses the pencil icon");
    await retouch.click();
    await page.locator('section[data-studio-tab="retouch"]').waitFor();
    assert.equal(await page.getByTestId("manual-retoucher").textContent(), "source-2.png");
    assert.deepEqual(await page.evaluate(() => ({ generation: (window as unknown as { generationCalls: number }).generationCalls, api: (window as unknown as { publicationCalls: number }).publicationCalls })), { generation: 0, api: 0 });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
