import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("iNrADN provides a confirmed reset at the bottom of every tab", () => {
  const ui = read("app/dashboard/settings/_components/AiMemoryContent.tsx");

  assert.match(ui, /data-ai-memory-tab-reset/);
  assert.match(ui, /justifyContent: "flex-end"/);
  assert.match(ui, /const resetCurrentTab = async/);
  assert.match(ui, /Cette action efface uniquement les informations de cet onglet/);
  assert.match(ui, /body: JSON\.stringify\(\{ tab: tabToReset, preserveVocabulary: hideNavigation && tabToReset === "identity" \}\)/);
  assert.match(ui, /activeTab !== "analysis"/);
});

test("the analysis tab keeps only the confirmed global iNrADN reset below the monthly quota", () => {
  const ui = read("app/dashboard/settings/_components/AiMemoryContent.tsx");
  const analysis = read("app/dashboard/settings/_components/BusinessDnaAnalysisWorkspace.tsx");
  const footer = analysis.slice(analysis.indexOf('<footer'), analysis.indexOf('</footer>'));
  assert.match(ui, /onReset=\{\(\) => void resetCurrentTab\("all"\)\}/);
  assert.equal((footer.match(/onClick=\{onReset\}/g) || []).length, 1);
  assert.match(footer, /analysisQuota[\s\S]*?className=\{styles\.actions\}[\s\S]*?className=\{styles\.footerMeta\}[\s\S]*?t\("analysisResetButton"\)/);
  assert.doesNotMatch(analysis, /Réinitialiser l’analyse|analysisPrivacyStyle/);
  assert.match(ui, /toutes les informations iNr’ADN, y compris les documents importés et leurs fichiers/);
});

test("the reset API is authenticated, account-scoped, and restricts document deletion to owned paths", () => {
  const route = read("app/api/ai-memory/reset/route.ts");

  assert.match(route, /requireUser\(\)/);
  assert.match(route, /RESETTABLE_TABS/);
  assert.match(route, /\.eq\("account_id", activeUserId\)/);
  assert.match(route, /\.upsert\([\s\S]*account_id: activeUserId[\s\S]*onConflict: "account_id"/);
  assert.match(route, /\.eq\("user_id", activeUserId\)/);
  assert.match(route, /ownedDocumentPath\(accountId, document\.path\)/);
  assert.match(route, /inrcy_remove_ai_memory_reference_document/);
  assert.match(route, /storage\.from\(bucket\)\.remove\(\[path\]\)/);
  assert.match(route, /tab === "documents" \|\| tab === "all"/);
  assert.match(route, /memory = EMPTY_AI_MEMORY/);
  assert.match(route, /invalidateBoosterGenerationContext\(activeUserId, "professional"\)/);
});
