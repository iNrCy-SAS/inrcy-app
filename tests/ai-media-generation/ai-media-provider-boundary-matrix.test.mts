import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { AiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { buildAiMediaImageProviderRequest } from "../../lib/aiMediaImageProviderRequest.ts";
import {
  assertAiMediaVideoProviderBoundary,
  assertAiMediaVideoProviderContract,
  buildAiMediaVideoParameterContract,
  buildAiMediaVideoProviderContract,
  buildAiMediaVideoProviderInstruction,
  buildAiMediaVideoReferenceContract,
  hashAiMediaCanonicalPrompt,
} from "../../lib/aiMediaVideoProviderContract.ts";

const ROOT = process.cwd();

test("les champs longs du contrat restent entiers ou sont refusés avant le réseau", () => {
  const idea = "Sujet détaillé, action centrale et résultat final. ".repeat(20).trim();
  const aiInstruction = "Instruction distincte, garder le produit et le lieu. ".repeat(20).trim();
  const contract = buildAiMediaVideoProviderContract({ request: requestFixture({ idea, aiInstruction }), durationSeconds: 8, brandColors: [] });
  assert.equal(contract.subject, idea);
  assert.equal(contract.instruction, aiInstruction);
  for (const request of [requestFixture({ idea: "x".repeat(2_001) }), requestFixture({ aiInstruction: "x".repeat(2_401) })]) {
    assert.throws(() => buildAiMediaVideoProviderContract({ request, durationSeconds: 8, brandColors: [] }), /ai_video_instruction_contract_too_long/);
  }
});

function requestFixture(
  overrides: Partial<AiMediaGenerationRequest> = {},
): AiMediaGenerationRequest {
  return {
    requestId: "provider-boundary-matrix",
    operation: "generate",
    inputMode: "essential",
    generationMode: "ai_criteria",
    peopleCriterion: "two",
    settingCriterion: "studio",
    focusCriterion: "product",
    kind: "video",
    source: "studio",
    subjectSource: "custom",
    idea: "Présenter clairement le nouveau service de l'entreprise.",
    aiInstruction: "Une réalisation professionnelle, crédible et rythmée.",
    textMode: "none",
    exactText: "",
    withText: false,
    textKeywords: [],
    withMusic: true,
    withNarration: true,
    narrationVoice: "female",
    narrationVoiceVariant: "Kore",
    format: "landscape",
    typology: "offer",
    visualStyle: "premium",
    visualDirection: "bold",
    imagePurpose: "auto",
    imageStyle: "photo",
    shotType: "medium",
    peopleMode: "team",
    creativity: "faithful",
    useBrandColors: true,
    logoMode: "visible",
    videoEngine: "veo",
    identityMode: "professional",
    videoCharacterMode: "professional",
    identityConsent: true,
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "voiceover",
    teamVideoVeoConsent: true,
    identityReferenceSetId: "provider-boundary-matrix-set",
    durationSeconds: 16,
    sceneMode: "multi",
    connectScenes: true,
    inspirationImages: [],
    ...overrides,
  };
}

function parameters(
  overrides: Partial<AiMediaGenerationRequest> = {},
) {
  return buildAiMediaVideoParameterContract({
    request: requestFixture(overrides),
    durationSeconds: 8,
    brandColors: ["#13b8ff", "#ec3e9d"],
  });
}

test("matrice vidéo : chaque choix Studio reste explicite dans le contrat commun Veo/Omni", () => {
  const cases: Array<{
    field: keyof AiMediaGenerationRequest;
    values: readonly unknown[];
    expected: (value: unknown, contract: string) => void;
  }> = [
    { field: "generationMode", values: ["ai_free", "ai_criteria", "inspiration"], expected: (value, contract) => assert.match(contract, new RegExp(`(?:^|;)mode=${value}(?:;|$)`)) },
    { field: "peopleCriterion", values: ["auto", "none", "one", "two", "three", "group"], expected: (value, contract) => assert.ok(contract.includes(`crit=${value}/`)) },
    { field: "settingCriterion", values: ["auto", "interior", "exterior", "studio", "neutral"], expected: (value, contract) => assert.ok(contract.includes(`/` + value + `/`)) },
    { field: "focusCriterion", values: ["auto", "people", "product", "environment"], expected: (value, contract) => assert.ok(contract.includes(`/` + value + `;`)) },
    { field: "format", values: ["square", "portrait", "story", "landscape"], expected: (value, contract) => assert.ok(contract.includes(`fmt=${value}`)) },
    { field: "typology", values: ["company", "service", "advice", "showcase", "offer", "event", "behind_scenes", "recruitment"], expected: (value, contract) => assert.ok(contract.includes(`type=${value}`)) },
    { field: "visualDirection", values: ["auto", "clean", "premium", "warm", "dynamic", "bold"], expected: (value, contract) => assert.ok(contract.includes(`dir=${value}`)) },
    { field: "visualStyle", values: ["brand", "clean", "premium", "warm", "dynamic", "expert", "local", "colorful"], expected: (value, contract) => assert.ok(contract.includes(`look=${value}/`)) },
    { field: "imageStyle", values: ["photo", "illustration", "three_d", "graphic"], expected: (value, contract) => assert.ok(contract.includes(`/` + value + `/`)) },
    { field: "shotType", values: ["auto", "close", "medium", "wide"], expected: (value, contract) => assert.ok(contract.includes(`/` + value + `/`)) },
    { field: "peopleMode", values: ["auto", "none", "solo", "team"], expected: (value, contract) => assert.ok(contract.includes(`/` + value + `/`)) },
    { field: "creativity", values: ["faithful", "bold"], expected: (value, contract) => assert.ok(contract.includes(`/` + value + `;`)) },
    { field: "textMode", values: ["none", "ai", "exact"], expected: (value, contract) => assert.ok(contract.includes(`text=${value}/local`)) },
    { field: "identityMode", values: ["auto", "professional", "brand_avatar", "reference_team"], expected: (value, contract) => assert.ok(contract.includes(`id=${value}/`)) },
    { field: "teamVideoMode", values: ["cinematic", "montage"], expected: (value, contract) => assert.ok(contract.includes(`/` + value + `;`)) },
    { field: "logoMode", values: ["discreet", "visible", "none"], expected: (value, contract) => assert.ok(contract.includes(`logo=${value}/local`)) },
    { field: "durationSeconds", values: [8, 16, 24], expected: (value, contract) => assert.ok(contract.includes(`film=${value}s`)) },
    { field: "sceneMode", values: ["single", "multi"], expected: (value, contract) => assert.ok(contract.includes(`story=${value}/`)) },
  ];

  for (const { field, values, expected } of cases) {
    for (const value of values) {
      const contract = parameters({ [field]: value } as Partial<AiMediaGenerationRequest>);
      assert.ok(contract.length <= 340, `${String(field)}=${String(value)} dépasse le budget`);
      expected(value, contract);
    }
  }

  assert.match(parameters({ connectScenes: true }), /story=multi\/linked/);
  assert.match(parameters({ connectScenes: false }), /story=multi\/unlinked/);
  assert.match(
    parameters({ teamVideoSpeechMode: "characters" }),
    /audio=characters\/music/,
  );
  assert.match(
    parameters({
      teamVideoSpeechMode: "voiceover",
      withNarration: true,
      narrationVoice: "male",
      narrationVoiceVariant: "Orus",
    }),
    /audio=voiceover-male-Orus\/music/,
  );
  assert.match(
    parameters({ withNarration: false, withMusic: false }),
    /audio=silent\/no-music/,
  );
  assert.match(parameters(), /pal=[a-z][a-z /-]*(?:\/[a-z][a-z /-]*)*$/i);
});

test("matrice références : rôle, usage et index arrivent sans ambiguïté au moteur", () => {
  const roles = ["character", "environment", "product", "inspiration"] as const;
  const usages = ["required", "inspiration"] as const;
  for (const role of roles) {
    for (const usage of usages) {
      const contract = buildAiMediaVideoReferenceContract({
        request: requestFixture({
          identityMode: role === "character" ? "professional" : "auto",
          videoCharacterMode: role === "character" ? "professional" : "auto",
          inspirationImages: [{
            data: "cmVmZXJlbmNl",
            mimeType: "image/png",
            role,
            usage,
            ...(role === "character" ? { characterIndex: 2 as const } : {}),
          }],
        }),
      });
      assert.ok(
        contract.includes(`#1:${role}/${usage}${role === "character" ? "/character-2" : ""}`),
        `${role}/${usage} absent de ${contract}`,
      );
    }
  }
});

test("un brief custom long sans aiInstruction reste entier au lieu d'être résumé", () => {
  const head = "DEBUT_BRIEF_AUTORITAIRE";
  const tail = "FIN_BRIEF_AUTORITAIRE";
  const idea = `${head} ${"exigence commerciale précise ".repeat(45)} ${tail}`;
  const instruction = buildAiMediaVideoProviderInstruction(
    requestFixture({ idea, aiInstruction: "" }),
  );
  assert.equal(instruction, idea.replace(/\s+/g, " ").trim());
  assert.match(instruction, new RegExp(head));
  assert.match(instruction, new RegExp(tail));
});

test("texte exact et logo sont autoritaires mais composés localement, jamais réinventés par le moteur vidéo", () => {
  const exactText = "OFFRE 58 € — TEXTE EXACT SECRET";
  const contract = buildAiMediaVideoProviderContract({
    request: requestFixture({
      textMode: "exact",
      exactText,
      withText: true,
      logoMode: "visible",
    }),
    durationSeconds: 8,
    brandColors: ["#13b8ff", "#ec3e9d"],
  });
  assert.match(contract.parameters, /text=exact\/local/);
  assert.match(contract.parameters, /logo=visible\/local/);
  assert.doesNotMatch(
    [contract.subject, contract.instruction, contract.parameters, contract.references].join(" "),
    new RegExp(exactText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("la frontière fournisseur refuse toute altération du prompt ou du contrat avant facturation", () => {
  const request = requestFixture();
  const canonicalPrompt = "PROMPT STUDIO CANONIQUE COMPLET";
  const contract = buildAiMediaVideoProviderContract({
    request,
    durationSeconds: 8,
    brandColors: ["#13b8ff", "#ec3e9d"],
  });
  assert.doesNotThrow(() =>
    assertAiMediaVideoProviderBoundary({
      canonicalPrompt,
      canonicalPromptSha256: hashAiMediaCanonicalPrompt(canonicalPrompt),
      providerContract: contract,
    }),
  );
  assert.throws(
    () => assertAiMediaVideoProviderBoundary({
      canonicalPrompt: `${canonicalPrompt} altéré`,
      canonicalPromptSha256: hashAiMediaCanonicalPrompt(canonicalPrompt),
      providerContract: contract,
    }),
    /ai_video_canonical_prompt_integrity_failed/,
  );
  assert.throws(
    () => assertAiMediaVideoProviderContract({
      ...contract,
      parameters: `${contract.parameters};critère-perdu=true`,
    }),
    /ai_video_provider_contract_integrity_failed/,
  );
});

test("image : prompt, références et rôles forment un objet profondément immuable partagé par nominal et fallback", () => {
  const roles: Array<{
    role: "product";
    usage: "required" | "inspiration";
  }> = [{ role: "product", usage: "required" }];
  const references = [Buffer.from("reference-produit")];
  const request = buildAiMediaImageProviderRequest({
    accountId: "provider-boundary-matrix-account",
    prompt: "PROMPT IMAGE STUDIO COMPLET",
    operation: "generate",
    identityMode: "auto",
    identityReferences: references,
    referenceRoles: roles,
  });
  assert.ok(Object.isFrozen(request));
  assert.ok(Object.isFrozen(request.identityReferences));
  assert.ok(Object.isFrozen(request.referenceRoles));
  assert.ok(Object.isFrozen(request.referenceRoles?.[0]));
  references.push(Buffer.from("ajout-tardif"));
  roles[0]!.usage = "inspiration";
  assert.equal(request.identityReferences?.length, 1);
  assert.equal(request.referenceRoles?.[0]?.usage, "required");
});

test("architecture : Veo et Omni vérifient le même contrat, les deux moteurs image reçoivent la même requête", () => {
  const server = readFileSync(path.join(ROOT, "lib/aiMediaGenerationServer.ts"), "utf8");
  const veo = readFileSync(path.join(ROOT, "lib/aiVideoProviderGoogleVeo.ts"), "utf8");
  const omni = readFileSync(path.join(ROOT, "lib/aiVideoProviderGoogleOmni.ts"), "utf8");

  assert.match(server, /const providerContract = buildAiMediaVideoProviderContract\(\{/);
  assert.match(server, /canonicalPrompt:\s*prompt/);
  assert.match(server, /canonicalPromptSha256:\s*promptHash/);
  assert.match(server, /generateOriginalAiVideoClips\(providerArgs\)/);
  assert.match(
    server,
    /generateOriginalAiVideoClips\(\{[\s\S]*?\.\.\.providerArgs,/,
  );
  assert.match(server, /generateAiMediaImage\(imageProviderRequest\)/);
  assert.match(server, /generateAiMediaImageWithGoogle\(imageProviderRequest\)/);

  for (const [name, source] of [["Veo", veo], ["Omni", omni]] as const) {
    const boundary = source.indexOf("assertAiMediaVideoProviderBoundary(args)");
    const client = source.indexOf("new GoogleGenAI", boundary);
    assert.ok(boundary >= 0, `${name}: garde de contrat absente`);
    assert.ok(client > boundary, `${name}: garde appelée après la création du client`);
  }
  assert.match(omni, /buildGoogleVideoScenePrompt\(/);
  assert.match(veo, /providerContract\.parameters/);
  assert.match(veo, /providerContract\.references/);
  assert.match(veo, /providerContract\.instruction/);
});
