import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

/** Execute production TS with only explicit service boundaries substituted. */
export function runtimeModules(stubs: Record<string, unknown> = {}) {
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load<T>(relative: string): T {
    const path = resolve(root, relative);
    if (cache.has(path)) return cache.get(path)!.exports as T;
    const result = { exports: {} };
    cache.set(path, result);
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    new Function("module", "exports", "require", compiled)(result, result.exports, (id: string) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      if (id === "server-only") return {};
      if (id.startsWith("@/")) return load(`${id.slice(2)}${id.endsWith(".ts") ? "" : ".ts"}`);
      if (id.startsWith(".")) return load(resolve(dirname(path), `${id}${id.endsWith(".ts") ? "" : ".ts"}`));
      return require(id);
    });
    return result.exports as T;
  }
  return load;
}
