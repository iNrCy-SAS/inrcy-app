import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const testsRoot = path.join(repositoryRoot, "tests");

async function collectContractTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectContractTests(absolutePath)));
      continue;
    }
    if (/\.test\.m(?:j|t)s$/i.test(entry.name)) files.push(absolutePath);
  }

  return files;
}

const testFiles = (await collectContractTests(testsRoot)).sort((left, right) =>
  left.localeCompare(right),
);
const relativeTestFiles = testFiles.map((filePath) =>
  path.relative(repositoryRoot, filePath),
);

if (testFiles.length === 0) {
  throw new Error("No contract tests were found under tests/.");
}

const requestedConcurrency = Number.parseInt(
  process.env.CONTRACT_TEST_CONCURRENCY || "4",
  10,
);
const concurrency = Number.isFinite(requestedConcurrency)
  ? Math.max(1, Math.min(requestedConcurrency, 8))
  : 4;

console.log(
  `[contracts] Running ${testFiles.length} files with concurrency ${concurrency}.`,
);

const child = spawn(
  process.execPath,
  [
    "--test",
    "--experimental-strip-types",
    `--test-concurrency=${concurrency}`,
    ...relativeTestFiles,
  ],
  {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);

child.once("error", (error) => {
  console.error("[contracts] Unable to start the Node test runner.", error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`[contracts] Test runner stopped by signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
