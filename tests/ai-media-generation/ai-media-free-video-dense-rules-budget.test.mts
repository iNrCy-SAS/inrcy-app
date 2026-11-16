import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAiMediaGenerationRequest } from '../../lib/aiMediaGenerationContracts.ts';
import { buildAiMediaGlobalConstraints } from '../../lib/aiMediaGlobalConstraints.ts';
import { buildAiMediaVideoProviderContract } from '../../lib/aiMediaVideoProviderContract.ts';
import { buildAiMediaFreeVideoScenePrompt, buildAiMediaVideoCharacterReferenceDirection, getAiMediaFreeVideoCreativeBudget, getAiMediaFreeVideoPromptMaxCharacters } from '../../lib/aiMediaFreeGenerationPrompt.ts';
import { getAiMediaVideoSegmentDurations } from '../../lib/aiMediaVideoTimeline.ts';
import type { NormalizedAiGenerationProfile } from '../../lib/aiGenerationProfile.ts';

// Entirely synthetic account rules. Prefixes, final negations and exact values
// deliberately span both ends: a head/tail truncation cannot satisfy this test.
const instructions='Use the two approved adults; exact price 149,90 €; '.padEnd(937, 'I')+' Never replace the stated place.';
const forbidden='Do not invent extra people, prices or qualifications. '.padEnd(830, 'P')+' Never add phone 01 23 45 67 89.';
const profile={preferences:{customInstructions:instructions,forbiddenInstructions:forbidden}} as unknown as NormalizedAiGenerationProfile;
const rules=buildAiMediaGlobalConstraints(profile);
const visual='Alex et Léa entretiennent ensemble un jardin en automne. Les feuilles tombent. Visages fidèles aux références. Alex parle, puis Léa.';
const timestamp=Date.now(),day=new Date(timestamp).toISOString().slice(0,10);
function request(engine:'veo'|'omni'|'grok-lite'|'wan-flash'|'wan27'|'wan3'|'kling'|'heygen',provided=false) {
  return normalizeAiMediaGenerationRequest({requestId:`dense-rules-${engine}-${provided}`,source:'studio',operation:'generate',creationMode:'free',kind:'video',
    format:'story',videoEngine:engine,durationSeconds:16,videoResolution:'720p',sceneMode:'single',freePrompt:visual,
    useBusinessDna:false,withNarration:!provided,withMusic:false,withSubtitles:false,teamVideoSpeechMode:provided?'characters':'voiceover',
    identityMode:'reference_team',identityConsent:true,teamVideoProviderConsent:engine,
    inspirationImages:[1,2].map(characterIndex=>({mimeType:'image/png',data:'A'.repeat(64),role:'character',usage:'required',characterIndex,
      voiceMode:provided?'provided':'ai',...(provided?{voiceSample:{
        path:`_studio-voice-references/${day}/synthetic-account__${timestamp}__00000000-0000-4000-8000-00000000000${characterIndex}.wav`,
        mimeType:'audio/wav',name:`synthetic-${characterIndex}.wav`,durationSeconds:5,sizeBytes:160044,
        libraryMediaId:`11111111-1111-4111-8111-11111111111${characterIndex}`,
      }}:{})})),
  });
}

test('long complete rules plus two required identities retain a useful visual direction/action budget on 3200-character engines',()=>{
  for(const engine of ['veo','omni','grok-lite'] as const) {
    const input=request(engine),before=structuredClone(input);
    const budget=getAiMediaFreeVideoCreativeBudget({request:input,globalMediaConstraints:rules,language:'fr'});
    assert.ok(budget.directionMaxCharacters>=96,`${engine}: ${JSON.stringify(budget)}`);
    assert.ok(budget.sceneMaxCharacters>=120,`${engine}: ${JSON.stringify(budget)}`);
    const durations=getAiMediaVideoSegmentDurations(input.durationSeconds!,engine,input.videoResolution,input.sceneMode);
    const plan={headline:'',subline:'D'.repeat(budget.directionMaxCharacters),companyName:'',cta:'',scenes:durations.map(()=>({
      eyebrow:'',title:'',body:'',spokenReply:'',layout:'hero' as const,visualBrief:'A'.repeat(budget.sceneMaxCharacters),spokenLine:'',
    }))};
    const providerContract=buildAiMediaVideoProviderContract({request:input,durationSeconds:durations[0],brandColors:[],globalMediaConstraints:rules});
    const canonical=structuredClone(providerContract);
    for(const[index,duration]of durations.entries()) {
      const prompt=buildAiMediaFreeVideoScenePrompt({request:input,plan,providerContract,contentLanguage:'fr'},index,duration,
        {compactEnvelope:true,continuationFrame:index>0,firstFrameTag:index>0});
      assert.ok(prompt.length<=3200);
      assert.ok(prompt.includes(rules)&&prompt.includes(instructions)&&prompt.includes(forbidden));
      assert.ok(prompt.includes(plan.subline)&&prompt.includes(plan.scenes[index].visualBrief));
      assert.match(prompt,/#1:required character-1,#2:required character-2/);
      assert.match(prompt,/group=2 adults, each once; identities locked; all move 0\.0s; no merge\/omit\/duplicate\/swap/);
      assert.match(prompt,/File\/shot count≠cast size; duplicates only if asked/);
      assert.match(prompt,/Photoreal unless brief asks otherwise, never from refs/);
      assert.match(prompt,/SUBTITLES OFF despite brief; no speech captions\/transcription/);
      assert.match(prompt,/Other requested text\/numbers exact; invent only if asked/);
      assert.match(prompt,/No native voices or dialogue/);
    }
    assert.deepEqual(input,before);assert.deepEqual(providerContract,canonical);
  }
});

test('two recorded library voices retain exclusive bindings and every exact turn within the real capable-engine ceilings',()=>{
  const lines=[
    ['Les feuilles tombent, notre atelier entretient vos extérieurs.','Nous préparons votre jardin pour une belle saison.'],
    ['Vous vous absentez pendant plusieurs jours ?','Nous prenons soin de votre maison pendant cette période.'],
    ['Quel plaisir de retrouver des pièces bien propres !','Avec Atelier Exemple, votre temps reste disponible.'],
  ];
  for(const engine of ['wan27','kling'] as const)for(const[first,second]of lines) {
    const input=request(engine,true),before=structuredClone(input);
    const budget=getAiMediaFreeVideoCreativeBudget({request:input,globalMediaConstraints:rules,language:'fr'});
    assert.ok(budget.directionMaxCharacters>=96&&budget.sceneMaxCharacters>=120,`${engine}: ${JSON.stringify(budget)}`);
    const durations=getAiMediaVideoSegmentDurations(input.durationSeconds!,engine,input.videoResolution,input.sceneMode);
    const plan={headline:'',subline:visual,companyName:'',cta:'',scenes:durations.map((duration,index)=>({
      eyebrow:'',title:'',body:'',spokenReply:'',layout:'hero' as const,visualBrief:'Alex parle puis Léa répond, tandis que les feuilles tombent.',spokenLine:'',
      // Wan's two short clips share the script; a sufficiently long native
      // Kling clip carries both ordered turns. Never overbook actual speech.
      spokenTurns:duration>=12?[{reference:1,speaker:'Alex',text:first},{reference:2,speaker:'Léa',text:second}]
        :[index===0?{reference:1,speaker:'Alex',text:first}:{reference:2,speaker:'Léa',text:second}],
    }))};
    const providerContract=buildAiMediaVideoProviderContract({request:input,durationSeconds:durations[0],brandColors:[],globalMediaConstraints:rules});
    const suffix=buildAiMediaVideoCharacterReferenceDirection(input);
    for(const[index,duration]of durations.entries()) {
      const prompt=buildAiMediaFreeVideoScenePrompt({request:input,plan,providerContract,contentLanguage:'fr'},index,duration,
        {compactEnvelope:true,continuationFrame:index>0,firstFrameTag:index>0});
      assert.ok(prompt.length+suffix.length<=getAiMediaFreeVideoPromptMaxCharacters(engine));
      assert.ok(prompt.includes(rules)&&prompt.includes(visual));
      for(const turn of plan.scenes[index].spokenTurns) assert.equal(prompt.split(JSON.stringify(turn.text)).length,2);
      assert.doesNotMatch(prompt,/NATIVE VOICEOVER/);
      if(engine==='kling') {
        for(const turn of plan.scenes[index].spokenTurns)
          assert.ok(prompt.includes(`[@image_${turn.reference}: ${JSON.stringify(turn.speaker)}; using only @voice_${turn.reference}]`));
        assert.match(suffix,/@image_1 = character1[\s\S]*only @voice_1[\s\S]*@image_2 = character2[\s\S]*only @voice_2/);
      }else{
        for(const turn of plan.scenes[index].spokenTurns)
          assert.ok(prompt.includes(`[Image ${turn.reference}: ${JSON.stringify(turn.speaker)}; using only its own attached referenceVoice]`));
        assert.match(suffix,/Image 1 = character1[\s\S]*own.*referenceVoice|Image 1 = character1[\s\S]*only its attached referenceVoice/);
      }
    }
    assert.deepEqual(input,before,'Both library voice references remain untouched');
  }
});

test('irreducible account rules still refuse Flash instead of truncating rules or switching the selected engine',()=>{
  const input=request('wan-flash'),before=structuredClone(input);
  assert.ok(instructions.length+forbidden.length>1500);
  assert.throws(()=>getAiMediaFreeVideoCreativeBudget({request:input,globalMediaConstraints:rules,language:'fr'}),/instruction_contract_too_long:.*:1500/);
  assert.deepEqual(input,before);
});
