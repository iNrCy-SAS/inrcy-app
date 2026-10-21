import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { adsDraftStepKeys } from "../lib/adsDraftNavigation.ts";
import { adsNativeDeliveryIssueStep, type AdsLaunchStepMap } from "../lib/adsLaunchReadiness.ts";
import { preparedAdsReviewDetails, preparedAdsReviewIssues } from "../lib/adsPreparedReview.ts";
import { preparedNativeBlockerLabel, preparedNativeBlockerStep } from "../lib/adsPreparedNativeClient.ts";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";

const require = createRequire(import.meta.url);
const sourceText = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("AdsClient.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (!result && predicate(node)) result = node; ts.forEachChild(node, visit); };
  visit(source); assert.ok(result); return result;
}
function variable(name: string) {
  const node = find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name) as ts.VariableDeclaration;
  assert.ok(node.initializer); return node;
}
function evaluate(name: string, scope: Record<string, unknown>) {
  const compiled = ts.transpileModule(`return (${variable(name).initializer!.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), compiled)(...Object.values(scope));
}
const warningStatements = sourceText.slice(variable("stepWarningMessages").parent.parent.getStart(source), variable("preparedNativeReady").parent.parent.getStart(source));
const warningsBody = ts.transpileModule(warningStatements + "\nreturn stepWarningMessages;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function warningMap(scope: Record<string, unknown> = {}): Map<number, string> {
  const complete = {
    incompleteLaunchSteps: [], linkedInLaunchReadinessReason: "", linkedInComplianceReady: true,
    linkedInSelectionsReady: true, linkedInReadinessIssue: null, validationStep: 10,
    googleLaunchReadinessIssue: null, pinterestLaunchReadinessIssue: null, metaLaunchReadinessIssue: null,
    openaiLaunchReadinessIssue: null, preparedReviewDetails: [], displayedStepKeys: [], preparedOnlyChannel: false,
    preparedNativeCheck: null, channelId: "meta", preparedNativeBlockerLabel, preparedNativeBlockerStep, ...scope,
  };
  return new Function(...Object.keys(complete), warningsBody)(...Object.values(complete));
}
const stepper = find((node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "nav"
  && node.openingElement.attributes.getText(source).includes("styles.stepper"));
const icon = find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "CampaignStepWarning");
const labelConstant = find((node) => ts.isVariableStatement(node) && node.declarationList.declarations[0].name.getText(source) === "PINTEREST_STEPPER_LABELS");
const fixtureSource = `
const styles=new Proxy({}, {get:(_,key)=>String(key)});
${icon.getText(source)}
${labelConstant.getText(source)}
exports.Stepper=function Stepper(props) {
  const {displayedStepKeys,stepWarningMessages,compactScreen=false,creationPath="inrcy",reachedStepKeys=displayedStepKeys,channelId="meta"}=props;
  const displayedStepNames=displayedStepKeys, step=displayedStepKeys.length-1, busy=null, navigateToStep=()=>{};
  return ${stepper.getText(source)};
};`;
const compiled = ts.transpileModule(fixtureSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const fixture: { Stepper?: (props: Record<string, unknown>) => ReturnType<typeof createElement> } = {};
new Function("exports", "require", compiled)(fixture, require);
function render(props: Record<string, unknown>) { return renderToStaticMarkup(createElement(fixture.Stepper!, props)); }

for (const provider of ["google", "meta", "linkedin", "pinterest", "openai", "tiktok", "x"] as const) {
  for (const creationMode of ["manual", "inrcy"] as const) {
    test(`${provider} ${creationMode}: final readiness warnings mark the matching number and label, including compact screens`, () => {
      const keys = adsDraftStepKeys({ provider, creationMode, campaignType: provider === "google" ? "search" : "generic" });
      const numbers = ["geography", "creative", "budget"].map((key) => keys.indexOf(key as typeof keys[number]) + 1);
      const warnings = warningMap({ incompleteLaunchSteps: numbers, displayedStepKeys: keys });
      const markup = render({ displayedStepKeys: keys, channelId: provider, stepWarningMessages: warnings });
      assert.equal((markup.match(/data-incomplete="true"/g) || []).length, 3);
      assert.equal((markup.match(/class="studioStepBubbleWarning"/g) || []).length, 3);
      assert.equal((markup.match(/class="studioStepNameWarning"/g) || []).length, 3);
      for (const number of numbers) assert.match(markup, new RegExp(`aria-label="${number}\\. ${keys[number - 1]} · Informations à compléter`));
      const compact = render({ displayedStepKeys: keys, stepWarningMessages: warnings, compactScreen: true });
      assert.equal((compact.match(/class="studioStepBubbleWarning"/g) || []).length, 3);
      assert.doesNotMatch(compact, /studioStepNameWarning/);
      const corrected = render({ displayedStepKeys: keys, stepWarningMessages: warningMap() });
      assert.doesNotMatch(corrected, /data-incomplete|studioStepBubbleWarning|studioStepNameWarning/);
    });
  }
}

test("warnings do not flag untouched steps or unlock navigation to them", () => {
  const keys = ["project", "foundations", "geography"];
  const markup = render({ displayedStepKeys: keys, reachedStepKeys: ["project"], stepWarningMessages: warningMap({ incompleteLaunchSteps: [2] }) });
  assert.doesNotMatch(markup, /data-incomplete|studioStepBubbleWarning/);
  assert.match(markup, /disabled=""[^>]*aria-label="2\. foundations"/);
});

test("verified Meta issues carry the same detail to the final message, the step tooltip and its accessible label", () => {
  const base = { channelId: "meta", effectiveMetaResources: {}, metaResourcesLoad: "ready", foundationsStep: 2, geographyStep: 3,
    targetingStep: 4, metaResourcesError: "", metaGeoReady: false, metaGeoState: { key: "zones", error: "Une zone du brief reste à confirmer." }, metaGeoKey: "zones" };
  const issue = evaluate("metaLaunchReadinessIssue", base);
  assert.equal(evaluate("metaLaunchReadinessReason", { metaLaunchReadinessIssue: issue }), base.metaGeoState.error);
  const warnings = warningMap({ metaLaunchReadinessIssue: issue });
  assert.equal(warnings.get(4), base.metaGeoState.error);
  const markup = render({ displayedStepKeys: ["project", "analysis", "foundations", "geography"], stepWarningMessages: warnings });
  assert.match(markup, /title="Une zone du brief reste à confirmer\."/);
  assert.match(markup, /aria-label="4\. geography · Une zone du brief reste à confirmer\."/);
  assert.equal(warnings.size, 1);
});

test("native validation messages use the same step mapping as readiness", () => {
  const steps: AdsLaunchStepMap = { foundations: 3, geography: 4, targeting: 5, bidding: 6, keywords: 0, creative: 7, media: 8, delivery: 9, budget: 10, validation: 11 };
  assert.equal(adsNativeDeliveryIssueStep("meta", "Vérifiez l’âge minimum.", steps), 5);
  assert.equal(adsNativeDeliveryIssueStep("meta", "Renseignez l’enchère.", steps), 6);
  assert.equal(adsNativeDeliveryIssueStep("openai", "Vérifiez les plateformes de diffusion.", steps), 9);
  assert.equal(adsNativeDeliveryIssueStep("pinterest", "Vérifiez le budget.", steps), 10);
});

test("X and TikTok preparation lists and navigation triangles come from the same detailed issues", () => {
  for (const provider of ["x", "tiktok"] as const) {
    const draft = { provider, name: "", offer: "", targetLocations: [], targetAudiences: [], primaryText: "", creativeUrl: "", imageUrl: "", creativeType: "image", conversionLocation: "website", destinationUrl: "", dailyBudgetEuros: 0, endDate: "", keywords: [] } as unknown as AdsCampaignInput;
    const details = preparedAdsReviewDetails(draft, Date.parse("2026-10-21T12:00:00Z"));
    assert.deepEqual(preparedAdsReviewIssues(draft, Date.parse("2026-10-21T12:00:00Z")), details.map((issue) => issue.message));
    const keys = adsDraftStepKeys({ provider, campaignType: "generic", creationMode: "inrcy" });
    const warnings = warningMap({ preparedReviewDetails: details, displayedStepKeys: keys });
    for (const key of ["foundations", "geography", "targeting", "creative", "media", "delivery", "budget"]) assert.ok(warnings.has(keys.indexOf(key as typeof keys[number]) + 1), `${provider}: ${key}`);
  }
});

test("native TikTok identity and X account resources are marked at their editable steps, with stale checks discarded", () => {
  for (const channelId of ["tiktok", "x"] as const) {
    const keys = adsDraftStepKeys({ provider: channelId, campaignType: "generic", creationMode: "inrcy" });
    const blockers = channelId === "tiktok" ? ["identity_required", "thumbnail_required", "location_not_available"] : ["funding_instrument_required", "promotable_user_required", "budget_minimum_unverified"];
    const warnings = warningMap({ preparedOnlyChannel: true, preparedNativeCheck: { blockers }, channelId, displayedStepKeys: keys });
    for (const code of blockers) assert.ok(warnings.has(keys.indexOf(preparedNativeBlockerStep(code, channelId)) + 1));
  }
  const stale = evaluate("preparedNativeCheck", { draft: { name: "changed" }, preparedNativeReadiness: { draftKey: JSON.stringify({ name: "old" }), check: { blockers: ["identity_required"] } } });
  assert.equal(stale, null);
});
