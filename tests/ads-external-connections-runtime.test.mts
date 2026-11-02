import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { emptyAdsConnectionSnapshots } from "../lib/adsConnectionSnapshot.ts";
import * as http from "../app/dashboard/ads/adsClientHttp.ts";
import type useAdsExternalConnections from "../app/dashboard/ads/useAdsExternalConnections.ts";

type State = ReturnType<typeof useAdsExternalConnections>;
function harness() {
  const initialConnections = emptyAdsConnectionSnapshots();
  initialConnections.linkedin = { status: "connected", accountId: "linkedin-saved", accountLabel: "Saved", pageId: "" };
  let snapshots = initialConnections;
  const slots: Array<{ value: unknown; deps?: unknown[] }> = [];
  let cursor = 0;
  const calls: Array<{ url: string; init: RequestInit; reply: (body: unknown, status?: number) => void }> = [];
  const react = {
    useState(initial: unknown) { const slot = slots[cursor++] ||= { value: typeof initial === "function" ? initial() : initial }; return [slot.value, (value: unknown) => { slot.value = typeof value === "function" ? value(slot.value) : value; }]; },
    useRef(initial: unknown) { return (slots[cursor++] ||= { value: { current: initial } }).value; },
    useCallback(value: unknown, deps: unknown[]) { const slot = slots[cursor++] ||= { value, deps }; if (!slot.deps || slot.deps.length !== deps.length || deps.some((item, index) => item !== slot.deps![index])) { slot.value = value; slot.deps = deps; } return slot.value; },
  };
  const record = { exports: {} as { default: typeof useAdsExternalConnections } };
  const output = ts.transpileModule(readFileSync(new URL("../app/dashboard/ads/useAdsExternalConnections.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("module", "exports", "require", "fetch", output)(record, record.exports, (name: string) => {
    if (name === "react") return react;
    if (name === "./adsClientHttp") return http;
    throw new Error(`Unexpected connection dependency: ${name}`);
  }, (url: string, init: RequestInit) => new Promise<Response>((resolve) => calls.push({ url, init, reply: (body, status = 200) => resolve(Response.json(body, { status })) })));
  const setConnectionSnapshots = (update: Parameters<typeof record.exports.default>[0]["setConnectionSnapshots"] extends (update: infer T) => void ? T : never) => { snapshots = typeof update === "function" ? update(snapshots) : update; };
  const render = (): State => { cursor = 0; return record.exports.default({ initialChannel: "linkedin", initialConnections, setConnectionSnapshots }); };
  return { calls, render, snapshots: () => snapshots };
}

test("the complete connection hook preserves durable identity while only the newest status owns authorization", async () => {
  const h = harness();
  assert.equal(h.render().externalStatuses.linkedin.connected, true);
  assert.equal(h.render().externalStatuses.linkedin.publicationEnabled, false);
  const first = h.render().refreshExternalStatus("linkedin");
  const second = h.render().refreshExternalStatus("linkedin");
  h.calls[1].reply({ connected: true, status: "connected", selectedAccountId: "new", publicationEnabled: true });
  await second;
  h.calls[0].reply({ connected: false, status: "disconnected" });
  await first;
  assert.equal(h.render().externalStatuses.linkedin.selectedAccountId, "new");
  assert.equal(h.render().externalStatuses.linkedin.publicationEnabled, true);
  assert.equal(h.snapshots().linkedin.accountId, "new");
  const transient = h.render().refreshExternalStatus("linkedin", { silent: true });
  assert.equal(h.render().externalStatuses.linkedin.publicationEnabled, false);
  h.calls[2].reply({ error: "Temporary" }, 503); await transient;
  assert.equal(h.render().externalStatuses.linkedin.connected, true);
  assert.equal(h.render().externalStatuses.linkedin.load, "error");
  const revoked = h.render().refreshExternalStatus("linkedin");
  h.calls[3].reply({ connected: false, status: "needs_reconnect" }, 403); await revoked;
  assert.equal(h.render().externalStatuses.linkedin.connected, false);
  assert.equal(h.snapshots().linkedin.status, "needs_update");
});

test("account discovery ignores responses from an abandoned card and reuses only its own cache", async () => {
  const h = harness();
  const abandoned = h.render().loadExternalAccounts("linkedin", "linkedin-saved");
  h.render().cancelExternalAccountsLoad();
  const active = h.render().loadExternalAccounts("pinterest", "pin-saved");
  h.calls[1].reply({ accounts: [{ id: "pin", name: "Pinterest" }], selectedAccountId: "pin" }); await active;
  h.calls[0].reply({ accounts: [{ id: "old", name: "LinkedIn" }], selectedAccountId: "old" }); await abandoned;
  assert.deepEqual(h.render().externalAccounts.map(({ id }) => id), ["pin"]);
  assert.equal(h.render().externalAccountsLoaded("linkedin"), false);
  assert.equal(h.render().externalAccountsLoaded("pinterest"), true);
  await h.render().loadExternalAccounts("pinterest", "pin-saved");
  assert.equal(h.calls.length, 2);
  h.render().hydrateExternalChannel("pinterest", true);
  assert.deepEqual(h.render().externalAccounts, []);
  h.render().hydrateExternalChannel("pinterest", false);
  assert.equal(h.render().externalAccountChoice, "pin");
});

test("selecting and reloading accounts cannot grant LinkedIn publication and retains the selected eligible account", async () => {
  const h = harness();
  h.render().selectExternalAccount("linkedin", "chosen");
  const task = h.render().loadExternalAccounts("linkedin", "saved", true);
  h.calls[0].reply({ accounts: [{ id: "chosen", name: "Choice" }, { id: "other", name: "Other" }], selectedAccountId: "other", publicationEnabled: true, selectedAccountCanManage: true }); await task;
  assert.equal(h.render().externalAccountChoice, "chosen");
  assert.equal(h.render().externalStatuses.linkedin.publicationEnabled, false);
  assert.equal(h.render().externalStatuses.linkedin.selectedAccountCanManage, true);
  h.render().clearExternalAccountsCache("linkedin");
  assert.equal(h.render().externalAccountsLoaded("linkedin"), false);
});

test("association posts the selected account then rereads status, while failed disconnect retains the cache", async () => {
  const h = harness();
  h.render().selectExternalAccount("linkedin", "chosen");
  const associate = h.render().associateExternalAccount("linkedin");
  assert.equal(h.calls[0].url, "/api/ads/linkedin/accounts");
  assert.equal(h.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(h.calls[0].init.body)), { accountId: "chosen" });
  h.calls[0].reply({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls[1].url, "/api/ads/linkedin/status");
  h.calls[1].reply({ connected: true, status: "connected", selectedAccountId: "chosen" }); await associate;
  assert.equal(h.render().externalAction, null);
  const disconnect = h.render().disconnectExternalChannel("linkedin");
  h.calls[2].reply({ error: "Try again" }, 503); await disconnect;
  assert.equal(h.render().externalAccountChoice, "chosen");
  assert.equal(h.render().externalStatuses.linkedin.connected, true);
  assert.equal(h.render().externalError, "Try again");
});
