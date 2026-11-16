import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import test from "node:test";
import * as React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import * as phones from "../../lib/ctaPhoneNumbers.ts";

const root=process.cwd(),require=createRequire(import.meta.url);
const pair="+243981837026 / +8618666071730";
const read=(file:string)=>readFileSync(path.join(root,file),"utf8");
function functions(file:string,names:string[],variables:string[]=[]){
  const ast=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),statements:string[]=[];
  const visit=(node:ts.Node)=>{
    if(ts.isFunctionDeclaration(node)&&node.name&&names.includes(node.name.text))statements.push(node.getText(ast));
    if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>ts.isIdentifier(item.name)&&variables.includes(item.name.text)))statements.push(node.getText(ast));
    ts.forEachChild(node,visit);
  };visit(ast);return statements.join("\n");
}
function evaluate<T>(source:string,context:Record<string,unknown>,result:string):T{
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(context),`${compiled}\nreturn ${result};`)(...Object.values(context)) as T;
}

test("Badge exposes two individually labelled call actions and exports two vCard telephone entries",()=>{
  const source=functions("app/badge/[slug]/page.tsx",["escapeVCard","createVCardDataUri"],["phoneNumbers","primaryActions"]);
  const context={...phones,phone:pair,shareSettings:{phone:true,email:false,saveContact:false},badgeText:{call:"Appeler"},trim:(value:unknown)=>String(value??"").trim()};
  const result=evaluate<{actions:Array<{href:string;label:string}>;vcard:string}>(source,context,`({actions:primaryActions,vcard:createVCardDataUri({phone,firstName:"Camille",lastName:"Martin",displayName:"Atelier",company:"Atelier"})})`);
  assert.deepEqual(result.actions.map(action=>action.href),["tel:+243981837026","tel:+8618666071730"]);
  assert.deepEqual(result.actions.map(action=>action.label),["Appeler : +243981837026","Appeler : +8618666071730"]);
  assert.deepEqual(decodeURIComponent(result.vcard.split(",")[1]).split("\n").filter(line=>line.startsWith("TEL;")),["TEL;TYPE=WORK,VOICE:+243981837026","TEL;TYPE=WORK,VOICE:+8618666071730"]);
});

test("Annuaire structured data keeps separate telephone values and call targets without inventing a country prefix",()=>{
  const source=functions("app/entreprises/[slug]/page.tsx",["normalizeStructuredPhone","buildJsonLd"]);
  const data={phone:pair,email:"",slug:"atelier",sections:{cta:true},services:[],zones:[],socialLinks:[],media:[],customerTypes:[]};
  const context={...phones,data,i18nT:(key:string)=>key,buildOpeningHoursSpecification:()=>[],buildInrSearchPublicUrl:()=>"https://app.inrcy.test/entreprises/atelier"};
  const result=evaluate<{telephone:string[];contactPoint:{telephone:string[]};potentialAction:{target:string[]}}>(source,context,'buildJsonLd(data,i18nT,"fr-FR")');
  assert.deepEqual(result.telephone,["+243981837026","+8618666071730"]);
  assert.deepEqual(result.contactPoint.telephone,result.telephone);
  assert.deepEqual(result.potentialAction.target,["tel:+243981837026","tel:+8618666071730"]);
  assert.equal(evaluate(source,context,'normalizeStructuredPhone("0612345678")'),"0612345678");
});

test("Annuaire contact card renders two complete actionable phone links inside one contact route",()=>{
  const file="app/entreprises/[slug]/InrSearchContactOrbit.tsx";
  const compiled=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const record={exports:{} as {default:React.ComponentType<Record<string,string>>}};
  new Function("require","module","exports",compiled)((id:string)=>{
    if(id==="next-intl")return{useTranslations:()=>((key:string)=>key==="appeler_de49ee03"?"Appeler":key)};
    if(id==="@/lib/ctaPhoneNumbers")return phones;
    if(id.endsWith(".css"))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
    if(id==="./InrSearchLeadForm"||id==="./InrSearchLogo")return{__esModule:true,default:()=>null};
    if(id==="./inrSearchContactEvents")return{INR_SEARCH_OPEN_CONTACT_EVENT:"test-contact"};
    return require(id);
  },record,record.exports);
  const props={slug:"atelier",companyName:"Atelier",logoUrl:"",profession:"",city:"",phone:pair,phoneHref:"",email:"",emailHref:"",addressLine:"",websiteUrl:"",directionsUrl:""};
  const html=renderToStaticMarkup(React.createElement(record.exports.default,props));
  const links=[...html.matchAll(/<a[^>]*href="(tel:[^"]+)"[^>]*>([^<]+)<\/a>/g)];
  assert.deepEqual(links.map(link=>[link[1],link[2]]),[["tel:+243981837026","+243981837026"],["tel:+8618666071730","+8618666071730"]]);
  assert.match(html,/1 voie/);
  const invalid=renderToStaticMarkup(React.createElement(record.exports.default,{...props,phone:"+243981837026 / invalid"}));
  assert.doesNotMatch(invalid,/href="tel:/);
});
