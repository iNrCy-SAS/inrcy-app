import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as preparedSettings from "../lib/adsPreparedCampaignSettings.ts";
import * as resourcesPolicy from "../lib/adsTikTokResources.ts";
import { tikTokNativeCapabilityScope } from "../scripts/tiktok-native-capability-scope.mjs";
type Source = typeof import("../lib/adsTikTokCapabilityEvidenceServer.ts");
const now = Date.parse("2026-10-08T10:00:00Z");
const scope = { appId: "1234567890", advertiserId: "1234567890123", integrationFingerprint: "a".repeat(64), context: structuredClone(resourcesPolicy.TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT) };
function load(): Source {
  const loaded = { exports: {} as Source }, modules = new Map<string, unknown>([["server-only", {}], ["./adsTikTokResources.ts", resourcesPolicy], ["./adsPreparedCampaignSettings.ts", preparedSettings]]);
  const output = ts.transpileModule(readFileSync(new URL("../lib/adsTikTokCapabilityEvidenceServer.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("module", "exports", "require", output)(loaded, loaded.exports, (name: string) => { assert.ok(modules.has(name), name); return modules.get(name); });
  return loaded.exports;
}
function authority() {
  return { scope, source: { kind: "operator_verified_native_access", reference: "https://business-api.tiktok.com/portal/apps" },
    manualTrafficV13: "verified", nativeWriteAccess: "verified", videoUpload: "verified", imageUpload: "unverified", mediaRead: "verified", objectRead: "verified",
    minimumLifetimeBudgetEuros: null, budgetCalendar: null, scheduleTimeBasis: null, scheduleOffsetMinutes: null,
    allowedNonSparkIdentityTypes: ["TT_USER"], callToActions: ["LEARN_MORE"], verifiedAt: new Date(now - 3600_000).toISOString(), validUntil: new Date(now + 3600_000).toISOString() };
}
const environment = (value: unknown) => ({ TIKTOK_ADS_NATIVE_CAPABILITY_EVIDENCE: JSON.stringify(value) });

test("TikTok server authority is absent by default and rejects malformed/oversized configuration", async () => {
  const source = load();
  for (const env of [{}, { TIKTOK_ADS_NATIVE_CAPABILITY_EVIDENCE: "not JSON" }, { TIKTOK_ADS_NATIVE_CAPABILITY_EVIDENCE: "x".repeat(24_001) }, environment([]), environment(Array(11).fill(authority()))]) assert.equal(await source.readTikTokConfiguredCapabilityEvidence(scope, now, env), null);
});
test("A fresh binding snapshot never renews the original operator attestation or invents missing grants", async () => {
  const source = load(), original = authority(), first = await source.readTikTokConfiguredCapabilityEvidence(scope, now, environment(original));
  assert.ok(first); assert.equal(first.verifiedAt, new Date(now).toISOString()); assert.equal(Date.parse(first.validUntil), now + 300_000);
  assert.deepEqual(first.authority, { verifiedAt: original.verifiedAt, validUntil: original.validUntil, source: original.source });
  assert.equal(first.imageUpload, "unverified"); assert.equal(first.minimumLifetimeBudgetEuros, null); assert.equal(first.scheduleTimeBasis, null);
  const later = await source.readTikTokConfiguredCapabilityEvidence(scope, now + 600_000, environment(original));
  assert.ok(later); assert.deepEqual(later.authority, first.authority); assert.equal(later.verifiedAt, new Date(now + 600_000).toISOString());
  assert.equal(await source.readTikTokConfiguredCapabilityEvidence(scope, now + 3600_000, environment(original)), null);
});
test("Authority must bind the exact app, advertiser, integration and Traffic context", async () => {
  const source = load(), original = authority();
  for (const binding of [{ ...scope, appId: "9999999999" }, { ...scope, advertiserId: "9876543210" }, { ...scope, integrationFingerprint: "b".repeat(64) }, { ...scope, context: { ...scope.context, placements: ["PLACEMENT_PANGLE"] } }]) assert.equal(await source.readTikTokConfiguredCapabilityEvidence(scope, now, environment({ ...original, scope: binding })), null);
  assert.equal(await source.readTikTokConfiguredCapabilityEvidence(scope, now, environment([original, original])), null);
});
test("Operator authority requires a bounded nonfuture interval and an explicit native source", async () => {
  const source = load(), original = authority();
  for (const patch of [{ validUntil: new Date(now).toISOString() }, { verifiedAt: new Date(now + 1).toISOString() }, { verifiedAt: new Date(now - 25 * 3600_000).toISOString() }, { validUntil: new Date(now + 25 * 3600_000).toISOString() }, { verifiedAt: "2026-11-31T10:00:00Z" }, { source: { kind: "account_get", reference: "https://business-api.tiktok.com/portal/apps" } }, { source: { kind: "operator_verified_native_access", reference: "https://third-party.example/approval" } }, { source: { kind: "operator_verified_native_access", reference: "https://secret@business-api.tiktok.com/portal/apps" } }]) assert.equal(await source.readTikTokConfiguredCapabilityEvidence(scope, now, environment({ ...original, ...patch })), null);
});
test("Malformed grants, unsupported Spark identity, arbitrary clocks and credentials fail closed", async () => {
  const source = load(), original = authority();
  for (const patch of [{ nativeWriteAccess: true }, { allowedNonSparkIdentityTypes: ["AUTH_CODE"] }, { allowedNonSparkIdentityTypes: ["TT_USER", "TT_USER"] }, { callToActions: ["En savoir plus"] }, { callToActions: ["LEARN_MORE", "LEARN_MORE"] }, { scheduleTimeBasis: "Paris" }, { scheduleOffsetMinutes: 1000 }, { minimumLifetimeBudgetEuros: "20" }, { budgetCalendar: { startAt: "2026-11-31T10:00:00Z", endAt: "2026-12-02T10:00:00Z" } }, { accessToken: "fixture-private" }]) assert.equal(await source.readTikTokConfiguredCapabilityEvidence(scope, now, environment({ ...original, ...patch })), null);
});
test("Scope helper only hashes the existing Ads integration and never returns token material", () => {
  const row = { id: "integration", status: "connected", resource_id: scope.advertiserId, access_token_enc: "private-cipher", refresh_token_enc: null, expires_at: null, meta: { token_lifecycle: "long_lived" } };
  const value = tikTokNativeCapabilityScope(scope.appId, row);
  assert.equal(value.appId, scope.appId); assert.equal(value.advertiserId, scope.advertiserId); assert.match(value.integrationFingerprint, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(value), /private|cipher|access_token|refresh_token/);
  assert.notEqual(value.integrationFingerprint, tikTokNativeCapabilityScope(scope.appId, { ...row, access_token_enc: "other-private-cipher" }).integrationFingerprint);
  for (const patch of [{ status: "disconnected" }, { resource_id: "unsafe" }, { access_token_enc: null }]) assert.throws(() => tikTokNativeCapabilityScope(scope.appId, { ...row, ...patch }));
});
