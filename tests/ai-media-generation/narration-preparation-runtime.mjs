import { readFileSync } from "node:fs";
import ts from "typescript";

export function loadNarrationPreparationRuntime(dependencies) {
  const source = readFileSync(new URL("../../lib/aiMediaNarrationPreparation.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", code)(loaded, loaded.exports, (id) => {
    if (!dependencies.has(id)) throw new Error(`Unexpected narration dependency: ${id}`);
    return dependencies.get(id);
  });
  return loaded.exports;
}
