"use client";

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
const money = (value: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
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

function calendarLabel(date: string): string {
  return googleAdsCalendarDate(date)
    ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))
    : "À renseigner";
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
  const changeBid = (key: keyof GoogleDeliverySettings["bidding"], value: number | null) => onChange({ bidding: { ...settings.bidding, [key]: value } });
  const needsConversions = strategy === "maximize_conversions" || strategy === "maximize_value" || strategy === "target_cpa" || strategy === "target_roas";
  const targetsCpa = strategy === "maximize_conversions" || strategy === "target_cpa";
  const targetsValue = strategy === "maximize_value" || strategy === "target_roas";
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Enchères Google Search</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>Stratégie d’enchères
        <select value={strategy} onChange={(event) => onStrategyChange(event.target.value as AdsBidStrategy)}>
          <option value="maximize_clicks">Maximiser les clics</option>
          <option value="maximize_conversions" disabled={conversionsReady !== true}>Maximiser les conversions</option>
          <option value="maximize_value" disabled={conversionsReady !== true}>Maximiser la valeur de conversion</option>
          <option value="manual_review">CPC manuel</option>
          {strategy === "target_cpa" && <option value="target_cpa" disabled={conversionsReady !== true}>CPA cible</option>}
          {strategy === "target_roas" && <option value="target_roas" disabled={conversionsReady !== true}>ROAS cible</option>}
        </select>
      </label>
      {strategy === "maximize_clicks" && <label className={styles.field}>Plafond CPC (€) — facultatif
        <input type="number" min="0.01" max="500" step="0.01" value={settings.bidding.cpcBidCeilingEuros ?? ""} onChange={(event) => changeBid("cpcBidCeilingEuros", optionalNumber(event.target.value))} />
        <small>Limite l’enchère par clic. Laissez vide pour laisser Google ajuster les enchères sans ce plafond.</small>
      </label>}
      {strategy === "manual_review" && <label className={styles.field}>Enchère CPC manuelle (€)
        <input type="number" min="0.01" max="500" step="0.01" required value={settings.bidding.manualCpcEuros ?? ""} onChange={(event) => changeBid("manualCpcEuros", optionalNumber(event.target.value))} />
        <small>Montant maximum par clic appliqué au groupe d’annonces.</small>
      </label>}
      {targetsCpa && <label className={styles.field}>CPA cible (€){strategy === "target_cpa" ? "" : " — facultatif"}
        <input type="number" min="0.01" max="45000" step="0.01" required={strategy === "target_cpa"} value={settings.bidding.targetCpaEuros ?? ""} onChange={(event) => changeBid("targetCpaEuros", optionalNumber(event.target.value))} />
        <small>Coût moyen visé par conversion, sans garantie pour chaque conversion.</small>
      </label>}
      {targetsValue && <label className={styles.field}>ROAS cible (%){strategy === "target_roas" ? "" : " — facultatif"}
        <input type="number" min="1" max="100000" step="1" required={strategy === "target_roas"} value={settings.bidding.targetRoas === null ? "" : Number((settings.bidding.targetRoas * 100).toFixed(6))} onChange={(event) => {
          const percent = optionalNumber(event.target.value);
          changeBid("targetRoas", percent === null ? null : percent / 100);
        }} />
        <small>Exemple : 400 % correspond à 4 € de valeur de conversion pour 1 € dépensé. Les conversions doivent avoir des valeurs pertinentes.</small>
      </label>}
    </div>
    {strategy === "maximize_clicks" && <p>Google ajuste les enchères pour obtenir des clics dans votre budget.</p>}
    {needsConversions && conversionsReady !== true && <p role="status">{conversionsReady === null ? "Les objectifs de conversion du compte doivent être vérifiés avant d’utiliser cette stratégie." : "Aucune conversion principale active dans les objectifs du compte n’a été confirmée. Choisissez les clics ou le CPC manuel, ou configurez vos conversions dans Google Ads."}</p>}
    {targetsValue && conversionsReady === true && <p>Cette stratégie optimise la valeur enregistrée par vos conversions, selon les objectifs du compte.</p>}
  </fieldset>;
}

export function GoogleAdsGeography({ settings, onChange }: SettingsProps) {
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Personnes à toucher dans les zones sélectionnées</legend>
    <label className={styles.field}>Option géographique
      <select value={settings.geoTargetType} onChange={(event) => onChange({ geoTargetType: event.target.value as GoogleDeliverySettings["geoTargetType"] })}>
        <option value="PRESENCE">Présence : personnes dans les zones ciblées ou qui s’y rendent régulièrement</option>
        <option value="PRESENCE_OR_INTEREST">Présence ou intérêt : personnes dans les zones ciblées ou intéressées par celles-ci</option>
      </select>
    </label>
    <p>{settings.geoTargetType === "PRESENCE" ? "La présence se limite aux personnes situées dans vos zones ou qui les fréquentent régulièrement, selon les signaux de Google." : "L’intérêt peut aussi toucher des personnes situées ailleurs, dont les recherches portent sur vos zones."}</p>
  </fieldset>;
}

export function GoogleAdsKeywords({ settings, onChange }: SettingsProps) {
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Correspondance des mots-clés</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>Correspondance par défaut
        <select value={settings.keywordMatchType} onChange={(event) => onChange({ keywordMatchType: event.target.value as GoogleKeywordMatchType })}>
          {Object.entries(matchLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <small>Les guillemets « &quot;expression&quot; » ou crochets « [exact] » d’un mot-clé prennent le dessus sur ce choix.</small>
      </label>
      <label className={styles.field}>Correspondance des exclusions
        <select value={settings.negativeKeywordMatchType} onChange={(event) => onChange({ negativeKeywordMatchType: event.target.value as GoogleKeywordMatchType })}>
          {Object.entries(matchLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <small>Les exclusions n’incluent pas automatiquement les variantes proches, synonymes ou singulier/pluriel.</small>
      </label>
    </div>
    <p>La requête large peut déclencher des recherches liées au sens du mot-clé. L’expression et l’exact restent sensibles au sens et aux variantes proches : ce ne sont pas des correspondances littérales.</p>
  </fieldset>;
}

export function GoogleAdsRSAFields({ settings, onChange }: SettingsProps) {
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Chemin affiché de l’annonce — facultatif</legend>
    <div className={styles.studioGrid}>
      {(["path1", "path2"] as const).map((key, index) => <label className={styles.field} key={key}>Chemin {index + 1}
        <input value={settings.responsiveSearchAd[key]} maxLength={15} placeholder={index === 0 ? "essai" : "21-jours"} onChange={(event) => onChange({ responsiveSearchAd: { ...settings.responsiveSearchAd, [key]: event.target.value } })} aria-invalid={googleAdsTextLength(settings.responsiveSearchAd[key]) > 15 || /[\/?#\r\n]/.test(settings.responsiveSearchAd[key])} />
        <small>{googleAdsTextLength(settings.responsiveSearchAd[key])} / 15 caractères ; sans « / », « ? » ou « # ».</small>
      </label>)}
    </div>
    <p>Ces segments s’affichent après votre domaine. Ils ne changent pas la page de destination.</p>
  </fieldset>;
}

export function GoogleAdsBudget({ settings, dailyBudget, endDate, timeZone, onChange, onDailyChange, onEndDateChange }: SettingsProps & {
  dailyBudget: number;
  endDate: string;
  timeZone: string;
  onDailyChange: (value: number) => void;
  onEndDateChange: (value: string) => void;
}) {
  const total = settings.budget.type === "total";
  const today = accountToday(timeZone);
  const start = settings.startDate || (total ? "" : today);
  const days = googleAdsCalendarDate(start) && googleAdsCalendarDate(endDate)
    ? Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1
    : null;
  const invalidDuration = total && days !== null && (days < 3 || days > 90);
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Budget et calendrier Google Search</legend>
    <div className={styles.studioGrid}>
      <label className={styles.field}>Type de budget
        <select value={settings.budget.type} onChange={(event) => {
          const type = event.target.value as GoogleDeliverySettings["budget"]["type"];
          onChange({ budget: { ...settings.budget, type }, ...(type === "total" && !settings.startDate && today ? { startDate: today } : {}) });
        }}>
          <option value="daily">Budget quotidien moyen</option>
          <option value="total">Budget total de la campagne</option>
        </select>
      </label>
      {total ? <label className={styles.field}>Budget total (€)
        <input type="number" min="5" max="45000" step="0.01" required value={settings.budget.totalEuros ?? ""} onChange={(event) => onChange({ budget: { ...settings.budget, totalEuros: optionalNumber(event.target.value) } })} />
        <small>Enveloppe publicitaire totale pour cette campagne : de 5 à 45 000 € dans iNrCy.</small>
      </label> : <label className={styles.field}>Budget quotidien moyen (€)
        <input type="number" min="5" max="500" step="0.01" required value={Number.isFinite(dailyBudget) ? dailyBudget : ""} onChange={(event) => onDailyChange(Number(event.target.value))} />
        <small>De 5 à 500 € par jour dans iNrCy. Ce montant est une moyenne.</small>
      </label>}
      <label className={styles.field}>Date de début{total ? "" : " — facultative"}
        <input type="date" value={settings.startDate ?? ""} min={today || undefined} required={total} onChange={(event) => onChange({ startDate: event.target.value || null })} />
        <small>{total ? "Un début et une fin fixes sont nécessaires pour le budget total." : "Sans date, la campagne pourra démarrer dès sa publication et son approbation."}</small>
      </label>
      <label className={styles.field}>Date de fin
        <input type="date" value={endDate} min={(total ? shiftDate(start, 2) : start) || undefined} max={total ? shiftDate(start, 89) || undefined : undefined} required onChange={(event) => onEndDateChange(event.target.value)} aria-invalid={invalidDuration || (days !== null && days < 1)} />
        <small>{total ? "Durée comprise entre 3 et 90 jours, dates incluses." : "La campagne s’arrête à cette date."}</small>
      </label>
    </div>
    <p>Dates du compte Google Ads : {timeZone || "fuseau horaire à vérifier"}.{days !== null && days > 0 ? ` Durée prévue : ${days} jour${days > 1 ? "s" : ""}.` : ""}</p>
    {invalidDuration && <p role="alert">Le budget total nécessite une campagne de 3 à 90 jours. Corrigez les dates.</p>}
    {total ? <p>Google répartit cette enveloppe sur la période. Les frais publicitaires facturés ne dépassent pas le budget total ; la dépense quotidienne peut varier. Le type de budget ne pourra plus être changé après création.</p>
      : <p>Google peut facturer jusqu’à deux fois le budget quotidien moyen certains jours et jusqu’à 30,4 fois ce montant sur un mois. Budget × durée reste une estimation, sans plafond total garanti pour votre période.</p>}
  </fieldset>;
}

export function GoogleAdsMeasurement({ resources, loading, error, onRefresh }: {
  resources: GoogleAdsAccountResources | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const actions = resources ? primaryActions(resources) : [];
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Conversions du compte Google Ads</legend>
    <p>La campagne reprend les objectifs de conversion définis par défaut dans votre compte. L’action décrite dans votre projet guide les textes ; elle ne crée pas de conversion Google.</p>
    <button type="button" className={styles.secondaryButton} onClick={onRefresh} disabled={loading}>{loading ? "Vérification en cours…" : "Actualiser les conversions"}</button>
    {error && <p role="alert">{error}</p>}
    {!loading && !error && !resources && <p role="status">Les objectifs du compte n’ont pas encore été vérifiés.</p>}
    {resources && <>
      <p>Compte {resources.selectedAccountId} · {resources.timeZone} · objectifs du compte</p>
      <div aria-live="polite">
        {actions.length ? <><strong>Conversions principales actives utilisées pour les enchères</strong><ul>{actions.map((action) => <li key={action.resourceName}>{action.name}</li>)}</ul></>
          : <p>Aucune conversion principale active rattachée à un objectif utilisable pour les enchères n’a été confirmée.</p>}
      </div>
      {resources.conversionActions.some((action) => !actions.some((primary) => primary.resourceName === action.resourceName)) && <details>
        <summary>Autres actions de conversion du compte</summary>
        <ul>{resources.conversionActions.filter((action) => !actions.some((primary) => primary.resourceName === action.resourceName)).map((action) => <li key={action.resourceName}>{action.name} — {action.primaryForGoal ? "objectif non utilisé pour les enchères" : "action secondaire"}</li>)}</ul>
      </details>}
      <p>La présence d’une conversion active ne confirme pas que la balise fonctionne. Vérifiez les déclenchements et les valeurs dans Google Ads avant de choisir une optimisation par conversions.</p>
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
  const settings = draft.googleDeliverySettings || defaultGoogleDeliverySettings();
  const matchingResources = resources && resources.selectedAccountId === draft.adAccountId.replace(/-/g, "") ? resources : null;
  const actions = matchingResources ? primaryActions(matchingResources) : [];
  let bidDetail = "";
  if (draft.bidStrategy === "maximize_clicks") bidDetail = settings.bidding.cpcBidCeilingEuros === null ? "Sans plafond CPC" : `Plafond CPC : ${money(settings.bidding.cpcBidCeilingEuros)}`;
  if (draft.bidStrategy === "manual_review") bidDetail = settings.bidding.manualCpcEuros === null ? "CPC à renseigner" : `CPC : ${money(settings.bidding.manualCpcEuros)}`;
  if (draft.bidStrategy === "maximize_conversions" || draft.bidStrategy === "target_cpa") bidDetail = settings.bidding.targetCpaEuros === null ? draft.bidStrategy === "target_cpa" ? "CPA cible à renseigner" : "Sans CPA cible" : `CPA cible : ${money(settings.bidding.targetCpaEuros)}`;
  if (draft.bidStrategy === "maximize_value" || draft.bidStrategy === "target_roas") bidDetail = settings.bidding.targetRoas === null ? draft.bidStrategy === "target_roas" ? "ROAS cible à renseigner" : "Sans ROAS cible" : `ROAS cible : ${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(settings.bidding.targetRoas * 100)} %`;
  const total = settings.budget.type === "total";
  const startLabel = settings.startDate ? calendarLabel(settings.startDate) : total ? "Début à renseigner" : "Dès publication et approbation";
  const rows = [
    ["Type de campagne", draft.campaignType === "search" ? "Réseau de recherche · annonce responsive textuelle" : "Format conservé en brouillon, publication non prise en charge"],
    ["Zones géographiques", draft.targetLocations.join(" ; ") || "À renseigner"],
    ["Option géographique", settings.geoTargetType === "PRESENCE" ? "Présence dans les zones ou fréquentation régulière" : "Présence ou intérêt pour les zones"],
    ["Mots-clés", nativeKeywords(draft.keywords, settings.keywordMatchType)],
    ["Mots-clés exclus", nativeKeywords(draft.negativeKeywords, settings.negativeKeywordMatchType)],
    ["Réseaux", ["Recherche Google", draft.googleSearchPartners && "Partenaires de recherche", draft.googleDisplayExpansion && "Extension Display"].filter(Boolean).join(" · ")],
    ["Enchères", `${strategyLabels[draft.bidStrategy] || "Stratégie à vérifier"}${bidDetail ? ` · ${bidDetail}` : ""}`],
    ["Budget", total ? settings.budget.totalEuros === null ? "Total à renseigner" : `${money(settings.budget.totalEuros)} au total` : `${money(draft.dailyBudgetEuros)} par jour en moyenne`],
    ["Calendrier", `${startLabel} → ${calendarLabel(draft.endDate)} · ${matchingResources?.timeZone || "fuseau du compte à vérifier"}`],
    ["Conversions pour les enchères", !matchingResources ? "Objectifs du compte à vérifier" : actions.map((action) => action.name).join(" ; ") || "Aucune conversion principale active confirmée"],
    ["Langue", "Google adapte Search à la langue des annonces et de la page de destination"],
    ["Chemin affiché", [settings.responsiveSearchAd.path1, settings.responsiveSearchAd.path2].filter(Boolean).join(" / ") || "Domaine uniquement"],
  ];
  return <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
    <legend>Réglages qui seront transmis à Google Search</legend>
    <dl className={styles.studioReviewGrid}>
      {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <p>{total ? "Le budget total est une enveloppe publicitaire de campagne." : "Le budget quotidien est une moyenne ; aucune enveloppe totale stricte n’est garantie."} Les conversions reprennent les objectifs du compte, sans créer de nouvelle balise.</p>
  </fieldset>;
}
