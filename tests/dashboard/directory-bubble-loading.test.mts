import assert from "node:assert/strict";
import test from "node:test";
import { channelRuntime, channelNodes, channelItem } from "../helpers/channel-bubble-runtime.mts";

test("Only connection errors appear below a channel; loading and confirmations stay silent", () => {
  const runtime = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const item = { ...channelItem, key: "inr_directory", name: "iNr’Annuaire", bubbleStatus: "available", connection: { accountConnected: false, resourceLabel: "Entreprise", onConnect() {}, loading: true } };
  let nodes = channelNodes(runtime.render({ item }));
  assert.equal(nodes.filter(node => node.props["data-channel-feedback"]).length, 0);
  nodes = channelNodes(runtime.render({ item: { ...item, connection: { ...item.connection, loading: false, error: "Enregistrement impossible." } } }));
  assert.ok(nodes.some(node => node.props["data-channel-feedback"] === "error" && node.props.role === "alert"));
  nodes = channelNodes(runtime.render({ item: { ...item, connection: { ...item.connection, loading: false, notice: "Votre présence est activée." } } }));
  assert.equal(nodes.filter(node => node.props["data-channel-feedback"]).length, 0);
});
