import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { adsComponentModules } from "../helpers/ads-component-runtime.mts";

const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"] as const;
const clientFile = "app/dashboard/ads/AdsClient.tsx", connectionFile = "app/dashboard/ads/OpenaiAdsConnectionSettings.tsx";
const files = new Map([clientFile, connectionFile].map(file => [file, ts.createSourceFile(file, readFileSync(new URL("../../" + file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)]));
function evaluate(expression: ts.Expression, file: string) {
  const source = files.get(file)!;
  const code = ts.transpileModule("exports.result = (" + expression.getText(source) + ");", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return (scope: Record<string, unknown>) => {
    const exports: { result?: unknown } = {};
    new Function("exports", ...Object.keys(scope), code)(exports, ...Object.values(scope));
    return exports.result;
  };
}
/** Extract the real production interpolation, including its conditional branches. */
function parameter(key: string, name: string, marker = "") {
  const source = files.get(clientFile)!; let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "i18nT" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === key && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
      const value = node.arguments[1].properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === name && property.initializer.getText(source).includes(marker));
      if (value && ts.isPropertyAssignment(value)) expression = value.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(expression, key + "/" + name); return evaluate(expression, clientFile);
}
function jsxExpression(file: string, marker: string) {
  const source = files.get(file)!; let expression: ts.Expression | undefined;
  function visit(node: ts.Node) { if (ts.isJsxExpression(node) && node.expression?.getText(source).includes(marker)) expression = node.expression; ts.forEachChild(node, visit); }
  visit(source); assert.ok(expression, marker); return evaluate(expression, file);
}
const account = parameter("value_id_value_b0e8c14b", "value0", "ads_linkedin_account_fallback");
const media = parameter("value_stockee_dans_votre_mediatheque_inrcy_3c5ddc3e", "value0");
const bidEnd = parameter("cpc_maximal_enchere_value_fin_value_e1ba2dbb", "value1");
const end = parameter("fin_prevue_value_ac289a92", "value0");
const chatgptStart = parameter("j_autorise_la_diffusion_sur_le_b66d5891", "value3");
const linkedinUnit = parameter("j_autorise_la_diffusion_sur_le_d7271ee3", "value2");
const linkedinStart = parameter("j_autorise_la_diffusion_sur_le_d7271ee3", "value3");
const activeBlocked = parameter("la_carte_peut_etre_creee_sans_7d4e9f2b", "value0");
const existingImage = parameter("la_campagne_est_prete_mais_le_796e58f4", "value1", "ads_existing_campaign_image_note");
const formats = parameter("inr_studio_a_genere_le_pack_514d2165", "value0");
const readiness = jsxExpression(connectionFile, "la_configuration_chatgpt_ads_sera_disponible_2fdac54d");
const disabledReason = jsxExpression(clientFile, 'errorMessage(openaiLiveReadinessMessage, "booster.ads_ui_db1c77acbf")');

test("actual ADS interpolation branches localize UI-only defaults while preserving account names, media enums and calendar values in nine locales", () => {
  for (const locale of locales) {
    const i18nT = adsComponentModules(locale)["next-intl"].useTranslations("booster"), base = { i18nT, locale };
    for (const name of ["", "PERSONAL ACCOUNT · Bonjour · 你好"]) assert.equal(account({ ...base, externalStatuses: { linkedin: { selectedAccountName: name } } }), name || i18nT("ads_linkedin_account_fallback"));
    for (const type of ["video", "image"]) { const draft = { creativeType: type }; assert.equal(media({ ...base, draft }), i18nT(type === "video" ? "video_304f6ca4" : "wizard_pool_image")); assert.equal(draft.creativeType, type); }
    for (const endDate of ["", "2026-12-24"]) for (const branch of [bidEnd, end]) assert.equal(branch({ ...base, draft: { endDate } }), endDate || i18nT("ads_date_to_specify"));
    for (const startAt of [null, "2026-12-01T12:30:00Z"]) {
      assert.equal(chatgptStart({ ...base, openaiDelivery: { budget: { startAt } }, effectiveOpenaiResources: { account: { timezone: "Europe/Paris" } } }), startAt ? i18nT("a_partir_du_value_924108c5", { value0: new Date(startAt).toLocaleString(locale, { timeZone: "Europe/Paris" }) }) : i18nT("ads_after_chatgpt_ad_approval"));
      assert.equal(linkedinStart({ ...base, linkedInDelivery: { budget: { startAt } } }), `, ${startAt ? i18nT("a_partir_du_value_924108c5", { value0: new Date(startAt).toLocaleString(locale) }) : i18nT("des_la_validation_de_linkedin_1f84bd29")}`);
    }
    for (const type of ["total", "daily"]) assert.equal(linkedinUnit({ ...base, linkedInDelivery: { budget: { type } } }), type === "total" ? ` ${i18nT("au_total_c8d2e40b")}` : i18nT("ads_ui_892bcf22ec"));
    assert.equal(existingImage({ ...base, feedImageUrl: "PERSONAL_MEDIA_URL", storyReelImageUrl: "" }), i18nT("ads_existing_campaign_image_note") + " ");
    assert.equal(existingImage({ ...base, feedImageUrl: "", storyReelImageUrl: "" }), "");
    assert.equal(formats({ ...base, needsFeed: true, needsStoryReel: true }), " : " + i18nT("ads_format_pair", { first: "Feed 4:5", second: "Story/Reel 9:16" }));
    assert.equal(formats({ ...base, needsFeed: true, needsStoryReel: false }), " Feed 4:5");
    assert.equal(formats({ ...base, needsFeed: false, needsStoryReel: true }), " Story/Reel 9:16");
  }
});

test("OpenAI readiness branches keep approved-state copy positive and hide unknown API diagnostics in every locale", () => {
  for (const locale of locales) {
    const modules = adsComponentModules(locale), i18nT = modules["next-intl"].useTranslations("booster"), errorMessage = modules["./useAdsErrorMessage"].useAdsErrorMessage();
    const status = { liveReadinessMessage: "PRIVATE_PROVIDER_DIAGNOSTIC", readinessMessage: "PRIVATE_PROVIDER_DIAGNOSTIC" };
    for (const [flags, expected] of [
      [{ locked: true, connected: false, liveDeliveryEnabled: false, pausedCreationEnabled: false }, i18nT("la_configuration_chatgpt_ads_sera_disponible_2fdac54d")],
      [{ locked: false, connected: true, liveDeliveryEnabled: true, pausedCreationEnabled: true }, i18nT("compte_pret_vous_pourrez_choisir_active_b909de08")],
      [{ locked: false, connected: true, liveDeliveryEnabled: false, pausedCreationEnabled: true }, i18nT("creation_de_campagnes_en_pause_disponible_dcc9c1a5", { value0: i18nT("ce_compte_n_est_pas_encore_c16c1342") })],
      [{ locked: false, connected: true, liveDeliveryEnabled: false, pausedCreationEnabled: false }, i18nT("connexion_reconnue_la_creation_de_campagne_ffc5bb9a")],
      [{ locked: false, connected: false, liveDeliveryEnabled: false, pausedCreationEnabled: false }, i18nT("creez_un_compte_annonceur_dans_ads_ad1f1319")],
    ] as const) {
      const before = JSON.stringify(status), result = readiness({ ...flags, status, i18nT, errorMessage });
      assert.equal(result, expected); assert.doesNotMatch(String(result), /PRIVATE_PROVIDER_DIAGNOSTIC/); assert.equal(JSON.stringify(status), before);
    }
    assert.equal(activeBlocked({ i18nT, errorMessage, openaiLiveReadinessMessage: "PRIVATE_PROVIDER_DIAGNOSTIC" }), i18nT("ce_compte_n_est_pas_encore_c16c1342"));
    assert.equal(disabledReason({ i18nT, errorMessage, demoDialog: { channelId: "openai" }, openaiLiveReadinessMessage: "PRIVATE_PROVIDER_DIAGNOSTIC" }), i18nT("ads_ui_db1c77acbf"));
    const reviewed = "Ce compte ChatGPT Ads n’est pas encore autorisé à lancer une diffusion active.";
    assert.equal(activeBlocked({ i18nT, errorMessage, openaiLiveReadinessMessage: reviewed }), i18nT("ads_public_error_f88c8f03e2"), "Reviewed application advice remains specific and translated");
  }
});
