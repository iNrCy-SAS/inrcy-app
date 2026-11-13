"use client";

import { adsUiText, translateAdsUiChoices, type AdsUiTranslator } from "./adsUiCopy";
import { useLocale, useTranslations } from "next-intl";


import { useMemo, useState } from "react";
import { defaultPinterestDeliverySettings } from "@/lib/adsPinterestCampaignSettings";
import type { PinterestDeliverySettings } from "@/lib/adsPinterestCampaignSettings";
import type { PinterestGeographyOption } from "@/lib/adsPinterestLocations";
import type { AdsCampaignInput } from "@/lib/adsValidation";
import styles from "./ads.module.css";

type SettingsProps = {
  settings: PinterestDeliverySettings;
  onChange: (patch: Partial<PinterestDeliverySettings>) => void;
};
type PinterestDraft = AdsCampaignInput & { pinterestDeliverySettings?: PinterestDeliverySettings };
type SummaryResources = {
  geographyOptions?: readonly PinterestGeographyOption[];
  languageOptions?: readonly { id: string; name: string }[];
};

const money = (value: number, locale = "fr-FR") => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(value);
const optionalNumber = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const placementLabels: Record<PinterestDeliverySettings["placementGroup"], string> = {
  ALL: "Tous les emplacements",
  SEARCH: "Recherche",
  BROWSE: "Parcourir",
  OTHER: "Autres emplacements",
};
const RAW_placementLabels = placementLabels;


function validTimeZone(timeZone: string | null): timeZone is string {
  if (!timeZone) return false;
  try { new Intl.DateTimeFormat("fr-FR", { timeZone }).format(); return true; }
  catch { return false; }
}

function localDateTime(value: string | null, timeZone: string | null): string {
  if (!value || !validTimeZone(timeZone) || !Number.isFinite(Date.parse(value))) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (name: string) => parts.find((item) => item.type === name)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Convert account wall-clock input without relying on the browser's local zone. */
function isoDateTime(value: string, timeZone: string | null): string | null {
  if (!validTimeZone(timeZone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) return null;
  const localMillis = (millis: number) => Date.parse(`${localDateTime(new Date(millis).toISOString(), timeZone)}:00Z`);
  let millis = wall;
  for (let index = 0; index < 4; index++) millis += wall - localMillis(millis);
  if (localMillis(millis) !== wall || [-7_200_000, -3_600_000, 3_600_000, 7_200_000].some((shift) => localMillis(millis + shift) === wall)) return null;
  return new Date(millis).toISOString();
}

function prettyDate(value: string | null, timeZone: string | null, i18nT?: AdsUiTranslator, locale = "fr-FR"): string {
  if (!value || !Number.isFinite(Date.parse(value))) return adsUiText(i18nT, "À renseigner");
  if (!validTimeZone(timeZone)) return adsUiText(i18nT, "{value0} · fuseau du compte à vérifier", { value0: value });
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function effectiveSettings(draft: PinterestDraft): PinterestDeliverySettings {
  if (draft.pinterestDeliverySettings) return draft.pinterestDeliverySettings;
  const objective = draft.channelSettings?.channel === "pinterest" ? draft.channelSettings.objectiveType : "CONSIDERATION";
  return {
    ...defaultPinterestDeliverySettings(objective),
    bidding: { strategy: "max_bid", amountEuros: draft.pinterestBidEuros ?? 1 },
  };
}

export function pinterestAdsBudgetLabel(draft: PinterestDraft, i18nT?: AdsUiTranslator, locale = "fr-FR"): string {
  const settings = effectiveSettings(draft);
  if (settings.budget.type === "total") return settings.budget.totalEuros === null ? adsUiText(i18nT, "Budget total à renseigner") : adsUiText(i18nT, "{value0} au total", { value0: money(settings.budget.totalEuros, locale) });
  return adsUiText(i18nT, settings.budget.flexibleDaily ? "{value0} par jour en moyenne" : "{value0} par jour · plafond quotidien fixe", { value0: money(draft.dailyBudgetEuros, locale) });
}

export function PinterestAdsBudget({ settings, dailyBudget, endDate, timeZone, onChange, onDailyChange, onEndDateChange }: SettingsProps & {
  dailyBudget: number;
  endDate: string;
  timeZone: string | null;
  onDailyChange: (value: number) => void;
  onEndDateChange: (value: string) => void;
}) {
  const i18nT = useTranslations("booster");
  const [calendarError, setCalendarError] = useState("");
  const total = settings.budget.type === "total";
  const calendarTimeZone = validTimeZone(timeZone) ? timeZone : "UTC";
  const start = settings.budget.startAt;
  const end = settings.budget.endAt || (endDate ? `${endDate}T23:59:59Z` : null);
  const now = new Date();
  const maximum = new Date(now.getTime() + 90 * 86_400_000).toISOString();
  const changeDate = (key: "startAt" | "endAt", value: string) => {
    if (!value) {
      setCalendarError("");
      onChange({ budget: { ...settings.budget, [key]: null } });
      if (key === "endAt") onEndDateChange("");
      return;
    }
    const instant = isoDateTime(value, calendarTimeZone);
    if (!instant) { setCalendarError(i18nT("cette_date_ou_cette_heure_n_f6c79ed2")); return; }
    setCalendarError("");
    onChange({ budget: { ...settings.budget, [key]: instant } });
    if (key === "endAt") onEndDateChange(value.slice(0, 10));
  };
  const wrongOrder = Boolean(start && end && Date.parse(end) <= Date.parse(start));
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("budget_et_calendrier_pinterest_7142a46a")}</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>{i18nT("type_de_budget_7e3d4089")}{" "}<select value={total ? "total" : settings.budget.flexibleDaily ? "flexible_daily" : "fixed_daily"} onChange={(event) => {
          const type = event.target.value === "total" ? "total" : "daily";
          onChange({ budget: { ...settings.budget, type, totalEuros: type === "total" ? settings.budget.totalEuros : null, flexibleDaily: event.target.value === "flexible_daily" } });
        }}>
          <option value="total">{i18nT("budget_total_de_la_campagne_a32e671e")}</option>
          <option value="fixed_daily">{i18nT("budget_quotidien_fixe_9076d7e6")}</option>
          <option value="flexible_daily">{i18nT("budget_quotidien_moyen_performance_a7df1d22")}</option>
        </select>
      </label>
      {total ? <label className={styles.field}>{i18nT("budget_total_97aca19f")}{" "}<input type="number" min="5" max="45000" step="0.01" required value={settings.budget.totalEuros ?? ""} onChange={(event) => onChange({ budget: { ...settings.budget, totalEuros: optionalNumber(event.target.value) } })} />
        <small>{i18nT("une_seule_enveloppe_pour_la_campagne_31f55b63")}</small>
      </label> : <label className={styles.field}>{settings.budget.flexibleDaily ? i18nT("budget_quotidien_moyen_8d3aa62f") : i18nT("budget_quotidien_fixe_e7a6f66e")}
        <input type="number" min="5" max="500" step="0.01" required value={Number.isFinite(dailyBudget) ? dailyBudget : ""} onChange={(event) => onDailyChange(Number(event.target.value))} />
        <small>{i18nT("de_5_a_500_par_jour_1c65a4db")}</small>
      </label>}
      <label className={styles.field}>{i18nT("debut_de_diffusion_0508eb90")}{" "}<select value={start ? "scheduled" : "now"} onChange={(event) => {
          setCalendarError("");
          onChange({ budget: { ...settings.budget, startAt: event.target.value === "scheduled" ? new Date(Date.now() + 86_400_000).toISOString() : null } });
        }}>
          <option value="now">{i18nT("des_la_validation_de_pinterest_8f570560")}</option>
          <option value="scheduled">{i18nT("choisir_une_date_et_une_heure_f4ff52cf")}</option>
        </select>
        {start && <input aria-label={i18nT("date_et_heure_de_debut_pinterest_54274ba4")} type="datetime-local" required value={localDateTime(start, calendarTimeZone)} min={localDateTime(now.toISOString(), calendarTimeZone)} max={localDateTime(maximum, calendarTimeZone)} onChange={(event) => changeDate("startAt", event.target.value)} />}
      </label>
      <label className={styles.field}>{i18nT("date_et_heure_de_fin_pinterest_fa79a99d")}{" "}<input type="datetime-local" required value={localDateTime(end, calendarTimeZone)} min={localDateTime(start || now.toISOString(), calendarTimeZone)} max={localDateTime(maximum, calendarTimeZone)} aria-invalid={wrongOrder || Boolean(calendarError)} onChange={(event) => changeDate("endAt", event.target.value)} />
        <small>{i18nT("une_fin_apres_le_debut_dans_ce74bf56")}</small>
      </label>
    </div>
    <p>{i18nT("heures_du_calendrier_value_cc897201", { value0: calendarTimeZone })}</p>
    {calendarError && <p role="alert">{calendarError}</p>}
    {wrongOrder && <p role="alert">{i18nT("la_fin_de_diffusion_doit_etre_334a69a7")}</p>}
    {total ? <p>{i18nT("pinterest_repartit_cette_enveloppe_sur_la_eddbd897")}</p>
      : settings.budget.flexibleDaily ? <p>{i18nT("le_budget_est_une_moyenne_calculee_6e5ab1bb")}</p>
        : <p>{i18nT("ce_montant_est_le_plafond_quotidien_9b209aa5")}</p>}
    <p>{i18nT("pinterest_repartit_le_budget_de_la_0b92b2ce")}</p>
  </fieldset>;
}

export function PinterestAdsBidding({ settings, objectiveType, budgetEuros, onChange }: SettingsProps & { objectiveType: string; budgetEuros: number }) {
  const i18nT = useTranslations("booster");
  const supported = objectiveType === "AWARENESS" || objectiveType === "CONSIDERATION";
  const awareness = objectiveType === "AWARENESS";
  if (!supported) return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("encheres_pinterest_743c92b0")}</legend><p>{i18nT("les_encheres_pour_cet_objectif_restent_8f3ecba1")}</p></fieldset>;
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("optimisation_et_encheres_pinterest_d8bf8998")}</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>{i18nT("resultat_optimise_71db0f48")}{" "}<input value={awareness ? "Impressions" : i18nT("ads_ui_64e0f5fd31")} readOnly />
        <small>{awareness ? i18nT("faire_decouvrir_votre_marque_sur_pinterest_14edafe6") : i18nT("un_clic_peut_ouvrir_l_epingle_18e2f0a8")}</small>
      </label>
      <label className={styles.field}>{i18nT("strategie_d_encheres_pinterest_e44219a1")}{" "}<select value={settings.bidding.strategy} onChange={(event) => {
          const strategy = event.target.value as PinterestDeliverySettings["bidding"]["strategy"];
          onChange({ bidding: { strategy, amountEuros: strategy === "max_bid" ? settings.bidding.amountEuros ?? 1 : null }, optimizationGoal: awareness ? "impressions" : "pin_clicks" });
        }}>
          <option value="automatic">{i18nT("performance_encheres_automatiques_6f135e8a")}</option>
          <option value="max_bid">{i18nT("enchere_maximale_personnalisee_512657a5")}</option>
        </select>
      </label>
      {settings.bidding.strategy === "max_bid" && <label className={styles.field}>{awareness ? i18nT("cpm_maximal_pour_1_000_impressions_47864831") : i18nT("cpc_maximal_par_clic_sur_l_af89d44e")}
        <input type="number" min="0.01" max={Number.isFinite(budgetEuros) && budgetEuros > 0 ? budgetEuros : undefined} step="0.01" required value={settings.bidding.amountEuros ?? ""} onChange={(event) => onChange({ bidding: { ...settings.bidding, amountEuros: optionalNumber(event.target.value) } })} />
        <small>{i18nT("de_0_01_au_montant_du_58c0ddf7")}</small>
      </label>}
    </div>
    {settings.bidding.strategy === "automatic" ? <p>{i18nT("pinterest_ajuste_les_encheres_dans_votre_b581518d")}</p> : <p>{i18nT("le_montant_saisi_limite_l_enchere_334943df")}</p>}
    {!awareness && <p>{i18nT("l_optimisation_des_clics_sortants_vers_ec4087c9")}</p>}
  </fieldset>;
}

export function PinterestAdsDistribution({ settings, onChange }: SettingsProps) {
  const i18nT = useTranslations("booster");
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("emplacements_pinterest_23bcb1ba")}</legend>
    <label className={styles.field}>{i18nT("ou_montrer_l_epingle_44a7806d")}{" "}<select value={settings.placementGroup} onChange={(event) => onChange({ placementGroup: event.target.value as PinterestDeliverySettings["placementGroup"] })}>
        <option value="ALL">{i18nT("tous_les_emplacements_recommande_10e9863d")}</option>
        <option value="SEARCH">{i18nT("recherche_787b5492")}</option>
        <option value="BROWSE">{i18nT("parcourir_19110baa")}</option>
        {settings.placementGroup === "OTHER" && <option value="OTHER">{i18nT("autres_emplacements_choix_conserve_c76909c3")}</option>}
      </select>
      <small>{settings.placementGroup === "SEARCH" ? i18nT("resultats_de_recherche_et_epingles_associees_83de4dc0") : settings.placementGroup === "BROWSE" ? i18nT("accueil_et_epingles_associees_pendant_la_f404f12d") : settings.placementGroup === "OTHER" ? i18nT("placement_enregistre_a_verifier_dans_pinterest_812dfb67") : i18nT("recherche_accueil_et_epingles_associees_4724fe33")}</small>
    </label>
    <p>{i18nT("le_ciblage_automatique_utilise_le_contenu_6325f062")}</p>
  </fieldset>;
}

export function PinterestAdsEffectiveSummary({ draft, timeZone, resources }: { draft: PinterestDraft; timeZone: string | null; resources?: SummaryResources | null }) {
  const locale = useLocale();
  const i18nT = useTranslations("booster");
  const { placementLabels } = useMemo(() => ({ placementLabels: translateAdsUiChoices(RAW_placementLabels, i18nT) }), [i18nT]);
  const settings = effectiveSettings(draft);
  const calendarTimeZone = validTimeZone(timeZone) ? timeZone : "UTC";
  const channel = draft.channelSettings?.channel === "pinterest" ? draft.channelSettings : null;
  const supported = Boolean(channel && ["AWARENESS", "CONSIDERATION"].includes(channel.objectiveType) && channel.intendedPromotionType === "STANDARD_AD" && channel.creativeType === "REGULAR" && channel.targetingMode === "automatic");
  const awareness = channel?.objectiveType === "AWARENESS";
  const bid = settings.bidding.strategy === "automatic" ? i18nT("performance_encheres_automatiques_5bded0b3") : i18nT("value_maximal_value_d56f0c3e", { value0: awareness ? "CPM" : i18nT("ads_pinterest_pin_cpc"), value1: settings.bidding.amountEuros === null ? i18nT("a_renseigner_fcd86e53") : money(settings.bidding.amountEuros, locale) });
  const locations = draft.targetLocations.map((value) => resources?.geographyOptions?.find((option) => option.id === value)?.name || value);
  const languages = draft.languages.map((value) => resources?.languageOptions?.find((option) => option.id === value)?.name || value);
  const end = settings.budget.endAt || (draft.endDate ? `${draft.endDate}T23:59:59Z` : null);
  const rows = [
    [i18nT("campagne_53c2fc2a"), channel?.objectiveType === "AWARENESS" ? i18nT("notoriete_88fa45ce") : channel?.objectiveType === "CONSIDERATION" ? i18nT("consideration_3dab0be5") : i18nT("objectif_conserve_en_brouillon_6f770fc0")],
    [i18nT("format_du_pin_54c429f9"), supported ? i18nT("epingle_sponsorisee_image_standard_e433b90d") : i18nT("format_ou_ciblage_a_conserver_en_c296bf2d")],
    [i18nT("resultat_optimise_71db0f48"), supported ? awareness ? i18nT("impressions_b5fb66f6") : i18nT("clics_sur_l_epingle_sans_garantie_ae0f0cc1") : i18nT("a_confirmer_dans_pinterest_1a0abb69")],
    [i18nT("zones_geographiques_febaa8a7"), locations.join(" ; ") || i18nT("a_renseigner_e3d2f20f")],
    [i18nT("langues_e90c7e3c"), languages.join(" ; ") || i18nT("a_renseigner_e3d2f20f")],
    [i18nT("audience_51d99345"), channel?.targetingMode === "automatic" ? i18nT("ciblage_automatique_a_partir_du_pin_257e0280") : i18nT("signaux_manuels_conserves_en_brouillon_fd5f8392")],
    [i18nT("emplacements_302f9ebb"), placementLabels[settings.placementGroup]],
    [i18nT("encheres_913a3aa8"), bid],
    [i18nT("budget_de_campagne_fa6e2318"), pinterestAdsBudgetLabel(draft, i18nT, locale)],
    [i18nT("debut_f0955314"), settings.budget.startAt ? prettyDate(settings.budget.startAt, calendarTimeZone, i18nT, locale) : i18nT("des_publication_et_validation_de_pinterest_e83a1377")],
    [i18nT("fin_4251065f"), prettyDate(end, calendarTimeZone, i18nT, locale)],
    [i18nT("heures_du_calendrier_4bf0190a"), calendarTimeZone],
    [i18nT("destination_d4271349"), draft.destinationUrl || i18nT("a_renseigner_e3d2f20f")],
    [i18nT("parametres_de_suivi_90a56411"), draft.trackingParameters || i18nT("aucun_parametre_ajoute_21d9cb77")],
    [i18nT("conversions_pour_les_encheres_9bec8b02"), i18nT("aucun_evenement_de_conversion_selectionne_pour_285adf90")],
  ];
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("reglages_de_diffusion_pinterest_85a6f772")}</legend>
    <dl className={styles.studioReviewGrid}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p>{i18nT("le_budget_est_defini_au_niveau_9c1ad962")}</p>
  </fieldset>;
}
