"use client";
import { useState } from "react";
import type { AdsCampaignInput } from "@/lib/adsValidation";
import { defaultMetaDeliverySettings, metaAdsDisplayCalendar, META_CALL_TO_ACTION_LABELS, type MetaDeliverySettings } from "@/lib/adsMetaCampaignSettings";
import type { MetaAdsResources } from "@/lib/adsMetaResources";
import styles from "./ads.module.css";

type Props = { settings: MetaDeliverySettings; onChange: (patch: Partial<MetaDeliverySettings>) => void };
const money = (value: number) => value.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
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
export function metaAdsBudgetLabel(draft:AdsCampaignInput) {
  const settings=draft.metaDeliverySettings || defaultMetaDeliverySettings();
  return settings.budget.type === "total" ? settings.budget.totalEuros === null ? "Budget total à renseigner" : `${money(settings.budget.totalEuros)} au total` : `${money(draft.dailyBudgetEuros)} par jour en moyenne`;
}
/** Saved deadlines remain readable; display labels never grant permission to publish an expired campaign. */
export function metaAdsCalendarLabels(draft: Pick<AdsCampaignInput, "endDate" | "metaDeliverySettings">, timeZone: string | null): { start: string; end: string } {
  const calendar = metaAdsDisplayCalendar(draft);
  const zone = calendarZone(timeZone);
  const format = (value: string) => new Date(value).toLocaleString("fr-FR", { timeZone: zone });
  return {
    start: calendar.startInvalid ? "Date à corriger" : calendar.startAt ? format(calendar.startAt) : "Dès la validation de Meta",
    end: calendar.endInvalid ? "Date à corriger" : calendar.endAt ? format(calendar.endAt) : "Fin à préciser",
  };
}
export function MetaAdsBudget({settings,dailyBudget,endDate,timeZone,onChange,onDailyChange,onEndDateChange}:Props & {dailyBudget:number;endDate:string;timeZone:string|null;onDailyChange:(value:number)=>void;onEndDateChange:(value:string)=>void}) {
  const zone=calendarZone(timeZone);
  const [error,setError]=useState("");
  const total=settings.budget.type==="total";
  const end=metaAdsDisplayCalendar({metaDeliverySettings:settings,endDate}).endAt;
  const changeDate=(key:"startAt"|"endAt",value:string)=>{
    const date=value?instant(value,zone):null;
    if(value&&!date){setError("Cette date ou cette heure n’est pas valide. Choisissez une autre heure.");return;}
    setError("");onChange({budget:{...settings.budget,[key]:date}});
    if(key==="endAt")onEndDateChange(value.slice(0,10));
  };
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Budget et calendrier Meta</legend><div className={styles.studioGrid}>
    <label className={styles.field}>Type de budget<select value={settings.budget.type} onChange={(event)=>onChange({budget:{...settings.budget,type:event.target.value as "daily"|"total",totalEuros:event.target.value==="total"?settings.budget.totalEuros:null}})}><option value="daily">Budget quotidien moyen</option><option value="total">Budget total sur la période</option></select></label>
    {total?<label className={styles.field}>Budget total (€)<input type="number" min="5" max="45000" step="0.01" value={settings.budget.totalEuros??""} onChange={(event)=>onChange({budget:{...settings.budget,totalEuros:numberOrNull(event.target.value)}})}/><small>Une seule enveloppe pour toute la période.</small></label>:<label className={styles.field}>Budget quotidien moyen (€)<input type="number" min="5" max="500" step="0.01" value={dailyBudget} onChange={(event)=>onDailyChange(Number(event.target.value))}/><small>La dépense peut varier selon les jours.</small></label>}
    <label className={styles.field}>Début de diffusion<select value={settings.budget.startAt?"scheduled":"now"} onChange={(event)=>onChange({budget:{...settings.budget,startAt:event.target.value==="scheduled"?new Date(Date.now()+86400000).toISOString():null}})}><option value="now">Dès la validation de Meta</option><option value="scheduled">Choisir une date et une heure</option></select>{settings.budget.startAt&&<input type="datetime-local" aria-label="Date et heure de début Meta" value={localDate(settings.budget.startAt,zone)} onChange={(event)=>changeDate("startAt",event.target.value)}/>}</label>
    <label className={styles.field}>Date et heure de fin Meta<input type="datetime-local" value={localDate(end,zone)} onChange={(event)=>changeDate("endAt",event.target.value)}/><small>Une fin après le début, dans les 90 prochains jours.</small></label>
  </div><p>Heures du calendrier : {zone}. Le budget est affecté à l’ensemble publicitaire.</p>{!timeZone&&<small>Calendrier affiché dans le fuseau Europe/Paris utilisé par ce parcours ; le fuseau du compte reste à vérifier.</small>}{error&&<p role="alert">{error}</p>}</fieldset>;
}
export function MetaAdsBidding({settings,budgetEuros,onChange}:Props&{budgetEuros:number}){
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Résultat et enchères Meta</legend><div className={styles.studioGrid}><label className={styles.field}>Résultat optimisé<input readOnly value="Clics sur le lien vers votre site"/><small>Un clic ne garantit pas une visite complète ni une conversion.</small></label><label className={styles.field}>Stratégie d’enchères<select value={settings.bidding.strategy} onChange={(event)=>onChange({bidding:{strategy:event.target.value as "maximum_delivery"|"bid_cap",amountEuros:event.target.value==="bid_cap"?settings.bidding.amountEuros??1:null}})}><option value="maximum_delivery">Volume maximal — enchères automatiques</option><option value="bid_cap">Plafond d’enchère personnalisé</option></select></label>{settings.bidding.strategy==="bid_cap"&&<label className={styles.field}>Plafond d’enchère (€)<input type="number" min="0.01" max={budgetEuros} step="0.01" value={settings.bidding.amountEuros??""} onChange={(event)=>onChange({bidding:{...settings.bidding,amountEuros:numberOrNull(event.target.value)}})}/><small>Limite d’enchère, sans garantie du coût par résultat.</small></label>}</div><p>Aucun Pixel ni événement de conversion n’est ajouté à cette campagne Trafic.</p></fieldset>;
}
export function MetaAdsAudience({settings,languages,locales,onLanguagesChange,onChange}:Props&{languages:string[];locales:readonly{id:string;name:string}[];onLanguagesChange:(value:string[])=>void}){
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Personnes ciblées</legend><div className={styles.studioGrid}><label className={styles.field}>Âge minimum<input type="number" min="18" max="65" value={settings.audience.ageMin} onChange={(event)=>onChange({audience:{...settings.audience,ageMin:Number(event.target.value)}})}/></label><label className={styles.field}>Âge maximum<select value={settings.audience.ageMax??"all"} onChange={(event)=>onChange({audience:{...settings.audience,ageMax:event.target.value==="all"?null:Number(event.target.value)}})}><option value="all">Sans limite supérieure</option>{Array.from({length:48},(_,index)=>index+18).map((age)=><option key={age} value={age}>{age===65?"65 ans et plus":`${age} ans`}</option>)}</select></label><label className={styles.field}>Langue des personnes<select value={languages.length===1?languages[0]:""} onChange={(event)=>onLanguagesChange(event.target.value?[event.target.value]:[])}><option value="">Toutes les langues</option>{languages.filter((value)=>!locales.some((item)=>item.id===value)).map((value)=><option key={value} value={value}>{value} · à vérifier</option>)}{locales.map((locale)=><option key={locale.id} value={locale.id}>{locale.name}</option>)}</select><small>Seules les langues du catalogue Meta sont transmises.</small></label></div><p>Meta recherche les personnes susceptibles de cliquer, dans vos zones et dans ces limites d’âge. Le brief client sert à rédiger le message ; il n’ajoute aucun intérêt ou audience personnalisée.</p></fieldset>;
}
export function MetaAdsEffectiveSummary({draft,resources}: {draft:AdsCampaignInput;resources:MetaAdsResources|null}){
  const settings=draft.metaDeliverySettings||defaultMetaDeliverySettings();
  const zone=calendarZone(resources?.account.timezone||null);
  const labels:Record<string,string>={facebook_feed:"Fil Facebook",instagram_feed:"Fil Instagram",stories:"Stories Facebook et Instagram",reels:"Reels Facebook et Instagram",messenger:"Messenger · brouillon"};
  const calendar=metaAdsCalendarLabels(draft,zone);
  return <div className={`${styles.studioControlPanel} ${styles.studioWide}`} data-meta-effective-summary="true"><strong>Réglages qui seront transmis à Meta</strong><p>Objectif : Trafic · Optimisation : clics sur le lien · Achat aux enchères</p><p>Identité : {resources?.pages.find((page)=>page.id===resources.selectedPageId)?.name||"Page à vérifier"}</p><p>Zones : {draft.metaDeliverySettings ? (draft.metaGeoTargets||[]).map((target)=>target.name).join(" · ")||"À vérifier" : `${draft.targetLocations.join(" · ")||"À vérifier"} · France (parcours historique)`}</p><p>Audience : {settings.audience.ageMin} ans minimum{settings.audience.ageMax?` → ${settings.audience.ageMax===65?"65 ans et plus":settings.audience.ageMax+" ans"}`:" · sans limite supérieure"} · Langues : {draft.metaDeliverySettings ? draft.languages.map((id)=>resources?.locales.find((item)=>item.id===id)?.name||id).join(" · ")||"Toutes" : "Sans filtre · les langues du brief historique ne sont pas transmises"}</p><p>Emplacements : {draft.metaPlacements.map((placement)=>labels[placement]||placement).join(" · ")}</p><p>Budget : {metaAdsBudgetLabel(draft)} · Début : {calendar.start} · Fin : {calendar.end} ({zone})</p><p>Enchères : {settings.bidding.strategy==="maximum_delivery"?"Volume maximal":`Plafond ${money(settings.bidding.amountEuros||0)}`} · Bouton : {META_CALL_TO_ACTION_LABELS[settings.callToAction]} · Mesure : clics sur le lien</p></div>;
}
