import assert from "node:assert/strict";
import test from "node:test";
import { getInrAssistantClientScreen, parseInrAssistantClientContext } from "../../lib/inrAssistantClientContext.ts";

test("assistant screen hints use reviewed tool names and strip every non-navigation field", () => {
  const screen = getInrAssistantClientScreen("/dashboard", new URLSearchParams("action=publish&channel=tiktok&step=media&access_token=secret&accountId=other&message=private"));
  assert.deepEqual(screen, { pathname: "/dashboard", tool: "Booster", action: "publish", channel: "tiktok", step: "media" });
  const parsed = parseInrAssistantClientContext({ source: "trusted_server", accountId: "other", edition: "premium", authorization: "secret", screen: { ...screen, tool: "Admin", url: "https://private.example", token: "secret" } });
  assert.deepEqual(parsed, { source: "untrusted_client", screen });
  assert.equal(JSON.stringify(parsed).length < 800, true);
  assert.deepEqual(getInrAssistantClientScreen("/dashboard", new URLSearchParams("help=1")), { pathname: "/dashboard", tool: "Aide iNrCy", action: "help" });
  for (const pathname of ["/dashboard/admin", "/dashboard/../../admin", "https://app.inrcy.com/dashboard", "/dashboard?token=secret", "/diagnostic"]) assert.equal(parseInrAssistantClientContext({ screen: { pathname } }), null);
  assert.deepEqual(parseInrAssistantClientContext({ screen: { pathname: "/dashboard/stats", action: "delete_everything", channel: "secret", step: "private" } })?.screen, { pathname: "/dashboard/stats", tool: "iNr’Stats" });
});

test("visible assistant errors contain a recent reference and code, never arbitrary messages or stacks", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const visibleError = { code: "assistant_unavailable", requestId: "dd122b0a-27a7-4a37-8cd3-3b97ab4c2f11", occurredAt: new Date(now - 1000).toISOString() };
  assert.deepEqual(parseInrAssistantClientContext({ visibleError: { ...visibleError, message: "private", stack: "secret", actorId: "other" } }, now), { source: "untrusted_client", visibleError });
  assert.equal(parseInrAssistantClientContext({ visibleError: { ...visibleError, occurredAt: new Date(now - 300001).toISOString() } }, now), null);
  assert.equal(parseInrAssistantClientContext({ visibleError: { ...visibleError, occurredAt: new Date(now + 5001).toISOString() } }, now), null);
  assert.equal(parseInrAssistantClientContext({ visibleError: { code: "Bearer secret", requestId: "https://secret.example", occurredAt: visibleError.occurredAt } }, now), null);
});

test("library multi-selection is exact, bounded, route-specific and never truncated", () => {
  const ids = Array.from({ length: 25 }, (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`);
  const screen = { pathname: "/dashboard/mediatheque", selectedMediaIds: ids };
  const context = parseInrAssistantClientContext({ screen });
  assert.deepEqual(context?.screen?.selectedMediaIds, ids);
  assert.ok(JSON.stringify(context).length <= 2400);
  assert.equal(parseInrAssistantClientContext({ screen: { ...screen, pathname: "/dashboard/ads" } })?.screen?.selectedMediaIds, undefined);
  for (const selectedMediaIds of [[...ids, ids[0]], ["invalid"], [ids[0], ids[0]]]) assert.equal(parseInrAssistantClientContext({ screen: { ...screen, selectedMediaIds } })?.screen?.selectedMediaIds, undefined);
  const overflow = parseInrAssistantClientContext({ screen: { ...screen, selectionOverflow: true } });
  assert.equal(overflow?.screen?.selectionOverflow, true);
  assert.equal(overflow?.screen?.selectedMediaIds, undefined);
});

test("native edit capabilities retain their exact form revision and cannot cross routes or entity types", () => {
  const screen = { pathname: "/dashboard/ads", channel: "meta", step: "creative", selection: { kind: "campaign", id: "draft_local" }, revision: "draft_4", pendingChanges: true, availableCommands: ["configure_ads_draft"], name: "private draft", accountId: "other" };
  const result = parseInrAssistantClientContext({ screen })?.screen;
  assert.deepEqual(result?.availableCommands, ["configure_ads_draft"]);
  assert.equal(result?.revision, "draft_4"); assert.equal(result?.pendingChanges, true); assert.equal(result?.step, "creative");
  assert.ok(!JSON.stringify(result).includes("private draft")); assert.ok(!JSON.stringify(result).includes("other"));
  assert.equal(parseInrAssistantClientContext({ screen: { ...screen, pathname: "/dashboard/crm" } })?.screen?.availableCommands, undefined);
  assert.equal(parseInrAssistantClientContext({ screen: { ...screen, selection: { kind: "media", id: "media_local" } } })?.screen?.availableCommands, undefined);
});
