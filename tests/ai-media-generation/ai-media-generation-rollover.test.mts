import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AI_MEDIA_ROLLOVER_CAPS,
  getAiMediaRolloverCap,
} from "../../lib/aiMediaGenerationQuotaPolicy.ts";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../..");
const rolloverMigration = await readFile(
  path.join(
    repositoryRoot,
    "supabase/migrations/20260914183000_ai_media_quota_rollover.sql",
  ),
  "utf8",
);
const secondsMigration = await readFile(
  path.join(
    repositoryRoot,
    "supabase/migrations/20260922150126_ai_media_video_seconds_quota.sql",
  ),
  "utf8",
);

function nextPeriodLimit(args: {
  previousLimit: number;
  previousUsed: number;
  previousReserved?: number;
  monthlyRecharge: number;
  elapsedMonths?: number;
  cap: number;
}): number {
  const remaining = Math.max(
    args.previousLimit - args.previousUsed - (args.previousReserved ?? 0),
    0,
  );
  return Math.min(
    Math.max(args.cap, args.monthlyRecharge),
    remaining + args.monthlyRecharge * (args.elapsedMonths ?? 1),
  );
}

test("les plafonds produit conservent 70 images et reportent les secondes selon le forfait", () => {
  assert.deepEqual(AI_MEDIA_ROLLOVER_CAPS, {
    standard: { image: 70, video: 168 },
    premium: { image: 70, video: 480 },
    founder: { image: 70, video: 480 },
  });
  assert.equal(getAiMediaRolloverCap("standard", "image"), 70);
  assert.equal(getAiMediaRolloverCap("standard", "video"), 168);
  assert.equal(getAiMediaRolloverCap("premium", "video"), 480);
});

test("les credits inutilises se cumulent puis s'arretent exactement au plafond", () => {
  let standardImages = 20;
  standardImages = nextPeriodLimit({
    previousLimit: standardImages,
    previousUsed: 0,
    monthlyRecharge: 20,
    cap: 70,
  });
  assert.equal(standardImages, 40);
  standardImages = nextPeriodLimit({
    previousLimit: standardImages,
    previousUsed: 0,
    monthlyRecharge: 20,
    cap: 70,
  });
  assert.equal(standardImages, 60);
  standardImages = nextPeriodLimit({
    previousLimit: standardImages,
    previousUsed: 0,
    monthlyRecharge: 20,
    cap: 70,
  });
  assert.equal(standardImages, 70);
  assert.equal(
    nextPeriodLimit({
      previousLimit: standardImages,
      previousUsed: 0,
      monthlyRecharge: 20,
      cap: 70,
    }),
    70,
  );

  let premiumImages = 30;
  premiumImages = nextPeriodLimit({
    previousLimit: premiumImages,
    previousUsed: 0,
    monthlyRecharge: 30,
    cap: 70,
  });
  assert.equal(premiumImages, 60);
  premiumImages = nextPeriodLimit({
    previousLimit: premiumImages,
    previousUsed: 0,
    monthlyRecharge: 30,
    cap: 70,
  });
  assert.equal(premiumImages, 70);

  let standardVideos = 48;
  for (const expected of [96, 144, 168, 168]) {
    standardVideos = nextPeriodLimit({
      previousLimit: standardVideos,
      previousUsed: 0,
      monthlyRecharge: 48,
      cap: 168,
    });
    assert.equal(standardVideos, expected);
  }
});

test("les credits perdus au plafond ne reapparaissent pas apres une consommation", () => {
  const afterCapMonth = nextPeriodLimit({
    previousLimit: 70,
    previousUsed: 0,
    monthlyRecharge: 20,
    cap: 70,
  });
  assert.equal(afterCapMonth, 70);

  const afterUsingThirty = nextPeriodLimit({
    previousLimit: afterCapMonth,
    previousUsed: 30,
    monthlyRecharge: 20,
    cap: 70,
  });
  assert.equal(afterUsingThirty, 60);
});

test("plusieurs mois sans connexion sont credites sans depasser la cagnotte", () => {
  assert.equal(
    nextPeriodLimit({
      previousLimit: 20,
      previousUsed: 8,
      monthlyRecharge: 20,
      elapsedMonths: 3,
      cap: 70,
    }),
    70,
  );
  assert.equal(
    nextPeriodLimit({
      previousLimit: 48,
      previousUsed: 16,
      monthlyRecharge: 48,
      elapsedMonths: 2,
      cap: 168,
    }),
    128,
  );

  assert.match(rolloverMigration, /left join public\.subscriptions s[\s\S]*s\.user_id = a\.id/i);
  assert.match(rolloverMigration, /greatest\([\s\S]*date '2026-09-01'/i);
  assert.match(rolloverMigration, /while v_credit_month <= p_period_start loop/i);
  assert.match(rolloverMigration, /v_limit := least\(v_effective_cap, v_limit \+ p_base_limit\)/i);
  assert.match(rolloverMigration, /sum\(u\.used_count \+ u\.reserved_count\)/i);
});

test("la migration initialise le mois courant sans cadeau retroactif", () => {
  assert.match(rolloverMigration, /rollover_version smallint not null default 0/i);
  assert.match(secondsMigration, /if v_current\.rollover_version = 0 then/i);
  assert.match(secondsMigration, /v_limit := case[\s\S]*when p_base_limit = 0 then 0[\s\S]*else greatest\(/i);
  assert.match(secondsMigration, /carried_count = 0/i);
  assert.match(secondsMigration, /and u\.rollover_version = 1[\s\S]*order by u\.period_start desc/i);
});

test("la recharge SQL est atomique, auditable et plafonnee", () => {
  for (const column of [
    "base_limit",
    "allocated_limit",
    "carried_count",
    "rollover_cap",
    "rollover_version",
  ]) {
    assert.match(rolloverMigration, new RegExp(`add column if not exists ${column}`, "i"));
  }

  assert.match(
    secondsMigration,
    /pg_advisory_xact_lock\([\s\S]*hashtext\(p_account_id::text\)[\s\S]*ai-media-rollover:/i,
  );
  assert.match(secondsMigration, /v_effective_cap := greatest\(p_rollover_cap, p_base_limit\)/i);
  assert.match(secondsMigration, /v_previous_remaining[\s\S]*p_base_limit::bigint \* v_months_gap::bigint/i);
  assert.match(secondsMigration, /'image',[\s\S]*v_image_base,[\s\S]*70,[\s\S]*v_period_start/i);
  assert.match(secondsMigration, /when v_plan\.edition = 'standard' then 168[\s\S]*else 480/i);
});

test("la reservation conserve idempotence, overrides et restitution tardive", () => {
  assert.match(
    secondsMigration,
    /pg_catalog\.pg_advisory_xact_lock\([\s\S]*pg_catalog\.hashtext\(p_account_id::text\)[\s\S]*pg_catalog\.hashtext\(v_request_key\)/i,
  );
  assert.match(secondsMigration, /v_limit := coalesce\(p_limit_override, v_rollover_limit\)/i);
  assert.match(secondsMigration, /if v_used \+ v_reserved \+ p_quota_amount > v_limit then/i);
  assert.match(secondsMigration, /set reserved_count = u\.reserved_count \+ p_quota_amount/i);
  assert.match(secondsMigration, /ai_media_monthly_usage_restore_late_rollover_refund/i);
  assert.match(secondsMigration, /after update of used_count, reserved_count/i);
  assert.match(secondsMigration, /least\(u\.rollover_cap, u\.allocated_limit \+ v_refund\)/i);
});

test("les helpers de mutation restent exclusivement serveur", () => {
  for (const signature of [
    "public.ai_media_prepare_monthly_rollover(uuid, text, integer, integer, date)",
    "public.ai_media_restore_late_rollover_refund()",
  ]) {
    assert.ok(secondsMigration.includes(`revoke all on function ${signature}`));
    assert.match(
      secondsMigration,
      new RegExp(
        `grant execute on function ${signature.replace(/[()]/g, "\\$&")}[\\s\\S]*to service_role`,
        "i",
      ),
    );
  }
});

test("le ledger secondes est immuable et toutes les transitions utilisent le montant du job", () => {
  assert.match(secondsMigration, /add column if not exists quota_unit text not null default 'item'/i);
  assert.match(secondsMigration, /add column if not exists quota_amount integer not null default 1/i);
  assert.match(secondsMigration, /AI_MEDIA_QUOTA_LEDGER_IMMUTABLE/i);
  assert.match(secondsMigration, /before update of quota_unit, quota_amount/i);
  assert.match(secondsMigration, /quota_amount in \(8, 16, 24\)/i);
  assert.match(secondsMigration, /used_count = u\.used_count \+ v_job\.quota_amount/i);
  assert.match(secondsMigration, /reserved_count = u\.reserved_count - v_job\.quota_amount/i);
  assert.match(secondsMigration, /reserved_count >= v_job\.quota_amount/i);
  assert.match(secondsMigration, /quota_recovered_from_library/i);
  assert.match(secondsMigration, /AI_MEDIA_DRAFT_RESERVATION_INVARIANT_BROKEN/i);
});

test("les RPC v2 exposent explicitement l'unite et le montant, sans acces client", () => {
  for (const rpc of [
    "get_ai_media_generation_quota_v2",
    "reserve_ai_media_generation_v2",
    "complete_ai_media_generation_v2",
    "fail_ai_media_generation_v2",
  ]) {
    assert.match(secondsMigration, new RegExp(`function public\\.${rpc}\\(`, "i"));
  }
  assert.match(secondsMigration, /p_quota_amount integer/i);
  assert.match(secondsMigration, /quota_unit text,[\s\S]*quota_amount integer/i);
  assert.match(secondsMigration, /from public, anon, authenticated/i);
  assert.match(secondsMigration, /to service_role/i);
  assert.match(secondsMigration, /set search_path = ''/i);
});

test("la bascule preserve les usages historiques et fixe 48 ou 144 secondes mensuelles", () => {
  assert.match(secondsMigration, /when 'standard' then 48/i);
  assert.match(secondsMigration, /when 'premium' then 144/i);
  assert.match(secondsMigration, /when 'founder' then 144/i);
  assert.match(secondsMigration, /video_monthly_limit_override \* 8/i);
  assert.match(secondsMigration, /greatest\(u\.used_count \* 8, coalesce\(t\.used_amount, 0\)\)/i);
  assert.match(secondsMigration, /when \(j\.metadata ->> 'duration_seconds'\) ~ '\^\(8\|16\|24\)\$'/i);
  assert.match(secondsMigration, /else 8/i);
});
