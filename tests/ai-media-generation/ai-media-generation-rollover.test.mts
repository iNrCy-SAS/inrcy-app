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
const migration = await readFile(
  path.join(
    repositoryRoot,
    "supabase/migrations/20260914183000_ai_media_quota_rollover.sql",
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

test("les plafonds produit sont 70 images et 20 videos", () => {
  assert.deepEqual(AI_MEDIA_ROLLOVER_CAPS, { image: 70, video: 20 });
  assert.equal(getAiMediaRolloverCap("image"), 70);
  assert.equal(getAiMediaRolloverCap("video"), 20);
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

  let standardVideos = 5;
  for (const expected of [10, 15, 20, 20]) {
    standardVideos = nextPeriodLimit({
      previousLimit: standardVideos,
      previousUsed: 0,
      monthlyRecharge: 5,
      cap: 20,
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
      previousLimit: 5,
      previousUsed: 2,
      monthlyRecharge: 5,
      elapsedMonths: 2,
      cap: 20,
    }),
    13,
  );

  assert.match(migration, /left join public\.subscriptions s[\s\S]*s\.user_id = a\.id/i);
  assert.match(migration, /greatest\([\s\S]*date '2026-09-01'/i);
  assert.match(migration, /while v_credit_month <= p_period_start loop/i);
  assert.match(migration, /v_limit := least\(v_effective_cap, v_limit \+ p_base_limit\)/i);
  assert.match(migration, /sum\(u\.used_count \+ u\.reserved_count\)/i);
});

test("la migration initialise le mois courant sans cadeau retroactif", () => {
  assert.match(migration, /rollover_version smallint not null default 0/i);
  assert.match(migration, /if v_current\.rollover_version = 0 then/i);
  assert.match(migration, /v_limit := case[\s\S]*when p_base_limit = 0 then 0[\s\S]*else greatest\(p_base_limit,/i);
  assert.match(migration, /carried_count = 0/i);
  assert.match(migration, /and u\.rollover_version = 1[\s\S]*order by u\.period_start desc/i);
});

test("la recharge SQL est atomique, auditable et plafonnee", () => {
  for (const column of [
    "base_limit",
    "allocated_limit",
    "carried_count",
    "rollover_cap",
    "rollover_version",
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`, "i"));
  }

  assert.match(
    migration,
    /pg_advisory_xact_lock\([\s\S]*hashtext\(p_account_id::text\)[\s\S]*ai-media-rollover:/i,
  );
  assert.match(migration, /v_effective_cap := greatest\(p_rollover_cap, p_base_limit\)/i);
  assert.match(migration, /v_previous_remaining[\s\S]*p_base_limit::bigint \* v_months_gap::bigint/i);
  assert.match(migration, /'image',[\s\S]*v_image_base,[\s\S]*70,[\s\S]*v_period_start/i);
  assert.match(migration, /'video',[\s\S]*v_video_base,[\s\S]*20,[\s\S]*v_period_start/i);
  assert.match(migration, /case when v_media_kind = 'image' then 70 else 20 end/i);
});

test("la reservation conserve idempotence, overrides et restitution tardive", () => {
  assert.match(
    migration,
    /pg_advisory_xact_lock\(hashtext\(p_account_id::text\), hashtext\(v_request_key\)\)/i,
  );
  assert.match(migration, /v_limit := coalesce\(p_limit_override, v_rollover_limit\)/i);
  assert.match(migration, /if v_used \+ v_reserved >= v_limit then/i);
  assert.match(migration, /set reserved_count = u\.reserved_count \+ 1/i);
  assert.match(migration, /ai_media_monthly_usage_restore_late_rollover_refund/i);
  assert.match(migration, /after update of used_count, reserved_count/i);
  assert.match(migration, /least\(u\.rollover_cap, u\.allocated_limit \+ v_refund\)/i);
});

test("les helpers de mutation restent exclusivement serveur", () => {
  for (const signature of [
    "public.ai_media_prepare_monthly_rollover(uuid, text, integer, integer, date)",
    "public.ai_media_restore_late_rollover_refund()",
  ]) {
    assert.ok(migration.includes(`revoke all on function ${signature}`));
    assert.match(
      migration,
      new RegExp(
        `grant execute on function ${signature.replace(/[()]/g, "\\$&")}[\\s\\S]*to service_role`,
        "i",
      ),
    );
  }
});
