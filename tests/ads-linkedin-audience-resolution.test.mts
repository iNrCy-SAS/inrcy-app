import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { addLinkedInAudienceTarget, uniqueLinkedInAudienceMatch, type LinkedInAudienceSuggestion } from "../lib/adsLinkedInAudienceSuggestions.ts";
import type { LinkedInDeliverySettings } from "../lib/adsLinkedInCampaignSettings.ts";

const source = ts.createSourceFile("LinkedInAdsAudience.tsx", readFileSync(new URL("../app/dashboard/ads/LinkedInAdsAudience.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect: ts.Expression | undefined;
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("const revision = ++suggestionRequest.current")) effect = node.arguments[0];
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(effect);
const compiled = ts.transpileModule(`const run = ${effect.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function actualEffect(scope: Record<string, unknown>): () => (() => void) | undefined {
  return new Function(...Object.keys(scope), `${compiled}\nreturn run;`)(...Object.values(scope));
}

test("an empty IA suggestion list clears the previous campaign's proposals and pending state", () => {
  const proposals: unknown[] = [], counts: number[] = [];
  const completedSuggestions = { current: "previous-campaign" };
  actualEffect({
    active: false, accountId: "123", suggestions: [], completedSuggestions,
    setProposals: (value: unknown) => proposals.push(value),
    latest: { current: { onPendingChange: (value: number) => counts.push(value) } },
  })();
  assert.deepEqual(proposals, [[]]);
  assert.deepEqual(counts, [0]);
  assert.equal(completedSuggestions.current, "");
});

test("all schema-bounded IA terms resolve, including proposals beyond the former twelve-term cutoff", async () => {
  const suggestions: LinkedInAudienceSuggestion[] = [
    { facet: "titles", terms: Array.from({ length: 8 }, (_, i) => `Poste ${i}`) },
    { facet: "skills", terms: Array.from({ length: 8 }, (_, i) => `Compétence ${i}`) },
  ];
  const counts: number[] = [];
  let selected: LinkedInDeliverySettings["professionalTargeting"] = { include: [], exclude: [] };
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const cleanup = actualEffect({
    active: true, accountId: "123", suggestions, suggestionKey: JSON.stringify(suggestions),
    completedSuggestions: { current: "" }, suggestionRequest: { current: 0 }, AbortController,
    LIST_FACETS: new Set(["seniorities", "companySizes", "functions"]),
    uniqueLinkedInAudienceMatch, addLinkedInAudienceTarget,
    setProposals: () => {},
    latest: { current: { targeting: selected, onChange: (value: typeof selected) => { selected = value; }, onPendingChange: (value: number) => { counts.push(value); if (value === 0) finish(); } } },
    lookup: async (facet: string, term: string) => [{ facet, name: term, urn: `urn:li:${facet === "titles" ? "title" : "skill"}:${term.match(/\d+/)![0]}` }],
  })();
  await finished;
  assert.equal(selected.include.length, 16);
  assert.deepEqual(counts, [16, 0]);
  assert.equal(selected.include.at(-1)?.name, "Compétence 7");
  cleanup?.();
});
