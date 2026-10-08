import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as metaSettings from "../lib/adsMetaCampaignSettings.ts";
import * as openaiSettings from "../lib/adsOpenaiCampaignSettings.ts";
import { adsDraftHasKeywordsStep, adsDraftHasMediaStep, adsDraftStepKeys } from "../lib/adsDraftNavigation.ts";

type Controls = Record<string, (props: Record<string, unknown>) => ReturnType<typeof createElement>> & Record<string, unknown>;
function controls(name: string) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../app/dashboard/ads/${name}.tsx`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const runtimeModule = { exports: {} };
  const require = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled)((path: string) => {
    if (path === "@/lib/adsMetaCampaignSettings") return metaSettings;
    if (path === "@/lib/adsOpenaiCampaignSettings") return openaiSettings;
    if (path === "./ads.module.css") return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    return require(path);
  }, runtimeModule, runtimeModule.exports);
  return runtimeModule.exports as Controls;
}
const meta = controls("MetaAdsCampaignControls");
const chatgpt = controls("ChatGPTAdsCampaignControls");
const noop = () => {};
const render = (component: Controls[string], props: Record<string, unknown>) => renderToStaticMarkup(createElement(component, props));

test("Actual Meta and ChatGPT labels and indices align with their ten manual or eleven assisted semantic steps", () => {
  const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const variables = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer); ts.forEachChild(node, visit); }; visit(source);
  for (const channelId of ["meta", "openai"] as const) for (const creationPath of ["manual", "inrcy"] as const) {
    const draft = { provider: channelId, campaignType: channelId === "meta" ? "meta_traffic" as const : "generic" as const, creationMode: creationPath };
    const scope: Record<string, unknown> = { channelId, creationPath, draft, stepKeys: adsDraftStepKeys(draft), adsDraftHasKeywordsStep, adsDraftHasMediaStep };
    for (const name of ["keywordStepName", "hasMediaStep", "hasKeywordsStep", "mediaStepName", "automatedChannelStepNames", "manualStepNames", "inrcyStepNames", "linkedInStepLabels", "googleStepLabels", "channelStepLabels", "stepNames", "foundationsStep", "biddingStep", "geographyStep", "targetingStep", "keywordsStep", "creativeStep", "mediaStep", "deliveryStep", "budgetStep", "validationStep"]) {
      const expression = variables.get(name); assert.ok(expression, name);
      const compiled = ts.transpileModule(`const value = (${expression.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      scope[name] = new Function(...Object.keys(scope), `${compiled}\nreturn value;`)(...Object.values(scope));
    }
    const prefix = ["Votre projet", ...(creationPath === "inrcy" ? ["Analyse iNrCy"] : []), "Campagne"];
    assert.deepEqual(scope.stepNames, channelId === "meta" ? [...prefix, "Zones géographiques", "Audience", "Enchères", "Annonce", "Média", "Destination et suivi", "Budget et calendrier", "Vérifier et lancer"] : [...prefix, "Budget et calendrier", "Zones géographiques", "Audience et contexte", "Enchères", "Carte ChatGPT", "Média", "Destination et suivi", "Vérifier et lancer"]);
    for (const [variable, key] of [["foundationsStep", "foundations"], ["biddingStep", "bidding"], ["geographyStep", "geography"], ["targetingStep", "targeting"], ["creativeStep", "creative"], ["mediaStep", "media"], ["deliveryStep", "delivery"], ["budgetStep", "budget"], ["validationStep", "validation"]] as const) assert.equal(scope[variable], adsDraftStepKeys(draft).indexOf(key), `${channelId} ${variable}`);
    assert.equal(scope.keywordsStep, -1);
    assert.equal(scope.validationStep, creationPath === "manual" ? 9 : 10);
  }
});

test("Meta total budget is displayed once, with native calendar times in the verified account timezone", () => {
  const settings = metaSettings.defaultMetaDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200, startAt: "2026-10-09T07:00:00.000Z", endAt: "2026-10-21T21:59:00.000Z" };
  const label = meta.metaAdsBudgetLabel as unknown as (draft: unknown) => string;
  assert.match(label({ dailyBudgetEuros: 25, metaDeliverySettings: settings }), /200,00.*au total/);
  assert.doesNotMatch(label({ dailyBudgetEuros: 25, metaDeliverySettings: settings }), /25,00|par jour/);
  const props = { settings, dailyBudget: 25, endDate: "2026-10-21", timeZone: "Europe/Paris", onChange: noop, onDailyChange: noop, onEndDateChange: noop };
  const html = render(meta.MetaAdsBudget, props);
  assert.match(html, /value="200"/);
  assert.match(html, /value="2026-10-09T09:00"/);
  assert.match(html, /value="2026-10-21T23:59"/);
  assert.doesNotMatch(html, /value="25"/);
  const newYork = render(meta.MetaAdsBudget, { ...props, timeZone: "America/New_York" });
  assert.match(newYork, /value="2026-10-09T03:00"/);
  assert.match(newYork, /value="2026-10-21T17:59"/);
});
test("Actual Meta calendar labels and summary retain a past legacy deadline instead of Invalid Date or an immediate end", () => {
  const calendarLabels = meta.metaAdsCalendarLabels as unknown as (draft: unknown, timeZone: string | null) => { start: string; end: string };
  const saved = { dailyBudgetEuros: 25, endDate: "2026-10-07", targetLocations: ["Paris"], languages: [], metaPlacements: ["facebook_feed"] };
  const labels = calendarLabels(saved, "Europe/Paris");
  assert.equal(labels.start, "Dès la validation de Meta"); assert.match(labels.end, /07\/10\/2026.*23:59:59/);
  assert.doesNotMatch(labels.end, /Invalid Date|Dès la validation/);
  assert.match(calendarLabels(saved, "America/New_York").end, /07\/10\/2026.*17:59:59/);
  const html = render(meta.MetaAdsEffectiveSummary, { draft: saved, resources: null });
  assert.match(html, /Fin : 07\/10\/2026.*23:59:59/); assert.doesNotMatch(html, /Invalid Date|Fin : Dès la validation/);
});
test("Meta labels preserve explicit total-calendar hours and distinguish missing from invalid start or end", () => {
  const calendarLabels = meta.metaAdsCalendarLabels as unknown as (draft: unknown, timeZone: string | null) => { start: string; end: string };
  const settings = metaSettings.defaultMetaDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200, startAt: "2026-10-09T09:30:00+02:00", endAt: "2026-10-19T17:45:00+02:00" };
  const native = { endDate: "2026-10-07", metaDeliverySettings: settings };
  assert.match(calendarLabels(native, "Europe/Paris").start, /09\/10\/2026.*09:30:00/);
  assert.match(calendarLabels(native, "Europe/Paris").end, /19\/10\/2026.*17:45:00/);
  assert.match(calendarLabels(native, "America/New_York").end, /19\/10\/2026.*11:45:00/);
  assert.deepEqual(calendarLabels({ endDate: "" }, "invalid/zone"), { start: "Dès la validation de Meta", end: "Fin à préciser" });
  assert.equal(calendarLabels({ endDate: "2026-02-30" }, "Europe/Paris").end, "Date à corriger");
  const invalid = { ...native, metaDeliverySettings: { ...settings, budget: { ...settings.budget, startAt: "not-a-date", endAt: "2026-02-30T10:00:00Z" } } };
  assert.deepEqual(calendarLabels(invalid, "Europe/Paris"), { start: "Date à corriger", end: "Date à corriger" });
  const html = render(meta.MetaAdsEffectiveSummary, { draft: { ...invalid, dailyBudgetEuros: 25, targetLocations: [], languages: [], metaPlacements: [] }, resources: null });
  assert.match(html, /Début : Date à corriger · Fin : Date à corriger/); assert.doesNotMatch(html, /Invalid Date/);
});

test("Meta exposes supported link-click bidding and age limits without manufacturing conversion or interest IDs", () => {
  const settings = metaSettings.defaultMetaDeliverySettings();
  const bidding = render(meta.MetaAdsBidding, { settings, budgetEuros: 200, onChange: noop });
  assert.match(bidding, /value="maximum_delivery"/);
  assert.match(bidding, /value="bid_cap"/);
  assert.match(bidding, /Clics sur le lien vers votre site/);
  assert.match(bidding, /Aucun Pixel ni événement de conversion/);
  assert.doesNotMatch(bidding, /value="cost_cap"|value="target_cpa"|Pixel ID/);
  settings.bidding = { strategy: "bid_cap", amountEuros: 1.5 };
  assert.match(render(meta.MetaAdsBidding, { settings, budgetEuros: 200, onChange: noop }), /max="200".*value="1.5"/);
  settings.audience = { ageMin: 25, ageMax: 65 };
  const audience = render(meta.MetaAdsAudience, { settings, languages: ["6"], locales: [{ id: "6", name: "Français" }, { id: "24", name: "Anglais" }], onChange: noop, onLanguagesChange: noop });
  assert.match(audience, /value="25"/);
  assert.match(audience, /value="65" selected="">65 ans et plus/);
  assert.match(audience, /value="6" selected="">Français/);
  assert.match(audience, /n’ajoute aucun intérêt ou audience personnalisée/);
});

test("ChatGPT total budget preserves the exact envelope and calendar, independently of its legacy daily field", () => {
  const settings = openaiSettings.defaultOpenaiDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200, startAt: "2026-10-09T07:00:00.000Z", endAt: "2026-10-21T21:59:00.000Z" };
  const label = chatgpt.openaiAdsBudgetLabel as unknown as (draft: unknown) => string;
  assert.match(label({ dailyBudgetEuros: 25, openaiDeliverySettings: settings }), /200,00.*au total/);
  assert.doesNotMatch(label({ dailyBudgetEuros: 25, openaiDeliverySettings: settings }), /25,00|par jour/);
  const props = { settings, dailyBudget: 25, endDate: "2026-10-21", timeZone: "Europe/Paris", onChange: noop, onDailyChange: noop, onEndDateChange: noop };
  const html = render(chatgpt.ChatGPTAdsBudget, props);
  assert.match(html, /value="200"/);
  assert.match(html, /value="2026-10-09T09:00"/);
  assert.match(html, /value="2026-10-21T23:59"/);
  assert.doesNotMatch(html, /value="25"/);
  settings.budget = { ...settings.budget, type: "daily", totalEuros: null };
  assert.match(label({ dailyBudgetEuros: 25, openaiDeliverySettings: settings }), /25,00.*par jour/);
  assert.match(render(chatgpt.ChatGPTAdsBudget, { ...props, settings }), /min="15" max="500"/);
});

test("ChatGPT presents its fixed CPC and native platform filters, preserving a custom platform selection", () => {
  const bidding = render(chatgpt.ChatGPTAdsBidding, { bidEuros: 1.5, budgetEuros: 200, onBidChange: noop });
  assert.match(bidding, /Enchère fixe par clic/);
  assert.match(bidding, /max="200".*value="1.5"/);
  assert.doesNotMatch(bidding, /target_cpa|maximum_delivery|Pixel|conversion ID/);
  const settings = openaiSettings.defaultOpenaiDeliverySettings();
  const all = render(chatgpt.ChatGPTAdsDistribution, { settings, onChange: noop });
  assert.match(all, /value="all" selected=""/);
  for (const platform of ["web", "ios_app", "android_app", "desktop_web", "ios_web", "android_web"]) assert.match(all, new RegExp(`value="${platform}"`));
  assert.match(all, /ne créent pas une audience personnalisée ni un filtre professionnel/);
  settings.platforms = ["desktop_web", "ios_app"];
  assert.match(render(chatgpt.ChatGPTAdsDistribution, { settings, onChange: noop }), /value="custom" disabled="" selected="">Sélection personnalisée conservée/);
});

test("ChatGPT geography adds only a selected native catalogue result, never every returned option", () => {
  const compiled = ts.transpileModule(readFileSync(new URL("../app/dashboard/ads/ChatGPTAdsCampaignControls.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const runtimeModule = { exports: {} as Controls };
  new Function("require", "module", "exports", compiled)((path: string) => path === "@/lib/adsOpenaiCampaignSettings" ? openaiSettings : path === "react/jsx-runtime" ? { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }) } : path === "./ads.module.css" ? { default: {} } : {}, runtimeModule, runtimeModule.exports);
  const changes: string[][] = [];
  const tree = runtimeModule.exports.ChatGPTAdsGeography({ resources: { geographyOptions: [{ id: "native-lille", canonicalName: "Lille, Hauts-de-France, France" }, { id: "native-paris", canonicalName: "Paris, Île-de-France, France" }] }, locations: [], loading: false, error: "", query: "Lille", onQueryChange: noop, onSearch: noop, onLocationsChange: (value: string[]) => changes.push(value) });
  const descendants = (value: unknown): Array<{ type: unknown; props: Record<string, unknown> }> => Array.isArray(value) ? value.flatMap(descendants) : value && typeof value === "object" && "props" in value ? [value as never, ...descendants((value as { props: { children: unknown } }).props.children)] : [];
  const select = descendants(tree).find((element) => element.type === "select")!;
  const choose = select.props.onChange as (event: unknown) => void;
  assert.deepEqual(changes, []);
  choose({ target: { value: "invented-id" } });
  assert.deepEqual(changes, []);
  choose({ target: { value: "native-lille" } });
  assert.deepEqual(changes, [["Lille, Hauts-de-France, France"]]);
});


test("Meta historical geography never activates the global native picker until its settings are explicitly updated", () => {
  const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.ConditionalExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isConditionalExpression(node) && node.condition.getText(source) === "draft.metaDeliverySettings"
      && ts.isJsxSelfClosingElement(node.whenTrue) && node.whenTrue.tagName.getText(source) === "MetaAdsLocationPicker") expression = node;
    ts.forEachChild(node, visit);
  }; visit(source);
  assert.ok(expression, "the actual native picker must be conditional on persisted native settings");
  const compiled = ts.transpileModule('const value = (' + expression.getText(source) + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const scope: Record<string, unknown> = { exports: {}, require: () => ({ jsx, jsxs: jsx }), styles: {}, creating: true, channelId: "meta", metaResourceAccountId: "1234567890", MetaAdsLocationPicker: "native-global-picker", updateDraft: noop, setMetaGeoState: noop, metaGeoKey: "key", updateMetaDelivery: noop };
  const renderPicker = (draft: Record<string, unknown>) => new Function(...Object.keys(scope), "draft", compiled + '\nreturn value;')(...Object.values(scope), draft);
  const native = renderPicker({ metaDeliverySettings: metaSettings.defaultMetaDeliverySettings(), metaGeoTargets: [], targetLocations: ["Paris"] });
  assert.equal(native.type, "native-global-picker"); assert.equal(native.props.active, true);
  const legacy = renderPicker({ metaGeoTargets: [{ name: "Paris US" }], targetLocations: ["Paris"] });
  assert.equal(legacy.type, "div"); assert.match(JSON.stringify(legacy.props.children), /Ciblage historique en France/);
  assert.doesNotMatch(JSON.stringify(legacy), /native-global-picker/);
});

test("Meta historical summary reports France and ignored language filters instead of unused global IDs", () => {
  const endDate = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
  const draft = { dailyBudgetEuros: 25, endDate, targetLocations: ["Lille"], metaGeoTargets: [{ key: "foreign-paris", type: "city", name: "Paris US", countryCode: "US" }], languages: ["6"], metaPlacements: ["facebook_feed"] };
  const resources = { selectedPageId: "9876543210", account: { timezone: "Europe/Paris" }, pages: [{ id: "9876543210", name: "Page iNrCy" }], locales: [{ id: "6", name: "Français" }] };
  const legacy = render(meta.MetaAdsEffectiveSummary, { draft, resources });
  assert.match(legacy, /Lille · France \(parcours historique\)/);
  assert.match(legacy, /Sans filtre · les langues du brief historique ne sont pas transmises/);
  assert.doesNotMatch(legacy, /Paris US|Langues : Français/);
  const native = render(meta.MetaAdsEffectiveSummary, { draft: { ...draft, metaDeliverySettings: metaSettings.defaultMetaDeliverySettings() }, resources });
  assert.match(native, /Paris US/); assert.match(native, /Langues : Français/);
  assert.doesNotMatch(native, /parcours historique|langues du brief historique/);
});
