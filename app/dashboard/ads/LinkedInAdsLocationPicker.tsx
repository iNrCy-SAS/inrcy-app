"use client";

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
  const id = useId();
  const [choices, setChoices] = useState<Record<string, string>>({});
  return <div className={styles.panel} data-linkedin-location-picker="true">
    <div className={styles.heading}><div><strong>Confirmer les zones proposées</strong><p>Une ligne par lieu. Vérifiez la région et le pays, puis ajustez le choix si nécessaire.</p></div><span className={styles.badge}>{targets.length} / 20 zones</span></div>
    <div className={styles.locationRows}>
      {resolutions.map((entry, index) => {
        const preferredUrn = Object.hasOwn(choices, entry.query) ? choices[entry.query] : entry.autoSelectedUrn;
        const matches = targets.filter((target) => entry.suggestions.some((option) => option.urn === target.urn));
        const selected = preferredUrn ? matches.find((target) => target.urn === preferredUrn) : !entry.autoSelectedUrn && !Object.hasOwn(choices, entry.query) && matches.length === 1 ? matches[0] : undefined;
        const options = selected && !entry.suggestions.some((option) => option.urn === selected.urn) ? [selected, ...entry.suggestions] : entry.suggestions;
        const verified = Boolean(selected && verifiedUrns.has(selected.urn));
        return <div className={styles.locationRow} key={entry.query.toLocaleLowerCase("fr")}>
          <label htmlFor={`${id}-${index}`}>{entry.query}</label>
          <select id={`${id}-${index}`} aria-label={`Zone LinkedIn pour ${entry.query}`} value={selected?.urn || ""} disabled={busy || (!selected && targets.length >= 20)} onChange={(event) => { setChoices((current) => ({ ...current, [entry.query]: event.target.value })); onChoiceRecorded(entry.query, event.target.value); onChoose(selected?.urn || "", options.find((option) => option.urn === event.target.value) || null); }}>
            <option value="">{entry.status === "provider_rejected" ? "Recherche à relancer" : options.length ? "Choisir la bonne zone…" : busy ? "Recherche en cours…" : "Aucune correspondance disponible"}</option>
            {options.map((option) => <option value={option.urn} key={option.urn}>{option.name}</option>)}
          </select>
          <span className={styles.status} data-ready={verified || undefined}>{verified ? "Vérifiée" : selected ? "Vérification…" : "À choisir"}</span>
        </div>;
      })}
    </div>
    <div className={styles.searchRow}>
      <label htmlFor={`${id}-search`} className={styles.srOnly}>Rechercher une autre ville, région ou pays</label>
      <input id={`${id}-search`} value={query} maxLength={80} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && query.trim().length >= 2 && !busy) { event.preventDefault(); onSearch(); } }} placeholder="Ajouter une ville, une région ou un pays…" />
      <button type="button" disabled={busy || query.trim().length < 2} onClick={onSearch}>{busy ? "Recherche…" : "Rechercher"}</button>
    </div>
    {targets.length > 0 && <details className={styles.details}><summary>Voir les {targets.length} zones retenues</summary><ul className={styles.chips}>{targets.map((target) => <li key={target.urn} data-ready={verifiedUrns.has(target.urn) || undefined}><span>{target.name}</span><button type="button" aria-label={`Retirer ${target.name}`} onClick={() => onRemove(target.urn)}>×</button></li>)}</ul></details>}
    <small>Seules les zones sélectionnées et vérifiées sont utilisées pour la diffusion.</small>
  </div>;
}
