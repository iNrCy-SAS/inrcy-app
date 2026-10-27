import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nextConfig = readFileSync(
  new URL("../../next.config.ts", import.meta.url),
  "utf8",
);

test("Vercel functions retain Sharp and its native libvips packages", () => {
  assert.match(nextConfig, /outputFileTracingIncludes/);
  assert.match(nextConfig, /node_modules\/sharp\/\*\*\/\*/);
  assert.match(nextConfig, /node_modules\/@img\/\*\*\/\*/);

  for (const route of [
    "/api/cron/*",
    "/api/booster/**/*",
    "/api/media-pipeline/**/*",
    "/api/media-library/**/*",
    "/api/inrsend/**/*",
  ]) {
    assert.ok(nextConfig.includes(`"${route}": sharpRuntimeFiles`), route);
  }
});

test("HEIC conversion remains a traced Node runtime dependency", () => {
  assert.match(
    nextConfig,
    /serverExternalPackages:\s*\["heic-convert"\]/,
  );
});

function evaluatedTracingIncludes(): Record<string, string[]> {
  const record = { exports: {} as { default?: { outputFileTracingIncludes?: Record<string, string[]> } } };
  const nativeRequire = createRequire(import.meta.url);
  const code = ts.transpileModule(nextConfig, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const plugins: Record<string, unknown> = {
    "@sentry/nextjs": { withSentryConfig: (config: unknown) => config },
    "next-intl/plugin": () => (config: unknown) => config,
  };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { process: { env: {} } })((id: string) => {
    if (id === "node:path") return nativeRequire(id);
    assert.ok(Object.hasOwn(plugins, id), `Unexpected configuration dependency: ${id}`);
    return plugins[id];
  }, record, record.exports);
  assert.ok(record.exports.default?.outputFileTracingIncludes);
  return record.exports.default.outputFileTracingIncludes;
}

test("photo-video publication entry points retain FFmpeg, Sharp and both soundtrack generations without widening unrelated endpoints", () => {
  const includes = evaluatedTracingIncludes();
  const entryPoints = [
    ["/api/booster/publish-now", "app/api/booster/publish-now"],
    ["/api/agent/actions/execute", "app/api/agent/actions/execute"],
    ["/api/agent/scheduled-actions/*/execute", "app/api/agent/scheduled-actions/[id]/execute"],
  ] as const;
  for (const [route, directory] of entryPoints) {
    const runtimeFiles = Array.from(includes[route] || []);
    for (const required of ["node_modules/ffmpeg-static/**/*", "node_modules/sharp/**/*", "node_modules/@img/**/*", "assets/media-generation/soundtracks/**/*"]) assert.ok(runtimeFiles.includes(required), `${route}: ${required}`);
    if (route !== "/api/booster/publish-now") assert.match(readFileSync(path.join(process.cwd(), directory, "route.ts"), "utf8"), /from "@\/app\/api\/booster\/publish-now\/route"/);
  }
  assert.deepEqual(Array.from(includes["/api/booster/**/*"]), ["node_modules/sharp/**/*", "node_modules/@img/**/*"]);
  assert.deepEqual(Array.from(includes["/api/agent/**/*"]), ["node_modules/sharp/**/*", "node_modules/@img/**/*"]);
  assert.ok(!includes["/api/booster/soundtracks/*/preview"].some(file => file.includes("ffmpeg-static")));

  // CI contracts run before `next build`. The release check requests the
  // additional assertions below against the freshly generated deployment NFT.
  if (process.env.INRCY_VERIFY_BUILT_PUBLICATION_TRACES === "1") for (const [, directory] of entryPoints) {
    const tracePath = path.join(process.cwd(), ".next/server", directory, "route.js.nft.json");
    const trace = JSON.parse(readFileSync(tracePath, "utf8")) as { files: string[] };
    const files = trace.files.map(file => file.replace(/\\/g, "/"));
    assert.ok(files.some(file => /(?:^|\/)node_modules\/ffmpeg-static\/ffmpeg(?:\.exe)?$/.test(file)), `${directory}: executable must exist in the built trace`);
    assert.ok(files.some(file => file.includes("node_modules/@img/") && /(?:\.node|libvips)/.test(file)), `${directory}: native image runtime`);
    const legacy = new Set(files.filter(file => /assets\/media-generation\/soundtracks\/[^/]+-(?:8|16|24)s\.wav$/.test(file)).map(file => file.slice(file.lastIndexOf("/") + 1)));
    const current = new Set(files.filter(file => /assets\/media-generation\/soundtracks\/v2\/[^/]+-(?:8|16|24)s\.wav$/.test(file)).map(file => file.slice(file.lastIndexOf("/") + 1)));
    assert.equal(legacy.size, 72, `${directory}: retain every historical audio asset`);
    assert.equal(current.size, 90, `${directory}: retain every current instrumental asset`);
  }
});
