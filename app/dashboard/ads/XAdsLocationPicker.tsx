"use client";
import { useEffect, useId, useRef, useState } from "react";
import { normalizeXAdsGeoTargets, type XAdsGeography, type XAdsNativeSelections } from "@/lib/adsXResources";
import styles from "./linkedin-campaign.module.css";
export default function XAdsLocationPicker({ accountId, locations, selections, active, onChange }: {
  accountId: string; locations: string[]; selections?: XAdsNativeSelections; active: boolean;
  onChange: (locations: string[], selections: XAdsNativeSelections) => void;
}) {
  const id = useId(), callbacks = useRef({ onChange, selections });
  useEffect(() => { callbacks.current = { onChange, selections }; });
  const locationsKey = JSON.stringify(locations), key = JSON.stringify([accountId, active, locationsKey]);
  const [result, setResult] = useState<{ key: string; value: XAdsGeography | null; error: string }>({ key: "", value: null, error: "" });
  useEffect(() => {
    if (!active || !accountId || !locations.length) return;
    const abort = new AbortController(); setResult({ key, value: null, error: "" });
    void fetch(`/api/ads/x/geography?accountId=${encodeURIComponent(accountId)}&queries=${encodeURIComponent(locationsKey)}`, { cache: "no-store", signal: abort.signal }).then(async (response) => {
      const body = await response.json() as XAdsGeography;
      if (!response.ok || body.selectedAccountId !== accountId || body.complete !== true || body.publicationEnabled !== false || !Array.isArray(body.resolutions)
        || body.resolutions.length !== locations.length || body.resolutions.some((row, index) => row.query !== locations[index] || !normalizeXAdsGeoTargets(row.options))) throw new Error("Les zones X ne peuvent pas encore être vérifiées pour ce compte.");
      return body;
    }).then((value) => { if (!abort.signal.aborted) setResult({ key, value, error: "" }); }).catch((error) => { if (!abort.signal.aborted) setResult({ key, value: null, error: error instanceof Error ? error.message : "Les zones X sont indisponibles." }); });
    return () => abort.abort();
  }, [active, accountId, key, locationsKey, locations.length]);
  const current = result.key === key ? result : null;
  return <div className={styles.panel} data-x-location-picker="true"><div className={styles.heading}><div><strong>Confirmer les zones proposées</strong><p>Une ligne par lieu ; les zones exactes viennent de votre compte X.</p></div></div>
    {!active && <small>Les lieux seront vérifiés après connexion du compte X.</small>}
    {active && !current?.value && !current?.error && <small role="status">Vérification des zones…</small>}
    <div className={styles.locationRows}>{current?.value?.resolutions.map((row, index) => {
      const selected = selections?.geoTargets.find((target) => target.name === row.query && row.options.some((option) => JSON.stringify(option) === JSON.stringify(target)));
      const proposed = row.options.find((option) => JSON.stringify(option) === JSON.stringify(row.autoSelectedTarget));
      return <div className={styles.locationRow} key={row.query}><label htmlFor={`${id}-${index}`}>{row.query}</label><select id={`${id}-${index}`} value={selected?.id || proposed?.id || ""} onChange={(event) => {
        const target = row.options.find((item) => item.id === event.target.value), native = callbacks.current.selections;
        if (!target || native?.accountId !== accountId) return;
        callbacks.current.onChange(locations.map((name, position) => position === index ? target.name : name), { ...native,
          geoTargets: [...native.geoTargets.filter((item) => item.name !== row.query && item.id !== target.id), target] });
      }}><option value="">Choisir une zone disponible</option>{row.options.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.countryCode}</option>)}</select><span className={styles.status}>{selected ? "Vérifiée" : "À préciser"}</span></div>;
    })}</div>{current?.error && <p className={styles.error} role="alert">{current.error}</p>}</div>;
}
