import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  adsDraftHasKeywordsStep,
  adsDraftHasMediaStep,
  adsDraftStepKeys,
  adsDraftValidationStep,
} from "../lib/adsDraftNavigation.ts";

const studioSource = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function actualStudioCallback(predicate: (node: ts.Node) => boolean, scope: Record<string, unknown>) {
  let callback: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (!callback && node.parent && predicate(node)) callback = node;
    ts.forEachChild(node, visit);
  }
  visit(studioSource);
  assert.ok(callback, "the actual studio callback must exist");
  const compiled = ts.transpileModule(`const callback = ${callback.getText(studioSource)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn callback;`)(...Object.values(scope));
}

test("un brouillon reprend toujours sur la validation adaptée à son parcours", () => {
  assert.equal(adsDraftValidationStep({ provider: "google", campaignType: "search", creationMode: "manual" }), 9);
  assert.equal(adsDraftValidationStep({ provider: "google", campaignType: "search", creationMode: "inrcy" }), 10);
  assert.equal(adsDraftValidationStep({ provider: "meta", campaignType: "meta_traffic", creationMode: "manual" }), 9);
  assert.equal(adsDraftValidationStep({ provider: "pinterest", campaignType: "generic", creationMode: "manual" }), 10);
  assert.equal(adsDraftValidationStep({ provider: "pinterest", campaignType: "generic", creationMode: "inrcy" }), 11);
});

test("Pinterest suit campagne, budget CBO, géographie, audience, enchères et format avant le Pin", () => {
  const manual = ["project", "foundations", "budget", "geography", "targeting", "bidding", "pinterest_format", "creative", "media", "delivery", "validation"];
  const assisted = ["project", "analysis", ...manual.slice(1)];
  const native = { schemaVersion: 1 as const, channel: "pinterest" as const,
    objectiveType: "CONSIDERATION" as const, intendedPromotionType: "STANDARD_AD" as const,
    creativeType: "REGULAR" as const, targetingMode: "automatic" as const, conversionEvent: null };
  for (const channelSettings of [undefined, native]) {
    for (const creationMode of ["manual", "inrcy"] as const) {
      const stored = { provider: "pinterest" as const, campaignType: "generic" as const, channelSettings, creationMode };
      const keys = adsDraftStepKeys(stored);
      assert.deepEqual(keys, creationMode === "manual" ? manual : assisted);
      assert.equal(adsDraftValidationStep(stored), creationMode === "manual" ? 10 : 11);
      assert.equal(keys[adsDraftValidationStep(stored)], "validation");
      assert.deepEqual(keys.slice(0, adsDraftValidationStep(stored) + 1), keys, "Un ancien brouillon retrouve toutes les étapes jusqu’à validation");
      assert.equal(keys.indexOf("budget") + 1, keys.indexOf("geography"));
      assert.equal(keys.indexOf("bidding") + 1, keys.indexOf("pinterest_format"));
      assert.equal(keys.indexOf("pinterest_format") + 1, keys.indexOf("creative"));
    }
  }
});

test("Meta sépare les zones, le brief d’audience et les enchères sans ajouter des mots-clés publicitaires", () => {
  const manual = ["project", "foundations", "geography", "targeting", "bidding", "creative", "media", "delivery", "budget", "validation"];
  for (const creationMode of ["manual", "inrcy"] as const) {
    const stored = { provider: "meta" as const, campaignType: "meta_traffic" as const, creationMode };
    const keys = adsDraftStepKeys(stored);
    assert.deepEqual(keys, creationMode === "manual" ? manual : ["project", "analysis", ...manual.slice(1)]);
    assert.equal(keys.includes("keywords"), false);
    assert.equal(keys[adsDraftValidationStep(stored)], "validation");
    assert.equal(adsDraftValidationStep(stored), creationMode === "manual" ? 9 : 10);
    assert.deepEqual(keys.slice(0, adsDraftValidationStep(stored) + 1), keys, "Un ancien brouillon sans paramètres natifs garde tous ses onglets accessibles");
  }
});

test("ChatGPT place budget et calendrier avant les zones, avec une carte et aucune étape de signaux fictifs", () => {
  const manual = ["project", "foundations", "budget", "geography", "targeting", "bidding", "creative", "media", "delivery", "validation"];
  for (const creationMode of ["manual", "inrcy"] as const) {
    const stored = { provider: "openai" as const, campaignType: "generic" as const, creationMode };
    const keys = adsDraftStepKeys(stored);
    assert.deepEqual(keys, creationMode === "manual" ? manual : ["project", "analysis", ...manual.slice(1)]);
    assert.equal(keys.includes("keywords"), false);
    assert.equal(keys.includes("pinterest_format"), false);
    assert.equal(keys[adsDraftValidationStep(stored)], "validation");
    assert.equal(adsDraftValidationStep(stored), creationMode === "manual" ? 9 : 10);
    assert.deepEqual(keys.slice(0, adsDraftValidationStep(stored) + 1), keys, "L’ancien brouillon se rouvre sur sa vraie validation");
  }
});

test("la fin IA Meta et ChatGPT ouvre le récapitulatif une seule fois après la préparation du média", () => {
  for (const provider of ["meta", "openai"] as const) {
    const draft = { provider, creationMode: "inrcy" as const, campaignType: provider === "meta" ? "meta_traffic" as const : "generic" as const };
    const reviewedPlanRevision = { current: 0 }, planGenerationRevision = { current: 1 };
    const calls: number[] = [], reached: unknown[] = [];
    const scope = {
      channelId: provider, creating: true, creationPath: "inrcy", step: 1, analysisStep: 1,
      planProgress: 100, busy: null, planError: "", reviewedPlanRevision, planGenerationRevision, draft,
      adsDraftValidationStep, adsDraftStepKeys,
      setStep: (index: number) => calls.push(index), setReachedStepKeys: (keys: unknown) => reached.push(keys),
    };
    const run = (patch: Record<string, unknown> = {}) => actualStudioCallback(
      (node) => ts.isArrowFunction(node) && ts.isCallExpression(node.parent)
        && node.parent.expression.getText(studioSource) === "useEffect"
        && node.getText(studioSource).includes("reviewedPlanRevision.current"), { ...scope, ...patch },
    )();
    for (const patch of [{ planProgress: 99 }, { busy: "plan" }, { planError: "Média non disponible" }]) run(patch);
    assert.deepEqual(calls, []);
    run(); assert.deepEqual(calls, [10]); assert.deepEqual(reached, [adsDraftStepKeys(draft)]);
    run(); run({ step: 4 }); assert.equal(calls.length, 1);
    planGenerationRevision.current = 2; run(); assert.equal(calls.length, 2);
  }
});

test("LinkedIn distingue la géographie de l’audience dans les parcours manuel et IA", () => {
  const manual = ["project", "foundations", "geography", "targeting", "keywords", "creative", "media", "delivery", "budget", "validation"];
  const assisted = ["project", "analysis", ...manual.slice(1)];
  const native = { schemaVersion: 1 as const, channel: "linkedin" as const, objectiveType: "WEBSITE_VISIT" as const, format: "STANDARD_UPDATE" as const, targetingFacet: "titles" as const, locale: { country: "FR", language: "fr" } };
  for (const channelSettings of [undefined, native]) {
    const draft = { provider: "linkedin" as const, campaignType: "generic" as const, channelSettings };
    assert.deepEqual(adsDraftStepKeys({ ...draft, creationMode: "manual" }), manual);
    assert.deepEqual(adsDraftStepKeys({ ...draft, creationMode: "inrcy" }), assisted);
    assert.equal(adsDraftValidationStep({ ...draft, creationMode: "manual" }), 9);
    assert.equal(adsDraftValidationStep({ ...draft, creationMode: "inrcy" }), 10);
  }
});

test("les anciens brouillons LinkedIn sans réglages natifs se rouvrent sur la nouvelle validation", () => {
  for (const creationMode of ["manual", "inrcy"] as const) {
    const stored = { provider: "linkedin" as const, campaignType: "generic" as const, creationMode };
    const keys = adsDraftStepKeys(stored);
    const validation = adsDraftValidationStep(stored);
    const restoredProgress = keys.slice(0, validation + 1);
    assert.equal("channelSettings" in stored, false);
    assert.equal(keys[validation], "validation");
    assert.equal(validation, creationMode === "manual" ? 9 : 10);
    assert.deepEqual(restoredProgress, keys);
    assert.equal(restoredProgress.filter((key) => key === "geography").length, 1);
    assert.equal(keys.indexOf("geography") + 1, keys.indexOf("targeting"));
  }
});

test("Google Search sépare campagne, enchères, géographie et paramètres sans médias inutiles", () => {
  const manual = ["project", "foundations", "bidding", "geography", "targeting", "keywords", "creative", "delivery", "budget", "validation"];
  const assisted = ["project", "analysis", ...manual.slice(1)];
  for (const creationMode of ["manual", "inrcy"] as const) {
    const draft = { provider: "google" as const, campaignType: "search" as const, creationMode };
    const keys = adsDraftStepKeys(draft);
    assert.deepEqual(keys, creationMode === "manual" ? manual : assisted);
    assert.equal(adsDraftValidationStep(draft), creationMode === "manual" ? 9 : 10);
    assert.equal(keys.includes("media"), false);
    assert.equal(keys.indexOf("bidding") + 1, keys.indexOf("geography"));
    assert.equal(keys.indexOf("geography") + 1, keys.indexOf("targeting"));
  }
});

test("les anciens brouillons Google Search restaurent toutes les nouvelles étapes jusqu’au récapitulatif", () => {
  for (const creationMode of ["manual", "inrcy"] as const) {
    const stored = { provider: "google" as const, campaignType: "search" as const, creationMode };
    assert.equal("channelSettings" in stored, false);
    assert.equal("googleDeliverySettings" in stored, false);
    const keys = adsDraftStepKeys(stored);
    const validation = adsDraftValidationStep(stored);
    const restoredProgress = keys.slice(0, validation + 1);
    assert.equal(keys[validation], "validation");
    assert.deepEqual(restoredProgress, keys);
    assert.equal(restoredProgress.filter((key) => key === "bidding").length, 1);
    assert.equal(restoredProgress.filter((key) => key === "geography").length, 1);
  }
});

test("X et TikTok préparent aussi leurs enchères et zones dans deux étapes séparées", () => {
  for (const provider of ["tiktok", "x"] as const) {
    const keys = adsDraftStepKeys({ provider, campaignType: "generic", creationMode: "manual" });
    assert.equal(keys.includes("geography"), true, provider);
    assert.equal(keys.includes("bidding"), true, provider);
    assert.equal(keys.indexOf("geography") + 1, keys.indexOf("targeting"));
    assert.equal(keys.indexOf("targeting") + 1, keys.indexOf("bidding"));
  }
  assert.equal(adsDraftStepKeys({ provider: "linkedin", campaignType: "generic", creationMode: "manual" }).includes("bidding"), false);
});

test("le stepper garde les étapes atteintes accessibles sans déverrouiller les suivantes", () => {
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");

  assert.match(client, /const \[reachedStepKeys, setReachedStepKeys\] = useState<AdsDraftStepKey\[]>\(\["project"\]\)/);
  assert.match(
    client,
    /function navigateToStep\(nextStep: number\) \{[\s\S]*?setStep\(boundedStep\);[\s\S]*?const currentKey = stepKeys\[step\];[\s\S]*?const reachedKey = stepKeys\[boundedStep\];[\s\S]*?setReachedStepKeys/,
  );
  for (const busy of [null, "plan", "demo"] as const) {
    for (const index of [0, 1, 2]) {
      const disabled = actualStudioCallback(
        (node) => ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent)
          && node.parent.parent.name.getText(studioSource) === "disabled"
          && node.getText(studioSource).includes("reachedStepKeys.includes"),
        { busy, index, step: 0, displayedStepKeys: ["project", "foundations", "geography"], reachedStepKeys: ["project", "foundations"] },
      );
      assert.equal(disabled, busy !== null || index === 2);
    }
  }
  assert.match(client, /onClick=\{\(\) => navigateToStep\(index\)\}/);
  assert.match(client, /navigateToStep\(step \+ 1\);/);
  assert.match(client, /navigateToStep\(step - 1\);/);
  assert.match(client, /navigateToStep\(nextStep\);/);
  assert.doesNotMatch(client, /maxReachedStep|setMaxReachedStep/);
});

test("le bouton Suivant garde le parcours manuel et ouvre les récapitulatifs IA Google, LinkedIn, Pinterest, Meta et ChatGPT terminés", () => {
  for (const [channelId, creationPath, step, planProgress, expected] of [
    ["linkedin", "manual", 1, 100, "next:2"],
    ["linkedin", "inrcy", 1, 100, "review:10"],
    ["linkedin", "inrcy", 2, 100, "next:3"],
    ["google", "inrcy", 1, 100, "review:10"],
    ["google", "manual", 1, 100, "next:2"],
    ["pinterest", "inrcy", 1, 100, "review:11"],
    ["pinterest", "manual", 1, 100, "next:2"],
    ["meta", "inrcy", 1, 100, "review:10"],
    ["meta", "manual", 1, 100, "next:2"],
    ["openai", "inrcy", 1, 100, "review:10"],
    ["openai", "manual", 1, 100, "next:2"],
  ] as const) {
    const draft = { provider: channelId, creationMode: "inrcy" as const, campaignType: channelId === "google" ? "search" as const : "generic" as const };
    const calls: string[] = [];
    const callback = actualStudioCallback(
      (node) => ts.isArrowFunction(node) && ts.isJsxExpression(node.parent)
        && ts.isJsxAttribute(node.parent.parent) && node.parent.parent.name.getText(studioSource) === "onClick"
        && node.getText(studioSource).includes("navigateToStep(step + 1)"),
      { channelId, creationPath, step, analysisStep: 1, planProgress, validationStep: adsDraftValidationStep(draft),
        resetStepProgress: (index: number) => calls.push(`review:${index}`),
        navigateToStep: (index: number) => calls.push(`next:${index}`) },
    );
    callback();
    assert.deepEqual(calls, [expected]);
  }
});

test("la fin IA ouvre une seule fois la validation du draft effectif et rend toutes ses étapes accessibles", () => {
  const draft = { provider: "linkedin" as const, creationMode: "inrcy" as const, campaignType: "generic" as const };
  const reviewedPlanRevision = { current: 0 };
  const planGenerationRevision = { current: 1 };
  const steps: number[] = [];
  const reached: unknown[] = [];
  const scope = {
    channelId: "linkedin", creating: true, creationPath: "inrcy", step: 1, analysisStep: 1,
    planProgress: 100, busy: null, planError: "", reviewedPlanRevision, planGenerationRevision, draft,
    adsDraftValidationStep, adsDraftStepKeys,
    setStep: (index: number) => steps.push(index), setReachedStepKeys: (keys: unknown) => reached.push(keys),
  };
  const run = (patch: Record<string, unknown> = {}) => actualStudioCallback(
    (node) => ts.isArrowFunction(node) && ts.isCallExpression(node.parent)
      && node.parent.expression.getText(studioSource) === "useEffect"
      && node.getText(studioSource).includes("reviewedPlanRevision.current"),
    { ...scope, ...patch },
  )();
  for (const patch of [
    { creating: false }, { channelId: "unsupported" }, { creationPath: "manual" }, { step: 2 },
    { planProgress: 99 }, { busy: "plan" }, { planError: "Le média n’est pas finalisé." },
  ]) run(patch);
  assert.deepEqual(steps, []);
  assert.equal(reviewedPlanRevision.current, 0);
  run();
  assert.deepEqual(steps, [adsDraftValidationStep(draft)]);
  assert.deepEqual(reached, [adsDraftStepKeys(draft)]);
  assert.equal(reviewedPlanRevision.current, 1);
  run();
  assert.equal(steps.length, 1, "reopening analysis must not steal navigation again");
  planGenerationRevision.current = 2;
  run();
  assert.equal(steps.length, 2, "a genuinely new generation can open its new proposal");
});

test("la fin IA Google ouvre une seule fois ses onze étapes et n’interrompt pas la lecture ensuite", () => {
  const draft = { provider: "google" as const, creationMode: "inrcy" as const, campaignType: "search" as const };
  const reviewedPlanRevision = { current: 0 };
  const planGenerationRevision = { current: 1 };
  const calls: number[] = [];
  const reached: unknown[] = [];
  const scope = {
    channelId: "google", creating: true, creationPath: "inrcy", step: 1, analysisStep: 1,
    planProgress: 100, busy: null, planError: "", reviewedPlanRevision, planGenerationRevision, draft,
    adsDraftValidationStep, adsDraftStepKeys,
    setStep: (index: number) => calls.push(index), setReachedStepKeys: (keys: unknown) => reached.push(keys),
  };
  const run = (patch: Record<string, unknown> = {}) => actualStudioCallback(
    (node) => ts.isArrowFunction(node) && ts.isCallExpression(node.parent)
      && node.parent.expression.getText(studioSource) === "useEffect"
      && node.getText(studioSource).includes("reviewedPlanRevision.current"),
    { ...scope, ...patch },
  )();
  run({ planProgress: 99 });
  assert.deepEqual(calls, []);
  run();
  assert.deepEqual(calls, [10]);
  assert.deepEqual(reached, [adsDraftStepKeys(draft)]);
  assert.equal((reached[0] as unknown[]).length, 11);
  run();
  run({ step: 4 });
  assert.equal(calls.length, 1);
  planGenerationRevision.current = 2;
  run();
  assert.equal(calls.length, 2);
});

test("la fin IA Pinterest attend le média puis ouvre une seule fois ses douze étapes", () => {
  const draft = { provider: "pinterest" as const, creationMode: "inrcy" as const, campaignType: "generic" as const };
  const reviewedPlanRevision = { current: 0 };
  const planGenerationRevision = { current: 1 };
  const calls: number[] = [];
  const reached: unknown[] = [];
  const scope = {
    channelId: "pinterest", creating: true, creationPath: "inrcy", step: 1, analysisStep: 1,
    planProgress: 100, busy: null, planError: "", reviewedPlanRevision, planGenerationRevision, draft,
    adsDraftValidationStep, adsDraftStepKeys,
    setStep: (index: number) => calls.push(index), setReachedStepKeys: (keys: unknown) => reached.push(keys),
  };
  const run = (patch: Record<string, unknown> = {}) => actualStudioCallback(
    (node) => ts.isArrowFunction(node) && ts.isCallExpression(node.parent)
      && node.parent.expression.getText(studioSource) === "useEffect"
      && node.getText(studioSource).includes("reviewedPlanRevision.current"),
    { ...scope, ...patch },
  )();
  for (const patch of [{ planProgress: 99 }, { busy: "plan" }, { planError: "Le média Pinterest n’est pas prêt." }]) run(patch);
  assert.deepEqual(calls, []);
  run();
  assert.deepEqual(calls, [11]);
  assert.deepEqual(reached, [adsDraftStepKeys(draft)]);
  assert.equal((reached[0] as unknown[]).length, 12);
  run();
  run({ step: 4 });
  assert.equal(calls.length, 1, "La revue ne doit pas interrompre les ajustements ultérieurs");
  planGenerationRevision.current = 2;
  run();
  assert.equal(calls.length, 2);
});

test("la progression du stepper est réinitialisée par parcours et restaurée pour un brouillon", () => {
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");

  assert.match(client, /function resetStepProgress\(nextStep: number, availableStepKeys: AdsDraftStepKey\[] = stepKeys\) \{[\s\S]*?setStep\(boundedStep\);[\s\S]*?setReachedStepKeys\(availableStepKeys\.slice\(0, boundedStep \+ 1\)\)/);
  assert.match(client, /function chooseManualCreation\(\) \{[\s\S]*?resetStepProgress\(1, manualStepKeys\);[\s\S]*?\}/);
  assert.match(client, /function openAssistedAnalysisSetup\(\) \{[\s\S]*?resetStepProgress\(0, inrcyStepKeys\);[\s\S]*?\}/);
  assert.match(client, /function beginAssistedAnalysis\(\) \{[\s\S]*?resetStepProgress\(1, inrcyStepKeys\);[\s\S]*?\}/);
  assert.match(client, /function startNewCampaign\(\) \{[\s\S]*?resetStepProgress\(0, manualStepKeys\);[\s\S]*?\}/);
  assert.match(client, /function reopen\(campaign: StoredCampaign\) \{[\s\S]*?const reopenedStepKeys = adsDraftStepKeys\(campaign\.draft\);[\s\S]*?resetStepProgress\(adsDraftValidationStep\(campaign\.draft\), reopenedStepKeys\);[\s\S]*?\}/);
  assert.match(client, /setCreationPath\("choice"\); setAnalysisSetupOpen\(true\); resetStepProgress\(0, inrcyStepKeys\);/);
});

test("une étape insérée après coup reste verrouillée sans refermer les étapes déjà visitées", () => {
  const xText = {
    provider: "x" as const,
    campaignType: "generic" as const,
    creationMode: "manual" as const,
    channelSettings: { schemaVersion: 1 as const, channel: "x" as const, objective: "website_traffic" as const,
      format: "text" as const, targetingMode: "broad" as const },
  };
  const previouslyReached = new Set(adsDraftStepKeys(xText));
  const withImage = adsDraftStepKeys({
    ...xText,
    channelSettings: { ...xText.channelSettings, format: "image" as const },
  });

  assert.equal(withImage.includes("media"), true);
  assert.equal(previouslyReached.has("media"), false);
  assert.equal(previouslyReached.has("validation"), true);

  const pinterestAutomatic = {
    provider: "pinterest" as const,
    campaignType: "generic" as const,
    creationMode: "manual" as const,
    channelSettings: { schemaVersion: 1 as const, channel: "pinterest" as const,
      objectiveType: "CONSIDERATION" as const, intendedPromotionType: "STANDARD_AD" as const,
      creativeType: "REGULAR" as const, targetingMode: "automatic" as const, conversionEvent: null },
  };
  const reachedAutomatic = new Set(adsDraftStepKeys(pinterestAutomatic));
  const withDiscovery = adsDraftStepKeys({
    ...pinterestAutomatic,
    channelSettings: { ...pinterestAutomatic.channelSettings, targetingMode: "keywords" as const },
  });

  assert.equal(withDiscovery.includes("keywords"), true);
  assert.equal(reachedAutomatic.has("keywords"), false);
  assert.equal(reachedAutomatic.has("validation"), true);
});

test("Pinterest automatique omet Découverte, les trois ciblages manuels la conservent", () => {
  const draft = { provider: "pinterest" as const, campaignType: "generic" as const, creationMode: "inrcy" as const };
  assert.equal(adsDraftHasKeywordsStep(draft), false);
  for (const targetingMode of ["automatic", "interests", "keywords", "audiences"] as const) {
    const configured = { ...draft, channelSettings: { schemaVersion: 1 as const, channel: "pinterest" as const,
      objectiveType: "CONSIDERATION" as const, intendedPromotionType: "STANDARD_AD" as const,
      creativeType: "REGULAR" as const, targetingMode, conversionEvent: null } };
    assert.equal(adsDraftHasKeywordsStep(configured), targetingMode !== "automatic");
    assert.equal(adsDraftValidationStep(configured), targetingMode === "automatic" ? 11 : 12);
    const keys = adsDraftStepKeys(configured);
    if (targetingMode !== "automatic") {
      assert.equal(keys.indexOf("pinterest_format") + 1, keys.indexOf("keywords"));
      assert.equal(keys.indexOf("keywords") + 1, keys.indexOf("creative"));
    }
  }
  for (const provider of ["google", "linkedin"] as const) {
    assert.equal(adsDraftHasKeywordsStep({ provider }), true);
  }
  assert.equal(adsDraftHasKeywordsStep({ provider: "meta" }), false);
  assert.equal(adsDraftHasKeywordsStep({ provider: "openai" }), false);
  assert.equal(adsDraftHasKeywordsStep({ provider: "tiktok" }), false);
  assert.equal(adsDraftHasKeywordsStep({ provider: "x" }), false);
});

test("seuls Google Search et le post X textuel omettent l’étape médias", () => {
  assert.equal(adsDraftHasMediaStep({ provider: "google", campaignType: "search" }), false);
  assert.equal(adsDraftHasMediaStep({ provider: "google", campaignType: "performance_max" }), true);
  assert.equal(adsDraftHasMediaStep({ provider: "meta", campaignType: "meta_traffic" }), true);
  assert.equal(adsDraftHasMediaStep({ provider: "linkedin", campaignType: "generic", channelSettings: { schemaVersion: 1, channel: "linkedin", objectiveType: "WEBSITE_VISIT", format: "TEXT_AD", targetingFacet: "titles", locale: { country: "FR", language: "fr" } } }), true);
  assert.equal(adsDraftHasMediaStep({ provider: "tiktok", campaignType: "generic" }), true);
  assert.equal(adsDraftHasMediaStep({ provider: "pinterest", campaignType: "generic", channelSettings: { schemaVersion: 1, channel: "pinterest", objectiveType: "SALES", intendedPromotionType: "CATALOG", creativeType: null, targetingMode: "automatic", conversionEvent: "CHECKOUT" } }), true);
  assert.equal(adsDraftHasMediaStep({ provider: "x", campaignType: "generic", channelSettings: { schemaVersion: 1, channel: "x", objective: "website_traffic", format: "text", targetingMode: "broad" } }), false);
  assert.equal(adsDraftHasMediaStep({ provider: "x", campaignType: "generic", channelSettings: { schemaVersion: 1, channel: "x", objective: "website_traffic", format: "image", targetingMode: "broad" } }), true);
  assert.equal(adsDraftValidationStep({ provider: "x", campaignType: "generic", creationMode: "manual", channelSettings: { schemaVersion: 1, channel: "x", objective: "website_traffic", format: "text", targetingMode: "broad" } }), 8);
  assert.equal(adsDraftValidationStep({ provider: "x", campaignType: "generic", creationMode: "manual", channelSettings: { schemaVersion: 1, channel: "x", objective: "website_traffic", format: "video", targetingMode: "broad" } }), 9);
});

test("le menu iNr’ADS lit uniquement les brouillons et les rouvre sans dupliquer le stockage", () => {
  const menu = readFileSync(new URL("../app/dashboard/ads/AdsDraftsMenu.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/route.ts", import.meta.url), "utf8");

  assert.match(menu, /\/api\/ads\/campaigns\?status=draft/);
  assert.match(menu, /folder=campagnes-ads&boxView=drafts/);
  assert.match(client, /<AdsDraftsMenu refreshKey=\{draftsRevision\} onOpenDraft=\{openDraftFromHeader\}/);
  assert.match(client, /resetStepProgress\(adsDraftValidationStep\(campaign\.draft\), reopenedStepKeys\)/);
  assert.doesNotMatch(client, /setNotice\(`Brouillon.*rouvert/);
  assert.match(route, /requestedStatus !== null && requestedStatus !== "draft"/);
  assert.match(route, /query = query\.eq\("status", "draft"\)/);
  assert.doesNotMatch(route, /from\("send_items"\)/);
  assert.doesNotMatch(route, /listAdsAccounts|listMetaPages|listPinterestAdsAccounts|listLinkedInAdsAccounts/);
  assert.match(route, /provider API is temporarily unavailable/);
});

test("iNr’Send expose une vue ADS Brouillons et un accès direct au studio", () => {
  const folder = readFileSync(new URL("../app/dashboard/mails/_components/AdsCampaignsFolder.tsx", import.meta.url), "utf8");
  const details = readFileSync(new URL("../app/dashboard/mails/_components/AdsCampaignDetailsModal.tsx", import.meta.url), "utf8");
  const mailbox = readFileSync(new URL("../app/dashboard/mails/MailboxClient.tsx", import.meta.url), "utf8");

  assert.match(mailbox, /draftOnly=\{searchParams\?\.get\("boxView"\) === "drafts"\}/);
  assert.match(folder, /params\.set\("status", "draft"\)/);
  assert.match(folder, /draftOnly \? "Brouillons ADS" : "ADS"/);
  assert.match(folder, /editCampaign=\$\{encodeURIComponent\(campaign\.id\)\}/);
  assert.match(details, /channel=\$\{encodeURIComponent\(campaign\.provider\)\}&editCampaign=/);
  assert.match(folder, /Toutes les campagnes/);
});
