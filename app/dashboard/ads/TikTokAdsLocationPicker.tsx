"use client";

import { useTranslations } from "next-intl";


import { createAdsApiRequestError } from "./adsClientHttp";
import { useAdsErrorMessage } from "./useAdsErrorMessage";
import { useEffect, useId, useRef, useState } from "react";
import { tikTokAdsGeoTargetLabel, type TikTokAdsGeoTarget } from "@/lib/adsTikTokResources";
import { tikTokLocationPickerRows, type TikTokLocationRow } from "@/lib/adsTikTokLocationSelection";
import styles from "./linkedin-campaign.module.css";

const EMPTY_LOCATION_ROWS: readonly TikTokLocationRow[] = [];

export default function TikTokAdsLocationPicker({ accountId, locations, active, onChange, onResolvedTargets }: {
  accountId: string; locations: string[]; active: boolean; onChange: (locations: string[]) => void; onResolvedTargets?: (targets: TikTokAdsGeoTarget[]) => void;
}) {
  const i18nT = useTranslations("booster");
  const errorMessage = useAdsErrorMessage();
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
      if (!response.ok) throw createAdsApiRequestError(body, response.status);
      return tikTokLocationPickerRows(body, accountId, queries);
    }).then((rows) => {
      if (!controller.signal.aborted && currentContext.current === contextKey) setResult({ key: contextKey, rows, loading: false, error: "" });
    }).catch((cause) => {
      if (!controller.signal.aborted && currentContext.current === contextKey) setResult({ key: contextKey, rows: [], loading: false, error: errorMessage(cause, "shell.ads_error_f51c5a4f5b") });
    });
    return () => controller.abort();
  }, [active, accountId, contextKey, queriesKey, revision, errorMessage]);
  const visible = result.key === contextKey ? result : null;
  const rows = visible?.rows || EMPTY_LOCATION_ROWS;
  const ready = rows.filter((row) => row.selected).length;
  const resolvedKey = JSON.stringify(rows.map((row) => row.selected));
  useEffect(() => {
    if (!active || !visible || visible.loading || visible.error || rows.length !== locations.length || ready !== rows.length || ready === 0) return;
    resolvedCallback.current?.(rows.map((row) => row.selected!));
  }, [active, contextKey, resolvedKey, ready, locations.length, visible, rows]);
  return <div className={styles.panel} data-tiktok-location-picker="true">
    <div className={styles.heading}><div><strong>{i18nT("zones_proposees_pour_tiktok_d1691359")}</strong><p>{i18nT("une_ligne_par_lieu_avec_la_a920f2e9")}</p></div><span className={styles.badge}>{ready} / {locations.length} {" "}{i18nT("verifiees_8690ab02")}</span></div>
    {!active && <small role="status">{i18nT("la_verification_sera_disponible_apres_connexion_9b8a201b")}</small>}
    {active && !locations.length && <small>{i18nT("les_lieux_de_votre_activite_seront_3a6a225c")}</small>}
    {visible?.loading && <small role="status">{i18nT("verification_des_lieux_disponibles_dans_le_f91d4b41")}</small>}
    <div className={styles.locationRows}>{rows.map((row, index) => <div className={styles.locationRow} key={row.query}>
      <label htmlFor={`${id}-${index}`}>{row.query}</label>
      <select id={`${id}-${index}`} aria-label={i18nT("zone_tiktok_pour_value_e5011564", { value0: row.query })} value={row.selected?.id || ""} disabled={!active || Boolean(visible?.loading)} onChange={(event) => {
        const selected = row.options.find((option) => option.id === event.target.value);
        if (!selected || currentContext.current !== contextKey) return;
        const label = tikTokAdsGeoTargetLabel(selected);
        if (label.length > 120) return;
        onChange([...new Set(locations.map((query) => query === row.query ? label : query))]);
      }}>
        <option value="" disabled>{row.options.length ? i18nT("choisir_la_bonne_zone_742a0ea9") : i18nT("lieu_indisponible_dans_le_compte_edb21dde")}</option>
        {row.options.map((option) => <option key={option.id} value={option.id} disabled={tikTokAdsGeoTargetLabel(option).length > 120}>{tikTokAdsGeoTargetLabel(option)}</option>)}
      </select>
      <span className={styles.status} data-ready={Boolean(row.selected) || undefined}>{row.selected ? i18nT("verifiee_3fd06024") : i18nT("a_preciser_f65d0dc7")}</span>
    </div>)}</div>
    {visible?.error && <p className={styles.error} role="alert">{visible.error}</p>}
    {active && accountId && locations.length > 0 && <div className={styles.actions}><button type="button" disabled={Boolean(visible?.loading)} onClick={() => setRevision((value) => value + 1)}>{i18nT("reverifier_les_zones_b7fd9197")}</button></div>}
    <small>{i18nT("catalogue_natif_pour_l_objectif_trafic_45277ec3")}</small>
  </div>;
}
