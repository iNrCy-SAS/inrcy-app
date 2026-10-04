import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (file) => readFileSync(resolve(process.cwd(), file), "utf8");

function assertAuthorizedDynamicWorkerImport(source, authorizationGuard, imports) {
  const handler = source.slice(source.indexOf("export async function POST"));
  const guard = handler.indexOf(authorizationGuard);
  const unauthorizedResponse = handler.indexOf("{ status: 401 }");
  const tryBlock = handler.indexOf("try {");

  assert.ok(guard >= 0, "authorization guard is missing");
  assert.ok(unauthorizedResponse > guard, "unauthorized requests must return 401");
  assert.ok(tryBlock > unauthorizedResponse, "worker imports must follow authorization");

  for (const importedModule of imports) {
    assert.doesNotMatch(
      source.slice(0, source.indexOf("export async function POST")),
      new RegExp(`from ["']${importedModule}["']`),
      `${importedModule} must not load at module initialization`,
    );
    const dynamicImport = handler.indexOf(`await import(\n      "${importedModule}"`);
    assert.ok(
      dynamicImport > tryBlock,
      `${importedModule} must load inside the guarded try block`,
    );
  }

  assert.match(handler, /catch \(error\) \{[\s\S]*?\{ status: 500 \}/);
  assert.match(handler, /stage,[\s\S]*?reason:[\s\S]*?elapsedMs:/);
  assert.match(handler, /export const GET = POST|export async function GET\(req: Request\) \{\s*return POST\(req\);/);
}

test("le cron Médiathèque ne charge le worker qu'après autorisation et garde les erreurs 500", () => {
  const source = read("app/api/cron/media-library-optimization/route.ts");
  assertAuthorizedDynamicWorkerImport(source, "if (!isAuthorizedCronRequest(request))", [
    "@/lib/mediaLibraryOptimizationWorker",
  ]);
  assert.match(source, /maxDuration = 1_800/);
  assert.match(source, /worker_loaded/);
  assert.match(source, /completed/);
  assert.match(source, /processMediaLibraryOptimizationJobs\(\{ limit: 1 \}\)/);
});

test("le cron vidéo ne charge queue et worker qu'après autorisation et garde les erreurs 500", () => {
  const source = read("app/api/cron/media-video-normalization/route.ts");
  assertAuthorizedDynamicWorkerImport(source, "if (!isAuthorizedCron(req))", [
    "@/lib/mediaVideoNormalizationQueue",
    "@/lib/mediaVideoNormalizationWorker",
  ]);
  assert.match(source, /maxDuration = 1800/);
  assert.match(source, /worker_loaded/);
  assert.match(source, /completed/);
  assert.match(source, /repairPendingVideoNormalizationQueue\(\{ limit: 10 \}\)/);
  assert.match(source, /processVideoNormalizationJobs\(\{ limit: 1 \}\)/);
});
