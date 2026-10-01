import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { adsAssociationDisplayReady, emptyAdsConnectionSnapshots } from "../lib/adsConnectionSnapshot.ts";

const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(predicate: (node: ts.Node) => boolean, file = source): ts.Node {
  let result: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (predicate(node)) result = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(result);
  return result;
}
function actual(name: string, scope: Record<string, unknown>, file = source) {
  const node = findNode((candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name
    || ts.isVariableDeclaration(candidate) && candidate.name.getText(file) === name, file);
  const declaration = ts.isFunctionDeclaration(node);
  const expression = declaration ? node.getText(file)
    : (node as ts.VariableDeclaration).initializer!.getText(file);
  const compiled = ts.transpileModule(declaration ? expression : `const actual = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${declaration ? name : "actual"};`)(...Object.values(scope));
}

test("une association connue reste verte avant la liste et pendant un refresh, jamais après un refus confirmé", () => {
  assert.equal(adsAssociationDisplayReady(true, "saved", "saved"), true);
  assert.equal(adsAssociationDisplayReady(true, "saved", "saved", true), true);
  assert.equal(adsAssociationDisplayReady(true, "saved", "saved", false), false);
  assert.equal(adsAssociationDisplayReady(false, "saved", "saved"), false);
  assert.equal(adsAssociationDisplayReady(true, "saved", "new-choice"), false);
  assert.equal(adsAssociationDisplayReady(true, "", ""), false);
});

test("la première sélection des sept canaux vient du snapshot SSR sans attendre un réseau", () => {
  const draftNode = findNode((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "[draft, setDraft]") as ts.VariableDeclaration;
  const initialize = (draftNode.initializer as ts.CallExpression).arguments[0];
  const compiled = ts.transpileModule(`const initialize = ${initialize.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const initialChannel of ["google", "meta", "linkedin", "tiktok", "pinterest", "x", "openai"]) {
    const initialConnections = { [initialChannel]: { accountId: "saved", pageId: "page" } };
    const init = new Function("initialChannel", "initialConnections", "newDraft", `${compiled}\nreturn initialize;`)(initialChannel, initialConnections, () => ({ adAccountId: "", pageId: "" }));
    assert.deepEqual(init(), { adAccountId: "saved", pageId: "page" });
  }
});

function providerHarness(provider = "google") {
  const account = (id: string) => ({ id, name: id, currency: "EUR", provider });
  const state: Record<string, unknown> = {
    connected: true, connectionStatus: "connected", accounts: [account("saved"), account("local")],
    draft: { provider, adAccountId: "local", accountCurrency: "EUR", pageId: "page" },
    connectionSnapshots: emptyAdsConnectionSnapshots(), notice: "",
  };
  const setter = (key: string) => (value: unknown) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const scope: Record<string, unknown> = {
    useCallback: (fn: unknown) => fn,
    adsAccountCanBeAssociated: (candidate: { currency: string }) => candidate.currency === "EUR",
  };
  for (const key of ["connected", "connectionStatus", "connectionAccount", "accounts", "pages", "configuredAccountId", "configuredAccountLabel", "configuredPageId", "connectionSnapshots", "draft", "notice"]) {
    scope[`set${key[0].toUpperCase()}${key.slice(1)}`] = setter(key);
  }
  return { apply: actual("applyProviderAccountsResult", scope), state, account };
}

for (const provider of ["google", "meta"]) test(`${provider} : échec temporaire conserve le compte, révocation réelle le désactive`, () => {
  const run = providerHarness(provider);
  run.apply(provider, { connected: true, error: "Service temporairement indisponible", accounts: [], selectedAccountAvailable: false }, true);
  assert.equal(run.state.connected, true);
  assert.equal((run.state.accounts as unknown[]).length, 2);
  assert.equal((run.state.draft as { adAccountId: string }).adAccountId, "local");
  assert.match(String(run.state.notice), /temporairement/);
  run.apply(provider, { connected: false, connectionStatus: "needs_update", accounts: [], selectedAccountId: "saved", selectedAccountAvailable: false }, true);
  assert.equal(run.state.connected, false);
  assert.equal(run.state.connectionStatus, "needs_update");
  assert.equal(run.state.configuredAccountId, "saved", "une révocation conserve l’association à reconnecter");
});

for (const provider of ["google", "meta"]) test(`${provider} : rafraîchir conserve le choix local et la Page/Instagram déjà associés`, () => {
  const run = providerHarness(provider);
  const pages = provider === "meta" ? [{ id: "page", name: "Page connue", instagramUserId: "instagram" }] : [];
  run.apply(provider, { connected: true, accounts: [run.account("saved"), run.account("local")], selectedAccountId: "saved", selectedAccountAvailable: true, pages, selectedPageId: provider === "meta" ? "page" : "", selectedPageAvailable: true }, false);
  assert.equal((run.state.draft as { adAccountId: string }).adAccountId, "local");
  assert.equal(run.state.configuredAccountId, "saved", "le choix local n’est pas associé implicitement");
  if (provider === "meta") {
    assert.deepEqual(run.state.pages, pages);
    assert.equal((run.state.draft as { pageId: string }).pageId, "page");
    assert.equal(run.state.configuredPageId, "page");
    run.apply(provider, { connected: true, error: "Service indisponible", accounts: [], pages: [] }, false);
    assert.deepEqual(run.state.pages, pages, "un refresh échoué garde la Page et son Instagram vérifiés");
  }
});

test("un statut externe révoqué sur HTTP503 n’est pas masqué par l’ancien snapshot vert", async () => {
  const readJson = actual("readJson", {});
  const readStatus = actual("readAdsConnectionStatus", { readJson });
  const result = await readStatus(Response.json({ connected: false, status: "needs_update", selectedAccountId: "saved", error: "Autorisation révoquée" }, { status: 503 }));
  assert.equal(result.connected, false);
  assert.equal(result.status, "needs_update");
  await assert.rejects(readStatus(Response.json({ connected: true, status: "connected", error: "Provider indisponible" }, { status: 503 })), /Provider indisponible/);
});

for (const channel of ["linkedin", "tiktok", "pinterest", "x"]) test(`${channel} : refresh silencieux conserve le snapshot puis applique la révocation`, async () => {
  const readJson = actual("readJson", {});
  const readStatus = actual("readAdsConnectionStatus", { readJson });
  let state = { [channel]: { load: "ready", configured: true, connected: true, status: "connected", selectedAccountId: "saved", selectedAccountName: "Compte connu", publicationEnabled: true, error: "" } };
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  const refresh = actual("refreshExternalStatus", {
    useCallback: (fn: unknown) => fn,
    externalStatusRequests: { current: { [channel]: 0 } },
    setExternalStatuses: (update: (current: typeof state) => typeof state) => { state = update(state); },
    setConnectionSnapshots: () => {},
    fetch: () => pending,
    readAdsConnectionStatus: readStatus,
  });
  const running = refresh(channel, { silent: true });
  assert.equal(state[channel].load, "ready");
  assert.equal(state[channel].connected, true);
  assert.equal(state[channel].selectedAccountId, "saved");
  if (channel === "linkedin") assert.equal(state[channel].publicationEnabled, false, "le badge ne vaut pas autorisation de publier");
  release(Response.json({ connected: false, status: "needs_update", selectedAccountId: "saved" }, { status: 503 }));
  await running;
  assert.equal(state[channel].connected, false);
  assert.equal(state[channel].status, "needs_update");
  assert.equal(state[channel].publicationEnabled, false);
});

for (const channel of ["linkedin", "tiktok", "pinterest", "x"]) test(`${channel} : le cache conserve la sélection au reopen puis pendant un refresh`, async () => {
  const accounts = [{ id: "saved", name: "Persisté", currency: "EUR" }, { id: "local", name: "Choix local", currency: "EUR" }];
  const cache = { current: { [channel]: { accounts, choice: "local", loaded: true, failed: false } } };
  const state: Record<string, unknown> = { externalStatuses: { [channel]: { connected: true, selectedAccountId: "saved", publicationEnabled: false, missingScopes: ["rw_ads"] } } };
  let calls = 0;
  let release!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => { release = resolve; });
  const scope: Record<string, unknown> = {
    useCallback: (fn: unknown) => fn, externalAccountsCache: cache, externalAccountsRequest: { current: 0 },
    refreshExternalStatus: () => {}, readJson: actual("readJson", {}), fetch: () => { calls += 1; return response; },
  };
  for (const key of ["externalAccounts", "externalAccountChoice", "externalAccountsLoadFailed", "externalAccountsLoading", "externalStatuses", "externalError"]) {
    scope[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value: unknown) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  }
  const load = actual("loadExternalAccounts", scope);
  await load(channel, "saved");
  assert.equal(calls, 0);
  assert.equal(state.externalAccountChoice, "local");
  assert.deepEqual(state.externalAccounts, accounts);
  const pending = load(channel, "saved", true);
  assert.equal(calls, 1);
  assert.equal(state.externalAccountChoice, "local");
  release(Response.json({ accounts, selectedAccountId: "saved", publicationEnabled: true }));
  await pending;
  assert.equal(state.externalAccountChoice, "local");
  const status = (state.externalStatuses as Record<string, { connected: boolean; selectedAccountId: string; publicationEnabled: boolean; missingScopes: string[] }>)[channel];
  assert.equal(status.connected, true);
  assert.equal(status.selectedAccountId, "saved");
  assert.deepEqual(status.missingScopes, ["rw_ads"], "la découverte compte ne peut effacer une autorisation manquante");
  if (channel === "linkedin") assert.equal(status.publicationEnabled, false);
});

test("LinkedIn : connexion connue reste visible mais les autorisations manquantes restent à compléter", () => {
  const file = ts.createSourceFile("ExternalAdsConnectionSettings.tsx", readFileSync(new URL("../app/dashboard/ads/ExternalAdsConnectionSettings.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const load of ["ready", "loading", "error"]) {
    for (const missingScopes of [[], ["rw_ads"]]) {
      const scope: Record<string, unknown> = { channel: "linkedin", locked: false, status: { connected: true, configured: true, status: "connected", load, missingScopes } };
      for (const key of ["needsReconnect", "linkedinManagementMissing", "connectionDisplayStatus", "connectionStatusLabel"]) scope[key] = actual(key, scope, file);
      assert.equal(scope.connectionDisplayStatus, missingScopes.length ? "needs_update" : "connected");
      assert.equal(scope.connectionStatusLabel, missingScopes.length ? "Autorisations à compléter" : undefined);
      scope.locked = true;
      scope.connectionDisplayStatus = actual("connectionDisplayStatus", scope, file);
      scope.connectionStatusLabel = actual("connectionStatusLabel", scope, file);
      assert.equal(scope.connectionDisplayStatus, "disconnected");
      assert.equal(scope.connectionStatusLabel, "Verrouillé");
    }
  }
});

test("Meta : une Page connue est visible avant découverte, Instagram n’est affirmé qu’après vérification", () => {
  const file = ts.createSourceFile("AdsConnectionSettings.tsx", readFileSync(new URL("../app/dashboard/ads/AdsConnectionSettings.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(actual("identityReady", { identityConfigured: true, metaNeedsInstagramIdentity: false, savedPage: undefined }, file), true);
  assert.equal(actual("identityReady", { identityConfigured: true, metaNeedsInstagramIdentity: true, savedPage: undefined }, file), false);
  assert.equal(actual("identityReady", { identityConfigured: true, metaNeedsInstagramIdentity: true, savedPage: { instagramUserId: "instagram" } }, file), true);
  assert.equal(actual("identityReady", { identityConfigured: false, metaNeedsInstagramIdentity: true, savedPage: { instagramUserId: "instagram" } }, file), false);
});
