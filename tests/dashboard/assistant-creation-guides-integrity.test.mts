import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { INR_ASSISTANT_CREATION_GUIDES } from "../../lib/inrAssistantGuidesCreation.ts";

const root = new URL("../../", import.meta.url);

test("creation knowledge has compact sourced topics and navigable application links", () => {
  const ids = new Set<string>();
  for (const guide of INR_ASSISTANT_CREATION_GUIDES) {
    assert.ok(!ids.has(guide.id), `Duplicate topic ${guide.id}`);
    ids.add(guide.id);
    assert.ok(guide.content.length <= 2500, `${guide.id} must fit a bounded tool response`);
    assert.ok(guide.keywords.length > 0);
    assert.ok(guide.sourceFiles.length > 0);
    for (const source of guide.sourceFiles) {
      assert.ok(existsSync(new URL(source, root)), `${guide.id} has missing evidence: ${source}`);
    }
    for (const [, href] of guide.content.matchAll(/\]\((\/dashboard[^)]*)\)/g)) {
      const url = new URL(href!, "https://app.inrcy.local");
      assert.ok(existsSync(new URL(`app${url.pathname}/page.tsx`, root)), `${guide.id} links a missing page: ${href}`);
    }
  }
  for (const required of ["booster", "studio-create", "studio-edit", "media-library", "ads", "emailing", "agents"]) {
    assert.ok(ids.has(required), `Missing creation topic ${required}`);
  }
});

test("campaign deep links use action values accepted by the current page", () => {
  const guide = INR_ASSISTANT_CREATION_GUIDES.find((item) => item.id === "emailing")!;
  for (const kind of ["propulser", "fideliser"]) {
    const source = readFileSync(new URL(`app/dashboard/${kind}/page.tsx`, root), "utf8");
    const expression = new RegExp(`/dashboard/${kind}\\?action=([a-z]+)`, "g");
    const actions = [...guide.content.matchAll(expression)].map((match) => match[1]!);
    assert.ok(actions.length > 0);
    for (const action of actions) assert.ok(source.includes(`normalized === "${action}"`), `Unsupported ${kind} action ${action}`);
  }
});
