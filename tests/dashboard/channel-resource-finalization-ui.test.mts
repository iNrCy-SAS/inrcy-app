import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { channelItem, channelNodes, channelRuntime, workspaceConnection } from "../helpers/channel-bubble-runtime.mts";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const cases = [
  { key: "facebook", prop: "facebookPanelProps", state: { facebookAccountConnected: true, facebookPageConnected: true, fbSelectedPageId: "page-1", fbSelectedPageName: "Mon entreprise", fbPages: [], fbPagesLoading: true, saveFacebookPage() {} }, value: "page-1", label: "Mon entreprise" },
  { key: "instagram", prop: "instagramPanelProps", state: { instagramAccountConnected: true, instagramConnected: true, igSelectedPageId: "page-1", instagramUsername: "entreprise", igAccounts: [], igAccountsLoading: true, saveInstagramProfile() {} }, value: "page-1", label: "@entreprise" },
  { key: "linkedin", prop: "linkedinPanelProps", state: { linkedinAccountConnected: true, linkedinSelectedOrganizationId: "org-1", linkedinSelectedOrganizationName: "Mon entreprise", linkedinOrganizations: [], linkedinOrganizationsLoading: true }, value: "org-1", label: "Mon entreprise" },
  { key: "gmb", prop: "gmbPanelProps", state: { gmbAccountConnected: true, gmbConfigured: true, gmbLocationName: "locations/1", gmbLocationLabel: "Mon entreprise", gmbLocations: [], gmbLoadingList: true, saveGmbLocation() {} }, value: "locations/1", label: "Mon entreprise" },
];

for (const example of cases) {
  test(`${example.key}: la ressource confirmée et sa pastille restent visibles pendant la découverte`, () => {
    const item = { ...channelItem, key: example.key };
    const connection = workspaceConnection({ item, [example.prop]: { ...example.state, disconnectFacebookAccount() {}, disconnectInstagramAccount() {}, disconnectLinkedinAccount() {} } });
    assert.equal(connection.accountConnected, true);
    assert.equal(connection.value, example.value);
    assert.equal(connection.resourceLabel, example.label);
    const runtime = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
    const tree = runtime.render({ item: { ...item, connection } });
    const nodes = channelNodes(tree);
    assert.equal(nodes.find(node => node.props.className === "centralConnectionDot")!.props["data-status"], "connected");
    const select = nodes.find(node => node.type === "select")!;
    assert.equal(select.props.value, example.value);
    assert.equal(channelNodes(select).find(node => node.type === "option" && node.props.value === example.value)!.props.children, example.label);
    assert.equal(nodes.find(node => node.props.role === "status")!.props.hidden, true, "Une liste en arrière-plan ne remplace pas la ressource enregistrée par un chargement");
    const pending = runtime.render({ item: { ...item, connection: { ...connection, busy: true } } });
    assert.equal(channelNodes(pending).find(node => node.type === "select")!.props.disabled, true);
  });
}

test("la découverte d'une ressource ne transforme pas un canal non confirmé en canal connecté", () => {
  const runtime = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const tree = runtime.render({ item: { ...channelItem, bubbleStatus: "available", bubbleStatusText: "À connecter", connection: { loading: true, accountConnected: false, onConnect() {} } } });
  assert.equal(channelNodes(tree).find(node => node.props.className === "centralConnectionDot")!.props["data-status"], "available");
  assert.ok(channelNodes(tree).some(node => node.props["aria-label"] === "Connecter — Google Business"));
});

test("Instagram explique les prérequis professionnel, créateur et Page Facebook", () => {
  const source = read("app/dashboard/_hooks/channels/useInstagramChannel.ts");

  assert.match(source, /le compte doit être Professionnel ou Créateur/);
  assert.match(source, /associé à votre Page Facebook professionnelle/);
  assert.match(source, /Aucun profil Instagram compatible n’a été trouvé/);
  assert.match(source, /withInstagramSetupHelp\(e,/);
  assert.match(source, /setPanelError\(setupError, setupError, 6000\)/);
});
