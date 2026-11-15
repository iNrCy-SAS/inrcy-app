import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { channelItem, channelNodes, channelRuntime } from "../helpers/channel-bubble-runtime.mts";
import * as presentation from "../../app/dashboard/_components/dashboard-channel-presentation.ts";

function gmbWorkspace(verificationStatus: string, overrides: Record<string, unknown> = {}, bubbleStatus = "connected") {
  const tree = channelRuntime("app/dashboard/_components/DashboardChannelWorkspace.tsx").render({
    item: { ...channelItem, bubbleStatus },
    gmbPanelProps: {
      gmbAccountConnected: true, gmbConfigured: true, gmbConnectionStatus: "connected",
      gmbVerificationStatus: verificationStatus, gmbAccountEmail: "fixture@example.invalid",
      gmbLocationName: "locations/current", gmbLocationLabel: "Mon entreprise",
      gmbLocations: [{ name: "locations/current", title: "Mon entreprise" }],
      connectGmbAccount() { assert.fail("Verification status must never start OAuth"); },
      disconnectGmbAccount() {}, disconnectGmbBusiness() {}, saveGmbLocation() {},
      ...overrides,
    },
  });
  return channelNodes(tree).find(node => node.props.item?.connection)!.props.item;
}

test("Google verification pending is blue and informative while its selected connection remains intact", () => {
  const item = gmbWorkspace("pending");
  assert.equal(item.bubbleStatus, "pending");
  assert.equal(item.bubbleStatusText, "Validation Google en cours");
  assert.equal(item.connection.accountConnected, true);
  assert.equal(item.connection.value, "locations/current");
  const tree = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx").render({ item });
  const nodes = channelNodes(tree);
  assert.equal(nodes.find(node => node.props.className === "centralConnectionDot")!.props["data-status"], "pending");
  const message = nodes.find(node => node.props["data-channel-feedback"] === "verification")!;
  assert.equal(message.props.role, "status");
  assert.match(message.props.className, /channelFeedbackPending/);
  assert.equal(channelNodes(message).find(node => node.type === "strong")!.props.children, "Validation Google en cours");
  const detail = channelNodes(message).find(node => node.type === "p")!.props.children.at(-1);
  assert.equal(detail, "À suivre sur Google Business.");
  assert.equal(detail.includes("Validation Google en cours"), false, "The short body does not repeat its heading");
  assert.doesNotMatch(detail, /aucune action|suffit d.attendre/i);
  assert.equal(nodes.some(node => node.type === "button" && /(?:Reconnecter|Connecter) — Google Business/.test(node.props["aria-label"] || "")), false);
  assert.equal(presentation.getChannelTone(item), "pending");
  assert.equal(presentation.isChannelConnectionEstablished(item), true);
});

for (const [status, title] of [["required", "Validation Google requise"], ["restricted", "Action requise chez Google"]]) {
  test(`${status}: a Google-side action is amber without confusing it with an OAuth failure`, () => {
    const item = gmbWorkspace(status);
    assert.equal(item.bubbleStatus, "available");
    assert.equal(item.bubbleStatusText, title);
    assert.equal(item.connection.accountConnected, true);
    const tree = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx").render({ item });
    const nodes = channelNodes(tree);
    assert.equal(nodes.find(node => node.props.className === "centralConnectionDot")!.props["data-status"], "available");
    const message = nodes.find(node => node.props["data-channel-feedback"] === "verification")!;
    assert.match(message.props.className, /channelFeedbackWarning/);
    assert.equal(nodes.some(node => node.type === "button" && /(?:Reconnecter|Connecter) — Google Business/.test(node.props["aria-label"] || "")), false);
  });
}

test("verification cannot hide a real reconnect or replace the missing location selection step", () => {
  const reconnect = gmbWorkspace("pending", { gmbConnectionStatus: "needs_update" }, "reconnect");
  assert.equal(reconnect.bubbleStatus, "reconnect");
  assert.equal(reconnect.connection.afterContent, undefined);
  for (const status of ["verified", "unknown"]) {
    const item = gmbWorkspace(status);
    assert.equal(item.bubbleStatus, "connected");
    assert.equal(item.connection.afterContent, undefined);
  }
  const unselected = gmbWorkspace("pending", { gmbConfigured: false, gmbLocationName: "", gmbConnectionStatus: "disconnected" }, "available");
  assert.equal(unselected.bubbleStatus, "available");
  assert.equal(unselected.connection.afterContent.props["data-channel-feedback"], "selection");
});

test("refresh is only available for a pending authorized fiche and disappears once Google validates it", async () => {
  let refreshes = 0;
  let oauthStarts = 0;
  const actions = { refreshGmbVerification() { refreshes++; }, connectGmbAccount() { oauthStarts++; } };
  const runtime = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const buttons = (tree: ReturnType<typeof runtime.render>) => channelNodes(tree).filter(node => node.type === "button" && node.props.children === "Actualiser");
  let tree = runtime.render({ item: gmbWorkspace("pending", actions) });
  assert.equal(buttons(tree).length, 1);
  assert.equal(buttons(tree)[0].props.disabled, false);
  buttons(tree)[0].props.onClick();
  await new Promise(setImmediate);
  assert.equal(refreshes, 1);
  assert.equal(oauthStarts, 0, "Checking verification never opens Google OAuth");

  tree = runtime.render({ item: gmbWorkspace("pending", { ...actions, gmbLoadingList: true }) });
  assert.equal(buttons(tree).length, 1);
  assert.equal(buttons(tree)[0].props.disabled, true);
  assert.equal(buttons(tree)[0].props["aria-busy"], true);

  tree = runtime.render({ item: gmbWorkspace("verified", actions) });
  assert.equal(buttons(tree).length, 0, "A validated connected fiche no longer offers refresh");
  for (const status of ["required", "restricted", "unknown"]) {
    tree = runtime.render({ item: gmbWorkspace(status, actions) });
    assert.equal(buttons(tree).length, 0, status);
  }
  for (const overrides of [{ gmbConfigured: false }, { gmbAccountConnected: false }, { gmbConnectionStatus: "disconnected" }]) {
    tree = runtime.render({ item: gmbWorkspace("pending", { ...actions, ...overrides }) });
    assert.equal(buttons(tree).length, 0, JSON.stringify(overrides));
  }
  tree = runtime.render({ item: gmbWorkspace("pending", { ...actions, gmbConnectionStatus: "needs_update" }, "reconnect") });
  assert.equal(buttons(tree).length, 0);
  assert.equal(refreshes, 1);
  assert.equal(oauthStarts, 0);
});

test("pending GMB stays among connected channels and keeps its blue markers in the overview and mobile grid", async () => {
  const pending = { ...channelItem, bubbleStatus: "pending", bubbleStatusText: "Validation Google en cours" };
  const items = [pending, { ...channelItem, key: "facebook", name: "Facebook" }, { ...channelItem, key: "instagram", name: "Instagram", bubbleStatus: "available", bubbleStatusText: "À connecter" }];
  const runtime = channelRuntime("app/dashboard/_components/DashboardChannelsModal.tsx", {
    "./dashboard-channel-presentation": presentation,
    "../_hooks/useInrAssistantLocalInterface": { useInrAssistantLocalInterface() {} },
    "next-intl": { useTranslations: () => (key: string, values?: Record<string, unknown>) => key === "value_connectes_d1e3af7a" ? values?.value0 : key },
  });
  let tree = runtime.render({ items, initialSelectedKey: "facebook", onClose() {} });
  assert.equal(channelNodes(tree).find(node => node.props.className === "connectionCount")!.props.children[1].props.children, 2);
  assert.equal(channelNodes(tree).find(node => node.props["data-channel-mini"] === "gmb")!.props["data-tone"], "pending");
  assert.ok(channelNodes(tree).some(node => node.type === "button" && /satellite pending/.test(node.props.className || "")));
  channelNodes(tree).find(node => node.type === "button" && node.key === "connected")!.props.onClick();
  await new Promise(setImmediate);
  tree = runtime.render({ items, initialSelectedKey: "facebook", onClose() {} });
  assert.equal(channelNodes(tree).find(node => node.props["data-channel-count"] !== undefined)!.props["data-channel-count"], 2);
  assert.ok(channelNodes(tree).some(node => node.props["data-channel-mini"] === "gmb"));
  channelNodes(tree).find(node => node.type === "button" && node.key === "configure")!.props.onClick();
  await new Promise(setImmediate);
  tree = runtime.render({ items, initialSelectedKey: "facebook", onClose() {} });
  assert.equal(channelNodes(tree).find(node => node.props["data-channel-count"] !== undefined)!.props["data-channel-count"], 1);
  assert.equal(channelNodes(tree).some(node => node.props["data-channel-mini"] === "gmb"), false);

  const bubbleCss = readFileSync(new URL("../../app/dashboard/_components/DashboardChannelBubble.module.css", import.meta.url), "utf8");
  const modalCss = readFileSync(new URL("../../app/dashboard/_components/DashboardChannelsModal.module.css", import.meta.url), "utf8");
  assert.match(bubbleCss, /\.centralConnectionDot\[data-status="pending"\][^}]*background: #5ba9ff/);
  assert.match(modalCss, /\.pending \.satelliteStatus[^}]*background: #5ba9ff/);
  assert.match(modalCss, /\.mobileChannelButton\[data-tone=pending\] \.miniStatus[^}]*background:#5ba9ff/);
});
