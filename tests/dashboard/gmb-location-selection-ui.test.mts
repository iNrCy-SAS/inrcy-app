import assert from "node:assert/strict";
import test from "node:test";
import { channelItem, channelNodes, channelRuntime, workspaceConnection } from "../helpers/channel-bubble-runtime.mts";

const oldLocation = "locations/3891416460066956860";
const currentLocation = "locations/10953798174154578778";
const locationTitle = "ELEC GENERAL 59";
const address = "10 rue Exemple · 59000 · Lille";

function connectionFor(overrides: Record<string, unknown> = {}) {
  return workspaceConnection({
    item: { ...channelItem, bubbleStatus: "available", bubbleStatusText: "Choisir une fiche" },
    gmbPanelProps: {
      gmbAccountConnected: true,
      gmbConfigured: false,
      gmbLocationUnavailable: true,
      gmbLocationsComplete: true,
      gmbAccountEmail: "professionnel@example.invalid",
      gmbLocationName: oldLocation,
      gmbLocationLabel: locationTitle,
      gmbLocations: [{ name: currentLocation, title: locationTitle, addressLabel: address }],
      saveGmbLocation() {}, disconnectGmbAccount() {},
      ...overrides,
    },
  });
}

test("an unavailable saved Google location stays distinct from the current same-title location until explicit selection", async () => {
  const selections: string[] = [];
  const connection = connectionFor({ saveGmbLocation: (value: string) => { selections.push(value); } });
  assert.equal(connection.value, oldLocation);
  assert.equal(connection.selectionUnavailable, true);
  assert.equal(connection.parameters, undefined, "An unavailable location cannot open its profile editor");
  assert.equal(connection.extraActions, undefined, "An unavailable location cannot open its reviews");
  const runtime = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const tree = runtime.render({ item: { ...channelItem, bubbleStatus: "available", connection } });
  const select = channelNodes(tree).find(node => node.type === "select")!;
  const options = channelNodes(select).filter(node => node.type === "option");
  const old = options.find(node => node.props.disabled && node.props.value)!;
  const current = options.find(node => node.props.value === currentLocation)!;
  assert.equal(select.props.value, old.props.value);
  assert.notEqual(select.props.value, oldLocation, "The unavailable display option is never confused with a selectable Google resource");
  assert.equal(old.props.disabled, true);
  assert.equal(old.props.children, `Ancienne fiche indisponible — ${locationTitle}`);
  assert.equal(current.props.children, `${locationTitle} — ${address}`);
  assert.ok(!current.props.disabled);
  assert.deepEqual(selections, [], "A discovered replacement cannot select itself");
  assert.doesNotMatch(options.map(option => option.props.children).join(" "), /locations\/|3891416460066956860|10953798174154578778/);
  select.props.onChange({ target: { value: currentLocation } });
  await new Promise(setImmediate);
  assert.deepEqual(selections, [currentLocation]);
});

test("an unavailable parent keeps a same-id location selectable as an explicit new target", async () => {
  const selections: string[] = [];
  const connection = connectionFor({ gmbLocations: [{ name: oldLocation, title: locationTitle, accountName: "accounts/current", addressLabel: address }], saveGmbLocation: (value: string) => { selections.push(value); } });
  const tree = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx").render({ item: { ...channelItem, bubbleStatus: "available", connection } });
  const select = channelNodes(tree).find(node => node.type === "select")!;
  const options = channelNodes(select).filter(node => node.type === "option");
  const old = options.find(node => node.props.disabled && node.props.value)!;
  const current = options.find(node => node.props.value === oldLocation)!;
  assert.equal(select.props.value, old.props.value);
  assert.notEqual(select.props.value, current.props.value);
  assert.equal(old.props.children, `Ancienne fiche indisponible — ${locationTitle}`);
  assert.equal(current.props.children, `${locationTitle} — ${address}`);
  assert.deepEqual(selections, []);
  select.props.onChange({ target: { value: old.props.value } });
  await new Promise(setImmediate);
  assert.deepEqual(selections, [], "The display sentinel can never be sent to the selection endpoint");
  select.props.onChange({ target: { value: current.props.value } });
  await new Promise(setImmediate);
  assert.deepEqual(selections, [oldLocation]);
});

test("an incomplete location list does not label a saved Google location unavailable", () => {
  const connection = connectionFor({ gmbConfigured: true, gmbLocationUnavailable: false, gmbLocationsComplete: false, gmbLocations: [], gmbLoadingList: true });
  const tree = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx").render({ item: { ...channelItem, connection } });
  const old = channelNodes(tree).find(node => node.type === "option" && node.props.value === oldLocation)!;
  assert.equal(old.props.children, locationTitle);
  assert.equal(old.props.disabled, false);
});

test("Google location options use a readable fallback when Google returns no title or address", () => {
  const connection = connectionFor({ gmbLocations: [{ name: currentLocation }] });
  assert.equal(connection.options[0].label, "Fiche Google Business");
});

test("a Google account awaiting a location clearly asks for the remaining choice", () => {
  const connection = connectionFor();
  assert.equal(connection.afterContent.props.role, "status");
  assert.equal(channelNodes(connection.afterContent).find(node => node.type === "p")!.props.children, "Compte Google autorisé — choisissez une fiche.");
  for (const overrides of [{ gmbConnectionStatus: "needs_update" }, { gmbAccountConnected: false }, { gmbConfigured: true, gmbLocationUnavailable: false }]) {
    assert.equal(connectionFor(overrides).afterContent, undefined);
  }
});

test("a genuine channel reconnect status remains visible independently of consent query warnings", () => {
  const tree = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx").render({ item: { ...channelItem, bubbleStatus: "reconnect", bubbleStatusText: "À reconnecter", connection: { accountConnected: false, resourceLabel: "", onConnect() {} } } });
  const dot = channelNodes(tree).find(node => node.props.className === "centralConnectionDot")!;
  assert.equal(dot.props["data-status"], "reconnect");
  assert.ok(channelNodes(tree).some(node => node.type === "button" && node.props["aria-label"] === "Reconnecter — Google Business"));
});
