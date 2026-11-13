"use client";

import { useLocale, useTranslations } from "next-intl";
import { adsUiText, type AdsUiTranslator } from "./adsUiCopy";


import { useState } from "react";
import { defaultOpenaiDeliverySettings, openaiAdsCalendarInstant, openaiAdsLegacyEndTime, openaiAdsLocalDateTime, openaiAdsTimeZone } from "@/lib/adsOpenaiCampaignSettings";
import type { OpenaiDeliverySettings, OpenaiNativeDraft } from "@/lib/adsOpenaiCampaignSettings";
import type { OpenaiAdsResources } from "@/lib/adsOpenaiResources";
import type { AdsCampaignInput } from "@/lib/adsValidation";
import styles from "./ads.module.css";

type SettingsProps = { settings: OpenaiDeliverySettings; onChange: (patch: Partial<OpenaiDeliverySettings>) => void };
type NativeDraft = AdsCampaignInput & { openaiDeliverySettings?: OpenaiDeliverySettings };
const euros = (amount: number | null | undefined, locale = "fr-FR", i18nT?: AdsUiTranslator) => amount == null || !Number.isFinite(amount) ? adsUiText(i18nT, "À préciser") : new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(amount);
const number = (value: string) => value === "" ? null : Number(value);
function endInstant(endAt: string | null, endDate: string, timeZone: string) {
  if (endAt) return endAt;
  try { return new Date(openaiAdsLegacyEndTime(endDate, timeZone) * 1000).toISOString(); } catch { return null; }
}
export function openaiAdsBudgetLabel(draft: OpenaiNativeDraft, i18nT?: AdsUiTranslator, locale = "fr-FR") {
  return draft.openaiDeliverySettings?.budget.type === "total" ? adsUiText(i18nT, "{value0} au total", { value0: euros(draft.openaiDeliverySettings.budget.totalEuros, locale, i18nT) }) : adsUiText(i18nT, "{value0} par jour", { value0: euros(draft.dailyBudgetEuros, locale, i18nT) });
}
export function ChatGPTAdsBudget({ settings, dailyBudget, endDate, timeZone, onChange, onDailyChange, onEndDateChange }: SettingsProps & {
  dailyBudget: number; endDate: string; timeZone: string | null; onDailyChange: (value: number) => void; onEndDateChange: (value: string) => void;
}) {
  const i18nT = useTranslations("booster");
  const [calendarError, setCalendarError] = useState("");
  const calendarTimeZone = openaiAdsTimeZone(timeZone) || "UTC";
  const start = settings.budget.startAt;
  const end = endInstant(settings.budget.endAt, endDate, calendarTimeZone);
  const total = settings.budget.type === "total";
  const now = new Date();
  const maximum = new Date(now.getTime() + 90 * 86400000).toISOString();
  const changeDate = (key: "startAt" | "endAt", value: string) => {
    const instant = openaiAdsCalendarInstant(value, calendarTimeZone);
    if (!instant) { setCalendarError(i18nT("cette_date_ou_heure_est_invalide_6ad0c7eb")); return; }
    setCalendarError("");
    onChange({ budget: { ...settings.budget, [key]: instant } });
    if (key === "endAt") onEndDateChange(instant.slice(0, 10));
  };
  const wrongOrder = Boolean(start && end && Date.parse(end) <= Date.parse(start));
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>{i18nT("budget_et_calendrier_chatgpt_ads_4bee2e0b")}</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>{i18nT("type_de_budget_7e3d4089")}{" "}<select value={settings.budget.type} onChange={(event) => onChange({ budget: { ...settings.budget, type: event.target.value as "daily" | "total", totalEuros: event.target.value === "total" ? settings.budget.totalEuros : null } })}>
          <option value="total">{i18nT("budget_total_de_la_campagne_a32e671e")}</option><option value="daily">{i18nT("budget_quotidien_c56e4bf1")}</option>
        </select>
      </label>
      {total ? <label className={styles.field}>{i18nT("budget_total_97aca19f")}<input type="number" min="5" max="45000" step="0.01" required value={settings.budget.totalEuros ?? ""} onChange={(event) => onChange({ budget: { ...settings.budget, totalEuros: number(event.target.value) } })} /><small>{i18nT("une_seule_enveloppe_pour_la_campagne_31f55b63")}</small></label>
        : <label className={styles.field}>{i18nT("budget_quotidien_02a0766e")}<input type="number" min="15" max="500" step="0.01" required value={Number.isFinite(dailyBudget) ? dailyBudget : ""} onChange={(event) => onDailyChange(Number(event.target.value))} /><small>{i18nT("de_15_a_500_par_jour_68fe2ac2")}</small></label>}
      <label className={styles.field}>{i18nT("debut_de_diffusion_0508eb90")}{" "}<select value={start ? "scheduled" : "now"} onChange={(event) => { setCalendarError(""); onChange({ budget: { ...settings.budget, startAt: event.target.value === "scheduled" ? new Date(Date.now() + 86400000).toISOString() : null } }); }}>
          <option value="now">{i18nT("des_la_validation_de_chatgpt_ads_e2813a47")}</option><option value="scheduled">{i18nT("choisir_une_date_et_une_heure_f4ff52cf")}</option>
        </select>
        {start && <input aria-label={i18nT("date_et_heure_de_debut_chatgpt_c6598931")} type="datetime-local" required value={openaiAdsLocalDateTime(start, calendarTimeZone)} min={openaiAdsLocalDateTime(now.toISOString(), calendarTimeZone)} max={openaiAdsLocalDateTime(maximum, calendarTimeZone)} onChange={(event) => changeDate("startAt", event.target.value)} />}
      </label>
      <label className={styles.field}>{i18nT("date_et_heure_de_fin_chatgpt_2be5a704")}{" "}<input type="datetime-local" required value={openaiAdsLocalDateTime(end, calendarTimeZone)} min={openaiAdsLocalDateTime(start || now.toISOString(), calendarTimeZone)} max={openaiAdsLocalDateTime(maximum, calendarTimeZone)} aria-invalid={wrongOrder || Boolean(calendarError)} onChange={(event) => changeDate("endAt", event.target.value)} />
        <small>{i18nT("une_fin_apres_le_debut_dans_ce74bf56")}</small>
      </label>
    </div>
    <p>{i18nT("heures_du_calendrier_e884a8ba")}{" "}{calendarTimeZone}.{!openaiAdsTimeZone(timeZone) ? i18nT("le_fuseau_du_compte_n_a_78b119f1") : ""}</p>
    {calendarError && <p role="alert">{calendarError}</p>}{wrongOrder && <p role="alert">{i18nT("la_fin_de_diffusion_doit_etre_334a69a7")}</p>}
    <p>{total ? i18nT("cette_enveloppe_est_le_plafond_publicitaire_3a82d698") : i18nT("le_budget_quotidien_n_est_pas_f858f829")}</p>
  </fieldset>;
}
export function ChatGPTAdsBidding({ bidEuros, budgetEuros, onBidChange }: { bidEuros: number | null | undefined; budgetEuros: number; onBidChange: (value: number | undefined) => void }) {
  const i18nT = useTranslations("booster");
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("encheres_chatgpt_ads_a8e22768")}</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>{i18nT("strategie_d_encheres_d2f40380")}<input value={i18nT("ads_ui_7d31607eb6")} readOnly /><small>{i18nT("cette_carte_optimise_les_clics_vers_a43873d0")}</small></label>
      <label className={styles.field}>{i18nT("cpc_maximal_0f0a3ca3")}<input type="number" min="0.01" max={budgetEuros > 0 ? budgetEuros : undefined} step="0.01" required value={bidEuros ?? ""} onChange={(event) => onBidChange(event.target.value === "" ? undefined : Number(event.target.value))} /><small>{i18nT("l_enchere_ne_doit_pas_depasser_e499caed")}</small></label>
    </div>
  </fieldset>;
}
export function ChatGPTAdsDistribution({ settings, onChange }: SettingsProps) {
  const i18nT = useTranslations("booster");
  const platforms = settings.platforms;
  const value = platforms.length === 0 ? "all" : platforms.length === 1 ? platforms[0] : platforms.length === 2 && platforms.includes("ios_app") && platforms.includes("android_app") ? "apps" : "custom";
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("plateformes_chatgpt_332494a8")}</legend>
    <label className={styles.field}>{i18nT("ou_montrer_la_carte_b9388dba")}{" "}<select value={value} onChange={(event) => onChange({ platforms: event.target.value === "all" ? [] : event.target.value === "apps" ? ["ios_app", "android_app"] : [event.target.value as OpenaiDeliverySettings["platforms"][number]] })}>
        <option value="all">{i18nT("toutes_les_plateformes_disponibles_737d59b6")}</option><option value="web">{i18nT("web_ordinateur_et_navigateurs_mobiles_a92dd9bc")}</option><option value="apps">{i18nT("applications_ios_et_android_f4a9d697")}</option><option value="ios_app">{i18nT("application_ios_89fffee5")}</option><option value="android_app">{i18nT("application_android_7d20f13f")}</option><option value="desktop_web">{i18nT("web_sur_ordinateur_5df91d9b")}</option><option value="ios_web">{i18nT("web_sur_ios_8ac26c98")}</option><option value="android_web">{i18nT("web_sur_android_4e175ff1")}</option>{value === "custom" && <option value="custom" disabled>{i18nT("selection_personnalisee_conservee_6be97467")}</option>}
      </select>
    </label>
    <p>{i18nT("ces_plateformes_constituent_un_filtre_de_1c0e5bba")}</p>
  </fieldset>;
}
export function ChatGPTAdsGeography({ resources, loading, error, query, onQueryChange, onSearch, locations, onLocationsChange }: {
  resources: OpenaiAdsResources | null; loading: boolean; error: string; query: string; onQueryChange: (value: string) => void;
  onSearch: () => void; locations: string[]; onLocationsChange: (value: string[]) => void;
}) {
  const i18nT = useTranslations("booster");
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("zones_geographiques_chatgpt_ads_8a6d58ca")}</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>{i18nT("rechercher_une_ville_ou_une_region_0c88291b")}{" "}<input value={query} minLength={2} maxLength={120} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!loading && query.trim().length >= 2) onSearch(); } }} placeholder={i18nT("ex_lille_ou_hauts_de_france_8256062d")} />
      </label>
      <div className={styles.field}><span>{i18nT("catalogue_du_compte_publicitaire_44b2f55b")}</span><button type="button" onClick={onSearch} disabled={loading || query.trim().length < 2}>{loading ? i18nT("recherche_en_cours_a16747f0") : i18nT("rechercher_dans_chatgpt_ads_8b9e820d")}</button></div>
      {!!resources?.geographyOptions.length && <label className={`${styles.field} ${styles.studioWide}`}>{i18nT("choisir_un_lieu_disponible_3b2f2dc3")}{" "}<select value="" disabled={loading || locations.length >= 20} onChange={(event) => { const option = resources.geographyOptions.find((item) => item.id === event.target.value); if (option && !locations.includes(option.canonicalName)) onLocationsChange([...locations, option.canonicalName]); }}>
          <option value="">{i18nT("selectionner_un_resultat_0a5809c0")}</option>{resources.geographyOptions.map((item) => <option key={item.id} value={item.id} disabled={locations.includes(item.canonicalName)}>{item.canonicalName}</option>)}
        </select>
      </label>}
    </div>
    {error && <p role="alert">{error}</p>}
    {resources && !loading && query.trim().length >= 2 && !resources.geographyOptions.length && !error && <p>{i18nT("aucun_lieu_disponible_dans_les_resultats_8f41641c")}</p>}
    {locations.length ? <ul>{locations.map((location, index) => <li key={`${location}-${index}`}>{location} <button type="button" aria-label={i18nT("retirer_value_c04cdfcb", { value0: location })} onClick={() => onLocationsChange(locations.filter((_, current) => current !== index))}>{i18nT("retirer_54ec24a1")}</button></li>)}</ul> : <p>{i18nT("choisissez_au_moins_une_zone_le_6c447379")}</p>}
    <p>{i18nT("ce_parcours_conserve_le_ciblage_local_6e327f5a")}</p>
  </fieldset>;
}
const platformName: Record<string, string> = { web: "Web (ordinateur et mobile)", ios_app: "Application iOS", android_app: "Application Android", desktop_web: "Web sur ordinateur", ios_web: "Web sur iOS", android_web: "Web sur Android" };
export function ChatGPTAdsEffectiveSummary({ draft, resources }: { draft: NativeDraft; resources: OpenaiAdsResources | null }) {
  const locale = useLocale();
  const i18nT = useTranslations("booster");
  const settings = draft.openaiDeliverySettings || defaultOpenaiDeliverySettings();
  const zone = openaiAdsTimeZone(resources?.account.timezone) || "UTC";
  const end = endInstant(settings.budget.endAt, draft.endDate, zone);
  const date = (instant: string | null) => instant && Number.isFinite(Date.parse(instant)) ? new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(Date.parse(instant)) : i18nT("a_preciser_f65d0dc7");
  const rows = [
    [i18nT("compte_annonceur_87bebaad"), resources?.account.name || i18nT("a_verifier_8f5f7255")],
    [i18nT("objectif_47d1c260"), i18nT("clics_vers_votre_site_95f7c79a")], [i18nT("format_041a5dec"), i18nT("carte_chatgpt_image_carree_7c54b6e5")],
    [i18nT("budget_de_campagne_fa6e2318"), openaiAdsBudgetLabel(draft, i18nT, locale)], [i18nT("debut_f0955314"), settings.budget.startAt ? date(settings.budget.startAt) : i18nT("des_validation_de_chatgpt_ads_b4454dc9")], [i18nT("fin_4251065f"), date(end)],
    [i18nT("heures_du_calendrier_4bf0190a"), `${zone}${openaiAdsTimeZone(resources?.account.timezone) ? "" : i18nT("fuseau_du_compte_a_verifier_042e4cb1")}`],
    [i18nT("zones_geographiques_febaa8a7"), draft.targetLocations.join(" · ") || i18nT("a_preciser_f65d0dc7")],
    [i18nT("plateformes_692c1f85"), settings.platforms.length ? settings.platforms.map((p) => platformName[p] || p).join(" · ") : i18nT("toutes_les_plateformes_disponibles_737d59b6")],
    [i18nT("encheres_913a3aa8"), i18nT("fixe_par_clic_cpc_maximal_value_7c0a7c34", { value0: euros(draft.openaiBidEuros, locale, i18nT) })],
    [i18nT("contexte_de_l_annonce_c3ee7c5e"), draft.offer || i18nT("aucune_indication_supplementaire_e36edfce")],
    [i18nT("destination_d4271349"), draft.destinationUrl || i18nT("a_preciser_f65d0dc7")], [i18nT("parametres_de_suivi_90a56411"), draft.openaiDeliverySettings ? draft.trackingParameters || i18nT("aucun_b2ed82f1") : i18nT("non_transmis_par_le_parcours_historique_f0c96a81")],
    [i18nT("conversions_pour_les_encheres_9bec8b02"), i18nT("aucun_evenement_selectionne_objectif_clics_d89bafb1")],
  ];
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("reglages_de_diffusion_chatgpt_ads_9646cace")}</legend>
    <dl className={styles.studioReviewGrid}>{rows.map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}</dl>
    <p>{i18nT("la_carte_et_le_compte_doivent_1388fe92")}</p>
  </fieldset>;
}
