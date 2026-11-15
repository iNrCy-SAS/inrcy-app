import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import type { DashboardFluxBubbleData } from "../../app/dashboard/_components/DashboardFluxBubble.tsx";
import { getChannelTone, isChannelConnectionEstablished } from "../../app/dashboard/_components/dashboard-channel-presentation.ts";
import { channelNodes, channelRuntime } from "../helpers/channel-bubble-runtime.mts";

// The real modules are transpiled at the asset/alias boundary; no live service is available.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;
type Model = Record<string, RuntimeValue>;
const root = new URL("../../", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, root), "utf8");
const modules = new Map<string, Model>();
const allowed = new Set([
  "app/dashboard/dashboard.flux-bubbles.ts", "app/dashboard/dashboard.constants.ts",
  "app/dashboard/dashboard.utils.ts", "app/dashboard/dashboard.shared.ts", "app/dashboard/dashboard.channel-setup.ts",
  "lib/inrDirectorySettings.ts", "lib/dashboardChannelSync.ts", "lib/bubbleAccess.ts", "i18n/dashboard.ts",
  "lib/googleBusinessVerification.ts", "lib/googleBusinessVerificationStore.ts",
]);
function load(relative: string): Model {
  if (modules.has(relative)) return modules.get(relative)!;
  if (/\.(?:png|jpg|svg)$/.test(relative)) return { __esModule: true, default: { src: `/${relative}` } };
  if (relative.endsWith(".css")) return { __esModule: true, default: {} };
  assert.ok(allowed.has(relative), `Unexpected runtime dependency ${relative}`);
  const fixtureModule = { exports: {} as Model };
  modules.set(relative, fixtureModule.exports);
  const require = (specifier: string): unknown => {
    if (specifier === "server-only") return {};
    assert.ok(specifier.startsWith("@/") || specifier.startsWith("."), `Unexpected external dependency ${specifier}`);
    const resolved = path.posix.normalize(specifier.startsWith("@/") ? specifier.slice(2) : path.posix.join(path.posix.dirname(relative), specifier));
    return load(/\.(?:ts|tsx|json|css|png|jpg|svg)$/.test(resolved) ? resolved : `${resolved}.ts`);
  };
  const code = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("module", "exports", "require", "fetch", code)(fixtureModule, fixtureModule.exports, require, () => { throw new Error("Live requests are forbidden in this fixture"); });
  return fixtureModule.exports;
}

const factory = load("app/dashboard/dashboard.flux-bubbles.ts");
const access = load("lib/bubbleAccess.ts");
const verification = load("lib/googleBusinessVerification.ts");
const store = load("lib/googleBusinessVerificationStore.ts");
const copy = { ...JSON.parse(read("messages/fr-FR/dashboard.json")), locale: "fr-FR" };
const labels = { pending: copy.channelBubble.googleVerificationPending, required: copy.channelBubble.googleVerificationRequired, restricted: copy.channelBubble.googleBusinessRestricted };
const now = Date.parse("2026-11-15T21:00:00.000Z");
const revision = "2026-11-15T20:30:00.000Z";
function savedMeta(status: string, patch: Model = {}) {
  return { connection_version_updated_at: revision, gmb_verification: {
    status, locationName: "locations/current", accountName: "accounts/current", checked_at: new Date(now).toISOString(), authorization_revision: revision,
    ...patch,
  } };
}
function args(patch: Model = {}): Model {
  return {
    bubbleAccessMap: access.createDefaultBubbleAccessMap(), standardMode: false, metaPilotEnabled: false,
    canAccessPinterest: true, officialChannelStatesReady: true, channelBlocks: {},
    facebookPageConnected: true, facebookConnectionStatus: "connected", facebookUrl: "https://facebook.example/fixture",
    getSiteBubbleProgress: () => ({ status: "connected", text: copy.status.connected }),
    gmbConnected: true, gmbConnectionStatus: "connected", gmbVerificationStatus: "unknown", gmbVerificationLabels: labels, gmbUrl: "https://maps.example/fixture",
    instagramConnected: true, instagramConnectionStatus: "connected", instagramUrl: "https://instagram.example/fixture",
    inrBadgeProfileReady: true, inrBadgeProfileCheckReady: true, inrBadgePublicUrl: "https://badge.example/fixture",
    onOpenInrAgent() {}, linkedinConnected: true, linkedinConnectionStatus: "connected", linkedinUrl: "https://linkedin.example/fixture",
    xConnected: true, xConnectionStatus: "connected", xUrl: "https://x.example/fixture",
    mailAccountsConnectedCount: 1, tiktokConnected: true, tiktokUrl: "https://tiktok.example/fixture",
    pinterestConnected: true, pinterestUrl: "https://pinterest.example/fixture",
    youtubeShortsConnected: true, youtubeShortsUrl: "https://youtube.example/fixture",
    openPanel() {}, savedSiteWebUrlMeta: "https://site.example", siteWebSavedUrl: "https://site.example", copy,
    ...patch,
  };
}
const build = (patch: Model = {}): DashboardFluxBubbleData[] => factory.buildFluxBubbleItems(args(patch));
const gmb = (patch: Model = {}): DashboardFluxBubbleData => build(patch).find(item => item.key === "gmb")!;
const savedStatus = (meta: Model) => store.readStoredGmbVerificationStatus(meta, "locations/current", "accounts/current", now);

test("a current Google pending signal reaches the real global factory and renders a blue connected GMB marker", () => {
  const parsed = verification.parseGmbVerification({ waitForVoiceOfMerchant: {} });
  const status = savedStatus(savedMeta(parsed));
  const item = gmb({ gmbVerificationStatus: status });
  assert.equal(item.bubbleStatus, "pending");
  assert.equal(item.bubbleStatusText, "Validation Google en cours");
  assert.equal(getChannelTone(item), "pending");
  assert.equal(isChannelConnectionEstablished(item), true);
  assert.equal(item.configureDisabled, false);
  const tree = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx").render({ item });
  assert.equal(channelNodes(tree).find(node => node.props.className === "centralConnectionDot")!.props["data-status"], "pending");
});

test("a pending verification for another fiche, account, OAuth revision or expired evidence cannot color this channel blue", () => {
  for (const changed of [
    { locationName: "locations/other" }, { accountName: "accounts/other" },
    { authorization_revision: "older-oauth-revision" }, { checked_at: new Date(now - 6 * 60 * 60_000).toISOString() },
    { checked_at: new Date(now + 2 * 60_000).toISOString() },
  ]) {
    const status = savedStatus(savedMeta("pending", changed));
    assert.equal(status, "unknown");
    assert.equal(gmb({ gmbVerificationStatus: status }).bubbleStatus, "connected");
  }
});

test("a real Google authorization failure stays reconnect even when a pending validation was saved", () => {
  for (const gmbConnected of [true, false]) {
    const item = gmb({ gmbConnected, gmbConnectionStatus: "needs_update", gmbVerificationStatus: "pending" });
    assert.equal(item.bubbleStatus, "reconnect");
    assert.equal(item.bubbleStatusText, copy.status.reconnect);
    assert.equal(getChannelTone(item), "warning");
    assert.equal(isChannelConnectionEstablished(item), false);
  }
});

test("an absent official fiche or unsynchronized official state cannot become pending from a cached verification", () => {
  const unselected = gmb({ gmbConnected: false, gmbConnectionStatus: "disconnected", gmbVerificationStatus: "pending" });
  assert.equal(unselected.bubbleStatus, "available");
  assert.equal(unselected.bubbleStatusText, copy.status.toConnect);
  const booting = gmb({ officialChannelStatesReady: false, gmbVerificationStatus: "pending" });
  assert.equal(booting.bubbleStatus, "available");
  assert.equal(booting.bubbleStatusText, copy.status.syncing);
});

test("verified or unknown validation retains the official connection instead of inventing a pending condition", () => {
  for (const gmbVerificationStatus of ["verified", "unknown", undefined]) {
    const item = gmb({ gmbVerificationStatus });
    assert.equal(item.bubbleStatus, "connected");
    assert.equal(item.bubbleStatusText, copy.status.connected);
  }
});

test("required and restricted have distinct Google-side action labels without becoming OAuth reconnection or pending", () => {
  const required = gmb({ gmbVerificationStatus: "required" });
  const restricted = gmb({ gmbVerificationStatus: "restricted" });
  assert.equal(required.bubbleStatusText, "Validation Google requise");
  assert.equal(restricted.bubbleStatusText, "Action requise chez Google");
  assert.notEqual(required.bubbleStatusText, restricted.bubbleStatusText);
  for (const item of [required, restricted]) {
    assert.equal(item.bubbleStatus, "available");
    assert.equal(getChannelTone(item), "available");
    assert.equal(item.configureDisabled, false);
  }
});

test("a pending GMB validation leaves every other global channel and its access unchanged", () => {
  const projection = (items: DashboardFluxBubbleData[]) => items.filter(item => item.key !== "gmb").map(item => ({ key: item.key, status: item.bubbleStatus, text: item.bubbleStatusText, configureDisabled: item.configureDisabled, premiumLocked: item.premiumLocked }));
  assert.deepEqual(projection(build({ gmbVerificationStatus: "pending" })), projection(build()));
  assert.equal(build({ gmbVerificationStatus: "pending" }).filter(item => item.bubbleStatus === "pending").length, 1);
});

test("pending status cannot bypass a disabled GMB entitlement, Standard mail lock or Threads rollout", () => {
  let opened = false;
  const disabled = gmb({ gmbVerificationStatus: "pending", bubbleAccessMap: { ...access.createDefaultBubbleAccessMap(), gmb: false }, openPanel() { opened = true; } });
  assert.equal(disabled.bubbleStatus, "coming");
  assert.equal(disabled.configureDisabled, true);
  assert.equal(getChannelTone(disabled), "disabled");
  disabled.onConfigure();
  assert.equal(opened, false);
  const standard = build({ standardMode: true, gmbVerificationStatus: "pending" });
  assert.equal(standard.find(item => item.key === "gmb")!.bubbleStatus, "pending");
  assert.equal(standard.find(item => item.key === "mails")!.premiumLocked, true);
  assert.equal(standard.find(item => item.key === "mails")!.bubbleStatus, "coming");
  assert.equal(standard.some(item => item.key === "threads"), false);
  const pilot = build({ metaPilotEnabled: true, threadsConnected: true, threadsConnectionStatus: "connected", gmbVerificationStatus: "pending" });
  assert.equal(pilot.find(item => item.key === "threads")!.bubbleStatus, "connected");
});

test("the pending global fiche keeps the existing configure action and destination", () => {
  let destination = "";
  const item = gmb({ gmbVerificationStatus: "pending", openPanel(panel: string) { destination = panel; } });
  assert.deepEqual(item.configureDestination, { kind: "panel", value: "gmb" });
  item.onConfigure();
  assert.equal(destination, "gmb");
});
