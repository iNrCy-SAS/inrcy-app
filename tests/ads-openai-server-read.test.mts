import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { assessOpenaiAdsAccount, OpenaiAdsPublishError } from "../lib/adsOpenaiConnector.ts";
import { openaiNativeDelivery } from "../lib/adsOpenaiCampaignSettings.ts";
import { openaiAdsResourcesConsentKey } from "../lib/adsOpenaiResources.ts";

const snapshot = { id: "integration_1", status: "connected", resource_id: "adacct_123", resource_label: "Entreprise", access_token_enc: "fixture-cipher", meta: {} };
const account = { id: "adacct_123", name: "Entreprise", currencyCode: "EUR", timezone: "Europe/Paris", status: "active", brandReviewStatus: "approved", accountReviewStatus: null };
const source = fs.readFileSync(new URL("../lib/adsOpenaiServer.ts", import.meta.url), "utf8");
type Snapshot = typeof snapshot | null;

function isolatedServer(snapshots: Snapshot[] = [snapshot], reviewedAccount = account) {
  let readCount = 0;
  let providerReads = 0;
  const writes: string[] = [];
  const supabaseAdmin = { from(table: string) {
    assert.equal(table, "integrations");
    const filters: [string, string][] = [];
    const query = {
      select() { return query; },
      eq(key: string, value: string) { filters.push([key, value]); return query; },
      async maybeSingle() {
        assert.deepEqual(filters, [["user_id", "user_123"], ["provider", "openai"], ["source", "openai_ads"], ["product", "ads"]]);
        const selected = snapshots[Math.min(readCount++, snapshots.length - 1)];
        return { data: selected ? { ...selected } : null, error: null };
      },
      async upsert() { writes.push("upsert"); throw new Error("Unexpected database write"); },
    };
    return query;
  } };
  const connector = {
    assessOpenaiAdsAccount, OpenaiAdsPublishError,
    async verifyOpenaiAdsAccount(options: { apiKey: string; expectedAccountId: string }) { assert.equal(options.apiKey, "fixture-private-key"); assert.equal(options.expectedAccountId, "adacct_123"); providerReads++; return reviewedAccount; },
    async searchOpenaiAdsLocations(options: { query: string }) { providerReads++; return [{ id: `geo_${options.query.toLowerCase().replace(/[^a-z0-9]/g, "_")}`, name: options.query, canonicalName: `${options.query}, France`, type: "city", countryCode: "FR" }]; },
    async resolveOpenaiAdsLocations() { providerReads++; return [{ id: "geo_lille", name: "Lille", type: "city", countryCode: "FR" }]; },
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/lib/oauthCrypto": { decryptToken: () => "fixture-private-key", encryptToken: () => { throw new Error("Unexpected encryption write"); } },
    "@/lib/adsOpenaiConnector": connector, "@/lib/adsOpenaiCampaignSettings": { openaiNativeDelivery }, "@/lib/adsOpenaiResources": { openaiAdsResourcesConsentKey },
  };
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", code)((name: string) => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; }, exports);
  return { exports, writes, counts: () => ({ readCount, providerReads }) };
}
test("les ressources ne renvoient aucun secret et recontrôlent la connexion après chaque GET", async () => {
  const server = isolatedServer();
  const result = await server.exports.readOpenaiAdsDeliveryResources("user_123", "Lille", "adacct_123") as Record<string, unknown>;
  assert.deepEqual(Object.keys(result).sort(), ["account", "geographyOptions", "selectedAccountId", "verifiedAt"]);
  assert.equal(JSON.stringify(result).includes("fixture-private-key"), false);
  assert.equal(JSON.stringify(result).includes("fixture-cipher"), false);
  assert.deepEqual(server.counts(), { readCount: 3, providerReads: 2 });
  assert.deepEqual(server.writes, []);
});
test("une reconnexion durant le GET compte invalide les ressources avant la recherche", async () => {
  const server = isolatedServer([snapshot, { ...snapshot, access_token_enc: "another-fixture-cipher" }]);
  await assert.rejects(server.exports.readOpenaiAdsDeliveryResources("user_123", "Lille"), (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "ACCOUNT_MISMATCH");
  assert.equal(server.counts().providerReads, 1);
  assert.deepEqual(server.writes, []);
});
test("un seul chargement regroupe trente zones et une recherche, sans répéter le compte", async () => {
  const server = isolatedServer();
  const queries = Array.from({ length: 30 }, (_, index) => `Ville ${index}`);
  const result = await server.exports.readOpenaiAdsDeliveryResources("user_123", "Lille", "adacct_123", queries) as { geographyOptions: unknown[] };
  assert.equal(result.geographyOptions.length, 31);
  assert.deepEqual(server.counts(), { readCount: 3, providerReads: 32 });
  assert.deepEqual(server.writes, []);
});
test("le lot déduplique les requêtes et rejette les tableaux invalides avant le compte", async () => {
  const server = isolatedServer();
  const result = await server.exports.readOpenaiAdsDeliveryResources("user_123", "Lille", "adacct_123", ["Lille", "Lille", "Arras"]) as { geographyOptions: unknown[] };
  assert.equal(result.geographyOptions.length, 2);
  assert.deepEqual(server.counts(), { readCount: 3, providerReads: 3 });
  for (const queries of [Array(31).fill("Lille"), ["x"], [null], ["Lille\n"]]) {
    const invalid = isolatedServer();
    await assert.rejects(invalid.exports.readOpenaiAdsDeliveryResources("user_123", "", "adacct_123", queries), (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "INVALID_GEO");
    assert.deepEqual(invalid.counts(), { readCount: 0, providerReads: 0 });
  }
});
test("une déconnexion pendant le catalogue invalide une réponse pourtant recevable", async () => {
  const server = isolatedServer([snapshot, snapshot, { ...snapshot, status: "disconnected" }]);
  await assert.rejects(server.exports.readOpenaiAdsDeliveryResources("user_123", "Lille"), (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "ACCOUNT_MISMATCH");
  assert.deepEqual(server.counts(), { readCount: 3, providerReads: 2 });
});
test("préflight grand total en lecture seule : compte, calendrier, géos et consentement public", async () => {
  const server = isolatedServer();
  const start = Date.now() + 86400000;
  const draft = { adAccountId: "adacct_123", targetLocations: ["Lille"], dailyBudgetEuros: 0, openaiBidEuros: 1, endDate: "ignored", openaiDeliverySettings: { budget: { type: "total", totalEuros: 200, startAt: new Date(start).toISOString(), endAt: new Date(start + 86400000).toISOString() }, bidding: { strategy: "fixed_bid" }, platforms: ["ios_app"] } };
  const result = await server.exports.checkOpenaiAdsPublication("user_123", draft) as { ready: boolean; verifiedLocationCount: number; delivery: { budget: unknown }; resourcesKey: string };
  assert.equal(result.ready, true);
  assert.equal(result.verifiedLocationCount, 1);
  assert.deepEqual(result.delivery.budget, { lifetimeSpendLimitMicros: 200_000_000 });
  assert.equal(result.resourcesKey, openaiAdsResourcesConsentKey({ account, selectedAccountId: account.id, geographyOptions: [], verifiedAt: "" }));
  assert.equal(JSON.stringify(result).includes("fixture-private-key"), false);
  assert.deepEqual(server.counts(), { readCount: 3, providerReads: 2 });
  assert.deepEqual(server.writes, []);
});
test("une revue compte incomplète arrête le préflight avant la géographie", async () => {
  const server = isolatedServer([snapshot], { ...account, brandReviewStatus: "in_review" });
  await assert.rejects(server.exports.checkOpenaiAdsPublication("user_123", { adAccountId: "adacct_123" }), (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "ACCOUNT_IN_REVIEW");
  assert.equal(server.counts().providerReads, 1);
  assert.deepEqual(server.writes, []);
});
