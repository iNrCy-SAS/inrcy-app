import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

import type { MediaGenerationRequest } from "../../app/dashboard/_hooks/useMediaGeneration.ts";
import {
  AiMediaRequestValidationError,
  normalizeAiMediaGenerationRequest,
  shouldConnectAiMediaVideoScenes,
} from "../../lib/aiMediaGenerationContracts.ts";

function clientRequest(overrides: Partial<MediaGenerationRequest> = {}): MediaGenerationRequest {
  return {
    kind: "video",
    subjectSource: "custom",
    idea: "Présenter notre nouvelle collection",
    textKeywords: [],
    format: "square",
    typology: "showcase",
    visualStyle: "brand",
    imageStyle: "photo",
    shotType: "auto",
    peopleMode: "auto",
    creativity: "faithful",
    useBrandColors: true,
    logoMode: "discreet",
    durationSeconds: 16,
    source: "studio",
    ...overrides,
  };
}

function normalize(overrides: Record<string, unknown> = {}) {
  return normalizeAiMediaGenerationRequest({
    ...clientRequest(),
    requestId: "connect-scenes-test-request",
    ...overrides,
  });
}

type HookRuntime = {
  default: () => { generate: (request: MediaGenerationRequest) => Promise<unknown> };
  fingerprintForTest: (request: MediaGenerationRequest, idea: string) => string;
};

/** Execute the real serializer and retry path without React effects or network. */
function hookRuntime() {
  const source = readFileSync(
    new URL("../../app/dashboard/_hooks/useMediaGeneration.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(
    `${source}\nexport { buildGenerationAttemptKey as fingerprintForTest };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const requests: Record<string, unknown>[] = [];
  const moduleRecord = { exports: {} };
  const runtimeRequire = (specifier: string) => {
    if (specifier === "react") {
      return {
        useCallback: (callback: unknown) => callback,
        useEffect: () => undefined,
        useRef: (initial: unknown) => ({ current: initial }),
        useState: (initial: unknown) => [initial, () => undefined],
      };
    }
    if (specifier === "@/lib/multicompte/constants") {
      return { ACTIVE_INRCY_ACCOUNT_EVENT: "fixture-account-change" };
    }
    if (specifier === "@/lib/aiMediaGenerationContracts") {
      return { shouldConnectAiMediaVideoScenes };
    }
    throw new Error(`Unexpected runtime dependency: ${specifier}`);
  };
  const fixtureFetch = async (url: string, options: RequestInit) => {
    assert.equal(url, "/api/media-generation/generate");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "include");
    assert.equal(typeof options.body, "string");
    requests.push(JSON.parse(options.body as string));
    // Keep the request pending so that we can verify real idempotent retries.
    return new Response(JSON.stringify({
      ok: false,
      code: "AI_MEDIA_GENERATION_IN_PROGRESS",
      message: "Fixture generation pending",
    }), { status: 409, headers: { "content-type": "application/json" } });
  };
  new Function("module", "exports", "require", "fetch", output)(
    moduleRecord, moduleRecord.exports, runtimeRequire, fixtureFetch,
  );
  return { runtime: moduleRecord.exports as HookRuntime, requests };
}

test("le raccord des scènes est optionnel, désactivé par défaut et réservé aux vidéos multi-actes", () => {
  for (const durationSeconds of [8, 16, 24]) {
    assert.equal(normalize({ durationSeconds }).connectScenes, false);
    assert.equal(normalize({ durationSeconds, connectScenes: false }).connectScenes, false);
    assert.equal(normalize({ durationSeconds, connectScenes: true }).connectScenes, durationSeconds > 8);
  }
  assert.equal(normalize({ kind: "image", connectScenes: true }).connectScenes, false);
  for (const videoEngine of ["veo", "omni"]) {
    assert.equal(normalize({ videoEngine, durationSeconds: 24, connectScenes: true }).connectScenes, true);
  }
});

test("le contrat refuse les valeurs non booléennes au lieu de les rendre vraies implicitement", () => {
  for (const connectScenes of ["true", "false", "1", "", 1, 0, null, [], {}]) {
    assert.throws(() => normalize({ connectScenes }), AiMediaRequestValidationError);
  }
});

test("les animations locales d'identité ne demandent pas de raccord au moteur", () => {
  const inspirationImages = [0, 1].map((value) => ({
    mimeType: "image/jpeg",
    data: Buffer.alloc(96, value + 1).toString("base64"),
  }));
  const identitySource = {
    identityConsent: true,
    inspirationImages,
    connectScenes: true,
    durationSeconds: 24,
  };
  for (const identityMode of ["professional", "brand_avatar", "reference_team"]) {
    assert.equal(normalize({ ...identitySource, identityMode, teamVideoMode: "montage" }).connectScenes, false);
    assert.equal(normalize({ ...identitySource, identityMode }).connectScenes, false, "montage est le défaut");
    assert.equal(normalize({
      ...identitySource,
      identityMode,
      teamVideoMode: "cinematic",
      teamVideoVeoConsent: true,
    }).connectScenes, true);
  }
  assert.equal(normalize({ ...identitySource, identityMode: "auto", teamVideoMode: "montage" }).connectScenes, true);
  assert.equal(normalize({ ...identitySource, identityMode: "professional", peopleMode: "none" }).connectScenes, true);
  assert.equal(normalize({ ...identitySource, identityMode: "reference_team", peopleMode: "none" }).connectScenes, false);
});

test("le raccord fait partie de l'empreinte idempotente du client", () => {
  const { runtime } = hookRuntime();
  const independent = clientRequest({ connectScenes: false });
  const continuous = clientRequest({ connectScenes: true });
  const independentKey = runtime.fingerprintForTest(independent, independent.idea);
  const continuousKey = runtime.fingerprintForTest(continuous, continuous.idea);
  assert.notEqual(independentKey, continuousKey);
  assert.equal(JSON.parse(independentKey).connectScenes, false);
  assert.equal(JSON.parse(continuousKey).connectScenes, true);
  assert.equal(
    runtime.fingerprintForTest(clientRequest(), independent.idea),
    independentKey,
    "un ancien client sans cette option reste en mode sans raccord",
  );
});

test("le vrai payload transmet le mode et son changement crée une nouvelle tentative", async () => {
  const { runtime, requests } = hookRuntime();
  const hook = runtime.default();
  for (const connectScenes of [false, false, true, true, false]) {
    await assert.rejects(
      hook.generate(clientRequest({ connectScenes })),
      { message: "Fixture generation pending" },
    );
  }
  assert.deepEqual(requests.map((body) => body.connectScenes), [false, false, true, true, false]);
  for (const body of requests) {
    assert.equal(normalizeAiMediaGenerationRequest(body).connectScenes, body.connectScenes);
    assert.equal(body.durationSeconds, 16);
    assert.equal(typeof body.requestId, "string");
  }
  assert.equal(requests[0]!.requestId, requests[1]!.requestId, "retry identique rejoué sans double génération");
  assert.notEqual(requests[1]!.requestId, requests[2]!.requestId, "cocher le raccord change la requête");
  assert.equal(requests[2]!.requestId, requests[3]!.requestId, "retry du raccord conserve sa tentative");
  assert.notEqual(requests[3]!.requestId, requests[4]!.requestId, "décocher le raccord change aussi la requête");
});

test("payload et empreinte utilisent la même applicabilité pour les options sans effet", async () => {
  const { runtime, requests } = hookRuntime();
  const hook = runtime.default();
  const inspirationImages = [0, 1].map((value) => ({
    mimeType: "image/jpeg" as const,
    data: Buffer.alloc(96, value + 1).toString("base64"),
    name: `fixture-${value}.jpg`,
  }));
  const cases: Array<Partial<MediaGenerationRequest>> = [
    { kind: "image" },
    { durationSeconds: 8 },
    ...(["professional", "brand_avatar", "reference_team"] as const).map((identityMode) => ({
      identityMode,
      identityConsent: true,
      teamVideoMode: "montage" as const,
      inspirationImages,
    })),
  ];
  for (const options of cases) {
    const request = clientRequest({ ...options, connectScenes: true });
    const key = runtime.fingerprintForTest(request, request.idea);
    assert.equal(JSON.parse(key).connectScenes, false);
    assert.equal(key, runtime.fingerprintForTest({ ...request, connectScenes: false }, request.idea));
    await assert.rejects(hook.generate(request), { message: "Fixture generation pending" });
    const body = requests.at(-1)!;
    assert.equal(body.connectScenes, false);
    assert.equal(normalizeAiMediaGenerationRequest(body).connectScenes, false);
  }
});
