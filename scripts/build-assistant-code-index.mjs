import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const GENERATED_PATH = "lib/inrAssistantCodeIndex.generated.ts";
export const ASSISTANT_GUIDE_REVIEW_PATH = "scripts/assistant-guide-reviews.json";
const slash = (path) => path.replaceAll("\\", "/");
const normalizedSource = (value) => value.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
const hash = (value) => createHash("sha256").update(value).digest("hex");

/** Evaluate public guide metadata only, with no process, filesystem or secrets in scope.
 * Keep this loader aligned with the guide contract tests; local imports cannot escape the repo. */
export function readAssistantGuideReviewInventory(root) {
  const cache = new Map();
  function load(dependency, parent = root) {
    if (dependency === "server-only") return {};
    if (dependency === "ai") return { tool: (definition) => definition, jsonSchema: (schema) => schema };
    if (!dependency.startsWith(".") && !dependency.startsWith("@/")) throw new Error(`Unsupported guide metadata import: ${dependency}`);
    const path = dependency.startsWith("@/") ? resolve(root, dependency.slice(2)) : resolve(parent, dependency);
    const file = extname(path) ? path : `${path}.ts`;
    const local = slash(relative(root, file));
    if (local.startsWith("../") || local === ".." || !/\.(?:ts|tsx|json)$/.test(local)) throw new Error(`Invalid guide metadata path: ${local}`);
    if (cache.has(file)) return cache.get(file).exports;
    const source = normalizedSource(readFileSync(file, "utf8"));
    if (file.endsWith(".json")) return JSON.parse(source);
    const record = { exports: {} };
    cache.set(file, record);
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})(__require,__module,__module.exports)`, {
      __require: (value) => load(value, dirname(file)), __module: record, URL, URLSearchParams,
    }, { timeout: 2_000, filename: local });
    return record.exports;
  }
  const guides = load("./lib/inrAssistantAppGuides.ts").INR_ASSISTANT_APP_GUIDES;
  if (!Array.isArray(guides) || !guides.length) throw new Error("No public assistant guides were found for review.");
  const reviewed = {};
  for (const guide of guides) {
    if (!guide || typeof guide.id !== "string" || Object.hasOwn(reviewed, guide.id) || !Array.isArray(guide.sourceFiles) || !guide.sourceFiles.length) {
      throw new Error("Each assistant guide must have a unique id and non-empty sourceFiles.");
    }
    const sources = {};
    for (const sourcePath of [...new Set(guide.sourceFiles)].sort()) {
      const path = slash(sourcePath);
      if (!/^(?:app|lib|messages)\//.test(path) || path.split("/").includes("..") || path === GENERATED_PATH || !/\.(?:ts|tsx|json)$/.test(path)) {
        throw new Error(`Invalid review source for ${guide.id}: ${path}`);
      }
      sources[path] = hash(normalizedSource(readFileSync(join(root, path), "utf8")));
    }
    const procedure = Object.fromEntries(Object.entries(guide).filter(([key]) => key !== "sourceFiles"));
    reviewed[guide.id] = {
      guideDigest: hash(JSON.stringify({ ...procedure, sourceFiles: Object.keys(sources) })),
      sources,
    };
  }
  return { formatVersion: 1, guides: Object.fromEntries(Object.entries(reviewed).sort(([a], [b]) => a.localeCompare(b))) };
}

export function assistantGuideReviewStatus(current, reviewed) {
  const previous = reviewed?.formatVersion === 1 && reviewed.guides && typeof reviewed.guides === "object" ? reviewed.guides : {};
  const changed = Object.keys(current.guides).filter((id) => JSON.stringify(current.guides[id]) !== JSON.stringify(previous[id]));
  const removed = Object.keys(previous).filter((id) => !Object.hasOwn(current.guides, id));
  return { current: !changed.length && !removed.length, changed, removed };
}

/** Updating the global index never implicitly certifies the meaning of changed guides. */
export function verifyAssistantGuideReviews(root, selectedIds) {
  const current = readAssistantGuideReviewInventory(root);
  const path = join(root, ASSISTANT_GUIDE_REVIEW_PATH);
  let reviewed;
  try { reviewed = JSON.parse(readFileSync(path, "utf8")); } catch { reviewed = { formatVersion: 1, guides: {} }; }
  if (selectedIds) {
    const all = selectedIds === "all";
    const selection = all ? Object.keys(current.guides) : selectedIds.split(",").filter(Boolean);
    if (!selection.length || selection.some((id) => !Object.hasOwn(current.guides, id))) throw new Error("--review-guides must be 'all' or a comma-separated list of current guide ids.");
    reviewed = { formatVersion: 1, guides: all ? current.guides : { ...reviewed.guides, ...Object.fromEntries(selection.map((id) => [id, current.guides[id]])) } };
    // Explicitly reviewing all also acknowledges guide removals.
    writeFileSync(path, `${JSON.stringify(reviewed, null, 2)}\n`);
  }
  const status = assistantGuideReviewStatus(current, reviewed);
  if (!status.current) {
    const details = [status.changed.length ? `changed or unreviewed: ${status.changed.join(", ")}` : "", status.removed.length ? `removed: ${status.removed.join(", ")}` : ""].filter(Boolean).join("; ");
    throw new Error(`Assistant guide review is stale (${details}). Check the affected screens and procedures, then explicitly acknowledge them with --review-guides=<ids> (or --review-guides=all after a full review). --write alone cannot revalidate guides.`);
  }
  return status;
}

function filesIn(root, directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = slash(join(directory, entry.name));
    return entry.isDirectory() ? filesIn(root, path) : /\.(?:ts|tsx|json)$/.test(path) && path !== GENERATED_PATH ? [path] : [];
  });
}

/** Index source metadata and UI destinations only. Never copy source, env or credentials into prompts. */
export function readAssistantCodeInventory(root) {
  const paths = [...filesIn(root, "app"), ...filesIn(root, "lib"), ...filesIn(root, "messages/fr-FR")].sort();
  const digest = createHash("sha256");
  const pages = new Set();
  const links = new Set();
  let apiRoutes = 0;
  for (const path of paths) {
    const source = normalizedSource(readFileSync(join(root, path), "utf8"));
    digest.update(path).update("\0").update(source).update("\0");
    if (/^app\/api\/.*\/route\.ts$/.test(path)) apiRoutes++;
    if (/^app\/dashboard(?:\/.*)?\/page\.tsx?$/.test(path) && !path.startsWith("app/dashboard/admin/")) {
      pages.add(`/${path.replace(/^app\//, "").replace(/\/page\.tsx?$/, "").replace(/\/\([^/]+\)/g, "")}`);
    }
    if (!path.startsWith("app/dashboard/") || !/\.tsx?$/.test(path) || path.startsWith("app/dashboard/admin/")) continue;
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isStringLiteralLike(node) && /^\/dashboard(?:[/?#]|$)/.test(node.text) && node.text.length <= 220 &&
        !/\/dashboard\/admin(?:[/?#]|$)|(?:secret|token|password|signature)=/i.test(node.text) && !node.text.includes("${")) {
        links.add(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return {
    sourceDigest: digest.digest("hex"), sourceFileCount: paths.length, apiRouteCount: apiRoutes,
    dashboardPages: [...pages].sort(), literalDashboardLinks: [...links].sort(),
  };
}

export function assistantCodeIndexSource(inventory) {
  return `// Generated by scripts/build-assistant-code-index.mjs --write.\n// Source metadata and UI links only; no source code or private configuration.\nexport const INR_ASSISTANT_CODE_INDEX = ${JSON.stringify(inventory, null, 2)} as const;\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try { verifyAssistantGuideReviews(root, process.argv.find((value) => value.startsWith("--review-guides="))?.slice("--review-guides=".length)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  if (process.exitCode) process.exit(process.exitCode);
  const inventory = readAssistantCodeInventory(root);
  const expected = assistantCodeIndexSource(inventory);
  const target = join(root, GENERATED_PATH);
  if (process.argv.includes("--write")) {
    writeFileSync(target, expected);
    console.info(`Assistant code index: ${inventory.sourceFileCount} source files, ${inventory.dashboardPages.length} professional pages, ${inventory.apiRouteCount} API routes indexed.`);
  } else {
    let actual = "";
    try { actual = readFileSync(target, "utf8").replaceAll("\r\n", "\n"); } catch { /* Missing generated index is stale. */ }
    if (actual !== expected) {
      console.error("Assistant code index is stale. Review affected guides, then run node scripts/build-assistant-code-index.mjs --write.");
      process.exitCode = 1;
    } else console.info(`Assistant code index is current (${relative(root, target)}).`);
  }
}
