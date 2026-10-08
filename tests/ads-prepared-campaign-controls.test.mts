import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as settingsModule from "../lib/adsPreparedCampaignSettings.ts";

type Controls = Record<string, (props: Record<string, unknown>) => ReturnType<typeof createElement>>;
const compiled = ts.transpileModule(readFileSync(new URL("../app/dashboard/ads/PreparedAdsCampaignControls.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const require = createRequire(import.meta.url);
function controls(hooks = false) {
  const runtimeModule = { exports: {} as Controls };
  let state: unknown;
  new Function("require", "module", "exports", compiled)((path: string) => {
    if (path === "@/lib/adsPreparedCampaignSettings") return settingsModule;
    if (path === "./ads.module.css") return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (hooks && path === "react") return { useState: (initial: unknown) => { if (state === undefined) state = initial; return [state, (next: unknown) => { state = next; }]; } };
    if (hooks && path === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
    return require(path);
  }, runtimeModule, runtimeModule.exports);
  return runtimeModule.exports;
}
const real = controls();
const noop = () => {};
const total = () => ({ ...settingsModule.defaultPreparedDeliverySettings("total"), budget: { type: "total" as const, totalEuros: 200, startAt: "2026-10-09T07:00:00.000Z", endAt: "2026-10-21T21:59:00.000Z" } });
const props = (settings = total()) => ({ settings, dailyBudget: 25, endDate: "2026-10-21", timeZone: "Europe/Paris", onChange: noop, onDailyChange: noop, onEndDateChange: noop });
const render = (name: string, value: Record<string, unknown>) => renderToStaticMarkup(createElement(real[name], value));
type Node = { type: string; props: Record<string, unknown> };
const descendants = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(descendants) : value && typeof value === "object" && "props" in value ? [value as Node, ...descendants((value as Node).props.children)] : [];
const change = (node: Node, value: string) => (node.props.onChange as (event: unknown) => void)({ target: { value } });

test("Prepared budget UI shows an exact total and the same scheduled instants in the selected timezone", () => {
  const html = render("PreparedAdsBudget", props());
  assert.match(html, /value="200"/); assert.doesNotMatch(html, /value="25"/);
  assert.match(html, /value="2026-10-09T09:00"/); assert.match(html, /value="2026-10-21T23:59"/);
  assert.match(html, /Aucun montant par jour n’est déduit automatiquement/);
  const newYork = render("PreparedAdsBudget", { ...props(), timeZone: "America/New_York" });
  assert.match(newYork, /value="2026-10-09T03:00"/); assert.match(newYork, /value="2026-10-21T17:59"/);
});
test("Switching budget type does not calculate a daily allowance or manufacture an envelope", () => {
  const runtime = controls(true);
  const patches: unknown[] = [], daily: number[] = [];
  const recordPatch = (patch: unknown) => patches.push(patch);
  const recordDaily = (value: number) => daily.push(value);
  const tree = runtime.PreparedAdsBudget({ ...props(), onChange: recordPatch, onDailyChange: recordDaily });
  change(descendants(tree).find((node) => node.type === "select")!, "daily");
  assert.deepEqual(patches, [{ budget: { ...total().budget, type: "daily", totalEuros: null } }]); assert.deepEqual(daily, []);
  patches.length = 0;
  const dailySettings = settingsModule.defaultPreparedDeliverySettings();
  const dailyTree = runtime.PreparedAdsBudget({ ...props(), settings: dailySettings, onChange: recordPatch, onDailyChange: recordDaily });
  change(descendants(dailyTree).find((node) => node.type === "select")!, "total");
  assert.deepEqual(patches, [{ budget: { ...dailySettings.budget, type: "total", totalEuros: null } }]); assert.deepEqual(daily, []);
});
test("Editing a scheduled end retains the wall-calendar date and rejects an ambiguous DST time", () => {
  const runtime = controls(true), patches: unknown[] = [], dates: string[] = [];
  const value = { ...props(), onChange: (patch: unknown) => patches.push(patch), onEndDateChange: (day: string) => dates.push(day) };
  const end = () => descendants(runtime.PreparedAdsBudget(value)).find((node) => node.type === "input" && node.props.type === "datetime-local" && !node.props["aria-label"])!;
  change(end(), "2026-10-22T00:30");
  assert.deepEqual(patches, [{ budget: { ...total().budget, endAt: "2026-10-21T22:30:00.000Z" } }]); assert.deepEqual(dates, ["2026-10-22"]);
  patches.length = 0; dates.length = 0;
  change(end(), "2026-10-25T02:30");
  assert.deepEqual(patches, []); assert.deepEqual(dates, []);
  assert.ok(descendants(runtime.PreparedAdsBudget(value)).some((node) => node.props.role === "alert"));
});
test("Prepared bidding retains deliberate blanks and describes account verification without a live API claim", () => {
  const runtime = controls(true), patches: unknown[] = [];
  const tree = runtime.PreparedAdsBidding({ settings: total(), budgetEuros: 200, channel: "x", onChange: (patch: unknown) => patches.push(patch) });
  change(descendants(tree).find((node) => node.type === "select")!, "max_bid");
  assert.deepEqual(patches, [{ bidding: { strategy: "max_bid", amountEuros: null } }]);
  const tiktok = render("PreparedAdsBidding", { settings: total(), budgetEuros: 200, channel: "tiktok", onChange: noop });
  assert.match(tiktok, /groupe d’annonces TikTok/); assert.match(tiktok, /sans optimisation du budget de campagne/);
  assert.match(tiktok, /sans transmission au compte publicitaire/); assert.doesNotMatch(tiktok, /CPC|CPM|minimum.*(?:20|50)/);
  const x = render("PreparedAdsBidding", { settings: total(), budgetEuros: 200, channel: "x", onChange: noop });
  assert.match(x, /autres combinaisons de plafonds proposées par X/);
});
test("TikTok uses Cost Cap with the chosen result, preserves its amount and never promises a hard per-result ceiling", () => {
  const runtime = controls(true), patches: unknown[] = [];
  const tree = runtime.PreparedAdsBidding({ settings: total(), budgetEuros: 200, channel: "tiktok", optimizationIntent: "conversions", onChange: (patch: unknown) => patches.push(patch) });
  const options = descendants(tree).filter((node) => node.type === "option");
  assert.ok(options.some((node) => node.props.value === "cost_cap")); assert.ok(!options.some((node) => node.props.value === "max_bid"));
  change(descendants(tree).find((node) => node.type === "select")!, "cost_cap");
  assert.deepEqual(patches, [{ bidding: { strategy: "cost_cap", amountEuros: null } }]);
  const settings = { ...total(), bidding: { strategy: "cost_cap" as const, amountEuros: 1.5 } };
  const conversion = render("PreparedAdsBidding", { settings, budgetEuros: 200, channel: "tiktok", optimizationIntent: "conversions", onChange: noop });
  assert.match(conversion, /Coût cible par conversion/); assert.match(conversion, /value="1.5"/);
  assert.match(conversion, /sans garantie de coût maximal/); assert.doesNotMatch(conversion, /CPC|Plafond d’enchère prévu/);
  const views = render("PreparedAdsBidding", { settings, budgetEuros: 200, channel: "tiktok", optimizationIntent: "views", onChange: noop });
  assert.match(views, /Coût cible par vue optimisée/);
});
test("Prepared summary displays editable wizard choices and no invented native conversion or provider IDs", () => {
  const draft = { provider: "tiktok", dailyBudgetEuros: 25, endDate: "2026-10-21", preparedDeliverySettings: total(), channelSettings: { channel: "tiktok", objectiveType: "WEB_CONVERSIONS", format: "video", targetingMode: "interests", placementIntent: "tiktok_only", optimizationIntent: "conversions", destinationKind: "website" }, targetLocations: ["Hauts-de-France"], languages: ["Français"], targetAudiences: ["Indépendants et petites entreprises"], conversionGoal: "lead_form", conversionLocation: "website", destinationUrl: "https://inrcy.com/", trackingParameters: "utm_source=tiktok", creativeUrl: "https://assets.example/video.mp4", imageUrl: "" };
  const html = render("PreparedAdsEffectiveSummary", { draft, timeZone: "Europe/Paris", identityMessage: "Identité du compte à confirmer" });
  for (const content of ["Brouillon préparé · réglages non transmis", "Conversions sur le site", "Centres d’intérêt à vérifier", "Budget du groupe d’annonces", "200,00", "TikTok uniquement", "Aucun événement natif associé", "Formulaires de contact", "utm_source=tiktok", "video.mp4"]) assert.ok(html.includes(content), content);
  assert.doesNotMatch(html, /25,00|urn:|campaign_id|pixel_id|VAL[Ii]DER|Lancer la campagne/);
  const x = render("PreparedAdsEffectiveSummary", { draft: { ...draft, provider: "x", channelSettings: { channel: "x", objective: "engagement", format: "text", targetingMode: "follower_lookalikes" }, creativeUrl: "" }, timeZone: "Europe/Paris" });
  assert.match(x, /Interactions/); assert.match(x, /Profils similaires aux abonnés/); assert.match(x, /Annonce textuelle/);
});
test("TikTok profile and integrated-form summaries describe their native destination and hide a residual website URL", () => {
  for (const destinationKind of ["profile", "instant_form"]) for (const destinationUrl of ["", "https://old-website.example/offre"]) {
    const draft = { provider: "tiktok", dailyBudgetEuros: 25, endDate: "2026-10-21", preparedDeliverySettings: total(), channelSettings: { channel: "tiktok", objectiveType: "ENGAGEMENT", format: "video", targetingMode: "broad", placementIntent: "tiktok_only", optimizationIntent: "engagement", destinationKind }, targetLocations: ["Hauts-de-France"], languages: ["Français"], targetAudiences: ["Indépendants"], conversionGoal: "message", conversionLocation: "website", destinationUrl, trackingParameters: "", creativeUrl: "https://assets.example/video.mp4", imageUrl: "" };
    const html = render("PreparedAdsEffectiveSummary", { draft, timeZone: "Europe/Paris" });
    assert.match(html, destinationKind === "profile" ? /<dt>Lien<\/dt><dd>Profil TikTok<\/dd>/ : /<dt>Lien<\/dt><dd>Formulaire intégré TikTok<\/dd>/);
    assert.doesNotMatch(html, /old-website\.example|<dt>Lien<\/dt><dd>À renseigner/);
  }
});
