"use client";

import { useLocale, useTranslations } from "next-intl";
import { adsUiText, type AdsUiTranslator } from "./adsUiCopy";

import { useState } from "react";
import type { AdsCampaignInput } from "@/lib/adsValidation";
import { defaultMetaDeliverySettings, metaAdsDisplayCalendar, META_CALL_TO_ACTION_LABELS, type MetaDeliverySettings } from "@/lib/adsMetaCampaignSettings";
import type { MetaAdsResources } from "@/lib/adsMetaResources";
import styles from "./ads.module.css";

type Props = { settings: MetaDeliverySettings; onChange: (patch: Partial<MetaDeliverySettings>) => void };
const money = (value: number, locale = "fr-FR") => value.toLocaleString(locale, { style: "currency", currency: "EUR" });
const numberOrNull = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
function localDate(value: string | null, zone: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23" }).formatToParts(new Date(value));
  const part=(name:string)=>parts.find((entry)=>entry.type===name)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
function instant(value: string, zone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const wall=Date.parse(value+":00Z");
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0,16)!==value) return null;
  const wallAt=(time:number)=>Date.parse(localDate(new Date(time).toISOString(),zone)+":00Z");
  let time=wall;
  for(let index=0;index<4;index++) time+=wall-wallAt(time);
  if(wallAt(time)!==wall || [-7200000,-3600000,3600000,7200000].some((shift)=>wallAt(time+shift)===wall)) return null;
  return new Date(time).toISOString();
}
function calendarZone(value:string|null){try{if(value){new Intl.DateTimeFormat("fr-FR",{timeZone:value}).format();return value;}}catch{}return "Europe/Paris";}
export function metaAdsBudgetLabel(draft:AdsCampaignInput, i18nT?: AdsUiTranslator, locale = "fr-FR") {
  const settings=draft.metaDeliverySettings || defaultMetaDeliverySettings();
  return settings.budget.type === "total" ? settings.budget.totalEuros === null ? adsUiText(i18nT, "Budget total à renseigner") : adsUiText(i18nT, "{value0} au total", { value0: money(settings.budget.totalEuros, locale) }) : adsUiText(i18nT, "{value0} par jour en moyenne", { value0: money(draft.dailyBudgetEuros, locale) });
}
/** Saved deadlines remain readable; display labels never grant permission to publish an expired campaign. */
export function metaAdsCalendarLabels(draft: Pick<AdsCampaignInput, "endDate" | "metaDeliverySettings">, timeZone: string | null, i18nT?: AdsUiTranslator, locale = "fr-FR"): { start: string; end: string } {
  const calendar = metaAdsDisplayCalendar(draft);
  const zone = calendarZone(timeZone);
  const format = (value: string) => new Date(value).toLocaleString(locale, { timeZone: zone });
  return {
    start: calendar.startInvalid ? adsUiText(i18nT, "Date à corriger") : calendar.startAt ? format(calendar.startAt) : adsUiText(i18nT, "Dès la validation de Meta"),
    end: calendar.endInvalid ? adsUiText(i18nT, "Date à corriger") : calendar.endAt ? format(calendar.endAt) : adsUiText(i18nT, "Fin à préciser"),
  };
}
export function MetaAdsBudget({settings,dailyBudget,endDate,timeZone,onChange,onDailyChange,onEndDateChange}:Props & {dailyBudget:number;endDate:string;timeZone:string|null;onDailyChange:(value:number)=>void;onEndDateChange:(value:string)=>void}) {
  const i18nT = useTranslations("booster");
  const zone=calendarZone(timeZone);
  const [error,setError]=useState("");
  const total=settings.budget.type==="total";
  const end=metaAdsDisplayCalendar({metaDeliverySettings:settings,endDate}).endAt;
  const changeDate=(key:"startAt"|"endAt",value:string)=>{
    const date=value?instant(value,zone):null;
    if(value&&!date){setError(i18nT("cette_date_ou_cette_heure_n_e5ca1ca5"));return;}
    setError("");onChange({budget:{...settings.budget,[key]:date}});
    if(key==="endAt")onEndDateChange(value.slice(0,10));
  };
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("budget_et_calendrier_meta_56f12ad1")}</legend><div className={styles.studioGrid}>
    <label className={styles.field}>{i18nT("type_de_budget_7e3d4089")}<select value={settings.budget.type} onChange={(event)=>onChange({budget:{...settings.budget,type:event.target.value as "daily"|"total",totalEuros:event.target.value==="total"?settings.budget.totalEuros:null}})}><option value="daily">{i18nT("budget_quotidien_moyen_0c02d0b4")}</option><option value="total">{i18nT("budget_total_sur_la_periode_b17241cc")}</option></select></label>
    {total?<label className={styles.field}>{i18nT("budget_total_97aca19f")}<input type="number" min="5" max="45000" step="0.01" value={settings.budget.totalEuros??""} onChange={(event)=>onChange({budget:{...settings.budget,totalEuros:numberOrNull(event.target.value)}})}/><small>{i18nT("une_seule_enveloppe_pour_toute_la_6a891135")}</small></label>:<label className={styles.field}>{i18nT("budget_quotidien_moyen_8d3aa62f")}<input type="number" min="5" max="500" step="0.01" value={dailyBudget} onChange={(event)=>onDailyChange(Number(event.target.value))}/><small>{i18nT("la_depense_peut_varier_selon_les_4fd9bbfa")}</small></label>}
    <label className={styles.field}>{i18nT("debut_de_diffusion_0508eb90")}<select value={settings.budget.startAt?"scheduled":"now"} onChange={(event)=>onChange({budget:{...settings.budget,startAt:event.target.value==="scheduled"?new Date(Date.now()+86400000).toISOString():null}})}><option value="now">{i18nT("des_la_validation_de_meta_ffea29fc")}</option><option value="scheduled">{i18nT("choisir_une_date_et_une_heure_f4ff52cf")}</option></select>{settings.budget.startAt&&<input type="datetime-local" aria-label={i18nT("date_et_heure_de_debut_meta_07cbeab2")} value={localDate(settings.budget.startAt,zone)} onChange={(event)=>changeDate("startAt",event.target.value)}/>}</label>
    <label className={styles.field}>{i18nT("date_et_heure_de_fin_meta_a9a3defa")}<input type="datetime-local" value={localDate(end,zone)} onChange={(event)=>changeDate("endAt",event.target.value)}/><small>{i18nT("une_fin_apres_le_debut_dans_ce74bf56")}</small></label>
  </div><p>{i18nT("heures_du_calendrier_value_le_budget_86089b4d", { value0: zone })}</p>{!timeZone&&<small>{i18nT("calendrier_affiche_dans_le_fuseau_europe_f1e016e3")}</small>}{error&&<p role="alert">{error}</p>}</fieldset>;
}
export function MetaAdsBidding({settings,budgetEuros,onChange}:Props&{budgetEuros:number}){
  const i18nT = useTranslations("booster");
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("resultat_et_encheres_meta_fc234737")}</legend><div className={styles.studioGrid}><label className={styles.field}>{i18nT("resultat_optimise_71db0f48")}<input readOnly value={i18nT("ads_ui_bdbecfac94")}/><small>{i18nT("un_clic_ne_garantit_pas_une_7bc56443")}</small></label><label className={styles.field}>{i18nT("strategie_d_encheres_d2f40380")}<select value={settings.bidding.strategy} onChange={(event)=>onChange({bidding:{strategy:event.target.value as "maximum_delivery"|"bid_cap",amountEuros:event.target.value==="bid_cap"?settings.bidding.amountEuros??1:null}})}><option value="maximum_delivery">{i18nT("volume_maximal_encheres_automatiques_7e9d2f7b")}</option><option value="bid_cap">{i18nT("plafond_d_enchere_personnalise_92e6418b")}</option></select></label>{settings.bidding.strategy==="bid_cap"&&<label className={styles.field}>{i18nT("plafond_d_enchere_6d2bd9ae")}<input type="number" min="0.01" max={budgetEuros} step="0.01" value={settings.bidding.amountEuros??""} onChange={(event)=>onChange({bidding:{...settings.bidding,amountEuros:numberOrNull(event.target.value)}})}/><small>{i18nT("limite_d_enchere_sans_garantie_du_d6b02342")}</small></label>}</div><p>{i18nT("aucun_pixel_ni_evenement_de_conversion_7fca350f")}</p></fieldset>;
}
export function MetaAdsAudience({settings,languages,locales,onLanguagesChange,onChange}:Props&{languages:string[];locales:readonly{id:string;name:string}[];onLanguagesChange:(value:string[])=>void}){
  const i18nT = useTranslations("booster");
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("personnes_ciblees_452b879d")}</legend><div className={styles.studioGrid}><label className={styles.field}>{i18nT("age_minimum_7c66d3c7")}<input type="number" min="18" max="65" value={settings.audience.ageMin} onChange={(event)=>onChange({audience:{...settings.audience,ageMin:Number(event.target.value)}})}/></label><label className={styles.field}>{i18nT("age_maximum_42e4050a")}<select value={settings.audience.ageMax??"all"} onChange={(event)=>onChange({audience:{...settings.audience,ageMax:event.target.value==="all"?null:Number(event.target.value)}})}><option value="all">{i18nT("sans_limite_superieure_80828d5a")}</option>{Array.from({length:48},(_,index)=>index+18).map((age)=><option key={age} value={age}>{age===65?i18nT("65_ans_et_plus_1ab8d283"):i18nT("ads_ui_a1b9c0a393", { value0: age })}</option>)}</select></label><label className={styles.field}>{i18nT("langue_des_personnes_0fc7f346")}<select value={languages.length===1?languages[0]:""} onChange={(event)=>onLanguagesChange(event.target.value?[event.target.value]:[])}><option value="">{i18nT("toutes_les_langues_18c88470")}</option>{languages.filter((value)=>!locales.some((item)=>item.id===value)).map((value)=><option key={value} value={value}>{i18nT("value_a_verifier_3fab0b33", { value0: value })}</option>)}{locales.map((locale)=><option key={locale.id} value={locale.id}>{locale.name}</option>)}</select><small>{i18nT("seules_les_langues_du_catalogue_meta_84f788b3")}</small></label></div><p>{i18nT("meta_recherche_les_personnes_susceptibles_de_523a2121")}</p></fieldset>;
}
export function MetaAdsEffectiveSummary({draft,resources}: {draft:AdsCampaignInput;resources:MetaAdsResources|null}){
  const locale = useLocale();
  const i18nT = useTranslations("booster");
  const settings=draft.metaDeliverySettings||defaultMetaDeliverySettings();
  const zone=calendarZone(resources?.account.timezone||null);
  const labels:Record<string,string>={facebook_feed:i18nT("fil_facebook_cf9b6c5a"),instagram_feed:i18nT("fil_instagram_ee06d355"),stories:i18nT("stories_facebook_et_instagram_914b0e8e"),reels:i18nT("reels_facebook_et_instagram_e3fe5e98"),messenger:i18nT("messenger_brouillon_886c91b0")};
  const calendar=metaAdsCalendarLabels(draft,zone, i18nT, locale);
  return <div className={`${styles.studioControlPanel} ${styles.studioWide}`} data-meta-effective-summary="true"><strong>{i18nT("reglages_qui_seront_transmis_a_meta_6a1f373f")}</strong><p>{i18nT("objectif_trafic_optimisation_clics_sur_le_ceba9326")}</p><p>{i18nT("identite_f31b53d0")}{" "}{resources?.pages.find((page)=>page.id===resources.selectedPageId)?.name||i18nT("page_a_verifier_97f4ed6f")}</p><p>{i18nT("zones_5ddcc9fd")}{" "}{draft.metaDeliverySettings ? (draft.metaGeoTargets||[]).map((target)=>target.name).join(" · ")||i18nT("a_verifier_8f5f7255") : i18nT("value_france_parcours_historique_f40df0e4", { value0: draft.targetLocations.join(" · ")||i18nT("a_verifier_8f5f7255") })}</p><p>{i18nT("audience_9168f5ec")}{" "}{settings.audience.ageMin} {" "}{i18nT("ans_minimum_2c4c478b")}{settings.audience.ageMax?` → ${settings.audience.ageMax===65?i18nT("65_ans_et_plus_1ab8d283"):settings.audience.ageMax+i18nT("ads_ui_1c2878cebf")}`:i18nT("sans_limite_superieure_d89ebf75")} {" "}{i18nT("langues_a1a2ac98")}{" "}{draft.metaDeliverySettings ? draft.languages.map((id)=>resources?.locales.find((item)=>item.id===id)?.name||id).join(" · ")||i18nT("toutes_c5f641e4") : i18nT("sans_filtre_les_langues_du_brief_1c260102")}</p><p>{i18nT("emplacements_value_c5413642", { value0: draft.metaPlacements.map((placement)=>labels[placement]||placement).join(" · ") })}</p><p>{i18nT("budget_value_debut_value_fin_value_6559f277", { value0: metaAdsBudgetLabel(draft, i18nT, locale), value1: calendar.start, value2: calendar.end, value3: zone })}</p><p>{i18nT("encheres_39a7aac3")}{" "}{settings.bidding.strategy==="maximum_delivery"?i18nT("volume_maximal_99b09015"):i18nT("plafond_value_6e057b53", { value0: money(settings.bidding.amountEuros||0, locale) })} {" "}{i18nT("bouton_3a98bc22")}{" "}{adsUiText(i18nT, META_CALL_TO_ACTION_LABELS[settings.callToAction])} {" "}{i18nT("mesure_clics_sur_le_lien_34f00a7b")}</p></div>;
}
