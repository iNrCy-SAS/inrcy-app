import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findAll(predicate: (node: ts.Node) => boolean, root: ts.Node = source): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

function variable(name: string) {
  const declaration = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name)[0] as ts.VariableDeclaration | undefined;
  assert.ok(declaration?.initializer, `${name} must exist`);
  return declaration.initializer;
}

function expression(node: ts.Node, scope: Record<string, unknown>) {
  return new Function(...Object.keys(scope), `return (${node.getText(source)});`)(...Object.values(scope));
}

function dialogGate(name: string, scope: Record<string, unknown>): boolean {
  const attribute = findAll((node) => ts.isJsxAttribute(node) && node.name.getText(source) === name)[0] as ts.JsxAttribute;
  assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression);
  return expression(attribute.initializer.expression, scope);
}

function actualFunction(name: string, scope: Record<string, unknown>) {
  const declaration = findAll((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)[0];
  assert.ok(declaration, `${name} must exist`);
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(...Object.values(scope));
}

function gateScope(channelId: string, livePublishingEnabled: boolean, publicationEnabled: unknown, load = "ready") {
  const scope: Record<string, unknown> = {
    channelId,
    livePublishingEnabled,
    externalStatuses: { linkedin: { load, publicationEnabled } },
    demoDialog: { channelId },
    linkedInPreflight: { account: { canServeCampaigns: true, canManageCampaigns: true } },
    selectedLinkedInCampaignGroup: { status: "ACTIVE" },
  };
  scope.linkedInPublishingEnabled = expression(variable("linkedInPublishingEnabled"), scope);
  return scope;
}

test("LinkedIn uses its dedicated gate independently from the Meta/Google flag in opening and both launch modes", () => {
  for (const global of [false, true]) {
    for (const dedicated of [false, true]) {
      for (const channel of ["linkedin", "meta", "google", "pinterest"]) {
        const scope = gateScope(channel, global, dedicated);
        const expected = channel === "linkedin" ? dedicated : channel === "pinterest" || global;
        assert.equal(expression(variable("channelPublishingEnabled"), scope), expected, `${channel}, global=${global}, dedicated=${dedicated}`);
        assert.equal(dialogGate("activeEnabled", scope), expected);
        assert.equal(dialogGate("pausedEnabled", scope), expected);
      }
    }
  }
});

test("SSR snapshots, unavailable status and non-boolean approvals cannot authorize LinkedIn", () => {
  const snapshot = actualFunction("externalStatusFromSnapshot", {})({ status: "connected", accountId: "123", accountLabel: "LinkedIn" });
  assert.equal(snapshot.publicationEnabled, false);
  for (const load of ["idle", "loading", "error"]) {
    const scope = gateScope("linkedin", true, true, load);
    assert.equal(expression(variable("channelPublishingEnabled"), scope), false);
    assert.equal(dialogGate("activeEnabled", scope), false);
    assert.equal(dialogGate("pausedEnabled", scope), false);
  }
  for (const approval of [undefined, null, "true", 1, false]) {
    assert.equal(expression(variable("channelPublishingEnabled"), gateScope("linkedin", true, approval)), false);
  }
});

test("an enabled LinkedIn gate still requires manageable resources and an ACTIVE parent to serve", () => {
  const scope = gateScope("linkedin", false, true);
  scope.linkedInPreflight = { account: { canServeCampaigns: false, canManageCampaigns: true } };
  assert.equal(dialogGate("activeEnabled", scope), false);
  assert.equal(dialogGate("pausedEnabled", scope), true);
  scope.linkedInPreflight = { account: { canServeCampaigns: true, canManageCampaigns: true } };
  scope.selectedLinkedInCampaignGroup = { status: "PAUSED" };
  assert.equal(dialogGate("activeEnabled", scope), false);
  assert.equal(dialogGate("pausedEnabled", scope), true);
  scope.linkedInPreflight = null;
  assert.equal(dialogGate("activeEnabled", scope), false);
  assert.equal(dialogGate("pausedEnabled", scope), false);
});

function statusUpdaters(owner: string) {
  return findAll((node) => ts.isCallExpression(node) && node.expression.getText(source) === "setExternalStatuses", variable(owner))
    .map((node) => (node as ts.CallExpression).arguments[0]);
}

test("only status verification owns the LinkedIn gate; silent refresh revokes it and account discovery cannot overwrite it", () => {
  const current = { linkedin: { load: "ready", publicationEnabled: true } };
  const [start, success, failure] = statusUpdaters("refreshExternalStatus");
  const refreshing = expression(start, { channel: "linkedin", options: { silent: true } })(current);
  assert.equal(refreshing.linkedin.publicationEnabled, false);
  const verified = expression(success, {
    channel: "linkedin", data: { publicationEnabled: true }, status: "connected", selectedAccountId: "123",
    selectedAccountName: "LinkedIn", scopes: [], missingScopes: [],
  })(refreshing);
  assert.equal(verified.linkedin.publicationEnabled, true);
  const unavailable = expression(failure, { channel: "linkedin", error: new Error("unavailable") })(refreshing);
  assert.equal(unavailable.linkedin.load, "error");
  assert.equal(unavailable.linkedin.publicationEnabled, false);
  const [accounts] = statusUpdaters("loadExternalAccounts");
  for (const approved of [false, true]) {
    const updated = expression(accounts, { channel: "linkedin", data: { publicationEnabled: !approved } })({ linkedin: { load: "ready", publicationEnabled: approved } });
    assert.equal(updated.linkedin.publicationEnabled, approved, "account results must not grant or revoke the status gate");
  }
});

test("opening and confirming a disabled LinkedIn launch return before any account, draft or publish request", async () => {
  let requests = 0;
  const notices: string[] = [];
  const scope = {
    channelId: "linkedin", channelPublishingEnabled: false, channelMeta: { label: "LinkedIn Ads" },
    isAdsDraftAccountChannel: () => true, busy: null, demoSubmissionRef: { current: false },
    linkedInSelectionsReady: true, linkedInComplianceReady: true, demoDialog: null,
    setNotice: (notice: string) => notices.push(notice), setBusy: () => {}, setDemoDialog: () => {},
    creating: true, step: 5, validationStep: 5,
    fetch: () => { requests += 1; throw new Error("unexpected request"); },
  };
  await actualFunction("openLaunchDialog", scope)();
  await actualFunction("confirmCampaignLaunch", { ...scope, demoDialog: { mode: "confirm", channelId: "linkedin" } })();
  assert.equal(requests, 0);
  assert.equal(notices.filter((notice) => notice.includes("momentanément verrouillé")).length, 2);
});
