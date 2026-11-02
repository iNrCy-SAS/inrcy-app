import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { INR_ASSISTANT_ACTION_COVERAGE, INR_ASSISTANT_COVERAGE_FAMILIES, discoverInrAssistantActionCoverage } from "../../lib/inrAssistantActionCoverage.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
test("each implemented capability names real tool definitions and every native route exists", () => {
  const tools = new Set(["readAppGuide", "proposeHumanSupport", "prepareStudioPrompt"]);
  for (const file of readdirSync(path.join(root, "lib")).filter(file => /^inrAssistant.*Tools\.ts$/.test(file))) {
    const ast = ts.createSourceFile(file, readFileSync(path.join(root, "lib", file), "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "tool") tools.add(node.name.getText(ast).replace(/["']/g, ""));
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  const ids = new Set<string>();
  for (const entry of INR_ASSISTANT_ACTION_COVERAGE) {
    assert.ok(!ids.has(entry.id), entry.id); ids.add(entry.id);
    assert.ok(entry.limits.trim(), entry.id);
    assert.equal(entry.family, INR_ASSISTANT_COVERAGE_FAMILIES[entry.domain]);
    if (entry.availability === "implemented") assert.ok(entry.tools.length > 0, entry.id);
    if (entry.availability === "not_in_app") assert.equal(entry.tools.length, 0, entry.id);
    for (const name of entry.tools) assert.ok(tools.has(name), `${entry.id}: undeclared ${name}`);
    for (const route of entry.nativeRoutes) assert.ok(existsSync(path.join(root, "app", route, "route.ts")), `${entry.id}: ${route}`);
  }
});

test("discovery is bounded, stable, paginated and searchable without being a permission grant", () => {
  const first = discoverInrAssistantActionCoverage({ edition: "basic", limit: 100 });
  assert.equal(first.items.length, 12); assert.equal(first.nextOffset, 12);
  const all: string[] = []; let offset: number | null = 0;
  while (offset !== null) {
    const page = discoverInrAssistantActionCoverage({ edition: "premium", offset, limit: 7 });
    all.push(...page.items.map(item => item.id)); offset = page.nextOffset;
  }
  assert.equal(new Set(all).size, INR_ASSISTANT_ACTION_COVERAGE.length);
  assert.match(first.notice, /jamais une autorisation/);
  const crm = discoverInrAssistantActionCoverage({ domain: "crm", edition: "basic" });
  assert.ok(crm.items.every(item => item.includedInEdition === false));
  const mail = discoverInrAssistantActionCoverage({ query: "Outlook", edition: "premium" });
  assert.ok(mail.items.some(item => item.id === "mail.individual" || item.id === "mail.boxes"));
  assert.ok(mail.items.some(item => item.id === "mail.inbox" && item.availability === "not_in_app"));
  assert.deepEqual(discoverInrAssistantActionCoverage({ domain: "unknown", edition: "premium" }).items, []);
});

test("the catalogue distinguishes guides, drafts, irreversible work and unavailable inbox features", () => {
  const byId = new Map(INR_ASSISTANT_ACTION_COVERAGE.map(entry => [entry.id, entry]));
  assert.equal(byId.get("studio.prompt")?.mode, "prefill");
  assert.equal(byId.get("channels.oauth")?.availability, "native_only");
  assert.equal(byId.get("channels.oauth")?.mode, "open");
  assert.equal(byId.get("mail.individual")?.mode, "needs_pro_confirmation");
  assert.equal(byId.get("mail.inbox")?.availability, "not_in_app");
  assert.equal(byId.get("crm.merge")?.availability, "not_in_app");
  assert.equal(byId.get("publication.execute")?.mode, "execute");
  assert.equal(byId.get("mail.history")?.mode, "read");
  assert.equal(byId.get("mail.history")?.family, "workspace");
  assert.equal(byId.get("documents.finalize")?.family, "commercial");
  assert.equal(byId.get("studio.generate")?.family, "media");
  assert.match(byId.get("mail.history")!.limits, /pas les messages reçus/);
  assert.match(byId.get("studio.generate")!.limits, /IMAGE uniquement/);
});
