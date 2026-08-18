import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { STANDARD_I18N_TARGETS } from "./standard-scope.mjs";

const root = process.cwd();
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

const errors = [];
let referenceCount = 0;

for (const [namespace, targets] of Object.entries(STANDARD_I18N_TARGETS)) {
  const catalogFile = path.join(root, "messages", "fr-FR", `${namespace}.json`);
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  const files = [...new Set(targets.flatMap((target) => walkFiles(path.join(root, target))))];

  for (const file of files) {
    const sourceText = fs.readFileSync(file, "utf8");
    const source = ts.createSourceFile(
      file,
      sourceText,
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

    function findKeys(node) {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && bindings.has(node.expression.text)
      ) {
        const key = literalText(node.arguments[0]);
        if (key) {
          referenceCount += 1;
          if (typeof catalog[key] !== "string") {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            errors.push(`${path.relative(root, file).replaceAll("\\", "/")}:${line}: clé ${namespace}.${key} absente`);
          }
        }
      }
      ts.forEachChild(node, findKeys);
    }
    findKeys(source);
  }
}

if (errors.length) {
  console.error(`Échec usage i18n Standard: ${errors.length} référence(s) sans catalogue.`);
  const diagnosticLimit = process.env.INRCY_I18N_FULL_DIAGNOSTICS === "1"
    ? errors.length
    : 100;
  errors.slice(0, diagnosticLimit).forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Usage i18n Standard valide: ${referenceCount} référence(s) contrôlée(s).`);
}
