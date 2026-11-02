import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { compareHygieneWarnings } from "./lint-hygiene-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtension = /\.(?:ts|tsx|js|jsx)$/;
function collect(directory) {
  const files = [];
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (file === "lib/vendor") continue;
    if (entry.isDirectory()) files.push(...collect(file));
    else if (entry.isFile() && sourceExtension.test(file) && !file.endsWith(".d.ts")) files.push(file);
  }
  return files;
}

try {
  const requested = process.argv.slice(2);
  const files = requested.length ? requested.map((file) => {
    const relative = path.relative(root, path.resolve(root, file)).replaceAll("\\", "/");
    if (relative.startsWith("../") || path.isAbsolute(relative) || !sourceExtension.test(relative) || !statSync(path.join(root, relative)).isFile()) {
      throw new Error(`Expected a source file inside this repository: ${file}`);
    }
    return relative;
  }) : ["app", "lib", "hooks", "i18n"].flatMap(collect);
  const baseline = JSON.parse(readFileSync(path.join(root, "scripts/lint-hygiene-baseline.json"), "utf8"));
  const eslint = new ESLint({ cwd: root, fix: false, overrideConfig: [{ files: ["**/*.{ts,tsx,js,jsx}"], rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
    "react-hooks/exhaustive-deps": "warn",
  } }] });
  const results = await eslint.lintFiles(files);
  const messages = results.flatMap((result) => result.messages.map((message) => ({
    file: path.relative(root, result.filePath).replaceAll("\\", "/"),
    line: message.line, column: message.column, rule: message.ruleId,
    severity: message.severity, message: message.message,
  })));
  const report = compareHygieneWarnings(messages, baseline);
  for (const issue of [...report.errors, ...report.newWarnings]) console.error(`${issue.file}:${issue.line}:${issue.column} ${issue.rule || "parse"} ${issue.message}`);
  console.log(`[lint:hygiene] ${results.length} files, ${report.knownWarnings} baseline warnings, ${report.newWarnings.length} new warnings, ${report.errors.length} errors. No files modified.`);
  process.exitCode = report.newWarnings.length || report.errors.length ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
