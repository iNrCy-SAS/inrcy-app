import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const messages = new Map();
function collect(value, prefix = "") {
  for (const [key, entry] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") messages.set(name, entry);
    else if (entry && typeof entry === "object") collect(entry, name);
  }
}
const directory = new URL("../../messages/fr-FR/", import.meta.url);
for (const name of readdirSync(directory).filter(name => name.endsWith(".json"))) {
  const catalog = JSON.parse(readFileSync(new URL(name, directory), "utf8"));
  collect(catalog);
  collect(catalog, name.slice(0, -5));
}
const cache = new Map();

/**
 * Annotate actual translation calls for legacy source contracts about copy.
 * Keep the original bindings, branches and order. Only keys present in the
 * inspected source receive copy; executable runtime fixtures use real Intl.
 */
export function withUiCopy(source) {
  if (cache.has(source)) return cache.get(source);
  const file = ts.createSourceFile("contract.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const additions = [];
  const visit = node => {
    if (ts.isCallExpression(node) &&
        (ts.isIdentifier(node.expression) && ["i18nT", "t"].includes(node.expression.text) ||
          ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "i18nT") &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const copy = messages.get(node.arguments[0].text);
      if (copy) additions.push({ end: node.end, copy: JSON.stringify(copy).replaceAll("*/", "* /") });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  let result = source;
  for (const { end, copy } of additions.sort((a, b) => b.end - a.end)) {
    result = `${result.slice(0, end)} /* localized copy: ${copy} */${result.slice(end)}`;
  }
  cache.set(source, result);
  return result;
}
