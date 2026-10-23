import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Transpiled modules and mocked React slots have heterogeneous runtime shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;
type Model = Record<string, RuntimeValue>;
type Reply = { ok: boolean; json(): Promise<unknown> };
const response = (payload: unknown, ok = true): Reply => ({ ok, json: async () => payload });
const settle = () => new Promise(setImmediate);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

type Channel = {
  name: string; hook: string; key: string; initial: Model;
  connected: string; account: string; status: string; selected: string; url: string; error: string;
  disconnect: string; resourceDisconnect?: string; resourceEndpoint?: string;
  load: string; listEndpoint: string; list: Model; save: string; target: string; saveEndpoint: string; saved: Model;
};
const channels: Channel[] = [
  {
    name: "Google Business", hook: "useGoogleBusinessChannel", key: "gmb",
    initial: { gmbConnected: true, gmbAccountConnected: true, gmbConfigured: true, gmbAccountEmail: "fixture@example.test", gmbLocationName: "locations/old", gmbLocationLabel: "Old location", gmbUrl: "https://maps.google.com/old" },
    connected: "gmbConnected", account: "gmbAccountConnected", status: "gmbConnectionStatus", selected: "gmbLocationName", url: "gmbUrl", error: "gmbUrlError",
    disconnect: "disconnectGmbAccount", resourceDisconnect: "disconnectGmbBusiness", resourceEndpoint: "/api/integrations/google-business/disconnect-location",
    load: "loadGmbAccountsAndLocations", listEndpoint: "/api/integrations/google-business/locations",
    list: { accounts: [{ name: "accounts/1" }], accountName: "accounts/1", locations: [{ name: "locations/new", title: "New location" }] },
    save: "saveGmbLocation", target: "locations/new", saveEndpoint: "/api/integrations/google-business/select-location", saved: { ok: true, url: "https://maps.google.com/new" },
  },
  {
    name: "Facebook", hook: "useFacebookChannel", key: "facebook",
    initial: { facebookPageConnected: true, facebookAccountConnected: true, facebookAccountEmail: "fixture@example.test", fbSelectedPageId: "old", fbSelectedPageName: "Old page", facebookUrl: "https://www.facebook.com/old" },
    connected: "facebookPageConnected", account: "facebookAccountConnected", status: "facebookConnectionStatus", selected: "fbSelectedPageId", url: "facebookUrl", error: "facebookUrlError",
    disconnect: "disconnectFacebookAccount", resourceDisconnect: "disconnectFacebookPage", resourceEndpoint: "/api/integrations/facebook/disconnect-page",
    load: "loadFacebookPages", listEndpoint: "/api/integrations/facebook/pages", list: { pages: [{ id: "new", name: "New page" }] },
    save: "saveFacebookPage", target: "new", saveEndpoint: "/api/integrations/facebook/select-page", saved: { ok: true, pageUrl: "https://www.facebook.com/new" },
  },
  {
    name: "Instagram", hook: "useInstagramChannel", key: "instagram",
    initial: { instagramConnected: true, instagramAccountConnected: true, instagramUsername: "fixture", instagramUrl: "https://www.instagram.com/fixture/" },
    connected: "instagramConnected", account: "instagramAccountConnected", status: "instagramConnectionStatus", selected: "igSelectedPageId", url: "instagramUrl", error: "instagramUrlError",
    disconnect: "disconnectInstagramAccount", resourceDisconnect: "disconnectInstagramProfile", resourceEndpoint: "/api/integrations/instagram/disconnect-profile",
    load: "loadInstagramAccounts", listEndpoint: "/api/integrations/instagram/accounts", list: { accounts: [{ page_id: "new", page_name: "New page", ig_id: "ig-new", username: "newfixture" }] },
    save: "saveInstagramProfile", target: "new", saveEndpoint: "/api/integrations/instagram/select-profile", saved: { ok: true, username: "newfixture", profileUrl: "https://www.instagram.com/newfixture/" },
  },
  {
    name: "LinkedIn", hook: "useLinkedinChannel", key: "linkedin",
    initial: { linkedinConnected: true, linkedinAccountConnected: true, linkedinDisplayName: "Fixture", linkedinSelectedOrganizationId: "old", linkedinSelectedOrganizationName: "Old org", linkedinProfileUrl: "https://www.linkedin.com/in/fixture", linkedinOrganizationUrl: "https://www.linkedin.com/company/old", linkedinUrl: "https://www.linkedin.com/company/old", linkedinShareToPersonalProfile: true },
    connected: "linkedinConnected", account: "linkedinAccountConnected", status: "linkedinConnectionStatus", selected: "linkedinSelectedOrganizationId", url: "linkedinUrl", error: "linkedinUrlError",
    disconnect: "disconnectLinkedinAccount", load: "loadLinkedinOrganizations", listEndpoint: "/api/integrations/linkedin/organizations",
    list: { organizations: [{ id: "new", name: "New org", url: "https://www.linkedin.com/company/new" }] },
    save: "selectLinkedinOrganization", target: "new", saveEndpoint: "/api/integrations/linkedin/select-organization", saved: { ok: true, organizationUrl: "https://www.linkedin.com/company/new" },
  },
];

/** Runs the production hook; dependencies are stable across controlled rerenders. No global fetch is used. */
function runtime(channel: Channel, options: {
  fetch?: (url: string, init?: RequestInit) => Promise<Reply>;
  refresh?: () => Promise<void>;
  writeSettings?: () => Promise<void>;
  initial?: Model;
  pilot?: boolean;
} = {}) {
  const slots: RuntimeValue[] = [];
  let cursor = 0;
  let activeAccountId = "account-1";
  const hooks = {
    useState(initial: RuntimeValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: RuntimeValue) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    // The tests invoke each data operation explicitly, without unrelated preference effects.
    useEffect() { cursor++; },
  };
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const patches: Array<{ channel: string; patch: Model; options: Model }> = [];
  const settingsWrites: Array<{ key: string; value: Model }> = [];
  const refreshes: string[] = [];
  const window = { location: { href: "http://localhost:3000/dashboard" }, setTimeout() {}, dispatchEvent() {} };
  const require = (specifier: string): unknown => {
    if (specifier === "react") return hooks;
    if (specifier.endsWith("userFacingErrors")) return {
      getClientUserFacingApiError: async (_response: Reply, fallback: string) => fallback,
      getClientUserFacingErrorMessage: (value: unknown, fallback: string) => value instanceof Error ? value.message : typeof value === "string" && value ? value : fallback,
    };
    if (specifier.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ metaPilotEnabled: options.pilot ?? true }) };
    if (specifier.endsWith("PublicationPreferences")) {
      const kind = specifier.includes("facebook") ? "Facebook" : "Instagram";
      return { [`DEFAULT_${kind.toUpperCase()}_PUBLICATION_PREFERENCES`]: {}, [`normalize${kind}PublicationPreferences`]: (value: unknown) => value };
    }
    if (specifier.endsWith("browserAccountCache")) return { getActiveBrowserUserId: () => activeAccountId };
    throw new Error(`Unmocked import: ${specifier}`);
  };
  const source = readFileSync(new URL(`../../app/dashboard/_hooks/channels/${channel.hook}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fixtureModule = { exports: {} as Model };
  const fetch = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (options.fetch) return options.fetch(url, init);
    if (url === channel.listEndpoint) return response(channel.list);
    if (url === channel.saveEndpoint) return response(channel.saved);
    return response({ ok: true });
  };
  new Function("module", "exports", "require", "fetch", "window", code)(fixtureModule, fixtureModule.exports, require, fetch, window);
  const props = {
    initialState: { ...channel.initial, ...options.initial }, panel: null, searchParams: new URLSearchParams(),
    patchChannelConnectionLocally: (key: string, patch: Model, opts: Model) => patches.push({ channel: key, patch, options: opts }),
    triggerChannelRefresh: (key: string) => { refreshes.push(key); return options.refresh?.() ?? Promise.resolve(); },
    updateRootSettingsKey: (key: string, value: Model) => { settingsWrites.push({ key, value }); return options.writeSettings?.() ?? Promise.resolve(); },
  };
  return {
    render: (): Model => { cursor = 0; return fixtureModule.exports[channel.hook](props); },
    setActiveAccount: (id: string) => { activeAccountId = id; },
    requests, patches, settingsWrites, refreshes, window,
  };
}

function assertDisconnected(channel: Channel, model: Model) {
  assert.equal(model[channel.connected], false, "The resource must remain disconnected");
  assert.equal(model[channel.account], false, "The account must remain disconnected");
  assert.equal(model[channel.status], "disconnected");
  assert.equal(model[channel.selected], "", "A stale selection must not reappear");
  assert.equal(model[channel.url], "", "A stale public URL must not reappear");
}

for (const channel of channels) {
  test(`${channel.name}: server-confirmed disconnect returns before statistics refresh and performs no second settings write`, async () => {
    const mutation = deferred<Reply>();
    const refresh = deferred<void>();
    const h = runtime(channel, { fetch: () => mutation.promise, refresh: () => refresh.promise });
    let result: unknown = "pending";
    const pending = h.render()[channel.disconnect]().then((value: unknown) => { result = value; });
    assert.equal(h.render()[channel.account], true, "The UI must not claim success before confirmation");
    mutation.resolve(response({ ok: true }));
    await settle();
    try {
      assert.equal(result, true, "Disconnect must not wait for the statistics request");
      assertDisconnected(channel, h.render());
      assert.deepEqual(h.refreshes, [channel.key]);
      assert.equal(h.requests.length, 1, "Only the authoritative disconnect route is required");
      assert.equal(h.requests[0].url, `/api/integrations/${channel.key === "gmb" ? "google-business" : channel.key}/disconnect-account`);
      assert.equal(h.requests[0].init?.method, "POST");
      assert.equal(h.settingsWrites.length, 0, "The route already persists disconnection; a browser write risks overwriting it");
      assert.equal(h.patches.at(-1)?.patch.connected, false);
      assert.equal(h.patches.at(-1)?.options.clearData, true);
    } finally { refresh.resolve(); await pending; }
  });

  test(`${channel.name}: failed disconnect returns false and preserves account, selected resource and public URL`, async () => {
    const h = runtime(channel, { fetch: async () => response({ ok: false, error: "Server failure" }, false) });
    const before = h.render();
    assert.equal(await before[channel.disconnect](), false);
    const after = h.render();
    for (const key of [channel.account, channel.connected, channel.selected, channel.url, channel.status]) assert.equal(after[key], before[key], key);
    assert.ok(after[channel.error]);
    assert.equal(h.patches.length, 0);
    assert.equal(h.settingsWrites.length, 0);
    assert.equal(h.refreshes.length, 0);
  });

  for (const timing of ["before", "during"] as const) {
    test(`${channel.name}: resource GET begun ${timing} disconnect cannot auto-select after its confirmation`, async () => {
      const list = deferred<Reply>();
      const mutation = deferred<Reply>();
      const h = runtime(channel, { initial: { gmbConfigured: false }, fetch: url => url === channel.listEndpoint ? list.promise : mutation.promise });
      const model = h.render();
      const pendingList = timing === "before" ? model[channel.load]() : undefined;
      const pendingDisconnect = model[channel.disconnect]();
      const newerList = timing === "during" ? h.render()[channel.load]() : undefined;
      mutation.resolve(response({ ok: true }));
      assert.equal(await pendingDisconnect, true);
      list.resolve(response(channel.list));
      await Promise.all([pendingList, newerList]);
      assertDisconnected(channel, h.render());
      assert.equal(h.requests.filter(request => request.url === channel.saveEndpoint).length, 0, "No automatic POST may be launched from an obsolete GET");
      assert.equal(h.patches.filter(item => item.patch.connected === true).length, 0);
      assert.equal(h.settingsWrites.length, 0);
    });
  }

  test(`${channel.name}: an automatic selection POST already in flight cannot restore a confirmed disconnection`, async () => {
    const selection = deferred<Reply>();
    const h = runtime(channel, { initial: { gmbConfigured: false }, fetch: async url => url === channel.listEndpoint ? response(channel.list) : url === channel.saveEndpoint ? selection.promise : response({ ok: true }) });
    const pendingList = h.render()[channel.load]();
    await settle();
    assert.equal(h.requests.filter(request => request.url === channel.saveEndpoint).length, 1, "Fixture must reach automatic resource selection");
    await h.render()[channel.disconnect]();
    const patchesAtDisconnect = h.patches.length;
    selection.resolve(response(channel.saved));
    await pendingList;
    assertDisconnected(channel, h.render());
    assert.equal(h.patches.length, patchesAtDisconnect);
    assert.equal(h.settingsWrites.length, 0);
  });

  test(`${channel.name}: a manual resource save already in flight cannot restore a confirmed disconnection`, async () => {
    const selection = deferred<Reply>();
    const h = runtime(channel, { fetch: async url => url === channel.listEndpoint ? response(channel.list) : url === channel.saveEndpoint ? selection.promise : response({ ok: true }) });
    await h.render()[channel.load]({ autoSelect: false });
    const pendingSave = h.render()[channel.save](channel.target);
    assert.equal(h.requests.filter(request => request.url === channel.saveEndpoint).length, 1);
    await h.render()[channel.disconnect]();
    const patchesAtDisconnect = h.patches.length;
    selection.resolve(response(channel.saved));
    await pendingSave;
    assertDisconnected(channel, h.render());
    assert.equal(h.patches.length, patchesAtDisconnect);
    assert.equal(h.settingsWrites.length, 0);
  });

  test(`${channel.name}: a disconnect response for account A cannot alter account B after a scope switch`, async () => {
    const mutation = deferred<Reply>();
    const h = runtime(channel, { fetch: () => mutation.promise });
    const before = h.render();
    const pending = before[channel.disconnect]();
    h.setActiveAccount("account-2");
    mutation.resolve(response({ ok: true }));
    await pending;
    const after = h.render();
    for (const key of [channel.connected, channel.account, channel.status, channel.selected, channel.url, channel.error, channel.error.replace("Error", "Notice")]) assert.equal(after[key], before[key], key);
    assert.equal(h.patches.length, 0, "An account-A result must not reach account-B dashboard state");
    assert.equal(h.refreshes.length, 0);
    assert.equal(h.settingsWrites.length, 0);
  });

  test(`${channel.name}: a resource GET for account A cannot launch auto-selection under account B`, async () => {
    const list = deferred<Reply>();
    const h = runtime(channel, { fetch: async url => url === channel.listEndpoint ? list.promise : response(channel.saved) });
    const before = h.render();
    const pending = before[channel.load]();
    h.setActiveAccount("account-2");
    list.resolve(response(channel.list));
    await pending;
    const after = h.render();
    for (const key of [channel.connected, channel.account, channel.status, channel.selected, channel.url, channel.error, channel.error.replace("Error", "Notice")]) assert.equal(after[key], before[key], key);
    assert.equal(h.requests.filter(request => request.init?.method === "POST").length, 0, "A stale list must not select an account-A resource in account B");
    assert.equal(h.patches.length, 0);
    assert.equal(h.refreshes.length, 0);
    assert.equal(h.settingsWrites.length, 0);
  });

  test(`${channel.name}: a resource save response for account A cannot publish a selection under account B`, async () => {
    const selection = deferred<Reply>();
    const h = runtime(channel, { fetch: async url => url === channel.listEndpoint ? response(channel.list) : selection.promise });
    await h.render()[channel.load]({ autoSelect: false });
    const before = h.render();
    const pending = before[channel.save](channel.target);
    h.setActiveAccount("account-2");
    selection.resolve(response(channel.saved));
    await pending;
    const after = h.render();
    for (const key of [channel.connected, channel.account, channel.status, channel.selected, channel.url, channel.error, channel.error.replace("Error", "Notice")]) assert.equal(after[key], before[key], key);
    assert.equal(h.patches.length, 0);
    assert.equal(h.refreshes.length, 0);
    assert.equal(h.settingsWrites.length, 0);
  });

  if (channel.resourceDisconnect) test(`${channel.name}: disconnecting only the resource preserves its account and does not wait for statistics`, async () => {
    const refresh = deferred<void>();
    const h = runtime(channel, { refresh: () => refresh.promise });
    let result: unknown = "pending";
    const pending = h.render()[channel.resourceDisconnect!]().then((value: unknown) => { result = value; });
    await settle();
    try {
      assert.equal(result, true);
      assert.equal(h.render()[channel.account], true);
      assert.equal(h.render()[channel.connected], false);
      assert.equal(h.requests[0].url, channel.resourceEndpoint);
      assert.equal(h.settingsWrites.length, 0);
      assert.equal(h.patches.at(-1)?.patch.accountConnected, true);
    } finally { refresh.resolve(); await pending; }
  });
}

test("Connect buttons retain the original OAuth endpoints, return URLs and provider modes", async () => {
  const cases: Array<[number, string, unknown[], string]> = [
    [0, "connectGmbAccount", [], "/api/integrations/google-business/start?returnTo=%2Fdashboard%3Fpanel%3Dgmb"],
    [1, "connectFacebookAccount", [], "/api/integrations/facebook/start?returnTo=%2Fdashboard%3Fpanel%3Dfacebook&mode=standard"],
    [1, "connectFacebookBusinessAccount", [], "/api/integrations/facebook/start?returnTo=%2Fdashboard%3Fpanel%3Dfacebook&mode=business"],
    [2, "connectInstagramAccount", [], "/api/integrations/instagram/start?returnTo=%2Fdashboard%3Fpanel%3Dinstagram&mode=standard"],
    [2, "connectInstagramAccount", [{ repair: true }], "/api/integrations/instagram/start?returnTo=%2Fdashboard%3Fpanel%3Dinstagram&mode=standard&repair=1"],
    [2, "connectInstagramBusinessAccount", [], "/api/integrations/instagram/start?returnTo=%2Fdashboard%3Fpanel%3Dinstagram&mode=business"],
    [2, "connectInstagramDirectAccount", [], "/api/integrations/instagram-direct/start?returnTo=%2Fdashboard%3Fpanel%3Dinstagram"],
    [3, "connectLinkedinAccount", [], "/api/integrations/linkedin/start?returnTo=%2Fdashboard%3Fpanel%3Dlinkedin%26linkedinTarget%3Dprofile"],
    [3, "connectLinkedinBusinessAccount", [], "/api/integrations/linkedin/start?returnTo=%2Fdashboard%3Fpanel%3Dlinkedin%26linkedinTarget%3Dorganization"],
  ];
  for (const [index, action, args, url] of cases) {
    const h = runtime(channels[index]);
    await h.render()[action](...args);
    assert.equal(h.window.location.href, url, action);
    assert.equal(h.requests.length, 0, "Connect delegates to the established provider route");
  }
  const noPilot = runtime(channels[2], { pilot: false });
  noPilot.render().connectInstagramDirectAccount();
  assert.equal(noPilot.window.location.href, "http://localhost:3000/dashboard");
});

test("Instagram direct-login disconnect uses its own route, without changing the Facebook-login flow", async () => {
  const h = runtime(channels[2], { initial: { instagramAuthMode: "instagram_login" } });
  assert.equal(await h.render().disconnectInstagramAccount(), true);
  assert.equal(h.requests[0].url, "/api/integrations/instagram-direct/disconnect");
  assertDisconnected(channels[2], h.render());
});

test("LinkedIn: a late personal-profile selection cannot restore a disconnected account", async () => {
  const selection = deferred<Reply>();
  const h = runtime(channels[3], { fetch: async url => url === channels[3].saveEndpoint ? selection.promise : response({ ok: true }) });
  const pending = h.render().useLinkedinPersonalProfile();
  await h.render().disconnectLinkedinAccount();
  const patchesAtDisconnect = h.patches.length;
  selection.resolve(response({ ok: true, profileUrl: "https://www.linkedin.com/in/fixture" }));
  await pending;
  assertDisconnected(channels[3], h.render());
  assert.equal(h.patches.length, patchesAtDisconnect);
  assert.equal(h.settingsWrites.length, 0);
});

for (const target of ["Profile", "Organization"]) {
  test(`LinkedIn: a late ${target.toLowerCase()} link save cannot republish the old connected state`, async () => {
    const settings = deferred<Reply>();
    const endpoint = "/api/integrations/channel-public-url";
    const h = runtime(channels[3], { fetch: async url => url === endpoint ? settings.promise : response({ ok: true }) });
    const pending = h.render()[`saveLinkedin${target}Url`]();
    await settle();
    const request = h.requests.find(item => item.url === endpoint);
    assert.ok(request, "Link editing must use the scoped public-URL endpoint");
    assert.equal(request.init?.method, "PATCH");
    const url = channels[3].initial[`linkedin${target}Url`];
    assert.deepEqual(JSON.parse(String(request.init?.body)), { channel: "linkedin", target: target.toLowerCase(), url }, "Only the URL and its destination are sent; connection flags must never be restored by a link save");
    await h.render().disconnectLinkedinAccount();
    const patchesAtDisconnect = h.patches.length;
    settings.resolve(response({ ok: true, url }));
    await pending;
    assertDisconnected(channels[3], h.render());
    assert.equal(h.patches.length, patchesAtDisconnect, "Saving a public URL must not overwrite newer connection status");
    assert.equal(h.settingsWrites.length, 0, "Link saves must not replace root connection settings");
  });
}
