import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const FORMER_PUBLIC_LABEL = /(?:\b(?:(?:co[- ]?)?(?:fondateur(?:s)?|fondatrice(?:s)?|founder(?:s)?|founding|fundador(?:a|es|as)?|fondator(?:e|i)|fondatric(?:e|i))|(?:mede)?(?:oprichter|oprichtster|stichter|stichtster)(?:s)?|(?:mit)?gründ(?:er(?:in(?:nen)?)?|ung)[\p{L}-]*)\b|ผู้ก่อตั้ง|創始人|创始人|創辦人|创办人)/iu;

function collectStrings(value: unknown, path = "root"): Array<{ path: string; value: string }> {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStrings(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => collectStrings(item, `${path}.${key}`));
}

function walkSourceFiles(relativeDirectory: string): string[] {
  return readdirSync(resolve(ROOT, relativeDirectory), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    if (entry.isDirectory()) return walkSourceFiles(relativePath);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)
      ? [relativePath.replaceAll("\\", "/")]
      : [];
  });
}

function sourceStringLiterals(file: string, source: string) {
  const values: string[] = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
      values.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      values.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

const TECHNICAL_PLAN_VALUES = new Set([
  "founder",
  "inrcy founder",
  "inrcy-founder",
  "inrcy_founder",
]);

test("no locale exposes the former public offer name in translated values", () => {
  const violations: string[] = [];
  const messagesRoot = resolve(ROOT, "messages");
  for (const localeEntry of readdirSync(messagesRoot, { withFileTypes: true })) {
    if (!localeEntry.isDirectory()) continue;
    const localeDirectory = join(messagesRoot, localeEntry.name);
    for (const catalogEntry of readdirSync(localeDirectory, { withFileTypes: true })) {
      if (!catalogEntry.isFile() || !catalogEntry.name.endsWith(".json")) continue;
      const relativePath = `messages/${localeEntry.name}/${catalogEntry.name}`;
      const catalog = JSON.parse(read(relativePath)) as unknown;
      for (const item of collectStrings(catalog)) {
        if (FORMER_PUBLIC_LABEL.test(item.value)) {
          violations.push(`${relativePath}:${item.path}=${JSON.stringify(item.value)}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("UI and API source literals only retain the internal compatibility values", () => {
  const violations: string[] = [];
  for (const file of ["proxy.ts", ...walkSourceFiles("app"), ...walkSourceFiles("lib")]) {
    const source = read(file);
    if (!FORMER_PUBLIC_LABEL.test(source)) continue;
    for (const value of sourceStringLiterals(file, source)) {
      if (!FORMER_PUBLIC_LABEL.test(value)) continue;
      if (TECHNICAL_PLAN_VALUES.has(value.trim().toLowerCase())) continue;
      violations.push(`${file}:${JSON.stringify(value)}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("the internal edition value and historical i18n keys remain compatible", () => {
  const edition = read("lib/dashboardEdition.ts");
  const admin = read("app/dashboard/admin/users/AdminUsersClient.tsx");
  const account = read("app/dashboard/settings/_components/AccountContent.tsx");
  const subscription = read("app/dashboard/settings/_components/AbonnementContent.tsx");

  assert.match(edition, /DashboardEdition = "standard" \| "premium" \| "founder"/);
  assert.match(admin, /<option value="founder">Partenaire historique · accès total<\/option>/);
  assert.match(account, /i18nT\("partenaire_fondateur_7857c49b"\)/);
  assert.match(subscription, /i18nT\("partenaire_fondateur_7857c49b"\)/);
  assert.match(subscription, /i18nT\("offre_partenaire_fondateur_82e34573"\)/);
  assert.match(subscription, /i18nT\("les_forfaits_premium_et_founder_sont_374bb1ec"\)/);
});
