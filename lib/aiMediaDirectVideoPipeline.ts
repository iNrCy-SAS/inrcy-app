import { buildAiMediaNativeNarratorVoiceDirection } from "./aiMediaNarrationVoices.ts";
import type { AiMediaCreativePlan } from "./aiMediaCreativePlan.ts";
import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";
import { getAiMediaVideoSegmentDurations } from "./aiMediaVideoTimeline.ts";

export const AI_MEDIA_DIRECT_VIDEO_PROMPT_VERSION = "inrcy-video-direct-v1";
type SpokenTurn = NonNullable<AiMediaCreativePlan["scenes"][number]["spokenTurns"]>[number];

/** The plan is transport bookkeeping only. The user's scene is never rewritten. */
export function buildAiMediaDirectVideoPlan(request: AiMediaGenerationRequest, preparedTurns?: readonly SpokenTurn[]): AiMediaCreativePlan {
  const durations=getAiMediaVideoSegmentDurations(request.durationSeconds || 8,request.videoEngine,request.videoResolution,request.sceneMode);
  const exact=request.exactDialogue;
  const groups=exact ? distributeDirectVideoTurns(exact,durations) : null;
  const preparedGroups=preparedTurns ? distributeDirectVideoTurns(preparedTurns,durations) : null;
  const characterReference=(slot: number | undefined)=>request.inspirationImages.findIndex(image=>image.role==="character" && image.characterIndex===slot)+1;
  const scenes=durations.map((_,index)=>{
    const turns=groups?.[index]?.map(turn=>{
      const reference=turn.speaker==="character" ? characterReference(turn.characterIndex) : 0;
      if(turn.speaker==="character" && reference<1)throw new Error("ai_media_direct_speaker_missing");
      return {reference,speaker:turn.speaker==="character" ? "Personnage "+turn.characterIndex : "Voix off",text:turn.text};
    }) || preparedGroups?.[index];
    const spokenLine=turns?.map(turn=>turn.text).join("\n") || (index===0 && request.teamVideoSpeechMode==="characters" ? request.spokenScript || "" : "");
    return {eyebrow:"",title:"",body:"",spokenLine,spokenReply:"",...(turns?.length?{spokenTurns:turns}:{}),visualBrief:request.freePrompt || "",layout:"hero" as const};
  });
  return {headline:"",subline:request.freePrompt || "",companyName:"",cta:"",scenes};
}

/** Native APIs may need multiple clips; ordered turns remain whole and unchanged. */
export function distributeDirectVideoTurns<T extends {text:string}>(turns: readonly T[],durations: readonly number[]): T[][] {
  const groups:T[][]=durations.map(()=>[]);
  if(!groups.length) throw new Error("ai_media_video_duration_invalid");
  const totalWeight=Math.max(1,turns.reduce((sum,turn)=>sum+turn.text.length,0)),totalDuration=durations.reduce((sum,value)=>sum+value,0);
  let index=0,elapsedWeight=0,elapsedDuration=durations[0];
  for(const turn of turns){
    if(groups[index].length && index<groups.length-1 && elapsedWeight/totalWeight>=elapsedDuration/totalDuration){index++;elapsedDuration+=durations[index];}
    groups[index].push(turn);elapsedWeight+=turn.text.length;
  }
  return groups;
}

export function getAiMediaDirectExactSpeech(request: AiMediaGenerationRequest): string | undefined {
  return request.exactDialogue ? request.exactDialogue.map(turn=>turn.text).join("\n") : request.spokenScript;
}

type DirectPromptInput = {request:AiMediaGenerationRequest;plan:AiMediaCreativePlan;contentLanguage?:string;businessDnaDirection?:string;nativeNarrationLines?:readonly string[];providerContract?:{globalMediaConstraints?:string}};
export function buildAiMediaDirectVideoScenePrompt(args:DirectPromptInput,index:number,durationSeconds:number,continuation=false):string {
  const request=args.request,brief=request.freePrompt || "";
  const refs=request.inspirationImages.map((image,i)=>"#"+(i+1)+" "+(image.role || "inspiration")+
    (image.characterIndex ? " character="+image.characterIndex : "")+
    (image.characterName ? " name="+JSON.stringify(image.characterName) : "")+
    (image.voiceMode==="provided" ? " own supplied voice" : ""));
  const structured=request.exactDialogue ? distributeDirectVideoTurns(request.exactDialogue,getAiMediaVideoSegmentDurations(request.durationSeconds || 8,request.videoEngine,request.videoResolution,request.sceneMode))[index] : undefined;
  const exact=structured ? structured.map(turn=>(turn.speaker==="character" ? "Character "+turn.characterIndex : "Off-screen narrator")+":\n"+turn.text).join("\n")
    : request.teamVideoSpeechMode==="characters" ? args.plan.scenes[index]?.spokenLine || "" : args.nativeNarrationLines?.[index] || "";
  const audible=request.teamVideoSpeechMode==="characters" || request.withNarration;
  const nativeNarrator=request.narrationVoiceMode!=="provided" && (request.withNarration || structured?.some(turn=>turn.speaker==="ai_voice"));
  const audio=request.teamVideoSpeechMode==="characters"
    ? exact ? "EXACT ORDERED DIALOGUE (keep every word and its speaker):\n"+exact : "Create natural character dialogue from the user brief in "+(args.contentLanguage || "fr")+". Each referenced voice belongs exclusively to its own character."
    : request.withNarration
      ? exact ? "EXACT OFF-SCREEN NARRATION (keep every word):\n"+exact : "Create natural off-screen narration about the user brief in "+(args.contentLanguage || "fr")+". Visible people act naturally without lip-syncing the narrator."
      : "No speech. Preserve the requested visual action and cast.";
  return [brief,
    args.providerContract?.globalMediaConstraints || "",
    "OUTPUT: "+durationSeconds+"s; "+request.format+"; clip "+(index+1)+"/"+args.plan.scenes.length+".",
    refs.length ? "ORIGINAL REFERENCES: "+refs.join("; ")+". Preserve their declared role and distinct identities." : "",
    continuation || index>0 ? "Continue the same requested film without restarting or repeating prior dialogue." : "",
    audio,
    audible ? "SPEECH LANGUAGE: "+(args.contentLanguage || "fr")+". Preserve supplied exact words without translation." : "",
    nativeNarrator ? "NARRATOR VOICE DIRECTION: "+buildAiMediaNativeNarratorVoiceDirection(request) : "",
    audible ? "Do not display spoken words as visual text unless subtitles are enabled or the brief explicitly requests that text." : "",
    "Subtitles: "+(request.withSubtitles ? "enabled, faithful to speech" : "disabled, including speech captions requested in the brief; preserve other explicitly requested visual lettering")+".",
    request.useBusinessDna && args.businessDnaDirection ? "ACCOUNT CONTEXT: "+args.businessDnaDirection : "",
  ].filter(Boolean).join("\n\n");
}
