import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { normalizeAiMediaGenerationRequest, AiMediaRequestValidationError, type AiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { AI_MEDIA_SOUNDTRACKS, LEGACY_AI_MEDIA_SOUNDTRACKS } from "../../lib/aiMediaSoundtrackDefinitions.ts";
import { selectAiMediaSoundtrack } from "../../lib/aiMediaSoundtrackCatalog.ts";
import { buildGenerationAttemptKey } from "../../lib/mediaGenerationClientRequest.ts";
import { createAiMediaRequestFingerprint } from "../../lib/aiMediaGenerationQuotaPolicy.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const input = { requestId: "music-request-0001", kind: "video", source: "studio", subjectSource: "custom", idea: "Un jardin lumineux et calme.",
  format: "landscape", durationSeconds: 8, videoEngine: "omni", withMusic: true, withNarration: false };
const free = { ...input, creationMode: "free", freePrompt: input.idea };
const normalize = (patch: Record<string, unknown> = {}, creation: "free" | "guided" = "free") => normalizeAiMediaGenerationRequest({ ...(creation === "free" ? free : input), ...patch });

test("both Studio creation paths retain exact registered choices, including immutable saved IDs", () => {
  for (const creation of ["free", "guided"] as const) for (const definition of [...AI_MEDIA_SOUNDTRACKS, ...LEGACY_AI_MEDIA_SOUNDTRACKS]) {
    const request = normalize({ soundtrackId: definition.id }, creation);
    assert.equal(request.soundtrackId, definition.id); assert.equal(request.withMusic, true);
  }
});

test("old requests and explicit Auto normalize identically while music-off and images discard stale choices", () => {
  for (const creation of ["free", "guided"] as const) {
    assert.deepEqual(normalize({}, creation), normalize({ soundtrackId: null }, creation));
    assert.equal(normalize({}, creation).soundtrackId, null);
    for (const soundtrackId of ["jazz-velours", "unknown", { url: "https://external.invalid/audio.wav" }]) {
      const off = normalize({ withMusic: false, soundtrackId }, creation);
      assert.equal(off.soundtrackId, null); assert.equal(off.withMusic, false);
      const image = normalize({ kind: "image", soundtrackId }, creation);
      assert.equal(image.soundtrackId, null); assert.equal(image.withMusic, false);
    }
  }
});

test("foreign IDs, URLs, paths and malformed choices fail in normalization before any provider or credit operation", () => {
  for (const value of ["not-a-track", "https://external.invalid/music.wav", "../jazz-velours", "v2/jazz-velours", "jazz-velours ", "Jazz-velours", "", 7, {}, ["jazz-velours"]]) {
    for (const creation of ["free", "guided"] as const) assert.throws(() => normalize({ soundtrackId: value }, creation),
      (error: unknown) => error instanceof AiMediaRequestValidationError && /catalogue iNrCy/.test(error.message));
  }
});

/** Execute the real orchestration tasks, substituting only timing/history I/O. */
async function serverMusic(request: AiMediaGenerationRequest, accountId = "account-a", jobId = "job-a") {
  const file = ts.createSourceFile("aiMediaGenerationServer.ts", source("lib/aiMediaGenerationServer.ts"), ts.ScriptTarget.Latest, true);
  const declarations = new Map<string, string>();
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ["recentSoundtrackIdsTask", "soundtrackTask"].includes(node.name.text)) declarations.set(node.name.text, `const ${node.getText(file)};`);
    ts.forEachChild(node, walk);
  }; walk(file); assert.equal(declarations.size, 2);
  const emitted = ts.transpileModule([...declarations.values()].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const load = runtimeModules();
  const assets = load<typeof import("../../lib/aiMediaGenerationSoundtracks.ts")>("lib/aiMediaGenerationSoundtracks.ts");
  const calls: Array<{ prompt: string; options: Parameters<typeof assets.loadAiMediaSoundtrack>[1] }> = [];
  let historyReads = 0;
  const execute = new Function("args", "providerRequest", "measure", "getRecentAiMediaSoundtrackIds", "loadAiMediaSoundtrack", "durationSeconds", "creativePlan",
    `return (async()=>{${emitted};return await soundtrackTask;})()`);
  const result = await execute({ request, accountId, jobId }, request, (_label: string, work: () => unknown) => work(),
    async (scope: { accountId: string }) => { assert.equal(scope.accountId, accountId); historyReads++; return ["jazz-velours"]; },
    async (prompt: string, options: Parameters<typeof assets.loadAiMediaSoundtrack>[1]) => { calls.push({ prompt, options }); return assets.loadAiMediaSoundtrack(prompt, options); },
    request.durationSeconds, { companyName: "", headline: "" }) as { value: Awaited<ReturnType<typeof assets.loadAiMediaSoundtrack>> | null; warnings: string[] };
  return { result, calls, historyReads };
}

test("the actual server soundtrack task loads the selected bundled bytes instead of Auto or recent-track exclusions", async () => {
  const selected = await serverMusic(normalize({ soundtrackId: "jazz-velours" }));
  assert.equal(selected.result.value?.id, "jazz-velours"); assert.equal(selected.result.value?.fileName, "v2/jazz-velours-8s.wav");
  assert.match(selected.result.value!.sha256, /^[a-f0-9]{64}$/); assert.ok(selected.result.value!.sizeBytes > 44);
  assert.equal(selected.calls[0].options?.soundtrackId, "jazz-velours"); assert.equal(selected.historyReads, 0);
  assert.deepEqual(selected.result.warnings, []);
});

test("Auto keeps the exact historical selection algorithm and scopes its history and repeatability to account/job", async () => {
  const request = normalize();
  const first = await serverMusic(request), repeated = await serverMusic(request), other = await serverMusic(request, "account-b", "job-b");
  assert.equal(first.historyReads, 1); assert.equal(first.calls[0].options?.soundtrackId, undefined);
  assert.equal(first.calls[0].options?.selectionKey, "account-a:job-a"); assert.equal(other.calls[0].options?.selectionKey, "account-b:job-b");
  assert.deepEqual(first.calls[0].options?.excludedIds, ["jazz-velours"]);
  assert.equal(first.result.value?.id, selectAiMediaSoundtrack(first.calls[0].prompt, first.calls[0].options).id);
  assert.equal(first.result.value?.sha256, repeated.result.value?.sha256);
});

test("music off performs no soundtrack/history load regardless of a stale draft choice", async () => {
  const off = await serverMusic(normalize({ withMusic: false, soundtrackId: "jazz-velours" }));
  assert.equal(off.result.value, null); assert.deepEqual(off.calls, []); assert.equal(off.historyReads, 0);
});

function fingerprintFunction() {
  const file = ts.createSourceFile("route.ts", source("app/api/media-generation/generate/route.ts"), ts.ScriptTarget.Latest, true);
  const node = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "generationFingerprint");
  assert.ok(node);
  const emitted = ts.transpileModule(node.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("createAiMediaRequestFingerprint", "AI_MEDIA_FREE_PROMPT_VERSION", "AI_MEDIA_PROMPT_VERSION", emitted + ";return generationFingerprint;")(
    createAiMediaRequestFingerprint, "fixture-free-version", "fixture-guided-version",
  ) as (request: AiMediaGenerationRequest) => string;
}

test("server and client deduplication distinguish explicit tracks but retain Auto and disabled-music identities", () => {
  const fingerprint = fingerprintFunction();
  const auto = normalize(), jazz = normalize({ soundtrackId: "jazz-velours" }), piano = normalize({ soundtrackId: "piano-serein" });
  const { soundtrackId, ...legacy } = auto;
  assert.equal(soundtrackId, null);
  assert.equal(fingerprint(auto), fingerprint(legacy)); assert.equal(fingerprint(auto), fingerprint({ ...auto, soundtrackId: undefined }));
  assert.notEqual(fingerprint(jazz), fingerprint(piano)); assert.notEqual(fingerprint(jazz), fingerprint(auto));
  const client = (request: AiMediaGenerationRequest) => buildGenerationAttemptKey({
    source: "studio", kind: request.kind, format: request.format, subjectSource: request.subjectSource,
    idea: request.idea, creationMode: request.creationMode, freePrompt: request.freePrompt,
    withMusic: request.withMusic, soundtrackId: request.soundtrackId, textKeywords: [],
    imageStyle: "photo", peopleMode: "auto", useBrandColors: false, logoMode: "none",
  }, request.idea);
  assert.equal(client(auto), client(legacy)); assert.notEqual(client(jazz), client(piano));
  assert.equal(client(normalize({ withMusic: false, soundtrackId: "jazz-velours" })), client(normalize({ withMusic: false })));
});

test("a bundled music choice changes neither provider credit pricing nor the account-bound quote", () => {
  const quoteServer = runtimeModules()<typeof import("../../lib/aiMediaCreditQuoteServer.ts")>("lib/aiMediaCreditQuoteServer.ts");
  const jazz = normalize({ soundtrackId: "jazz-velours" });
  const quote = quoteServer.quoteAiMediaRequest("account-a", jazz);
  assert.deepEqual(quote, quoteServer.quoteAiMediaRequest("account-a", normalize()));
  assert.deepEqual(quote, quoteServer.quoteAiMediaRequest("account-a", normalize({ soundtrackId: "piano-serein" })));
  const priced = { ...jazz, expectedCredits: quote.totalCredits, creditTariffVersion: quote.tariffVersion, creditQuoteId: quote.quoteId };
  assert.equal(quoteServer.assertAiMediaCreditQuote(priced, quote), true);
  assert.equal(quoteServer.assertAiMediaCreditQuote(priced, quoteServer.quoteAiMediaRequest("account-b", jazz)), false);
  assert.equal(priced.soundtrackId, "jazz-velours");
});

test("the browser validation graph contains no Node imports and uses the same catalogue definitions as the server", () => {
  const definitions = source("lib/aiMediaSoundtrackDefinitions.ts");
  assert.doesNotMatch(definitions, /(?:from|import\s*\()\s*["'](?:node:|server-only)/);
  assert.equal(AI_MEDIA_SOUNDTRACKS.length, 30); assert.equal(LEGACY_AI_MEDIA_SOUNDTRACKS.length, 24);
});
