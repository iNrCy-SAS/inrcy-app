import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { INR_ASSISTANT_REFRESH_EVENT, assistantRefreshTopics, parseInrAssistantRefresh, subscribeInrAssistantRefresh } from "../../lib/inrAssistantRefresh.ts";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const emit = (target: EventTarget, accountId = "a", topics = ["media"]) => target.dispatchEvent(new CustomEvent(INR_ASSISTANT_REFRESH_EVENT, { detail: { accountId, turnId: "turn", topics } }));
test("refresh projects only real effects and never previews, reads, tokens, pending or uncertain actions", () => {
  const values = assistantRefreshTopics([
    { tool: "applyMediaDeletion", ok: true, status: "deleted" }, { tool: "updateToolSettings", ok: true, status: "saved" }, { tool: "managePublicationIdeas", ok: true, status: "updated" },
    ...["unknown", "partial", "preview_ready", "saved_unconfirmed", "processing", "queued"].map(status => ({ tool: "updateBusinessDna", ok: true, status })),
    { tool: "readGoogleBusinessProfile", ok: true, status: "read" }, { tool: "sendStatsReport", ok: false, status: "sent" },
  ]);
  assert.deepEqual(values, ["media", "settings", "channels", "agents"]);
  assert.deepEqual(parseInrAssistantRefresh({ accountId: "a", turnId: "t", topics: ["media"], approvalToken: "SECRET" }), { accountId: "a", turnId: "t", topics: ["media"] });
  for (const topics of [[], ["arbitrary"], ["media", "media", "media", "media", "media", "media", "media"]]) assert.equal(parseInrAssistantRefresh({ accountId: "a", turnId: "t", topics }), null);
});
test("scoped refresh waits for editing to finish and coalesces repeated events", async () => {
  const target = new EventTarget(); let blocked = true, calls = 0;
  const subscription = subscribeInrAssistantRefresh({ target, topics: ["media"], getAccountId: () => "a", isBlocked: () => blocked, refresh: async context => { assert.equal(context.canApply(), true); calls++; return true; } });
  emit(target, "other"); emit(target, "a", ["settings"]); emit(target); emit(target); await tick(); assert.equal(calls, 0);
  blocked = false; await subscription.flush(); assert.equal(calls, 1);
  subscription.dispose(); emit(target); await tick(); assert.equal(calls, 1);
});
test("an async read cannot replace a draft started during fetch, and account changes discard old data", async () => {
  for (const change of ["draft", "account", "unmount"]) {
    const target = new EventTarget(); let account = "a", blocked = false, applied = false; let resume!: () => void;
    const pending = new Promise<void>(resolve => { resume = resolve; });
    const subscription = subscribeInrAssistantRefresh({ target, topics: ["media"], getAccountId: () => account, isBlocked: () => blocked, refresh: async context => { await pending; applied = context.canApply(); return applied; } });
    emit(target); if (change === "draft") blocked = true; if (change === "account") account = "b"; if (change === "unmount") subscription.dispose(); resume(); await tick(); assert.equal(applied, false, change); subscription.dispose();
  }
});
test("a save or selection change during a slow request starts one fresh read after discarding its stale response", async () => {
  const target = new EventTarget(); let revision = 0, calls = 0; const applied: number[] = []; let resume!: () => void;
  const pending = new Promise<void>(resolve => { resume = resolve; });
  const subscription = subscribeInrAssistantRefresh({ target, topics: ["channels"], getAccountId: () => "a", getRevision: () => revision, isBlocked: () => false, refresh: async context => { const call = ++calls; if (call === 1) await pending; if (!context.canApply()) return false; applied.push(call); return true; } });
  emit(target, "a", ["channels"]); revision++; resume(); await tick(); assert.equal(calls, 2); assert.deepEqual(applied, [2]); subscription.dispose();
});
test("failed native reads retain existing view without retry loops", async () => {
  const target = new EventTarget(); let calls = 0;
  const subscription = subscribeInrAssistantRefresh({ target, topics: ["media"], getAccountId: () => "a", isBlocked: () => false, refresh: async () => { calls++; throw new Error("offline"); } });
  emit(target); await tick(); assert.equal(calls, 1); await subscription.flush(); assert.equal(calls, 2); subscription.dispose();
});
test("native subscribers guard drafts and late data instead of reloading the page", () => {
  for (const file of ["app/dashboard/mediatheque/MediaLibraryClient.tsx", "app/dashboard/agent/AgentClient.tsx", "app/dashboard/DashboardClient.tsx", "app/dashboard/stats/StatsClient.tsx", "app/dashboard/settings/_components/GeneralPreferencesContent.tsx", "app/dashboard/settings/_components/NativeChannelSettingsContent.tsx", "app/dashboard/_components/GoogleBusinessProfileEditor.tsx"]) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); assert.match(source, /useInrAssistantRefresh/); assert.match(source, /blocked:/); assert.match(source, /canApply/);
  }
});
