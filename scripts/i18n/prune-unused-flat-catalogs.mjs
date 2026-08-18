import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { APPLICATION_I18N_TARGETS } from "./application-scope.mjs";

const root = process.cwd();
const write = process.argv.includes("--write");
const locales = fs.readdirSync(path.join(root, "messages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const sourceExtensions = new Set([".ts", ".tsx"]);

function walkFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return sourceExtensions.has(path.extname(target)) ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(target, entry.name);
    return entry.isDirectory()
      ? walkFiles(next)
      : sourceExtensions.has(path.extname(entry.name)) ? [next] : [];
  });
}

function literalText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

function collectReferencedKeys(namespace, targets) {
  const keys = new Set();
  const dynamicCalls = [];
  const files = [...new Set(targets.flatMap((target) => walkFiles(path.join(root, target))))];

  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const bindings = new Set();

    function findBindings(node) {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
        && ts.isCallExpression(node.initializer)
        && ts.isIdentifier(node.initializer.expression)
        && node.initializer.expression.text === "useTranslations"
        && literalText(node.initializer.arguments[0]) === namespace
      ) {
        bindings.add(node.name.text);
      }
      ts.forEachChild(node, findBindings);
    }
    findBindings(source);
    if (!bindings.size) continue;

    function findCalls(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && bindings.has(node.expression.text)) {
        const key = literalText(node.arguments[0]);
        if (key) keys.add(key);
        else {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          dynamicCalls.push(`${path.relative(root, file).replaceAll("\\", "/")}:${line}`);
        }
      }
      ts.forEachChild(node, findCalls);
    }
    findCalls(source);
  }

  return { keys, dynamicCalls };
}

const report = {};
for (const [namespace, targets] of Object.entries(APPLICATION_I18N_TARGETS)) {
  const { keys, dynamicCalls } = collectReferencedKeys(namespace, targets);
  if (dynamicCalls.length) {
    throw new Error(`${namespace}: appels dynamiques non sûrs pour le nettoyage:\n${dynamicCalls.join("\n")}`);
  }

  const sourceFile = path.join(root, "messages", "fr-FR", `${namespace}.json`);
  const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  const missing = [...keys].filter((key) => typeof source[key] !== "string");
  if (missing.length) throw new Error(`${namespace}: clés absentes du français: ${missing.join(", ")}`);

  const orderedKeys = Object.keys(source).filter((key) => keys.has(key));
  for (const locale of locales) {
    const file = path.join(root, "messages", locale, `${namespace}.json`);
    if (!fs.existsSync(file)) continue;
    const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
    const pruned = Object.fromEntries(orderedKeys.filter((key) => typeof catalog[key] === "string").map((key) => [key, catalog[key]]));
    if (write) fs.writeFileSync(file, `${JSON.stringify(pruned, null, 2)}\n`, "utf8");
  }

  report[namespace] = {
    referenced: keys.size,
    removedFromFrench: Object.keys(source).length - orderedKeys.length,
  };
}

console.log(JSON.stringify({ write, report }, null, 2));
