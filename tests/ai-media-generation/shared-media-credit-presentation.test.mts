import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import type { ReactNode } from "react";
import ts from "typescript";
import { catalogTranslator } from "../helpers/catalog-translator.mts";

type Counter=Record<string,unknown>;
const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8");
const hookPath="app/dashboard/_hooks/useMediaGeneration.ts";
const hook=ts.createSourceFile(hookPath,read(hookPath),ts.ScriptTarget.Latest,true);
// Run the real private normalizer, with its real numeric helper and defaults.
const statements=hook.statements.filter(node=>ts.isFunctionDeclaration(node)
  ? ["normalizeCounter","finiteNumber"].includes(node.name?.text||"")
  :ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>declaration.name.getText(hook)==="EMPTY_COUNTER"));
assert.equal(statements.length,3);
const counterModule={exports:{} as {normalizeCounter(value:unknown,unit:string):Counter}};
const counterJs=ts.transpileModule(statements.map(node=>node.getText(hook)).join("\n")+"\nexports.normalizeCounter=normalizeCounter;",{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;
new Function("exports",counterJs)(counterModule.exports);
const normalize=counterModule.exports.normalizeCounter;

function render(counter:Counter,extra:Counter={},locale:Parameters<typeof catalogTranslator>[1]="fr-FR") {
  const runtimeModule={exports:{} as {default(props:Counter):ReactNode}};
  const modules:Record<string,unknown>={
    "react/jsx-runtime":jsxRuntime,
    "next-intl":{useLocale:()=>locale,useTranslations:()=>catalogTranslator("media",locale)},
    "./VideoCreditRecharge":{MediaCreditRechargeButton:()=>null},
    "./MediaQuotaSummary.module.css":{__esModule:true,default:new Proxy({},{get:(_target,key)=>key})},
  };
  const source=ts.transpileModule(read("app/dashboard/_components/MediaQuotaSummary.tsx"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
  }).outputText;
  new Function("module","exports","require",source)(runtimeModule,runtimeModule.exports,(name:string)=>{
    assert.ok(Object.hasOwn(modules,name),`Unexpected component dependency ${name}`);return modules[name];
  });
  return renderToStaticMarkup(runtimeModule.exports.default({kind:"image",counter,creditsReady:true,resetDate:"01/12/2026",locked:false,onRefresh(){},...extra}));
}

test("the real client normalizer preserves the shared allowance and signed advance without accepting negative purchases",()=>{
  const result=normalize({unit:"credit",limit:2530,used:2537,reserved:0,remaining:-7,includedRemaining:-7,
    purchasedRemaining:-10,sharedPool:{memberCount:2,monthlyLimit:2530,poolId:"private"}},"credit");
  assert.equal(result.remaining,-7);assert.equal(result.includedRemaining,-7);
  assert.equal(Object.hasOwn(result,"purchasedRemaining"),false);
  assert.deepEqual(result.sharedPool,{memberCount:2,monthlyLimit:2530});
  for(const sharedPool of [null,{memberCount:1,monthlyLimit:2530},{memberCount:2,monthlyLimit:0},{memberCount:2.2,monthlyLimit:2530},
    {memberCount:"2",monthlyLimit:2530},{memberCount:2,monthlyLimit:1000001}])
    assert.equal(Object.hasOwn(normalize({unit:"credit",sharedPool},"credit"),"sharedPool"),false);
  assert.equal(normalize({unit:"item",limit:10,used:11,remaining:-1},"item").remaining,0);
  assert.equal(normalize({unit:"credit",used:-1,reserved:-1},"credit").used,0);
});

test("the real quota summary labels the common allowance and explains that purchased credits belong to this establishment",()=>{
  const counter=normalize({unit:"credit",remaining:2939,includedRemaining:2439,purchasedRemaining:500,
    sharedPool:{memberCount:2,monthlyLimit:2530}},"credit");
  const html=render(counter);
  assert.match(html,/data-shared-media-credit-pool="true"/);
  assert.match(html,/Inclus partagés entre 2 établissements/);
  assert.match(html,/2\s*939 crédits/);
  assert.match(html,/Inclus : 2\s*439/);
  assert.match(html,/Achetés : 500/);
  assert.match(html,/Les crédits achetés restent propres à cet établissement/);
  assert.doesNotMatch(render({...counter,sharedPool:undefined}),/data-shared-media-credit-pool/);
  assert.doesNotMatch(render(counter,{unlimited:true}),/Inclus partagés|data-shared-media-credit-pool/);
  assert.doesNotMatch(render(counter,{creditsReady:false}),/Inclus partagés|data-shared-media-credit-pool/);
  const advance=render({...counter,remaining:-7,includedRemaining:-7,purchasedRemaining:0});
  assert.match(advance,/data-negative="true"/);assert.match(advance,/-7 crédits/);
});

test("shared allowance copy renders with the real ICU catalogues for every supported locale",()=>{
  for(const locale of ["fr-FR","en-GB","de-DE","es-ES","it-IT","nl-NL","pt-PT","th-TH","zh-CN"] as const) {
    const html=render({unit:"credit",remaining:2439,includedRemaining:2439,purchasedRemaining:0,sharedPool:{memberCount:2,monthlyLimit:2530}},{},locale);
    assert.match(html,/data-shared-media-credit-pool="true"/);
    assert.doesNotMatch(html,/ai_generator_credit_shared_|\{accounts\}|\{credits\}/);
  }
});
