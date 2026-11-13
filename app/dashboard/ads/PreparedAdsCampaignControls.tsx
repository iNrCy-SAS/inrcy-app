"use client";

import { adsUiText, translateAdsUiChoices, type AdsUiTranslator } from "./adsUiCopy";
import { useLocale, useTranslations } from "next-intl";


import { useAdsErrorMessage } from "./useAdsErrorMessage";
import { useMemo, useState } from "react";
import {
  defaultPreparedDeliverySettings,
  plannedNativeCalendar,
  preparedAdsCalendarInstant,
  preparedAdsLegacyEndInstant,
  preparedAdsLocalDateTime,
  preparedAdsTimeZone,
} from "@/lib/adsPreparedCampaignSettings";
import type { PreparedDeliverySettings } from "@/lib/adsPreparedCampaignSettings";
import type { AdsCampaignInput } from "@/lib/adsValidation";
import styles from "./ads.module.css";

type SettingsProps = {
  settings: PreparedDeliverySettings;
  onChange: (patch: Partial<PreparedDeliverySettings>) => void;
};
type PreparedDraft = AdsCampaignInput & { preparedDeliverySettings?: PreparedDeliverySettings };
const money = (value: number, locale = "fr-FR") => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(value);
const optionalNumber = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const channelLabel = (channel: string) => channel === "tiktok" ? "TikTok" : "X";
const objectiveLabels: Record<string, string> = {
  REACH: "Couverture", VIDEO_VIEWS: "Vues de vidéo", TRAFFIC: "Visites du site", WEB_CONVERSIONS: "Conversions sur le site", LEAD_GENERATION: "Prospects", ENGAGEMENT: "Interactions",
  reach: "Couverture", video_views: "Vues de vidéo", website_traffic: "Visites du site", website_conversions: "Conversions sur le site", engagement: "Interactions",
};
const optimizationLabels: Record<string, string> = { reach: "Couverture", views: "Vues de vidéo", clicks: "Clics", conversions: "Conversions", leads: "Prospects", engagement: "Interactions" };
const audienceLabels: Record<string, string> = { broad: "Audience large", interests: "Centres d’intérêt à vérifier dans le compte", keywords: "Mots-clés à vérifier dans le compte", follower_lookalikes: "Profils similaires aux abonnés à vérifier dans le compte" };
const conversionLabels: Record<string, string> = { quote_request: "Demandes de devis", lead_form: "Formulaires de contact", phone_call: "Appels", website_visit: "Visites du site", purchase: "Achats", message: "Messages", store_visit: "Visites en magasin", custom: "Objectif personnalisé" };
const destinationLabels: Record<string, string> = { website: "Site web", instant_form: "Formulaire instantané à vérifier", profile: "Profil publicitaire à vérifier", messaging: "Messagerie", phone: "Téléphone", store: "Magasin" };
const formatLabels: Record<string, string> = { text: "Texte", image: "Image", video: "Vidéo" };
const costCapLabels: Record<string, string> = { reach: "Coût cible pour la couverture (€)", views: "Coût cible par vue optimisée (€)", clicks: "Coût cible par clic (€)", conversions: "Coût cible par conversion (€)", leads: "Coût cible par prospect (€)", engagement: "Coût cible par interaction (€)" };
const RAW_objectiveLabels = objectiveLabels;
const RAW_optimizationLabels = optimizationLabels;
const RAW_audienceLabels = audienceLabels;
const RAW_conversionLabels = conversionLabels;
const RAW_destinationLabels = destinationLabels;
const RAW_formatLabels = formatLabels;
const RAW_costCapLabels = costCapLabels;


export function preparedAdsBudgetLabel(draft: PreparedDraft, i18nT?: AdsUiTranslator, locale = "fr-FR"): string {
  const budget = draft.preparedDeliverySettings?.budget;
  return budget?.type === "total"
    ? budget.totalEuros === null ? adsUiText(i18nT, "Budget total à renseigner") : adsUiText(i18nT, "{value0} au total", { value0: money(budget.totalEuros, locale) })
    : adsUiText(i18nT, "{value0} par jour", { value0: money(draft.dailyBudgetEuros, locale) });
}

export function PreparedAdsBudget({ settings, dailyBudget, endDate, timeZone, onChange, onDailyChange, onEndDateChange }: SettingsProps & {
  dailyBudget: number;
  endDate: string;
  timeZone: string | null;
  onDailyChange: (value: number) => void;
  onEndDateChange: (value: string) => void;
}) {
  const i18nT = useTranslations("booster");
  const [calendarError, setCalendarError] = useState("");
  const calendarTimeZone = preparedAdsTimeZone(timeZone) || "Europe/Paris";
  const total = settings.budget.type === "total";
  const start = settings.budget.startAt;
  const end = settings.budget.endAt || preparedAdsLegacyEndInstant(endDate);
  const now = new Date();
  const maximum = new Date(now.getTime() + 90 * 86_400_000).toISOString();
  const wrongOrder = Boolean(start && end && Date.parse(end) <= Date.parse(start));
  const changeDate = (key: "startAt" | "endAt", value: string) => {
    if (!value) {
      setCalendarError("");
      onChange({ budget: { ...settings.budget, [key]: null } });
      if (key === "endAt") onEndDateChange("");
      return;
    }
    const instant = preparedAdsCalendarInstant(value, calendarTimeZone);
    if (!instant) { setCalendarError(i18nT("cette_date_ou_cette_heure_est_13749e32")); return; }
    setCalendarError("");
    onChange({ budget: { ...settings.budget, [key]: instant } });
    if (key === "endAt") onEndDateChange(value.slice(0, 10));
  };
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("budget_et_calendrier_prepares_b9a9d758")}</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>{i18nT("type_de_budget_7e3d4089")}{" "}<select value={settings.budget.type} onChange={(event) => {
          const type = event.target.value === "total" ? "total" : "daily";
          onChange({ budget: { ...settings.budget, type, totalEuros: type === "total" ? settings.budget.totalEuros : null } });
        }}>
          <option value="daily">{i18nT("budget_quotidien_c56e4bf1")}</option>
          <option value="total">{i18nT("budget_total_pour_la_periode_0d88c23e")}</option>
        </select>
      </label>
      {total ? <label className={styles.field}>{i18nT("budget_total_97aca19f")}{" "}<input type="number" min="5" max="45000" step="0.01" required value={settings.budget.totalEuros ?? ""} onChange={(event) => onChange({ budget: { ...settings.budget, totalEuros: optionalNumber(event.target.value) } })} />
        <small>{i18nT("une_seule_enveloppe_pour_la_periode_4cc6fdca")}</small>
      </label> : <label className={styles.field}>{i18nT("budget_quotidien_02a0766e")}{" "}<input type="number" min="5" max="500" step="0.01" required value={Number.isFinite(dailyBudget) ? dailyBudget : ""} onChange={(event) => onDailyChange(Number(event.target.value))} />
        <small>{i18nT("de_5_a_500_par_jour_1c65a4db")}</small>
      </label>}
      <label className={styles.field}>{i18nT("debut_prevu_313e0d47")}{" "}<select value={start ? "scheduled" : "now"} onChange={(event) => {
          setCalendarError("");
          onChange({ budget: { ...settings.budget, startAt: event.target.value === "scheduled" ? new Date(Date.now() + 86_400_000).toISOString() : null } });
        }}>
          <option value="now">{i18nT("debut_immediat_prevu_89f6befb")}</option>
          <option value="scheduled">{i18nT("choisir_une_date_et_une_heure_f4ff52cf")}</option>
        </select>
        {start && <input aria-label={i18nT("date_et_heure_de_debut_preparees_7ac49a22")} type="datetime-local" required value={preparedAdsLocalDateTime(start, calendarTimeZone)} min={preparedAdsLocalDateTime(now.toISOString(), calendarTimeZone)} max={preparedAdsLocalDateTime(maximum, calendarTimeZone)} onChange={(event) => changeDate("startAt", event.target.value)} />}
      </label>
      <label className={styles.field}>{i18nT("date_et_heure_de_fin_prevues_a40b6439")}{" "}<input type="datetime-local" required value={preparedAdsLocalDateTime(end, calendarTimeZone)} min={preparedAdsLocalDateTime(start || now.toISOString(), calendarTimeZone)} max={preparedAdsLocalDateTime(maximum, calendarTimeZone)} aria-invalid={wrongOrder || Boolean(calendarError)} onChange={(event) => changeDate("endAt", event.target.value)} />
        <small>{i18nT("une_fin_apres_le_debut_dans_ce74bf56")}</small>
      </label>
    </div>
    <p>{i18nT("heures_du_calendrier_value_cc897201", { value0: calendarTimeZone })}</p>
    {!preparedAdsTimeZone(timeZone) && <p>{i18nT("fuseau_de_preparation_europe_paris_le_f3d623e6")}</p>}
    {calendarError && <p role="alert">{calendarError}</p>}
    {wrongOrder && <p role="alert">{i18nT("la_fin_prevue_doit_etre_apres_9c791f82")}</p>}
    <p>{total ? i18nT("l_enveloppe_totale_reste_distincte_du_31752672") : i18nT("ce_montant_prepare_un_budget_quotidien_2c9dbbb9")}</p>
    <p>{i18nT("ces_choix_sont_conserves_dans_le_04e46ed8")}</p>
  </fieldset>;
}

export function PreparedAdsBidding({ settings, budgetEuros, channel, optimizationIntent, onChange }: SettingsProps & { budgetEuros: number; channel: "x" | "tiktok"; optimizationIntent?: string }) {
  const i18nT = useTranslations("booster");
  const { costCapLabels } = useMemo(() => ({ costCapLabels: translateAdsUiChoices(RAW_costCapLabels, i18nT) }), [i18nT]);
  const tiktok = channel === "tiktok";
  const manual = settings.bidding.strategy !== "automatic";
  const incompatible = tiktok ? settings.bidding.strategy === "max_bid" : settings.bidding.strategy === "cost_cap";
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("encheres_value_preparees_2ba21b4e", { value0: channelLabel(channel) })}</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>{i18nT("strategie_d_encheres_prevue_53a5159a")}{" "}<select value={settings.bidding.strategy} onChange={(event) => {
          const strategy = event.target.value === "cost_cap" && tiktok ? "cost_cap" : event.target.value === "max_bid" && !tiktok ? "max_bid" : "automatic";
          onChange({ bidding: { strategy, amountEuros: strategy !== "automatic" && !incompatible ? settings.bidding.amountEuros : null } });
        }}>
          <option value="automatic">{tiktok ? i18nT("maximum_delivery_maximiser_les_resultats_eaab8af8") : i18nT("automatique_f8a3c37b")}</option>
          {tiktok ? <option value="cost_cap">{i18nT("cost_cap_cout_cible_par_resultat_3f8ca011")}</option> : <option value="max_bid">{i18nT("plafond_d_enchere_a_definir_6ca56322")}</option>}
          {incompatible && <option value={settings.bidding.strategy} disabled>{i18nT("ancien_choix_a_remplacer_pour_ce_b642b013")}</option>}
        </select>
      </label>
      {manual && <label className={styles.field}>{tiktok ? costCapLabels[optimizationIntent || ""] || i18nT("cout_cible_par_resultat_649d6b45") : i18nT("plafond_d_enchere_prevu_c3792aeb")}
        <input type="number" min="0.01" max={Number.isFinite(budgetEuros) && budgetEuros > 0 ? budgetEuros : undefined} step="0.01" required value={settings.bidding.amountEuros ?? ""} onChange={(event) => onChange({ bidding: { ...settings.bidding, amountEuros: optionalNumber(event.target.value) } })} />
        <small>{i18nT("le_type_d_enchere_et_son_228b13c1", { value0: channelLabel(channel) })}</small>
      </label>}
    </div>
    {incompatible && <p role="alert">{i18nT("choisissez_une_strategie_d_encheres_adaptee_4a1e77ad")}</p>}
    {tiktok && settings.bidding.strategy === "cost_cap" && <p>{i18nT("cost_cap_prepare_un_cout_cible_c0b6442d")}</p>}
    <p>{i18nT("strategie_preparee_dans_inrcy_sans_transmission_4b94d606")}</p>
    {channel === "tiktok" ? <p>{i18nT("le_budget_est_prepare_au_niveau_9e45ceda")}</p> : <p>{i18nT("inrcy_prepare_ici_un_choix_de_039d526c")}</p>}
  </fieldset>;
}

export function PreparedAdsEffectiveSummary({ draft, timeZone, identityMessage }: { draft: PreparedDraft; timeZone: string | null; identityMessage?: string }) {
  const locale = useLocale();
  const i18nT = useTranslations("booster");
  const { objectiveLabels, optimizationLabels, audienceLabels, conversionLabels, destinationLabels, formatLabels } = useMemo(() => ({ objectiveLabels: translateAdsUiChoices(RAW_objectiveLabels, i18nT), optimizationLabels: translateAdsUiChoices(RAW_optimizationLabels, i18nT), audienceLabels: translateAdsUiChoices(RAW_audienceLabels, i18nT), conversionLabels: translateAdsUiChoices(RAW_conversionLabels, i18nT), destinationLabels: translateAdsUiChoices(RAW_destinationLabels, i18nT), formatLabels: translateAdsUiChoices(RAW_formatLabels, i18nT) }), [i18nT]);
  const errorMessage = useAdsErrorMessage();
  const [reviewedAt] = useState(() => Date.now());
  const settings = draft.preparedDeliverySettings || defaultPreparedDeliverySettings();
  const zone = preparedAdsTimeZone(timeZone) || i18nT("europe_paris_f84bc266");
  const channel = draft.channelSettings?.channel === "tiktok" || draft.channelSettings?.channel === "x" ? draft.channelSettings : null;
  let calendarError = "";
  try { plannedNativeCalendar(draft, reviewedAt, zone); } catch (error) { calendarError = errorMessage(error, "shell.ads_error_f0cd58de99"); }
  const prettyDate = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : i18nT("a_renseigner_e3d2f20f");
  const objective = channel?.channel === "tiktok" ? channel.objectiveType : channel?.channel === "x" ? channel.objective : "";
  const destination = channel?.channel === "tiktok" && channel.destinationKind !== "website"
    ? channel.destinationKind === "profile" ? i18nT("profil_tiktok_77aac6e1") : i18nT("formulaire_integre_tiktok_f1a247ba")
    : draft.destinationUrl || i18nT("a_renseigner_e3d2f20f");
  const rows = [
    [i18nT("statut_659499f3"), i18nT("brouillon_prepare_reglages_non_transmis_e71d0db3")],
    [i18nT("compte_et_identite_ddd1d0c9"), identityMessage || i18nT("a_verifier_dans_le_compte_publicitaire_0b328d29")],
    [i18nT("objectif_47d1c260"), objectiveLabels[objective] || i18nT("a_preciser_f65d0dc7")],
    [i18nT("resultat_optimise_prevu_d83809a4"), channel?.channel === "tiktok" ? optimizationLabels[channel.optimizationIntent] : objectiveLabels[objective] || i18nT("a_preciser_f65d0dc7")],
    [i18nT("format_041a5dec"), formatLabels[channel?.format || ""] || i18nT("a_preciser_f65d0dc7")],
    [i18nT("zones_geographiques_febaa8a7"), draft.targetLocations.join(" ; ") || i18nT("a_renseigner_e3d2f20f")],
    [i18nT("langues_e90c7e3c"), draft.languages.join(" ; ") || i18nT("a_renseigner_e3d2f20f")],
    [i18nT("audience_51d99345"), audienceLabels[channel?.targetingMode || ""] || i18nT("a_preciser_f65d0dc7")],
    [i18nT("brief_d_audience_c7cd77f6"), draft.targetAudiences.join(" ; ") || i18nT("aucun_brief_ajoute_caddbfc7")],
    [i18nT("emplacements_prevus_57ed0e72"), channel?.channel === "tiktok" ? channel.placementIntent === "automatic" ? i18nT("automatiques_a_confirmer_dans_tiktok_43a094fe") : i18nT("tiktok_uniquement_2f12d7e1") : i18nT("a_confirmer_dans_x_21ec1ea4")],
    [i18nT("encheres_913a3aa8"), settings.bidding.strategy === "automatic" ? channel?.channel === "tiktok" ? i18nT("maximum_delivery_maximiser_les_resultats_eaab8af8") : i18nT("automatiques_a_confirmer_054e8aa7") : `${settings.bidding.strategy === "cost_cap" ? i18nT("cost_cap_cout_cible_par_resultat_3f8ca011") : i18nT("plafond_prevu_213d63c9")} : ${settings.bidding.amountEuros === null ? i18nT("a_renseigner_fcd86e53") : money(settings.bidding.amountEuros, locale)}`],
    [channel?.channel === "tiktok" ? i18nT("budget_du_groupe_d_annonces_2c44aa0e") : i18nT("budget_prevu_6b763bf7"), preparedAdsBudgetLabel(draft, i18nT, locale)],
    [i18nT("debut_f0955314"), settings.budget.startAt ? prettyDate(settings.budget.startAt) : i18nT("debut_immediat_prevu_89f6befb")],
    [i18nT("fin_4251065f"), prettyDate(settings.budget.endAt || preparedAdsLegacyEndInstant(draft.endDate))],
    [i18nT("heures_du_calendrier_4bf0190a"), zone],
    [i18nT("destination_prevue_4c89f38a"), destinationLabels[channel?.channel === "tiktok" ? channel.destinationKind : draft.conversionLocation] || i18nT("a_preciser_f65d0dc7")],
    [i18nT("lien_e2639e1d"), destination],
    [i18nT("suivi_29293f77"), draft.trackingParameters || i18nT("aucun_parametre_ajoute_21d9cb77")],
    [i18nT("objectif_de_conversion_du_brief_80f97757"), conversionLabels[draft.conversionGoal] || i18nT("a_preciser_f65d0dc7")],
    [i18nT("evenement_de_conversion_natif_265d08cd"), i18nT("aucun_evenement_natif_associe_a_verifier_ea1baab9")],
    [i18nT("media_d8a313d3"), draft.creativeUrl || draft.imageUrl || (channel?.format === "text" ? i18nT("annonce_textuelle_36a22442") : i18nT("a_joindre_9d1a48f5"))],
  ];
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("reglages_value_prepares_42b0e927", { value0: channelLabel(draft.provider) })}</legend>
    <dl className={styles.studioReviewGrid}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {calendarError && <p role="alert">{calendarError}</p>}
    <p>{i18nT("le_brouillon_conserve_votre_intention_les_51c66404")}</p>
  </fieldset>;
}
