"use client";

import { useEffect, useId, useRef, useState } from "react";
import { tikTokAdsGeoTargetLabel, type TikTokAdsGeoTarget } from "@/lib/adsTikTokResources";
import { tikTokLocationPickerRows, type TikTokLocationRow } from "@/lib/adsTikTokLocationSelection";
import styles from "./linkedin-campaign.module.css";

export default function TikTokAdsLocationPicker({ accountId, locations, active, onChange, onResolvedTargets }: {
  accountId: string; locations: string[]; active: boolean; onChange: (locations: string[]) => void; onResolvedTargets?: (targets: TikTokAdsGeoTarget[]) => void;
}) {
  const id = useId();
  const resolvedCallback = useRef(onResolvedTargets);
  useEffect(() => { resolvedCallback.current = onResolvedTargets; });
  const queriesKey = JSON.stringify(locations);
  const contextKey = JSON.stringify({ accountId, active, queriesKey });
  const currentContext = useRef(contextKey);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: TikTokLocationRow[]; loading: boolean; error: string }>({ key: "", rows: [], loading: false, error: "" });
  useEffect(() => {
    currentContext.current = contextKey;
    if (!active || !accountId) return;
    const queries = JSON.parse(queriesKey) as string[];
    if (!queries.length || queries.length > 20) return;
    const controller = new AbortController();
    setResult({ key: contextKey, rows: [], loading: true, error: "" });
    void fetch(`/api/ads/tiktok/geography?accountId=${encodeURIComponent(accountId)}&queries=${encodeURIComponent(queriesKey)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Les zones TikTok ne sont pas encore accessibles.");
      return tikTokLocationPickerRows(body, accountId, queries);
    }).then((rows) => {
      if (!controller.signal.aborted && currentContext.current === contextKey) setResult({ key: contextKey, rows, loading: false, error: "" });
    }).catch((cause) => {
      if (!controller.signal.aborted && currentContext.current === contextKey) setResult({ key: contextKey, rows: [], loading: false, error: cause instanceof Error ? cause.message : "La vérification TikTok est indisponible." });
    });
    return () => controller.abort();
  }, [active, accountId, contextKey, queriesKey, revision]);
  const visible = result.key === contextKey ? result : null;
  const rows = visible?.rows || [];
  const ready = rows.filter((row) => row.selected).length;
  const resolvedKey = JSON.stringify(rows.map((row) => row.selected));
  useEffect(() => {
    if (!active || !visible || visible.loading || visible.error || rows.length !== locations.length || ready !== rows.length || ready === 0) return;
    resolvedCallback.current?.(rows.map((row) => row.selected!));
  }, [active, contextKey, resolvedKey, ready, locations.length, visible, rows]);
  return <div className={styles.panel} data-tiktok-location-picker="true">
    <div className={styles.heading}><div><strong>Zones proposées pour TikTok</strong><p>Une ligne par lieu, avec la région et le pays. Les propositions ambiguës restent à choisir.</p></div><span className={styles.badge}>{ready} / {locations.length} vérifiées</span></div>
    {!active && <small role="status">La vérification sera disponible après connexion du compte, pour une campagne Trafic sur TikTok uniquement. Vos lieux restent enregistrés dans le brief.</small>}
    {active && !locations.length && <small>Les lieux de votre activité seront proposés ici par l’IA.</small>}
    {visible?.loading && <small role="status">Vérification des lieux disponibles dans le compte TikTok…</small>}
    <div className={styles.locationRows}>{rows.map((row, index) => <div className={styles.locationRow} key={row.query}>
      <label htmlFor={`${id}-${index}`}>{row.query}</label>
      <select id={`${id}-${index}`} aria-label={`Zone TikTok pour ${row.query}`} value={row.selected?.id || ""} disabled={!active || Boolean(visible?.loading)} onChange={(event) => {
        const selected = row.options.find((option) => option.id === event.target.value);
        if (!selected || currentContext.current !== contextKey) return;
        const label = tikTokAdsGeoTargetLabel(selected);
        if (label.length > 120) return;
        onChange([...new Set(locations.map((query) => query === row.query ? label : query))]);
      }}>
        <option value="" disabled>{row.options.length ? "Choisir la bonne zone…" : "Lieu indisponible dans le compte"}</option>
        {row.options.map((option) => <option key={option.id} value={option.id} disabled={tikTokAdsGeoTargetLabel(option).length > 120}>{tikTokAdsGeoTargetLabel(option)}</option>)}
      </select>
      <span className={styles.status} data-ready={Boolean(row.selected) || undefined}>{row.selected ? "Vérifiée" : "À préciser"}</span>
    </div>)}</div>
    {visible?.error && <p className={styles.error} role="alert">{visible.error}</p>}
    {active && accountId && locations.length > 0 && <div className={styles.actions}><button type="button" disabled={Boolean(visible?.loading)} onClick={() => setRevision((value) => value + 1)}>Revérifier les zones</button></div>}
    <small>Catalogue natif pour l’objectif Trafic et les placements TikTok. Aucun lieu indisponible n’est remplacé par le pays entier.</small>
  </div>;
}
