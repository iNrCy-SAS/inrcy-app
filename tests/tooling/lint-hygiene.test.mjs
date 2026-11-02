import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";
import { compareHygieneWarnings } from "../../scripts/lint-hygiene-policy.mjs";

const warning = { file: "app/example.tsx", rule: "react-hooks/exhaustive-deps", message: "Missing dependency 'user'", severity: 1, line: 4, column: 2 };
const baseline = { entries: [{ ...warning, count: 1 }] };

test("moving a known warning in the same file does not spend a new allowance", () => {
  const result = compareHygieneWarnings([{ ...warning, line: 94 }], baseline);
  assert.equal(result.knownWarnings, 1);
  assert.deepEqual(result.newWarnings, []);
});

test("moving a dependent hook keeps its embedded line number out of warning identity", () => {
  const oldWarning = { ...warning, message: "The 'save' function changes useEffect (at line 6907) on every render." };
  const baseline = { entries: [{ ...oldWarning, count: 1 }] };
  assert.equal(compareHygieneWarnings([{ ...oldWarning, message: oldWarning.message.replace("6907", "6015") }], baseline).knownWarnings, 1);
  assert.equal(compareHygieneWarnings([{ ...oldWarning, message: oldWarning.message.replace("'save'", "'load'") }], baseline).newWarnings.length, 1);
});

test("new files, messages and occurrences are blocked even if the global warning count shrinks", () => {
  for (const messages of [[{ ...warning, file: "app/new.tsx" }], [{ ...warning, message: "New warning" }], [warning, { ...warning, line: 50 }]]) {
    assert.equal(compareHygieneWarnings(messages, baseline).newWarnings.length, 1);
  }
  assert.deepEqual(compareHygieneWarnings([], baseline), { knownWarnings: 0, newWarnings: [], errors: [] });
});

test("errors remain blocking and invalid or repeated allowance identities are rejected", () => {
  assert.equal(compareHygieneWarnings([{ ...warning, severity: 2 }], baseline).errors.length, 1);
  assert.throws(() => compareHygieneWarnings([], { entries: [{ ...warning, count: 0 }] }), /Invalid/);
  assert.throws(() => compareHygieneWarnings([], { entries: [baseline.entries[0], baseline.entries[0]] }), /Duplicate/);
});

test("standard lint rejects unused source bindings without a separate audit command", async () => {
  const eslint = new ESLint();
  for (const filePath of ["app/api/fixture/route.ts", "app/dashboard/Fixture.tsx", "lib/fixture.ts", "hooks/fixture.ts", "i18n/fixture.ts"]) {
    const [result] = await eslint.lintText('const unusedBinding = 1; export const retained = 2;', { filePath });
    assert.ok(result.messages.some(message => message.ruleId === "@typescript-eslint/no-unused-vars" && message.severity === 2), filePath);
  }
});

test("standard lint rejects a missing effect dependency in dashboard code", async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText('import {useEffect} from "react"; export default function Fixture({value}: {value: string}) { useEffect(() => { console.log(value); }, []); return null; }', { filePath: "app/dashboard/Fixture.tsx" });
  assert.ok(result.messages.some(message => message.ruleId === "react-hooks/exhaustive-deps" && message.severity === 2));
});
