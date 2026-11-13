import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const repo = new URL("../../", import.meta.url);
const cache = new Map<string, Record<string, unknown>>();
function load(file: URL): Record<string, unknown> {
  if (!file.pathname.endsWith(".ts")) file = new URL(file.href + ".ts");
  assert.ok(file.href.startsWith(new URL("lib/", repo).href), "error fixtures load only local pure library modules");
  const cached = cache.get(file.href);
  if (cached) return cached;
  const exports: Record<string, unknown> = {};
  cache.set(file.href, exports);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", code)((name: string) => {
    if (name.startsWith("@/")) return load(new URL(name.slice(2), repo));
    assert.ok(name.startsWith("."), "error fixtures never load a service SDK");
    return load(new URL(name, file));
  }, exports);
  return exports;
}

/** Real display boundaries, with no network, database or generation calls. */
export const userFacingErrorsFixture = load(new URL("lib/userFacingErrors.ts", repo)) as unknown as typeof import("../../lib/userFacingErrors.ts");
export const aiMediaPublicErrorsFixture = load(new URL("lib/aiMediaGenerationPublicErrorI18n.ts", repo)) as unknown as typeof import("../../lib/aiMediaGenerationPublicErrorI18n.ts");
