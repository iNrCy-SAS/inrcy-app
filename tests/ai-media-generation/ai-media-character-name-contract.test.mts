import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import sharp from 'sharp';
import {normalizeAiMediaCharacterName} from '../../lib/aiMediaCharacterVoices.ts';
import {normalizeAiMediaGenerationRequest} from '../../lib/aiMediaGenerationContracts.ts';
import {prepareAiMediaIdentityReferences} from '../../lib/aiMediaIdentityReferences.ts';
import {buildAiMediaVideoProviderContract,hashAiMediaVideoProviderContract} from '../../lib/aiMediaVideoProviderContract.ts';
import {createAiMediaRequestFingerprint} from '../../lib/aiMediaGenerationQuotaPolicy.ts';
import {buildGenerationAttemptKey} from '../../lib/mediaGenerationClientRequest.ts';
import {getAiMediaVideoSpeechState} from '../../lib/aiMediaVideoSpeechBudget.ts';

function request(names:unknown[]=['Alex','Léa']){
 return normalizeAiMediaGenerationRequest({requestId:'synthetic-character-names',creationMode:'free',kind:'video',source:'studio',videoEngine:'kling',durationSeconds:16,
  freePrompt:'Deux personnes entretiennent un jardin.',withNarration:false,teamVideoSpeechMode:'characters',identityMode:'reference_team',identityConsent:true,teamVideoProviderConsent:'kling',
  inspirationImages:names.map((characterName,index)=>({mimeType:'image/png',data:'A'.repeat(64),role:'character',usage:'required',characterIndex:index+1,characterName}))});
}

test('explicit character names normalize consistently, reject control syntax and remain unique among photos',()=>{
 assert.equal(normalizeAiMediaCharacterName('  Ａlex   Martin  '),'Alex Martin');
 for(const name of ['Léa','Jean-Pierre',"O’Connor",'王女士','山田さん','ศิริ'])assert.equal(normalizeAiMediaCharacterName(name),name);
 for(const value of [null,14,'A'.repeat(41),'Alex:','Alex\u0000','Alex (1)','<script>'])assert.equal(normalizeAiMediaCharacterName(value),null);
 assert.equal(normalizeAiMediaCharacterName('  '),'');
 assert.deepEqual(request(['  Ａlex  ','Léa']).inspirationImages.map(image=>image.characterName),['Alex','Léa']);
 assert.throws(()=>request(['Alex','ＡLEX']),/nom différent/);
 assert.throws(()=>request(['Alex:','Léa']),/nom du personnage/);
 const legacy=request([undefined,undefined]);assert.ok(legacy.inspirationImages.every(image=>!Object.hasOwn(image,'characterName')));
});

test('photo preparation and both client/server idempotency fingerprints preserve the explicit identity assignment',async()=>{
 const input=request(),swapped=request(['Léa','Alex']);
 const image=await sharp({create:{width:512,height:512,channels:3,background:'#448866'}}).png().toBuffer();
 const prepared=await prepareAiMediaIdentityReferences(input.inspirationImages.map(reference=>({...reference,data:image.toString('base64')})));
 assert.deepEqual(prepared.providerImages.map(reference=>reference.characterName),['Alex','Léa']);
 const client=(value:ReturnType<typeof request>)=>buildGenerationAttemptKey({creationMode:value.creationMode,kind:value.kind,source:value.source,subjectSource:value.subjectSource,
   idea:value.idea,freePrompt:value.freePrompt,textKeywords:value.textKeywords,format:value.format,imageStyle:value.imageStyle,peopleMode:value.peopleMode,videoEngine:'kling',useBrandColors:value.useBrandColors,logoMode:value.logoMode,
   inspirationImages:value.inspirationImages.map((reference,index)=>({...reference,name:`photo-${index}.png`}))},value.idea);
 assert.notEqual(client(input),client(swapped));
 const file='app/api/media-generation/generate/route.ts',source=readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const node=ast.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text==='generationFingerprint');assert.ok(node);
 const compiled=ts.transpileModule(`${node.getText(ast)}\nexports.fingerprint=generationFingerprint;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={} as {fingerprint:(value:unknown)=>string};
 new Function('exports','createAiMediaRequestFingerprint','AI_MEDIA_FREE_PROMPT_VERSION','AI_MEDIA_PROMPT_VERSION',compiled)(exports,createAiMediaRequestFingerprint,'test-free','test-guided');
 assert.notEqual(exports.fingerprint(input),exports.fingerprint(swapped));
 const contract=buildAiMediaVideoProviderContract({request:input,durationSeconds:16,brandColors:[]});
 assert.match(contract.references,/character-1\/name="Alex"/);assert.match(contract.references,/character-2\/name="Léa"/);
 assert.notEqual(contract.sha256,hashAiMediaVideoProviderContract({...contract,references:contract.references.replace('"Alex"','"Autre"')}));
});

test('long declared names are neither spoken words nor caption characters in the real speech preflight',()=>{
 const input=request(['Alex'.padEnd(40,'a'),'Léa'.padEnd(40,'b')]);
 const first='Notre jardin est prêt pour demain.',second='Les feuilles brillent dans cette lumière.';
 const spokenScript=`${input.inspirationImages[0].characterName} : ${first}\n${input.inspirationImages[1].characterName} : ${second}`;
 const state=getAiMediaVideoSpeechState({...input,durationSeconds:8,spokenScript});
 assert.equal(state.issue,null);assert.equal(state.units,12);assert.equal(state.characters,`${first}\n${second}`.length);
 assert.equal(state.script,spokenScript,'The editable exact field remains intact');
 assert.equal(state.segmentBudgets[0].script,`${first}\n${second}`);
});
