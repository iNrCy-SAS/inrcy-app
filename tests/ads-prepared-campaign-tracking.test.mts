import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createTranslator } from "next-intl";
import { createAdsApiRequestError } from "../app/dashboard/ads/adsClientHttp.ts";
import { adsErrorRuntime } from "./helpers/ads-error-message-runtime.mts";
const messages = Object.fromEntries(["booster", "mails"].map(namespace => [namespace, JSON.parse(readFileSync(new URL(`../messages/fr-FR/${namespace}.json`, import.meta.url), "utf8"))]));
const translate = createTranslator({ locale: "fr-FR", messages, onError: error => { throw error; } });
const source = readFileSync(new URL("../app/dashboard/ads/AdsCampaignTracking.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("AdsCampaignTracking.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reader: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "readPreparedNativeState") reader = node; ts.forEachChild(node, visit); }
visit(ast); assert.ok(reader);
const compiled = ts.transpileModule(reader.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function runtime(provider: string, result: unknown, status = 200, busy: string | null = null) {
  let state: Record<string, { confirmed: boolean; message: string }> = {}, calls = 0;
  const busyChanges: unknown[] = [];
  const fetch = async (url: string, options: RequestInit) => { calls++; assert.equal(url, "/api/ads/campaigns/campaign-123/lifecycle"); assert.equal(options.method, "PATCH"); assert.equal(options.cache, "no-store"); assert.deepEqual(JSON.parse(String(options.body)), { action: "reconcile" }); return Response.json(result, { status }); };
  const run = new Function("fetch", "busyId", "setBusyId", "setNativeStateById", "errorMessage", "createAdsApiRequestError", "i18nT", compiled + "; return readPreparedNativeState;")(fetch, busy, (value: unknown) => busyChanges.push(value), (update: (current: typeof state) => typeof state) => { state = update(state); }, adsErrorRuntime().useAdsErrorMessage(), createAdsApiRequestError, createTranslator({ locale: "fr-FR", messages, namespace: "booster", onError: error => { throw error; } }));
  return { run: () => run({ id: "campaign-123", provider }), calls: () => calls, state: () => state["campaign-123"], busyChanges };
}
for (const provider of ["tiktok", "x"]) {
  test(`${provider} tracking reads only paused native state and never publishes or changes the draft`, async () => {
    const h = runtime(provider, { readOnly: true, publicationEnabled: false, nativeReadback: { confirmed: true, targetStatus: provider === "tiktok" ? "DISABLE" : "PAUSED" } });
    await h.run(); assert.equal(h.calls(), 1); assert.equal(h.state().confirmed, true); assert.match(h.state().message, /Aucune activation/); assert.deepEqual(h.busyChanges, ["campaign-123", null]);
  });
  test(`${provider} tracking cannot present incomplete native state as confirmed`, async () => {
    for (const result of [{ readOnly: false, publicationEnabled: false, nativeReadback: { confirmed: true, targetStatus: "PAUSED" } }, { readOnly: true, publicationEnabled: true, nativeReadback: { confirmed: true, targetStatus: "PAUSED" } }, { readOnly: true, publicationEnabled: false, nativeReadback: { confirmed: true, targetStatus: "ACTIVE" } }]) {
      const h = runtime(provider, result); await h.run(); assert.equal(h.state().confirmed, false); assert.equal(h.state().message, translate("booster.ads_public_error_d0fea80b4b"));
    }
    const unresolved = runtime(provider, { readOnly: true, publicationEnabled: false, nativeReadback: { confirmed: false, targetStatus: provider === "tiktok" ? "DISABLE" : "PAUSED" } });
    await unresolved.run(); assert.match(unresolved.state().message, /journal de reprise reste conservé/);
  });
}
test("new readback handler cannot reach existing connectors or run a second request while busy", async () => {
  for (const provider of ["meta", "google", "pinterest", "linkedin", "openai"]) { const h = runtime(provider, {}); await h.run(); assert.equal(h.calls(), 0); }
  const busy = runtime("tiktok", {}, 200, "other"); await busy.run(); assert.equal(busy.calls(), 0);
});
test("tracking renders TikTok/X total budget, historical advertiser and native calendar without inventing performance", () => {
  assert.match(source, /preparedChannel \? draft\.preparedDeliverySettings\?\.budget : null/);
  assert.match(source, /campaign\.ad_account_id \|\| \(preparedChannel \? draft\.adAccountId/);
  assert.match(source, /preparedChannel && draft\.preparedDeliverySettings\?\.budget.endAt/);
  assert.ok(source.includes('i18nT("verifier_l_etat_suspendu_573f9942")'));
  assert.equal(translate("booster.verifier_l_etat_suspendu_573f9942"), "Vérifier l’état suspendu");
  assert.ok(source.includes('i18nT("ads_tracking_paused_confirmed")'));
  assert.match(translate("booster.ads_tracking_paused_confirmed"), /Aucune activation effectuée/);
  assert.match(source, /campaign\.provider === "google"[\s\S]+campaign\.provider === "meta"/);
  assert.doesNotMatch(compiled, /\/publish|\/metrics|action: "resume"|method: "POST"|setDraft|onEdit/);
});
