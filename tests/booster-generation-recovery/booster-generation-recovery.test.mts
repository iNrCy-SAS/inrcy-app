import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeBoosterGenerationRequestId,
  readBoosterGenerationRecoveryPayload,
} from "../../lib/boosterGenerationRecovery.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const requestId = "bg_20260807_mobile_recovery_1234";

test("un résultat n'est récupéré que pour son reçu exact", () => {
  const generatedContent = {
    generatedAt: "2026-08-07T15:15:45.000Z",
    postByChannel: {
      facebook: { title: "Titre", content: "Contenu" },
      pinterest: { title: "Épingle", content: "Description" },
      x: { content: "Contenu X" },
      canal_inconnu: { content: "Ne doit pas sortir" },
    },
    boosterGenerationReceipt: {
      requestId,
      status: "ready",
      generatedAt: "2026-08-07T15:15:45.000Z",
      recoveredChannels: ["facebook", "x", "canal_inconnu"],
      aiFallback: { used: true, finalEngineLabel: "ChatGPT" },
    },
  };

  const recovered = readBoosterGenerationRecoveryPayload(
    generatedContent,
    requestId,
  );
  assert.ok(recovered);
  assert.deepEqual(Object.keys(recovered.versions), ["facebook", "pinterest", "x"]);
  assert.deepEqual(recovered.recoveredChannels, ["facebook", "x"]);
  assert.equal(recovered.aiFallback?.used, true);
  assert.equal(
    readBoosterGenerationRecoveryPayload(generatedContent, `${requestId}_old`),
    null,
  );
});

test("un reçu incomplet, ancien ou invalide n'est jamais injecté dans l'éditeur", () => {
  assert.equal(normalizeBoosterGenerationRequestId("court"), "");
  assert.equal(
    readBoosterGenerationRecoveryPayload(
      {
        postByChannel: { facebook: { content: "Texte" } },
        boosterGenerationReceipt: { requestId, status: "pending" },
      },
      requestId,
    ),
    null,
  );
  assert.equal(
    readBoosterGenerationRecoveryPayload(
      {
        postByChannel: {},
        boosterGenerationReceipt: { requestId, status: "ready" },
      },
      requestId,
    ),
    null,
  );
});

test("le renforcement reste isolé du moteur et des parcours de publication", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const generationRoute = read("app/api/booster/generate/route.ts");
  const recoveryRoute = read("app/api/booster/generation-result/route.ts");
  const recoveryClient = read("lib/boosterGenerationRecoveryClient.ts");

  assert.match(modal, /fetch\("\/api\/booster\/generate"/);
  assert.match(modal, /executeGenerationRequestWithRecovery/);
  assert.match(
    modal,
    /const recoveryWorkspace = await ensurePersistentMediaWorkspace\(\)/,
  );
  assert.match(
    modal,
    /recovery receipt workspace unavailable/,
  );
  assert.match(modal, /response:\s*null,[\s\S]*responseJson:\s*recovery\.payload/);
  assert.match(
    modal,
    /Aucun nouvel appel IA n[’']a été lancé/,
  );
  assert.match(generationRoute, /boosterGenerationReceipt/);
  assert.match(generationRoute, /generationRequestId/);
  assert.match(recoveryRoute, /\.eq\("account_id", activeUserId\)/);
  assert.match(recoveryRoute, /status:\s*"pending"/);
  assert.match(recoveryClient, /booster_generation_response_lost/);
  assert.doesNotMatch(recoveryClient, /publish-now|schedule|program/i);
  assert.doesNotMatch(recoveryRoute, /generateSharedBoosterPosts|reserveAiCredits/);
});
