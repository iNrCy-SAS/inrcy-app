const loaded = {}, translations = new Map(), cache = new Map();
window.mutations = 0; window.confirmations = [];
const noop = () => {};
const account = "00000000-0000-4000-8000-000000000001";
window.activeAccount = account; window.fixtureWrites = []; window.authWaiters = []; window.navigationCalls = [];
window.allowWrites = false; window.holdWrites = false; window.holdAuth = false;
function runWrite(kind,payload,commit){
  if(!window.allowWrites)throw Error('Unexpected layout mutation '+kind);
  window.mutations++;
  const record={kind,payload:structuredClone(payload),resolved:false};window.fixtureWrites.push(record);
  return new Promise(resolve=>{record.release=()=>{if(record.resolved)return;record.resolved=true;resolve(commit(record.payload))};if(!window.holdWrites)record.release()});
}
window.releaseFixtureWrite=index=>window.fixtureWrites[index].release();
window.releaseFixtureAuth=index=>window.authWaiters[index]();
const profile = { company_legal_name:"Atelier Lumière",contact_email:"contact@atelier.example",first_name:"Camille",last_name:"Martin",phone:"06 12 34 56 78",hq_zip:"62000",hq_city:"Arras" };
const business = { sector:"[[SECTOR:autre]] Conseil",activity_description:"Un atelier local au service des professionnels.",services:["Conseil","Création","Accompagnement"],strengths:["Proximité","Réactivité","Expertise"],intervention_zones:["Arras","Lens"],customer_typologies:["particuliers","professionnels"] };
const memory = { mission:"Rendre les projets de nos clients plus simples et plus efficaces.",values:["Qualité","Écoute"],brandPersonality:["Chaleureuse","Experte"],commitments:["Suivi personnalisé"],preferredVocabulary:["Ensemble","Local"],forbiddenVocabulary:["Miracle"],targetAudiences:["Indépendants","Commerçants"],customerNeeds:["Gagner du temps","Développer leur visibilité"],specialties:["Communication locale"],recentNewsItems:["Une nouvelle offre de conseil pour les professionnels.","Notre atelier accueille de nouveaux collaborateurs.","Participation à un événement local.","Une réalisation menée avec un artisan partenaire."],offersAndArguments:"Une offre claire et un accompagnement adapté à chaque projet.",keyArguments:"Un interlocuteur local, une expérience concrète et des résultats suivis.",proofsAndObjections:"Des projets documentés et des retours clients vérifiables.",objectionResponses:"Nous adaptons le calendrier et le périmètre à votre besoin.",editorialStrategy:"Partager des conseils, des réalisations et la vie de l’équipe.",campaignCalendar:"Préparer les temps forts de l’activité chaque mois." };
memory.referenceDocuments = Array.from({length:window.fixtureDocumentCount || 0},(_,index)=>({
 id:`reference-${index+1}`,name:`${String(index+1).padStart(2,'0')}-Catalogue des prestations et références professionnelles.pdf`,
 bucket:'inrcy-ai-documents',path:`users/${account}/ai-memory-documents/reference-${index+1}.pdf`,
 mimeType:'application/pdf',size:2400000,status:'analysed',extractedText:'Présentation des prestations et références professionnelles.',
 note:'Prestations, tarifs et références de notre entreprise.',createdAt:'2026-11-03T09:00:00.000Z'
}));
if(window.fixtureStressContent){
 const tags=(label,count)=>Array.from({length:count},(_,index)=>`${label} ${String(index+1).padStart(2,'0')} — Un accompagnement professionnel complet et personnalisé pour nos clients et partenaires locaux`);
 business.services=tags('Prestation',20);business.strengths=tags('Force',16);business.intervention_zones=tags('Zone',30);
 for(const [key,label] of Object.entries({values:'Valeur',brandPersonality:'Trait',commitments:'Engagement',specialties:'Spécialité',targetAudiences:'Public',customerNeeds:'Besoin',preferredVocabulary:'Expression préférée',forbiddenVocabulary:'Expression interdite'}))memory[key]=tags(label,['brandPersonality','commitments'].includes(key)?12:16);
 memory.mission='Notre mission est de simplifier chaque projet grâce à un accompagnement local et concret. '.repeat(8).slice(0,790);
 business.activity_description='Notre atelier accompagne les professionnels dans la préparation, la création et le suivi de leurs projets. '.repeat(30).slice(0,4900);
 for(const key of ['offersAndArguments','keyArguments','proofsAndObjections','objectionResponses','editorialStrategy','campaignCalendar']){
  const limit=['keyArguments','objectionResponses','campaignCalendar'].includes(key)?2900:4900;
  memory[key]=('Nous préparons un accompagnement adapté aux objectifs du client, avec des exemples concrets, un suivi régulier et des résultats documentés.\n\n'.repeat(40)).slice(0,limit-40)+`\nFin du champ ${key}.`;
 }
}
function translate(namespace) {
  if(translations.has(namespace))return translations.get(namespace);
  const translator=(key,args={})=>{
    let value=namespace.split('.').reduce((result,k)=>result?.[k],window.catalogues);
    value=key.split('.').reduce((result,k)=>result?.[k],value);
    return Object.entries(args).reduce((result,[name,arg])=>result.replaceAll('{'+name+'}',String(arg)),typeof value==='string'?value:key);
  };
  translations.set(namespace,translator);return translator;
}
const query=table=>{
  const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:table==='profiles'?profile:business,error:null}),update:()=>{throw Error('No unscoped update allowed')},upsert:payload=>runWrite(table,payload,saved=>{Object.assign(table==='profiles'?profile:business,saved);return {error:null}}),then:resolve=>resolve({data:table==='profiles'?profile:business,error:null})};return chain;
};
const sdk={auth:{getUser:()=>{const result={data:{user:{id:account,email:profile.contact_email}},error:null};return window.holdAuth?new Promise(resolve=>window.authWaiters.push(()=>resolve(result))):Promise.resolve(result)}},from:query,storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:''},error:null})})}};
const known={
 'lib/supabaseClient':{createClient:()=>sdk},
 'lib/browserAccountCache':{getActiveBrowserUserId:()=>window.activeAccount,resolveActiveBrowserUserId:()=>window.activeAccount,readAccountCacheValue:key=>cache.get(key)||null,writeAccountCacheValue:(key,value)=>cache.set(key,value)},
 'lib/userFacingErrors':{getClientUserFacingErrorMessage:(e,fallback)=>e?.message||fallback},
 'lib/boosterGenerationContextClient':{invalidateBoosterGenerationContextClient:async()=>true},
 'lib/publicProfileRefreshClient':{PUBLIC_PROFILE_DATA_SAVED_EVENT:'fixture-profile',refreshPublicProfileDependents:async()=>true},
 'lib/universalMediaUploadClient':{uploadFileToPreparedStorageIntent:()=>{throw Error('No upload allowed in layout fixture')}},
 'lib/inrcyDialog':{confirmInrcy:async options=>{window.confirmations.push(options);return false},chooseInrcy:async()=>null},
 'app/dashboard/_components/DashboardViewerAccessProvider':{useDashboardViewerAccess:()=>({metaPilotEnabled:true,actorUserId:account,activeAccountId:account})},
 'app/dashboard/_components/DashboardEditionProvider':{useDashboardEdition:()=>"premium"},
 'app/dashboard/_components/DashboardUnsavedNavigationProvider':{useDashboardUnsavedNavigation:()=>({requestNavigation:async fn=>{if(!window.exitGuard?.shouldBlock||await window.exitGuard.onBlockedExit())fn()}})},
 'app/dashboard/_hooks/useDashboardCompletionChecks':{useDashboardCompletionChecks:()=>({accountId:account,checkProfile:noop,checkActivity:noop,markProfileCompleted:noop,markActivityCompleted:noop})},
 'app/dashboard/_hooks/useDashboardPreparationScores':{useDashboardPreparationScores:()=>({dnaScore:80,aiScore:80,refreshPreparationScores:noop})},
 'app/dashboard/_hooks/useUnsavedExitGuard':{useUnsavedExitGuard:options=>{window.exitGuard=options}},
};
function resolveName(name,from){
 if(name.startsWith('@/'))return name.slice(2);
 if(!name.startsWith('.'))return name;
 const parts=from.split('/');parts.pop();for(const part of name.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part)}return parts.join('/');
}
function load(name,from=''){
 if(name==='next-intl')return {useTranslations:translate,useLocale:()=>"fr-FR"};
 if(name==='next/navigation')return {usePathname:()=>'/dashboard/personnalisation',useRouter:()=>({push:url=>window.navigationCalls.push(url)}),useSearchParams:()=>new URLSearchParams()};
 if(name==='next/dynamic')return {__esModule:true,default:loader=>{const React=load('react'),Lazy=React.lazy(loader);return props=>React.createElement(React.Suspense,{fallback:null},React.createElement(Lazy,props))}};
 name=resolveName(name,from);
 if(known[name])return known[name];
 if(name.endsWith('DashboardAssistantTrigger'))return {__esModule:true,default:()=>null};
 if(name.endsWith('MediaSubjectVoiceButton'))return {__esModule:true,default:()=>load('react').createElement('button',{type:'button','aria-label':'Dictée vocale',style:{width:30,height:30,minHeight:30,borderRadius:'50%',color:'#d9e8ff',background:'#394a70',border:'1px solid #91b9ed66'}},'♩')};
 if(name.endsWith('AiEngineInfoModal')||name.endsWith('BusinessDnaAnalysisScheduleModal'))return {__esModule:true,default:()=>null};
 if(window.cssExports[name])return {__esModule:true,default:window.cssExports[name]};
 if(!window.sources[name])name=[name+'.tsx',name+'.ts'].find(file=>window.sources[file])||name;
 if(loaded[name])return loaded[name].exports;
 if(!window.sources[name])throw Error('Missing fixture module '+name+' from '+from);
 const fixtureModule=loaded[name]={exports:{}};new Function('require','module','exports',window.sources[name])(dependency=>load(dependency,name),fixtureModule,fixtureModule.exports);return fixtureModule.exports;
}
const serverMemory=structuredClone(memory),serverBusiness={description:business.activity_description,services:business.services,strengths:business.strengths,interventionZones:business.intervention_zones,customerTypes:business.customer_typologies};
window.fetch=async(url,options={})=>{
 const ok=value=>Promise.resolve({ok:true,json:async()=>value});
 if(options.method&&options.method!=='GET'){
   if(url==='/api/loyalty/award'&&window.allowWrites)return ok({ok:true});
   if(url==='/api/ai-memory'&&options.method==='PUT')return runWrite('ai-memory',JSON.parse(options.body),saved=>{Object.assign(serverMemory,saved.memory);Object.assign(serverBusiness,saved.businessKnowledge);return ok({accountId:account,memory:serverMemory,businessKnowledge:serverBusiness,strategyEnabled:true})});
   window.mutations++;throw Error('Unexpected layout mutation '+url);
 }
 if(url==='/api/ai-memory')return ok({accountId:account,memory:serverMemory,businessKnowledge:serverBusiness,strategyEnabled:true});
 if(url==='/api/ai-memory/analyze-channels')return ok({accountId:account,channels:[],quota:{limit:3,used:0,remaining:3,resetAt:'2026-12-01'},job:null});
 if(url==='/api/business-location')return ok({ok:true,accountId:account,location:{postalCode:'62000',city:'Arras'},source:'google_business'});
 if(url==='/api/booster/cta-defaults')return ok({preferredWebsiteUrl:'https://atelier.example',siteWebUrl:'https://atelier.example',phone:'0612345678'});
 throw Error('Unexpected layout fetch '+url);
};
const React=load('react'),Page=load('app/dashboard/personnalisation/page.tsx').default;
const root=load('react-dom/client').createRoot(document.getElementById('root'));
root.render(React.createElement(Page));
window.renderRichEditor=()=>{
  const Editor=load('app/dashboard/settings/_components/BusinessDnaRichTextEditor.tsx').default;
  function RichEditorFixture(){
    const [draft,setDraft]=React.useState({text:'Argument initial',html:'<p>Argument initial</p>'});
    const [revision,setRevision]=React.useState(0);
    React.useEffect(()=>{window.richDraft=draft;window.remountRichEditor=()=>setRevision(value=>value+1)},[draft]);
    return React.createElement(Editor,{key:revision,label:'Argument de test',value:draft.text,html:draft.html,onChange:setDraft,placeholder:'Argument',maxLength:3000});
  }
  root.render(React.createElement(RichEditorFixture));
};
