import { readAgentPublicationPreparationSource } from "../inragent/prepare-publication-sources.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

function read(rel: string) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function walk(relDir: string): string[] {
  const abs = join(ROOT, relDir);
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = join(relDir, entry.name);
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    if (entry.isDirectory()) return walk(rel);
    return entry.isFile() ? [rel.replaceAll("\\", "/")] : [];
  });
}

test("content and vision generation are Gateway-first with one centralized OpenAI emergency fallback", () => {
  const client = read("lib/aiGatewayClient.ts");
  const config = read("lib/aiGatewayConfig.ts");
  assert.match(config, /ai-gateway\.vercel\.sh\/v1/);
  assert.match(client, /https:\/\/api\.openai\.com\/v1/);
  assert.match(client, /transport:\s*"openai_direct"/);
  assert.match(client, /store:\s*false/);
  assert.match(client, /OPENAI_API_KEY/);
  assert.doesNotMatch(client, /OPENAI_MODEL|OPENAI_VISION_MODEL/);
});

test("only the centralized OpenAI emergency endpoint is allowed and raw transcription stays on Vercel Gateway", () => {
  const providerPattern = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.x\.ai|api\.perplexity\.ai|api\.deepseek\.com/g;
  const hits: Array<{ file: string; match: string }> = [];

  for (const file of [...walk("app"), ...walk("lib")]) {
    const text = read(file);
    for (const match of text.matchAll(providerPattern)) {
      hits.push({ file, match: match[0] });
    }
  }

  assert.deepEqual(hits, [
    { file: "lib/aiGatewayClient.ts", match: "api.openai.com" },
  ]);
  const transcription = read("lib/aiGatewayTranscription.ts");
  const config = read("lib/aiGatewayConfig.ts");
  assert.match(config, /v4\/ai\/transcription-model/);
  assert.match(transcription, /ai-model-id/);
  assert.doesNotMatch(transcription, /OPENAI_API_KEY|api\.openai\.com/);
});

test("every aiGenerateJSON call is tagged and explicitly routed", () => {
  const callIssues: string[] = [];
  for (const file of [...walk("app"), ...walk("lib")]) {
    if (file === "lib/aiGatewayClient.ts") continue;
    const text = read(file);
    const callRegex = /aiGenerateJSON(?:<[^;\n]+?>)?\s*\(\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(text))) {
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      const block = text.slice(match.index, match.index + 900);
      if (!/\bfeature\s*:/.test(block)) callIssues.push(`${file}:${line}:feature`);
      if (!/\bengine\s*:|\bmodel\s*:/.test(block)) callIssues.push(`${file}:${line}:routing`);
    }
  }
  assert.deepEqual(callIssues, []);
});

test("major iNrCy modules have distinct Gateway feature tags", () => {
  const expected = [
    "booster.publish",
    "agent.publish",
    "templates.generate",
    "agent.campaign",
    "mails.generate",
    "mails.attachment-image",
    "mails.attachment-video",
    "reviews.google",
    "agent.stats-report",
    "booster.transcript-cleanup",
  ];

  const sources = [
    "lib/aiGatewayClient.ts",
    "lib/boosterPublishGeneration.ts",
    "lib/templateAiGeneration.ts",
    "lib/aiAttachmentContext.ts",
    "app/api/agent/actions/prepare-publish/route.ts",
    "app/api/agent/actions/prepare-campaign/route.ts",
    "app/api/agent/actions/send-stats-report/route.ts",
    "app/api/booster/transcribe/route.ts",
    "app/api/e-reputation/google/generate-reply/route.ts",
    "app/api/mails/generate-ai/route.ts",
  ].map(read).join("\n");

  for (const feature of expected) {
    assert.match(sources, new RegExp(feature.replaceAll(".", "\\.")), `missing feature ${feature}`);
  }
});

test("iNrAgent shared generators identify Agent traffic explicitly", () => {
  assert.match(readAgentPublicationPreparationSource(), /aiFeature:\s*"agent\.publish"/);
  assert.match(read("app/api/agent/actions/prepare-campaign/route.ts"), /aiFeature:\s*"agent\.campaign"/);
});
