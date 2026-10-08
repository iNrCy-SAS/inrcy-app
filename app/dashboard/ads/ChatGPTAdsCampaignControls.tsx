"use client";

import { useState } from "react";
import { defaultOpenaiDeliverySettings, openaiAdsCalendarInstant, openaiAdsLegacyEndTime, openaiAdsLocalDateTime, openaiAdsTimeZone } from "@/lib/adsOpenaiCampaignSettings";
import type { OpenaiDeliverySettings, OpenaiNativeDraft } from "@/lib/adsOpenaiCampaignSettings";
import type { OpenaiAdsResources } from "@/lib/adsOpenaiResources";
import type { AdsCampaignInput } from "@/lib/adsValidation";
import styles from "./ads.module.css";

type SettingsProps = { settings: OpenaiDeliverySettings; onChange: (patch: Partial<OpenaiDeliverySettings>) => void };
type NativeDraft = AdsCampaignInput & { openaiDeliverySettings?: OpenaiDeliverySettings };
const euros = (amount: number | null | undefined) => amount == null || !Number.isFinite(amount) ? "À préciser" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
const number = (value: string) => value === "" ? null : Number(value);
function endInstant(endAt: string | null, endDate: string, timeZone: string) {
  if (endAt) return endAt;
  try { return new Date(openaiAdsLegacyEndTime(endDate, timeZone) * 1000).toISOString(); } catch { return null; }
}
export function openaiAdsBudgetLabel(draft: OpenaiNativeDraft) {
  return draft.openaiDeliverySettings?.budget.type === "total" ? `${euros(draft.openaiDeliverySettings.budget.totalEuros)} au total` : `${euros(draft.dailyBudgetEuros)} par jour`;
}
export function ChatGPTAdsBudget({ settings, dailyBudget, endDate, timeZone, onChange, onDailyChange, onEndDateChange }: SettingsProps & {
  dailyBudget: number; endDate: string; timeZone: string | null; onDailyChange: (value: number) => void; onEndDateChange: (value: string) => void;
}) {
  const [calendarError, setCalendarError] = useState("");
  const calendarTimeZone = openaiAdsTimeZone(timeZone) || "UTC";
  const start = settings.budget.startAt;
  const end = endInstant(settings.budget.endAt, endDate, calendarTimeZone);
  const total = settings.budget.type === "total";
  const now = new Date();
  const maximum = new Date(now.getTime() + 90 * 86400000).toISOString();
  const changeDate = (key: "startAt" | "endAt", value: string) => {
    const instant = openaiAdsCalendarInstant(value, calendarTimeZone);
    if (!instant) { setCalendarError("Cette date ou heure est invalide ou ambiguë dans le calendrier choisi."); return; }
    setCalendarError("");
    onChange({ budget: { ...settings.budget, [key]: instant } });
    if (key === "endAt") onEndDateChange(instant.slice(0, 10));
  };
  const wrongOrder = Boolean(start && end && Date.parse(end) <= Date.parse(start));
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Budget et calendrier ChatGPT Ads</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>Type de budget
        <select value={settings.budget.type} onChange={(event) => onChange({ budget: { ...settings.budget, type: event.target.value as "daily" | "total", totalEuros: event.target.value === "total" ? settings.budget.totalEuros : null } })}>
          <option value="total">Budget total de la campagne</option><option value="daily">Budget quotidien</option>
        </select>
      </label>
      {total ? <label className={styles.field}>Budget total (€)<input type="number" min="5" max="45000" step="0.01" required value={settings.budget.totalEuros ?? ""} onChange={(event) => onChange({ budget: { ...settings.budget, totalEuros: number(event.target.value) } })} /><small>Une seule enveloppe pour la campagne, de 5 à 45 000 € dans iNrCy.</small></label>
        : <label className={styles.field}>Budget quotidien (€)<input type="number" min="15" max="500" step="0.01" required value={Number.isFinite(dailyBudget) ? dailyBudget : ""} onChange={(event) => onDailyChange(Number(event.target.value))} /><small>De 15 à 500 € par jour dans iNrCy. Le minimum réel est vérifié par ChatGPT Ads.</small></label>}
      <label className={styles.field}>Début de diffusion
        <select value={start ? "scheduled" : "now"} onChange={(event) => { setCalendarError(""); onChange({ budget: { ...settings.budget, startAt: event.target.value === "scheduled" ? new Date(Date.now() + 86400000).toISOString() : null } }); }}>
          <option value="now">Dès la validation de ChatGPT Ads</option><option value="scheduled">Choisir une date et une heure</option>
        </select>
        {start && <input aria-label="Date et heure de début ChatGPT Ads" type="datetime-local" required value={openaiAdsLocalDateTime(start, calendarTimeZone)} min={openaiAdsLocalDateTime(now.toISOString(), calendarTimeZone)} max={openaiAdsLocalDateTime(maximum, calendarTimeZone)} onChange={(event) => changeDate("startAt", event.target.value)} />}
      </label>
      <label className={styles.field}>Date et heure de fin ChatGPT Ads
        <input type="datetime-local" required value={openaiAdsLocalDateTime(end, calendarTimeZone)} min={openaiAdsLocalDateTime(start || now.toISOString(), calendarTimeZone)} max={openaiAdsLocalDateTime(maximum, calendarTimeZone)} aria-invalid={wrongOrder || Boolean(calendarError)} onChange={(event) => changeDate("endAt", event.target.value)} />
        <small>Une fin après le début, dans les 90 prochains jours.</small>
      </label>
    </div>
    <p>Heures du calendrier : {calendarTimeZone}.{!openaiAdsTimeZone(timeZone) ? " Le fuseau du compte n’a pas encore été vérifié ; les horaires saisis ici sont en UTC." : ""}</p>
    {calendarError && <p role="alert">{calendarError}</p>}{wrongOrder && <p role="alert">La fin de diffusion doit être après le début.</p>}
    <p>{total ? "Cette enveloppe est le plafond publicitaire total de la campagne. Les dépenses quotidiennes peuvent varier." : "Le budget quotidien n’est pas une enveloppe pour toute la campagne. Ads Manager peut présenter une moyenne et faire varier les dépenses selon les jours. Choisissez un budget total pour fixer l’enveloppe de toute la campagne."}</p>
  </fieldset>;
}
export function ChatGPTAdsBidding({ bidEuros, budgetEuros, onBidChange }: { bidEuros: number | null | undefined; budgetEuros: number; onBidChange: (value: number | undefined) => void }) {
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Enchères ChatGPT Ads</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>Stratégie d’enchères<input value="Enchère fixe par clic" readOnly /><small>Cette carte optimise les clics vers votre page. Aucun événement de conversion n’est sélectionné.</small></label>
      <label className={styles.field}>CPC maximal (€)<input type="number" min="0.01" max={budgetEuros > 0 ? budgetEuros : undefined} step="0.01" required value={bidEuros ?? ""} onChange={(event) => onBidChange(event.target.value === "" ? undefined : Number(event.target.value))} /><small>L’enchère ne doit pas dépasser le budget choisi. Elle ne promet ni clics, ni ventes.</small></label>
    </div>
  </fieldset>;
}
export function ChatGPTAdsDistribution({ settings, onChange }: SettingsProps) {
  const platforms = settings.platforms;
  const value = platforms.length === 0 ? "all" : platforms.length === 1 ? platforms[0] : platforms.length === 2 && platforms.includes("ios_app") && platforms.includes("android_app") ? "apps" : "custom";
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Plateformes ChatGPT</legend>
    <label className={styles.field}>Où montrer la carte
      <select value={value} onChange={(event) => onChange({ platforms: event.target.value === "all" ? [] : event.target.value === "apps" ? ["ios_app", "android_app"] : [event.target.value as OpenaiDeliverySettings["platforms"][number]] })}>
        <option value="all">Toutes les plateformes disponibles</option><option value="web">Web — ordinateur et navigateurs mobiles</option><option value="apps">Applications iOS et Android</option><option value="ios_app">Application iOS</option><option value="android_app">Application Android</option><option value="desktop_web">Web sur ordinateur</option><option value="ios_web">Web sur iOS</option><option value="android_web">Web sur Android</option>{value === "custom" && <option value="custom" disabled>Sélection personnalisée conservée</option>}
      </select>
    </label>
    <p>Ces plateformes constituent un filtre de diffusion. Les profils décrits dans votre projet guident le message ; ils ne créent pas une audience personnalisée ni un filtre professionnel.</p>
  </fieldset>;
}
export function ChatGPTAdsGeography({ resources, loading, error, query, onQueryChange, onSearch, locations, onLocationsChange }: {
  resources: OpenaiAdsResources | null; loading: boolean; error: string; query: string; onQueryChange: (value: string) => void;
  onSearch: () => void; locations: string[]; onLocationsChange: (value: string[]) => void;
}) {
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Zones géographiques ChatGPT Ads</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>Rechercher une ville ou une région en France
        <input value={query} minLength={2} maxLength={120} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!loading && query.trim().length >= 2) onSearch(); } }} placeholder="Ex. Lille ou Hauts-de-France" />
      </label>
      <div className={styles.field}><span>Catalogue du compte publicitaire</span><button type="button" onClick={onSearch} disabled={loading || query.trim().length < 2}>{loading ? "Recherche en cours…" : "Rechercher dans ChatGPT Ads"}</button></div>
      {!!resources?.geographyOptions.length && <label className={`${styles.field} ${styles.studioWide}`}>Choisir un lieu disponible
        <select value="" disabled={loading || locations.length >= 20} onChange={(event) => { const option = resources.geographyOptions.find((item) => item.id === event.target.value); if (option && !locations.includes(option.canonicalName)) onLocationsChange([...locations, option.canonicalName]); }}>
          <option value="">Sélectionner un résultat</option>{resources.geographyOptions.map((item) => <option key={item.id} value={item.id} disabled={locations.includes(item.canonicalName)}>{item.canonicalName}</option>)}
        </select>
      </label>}
    </div>
    {error && <p role="alert">{error}</p>}
    {resources && !loading && query.trim().length >= 2 && !resources.geographyOptions.length && !error && <p>Aucun lieu disponible dans les résultats affichés. Affinez la recherche.</p>}
    {locations.length ? <ul>{locations.map((location, index) => <li key={`${location}-${index}`}>{location} <button type="button" aria-label={`Retirer ${location}`} onClick={() => onLocationsChange(locations.filter((_, current) => current !== index))}>Retirer</button></li>)}</ul> : <p>Choisissez au moins une zone. Le contrôle final vérifie chaque lieu dans le compte sélectionné.</p>}
    <p>Ce parcours conserve le ciblage local français : villes et régions, jusqu’à 20 zones. Les résultats du catalogue ne remplacent pas le contrôle avant diffusion.</p>
  </fieldset>;
}
const platformName: Record<string, string> = { web: "Web (ordinateur et mobile)", ios_app: "Application iOS", android_app: "Application Android", desktop_web: "Web sur ordinateur", ios_web: "Web sur iOS", android_web: "Web sur Android" };
export function ChatGPTAdsEffectiveSummary({ draft, resources }: { draft: NativeDraft; resources: OpenaiAdsResources | null }) {
  const settings = draft.openaiDeliverySettings || defaultOpenaiDeliverySettings();
  const zone = openaiAdsTimeZone(resources?.account.timezone) || "UTC";
  const end = endInstant(settings.budget.endAt, draft.endDate, zone);
  const date = (instant: string | null) => instant && Number.isFinite(Date.parse(instant)) ? new Intl.DateTimeFormat("fr-FR", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(Date.parse(instant)) : "À préciser";
  const rows = [
    ["Compte annonceur", resources?.account.name || "À vérifier"],
    ["Objectif", "Clics vers votre site"], ["Format", "Carte ChatGPT · image carrée"],
    ["Budget de campagne", openaiAdsBudgetLabel(draft)], ["Début", settings.budget.startAt ? date(settings.budget.startAt) : "Dès validation de ChatGPT Ads"], ["Fin", date(end)],
    ["Heures du calendrier", `${zone}${openaiAdsTimeZone(resources?.account.timezone) ? "" : " · fuseau du compte à vérifier"}`],
    ["Zones géographiques", draft.targetLocations.join(" · ") || "À préciser"],
    ["Plateformes", settings.platforms.length ? settings.platforms.map((p) => platformName[p] || p).join(" · ") : "Toutes les plateformes disponibles"],
    ["Enchères", `Fixe par clic · CPC maximal ${euros(draft.openaiBidEuros)}`],
    ["Contexte de l’annonce", draft.offer || "Aucune indication supplémentaire"],
    ["Destination", draft.destinationUrl || "À préciser"], ["Paramètres de suivi", draft.openaiDeliverySettings ? draft.trackingParameters || "Aucun" : "Non transmis par le parcours historique"],
    ["Conversions pour les enchères", "Aucun événement sélectionné · objectif clics"],
  ];
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Réglages de diffusion ChatGPT Ads</legend>
    <dl className={styles.studioReviewGrid}>{rows.map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}</dl>
    <p>La carte et le compte doivent passer la revue de ChatGPT Ads. L’enregistrement d’un brouillon ne lance aucune diffusion.</p>
  </fieldset>;
}
