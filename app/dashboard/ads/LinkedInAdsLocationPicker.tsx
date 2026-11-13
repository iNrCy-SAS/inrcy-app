"use client";

import { useTranslations } from "next-intl";


import { useId, useState } from "react";
import styles from "./linkedin-campaign.module.css";

type Target = { urn: string; name: string };
type Resolution = { query: string; suggestions: Target[]; status?: string; autoSelectedUrn?: string | null };

export default function LinkedInAdsLocationPicker({ resolutions, targets, verifiedUrns, busy, query, onQueryChange, onSearch, onChoose, onRemove, onChoiceRecorded }: {
  resolutions: Resolution[];
  targets: Target[];
  verifiedUrns: Set<string>;
  busy: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onChoose: (previousUrn: string, target: Target | null) => void;
  onRemove: (urn: string) => void;
  onChoiceRecorded: (query: string, urn: string) => void;
}) {
  const i18nT = useTranslations("booster");
  const id = useId();
  const [choices, setChoices] = useState<Record<string, string>>({});
  return <div className={styles.panel} data-linkedin-location-picker="true">
    <div className={styles.heading}><div><strong>{i18nT("confirmer_les_zones_proposees_184f7772")}</strong><p>{i18nT("une_ligne_par_lieu_verifiez_la_c49d4752")}</p></div><span className={styles.badge}>{targets.length} / 20 zones</span></div>
    <div className={styles.locationRows}>
      {resolutions.map((entry, index) => {
        const preferredUrn = Object.hasOwn(choices, entry.query) ? choices[entry.query] : entry.autoSelectedUrn;
        const matches = targets.filter((target) => entry.suggestions.some((option) => option.urn === target.urn));
        const selected = preferredUrn ? matches.find((target) => target.urn === preferredUrn) : !entry.autoSelectedUrn && !Object.hasOwn(choices, entry.query) && matches.length === 1 ? matches[0] : undefined;
        const options = selected && !entry.suggestions.some((option) => option.urn === selected.urn) ? [selected, ...entry.suggestions] : entry.suggestions;
        const verified = Boolean(selected && verifiedUrns.has(selected.urn));
        return <div className={styles.locationRow} key={entry.query.toLocaleLowerCase("fr")}>
          <label htmlFor={`${id}-${index}`}>{entry.query}</label>
          <select id={`${id}-${index}`} aria-label={i18nT("zone_linkedin_pour_value_24a044d6", { value0: entry.query })} value={selected?.urn || ""} disabled={busy || (!selected && targets.length >= 20)} onChange={(event) => { setChoices((current) => ({ ...current, [entry.query]: event.target.value })); onChoiceRecorded(entry.query, event.target.value); onChoose(selected?.urn || "", options.find((option) => option.urn === event.target.value) || null); }}>
            <option value="">{entry.status === "provider_rejected" ? i18nT("recherche_a_relancer_ddaeb814") : options.length ? i18nT("choisir_la_bonne_zone_742a0ea9") : busy ? i18nT("recherche_en_cours_a16747f0") : i18nT("aucune_correspondance_disponible_c94c3e8c")}</option>
            {options.map((option) => <option value={option.urn} key={option.urn}>{option.name}</option>)}
          </select>
          <span className={styles.status} data-ready={verified || undefined}>{verified ? i18nT("verifiee_3fd06024") : selected ? i18nT("verification_30a67937") : i18nT("a_choisir_843d69a7")}</span>
        </div>;
      })}
    </div>
    <div className={styles.searchRow}>
      <label htmlFor={`${id}-search`} className={styles.srOnly}>{i18nT("rechercher_une_autre_ville_region_ou_c19ff0d8")}</label>
      <input id={`${id}-search`} value={query} maxLength={80} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && query.trim().length >= 2 && !busy) { event.preventDefault(); onSearch(); } }} placeholder={i18nT("ajouter_une_ville_une_region_ou_a8905e3f")} />
      <button type="button" disabled={busy || query.trim().length < 2} onClick={onSearch}>{busy ? i18nT("recherche_af776274") : i18nT("rechercher_91f7d3e9")}</button>
    </div>
    {targets.length > 0 && <details className={styles.details}><summary>{i18nT("voir_les_value_zones_retenues_1302367d", { value0: targets.length })}</summary><ul className={styles.chips}>{targets.map((target) => <li key={target.urn} data-ready={verifiedUrns.has(target.urn) || undefined}><span>{target.name}</span><button type="button" aria-label={i18nT("retirer_value_c04cdfcb", { value0: target.name })} onClick={() => onRemove(target.urn)}>×</button></li>)}</ul></details>}
    <small>{i18nT("seules_les_zones_selectionnees_et_verifiees_778de72e")}</small>
  </div>;
}
