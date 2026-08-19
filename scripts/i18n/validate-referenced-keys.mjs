import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const messagesRoot = path.join(root, "messages");
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (/\.(?:c|m)?(?:j|t)sx?$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

function flatten(value, prefix = "", output = {}) {
  for (const [key, child] of Object.entries(value || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, fullKey, output);
    else output[fullKey] = child;
  }
  return output;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (!fs.existsSync(messagesRoot)) {
  console.error("Répertoire messages introuvable.");
  process.exit(1);
}

const locales = fs.readdirSync(messagesRoot)
  .filter((entry) => fs.statSync(path.join(messagesRoot, entry)).isDirectory())
  .sort();
const catalogs = new Map();

for (const locale of locales) {
  const localeRoot = path.join(messagesRoot, locale);
  for (const filename of fs.readdirSync(localeRoot).filter((entry) => entry.endsWith(".json"))) {
    const namespace = filename.replace(/\.json$/, "");
    const content = JSON.parse(fs.readFileSync(path.join(localeRoot, filename), "utf8"));
    catalogs.set(`${locale}:${namespace}`, flatten(content));
  }
}

const findings = [];
let referenceCount = 0;

for (const file of walk(root)) {
  const source = fs.readFileSync(file, "utf8");
  const declarations = [];
  const declarationPattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(declarationPattern)) {
    declarations.push({ variable: match[1], namespace: match[2] });
  }

  for (const { variable, namespace } of declarations) {
    const [catalogName, ...namespaceParts] = namespace.split(".");
    const namespacePrefix = namespaceParts.join(".");
    const callPattern = new RegExp(
      `\\b${escapeRegExp(variable)}(?:\\.(?:rich|raw|has|markup))?\\(\\s*["']([^"']+)["']`,
      "g",
    );

    for (const match of source.matchAll(callPattern)) {
      referenceCount += 1;
      const key = match[1];
      const catalogKey = namespacePrefix ? `${namespacePrefix}.${key}` : key;
      const missingLocales = locales.filter(
        (locale) => !(catalogKey in (catalogs.get(`${locale}:${catalogName}`) || {})),
      );
      if (!missingLocales.length) continue;
      const line = source.slice(0, match.index).split("\n").length;
      findings.push({
        file: path.relative(root, file).replaceAll("\\", "/"),
        line,
        namespace,
        key,
        missingLocales,
      });
    }
  }
}

const uniqueFindings = Array.from(
  new Map(
    findings.map((finding) => [
      `${finding.file}:${finding.line}:${finding.namespace}:${finding.key}`,
      finding,
    ]),
  ).values(),
);

if (uniqueFindings.length) {
  console.error(`Échec des références i18n: ${uniqueFindings.length} clé(s) absente(s).`);
  for (const finding of uniqueFindings) {
    console.error(
      `- ${finding.file}:${finding.line} — ${finding.namespace}.${finding.key} — absent de ${finding.missingLocales.join(", ")}`,
    );
  }
  process.exit(1);
}

console.log(
  `Références i18n valides: ${referenceCount} appel(s) statique(s), ${locales.length} langue(s).`,
);
