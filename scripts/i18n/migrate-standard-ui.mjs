import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { STANDARD_I18N_TARGETS } from "./standard-scope.mjs";
import { APPLICATION_I18N_TARGETS } from "./application-scope.mjs";

const root = process.cwd();
const write = process.argv.includes("--write");
const catalogOnly = process.argv.includes("--catalog-only");
const listRemaining = process.argv.includes("--list-remaining");
const listHardcoded = process.argv.includes("--list-hardcoded");
const onlyNamespace = process.argv.find((argument) => argument.startsWith("--module="))?.split("=")[1];
const scope = process.argv.find((argument) => argument.startsWith("--scope="))?.split("=")[1] || "standard";

const modules = scope === "application"
  ? APPLICATION_I18N_TARGETS
  : scope === "all"
    ? { ...STANDARD_I18N_TARGETS, ...APPLICATION_I18N_TARGETS }
    : STANDARD_I18N_TARGETS;

const uiAttributes = new Set([
  "aria-label",
  "aria-description",
  "title",
  "placeholder",
  "alt",
  "label",
  "helperText",
  "emptyText",
]);

const uiObjectFields = new Set([
  "title",
  "subtitle",
  "label",
  "description",
  "intro",
  "goal",
  "message",
  "helper",
  "empty",
  "loading",
  "error",
  "success",
  "caption",
  "eyebrow",
  "cta",
  "text",
  "tooltip",
  "ariaLabel",
  "placeholder",
  "steps",
  "checks",
  "pitfalls",
  "keywords",
  "duration",
  "q",
  "a",
  "comment",
  "reply",
  "date",
]);

const uiCallPattern = /^(?:alert|confirm|prompt|toast|showToast|notify|set.*(?:Error|Errors|Notice|Message|Status|Feedback|Success|Warning|Toast|Banner))$/i;
const sourceExtensions = new Set([".ts", ".tsx"]);

function walkFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return sourceExtensions.has(path.extname(target)) ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(target, entry.name);
    if (entry.isDirectory()) return walkFiles(next);
    return sourceExtensions.has(path.extname(entry.name)) ? [next] : [];
  });
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function looksHumanText(value) {
  const text = normalizeText(value);
  if (text.length < 2 || !/\p{L}/u.test(text)) return false;
  if (/^(?:https?:|mailto:|tel:|data:|\/|\.\/|\.\.\/)/i.test(text)) return false;
  if (/^#(?:[0-9a-f]{3,8})$/i.test(text)) return false;
  if (/^(?:rgba?|hsla?|var|calc|min|max|clamp|linear-gradient|radial-gradient)\(/i.test(text)) return false;
  if (/^-?\d+(?:[.,]\d+)?(?:px|rem|em|vh|vw|svh|dvh|%)$/i.test(text)) return false;
  if (/<\/?[a-z][^>]*>/i.test(text)) return false;
  if (/^[a-z][a-z0-9-]*$/.test(text)) return false;
  if (/^[A-Z][A-Z0-9_-]+$/.test(text)) return false;
  if (/^[a-z]{2}-[A-Z]{2}$/.test(text)) return false;
  if (/^[a-z0-9_.:/@-]+$/.test(text) && (text.includes("/") || text.includes("_") || text.includes("."))) return false;
  if (/^(?:GET|POST|PUT|PATCH|DELETE|application\/json|content-type)$/i.test(text)) return false;
  if (/^(?:2-digit|numeric|short|long|narrow)$/i.test(text)) return false;
  if (/^(?:text|image|audio|video|application)\/[a-z0-9.+-]+(?:;[a-z0-9=._-]+)*$/i.test(text)) return false;
  if (/^(?:private|public),\s*(?:no-store|s-maxage|max-age|stale-while-revalidate)[a-z0-9=,\s-]*$/i.test(text)) return false;
  if (/^[dmyhms/:.\-\s]+$/i.test(text)) return false;
  if (/^\{value\d+\}T\d{2}:\d{2}:\d{2}$/i.test(text)) return false;
  return true;
}

function hasNaturalLanguageText(value) {
  return looksHumanText(String(value).replace(/\{value\d+\}/g, ""));
}

function isUiAttribute(name) {
  return uiAttributes.has(name) || /(?:Label|Title|Description|Message|Placeholder|Text|Caption|Hint|Kicker)$/.test(name);
}

function isUiObjectField(name) {
  return uiObjectFields.has(name) || /(?:Label|Title|Description|Message|Placeholder|Text|Caption|Hint|Kicker)$/.test(name);
}

function propertyNameText(name) {
  if (!name) return "";
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return "";
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

function directConditionalUiLiteral(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isJsxExpression(parent)) return !ts.isJsxAttribute(parent.parent);
    if (ts.isParenthesizedExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isConditionalExpression(parent) && (parent.whenTrue === current || parent.whenFalse === current)) {
      current = parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === current &&
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(parent.operatorToken.kind)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
  return false;
}

function functionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  return "";
}

function translationOwner(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current) && current.body && ts.isBlock(current.body)) {
      const name = functionName(current);
      const asyncFunction = current.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
      if (!asyncFunction && (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name))) {
        return { node: current, mode: "client" };
      }
      if (asyncFunction && (/^[A-Z]/.test(name) || name === "generateMetadata")) {
        return { node: current, mode: "server" };
      }
    }
    current = current.parent;
  }
  return null;
}

function nearestNamedFunction(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return functionName(current);
    current = current.parent;
  }
  return "";
}

function insideIgnoredElement(node) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const tag = current.openingElement.tagName.getText().toLowerCase();
      if (tag === "style" || tag === "script") return true;
    }
    current = current.parent;
  }
  return false;
}

function insideJsxAttribute(node) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxAttribute(current)) return true;
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) return false;
    current = current.parent;
  }
  return false;
}

function templateMessage(node, source) {
  if (!ts.isTemplateExpression(node)) return null;
  let message = node.head.text;
  const values = [];
  node.templateSpans.forEach((span, index) => {
    const name = `value${index}`;
    message += `{${name}}${span.literal.text}`;
    values.push(`${name}: ${span.expression.getText(source)}`);
  });
  return { message: normalizeText(message), values };
}

function literalMessage(node, source) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { message: normalizeText(node.text), values: [] };
  }
  return templateMessage(node, source);
}

function messageKey(message) {
  const slug = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\{[^}]+\}/g, " value ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .split("_")
    .filter(Boolean)
    .slice(0, 6)
    .join("_")
    .slice(0, 48) || "message";
  const hash = crypto.createHash("sha1").update(message).digest("hex").slice(0, 8);
  return `${slug}_${hash}`;
}

function addCandidate(found, node, kind, source) {
  if (insideIgnoredElement(node)) return;
  const parsed = literalMessage(node, source);
  if (!parsed || !hasNaturalLanguageText(parsed.message)) return;
  found.push({ node, kind, owner: translationOwner(node), ...parsed });
}

function collectCandidates(source) {
  const found = [];

  function addSimpleJsxGroup(node) {
    if (!ts.isJsxElement(node) || node.children.length < 2 || insideIgnoredElement(node)) return;
    const values = [];
    let message = "";
    for (const child of node.children) {
      if (ts.isJsxText(child)) {
        message += child.text;
        continue;
      }
      if (ts.isJsxExpression(child) && child.expression) {
        const expression = child.expression;
        const simple =
          ts.isIdentifier(expression) ||
          ts.isPropertyAccessExpression(expression) ||
          ts.isElementAccessExpression(expression) ||
          ts.isCallExpression(expression) ||
          ts.isNumericLiteral(expression);
        if (!simple) return;
        const name = `value${values.length}`;
        message += `{${name}}`;
        values.push(`${name}: ${expression.getText(source)}`);
        continue;
      }
      return;
    }
    const normalized = normalizeText(message);
    if (!values.length || !hasNaturalLanguageText(normalized)) return;
    const first = node.children[0];
    const last = node.children[node.children.length - 1];
    found.push({
      node,
      kind: "jsx-group",
      owner: translationOwner(node),
      message: normalized,
      values,
      start: first.getStart(source),
      end: last.getEnd(),
    });
  }

  function visit(node) {
    addSimpleJsxGroup(node);
    if (ts.isJsxText(node)) {
      const message = normalizeText(node.text);
      if (looksHumanText(message) && !insideIgnoredElement(node)) {
        found.push({
          node,
          kind: "jsx-text",
          owner: translationOwner(node),
          message,
          values: [],
          leadingSpace: /^[ \t]+/.test(node.text),
          trailingSpace: /[ \t]+$/.test(node.text),
        });
      }
    }

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      if (isUiAttribute(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) addCandidate(found, node.initializer, `attr:${name}`, source);
        if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          addCandidate(found, node.initializer.expression, `attr:${name}`, source);
        }
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propertyNameText(node.name);
      if (isUiObjectField(name)) {
        addCandidate(found, node.initializer, `field:${name}`, source);
        if (ts.isArrayLiteralExpression(node.initializer)) {
          for (const element of node.initializer.elements) addCandidate(found, element, `field:${name}[]`, source);
        }
      }
    }

    if (ts.isCallExpression(node) && uiCallPattern.test(callName(node.expression))) {
      if (node.arguments[0]) addCandidate(found, node.arguments[0], `call:${callName(node.expression)}`, source);
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
      directConditionalUiLiteral(node)
    ) {
      addCandidate(found, node, "jsx-expression", source);
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
      !insideJsxAttribute(node) &&
      /(?:label|title|message|text|status|error|warning|caption|meta|empty|format|summary|description|copy|reply)/i.test(nearestNamedFunction(node))
    ) {
      addCandidate(found, node, "helper-literal", source);
    }

    ts.forEachChild(node, visit);
  }

  visit(source);

  const unique = [];
  for (const candidate of found.sort((a, b) => {
    if (a.kind === "jsx-group" && b.kind !== "jsx-group") return -1;
    if (b.kind === "jsx-group" && a.kind !== "jsx-group") return 1;
    const aStart = a.start ?? a.node.getStart(source);
    const bStart = b.start ?? b.node.getStart(source);
    const aEnd = a.end ?? a.node.getEnd();
    const bEnd = b.end ?? b.node.getEnd();
    return (bEnd - bStart) - (aEnd - aStart);
  })) {
    const start = candidate.start ?? candidate.node.getStart(source);
    const end = candidate.end ?? candidate.node.getEnd();
    if (unique.some((selected) => {
      const selectedStart = selected.start ?? selected.node.getStart(source);
      const selectedEnd = selected.end ?? selected.node.getEnd();
      return start < selectedEnd && end > selectedStart;
    })) continue;
    unique.push(candidate);
  }
  return unique.sort((a, b) => (a.start ?? a.node.getStart(source)) - (b.start ?? b.node.getStart(source)));
}

function replacementFor(candidate, key) {
  const call = candidate.values.length
    ? `i18nT(${JSON.stringify(key)}, { ${candidate.values.join(", ")} })`
    : `i18nT(${JSON.stringify(key)})`;
  if (candidate.kind === "jsx-group") return `{${call}}`;
  if (candidate.kind === "jsx-text") {
    return `${candidate.leadingSpace ? '{" "}' : ""}{${call}}${candidate.trailingSpace ? '{" "}' : ""}`;
  }
  if (candidate.kind.startsWith("attr:") && ts.isStringLiteral(candidate.node) && ts.isJsxAttribute(candidate.node.parent)) {
    return `{${call}}`;
  }
  return call;
}

function importInsertion(sourceText, source, modes) {
  const imports = [];
  if (modes.has("client") && !/\buseTranslations\b/.test(sourceText)) {
    imports.push('import { useTranslations } from "next-intl";');
  }
  if (modes.has("server") && !/\bgetTranslations\b/.test(sourceText)) {
    imports.push('import { getTranslations } from "next-intl/server";');
  }
  if (!imports.length) return null;
  let position = 0;
  for (const statement of source.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
      position = statement.end;
      continue;
    }
    break;
  }
  return { start: position, end: position, text: `${position ? "\n\n" : ""}${imports.join("\n")}\n` };
}

function migrateFile(file, namespace, catalog, registeredSources) {
  const sourceText = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const candidates = collectCandidates(source);
  if (!listRemaining) {
    for (const candidate of candidates) {
      catalog[messageKey(candidate.message)] = candidate.message;
    }
  }
  const eligible = candidates.filter((candidate) => candidate.owner);
  if (catalogOnly || listRemaining || listHardcoded) {
    const reportedCandidates = listHardcoded
      ? candidates
      : candidates.filter((candidate) => !registeredSources.has(candidate.message));
    return {
      migrated: 0,
      skipped: candidates.length,
      alreadyMigrated: false,
      candidates: reportedCandidates.map((candidate) => ({
        file: path.relative(root, file).replaceAll("\\", "/"),
        line: source.getLineAndCharacterOfPosition(candidate.start ?? candidate.node.getStart(source)).line + 1,
        kind: candidate.kind,
        message: candidate.message,
      })),
    };
  }
  if (!eligible.length) return { migrated: 0, skipped: candidates.length, alreadyMigrated: false };

  const edits = [];
  const owners = new Map();
  for (const candidate of eligible) {
    const key = messageKey(candidate.message);
    edits.push({
      start: candidate.start ?? candidate.node.getStart(source),
      end: candidate.end ?? candidate.node.getEnd(),
      text: replacementFor(candidate, key),
    });
    owners.set(candidate.owner.node.getStart(source), candidate.owner);
  }

  for (const owner of owners.values()) {
    const factory = owner.mode === "server" ? "getTranslations" : "useTranslations";
    if (owner.node.getText(source).includes(`${factory}(${JSON.stringify(namespace)})`)) continue;
    edits.push({
      start: owner.node.body.getStart(source) + 1,
      end: owner.node.body.getStart(source) + 1,
      text: `\n  const i18nT = ${owner.mode === "server" ? "await " : ""}${factory}(${JSON.stringify(namespace)});`,
    });
  }

  const importEdit = importInsertion(sourceText, source, new Set([...owners.values()].map((owner) => owner.mode)));
  if (importEdit) edits.push(importEdit);

  let output = sourceText;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }
  if (write) fs.writeFileSync(file, output, "utf8");
  return { migrated: eligible.length, skipped: candidates.length - eligible.length, alreadyMigrated: false };
}

const report = {};
for (const [namespace, targets] of Object.entries(modules)) {
  if (onlyNamespace && namespace !== onlyNamespace) continue;
  const destination = path.join(root, "messages", "fr-FR", `${namespace}.json`);
  // Catalogues are append-only here: migration must never prune already
  // translated keys just because a source file has already been converted.
  const catalog = fs.existsSync(destination)
    ? JSON.parse(fs.readFileSync(destination, "utf8"))
    : {};
  const registeredSources = new Set(Object.values(catalog).map(normalizeText));
  const files = [...new Set(targets.flatMap((target) => walkFiles(path.join(root, target))))];
  let migrated = 0;
  let skipped = 0;
  let changedFiles = 0;
  const candidates = [];
  for (const file of files) {
    const result = migrateFile(file, namespace, catalog, registeredSources);
    migrated += result.migrated;
    skipped += result.skipped;
    if (result.migrated) changedFiles += 1;
    if (result.candidates) candidates.push(...result.candidates);
  }
  const orderedCatalog = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)));
  if ((write || catalogOnly) && Object.keys(orderedCatalog).length) {
    fs.writeFileSync(destination, `${JSON.stringify(orderedCatalog, null, 2)}\n`, "utf8");
  }
  report[namespace] = {
    files: files.length,
    changedFiles,
    migratedOccurrences: migrated,
    skippedOccurrences: skipped,
    messages: Object.keys(orderedCatalog).length,
    ...(listRemaining || listHardcoded ? { candidates } : {}),
    ...(listRemaining ? { unregisteredOccurrences: candidates.length } : {}),
    ...(listHardcoded ? { hardcodedOccurrences: candidates.length } : {}),
  };
}

console.log(JSON.stringify({ write, catalogOnly, listRemaining, listHardcoded, scope, report }, null, 2));
if (listRemaining && Object.values(report).some((entry) => entry.unregisteredOccurrences > 0)) {
  process.exitCode = 1;
}
if (listHardcoded && Object.values(report).some((entry) => entry.hardcodedOccurrences > 0)) {
  process.exitCode = 1;
}
