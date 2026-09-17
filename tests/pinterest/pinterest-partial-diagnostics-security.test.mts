import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

type UnknownRecord = Record<string, unknown>;

const requireFromTest = createRequire(import.meta.url);

function loadPinterestCarouselModule() {
  const source = readFileSync(
    new URL("../../lib/pinterestCarouselImages.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleRecord: { exports: UnknownRecord } = { exports: {} };
  const sharpStub = () => ({
    metadata: async () => ({ width: 1000, height: 1000 }),
  });
  const localRequire = (specifier: string) => {
    if (specifier === "server-only") return {};
    if (specifier === "sharp") return sharpStub;
    if (specifier === "@/lib/boosterImageDecision") {
      return {
        BOOSTER_AUTO_CROP_MAX_LOSS: 0.08,
        getImageCropLossFraction: () => 0,
      };
    }
    if (specifier === "@/lib/pinterestCarouselPolicy") {
      return {
        buildPinterestCarouselGeometryPlan: () => ({ harmonize: false }),
      };
    }
    if (specifier === "@/lib/supabaseAdmin") {
      return { supabaseAdmin: { storage: { from: () => ({}) } } };
    }
    if (specifier === "@/lib/supabaseStorageBinary") {
      return { toExactStorageArrayBuffer: (value: unknown) => value };
    }
    return requireFromTest(specifier);
  };
  const execute = new Function("module", "exports", "require", output);
  execute(moduleRecord, moduleRecord.exports, localRequire);
  return moduleRecord.exports;
}

test("Pinterest ne remet jamais l'URL source signée dans un diagnostic partiel", async () => {
  const loaded = loadPinterestCarouselModule();
  const preparePinterestCarouselImages = loaded.preparePinterestCarouselImages as (
    params: UnknownRecord,
  ) => Promise<UnknownRecord>;
  const failedUrl =
    "https://private-storage.test/object/sign/photo.jpg?token=private-signed-token";
  const validUrl = "https://public-storage.test/photo.jpg";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === failedUrl) return new Response("indisponible", { status: 503 });
    if (url === validUrl) {
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await preparePinterestCarouselImages({
      userId: "account-test",
      imageUrls: [failedUrl, validUrl],
    });
    assert.equal(result.requestedCount, 2);
    assert.equal(result.preparedCount, 1);
    assert.deepEqual(result.rejectedImages, [
      {
        index: 0,
        stage: "download",
        error: "Pinterest n’a pas pu récupérer l’image 1 (503).",
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(result.rejectedImages),
      /private-storage|private-signed-token|[?&]token=/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
