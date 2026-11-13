"use client";

import { useLocale, useTranslations } from "next-intl";
import { adsUiText } from "./adsUiCopy";


import { createAdsApiRequestError } from "./adsClientHttp";
import { useAdsErrorMessage } from "./useAdsErrorMessage";
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
function prettyDate(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function calendarDate(value: string, locale: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale, { dateStyle: "medium", timeZone: "UTC" }) : "—";
}

export function LinkedInAdsCallToAction({ value, onChange }: { value: LinkedInDeliverySettings["callToAction"]; onChange: (value: LinkedInDeliverySettings["callToAction"]) => void }) {
  const i18nT = useTranslations("booster");
  return <label className={styles.field}>{i18nT("bouton_de_l_annonce_2c7567c0")}<select value={value} onChange={(event) => onChange(event.target.value as LinkedInDeliverySettings["callToAction"])}>{LINKEDIN_CALL_TO_ACTIONS.map((cta) => <option value={cta} key={cta}>{adsUiText(i18nT, LINKEDIN_CTA_LABELS[cta] || cta)}</option>)}</select><small>{i18nT("ce_bouton_sera_transmis_a_linkedin_da346eff")}</small></label>;
}

export function LinkedInAdsDistribution({ accountId, settings, active, objective, onChange }: { accountId: string; settings: LinkedInDeliverySettings; active: boolean; objective: string; onChange: (settings: LinkedInDeliverySettings) => void }) {
  const i18nT = useTranslations("booster");
  const errorMessage = useAdsErrorMessage();
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
        if (!response.ok) throw createAdsApiRequestError(data, response.status);
        for (const option of Array.isArray(data.options) ? data.options : []) {
          if (typeof option?.urn === "string" && typeof option?.name === "string") found.set(option.urn, option);
        }
        if (!data.paging?.hasMore) { if (!controller.signal.aborted) setConversions([...found.values()]); return; }
        const count = Number(data.paging.count);
        if (!Number.isInteger(count) || count <= 0) throw new Error("LinkedIn n’a pas fourni une pagination valide. Actualisez les conversions.");
        start += count;
      }
      throw new Error("Le compte possède une longue liste de conversions. Affinez-la dans LinkedIn avant de l’actualiser ici.");
    })().catch((failure) => { if (!controller.signal.aborted) setError(errorMessage(failure, "agent.verification_indisponible_83dd6d8c")); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [active, accountId, revision, errorMessage]);
  const conversionRequired = objective === "WEBSITE_CONVERSION";
  return <div className={styles.panel} data-linkedin-distribution="true">
    <div className={styles.heading}><div><strong>{i18nT("emplacements_et_mesure_3c04157a")}</strong><p>{i18nT("choisissez_ou_diffuser_et_les_actions_0220af6c")}</p></div></div>
    <label className={styles.toggle}><input type="checkbox" checked={settings.placements.audienceNetwork} onChange={(event) => onChange({ ...settings, placements: { ...settings.placements, audienceNetwork: event.target.checked } })} /><span>{i18nT("diffuser_aussi_sur_linkedin_audience_network_86f32475")}<small>{i18nT("autorise_les_sites_et_applications_partenaires_7846a801")}</small></span></label>
    <label className={styles.toggle}><input type="checkbox" checked={settings.placements.audienceExpansion} onChange={(event) => onChange({ ...settings, placements: { ...settings.placements, audienceExpansion: event.target.checked } })} /><span>{i18nT("autoriser_l_extension_d_audience_d5ccf243")}<small>{i18nT("linkedin_peut_elargir_les_criteres_professionnel_a69d73a3")}</small></span></label>
    <label className={styles.field}>{i18nT("conversions_du_compte_39593bee")}{" "}{conversionRequired ? i18nT("obligatoire_187dd41a") : i18nT("facultatif_09e43d87")}<select value="" disabled={busy || !conversions.length || settings.conversions.conversionUrns.length >= 20} onChange={(event) => { const urn = event.target.value; if (urn && settings.conversions.conversionUrns.length < 20) onChange({ ...settings, conversions: { conversionUrns: [...new Set([...settings.conversions.conversionUrns, urn])] } }); }}><option value="">{busy ? i18nT("verification_des_conversions_d515d75b") : conversions.length ? i18nT("ajouter_une_conversion_existante_4b793fa7") : i18nT("aucune_conversion_disponible_dans_ce_compte_ce9d80c5")}</option>{conversions.map((conversion) => <option key={conversion.urn} value={conversion.urn} disabled={conversion.enabled === false || settings.conversions.conversionUrns.includes(conversion.urn)}>{conversion.name}{conversion.enabled === false ? i18nT("desactivee_e3dbe618") : ""}</option>)}</select></label>
    {settings.conversions.conversionUrns.length > 0 && <ul className={styles.chips}>{settings.conversions.conversionUrns.map((urn) => { const conversion = conversions.find((item) => item.urn === urn); return <li key={urn}><span>{conversion?.name || i18nT("conversion_selectionnee_verification_en_cours_2e8e7e52")}</span><button type="button" aria-label={conversion?.name ? i18nT("retirer_value_c04cdfcb", { value0: conversion.name }) : i18nT("ads_linkedin_remove_conversion")} onClick={() => onChange({ ...settings, conversions: { conversionUrns: settings.conversions.conversionUrns.filter((value) => value !== urn) } })}>×</button></li>; })}</ul>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.actions}><button type="button" disabled={busy || !accountId} onClick={() => setRevision((value) => value + 1)}>{i18nT("actualiser_les_conversions_9e835657")}</button></div>
    <small>{i18nT("les_conversions_selectionnees_seront_associees_a_625d9ee3")}</small>
    {conversionRequired && !settings.conversions.conversionUrns.length && <p className={styles.error} role="alert">{i18nT("l_objectif_conversions_du_site_necessite_735626ec")}</p>}
  </div>;
}

export function LinkedInAdsBudget({ settings, dailyBudget, endDate, bid, objective, pricing, onChange, onDailyChange, onEndDateChange, onBidChange }: {
  settings: LinkedInDeliverySettings; dailyBudget: number; endDate: string; bid?: number; objective: string;
  pricing: { bidMin: number; bidMax: number; dailyBudgetMin: number } | null;
  onChange: (settings: LinkedInDeliverySettings) => void; onDailyChange: (value: number) => void; onEndDateChange: (value: string) => void; onBidChange: (value: number | undefined) => void;
}) {
  const i18nT = useTranslations("booster");
  const locale = useLocale();
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
    <div className={styles.heading}><div><strong>{i18nT("budget_et_calendrier_44488f64")}</strong><p>{i18nT("fixez_votre_rythme_ou_votre_enveloppe_d1030952")}</p></div><span className={styles.badge}>{i18nT("ads_ui_57d4846cec")}</span></div>
    <div className={styles.grid}>
      <label className={styles.field}>{i18nT("type_de_budget_7e3d4089")}<select value={settings.budget.type} onChange={(event) => onChange({ ...settings, budget: { ...settings.budget, type: event.target.value as "daily" | "total", totalEuros: settings.budget.totalEuros || Math.round(dailyBudget * duration * 100) / 100, endAt: settings.budget.endAt || isoDateTime(endInput) } })}><option value="daily">{i18nT("budget_quotidien_moyen_0c02d0b4")}</option><option value="total">{i18nT("budget_total_sur_la_periode_b17241cc")}</option></select></label>
      {totalMode ? <label className={styles.field}>{i18nT("budget_total_97aca19f")}<input type="number" min="5" max="45000" step="0.01" value={settings.budget.totalEuros ?? ""} onChange={(event) => onChange({ ...settings, budget: { ...settings.budget, totalEuros: event.target.value ? Number(event.target.value) : null } })} /><small>{i18nT("enveloppe_publicitaire_totale_transmise_a_linked_15698a6a")}</small></label> : <label className={styles.field}>{i18nT("budget_quotidien_moyen_8d3aa62f")}<input type="number" min={pricing?.dailyBudgetMin || 5} max="500" step="0.01" value={dailyBudget} onChange={(event) => onDailyChange(Number(event.target.value))} /><small>{pricing ? i18nT("minimum_verifie_value_par_jour_4246b2a8", { value0: pricing.dailyBudgetMin.toLocaleString(locale) }) : i18nT("le_minimum_sera_verifie_aupres_de_e6679271")}</small></label>}
      <label className={styles.field}>{i18nT("debut_de_diffusion_0508eb90")}<select value={start ? "scheduled" : "now"} onChange={(event) => onChange({ ...settings, budget: { ...settings.budget, startAt: event.target.value === "scheduled" ? new Date(Date.now() + 86_400_000).toISOString() : null } })}><option value="now">{i18nT("des_la_validation_de_linkedin_1f84bd29")}</option><option value="scheduled">{i18nT("choisir_une_date_et_une_heure_f4ff52cf")}</option></select>{start && <input aria-label={i18nT("date_et_heure_de_debut_19b1db6a")} type="datetime-local" value={localDateTime(start)} onChange={(event) => onChange({ ...settings, budget: { ...settings.budget, startAt: isoDateTime(event.target.value) } })} />}</label>
      <label className={styles.field}>{i18nT("date_et_heure_de_fin_497c7ee8")}<input type="datetime-local" value={endInput} onChange={(event) => { const endAt = isoDateTime(event.target.value); if (endAt) { onChange({ ...settings, budget: { ...settings.budget, endAt } }); onEndDateChange(event.target.value.slice(0, 10)); } }} /><small>{i18nT("heures_affichees_dans_votre_fuseau_value_81f7ebfb", { value0: timeZone })}</small></label>
      <label className={styles.field}>{i18nT("strategie_d_encheres_d2f40380")}<select value={settings.bidding.strategy} onChange={(event) => onChange({ ...settings, bidding: { ...settings.bidding, strategy: event.target.value as LinkedInDeliverySettings["bidding"]["strategy"] } })}><option value="maximum_delivery">{i18nT("diffusion_maximale_linkedin_optimise_5628acca")}</option>{objective !== "BRAND_AWARENESS" && objective !== "VIDEO_VIEW" && <option value="manual_cpc">{i18nT("enchere_manuelle_au_clic_5f6ec65a")}</option>}{objective !== "WEBSITE_CONVERSION" && <option value="cost_cap">{i18nT("cout_cible_moyen_c7d4a560")}</option>}</select><small>{manual ? i18nT("vous_fixez_le_montant_maximal_d_f7aa8c05") : costCap ? i18nT("linkedin_vise_un_cout_moyen_ce_00d3c2b2") : i18nT("linkedin_regle_les_encheres_pour_rechercher_b04737b8")}</small></label>
      {(manual || costCap) && <label className={styles.field}>{manual ? i18nT("enchere_maximale_par_clic_09695092") : i18nT("cout_cible_moyen_02d808b7")}<input type="number" min={manual ? pricing?.bidMin || 0.01 : 0.01} max={manual ? Math.min(pricing?.bidMax || dailyBudget, totalMode ? settings.budget.totalEuros || dailyBudget : dailyBudget) : 500} step="0.01" value={settings.bidding.amountEuros ?? bid ?? ""} onChange={(event) => { const amountEuros = event.target.value ? Number(event.target.value) : null; onChange({ ...settings, bidding: { ...settings.bidding, amountEuros } }); if (manual) onBidChange(amountEuros ?? undefined); }} /><small>{manual && pricing ? i18nT("plage_verifiee_value_a_value_c9bf0484", { value0: pricing.bidMin.toLocaleString(locale), value1: pricing.bidMax.toLocaleString(locale) }) : i18nT("montant_a_faire_valider_par_linkedin_9fdaeb01")}</small></label>}
    </div>
    <div className={styles.notice}><strong>{totalMode ? i18nT("budget_total_b930ffdc") : i18nT("enveloppe_calculee_sur_la_periode_19c9cdbe")} : {typeof amount === "number" && Number.isFinite(amount) ? amount.toLocaleString(locale, { style: "currency", currency: "EUR" }) : i18nT("a_renseigner_fcd86e53")}</strong><p>{totalMode ? i18nT("linkedin_repartit_cette_enveloppe_sur_le_a9dab244") : i18nT("le_budget_quotidien_est_une_moyenne_b818cba0")} {" "}{i18nT("le_statut_active_ou_en_pause_e96698f7")}</p></div>
  </div>;
}

export function LinkedInAdsEffectiveSummary({ settings, dailyBudget, endDate, zones }: { settings: LinkedInDeliverySettings; dailyBudget: number; endDate: string; zones: string[] }) {
  const i18nT = useTranslations("booster");
  const locale = useLocale();
  const audienceName = (target: LinkedInDeliverySettings["professionalTargeting"]["include"][number]) => {
    const name = linkedInAudienceDisplayName(target);
    return target.facet === "companySizes" && name === "Indépendant" ? i18nT("ads_linkedin_self_employed") : name;
  };
  return <div className={styles.panel} data-linkedin-effective-summary="true"><strong>{i18nT("reglages_qui_seront_transmis_a_linkedin_1e7b1f58")}</strong><div className={styles.summary}><span><b>{i18nT("zones_5ddcc9fd")}</b> {zones.join(" · ") || i18nT("a_selectionner_51ca6f8a")} · {settings.locationType === "permanent" ? i18nT("residence_permanente_10c941dd") : i18nT("residence_ou_presence_recente_6daa20c7")}</span>{Object.entries(LINKEDIN_AUDIENCE_FACET_LABELS).map(([facet, label]) => { const selected = settings.professionalTargeting.include.filter((target) => target.facet === facet); return selected.length ? <span key={facet}><b>{adsUiText(i18nT, label)} :</b> {selected.map(audienceName).join(` ${i18nT("ads_linkedin_audience_or")} `)}</span> : null; })}<span><b>{i18nT("exclusions_09c0d084")}</b> {settings.professionalTargeting.exclude.map(audienceName).join(" · ") || i18nT("aucune_e8f88273")}</span><span><b>{i18nT("placements_550e3eae")}</b> {" "}{i18nT("linkedin_6b6390a4")}{settings.placements.audienceNetwork ? i18nT("et_sites_partenaires_d3ae252e") : i18nT("ads_ui_2362512428")} {" "}{i18nT("extension_d_audience_3d224487")}{" "}{settings.placements.audienceExpansion ? i18nT("autorisee_e2fde3bc") : i18nT("desactivee_72423e84")}</span><span><b>{i18nT("budget_ff6031d6")}</b> {settings.budget.type === "total" ? i18nT("value_au_total_c990d9bf", { value0: settings.budget.totalEuros?.toLocaleString(locale) ?? "—" }) : i18nT("value_par_jour_c3db45bd", { value0: dailyBudget.toLocaleString(locale) })} · {prettyDate(settings.budget.startAt, locale, i18nT("des_la_validation_de_linkedin_1f84bd29"))} → {settings.budget.endAt ? prettyDate(settings.budget.endAt, locale, "—") : i18nT("value_a_23_59_utc_e70caa51", { value0: calendarDate(endDate, locale) })}</span><span><b>{i18nT("encheres_39a7aac3")}</b> {settings.bidding.strategy === "maximum_delivery" ? i18nT("diffusion_maximale_738cf3c0") : settings.bidding.strategy === "cost_cap" ? i18nT("cout_cible_moyen_c7d4a560") : i18nT("cpc_manuel_ea29c29b")} · <b>{i18nT("bouton_ef0a9f65")}</b> {adsUiText(i18nT, LINKEDIN_CTA_LABELS[settings.callToAction])} · <b>{i18nT("conversions_fd5b1610")}</b> {i18nT("ads_linkedin_linked_count", { count: settings.conversions.conversionUrns.length })}</span></div></div>;
}
