import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  auditAiMediaNativeDialogueClips,
  evaluateAiMediaNativeDialogue,
  tokenizeAiMediaNativeDialogue,
  type AiMediaNativeDialogueQaClip,
} from "../../lib/aiMediaNativeDialogueQa.ts";

const ROOT = process.cwd();

function fakeClip(overrides: Partial<AiMediaNativeDialogueQaClip> = {}): AiMediaNativeDialogueQaClip {
  return {
    sceneIndex: 0,
    buffer: Buffer.from("video"),
    mediaType: "video/mp4",
    durationSeconds: 8,
    sourceStartSeconds: 0,
    expectedLine: "Votre projet avance avec une méthode claire.",
    ...overrides,
  };
}

test("la QA accepte la réplique complète malgré ponctuation, accents et une petite variation ASR", () => {
  assert.deepEqual(
    tokenizeAiMediaNativeDialogue("L’équipe prend rendez-vous."),
    ["l", "equipe", "prend", "rendez", "vous"],
  );
  const result = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine: "Votre projet avance avec une méthode claire.",
    transcript: "Votre projet avance avec une méthode très claire.",
    language: "fr",
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.issues, []);
  assert.ok(result.metrics.expectedCoverage >= 0.95);
});

test("la QA compare aussi les dialogues chinois et thaï sans espaces", () => {
  assert.deepEqual(tokenizeAiMediaNativeDialogue("让您的项目顺利推进。"), [
    "让", "您", "的", "项", "目", "顺", "利", "推", "进",
  ]);
  assert.equal(
    evaluateAiMediaNativeDialogue({
      sceneIndex: 0,
      expectedLine: "让您的项目顺利推进。",
      transcript: "让您的项目顺利推进。",
      language: "zh",
    }).status,
    "passed",
  );
  assert.equal(
    evaluateAiMediaNativeDialogue({
      sceneIndex: 0,
      expectedLine: "เราพร้อมดูแลโครงการของคุณ",
      transcript: "เราพร้อมดูแลโครงการของคุณ",
      language: "th",
    }).status,
    "passed",
  );
});

test("la QA refuse une phrase coupée avant son complément", () => {
  const result = evaluateAiMediaNativeDialogue({
    sceneIndex: 1,
    expectedLine: "On peut prendre rendez-vous et parler de votre projet.",
    transcript: "On peut prendre rendez-vous et parler de",
    language: "fr",
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.issues.includes("spoken_dialogue_incomplete"));
});

test("la QA refuse la répétition du début de la réplique", () => {
  const result = evaluateAiMediaNativeDialogue({
    sceneIndex: 2,
    expectedLine: "Votre projet entre aujourd'hui dans de bonnes mains.",
    transcript: "Votre projet entre. Votre projet entre. Votre projet entre.",
    language: "fr",
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.issues.includes("spoken_dialogue_repeated"));
  assert.ok(result.issues.includes("spoken_dialogue_mismatch"));
  assert.equal(result.metrics.repeatCount, 3);
});

test("la QA refuse une improvisation sans rapport et une piste sans parole", () => {
  const mismatch = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine: "Découvrez une méthode claire pour votre entreprise.",
    transcript: "Alors on s'y met toi ?",
    language: "fr",
  });
  assert.equal(mismatch.status, "rejected");
  assert.ok(mismatch.issues.includes("spoken_dialogue_mismatch"));

  const missing = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine: "Découvrez une méthode claire pour votre entreprise.",
    transcript: "",
    language: "fr",
  });
  assert.equal(missing.status, "rejected");
  assert.deepEqual(missing.issues, ["spoken_dialogue_missing"]);
});

test("l'orchestrateur isole les actes de 8 s et transmet sourceStartSeconds", async () => {
  const cumulativeBuffer = Buffer.from("same-cumulative-video");
  const clips = [
    fakeClip({ sceneIndex: 0, buffer: cumulativeBuffer, sourceStartSeconds: 0 }),
    fakeClip({ sceneIndex: 1, buffer: cumulativeBuffer, sourceStartSeconds: 8 }),
    fakeClip({ sceneIndex: 2, buffer: cumulativeBuffer, sourceStartSeconds: 16 }),
  ];
  const starts: number[] = [];
  const result = await auditAiMediaNativeDialogueClips({
    clips,
    language: "fr",
    transcribe: async (clip) => {
      starts.push(clip.sourceStartSeconds || 0);
      return { text: clip.expectedLine, model: "gemini-test" };
    },
  });
  assert.deepEqual(starts.sort((a, b) => a - b), [0, 8, 16]);
  assert.equal(result.status, "passed");
  assert.equal(result.model, "gemini-test");
  assert.deepEqual(result.clips.map((clip) => clip.status), ["passed", "passed", "passed"]);
});

test("un rejet prime sur une transcription indisponible, sans exposer le transcript", async () => {
  const result = await auditAiMediaNativeDialogueClips({
    clips: [
      fakeClip({ sceneIndex: 0 }),
      fakeClip({ sceneIndex: 1 }),
    ],
    transcribe: async (clip) => {
      if (clip.sceneIndex === 1) throw new Error("google unavailable");
      return { text: "Une phrase complètement différente.", model: "gemini-test" };
    },
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.clips[1]?.status, "unavailable");
  assert.equal("transcript" in result, false);
  assert.equal(JSON.stringify(result).includes("phrase complètement différente"), false);
});

test("l'adaptateur Google découpe réellement les sorties cumulées avant transcription", () => {
  const source = readFileSync(
    path.join(ROOT, "lib/aiMediaNativeDialogueQaGoogle.ts"),
    "utf8",
  );
  assert.match(source, /"-ss",\s*String\(sourceStartSeconds\)/);
  assert.match(source, /"-t",\s*String\(args\.clip\.durationSeconds\)/);
  assert.match(source, /sourcePathByBuffer = new Map<Buffer, Promise<string>>\(\)/);
  assert.match(source, /store: false/);
  assert.match(source, /const DEFAULT_TIMEOUT_MS = 8_000/);
  assert.match(source, /const deadlineAt = Date\.now\(\) \+ timeoutMs/);
  assert.match(source, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(source, /AbortSignal\.any\(\[args\.signal, deadlineSignal\]\)/);
  assert.match(source, /timeoutMs: remainingTimeoutMs\(\)/);
  assert.match(source, /maxRetries: 0/);
  assert.match(source, /N'invente, ne corrige, ne complète et ne résume aucun mot/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^)]*transcript/i);
});
