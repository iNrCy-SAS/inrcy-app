"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { AdsCampaignInput } from "@/lib/adsValidation";
import { automaticTikTokNativeSelections, automaticXNativeSelections, ownedPreparedVideoId, preparedNativeBlockerLabel, preparedNativeCheck, type PreparedNativeCheck, PREPARED_TIKTOK_CTA_LABELS } from "@/lib/adsPreparedNativeClient";
import { tikTokAdsResourcesConsentKey, type TikTokAdsResources } from "@/lib/adsTikTokResources";
import { normalizeXAdsGeoTargets, xAdsResourcesConsentKey, type XAdsGeography, type XAdsResources } from "@/lib/adsXResources";
import { uploadFileToMediaLibrary } from "@/lib/mediaLibraryUploadClient";
import { prepareOwnedTikTokThumbnail } from "@/lib/adsTikTokThumbnailClient";
import styles from "./linkedin-campaign.module.css";

export type PreparedNativeReadiness = { draftKey: string; check: PreparedNativeCheck | null; error: string };
type Props = {
  draft: AdsCampaignInput; active: boolean; connected: boolean; selectedAccountId: string;
  tikTokResources: TikTokAdsResources | null; mode: "campaign" | "geography" | "final" | "hidden";
  onChange: (patch: Partial<AdsCampaignInput>) => void;
  onReadiness: (value: PreparedNativeReadiness) => void;
  onXResources: (value: XAdsResources | null) => void;
};
async function read(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Le contrôle natif est indisponible.");
  return body;
}
export default function PreparedAdsNativeControls(props: Props) {
  const { draft, active, connected, selectedAccountId, tikTokResources, mode } = props;
  const callbacks = useRef(props);
  useEffect(() => { callbacks.current = props; });
  const id = useId();
  const provider = draft.provider === "tiktok" ? "tiktok" : "x";
  const contextKey = JSON.stringify([active, connected, provider, selectedAccountId]);
  const [xState, setXState] = useState<{ key: string; resources: XAdsResources | null; error: string }>({ key: "", resources: null, error: "" });
  const [revision, setRevision] = useState(0);
  const [geo, setGeo] = useState<{ key: string; value: XAdsGeography | null; error: string }>({ key: "", value: null, error: "" });
  const [checkState, setCheckState] = useState<PreparedNativeReadiness>({ draftKey: "", check: null, error: "" });
  const [thumbnailState, setThumbnailState] = useState<{ url: string; loading: boolean; error: string }>({ url: "", loading: false, error: "" });
  const thumbnailCache = useRef(new Map<string, string>());
  const xResources = xState.key === contextKey ? xState.resources : null;
  const resourcesKey = provider === "tiktok" ? tikTokAdsResourcesConsentKey(tikTokResources) || "" : xAdsResourcesConsentKey(xResources);
  const draftKey = JSON.stringify(draft);
  const locationKey = JSON.stringify(draft.targetLocations);
  const geoKey = JSON.stringify([contextKey, locationKey]);
  useEffect(() => {
    if (!active || !connected || provider !== "x" || !selectedAccountId) { callbacks.current.onXResources(null); return; }
    const abort = new AbortController();
    setXState({ key: contextKey, resources: null, error: "" }); callbacks.current.onXResources(null);
    void fetch(`/api/ads/x/resources?accountId=${encodeURIComponent(selectedAccountId)}`, { cache: "no-store", signal: abort.signal }).then(read).then((body) => {
      const resources = body as unknown as XAdsResources;
      if (resources.selectedAccountId !== selectedAccountId || resources.account?.id !== selectedAccountId || resources.publicationEnabled !== false || !Array.isArray(resources.fundingInstruments) || !Array.isArray(resources.promotableUsers) || !Array.isArray(resources.posts)) throw new Error("Le compte X a changé. Revérifiez la connexion.");
      if (abort.signal.aborted) return;
      setXState({ key: contextKey, resources, error: "" }); callbacks.current.onXResources(resources);
    }).catch((error) => { if (!abort.signal.aborted) setXState({ key: contextKey, resources: null, error: error instanceof Error ? error.message : "Les ressources X sont indisponibles." }); });
    return () => abort.abort();
  }, [active, connected, provider, selectedAccountId, contextKey, revision]);
  useEffect(() => {
    if (!active || !connected || !selectedAccountId) return;
    const current = callbacks.current.draft;
    if (current.adAccountId !== selectedAccountId) { callbacks.current.onChange({ adAccountId: selectedAccountId }); return; }
    if (provider === "tiktok" && tikTokResources?.selectedAccountId === selectedAccountId) {
      const selections = automaticTikTokNativeSelections(tikTokResources, current.tiktokNativeSelections);
      if (JSON.stringify(selections) !== JSON.stringify(current.tiktokNativeSelections)) callbacks.current.onChange({ tiktokNativeSelections: selections, callToAction: PREPARED_TIKTOK_CTA_LABELS[selections.callToAction || ""] || current.callToAction });
    } else if (provider === "x" && xResources?.selectedAccountId === selectedAccountId) {
      const selections = automaticXNativeSelections(xResources, current.xNativeSelections);
      if (JSON.stringify(selections) !== JSON.stringify(current.xNativeSelections)) callbacks.current.onChange({ xNativeSelections: selections });
    }
  }, [active, connected, provider, selectedAccountId, resourcesKey, draftKey, tikTokResources, xResources]);
  useEffect(() => {
    if (!active || !connected || provider !== "x" || !selectedAccountId || !draft.targetLocations.length) return;
    const abort = new AbortController();
    setGeo({ key: geoKey, value: null, error: "" });
    void fetch(`/api/ads/x/geography?accountId=${encodeURIComponent(selectedAccountId)}&queries=${encodeURIComponent(locationKey)}`, { cache: "no-store", signal: abort.signal }).then(read).then((body) => {
      const value = body as unknown as XAdsGeography;
      if (value.selectedAccountId !== selectedAccountId || value.complete !== true || value.publicationEnabled !== false || !Array.isArray(value.resolutions)
        || value.resolutions.length !== draft.targetLocations.length || value.resolutions.some((row, index) => row.query !== draft.targetLocations[index] || !normalizeXAdsGeoTargets(row.options))) throw new Error("Les zones X doivent être revérifiées.");
      if (!abort.signal.aborted) setGeo({ key: geoKey, value, error: "" });
    }).catch((error) => { if (!abort.signal.aborted) setGeo({ key: geoKey, value: null, error: error instanceof Error ? error.message : "Les zones X sont indisponibles." }); });
    return () => abort.abort();
  }, [active, connected, provider, selectedAccountId, locationKey, geoKey, revision, draft.targetLocations.length]);
  useEffect(() => {
    if (!active || provider !== "x" || geo.key !== geoKey || !geo.value || !xResources || !draft.xNativeSelections) return;
    const targets = geo.value.resolutions.map((row) => {
      const previous = draft.xNativeSelections!.geoTargets.find((item) => item.name === row.query);
      return row.options.find((item) => item.id === previous?.id) || row.options.find((item) => JSON.stringify(item) === JSON.stringify(row.autoSelectedTarget)) || null;
    });
    if (targets.some((item) => !item)) return;
    const exact = normalizeXAdsGeoTargets(targets);
    if (!exact) return;
    const labels = exact.map((item) => item.name), selections = { ...draft.xNativeSelections, geoTargets: exact };
    if (JSON.stringify(labels) !== locationKey || JSON.stringify(selections) !== JSON.stringify(draft.xNativeSelections)) callbacks.current.onChange({ targetLocations: labels, xNativeSelections: selections });
  }, [active, provider, geo, geoKey, xResources, locationKey, draft.xNativeSelections]);
  const videoUrl = draft.creativeType === "video" ? draft.creativeUrl || "" : "";
  const thumbnailMediaId = draft.tiktokNativeSelections?.thumbnailMediaId || "";
  useEffect(() => {
    if (!active || !connected || provider !== "tiktok" || !draft.tiktokNativeSelections || !ownedPreparedVideoId(videoUrl) || thumbnailMediaId) return;
    const cached = thumbnailCache.current.get(videoUrl);
    if (cached) { callbacks.current.onChange({ tiktokNativeSelections: { ...draft.tiktokNativeSelections, thumbnailMediaId: cached } }); return; }
    const abort = new AbortController();
    setThumbnailState({ url: videoUrl, loading: true, error: "" });
    void prepareOwnedTikTokThumbnail(videoUrl, abort.signal).then(async (frame) => {
      if (abort.signal.aborted) return null;
      const uploaded = await uploadFileToMediaLibrary(frame.file, { source: "ads_campaign", title: "Miniature publicitaire TikTok", width: frame.width, height: frame.height,
        tags: ["inrads", "tiktok", "thumbnail"], metadata: { source_video_media_id: frame.videoMediaId, campaign_media_source: "video_frame" } });
      if (!uploaded?.ok || typeof uploaded.id !== "string" || !/^[a-f0-9-]{36}$/i.test(uploaded.id)) throw new Error("La miniature n’a pas été enregistrée dans la médiathèque.");
      thumbnailCache.current.set(videoUrl, uploaded.id);
      return uploaded.id;
    }).then((mediaId) => {
      if (abort.signal.aborted || !mediaId) return;
      const current = callbacks.current.draft;
      if (current.provider === "tiktok" && current.creativeUrl === videoUrl && current.tiktokNativeSelections?.advertiserId === selectedAccountId)
        callbacks.current.onChange({ tiktokNativeSelections: { ...current.tiktokNativeSelections, thumbnailMediaId: mediaId } });
      setThumbnailState({ url: videoUrl, loading: false, error: "" });
    }).catch((error) => { if (!abort.signal.aborted) setThumbnailState({ url: videoUrl, loading: false, error: error instanceof Error ? error.message : "La miniature n’a pas pu être préparée." }); });
    return () => abort.abort();
  }, [active, connected, provider, selectedAccountId, videoUrl, thumbnailMediaId, Boolean(draft.tiktokNativeSelections), revision]);
  useEffect(() => {
    const state = { draftKey, check: null, error: "" };
    setCheckState(state); callbacks.current.onReadiness(state);
    if (!active || !connected || !resourcesKey || mode !== "final") return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/ads/${provider}/preflight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: JSON.parse(draftKey) }), cache: "no-store", signal: abort.signal }).then(read).then((body) => {
        if (abort.signal.aborted) return;
        const check = preparedNativeCheck(body, provider, selectedAccountId);
        const value = { draftKey, check, error: "" }; setCheckState(value); callbacks.current.onReadiness(value);
      }).catch((error) => { if (!abort.signal.aborted) { const value = { draftKey, check: null, error: error instanceof Error ? error.message : "La vérification native est indisponible." }; setCheckState(value); callbacks.current.onReadiness(value); } });
    }, 700);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [active, connected, resourcesKey, mode, provider, selectedAccountId, draftKey, revision]);
  if (!active || mode === "hidden") return null;
  const check = checkState.draftKey === draftKey ? checkState.check : null;
  const tt = draft.tiktokNativeSelections, x = draft.xNativeSelections;
  const geography = geo.key === geoKey ? geo.value : null;
  return <div className={styles.panel} data-prepared-native-controls={provider}>
    <div className={styles.heading}><div><strong>{mode === "geography" ? "Zones exactes proposées par X" : mode === "final" ? "Vérification native du compte" : "Identité publicitaire proposée"}</strong>
      <p>{provider === "tiktok" ? "L’identité, les zones et la vidéo sont revérifiées dans votre compte TikTok." : "Un nouveau post publicitaire privé est préparé à partir de votre annonce, avec une source de financement autorisée."}</p></div></div>
    {!connected && <small role="status">Connectez votre compte pour vérifier automatiquement les ressources. Le brouillon reste enregistrable.</small>}
    {(mode === "campaign" || mode === "final") && provider === "tiktok" && tikTokResources && <>
      {tikTokResources.identities.length === 1 ? <p>Identité retenue : <b>{tikTokResources.identities[0].displayName}</b></p> : <label className={styles.field} htmlFor={`${id}-identity`}>Identité TikTok<select id={`${id}-identity`} value={tt?.identity ? JSON.stringify([tt.identity.type, tt.identity.id, tt.identity.authorizedBusinessCenterId || ""]) : ""} onChange={(event) => {
        const identity = tikTokResources.identities.find((item) => JSON.stringify([item.type, item.id, item.authorizedBusinessCenterId || ""]) === event.target.value);
        if (identity && tt) callbacks.current.onChange({ tiktokNativeSelections: { ...tt, identity: { id: identity.id, type: identity.type, ...(identity.authorizedBusinessCenterId ? { authorizedBusinessCenterId: identity.authorizedBusinessCenterId } : {}) } } });
      }}><option value="">Choisir une identité autorisée</option>{tikTokResources.identities.map((item) => <option key={JSON.stringify([item.type, item.id, item.authorizedBusinessCenterId || ""])} value={JSON.stringify([item.type, item.id, item.authorizedBusinessCenterId || ""])}>{item.displayName || item.type}</option>)}</select></label>}
      <small>Bouton proposé : {PREPARED_TIKTOK_CTA_LABELS[tt?.callToAction || "LEARN_MORE"] || "À vérifier"}. Sa disponibilité sera contrôlée avant la création.</small>
    </>}
    {(mode === "campaign" || mode === "final") && provider === "x" && xResources && x && <>
      <label className={styles.field} htmlFor={`${id}-funding`}>Financement du compte<select id={`${id}-funding`} value={x.fundingInstrumentId || ""} onChange={(event) => callbacks.current.onChange({ xNativeSelections: { ...x, fundingInstrumentId: event.target.value || null } })}><option value="">Choisir une source disponible</option>{xResources.fundingInstruments.filter((item) => item.currency === "EUR" && item.ableToFund && !item.deleted && !item.cancelled).map((item) => <option key={item.id} value={item.id}>Source {item.id} · EUR</option>)}</select></label>
      <label className={styles.field} htmlFor={`${id}-x-user`}>Identité X autorisée<select id={`${id}-x-user`} value={x.promotableUserId || ""} onChange={(event) => callbacks.current.onChange({ xNativeSelections: { ...x, promotableUserId: event.target.value || null, postId: null } })}><option value="">Choisir une identité</option>{xResources.promotableUsers.filter((item) => item.type === "FULL").map((item) => <option key={item.id} value={item.id}>Compte X {item.userId}</option>)}</select></label>
      <small>Les choix sont automatiques quand une seule ressource compatible existe. Le post reste absent du fil organique.</small>
    </>}
    {mode === "geography" && provider === "x" && <div className={styles.locationRows}>{geography?.resolutions.map((row, index) => {
      const chosen = x?.geoTargets.find((target) => target.name === row.query);
      return <div className={styles.locationRow} key={row.query}><label className={styles.field} htmlFor={`${id}-geo-${index}`}>{row.query}</label><select id={`${id}-geo-${index}`} value={chosen?.id || row.autoSelectedTarget?.id || ""} onChange={(event) => {
        const target = row.options.find((item) => item.id === event.target.value); if (!target || !x) return;
        const targets = geography.resolutions.map((item, position) => position === index ? target : x.geoTargets.find((geoItem) => geoItem.name === item.query) || item.options.find((option) => JSON.stringify(option) === JSON.stringify(item.autoSelectedTarget)) || null);
        const complete = targets.every(Boolean);
        callbacks.current.onChange({ targetLocations: draft.targetLocations.map((name, position) => position === index ? target.name : name),
          xNativeSelections: { ...x, geoTargets: complete ? targets as NonNullable<typeof x>["geoTargets"] : [...x.geoTargets.filter((item) => item.name !== row.query), target] } });
      }}><option value="">Choisir la bonne zone</option>{row.options.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.countryCode}</option>)}</select><span className={styles.status}>{chosen ? "Vérifiée" : "À préciser"}</span></div>;
    })}</div>}
    {mode === "final" && provider === "tiktok" && tt && <>
      <p>{thumbnailState.url === videoUrl && thumbnailState.loading ? "Préparation automatique de la miniature vidéo…" : tt.thumbnailMediaId ? "Miniature vidéo enregistrée dans votre médiathèque." : "La miniature sera préparée automatiquement à partir de votre vidéo."}</p>
      <fieldset><legend>Déclaration de la vidéo</legend><label className={styles.toggle}><input type="radio" name={`${id}-aigc`} checked={tt.isAiGenerated === true} onChange={() => callbacks.current.onChange({ tiktokNativeSelections: { ...tt, isAiGenerated: true } })} /> Cette vidéo a été générée ou modifiée par l’IA.</label><label className={styles.toggle}><input type="radio" name={`${id}-aigc`} checked={tt.isAiGenerated === false} onChange={() => callbacks.current.onChange({ tiktokNativeSelections: { ...tt, isAiGenerated: false } })} /> Cette vidéo ne contient pas de contenu généré par l’IA.</label></fieldset>
    </>}
    {mode === "final" && connected && <div role="status"><strong>{check?.ready ? "Création native en pause prête" : "Contrôles avant création"}</strong>{check && !check.ready && <ul>{[...new Set(check.blockers.map(preparedNativeBlockerLabel))].map((label) => <li key={label}>{label}</li>)}</ul>}{!check && !checkState.error && <p>Vérification du compte et de la proposition…</p>}<small>La création se fait en pause. La diffusion payante reste désactivée dans ce parcours.</small></div>}
    {(xState.key === contextKey && xState.error || geo.key === geoKey && geo.error || thumbnailState.url === videoUrl && thumbnailState.error || checkState.draftKey === draftKey && checkState.error) && <p className={styles.error} role="alert">{checkState.error || thumbnailState.error || geo.error || xState.error}</p>}
    {connected && <div className={styles.actions}><button type="button" onClick={() => setRevision((value) => value + 1)}>Revérifier le compte</button></div>}
  </div>;
}
