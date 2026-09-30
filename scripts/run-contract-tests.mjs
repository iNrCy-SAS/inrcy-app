import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { contractTestBatches } from "./contract-test-batches.mjs";

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

const batches = contractTestBatches(relativeTestFiles);
let exitCode = 0;
for (const [index, batch] of batches.entries()) {
  if (batches.length > 1) console.log(`[contracts] Batch ${index + 1}/${batches.length}: ${batch.length} files.`);
  const batchExitCode = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--test", "--experimental-strip-types", `--test-concurrency=${concurrency}`, ...batch],
      { cwd: repositoryRoot, env: process.env, stdio: "inherit", windowsHide: true },
    );
    child.once("error", (error) => {
      console.error("[contracts] Unable to start the Node test runner.", error);
      resolve(1);
    });
    child.once("exit", (code, signal) => {
      if (signal) console.error(`[contracts] Test runner stopped by signal ${signal}.`);
      resolve(signal ? 1 : code ?? 1);
    });
  }).catch((error) => {
    console.error("[contracts] Unable to start the Node test runner.", error);
    return 1;
  });
  if (batchExitCode !== 0) exitCode = 1;
}
process.exitCode = exitCode;
