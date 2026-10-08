import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { adsDraftHasKeywordsStep, adsDraftHasMediaStep, adsDraftStepKeys } from "../lib/adsDraftNavigation.ts";
import { defaultGoogleDeliverySettings } from "../lib/adsGoogleCampaignSettings.ts";
import { googleAdsResourcesConsentKey, type GoogleAdsAccountResources } from "../lib/adsGoogleResources.ts";
import { adsDestinationReviewState } from "../lib/adsDestination.ts";
import { adsIncompleteLaunchMessage, adsIncompleteLaunchSteps } from "../lib/adsLaunchReadiness.ts";
import { parseAdsCampaignInput, type AdsCampaignInput } from "../lib/adsValidation.ts";

const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findAll(predicate: (node: ts.Node) => boolean, root: ts.Node = source): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return result;
}
function evaluate(node: ts.Node, scope: Record<string, unknown>) {
  const compiled = ts.transpileModule(`const value = (${node.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn value;`)(...Object.values(scope));
}
function initializer(name: string, scope: Record<string, unknown>) {
  const variable = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name)[0] as ts.VariableDeclaration | undefined;
  assert.ok(variable?.initializer, `${name} must exist`);
  return evaluate(variable.initializer, scope);
}
function field(name: string, root: ts.Node) {
  const attribute = findAll((node) => ts.isJsxAttribute(node) && node.name.getText(source) === name, root)[0] as ts.JsxAttribute | undefined;
  assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression, `${name} must be an expression`);
  return attribute.initializer.expression;
}
function label(marker: string) {
  const labels = findAll((node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "label"
    && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === marker));
  assert.equal(labels.length, 1, `${marker} must have one owner in the actual UI`);
  return labels[0];
}
function functionDeclaration(name: string) {
  const declaration = findAll((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)[0];
  assert.ok(declaration, `${name} must exist`);
  return declaration;
}
function launchButton() {
  const button = findAll((node) => ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "button"
    && node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
      && attribute.name.getText(source) === "onClick" && attribute.getText(source).includes("openLaunchDialog(")))[0];
  assert.ok(button);
  return button;
}
function politicalLabel() {
  const labels = findAll((node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "label"
    && findAll((child) => ts.isJsxAttribute(child) && child.name.getText(source) === "checked"
      && child.initializer?.getText(source) === "{draft.notEuPoliticalConfirmed}", node).length === 1);
  assert.equal(labels.length, 1, "Google political declaration must have one owner");
  return labels[0];
}
function resources(): GoogleAdsAccountResources {
  return {
    selectedAccountId: "1234567890", timeZone: "Europe/Paris", conversionMode: "account_defaults",
    conversionGoals: [{ category: "SIGNUP", origin: "WEBSITE", biddable: true }],
    conversionActions: [{ resourceName: "customers/1234567890/conversionActions/7", name: "Inscription", category: "SIGNUP", origin: "WEBSITE", type: "WEBPAGE", status: "ENABLED", primaryForGoal: true }],
    hasBiddableConversions: true,
  };
}
function finalConfirmationHarness() {
  const settings = defaultGoogleDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200 };
  settings.startDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const parsed = parseAdsCampaignInput({
    provider: "google", creationMode: "inrcy", campaignType: "search", objective: "website_traffic", conversionGoal: "website_visit",
    adAccountId: "1234567890", accountCurrency: "EUR", name: "Découvrir iNrCy", bidStrategy: "maximize_clicks",
    dailyBudgetEuros: 25, endDate: new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10),
    destinationUrl: "https://example.com/offre", trackingParameters: "utm_source=google&utm_campaign=inrcy",
    headlines: ["Découvrez iNrCy", "Simplifiez votre activité", "Votre essai gratuit"],
    descriptions: ["Découvrez nos outils pour votre activité professionnelle.", "Essayez la solution et gérez votre activité plus simplement."],
    keywords: ["logiciel indépendants", "gestion petite entreprise"], negativeKeywords: ["emploi"],
    targetLocations: ["Hauts-de-France,France"], notEuPoliticalConfirmed: false, googleDeliverySettings: settings,
  }, { purpose: "draft" });
  assert.ok(parsed.draft, parsed.error || "Google final fixture must be valid");
  let draft = parsed.draft;
  let confirmedSpend = false;
  let confirmedDestinationUrl = "";
  let dirty = false;
  let busy: string | null = null;
  const consent: { current: { key: string; status: string; googleResourcesKey?: string } | null } = { current: null };
  const accountResources = resources();
  const scope = () => {
    const destinationReview = adsDestinationReviewState({ assisted: true, fieldVisible: true, websiteRequired: true, destinationUrl: draft.destinationUrl, confirmedUrl: confirmedDestinationUrl });
    const base: Record<string, unknown> = {
      channelId: "google", creationPath: "inrcy", draft, busy,
      reviewAccountReady: true, googleResourcesLoad: "ready", effectiveGoogleResources: accountResources,
      effectiveOpenaiResources: null,
      googleLaunchReadinessReason: "", linkedInLaunchReadinessReason: "", pinterestLaunchReadinessReason: "", metaLaunchReadinessReason: "", openaiLaunchReadinessReason: "", launchUnavailableReason: "",
      destinationReview, adsIncompleteLaunchSteps, adsIncompleteLaunchMessage,
      foundationsStep: 2, biddingStep: 3, geographyStep: 4, targetingStep: 5, keywordsStep: 6,
      creativeStep: 7, mediaStep: -1, deliveryStep: 8, budgetStep: 9, validationStep: 10,
      livePublisherMediaReady: true, linkedInLaunchConsent: consent, confirmedSpend,
      googleAdsResourcesConsentKey,
      setDraft: (next: AdsCampaignInput | ((current: AdsCampaignInput) => AdsCampaignInput)) => { draft = typeof next === "function" ? next(draft) : next; },
      setDirty: (value: boolean) => { dirty = value; },
      setConfirmedSpend: (value: boolean) => { confirmedSpend = value; },
      setConfirmedDestinationUrl: (value: string) => { confirmedDestinationUrl = value; },
      applyDraftEdit: (current: AdsCampaignInput, next: Partial<AdsCampaignInput>) => evaluate(functionDeclaration("applyDraftEdit"), {})(current, next),
    };
    base.updateDraft = (next: Partial<AdsCampaignInput>) => evaluate(functionDeclaration("updateDraft"), scope())(next);
    base.confirmReviewedDeclaration = (name: string, checked: boolean) => evaluate(functionDeclaration("confirmReviewedDeclaration"), scope())(name, checked);
    base.incompleteLaunchSteps = initializer("incompleteLaunchSteps", base);
    base.incompleteLaunchMessage = initializer("incompleteLaunchMessage", base);
    base.launchBlockingMessage = initializer("launchBlockingMessage", base);
    base.launchBlocked = initializer("launchBlocked", base);
    return base;
  };
  return {
    draft: () => draft, consent, spend: () => confirmedSpend, dirty: () => dirty,
    setBusy: (value: string | null) => { busy = value; },
    budgetDisabled: () => evaluate(field("disabled", label("data-google-launch-confirmation")), scope()),
    politicalDisabled: () => evaluate(field("disabled", politicalLabel()), scope()),
    launchDisabled: () => evaluate(field("disabled", launchButton()), scope()),
    budget: (checked: boolean) => evaluate(field("onChange", label("data-google-launch-confirmation")), scope())({ target: { checked } }),
    political: (checked: boolean) => evaluate(field("onChange", politicalLabel()), scope())({ target: { checked } }),
    destination: (checked: boolean) => evaluate(field("onChange", label("data-google-destination-confirmation")), scope())({ target: { checked } }),
    edit: (next: Partial<AdsCampaignInput>) => evaluate(functionDeclaration("updateDraft"), scope())(next),
  };
}

test("les libellés et indices réels Google correspondent aux dix ou onze clés du parcours", () => {
  const manualNames = ["Votre projet", "Campagne", "Enchères", "Zones géographiques", "Paramètres", "Mots-clés", "Annonce", "Destination et suivi", "Budget et calendrier", "Vérifier et lancer"];
  for (const creationPath of ["manual", "inrcy"] as const) {
    const draft = { provider: "google" as const, campaignType: "search" as const, creationMode: creationPath };
    const scope: Record<string, unknown> = { channelId: "google", creationPath, draft, stepKeys: adsDraftStepKeys(draft), adsDraftHasKeywordsStep, adsDraftHasMediaStep };
    for (const name of ["keywordStepName", "hasMediaStep", "hasKeywordsStep", "mediaStepName", "automatedChannelStepNames", "manualStepNames", "inrcyStepNames", "linkedInStepLabels", "googleStepLabels", "channelStepLabels", "stepNames", "foundationsStep", "biddingStep", "geographyStep", "targetingStep", "keywordsStep", "creativeStep", "pinterestFormatStep", "mediaStep", "deliveryStep", "budgetStep", "validationStep"]) scope[name] = initializer(name, scope);
    const expectedNames = creationPath === "manual" ? manualNames : [manualNames[0], "Analyse iNrCy", ...manualNames.slice(1)];
    assert.deepEqual(scope.stepNames, expectedNames);
    const keys = adsDraftStepKeys(draft);
    for (const [variable, key] of [["foundationsStep", "foundations"], ["biddingStep", "bidding"], ["geographyStep", "geography"], ["targetingStep", "targeting"], ["keywordsStep", "keywords"], ["creativeStep", "creative"], ["deliveryStep", "delivery"], ["budgetStep", "budget"], ["validationStep", "validation"]]) assert.equal(scope[variable], keys.indexOf(key as typeof keys[number]), variable);
    assert.equal(scope.mediaStep, -1);
    assert.equal(scope.validationStep, expectedNames.length - 1);
  }
});

test("la dépense Google peut être confirmée avant le lien et la déclaration, mais attend le compte et les réglages valides", () => {
  const checkbox = label("data-google-launch-confirmation");
  const base = {
    busy: null, reviewAccountReady: true, googleResourcesLoad: "ready", effectiveGoogleResources: { selectedAccountId: "1234567890" },
    draft: { notEuPoliticalConfirmed: false }, destinationReview: { confirmed: false }, googleLaunchReadinessReason: "",
  };
  const disabled = field("disabled", checkbox);
  assert.equal(evaluate(disabled, base), false);
  for (const patch of [
    { busy: "demo" }, { reviewAccountReady: false }, { googleResourcesLoad: "idle" },
    { googleResourcesLoad: "loading" }, { googleResourcesLoad: "error" }, { effectiveGoogleResources: null },
    { googleLaunchReadinessReason: "Une conversion primaire est requise." },
  ]) assert.equal(evaluate(disabled, { ...base, ...patch }), true, JSON.stringify(patch));
});

test("la case de dépense Google autorise seulement le JSON exact du récapitulatif en statut Active", () => {
  const settings = defaultGoogleDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200 };
  const draft = { provider: "google", googleDeliverySettings: settings, destinationUrl: "https://example.com", headlines: ["Une offre à relire"], dailyBudgetEuros: 25 };
  const resources: GoogleAdsAccountResources = {
    selectedAccountId: "1234567890", timeZone: "Europe/Paris", conversionMode: "account_defaults",
    conversionGoals: [{ category: "SIGNUP", origin: "WEBSITE", biddable: true }],
    conversionActions: [{ resourceName: "customers/1234567890/conversionActions/7", name: "Inscription", category: "SIGNUP", origin: "WEBSITE", type: "WEBPAGE", status: "ENABLED", primaryForGoal: true }],
    hasBiddableConversions: true,
  };
  const consent: { current: { key: string; status: string; googleResourcesKey?: string } | null } = { current: null };
  let checked = false;
  const onChange = evaluate(field("onChange", label("data-google-launch-confirmation")), {
    draft, linkedInLaunchConsent: consent, effectiveGoogleResources: resources, googleAdsResourcesConsentKey,
    setConfirmedSpend: (value: boolean) => { checked = value; },
  });
  onChange({ target: { checked: true } });
  assert.equal(checked, true);
  assert.deepEqual(consent.current, { key: JSON.stringify(draft), status: "active", googleResourcesKey: googleAdsResourcesConsentKey(resources) });
  assert.deepEqual(JSON.parse(consent.current!.key).googleDeliverySettings.budget, { type: "total", totalEuros: 200 });
  onChange({ target: { checked: false } });
  assert.equal(checked, false);
  assert.equal(consent.current, null);
});

test("Google autorise les confirmations finales dans les deux ordres sans perdre le consentement du budget", () => {
  for (const order of [["budget", "political", "destination"], ["destination", "political", "budget"]] as const) {
    const harness = finalConfirmationHarness();
    assert.equal(harness.budgetDisabled(), false, "Le budget est indépendant des deux autres cases");
    assert.equal(harness.launchDisabled(), true);
    for (const [index, confirmation] of order.entries()) {
      harness[confirmation](true);
      assert.equal(harness.launchDisabled(), index < order.length - 1, `${order.join(" → ")}: ${confirmation}`);
      if (harness.spend()) {
        assert.ok(harness.consent.current);
        assert.equal(harness.consent.current.key, JSON.stringify(harness.draft()), "Le JSON exact demeure approuvé après une déclaration seule");
        assert.equal(harness.consent.current.googleResourcesKey, googleAdsResourcesConsentKey(resources()));
      }
    }
    assert.equal(harness.spend(), true);
    assert.equal(harness.draft().notEuPoliticalConfirmed, true);
    assert.deepEqual(harness.draft().googleDeliverySettings?.budget, { type: "total", totalEuros: 200 });
  }
});

test("retirer puis recocher le lien ou la déclaration Google bloque seulement VALIDER et conserve le budget exact", () => {
  const harness = finalConfirmationHarness();
  harness.budget(true);
  harness.political(true);
  harness.destination(true);
  const approvedCampaign = harness.draft();
  for (const confirmation of ["destination", "political"] as const) {
    harness[confirmation](false);
    assert.equal(harness.spend(), true, confirmation);
    assert.equal(harness.launchDisabled(), true, confirmation);
    assert.equal(harness.consent.current?.key, JSON.stringify(harness.draft()));
    assert.deepEqual(harness.draft().googleDeliverySettings, approvedCampaign.googleDeliverySettings);
    assert.deepEqual(harness.draft().headlines, approvedCampaign.headlines);
    harness[confirmation](true);
    assert.equal(harness.spend(), true);
    assert.equal(harness.launchDisabled(), false);
    assert.equal(harness.consent.current?.key, JSON.stringify(harness.draft()));
  }
});

test("une vraie modification Google du budget, de l’annonce ou du lien annule encore le consentement", () => {
  const patches: Partial<AdsCampaignInput>[] = [
    { googleDeliverySettings: { ...defaultGoogleDeliverySettings(), budget: { type: "total", totalEuros: 300 } } },
    { headlines: ["Une nouvelle promesse", "Titre deux", "Titre trois"] },
    { descriptions: ["Un nouveau message pour votre activité.", "Découvrez notre nouvelle proposition."] },
    { destinationUrl: "https://example.com/autre" },
    { trackingParameters: "utm_campaign=autre" },
  ];
  for (const patch of patches) {
    const harness = finalConfirmationHarness();
    harness.budget(true);
    harness.political(true);
    harness.destination(true);
    assert.equal(harness.launchDisabled(), false);
    harness.edit(patch);
    assert.equal(harness.spend(), false, JSON.stringify(patch));
    assert.equal(harness.consent.current, null);
    assert.equal(harness.launchDisabled(), true);
    assert.equal(harness.dirty(), true);
    for (const key of Object.keys(patch) as (keyof AdsCampaignInput)[]) assert.deepEqual(harness.draft()[key], patch[key]);
  }
});

test("une déclaration Google ne peut pas renouveler un consentement déjà divergent", () => {
  const harness = finalConfirmationHarness();
  harness.budget(true);
  assert.ok(harness.consent.current);
  const staleKey = JSON.stringify({ ...harness.draft(), trackingParameters: "utm_campaign=un_autre_accord" });
  harness.consent.current.key = staleKey;
  harness.political(true);
  assert.equal(harness.consent.current, null, "Une déclaration ne réautorise pas une campagne différente");
  assert.equal(harness.spend(), false);
  assert.equal(harness.launchDisabled(), true);
});

test("Google désactive les confirmations pendant le lancement et refuse une déclaration déclenchée tardivement", () => {
  const harness = finalConfirmationHarness();
  harness.budget(true);
  const before = harness.draft();
  const consent = harness.consent.current;
  harness.setBusy("demo");
  assert.equal(harness.budgetDisabled(), true);
  assert.equal(harness.politicalDisabled(), true);
  assert.equal(harness.launchDisabled(), true);
  harness.political(true);
  assert.equal(harness.draft(), before);
  assert.equal(harness.draft().notEuPoliticalConfirmed, false);
  assert.equal(harness.dirty(), false);
  assert.equal(harness.consent.current, consent);
});

test("VALIDER Google IA choisit le lancement direct ; le mode manuel garde sa confirmation", () => {
  const button = launchButton();
  for (const [channelId, creationPath, direct] of [["google", "inrcy", true], ["google", "manual", false], ["linkedin", "inrcy", true], ["pinterest", "inrcy", true], ["meta", "inrcy", true], ["meta", "manual", false], ["openai", "inrcy", true], ["openai", "manual", false], ["tiktok", "inrcy", false]]) {
    const calls: boolean[] = [];
    const callback = evaluate(field("onClick", button), { channelId, creationPath, openLaunchDialog: (value: boolean) => calls.push(value) });
    callback();
    assert.deepEqual(calls, [direct]);
  }
});
