import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

import { resolveAiMediaDialogueSequence } from "../../lib/aiMediaDialogue.ts";
import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "../../lib/mediaVideoNormalizer.ts";

const requireFromTest = createRequire(import.meta.url);

type NarrationAudio = {
  buffer: Buffer;
  mimeType: string;
  extension: "wav";
  model: string;
  voice: string;
};

type PreflightModule = {
  AiMediaNarrationTooLongError: new (...args: never[]) => Error;
  prepareAiMediaNarrationAudioForVideo: (args: {
    audio: NarrationAudio;
    durationSeconds: 8 | 16 | 24;
  }) => Promise<{
    audio: NarrationAudio;
    durationSeconds: number;
    tempo: number;
    silenceCompacted: boolean;
  }>;
};

function transpilePreflightModule() {
  const source = readFileSync(
    new URL("../../lib/aiMediaGeneratedVideo.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const localRequire = (specifier: string) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/mediaVideoNormalizer") {
      return { probeVideoSource, resolveVideoNormalizationFfmpegPath };
    }
    return requireFromTest(specifier);
  };
  const execute = new Function("module", "exports", "require", output);
  execute(moduleRecord, moduleRecord.exports, localRequire);
  return moduleRecord.exports as PreflightModule;
}

function createPcmWav(args: {
  durationSeconds: number;
  silencePattern?: boolean;
}) {
  const sampleRate = 24_000;
  const sampleCount = Math.floor(args.durationSeconds * sampleRate);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const audible = !args.silencePattern || time % 1.25 < 0.5;
    const sample = audible
      ? Math.round(Math.sin(time * Math.PI * 2 * 220) * 9_000)
      : 0;
    pcm.writeInt16LE(sample, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function narrationAudio(buffer: Buffer): NarrationAudio {
  return {
    buffer,
    mimeType: "audio/wav",
    extension: "wav",
    model: "local-test",
    voice: "local-test",
  };
}

test("le préflight conserve une narration déjà compatible avant l'appel vidéo", async () => {
  const runtime = transpilePreflightModule();
  const source = narrationAudio(createPcmWav({ durationSeconds: 6 }));
  const result = await runtime.prepareAiMediaNarrationAudioForVideo({
    audio: source,
    durationSeconds: 8,
  });

  assert.equal(result.silenceCompacted, false);
  assert.equal(result.audio.buffer, source.buffer);
  assert.ok(result.durationSeconds >= 5.9 && result.durationSeconds <= 6.1);
  assert.ok(result.tempo <= 1.08);
});

test("le préflight resserre seulement les longs silences sans couper la piste", async () => {
  const runtime = transpilePreflightModule();
  const result = await runtime.prepareAiMediaNarrationAudioForVideo({
    audio: narrationAudio(
      createPcmWav({ durationSeconds: 9, silencePattern: true }),
    ),
    durationSeconds: 8,
  });

  assert.equal(result.silenceCompacted, true);
  assert.equal(result.audio.extension, "wav");
  assert.equal(result.audio.mimeType, "audio/wav");
  assert.ok(result.audio.buffer.length > 44);
  assert.ok(result.durationSeconds < 7.2);
  assert.ok(result.tempo <= 1.08);
});

test("le préflight exige une réécriture si les mots seuls dépassent la fenêtre", async () => {
  const runtime = transpilePreflightModule();
  await assert.rejects(
    runtime.prepareAiMediaNarrationAudioForVideo({
      audio: narrationAudio(createPcmWav({ durationSeconds: 9 })),
      durationSeconds: 8,
    }),
    (error: unknown) => {
      assert.ok(error instanceof runtime.AiMediaNarrationTooLongError);
      assert.match(String((error as Error).message), /required_tempo=/);
      return true;
    },
  );
});

test("le serveur valide et réécrit la voix avant de lancer le moteur vidéo", () => {
  const server = readFileSync(
    new URL("../../lib/aiMediaGenerationServer.ts", import.meta.url),
    "utf8",
  );
  const narration = readFileSync(
    new URL("../../lib/aiMediaNarration.ts", import.meta.url),
    "utf8",
  );

  assert.match(server, /prepareAiMediaNarrationAudioForVideo\(\{/);
  assert.match(server, /error instanceof AiMediaNarrationTooLongError/);
  assert.match(server, /maximumSpeechUnits = maximumSpeechUnits/);
  assert.ok(
    server.indexOf("prepareAiMediaNarrationAudioForVideo({") <
      server.indexOf("const videoGatewayTask = generateVideoGateway();"),
  );
  assert.match(
    server,
    /const narrationRequired =\s*providerRequest\.withNarration &&/,
  );
  assert.match(narration, /maximumSpeechUnits\?: number/);
  assert.match(narration, /resolveNarrationWordTarget/);
});

test("une citation de voix off 16 ou 24 s ne passe jamais par le contrat court des personnages", () => {
  const server = readFileSync(
    new URL("../../lib/aiMediaGenerationServer.ts", import.meta.url),
    "utf8",
  );
  const dialogueValidationIndex = server.indexOf(
    "const expectedDialogueLines = characterDialogueRequested",
  );
  const paidVideoIndex = server.indexOf(
    "const videoGatewayTask = generateVideoGateway();",
  );

  assert.ok(dialogueValidationIndex >= 0);
  assert.ok(dialogueValidationIndex < paidVideoIndex);
  assert.match(
    server.slice(dialogueValidationIndex, paidVideoIndex),
    /characterDialogueRequested\s*\?\s*resolveAiMediaDialogueSequence\(\{/,
  );
  assert.match(
    server.slice(dialogueValidationIndex, paidVideoIndex),
    /:\s*\[\];/,
  );

  const quotedVoiceOver =
    "La voix off dit : « Dans son atelier lumineux, la fleuriste choisit les fleurs et compose les couleurs avec soin, puis noue le ruban pour offrir une attention vraiment personnalisée. »";
  const resolveForSpeechMode = (
    speechMode: "voiceover" | "characters",
  ) =>
    speechMode === "characters"
      ? resolveAiMediaDialogueSequence({
          scenes: [{ title: "Atelier" }],
          headline: "Une attention personnalisée",
          language: "fr",
          requestedSpeech: quotedVoiceOver,
        })
      : [];

  for (const durationSeconds of [16, 24] as const) {
    assert.doesNotThrow(() => resolveForSpeechMode("voiceover"));
    assert.deepEqual(resolveForSpeechMode("voiceover"), []);
    assert.ok(durationSeconds >= 16);
  }
});

test("une citation courte de personnage reste exacte et est validée avant la vidéo", () => {
  const quotedCharacter =
    "La fleuriste dit : « Je compose chaque bouquet avec soin pour vous émerveiller. »";
  assert.deepEqual(
    resolveAiMediaDialogueSequence({
      scenes: [{ title: "Bouquet" }],
      headline: "Bouquet",
      language: "fr",
      requestedSpeech: quotedCharacter,
    }),
    ["Je compose chaque bouquet avec soin pour vous émerveiller."],
  );
});
