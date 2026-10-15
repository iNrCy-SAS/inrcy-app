import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { AI_MEDIA_VIDEO_MODELS, type AiMediaVideoEngine } from "../../lib/aiMediaModelCatalog.ts";
import { buildAiMediaFreeVideoScenePrompt, AI_MEDIA_FREE_SILENT_CHARACTER_CONTRACT } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { buildAiMediaVideoProviderContract } from "../../lib/aiMediaVideoProviderContract.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";

const narration = "Notre équipe prépare votre projet avec soin.";
const direction = "La femme présente son agence en parlant à la caméra.";
const action = "La femme parle face caméra et articule chaque mot, puis sourit en prenant son café.";

function provider(engine: AiMediaVideoEngine, speech: "silent" | "voiceover" | "characters") {
  const model = AI_MEDIA_VIDEO_MODELS.find((item) => item.id === engine)!;
  const request = normalizeAiMediaGenerationRequest({
    requestId: "visual-speech-contract-test", source: "studio", operation: "generate", creationMode: "free",
    kind: "video", videoEngine: engine, videoResolution: model.defaultResolution, format: "story",
    durationSeconds: 8, sceneMode: "single", freePrompt: "Une femme accompagne ses collègues et prend un café.",
    withNarration: speech === "voiceover", withMusic: false,
    teamVideoSpeechMode: speech === "characters" ? "characters" : "voiceover",
    inspirationImages: model.supportsTextToVideo ? [] : [{ data: "A".repeat(64), mimeType: "image/png", role: "environment", usage: "required" }],
  });
  const nativeNarrationLines = [narration];
  return {
    request, nativeNarrationLines, contentLanguage: "fr",
    providerContract: buildAiMediaVideoProviderContract({ request, durationSeconds: 8, brandColors: [], nativeNarrationLines }),
    plan: { subline: direction, scenes: [{ visualBrief: action, spokenLine: speech === "characters" ? narration : "" }] },
  } as unknown as AiVideoProviderGenerationArgs;
}

for (const model of AI_MEDIA_VIDEO_MODELS) {
  test(`${model.id}: silence and separate voiceover prohibit visual speech before contradictory directions without deleting creative actions`, () => {
    for (const speech of ["silent", "voiceover"] as const) {
      const args = provider(model.id, speech);
      for (const options of [{}, { continuationFrame: true, firstFrameTag: true }, { continuation: true }]) {
        const prompt = buildAiMediaFreeVideoScenePrompt(args, 0, 8, options);
        assert.ok(prompt.indexOf(AI_MEDIA_FREE_SILENT_CHARACTER_CONTRACT) < prompt.indexOf("CREATIVE DIRECTION:"));
        assert.match(prompt, /no speaking, word articulation, mimed speech or lip-sync/);
        assert.match(prompt, /Natural gestures, gaze and smiles remain/);
        assert.ok(prompt.includes(direction));
        assert.ok(prompt.includes(action), "The brief is preserved, including ordinary smiles and drinking.");
        assert.doesNotMatch(prompt, /NATIVE DIALOGUE:|NATIVE VOICEOVER:/);
        assert.ok(!prompt.includes(narration), "A stale native narration cannot reach the visual model.");
        assert.match(prompt, /No native voices or dialogue/);
        assert.ok(prompt.length <= 3_200);
      }
    }
  });

  test(`${model.id}: intentional character dialogue keeps exact words and lip synchronization`, () => {
    const args = provider(model.id, "characters");
    const prompt = buildAiMediaFreeVideoScenePrompt(args, 0, 8);
    assert.ok(!prompt.includes(AI_MEDIA_FREE_SILENT_CHARACTER_CONTRACT));
    assert.match(prompt, /NATIVE DIALOGUE:/);
    assert.match(prompt, /Synchronize the mouth and audible speech/);
    assert.match(prompt, /No narrator/);
    assert.equal(prompt.split(narration).length, 2);
    assert.ok(prompt.includes(direction) && prompt.includes(action));
  });
}

test("the visual speech contract stays inside the transport budget without truncating direction or action", () => {
  for (const model of AI_MEDIA_VIDEO_MODELS) for (const speech of ["silent", "voiceover", "characters"] as const) {
    const args = provider(model.id, speech);
    args.plan.subline = "D".repeat(1_400);
    args.plan.scenes[0].visualBrief = "V".repeat(300);
    const prompt = buildAiMediaFreeVideoScenePrompt(args, 0, 8);
    assert.ok(prompt.length <= 3_200, `${model.id}/${speech}: ${prompt.length}`);
    assert.ok(prompt.includes(args.plan.subline));
    assert.ok(prompt.includes(args.plan.scenes[0].visualBrief));
    args.plan.subline = "D".repeat(3_200);
    assert.throws(() => buildAiMediaFreeVideoScenePrompt(args, 0, 8), /ai_video_instruction_contract_too_long/);
  }
});
