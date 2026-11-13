"use client";

import { useMemo } from "react";
import { adsUiText, translateAdsUiChoices, type AdsUiTranslator } from "./adsUiCopy";
import { useLocale, useTranslations } from "next-intl";


import { defaultGoogleDeliverySettings, googleAdsCalendarDate, googleAdsTextLength, googleSearchKeyword } from "@/lib/adsGoogleCampaignSettings";
import type { GoogleDeliverySettings, GoogleKeywordMatchType } from "@/lib/adsGoogleCampaignSettings";
import type { GoogleAdsAccountResources } from "@/lib/adsGoogleResources";
import type { AdsBidStrategy, AdsCampaignInput } from "@/lib/adsValidation";
import styles from "./ads.module.css";

type SettingsProps = {
  settings: GoogleDeliverySettings;
  onChange: (patch: Partial<GoogleDeliverySettings>) => void;
};

const matchLabels: Record<GoogleKeywordMatchType, string> = {
  PHRASE: "Expression exacte",
  EXACT: "Mot-clé exact",
  BROAD: "Requête large",
};
const strategyLabels: Partial<Record<AdsBidStrategy, string>> = {
  maximize_clicks: "Maximiser les clics",
  maximize_conversions: "Maximiser les conversions",
  maximize_value: "Maximiser la valeur de conversion",
  manual_review: "CPC manuel",
  target_cpa: "CPA cible",
  target_roas: "ROAS cible",
};
const RAW_matchLabels = matchLabels;
const RAW_strategyLabels = strategyLabels;

const money = (value: number, locale = "fr-FR") => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(value);
const optionalNumber = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;

function accountToday(timeZone: string): string {
  if (!timeZone) return "";
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
  } catch {
    return "";
  }
}

function shiftDate(date: string, days: number): string {
  if (!googleAdsCalendarDate(date)) return "";
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function calendarLabel(date: string, i18nT?: AdsUiTranslator, locale = "fr-FR"): string {
  return googleAdsCalendarDate(date)
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))
    : adsUiText(i18nT, "À renseigner");
}

function primaryActions(resources: GoogleAdsAccountResources) {
  return resources.conversionActions.filter((action) => action.status === "ENABLED" && action.primaryForGoal
    && resources.conversionGoals.some((goal) => goal.biddable && goal.category === action.category && goal.origin === action.origin));
}

export function GoogleAdsBidding({ settings, strategy, onStrategyChange, onChange, conversionsReady }: SettingsProps & {
  strategy: AdsBidStrategy;
  onStrategyChange: (strategy: AdsBidStrategy) => void;
  conversionsReady: boolean | null;
}) {
  const i18nT = useTranslations("booster");
  const changeBid = (key: keyof GoogleDeliverySettings["bidding"], value: number | null) => onChange({ bidding: { ...settings.bidding, [key]: value } });
  const needsConversions = strategy === "maximize_conversions" || strategy === "maximize_value" || strategy === "target_cpa" || strategy === "target_roas";
  const targetsCpa = strategy === "maximize_conversions" || strategy === "target_cpa";
  const targetsValue = strategy === "maximize_value" || strategy === "target_roas";
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("encheres_google_search_f6377281")}</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>{i18nT("strategie_d_encheres_d2f40380")}{" "}<select value={strategy} onChange={(event) => onStrategyChange(event.target.value as AdsBidStrategy)}>
          <option value="maximize_clicks">{i18nT("maximiser_les_clics_bbc8d5a8")}</option>
          <option value="maximize_conversions" disabled={conversionsReady !== true}>{i18nT("maximiser_les_conversions_6ebf44c2")}</option>
          <option value="maximize_value" disabled={conversionsReady !== true}>{i18nT("maximiser_la_valeur_de_conversion_16116443")}</option>
          <option value="manual_review">{i18nT("cpc_manuel_ea29c29b")}</option>
          {strategy === "target_cpa" && <option value="target_cpa" disabled={conversionsReady !== true}>{i18nT("cpa_cible_35f8a81d")}</option>}
          {strategy === "target_roas" && <option value="target_roas" disabled={conversionsReady !== true}>{i18nT("roas_cible_2271b699")}</option>}
        </select>
      </label>
      {strategy === "maximize_clicks" && <label className={styles.field}>{i18nT("plafond_cpc_facultatif_7ace37e0")}{" "}<input type="number" min="0.01" max="500" step="0.01" value={settings.bidding.cpcBidCeilingEuros ?? ""} onChange={(event) => changeBid("cpcBidCeilingEuros", optionalNumber(event.target.value))} />
        <small>{i18nT("limite_l_enchere_par_clic_laissez_296c80e5")}</small>
      </label>}
      {strategy === "manual_review" && <label className={styles.field}>{i18nT("enchere_cpc_manuelle_616a390f")}{" "}<input type="number" min="0.01" max="500" step="0.01" required value={settings.bidding.manualCpcEuros ?? ""} onChange={(event) => changeBid("manualCpcEuros", optionalNumber(event.target.value))} />
        <small>{i18nT("montant_maximum_par_clic_applique_au_fa2b4cbd")}</small>
      </label>}
      {targetsCpa && <label className={styles.field}>{i18nT("cpa_cible_1f116ff8")}{strategy === "target_cpa" ? "" : i18nT("facultatif_04f3cd5a")}
        <input type="number" min="0.01" max="45000" step="0.01" required={strategy === "target_cpa"} value={settings.bidding.targetCpaEuros ?? ""} onChange={(event) => changeBid("targetCpaEuros", optionalNumber(event.target.value))} />
        <small>{i18nT("cout_moyen_vise_par_conversion_sans_dedc9674")}</small>
      </label>}
      {targetsValue && <label className={styles.field}>{i18nT("roas_cible_86649fea")}{strategy === "target_roas" ? "" : i18nT("facultatif_04f3cd5a")}
        <input type="number" min="1" max="100000" step="1" required={strategy === "target_roas"} value={settings.bidding.targetRoas === null ? "" : Number((settings.bidding.targetRoas * 100).toFixed(6))} onChange={(event) => {
          const percent = optionalNumber(event.target.value);
          changeBid("targetRoas", percent === null ? null : percent / 100);
        }} />
        <small>{i18nT("exemple_400_correspond_a_4_de_6e5798c6")}</small>
      </label>}
    </div>
    {strategy === "maximize_clicks" && <p>{i18nT("google_ajuste_les_encheres_pour_obtenir_fd68c629")}</p>}
    {needsConversions && conversionsReady !== true && <p role="status">{conversionsReady === null ? i18nT("les_objectifs_de_conversion_du_compte_5922885a") : i18nT("aucune_conversion_principale_active_dans_les_32f85e15")}</p>}
    {targetsValue && conversionsReady === true && <p>{i18nT("cette_strategie_optimise_la_valeur_enregistree_e594aecf")}</p>}
  </fieldset>;
}

export function GoogleAdsGeography({ settings, onChange }: SettingsProps) {
  const i18nT = useTranslations("booster");
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("personnes_a_toucher_dans_les_zones_f9628c4a")}</legend>
    <label className={styles.field}>{i18nT("option_geographique_3b771757")}{" "}<select value={settings.geoTargetType} onChange={(event) => onChange({ geoTargetType: event.target.value as GoogleDeliverySettings["geoTargetType"] })}>
        <option value="PRESENCE">{i18nT("presence_personnes_dans_les_zones_ciblees_dd90ab78")}</option>
        <option value="PRESENCE_OR_INTEREST">{i18nT("presence_ou_interet_personnes_dans_les_3a1a80d8")}</option>
      </select>
    </label>
    <p>{settings.geoTargetType === "PRESENCE" ? i18nT("la_presence_se_limite_aux_personnes_20f4eb1f") : i18nT("l_interet_peut_aussi_toucher_des_2da6304c")}</p>
  </fieldset>;
}

export function GoogleAdsKeywords({ settings, onChange }: SettingsProps) {
  const i18nT = useTranslations("booster");
  const { matchLabels } = useMemo(() => ({ matchLabels: translateAdsUiChoices(RAW_matchLabels, i18nT) }), [i18nT]);
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("correspondance_des_mots_cles_30a7919e")}</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>{i18nT("correspondance_par_defaut_f7aadab0")}{" "}<select value={settings.keywordMatchType} onChange={(event) => onChange({ keywordMatchType: event.target.value as GoogleKeywordMatchType })}>
          {Object.entries(matchLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <small>{i18nT("les_guillemets_quot_expression_quot_ou_6274f72c")}</small>
      </label>
      <label className={styles.field}>{i18nT("correspondance_des_exclusions_2bfe4786")}{" "}<select value={settings.negativeKeywordMatchType} onChange={(event) => onChange({ negativeKeywordMatchType: event.target.value as GoogleKeywordMatchType })}>
          {Object.entries(matchLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <small>{i18nT("les_exclusions_n_incluent_pas_automatiquement_d7c39348")}</small>
      </label>
    </div>
    <p>{i18nT("la_requete_large_peut_declencher_des_24e9faf1")}</p>
  </fieldset>;
}

export function GoogleAdsRSAFields({ settings, onChange }: SettingsProps) {
  const i18nT = useTranslations("booster");
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("chemin_affiche_de_l_annonce_facultatif_702414f4")}</legend>
    <div className={styles.studioGrid}>
      {(["path1", "path2"] as const).map((key, index) => <label className={styles.field} key={key}>{i18nT("chemin_292b645c")}{" "}{index + 1}
        <input value={settings.responsiveSearchAd[key]} maxLength={15} placeholder={index === 0 ? "essai" : i18nT("21_jours_4e59a7b4")} onChange={(event) => onChange({ responsiveSearchAd: { ...settings.responsiveSearchAd, [key]: event.target.value } })} aria-invalid={googleAdsTextLength(settings.responsiveSearchAd[key]) > 15 || /[\/?#\r\n]/.test(settings.responsiveSearchAd[key])} />
        <small>{googleAdsTextLength(settings.responsiveSearchAd[key])} / 15 caractères ; sans « / », « ? » ou « # ».</small>
      </label>)}
    </div>
    <p>{i18nT("ces_segments_s_affichent_apres_votre_9e130d9f")}</p>
  </fieldset>;
}

export function GoogleAdsBudget({ settings, dailyBudget, endDate, timeZone, onChange, onDailyChange, onEndDateChange }: SettingsProps & {
  dailyBudget: number;
  endDate: string;
  timeZone: string;
  onDailyChange: (value: number) => void;
  onEndDateChange: (value: string) => void;
}) {
  const i18nT = useTranslations("booster");
  const total = settings.budget.type === "total";
  const today = accountToday(timeZone);
  const start = settings.startDate || (total ? "" : today);
  const days = googleAdsCalendarDate(start) && googleAdsCalendarDate(endDate)
    ? Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1
    : null;
  const invalidDuration = total && days !== null && (days < 3 || days > 90);
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("budget_et_calendrier_google_search_015b711c")}</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>{i18nT("type_de_budget_7e3d4089")}{" "}<select value={settings.budget.type} onChange={(event) => {
          const type = event.target.value as GoogleDeliverySettings["budget"]["type"];
          onChange({ budget: { ...settings.budget, type }, ...(type === "total" && !settings.startDate && today ? { startDate: today } : {}) });
        }}>
          <option value="daily">{i18nT("budget_quotidien_moyen_0c02d0b4")}</option>
          <option value="total">{i18nT("budget_total_de_la_campagne_a32e671e")}</option>
        </select>
      </label>
      {total ? <label className={styles.field}>{i18nT("budget_total_97aca19f")}{" "}<input type="number" min="5" max="45000" step="0.01" required value={settings.budget.totalEuros ?? ""} onChange={(event) => onChange({ budget: { ...settings.budget, totalEuros: optionalNumber(event.target.value) } })} />
        <small>{i18nT("enveloppe_publicitaire_totale_pour_cette_campagn_a13b23b3")}</small>
      </label> : <label className={styles.field}>{i18nT("budget_quotidien_moyen_8d3aa62f")}{" "}<input type="number" min="5" max="500" step="0.01" required value={Number.isFinite(dailyBudget) ? dailyBudget : ""} onChange={(event) => onDailyChange(Number(event.target.value))} />
        <small>{i18nT("de_5_a_500_par_jour_52edf4a3")}</small>
      </label>}
      <label className={styles.field}>{i18nT("date_de_debut_706438ab")}{total ? "" : i18nT("facultative_6a96ceae")}
        <input type="date" value={settings.startDate ?? ""} min={today || undefined} required={total} onChange={(event) => onChange({ startDate: event.target.value || null })} />
        <small>{total ? i18nT("un_debut_et_une_fin_fixes_177a2180") : i18nT("sans_date_la_campagne_pourra_demarrer_1b695139")}</small>
      </label>
      <label className={styles.field}>{i18nT("date_de_fin_716a6d8d")}{" "}<input type="date" value={endDate} min={(total ? shiftDate(start, 2) : start) || undefined} max={total ? shiftDate(start, 89) || undefined : undefined} required onChange={(event) => onEndDateChange(event.target.value)} aria-invalid={invalidDuration || (days !== null && days < 1)} />
        <small>{total ? i18nT("duree_comprise_entre_3_et_90_e2b36859") : i18nT("la_campagne_s_arrete_a_cette_111704e0")}</small>
      </label>
    </div>
    <p>{i18nT("dates_du_compte_google_ads_54cfc4c4")}{" "}{timeZone || i18nT("fuseau_horaire_a_verifier_cf8fbcd4")}.{days !== null && days > 0 ? i18nT("ads_count_duration_days", { count: days }) : ""}</p>
    {invalidDuration && <p role="alert">{i18nT("le_budget_total_necessite_une_campagne_a951a62e")}</p>}
    {total ? <p>{i18nT("google_repartit_cette_enveloppe_sur_la_cd84cf16")}</p>
      : <p>{i18nT("google_peut_facturer_jusqu_a_deux_4dcc166c")}</p>}
  </fieldset>;
}

export function GoogleAdsMeasurement({ resources, loading, error, onRefresh }: {
  resources: GoogleAdsAccountResources | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const i18nT = useTranslations("booster");
  const actions = resources ? primaryActions(resources) : [];
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("conversions_du_compte_google_ads_30d9cbf2")}</legend>
    <p>{i18nT("la_campagne_reprend_les_objectifs_de_78ee8919")}</p>
    <button type="button" className={styles.secondaryButton} onClick={onRefresh} disabled={loading}>{loading ? i18nT("verification_en_cours_91ab3c71") : i18nT("actualiser_les_conversions_9e835657")}</button>
    {error && <p role="alert">{error}</p>}
    {!loading && !error && !resources && <p role="status">{i18nT("les_objectifs_du_compte_n_ont_a78525a4")}</p>}
    {resources && <>
      <p>{i18nT("compte_value_value_objectifs_du_compte_86ed5729", { value0: resources.selectedAccountId, value1: resources.timeZone })}</p>
      <div aria-live="polite">
        {actions.length ? <><strong>{i18nT("conversions_principales_actives_utilisees_pour_l_0df0bde7")}</strong><ul>{actions.map((action) => <li key={action.resourceName}>{action.name}</li>)}</ul></>
          : <p>{i18nT("aucune_conversion_principale_active_rattachee_a_789e69b6")}</p>}
      </div>
      {resources.conversionActions.some((action) => !actions.some((primary) => primary.resourceName === action.resourceName)) && <details>
        <summary>{i18nT("autres_actions_de_conversion_du_compte_b741fcf1")}</summary>
        <ul>{resources.conversionActions.filter((action) => !actions.some((primary) => primary.resourceName === action.resourceName)).map((action) => <li key={action.resourceName}>{action.name} — {action.primaryForGoal ? i18nT("objectif_non_utilise_pour_les_encheres_33a8749a") : i18nT("action_secondaire_7dced36b")}</li>)}</ul>
      </details>}
      <p>{i18nT("la_presence_d_une_conversion_active_0e2b2d92")}</p>
    </>}
  </fieldset>;
}

function nativeKeywords(values: string[], defaultMatchType: GoogleKeywordMatchType) {
  return values.map((value) => {
    try {
      const keyword = googleSearchKeyword(value, defaultMatchType);
      return `${keyword.text} · ${matchLabels[keyword.matchType]}`;
    } catch {
      return `${value} · à corriger`;
    }
  }).join(" ; ") || "Aucun";
}

export function GoogleAdsEffectiveSummary({ draft, resources }: { draft: AdsCampaignInput; resources: GoogleAdsAccountResources | null }) {
  const locale = useLocale();
  const i18nT = useTranslations("booster");
  const { strategyLabels } = useMemo(() => ({ strategyLabels: translateAdsUiChoices(RAW_strategyLabels, i18nT) }), [i18nT]);
  const settings = draft.googleDeliverySettings || defaultGoogleDeliverySettings();
  const matchingResources = resources && resources.selectedAccountId === draft.adAccountId.replace(/-/g, "") ? resources : null;
  const actions = matchingResources ? primaryActions(matchingResources) : [];
  let bidDetail = "";
  if (draft.bidStrategy === "maximize_clicks") bidDetail = settings.bidding.cpcBidCeilingEuros === null ? i18nT("sans_plafond_cpc_7f230747") : i18nT("plafond_cpc_value_1e472b52", { value0: money(settings.bidding.cpcBidCeilingEuros, locale) });
  if (draft.bidStrategy === "manual_review") bidDetail = settings.bidding.manualCpcEuros === null ? i18nT("cpc_a_renseigner_36bfddf8") : i18nT("cpc_value_9662473f", { value0: money(settings.bidding.manualCpcEuros, locale) });
  if (draft.bidStrategy === "maximize_conversions" || draft.bidStrategy === "target_cpa") bidDetail = settings.bidding.targetCpaEuros === null ? draft.bidStrategy === "target_cpa" ? i18nT("cpa_cible_a_renseigner_e507a31e") : i18nT("sans_cpa_cible_e2cd7c58") : i18nT("cpa_cible_value_ec0b7019", { value0: money(settings.bidding.targetCpaEuros, locale) });
  if (draft.bidStrategy === "maximize_value" || draft.bidStrategy === "target_roas") bidDetail = settings.bidding.targetRoas === null ? draft.bidStrategy === "target_roas" ? i18nT("roas_cible_a_renseigner_426c1099") : i18nT("sans_roas_cible_8059298e") : i18nT("roas_cible_value_3212765a", { value0: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(settings.bidding.targetRoas * 100) });
  const total = settings.budget.type === "total";
  const startLabel = settings.startDate ? calendarLabel(settings.startDate, i18nT, locale) : total ? i18nT("debut_a_renseigner_4d3c51ee") : i18nT("des_publication_et_approbation_014321fe");
  const rows = [
    [i18nT("type_de_campagne_70f9fad7"), draft.campaignType === "search" ? i18nT("reseau_de_recherche_annonce_responsive_textuelle_f96f93b8") : i18nT("format_conserve_en_brouillon_publication_non_1217e6fa")],
    [i18nT("zones_geographiques_febaa8a7"), draft.targetLocations.join(" ; ") || i18nT("a_renseigner_e3d2f20f")],
    [i18nT("option_geographique_3b771757"), settings.geoTargetType === "PRESENCE" ? i18nT("presence_dans_les_zones_ou_frequentation_7149c69c") : i18nT("presence_ou_interet_pour_les_zones_cdbaf940")],
    [i18nT("mots_cles_7120109e"), nativeKeywords(draft.keywords, settings.keywordMatchType)],
    [i18nT("mots_cles_exclus_d5b8ad53"), nativeKeywords(draft.negativeKeywords, settings.negativeKeywordMatchType)],
    [i18nT("reseaux_ee81e84d"), [i18nT("recherche_google_133957f9"), draft.googleSearchPartners && i18nT("partenaires_de_recherche_59875e41"), draft.googleDisplayExpansion && i18nT("extension_display_defbf9ad")].filter(Boolean).join(" · ")],
    [i18nT("encheres_913a3aa8"), `${strategyLabels[draft.bidStrategy] || i18nT("strategie_a_verifier_8a64b661")}${bidDetail ? ` · ${bidDetail}` : ""}`],
    [i18nT("budget_7aeba4cd"), total ? settings.budget.totalEuros === null ? i18nT("total_a_renseigner_298aa221") : i18nT("value_au_total_7cbf0b20", { value0: money(settings.budget.totalEuros, locale) }) : i18nT("value_par_jour_en_moyenne_06a0202f", { value0: money(draft.dailyBudgetEuros, locale) })],
    [i18nT("calendrier_4c83736b"), `${startLabel} → ${calendarLabel(draft.endDate, i18nT, locale)} · ${matchingResources?.timeZone || i18nT("fuseau_du_compte_a_verifier_bcfb3972")}`],
    [i18nT("conversions_pour_les_encheres_9bec8b02"), !matchingResources ? i18nT("objectifs_du_compte_a_verifier_524d3350") : actions.map((action) => action.name).join(" ; ") || i18nT("aucune_conversion_principale_active_confirmee_365582dd")],
    [i18nT("langue_6619264a"), i18nT("google_adapte_search_a_la_langue_52b92f23")],
    [i18nT("chemin_affiche_14d334ef"), [settings.responsiveSearchAd.path1, settings.responsiveSearchAd.path2].filter(Boolean).join(" / ") || i18nT("domaine_uniquement_d6bdf3c3")],
  ];
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("reglages_qui_seront_transmis_a_google_04cdc64c")}</legend>
    <dl className={styles.studioReviewGrid}>
      {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <p>{total ? i18nT("le_budget_total_est_une_enveloppe_878ea770") : i18nT("le_budget_quotidien_est_une_moyenne_85999c1f")} {" "}{i18nT("les_conversions_reprennent_les_objectifs_du_0a3279cc")}</p>
  </fieldset>;
}
