"use client";

import { useState } from "react";
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

const money = (value: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
const optionalNumber = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const placementLabels: Record<PinterestDeliverySettings["placementGroup"], string> = {
  ALL: "Tous les emplacements",
  SEARCH: "Recherche",
  BROWSE: "Parcourir",
  OTHER: "Autres emplacements",
};

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

function prettyDate(value: string | null, timeZone: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "À renseigner";
  if (!validTimeZone(timeZone)) return `${value} · fuseau du compte à vérifier`;
  return new Intl.DateTimeFormat("fr-FR", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function effectiveSettings(draft: PinterestDraft): PinterestDeliverySettings {
  if (draft.pinterestDeliverySettings) return draft.pinterestDeliverySettings;
  const objective = draft.channelSettings?.channel === "pinterest" ? draft.channelSettings.objectiveType : "CONSIDERATION";
  return {
    ...defaultPinterestDeliverySettings(objective),
    bidding: { strategy: "max_bid", amountEuros: draft.pinterestBidEuros ?? 1 },
  };
}

export function pinterestAdsBudgetLabel(draft: PinterestDraft): string {
  const settings = effectiveSettings(draft);
  if (settings.budget.type === "total") return settings.budget.totalEuros === null ? "Budget total à renseigner" : `${money(settings.budget.totalEuros)} au total`;
  return `${money(draft.dailyBudgetEuros)} par jour${settings.budget.flexibleDaily ? " en moyenne" : " · plafond quotidien fixe"}`;
}

export function PinterestAdsBudget({ settings, dailyBudget, endDate, timeZone, onChange, onDailyChange, onEndDateChange }: SettingsProps & {
  dailyBudget: number;
  endDate: string;
  timeZone: string | null;
  onDailyChange: (value: number) => void;
  onEndDateChange: (value: string) => void;
}) {
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
    if (!instant) { setCalendarError("Cette date ou cette heure n’est pas valide dans le fuseau du compte. Choisissez une autre heure."); return; }
    setCalendarError("");
    onChange({ budget: { ...settings.budget, [key]: instant } });
    if (key === "endAt") onEndDateChange(value.slice(0, 10));
  };
  const wrongOrder = Boolean(start && end && Date.parse(end) <= Date.parse(start));
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Budget et calendrier Pinterest</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>Type de budget
        <select value={total ? "total" : settings.budget.flexibleDaily ? "flexible_daily" : "fixed_daily"} onChange={(event) => {
          const type = event.target.value === "total" ? "total" : "daily";
          onChange({ budget: { ...settings.budget, type, totalEuros: type === "total" ? settings.budget.totalEuros : null, flexibleDaily: event.target.value === "flexible_daily" } });
        }}>
          <option value="total">Budget total de la campagne</option>
          <option value="fixed_daily">Budget quotidien fixe</option>
          <option value="flexible_daily">Budget quotidien moyen Performance+</option>
        </select>
      </label>
      {total ? <label className={styles.field}>Budget total (€)
        <input type="number" min="5" max="45000" step="0.01" required value={settings.budget.totalEuros ?? ""} onChange={(event) => onChange({ budget: { ...settings.budget, totalEuros: optionalNumber(event.target.value) } })} />
        <small>Une seule enveloppe pour la campagne, de 5 à 45 000 € dans iNrCy.</small>
      </label> : <label className={styles.field}>{settings.budget.flexibleDaily ? "Budget quotidien moyen (€)" : "Budget quotidien fixe (€)"}
        <input type="number" min="5" max="500" step="0.01" required value={Number.isFinite(dailyBudget) ? dailyBudget : ""} onChange={(event) => onDailyChange(Number(event.target.value))} />
        <small>De 5 à 500 € par jour dans iNrCy.</small>
      </label>}
      <label className={styles.field}>Début de diffusion
        <select value={start ? "scheduled" : "now"} onChange={(event) => {
          setCalendarError("");
          onChange({ budget: { ...settings.budget, startAt: event.target.value === "scheduled" ? new Date(Date.now() + 86_400_000).toISOString() : null } });
        }}>
          <option value="now">Dès la validation de Pinterest</option>
          <option value="scheduled">Choisir une date et une heure</option>
        </select>
        {start && <input aria-label="Date et heure de début Pinterest" type="datetime-local" required value={localDateTime(start, calendarTimeZone)} min={localDateTime(now.toISOString(), calendarTimeZone)} max={localDateTime(maximum, calendarTimeZone)} onChange={(event) => changeDate("startAt", event.target.value)} />}
      </label>
      <label className={styles.field}>Date et heure de fin Pinterest
        <input type="datetime-local" required value={localDateTime(end, calendarTimeZone)} min={localDateTime(start || now.toISOString(), calendarTimeZone)} max={localDateTime(maximum, calendarTimeZone)} aria-invalid={wrongOrder || Boolean(calendarError)} onChange={(event) => changeDate("endAt", event.target.value)} />
        <small>Une fin après le début, dans les 90 prochains jours.</small>
      </label>
    </div>
    <p>Heures du calendrier : {calendarTimeZone}.</p>
    {calendarError && <p role="alert">{calendarError}</p>}
    {wrongOrder && <p role="alert">La fin de diffusion doit être après le début.</p>}
    {total ? <p>Pinterest répartit cette enveloppe sur la période. Les dépenses quotidiennes peuvent varier ; le montant choisi est le plafond publicitaire total de la campagne.</p>
      : settings.budget.flexibleDaily ? <p>Le budget est une moyenne calculée du dimanche au samedi. Pinterest peut dépenser davantage certains jours ; budget × durée reste une estimation, sans plafond total pour la période.</p>
        : <p>Ce montant est le plafond quotidien fixe de la campagne. Budget × durée reste une estimation ; choisissez un budget total pour fixer une enveloppe pour toute la période.</p>}
    <p>Pinterest répartit le budget de la campagne entre ses groupes d’annonces.</p>
  </fieldset>;
}

export function PinterestAdsBidding({ settings, objectiveType, budgetEuros, onChange }: SettingsProps & { objectiveType: string; budgetEuros: number }) {
  const supported = objectiveType === "AWARENESS" || objectiveType === "CONSIDERATION";
  const awareness = objectiveType === "AWARENESS";
  if (!supported) return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Enchères Pinterest</legend><p>Les enchères pour cet objectif restent en brouillon. Le lancement actuel prend en charge Notoriété et Considération avec une image.</p></fieldset>;
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Optimisation et enchères Pinterest</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>Résultat optimisé
        <input value={awareness ? "Impressions" : "Clics sur l’épingle"} readOnly />
        <small>{awareness ? "Faire découvrir votre marque sur Pinterest." : "Un clic peut ouvrir l’épingle sur Pinterest. Il ne garantit pas une visite de votre site."}</small>
      </label>
      <label className={styles.field}>Stratégie d’enchères Pinterest
        <select value={settings.bidding.strategy} onChange={(event) => {
          const strategy = event.target.value as PinterestDeliverySettings["bidding"]["strategy"];
          onChange({ bidding: { strategy, amountEuros: strategy === "max_bid" ? settings.bidding.amountEuros ?? 1 : null }, optimizationGoal: awareness ? "impressions" : "pin_clicks" });
        }}>
          <option value="automatic">Performance+ — enchères automatiques</option>
          <option value="max_bid">Enchère maximale personnalisée</option>
        </select>
      </label>
      {settings.bidding.strategy === "max_bid" && <label className={styles.field}>{awareness ? "CPM maximal (€ pour 1 000 impressions)" : "CPC maximal (€ par clic sur l’épingle)"}
        <input type="number" min="0.01" max={Number.isFinite(budgetEuros) && budgetEuros > 0 ? budgetEuros : undefined} step="0.01" required value={settings.bidding.amountEuros ?? ""} onChange={(event) => onChange({ bidding: { ...settings.bidding, amountEuros: optionalNumber(event.target.value) } })} />
        <small>De 0,01 € au montant du budget choisi dans iNrCy.</small>
      </label>}
    </div>
    {settings.bidding.strategy === "automatic" ? <p>Pinterest ajuste les enchères dans votre budget. Aucun montant maximal manuel n’est envoyé.</p> : <p>Le montant saisi limite l’enchère ; le coût réel peut être inférieur.</p>}
    {!awareness && <p>L’optimisation des clics sortants vers votre site nécessite un parcours Pinterest distinct, qui n’est pas proposé ici.</p>}
  </fieldset>;
}

export function PinterestAdsDistribution({ settings, onChange }: SettingsProps) {
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Emplacements Pinterest</legend>
    <label className={styles.field}>Où montrer l’épingle
      <select value={settings.placementGroup} onChange={(event) => onChange({ placementGroup: event.target.value as PinterestDeliverySettings["placementGroup"] })}>
        <option value="ALL">Tous les emplacements — recommandé</option>
        <option value="SEARCH">Recherche</option>
        <option value="BROWSE">Parcourir</option>
        {settings.placementGroup === "OTHER" && <option value="OTHER">Autres emplacements — choix conservé</option>}
      </select>
      <small>{settings.placementGroup === "SEARCH" ? "Résultats de recherche et épingles associées." : settings.placementGroup === "BROWSE" ? "Accueil et épingles associées pendant la navigation." : settings.placementGroup === "OTHER" ? "Placement enregistré à vérifier dans Pinterest." : "Recherche, accueil et épingles associées."}</small>
    </label>
    <p>Le ciblage automatique utilise le contenu de votre Pin dans les zones et langues choisies. Les profils décrits dans le brief guident les textes ; ils ne créent pas de filtre professionnel ou démographique.</p>
  </fieldset>;
}

export function PinterestAdsEffectiveSummary({ draft, timeZone, resources }: { draft: PinterestDraft; timeZone: string | null; resources?: SummaryResources | null }) {
  const settings = effectiveSettings(draft);
  const calendarTimeZone = validTimeZone(timeZone) ? timeZone : "UTC";
  const channel = draft.channelSettings?.channel === "pinterest" ? draft.channelSettings : null;
  const supported = Boolean(channel && ["AWARENESS", "CONSIDERATION"].includes(channel.objectiveType) && channel.intendedPromotionType === "STANDARD_AD" && channel.creativeType === "REGULAR" && channel.targetingMode === "automatic");
  const awareness = channel?.objectiveType === "AWARENESS";
  const bid = settings.bidding.strategy === "automatic" ? "Performance+ · enchères automatiques" : `${awareness ? "CPM" : "CPC par clic sur l’épingle"} maximal : ${settings.bidding.amountEuros === null ? "à renseigner" : money(settings.bidding.amountEuros)}`;
  const locations = draft.targetLocations.map((value) => resources?.geographyOptions?.find((option) => option.id === value)?.name || value);
  const languages = draft.languages.map((value) => resources?.languageOptions?.find((option) => option.id === value)?.name || value);
  const end = settings.budget.endAt || (draft.endDate ? `${draft.endDate}T23:59:59Z` : null);
  const rows = [
    ["Campagne", channel?.objectiveType === "AWARENESS" ? "Notoriété" : channel?.objectiveType === "CONSIDERATION" ? "Considération" : "Objectif conservé en brouillon"],
    ["Format du Pin", supported ? "Épingle sponsorisée · image standard" : "Format ou ciblage à conserver en brouillon"],
    ["Résultat optimisé", supported ? awareness ? "Impressions" : "Clics sur l’épingle · sans garantie de visite du site" : "À confirmer dans Pinterest"],
    ["Zones géographiques", locations.join(" ; ") || "À renseigner"],
    ["Langues", languages.join(" ; ") || "À renseigner"],
    ["Audience", channel?.targetingMode === "automatic" ? "Ciblage automatique à partir du Pin" : "Signaux manuels conservés en brouillon"],
    ["Emplacements", placementLabels[settings.placementGroup]],
    ["Enchères", bid],
    ["Budget de campagne", pinterestAdsBudgetLabel(draft)],
    ["Début", settings.budget.startAt ? prettyDate(settings.budget.startAt, calendarTimeZone) : "Dès publication et validation de Pinterest"],
    ["Fin", prettyDate(end, calendarTimeZone)],
    ["Heures du calendrier", calendarTimeZone],
    ["Destination", draft.destinationUrl || "À renseigner"],
    ["Paramètres de suivi", draft.trackingParameters || "Aucun paramètre ajouté"],
    ["Conversions pour les enchères", "Aucun événement de conversion sélectionné pour Notoriété ou Considération"],
  ];
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Réglages de diffusion Pinterest</legend>
    <dl className={styles.studioReviewGrid}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p>Le budget est défini au niveau de la campagne. Les objectifs décrits dans votre projet ne créent pas de balise de conversion Pinterest.</p>
  </fieldset>;
}
