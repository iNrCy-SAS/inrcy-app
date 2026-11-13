import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultLinkedInDeliverySettings, LINKEDIN_CALL_TO_ACTIONS } from "../../lib/adsLinkedInCampaignSettings.ts";
import { responsiveSurfaceFixture } from "../helpers/responsive-surface-fixture.mts";

const file = "app/dashboard/ads/LinkedInAdsDelivery.tsx";
const allLocales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const locales = process.env.ADS_DELIVERY_QA_LOCALES?.split(",") ?? allLocales;
assert.ok(locales.length && locales.every(locale => allLocales.includes(locale)));
const escaped = (text: unknown) => renderToStaticMarkup(React.createElement(React.Fragment, null, String(text)));
const ctaKeys = ["ads_ui_97c88ca182", "ads_ui_cdaaab442d", "demander_un_devis_8a1f1c6c", "ads_ui_dd3ae33250", "cta_action_inscrire", "wizard_preview_subscribe", "ads_ui_f0db5a41c1", "ads_ui_df3089a39a", "ads_ui_ceeba89a60", "ads_ui_3973c75925", "wizard_preview_more", "cta_action_acheter", "ads_ui_8ebae6c03a"];
const noop = () => {};

test("LinkedIn CTA choices and unresolved conversion controls translate without changing native enums or campaign labels", () => {
  const original = readFileSync(new URL("../../" + file, import.meta.url), "utf8");
  assert.match(original, /export const LINKEDIN_CTA_LABELS/);
  assert.match(original, /APPLY: "Postuler", DOWNLOAD: "Télécharger"/);
  for (const locale of locales) {
    const fixture = responsiveSurfaceFixture(locale), t = fixture.t("booster");
    const cta = renderToStaticMarkup(fixture.element(file, { value: "SIGN_UP", onChange: noop }, "LinkedInAdsCallToAction"));
    for (const [at, value] of LINKEDIN_CALL_TO_ACTIONS.entries()) {
      assert.ok(cta.includes(`value="${value}"`), locale + "/" + value);
      assert.ok(cta.includes(escaped(t(ctaKeys[at]))), locale + "/" + ctaKeys[at]);
    }
    assert.match(cta, /value="SIGN_UP" selected=""/);
    const settings = defaultLinkedInDeliverySettings(); settings.conversions.conversionUrns = ["urn:lla:llaPartnerConversion:123"];
    const distribution = renderToStaticMarkup(fixture.element(file, { settings, accountId: "123", active: false, objective: "WEBSITE_CONVERSION", onChange: noop }, "LinkedInAdsDistribution"));
    assert.ok(distribution.includes(`aria-label="${escaped(t("ads_linkedin_remove_conversion"))}"`));
    assert.ok(distribution.includes(escaped(t("conversion_selectionnee_verification_en_cours_2e8e7e52"))));
    if (locale !== "fr-FR") assert.doesNotMatch(distribution, /Retirer la conversion|la conversion&quot;/);
  }
});

test("LinkedIn summaries localize facets, OR, dates, self-employment and conversion plurals while preserving personal targeting labels", () => {
  for (const locale of locales) for (const count of [0, 1, 2]) {
    const fixture = responsiveSurfaceFixture(locale), t = fixture.t("booster"), settings = defaultLinkedInDeliverySettings();
    const names = ["USER PROFILE · Bonjour", "OTHER PROFILE · 你好"];
    settings.professionalTargeting.include = [
      { facet: "skills", urn: "urn:li:skill:123", name: names[0] }, { facet: "skills", urn: "urn:li:skill:456", name: names[1] },
      { facet: "companySizes", urn: "urn:li:staffCountRange:(1,1)", name: "Self-employed only" },
    ];
    settings.budget.startAt = count === 0 ? null : "2026-12-01T12:30:00Z";
    settings.budget.endAt = "2026-12-24T16:45:00Z";
    settings.callToAction = "REQUEST_DEMO";
    settings.conversions.conversionUrns = Array.from({ length: count }, (_, at) => `urn:lla:llaPartnerConversion:${at + 1}`);
    const markup = renderToStaticMarkup(fixture.element(file, { settings, dailyBudget: 123.45, endDate: "2026-12-24", zones: ["USER CITY · Paris"] }, "LinkedInAdsEffectiveSummary"));
    for (const name of names) assert.ok(markup.includes(name));
    assert.ok(markup.includes("USER CITY · Paris"));
    for (const key of ["ads_ui_413923285a", "ads_ui_db706bac4b", "ads_linkedin_self_employed", "ads_linkedin_audience_or", "ads_ui_3973c75925"]) assert.ok(markup.includes(escaped(t(key))), locale + "/" + key);
    assert.ok(markup.includes(escaped(t("ads_linkedin_linked_count", { count }))));
    assert.ok(markup.includes(escaped(t("value_par_jour_c3db45bd", { value0: (123.45).toLocaleString(locale) }))));
    assert.ok(markup.includes(escaped(count === 0 ? t("des_la_validation_de_linkedin_1f84bd29") : new Date(settings.budget.startAt!).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }))));
    if (locale !== "fr-FR") assert.doesNotMatch(markup, /Compétences|Taille de l’entreprise|Demander une démonstration|Dès la validation de LinkedIn/);
  }
});

test("LinkedIn budget views use the current locale and retain original native calendar values", () => {
  for (const locale of locales) for (const type of ["daily", "total"] as const) {
    const fixture = responsiveSurfaceFixture(locale), settings = defaultLinkedInDeliverySettings();
    settings.budget = { type, totalEuros: 2345.67, startAt: "2026-12-01T12:30:00Z", endAt: "2026-12-24T16:45:00Z" };
    settings.bidding = { strategy: "manual_cpc", amountEuros: 1.5 };
    const markup = renderToStaticMarkup(fixture.element(file, { settings, dailyBudget: 45.6, endDate: "2026-12-24", objective: "WEBSITE_VISIT", pricing: { dailyBudgetMin: 5.5, bidMin: 1.25, bidMax: 12.5 }, onChange: noop, onDailyChange: noop, onEndDateChange: noop, onBidChange: noop }, "LinkedInAdsBudget"));
    assert.ok(markup.includes(escaped((1.25).toLocaleString(locale))));
    assert.ok(markup.includes(escaped((12.5).toLocaleString(locale))));
    if (type === "total") assert.ok(markup.includes(escaped((2345.67).toLocaleString(locale, { style: "currency", currency: "EUR" }))));
    const localDate = (value: string) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
    assert.ok(markup.includes(`value="${localDate(settings.budget.startAt!)}"`));
    assert.ok(markup.includes(`value="${localDate(settings.budget.endAt!)}"`));
  }
});
