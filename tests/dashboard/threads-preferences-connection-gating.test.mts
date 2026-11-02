import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as preferences from "../../lib/threadsPublicationPreferences.ts";

type Context = Record<string, unknown>;
function effectFrom(file: string, marker: string, context: Context) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes(marker)) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(callback, marker);
  const code = ts.transpileModule(`exports.effect = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exported = {} as { effect: () => (() => void) | undefined };
  new Function("exports", ...Object.keys(context), code)(exported, ...Object.values(context));
  return exported.effect;
}

function modalFixture(options: { state?: string; connected?: boolean; enabled?: boolean; draft?: string; snapshotAccount?: string; authoritative?: boolean; response?: Promise<Response> } = {}) {
  const state: Context = {};
  const requests: string[] = [];
  const setters = Object.fromEntries(["setThreadsPublicationPreferences", "setThreadsPreferencesLoading", "setThreadsPreferencesFailed", "setThreadsPreferencesAccountId", "setThreadsPublicationMode"].map(name => [name, (value: unknown) => { state[name] = value; }]));
  const effect = effectFrom("app/dashboard/booster/publier/PublishModal.tsx", "const loadThreadsPreferences = async", {
    ...setters, ...preferences, threadsPublicationPreferencesRef: { current: preferences.CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES },
    threadsModeTouchedRef: { current: false }, activeAccountId: "account", publicationDraftIdParam: options.draft || "",
    metaPilotEnabled: options.enabled ?? true, connectedChannelsLoadState: options.state || "ready", connected: { threads: options.connected ?? true },
    authoritativeChannelsRef: { current: options.authoritative ?? true }, connectedChannelsScopeRef: { current: options.snapshotAccount || "account" }, getActiveBrowserUserId: () => "account",
    fetch: async (url: string) => { requests.push(url); return options.response || Response.json({ preferences: { version: 1, ghostEnabled: true, defaultMode: "ghost" } }); },
  });
  return { state, requests, effect };
}

test("Booster does not request Threads settings until the account connection is known and connected", async () => {
  for (const options of [{ state: "loading" }, { state: "error" }, { connected: false }, { enabled: false }, { snapshotAccount: "previous-account" }, { authoritative: false }]) {
    const fixture = modalFixture(options); fixture.effect(); await new Promise(setImmediate);
    assert.deepEqual(fixture.requests, []);
    assert.deepEqual(fixture.state.setThreadsPublicationPreferences, preferences.CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES);
    if (options.connected === false || options.enabled === false) assert.equal(fixture.state.setThreadsPreferencesLoading, false);
    if (options.state === "error") assert.equal(fixture.state.setThreadsPreferencesFailed, true);
  }
});

test("connected Booster loads Ghost preferences once while preserving an existing draft mode", async () => {
  for (const draft of ["", "saved-draft"]) {
    const fixture = modalFixture({ draft }); fixture.effect(); await new Promise(setImmediate);
    assert.equal(fixture.requests.length, 1);
    assert.equal((fixture.state.setThreadsPublicationPreferences as { ghostEnabled: boolean }).ghostEnabled, true);
    assert.equal(fixture.state.setThreadsPreferencesLoading, false);
    assert.equal(fixture.state.setThreadsPublicationMode, draft ? undefined : "ghost");
  }
});

test("changing the account cancels an in-flight preference response and real refusals remain failures", async () => {
  let finish!: (response: Response) => void;
  const fixture = modalFixture({ response: new Promise(resolve => { finish = resolve; }) });
  const cleanup = fixture.effect(); cleanup?.(); finish(Response.json({ preferences: { ghostEnabled: true, defaultMode: "ghost" } }));
  await new Promise(setImmediate);
  assert.deepEqual(fixture.state.setThreadsPublicationPreferences, preferences.CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES);
  const refused = modalFixture({ response: Promise.resolve(Response.json({}, { status: 503 })) });
  refused.effect(); await new Promise(setImmediate);
  assert.equal(refused.state.setThreadsPreferencesFailed, true);
});

test("Agent loads Threads preferences only after a connected snapshot for the active account and ignores stale responses", async () => {
  for (const [connected, snapshotAccount] of [[false, "account"], [true, "account"], [true, "previous-account"]] as const) {
    const state: unknown[] = [], requests: string[] = [];
    let finish!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { finish = resolve; });
    const effect = effectFrom("app/dashboard/agent/AgentClient.tsx", "async function loadThreadsPublicationPreferences", {
      ...preferences, metaPilotEnabled: true, connectedChannelsLoadState: "ready", agentConnectedChannels: { threads: connected },
      activeAccountId: "account", connectedChannelsAccountId: snapshotAccount,
      setThreadsPublicationPreferences: (value: unknown) => state.push(value),
      fetch: async (url: string) => { requests.push(url); return response; },
    });
    const cleanup = effect();
    assert.equal(requests.length, connected && snapshotAccount === "account" ? 1 : 0);
    cleanup?.(); finish(Response.json({ preferences: { ghostEnabled: true, defaultMode: "ghost" } })); await new Promise(setImmediate);
    assert.deepEqual(state, [preferences.CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES]);
  }
});
