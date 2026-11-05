import { readFileSync } from "node:fs";
import ts from "typescript";
import * as localInterfaces from "../../lib/inrAssistantLocalInterface.ts";
import * as nativeChannelLinks from "../../lib/inrAssistantNativeChannelLinks.ts";

/** Load the real native ports against the fixture's React, viewer and router
 * boundaries. Never replace registration, revision or commit handlers by noops. */
export function createNativeLocalHookLoader(boundary: (specifier: string) => unknown) {
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const load = (specifier: string): unknown => {
    if (specifier === "@/lib/inrAssistantLocalInterface") return localInterfaces;
    if (specifier === "@/lib/inrAssistantNativeChannelLinks") return nativeChannelLinks;
    const name = specifier.split("/").at(-1);
    if (!name || !["useInrAssistantLocalInterface", "useInrAssistantLocalClose", "useInrAssistantNativeChannelLinks"].includes(name)) return undefined;
    const cached = cache.get(name);
    if (cached) return cached.exports;
    const loadedModule = { exports: {} as Record<string, unknown> };
    cache.set(name, loadedModule);
    const source = readFileSync(new URL(`../../app/dashboard/_hooks/${name}.ts`, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("module", "exports", "require", code)(loadedModule, loadedModule.exports, (dependency: string) => load(dependency) ?? boundary(dependency));
    return loadedModule.exports;
  };
  return load;
}
