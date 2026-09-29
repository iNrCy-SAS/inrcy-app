import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adsPlanNeedsTrustedLocation } from "../lib/adsCampaignIntelligence.ts";

const routeSource = readFileSync(
  new URL("../app/api/ads/plan/route.ts", import.meta.url),
  "utf8",
);

test("iNr’ADS continue sans mémoire ni historique quand le profil professionnel est lisible", () => {
  assert.match(routeSource, /async function readContextSource/);
  assert.match(routeSource, /readContextSource\("ai_memory"/);
  assert.match(routeSource, /readContextSource\("campaign_history"/);
  assert.match(routeSource, /readContextSource\("publication_history"/);
  assert.doesNotMatch(
    routeSource,
    /if \(businessResult\.error \|\| profileResult\.error \|\| memoryResult\.error \|\| historyResult\.error\)/,
  );
});

test("iNr’ADS conserve le client RLS et ne renvoie 503 que si les deux profils de base sont indisponibles", () => {
  assert.match(routeSource, /user\.supabase\s*\.from\("business_ai_memories"/);
  assert.match(routeSource, /user\.supabase\s*\.from\("profiles"/);
  assert.match(
    routeSource,
    /if \(!hasReadableProfessionalProfile && \(businessResult\.error \|\| profileResult\.error\)\)/,
  );
  assert.match(routeSource, /ADS_PROFILE_CONTEXT_UNAVAILABLE/);
});

test("l’historique des campagnes reste lu côté serveur et limité au compte actif", () => {
  assert.match(
    routeSource,
    /readContextSource\("campaign_history", \(\) => supabaseAdmin\s*\.from\("ads_campaigns"\)\s*\.select\("name,provider,created_at"\)\s*\.eq\("user_id", user\.activeUserId\)/,
  );
});

test("les incidents de sources secondaires produisent un log serveur borné, sans donnée professionnelle", () => {
  assert.match(routeSource, /\[ads\.plan\] optional context source unavailable/);
  assert.match(routeSource, /code: contextErrorCode\(result\.error\)/);
  assert.match(routeSource, /return \{ data: null, error \};/);
  assert.doesNotMatch(routeSource, /message: .*error/);
});

test("un brief natif sans zone sûre est refusé avant le crédit et les trois moteurs", () => {
  for (const provider of ["linkedin", "tiktok", "pinterest", "x"]) {
    assert.equal(adsPlanNeedsTrustedLocation(provider, [], ""), true, provider);
    assert.equal(adsPlanNeedsTrustedLocation(provider, ["Lyon"], ""), false, provider);
    assert.equal(adsPlanNeedsTrustedLocation(provider, [], "Paris"), false, provider);
  }
  assert.equal(adsPlanNeedsTrustedLocation("google", [], ""), false);
  assert.equal(adsPlanNeedsTrustedLocation("meta", [], ""), false);
  const preflight = routeSource.indexOf("adsPlanNeedsTrustedLocation(provider, context.zones, context.localContext.city)");
  const reservation = routeSource.indexOf("reserveAiCredits(");
  assert.ok(preflight >= 0 && reservation > preflight);
  assert.match(routeSource, /ADS_PLAN_LOCATION_REQUIRED/);
});

test("le délai IA laisse une marge pour rendre la réponse et gérer le crédit", () => {
  const deadline = routeSource.indexOf("const generationDeadlineAt = startedAt + maxDuration * 1_000 - 15_000");
  const reservation = routeSource.indexOf("reserveAiCredits(");
  assert.ok(deadline >= 0 && deadline < reservation);
  assert.doesNotMatch(routeSource, /const generationDeadlineAt = Date\.now\(\) \+ 110_000/);
});

test("Pinterest impose son schéma natif avant la validation sémantique", () => {
  assert.match(routeSource, /provider === "pinterest" \? \{ responseSchema: pinterestAdsCampaignPlanResponseSchema\(\) \}/);
  assert.match(routeSource, /adsCampaignPlanValidationIssueCodes\(rawPlan/);
});

test("chaque moteur journalise une étape et des codes non sensibles", () => {
  assert.match(routeSource, /\[ads\.plan\] model attempt rejected/);
  assert.match(routeSource, /stage: "generation"/);
  assert.match(routeSource, /stage: "validation"/);
  assert.match(routeSource, /engineCode: safeEngineErrorCode\(error\)/);
  assert.match(routeSource, /reasonCode: "ADS_PLAN_RESPONSE_INCOMPLETE"/);
  assert.match(routeSource, /issueCodes/);
  assert.doesNotMatch(routeSource, /model attempt rejected", \{[^}]*\b(?:rawPlan|primaryText|pinDescription|system|input)\b/);
});
