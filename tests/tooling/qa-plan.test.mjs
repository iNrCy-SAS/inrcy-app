import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createQaExecutionPlan, executeQaPlan, npmScriptArguments } from "../../scripts/qa-plan.mjs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const plans = JSON.parse(readFileSync(new URL("../../scripts/qa-plans.json", import.meta.url), "utf8"));

test("npm prebuild requires complete Basic coverage before code-index verification and cleanup", () => {
  assert.equal(typeof pkg.scripts.prebuild, "string");
  assert.deepEqual(pkg.scripts.prebuild.split("&&").map(command => command.trim()), [
    "node scripts/assistant-basic-coverage.mjs",
    "node scripts/build-assistant-code-index.mjs --check",
    "node scripts/prebuild-clean.mjs",
  ], "The mandatory coverage check must fail the build before any index or cleanup command; no report-only mode or ignored failure is permitted");
  assert.equal(pkg.scripts.build, "next build", "npm run build retains its mandatory prebuild lifecycle");
});

test("the full publication certification keeps all declared suites once and runs global checks last", () => {
  const expected = [];
  const collect = (name) => plans[name] ? plans[name].forEach(collect) : expected.push(name);
  collect("certify:publication-system");
  const result = createQaExecutionPlan("certify:publication-system", pkg.scripts, plans);
  assert.equal(expected.filter((name) => name === "typecheck").length, 9);
  assert.deepEqual(new Set(result), new Set(expected));
  assert.equal(result.length, new Set(result).size);
  assert.deepEqual(result.slice(-3), ["typecheck", "lint", "build"]);
  for (const name of Object.keys(plans)) {
    assert.equal(pkg.scripts[name], `node scripts/run-qa-plan.mjs ${name}`);
    assert.ok(createQaExecutionPlan(name, pkg.scripts, plans).length);
  }
});

test("QA rejects broken plans, cycles and undeclared suites before execution", () => {
  assert.throws(() => createQaExecutionPlan("absent", {}, {}), /Unknown QA plan/);
  assert.throws(() => createQaExecutionPlan("root", { root: "" }, { root: ["missing"] }), /Unknown npm script/);
  assert.throws(() => createQaExecutionPlan("root", { root: "", nested: "" }, { root: ["nested"], nested: ["root"] }), /Cyclic/);
});

test("execution preserves order, stops after a failure and invokes npm so pre/post hooks survive", async () => {
  const calls = [];
  const exitCode = await executeQaPlan(["audit", "test", "typecheck", "build"], async (name) => {
    calls.push(name);
    return name === "test" ? 7 : 0;
  });
  assert.equal(exitCode, 7);
  assert.deepEqual(calls, ["audit", "test"]);
  assert.deepEqual(npmScriptArguments("/npm/bin/npm-cli.js", "build"), ["/npm/bin/npm-cli.js", "run", "build"]);
  assert.throws(() => npmScriptArguments(null, "build"), /lifecycle hooks/);
  assert.throws(() => npmScriptArguments("npm-cli.js", "build && arbitrary"), /lifecycle hooks/);
});
