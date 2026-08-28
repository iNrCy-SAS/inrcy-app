import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceLocale = "fr-FR";
const targetLocales = ["en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const sourceDirectory = path.join(root, "messages", sourceLocale);
const namespaces = fs.readdirSync(sourceDirectory)
  .filter((name) => name.endsWith(".json"))
  .map((name) => path.basename(name, ".json"))
  .sort();

const report = {};

function leafPaths(value, prefix = [], output = new Set()) {
  if (typeof value === "string") {
    output.add(JSON.stringify(prefix));
    return output;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) leafPaths(child, [...prefix, key], output);
  return output;
}

function alignCatalog(source, target, counters) {
  if (typeof source === "string") {
    if (typeof target === "string" && target.trim()) {
      counters.preserved += 1;
      return target;
    }
    counters.missing += 1;
    return undefined;
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  const output = {};
  for (const [key, child] of Object.entries(source)) {
    const aligned = alignCatalog(child, target?.[key], counters);
    if (aligned !== undefined && (typeof aligned !== "object" || Object.keys(aligned).length)) {
      output[key] = aligned;
    }
  }
  return output;
}

for (const locale of targetLocales) {
  report[locale] = {};
  for (const namespace of namespaces) {
    const sourceFile = path.join(sourceDirectory, `${namespace}.json`);
    const targetFile = path.join(root, "messages", locale, `${namespace}.json`);
    const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
    const target = fs.existsSync(targetFile)
      ? JSON.parse(fs.readFileSync(targetFile, "utf8"))
      : {};
    const counters = { preserved: 0, missing: 0 };
    const aligned = alignCatalog(source, target, counters) ?? {};
    const sourcePaths = leafPaths(source);
    const dropped = [...leafPaths(target)].filter((key) => !sourcePaths.has(key)).length;
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, `${JSON.stringify(aligned, null, 2)}\n`, "utf8");
    report[locale][namespace] = { ...counters, dropped };
  }
}

console.log(JSON.stringify(report, null, 2));
