import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { filterMetaPilotItems, filterMetaPilotPayload, isMetaPilotChannelVisible } from "../../lib/metaChannelUiAccess.ts";
import { isMetaChannelPilotEnabled, META_DIRECT_CHANNELS_PUBLIC_ENABLED } from "../../lib/metaChannelRollout.ts";
import { buildBubbleAccessMap } from "../../lib/bubbleAccess.ts";
import { THREADS_PUBLICATION_CAPABILITIES } from "../../lib/inrsend/threadsCapabilities.ts";
import { clampDashboardChannelPowerForAccess, computeDashboardChannelPower } from "../../lib/dashboardChannelPower.ts";
import { getDashboardChannelPowerSetup, getDashboardChannelSetup } from "../../app/dashboard/dashboard.channel-setup.ts";
import { DASHBOARD_CACHE_KEYS } from "../../lib/dashboardCacheKeys.ts";
import type { DashboardFluxBubbleData } from "../../app/dashboard/_components/DashboardFluxBubble.tsx";
import { getBoosterImageDecision } from "../../lib/boosterImageDecision.ts";
import { channelItem, channelNodes, channelRuntime, workspaceConnection } from "../helpers/channel-bubble-runtime.mts";

const require = createRequire(import.meta.url);
const loaded = new Map<string, Record<string, unknown>>();
function load(relative: string): Record<string, unknown> {
  const file = path.resolve(relative);
  if (loaded.has(file)) return loaded.get(file)!;
  if (/\.(png|jpg|jpeg|svg)$/.test(file)) return { src: relative };
  if (file.endsWith(".json")) return JSON.parse(fs.readFileSync(file, "utf8"));
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} as Record<string, unknown> }; loaded.set(file, loadedModule.exports);
  const localRequire = (id: string) => {
    if (file.endsWith("dashboard.flux-bubbles.ts") && id === "./dashboard.utils") return { statusLabel: (status: string, copy: { status: Record<string, string> }) => copy.status[status] || status };
    if (id === "server-only") return {};
    if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
    const base = id.startsWith("@/") ? path.resolve(id.slice(2)) : path.resolve(path.dirname(file), id);
    const candidate = [base, base + ".ts", base + ".tsx", base + ".json"].find((item) => fs.existsSync(item));
    assert.ok(candidate, "module " + id);
    return load(candidate);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  loaded.set(file, loadedModule.exports); return loadedModule.exports;
}

const { buildFluxBubbleItems } = load("app/dashboard/dashboard.flux-bubbles.ts") as { buildFluxBubbleItems: (args: ReturnType<typeof bubbleArgs>) => DashboardFluxBubbleData[] };
const copy = { ...load("messages/fr-FR/dashboard.json"), locale: "fr-FR" };
function bubbleArgs(enabled: boolean) {
  return { bubbleAccessMap: buildBubbleAccessMap([{ bubble_key: "threads", enabled: true }]), metaPilotEnabled: enabled,
    officialChannelStatesReady: true, canAccessPinterest: true, channelBlocks: {},
    facebookPageConnected: false, facebookConnectionStatus: "disconnected", facebookUrl: "",
    instagramConnected: false, instagramConnectionStatus: "disconnected", instagramUrl: "",
    threadsConnected: true, threadsConnectionStatus: "connected", threadsUrl: "https://www.threads.com/@inrcy",
    linkedinConnected: false, linkedinConnectionStatus: "disconnected", linkedinUrl: "",
    gmbConnected: false, gmbConnectionStatus: "disconnected", gmbUrl: "",
    xConnected: false, xConnectionStatus: "disconnected", xUrl: "", mailAccountsConnectedCount: 0,
    tiktokConnected: false, youtubeShortsConnected: false, inrBadgeProfileReady: false, inrBadgeProfileCheckReady: true,
    getSiteBubbleProgress: () => ({ status: "available", text: "À connecter" }),
    inrBadgePublicUrl: "", onOpenInrAgent() {}, openPanel(name: string) { void name; }, setHelpSiteWebOpen() {}, siteWebSavedUrl: "", copy };
}

test("approved Meta channels are available to ordinary accounts after App Review", () => {
  assert.equal(META_DIRECT_CHANNELS_PUBLIC_ENABLED, true);
  assert.equal(isMetaChannelPilotEnabled(false), true);
  const rows = buildFluxBubbleItems(bubbleArgs(isMetaChannelPilotEnabled(false)));
  assert.equal(rows.some((row) => row.key === "threads"), true);
  assert.equal(rows.some((row) => row.key === "instagram"), true);
});

test("the ADMIN pilot bubble retains the normal status, profile and settings actions", () => {
  const args = bubbleArgs(isMetaChannelPilotEnabled(true));
  let opened = ""; args.openPanel = (name: string) => { opened = name; };
  const row = buildFluxBubbleItems(args).find((item) => item.key === "threads");
  assert.ok(row); assert.equal(row.logoSrc, "/icons/threads.svg");
  assert.equal(row.bubbleStatus, "connected"); assert.equal(row.specialViewHref, args.threadsUrl);
  assert.equal(row.canViewSpecial, true); assert.equal(row.configureDisabled, false);
  row.onConfigure(); assert.equal(opened, "threads");
});

test("iNrBadge's view action opens the public badge page instead of the QR preview", () => {
  const args = bubbleArgs(false);
  args.inrBadgeProfileReady = true;
  args.inrBadgePublicUrl = "https://app.inrcy.com/badge/fixture";
  const row = buildFluxBubbleItems(args).find(item => item.key === "inrbadge");
  assert.ok(row);
  assert.equal(row.specialViewHref, args.inrBadgePublicUrl);
  assert.equal(row.canViewSpecial, true);
  assert.equal(row.onSpecialView, undefined, "Viewing the public page must not open the QR modal");
  const bubble = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const view = channelNodes(bubble.render({ item: row })).find(node => node.type === "a" && node.props.href === args.inrBadgePublicUrl);
  assert.ok(view, "The visible View action must link to the same public page as the QR code");
  assert.equal(view.props.target, "_blank");
});

test("USER snapshots discard Threads-only publications and strip mixed channel data without changing Facebook", () => {
  const history = [{ id: "threads-only", channels: ["threads"], raw: { payload: { channels: ["threads"] } } },
    { id: "mixed", channels: ["facebook", "threads"], raw: { payload: { channels: ["facebook", "threads"], postByChannel: { facebook: { content: "Keep me" }, threads: { content: "Pilot" } }, results: { facebook: { ok: true }, threads: { ok: false } } } } }];
  const safe = filterMetaPilotItems(history, false);
  assert.deepEqual(safe.map((item) => item.id), ["mixed"]);
  assert.deepEqual(safe[0].channels, ["facebook"]);
  assert.deepEqual(safe[0].raw.payload.postByChannel, { facebook: { content: "Keep me" } });
  assert.deepEqual(history[1].channels, ["facebook", "threads"]);
  assert.deepEqual(filterMetaPilotItems(history, true), history);
});

test("USER Agent preferences, CTA settings and channel maps drop Threads while ADMIN retains them", () => {
  const snapshot = { allowedChannels: ["instagram", "threads"], connectedChannels: { instagram: true, threads: true }, channelCtas: { threads: { label: "Visit" }, instagram: { label: "Call" } } };
  assert.deepEqual(filterMetaPilotPayload(snapshot, false), { allowedChannels: ["instagram"], connectedChannels: { instagram: true }, channelCtas: { instagram: { label: "Call" } } });
  assert.equal(filterMetaPilotPayload(snapshot, true), snapshot);
  assert.equal(isMetaPilotChannelVisible("Threads", false), false);
});

test("Threads publication text preview is exactly the transmitted title and CTA at 500 Unicode characters", () => {
  const { buildBoosterThreadsPostText } = load("lib/boosterCta.ts") as { buildBoosterThreadsPostText: (post: Record<string, unknown>) => string };
  const { getBoosterPublicationTextPreview } = load("lib/boosterPublicationTextPreview.ts") as { getBoosterPublicationTextPreview: (channel: string, post: Record<string, unknown>) => { count: number; text: string } };
  const post = { title: "", content: "😀".repeat(500), ctaMode: "none", hashtags: ["ignored"] };
  const preview = getBoosterPublicationTextPreview("threads", post);
  assert.equal(preview.count, 500); assert.equal(preview.text, buildBoosterThreadsPostText(post));
  assert.throws(() => buildBoosterThreadsPostText({ ...post, content: "😀".repeat(501) }), /500/);
  const cta = { title: "Hello", content: "A useful update", ctaMode: "website", cta: "Visit", ctaUrl: "https://example.com", hashtags: [] };
  assert.equal(getBoosterPublicationTextPreview("threads", cta).text, buildBoosterThreadsPostText(cta));
});

test("Threads keeps originals and offers draft editing, remote deletion and retry without fake published editing", () => {
  assert.deepEqual(THREADS_PUBLICATION_CAPABILITIES.editPublished, false);
  assert.equal(THREADS_PUBLICATION_CAPABILITIES.editDraft, true);
  assert.equal(THREADS_PUBLICATION_CAPABILITIES.deletePublished, true);
  assert.equal(THREADS_PUBLICATION_CAPABILITIES.retryFailed, true);
  assert.equal(getBoosterImageDecision({ channel: "threads", meta: { width: 3000, height: 600 } }).mode, "original");
});

test("the approved 14 fixed channel weights total 100, with Mails and iNr tools in the lowest tier", () => {
  const approved: Readonly<Record<string, number>> = { gmb: 12, site_web: 12, facebook: 10, instagram: 10, linkedin: 10, tiktok: 6, youtube_shorts: 6, pinterest: 6, x: 6, threads: 6, mails: 4, inr_search: 4, inr_directory: 4, inrbadge: 4 };
  const admin = getDashboardChannelPowerSetup(true);
  const user = getDashboardChannelPowerSetup(false);
  assert.deepEqual(Object.fromEntries(admin.map(({ key, weight }) => [key, weight])), approved);
  assert.equal(admin.reduce((sum, channel) => sum + channel.weight, 0), 100);
  assert.deepEqual(admin.map((channel) => channel.key), Object.keys(approved), "the help grid follows the approved tier order");
  for (const channel of user) assert.equal(channel.weight, approved[channel.key], "hiding Threads must preserve " + channel.key);
  assert.equal(admin.filter((channel) => channel.weight > 4).reduce((sum, channel) => sum + channel.weight, 0), 84);
  assert.equal(admin.filter((channel) => channel.weight === 4).reduce((sum, channel) => sum + channel.weight, 0), 16);
});

test("fixed scoring reaches ADMIN 100 and USER 94 without compensating for unavailable channels", () => {
  const user = getDashboardChannelPowerSetup(false);
  const admin = getDashboardChannelPowerSetup(true);
  const score = (pilot: boolean, connected: readonly string[]) => computeDashboardChannelPower(getDashboardChannelPowerSetup(pilot).map((channel) => ({ weight: channel.weight, completed: connected.includes(channel.key) })));
  assert.equal(user.some((channel) => channel.key === "threads"), false);
  assert.equal(computeDashboardChannelPower(user.map((channel) => ({ weight: channel.weight, completed: true }))), 94);
  assert.equal(computeDashboardChannelPower(admin.map((channel) => ({ weight: channel.weight, completed: true }))), 100);
  assert.equal(score(true, user.map((channel) => channel.key)), 94);
  assert.equal(score(false, ["site_web", "gmb"]), 24);
  assert.equal(score(true, ["site_web", "gmb"]), 24);
  assert.equal(score(true, ["site_web", "gmb", "threads"]), 30);
  assert.equal(score(false, ["site_web", "gmb", "threads"]), 24, "an inaccessible cached Threads connection adds no points");
  assert.equal(score(true, ["tiktok", "youtube_shorts", "pinterest", "x", "threads"]), 30);
  assert.equal(score(false, user.filter((channel) => channel.key !== "mails").map((channel) => channel.key)), 90);
  assert.equal(score(true, admin.filter((channel) => channel.key !== "mails").map((channel) => channel.key)), 96);
  assert.equal(score(true, admin.filter((channel) => !["instagram", "inr_directory"].includes(channel.key)).map((channel) => channel.key)), 86);
  for (const key of ["mails", "inr_search", "inr_directory", "inrbadge"]) assert.equal(score(true, [key]), 4);
  assert.equal(score(false, []), 0);
  assert.equal(computeDashboardChannelPower([{ weight: 80, completed: true }, { weight: 40, completed: true }, { weight: 99, completed: false }]), 100);
});

type RenderNode = { type: unknown; props: Record<string, unknown> };
function renderNodes(value: unknown): RenderNode[] {
  if (Array.isArray(value)) return value.flatMap(renderNodes);
  if (!value || typeof value !== "object") return [];
  const node = value as RenderNode;
  return [node, ...renderNodes(node.props?.children)];
}
function renderChannelConnections(pilot: boolean): RenderNode {
  const jsx = (type: unknown, props: Record<string, unknown>): RenderNode => ({ type, props });
  const output = ts.transpileModule(fs.readFileSync("app/dashboard/_components/DashboardChannelsSection.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const sectionModule = { exports: {} as Record<string, unknown> };
  const sectionRequire = (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "next-intl") return { useLocale: () => "fr-FR" };
    if (id.endsWith(".css")) return {};
    if (id === "./dashboard-channel-presentation") return load("app/dashboard/_components/dashboard-channel-presentation.ts");
    if (id === "../dashboard.scroll") return { DASHBOARD_TOOLS_ANCHOR_ID: "tools" };
    return { __esModule: true, default: id };
  };
  new Function("require", "module", "exports", output)(sectionRequire, sectionModule, sectionModule.exports);
  const Section = sectionModule.exports.default as (props: Record<string, unknown>) => RenderNode;
  return Section({ channelsOpen: true, fluxBubbleItems: getDashboardChannelSetup(pilot).map(({ key }) => ({ key, name: key, logoSrc: "/test.svg", bubbleStatus: "connected", bubbleStatusText: "Connected", onConfigure() {} })), onOpenChannels() {}, onCloseChannels() {}, goToModule() {}, openPanel() {}, onOpenChannelsHelp() {} });
}

test("the shared bubble hub counts only the channels available to USER and ADMIN", () => {
  for (const pilot of [false, true]) {
    const modal = renderNodes(renderChannelConnections(pilot)).find(node => node.type === "./DashboardChannelsModal");
    assert.ok(modal);
    const summary = modal.props.summary as { connected: number; total: number };
    assert.deepEqual(summary, { connected: pilot ? 14 : 13, total: pilot ? 14 : 13 });
    const items = modal.props.items as Array<{ key: string }>;
    assert.equal(items.some(item => item.key === "threads"), pilot);
    assert.equal(items.filter(item => item.key === "inr_directory").length, 1, "Annuaire is a separate channel in both account contexts");
    assert.equal(new Set(items.map(item => item.key)).size, items.length);
  }
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(), key: (index) => [...values.keys()][index] ?? null, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}

test("a cached v5 score is immediately capped when actor, account or edition access changes", () => {
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  const accountId = "11111111-1111-4111-8111-111111111111";
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage, sessionStorage, location: { protocol: "http:", hostname: "localhost" } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "" } });
  try {
    const browserCache = load("lib/browserAccountCache.ts") as { writeAccountCacheValue: (key: string, value: string, id: string) => void };
    const bootstrap = load("app/dashboard/dashboard.bootstrap-cache.ts") as { readCachedGeneratorPowerPercent: (id: string) => number | null };
    browserCache.writeAccountCacheValue(DASHBOARD_CACHE_KEYS.generatorPower, "100", accountId);
    const contexts = [
      { actorAdmin: true, accountAdmin: true, standard: false, expected: 100 },
      { actorAdmin: false, accountAdmin: true, standard: false, expected: 100 },
      { actorAdmin: true, accountAdmin: false, standard: false, expected: 100 },
      { actorAdmin: false, accountAdmin: false, standard: true, expected: 96 },
      { actorAdmin: true, accountAdmin: true, standard: true, expected: 96 },
      { actorAdmin: true, accountAdmin: true, standard: false, expected: 100 },
    ];
    for (const context of contexts) {
      const pilot = isMetaChannelPilotEnabled(context.actorAdmin && context.accountAdmin);
      const maximum = computeDashboardChannelPower(getDashboardChannelPowerSetup(pilot).map((channel) => ({ weight: channel.weight, completed: channel.key !== "mails" || !context.standard })));
      const cached = bootstrap.readCachedGeneratorPowerPercent(accountId);
      assert.equal(cached, 100, "the same cached value is present throughout the access changes");
      assert.equal(clampDashboardChannelPowerForAccess(cached, maximum), context.expected);
      assert.equal(clampDashboardChannelPowerForAccess(30, maximum), 30, "available capacity never awards points");
      assert.equal(clampDashboardChannelPowerForAccess(null, maximum), 0);
    }
    assert.match(fs.readFileSync("app/dashboard/DashboardClient.tsx", "utf8"), /const generatorPower = clampDashboardChannelPowerForAccess\(displayedGeneratorPower, availableGeneratorPowerMax\)/);
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow); else Reflect.deleteProperty(globalThis, "window");
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});

test("the gauge ignores previous normalized and 12-channel caches and purges old and current snapshots", () => {
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  const accountId = "11111111-1111-4111-8111-111111111111";
  const scoped = (key: string) => key + ":uid:" + accountId;
  const staleSnapshot = { power: 91, completedStepKeys: ["site_web"], nextStepKey: "threads", remainingSteps: 1 };
  for (const storage of [localStorage, sessionStorage]) {
    for (const version of [3, 4]) {
      storage.setItem(scoped(`inrcy_generator_power_percent_v${version}`), "91");
      storage.setItem(scoped(`inrcy_generator_power_snapshot_v${version}`), JSON.stringify(staleSnapshot));
    }
  }
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage, sessionStorage, location: { protocol: "http:", hostname: "localhost" } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "" } });
  try {
    const bootstrap = load("app/dashboard/dashboard.bootstrap-cache.ts") as { readCachedGeneratorPowerPercent: (id: string) => number | null; readCachedGeneratorPowerSnapshot: (id: string) => unknown };
    const browserCache = load("lib/browserAccountCache.ts") as { writeAccountCacheValue: (key: string, value: string, id: string) => void; purgeAllBrowserAccountCaches: () => void };
    assert.equal(bootstrap.readCachedGeneratorPowerPercent(accountId), null);
    assert.equal(bootstrap.readCachedGeneratorPowerSnapshot(accountId), null);
    const currentSnapshot = { ...staleSnapshot, power: 96 };
    browserCache.writeAccountCacheValue(DASHBOARD_CACHE_KEYS.generatorPower, "96", accountId);
    browserCache.writeAccountCacheValue(DASHBOARD_CACHE_KEYS.generatorPowerSnapshot, JSON.stringify(currentSnapshot), accountId);
    assert.equal(bootstrap.readCachedGeneratorPowerPercent(accountId), 96);
    assert.deepEqual(bootstrap.readCachedGeneratorPowerSnapshot(accountId), currentSnapshot);
    browserCache.purgeAllBrowserAccountCaches();
    for (const storage of [localStorage, sessionStorage]) assert.equal(storage.length, 0);
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow); else Reflect.deleteProperty(globalThis, "window");
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});


function instagramConnection(pilot: boolean, connected: boolean, authMode: string, calls: string[]) {
  return workspaceConnection({ item: { ...channelItem, key: "instagram", name: "Instagram", bubbleStatus: connected ? "connected" : "available" }, instagramPanelProps: { instagramAuthMode: authMode, instagramAccountConnected: connected, instagramConnected: connected, instagramUsername: connected ? "inrcy" : "", instagramUrl: "", igAccounts: [], connectInstagramAccount: () => calls.push("standard"), connectInstagramBusinessAccount: () => calls.push("business"), connectInstagramDirectAccount: () => calls.push("direct"), disconnectInstagramAccount: () => calls.push("disconnect"), saveInstagramProfile() {}, loadInstagramAccounts() {} } }, { "./DashboardViewerAccessProvider": { useDashboardViewerAccess: () => ({ metaPilotEnabled: pilot }) } });
}

test("Instagram groups both Facebook logins and highlights direct login when the active account is ready", async () => {
  for (const pilot of [false, true]) {
    const calls: string[] = [];
    const connection = instagramConnection(pilot, false, "facebook_login", calls);
    const runtime = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
    const props = { item: { ...channelItem, key: "instagram", name: "Instagram", bubbleStatus: "available", connection } };
    const connect = channelNodes(runtime.render(props)).find(node => node.props["aria-label"] === "Connecter — Instagram")!;
    connect.props.onClick();
    const choices = channelNodes(runtime.render(props)).find(node => node.props.className === "connectChoices")!;
    const buttons = channelNodes(choices).filter(node => node.type === "button");
    assert.deepEqual(buttons.map(node => node.props.children[1]), pilot ? ["Connexion directe"] : []);
    const menu = channelNodes(choices).find(node => node.props.label === "Connexion via Facebook")!;
    assert.ok(menu);
    assert.deepEqual(menu.props.options.map((option: { label: string }) => option.label), ["Connexion classique", "Connexion Business"]);
    for (const button of buttons) { button.props.onClick(); await Promise.resolve(); await Promise.resolve(); }
    for (const option of menu.props.options) { menu.props.onChoose(option); await Promise.resolve(); await Promise.resolve(); }
    assert.deepEqual(calls, pilot ? ["direct", "standard", "business"] : ["standard", "business"]);
  }
});

test("a directly connected Instagram account keeps Disconnect and has no Facebook profile picker", async () => {
  const calls: string[] = [];
  const connection = instagramConnection(true, true, "instagram_login", calls);
  assert.equal(connection.onSelect, undefined);
  assert.equal(connection.onLoad, undefined);
  const runtime = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const nodes = channelNodes(runtime.render({ item: { ...channelItem, key: "instagram", name: "Instagram", connection } }));
  const disconnect = nodes.find(node => node.props["aria-label"] === "Déconnecter — @inrcy");
  assert.ok(disconnect);
  disconnect.props.onClick(); await Promise.resolve();
  assert.deepEqual(calls, ["disconnect"]);
  assert.equal(nodes.some(node => node.type === "select"), false);
  assert.equal(nodes.some(node => String(node.props["aria-label"]).startsWith("Connecter —")), false);
  assert.equal(nodes.some(node => node.props.className === "connectChoices"), false);
});
