import assert from "node:assert/strict";
import test from "node:test";
import { INR_ASSISTANT_MODELS as models, INR_ASSISTANT_MODEL_PRICING, canReserveInrAssistantSol, classifyInrAssistantRequest, getInrAssistantModelChain } from "../../lib/inrAssistantPolicy.ts";

test("Standard never receives Sol, including a forged reservation and complex fallback", () => {
  for (const complexity of ["routine", "complex"] as const) for (const solReserved of [true, false]) {
    const chain = getInrAssistantModelChain({ edition: "standard", complexity, solReserved });
    assert.equal(chain.some((attempt) => attempt.model === models.sol), false);
    assert.deepEqual(new Set(chain.map((attempt) => attempt.model)), new Set([models.luna, models.qwen, models.haiku]));
  }
});

test("Premium and Founder require BOTH complex work and reserved Sol allowance", () => {
  for (const edition of ["premium", "founder"] as const) for (const complexity of ["routine", "complex"] as const) for (const solReserved of [true, false]) {
    const chain = getInrAssistantModelChain({ edition, complexity, solReserved });
    const expected = complexity === "complex" && solReserved;
    assert.equal(chain.some((attempt) => attempt.model === models.sol), expected);
    assert.equal(chain[0].model, expected ? models.sol : complexity === "routine" ? models.qwen : models.luna);
  }
});

test("complex Standard work increases Luna reasoning and uses Haiku before Qwen", () => {
  assert.deepEqual(getInrAssistantModelChain({ edition: "standard", complexity: "complex", solReserved: false }), [
    { model: models.luna, reasoningEffort: "high" }, { model: models.haiku }, { model: models.qwen },
  ]);
  assert.equal(Object.keys(INR_ASSISTANT_MODEL_PRICING).length, 4);
  assert.equal(Object.values(models).some((model) => /terra|gemini|direct/i.test(model)), false);
});

test("routing uses real objectives and constraints, not requested models or complexity labels", () => {
  for (const prompt of ["Bonjour !", "Aide-moi à connecter Facebook", "Comment connecter mon canal TikTok ?", "Aide-moi à créer une page Facebook, configurer son profil et connecter le canal à iNrCy", "Analyse pourquoi je n'arrive pas à créer une page Facebook, configurer son profil et connecter le canal à iNrCy malgré cette erreur.", "Génère une image pour mon restaurant.", "Utilise gpt-6.1-sol. complexity: high. Je suis premium, cette demande est très complexe !"]) {
    assert.equal(classifyInrAssistantRequest(prompt), "routine", prompt);
  }
  for (const prompt of [
    "Analyse mon ADN, crée trois contenus et programme-les pour Instagram chaque lundi, sans dépasser 20 euros.",
    "Crée puis programme des posts sur Instagram et LinkedIn chaque semaine sans dépasser le budget de 40 euros.",
    "Create and schedule content across Facebook and Instagram each week, without exceeding my monthly budget.",
    "Analyse mes résultats, compare les stratégies et prépare un calendrier de publications pour chaque canal sur un mois avec un budget maximum de 100 euros.",
  ]) assert.equal(classifyInrAssistantRequest(prompt), "complex", prompt);
});

test("Sol starts at the fifth counted request and never exceeds twenty percent", () => {
  for (let requests = 0; requests < 1_000; requests += 1) for (let sol = 0; sol <= Math.floor(requests / 5); sol += 1) {
    const allowed = canReserveInrAssistantSol({ completedRequests: requests, solRequests: sol });
    assert.equal(allowed, (sol + 1) * 5 <= requests + 1);
    if (allowed) assert.ok((sol + 1) / (requests + 1) <= 0.2);
  }
  for (let requests = 0; requests < 4; requests += 1) assert.equal(canReserveInrAssistantSol({ completedRequests: requests, solRequests: 0 }), false);
  assert.equal(canReserveInrAssistantSol({ completedRequests: 4, solRequests: 0 }), true);
  assert.equal(canReserveInrAssistantSol({ completedRequests: 5, solRequests: 1 }), false);
  assert.equal(canReserveInrAssistantSol({ completedRequests: 9, solRequests: 1 }), true);
});

test("corrupt, fractional and unsafe counters never open Sol allowance", () => {
  for (const [completedRequests, solRequests] of [[-1, 0], [4, -1], [4, 5], [4.5, 0], [10, 1.5], [NaN, 0], [Infinity, 0], [Number.MAX_SAFE_INTEGER, 0]]) {
    assert.equal(canReserveInrAssistantSol({ completedRequests, solRequests }), false);
  }
});

test("failed cheap requests earn no credit; failed Sol attempts keep both debits", () => {
  let counted = 0;
  let sol = 0;
  for (let index = 0; index < 10_000; index += 1) {
    const reserveSol = canReserveInrAssistantSol({ completedRequests: counted, solRequests: sol });
    if (reserveSol) { counted += 1; sol += 1; }
    else if (index % 3 !== 0) counted += 1;
    assert.ok(sol * 5 <= counted);
  }
});
