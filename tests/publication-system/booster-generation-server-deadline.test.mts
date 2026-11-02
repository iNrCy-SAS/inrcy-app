import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const route = read("app/api/booster/generate/route.ts");

const generationController = read("app/dashboard/booster/publier/useBoosterGeneration.ts");

test("the generation server owns a fresh route-entry deadline", () => {
  assert.match(
    route,
    /const generationDeadlineAt =\s*routeStartedAt \+ BOOSTER_GENERATION_SAFETY_BUDGET_MS/,
  );
  assert.doesNotMatch(route, /clientDeadlineAt/);
  assert.doesNotMatch(
    route,
    /generationDeadlineAt\s*=\s*Math\.min\([^;]*body\.generationDeadlineAt/,
  );
  assert.match(
    route,
    /withinGenerationDeadline\([\s\S]*generationDeadlineAt/,
  );
  assert.match(
    route,
    /generateSharedBoosterPosts\(\{[\s\S]*deadlineAt:\s*generationDeadlineAt - BOOSTER_GENERATION_CLOSE_MARGIN_MS/,
  );
});

test("browser media readiness finishes before its POST safety window starts", () => {
  const readinessIndex = generationController.indexOf(
    "await waitForPersistentWorkspaceReadiness",
  );
  const localFramesIndex = generationController.indexOf(
    "getOrPrepareVideoFramesForAI(videoFile)",
    readinessIndex,
  );
  const deadlineIndex = generationController.indexOf(
    "const generationDeadlineAt =",
    readinessIndex,
  );
  const fetchIndex = generationController.indexOf(
    'fetch("/api/booster/generate"',
    deadlineIndex,
  );

  assert.ok(readinessIndex >= 0);
  assert.ok(localFramesIndex > readinessIndex);
  assert.ok(deadlineIndex > localFramesIndex);
  assert.ok(fetchIndex > deadlineIndex);
  assert.match(
    generationController.slice(deadlineIndex, fetchIndex),
    /Date\.now\(\) \+ BOOSTER_GENERATION_SAFETY_BUDGET_MS/,
  );
});
