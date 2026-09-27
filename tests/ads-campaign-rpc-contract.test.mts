import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function functionBlock(sql: string, name: string): { definition: string; args: string } {
  const match = sql.match(new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns uuid([\\s\\S]*?)\\$\\$;`, "i"));
  assert.ok(match, `${name} must have an explicit SQL definition`);
  return { args: match[1], definition: match[2] };
}

const contracts = [
  {
    name: "inrcy_extend_ads_draft",
    migration: "supabase/migrations/20260926205527_ads_campaign_draft_atomic_actions.sql",
    route: "app/api/ads/campaigns/[id]/route.ts",
    signature: "uuid, uuid, timestamptz, date, date, jsonb",
  },
  {
    name: "inrcy_delete_ads_draft",
    migration: "supabase/migrations/20260926205527_ads_campaign_draft_atomic_actions.sql",
    route: "app/api/ads/campaigns/[id]/route.ts",
    signature: "uuid, uuid, timestamptz",
  },
  {
    name: "inrcy_update_ads_draft",
    migration: "supabase/migrations/20260926213059_ads_campaign_draft_update_and_claim.sql",
    route: "app/api/ads/campaigns/route.ts",
    signature: "uuid, uuid, timestamptz, text, text, text, integer, date, jsonb",
  },
  {
    name: "inrcy_claim_ads_draft_for_publish",
    migration: "supabase/migrations/20260926213059_ads_campaign_draft_update_and_claim.sql",
    route: "app/api/ads/campaigns/[id]/publish/route.ts",
    signature: "uuid, uuid, timestamptz",
  },
] as const;

test("the four Ads RPC calls use exactly the declared SQL argument names", () => {
  for (const contract of contracts) {
    const sql = source(contract.migration);
    const block = functionBlock(sql, contract.name);
    const sqlArgs = [...block.args.matchAll(/\b(p_[a-z_]+)\s+(?:uuid|timestamptz|date|text|integer|jsonb)\b/gi)]
      .map((match) => match[1]).sort();
    const call = source(contract.route).match(new RegExp(`\\.rpc\\("${contract.name}",\\s*\\{([\\s\\S]*?)\\}\\)`));
    assert.ok(call, `${contract.name} must be called by its campaign route`);
    const callArgs = [...call[1].matchAll(/\b(p_[a-z_]+)\s*:/g)].map((match) => match[1]).sort();
    assert.deepEqual(callArgs, sqlArgs, `${contract.name} route/SQL signature drift`);
  }
});

test("each Ads RPC is invoker-only, service-role-only, and guards the atomic row", () => {
  const base = source("supabase/migrations/20260924110918_inr_ads_campaigns.sql");
  assert.match(base, /alter table public\.ads_campaigns enable row level security;/i);
  assert.match(base, /revoke all on public\.ads_campaigns from anon, authenticated;/i);
  assert.match(base, /grant select, insert, update on public\.ads_campaigns to service_role;/i);

  for (const contract of contracts) {
    const sql = source(contract.migration);
    const block = functionBlock(sql, contract.name);
    assert.match(block.definition, /security invoker\s+set search_path = ''/i);
    assert.match(block.definition, /where id = p_campaign_id[\s\S]*?and user_id = p_user_id[\s\S]*?and status = 'draft'[\s\S]*?and published_at is null[\s\S]*?and provider_resources = '\{\}'::jsonb[\s\S]*?and updated_at = p_expected_updated_at/i);
    const sig = `${contract.name}\\(${contract.signature.replaceAll(", ", ",\\s*")}\\)`;
    assert.match(sql, new RegExp(`revoke all on function public\\.${sig}\\s+from public, anon, authenticated;`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${sig}\\s+to service_role;`, "i"));
  }

  const atomic = source("supabase/migrations/20260926205527_ads_campaign_draft_atomic_actions.sql");
  assert.match(atomic, /grant delete on public\.ads_campaigns to service_role;/i);
});

test("the follow-up migration restores invoker mode to older deployed draft functions", () => {
  const followUp = source("supabase/migrations/20260927184251_20260927165829_ads_campaign_draft_invoker_permissions.sql");
  const statements = followUp.replace(/--[^\r\n]*/g, "");
  assert.match(followUp, /alter function public\.inrcy_extend_ads_draft\(uuid, uuid, timestamptz, date, date, jsonb\)\s+security invoker;/i);
  assert.match(followUp, /alter function public\.inrcy_delete_ads_draft\(uuid, uuid, timestamptz\)\s+security invoker;/i);
  assert.doesNotMatch(statements, /security definer|grant execute[\s\S]*?to (?:anon|authenticated)/i);
});
