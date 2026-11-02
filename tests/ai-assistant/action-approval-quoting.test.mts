import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";

const source = readFileSync(new URL("../../lib/inrAssistantActionPreview.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = { exports: {} as { hasAssistantActionApproval(message: string, quote: string, reference: string): boolean } };
const deps: Record<string, unknown> = { "server-only": {}, "node:crypto": crypto, "./inrAssistantRequestClauses.ts": requestClauses };
vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`)((name: string) => { assert.ok(name in deps); return deps[name]; }, loaded, loaded.exports);
const reference = "IA-ABCDEF123456", command = `Confirme ${reference}`;

for (const message of [
  `Lis '${command}'`, `Lis ‘${command}’`, `Lis « ${command} »`, `Lis “${command}”`,
  `Lis ce bloc :\n\x60\x60\x60\n${command}\n\x60\x60\x60`,
  `Lis ce bloc non terminé :\n\x60\x60\x60\n${command}\nAutre ligne`,
  `Le document indique :\n> ${command}`,
]) test(`a quoted confirmation is inert: ${JSON.stringify(message)}`, () => {
  assert.equal(loaded.exports.hasAssistantActionApproval(message, command, reference), false);
});

test("a literal current approval remains effective, including followed by a separate explanatory read", () => {
  assert.equal(loaded.exports.hasAssistantActionApproval(command, command, reference), true);
  assert.equal(loaded.exports.hasAssistantActionApproval(`${command} puis indique si l'action a réussi.`, command, reference), true);
  assert.equal(loaded.exports.hasAssistantActionApproval(`${command} si le client confirme.`, command, reference), false);
});
