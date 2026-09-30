import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isAdsChannelId, isAdsDraftAccountChannel, isAdsProvider, parseAdsCampaignInput } from "../../lib/adsValidation.ts";
import { isAdsChannelPublishEnabled } from "../../lib/adsPublishMode.ts";
import { normalizeXAdsAccount, verifyXAdsAccount } from "../../lib/adsXPolicy.ts";

const accountId = "Ab12cd";
const campaignId = "00000000-0000-4000-8000-000000000001";
const draft = {
  provider: "x", adAccountId: accountId, accountCurrency: "EUR", name: "Offre locale X",
  dailyBudgetEuros: 10, endDate: new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10),
  primaryText: "Découvrez nos prestations à Arras.", destinationUrl: "https://example.com/offre",
  targetLocations: ["Arras"], keywords: [], headlines: [], descriptions: [],
};

test("le brouillon X conserve un identifiant alphanumérique, sans permettre la publication", () => {
  const saved = parseAdsCampaignInput(draft, { purpose: "draft" });
  assert.equal(saved.error, null);
  assert.equal(saved.draft?.adAccountId, accountId);
  assert.equal(parseAdsCampaignInput({ ...draft, adAccountId: "" }, { purpose: "draft" }).error, null);
  for (const invalidId of ["act_Ab12cd", "Ab12-cd", "Ab/12cd"]) {
    assert.equal(parseAdsCampaignInput({ ...draft, adAccountId: invalidId }, { purpose: "draft" }).draft, null);
  }
  assert.equal(parseAdsCampaignInput(draft, { purpose: "publish" }).draft, null);
  assert.equal(isAdsDraftAccountChannel("x"), false);
  assert.equal(isAdsChannelPublishEnabled("x", "live", { INRCY_ADS_LIVE_PUBLISH_ENABLED: "true" }), false);
  for (const provider of ["google", "meta", "linkedin", "pinterest", "tiktok"]) {
    assert.equal(parseAdsCampaignInput({ ...draft, provider }, { purpose: "draft" }).draft, null, provider);
  }
});

function harness(options: {
  pilot?: boolean; connected?: boolean; associatedId?: string; listed?: boolean;
  permission?: string; currency?: string; accepted?: boolean; existingOwner?: string;
} = {}) {
  const events: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const user = { authUserId: "pilot-admin", activeUserId: "business-owner" };
  const integration = { id: "ads-integration", status: options.connected === false ? "needs_update" : "connected", resource_id: options.associatedId ?? accountId };
  const account = normalizeXAdsAccount({ id: accountId, name: "Mon entreprise", approval_status: options.accepted === false ? "PENDING" : "ACCEPTED" })!;
  const query = {
    filters: new Map<string, unknown>(),
    select() { return this; },
    eq(key: string, value: unknown) { this.filters.set(key, value); return this; },
    insert(value: Record<string, unknown>) { events.push("insert"); writes.push(value); return this; },
    async single() { return { data: { id: campaignId, status: "draft" }, error: null }; },
    async maybeSingle() {
      assert.equal(this.filters.get("user_id"), user.activeUserId);
      return { data: options.existingOwner === user.activeUserId ? { id: campaignId, provider: "x", status: "draft", updated_at: "2026-09-30T12:00:00Z" } : null, error: null };
    },
  };
  const scope = {
    adsRequestOriginAllowed: () => true,
    requirePremiumAdsUser: async () => ({ user }),
    enforceRateLimit: async () => null,
    NextResponse: { json: (body: unknown, init?: { status: number }) => ({ status: init?.status || 200, body }) },
    adsPilotOnlyResponse: () => ({ status: 403 }),
    isAdsChannelUserAllowed: async () => options.pilot !== false,
    parseAdsCampaignInput, isAdsProvider, isAdsChannelId,
    readXAdsIntegration: async (owner: string) => { assert.equal(owner, user.activeUserId); events.push("connection"); return integration; },
    listXAdsAccounts: async (owner: string, row: unknown) => { assert.equal(owner, user.activeUserId); assert.equal(row, integration); events.push("accounts"); return options.listed === false ? [] : [account]; },
    verifySelectedXAdsAccount: async (owner: string, row: unknown, selected: unknown) => {
      assert.equal(owner, user.activeUserId); assert.equal(row, integration); assert.equal(selected, account); events.push("verify");
      return verifyXAdsAccount(account, { permissions: [options.permission || "AD_MANAGER"] }, [{ currency: options.currency || "EUR", able_to_fund: true }]);
    },
    ADS_CAMPAIGN_ID_PATTERN: /^[a-f0-9-]{36}$/,
    canMutateAdsDraft: () => true,
    supabaseAdmin: { from: () => query, rpc: async (_name: string, value: Record<string, unknown>) => { events.push("update"); writes.push(value); return { data: campaignId, error: null }; } },
  };
  const filename = "app/api/ads/campaigns/route.ts";
  const source = ts.createSourceFile(filename, readFileSync(new URL(`../../${filename}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const post = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "POST");
  assert.ok(post);
  const compiled = ts.transpileModule(post.getText(source).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const execute = new Function(...Object.keys(scope), `${compiled}\nreturn POST;`)(...Object.values(scope));
  return { events, writes, save: (body = draft) => execute(new Request("https://app.example/api/ads/campaigns", { method: "POST", body: JSON.stringify(body) })) };
}

test("POST persiste le compte X associé seulement après vérification fraîche de son accès", async () => {
  const h = harness();
  assert.equal((await h.save()).status, 200);
  assert.deepEqual(h.events, ["connection", "accounts", "verify", "insert"]);
  assert.equal(h.writes[0].user_id, "business-owner");
  assert.equal(h.writes[0].ad_account_id, accountId);
  assert.equal((h.writes[0].draft as { adAccountId: string }).adAccountId, accountId);
});

test("POST refuse compte non associé, retiré, refusé, non EUR ou rôle révoqué sans écriture", async () => {
  for (const options of [{ connected: false }, { associatedId: "Other123" }, { listed: false }, { permission: "VIEWER" }, { currency: "USD" }, { accepted: false }]) {
    const h = harness(options);
    assert.ok([403, 409].includes((await h.save()).status), JSON.stringify(options));
    assert.equal(h.writes.length, 0);
  }
});

test("la sauvegarde X reste pilote et respecte le propriétaire lors d’une modification", async () => {
  const blocked = harness({ pilot: false });
  assert.equal((await blocked.save()).status, 403);
  assert.deepEqual(blocked.events, []);
  const foreign = harness({ existingOwner: "another-business" });
  assert.equal((await foreign.save({ ...draft, id: campaignId } as typeof draft)).status, 404);
  assert.equal(foreign.writes.length, 0);
  const owned = harness({ existingOwner: "business-owner" });
  assert.equal((await owned.save({ ...draft, id: campaignId } as typeof draft)).status, 200);
  assert.equal(owned.writes[0].p_user_id, "business-owner");
  assert.equal(owned.writes[0].p_ad_account_id, accountId);
});

test("le brouillon X sans compte reste enregistrable sans lire une connexion", async () => {
  const h = harness();
  assert.equal((await h.save({ ...draft, adAccountId: "" })).status, 200);
  assert.deepEqual(h.events, ["insert"]);
});
