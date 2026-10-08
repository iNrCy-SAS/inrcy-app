import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { adsDraftHasKeywordsStep, adsDraftHasMediaStep, adsDraftStepKeys, adsDraftValidationStep } from "../lib/adsDraftNavigation.ts";
import { tikTokAdsResourcesConsentKey, type TikTokAdsResources } from "../lib/adsTikTokResources.ts";

const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualFunction(name: string, scope: Record<string, unknown>) {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node; ts.forEachChild(node, visit); }; visit(source);
  assert.ok(declaration, name);
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(...Object.values(scope));
}
function actualElement(marker: string) {
  let found: ts.JsxElement | ts.JsxSelfClosingElement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = ts.isJsxElement(node) ? node.openingElement.attributes.properties : node.attributes.properties;
      if (attributes.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === marker)) found = node;
    }
    ts.forEachChild(node, visit);
  }; visit(source); assert.ok(found, marker); return found;
}
function actualCheckbox(marker: string, scope: Record<string, unknown>) {
  const element = actualElement(marker); let input: ts.JsxSelfClosingElement | undefined;
  const visit = (node: ts.Node) => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "input") input = node; ts.forEachChild(node, visit); }; visit(element); assert.ok(input, marker);
  const evaluate = (name: string) => {
    const attribute = input!.attributes.properties.find((value) => ts.isJsxAttribute(value) && value.name.getText(source) === name) as ts.JsxAttribute;
    assert.ok(attribute && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression, `${marker}/${name}`);
    const compiled = ts.transpileModule(`const value = (${attribute.initializer.expression.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(scope), `${compiled}\nreturn value;`)(...Object.values(scope));
  };
  return { disabled: evaluate("disabled"), change: evaluate("onChange") as (event: unknown) => void };
}

test("X and TikTok separate budget, geography, audience and bidding while keeping only needed keyword and media steps", () => {
  for (const creationMode of ["manual", "inrcy"] as const) {
    const prefix = ["project", ...(creationMode === "inrcy" ? ["analysis"] : []), "foundations", "budget", "geography", "targeting", "bidding"];
    const x = { provider: "x" as const, campaignType: "generic" as const, creationMode, channelSettings: { schemaVersion: 1 as const, channel: "x" as const, objective: "website_traffic" as const, format: "text" as const, targetingMode: "broad" as const } };
    assert.deepEqual(adsDraftStepKeys(x), [...prefix, "creative", "delivery", "validation"]);
    assert.deepEqual(adsDraftStepKeys({ ...x, channelSettings: { ...x.channelSettings, format: "image", targetingMode: "keywords" } }), [...prefix, "keywords", "creative", "media", "delivery", "validation"]);
    const tiktok = { provider: "tiktok" as const, campaignType: "generic" as const, creationMode };
    assert.deepEqual(adsDraftStepKeys(tiktok), [...prefix, "creative", "identity", "media", "delivery", "validation"]);
    for (const legacy of [{ ...x, channelSettings: undefined }, tiktok]) {
      const keys = adsDraftStepKeys(legacy), validation = adsDraftValidationStep(legacy);
      assert.equal(keys[validation], "validation"); assert.deepEqual(keys.slice(0, validation + 1), keys);
    }
    assert.equal(adsDraftHasKeywordsStep(tiktok), false); assert.equal(adsDraftHasMediaStep(tiktok), true);
  }
});
test("Actual X and TikTok visible labels stay aligned with semantic navigation for both assisted and manual drafts", () => {
  const variables = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer); ts.forEachChild(node, visit); }; visit(source);
  for (const channelId of ["x", "tiktok"] as const) for (const creationPath of ["manual", "inrcy"] as const) {
    const draft = { provider: channelId, campaignType: "generic" as const, creationMode: creationPath, ...(channelId === "x" ? { channelSettings: { schemaVersion: 1 as const, channel: "x" as const, objective: "website_traffic" as const, format: "text" as const, targetingMode: "broad" as const } } : {}) };
    const scope: Record<string, unknown> = { channelId, creationPath, draft, stepKeys: adsDraftStepKeys(draft), adsDraftHasKeywordsStep, adsDraftHasMediaStep };
    for (const name of ["keywordStepName", "hasMediaStep", "hasKeywordsStep", "mediaStepName", "automatedChannelStepNames", "manualStepNames", "inrcyStepNames", "linkedInStepLabels", "googleStepLabels", "channelStepLabels", "stepNames", "budgetStep", "geographyStep", "targetingStep", "biddingStep", "creativeStep", "identityStep", "mediaStep", "deliveryStep", "validationStep"]) {
      const expression = variables.get(name); assert.ok(expression, name);
      const compiled = ts.transpileModule(`const value = (${expression.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      scope[name] = new Function(...Object.keys(scope), `${compiled}\nreturn value;`)(...Object.values(scope));
    }
    assert.deepEqual(scope.stepNames, ["Votre projet", ...(creationPath === "inrcy" ? ["Analyse iNrCy"] : []), "Campagne", "Budget et calendrier", "Zones géographiques", "Audience et placements", "Enchères et optimisation", "Format et annonce", ...(channelId === "tiktok" ? ["Identité TikTok", "Vidéo"] : []), "Destination et suivi", "Vérifier et valider"]);
    for (const key of ["budget", "geography", "targeting", "bidding", "creative", "identity", "media", "delivery", "validation"] as const) assert.equal(scope[key + "Step"], adsDraftStepKeys(draft).indexOf(key));
  }
});
test("Prepared budget and content confirmations may be checked in either order independently of the destination", () => {
  for (const order of [["budget", "content", "destination"], ["destination", "content", "budget"]]) {
    let budget = "", content = "", destination = "";
    const key = "exact-draft-and-resources";
    const scope = { busy: null, preparedBudgetError: "", preparedDraftKey: key, preparedBudgetApprovalKey: budget, preparedContentApprovalKey: content, destinationReview: { valid: true }, draft: { destinationUrl: "https://inrcy.com/" }, setPreparedBudgetApprovalKey: (value: string) => { budget = value; }, setPreparedContentApprovalKey: (value: string) => { content = value; }, setConfirmedDestinationUrl: (value: string) => { destination = value; } };
    for (const field of order) {
      const checkbox = actualCheckbox(`data-prepared-${field}-confirmation`, scope);
      assert.equal(checkbox.disabled, false, field); checkbox.change({ target: { checked: true } });
    }
    assert.equal(budget, key); assert.equal(content, key); assert.equal(destination, "https://inrcy.com/");
  }
});
test("Prepared confirmations belong to the final review, whose sole validation waits for all required choices", () => {
  for (const marker of ["data-prepared-budget-confirmation", "data-prepared-content-confirmation", "data-prepared-destination-confirmation"]) {
    let ancestor: ts.Node | undefined = actualElement(marker);
    while (ancestor && !(ts.isJsxElement(ancestor) && ancestor.openingElement.tagName.getText(source) === "section")) ancestor = ancestor.parent;
    assert.ok(ancestor && ts.isJsxElement(ancestor));
    const hidden = ancestor.openingElement.attributes.properties.find((value) => ts.isJsxAttribute(value) && value.name.getText(source) === "hidden") as ts.JsxAttribute;
    assert.match(hidden.getText(source), /step !== validationStep/);
  }
  const final = actualElement("data-prepared-final-validation");
  const attributes = ts.isJsxElement(final) ? final.openingElement.attributes.properties : final.attributes.properties;
  const disabled = attributes.find((value) => ts.isJsxAttribute(value) && value.name.getText(source) === "disabled") as ts.JsxAttribute;
  assert.ok(disabled.initializer && ts.isJsxExpression(disabled.initializer) && disabled.initializer.expression);
  const compiled = ts.transpileModule(`const disabled = (${disabled.initializer.expression.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const base = { busy: null, preparedReviewIssues: [], preparedBudgetApprovalKey: "exact", preparedContentApprovalKey: "exact", preparedDraftKey: "exact", destinationReview: { required: true, confirmed: true } };
  const check = (patch: Record<string, unknown>) => { const scope = { ...base, ...patch }; return new Function(...Object.keys(scope), `${compiled}\nreturn disabled;`)(...Object.values(scope)); };
  assert.equal(check({}), false);
  for (const patch of [{ busy: "save" }, { preparedReviewIssues: ["Média à vérifier"] }, { preparedBudgetApprovalKey: "older" }, { preparedContentApprovalKey: "older" }, { destinationReview: { required: true, confirmed: false } }]) assert.equal(check(patch), true);
  const paidButtons: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button" && node.openingElement.attributes.properties.some((value) => ts.isJsxAttribute(value) && value.name.getText(source) === "onClick" && value.getText(source).includes("openLaunchDialog("))) paidButtons.push(node);
    ts.forEachChild(node, visit);
  }; visit(source); assert.equal(paidButtons.length, 1);
  let ancestor: ts.Node | undefined = paidButtons[0].parent;
  while (ancestor && !(ts.isJsxExpression(ancestor) && ancestor.getText(source).includes("!preparedOnlyChannel"))) ancestor = ancestor.parent;
  assert.ok(ancestor, "The paid launch control is absent from X/TikTok preparation, not merely disabled");
});
test("Completed assisted X and TikTok proposals open their real review once, after media preparation finishes", () => {
  let callback: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isArrowFunction(node) && ts.isCallExpression(node.parent) && node.parent.expression.getText(source) === "useEffect" && node.getText(source).includes("reviewedPlanRevision.current")) callback = node;
    ts.forEachChild(node, visit);
  }; visit(source); assert.ok(callback);
  const compiled = ts.transpileModule(`const callback = (${callback.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const provider of ["x", "tiktok"] as const) {
    const draft = { provider, campaignType: "generic" as const, creationMode: "inrcy" as const };
    const reached: unknown[] = [], steps: number[] = [], reviewedPlanRevision = { current: 0 }, planGenerationRevision = { current: 1 };
    const base = { channelId: provider, creating: true, creationPath: "inrcy", step: 1, analysisStep: 1, planProgress: 100, busy: null, planError: "", reviewedPlanRevision, planGenerationRevision, draft, adsDraftValidationStep, adsDraftStepKeys, setStep: (value: number) => steps.push(value), setReachedStepKeys: (value: unknown) => reached.push(value) };
    const run = (patch: Record<string, unknown> = {}) => { const scope = { ...base, ...patch }; new Function(...Object.keys(scope), `${compiled}\ncallback();`)(...Object.values(scope)); };
    for (const patch of [{ planProgress: 99 }, { busy: "plan" }, { planError: "Média à compléter" }]) run(patch);
    assert.deepEqual(steps, []); run(); assert.deepEqual(steps, [adsDraftValidationStep(draft)]); assert.deepEqual(reached, [adsDraftStepKeys(draft)]);
    run(); run({ step: 4 }); assert.equal(steps.length, 1);
    planGenerationRevision.current = 2; run(); assert.equal(steps.length, 2);
  }
});

function harness(options: { channel?: "x" | "tiktok"; missing?: "budget" | "content" | "destination"; issues?: string[]; resources?: boolean; resourceChange?: boolean; editDuring?: "resources" | "save"; revokeDuring?: "resources" | "save"; savedId?: string; missingSavedId?: boolean } = {}) {
  const channelId = options.channel || "x";
  const draft = { provider: channelId, name: "Découvrir iNrCy", primaryText: "Annonce relue", destinationUrl: "https://inrcy.com/", dailyBudgetEuros: 25, preparedDeliverySettings: { budget: { type: "total", totalEuros: 200, startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-21T21:59:00Z" }, bidding: { strategy: "automatic", amountEuros: null } } };
  let currentDraft = draft, dirty = true;
  const resources = options.resources ? { selectedAccountId: "123456789", account: { id: "123456789", name: "iNrCy", currency: "EUR", status: "STATUS_ENABLE", timezone: "Europe/Paris" }, identities: [{ id: "identity-a", type: "TT_USER", displayName: "iNrCy" }], identityRead: { status: "verified" }, readiness: { advertiserRead: true, campaignWrite: "unverified", publicationReady: false, blockers: ["campaign_write_unverified", "publication_adapter_unavailable"] }, publicationEnabled: false, verifiedAt: "2026-10-08T10:00:00Z" } as unknown as TikTokAdsResources : null;
  const key = JSON.stringify({ draft, resources: channelId === "tiktok" ? tikTokAdsResourcesConsentKey(resources) : null });
  const latest = { current: { draftKey: key, budgetKey: options.missing === "budget" ? "" : key, contentKey: options.missing === "content" ? "" : key, destination: options.missing === "destination" ? "" : draft.destinationUrl } };
  const requests: { url: string; method: string; body?: string }[] = [], notices: string[] = [], ids: string[] = [];
  const mutate = (phase: "resources" | "save") => {
    if (options.editDuring === phase) { currentDraft = { ...currentDraft, primaryText: "Modification à conserver" }; dirty = true; latest.current = { draftKey: "changed-json", budgetKey: "", contentKey: "", destination: draft.destinationUrl }; }
    if (options.revokeDuring === phase) latest.current.budgetKey = "";
  };
  const scope = { preparedOnlyChannel: true, busy: null, preparedDraftKey: key, preparedBudgetApprovalKey: latest.current.budgetKey, preparedContentApprovalKey: latest.current.contentKey, destinationReview: { required: true, valid: true, confirmed: options.missing !== "destination" }, preparedReviewIssues: options.issues || [], draft, channelId, channelMeta: { label: channelId === "x" ? "X Ads" : "TikTok Ads" }, effectiveTikTokResources: resources, tikTokAdsResourcesConsentKey, preparedLatestReview: latest, savedId: options.savedId || null,
    parseAdsCampaignInput: (value: unknown, purpose: unknown) => { assert.deepEqual(purpose, { purpose: "draft" }); return { draft: structuredClone(value), error: null }; },
    setNotice: (value: string) => notices.push(value), setBusy: () => {}, setSavedId: (value: string) => ids.push(value), setDirty: (value: boolean) => { dirty = value; }, setDraftsRevision: () => {},
    setDraft: () => { throw new Error("Unchanged or abandoned preparation must not overwrite the editor draft"); }, readJson: async (value: unknown) => value,
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      requests.push({ url, method: init?.method || "GET", body: init?.body });
      if (url.startsWith("/api/ads/tiktok/resources?")) { mutate("resources"); return { ...resources, ...(options.resourceChange ? { identities: [{ id: "identity-b", type: "TT_USER", displayName: "Nouvelle identité" }] } : {}), verifiedAt: "2026-10-08T10:05:00Z" }; }
      assert.equal(url, "/api/ads/campaigns", "Preparation must not call any provider publication endpoint"); assert.equal(init?.method, "POST"); mutate("save");
      return { campaign: options.missingSavedId ? {} : { id: options.savedId || "draft-a" } };
    },
  };
  return { run: () => actualFunction("validatePreparedDraft", scope)(), requests, notices, ids, latest, draft, state: () => ({ currentDraft, dirty }) };
}
for (const channel of ["x", "tiktok"] as const) {
  test(`Prepared ${channel} validation refuses every missing final confirmation without an API request`, async () => {
    for (const missing of ["budget", "content", "destination"] as const) { const check = harness({ channel, missing }); await check.run(); assert.deepEqual(check.requests, []); assert.deepEqual(check.ids, []); }
    const invalid = harness({ channel, issues: ["Média à compléter"] }); await invalid.run(); assert.deepEqual(invalid.requests, []);
  });
  test(`Agreed ${channel} preparation persists its exact total once as a draft, without a provider mutation`, async () => {
    const check = harness({ channel, resources: channel === "tiktok", savedId: "existing-draft" }); await check.run();
    const saved = check.requests.filter((request) => request.method === "POST"); assert.equal(saved.length, 1);
    assert.deepEqual(JSON.parse(saved[0].body!), { ...check.draft, id: "existing-draft" }); assert.deepEqual(check.ids, ["existing-draft"]);
    assert.equal(check.state().dirty, false); assert.match(check.notices.at(-1) || "", /aucune dépense/);
  });
}
test("TikTok account or identity drift cancels preparation before save, while a verified-at refresh is harmless", async () => {
  const changed = harness({ channel: "tiktok", resources: true, resourceChange: true }); await changed.run();
  assert.equal(changed.requests.length, 1); assert.deepEqual(changed.ids, []); assert.equal(changed.state().dirty, true); assert.match(changed.notices.at(-1) || "", /identités TikTok ont changé/);
  const stable = harness({ channel: "tiktok", resources: true }); await stable.run(); assert.equal(stable.requests.length, 2); assert.deepEqual(stable.ids, ["draft-a"]);
});
test("Editing or revoking consent during TikTok resource verification prevents saving and preserves local changes", async () => {
  for (const mutation of [{ editDuring: "resources" as const }, { revokeDuring: "resources" as const }]) {
    const check = harness({ channel: "tiktok", resources: true, ...mutation }); await check.run();
    assert.equal(check.requests.length, 1); assert.deepEqual(check.ids, []); assert.equal(check.state().dirty, true);
    if (mutation.editDuring) assert.equal(check.state().currentDraft.primaryText, "Modification à conserver");
  }
});
test("Editing or revoking consent while a preparation POST is pending never marks newer edits validated", async () => {
  for (const mutation of [{ editDuring: "save" as const }, { revokeDuring: "save" as const }]) {
    const check = harness({ ...mutation }); await check.run();
    assert.equal(check.requests.length, 1); assert.deepEqual(check.ids, []); assert.equal(check.state().dirty, true);
    if (mutation.editDuring) assert.equal(check.state().currentDraft.primaryText, "Modification à conserver");
    assert.match(check.notices.at(-1) || "", /nouvelles modifications restent à valider/);
  }
});
test("An unconfirmed preparation save response cannot mark the draft validated", async () => {
  const check = harness({ missingSavedId: true }); await check.run(); assert.deepEqual(check.ids, []); assert.equal(check.state().dirty, true); assert.match(check.notices.at(-1) || "", /pas été confirmé/);
});
