import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceLocale = "fr-FR";
const args = process.argv.slice(2);
const write = args.includes("--write");
const localeArg = args.find((arg) => arg.startsWith("--locale="));
const namespaceArg = args.find((arg) => arg.startsWith("--namespaces="));
const targetLocales = localeArg
  ? localeArg.slice("--locale=".length).split(",").filter(Boolean)
  : fs.readdirSync(path.join(root, "messages")).filter((locale) => locale !== sourceLocale);
const allNamespaces = fs.readdirSync(path.join(root, "messages", sourceLocale))
  .filter((name) => name.endsWith(".json"))
  .map((name) => path.basename(name, ".json"))
  .sort();
const selectedNamespaces = namespaceArg
  ? namespaceArg.slice("--namespaces=".length).split(",").filter(Boolean)
  : allNamespaces;

function readCatalog(locale, namespace) {
  const filename = path.join(root, "messages", locale, `${namespace}.json`);
  return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")) : {};
}

function visitLeaves(value, callback, trail = []) {
  if (typeof value === "string") {
    callback(value, trail);
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) visitLeaves(child, callback, [...trail, key]);
}

function getAtPath(value, trail) {
  return trail.reduce((current, key) => current?.[key], value);
}

function reuseMissing(source, target, memory, counters) {
  if (typeof source === "string") {
    if (typeof target === "string" && target.trim()) return target;
    const translations = memory.get(source);
    if (translations?.size === 1) {
      counters.reused += 1;
      return translations.values().next().value;
    }
    counters.missing += 1;
    return undefined;
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return target;
  const output = {};
  for (const [key, child] of Object.entries(source)) {
    const translated = reuseMissing(child, target?.[key], memory, counters);
    if (translated !== undefined) output[key] = translated;
  }
  for (const [key, child] of Object.entries(target ?? {})) {
    if (!(key in source)) output[key] = child;
  }
  return output;
}

for (const locale of targetLocales) {
  const memory = new Map();
  for (const namespace of allNamespaces) {
    const source = readCatalog(sourceLocale, namespace);
    const target = readCatalog(locale, namespace);
    visitLeaves(source, (sourceText, trail) => {
      const translated = getAtPath(target, trail);
      if (typeof translated !== "string" || !translated.trim()) return;
      if (!memory.has(sourceText)) memory.set(sourceText, new Set());
      memory.get(sourceText).add(translated);
    });
  }

  for (const namespace of selectedNamespaces) {
    const source = readCatalog(sourceLocale, namespace);
    const target = readCatalog(locale, namespace);
    const counters = { reused: 0, missing: 0 };
    const output = reuseMissing(source, target, memory, counters);
    if (write && counters.reused) {
      const filename = path.join(root, "messages", locale, `${namespace}.json`);
      fs.writeFileSync(filename, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    }
    console.log(`${locale}/${namespace}: reused=${counters.reused} missing=${counters.missing}`);
  }
}
