"use client";

import { useEffect, useId, useRef, useState } from "react";
import { normalizeMetaAdsGeoTargets, type MetaAdsGeoTarget } from "@/lib/adsMetaResources";
import styles from "./ads.module.css";

export type MetaLocationRow = { query: string; options: MetaAdsGeoTarget[]; selected: MetaAdsGeoTarget | null };
const identity = (target: MetaAdsGeoTarget) => `${target.type}:${target.key}`;
const sameTarget = (left: MetaAdsGeoTarget, right: MetaAdsGeoTarget) => identity(left) === identity(right)
  && left.name === right.name && left.countryCode === right.countryCode && (left.region || "") === (right.region || "");
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Only the server's exact choice or an explicit, still verified choice is selected. */
export function metaLocationPickerRows(response: unknown, accountId: string, queries: readonly string[], targets: readonly MetaAdsGeoTarget[], choices: Readonly<Record<string, string>> = {}): MetaLocationRow[] {
  const body = object(response);
  if (body.selectedAccountId !== accountId) throw new Error("Le compte Meta Ads a changé. Revérifiez ses zones.");
  if (!Array.isArray(body.resolutions) || body.resolutions.length !== queries.length) throw new Error("Meta n’a pas répondu pour toutes les zones demandées.");
  return queries.map((query) => {
    const entries = (body.resolutions as unknown[]).map(object).filter((row) => row.query === query);
    if (entries.length !== 1 || !Array.isArray(entries[0].options) || entries[0].options.length > 100) throw new Error(`La zone « ${query} » doit être revérifiée dans Meta.`);
    const options = [...new Map(entries[0].options.map((value: unknown) => {
      const parsed = normalizeMetaAdsGeoTargets([value]);
      if (!parsed?.[0]) throw new Error("Meta a renvoyé une zone invalide. Réessayez la vérification.");
      return [identity(parsed[0]), parsed[0]] as const;
    })).values()];
    let selected: MetaAdsGeoTarget | null = null;
    if (Object.hasOwn(choices, query)) selected = options.find((option) => identity(option) === choices[query]) || null;
    else {
      const existing = options.filter((option) => targets.some((target) => sameTarget(target, option)));
      if (existing.length === 1) selected = existing[0];
      else if (entries[0].autoSelectedTarget != null) {
        const auto = normalizeMetaAdsGeoTargets([entries[0].autoSelectedTarget])?.[0];
        selected = auto ? options.find((option) => sameTarget(option, auto)) || null : null;
        if (!selected) throw new Error("Meta n’a pas confirmé son choix automatique dans les résultats natifs.");
      }
    }
    return { query, options, selected };
  });
}

export default function MetaAdsLocationPicker({ accountId, locations, targets, active, onChange, onReadyChange, onAddLocation }: {
  accountId: string;
  locations: string[];
  targets: MetaAdsGeoTarget[];
  active: boolean;
  onChange: (targets: MetaAdsGeoTarget[]) => void;
  onReadyChange: (ready: boolean, error: string) => void;
  onAddLocation?: (label: string) => void;
}) {
  const id = useId();
  const locationsKey = JSON.stringify([...new Set(locations.map((location) => location.trim()).filter(Boolean))]);
  const contextKey = `${accountId}\u0000${locationsKey}\u0000${active}`;
  const contextRef = useRef(contextKey); contextRef.current = contextKey;
  const callbacks = useRef({ onChange, onReadyChange, onAddLocation }); callbacks.current = { onChange, onReadyChange, onAddLocation };
  const targetsRef = useRef(targets); targetsRef.current = targets;
  const choices = useRef<{ accountId: string; values: Record<string, string> }>({ accountId, values: {} });
  const extraRequest = useRef<AbortController | null>(null);
  const [rows, setRows] = useState<MetaLocationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [extraOptions, setExtraOptions] = useState<MetaAdsGeoTarget[]>([]);
  const [extraLoading, setExtraLoading] = useState(false);
  const [extraError, setExtraError] = useState("");

  const report = (nextRows: MetaLocationRow[]) => {
    const selected = [...new Map(nextRows.flatMap((row) => row.selected ? [row.selected] : []).map((target) => [identity(target), target])).values()];
    if (JSON.stringify(selected) !== JSON.stringify(targetsRef.current)) { targetsRef.current = selected; callbacks.current.onChange(selected); }
    callbacks.current.onReadyChange(nextRows.length > 0 && nextRows.every((row) => row.selected !== null), nextRows.some((row) => !row.selected) ? "Choisissez une zone exacte pour chaque lieu du brief." : "");
  };
  const reportRef = useRef(report); reportRef.current = report;

  useEffect(() => {
    const controller = new AbortController();
    const expectedContext = contextKey;
    const queries = JSON.parse(locationsKey) as string[];
    extraRequest.current?.abort(); setExtraOptions([]); setExtraError(""); setExtraLoading(false);
    setRows([]); setError(""); callbacks.current.onReadyChange(false, "");
    if (choices.current.accountId !== accountId) choices.current = { accountId, values: {} };
    choices.current.values = Object.fromEntries(Object.entries(choices.current.values).filter(([name]) => queries.includes(name)));
    if (!active || !accountId || !queries.length || queries.length > 20 || queries.some((name) => name.length < 2 || name.length > 120)) {
      setLoading(false);
      const issue = !active ? "" : !accountId ? "Associez le compte Meta Ads pour vérifier les zones." : "Précisez entre une et vingt zones de 2 à 120 caractères.";
      setError(issue); callbacks.current.onReadyChange(false, issue);
      return () => controller.abort();
    }
    setLoading(true);
    const params = new URLSearchParams(); queries.forEach((name) => params.append("query", name));
    void (async () => {
      try {
        const response = await fetch(`/api/ads/meta/geography?${params}`, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json();
        if (controller.signal.aborted || contextRef.current !== expectedContext) return;
        if (!response.ok) throw new Error(typeof object(body).error === "string" ? String(object(body).error) : "Les zones Meta ne sont pas disponibles. Réessayez.");
        const nextRows = metaLocationPickerRows(body, accountId, queries, targetsRef.current, choices.current.values);
        setRows(nextRows); reportRef.current(nextRows);
      } catch (cause) {
        if (controller.signal.aborted || contextRef.current !== expectedContext) return;
        const issue = cause instanceof Error ? cause.message : "Meta n’a pas pu confirmer les zones.";
        setError(issue); callbacks.current.onReadyChange(false, issue);
      } finally { if (!controller.signal.aborted && contextRef.current === expectedContext) setLoading(false); }
    })();
    return () => { controller.abort(); extraRequest.current?.abort(); };
  }, [accountId, locationsKey, active, revision, contextKey]);

  async function searchExtra() {
    if (!active || !accountId || query.trim().length < 2 || extraLoading) return;
    extraRequest.current?.abort();
    const controller = new AbortController(); extraRequest.current = controller;
    const expectedContext = contextKey;
    setExtraLoading(true); setExtraOptions([]); setExtraError("");
    try {
      const response = await fetch(`/api/ads/meta/geography?${new URLSearchParams({ query: query.trim() })}`, { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json();
      if (controller.signal.aborted || contextRef.current !== expectedContext) return;
      if (!response.ok) throw new Error(typeof object(body).error === "string" ? String(object(body).error) : "La recherche Meta est indisponible.");
      setExtraOptions(metaLocationPickerRows(body, accountId, [query.trim()], [])[0].options);
    } catch (cause) {
      if (!controller.signal.aborted && contextRef.current === expectedContext) setExtraError(cause instanceof Error ? cause.message : "La recherche Meta est indisponible.");
    } finally { if (!controller.signal.aborted && contextRef.current === expectedContext) setExtraLoading(false); }
  }

  return <div className={`${styles.studioControlPanel} ${styles.metaLocationPicker}`} data-meta-location-picker="true">
    <strong>Confirmer les zones Meta</strong>
    <p>Une ligne par lieu. Vérifiez le pays et la région ; une correspondance ambiguë reste à choisir.</p>
    {loading && <small role="status">Vérification des zones dans Meta…</small>}
    {rows.map((row, index) => <label className={styles.field} key={row.query} htmlFor={`${id}-${index}`}>
      {row.query}
      <select id={`${id}-${index}`} value={row.selected ? identity(row.selected) : ""} disabled={!active || loading} onChange={(event) => {
        const selected = row.options.find((option) => identity(option) === event.target.value) || null;
        choices.current.values[row.query] = selected ? identity(selected) : "";
        const nextRows = rows.map((entry) => entry.query === row.query ? { ...entry, selected } : entry);
        setRows(nextRows); report(nextRows);
      }}>
        <option value="">{row.options.length ? "Choisir la bonne zone…" : "Aucune zone disponible"}</option>
        {row.options.map((option) => <option key={identity(option)} value={identity(option)}>{[option.name, option.region, option.countryCode].filter(Boolean).join(" · ")}</option>)}
      </select>
      <small data-ready={Boolean(row.selected)}>{row.selected ? "Zone vérifiée" : "Choix nécessaire"}</small>
    </label>)}
    {error && <p role="alert">{error}</p>}
    {active && accountId && <button type="button" className={styles.secondaryButton} disabled={loading} onClick={() => setRevision((value) => value + 1)}>Revérifier les zones</button>}
    {onAddLocation && <div className={styles.metaLocationSearch}>
      <label className={styles.field} htmlFor={`${id}-search`}>Rechercher une autre ville, région ou pays
        <div className={styles.pinterestLocationSearchActions}>
          <input id={`${id}-search`} value={query} maxLength={120} disabled={!active || !accountId || locations.length >= 20} placeholder="Ex. Hauts-de-France, Lille, Belgique" onChange={(event) => { extraRequest.current?.abort(); setExtraLoading(false); setQuery(event.target.value); setExtraOptions([]); setExtraError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchExtra(); } }} />
          <button type="button" className={styles.secondaryButton} disabled={!active || !accountId || query.trim().length < 2 || extraLoading || locations.length >= 20} onClick={() => void searchExtra()}>{extraLoading ? "Recherche…" : "Rechercher"}</button>
        </div>
      </label>
      {extraOptions.length > 0 && <label className={styles.field}>Ajouter une zone vérifiée
        <select value="" disabled={!active || locations.length >= 20} onChange={(event) => {
          const selected = extraOptions.find((option) => identity(option) === event.target.value);
          if (!selected || !callbacks.current.onAddLocation) return;
          callbacks.current.onReadyChange(false, "");
          choices.current.values[selected.name] = identity(selected);
          callbacks.current.onAddLocation(selected.name);
          const next = normalizeMetaAdsGeoTargets([...targetsRef.current, selected]);
          if (next) { targetsRef.current = next; callbacks.current.onChange(next); }
          setQuery(""); setExtraOptions([]);
        }}>
          <option value="">Choisir une zone à ajouter…</option>
          {extraOptions.map((option) => <option key={identity(option)} value={identity(option)} disabled={locations.includes(option.name)}>{[option.name, option.region, option.countryCode].filter(Boolean).join(" · ")}</option>)}
        </select>
      </label>}
      {extraError && <small role="alert">{extraError}</small>}
    </div>}
  </div>;
}
