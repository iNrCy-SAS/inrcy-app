import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("les incidents de sources secondaires produisent un log serveur borné, sans donnée professionnelle", () => {
  assert.match(routeSource, /\[ads\.plan\] optional context source unavailable/);
  assert.match(routeSource, /code: contextErrorCode\(result\.error\)/);
  assert.match(routeSource, /return \{ data: null, error \};/);
  assert.doesNotMatch(routeSource, /message: .*error/);
});
