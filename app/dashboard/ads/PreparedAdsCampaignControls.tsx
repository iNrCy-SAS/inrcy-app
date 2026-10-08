"use client";

import { useState } from "react";
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
const money = (value: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
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

export function preparedAdsBudgetLabel(draft: PreparedDraft): string {
  const budget = draft.preparedDeliverySettings?.budget;
  return budget?.type === "total"
    ? budget.totalEuros === null ? "Budget total à renseigner" : `${money(budget.totalEuros)} au total`
    : `${money(draft.dailyBudgetEuros)} par jour`;
}

export function PreparedAdsBudget({ settings, dailyBudget, endDate, timeZone, onChange, onDailyChange, onEndDateChange }: SettingsProps & {
  dailyBudget: number;
  endDate: string;
  timeZone: string | null;
  onDailyChange: (value: number) => void;
  onEndDateChange: (value: string) => void;
}) {
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
    if (!instant) { setCalendarError("Cette date ou cette heure est impossible ou ambiguë dans le fuseau choisi. Choisissez une autre heure."); return; }
    setCalendarError("");
    onChange({ budget: { ...settings.budget, [key]: instant } });
    if (key === "endAt") onEndDateChange(value.slice(0, 10));
  };
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Budget et calendrier préparés</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>Type de budget
        <select value={settings.budget.type} onChange={(event) => {
          const type = event.target.value === "total" ? "total" : "daily";
          onChange({ budget: { ...settings.budget, type, totalEuros: type === "total" ? settings.budget.totalEuros : null } });
        }}>
          <option value="daily">Budget quotidien</option>
          <option value="total">Budget total pour la période</option>
        </select>
      </label>
      {total ? <label className={styles.field}>Budget total (€)
        <input type="number" min="5" max="45000" step="0.01" required value={settings.budget.totalEuros ?? ""} onChange={(event) => onChange({ budget: { ...settings.budget, totalEuros: optionalNumber(event.target.value) } })} />
        <small>Une seule enveloppe pour la période, de 5 à 45 000 € dans iNrCy.</small>
      </label> : <label className={styles.field}>Budget quotidien (€)
        <input type="number" min="5" max="500" step="0.01" required value={Number.isFinite(dailyBudget) ? dailyBudget : ""} onChange={(event) => onDailyChange(Number(event.target.value))} />
        <small>De 5 à 500 € par jour dans iNrCy.</small>
      </label>}
      <label className={styles.field}>Début prévu
        <select value={start ? "scheduled" : "now"} onChange={(event) => {
          setCalendarError("");
          onChange({ budget: { ...settings.budget, startAt: event.target.value === "scheduled" ? new Date(Date.now() + 86_400_000).toISOString() : null } });
        }}>
          <option value="now">Début immédiat prévu</option>
          <option value="scheduled">Choisir une date et une heure</option>
        </select>
        {start && <input aria-label="Date et heure de début préparées" type="datetime-local" required value={preparedAdsLocalDateTime(start, calendarTimeZone)} min={preparedAdsLocalDateTime(now.toISOString(), calendarTimeZone)} max={preparedAdsLocalDateTime(maximum, calendarTimeZone)} onChange={(event) => changeDate("startAt", event.target.value)} />}
      </label>
      <label className={styles.field}>Date et heure de fin prévues
        <input type="datetime-local" required value={preparedAdsLocalDateTime(end, calendarTimeZone)} min={preparedAdsLocalDateTime(start || now.toISOString(), calendarTimeZone)} max={preparedAdsLocalDateTime(maximum, calendarTimeZone)} aria-invalid={wrongOrder || Boolean(calendarError)} onChange={(event) => changeDate("endAt", event.target.value)} />
        <small>Une fin après le début, dans les 90 prochains jours.</small>
      </label>
    </div>
    <p>Heures du calendrier : {calendarTimeZone}.</p>
    {!preparedAdsTimeZone(timeZone) && <p>Fuseau de préparation Europe/Paris ; le fuseau du compte publicitaire reste à vérifier.</p>}
    {calendarError && <p role="alert">{calendarError}</p>}
    {wrongOrder && <p role="alert">La fin prévue doit être après le début.</p>}
    <p>{total ? "L’enveloppe totale reste distincte du budget quotidien. Aucun montant par jour n’est déduit automatiquement." : "Ce montant prépare un budget quotidien. Il ne fixe pas une enveloppe totale pour la période."}</p>
    <p>Ces choix sont conservés dans le brouillon. Les limites de budget et le calendrier acceptés par le compte publicitaire restent à vérifier.</p>
  </fieldset>;
}

export function PreparedAdsBidding({ settings, budgetEuros, channel, optimizationIntent, onChange }: SettingsProps & { budgetEuros: number; channel: "x" | "tiktok"; optimizationIntent?: string }) {
  const tiktok = channel === "tiktok";
  const manual = settings.bidding.strategy !== "automatic";
  const incompatible = tiktok ? settings.bidding.strategy === "max_bid" : settings.bidding.strategy === "cost_cap";
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Enchères {channelLabel(channel)} préparées</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>Stratégie d’enchères prévue
        <select value={settings.bidding.strategy} onChange={(event) => {
          const strategy = event.target.value === "cost_cap" && tiktok ? "cost_cap" : event.target.value === "max_bid" && !tiktok ? "max_bid" : "automatic";
          onChange({ bidding: { strategy, amountEuros: strategy !== "automatic" && !incompatible ? settings.bidding.amountEuros : null } });
        }}>
          <option value="automatic">{tiktok ? "Maximum Delivery · maximiser les résultats" : "Automatique"}</option>
          {tiktok ? <option value="cost_cap">Cost Cap · coût cible par résultat</option> : <option value="max_bid">Plafond d’enchère à définir</option>}
          {incompatible && <option value={settings.bidding.strategy} disabled>Ancien choix à remplacer pour ce canal</option>}
        </select>
      </label>
      {manual && <label className={styles.field}>{tiktok ? costCapLabels[optimizationIntent || ""] || "Coût cible par résultat (€)" : "Plafond d’enchère prévu (€)"}
        <input type="number" min="0.01" max={Number.isFinite(budgetEuros) && budgetEuros > 0 ? budgetEuros : undefined} step="0.01" required value={settings.bidding.amountEuros ?? ""} onChange={(event) => onChange({ bidding: { ...settings.bidding, amountEuros: optionalNumber(event.target.value) } })} />
        <small>Le type d’enchère et son unité doivent être confirmés pour l’objectif dans le compte {channelLabel(channel)}.</small>
      </label>}
    </div>
    {incompatible && <p role="alert">Choisissez une stratégie d’enchères adaptée au canal avant de valider le brouillon.</p>}
    {tiktok && settings.bidding.strategy === "cost_cap" && <p>Cost Cap prépare un coût cible moyen par résultat, sans garantie de coût maximal pour chaque résultat. Son unité et sa disponibilité dépendent de l’objectif et du compte TikTok.</p>}
    <p>Stratégie préparée dans iNrCy, sans transmission au compte publicitaire.</p>
    {channel === "tiktok" ? <p>Le budget est préparé au niveau du groupe d’annonces TikTok, sans optimisation du budget de campagne. Les bornes applicables à ce compte restent à vérifier.</p> : <p>iNrCy prépare ici un choix de budget quotidien ou total. Les autres combinaisons de plafonds proposées par X restent à vérifier dans le compte.</p>}
  </fieldset>;
}

export function PreparedAdsEffectiveSummary({ draft, timeZone, identityMessage }: { draft: PreparedDraft; timeZone: string | null; identityMessage?: string }) {
  const [reviewedAt] = useState(() => Date.now());
  const settings = draft.preparedDeliverySettings || defaultPreparedDeliverySettings();
  const zone = preparedAdsTimeZone(timeZone) || "Europe/Paris";
  const channel = draft.channelSettings?.channel === "tiktok" || draft.channelSettings?.channel === "x" ? draft.channelSettings : null;
  let calendarError = "";
  try { plannedNativeCalendar(draft, reviewedAt, zone); } catch (error) { calendarError = error instanceof Error ? error.message : "Le calendrier préparé reste à vérifier."; }
  const prettyDate = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("fr-FR", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "À renseigner";
  const objective = channel?.channel === "tiktok" ? channel.objectiveType : channel?.channel === "x" ? channel.objective : "";
  const destination = channel?.channel === "tiktok" && channel.destinationKind !== "website"
    ? channel.destinationKind === "profile" ? "Profil TikTok" : "Formulaire intégré TikTok"
    : draft.destinationUrl || "À renseigner";
  const rows = [
    ["Statut", "Brouillon préparé · réglages non transmis"],
    ["Compte et identité", identityMessage || "À vérifier dans le compte publicitaire"],
    ["Objectif", objectiveLabels[objective] || "À préciser"],
    ["Résultat optimisé prévu", channel?.channel === "tiktok" ? optimizationLabels[channel.optimizationIntent] : objectiveLabels[objective] || "À préciser"],
    ["Format", formatLabels[channel?.format || ""] || "À préciser"],
    ["Zones géographiques", draft.targetLocations.join(" ; ") || "À renseigner"],
    ["Langues", draft.languages.join(" ; ") || "À renseigner"],
    ["Audience", audienceLabels[channel?.targetingMode || ""] || "À préciser"],
    ["Brief d’audience", draft.targetAudiences.join(" ; ") || "Aucun brief ajouté"],
    ["Emplacements prévus", channel?.channel === "tiktok" ? channel.placementIntent === "automatic" ? "Automatiques · à confirmer dans TikTok" : "TikTok uniquement" : "À confirmer dans X"],
    ["Enchères", settings.bidding.strategy === "automatic" ? channel?.channel === "tiktok" ? "Maximum Delivery · maximiser les résultats" : "Automatiques · à confirmer" : `${settings.bidding.strategy === "cost_cap" ? "Cost Cap · coût cible par résultat" : "Plafond prévu"} : ${settings.bidding.amountEuros === null ? "à renseigner" : money(settings.bidding.amountEuros)}`],
    [channel?.channel === "tiktok" ? "Budget du groupe d’annonces" : "Budget prévu", preparedAdsBudgetLabel(draft)],
    ["Début", settings.budget.startAt ? prettyDate(settings.budget.startAt) : "Début immédiat prévu"],
    ["Fin", prettyDate(settings.budget.endAt || preparedAdsLegacyEndInstant(draft.endDate))],
    ["Heures du calendrier", zone],
    ["Destination prévue", destinationLabels[channel?.channel === "tiktok" ? channel.destinationKind : draft.conversionLocation] || "À préciser"],
    ["Lien", destination],
    ["Suivi", draft.trackingParameters || "Aucun paramètre ajouté"],
    ["Objectif de conversion du brief", conversionLabels[draft.conversionGoal] || "À préciser"],
    ["Événement de conversion natif", "Aucun événement natif associé · à vérifier dans le compte"],
    ["Média", draft.creativeUrl || draft.imageUrl || (channel?.format === "text" ? "Annonce textuelle" : "À joindre")],
  ];
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Réglages {channelLabel(draft.provider)} préparés</legend>
    <dl className={styles.studioReviewGrid}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {calendarError && <p role="alert">{calendarError}</p>}
    <p>Le brouillon conserve votre intention. Les audiences, événements de conversion, emplacements, enchères et limites du compte doivent être confirmés avant toute transmission publicitaire.</p>
  </fieldset>;
}
