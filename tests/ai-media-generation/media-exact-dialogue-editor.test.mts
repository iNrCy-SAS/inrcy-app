import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {normalizeAiMediaGenerationRequest} from '../../lib/aiMediaGenerationContracts.ts';
import {normalizeAiMediaExactDialogue} from '../../lib/aiMediaExactDialogue.ts';
import {buildMediaExactDialogueCharacters,serializeMediaExactDialogueRows,importMediaExactDialogueText,createMediaExactDialogueRow,countMediaExactDialogueCharacters,getMediaExactDialogueDisplayBudget,initializeMediaExactDialogueRows,projectMediaExactDialogueRows,mergeMediaExactDialogueRows,
 type MediaExactDialogueCharacter} from '../../lib/mediaExactDialogueEditor.ts';

test('Exact starts with the chosen stable character while keeping existing and legacy speech intact',()=>{
 const characters=buildMediaExactDialogueCharacters([{id:'david',role:'character',characterName:'David'},{id:'garden',role:'environment'},{id:'kathia',role:'character',characterName:'Kathia'}]);
 const defaults={speechMode:'characters' as const,characterId:'kathia',narrationVoiceMode:'provided' as const};
 const rows=initializeMediaExactDialogueRows([], '', characters, defaults);
 assert.equal(rows.length,1);assert.equal(rows[0].speaker,'character');assert.equal(rows[0].characterId,'kathia');assert.equal(rows[0].text,'');
 const reordered=buildMediaExactDialogueCharacters([{id:'kathia',role:'character'},{id:'garden',role:'environment'},{id:'david',role:'character'}]);
 assert.equal(initializeMediaExactDialogueRows([], '', reordered, defaults)[0].characterId,'kathia');
 assert.equal(initializeMediaExactDialogueRows([], '', characters,{...defaults,characterId:null})[0].characterId,'david');
 assert.equal(initializeMediaExactDialogueRows([], '', characters,{...defaults,characterId:'removed'})[0].speaker,'unassigned');
 assert.equal(initializeMediaExactDialogueRows([], '', [],defaults)[0].speaker,'unassigned');
 const mixed=[{...rows[0],text:'Bonjour !'},createMediaExactDialogueRow('ai_voice','Bienvenue !')];
 assert.deepEqual(initializeMediaExactDialogueRows(mixed,'Un ancien texte.',characters,{speechMode:'voiceover'}),mixed);
 const legacy='Kathia : Bonjour !\nDavid : Bienvenue !';
 assert.deepEqual(initializeMediaExactDialogueRows([],legacy,characters,defaults).map(row=>[row.characterId,row.text]),[['kathia','Bonjour !'],['david','Bienvenue !']]);
 const unknown='Un ancien texte sans acteur.';
 const imported=initializeMediaExactDialogueRows([],unknown,characters,defaults);assert.equal(imported[0].text,unknown);assert.equal(imported[0].speaker,'unassigned');
 for(const source of ['ai','provided'] as const){const narrator=initializeMediaExactDialogueRows([],'',[],{speechMode:'voiceover',narrationVoiceMode:source});assert.equal(narrator[0].speaker,source==='provided'?'provided_voice':'ai_voice');}
});

test('voiceover projection edits the same text and order without destroying dormant photo assignments',()=>{
 const characters=buildMediaExactDialogueCharacters([{id:'david',role:'character'},{id:'kathia',role:'character'}]);
 const david={...createMediaExactDialogueRow('character','Bonjour de David.'),characterId:'david'},kathia={...createMediaExactDialogueRow('character','Bonjour de Kathia.'),characterId:'kathia'},offscreen=createMediaExactDialogueRow('ai_voice','Une conclusion.');
 const draft=[david,kathia,offscreen],before=structuredClone(draft);
 for(const source of ['ai','provided'] as const){
  const effective=projectMediaExactDialogueRows(draft,'voiceover',source);
  assert.deepEqual(effective.map(row=>[row.id,row.text]),draft.map(row=>[row.id,row.text]));
  assert.ok(effective.every(row=>row.speaker===(source==='provided'?'provided_voice':'ai_voice')&&row.characterId===undefined));
  assert.equal(serializeMediaExactDialogueRows(effective,characters).issue,null);
 }
 const projected=projectMediaExactDialogueRows(draft,'voiceover','ai');
 const added=createMediaExactDialogueRow('ai_voice','Une nouvelle phrase.');
 const edited=[{...projected[1],text:'Kathia révisée.'},projected[0],added];
 const merged=mergeMediaExactDialogueRows(draft,edited,'voiceover');
 assert.deepEqual(merged.map(row=>[row.id,row.speaker,row.characterId,row.text]),[[kathia.id,'character','kathia','Kathia révisée.'],[david.id,'character','david',david.text],[added.id,'ai_voice',undefined,added.text]]);
 const restored=projectMediaExactDialogueRows(merged,'characters','provided');assert.deepEqual(restored,merged);
 assert.deepEqual(draft,before);assert.deepEqual(projectMediaExactDialogueRows(merged,'silent','ai'),[]);
 assert.equal(serializeMediaExactDialogueRows(restored,characters.filter(character=>character.id!=='kathia')).issue,'missing_character');
});

test('the displayed speech allowance stays useful before typing and follows the actual engine duration without truncating drafts',()=>{
 const input={videoEngine:'kling' as const,videoResolution:'1080p' as const,durationSeconds:16,sceneMode:'single' as const,language:'fr-FR'};
 const rows=[createMediaExactDialogueRow()];
 const empty=getMediaExactDialogueDisplayBudget(rows,input);assert.equal(empty.units,0);assert.equal(empty.characters,0);assert.equal(empty.maxUnits,30);assert.equal(empty.maxCharacters,300);
 const short=getMediaExactDialogueDisplayBudget(rows,{...input,videoEngine:'wan27',durationSeconds:8});assert.equal(short.maxUnits,14);assert.equal(short.maxCharacters,140);
 const wanMulti=getMediaExactDialogueDisplayBudget(rows,{...input,videoEngine:'wan27',durationSeconds:16});assert.equal(wanMulti.maxUnits,28);assert.equal(wanMulti.maxCharacters,280,'native two-eight-second plans have their own allowance, unlike one sixteen-second Kling plan');
 const script=Array(31).fill('bonjour').join(' ');rows[0].text=script;const over=getMediaExactDialogueDisplayBudget(rows,input);assert.equal(over.units,31);assert.equal(over.characters,script.length);assert.ok(over.issue);assert.equal(rows[0].text,script);
 rows[0].text='x'.repeat(4100);const historical=getMediaExactDialogueDisplayBudget(rows,input);assert.equal(historical.characters,4100);assert.equal(rows[0].text.length,4100);assert.ok(historical.issue);
 const cjk=getMediaExactDialogueDisplayBudget([createMediaExactDialogueRow('ai_voice','你好')],{...input,language:'zh-CN'});assert.equal(cjk.unit,'caractères prononcés');assert.equal(cjk.units,2);assert.ok(cjk.maxUnits>0);
});

test('the same canonical photo table drives thumbnail numbers, editor choices and the real serialized request',()=>{
 const stamp=Date.now(),day=new Date(stamp).toISOString().slice(0,10);
 const photos=[
  {id:'optional-photo',name:'first.png',fromVideo:false,mimeType:'image/png' as const,data:'A'.repeat(64),role:'character' as const,usage:'inspiration' as const},
  {id:'garden',name:'garden.png',fromVideo:false,mimeType:'image/png' as const,data:'A'.repeat(64),role:'environment' as const,usage:'required' as const},
  {id:'required-photo',name:'second.png',fromVideo:false,mimeType:'image/png' as const,data:'A'.repeat(64),role:'character' as const,usage:'required' as const,voiceMode:'provided' as const,
   voiceSample:{path:`_studio-voice-references/${day}/synthetic-account__${stamp}__00000000-0000-4000-8000-000000000001.wav`,name:'voice.wav',mimeType:'audio/wav' as const,durationSeconds:7,sizeBytes:224044}},
 ];
 const characters=buildMediaExactDialogueCharacters(photos);
 assert.deepEqual(characters.map(character=>[character.id,character.characterIndex,character.referenceIndex]),[['optional-photo',1,0],['required-photo',2,2]]);
 const rows=[{...createMediaExactDialogueRow('character','Bonjour !'),characterId:'required-photo'}];
 const serialized=serializeMediaExactDialogueRows(rows,characters);assert.equal(serialized.issue,null);
 const source=readFileSync(new URL('../../app/dashboard/_components/MediaFreeGenerator.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('free.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='referencesForRequest');assert.ok(node);
 const javascript=ts.transpileModule(`${node.getText(ast)}\nexports.serialize=referencesForRequest;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const exported={} as {serialize:(references:typeof photos,voices:boolean,characters:MediaExactDialogueCharacter[])=>unknown[]};
 new Function('exports',javascript)(exported);
 const imagePayload=exported.serialize(photos,true,characters);
 const request=normalizeAiMediaGenerationRequest({requestId:'canonical-editor-payload',kind:'video',source:'studio',creationMode:'free',inputMode:'essential',freePrompt:'Deux personnes dans le jardin.',
   videoEngine:'kling',videoResolution:'1080p',durationSeconds:16,sceneMode:'single',format:'story',identityMode:'auto',identityConsent:true,teamVideoProviderConsent:'kling',
   withMusic:false,withNarration:false,exactDialogue:serialized.turns,inspirationImages:imagePayload});
 assert.equal(request.exactDialogue?.[0].characterIndex,2);assert.equal(request.inspirationImages[2].characterIndex,2);
 assert.equal(request.inspirationImages[2].voiceSample?.path,photos[2].voiceSample?.path);
 const reordered=buildMediaExactDialogueCharacters([photos[2],photos[1],photos[0]]);
 assert.equal(serializeMediaExactDialogueRows(rows,reordered).turns[0].characterIndex,1,'The same photo ID keeps its voice while its visible number changes');
 assert.equal(serializeMediaExactDialogueRows(rows,characters.filter(character=>character.id!=='required-photo')).issue,'missing_character');
});

test('line order and exact text survive while AI never consumes a photo slot',()=>{
 const characters=buildMediaExactDialogueCharacters([{id:'one',role:'character'},{id:'two',role:'character'}]);
 const rows=[createMediaExactDialogueRow('ai_voice','  Une introduction !\n'),{...createMediaExactDialogueRow('character','Bonjour !'),characterId:'two'}];
 const result=serializeMediaExactDialogueRows(rows,characters);assert.equal(result.issue,null);
 assert.deepEqual(result.turns,[{speaker:'ai_voice',text:'  Une introduction !\n'},{speaker:'character',characterIndex:2,text:'Bonjour !'}]);
 assert.deepEqual(normalizeAiMediaExactDialogue(result.turns),result.turns);
 assert.equal(countMediaExactDialogueCharacters(rows),rows[0].text.length+rows[1].text.length+1);
 assert.equal(serializeMediaExactDialogueRows([{...rows[0],text:'x'.repeat(2000)},{...rows[1],text:'x'.repeat(2000)}],characters).issue,'too_long');
 assert.equal(serializeMediaExactDialogueRows([createMediaExactDialogueRow()],characters).issue,'empty');
});

test('legacy paragraphs are retained without guessed actors, while explicit names can recover an existing photo binding',()=>{
 const text='  Une ancienne phrase exacte.\nUne autre phrase.  ';
 const characters=buildMediaExactDialogueCharacters([{id:'one',role:'character',characterName:'Alex'},{id:'two',role:'character',characterName:'Léa'}]);
 const unresolved=importMediaExactDialogueText(text,characters);
 assert.equal(unresolved[0].text,text);assert.equal(unresolved[0].speaker,'unassigned');
 const imported=importMediaExactDialogueText('Léa : Bonjour !\nAlex : Bonsoir !',characters);
 assert.deepEqual(imported.map(row=>[row.characterId,row.text]),[['two','Bonjour !'],['one','Bonsoir !']]);
 const unknown='Un inconnu : Bonjour !\nAlex : Bonsoir !';
 assert.equal(importMediaExactDialogueText(unknown,characters)[0].text,unknown);
});

test('the recorded offscreen narrator remains available alone, without silently mixing it with synthetic speech',()=>{
 const recorded=[createMediaExactDialogueRow('provided_voice','Bonjour !'),createMediaExactDialogueRow('provided_voice','Bienvenue !')];
 assert.equal(serializeMediaExactDialogueRows(recorded,[]).issue,null);
 assert.deepEqual(serializeMediaExactDialogueRows(recorded,[]).turns,[{speaker:'provided_voice',text:'Bonjour !'},{speaker:'provided_voice',text:'Bienvenue !'}]);
 assert.equal(serializeMediaExactDialogueRows([...recorded,createMediaExactDialogueRow('ai_voice','Autre voix.')],[]).issue,'provided_mix');
});
