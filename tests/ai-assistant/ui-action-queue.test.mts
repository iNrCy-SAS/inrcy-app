import assert from "node:assert/strict";
import test from "node:test";
import { inrAssistantBusinessProgressAfterUi, inrAssistantUiActionsFromToolResult, parseInrAssistantUiActions, runInrAssistantUiActions, type InrAssistantUiAction } from "../../lib/inrAssistantUiActions.ts";
import { getInrAssistantNavigation } from "../../lib/inrAssistantUiCommands.ts";

const id = "22222222-2222-4222-8222-222222222222";
const navigation = getInrAssistantNavigation("quotes", id)!;
const command = { command: "export_document_pdf" as const, selection: { kind: "quote" as const, id } };
const actions = inrAssistantUiActionsFromToolResult("call-1", { ok: true, navigation, uiCommand: command });

test("compound document action waits for target navigation before exact export", async () => {
  let resolveMounted!: (value: boolean) => void;
  const mounted = new Promise<boolean>(resolve => { resolveMounted = resolve; });
  const seen: string[] = [];
  const execution = runInrAssistantUiActions(actions, {
    isCurrent: () => true,
    navigate: async target => { seen.push(target.documentId!); return mounted; },
    command: async value => { seen.push(`export:${value.selection.id}`); return true; },
  });
  await Promise.resolve();
  assert.deepEqual(seen, [id]);
  resolveMounted(true);
  assert.deepEqual((await execution).map(result => result.status), ["applied", "handed_to_browser"]);
  assert.deepEqual(seen, [id, `export:${id}`]);
});

test("refused dirty navigation cancels export instead of running it on previous document", async () => {
  let exported = false;
  const results = await runInrAssistantUiActions(actions, {
    isCurrent: () => true, navigate: async () => false, command: async () => { exported = true; return true; },
  });
  assert.equal(exported, false);
  assert.deepEqual(results.map(result => result.status), ["failed", "cancelled"]);
});

test("scope invalidation after navigation prevents a late document export", async () => {
  let current = true;
  const results = await runInrAssistantUiActions(actions, {
    isCurrent: () => current, navigate: async () => { current = false; return true; }, command: async () => assert.fail("stale scope executed"),
  });
  assert.deepEqual(results.map(result => result.status), ["cancelled", "cancelled"]);
});

test("multiple downloads remain separate and acknowledgement transport never replays an action", async () => {
  const batch: InrAssistantUiAction[] = [
    ...inrAssistantUiActionsFromToolResult("media", { ok: true, uiCommand: { command: "download_media", selection: { kind: "media", id }, mediaIds: [id], pathname: "/dashboard/mediatheque" } }),
    ...inrAssistantUiActionsFromToolResult("report", { ok: true, uiCommand: { command: "download_stats_report", selection: { kind: "stats_report", id }, reportId: id } }),
  ];
  const executed: string[] = [];
  const result = await runInrAssistantUiActions(batch, { isCurrent: () => true, navigate: async () => assert.fail(),
    command: async value => { executed.push(value.command); return true; }, onResult: async () => { throw new Error("network down"); } });
  assert.deepEqual(executed, ["download_media", "download_stats_report"]);
  assert.equal(result.length, 2);
  assert.ok(result.every(item => item.source === "browser_reported" && item.status === "handed_to_browser"));
});

test("protocol rejects duplicate IDs, oversized actions and substituted external navigation", () => {
  assert.deepEqual(parseInrAssistantUiActions(actions), actions);
  assert.equal(parseInrAssistantUiActions([...actions, actions[0]]), null);
  assert.equal(parseInrAssistantUiActions(Array.from({ length: 25 }, (_, i) => ({ ...actions[0], id: `action-${i}` }))), null);
  assert.equal(parseInrAssistantUiActions([{ ...actions[0], navigation: { ...navigation, href: "https://external.invalid" } }]), null);
});

test("a refused server claim stops all actions and never invokes navigation or export", async () => {
  const results = await runInrAssistantUiActions(actions, { isCurrent: () => true, beforeAction: async () => false,
    navigate: async () => assert.fail("unclaimed navigation"), command: async () => assert.fail("unclaimed command") });
  assert.deepEqual(results.map(result => result.status), ["failed", "cancelled"]);
});

test("browser projection removes handed-off UI work without inventing confirmed business results", () => {
  const batch = inrAssistantUiActionsFromToolResult("media", { ok: true, uiCommand: { command: "download_media", selection: { kind: "media", id }, mediaIds: [id], pathname: "/dashboard/mediatheque" } });
  const results = [{ actionId: batch[0].id, source: "browser_reported" as const, status: "handed_to_browser" as const }];
  assert.equal(inrAssistantBusinessProgressAfterUi({ outcome: "processing", completed: [], remaining: ["télécharger les médias"] }, batch, results), undefined);
  assert.deepEqual(inrAssistantBusinessProgressAfterUi({ outcome: "processing", completed: ["créer le contact"], remaining: ["publier", "télécharger les médias"] }, batch, results), { outcome: "processing", completed: ["créer le contact"], remaining: ["publier"] });
});
