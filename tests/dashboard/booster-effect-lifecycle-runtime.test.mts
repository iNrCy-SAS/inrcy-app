import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = ts.createSourceFile("PublishModal.tsx", readFileSync(new URL("../../app/dashboard/booster/publier/PublishModal.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "PublishModal");
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
function contextBindings(callee: string) {
  let keys: string[] | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === callee && ts.isObjectLiteralExpression(node.arguments[0])) {
      keys = node.arguments[0].properties.filter(ts.isShorthandPropertyAssignment).map(property => property.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(keys?.length);
  return keys;
}
async function setup(page: Page, declarations: string[], marker: string, bindings: string[], fixture: string, rendered = "null") {
  const code = `import {createElement,useCallback,useEffect,useEffectEvent,useState} from 'react';export default function Harness({snapshot}){const {${[...new Set(bindings)].join(",")}}=snapshot;${actualEffect(declarations,marker)}return ${rendered};}`;
  const sources = {
    react: packageSource("react", "react.development.js"), "react-dom": packageSource("react-dom", "react-dom.development.js"),
    "react-dom/client": packageSource("react-dom", "react-dom-client.development.js"), scheduler: packageSource("scheduler", "scheduler.development.js"),
    subject: ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
  };
  await page.route("**/*", route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(sources)},cache={},process={env:{NODE_ENV:'development'}},noop=()=>{};
    function require(name){if(cache[name])return cache[name].exports;if(!sources[name])throw Error('Unexpected fixture import '+name);const module=cache[name]={exports:{}};new Function('require','module','exports','process',sources[name])(require,module,module.exports,process);return module.exports;}
    const React=require('react'),Harness=require('subject').default,root=require('react-dom/client').createRoot(document.getElementById('root'));
    window.config={};window.configure=patch=>{window.config={...window.config,...patch};const snapshot=new Proxy(window.config,{get:(target,key)=>Object.hasOwn(target,key)?target[key]:noop});root.render(React.createElement(Harness,{snapshot}))};window.unmount=()=>root.unmount();
    ${fixture}
  ` });
  page.setDefaultTimeout(3_000);
}

test("draft effect captures editor defaults once, cancels on draft replacement and rejects late writes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, ["onPublicationDraftRequested"], "void onPublicationDraftRequested", [...contextBindings("loadPublicationDraft"), "loadPublicationDraft", "publicationDraftIdParam", "loadedPublicationDraftId", "ctaDefaults", "legacyMediaCutoverClientAvailable", "onUnsavedChange"], `
      window.loads=[];window.ideas=[];window.configure({publicationDraftIdParam:'draft-a',loadedPublicationDraftId:null,ctaDefaults:{facebook:'initial'},legacyMediaCutoverClientAvailable:false,onUnsavedChange:noop,defaultAiPreferredEngine:'google',channels:{facebook:true},i18nT:key=>'fr:'+key,setIdea:value=>window.ideas.push(value),loadPublicationDraft:(context,cancelled)=>new Promise(resolve=>window.loads.push({context,cancelled,finish:()=>{if(!cancelled()){context.setIdea(context.publicationDraftIdParam);window.configure({loadedPublicationDraftId:context.publicationDraftIdParam})}resolve()}}))});
    `);
    await page.waitForFunction("window.loads.length === 1");
    await page.evaluate("window.configure({defaultAiPreferredEngine:'openai',channels:{instagram:true},i18nT:key=>'en:'+key})");
    assert.equal(await page.evaluate("window.loads.length"), 1);
    assert.equal(await page.evaluate("window.loads[0].cancelled()"), false);
    assert.equal(await page.evaluate("window.loads[0].context.defaultAiPreferredEngine"), "google", "in-flight load retains its starting defaults");
    await page.evaluate("window.configure({publicationDraftIdParam:'draft-b'})");
    await page.waitForFunction("window.loads.length === 2");
    assert.equal(await page.evaluate("window.loads[0].cancelled()"), true);
    assert.equal(await page.evaluate("window.loads[1].context.defaultAiPreferredEngine"), "openai");
    assert.deepEqual(await page.evaluate("window.loads[1].context.channels"), { instagram: true });
    await page.evaluate("window.loads[1].finish();window.loads[0].finish()");
    await page.waitForFunction("window.config.loadedPublicationDraftId === 'draft-b'");
    assert.deepEqual(await page.evaluate("window.ideas"), ["draft-b"]);
    await page.evaluate("window.configure({channels:{facebook:true},defaultAiPreferredEngine:'google'})");
    assert.equal(await page.evaluate("window.loads.length"), 2, "edits after restoration never reload the draft");
    await page.evaluate("window.configure({publicationDraftIdParam:'draft-c'})");
    await page.waitForFunction("window.loads.length === 3");
    await page.evaluate("window.unmount();window.loads[2].finish()");
    assert.equal(await page.evaluate("window.loads[2].cancelled()"), true);
    assert.deepEqual(await page.evaluate("window.ideas"), ["draft-b"]);
  } finally { await browser.close(); }
});

test("Studio return waits for its draft, inserts through current callbacks once, and stays single during rerenders", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, ["onStudioReturnReady"], "onStudioReturnReady(pendingStudioReturn", ["pendingStudioReturn", "loadedPublicationDraftId", "completeReturn", "inlineStudioReturnKeyRef", "studioReturnApplyingKeyRef", "setImgError", "mediaT", "setPendingStudioReturn", "addMediaLibrarySelection"], `
      window.insertions=[];window.completions=0;window.errors=[];
      window.configure({pendingStudioReturn:{returnKey:'returned',action:'generate',context:{draftId:'draft-b'},item:{id:'generated',media_type:'image'}},loadedPublicationDraftId:'draft-a',inlineStudioReturnKeyRef:{current:''},studioReturnApplyingKeyRef:{current:''},completeReturn:()=>window.completions++,setImgError:value=>window.errors.push(value),mediaT:key=>key,setPendingStudioReturn:value=>window.configure({pendingStudioReturn:value}),addMediaLibrarySelection:()=>{throw Error('Previous draft callback must not run')}});
    `);
    await page.evaluate("window.configure({addMediaLibrarySelection:(items,destination)=>new Promise(resolve=>{window.insertions.push({items,destination});window.finish=()=>resolve(true)})})");
    assert.deepEqual(await page.evaluate("window.insertions"), []);
    await page.evaluate("window.configure({loadedPublicationDraftId:'draft-b'})");
    await page.waitForFunction("window.insertions.length === 1");
    await page.evaluate("window.configure({addMediaLibrarySelection:()=>{throw Error('Return must not insert twice')}})");
    assert.equal(await page.evaluate("window.insertions.length"), 1);
    await page.evaluate("window.finish()");
    await page.waitForFunction("window.completions === 1 && window.config.pendingStudioReturn === null");
    assert.deepEqual(await page.evaluate("window.insertions"), [{ items: [{ id: "generated", media_type: "image" }], destination: { kind: "publication" } }]);
    assert.deepEqual(await page.evaluate("window.errors"), []);
  } finally { await browser.close(); }
});

test("save action ref always uses the last committed form and is removed on unmount", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, ["onSavePublicationDraft"], "saveDraftActionRef.current = onSavePublicationDraft", [...contextBindings("savePublicationDraft"), "savePublicationDraft", "saveDraftActionRef"], `
      window.saved=[];window.saveRef={current:null};window.configure({idea:'first',selectedChannels:['facebook'],saveDraftActionRef:window.saveRef,savePublicationDraft:(context,options)=>{window.saved.push({idea:context.idea,channels:context.selectedChannels,options});return Promise.resolve()}});
    `, `createElement('output',{id:'committed-form'},JSON.stringify({idea,channels:selectedChannels}))`);
    await page.waitForFunction("typeof window.saveRef.current === 'function'");
    await page.evaluate("window.saveRef.current({updateRoute:false})");
    await page.evaluate("window.configure({idea:'edited',selectedChannels:['instagram']});window.saveRef.current({updateRoute:true})");
    assert.deepEqual(await page.evaluate("window.saved"), [
      { idea: "first", channels: ["facebook"], options: { updateRoute: false } },
      { idea: "first", channels: ["facebook"], options: { updateRoute: true } },
    ], "a scheduled render must not expose uncommitted form values");
    await page.waitForFunction("document.querySelector('#committed-form')?.textContent === JSON.stringify({idea:'edited',channels:['instagram']})");
    await page.evaluate("window.saveRef.current({updateRoute:true})");
    assert.deepEqual(await page.evaluate("window.saved"), [
      { idea: "first", channels: ["facebook"], options: { updateRoute: false } },
      { idea: "first", channels: ["facebook"], options: { updateRoute: true } },
      { idea: "edited", channels: ["instagram"], options: { updateRoute: true } },
    ]);
    await page.evaluate("window.unmount()");
    assert.equal(await page.evaluate("window.saveRef.current"), null);
  } finally { await browser.close(); }
});

test("Pinterest locale changes preserve board selection and localize errors without refetching", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await setup(page, ["[pinterestBoardsFailure, setPinterestBoardsFailure]", "pinterestBoardsError", "loadPinterestBoardsForPublish", "onPinterestBoardChange"], "void loadPinterestBoardsForPublish", ["connected", "channels", "pinterestBoards", "setPinterestBoards", "setPinterestBoardsLoading", "setPinterestBoardId", "setPinterestBoardName", "writePinterestBoardUiCache", "i18nT", "getSimpleFrenchErrorMessage", "fetch"], `
      window.requests=0;window.boardId='';window.boardName='';window.fail=false;
      window.configure({connected:{pinterest:true},channels:{pinterest:true},pinterestBoards:[],i18nT:key=>'fr:'+key,getSimpleFrenchErrorMessage:(_error,fallback)=>fallback,writePinterestBoardUiCache:noop,
        setPinterestBoards:boards=>window.configure({pinterestBoards:boards}),setPinterestBoardsLoading:value=>window.loading=value,
        setPinterestBoardId:value=>window.boardId=typeof value==='function'?value(window.boardId):value,setPinterestBoardName:value=>window.boardName=value,
        fetch:async()=>{window.requests++;if(window.fail)throw Error('Opaque provider failure');return {ok:true,json:async()=>({ok:true,boards:[{id:'board-a',name:'First'},{id:'board-b',name:'Selected'}],defaultBoardId:'board-a'})}}
      });
    `, `createElement('div',null,createElement('output',{id:'error'},pinterestBoardsError),createElement('button',{id:'retry',onClick:loadPinterestBoardsForPublish},'Retry'),createElement('button',{id:'choose',onClick:()=>onPinterestBoardChange('board-b')},'Choose'))`);
    await page.waitForFunction("window.requests === 1 && window.boardId === 'board-a' && !window.loading");
    await page.locator("#choose").click();
    assert.deepEqual(await page.evaluate("[window.boardId,window.boardName]"), ["board-b", "Selected"]);
    await page.evaluate("window.configure({i18nT:key=>'en:'+key})");
    await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(await page.evaluate("window.requests"), 1, "changing locale does not reload the board list");
    assert.deepEqual(await page.evaluate("[window.boardId,window.boardName]"), ["board-b", "Selected"]);
    await page.evaluate("window.fail=true");
    await page.locator("#retry").click();
    await page.waitForFunction("document.querySelector('#error').textContent === 'en:pinterest_boards_load_failed'");
    await page.evaluate("window.configure({i18nT:key=>'fr:'+key})");
    await page.waitForFunction("document.querySelector('#error').textContent === 'fr:pinterest_boards_load_failed'");
    assert.equal(await page.evaluate("window.requests"), 2, "error localization does not retry a failed request");
    assert.deepEqual(await page.evaluate("[window.boardId,window.boardName]"), ["board-b", "Selected"]);
  } finally { await browser.close(); }
});
