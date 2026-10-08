"use client";

import { useEffect, useState } from "react";
import { LINKEDIN_CALL_TO_ACTIONS, type LinkedInDeliverySettings } from "@/lib/adsLinkedInCampaignSettings";
import { LINKEDIN_AUDIENCE_FACET_LABELS, linkedInAudienceDisplayName } from "@/lib/adsLinkedInAudienceSuggestions";
import styles from "./linkedin-campaign.module.css";

export const LINKEDIN_CTA_LABELS: Record<string, string> = {
  APPLY: "Postuler", DOWNLOAD: "Télécharger", VIEW_QUOTE: "Demander un devis", LEARN_MORE: "En savoir plus",
  SIGN_UP: "S’inscrire", SUBSCRIBE: "S’abonner", REGISTER: "S’enregistrer", JOIN: "Rejoindre", ATTEND: "Participer",
  REQUEST_DEMO: "Demander une démonstration", SEE_MORE: "Voir plus", BUY_NOW: "Acheter", SHOP_NOW: "Acheter maintenant",
};
type Conversion = { urn: string; name: string; type?: string; enabled?: boolean; attributionType?: string; postClickAttributionWindowSize?: number; viewThroughAttributionWindowSize?: number };
function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
}
function isoDateTime(value: string) { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date.toISOString() : null; }
function prettyDate(value: string | null) { return value ? new Date(value).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "Dès la validation de LinkedIn"; }

export function LinkedInAdsCallToAction({ value, onChange }: { value: LinkedInDeliverySettings["callToAction"]; onChange: (value: LinkedInDeliverySettings["callToAction"]) => void }) {
  return <label className={styles.field}>Bouton de l’annonce<select value={value} onChange={(event) => onChange(event.target.value as LinkedInDeliverySettings["callToAction"])}>{LINKEDIN_CALL_TO_ACTIONS.map((cta) => <option value={cta} key={cta}>{LINKEDIN_CTA_LABELS[cta] || cta}</option>)}</select><small>Ce bouton sera transmis à LinkedIn avec votre lien.</small></label>;
}

export function LinkedInAdsDistribution({ accountId, settings, active, objective, onChange }: { accountId: string; settings: LinkedInDeliverySettings; active: boolean; objective: string; onChange: (settings: LinkedInDeliverySettings) => void }) {
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active || !accountId) return;
    const controller = new AbortController();
    setBusy(true); setError("");
    setConversions([]);
    void (async () => {
      const found = new Map<string, Conversion>();
      let start = 0;
      for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({ account: accountId, start: String(start), count: "100" });
        const response = await fetch(`/api/ads/linkedin/conversions?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Les conversions LinkedIn ne sont pas disponibles.");
        for (const option of Array.isArray(data.options) ? data.options : []) {
          if (typeof option?.urn === "string" && typeof option?.name === "string") found.set(option.urn, option);
        }
        if (!data.paging?.hasMore) { if (!controller.signal.aborted) setConversions([...found.values()]); return; }
        const count = Number(data.paging.count);
        if (!Number.isInteger(count) || count <= 0) throw new Error("LinkedIn n’a pas fourni une pagination valide. Actualisez les conversions.");
        start += count;
      }
      throw new Error("Le compte possède une longue liste de conversions. Affinez-la dans LinkedIn avant de l’actualiser ici.");
    })().catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Vérification indisponible"); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [active, accountId, revision]);
  const conversionRequired = objective === "WEBSITE_CONVERSION";
  return <div className={styles.panel} data-linkedin-distribution="true">
    <div className={styles.heading}><div><strong>Emplacements et mesure</strong><p>Choisissez où diffuser et les actions que LinkedIn doit mesurer.</p></div></div>
    <label className={styles.toggle}><input type="checkbox" checked={settings.placements.audienceNetwork} onChange={(event) => onChange({ ...settings, placements: { ...settings.placements, audienceNetwork: event.target.checked } })} /><span>Diffuser aussi sur LinkedIn Audience Network<small>Autorise les sites et applications partenaires compatibles avec le format.</small></span></label>
    <label className={styles.toggle}><input type="checkbox" checked={settings.placements.audienceExpansion} onChange={(event) => onChange({ ...settings, placements: { ...settings.placements, audienceExpansion: event.target.checked } })} /><span>Autoriser l’extension d’audience<small>LinkedIn peut élargir les critères professionnels à des profils similaires dans les zones choisies.</small></span></label>
    <label className={styles.field}>Conversions du compte {conversionRequired ? "· Obligatoire" : "· Facultatif"}<select value="" disabled={busy || !conversions.length || settings.conversions.conversionUrns.length >= 20} onChange={(event) => { const urn = event.target.value; if (urn && settings.conversions.conversionUrns.length < 20) onChange({ ...settings, conversions: { conversionUrns: [...new Set([...settings.conversions.conversionUrns, urn])] } }); }}><option value="">{busy ? "Vérification des conversions…" : conversions.length ? "Ajouter une conversion existante…" : "Aucune conversion disponible dans ce compte"}</option>{conversions.map((conversion) => <option key={conversion.urn} value={conversion.urn} disabled={conversion.enabled === false || settings.conversions.conversionUrns.includes(conversion.urn)}>{conversion.name}{conversion.enabled === false ? " · désactivée" : ""}</option>)}</select></label>
    {settings.conversions.conversionUrns.length > 0 && <ul className={styles.chips}>{settings.conversions.conversionUrns.map((urn) => { const conversion = conversions.find((item) => item.urn === urn); return <li key={urn}><span>{conversion?.name || "Conversion sélectionnée · vérification en cours"}</span><button type="button" aria-label={`Retirer ${conversion?.name || "la conversion"}`} onClick={() => onChange({ ...settings, conversions: { conversionUrns: settings.conversions.conversionUrns.filter((value) => value !== urn) } })}>×</button></li>; })}</ul>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.actions}><button type="button" disabled={busy || !accountId} onClick={() => setRevision((value) => value + 1)}>Actualiser les conversions</button></div>
    <small>Les conversions sélectionnées seront associées à la campagne. Leur présence ne prouve pas que la balise du site ou la transmission des événements fonctionne : vérifiez cette source dans LinkedIn.</small>
    {conversionRequired && !settings.conversions.conversionUrns.length && <p className={styles.error} role="alert">L’objectif Conversions du site nécessite au moins une conversion active du compte.</p>}
  </div>;
}

export function LinkedInAdsBudget({ settings, dailyBudget, endDate, bid, objective, pricing, onChange, onDailyChange, onEndDateChange, onBidChange }: {
  settings: LinkedInDeliverySettings; dailyBudget: number; endDate: string; bid?: number; objective: string;
  pricing: { bidMin: number; bidMax: number; dailyBudgetMin: number } | null;
  onChange: (settings: LinkedInDeliverySettings) => void; onDailyChange: (value: number) => void; onEndDateChange: (value: string) => void; onBidChange: (value: number | undefined) => void;
}) {
  const start = settings.budget.startAt;
  const finish = settings.budget.endAt;
  const endInput = localDateTime(finish || `${endDate}T23:59:59Z`);
  const totalMode = settings.budget.type === "total";
  const manual = settings.bidding.strategy === "manual_cpc";
  const costCap = settings.bidding.strategy === "cost_cap";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const duration = Math.max(1, Math.ceil(((finish ? Date.parse(finish) : Date.parse(`${endDate}T23:59:59Z`)) - (start ? Date.parse(start) : Date.now())) / 86_400_000));
  const amount = totalMode ? settings.budget.totalEuros : dailyBudget * duration;
  return <div className={styles.panel} data-linkedin-budget="true">
    <div className={styles.heading}><div><strong>Budget et calendrier</strong><p>Fixez votre rythme ou votre enveloppe totale, puis les dates de diffusion.</p></div><span className={styles.badge}>EUR</span></div>
    <div className={styles.grid}>
      <label className={styles.field}>Type de budget<select value={settings.budget.type} onChange={(event) => onChange({ ...settings, budget: { ...settings.budget, type: event.target.value as "daily" | "total", totalEuros: settings.budget.totalEuros || Math.round(dailyBudget * duration * 100) / 100, endAt: settings.budget.endAt || isoDateTime(endInput) } })}><option value="daily">Budget quotidien moyen</option><option value="total">Budget total sur la période</option></select></label>
      {totalMode ? <label className={styles.field}>Budget total (€)<input type="number" min="5" max="45000" step="0.01" value={settings.budget.totalEuros ?? ""} onChange={(event) => onChange({ ...settings, budget: { ...settings.budget, totalEuros: event.target.value ? Number(event.target.value) : null } })} /><small>Enveloppe publicitaire totale transmise à LinkedIn.</small></label> : <label className={styles.field}>Budget quotidien moyen (€)<input type="number" min={pricing?.dailyBudgetMin || 5} max="500" step="0.01" value={dailyBudget} onChange={(event) => onDailyChange(Number(event.target.value))} /><small>{pricing ? `Minimum vérifié : ${pricing.dailyBudgetMin.toLocaleString("fr-FR")} € par jour.` : "Le minimum sera vérifié auprès de LinkedIn."}</small></label>}
      <label className={styles.field}>Début de diffusion<select value={start ? "scheduled" : "now"} onChange={(event) => onChange({ ...settings, budget: { ...settings.budget, startAt: event.target.value === "scheduled" ? new Date(Date.now() + 86_400_000).toISOString() : null } })}><option value="now">Dès la validation de LinkedIn</option><option value="scheduled">Choisir une date et une heure</option></select>{start && <input aria-label="Date et heure de début" type="datetime-local" value={localDateTime(start)} onChange={(event) => onChange({ ...settings, budget: { ...settings.budget, startAt: isoDateTime(event.target.value) } })} />}</label>
      <label className={styles.field}>Date et heure de fin<input type="datetime-local" value={endInput} onChange={(event) => { const endAt = isoDateTime(event.target.value); if (endAt) { onChange({ ...settings, budget: { ...settings.budget, endAt } }); onEndDateChange(event.target.value.slice(0, 10)); } }} /><small>Heures affichées dans votre fuseau : {timeZone}.</small></label>
      <label className={styles.field}>Stratégie d’enchères<select value={settings.bidding.strategy} onChange={(event) => onChange({ ...settings, bidding: { ...settings.bidding, strategy: event.target.value as LinkedInDeliverySettings["bidding"]["strategy"] } })}><option value="maximum_delivery">Diffusion maximale · LinkedIn optimise</option>{objective !== "BRAND_AWARENESS" && objective !== "VIDEO_VIEW" && <option value="manual_cpc">Enchère manuelle au clic</option>}{objective !== "WEBSITE_CONVERSION" && <option value="cost_cap">Coût cible moyen</option>}</select><small>{manual ? "Vous fixez le montant maximal d’un clic." : costCap ? "LinkedIn vise un coût moyen ; ce n’est pas un plafond garanti pour chaque résultat." : "LinkedIn règle les enchères pour rechercher les résultats de l’objectif choisi."}</small></label>
      {(manual || costCap) && <label className={styles.field}>{manual ? "Enchère maximale par clic (€)" : "Coût cible moyen (€)"}<input type="number" min={manual ? pricing?.bidMin || 0.01 : 0.01} max={manual ? Math.min(pricing?.bidMax || dailyBudget, totalMode ? settings.budget.totalEuros || dailyBudget : dailyBudget) : 500} step="0.01" value={settings.bidding.amountEuros ?? bid ?? ""} onChange={(event) => { const amountEuros = event.target.value ? Number(event.target.value) : null; onChange({ ...settings, bidding: { ...settings.bidding, amountEuros } }); if (manual) onBidChange(amountEuros ?? undefined); }} /><small>{manual && pricing ? `Plage vérifiée : ${pricing.bidMin.toLocaleString("fr-FR")} à ${pricing.bidMax.toLocaleString("fr-FR")} €.` : "Montant à faire valider par LinkedIn avant le lancement."}</small></label>}
    </div>
    <div className={styles.notice}><strong>{totalMode ? "Budget total" : "Enveloppe calculée sur la période"} : {typeof amount === "number" && Number.isFinite(amount) ? amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : "à renseigner"}</strong><p>{totalMode ? "LinkedIn répartit cette enveloppe sur le calendrier choisi." : "Le budget quotidien est une moyenne ; la dépense peut varier d’un jour à l’autre selon les règles LinkedIn."} Le statut Active ou En pause sera choisi lors de la validation.</p></div>
  </div>;
}

export function LinkedInAdsEffectiveSummary({ settings, dailyBudget, endDate, zones }: { settings: LinkedInDeliverySettings; dailyBudget: number; endDate: string; zones: string[] }) {
  return <div className={styles.panel} data-linkedin-effective-summary="true"><strong>Réglages qui seront transmis à LinkedIn</strong><div className={styles.summary}><span><b>Zones :</b> {zones.join(" · ") || "À sélectionner"} · {settings.locationType === "permanent" ? "résidence permanente" : "résidence ou présence récente"}</span>{Object.entries(LINKEDIN_AUDIENCE_FACET_LABELS).map(([facet, label]) => { const selected = settings.professionalTargeting.include.filter((target) => target.facet === facet); return selected.length ? <span key={facet}><b>{label} :</b> {selected.map(linkedInAudienceDisplayName).join(" OU ")}</span> : null; })}<span><b>Exclusions :</b> {settings.professionalTargeting.exclude.map(linkedInAudienceDisplayName).join(" · ") || "Aucune"}</span><span><b>Placements :</b> LinkedIn{settings.placements.audienceNetwork ? " et sites partenaires" : " uniquement"} · extension d’audience {settings.placements.audienceExpansion ? "autorisée" : "désactivée"}</span><span><b>Budget :</b> {settings.budget.type === "total" ? `${settings.budget.totalEuros ?? "—"} € au total` : `${dailyBudget} € par jour`} · {prettyDate(settings.budget.startAt)} → {settings.budget.endAt ? prettyDate(settings.budget.endAt) : `${endDate} à 23:59 UTC`}</span><span><b>Enchères :</b> {settings.bidding.strategy === "maximum_delivery" ? "Diffusion maximale" : settings.bidding.strategy === "cost_cap" ? "Coût cible moyen" : "CPC manuel"} · <b>Bouton :</b> {LINKEDIN_CTA_LABELS[settings.callToAction]} · <b>Conversions :</b> {settings.conversions.conversionUrns.length} associée(s)</span></div></div>;
}
