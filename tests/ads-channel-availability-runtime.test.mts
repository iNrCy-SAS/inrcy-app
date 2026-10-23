/* eslint-disable @typescript-eslint/no-explicit-any -- Execute the actual channel controls and authorization functions with bounded fixtures. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { isValidElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { adsAccessAllowed, isAdsPublicChannel } from "../lib/adsAccessPolicy.ts";
import { ADS_CHANNELS, isAdsProvider, type AdsChannelId } from "../lib/adsValidation.ts";
import { FULL_PRODUCT_REVIEWER_ACCOUNT_ID, hasFullProductReviewerAccess } from "../lib/reviewerAccess.ts";

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function findNode<T extends ts.Node>(file: ts.SourceFile, predicate: (node: ts.Node) => node is T): T {
  let found: T | undefined;
  function visit(node: ts.Node) {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, `Expected source node in ${file.fileName}`);
  return found;
}

function actualFunction(path: string, name: string, scope: Record<string, unknown>) {
  const file = source(path);
  const node = findNode(file, (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const output = ts.transpileModule(node.getText(file).replace(/^export\s+/, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(scope), `${output}\nreturn ${name};`)(...Object.values(scope));
}

const client = source("app/dashboard/ads/AdsClient.tsx");
const catalogNode = findNode(client, (node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "CHANNEL_CATALOG");
const catalogCode = ts.transpileModule(`const catalog = ${catalogNode.initializer!.getText(client)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const catalog = new Function(`${catalogCode}\nreturn catalog;`)() as Array<{ id: AdsChannelId; label: string; logo: string }>;
const channelPanel = findNode(client, (node): node is ts.JsxElement => ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(client) === "id" && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "ads-channels"));
const launchPanel = findNode(client, (node): node is ts.JsxElement => ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(client) === "className" && attribute.initializer?.getText(client) === "{styles.launchArea}"));
const controlsCode = ts.transpileModule(`export function renderControls() { return <>${channelPanel.getText(client)}${launchPanel.getText(client)}</>; }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function controls(channelId: AdsChannelId, pilotChannelsEnabled = false) {
  const actions: string[] = [];
  const scope = {
    styles: new Proxy({}, { get: (_target, name) => String(name) }),
    CHANNEL_CATALOG: catalog,
    channelIndex: catalog.findIndex((channel) => channel.id === channelId),
    channelId, pilotChannelsEnabled, comingSoonLabel: "À venir", isAdsPublicChannel,
    isExternalChannel: (channel: string) => ["linkedin", "pinterest", "tiktok", "x"].includes(channel),
    externalStatuses: Object.fromEntries(ADS_CHANNELS.map(({ id }) => [id, { selectedAccountId: "" }])),
    connectionSnapshots: Object.fromEntries(ADS_CHANNELS.map(({ id }) => [id, { accountId: "" }])),
    isAdsProvider,
    AdsConnectionSettings: "provider-connection", ExternalAdsConnectionSettings: "external-connection", OpenaiAdsConnectionSettings: "openai-connection",
    provider: isAdsProvider(channelId) ? channelId : "google",
    connected: false, connectionStatus: "disconnected", connectionAccount: undefined, loadingAccounts: false,
    configAction: null, accounts: [], pages: [], draft: { adAccountId: "", pageId: "" },
    configuredAccountId: "", configuredAccountLabel: "", configuredPageId: "", metaNeedsInstagramIdentity: false,
    externalSettingsChannel: ["linkedin", "pinterest", "tiktok", "x"].includes(channelId) ? channelId : "linkedin",
    externalAccounts: [], externalAccountChoice: "", externalAccountsLoading: false, externalAccountsLoadFailed: false,
    externalAction: null, externalError: "", externalAccountsCache: { current: Object.fromEntries(ADS_CHANNELS.map(({ id }) => [id, { loaded: false }])) },
    getAdsAdvertiserAccountUrl: () => null,
    configuredAdvertiserAccountUrl: null,
    adsConnectionDisplay: () => ({ tone: "disconnected", label: "Non connecté" }),
    externalStatusDisplay: () => ({ tone: "disconnected", label: "Non connecté" }),
    Image: "img", launchButtonRef: { current: null }, channelPointerStart: { current: null },
    selectChannel: () => actions.push("select"),
    startNewCampaign: () => actions.push("launch"),
  };
  const exports: { renderControls?: () => unknown } = {};
  new Function("exports", "require", ...Object.keys(scope), controlsCode)(exports, (name: string) => {
    assert.equal(name, "react/jsx-runtime");
    return jsxRuntime;
  }, ...Object.values(scope));
  const elements: any[] = [];
  function visit(value: unknown) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isValidElement(value)) {
      elements.push(value);
      visit((value.props as { children?: unknown }).children);
    }
  }
  visit(exports.renderControls!());
  return { elements, actions };
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (isValidElement(value)) return textOf((value.props as { children?: unknown }).children);
  return "";
}

test("released Ads channels expose their account controls directly and can start creation", () => {
  for (const channel of ["meta", "google", "linkedin", "pinterest", "openai"] as const) {
    const view = controls(channel);
    const connection = view.elements.find((element) => String(element.type).endsWith("-connection") && element.props.active);
    const launch = view.elements.find((element) => element.type === "button" && element.props.className?.includes("launchButton"));
    assert.ok(connection, channel);
    assert.equal(connection.props.locked, false, channel);
    assert.equal(launch.props.disabled, false, channel);
    assert.equal(view.elements.some((element) => element.type === "button" && /Configurer/.test(textOf(element))), false);
    launch.props.onClick();
    assert.deepEqual(view.actions, ["launch"], channel);
  }
});

test("ordinary users cannot connect or launch unreleased TikTok and X channels", () => {
  for (const channel of ["tiktok", "x"] as const) {
    const view = controls(channel);
    const connection = view.elements.find((element) => String(element.type).endsWith("-connection") && element.props.active);
    const launch = view.elements.find((element) => element.type === "button" && element.props.className?.includes("launchButton"));
    const tab = view.elements.find((element) => element.type === "button" && element.props["data-channel"] === channel);
    assert.equal(connection.props.locked, true, channel);
    assert.equal(connection.props.status.connected, false, channel);
    assert.equal(connection.props.status.selectedAccountId, "", channel);
    assert.equal(launch.props.disabled, true, channel);
    assert.equal(tab.props.disabled, true, channel);
    assert.deepEqual(view.actions, []);
  }
});

test("validation accounts keep inline controls on every Ads channel", () => {
  for (const { id: channel } of ADS_CHANNELS) {
    const view = controls(channel, true);
    const connection = view.elements.find((element) => String(element.type).endsWith("-connection") && element.props.active);
    assert.equal(connection.props.locked, false, channel);
    assert.equal(view.elements.find((element) => element.type === "button" && element.props["data-channel"] === channel).props.disabled, false, channel);
    assert.deepEqual(view.actions, [], "rendering account fields must not initiate OAuth or mutate an account");
  }
});

function authorization(role: string, actor = FULL_PRODUCT_REVIEWER_ACCOUNT_ID, edition = "premium", roleReadError = false) {
  const pilot = actualFunction("lib/adsServer.ts", "isAdsPilotAdmin", {
    ADMIN_USER_IDS: [], isAdminRole: (value: unknown) => value === "admin", hasFullProductReviewerAccess,
    supabaseAdmin: { from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { role }, error: roleReadError ? { message: "Role read failed" } : null }) }) },
  });
  const userAllowed = actualFunction("lib/adsServer.ts", "isAdsUserAllowed", { isAdsPilotAdmin: pilot, getDashboardEditionForAccountId: async () => edition, adsAccessAllowed });
  const allowed = actualFunction("lib/adsServer.ts", "isAdsChannelUserAllowed", { isAdsPublicChannel, isAdsPilotAdmin: pilot, isAdsUserAllowed: userAllowed });
  return (channel: AdsChannelId, active = actor) => allowed(actor, active, channel);
}

test("server access releases Meta without removing commercial or reviewer ownership controls", async () => {
  for (const edition of ["premium", "founder"]) {
    const allowed = authorization("user", "ordinary-user", edition);
    for (const channel of ["meta", "google", "linkedin", "pinterest", "openai"] as const) assert.equal(await allowed(channel), true, `${edition}/${channel}`);
    for (const channel of ["tiktok", "x"] as const) assert.equal(await allowed(channel), false, `${edition}/${channel}`);
  }
  for (const { id } of ADS_CHANNELS) assert.equal(await authorization("user", "standard-user", "standard")(id), false, id);
  for (const channel of ["tiktok", "x"] as const) {
    assert.equal(await authorization("admin", "internal-admin")(channel), true, channel);
    assert.equal(await authorization("reviewer")(channel), true, channel);
    assert.equal(await authorization("reviewer")(channel, "another-company"), false, channel);
    assert.equal(await authorization("reviewer", "unapproved-reviewer")(channel), false, channel);
    assert.equal(await authorization("reviewer", FULL_PRODUCT_REVIEWER_ACCOUNT_ID, "premium", true)(channel), false, channel);
    assert.equal(await authorization("staff", "staff")(channel), false, channel);
  }
});

test("À venir reuses the existing translation in every supported catalog", () => {
  for (const locale of readdirSync(new URL("../messages/", import.meta.url))) {
    const catalog = JSON.parse(readFileSync(new URL(`../messages/${locale}/dashboard.json`, import.meta.url), "utf8"));
    assert.equal(typeof catalog.signatureTools.comingSoon, "string", locale);
    assert.ok(catalog.signatureTools.comingSoon.trim().length > 0, locale);
  }
});
