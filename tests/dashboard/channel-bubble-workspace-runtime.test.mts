import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { getChannelPopoverPosition } from "../../app/dashboard/_components/channel-popover-position.ts";

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
// Transpiled modules and mocked React slots have heterogeneous runtime shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;
type Props = Record<string, RuntimeValue>;
const labels = JSON.parse(read("messages/fr-FR/dashboard.json")).channelBubble;
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const stub = (props: Props) => React.createElement("div", {}, props.children);
const urlFieldStub = (props: Props) => React.createElement("div", {}, props.children);

function runtime(path: string, overrides: Props = {}) {
  const slots: RuntimeValue[] = [];
  const effects: Array<() => unknown> = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial: RuntimeValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: RuntimeValue) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: RuntimeValue) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useId: () => "test-publication-types",
    useCallback: (fn: RuntimeValue) => fn,
    useMemo: (fn: RuntimeValue) => fn(),
    useEffect(effect: () => unknown) { effects.push(effect); },
  };
  const localRequire = (specifier: string): RuntimeValue => {
    if (specifier in overrides) return overrides[specifier];
    if (specifier === "react") return hooks;
    if (specifier === "react/jsx-runtime") return require(specifier);
    if (specifier.endsWith(".css")) return css;
    if (specifier.endsWith("EditableChannelUrlField")) return { __esModule: true, default: urlFieldStub };
    if (specifier.endsWith("channel-popover-position")) return require("../../app/dashboard/_components/channel-popover-position.ts");
    if (specifier.endsWith("channel-workspace-snapshot")) return { readChannelWorkspaceSnapshot: (_channel: string, fallback: unknown) => fallback, writeChannelWorkspaceSnapshot() {} };
    if (specifier === "next-intl") return { useTranslations: () => (key: string, values: Props = {}) => String(labels[key] || key).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match)) };
    if (specifier === "next/dynamic") return { __esModule: true, default: () => stub };
    if (specifier.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ metaPilotEnabled: false }) };
    if (specifier.endsWith("useUnsavedExitGuard")) return { useUnsavedExitGuard() {} };
    if (specifier.endsWith("DashboardUnsavedNavigationProvider")) return { useDashboardUnsavedNavigation: () => ({ requestNavigation: async (fn: () => void) => { fn(); return true; } }) };
    if (specifier.endsWith("userFacingErrors")) return { getClientUserFacingApiError: async () => "API error", getClientUserFacingErrorMessage: (_: unknown, fallback: string) => fallback };
    if (specifier === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => "fixture", resolveActiveBrowserUserId: (id: string) => id };
    if (specifier === "@/lib/facebookPublicationPreferences") return require("../../lib/facebookPublicationPreferences.ts");
    if (specifier === "@/lib/instagramPublicationPreferences") return require("../../lib/instagramPublicationPreferences.ts");
    if (specifier.endsWith("PublicationPreferences")) return new Proxy({}, { get: (_, key) => String(key).startsWith("normalize") ? (value: RuntimeValue) => value || {} : {} });
    return { __esModule: true, default: stub, DashboardPremiumLockIcon: stub };
  };
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const fixtureModule = { exports: {} as Props };
  const fetch = overrides.fetch || (() => { throw Error("Unexpected request"); });
  new Function("module", "exports", "require", "fetch", "window", code)(fixtureModule, fixtureModule.exports, localRequire, fetch, { setTimeout() {}, clearTimeout() {}, requestAnimationFrame(callback: () => void) { callback(); }, dispatchEvent() {}, location: { href: "", search: "" } });
  return { exports: fixtureModule.exports, render: (name: string, props: RuntimeValue) => { cursor = 0; return fixtureModule.exports[name](props); }, flushEffects: async () => { await Promise.all(effects.splice(0).map(effect => effect())); } };
}

function nodes(tree: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return React.isValidElement<Props>(tree) ? [tree, ...nodes(tree.props.children)] : [];
}
const item = { key: "gmb", name: "Google Business", description: "Augmente les appels", logoSrc: "/icons/gmb.png", accent: "cyan", bubbleStatus: "connected", bubbleStatusText: "Connecté", onConfigure() {} };

test("resource fields identify the kind of choice without a duplicated visible caption", () => {
  const choices = { gmb: "Choisir une fiche", facebook: "Choisir une page", instagram: "Choisir un compte", linkedin: "Choisir un compte", youtube_shorts: "Choisir un compte", pinterest: "Choisir un tableau", mails: "Choisir une boîte mail" };
  for (const [key, placeholder] of Object.entries(choices)) {
    const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
    const props = { item: { ...item, key, connection: { onSelect() {}, options: [{ value: "existing", label: "Mon choix enregistré" }] } } };
    let tree = h.render("default", props);
    let select = nodes(tree).find(node => node.type === "select")!;
    assert.equal(nodes(select).find(node => node.type === "option" && node.props.value === "")!.props.children, placeholder);
    assert.ok(select.props["aria-label"], "The field keeps an accessible name");
    const group = nodes(tree).find(node => node.props.className === "resourceGroup")!;
    const visibleText = renderToStaticMarkup(group).replace(/<[^>]+>/g, "");
    for (const caption of ["selected", "selectedPage", "selectedBoard", "selectedMailbox", "selectedAccount"]) {
      assert.ok(!visibleText.includes(labels[caption]), "The accessible caption must not be repeated above the field");
    }
    tree = h.render("default", { item: { ...props.item, connection: { ...props.item.connection, value: "existing", resourceLabel: "Mon choix enregistré" } } });
    select = nodes(tree).find(node => node.type === "select")!;
    assert.equal(select.props.value, "existing");
    assert.equal(nodes(select).find(node => node.type === "option" && node.props.value === "existing")!.props.children, "Mon choix enregistré");
    tree = h.render("default", { item: { ...props.item, connection: { onSelect() {}, value: "known-id-before-name" } } });
    select = nodes(tree).find(node => node.type === "select")!;
    assert.equal(nodes(select).find(node => node.type === "option" && node.props.value === "known-id-before-name")!.props.children, placeholder, "A pending resource name must never leave the field blank");
  }
});

for (const channel of ["gmb", "facebook", "instagram"] as const) {
  test(`${channel}: listing resources from the bubble is read-only; selecting sends the exact new target`, async () => {
    const config = {
      gmb: { file: "useGoogleBusinessChannel", load: "loadGmbAccountsAndLocations", save: "saveGmbLocation", initial: { gmbAccountConnected: true, gmbLocationName: "locations/old" }, list: { accountName: "accounts/1", locations: [{ name: "locations/new", title: "New business" }] }, target: "locations/new", payloadKey: "locationName" },
      facebook: { file: "useFacebookChannel", load: "loadFacebookPages", save: "saveFacebookPage", initial: { facebookAccountConnected: true, fbSelectedPageId: "old" }, list: { pages: [{ id: "new", name: "New page" }] }, target: "new", payloadKey: "pageId" },
      instagram: { file: "useInstagramChannel", load: "loadInstagramAccounts", save: "saveInstagramProfile", initial: { instagramAccountConnected: true, igSelectedPageId: "old" }, list: { accounts: [{ page_id: "new", ig_id: "ig-new", username: "new-profile" }] }, target: "new", payloadKey: "pageId" },
    }[channel];
    const calls: Array<{ method: string; body?: Props }> = [];
    const h = runtime(`app/dashboard/_hooks/channels/${config.file}.ts`, { fetch: async (_url: string, init: RequestInit = {}) => { calls.push({ method: init.method || "GET", body: init.body ? JSON.parse(String(init.body)) : undefined }); return { ok: true, json: async () => init.method ? { ok: true } : config.list }; } });
    const props = { initialState: config.initial, panel: null, searchParams: new URLSearchParams(), patchChannelConnectionLocally() {}, triggerChannelRefresh: async () => {}, updateRootSettingsKey: async () => {} };
    let hook = h.render(config.file, props);
    await hook[config.load]({ autoSelect: false });
    assert.deepEqual(calls.map(call => call.method), ["GET"], "Opening a bubble must never select the only page automatically");
    hook = h.render(config.file, props);
    assert.equal(await hook[config.save](config.target), true);
    assert.equal(calls[1].body?.[config.payloadKey], config.target, "The dropdown must not persist its previous closure value");
  });
}

test("connected channels replace the plug with a single red X between view and parameters", () => {
  const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const tree = h.render("default", { item: { ...item, specialViewHref: "https://example.test/page", connection: { accountConnected: true, resourceLabel: "iNrCy", value: "1", options: [{ value: "1", label: "iNrCy" }], onSelect() {}, onConnect() {}, onDisconnect() {}, parameters: "Settings" } } });
  const line = nodes(tree).find(node => node.props.className === "resourceLine")!;
  const actions = nodes(tree).find(node => node.props.className === "iconActions")!;
  const disconnect = nodes(tree).find(node => node.props["aria-label"] === "Déconnecter — iNrCy")!;
  assert.ok(disconnect);
  assert.ok(!nodes(line).includes(disconnect), "The selected resource must have no disconnect button beside it");
  assert.deepEqual(React.Children.toArray(actions.props.children).filter(React.isValidElement).map(node => (node as React.ReactElement<Props>).props["aria-label"]), ["Voir la page", "Déconnecter — iNrCy", "Paramètres — Google Business"]);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Fiche sélectionnée/);
  assert.doesNotMatch(html, /Reconnecter — Google Business/);
  assert.match(html, /Paramètres — Google Business/);
  assert.match(html, /Augmente les appels/);
});

test("resource bubbles preserve the old single-resource setup but never replace an existing selection", async () => {
  for (const [key, prop, list, configured, load] of [
    ["gmb", "gmbPanelProps", "gmbLocations", "gmbConfigured", "loadGmbAccountsAndLocations"],
    ["facebook", "facebookPanelProps", "fbPages", "facebookPageConnected", "loadFacebookPages"],
    ["instagram", "instagramPanelProps", "igAccounts", "instagramConnected", "loadInstagramAccounts"],
  ]) {
    const calls: boolean[] = [];
    const h = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx");
    for (const selected of [false, true]) {
      const tree = h.render("default", { item: { ...item, key }, [prop]: { [list]: [], [configured]: selected, [load]: (options: { autoSelect: boolean }) => calls.push(options.autoSelect) } });
      await nodes(tree).find(node => node.props.item?.connection)!.props.item.connection.onLoad();
    }
    assert.deepEqual(calls, [true, false], key);
  }
});

test("an empty resource selector shows one loading message during discovery and selection", () => {
  const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  for (const operation of [{ loading: true }, { busy: true }]) {
    const tree = h.render("default", { item: { ...item, connection: { accountConnected: true, value: "", onSelect() {}, ...operation } } });
    const select = nodes(tree).find(node => node.type === "select")!;
    assert.equal(nodes(select).find(node => node.type === "option")!.props.children, labels.loading);
    assert.equal(nodes(tree).find(node => node.props.role === "status")!.props.hidden, true);
    assert.equal(renderToStaticMarkup(tree).split(labels.loading).length - 1, 1);
  }
  const selected = h.render("default", { item: { ...item, connection: { accountConnected: true, value: "locations/1", resourceLabel: "iNrCy", onSelect() {}, busy: true } } });
  assert.equal(nodes(selected).find(node => node.type === "select")!.props.value, "locations/1");
  assert.equal(nodes(selected).find(node => node.props.role === "status")!.props.children[1], labels.loading);
});

test("Google Business prevents a disconnect from racing the automatic selection write", () => {
  const workspace = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx");
  const bubble = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const tree = workspace.render("default", { item, gmbPanelProps: { gmbAccountConnected: true, gmbLocations: [], gmbLocationsPhase: "connecting", gmbLoadingList: true, saveGmbLocation() {}, disconnectGmbAccount() {} } });
  const connection = nodes(tree).find(node => node.props.item?.connection)!.props.item.connection;
  const pending = bubble.render("default", { item: { ...item, connection } });
  assert.equal(nodes(pending).find(node => node.type === "select")!.props.disabled, true);
  assert.equal(nodes(pending).find(node => String(node.props["aria-label"]).startsWith("Déconnecter —"))!.props.disabled, true);
});

test("Google Business, Facebook and Instagram show account-operation errors inside the bubble", () => {
  const cases = [
    { key: "gmb", props: { gmbPanelProps: { gmbLocations: [], gmbUrlError: "Compte Google non déconnecté", gmbListError: "Old list warning" } }, error: "Compte Google non déconnecté" },
    { key: "facebook", props: { facebookPanelProps: { fbPages: [], facebookUrlError: "Compte Facebook non déconnecté", fbPagesError: "Old list warning" } }, error: "Compte Facebook non déconnecté" },
    { key: "instagram", props: { instagramPanelProps: { igAccounts: [], instagramUrlError: "Compte Instagram non déconnecté", igAccountsError: "Old list warning" } }, error: "Compte Instagram non déconnecté" },
  ];
  for (const example of cases) {
    const h = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx");
    const tree = h.render("default", { item: { ...item, key: example.key }, ...example.props });
    assert.equal(nodes(tree).find(node => node.props.item?.connection)!.props.item.connection.error, example.error);
  }
});

test("Pinterest keeps account identity separate from the selected board and puts creation beside the selector", () => {
  const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const create = async () => true;
  const tree = h.render("default", { item: { ...item, key: "pinterest", name: "Pinterest", connection: { accountConnected: true, accountLabel: "iNrCy", resourceLabel: "Nos réalisations", value: "board-1", options: [{ value: "board-1", label: "Nos réalisations" }], onSelect() {}, onDisconnect() {}, onCreateResource: create } } });
  const groups = nodes(tree).filter(node => node.props.className === "resourceGroup");
  assert.equal(groups.length, 2);
  assert.match(renderToStaticMarkup(groups[0]), /aria-label="Compte connecté".*iNrCy/);
  assert.doesNotMatch(renderToStaticMarkup(groups[0]), /Nos réalisations/);
  assert.match(renderToStaticMarkup(groups[1]), /Tableau sélectionné.*Nos réalisations/);
  const line = nodes(groups[1]).find(node => String(node.props.className).includes("resourceLineWithCreate"))!;
  assert.ok(nodes(line).some(node => node.props.onCreate === create));
  assert.ok(nodes(tree).some(node => node.props["aria-label"] === "Déconnecter — iNrCy"));
});

test("inline Pinterest creation sends the entered name once and keeps a failed draft available", async () => {
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  const calls: string[] = [];
  const h = runtime("app/dashboard/_components/ChannelBoardCreator.tsx");
  const props = { onCreate: (name: string) => { calls.push(name); return pending; } };
  let tree = h.render("default", props);
  assert.ok(nodes(tree).some(node => node.props.popover === "auto"));
  assert.ok(!nodes(tree).some(node => node.props.role === "dialog"));
  nodes(tree).find(node => node.type === "input")!.props.onChange({ target: { value: "  Projets   clients  " } });
  tree = h.render("default", props);
  const submit = nodes(tree).find(node => node.type === "form")!.props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} });
  assert.deepEqual(calls, ["Projets clients"]);
  finish(false); await pending; await Promise.resolve();
  tree = h.render("default", props);
  assert.equal(nodes(tree).find(node => node.type === "input")!.props.value, "  Projets   clients  ");
  assert.ok(nodes(tree).some(node => node.props.role === "alert"));
});

test("Pinterest inline creation uses the real board endpoint and retains the existing default", async () => {
  const calls: Array<{ url: string; method: string; body?: Props }> = [];
  const h = runtime("app/dashboard/settings/_components/PinterestSettingsContent.tsx", {
    "@/lib/dashboardCacheKeys": { DASHBOARD_CACHE_KEYS: { channelState: "fixture" } },
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => "fixture", readAccountCacheValue: () => JSON.stringify({ pinterestConnected: true }) },
    "@/lib/pinterestUiSessionCache": { readPinterestBoardUiCache: () => ({ boards: [{ id: "board-1", name: "Existing board" }], defaultBoardId: "board-1" }), writePinterestBoardUiCache() {} },
    fetch: async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true, json: async () => ({ ok: true, board: { id: "board-2", name: "New board" }, defaultBoardId: "board-1" }) };
    },
  });
  const props = { renderBubble: (model: Props) => model };
  let model = h.render("default", props);
  assert.notEqual(model.accountLabel, model.resourceLabel);
  assert.equal(model.resourceLabel, "Existing board");
  assert.equal(await model.onCreateResource("  New   board  "), true);
  assert.deepEqual(calls, [{ url: "/api/integrations/pinterest/boards", method: "POST", body: { name: "New board" } }]);
  model = h.render("default", props);
  assert.equal(model.value, "board-1");
  assert.equal(model.resourceLabel, "Existing board");
  assert.ok(model.options.some((option: Props) => option.value === "board-2" && option.label === "New board"));
});

test("Pinterest keeps the selected board visible across remounts and a fresh page while status revalidates", async () => {
  let savedSnapshot: unknown = null;
  let sharedBoardsAvailable = true;
  const cache = {
    readChannelWorkspaceSnapshot: (_channel: string, fallback: unknown) => savedSnapshot ?? fallback,
    writeChannelWorkspaceSnapshot: (_channel: string, value: unknown) => { savedSnapshot = value; },
  };
  const overrides = {
    "../../_components/channel-workspace-snapshot": cache,
    "@/lib/dashboardCacheKeys": { DASHBOARD_CACHE_KEYS: { channelState: "fixture" } },
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => "fixture", readAccountCacheValue: () => JSON.stringify({ pinterestConnected: true }) },
    "@/lib/pinterestUiSessionCache": { readPinterestBoardUiCache: () => sharedBoardsAvailable ? { boards: [{ id: "board-1", name: "Nos réalisations" }], defaultBoardId: "board-1" } : null, writePinterestBoardUiCache() {} },
    fetch: () => new Promise(() => {}),
  };
  const props = { renderBubble: (model: Props) => model };
  const first = runtime("app/dashboard/settings/_components/PinterestSettingsContent.tsx", overrides);
  let model = first.render("default", props);
  assert.equal(model.value, "board-1");
  assert.equal(model.resourceLabel, "Nos réalisations");
  assert.equal(model.loading, false);
  await first.flushEffects();
  model = first.render("default", props);
  assert.equal(model.loading, false, "A pending status read must not replace a known board with a loading placeholder");
  assert.ok(savedSnapshot);

  // A newly evaluated module has no in-memory cache after a browser refresh.
  sharedBoardsAvailable = false;
  const freshPage = runtime("app/dashboard/settings/_components/PinterestSettingsContent.tsx", overrides);
  model = freshPage.render("default", props);
  assert.equal(model.value, "board-1");
  assert.equal(model.resourceLabel, "Nos réalisations");
  assert.equal(model.accountConnected, true);
  assert.equal(model.loading, false);
  await freshPage.flushEffects();
  assert.equal(freshPage.render("default", props).resourceLabel, "Nos réalisations");
});

test("Pinterest's fresh disconnected status overrides the restored display snapshot", async () => {
  let finishStatus!: (response: Props) => void;
  const pending = new Promise<Props>(resolve => { finishStatus = resolve; });
  const h = runtime("app/dashboard/settings/_components/PinterestSettingsContent.tsx", {
    "@/lib/dashboardCacheKeys": { DASHBOARD_CACHE_KEYS: { channelState: "fixture" } },
    "@/lib/pinterestUiSessionCache": { readPinterestBoardUiCache: () => null, writePinterestBoardUiCache() {} },
    "../../_components/channel-workspace-snapshot": {
      readChannelWorkspaceSnapshot: () => ({ accountConnected: true, connected: true, boards: [{ id: "board-1", name: "Nos réalisations" }], defaultBoardId: "board-1" }),
      writeChannelWorkspaceSnapshot() {},
    },
    fetch: () => pending,
  });
  const props = { renderBubble: (model: Props) => model };
  assert.equal(h.render("default", props).accountConnected, true);
  await h.flushEffects();
  finishStatus({ ok: true, json: async () => ({ ok: true, connected: false, boards: [], defaultBoardId: "" }) });
  await new Promise(setImmediate);
  const model = h.render("default", props);
  assert.equal(model.accountConnected, false, "Cached display data must never override the server's connection state");
  assert.equal(model.loading, false);
});

test("disconnected and expired channels show an explicit working connection button instead of the X", async () => {
  for (const expired of [false, true]) {
    let connections = 0;
    const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
    const tree = h.render("default", { item: { ...item, bubbleStatus: expired ? "reconnect" : "available", connection: { accountConnected: expired, value: "last-known-target", resourceLabel: "iNrCy", onSelect() {}, onConnect() { connections++; }, onDisconnect() {} } } });
    const connect = nodes(tree).find(node => node.props["aria-label"] === `${expired ? "Reconnecter" : "Connecter"} — Google Business`)!;
    assert.ok(connect);
    assert.match(renderToStaticMarkup(connect).replace(/<[^>]+>/g, ""), expired ? /^Reconnecter$/ : /^Connecter$/);
    assert.ok(!nodes(tree).some(node => node.type === "select"), "Connect before offering a resource choice");
    assert.ok(!nodes(tree).some(node => String(node.props["aria-label"]).startsWith("Déconnecter —")));
    await connect.props.onClick();
    assert.equal(connections, 1, "The explicit button invokes the existing connection callback");
  }
});

test("the explicit Instagram connection button preserves the existing provider choices", async () => {
  let businessConnections = 0;
  const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const props = { item: { ...item, key: "instagram", name: "Instagram", bubbleStatus: "available", connection: { accountConnected: false, resourceLabel: "", connectOptions: [{ label: "Via Facebook", onConnect() {} }, { label: "Connexion Business", onConnect() { businessConnections++; } }] } } };
  let tree = h.render("default", props);
  await nodes(tree).find(node => node.props["aria-label"] === "Connecter — Instagram")!.props.onClick();
  tree = h.render("default", props);
  const business = nodes(tree).find(node => node.type === "button" && React.Children.toArray(node.props.children).includes("Connexion Business"))!;
  assert.ok(business);
  assert.ok(nodes(tree).some(node => node.type === "button" && React.Children.toArray(node.props.children).includes("Via Facebook")));
  await business.props.onClick();
  assert.equal(businessConnections, 1);
});

test("selecting a known bubble never reloads its resource list; opening its selector loads once without hiding the current page", async () => {
  let loads = 0;
  const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const props = { item: { ...item, connection: { accountConnected: true, resourceLabel: "iNrCy", value: "1", options: [{ value: "1", label: "iNrCy" }], onSelect() {}, onLoad: async () => { loads++; } } } };
  let tree = h.render("default", props);
  await h.flushEffects();
  assert.equal(loads, 0);
  const select = nodes(tree).find(node => node.type === "select")!;
  select.props.onPointerDown();
  select.props.onFocus();
  await Promise.resolve();
  assert.equal(loads, 1, "Pointer and focus must not issue duplicate reads");
  tree = h.render("default", { item: { ...props.item, connection: { ...props.item.connection, loading: true } } });
  assert.equal(nodes(tree).find(node => node.type === "select")!.props.disabled, false);
  const status = nodes(tree).find(node => node.props.role === "status")!;
  assert.equal(status.props.hidden, true, "A background list refresh must not change the bubble layout");
  assert.match(renderToStaticMarkup(tree), /iNrCy/);
});

test("cold controllers reuse the dashboard's confirmed account while loading and let a fresh disconnect win", () => {
  const h = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx");
  const currentItem = { ...item, key: "x", name: "X", specialViewHref: "https://x.com/iNrCyTeam" };
  const tree = h.render("default", { item: currentItem });
  const renderBubble = nodes(tree).find(node => typeof node.props.renderBubble === "function")!.props.renderBubble;
  const reading = renderBubble({ accountConnected: false, resourceLabel: "", loading: true });
  assert.equal(reading.props.item.connection.accountConnected, true);
  assert.equal(reading.props.item.connection.resourceLabel, "@iNrCyTeam");
  const confirmed = renderBubble({ accountConnected: false, resourceLabel: "", loading: false });
  assert.equal(confirmed.props.item.connection.accountConnected, false, "A cache must never override the completed server response");
});

test("known connected accounts do not show a loading label while refreshing public metadata", () => {
  const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  for (const resourceLabel of ["@iNrCyTeam", ""]) {
    const tree = h.render("default", { item: { ...item, connection: { accountConnected: true, resourceLabel, loading: true } } });
    assert.doesNotMatch(renderToStaticMarkup(tree), /Chargement/);
    assert.equal(nodes(tree).find(node => node.props.role === "status")!.props.hidden, true);
  }
});

test("channel display snapshots are isolated by active account, expire and retain the requesting account on late writes", () => {
  let active = "account-a";
  const values = new Map<string, string>();
  const h = runtime("app/dashboard/_components/channel-workspace-snapshot.ts", {
    "@/lib/browserAccountCache": {
      getActiveBrowserUserId: () => active,
      readAccountCacheValue: (key: string) => values.get(`${active}:${key}`) || null,
      writeAccountCacheValue: (key: string, value: string, account: string) => values.set(`${account}:${key}`, value),
    },
  });
  const { readChannelWorkspaceSnapshot: readSnapshot, writeChannelWorkspaceSnapshot: writeSnapshot } = h.exports;
  writeSnapshot("x", { username: "first" });
  assert.deepEqual(readSnapshot("x", {}), { username: "first" });
  active = "account-b";
  assert.deepEqual(readSnapshot("x", {}), {});
  writeSnapshot("x", { username: "late-first" }, "account-a");
  assert.deepEqual(readSnapshot("x", {}), {});
  active = "account-a";
  assert.equal(readSnapshot("x", {}).username, "late-first");
  values.set("account-a:inrcy_channel_workspace_ui_v1:x", JSON.stringify({ value: { username: "expired" }, updatedAt: Date.now() - 11 * 60 * 1000 }));
  assert.deepEqual(readSnapshot("x", {}), {});
});

test("X keeps its cached account visible and silently replaces it with an authoritative disconnected response", async () => {
  const h = runtime("app/dashboard/settings/_components/XSettingsContent.tsx", {
    "../../_components/channel-workspace-snapshot": { readChannelWorkspaceSnapshot: () => ({ connected: true, username: "iNrCyTeam", displayName: "iNrCy" }), writeChannelWorkspaceSnapshot() {} },
    fetch: async () => ({ ok: true, json: async () => ({ connected: false }) }),
  });
  const props = { renderBubble: (model: Props) => model };
  let model = h.render("default", props);
  assert.equal(model.accountConnected, true);
  assert.equal(model.resourceLabel, "iNrCy · @iNrCyTeam");
  await h.flushEffects(); await new Promise(setImmediate);
  model = h.render("default", props);
  assert.equal(model.accountConnected, false);
  assert.equal(model.loading, false);
});

test("Mails uses four direct mailbox controls instead of a selector with hidden connection actions", () => {
  const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const slots = [1,2,3,4].map(number => ({ number, provider: number === 4 ? "IMAP" : "Gmail / Microsoft", connectOptions: [] }));
  const tree = h.render("default", { item: { ...item, key: "mails", name: "Mails", connection: { accountConnected: true, resourceLabel: "", mailboxes: slots, parameters: "Signature" } } });
  assert.ok(!nodes(tree).some(node => node.type === "select"));
  assert.equal(nodes(tree).find(node => node.props.slots)?.props.slots, slots);
  assert.ok(nodes(tree).some(node => node.props["aria-label"] === "Signature — Mails"));
});

test("a late Pinterest list refresh cannot undo a more recent board selection", async () => {
  let finishRead!: (value: Props) => void;
  const readResponse = new Promise<Props>(resolve => { finishRead = resolve; });
  const h = runtime("app/dashboard/settings/_components/PinterestSettingsContent.tsx", {
    "@/lib/dashboardCacheKeys": { DASHBOARD_CACHE_KEYS: { channelState: "fixture" } },
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => "fixture", readAccountCacheValue: () => JSON.stringify({ pinterestConnected: true }) },
    "@/lib/pinterestUiSessionCache": { readPinterestBoardUiCache: () => ({ boards: [{ id: "board-1", name: "Old board" }, { id: "board-2", name: "Selected board" }], defaultBoardId: "board-1" }), writePinterestBoardUiCache() {} },
    fetch: async (_url: string, init: RequestInit = {}) => init.method ? { ok: true, json: async () => ({ ok: true, defaultBoardId: "board-2" }) } : readResponse,
  });
  const props = { renderBubble: (model: Props) => model };
  let model = h.render("default", props);
  const pendingRead = model.onLoad();
  await model.onSelect("board-2");
  finishRead({ ok: true, json: async () => ({ ok: true, boards: [{ id: "board-1", name: "Old board" }], defaultBoardId: "board-1" }) });
  await pendingRead;
  model = h.render("default", props);
  assert.equal(model.value, "board-2");
  assert.equal(model.resourceLabel, "Selected board");
});

test("resource mutations cannot be submitted twice while an earlier selection is pending", async () => {
  let resolve!: () => void;
  const pending = new Promise<void>(done => { resolve = done; });
  const calls: string[] = [];
  const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const tree = h.render("default", { item: { ...item, connection: { resourceLabel: "iNrCy", value: "1", onSelect: (value: string) => { calls.push(value); return pending; } } } });
  const select = nodes(tree).find(node => node.type === "select")!;
  select.props.onChange({ target: { value: "second-page" } });
  select.props.onChange({ target: { value: "third-page" } });
  assert.deepEqual(calls, ["second-page"]);
  resolve();
  await pending;
});

test("a locked channel never exposes its controller, provider actions or resource selector", () => {
  const h = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx");
  const tree = h.render("default", { item: { ...item, key: "mails", premiumLocked: true, configureDisabled: true } });
  assert.equal(tree.props.item.connection, undefined);
  assert.equal(tree.props.item.premiumLocked, true);
  assert.equal(nodes(tree).filter(node => node.type === "select").length, 0);
});

test("Facebook and Instagram retain Business login for every user while direct Instagram stays in the pilot", () => {
  for (const pilot of [false, true]) {
    const actions = { standard() {}, business() {}, direct() {} };
    const h = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx", { "./DashboardViewerAccessProvider": { useDashboardViewerAccess: () => ({ metaPilotEnabled: pilot }) } });
    const tree = h.render("default", { item: { ...item, key: "instagram" }, instagramPanelProps: { igAccounts: [], connectInstagramAccount: actions.standard, connectInstagramBusinessAccount: actions.business, connectInstagramDirectAccount: actions.direct } });
    const connection = nodes(tree).find(node => node.props.item?.connection)?.props.item.connection;
    assert.ok(connection);
    assert.ok(connection.connectOptions.some((option: Props) => option.onConnect === actions.standard));
    assert.ok(connection.connectOptions.some((option: Props) => option.onConnect === actions.business));
    assert.equal(connection.connectOptions.some((option: Props) => option.onConnect === actions.direct), pilot);
  }
});

test("channel controllers expose explicit parameters without any legacy connection tree", () => {
  for (const name of ["X", "YoutubeShorts", "Pinterest", "Mails", "InrSearch"]) {
    const source = read(`app/dashboard/settings/_components/${name}SettingsContent.tsx`);
    assert.doesNotMatch(source, /channelParameters|channelPublicLinks|parametersOnly|renderBubble\?:/);
    assert.doesNotMatch(source, /step=\{1\}|data-channel-connection-step/);
  }
  const threads = read("app/dashboard/_components/ThreadsPublicationSettings.tsx");
  assert.doesNotMatch(threads, /connectThreads|disconnectThreads|parametersOnly|step=\{/);
  assert.match(threads, /savePublicationPreferences/);
});

test("channel frames center on their own bubble and remain fully inside narrow or short viewports", () => {
  const bubble = { left: 400, top: 220, width: 480, height: 480 };
  const desktop = getChannelPopoverPosition({ left: 800, width: 48, bottom: 700 }, { width: 1280, height: 900 }, 420, { bubble, height: 220 });
  assert.equal(desktop.left + desktop.width / 2, 640);
  assert.equal(desktop.top + 220 / 2, 460);
  const mobile = getChannelPopoverPosition({ left: 260, width: 42, bottom: 610 }, { width: 320, height: 667 }, 420, { bubble: { left: 20, top: 200, width: 280, height: 280 }, height: 280 });
  assert.deepEqual(mobile, { width: 296, left: 12, top: 200, maxHeight: 643 });
  const tall = getChannelPopoverPosition({ left: 10, width: 40, bottom: 665 }, { width: 320, height: 400 }, 300, { bubble, height: 800 });
  assert.equal(tall.top, 12);
  assert.equal(tall.maxHeight, 376, "Long content scrolls within the viewport");
});

test("Mails exposes three OAuth slots and one IMAP slot with account-specific actions and an unnumbered signature", async () => {
  const accounts = [
    { id: "gmail-1", provider: "gmail", email_address: "first@example.test", status: "connected" },
    { id: "outlook-1", provider: "microsoft", email_address: "second@example.test", status: "expired", connection_status: "needs_update" },
    { id: "imap-1", provider: "imap", email_address: "imap@example.test", status: "connected" },
  ];
  const calls: Array<{ url: string; body?: Props }> = [];
  const h = runtime("app/dashboard/settings/_components/MailsSettingsContent.tsx", {
    "../../_components/channel-workspace-snapshot": { readChannelWorkspaceSnapshot: () => accounts, writeChannelWorkspaceSnapshot() {} },
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => "fixture" },
    fetch: async (url: string, init: RequestInit = {}) => { calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined }); return { ok: true, json: async () => ({ mailAccounts: accounts.filter(account => account.id !== "outlook-1") }) }; },
  });
  let model!: Props;
  const props = { renderBubble: (next: Props) => { model = next; return null; } };
  h.render("default", props);
  assert.equal(model.mailboxes.length, 4);
  assert.deepEqual(model.mailboxes.map((slot: Props) => slot.address), ["first@example.test", "second@example.test", undefined, "imap@example.test"]);
  assert.deepEqual(model.mailboxes[2].connectOptions.map((option: Props) => option.label), ["Gmail", "Microsoft"]);
  assert.equal(model.mailboxes[1].needsUpdate, true);
  assert.ok(model.mailboxes[3].onConfigure);
  assert.equal(model.onDisconnect, undefined, "A global mailbox X must not disconnect the wrong account");
  const signature = nodes(model.parameters).find(node => node.props["data-mail-signature"] !== undefined)!;
  assert.ok(signature);
  assert.ok(!nodes(signature).some(node => node.type === "span" && React.Children.toArray(node.props.children).includes("1")));
  assert.equal(model.parametersOwnHeading, true);
  assert.ok(!nodes(model.parameters).some(node => node.props.step === 1), "The old connection panel is not present");
  await model.mailboxes[1].onDisconnect();
  assert.deepEqual(calls[0], { url: "/api/integrations/microsoft/disconnect", body: { accountId: "outlook-1" } });
  assert.equal(calls.length, 1, "A confirmed mailbox disconnect must not wait for another global status request");
  h.render("default", props);
  assert.equal(model.mailboxes[0].address, "first@example.test");
  assert.equal(model.mailboxes[3].address, "imap@example.test");
});

test("each mailbox mini frame owns its disconnect action and empty IMAP opens configuration directly", async () => {
  const calls: string[] = [];
  const h = runtime("app/dashboard/_components/ChannelMailboxConnections.tsx");
  const onAction = (action: () => void) => action();
  const connected = h.render("MailboxConnectionButton", { slot: { number: 2, address: "second@example.test", provider: "Microsoft", connectOptions: [], onReconnect: () => calls.push("reconnect-second"), onDisconnect: () => calls.push("disconnect-second") }, onAction });
  assert.equal(calls.length, 0);
  assert.ok(nodes(connected).some(node => node.props.popover === "auto"));
  const disconnect = nodes(connected).find(node => node.type === "button" && node.props["data-danger"] === "true")!;
  await disconnect.props.onClick();
  assert.deepEqual(calls, ["disconnect-second"]);
  const imap = runtime("app/dashboard/_components/ChannelMailboxConnections.tsx").render("MailboxConnectionButton", { slot: { number: 4, provider: "IMAP", connectOptions: [{ label: "IMAP", onConnect: () => calls.push("configure-imap") }] }, onAction });
  assert.ok(!nodes(imap).some(node => node.props.popover));
  await nodes(imap).find(node => node.type === "button")!.props.onClick();
  assert.deepEqual(calls, ["disconnect-second", "configure-imap"]);
});

test("YouTube exposes its URL editor independently from its preference form", () => {
  const h = runtime("app/dashboard/settings/_components/YoutubeShortsSettingsContent.tsx", {
    "../../_components/channel-workspace-snapshot": { readChannelWorkspaceSnapshot: (_key: string, fallback: Props) => ({ ...fallback, connected: true, accountConnected: true, channelUrl: "https://youtube.com/@fixture" }), writeChannelWorkspaceSnapshot() {} },
    "@/lib/apiResponse": { readApiJson: async () => ({}) },
  });
  let model!: Props;
  h.render("default", { renderBubble: (next: Props) => { model = next; return null; } });
  const links = nodes(model.publicLinks);
  assert.equal(links.length, 1);
  assert.equal(links[0].props.editorOnly, true);
  assert.equal(typeof links[0].props.onSaved, "function");
  assert.equal(typeof links[0].props.onDirtyChange, "function");
  assert.equal(links[0].props.value, "https://youtube.com/@fixture");
  assert.ok(!nodes(model.parameters).some(node => node.type === urlFieldStub));
  assert.ok(nodes(model.parameters).some(node => node.type === "select"));
});

test("public-link editing has one explicit action with no account menu or authentication choices", () => {
  const h = runtime("app/dashboard/_components/ChannelPublicLinkEditor.tsx");
  const tree = h.render("default", { name: "Facebook", children: React.createElement("input", { "aria-label": "Public link" }) });
  assert.ok(nodes(tree).some(node => node.props.popover === "auto"));
  assert.ok(nodes(tree).some(node => node.props["aria-label"] === "Public link"));
  assert.ok(nodes(tree).some(node => node.type === "button" && node.props["aria-label"] === "Modifier le lien public — Facebook"));
  assert.ok(nodes(tree).some(node => node.props.popoverTargetAction === "hide"));
  assert.doesNotMatch(renderToStaticMarkup(tree), /Actions du compte|Connexion Business|Renouveler/);
});

test("a connected bubble offers no login modes and its X disconnects the account rather than merely clearing the page", async () => {
  const calls: string[] = [];
  const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const tree = h.render("default", { item: { ...item, key: "facebook", name: "Facebook", connection: { accountConnected: true, value: "page-1", resourceLabel: "My page", onSelect() {}, connectOptions: [{ label: "Connexion Facebook", onConnect: () => calls.push("standard") }, { label: "Connexion Business", onConnect: () => calls.push("business") }], onDisconnect: () => calls.push("page"), onDisconnectAccount: () => calls.push("account") } } });
  assert.doesNotMatch(renderToStaticMarkup(tree), /Connexion Facebook|Connexion Business|Actions du compte/);
  const disconnect = nodes(tree).find(node => node.props["aria-label"] === "Déconnecter — My page")!;
  await disconnect.props.onClick();
  assert.deepEqual(calls, ["account"]);
});

test("the dedicated public-link editor opens directly for editing, ignores background hydration and keeps real drafts", async () => {
  const dirty: boolean[] = [];
  const saved: string[] = [];
  const writes: Props[] = [];
  const h = runtime("app/dashboard/_components/EditableChannelUrlField.tsx", {
    "@/lib/channelPublicUrl": require("../../lib/channelPublicUrl.ts"),
    fetch: async (_url: string, init: RequestInit) => { writes.push(JSON.parse(String(init.body))); return { ok: true, json: async () => ({ ok: true, url: "https://www.tiktok.com/@new-account" }) }; },
  });
  let props = { channel: "tiktok", value: "", editorOnly: true, ariaLabel: "Public link", viewLabel: "View", onDirtyChange: (value: boolean) => dirty.push(value), onSaved: (value: string) => saved.push(value) };
  let tree = h.render("default", props);
  await h.flushEffects();
  props = { ...props, value: "https://www.tiktok.com/@known-account" };
  h.render("default", props);
  await h.flushEffects();
  tree = h.render("default", props);
  assert.equal(nodes(tree).find(node => node.type === "input")!.props.readOnly, false);
  assert.equal(nodes(tree).find(node => node.type === "input")!.props.value, props.value);
  assert.ok(!dirty.includes(true), "Loading an existing link cannot create an unsaved-edit warning");
  assert.ok(!nodes(tree).some(node => node.type === "a"), "The editor does not duplicate the eye action");
  nodes(tree).find(node => node.type === "input")!.props.onChange({ target: { value: "https://www.tiktok.com/@new-account" } });
  tree = h.render("default", props);
  await h.flushEffects();
  assert.equal(dirty.at(-1), true);
  await nodes(tree).find(node => node.type === "button" && !node.props.disabled)!.props.onClick();
  await new Promise(setImmediate);
  assert.deepEqual(writes, [{ channel: "tiktok", url: "https://www.tiktok.com/@new-account" }]);
  assert.deepEqual(saved, ["https://www.tiktok.com/@new-account"]);
});

test("YouTube keeps visibility, hashtags and children defaults and saves their exact values alongside unrelated settings", async () => {
  let saved: Props | undefined;
  const h = runtime("app/dashboard/settings/_components/YoutubeShortsSettingsContent.tsx", {
    "../../_components/channel-workspace-snapshot": { readChannelWorkspaceSnapshot: () => ({ connected: true, accountConnected: true, channelName: "Fixture", defaults: { defaultVisibility: "private", autoHashtags: true, madeForKids: false } }), writeChannelWorkspaceSnapshot() {} },
    fetch: async () => ({ ok: true, json: async () => ({ youtube_shorts: { connected: true, accountConnected: true, channelName: "Fixture", defaults: { defaultVisibility: "private", autoHashtags: true, madeForKids: false } } }) }),
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => "fixture", resolveActiveBrowserUserId: (id: string) => id },
    "@/lib/supabaseClient": { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "fixture" } } }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { settings: { other_channel: { keep: true } } } }) }) }), upsert: async (value: Props) => { saved = value; return {}; } }) }) },
  });
  const props = { renderBubble: (model: Props) => model };
  h.render("default", props);
  await h.flushEffects();
  await new Promise(setImmediate);
  let model = h.render("default", props);
  assert.ok(model.publicLinks);
  const visibility = nodes(model.parameters).find(node => node.type === "select")!;
  assert.equal(visibility.props.value, "private");
  assert.deepEqual(nodes(visibility).filter(node => node.type === "option").map(node => node.props.value), ["public", "unlisted", "private"]);
  visibility.props.onChange({ target: { value: "unlisted" } });
  const hashtags = nodes(model.parameters).find(node => node.props.label === "hashtags_automatiques_49295275")!;
  const children = nodes(model.parameters).find(node => node.props.label === "contenu_destine_aux_enfants_e07f8415")!;
  assert.ok(hashtags && children);
  hashtags.props.onChange(false);
  children.props.onChange(true);
  model = h.render("default", props);
  const save = nodes(model.parameters).find(node => node.type === "button" && String(node.props.children).includes("enregistrer_mes_reglages"))!;
  assert.equal(save.props.disabled, false);
  save.props.onClick();
  await new Promise(setImmediate);
  assert.deepEqual(saved?.settings.youtube_shorts.defaults, { defaultVisibility: "unlisted", preferredFormat: "shorts", madeForKids: true, autoHashtags: false });
  assert.deepEqual(saved?.settings.other_channel, { keep: true });
});

test("Instagram repair belongs to reconnecting and preserves the chosen authentication flow", () => {
  for (const direct of [false, true]) {
    const calls: unknown[] = [];
    const h = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx", { "./DashboardViewerAccessProvider": { useDashboardViewerAccess: () => ({ metaPilotEnabled: true }) } });
    const tree = h.render("default", { item: { ...item, key: "instagram", bubbleStatus: "reconnect" }, instagramPanelProps: { igAccounts: [], instagramAuthMode: direct ? "instagram_login" : "facebook_login", connectInstagramAccount: (options: unknown) => calls.push(options), connectInstagramDirectAccount: () => calls.push("direct") } });
    const connection = nodes(tree).find(node => node.props.item?.connection)!.props.item.connection;
    connection.connectOptions.find((option: Props) => option.label === (direct ? "Connexion Instagram" : "Via Facebook")).onConnect();
    assert.deepEqual(calls, direct ? ["direct"] : [{ repair: true }]);
  }
});

test("LinkedIn keeps both public destinations, separate organization and account disconnection, and personal-profile sharing", () => {
  const calls: unknown[] = [];
  const h = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx");
  const tree = h.render("default", { item: { ...item, key: "linkedin" }, linkedinPanelProps: {
    linkedinAccountConnected: true, linkedinDisplayName: "Fixture profile", linkedinSelectedOrganizationId: "org-1", linkedinSelectedOrganizationName: "Fixture company", linkedinOrganizations: [], linkedinProfileUrl: "https://linkedin.com/in/fixture", linkedinOrganizationUrl: "https://linkedin.com/company/fixture", linkedinShareToPersonalProfile: true,
    disconnectLinkedinOrganization: () => calls.push("organization"), disconnectLinkedinAccount: () => calls.push("account"), setLinkedinProfileUrl: (url: string) => calls.push(["profile-url", url]), setLinkedinOrganizationUrl: (url: string) => calls.push(["organization-url", url]), updateLinkedinShareToPersonalProfile: (value: boolean) => calls.push(["personal-sharing", value]),
  } });
  const connection = nodes(tree).find(node => node.props.item?.connection)!.props.item.connection;
  const links = nodes(connection.publicLinks).filter(node => node.type === urlFieldStub);
  assert.equal(links.length, 2);
  assert.deepEqual(links.map(node => [node.props.target, node.props.value]), [["profile", "https://linkedin.com/in/fixture"], ["organization", "https://linkedin.com/company/fixture"]]);
  links[0].props.onSaved("https://linkedin.com/in/new");
  links[1].props.onSaved("https://linkedin.com/company/new");
  nodes(connection.parameters).find(node => node.type === "input")!.props.onChange({ target: { checked: false } });
  connection.onDisconnect(); connection.onDisconnectAccount();
  assert.deepEqual(calls, [["profile-url", "https://linkedin.com/in/new"], ["organization-url", "https://linkedin.com/company/new"], ["personal-sharing", false], "organization", "account"]);
});

test("a connected account awaiting a resource keeps board creation without showing another account-creation link", () => {
  const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const createBoard = async () => true;
  const tree = h.render("default", { item: { ...item, key: "pinterest", bubbleStatus: "available", createHref: "https://pinterest.com/business/create", connection: { accountConnected: true, resourceLabel: "", onSelect() {}, onDisconnect() {}, onCreateResource: createBoard } } });
  assert.ok(nodes(tree).some(node => node.props.onCreate === createBoard));
  assert.ok(!nodes(tree).some(node => node.props.href === "https://pinterest.com/business/create"));
});

test("Google Business has no settings while Facebook and Instagram expose only inline publication types", () => {
  const h = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx");
  const connectionOf = (tree: React.ReactNode) => nodes(tree).find(node => node.props.item?.connection)!.props.item.connection;
  const google = connectionOf(h.render("default", { item, gmbPanelProps: { gmbLocations: [], gmbConfigured: true, gmbLocationName: "1", gmbLocationLabel: "iNrCy" } }));
  assert.equal(google.parameters, undefined);
  for (const channel of ["facebook", "instagram"]) {
    const title = channel === "facebook" ? "Facebook" : "Instagram";
    const save = async () => true;
    const panel = { fbPages: [], igAccounts: [], [`${channel}PublicationPreferences`]: { reelsEnabled: true, storiesEnabled: false }, [`save${title}PublicationPreferences`]: save };
    const model = connectionOf(h.render("default", { item: { ...item, key: channel }, [`${channel}PanelProps`]: panel }));
    assert.equal(model.parameters, undefined);
    assert.equal(model.publicationTypes.onChange, save);
    assert.equal(model.publicationTypes.value.storiesEnabled, false);
  }
  const badge = connectionOf(h.render("default", { item: { ...item, key: "inrbadge" }, inrBadgeSettingsProps: { profileReady: true, profile: { companyLegalName: "iNrCy" } } }));
  assert.equal(badge.parametersFullScreen, true);
});

test("publication types open a non-modal checklist and autosave one exact change without a save button", async () => {
  const changes: Props[] = [];
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const h = runtime("app/dashboard/_components/ChannelPublicationTypes.tsx");
  const tree = h.render("default", { name: "Facebook", settings: { value: { reelsEnabled: true, storiesEnabled: false }, onChange: (patch: Props) => { changes.push(patch); return pending; } } });
  const checks = nodes(tree).filter(node => node.type === "input");
  assert.equal(checks.length, 3);
  assert.equal(checks[0].props.checked, true);
  assert.equal(checks[0].props.disabled, true);
  assert.equal(checks[2].props.checked, false);
  assert.equal(nodes(tree).filter(node => node.type === "button" && node.props.popoverTarget && !node.props.popoverTargetAction).length, 1);
  assert.equal(nodes(tree).filter(node => node.type === "button" && node.props["aria-pressed"] !== undefined).length, 3);
  assert.ok(nodes(tree).some(node => node.props.popover === "auto"));
  assert.ok(!nodes(tree).some(node => node.props.role === "dialog"));
  checks[1].props.onChange({ target: { checked: false } });
  checks[2].props.onChange({ target: { checked: true } });
  assert.deepEqual(changes, [{ reelsEnabled: false }], "A pending save must prevent duplicate requests");
  finish(); await pending;
});

test("publication types retain the previous default-format choice inside the same checklist", async () => {
  const changes: Props[] = [];
  const h = runtime("app/dashboard/_components/ChannelPublicationTypes.tsx");
  const tree = h.render("default", { name: "Instagram", settings: { value: { reelsEnabled: true, storiesEnabled: false, defaultMode: "classic" }, onChange: async (patch: Props) => { changes.push(patch); return true; } } });
  const defaults = nodes(tree).filter(node => node.type === "button" && node.props["aria-pressed"] !== undefined);
  assert.equal(defaults[0].props["aria-pressed"], true);
  assert.equal(defaults[2].props.disabled, true, "Disabled formats cannot become the default");
  await defaults[1].props.onClick();
  assert.deepEqual(changes, [{ defaultMode: "reel" }]);
});

test("Facebook and Instagram publication types are an icon in the final action row", () => {
  for (const channel of ["facebook", "instagram"]) {
    const h = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
    const settings = { value: { reelsEnabled: true, storiesEnabled: true }, onChange() {} };
    const tree = h.render("default", { item: { ...item, key: channel, connection: { accountConnected: true, resourceLabel: "iNrCy", publicationTypes: settings } } });
    const row = nodes(tree).find(node => node.props.className === "iconActions")!;
    assert.ok(nodes(row).some(node => node.props.settings === settings));
  }
  const h = runtime("app/dashboard/_components/ChannelPublicationTypes.tsx");
  const tree = h.render("default", { name: "Facebook", settings: { value: { reelsEnabled: true, storiesEnabled: true }, onChange() {} } });
  const trigger = nodes(tree).find(node => node.type === "button" && node.props.popoverTarget)!;
  assert.equal(trigger.props.className, "iconAction");
  assert.ok(nodes(trigger).some(node => node.type === "svg"));
  assert.doesNotMatch(renderToStaticMarkup(trigger), />Types de publication</);
});

for (const name of ["Facebook", "Instagram"]) {
  test(`${name} inline format changes save the new checked state and roll back on failure`, async () => {
    for (const succeed of [true, false]) {
      let sent: Props | undefined;
      const lower = name.toLowerCase();
      const previous = { version: 1, reelsEnabled: true, storiesEnabled: true, defaultMode: "reel" };
      const h = runtime(`app/dashboard/_hooks/channels/use${name}Channel.ts`, { fetch: async (_url: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return { ok: succeed, json: async () => ({ preferences: sent }) }; } });
      const props = { initialState: { [`${lower}PublicationPreferences`]: previous }, panel: null, searchParams: new URLSearchParams(), patchChannelConnectionLocally() {}, triggerChannelRefresh: async () => {}, updateRootSettingsKey: async () => {} };
      let hook = h.render(`use${name}Channel`, props);
      assert.equal(await hook[`save${name}PublicationPreferences`]({ reelsEnabled: false }), succeed);
      assert.equal(sent?.reelsEnabled, false);
      assert.equal(sent?.storiesEnabled, true);
      assert.equal(sent?.defaultMode, "classic", "Disabled placements cannot remain the default");
      hook = h.render(`use${name}Channel`, props);
      assert.equal(hook[`${lower}PublicationPreferences`].reelsEnabled, !succeed);
    }
  });
}

test("legacy OAuth return URLs and dashboard entries converge on the single bubble workspace", () => {
  const client = read("app/dashboard/DashboardClient.tsx");
  const drawer = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");
  assert.doesNotMatch(client, /ChannelConnectionsModal|ChannelSettingsHeader/);
  assert.match(client, /channelsOpen=\{channelConnectionsOpen \|\| isChannelSettingsPanel\(panel\)\}/);
  assert.match(client, /initialSelectedKey=\{isChannelSettingsPanel\(panel\) \? panel : undefined\}/);
  assert.doesNotMatch(drawer, /MemorizedPanel|shouldKeepPanel|XSettingsContent|MailsSettingsContent|PanelBlock/);
});

test("Site Web has independent Google connections and a widget-only settings frame", () => {
  const h = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx");
  const site = { hasSiteWebUrl: true, siteWebSavedUrl: "https://example.test/" };
  const tree = h.render("default", { item: { ...item, key: "site_web" }, siteWebPanelProps: site });
  const model = nodes(tree).find(node => node.props.item?.connection)!.props.item.connection;
  assert.equal(model.onDisconnect, undefined, "There is no global X that could disconnect both Google services");
  assert.equal(model.onConnect, undefined);
  assert.equal(model.resourceContent.props.site, site);
  assert.equal(model.parameters.props.site, site);
  assert.equal(model.parametersIcon, "widget");
  assert.equal(model.parametersOwnHeading, true);
  assert.equal(model.parametersLabel, "Widget");

  const widget = runtime("app/dashboard/_components/SiteWebWidgetSettings.tsx");
  const widgetTree = widget.render("default", { site: { ...site, siteWebActusLayout: "list", siteWebActusLimit: 5, siteWebActusDesign: "modern", siteWebActusTheme: "light", siteWebActusAccent: "", requestSiteWebWidgetToken() {} }, onDirtyChange() {} });
  assert.equal(nodes(widgetTree).filter(node => node.props.onConnect || node.props.onDisconnect).length, 0);
  assert.ok(nodes(widgetTree).some(node => node.props.layout === "list" && node.props.limit === 5));
  assert.ok(nodes(widgetTree).some(node => node.props.onGenerate && node.props.onRequestToken), "The original widget save/token/code workflow is retained");
});

for (const product of ["GA4", "GSC"]) {
  test(`Site Web: ${product} connects and disconnects only its own service`, async () => {
    const calls: string[] = [];
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const h = runtime("app/dashboard/_components/SiteWebBubbleControls.tsx");
    const props = { product, connected: true, busy: false, canConnect: true, details: [{ label: "Property", value: "fixture" }], onConnect: () => calls.push(`connect-${product}`), onDisconnect: () => { calls.push(`disconnect-${product}`); return pending; } };
    const tree = h.render("SiteGoogleConnectionButton", props);
    assert.deepEqual(calls, [], "Selecting a connected channel does not initiate OAuth or change access");
    assert.ok(nodes(tree).some(node => node.props.popover === "auto"));
    const disconnect = nodes(tree).find(node => node.type === "button" && node.props["aria-label"] === `Déconnecter ${product}`)!;
    disconnect.props.onClick();
    disconnect.props.onClick();
    assert.deepEqual(calls, [`disconnect-${product}`], "A double click never issues a duplicate disconnect");
    finish(); await pending; await Promise.resolve();
    const disconnected = h.render("SiteGoogleConnectionButton", { ...props, connected: false });
    assert.ok(!nodes(disconnected).some(node => node.props["aria-label"] === `Déconnecter ${product}`));
    nodes(disconnected).find(node => node.type === "button")!.props.onClick();
    assert.deepEqual(calls, [`disconnect-${product}`, `connect-${product}`]);
  });
}

test("Site Web link switches from pencil to save and persists an edited URL through the existing validated API", async () => {
  const calls: Props[] = [];
  const saved: string[] = [];
  const h = runtime("app/dashboard/_components/EditableChannelUrlField.tsx", {
    "@/lib/channelPublicUrl": require("../../lib/channelPublicUrl.ts"),
    fetch: async (url: string, init: RequestInit) => { calls.push({ url, method: init.method, body: JSON.parse(String(init.body)) }); return { ok: true, json: async () => ({ ok: true, url: "https://new.example.com/" }) }; },
  });
  const props = { channel: "site_web", value: "https://old.example.com/", saveAsIcon: true, ariaLabel: "Site link", viewLabel: "View", onSaved: (value: string) => saved.push(value) };
  let tree = h.render("default", props); await h.flushEffects();
  assert.equal(nodes(tree).find(node => node.type === "input")!.props.readOnly, true);
  assert.equal(nodes(tree).filter(node => node.type === "a").length, 0, "The bubble already owns its View action");
  nodes(tree).find(node => node.type === "button")!.props.onClick();
  tree = h.render("default", props); await h.flushEffects();
  assert.equal(nodes(tree).find(node => node.type === "input")!.props.readOnly, false);
  assert.equal(nodes(tree).find(node => node.type === "button")!.props.disabled, false, "The floppy can confirm the existing valid URL");
  nodes(tree).find(node => node.type === "input")!.props.onChange({ target: { value: "https://new.example.com/" } });
  tree = h.render("default", props);
  await nodes(tree).find(node => node.type === "button")!.props.onClick();
  await new Promise(setImmediate);
  assert.deepEqual(calls, [{ url: "/api/integrations/channel-public-url", method: "PATCH", body: { channel: "site_web", url: "https://new.example.com/" } }]);
  assert.deepEqual(saved, ["https://new.example.com/"]);
});

for (const enteredUrl of ["inrcy.com", "https://inrcy.com", "https://inrcy.com/"]) {
  test(`Site Web confirms ${enteredUrl} when the same address is already saved`, async () => {
    const h = runtime("app/dashboard/_components/EditableChannelUrlField.tsx", {
      "@/lib/channelPublicUrl": require("../../lib/channelPublicUrl.ts"),
      fetch: () => { throw Error("An unchanged address must not issue a write"); },
    });
    const dirty: boolean[] = [];
    const props = { channel: "site_web", value: "https://inrcy.com/", saveAsIcon: true, ariaLabel: "Site link", viewLabel: "View", onSaved() { throw Error("The existing saved value does not need to be persisted again"); }, onDirtyChange: (value: boolean) => dirty.push(value) };
    let tree = h.render("default", props); await h.flushEffects();
    nodes(tree).find(node => node.type === "button")!.props.onClick();
    tree = h.render("default", props); await h.flushEffects();
    nodes(tree).find(node => node.type === "input")!.props.onChange({ target: { value: enteredUrl } });
    tree = h.render("default", props); await h.flushEffects();
    assert.equal(nodes(tree).find(node => node.type === "button")!.props.disabled, false);
    await nodes(tree).find(node => node.type === "button")!.props.onClick();
    tree = h.render("default", props); await h.flushEffects();
    assert.equal(nodes(tree).find(node => node.type === "input")!.props.readOnly, true);
    assert.equal(nodes(tree).find(node => node.type === "input")!.props.value, props.value);
    assert.equal(dirty.at(-1), false);
    assert.ok(nodes(tree).some(node => node.props.role === "status"));
  });
}

test("iNrBadge moves QR, downloads and copying into the bubble while retaining the full settings form", () => {
  const h = runtime("app/dashboard/_components/DashboardChannelWorkspace.tsx");
  const badge = { publicUrl: "https://example.com/badge/fixture", profileReady: true, profile: { companyLegalName: "Fixture" } };
  const tree = h.render("default", { item: { ...item, key: "inrbadge" }, inrBadgeSettingsProps: badge });
  const model = nodes(tree).find(node => node.props.item?.connection)!.props.item.connection;
  assert.equal(model.resourceContent.props.publicUrl, badge.publicUrl);
  assert.equal(nodes(model.extraActions).filter(node => node.props.publicUrl === badge.publicUrl).length, 2);
  assert.equal(model.parameters.props.profile, badge.profile);
  assert.doesNotMatch(read("app/dashboard/settings/_components/InrBadgeSettingsContent.tsx"), /hideQrControls|downloadMenuOpen|toggleDownloadMenu/);
  assert.equal(model.parametersFullScreen, true);
  const bubble = runtime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const view = bubble.render("default", { item: { ...item, key: "inrbadge", connection: model, specialViewHref: badge.publicUrl } });
  const actions = nodes(view).find(node => node.props.className === "iconActions")!;
  const actionChildren = React.Children.toArray(actions.props.children) as React.ReactElement<Props>[];
  assert.equal(actionChildren[0].type, "a");
  assert.equal(actionChildren[1].type, React.Fragment);
  assert.equal(actionChildren[2].props["aria-label"], "Paramètres — Google Business");
});

test("iNrBadge displays the QR for the same tracked badge URL used by its existing exports", () => {
  const badge = require("../../lib/inrBadge.ts");
  const qr = require("../../lib/inrBadgeQr.ts");
  const h = runtime("app/dashboard/_components/InrBadgeBubbleActions.tsx", { "@/lib/inrBadge": badge, "@/lib/inrBadgeQr": qr });
  const url = "https://app.inrcy.com/badge/fixture";
  const tree = h.render("InrBadgeQrButton", { publicUrl: url, companyName: "Fixture" });
  const code = nodes(tree).find(node => node.type === "svg" && node.props.role === "img")!;
  const dimension = qr.createInrBadgeQrMatrix(badge.createInrBadgeQrTrackingUrl(url)).length + 8;
  assert.equal(code.props.viewBox, `0 0 ${dimension} ${dimension}`);
  assert.ok(nodes(code).some(node => node.type === "path" && node.props.d.length > 100));
  assert.ok(nodes(tree).some(node => node.props.popover === "auto"));
  assert.equal(nodes(tree).find(node => node.props.className === "badgeQrCompany")!.props.children, "Fixture");
});

test("iNrBadge PNG and PDF buttons call the original export with the same profile and public URL", async () => {
  for (const format of ["png", "pdf"]) {
    const calls: Props[] = [];
    const profile = { companyLegalName: "Fixture" };
    const h = runtime("app/dashboard/_components/InrBadgeBubbleActions.tsx", {
      "../settings/_components/InrBadgeSettingsContent": { downloadInrBadgeQr: async (url: string, data: Props, selected: string) => { calls.push({ url, profile: data, format: selected }); } },
    });
    const tree = h.render("InrBadgeDownloadButton", { publicUrl: "https://example.com/badge/fixture", profile });
    nodes(tree).find(node => node.type === "button" && node.props.children === format.toUpperCase())!.props.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(calls, [{ url: "https://example.com/badge/fixture", profile, format }]);
  }
});

test("switching channels mounts their complete controllers without an incomplete Suspense bubble", () => {
  const source = read("app/dashboard/_components/DashboardChannelWorkspace.tsx");
  assert.doesNotMatch(source, /Suspense|fallback=/);
  for (const name of ["XSettingsContent", "YoutubeShortsSettingsContent", "PinterestSettingsContent", "MailsSettingsContent", "InrSearchSettingsContent"]) {
    assert.ok(source.includes(`import ${name} from`));
  }
});
