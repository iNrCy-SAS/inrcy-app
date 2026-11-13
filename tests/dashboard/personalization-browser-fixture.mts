import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

export const ROOT = path.resolve(import.meta.dirname, "../..");
const nodeRequire = createRequire(import.meta.url);
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const sources: Record<string, string> = {};
const cssExports: Record<string, Record<string, string>> = {};
const styles: string[] = [];
const mocked = new Set([
  "lib/supabaseClient", "lib/browserAccountCache", "lib/userFacingErrors", "lib/boosterGenerationContextClient",
  "lib/publicProfileRefreshClient", "lib/universalMediaUploadClient", "lib/inrcyDialog",
  "app/dashboard/_components/DashboardViewerAccessProvider", "app/dashboard/_components/DashboardEditionProvider",
  "app/dashboard/_components/DashboardUnsavedNavigationProvider", "app/dashboard/_hooks/useDashboardCompletionChecks",
  "app/dashboard/_hooks/useDashboardPreparationScores", "app/dashboard/_hooks/useUnsavedExitGuard",
  "app/dashboard/_components/DashboardAssistantTrigger", "app/dashboard/_components/MediaSubjectVoiceButton",
  "app/dashboard/_components/AiEngineInfoModal", "app/dashboard/settings/_components/BusinessDnaAnalysisScheduleModal",
]);
function resolved(name: string, from: string) {
  return name.startsWith("@/") ? name.slice(2) : name.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(from), name)) : name;
}
function bundle(name: string, from = "") {
  let file = resolved(name, from);
  if (mocked.has(file) || !/^(?:app|lib)\//.test(file)) return;
  if (file.endsWith(".css")) {
    if (cssExports[file]) return;
    const globals: string[] = [];
    let css = read(file).replace(/:global\(([^)]+)\)/g, (_, selector) => `___GLOBAL_${globals.push(selector) - 1}___`);
    const prefix = `p${Object.keys(cssExports).length}-`;
    const mapping: Record<string, string> = {};
    css = css.replace(/\.([A-Za-z_][\w-]*)/g, (_, key: string) => `.${mapping[key] ||= prefix + key}`);
    css = css.replace(/___GLOBAL_(\d+)___/g, (_, index: string) => globals[Number(index)]);
    cssExports[file] = mapping; styles.push(css); return;
  }
  if (!existsSync(path.join(ROOT, file))) {
    file = [".tsx", ".ts"].map(ext => file + ext).find(candidate => existsSync(path.join(ROOT, candidate))) || file;
  }
  if (sources[file]) return;
  if (!existsSync(path.join(ROOT, file))) throw new Error(`Unresolved browser fixture module ${name} from ${from}`);
  const output = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  sources[file] = output;
  for (const [, dependency] of output.matchAll(/require\("([^"]+)"\)/g)) bundle(dependency, file);
}
for (const [name, file] of Object.entries({ react: "react.production.js", "react/jsx-runtime": "react-jsx-runtime.production.js", "react-dom": "react-dom.production.js", "react-dom/client": "react-dom-client.production.js", scheduler: "scheduler.production.js" })) {
  const packageName = name.startsWith("react-dom") ? "react-dom" : name.startsWith("react/") ? "react" : name;
  sources[name] = readFileSync(path.join(path.dirname(nodeRequire.resolve(`${packageName}/package.json`)), "cjs", file), "utf8");
}
bundle("app/dashboard/personnalisation/page.tsx");
const catalogues = Object.fromEntries(["dashboard", "settings", "booster"].map(name => [name, JSON.parse(read(`messages/fr-FR/${name}.json`))]));
export const fixture = `window.sources=${JSON.stringify(sources)};window.cssExports=${JSON.stringify(cssExports)};window.catalogues=${JSON.stringify(catalogues)};\n` + read("tests/dashboard/fixtures/personalization-layout.js");
export const html = `<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*,*::before,*::after{box-sizing:border-box}html,body{margin:0;min-width:0;background:#071027;color:#f5f6ff;font:14px Arial,sans-serif}button,input,textarea,select{font-family:inherit}button{font-size:inherit}button:disabled{cursor:default}[hidden]{display:none!important}h1,h2,h3,p{margin-top:0}${styles.join("\n")}
</style></head><body><div id="root"></div></body></html>`;
