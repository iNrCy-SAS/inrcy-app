import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  BUSINESS_DNA_MANUAL_MONTHLY_LIMIT,
  computeNextBusinessDnaAutomaticOccurrence,
  normalizeBusinessDnaScheduleDay,
  normalizeBusinessDnaScheduleTime,
  normalizeBusinessDnaScheduleTimezone,
} from "../../lib/businessDnaAutomaticSchedule.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("le quota manuel public est fixé à trois analyses", () => {
  assert.equal(BUSINESS_DNA_MANUAL_MONTHLY_LIMIT, 3);
  const migration = read(
    "supabase/migrations/20260911190000_business_dna_automatic_analysis.sql",
  );
  assert.match(migration, /\('standard', 3\)/);
  assert.match(migration, /\('premium', 3\)/);
  assert.match(migration, /\('founder', 3\)/);
});

test("une occurrence mensuelle respecte le fuseau Europe/Paris", () => {
  const occurrence = computeNextBusinessDnaAutomaticOccurrence({
    dayOfMonth: 5,
    time: "07:00",
    timezone: "Europe/Paris",
    now: new Date("2026-09-01T00:00:00.000Z"),
  });
  assert.deepEqual(occurrence, {
    periodStart: "2026-09-01",
    runAt: "2026-09-05T05:00:00.000Z",
  });
});

test("une date déjà passée bascule au mois suivant", () => {
  const occurrence = computeNextBusinessDnaAutomaticOccurrence({
    dayOfMonth: 5,
    time: "07:00",
    timezone: "Europe/Paris",
    now: new Date("2026-09-06T12:00:00.000Z"),
  });
  assert.equal(occurrence.periodStart, "2026-10-01");
  assert.equal(occurrence.runAt, "2026-10-05T05:00:00.000Z");
});

test("un mois déjà traité ne peut pas recevoir une seconde analyse gratuite", () => {
  const occurrence = computeNextBusinessDnaAutomaticOccurrence({
    dayOfMonth: 25,
    time: "07:00",
    timezone: "Europe/Paris",
    now: new Date("2026-09-10T12:00:00.000Z"),
    lastProcessedPeriod: "2026-09-01",
  });
  assert.equal(occurrence.periodStart, "2026-10-01");
  assert.equal(occurrence.runAt, "2026-10-25T06:00:00.000Z");
});

test("les valeurs de programmation invalides reviennent aux valeurs sûres", () => {
  assert.equal(normalizeBusinessDnaScheduleDay(0), 5);
  assert.equal(normalizeBusinessDnaScheduleDay(29), 5);
  assert.equal(normalizeBusinessDnaScheduleTime("25:90"), "07:00");
  assert.equal(normalizeBusinessDnaScheduleTimezone("Fuseau/Inconnu"), "Europe/Paris");
});

test("la migration garantit claim atomique, lease et historique mensuel", () => {
  const migration = read(
    "supabase/migrations/20260911190000_business_dna_automatic_analysis.sql",
  );
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /lock_expires_at/i);
  assert.match(migration, /last_run_period/i);
  assert.match(migration, /BUSINESS_DNA_AUTOMATIC_PERIOD_ALREADY_PROCESSED/);
  assert.match(migration, /v_candidate_run_at := public\.business_dna_scheduled_at/i);
  assert.doesNotMatch(
    migration,
    /create or replace function public\.upsert_business_dna_analysis_schedule\([\s\S]*?p_next_run_at/i,
  );
  assert.match(migration, /Une panne technique ne consomme jamais l'analyse mensuelle/i);
  assert.doesNotMatch(migration, /attempt_count\s*>=\s*3/i);
  assert.match(
    migration,
    /grant execute on function public\.claim_due_business_dna_automatic_analysis\(integer\)[\s\S]*?to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.claim_due_business_dna_automatic_analysis\(integer\)[\s\S]{0,80}?to authenticated/i,
  );
});

test("l'analyse automatique contourne seulement le quota manuel via le cron privé", () => {
  const route = read("app/api/ai-memory/analyze-channels/route.ts");
  const cron = read("app/api/cron/business-dna-analysis/route.ts");
  const vercel = read("vercel.json");
  assert.match(route, /isAuthorizedCronRequest\(request\)/);
  assert.match(route, /if \(!automatic\)[\s\S]*?consumeBusinessDnaAnalysisQuota/);
  assert.match(route, /if \(automatic\)[\s\S]*?mergeAiBusinessDnaAnalysis/);
  assert.match(cron, /claim_due_business_dna_automatic_analysis/);
  assert.match(cron, /complete_business_dna_automatic_analysis/);
  assert.match(vercel, /"path": "\/api\/cron\/business-dna-analysis"/);
});

test("le bouton de programmation reste sous l'action manuelle et ouvre une modale", () => {
  const content = read("app/dashboard/settings/_components/AiMemoryContent.tsx");
  const modal = read(
    "app/dashboard/settings/_components/BusinessDnaAnalysisScheduleModal.tsx",
  );
  assert.match(
    content,
    /t\("analysisButton"\)[\s\S]*?t\("analysisScheduleButton"\)/,
  );
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /analysisScheduleQuotaHint/);
});
