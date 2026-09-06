import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  AI_FEATURE_POLICIES,
  getDefaultAllowedAiGatewayTranscriptionModels,
} from "../../lib/aiGatewayPolicy.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("raw transcription is routed exclusively through Vercel AI Gateway", () => {
  const client = read("lib/aiGatewayTranscription.ts");
  const config = read("lib/aiGatewayConfig.ts");
  assert.match(config, /v4\/ai\/transcription-model/);
  assert.match(client, /ai-model-id/);
  assert.match(client, /ai-gateway-protocol-version/);
  assert.match(client, /AI_GATEWAY_PROTOCOL_VERSION\s*=\s*"0\.0\.1"/);
  assert.match(client, /ai-transcription-model-specification-version/);
  assert.match(
    client,
    /AI_GATEWAY_TRANSCRIPTION_SPECIFICATION_VERSION\s*=\s*"4"/,
  );
  assert.match(client, /ai-gateway-auth-method/);
  assert.match(client, /AI_GATEWAY_TRANSCRIBE_MODEL/);
  assert.doesNotMatch(client, /api\.openai\.com|OPENAI_API_KEY|OPENAI_TRANSCRIBE_MODEL/);
});

test("one obsolete protocol response never disables voice for every account", () => {
  const client = read("lib/aiGatewayTranscription.ts");
  assert.doesNotMatch(client, /transcriptionProtocolUnavailableUntil/);
  assert.doesNotMatch(client, /TRANSCRIPTION_PROTOCOL_COOLDOWN_MS/);
});

test("Booster records a portable audio file first and keeps live dictation as fallback", () => {
  const panel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
  );
  const sharedVoiceButton = read(
    "app/dashboard/_components/MediaSubjectVoiceButton.tsx",
  );

  assert.match(panel, /import MediaSubjectVoiceButton/);
  assert.doesNotMatch(panel, /\bMediaRecorder\b|\bgetUserMedia\b/);
  assert.match(
    sharedVoiceButton,
    /shouldUseLiveOnly:\s*hasSpeechRecognition && !hasMediaRecording/,
  );
  assert.match(sharedVoiceButton, /recorder\.start\(\);/);
  assert.match(sharedVoiceButton, /normalizeRecordedMimeType/);
  assert.match(sharedVoiceButton, /startLiveOnlyRecording\(sessionId\)/);
});

test("transcription keeps a quality-first model with a Whisper fallback", () => {
  const models = getDefaultAllowedAiGatewayTranscriptionModels();
  assert.ok(models.has("openai/gpt-4o-transcribe"));
  assert.ok(models.has("openai/whisper-1"));
  assert.ok(models.has("openai/gpt-4o-mini-transcribe"));
});

test("raw transcription attempts are attached to the active account economic guard", () => {
  const client = read("lib/aiGatewayTranscription.ts");
  assert.match(client, /reserveAiGatewayAccountAttempt\(args\.accountId,\s*\{/);
  assert.match(client, /commitAiGatewayAccountAttempt/);
  assert.match(client, /rollbackAiGatewayAccountAttempt/);
  assert.match(client, /feature:\s*"booster\.transcribe"/);
  assert.equal(AI_FEATURE_POLICIES["booster.transcribe"].maxRetries, 1);
});

test("video transcription extracts an audio track before Gateway when FFmpeg is available", () => {
  const media = read("lib/transcriptionMedia.ts");
  const route = read("app/api/booster/transcribe/route.ts");
  assert.match(media, /-vn/);
  assert.match(media, /audio\.mp3/);
  assert.match(route, /extractVideoAudioForGateway/);
  assert.match(route, /mediaType = "audio\/mpeg"/);
});

test("direct OpenAI fallback is never used by the raw transcription runtime", () => {
  const activeTranscription = [
    read("app/api/booster/transcribe/route.ts"),
    read("lib/aiGatewayTranscription.ts"),
  ].join("\n");

  assert.doesNotMatch(activeTranscription, /OPENAI_API_KEY|OPENAI_TRANSCRIBE_MODEL|api\.openai\.com/);
  const generationClient = read("lib/aiGatewayClient.ts");
  assert.match(generationClient, /OPENAI_API_KEY/);
  assert.match(generationClient, /api\.openai\.com/);
});
