import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const source = readFileSync(
  resolve(ROOT, "app/dashboard/settings/_components/AiMemoryContent.tsx"),
  "utf8",
);

test("channel analysis merges its result into the latest edited draft", () => {
  assert.match(source, /const memoryRef = useRef<AiMemory>\(EMPTY_AI_MEMORY\)/);
  assert.match(
    source,
    /const businessKnowledgeRef = useRef<AiBusinessKnowledge>\(EMPTY_AI_BUSINESS_KNOWLEDGE\)/,
  );

  const mergeStart = source.indexOf("const merged = mergeAiBusinessDnaAnalysis(");
  const summaryStart = source.indexOf("setAnalysisSummary({", mergeStart);
  assert.notEqual(mergeStart, -1);
  assert.notEqual(summaryStart, -1);
  const completionMerge = source.slice(mergeStart, summaryStart);

  assert.match(
    completionMerge,
    /mergeAiBusinessDnaAnalysis\(\s*memoryRef\.current,\s*businessKnowledgeRef\.current,/,
  );
  assert.doesNotMatch(
    completionMerge,
    /mergeAiBusinessDnaAnalysis\(\s*memory,\s*businessKnowledge,/,
  );
  assert.match(completionMerge, /updateMemory\(merged\.memory\)/);
  assert.match(completionMerge, /updateBusinessKnowledge\(merged\.businessKnowledge\)/);
});

test("every draft mutation updates its live ref before React state", () => {
  const memoryUpdaterStart = source.indexOf("const updateMemory = useCallback");
  const businessUpdaterStart = source.indexOf("const updateBusinessKnowledge = useCallback");
  const signatureStart = source.indexOf("const signature = useMemo", businessUpdaterStart);
  assert.notEqual(memoryUpdaterStart, -1);
  assert.notEqual(businessUpdaterStart, -1);
  assert.notEqual(signatureStart, -1);

  const memoryUpdater = source.slice(memoryUpdaterStart, businessUpdaterStart);
  const businessUpdater = source.slice(businessUpdaterStart, signatureStart);

  assert.match(memoryUpdater, /update\(memoryRef\.current\)/);
  assert.ok(memoryUpdater.indexOf("memoryRef.current = nextMemory") < memoryUpdater.indexOf("setMemory(nextMemory)"));
  assert.match(businessUpdater, /update\(businessKnowledgeRef\.current\)/);
  assert.ok(
    businessUpdater.indexOf("businessKnowledgeRef.current = nextBusinessKnowledge")
      < businessUpdater.indexOf("setBusinessKnowledge(nextBusinessKnowledge)"),
  );

  assert.equal((source.match(/\bsetMemory\(/g) || []).length, 1);
  assert.equal((source.match(/\bsetBusinessKnowledge\(/g) || []).length, 1);
  assert.match(source, /const currentCustomerTypes = businessKnowledgeRef\.current\.customerTypes/);
});
