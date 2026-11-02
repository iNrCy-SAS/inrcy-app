import assert from "node:assert/strict";
import test from "node:test";
import { elements, harness } from "./dashboard-assistant-runtime-harness.mts";
import { inrAssistantUiActionsFromToolResult, runInrAssistantUiActions } from "../../lib/inrAssistantUiActions.ts";
const tick = () => new Promise(resolve => setImmediate(resolve));
const id = "11111111-1111-4111-8111-111111111111";
const actions = [
  ...inrAssistantUiActionsFromToolResult("media", { ok: true, uiCommand: { command: "download_media", selection: { kind: "media", id }, mediaIds: [id], pathname: "/dashboard/mediatheque" } }),
  ...inrAssistantUiActionsFromToolResult("stats", { ok: true, uiCommand: { command: "download_stats_report", selection: { kind: "stats_report", id }, reportId: id } }),
];

test("real Session claims and reports each ordered download and removes only UI pending labels", async () => {
  const original = globalThis.fetch, events: string[] = [], view = harness();
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/ui-results")) {
      const body = JSON.parse(String(init?.body)); assert.equal(body.token, "signed-fixture");
      events.push(body.action === "claim" ? `claim:${body.actionId}` : `report:${body.result.actionId}`);
      return Response.json({ ok: true });
    }
    const body = JSON.parse(String(init?.body)); assert.equal(body.uiReceiptToken, undefined);
    return Response.json({ message: "Deux téléchargements demandés", accountId: "account-a", uiActions: actions, uiReceiptToken: "signed-fixture",
      taskProgress: { outcome: "processing", completed: ["contact créé"], remaining: ["télécharger les médias", "télécharger le bilan PDF"] } });
  };
  view.onUiActions((batch, onResult, beforeAction) => runInrAssistantUiActions(batch, { isCurrent: () => true, navigate: async () => assert.fail(),
    command: async command => { events.push(command.command); return true; }, onResult, beforeAction }));
  try {
    view.submit("Télécharge les médias et le bilan"); await tick();
    assert.deepEqual(events, ["claim:media_command", "download_media", "report:media_command", "claim:stats_command", "download_stats_report", "report:stats_command"]);
    const tree = elements(view.render());
    const progress = tree.find(node => node.props["data-testid"] === "assistant-task-progress");
    assert.equal(progress?.props["data-outcome"], "completed");
    const content = tree.map(node => node.props.content || "").join(" ");
    assert.match(content, /2 download\(s\) handed to the browser/);
    assert.match(content, /file receipt is not verified/);
    assert.doesNotMatch(content, /downloaded successfully|files received/);
  } finally { view.cleanup(); globalThis.fetch = original; }
});

test("a replayed already reported download is displayed but never executed again", async () => {
  const original = globalThis.fetch, executed: string[] = [], view = harness();
  globalThis.fetch = async url => String(url).endsWith("/ui-results") ? Response.json({ ok: true }) : Response.json({ message: "Reprise", accountId: "account-a", uiActions: actions, uiReceiptToken: "signed-fixture",
    uiResults: [{ actionId: actions[0].id, source: "browser_reported", status: "handed_to_browser" }] });
  view.onUiActions((batch, onResult, beforeAction) => runInrAssistantUiActions(batch, { isCurrent: () => true, navigate: async () => assert.fail(), command: async value => { executed.push(value.command); return true; }, onResult, beforeAction }));
  try { view.submit("Reprends"); await tick(); assert.deepEqual(executed, ["download_stats_report"]); }
  finally { view.cleanup(); globalThis.fetch = original; }
});

test("missing signed grant or a refused claim never dispatches an ordered UI action", async () => {
  const original = globalThis.fetch;
  try {
    for (const token of [undefined, "signed-fixture"]) {
      const view = harness(); let executed = 0;
      globalThis.fetch = async url => String(url).endsWith("/ui-results") ? Response.json({ ok: false }, { status: 409 }) : Response.json({ message: "Téléchargement demandé", accountId: "account-a", uiActions: actions, uiReceiptToken: token });
      view.onUiActions((batch, onResult, beforeAction) => runInrAssistantUiActions(batch, { isCurrent: () => true, navigate: async () => assert.fail(), command: async () => { executed++; return true; }, onResult, beforeAction }));
      try { view.submit("Télécharge"); await tick(); assert.equal(executed, 0); }
      finally { view.cleanup(); }
    }
  } finally { globalThis.fetch = original; }
});
