import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

function walk(relativeDirectory: string): string[] {
  const absoluteDirectory = resolve(ROOT, relativeDirectory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    if (entry.isDirectory()) return walk(relativePath);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)
      ? [relativePath.replaceAll("\\", "/")]
      : [];
  });
}

function aiGenerateJsonCallsByFile() {
  const calls = new Map<string, number>();
  for (const file of [...walk("app"), ...walk("lib")]) {
    if (file === "lib/aiGatewayClient.ts") continue;
    const source = read(file);
    let count = 0;
    for (const match of source.matchAll(/\baiGenerateJSON\b/g)) {
      const following = source.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 900);
      if (/^\s*(?:<[\s\S]{0,800}?>\s*)?\(/.test(following)) count += 1;
    }
    if (count) calls.set(file, count);
  }
  return calls;
}

const USER_CONTENT_CALLS = new Map<string, number>([
  ["app/api/agent/actions/send-stats-report/route.ts", 1],
  ["app/api/e-reputation/google/generate-reply/route.ts", 1],
  ["app/api/mails/generate-ai/route.ts", 1],
  ["lib/aiMediaCopywriter.ts", 1],
  ["lib/aiMediaNarration.ts", 1],
  ["lib/boosterPublishGeneration.ts", 1],
  ["lib/templateAiGeneration.ts", 1],
]);

const TECHNICAL_CALLS = new Map<string, number>([
  ["app/api/ai-memory/analyze-channels/route.ts", 1],
  ["app/api/booster/transcribe/route.ts", 1],
  ["lib/aiAttachmentContext.ts", 2],
  ["lib/aiMediaUnderstanding.ts", 1],
]);

test("every aiGenerateJSON call is exhaustively classified as user content or technical analysis", () => {
  const expected = new Map([...USER_CONTENT_CALLS, ...TECHNICAL_CALLS]);
  assert.deepEqual(
    [...aiGenerateJsonCallsByFile()].sort(([left], [right]) => left.localeCompare(right)),
    [...expected].sort(([left], [right]) => left.localeCompare(right)),
  );
});

test("direct text writers use the shared server context, normalized profile and writing prompt", () => {
  const directTextWriters = [
    "app/api/agent/actions/send-stats-report/route.ts",
    "app/api/e-reputation/google/generate-reply/route.ts",
    "app/api/mails/generate-ai/route.ts",
    "lib/templateAiGeneration.ts",
  ];

  for (const file of directTextWriters) {
    const source = read(file);
    assert.match(source, /getAiProfessionalGenerationContext/, `${file}: shared loader`);
    assert.match(source, /buildNormalizedAiGenerationProfile\(/, `${file}: canonical profile`);
    assert.match(
      source,
      /buildAiWritingProfilePromptSection\(generationProfile\)/,
      `${file}: professional writing profile`,
    );
    assert.match(
      source,
      /buildAiWritingProfileRules\(generationProfile/,
      `${file}: professional writing rules`,
    );
    assert.doesNotMatch(source, /\.from\(["'](?:profiles|business_profiles|business_ai_memories)["']\)/, `${file}: no ad-hoc professional profile query`);
  }
});

test("iNrAgent campaign and report entrypoints no longer reload professional tables ad hoc", () => {
  for (const file of [
    "app/api/agent/actions/prepare-campaign/route.ts",
    "app/api/agent/actions/send-stats-report/route.ts",
  ]) {
    const source = read(file);
    assert.match(source, /from "@\/lib\/aiProfessionalGenerationContext"/);
    assert.match(source, /getAiProfessionalGenerationContext\(/);
    assert.doesNotMatch(source, /\.from\(["'](?:profiles|business_profiles|business_ai_memories)["']\)/);
  }
});

test("shared professional context keeps server-side Premium filtering and a contact-free prompt projection", () => {
  const facade = read("lib/aiProfessionalGenerationContext.ts");
  const loader = read("lib/boosterGenerationContext.ts");
  const profile = read("lib/aiGenerationProfile.ts");
  const projection = facade.slice(facade.indexOf("buildAiProfessionalBusinessPromptPayload"));

  assert.match(facade, /getAiProfessionalGenerationContext/);
  assert.match(loader, /includePremium: hasPremiumDashboardAccess\(edition\)/);
  assert.match(profile, /includePremium: lengthEdition === "premium"/);
  assert.doesNotMatch(projection, /business\.(?:phone|email|postalCode)/);
  assert.doesNotMatch(projection, /(?:access|refresh|api)[_-]?token|messages?/i);
});

test("indirect Booster, iNrAgent publication and Media writers receive the canonical profile", () => {
  const boosterRoute = read("app/api/booster/generate/route.ts");
  const agentPublication = read("app/api/agent/actions/prepare-publish/route.ts");
  const boosterWriter = read("lib/boosterPublishGeneration.ts");
  const mediaServer = read("lib/aiMediaGenerationServer.ts");
  const mediaCopywriter = read("lib/aiMediaCopywriter.ts");
  const mediaNarration = read("lib/aiMediaNarration.ts");

  assert.match(boosterRoute, /getBoosterGenerationContext\(/);
  assert.match(agentPublication, /getBoosterGenerationContext\(/);
  assert.match(boosterWriter, /generationProfile: NormalizedAiGenerationProfile/);
  assert.match(boosterWriter, /generationProfile: args\.generationProfile/);
  assert.match(mediaServer, /getBoosterGenerationContext\(/);
  assert.match(mediaServer, /buildNormalizedAiGenerationProfile\(/);
  for (const source of [mediaCopywriter, mediaNarration]) {
    assert.match(source, /profile: NormalizedAiGenerationProfile/);
    assert.match(source, /buildAiMediaBusinessDnaPayload\(args\.profile\)/);
  }
});

test("image and video provider calls only receive prompts compiled upstream from the canonical profile", () => {
  const mediaServer = read("lib/aiMediaGenerationServer.ts");
  const imageTransport = read("lib/aiMediaGateway.ts");
  const videoVeoTransport = read("lib/aiVideoProviderGoogleVeo.ts");
  const videoOmniTransport = read("lib/aiVideoProviderGoogleOmni.ts");
  const narrationAudioTransport = read("lib/aiMediaNarrationAudio.ts");

  assert.match(mediaServer, /const profile = buildNormalizedAiGenerationProfile\(/);
  assert.match(mediaServer, /buildAiMediaPrompt\(\{[\s\S]*?profile,/);
  assert.match(mediaServer, /generateAiMediaImage\(\{[\s\S]*?prompt,/);
  assert.match(mediaServer, /buildAiMediaVideoDnaBrief\(profile\)/);
  assert.match(imageTransport, /await generateImage\(\{/);
  assert.match(videoVeoTransport, /args\.ai\.models\.generateVideos\(\{/);
  assert.match(videoOmniTransport, /args\.ai\.interactions\.create\(/);

  // La synthèse vocale est un rendu mot à mot du script déjà personnalisé :
  // elle ne doit pas recevoir un second contexte susceptible d'altérer le texte.
  assert.match(narrationAudioTransport, /TRANSCRIPTION À LIRE MOT POUR MOT/);
  assert.match(narrationAudioTransport, /args\.narration\.script/);
  assert.doesNotMatch(narrationAudioTransport, /buildAiWritingProfilePromptSection|buildAiMediaBusinessDnaPayload/);
});

test("technical transforms remain fact-only and do not receive the professional writing memory", () => {
  const technicalSources = [...TECHNICAL_CALLS.keys()].map(read);
  for (const source of technicalSources) {
    assert.doesNotMatch(source, /buildAiWritingProfilePromptSection/);
  }
  assert.match(read("lib/aiMediaUnderstanding.ts"), /mission s'arrête à l'observation/);
  assert.match(read("app/api/booster/transcribe/route.ts"), /Ne change pas le sens, n'invente rien/);
  assert.match(read("lib/aiAttachmentContext.ts"), /Reste factuel\. N'invente rien/);
});
