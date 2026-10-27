import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import ts from "typescript";

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
  "@/app/dashboard/_components/MediaSoundtrackSelector": compile("app/dashboard/_components/MediaSoundtrackSelector.tsx"),
  "@/lib/mediaSoundtrackSelection": compile("lib/mediaSoundtrackSelection.ts"),
  "./publishChannelIdentity": compile("app/dashboard/booster/publier/components/publishChannelIdentity.ts"),
};
const messages = JSON.parse(read("messages/fr-FR/booster.json"));
const icons = new Map([...read("app/dashboard/booster/publier/components/publishChannelIdentity.ts").matchAll(/icon: "([^"]+)"/g)].map(([,name]) => [name,readFileSync(new URL(`../../public${name}`,import.meta.url))]));
const fixture = `
const sources=${JSON.stringify(sources)},messages=${JSON.stringify(messages)},loaded={};
function require(name){
 if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>(name.includes('MediaSoundtrackSelector')?'music-':'')+String(key)})};
 if(name==='next-intl')return {useTranslations:()=> (key,args={})=>Object.entries(args).reduce((text,[name,value])=>text.replaceAll('{'+name+'}',String(value)),messages[key]||key)};
 if(name==='../publishModal.shared')return {channelSupportsImages:channel=>channel!=='youtube_shorts',getBoosterMaxImageCountForChannel:channel=>channel==='youtube_shorts'?1:5};
 if(name==='@/app/dashboard/_components/ChannelImageAdapterTool')return {ChannelPublicationPreview:({preview})=>require('react').createElement('section',{'data-native-preview':true,style:{overflow:'auto',width:'100%'}},preview.channelLabel+' — contenu complet de la publication')};
 if(name==='@/app/dashboard/_components/channel-image-adapter/native-publication-preview')return {PublicationPreviewDeviceTabs:()=>null};
 if(loaded[name])return loaded[name].exports;
 if(!sources[name])throw Error('Unexpected validation layout fixture module '+name);
 const module=loaded[name]={exports:{}};new Function('require','module','exports',sources[name])(require,module,module.exports);return module.exports;
}
const React=require('react'),Board=require('board').default,identities=require('./publishChannelIdentity').PUBLISH_CHANNEL_IDENTITY;
// Two synthetic identities stress the requested 13-card layout alongside all
// real channels, without adding a channel or capability to the application.
identities.fixture12={...identities.facebook};identities.fixture13={...identities.instagram};
const labels={site_web:'Site web',gmb:'Google Business',inr_search:'iNr’Search',facebook:'Facebook',instagram:'Instagram',threads:'Threads',linkedin:'LinkedIn',tiktok:'TikTok',youtube_shorts:'YouTube',pinterest:'Pinterest',x:'X',fixture12:'Canal 12',fixture13:'Canal 13'};
const channels=['facebook','instagram','threads',...Object.keys(labels).filter(channel=>!['facebook','instagram','threads'].includes(channel))],image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#408bc4"/></svg>');
const root=require('react-dom/client').createRoot(document.getElementById('root'));
window.nativeCalls=0;
function Fixture({count}){
 const [active,setActive]=React.useState('site_web');
 const items=channels.slice(0,count).map(channel=>({channel,label:labels[channel],hasText:true,blockers:[],warnings:[],contentBlockers:[],contentWarnings:[],mediaBlockers:channel==='youtube_shorts'?['Ajoutez une vidéo pour ce canal.']:[],mediaWarnings:[],mediaBlockerCodes:channel==='youtube_shorts'?['youtube_video_required']:[]}));
 return React.createElement(Board,{items,imageKeys:['first','second'],previewByKey:{first:image,second:image},videoPreviewUrl:'',getMode:channel=>channel==='youtube_shorts'?'none':'images',getSelectedImageKeys:()=>['first'],onModeChange(){},onToggleImage(){},onAddImage(){},onReorderImage(){},onOpenMediaPool(){},onSelectChannel:setActive,activePreview:{channelKey:active,channelLabel:labels[active]},disabled:false,soundtrackByChannel:{facebook:null,instagram:null},soundtrackScopeKey:'actor:account',canSelectSoundtrack:channel=>channel==='facebook'||channel==='instagram',onSoundtrackChange(){},isSoundtrackLocked:()=>false});
}
window.renderFixture=count=>root.render(React.createElement(Fixture,{count}));
window.renderFixture(13);
window.fetch=()=>{window.nativeCalls++;throw Error('No native publication or provider call allowed')};
`;
const css = ["app/dashboard/booster/publier/components/publishWizard.module.css", "app/dashboard/booster/publier/components/PublishValidationBoard.module.css"].map(read).join("\n").replace(/:global\(([^)]+)\)/g,"$1")+read("app/dashboard/_components/MediaSoundtrackSelector.module.css").replace(/\.([a-zA-Z_][\w-]*)/g,".music-$1");
const html = `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
*{box-sizing:border-box}body{margin:0;padding:16px;background:#080c22;font:14px Arial;color:#fff;height:100dvh}button{font-family:inherit}.wizard{height:100%}.progress{min-height:50px}.footer{min-height:56px}.instruction{min-height:26px}
</style></head><body><div class="wizard" data-current-step="control"><nav class="progress">Validation</nav><div class="workspace"><p class="instruction">Vérifiez vos canaux avant publication.</p><div class="body" tabindex="0"><section class="screen" data-wizard-screen="control"><div id="root"></div></section></div></div><footer class="footer">Étape précédente · Continuer</footer></div></body></html>`;

test("Validation keeps the same compact card dimensions with 1, 3 or 13 channels in portrait and landscape",async t=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const viewport of [{width:1440,height:1000},{width:1280,height:720},{width:1024,height:768},{width:768,height:1024},{width:844,height:390},{width:390,height:844}]){
   const page=await browser.newPage({viewport});
   const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
   await page.route("**/*",route=>{
    const name=new URL(route.request().url()).pathname,icon=icons.get(name);
    if(route.request().resourceType()==="document")return route.fulfill({contentType:"text/html",body:html});
    if(icon)return route.fulfill({contentType:name.endsWith(".svg")?"image/svg+xml":name.endsWith(".png")?"image/png":"image/jpeg",body:icon});
    return route.abort();
   });
   await page.goto("https://validation.fixture.invalid/");await page.addScriptTag({content:fixture});
   let reference:{width:number;height:number}|undefined;
   for(const count of [13,3,1]){
    await page.evaluate(count=>(window as unknown as {renderFixture:(count:number)=>void}).renderFixture(count),count);
    await page.waitForFunction(count=>document.querySelectorAll('[data-publish-validation-board] > article').length===count,count);
    assert.equal(await page.locator('[data-publish-validation-board] button[aria-haspopup="dialog"]').count(),count===1?1:2,"Only Facebook and Instagram image cards expose music");
    assert.equal(await page.locator('[data-channel="threads"] button[aria-haspopup], [data-channel="gmb"] button[aria-haspopup], [data-channel="tiktok"] button[aria-haspopup]').count(),0);
    const measurements=await page.locator('[data-publish-validation-board] > article').evaluateAll(cards=>cards.map(card=>{
     const rect=card.getBoundingClientRect();
     const controls=Array.from(card.querySelectorAll('button')).filter(button=>button.getClientRects().length).map(button=>{const b=button.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom}});
     return {width:rect.width,height:rect.height,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,controls};
    }));
    reference??={width:measurements[0].width,height:measurements[0].height};
    for(const card of measurements){
     assert.ok(Math.abs(card.width-reference.width)<1,`${viewport.width}px/${count}: channel count must not change card width`);
     assert.ok(Math.abs(card.height-reference.height)<1,`${viewport.width}px/${count}: card height ${card.height} differs from compact reference ${reference.height}`);
     assert.ok(card.height<=(viewport.width<=600?210:180),"Keep the dense 13-channel proportions");
     for(const button of card.controls)assert.ok(button.left>=card.left-1&&button.right<=card.right+1&&button.top>=card.top-1&&button.bottom<=card.bottom+1,"Every card action stays inside its compact frame");
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"No horizontal page overflow");
    const last=page.locator('[data-publish-validation-board] > article').last();
    await last.locator('header .cardActions > button').click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    assert.equal(await dialog.locator('[data-native-preview]').isVisible(),true,"A compact card keeps access to the full preview");
    const bounds=await dialog.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1);
    await dialog.locator('header > button').click();await dialog.waitFor({state:'hidden'});
    if(process.env.INRCY_VALIDATION_LAYOUT_PROOF&&[1440,390].includes(viewport.width)&&count!==1){
     await page.locator('.body').evaluate(element=>{element.scrollTop=0});
     await page.screenshot({path:`${process.env.INRCY_VALIDATION_LAYOUT_PROOF}-${viewport.width}-${count}.png`});
    }
    t.diagnostic(JSON.stringify({viewport,count,card:reference}));
   }
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>(window as unknown as {nativeCalls:number}).nativeCalls),0);
   await page.close();
  }
 }finally{await browser.close()}
});
