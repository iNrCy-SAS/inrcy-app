"use client";

import { useTranslations } from "next-intl";

import { useAdsErrorMessage } from "./useAdsErrorMessage";
import { useEffect, useId, useRef, useState } from "react";
import { normalizeXAdsGeoTargets, type XAdsGeography, type XAdsNativeSelections } from "@/lib/adsXResources";
import styles from "./linkedin-campaign.module.css";
export default function XAdsLocationPicker({ accountId, locations, selections, active, onChange }: {
  accountId: string; locations: string[]; selections?: XAdsNativeSelections; active: boolean;
  onChange: (locations: string[], selections: XAdsNativeSelections) => void;
}) {
  const i18nT = useTranslations("booster");
  const errorMessage = useAdsErrorMessage();
  const id = useId(), callbacks = useRef({ onChange, selections });
  useEffect(() => { callbacks.current = { onChange, selections }; });
  const locationsKey = JSON.stringify(locations), key = JSON.stringify([accountId, active, locationsKey]);
  const [result, setResult] = useState<{ key: string; value: XAdsGeography | null; error: string }>({ key: "", value: null, error: "" });
  useEffect(() => {
    const requestedLocations = JSON.parse(locationsKey) as string[];
    if (!active || !accountId || !requestedLocations.length) return;
    const abort = new AbortController(); setResult({ key, value: null, error: "" });
    void fetch(`/api/ads/x/geography?accountId=${encodeURIComponent(accountId)}&queries=${encodeURIComponent(locationsKey)}`, { cache: "no-store", signal: abort.signal }).then(async (response) => {
      const body = await response.json() as XAdsGeography;
      if (!response.ok || body.selectedAccountId !== accountId || body.complete !== true || body.publicationEnabled !== false || !Array.isArray(body.resolutions)
        || body.resolutions.length !== requestedLocations.length || body.resolutions.some((row, index) => row.query !== requestedLocations[index] || !normalizeXAdsGeoTargets(row.options))) throw new Error("Les zones X ne peuvent pas encore être vérifiées pour ce compte.");
      return body;
    }).then((value) => { if (!abort.signal.aborted) setResult({ key, value, error: "" }); }).catch((error) => { if (!abort.signal.aborted) setResult({ key, value: null, error: errorMessage(error, "shell.ads_error_97ef260f78") }); });
    return () => abort.abort();
  }, [active, accountId, key, locationsKey, errorMessage]);
  const current = result.key === key ? result : null;
  return <div className={styles.panel} data-x-location-picker="true"><div className={styles.heading}><div><strong>{i18nT("confirmer_les_zones_proposees_184f7772")}</strong><p>{i18nT("une_ligne_par_lieu_les_zones_fe18d25c")}</p></div></div>
    {!active && <small>{i18nT("les_lieux_seront_verifies_apres_connexion_02a9f123")}</small>}
    {active && !current?.value && !current?.error && <small role="status">{i18nT("verification_des_zones_307ac53e")}</small>}
    <div className={styles.locationRows}>{current?.value?.resolutions.map((row, index) => {
      const selected = selections?.geoTargets.find((target) => target.name === row.query && row.options.some((option) => JSON.stringify(option) === JSON.stringify(target)));
      const proposed = row.options.find((option) => JSON.stringify(option) === JSON.stringify(row.autoSelectedTarget));
      return <div className={styles.locationRow} key={row.query}><label htmlFor={`${id}-${index}`}>{row.query}</label><select id={`${id}-${index}`} value={selected?.id || proposed?.id || ""} onChange={(event) => {
        const target = row.options.find((item) => item.id === event.target.value), native = callbacks.current.selections;
        if (!target || native?.accountId !== accountId) return;
        callbacks.current.onChange(locations.map((name, position) => position === index ? target.name : name), { ...native,
          geoTargets: [...native.geoTargets.filter((item) => item.name !== row.query && item.id !== target.id), target] });
      }}><option value="">{i18nT("choisir_une_zone_disponible_2ab37b87")}</option>{row.options.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.countryCode}</option>)}</select><span className={styles.status}>{selected ? i18nT("verifiee_3fd06024") : i18nT("a_preciser_f65d0dc7")}</span></div>;
    })}</div>{current?.error && <p className={styles.error} role="alert">{current.error}</p>}</div>;
}
