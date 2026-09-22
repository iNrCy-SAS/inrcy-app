import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

import * as narrationVoices from "../../lib/aiMediaNarrationVoices.ts";

type AudioRequest = {
  accountId: string;
  narration: { script: string; language: string };
  durationSeconds: 8 | 16 | 24;
  narrationVoice: "female" | "male";
  signal?: AbortSignal;
};

type ProviderRequest = {
  input: string;
  generation_config: { speech_config: Array<{ voice: string; language: string }> };
};

type NarrationAudioModule = {
  generateAiMediaNarrationAudio: (args: AudioRequest) => Promise<{
    buffer: Buffer;
    mimeType: string;
    extension: string;
  }>;
};

const source = readFileSync(
  new URL("../../lib/aiMediaNarrationAudio.ts", import.meta.url),
  "utf8",
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function runtime(options: {
  missingCredentials?: boolean;
  constructorError?: Error;
  providerErrors?: Error[];
  commitError?: Error;
  committedBeforeError?: boolean;
} = {}) {
  const events: string[] = [];
  const requests: ProviderRequest[] = [];
  const reservation = { id: "test-reservation", state: "reserved" };
  const providerErrors = [...(options.providerErrors || [])];
  class GoogleGenAI {
    constructor() {
      events.push("construct");
      if (options.constructorError) throw options.constructorError;
    }

    interactions = {
      create: async (request: ProviderRequest) => {
        events.push("generate");
        requests.push(request);
        const error = providerErrors.shift();
        if (error) throw error;
        return {
          output_audio: {
            data: Buffer.from([0, 0, 1, 0]).toString("base64"),
            mime_type: "audio/l16",
            sample_rate: 24_000,
            channels: 1,
          },
        };
      },
    };
  }
  const guard = {
    reserveAiGatewayAccountAttempt: async () => {
      events.push("reserve");
      return reservation;
    },
    commitAiGatewayAccountAttempt: async () => {
      events.push("commit");
      if (options.committedBeforeError) reservation.state = "committed";
      if (options.commitError) throw options.commitError;
      reservation.state = "committed";
    },
    rollbackAiGatewayAccountAttempt: async () => {
      events.push("rollback");
      if (reservation.state === "reserved") reservation.state = "rolled_back";
    },
    recordAiGatewayAccountFailure: async () => {
      events.push("failure");
    },
  };
  const moduleRecord = { exports: {} };
  const localRequire = (specifier: string) => {
    if (specifier === "server-only") return {};
    if (specifier === "@google/genai") return { GoogleGenAI };
    if (specifier === "@/lib/aiGatewayAccountGuard") return guard;
    if (specifier === "./aiMediaNarrationVoices.ts") return narrationVoices;
    throw new Error(`Unexpected import: ${specifier}`);
  };
  const execute = new Function(
    "module", "exports", "require", "process", "setTimeout", output,
  );
  execute(
    moduleRecord,
    moduleRecord.exports,
    localRequire,
    { env: options.missingCredentials ? {} : { GEMINI_API_KEY: "test-key" } },
    (callback: () => void) => setTimeout(callback, 0),
  );
  return {
    api: moduleRecord.exports as NarrationAudioModule,
    events,
    requests,
    reservation,
  };
}

const request: AudioRequest = {
  accountId: "test-account",
  narration: {
    script: "Votre projet avance avec une méthode claire et concrète.",
    language: "fr",
  },
  durationSeconds: 8,
  narrationVoice: "female",
};

test("une clé TTS absente ne réserve aucun budget", async () => {
  const harness = runtime({ missingCredentials: true });
  await assert.rejects(
    harness.api.generateAiMediaNarrationAudio(request),
    /ai_video_veo_credentials_missing/,
  );
  assert.deepEqual(harness.events, []);
});

test("un client TTS impossible à construire ne réserve aucun budget", async () => {
  const harness = runtime({ constructorError: new Error("invalid_client") });
  await assert.rejects(
    harness.api.generateAiMediaNarrationAudio(request),
    /invalid_client/,
  );
  assert.deepEqual(harness.events, ["construct"]);
});

for (const committedBeforeError of [false, true]) {
  test(`un échec comptable 503 après synthèse ne refacture pas la piste (commit préalable : ${committedBeforeError})`, async () => {
    const harness = runtime({
      commitError: Object.assign(new Error("accounting_unavailable"), { status: 503 }),
      committedBeforeError,
    });
    await assert.rejects(
      harness.api.generateAiMediaNarrationAudio(request),
      /ai_media_narration_failed:.*accounting_unavailable/,
    );
    assert.deepEqual(harness.events, [
      "construct", "reserve", "generate", "commit", "rollback", "failure",
    ]);
    assert.equal(harness.requests.length, 1);
    assert.equal(
      harness.reservation.state,
      committedBeforeError ? "committed" : "rolled_back",
    );
  });
}

test("une erreur fournisseur temporaire conserve sa relance puis son commit", async () => {
  const harness = runtime({
    providerErrors: [Object.assign(new Error("provider_unavailable"), { status: 503 })],
  });
  const audio = await harness.api.generateAiMediaNarrationAudio(request);
  assert.equal(audio.mimeType, "audio/wav");
  assert.deepEqual(harness.events, [
    "construct", "reserve", "generate", "generate", "commit",
  ]);
  assert.equal(harness.reservation.state, "committed");
});

for (const durationSeconds of [8, 16, 24] as const) {
  test(`le TTS transmet intégralement le script et la durée ${durationSeconds} s`, async () => {
    const harness = runtime();
    const audio = await harness.api.generateAiMediaNarrationAudio({
      ...request,
      durationSeconds,
    });
    assert.equal(harness.requests.length, 1);
    assert.ok(harness.requests[0].input.endsWith(request.narration.script));
    assert.ok(harness.requests[0].input.includes(`La vidéo dure ${durationSeconds} secondes`));
    assert.deepEqual(harness.requests[0].generation_config.speech_config, [
      { voice: "Kore", language: "fr-FR" },
    ]);
    assert.equal(audio.buffer.toString("ascii", 0, 4), "RIFF");
    assert.equal(audio.buffer.readUInt32LE(24), 24_000);
    assert.deepEqual(audio.buffer.subarray(44), Buffer.from([0, 0, 1, 0]));
    assert.equal(harness.reservation.state, "committed");
  });
}
