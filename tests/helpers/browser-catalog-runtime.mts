import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

/** Bundle only the installed, pure ICU formatter and its static dependencies.
 * No service SDK, network, runtime file access or identity translation is used. */
export function browserCatalogRuntime(namespaces: string[], locale = "fr-FR") {
  const sources: Record<string, string> = {}, dependencies: Record<string, Record<string, string>> = {};
  const ids = new Map<string, string>(), require = createRequire(import.meta.url);
  const add = (file: string): string => {
    if (ids.has(file)) return ids.get(file)!;
    assert.ok(file.replaceAll("\\", "/").includes("/node_modules/"), "ICU fixture dependencies stay inside installed packages");
    const id = "icu-" + ids.size; ids.set(file, id);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    sources[id] = code; dependencies[id] = {};
    const resolve = createRequire(file);
    for (const [, name] of code.matchAll(/require\("([^"]+)"\)/g)) dependencies[id][name] = add(resolve.resolve(name));
    return id;
  };
  const main = add(require.resolve("intl-messageformat"));
  const catalogs = Object.fromEntries(namespaces.map(namespace => [namespace, JSON.parse(readFileSync(new URL(`../../messages/${locale}/${namespace}.json`, import.meta.url), "utf8"))]));
  return `const fixtureIntl=(()=>{
    const sources=${JSON.stringify(sources)},dependencies=${JSON.stringify(dependencies)},loaded={},catalogs=${JSON.stringify(catalogs)},locale=${JSON.stringify(locale)};
    function load(id){if(loaded[id])return loaded[id].exports;const module=loaded[id]={exports:{}};new Function("require","module","exports",sources[id])(name=>{const target=dependencies[id][name];if(!target)throw Error("Unexpected ICU dependency "+name);return load(target)},module,module.exports);return module.exports}
    const {IntlMessageFormat}=load(${JSON.stringify(main)}),formats=new Map(),translators=new Map();
    function value(namespace,key){return [...(namespace?namespace.split("."):[]),...key.split(".")].reduce((part,name)=>part?.[name],catalogs)}
    function translate(namespace,key,values={}){const text=value(namespace,key);if(typeof text!=="string")throw Error("Missing browser catalogue message "+namespace+"."+key);const id=namespace+"."+key;if(!formats.has(id))formats.set(id,new IntlMessageFormat(text,locale));return formats.get(id).format(values)}
    return {useLocale:()=>locale,useTranslations:(namespace="")=>{if(!translators.has(namespace)){const t=(key,values)=>translate(namespace,key,values);t.rich=t;t.raw=key=>value(namespace,key);t.has=key=>value(namespace,key)!==undefined;translators.set(namespace,t)}return translators.get(namespace)}};
  })();\n`;
}

/** Public error classification is pure client code; no SDK is admitted. */
export function browserPublicErrorSources() {
  return Object.fromEntries(["userFacingErrors", "appLanguage", "publicationErrorFrench", "metaGraphErrorClassification"].flatMap(name => {
    const file = `lib/${name}.ts`, source = readFileSync(new URL("../../" + file, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return [[`@/lib/${name}`, code], [`./${name}`, code], [`./${name}.ts`, code]];
  }));
}
