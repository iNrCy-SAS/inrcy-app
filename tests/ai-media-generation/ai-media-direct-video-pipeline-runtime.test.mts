import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import * as direct from "../../lib/aiMediaDirectVideoPipeline.ts";
import { buildAiMediaVideoProviderContract } from "../../lib/aiMediaVideoProviderContract.ts";
import { buildAiMediaFreeVideoScenePrompt } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { usesSeparateAiMediaFreeVoiceover } from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import { AI_MEDIA_AVAILABLE_VIDEO_MODELS } from "../../lib/aiMediaModelCatalog.ts";

const portrait = { role: "character", usage: "required", characterIndex: 1, characterName: "David", mimeType: "image/png", data: "A".repeat(88) };
function request(patch: Record<string, unknown> = {}) {
  return normalizeAiMediaGenerationRequest({ requestId: "direct-video-test", source: "studio", operation: "generate",
    creationMode: "free", kind: "video", format: "story", videoEngine: "grok-lite", videoResolution: "720p",
    durationSeconds: 8, teamVideoSpeechMode: "voiceover", withNarration: true, freePrompt: "Dans un jardin, l’équipe marche et présente son travail.",
    identityConsent: true, identityReferenceSetId: "11111111-1111-4111-8111-111111111111", ...patch });
}
const profile = { preferences: { language: "fr" }, business: { companyName: "DK", professionLabel: "Jardinier" } };

test("a direct plan preserves the raw scene and original references without inventing speech or a storyboard", () => {
  const input = request({ freePrompt: "Dans un jardin 🌳.\nDavid marche, Kathia répond ; caméra mobile.", inspirationImages: [portrait] });
  const before = structuredClone(input), plan = direct.buildAiMediaDirectVideoPlan(input);
  assert.equal(plan.subline, input.freePrompt);
  assert.ok(plan.scenes.every(scene => scene.visualBrief === input.freePrompt && scene.spokenLine === "" && scene.body === "" && scene.title === ""));
  assert.deepEqual(input, before);
  assert.equal(plan.companyName, "");
});

test("ordered exact turns keep original speaker references even when two people say identical words", () => {
  const input = request({ videoEngine: "kling", teamVideoProviderConsent: "kling", durationSeconds: 30, sceneMode: "multi", teamVideoSpeechMode: "characters", withNarration: false,
    inspirationImages: [
      { role: "product", usage: "required", mimeType: "image/png", data: "C".repeat(88) },
      portrait,
      { ...portrait, characterIndex: 2, characterName: "Kathia", data: "B".repeat(88) },
    ],
    exactDialogue: [{ speaker: "character", characterIndex: 1, text: "Bonjour à tous." }, { speaker: "character", characterIndex: 2, text: "Bonjour à tous." },
      { speaker: "ai_voice", text: "Bienvenue chez nous !" }],
  });
  const before = structuredClone(input), plan = direct.buildAiMediaDirectVideoPlan(input);
  const turns = plan.scenes.flatMap(scene => scene.spokenTurns || []);
  assert.deepEqual(turns.map(turn => turn.reference), [2, 3, 0]);
  assert.deepEqual(turns.map(turn => turn.text), input.exactDialogue!.map(turn => turn.text));
  assert.equal(plan.scenes.length, 2);
  assert.deepEqual(input, before);
});

test("a stale exact character association fails structurally instead of silently giving another person the line", () => {
  const input = { ...request({ inspirationImages: [portrait] }), exactDialogue: [{ speaker: "character" as const, characterIndex: 2 as const, text: "Ma réplique." }] };
  assert.throws(() => direct.buildAiMediaDirectVideoPlan(input), /ai_media_direct_speaker_missing/);
});

test("native segmentation retains every whole turn without lexical limits or rewritten transitions", () => {
  const turns = [{ text: "A".repeat(90) }, { text: "B".repeat(20) }, { text: "C".repeat(80) }];
  const groups = direct.distributeDirectVideoTurns(turns, [8, 8]);
  assert.deepEqual(groups.flat(), turns);
  assert.ok(groups.every(group => group.length));
  assert.throws(() => direct.distributeDirectVideoTurns(turns, []), /duration_invalid/);
});

test("the actual Free prompt adaptor starts with the unchanged brief and forwards exact words and original role labels", () => {
  const input = request({ videoEngine: "kling", teamVideoSpeechMode: "characters", withNarration: false, inspirationImages: [portrait],
    exactDialogue: [{ speaker: "character", characterIndex: 1, text: "Pour l’été : 12,50 € — appelez-moi !" }] });
  const prompt = buildAiMediaFreeVideoScenePrompt({ request: input, plan: direct.buildAiMediaDirectVideoPlan(input), providerContract: buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [] }), directVideo: true, contentLanguage: "fr" }, 0, 8);
  assert.ok(prompt.startsWith(input.freePrompt!));
  assert.ok(prompt.includes(input.exactDialogue![0].text));
  assert.match(prompt, /#1 character character=1 name="David"/);
  assert.doesNotMatch(prompt, /A{30}|_studio-voice-references|EMPTY LOCATION|full-frame initial instant/);
});

test("native Auto IA asks the selected engine for speech without a copywriter or a compulsory photo", () => {
  const input = request();
  const prompt = direct.buildAiMediaDirectVideoScenePrompt({ request: input, plan: direct.buildAiMediaDirectVideoPlan(input), contentLanguage: "fr" }, 0, 8);
  assert.match(prompt, /Create natural off-screen narration/);
  assert.match(prompt, /Visible people act naturally/);
  assert.doesNotMatch(prompt, /synthetic|silent avatar|public avatar/i);
});

test("silent direct video preserves requested visual action while explicitly disabling speech", () => {
  const input = request({ withNarration: false }), prompt = direct.buildAiMediaDirectVideoScenePrompt({ request: input, plan: direct.buildAiMediaDirectVideoPlan(input) }, 0, 8);
  assert.match(prompt, /No speech\. Preserve the requested visual action and cast/);
  assert.ok(prompt.startsWith(input.freePrompt!));
});

test("provided narrators use external audio while every current native-audio engine handles IA narration directly", () => {
  for (const model of AI_MEDIA_AVAILABLE_VIDEO_MODELS) {
    const input = { ...request(), videoEngine: model.id };
    assert.equal(usesSeparateAiMediaFreeVoiceover(input), !model.nativeAudio, model.id);
    assert.equal(usesSeparateAiMediaFreeVoiceover({ ...input, narrationVoiceMode: "provided" }), true, model.id);
    assert.equal(usesSeparateAiMediaFreeVoiceover({ ...input, teamVideoSpeechMode: "characters" }), false, model.id);
    assert.equal(usesSeparateAiMediaFreeVoiceover({ ...input, withNarration: false }), false, model.id);
  }
});

function avatarRuntime() {
  const calls: Record<string, unknown>[] = [], events: string[] = [];
  const load = runtimeModules({
    "@/lib/aiGatewayClient": { aiGenerateJSON: async (args: Record<string, unknown>) => {
      events.push("speech"); calls.push(args);
      const value = { turns: [{ reference: 2, text: "Nous entretenons votre jardin." }, { reference: 3, text: "Bienvenue chez DK !" }] };
      (args.normalizeResponseBeforeValidation as (value: unknown) => unknown)(value);
      return { ...value, inventedVisual: "A white background" };
    } },
    "@/lib/aiEnginePreference": { getAiEngineOption: () => ({ model: "openai/test-model" }) },
  });
  return { calls, events, prepare: load<typeof import("../../lib/aiMediaDirectAvatarDialogue.ts")>("lib/aiMediaDirectAvatarDialogue.ts").prepareAiMediaDirectAvatarDialogue };
}

test("only actual portrait-avatar Auto needs a speech adapter, which cannot replace the requested scene or original images", async () => {
  const env = avatarRuntime();
  const input = request({ videoEngine: "heygen-avatar", teamVideoProviderConsent: "heygen-avatar", teamVideoSpeechMode: "characters", withNarration: false,
    inspirationImages: [{ role: "environment", usage: "required", mimeType: "image/png", data: "C".repeat(88) }, portrait, { ...portrait, characterIndex: 2, characterName: "Kathia" }] });
  const before = structuredClone(input);
  const plan = await env.prepare({ accountId: "account-a", request: input, profile: profile as never,
    onBillableWorkStarted: async () => { env.events.push("billing-lock"); } });
  assert.deepEqual(env.events, ["billing-lock", "speech"]);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].accountId, "account-a");
  assert.deepEqual(plan.scenes.flatMap(scene => scene.spokenTurns || []).map(turn => turn.reference), [2, 3]);
  assert.ok(plan.scenes.every(scene => scene.visualBrief === input.freePrompt));
  assert.deepEqual(input, before);
  const sent = JSON.parse(env.calls[0].input as string);
  assert.equal(sent.brief, input.freePrompt);
  assert.deepEqual(sent.characters.map((item: {reference: number}) => item.reference), [2, 3]);
  assert.doesNotMatch(env.calls[0].input as string, /A{30}|C{30}|inventedVisual/);
  assert.match(env.calls[0].system as string, /Do not write or change visual directions/);
});

test("cinematic/no-portrait, voiceoff, exact and every other engine bypass avatar speech generation entirely", async () => {
  const env = avatarRuntime();
  for (const patch of [
    { videoEngine: "heygen-avatar", teamVideoSpeechMode: "characters", inspirationImages: [] },
    { videoEngine: "heygen-avatar", teamVideoSpeechMode: "voiceover", inspirationImages: [portrait] },
    { videoEngine: "heygen-avatar", teamVideoSpeechMode: "characters", inspirationImages: [portrait], spokenScript: "Bonjour exactement." },
    { videoEngine: "heygen-avatar", teamVideoSpeechMode: "characters", inspirationImages: [portrait], exactDialogue: [{ speaker: "character", characterIndex: 1, text: "Bonjour exactement." }] },
    { videoEngine: "wan27", teamVideoSpeechMode: "characters", inspirationImages: [portrait] },
  ]) await env.prepare({ accountId: "account-a", request: request(patch), profile: profile as never,
    onBillableWorkStarted: async () => { throw new Error("unexpected-billable-copy"); } });
  assert.equal(env.calls.length, 0);
});

test("avatar speech cannot start if the cancellation/billing lock fails", async () => {
  const env = avatarRuntime(), input = request({ videoEngine: "heygen-avatar", teamVideoSpeechMode: "characters", withNarration: false, inspirationImages: [portrait] });
  await assert.rejects(env.prepare({ accountId: "account-a", request: input, profile: profile as never,
    onBillableWorkStarted: async () => { throw new Error("cancelled-before-speech"); } }), /cancelled-before-speech/);
  assert.equal(env.calls.length, 0);
});

test("native narrator gender and style selections reach Auto and Exact direct prompts without naming unavailable proprietary timbres", () => {
  const make = (narrationVoice: "female" | "male", narrationVoiceVariant: "Sulafat" | "Orus" | "Puck", spokenScript?: string) => {
    const input = request({ narrationVoice, narrationVoiceVariant, ...(spokenScript !== undefined ? { spokenScript } : {}) });
    return direct.buildAiMediaDirectVideoScenePrompt({ request: input, plan: direct.buildAiMediaDirectVideoPlan(input), contentLanguage: "en", ...(spokenScript !== undefined ? { nativeNarrationLines: [spokenScript] } : {}) }, 0, 8);
  };
  for (const exact of [undefined, "  Bonjour, Océane !\n58 € — iNrCy.  "]) {
    const female = make("female", "Sulafat", exact), male = make("male", "Orus", exact), upbeat = make("male", "Puck", exact);
    assert.match(female, /female off-screen narrator; warm, gentle and welcoming tone/);
    assert.match(male, /male off-screen narrator; assertive, direct and professional tone/);
    assert.match(upbeat, /male off-screen narrator; upbeat, positive and energetic tone/);
    assert.match(male, /SPEECH LANGUAGE: en/); assert.notEqual(female, male); assert.notEqual(male, upbeat);
    for (const prompt of [female, male, upbeat]) {
      assert.doesNotMatch(prompt, /Sulafat|Orus|Puck|Gemini/);
      if (exact !== undefined) assert.equal(prompt.split(exact).length, 2, "Every exact code point and its sole occurrence remain intact.");
    }
  }
});

test("mixed exact character and off-screen turns retain speaker order, language and disabled captions in the direct envelope", () => {
  const input = request({ videoEngine: "kling", withSubtitles: false, freePrompt: "Dans un jardin. Ajoute des sous-titres et une enseigne qui affiche Atelier.", inspirationImages: [portrait],
    exactDialogue: [{ speaker: "character", characterIndex: 1, text: "  Bonjour, David !\nVoici iNrCy.  " }, { speaker: "ai_voice", text: "Bienvenue, Océane — 12,50 €." }] });
  const before = structuredClone(input), prompt = direct.buildAiMediaDirectVideoScenePrompt({ request: input, plan: direct.buildAiMediaDirectVideoPlan(input), contentLanguage: "fr" }, 0, 8);
  assert.ok(prompt.indexOf("Character 1:") < prompt.indexOf("Off-screen narrator:"));
  for (const turn of input.exactDialogue!) assert.equal(prompt.split(turn.text).length, 2);
  assert.match(prompt, /SPEECH LANGUAGE: fr/); assert.match(prompt, /NARRATOR VOICE DIRECTION: off-screen narrator/);
  assert.match(prompt, /Subtitles: disabled, including speech captions requested in the brief/);
  assert.match(prompt, /preserve other explicitly requested visual lettering/); assert.ok(prompt.startsWith(input.freePrompt!));
  assert.deepEqual(input, before);
});

test("a supplied exact off-screen narrator stays outside the native direct prompt after external-audio routing", () => {
  const timestamp = Date.now(), exact = "  Ma voix réelle lit ceci.\n12,50 € — iNrCy.  ";
  const supplied = request({ spokenScript: exact, narrationVoiceMode: "provided", narrationVoiceConsent: true,
    narrationVoiceSample: { path: "_studio-voice-references/" + new Date(timestamp).toISOString().slice(0, 10) + "/offline-test__" + timestamp + "__00000000-0000-4000-8000-000000000001.wav", mimeType: "audio/wav", name: "narrator.wav", durationSeconds: 6, sizeBytes: 192044 } });
  assert.equal(supplied.spokenScript, exact); assert.equal(usesSeparateAiMediaFreeVoiceover(supplied), true);
  const modelRequest = { ...supplied, withNarration: false, withSubtitles: false };
  const prompt = direct.buildAiMediaDirectVideoScenePrompt({ request: modelRequest, plan: direct.buildAiMediaDirectVideoPlan(modelRequest), contentLanguage: "fr" }, 0, 8);
  assert.match(prompt, /No speech/); assert.doesNotMatch(prompt, /NARRATOR VOICE DIRECTION/); assert.ok(!prompt.includes(exact));
  assert.equal(supplied.spokenScript, exact);
});

test("Avatar dialogue is user content with only the explicitly opted-in company context",async()=>{
 const env=avatarRuntime();const company={companyName:"Business fact explicitly opted in",professionLabel:"Jardinier"},dna={facts:["Scoped account context"]};
 const pictures=[{role:"environment",usage:"required",mimeType:"image/png",data:"C".repeat(88)},portrait,{...portrait,characterIndex:2,characterName:"Kathia"}];
 for(const useBusinessDna of [false,true]){
  await env.prepare({accountId:"account-a",request:request({videoEngine:"heygen-avatar",teamVideoSpeechMode:"characters",withNarration:false,teamVideoProviderConsent:"heygen-avatar",inspirationImages:pictures,useBusinessDna}),profile:{...profile,business:company,memory:{unrelated:"Guided writing memory must not leak"}} as never,businessDnaContext:dna,globalMediaConstraints:"Account directions"});
  const sent=JSON.parse(env.calls.at(-1)!.input as string);assert.deepEqual(sent.company,useBusinessDna?company:null);assert.deepEqual(sent.requestedContext,useBusinessDna?dna:null);assert.equal(sent.account_rules,"Account directions");assert.doesNotMatch(env.calls.at(-1)!.input as string,/Guided writing memory must not leak/);
 }
 assert.equal(env.calls.length,2);
});
