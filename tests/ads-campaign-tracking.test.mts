import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ADS_CAMPAIGN_ID_PATTERN, canMutateAdsDraft, validateDraftExtension } from "../app/api/ads/campaigns/[id]/trackingPolicy.ts";

test("seuls les brouillons sans ressource fournisseur peuvent changer localement", () => {
  const draft = { status: "draft", published_at: null, provider_resources: {} };
  assert.equal(canMutateAdsDraft(draft), true);
  assert.equal(canMutateAdsDraft({ ...draft, status: "active" }), false);
  assert.equal(canMutateAdsDraft({ ...draft, status: "publishing" }), false);
  assert.equal(canMutateAdsDraft({ ...draft, status: "needs_review" }), false);
  assert.equal(canMutateAdsDraft({ ...draft, status: "demo_paused" }), false);
  assert.equal(canMutateAdsDraft({ ...draft, published_at: "2026-09-26T10:00:00Z" }), false);
  assert.equal(canMutateAdsDraft({ ...draft, provider_resources: { campaignId: "remote-123" } }), false);
  assert.equal(canMutateAdsDraft({ ...draft, provider_resources: null }), false);
});

test("une prolongation exige une date réelle et postérieure dans la fenêtre du studio", () => {
  const now = new Date("2026-09-26T10:00:00.000Z");
  assert.equal(validateDraftExtension("2026-10-01", "2026-10-15", now), null);
  assert.match(validateDraftExtension("2026-10-01", "2026-09-30", now) || "", /postérieure/);
  assert.match(validateDraftExtension("2026-10-01", "2026-02-30", now) || "", /valide/);
  assert.match(validateDraftExtension("2026-10-01", "2027-01-01", now) || "", /89 jours/);
  assert.match(validateDraftExtension("2026-10-01", "2026-10-01", now) || "", /postérieure/);
});

test("les mutations sont bornées au compte et au brouillon sans publication", () => {
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260926205527_ads_campaign_draft_atomic_actions.sql", import.meta.url), "utf8");
  const updateMigration = readFileSync(new URL("../supabase/migrations/20260926213059_ads_campaign_draft_update_and_claim.sql", import.meta.url), "utf8");
  assert.equal(ADS_CAMPAIGN_ID_PATTERN.test("72b4871a-95e4-4e16-b16e-94c8341741a5"), true);
  assert.equal(ADS_CAMPAIGN_ID_PATTERN.test("../../../other-user"), false);
  assert.match(route, /adsRequestOriginAllowed\(request\)/);
  assert.match(route, /requirePremiumAdsUser\(\)/);
  assert.match(route, /canMutateAdsDraft\(data\)/);
  assert.match(route, /\.rpc\("inrcy_extend_ads_draft"/);
  assert.match(route, /\.rpc\("inrcy_delete_ads_draft"/);
  assert.match(route, /p_expected_updated_at: campaign\.updated_at/g);
  assert.match(migration, /provider_resources = '\{\}'::jsonb/g);
  assert.match(migration, /status = 'draft'/g);
  assert.match(migration, /published_at is null/g);
  assert.match(migration, /user_id = p_user_id/g);
  assert.match(migration, /updated_at = p_expected_updated_at/g);
  assert.match(migration, /grant execute on function public\.inrcy_delete_ads_draft[\s\S]+?to service_role/i);
  assert.match(migration, /grant delete on public\.ads_campaigns to service_role/i);
  assert.equal((migration.match(/security invoker/g) || []).length, 2);
  assert.doesNotMatch(migration, /^\s*security definer\s*$/im);
  assert.match(updateMigration, /create or replace function public\.inrcy_update_ads_draft/);
  assert.match(updateMigration, /security invoker[\s\S]+?provider_resources = '\{\}'::jsonb[\s\S]+?updated_at = p_expected_updated_at/i);
  assert.match(updateMigration, /grant execute on function public\.inrcy_update_ads_draft[\s\S]+?to service_role/i);
  assert.match(updateMigration, /create or replace function public\.inrcy_claim_ads_draft_for_publish/);
  assert.match(updateMigration, /grant execute on function public\.inrcy_claim_ads_draft_for_publish[\s\S]+?to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]+?to (?:anon|authenticated)/i);
  assert.doesNotMatch(updateMigration, /grant execute[\s\S]+?to (?:anon|authenticated)/i);
  const saveRoute = readFileSync(new URL("../app/api/ads/campaigns/route.ts", import.meta.url), "utf8");
  assert.match(saveRoute, /ADS_CAMPAIGN_ID_PATTERN\.test\(requestedId\)/);
  assert.match(saveRoute, /canMutateAdsDraft\(existing\)/);
  assert.match(saveRoute, /\.rpc\("inrcy_update_ads_draft"/);
  assert.match(saveRoute, /p_expected_updated_at: existing\.updated_at/);
  assert.doesNotMatch(saveRoute, /\.update\(payload\)\.eq\("id", id\)/);
  const publishRoute = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(publishRoute, /\.rpc\("inrcy_claim_ads_draft_for_publish"/);
  assert.match(publishRoute, /p_expected_updated_at: stored\.updated_at/);
  assert.doesNotMatch(publishRoute, /\.eq\("status", "draft"\)[\s\S]*?\.select\("id"\)\.maybeSingle\(\)/);
});

test("la migration additive corrige les fonctions déjà installées sans élargir leur accès", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260927184251_20260927165829_ads_campaign_draft_invoker_permissions.sql", import.meta.url),
    "utf8",
  );
  const sql = migration.replace(/--[^\r\n]*/g, "").replace(/\s+/g, " ").trim();
  assert.match(sql, /^begin;[\s\S]*commit;$/i);
  assert.match(sql, /grant delete on public\.ads_campaigns to service_role;/i);
  assert.match(sql, /alter function public\.inrcy_extend_ads_draft\(uuid, uuid, timestamptz, date, date, jsonb\) security invoker;/i);
  assert.match(sql, /alter function public\.inrcy_delete_ads_draft\(uuid, uuid, timestamptz\) security invoker;/i);
  for (const signature of [
    "inrcy_extend_ads_draft\\(uuid, uuid, timestamptz, date, date, jsonb\\)",
    "inrcy_delete_ads_draft\\(uuid, uuid, timestamptz\\)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated;`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature} to service_role;`, "i"));
  }
  assert.doesNotMatch(sql, /create(?: or replace)? function|security definer|grant (?:all|delete) on public\.ads_campaigns to (?:public|anon|authenticated)/i);
});

test("le suivi distingue le budget prévu des statistiques réelles indisponibles", () => {
  const component = readFileSync(new URL("../app/dashboard/ads/AdsCampaignTracking.tsx", import.meta.url), "utf8");
  assert.match(component, /Budget\/jour prévu/);
  assert.match(component, /Performances réelles/);
  assert.match(component, /Les performances Google Ads et Meta Ads sont consultées à la demande/);
  assert.match(component, /Voir les statistiques/);
  assert.match(component, /\/metrics[\s\S]*cache: "no-store"/);
  assert.match(component, /metricsState\.metrics\.conversions === null \? "Non harmonisées"/);
  assert.match(component, /canReadMetrics \? "À consulter" : "Indisponibles"/);
  assert.match(component, /Modification, prolongation et suppression indisponibles ici après le lancement/);
  assert.match(component, /method: "DELETE"/);
  assert.match(component, /method: "PATCH"/);
  assert.match(component, /Afficher les campagnes suivantes/);
  const listing = readFileSync(new URL("../app/api/ads/campaigns/route.ts", import.meta.url), "utf8");
  assert.match(listing, /count: "exact"/);
  assert.match(listing, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(listing, /\.range\(offset, offset \+ CAMPAIGN_PAGE_SIZE - 1\)/);
  assert.match(listing, /nextOffset/);
  assert.doesNotMatch(listing, /\.limit\(50\)/);
});
