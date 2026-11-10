import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { nativeFixtureRefusal, fixtureEffectIdentity, fixtureEffectFingerprint, projectNativeFixtureRead, providerVisualSummary, providerOutputPartSummary } from './lib/inr-assistant-fixture-boundary.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(arg('source') || resolve(import.meta.dirname, '..'));
const { getInrAssistantNavigation } = await import(pathToFileURL(resolve(root,'lib/inrAssistantUiCommands.ts')).href);
const { isDashboardDestinationAllowedForEdition } = await import(pathToFileURL(resolve(root,'lib/dashboardEdition.ts')).href);
const { inrAssistantToolsOutsideEdition } = await import(pathToFileURL(resolve(root,'lib/inrAssistantActionCoverage.ts')).href);
const { INR_ASSISTANT_COMMANDS } = await import(pathToFileURL(resolve(root,'lib/inrAssistantCommandRegistry.ts')).href);
const { continueInrAssistantTask } = await import(pathToFileURL(resolve(root,'lib/inrAssistantTaskPolicy.ts')).href);
const { parseInrAssistantClientContext } = await import(pathToFileURL(resolve(root,'lib/inrAssistantClientContext.ts')).href);
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript'), sdk = require('ai');
const live = process.argv.includes('--live');
if (!arg('dataset')) throw new Error('Provide --dataset=<JSON> and --report=<JSON>; --live opts in to paid models with synthetic business effects.');
const dataPath = resolve(arg('dataset'));
const dataset = JSON.parse(readFileSync(dataPath, 'utf8'));
const datasetSha256 = createHash('sha256').update(readFileSync(dataPath)).digest('hex');
const cases = (Array.isArray(dataset) ? dataset : dataset.cases).map(test=>({...test,...(!test.fileContexts&&test.fileContextSet?{fileContexts:dataset.fileContextSets?.[test.fileContextSet]}:{})}));
const selected = cases.filter((c, i) => (!arg('cases') || arg('cases').split(',').includes(c.id)) && i >= Number(arg('offset') || 0)).slice(0, Number(arg('limit') || 1000));
assert.ok(selected.length);
const reportPath = resolve(arg('report') || resolve(root, 'test-results/inr-assistant-three-packs.json'));
const maxCalls = Math.min(1000, Number(arg('max-calls') || 500));
const maxUsd = Math.min(5, Number(arg('max-usd') || 2));
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root,encoding:'utf8',windowsHide:true}).trim();
const fingerprints = () => Object.fromEntries(['lib/inrAssistantGateway.ts','lib/inrAssistantToolRegistry.ts','lib/inrAssistantConversation.ts','lib/inrAssistantObjectives.ts','lib/inrAssistantTaskPolicy.ts','lib/inrAssistantToolRouting.ts','lib/inrAssistantActionCoverage.ts','lib/inrAssistantStudioFacts.ts','tests/ai-assistant/schema-budget.test.mts'].map(file => [file, createHash('sha256').update(readFileSync(resolve(root,file),'utf8').replaceAll('\r\n','\n')).digest('hex')]));
const initialSourceFingerprints = fingerprints();
const startedAt = new Date().toISOString();
const rates = {'alibaba/qwen3.7-flash':{input:.03,output:.13},'openai/gpt-6-luna':{input:.10,output:.50},'anthropic/claude-haiku-5.5':{input:.10,output:.50},'openai/gpt-6.1-sol':{input:2,output:10}};
const ACCOUNT='10000000-0000-4000-8000-000000000001',ACTOR='20000000-0000-4000-8000-000000000001';
const MUTATIONS = new Set(Object.keys(INR_ASSISTANT_COMMANDS));
['refreshStatsSources','sendIndividualMail','sendMailDraft','runScreenCommand'].forEach(name=>MUTATIONS.add(name));
const NON_EFFECT_STATUSES = new Set(['preview_ready','ui_requested','navigation_requested','confirmation_required','needs_input','needs_details','needs_instruction','not_included','blocked','unavailable','unknown','unchanged','already_processed']);
const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
let activeCase, apiCalls=0, chargedEstimateUsd=0;
const results=[], providerUsage=[], providerErrors=[], providerTrace=[];
const gateway = live ? sdk.createGateway({apiKey:process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,fetch:async(input,init)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  assert.equal(url.origin,'https://ai-gateway.vercel.sh');
  return fetch(input,init);
}}) : null;

const fixtureMap = test => {
  if(!Array.isArray(test.fixtureResponses))return test.fixtureResponses??test.fixtures??{};
  const result={};
  for(const item of test.fixtureResponses){
    if(item.matchInput){result[item.tool]??={byInput:[]};result[item.tool].byInput.push({when:item.matchInput,responses:item.sequence??[item.output]});}
    else result[item.tool]={responses:item.sequence??[item.output]};
  }
  return result;
};
function fixtureExecute(name,input,factoryArgs,nativeModule={}){
  const call={tool:name,input}; activeCase.calls.push(call);
  const scope=factoryArgs[0] ?? {}, test=activeCase.test;
  let output;
  const refusal=nativeFixtureRefusal(name,input,scope,nativeModule);
  if(refusal){call.output=refusal;call.nativeInputRejected=true;call.nativeQuoteRejected=refusal.inputIssue==='exact_instruction_quote_required';return refusal;}
  const currentInstructions=[scope.currentUserMessage,scope.currentApprovalMessage].filter(value=>typeof value==='string');
  if(typeof input.instructionQuote==='string' && currentInstructions.length && !currentInstructions.some(value=>value.includes(input.instructionQuote.trim()))){
    output={ok:false,status:'needs_instruction',inputIssue:'exact_instruction_quote_required',noEffect:true,retryableInput:true,message:'La citation doit être une sous-chaîne exacte de la consigne actuelle, sans réécrire le verbe ni retirer des mots. Reprenez le texte exact avant toute action. Rien exécuté.'};
    call.output=output;call.nativeQuoteRejected=true;return output;
  }
  const operationKey=MUTATIONS.has(name)&&name!=='runScreenCommand'?fixtureEffectIdentity(name,input,scope,nativeModule):null;
  const operationFingerprint=operationKey?fixtureEffectFingerprint(name,input,nativeModule):null;
  if(operationKey&&activeCase.mutationCache.has(operationKey)){
    const previous=activeCase.mutationCache.get(operationKey);
    if(previous.fingerprint!==operationFingerprint&&nativeModule.getInrAssistantWorkspaceSlotReuseRefusal){
      call.output=nativeModule.getInrAssistantWorkspaceSlotReuseRefusal(name==='prepareCampaignEmail'?'campaign':'appointment',previous.output?.ok===true);call.nativeInputRejected=true;return call.output;
    }
    call.output=previous.output;call.syntheticReplay=true;return call.output;
  }
  call.fixtureBoundary=true;
  if(inrAssistantToolsOutsideEdition([name],test.edition).length) output={ok:false,status:'not_included',message:'Ce module ne fait pas partie de cette offre ; aucune action exécutée.',nextAction:{label:'Mon abonnement',href:'/dashboard?panel=abonnement'}};
  else {
    const definitions=fixtureMap(test), declared=definitions[name] ?? (dataset.fixtures?.[test.fixtureSet]?.[name]);
    if(declared !== undefined){
      const index=activeCase.calls.filter(c=>c.tool===name&&c.fixtureBoundary).length-1;
      const sequence=declared?.responses ?? (Array.isArray(declared)?declared:null);
      const branch=declared?.byInput?.find(branch=>Object.entries(branch.when??{}).every(([key,value])=>JSON.stringify(input[key])===JSON.stringify(value)));
      const branchCalls=branch?activeCase.calls.filter(c=>c.tool===name&&c.fixtureBoundary&&Object.entries(branch.when??{}).every(([key,value])=>JSON.stringify(c.input[key])===JSON.stringify(value))).length-1:0;
      const branchOutput=branch?.responses?branch.responses[Math.min(branchCalls,branch.responses.length-1)]:branch?.output;
      output=structuredClone(declared?.byInput ? branchOutput ?? declared.fallback ?? {ok:false,status:'unavailable',message:'Fixture absente pour cette variante native ; aucun fait inventé.'} : sequence ? sequence[Math.min(index,sequence.length-1)] : declared);
      if(output && Object.hasOwn(output,'output')) output=output.output;
    }
    else if(name==='navigateApplication'){
      const navigation=getInrAssistantNavigation(input.destination,input.documentId);
      output=navigation&&isDashboardDestinationAllowedForEdition(navigation.href,test.edition)?{ok:true,status:'navigation_requested',navigation,message:'Ouverture demandée au navigateur de démonstration ; aucun consentement OAuth.'}:{ok:false,status:'not_included',message:'Destination non disponible dans cette offre.'};
    }
    else if(name==='getBusinessDna') output={ok:true,savedMemory:true,knowledge:{company:'Atelier Démonstration',city:'Lyon',services:['Réparation de vélos'],tone:'Clair et chaleureux'}};
    else if(name==='searchCrmContacts') output={ok:true,items:[],contacts:[],truncated:false,nextOffset:null};
    else if(name==='searchMedia') output={ok:true,items:[],truncated:false,nextOffset:null,olderItemsMayExist:false};
    else if(name==='getRecentPublications'||name==='readPublicationWorkspace') output={ok:true,items:[],nextOffset:null,message:'Aucun résultat dans cet échantillon fictif.'};
    else if(name==='readWorkspaceSection') output={ok:true,section:input.section,items:[],counts:{clients:0,prospects:0},summary:'Compte fictif sans résultat dans cette section.'};
    else if(name==='readChannelStatus') output={ok:true,liveVerified:false,channels:[{key:'facebook',connected:false,needsReconnect:true}],message:'État enregistré : Facebook doit être reconnecté. Aucun OAuth effectué.'};
    else if(name==='guideChannelConnection') output={ok:true,status:'navigation_required',connectionPerformed:false,channel:input.channel,nextAction:{label:'Mes canaux',href:'/dashboard?panel=facebook'},message:'Autorisation officielle du titulaire nécessaire dans le panneau du canal.'};
    else if(name==='readStatsSnapshots') output={ok:true,liveVerified:false,source:'saved_account_statistics',snapshots:[{generatedAt:'2026-11-09T12:00:00.000Z',currentDataKnown:true,sources:[{channel:'facebook',dataKnown:true,totals:{impressions:1140,clicks:57}},{channel:'instagram',dataKnown:false,totals:{}}]}],message:'Instantané enregistré du9novembre2026 : Facebook1140impressions/57clics. Instagram inconnu ; pas zéro. Aucune actualisation.'};
    else if(name==='getAccountDiagnostics') output={ok:true,source:'active_account_diagnostics',checkedAt:'2026-11-10T20:00:00.000Z',complete:false,liveVerified:false,windowHours:168,sources:[{id:'server_events',status:'available',found:1},{id:'provider_status',status:'unavailable',found:0}],items:[{area:'publications',category:'connection_required',status:'failed',channel:'facebook',occurredAt:'2026-11-08T09:15:00.000Z',message:'Autorisation Facebook expirée lors de la tentative datée du8novembre2026.',nextStep:'Accueil → Connecter mes canaux → Facebook → Reconnecter si proposé, puis vérifier le suivi.'}],truncated:false,message:'Incident enregistré et daté ; aucune cause en direct vérifiée, une source indisponible. Aucune réparation ni relance.'};
    else if(name==='runScreenCommand'&&test.screen){
      const allowed=test.screen.availableCommands?.includes(input.command);
      output=allowed?{ok:true,status:'ui_requested',uiCommand:{command:input.command,selection:test.screen.selection,revision:test.screen.revision,...(input.patch?{patch:input.patch}:{})},message:'Commande native préparée ; attend le reçu du navigateur.'}:{ok:false,status:'blocked',message:'Commande absente de cet écran.'};
    }
    else if(MUTATIONS.has(name)) output={ok:false,status:'needs_input',message:'Aucune fixture native admissible ne permet cette action dans ce scénario. Rien exécuté.'};
    else output={ok:false,status:'unavailable',message:'Cette source n’est pas disponible dans le scénario fictif ; aucune donnée réelle consultée.'};
  }
  output=projectNativeFixtureRead(name,input,output);
  if(name==='selectCampaignMailbox'&&output?.ok&&typeof output.sender==='string')output=nativeModule.getInrAssistantCampaignInputRefusal?.(scope.currentUserMessage??'',name,input,output.sender)??output;
  if(['previewCalendarAction','applyCalendarAction'].includes(name))call.nativeGuardCoverage='quote_only_requires_separate_native_tests';
  call.output=output;
  if(operationKey)activeCase.mutationCache.set(operationKey,{fingerprint:operationFingerprint,output});
  if(['generateMedia','modifyMedia','getMediaGeneration'].includes(name)) scope.onResult?.(output);
  if(['preparePublication','executePublication','editPublication','getPublicationStatus'].includes(name)) scope.onResult?.(output);
  return output;
}

function loadHarness(){
  const file=resolve(root,'tests/ai-assistant/schema-budget.test.mts');
  let source=readFileSync(file,'utf8'); source=source.slice(0,source.indexOf('\nconst scenarios ='));
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),replacements=[];
  const visit=node=>{if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='createGateway')replacements.push([node.getStart(ast),node.getEnd(),'createGateway: () => __evaluation.gateway']);ts.forEachChild(node,visit);}; visit(ast); assert.equal(replacements.length,1);
  for(const[start,end,value]of replacements.reverse())source=source.slice(0,start)+value+source.slice(end);
  const marker='definitions.set(definition.inputSchema, { name: toolName, description: definition.description });';assert.ok(source.includes(marker));
  source=source.replace(marker,`${marker}\nif (!["readAppGuide","readCurrentDateTime","readAttachedDocument","recallPastDiscussions"].includes(toolName)) (value as {execute?:unknown}).execute = (input: unknown) => __evaluation.execute(toolName,input,args,moduleRecord.exports);`);
  const nativeMarker='definitions.set(result.inputSchema, { name: "proposeHumanSupport", description: result.description });';
  assert.ok(source.includes(nativeMarker));
  source=source.replace(nativeMarker,`${nativeMarker}\nif (result.execute) { const execute = result.execute; result.execute = (input: unknown, options: unknown) => __evaluation.nativeExecute(execute, input, options); }`);
  source=source.replace('reserveInrAssistantRequest: async () => ({ solReserved: false })','reserveInrAssistantRequest: async () => ({ solReserved: __evaluation.solQuotaAvailable() })');
  source=source.replaceAll('Date, Intl, URL,','Date, Intl, Buffer, Uint8Array, ArrayBuffer, URL,');
  source=source.replaceAll('TextEncoder, AbortSignal','TextEncoder, TextDecoder, AbortSignal');
  source=source.replaceAll('import.meta.url',JSON.stringify(pathToFileURL(file).href));source+='\nmodule.exports={harness};\n';
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const evaluation={execute:fixtureExecute,nativeExecute:async(execute,input,options)=>{const name=activeCase.toolCallNames?.get(options?.toolCallId)??'native_tool_unresolved';const output=await execute(input,options);activeCase.calls.push({tool:name,input,output,executor:'real_pure_or_scoped_fixture_reader'});return output;},solQuotaAvailable:()=>!!activeCase.test.solQuotaAvailable,gateway:modelId=>{
    assert.ok(Object.hasOwn(rates,modelId)); const model=gateway?.(modelId);
    return{specificationVersion:'v3',provider:'real-model-synthetic-business',modelId,supportedUrls:{},doStream:async()=>{throw Error('No stream in this harness');},doGenerate:async params=>{
      if(!live)return{content:[{type:'text',text:'Validation locale de schémas.'}],finishReason:{unified:'stop',raw:'fixture'},usage:{inputTokens:{total:0},outputTokens:{total:0}},warnings:[]};
      const rate=rates[modelId],upper=(32000*rate.input+6000*rate.output)/1e6;
      assert.ok(apiCalls<maxCalls&&chargedEstimateUsd+upper<=maxUsd,'Batch spending or call ceiling reached');
      apiCalls++; const trace={caseId:activeCase.test.id,turn:activeCase.turn,modelId,availableTools:(params.tools??[]).map(t=>t.name),providerBytes:new TextEncoder().encode(JSON.stringify(params.prompt)).byteLength,...providerVisualSummary(params)};providerTrace.push(trace);
      const start=Date.now(); let response;
      try{response=await model.doGenerate({...params,abortSignal:AbortSignal.any([...(params.abortSignal?[params.abortSignal]:[]),AbortSignal.timeout(45000)])});}
      catch(error){chargedEstimateUsd+=upper;let message=String(error?.message??'Provider failure').slice(0,600);for(const secret of[process.env.AI_GATEWAY_API_KEY,process.env.VERCEL_OIDC_TOKEN].filter(Boolean))message=message.replaceAll(secret,'[redacted]');providerErrors.push({caseId:activeCase.test.id,modelId,name:error?.name,status:error?.statusCode,message,retainedEstimateUsd:upper});throw error;}
      trace.durationMs=Date.now()-start;trace.outputParts=providerOutputPartSummary(response);
      trace.toolCalls=response.content.filter(c=>c.type==='tool-call').map(({type,toolCallId,toolName,input})=>({type,toolCallId,toolName,input}));
      for(const call of trace.toolCalls)activeCase.toolCallNames.set(call.toolCallId,call.toolName);
      const inputTokens=response.usage?.inputTokens?.total,outputTokens=response.usage?.outputTokens?.total;
      const cost=response.providerMetadata?.gateway?.gatewayCost;
      const nativeCost=(typeof cost==='number'||typeof cost==='string'&&/^\d+(?:\.\d+)?$/.test(cost))&&Number.isFinite(Number(cost))&&Number(cost)>=0?Number(cost):null;
      const estimatedUsd=nativeCost??(typeof inputTokens==='number'&&typeof outputTokens==='number'?(inputTokens*rate.input+outputTokens*rate.output)/1e6:upper);
      chargedEstimateUsd+=estimatedUsd;providerUsage.push({caseId:activeCase.test.id,turn:activeCase.turn,modelId,inputTokens,outputTokens,estimatedUsd,costSource:nativeCost===null?'usage_estimate':'provider_gateway_cost'});return response;
    }};
  }};
  const record={exports:{}};vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`,{__evaluation:evaluation,Date,Intl,Buffer,Uint8Array,ArrayBuffer,URL,URLSearchParams,Request,Response,Headers,TextEncoder,TextDecoder,AbortSignal,setTimeout,clearTimeout,console})(createRequire(file),record,record.exports);
  return record.exports.harness;
}
const harness=loadHarness();
const actualEffects = calls => calls.filter(c=>!c.syntheticReplay&&MUTATIONS.has(c.tool)&&c.output?.ok===true&&!NON_EFFECT_STATUSES.has(c.output.status));
function checkCase(test,reply,failure,calls){
  const exp=test.expectations??{},issues=[],checks=[];
  if(!live)return{passed:!failure,issues:failure?['offline_runtime_load']:[],checks:['offline_runtime_load_only'],counts:{},effects:[],needsHumanReview:true};
  const testIt=(label,condition)=>{checks.push(label);if(!condition)issues.push(label);};
  testIt('response_available',!failure&&!!reply?.message?.trim());
  const counts=Object.fromEntries([...new Set(calls.map(c=>c.tool))].map(name=>[name,calls.filter(c=>c.tool===name).length]));
  const req=exp.requiredTools??test.calls??{};
  for(const[name,count]of Array.isArray(req)?req.map(n=>typeof n==='string'?[n,1]:[n.name,n.minCalls??1]):Object.entries(req))testIt('required:'+name,(counts[name]??0)>=(Number(count)||1));
  if(Array.isArray(req))for(const item of req.filter(n=>typeof n==='object')){
    if(item.maxCalls!==undefined)testIt('max_calls:'+item.name,(counts[item.name]??0)<=item.maxCalls);
    for(const[path,value]of Object.entries(item.inputEquals??{}))testIt('required_input:'+item.name+':'+path,calls.some(c=>c.tool===item.name&&JSON.stringify(path.split('.').reduce((v,k)=>v?.[k],c.input))===JSON.stringify(value)));
  }
  for(const name of exp.forbiddenTools??test.forbidden??[])testIt('forbidden_attempt:'+name,!counts[name]);
  for(const name of exp.forbiddenSuccessTools??[])testIt('forbidden_success:'+name,!actualEffects(calls).some(c=>c.tool===name));
  if(test.readOnly||exp.readOnly||exp.noMutation)testIt('no_business_effect',actualEffects(calls).length===0);
  for(const[name,max]of Object.entries(exp.maxCalls??{}))testIt('max_calls:'+name,(counts[name]??0)<=max);
  for(const group of exp.anyOfTools??(test.oneOf?[test.oneOf]:[]))testIt('any_tool:'+group.join('|'),group.some(name=>counts[name]));
  const text=normalize(reply?.message);
  for(const word of exp.answerContainsAll??[])testIt('answer_contains:'+word,text.includes(normalize(word)));
  if(exp.answerContainsAny?.length)testIt('answer_contains_any',exp.answerContainsAny.some(word=>text.includes(normalize(word))));
  for(const word of exp.answerNotContains??[])testIt('answer_excludes:'+word,!text.includes(normalize(word)));
  for(const pattern of exp.answerPatterns??[])testIt('answer_pattern:'+pattern,new RegExp(pattern,'iu').test(reply?.message??''));
  for(const pattern of exp.answerForbiddenPatterns??[])testIt('answer_forbidden_pattern:'+pattern,!new RegExp(pattern,'iu').test(reply?.message??''));
  if(exp.outcomes?.length)testIt('allowed_outcome',exp.outcomes.includes(reply?.outcome));
  if(exp.studioDraft!==undefined){
    if(typeof exp.studioDraft==='boolean')testIt('studio_draft',!!reply?.studioDraft===exp.studioDraft);
    else {testIt('studio_draft',!!reply?.studioDraft===exp.studioDraft.required);for(const field of ['version','mediaType','format','durationSeconds'])if(Object.hasOwn(exp.studioDraft,field))testIt('studio_draft:'+field,JSON.stringify(reply?.studioDraft?.[field])===JSON.stringify(exp.studioDraft[field]));if(exp.studioDraft.promptContainsAny?.length)testIt('studio_draft_prompt',exp.studioDraft.promptContainsAny.some(v=>normalize(reply?.studioDraft?.prompt).includes(normalize(v))));}
  }
  if(exp.outcome?.allowed?.length && (reply?.outcome||!exp.outcome.requiredIfPresent))testIt('allowed_outcome',exp.outcome.allowed.includes(reply?.outcome));
  if(exp.ui?.command){const commands=[...(reply?.uiActions??[]).filter(a=>a.type==='command').map(a=>a.command),...(reply?.uiCommand?[reply.uiCommand]:[])];testIt('native_command',commands.some(c=>c.command===exp.ui.command));if(exp.ui.onlyChanges)testIt('exact_ui_changes',commands.some(c=>{const changes=Array.isArray(c.patch?.changes)?Object.fromEntries(c.patch.changes.map(change=>[change.field,JSON.parse(change.valueJson)])):c.patch??{};return Object.keys(changes).length===Object.keys(exp.ui.onlyChanges).length&&Object.entries(exp.ui.onlyChanges).every(([key,value])=>JSON.stringify(changes[key])===JSON.stringify(value));}));}
  for(const name of exp.forbiddenTaskTools??[])testIt('no_phantom_task:'+name,!reply?.taskState?.requiredTools?.includes(name));
  if(exp.noUiTask)testIt('no_phantom_ui_task',!reply?.taskState?.uiSteps?.length);
  if(exp.media)for(const[field,value]of Object.entries(exp.media))testIt('media:'+field,JSON.stringify(reply?.media?.[field])===JSON.stringify(value));
  for(const item of exp.mustReadEvidence??[])testIt('read_evidence:'+item.tool,calls.some(c=>c.tool===item.tool&&JSON.stringify(c.output).includes(item.outputContains)));
  if(exp.noMediaTask)testIt('no_media_task',!reply?.taskState?.requiredTools?.some(n=>['generateMedia','modifyMedia'].includes(n)));
  if(exp.expectedCommand)testIt('native_command',[...(reply?.uiActions??[]).filter(a=>a.type==='command').map(a=>a.command),...(reply?.uiCommand?[reply.uiCommand]:[])].some(c=>c.command===exp.expectedCommand));
  if(exp.expectedNavigation)testIt('native_navigation',reply?.navigation?.href===exp.expectedNavigation||(reply?.uiActions??[]).some(a=>a.type==='navigate'&&a.navigation?.href===exp.expectedNavigation));
  for(const assertion of exp.toolInputs??[]){const matches=calls.filter(c=>c.tool===assertion.tool);testIt('tool_input:'+assertion.tool+':'+assertion.path,matches.some(c=>{const value=assertion.path.split('.').reduce((v,k)=>v?.[k],c.input);return JSON.stringify(value)===JSON.stringify(assertion.equals);}));}
  return{passed:issues.length===0,issues,checks,counts,effects:actualEffects(calls).map(c=>({tool:c.tool,status:c.output.status})),needsHumanReview:checks.length===1||!!exp.manualReview};
}
function save(){mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify({mode:live?'real_models_synthetic_business':'offline_schema_validation',sourceHead,initialSourceFingerprints,finalSourceFingerprints:fingerprints(),datasetSha256,startedAt,observedAt:new Date().toISOString(),selectedCases:selected.length,tests:results.length,passed:results.filter(r=>r.assessment.passed).length,needsReview:results.filter(r=>r.assessment.needsHumanReview).length,apiCalls,estimatedUsd:chargedEstimateUsd,limits:{maxCalls,maxUsd},databaseCalls:0,productionWrites:0,limitations:['Vrais modèles, SDK, schémas et orchestration ; exécuteurs métier fictifs.','Les cas sont relus avec leurs oracles ; les scores bruts ne certifient ni OAuth ni livraison ni autonomie générale.','Les cas quota Sol simulent uniquement une réservation admissible ; les tests natifs de quota sont exécutés séparément.','Coûts estimés ; résultat inconnu conserve sa borne de réservation.'],providerUsage,providerErrors,providerTrace,cases:results},null,2));}
if(live&&!process.env.AI_GATEWAY_API_KEY&&!process.env.VERCEL_OIDC_TOKEN)throw Error('Existing AI Gateway credential required');
for(const test of selected){
  assert.ok(['basic','standard','premium'].includes(test.edition));assert.deepEqual(fingerprints(),initialSourceFingerprints,'Source changed during batch');
  activeCase={test,calls:[],turn:0,toolCallNames:new Map(),mutationCache:new Map()};const h=harness();let reply,failure;const turns=[];let messages=structuredClone(test.messages??test.messagesPrefix??[]),state;
  for(const[turn,step]of(test.steps??[{prompt:test.prompt}]).entries()){
    activeCase.turn=turn;const prompt=step.prompt??test.prompt;messages.push({role:'user',content:prompt});const before=activeCase.calls.length;
    try{const taskArgs=step.continueTask&&state?{taskContext:state,actionInstruction:continueInrAssistantTask(prompt,state,Date.now(),step.taskIntent),...(step.taskIntent?{taskIntent:step.taskIntent}:{})}:{};
      const clientContext=parseInrAssistantClientContext(test.rawClientContext??{source:'untrusted_client',...test.clientContext,screen:step.screen??test.screen??test.clientContext?.screen??{pathname:'/dashboard',tool:'Accueil'}});
      reply=await h.runtime.generateInrAssistantReply({accountId:ACCOUNT,actorUserId:ACTOR,displayName:'Atelier Démonstration',edition:test.edition,requestId:randomUUID(),actionRequestId:state?.actionRequestId??randomUUID(),request:new Request('https://fixture.invalid/api/assistant/chat'),supabase:{from(){throw Error('Real database access forbidden');}},memory:{loadRecent:async()=>({available:true,turns:test.memoryTurns??[],truncated:false}),search:async()=>({available:true,turns:test.memoryTurns??[],truncated:false})},accountContext:{source:'active_account_database',business:{company:'Atelier Démonstration',city:'Lyon',profession:'Réparateur de vélos',services:['Réparation de vélos']},setup:{}},messages,clientContext,...(test.fileContexts?{fileContexts:test.fileContexts}:{}),...(test.mediaAttachments?{mediaAttachments:test.mediaAttachments}:{}),...taskArgs});
    }catch(error){let message=String(error?.message??'Evaluation failed').slice(0,400);for(const secret of[process.env.AI_GATEWAY_API_KEY,process.env.VERCEL_OIDC_TOKEN].filter(Boolean))message=message.replaceAll(secret,'[redacted]');failure={name:error?.name,code:error?.code??'evaluation_failed',status:error?.statusCode??null,message};}
    const turnAssessment=checkCase({...test,...step,expectations:step.expectations??test.expectations},reply,failure,activeCase.calls.slice(before));turns.push({prompt,reply,failure,assessment:turnAssessment});state=reply?.taskState;if(reply?.message)messages.push({role:'assistant',content:reply.message});if(failure)break;
  }
  const assessment=turns.length===1?turns[0].assessment:{passed:turns.every(t=>t.assessment.passed),issues:turns.flatMap((t,i)=>t.assessment.issues.map(issue=>i+':'+issue)),needsHumanReview:turns.some(t=>t.assessment.needsHumanReview),counts:Object.fromEntries([...new Set(activeCase.calls.map(c=>c.tool))].map(n=>[n,activeCase.calls.filter(c=>c.tool===n).length]))};
  results.push({id:test.id,scenarioId:test.scenarioId,edition:test.edition,prompt:test.prompt,solQuotaAvailable:!!test.solQuotaAvailable,assessment,turns,calls:activeCase.calls,reply,failure});save();console.log(JSON.stringify({case:test.id,passed:assessment.passed,issues:assessment.issues,counts:assessment.counts,apiCalls,estimatedUsd:chargedEstimateUsd}));
  if(apiCalls>=maxCalls||chargedEstimateUsd>=maxUsd)break;
}
if(results.length!==selected.length||results.some(r=>!r.assessment.passed))process.exitCode=1;
