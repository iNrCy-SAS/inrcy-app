"use client";

import { useTranslations } from "next-intl";


import { createAdsApiRequestError } from "./adsClientHttp";
import { useAdsErrorMessage } from "./useAdsErrorMessage";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import AdsConnectionIcon from "./AdsConnectionIcon";
import type { AdsConnectionSnapshot } from "@/lib/adsConnectionSnapshot";
import adsStyles from "./AdsConnectionSettings.module.css";
import styles from "./OpenaiAdsConnectionSettings.module.css";

type Status = {
  connected: boolean;
  status: string;
  accountId: string;
  accountName: string;
  currency: string;
  brandReviewStatus: string;
  accountReviewStatus: string | null;
  readiness: string;
  readinessMessage: string;
  publicationEnabled: boolean;
  pausedCreationEnabled?: boolean;
  liveDeliveryEnabled?: boolean;
  liveReadinessMessage?: string;
  error?: string;
};

type Props = {
  active: boolean;
  locked?: boolean;
  onConnectionChange?: () => void;
  initialConnection?: AdsConnectionSnapshot;
};

function fromSnapshot(snapshot?: AdsConnectionSnapshot): Status {
  return {
    connected: snapshot?.status === "connected" && Boolean(snapshot.accountId),
    status: snapshot?.status || "disconnected",
    accountId: snapshot?.accountId || "",
    accountName: snapshot?.accountLabel || "",
    currency: "",
    brandReviewStatus: "",
    accountReviewStatus: null,
    readiness: "",
    readinessMessage: "",
    publicationEnabled: false,
  };
}

async function readResponse(response: Response): Promise<Status> {
  const result = await response.json().catch(() => ({})) as Status;
  if (!response.ok) throw createAdsApiRequestError(result, response.status);
  return result;
}

export default function OpenaiAdsConnectionSettings({ active, locked = false, onConnectionChange, initialConnection }: Props) {
  const i18nT = useTranslations("booster");
  const errorMessage = useAdsErrorMessage();
  const [status, setStatus] = useState<Status>(() => fromSnapshot(initialConnection));
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState("");
  const [refreshed, setRefreshed] = useState(false);
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await readResponse(await fetch("/api/ads/openai/status", { cache: "no-store" }));
      setStatus(next);
      setError("");
    } catch (cause) {
      setError(errorMessage(cause, "shell.ads_error_8a8bf99863"));
    } finally {
      setRefreshed(true);
    }
  }, [errorMessage]);

  useEffect(() => {
    if (active) {
      if (locked) {
        setStatus(fromSnapshot());
        setKeyFormOpen(false);
        setRefreshed(true);
      } else void refresh();
    }
  }, [active, locked, refresh]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const key = keyInput.current?.value.trim() || "";
    if (!key || busy) return;
    setBusy("connect");
    setError("");
    try {
      const next = await readResponse(await fetch("/api/ads/openai/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adsApiKey: key }),
        cache: "no-store",
      }));
      if (keyInput.current) keyInput.current.value = "";
      setStatus((current) => ({ ...current, ...next, status: "connected" }));
      onConnectionChange?.();
    } catch (cause) {
      setError(errorMessage(cause, "shell.ads_error_ad66aa5ff4"));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (locked || busy) return;
    setBusy("disconnect");
    setError("");
    try {
      await readResponse(await fetch("/api/ads/openai/disconnect", { method: "POST", cache: "no-store" }));
      setStatus(fromSnapshot());
      onConnectionChange?.();
    } catch (cause) {
      setError(errorMessage(cause, "shell.ads_error_b8346c06c5"));
    } finally {
      setBusy(null);
    }
  }

  const connected = !locked && status.connected;
  const pausedCreationEnabled = status.pausedCreationEnabled === true;
  const liveDeliveryEnabled = status.liveDeliveryEnabled === true;
  const connectionDisplayStatus = locked ? "disconnected" : status.status === "needs_update" ? "needs_update" : connected ? "connected" : "disconnected";
  const accountUrl = /^adacct_[A-Za-z0-9_-]+$/.test(status.accountId)
    ? `https://ads.openai.com/settings?act=${encodeURIComponent(status.accountId)}`
    : "https://ads.openai.com/";
  if (!connected && !keyFormOpen) return <div hidden={!active} data-ads-connection-controls="openai" className={`${adsStyles.content} ${adsStyles.connectionPrompt} ${styles.openai}`}>
    <button type="button" className={adsStyles.initialConnect} disabled={locked} onClick={() => setKeyFormOpen(true)}>{i18nT("connecter_ca28e250")}</button>
    {!locked && error ? <p className={adsStyles.inlineError} role="alert">{error} <button type="button" className={styles.retry} onClick={() => void refresh()}>{i18nT("reessayer_895d416b")}</button></p> : null}
  </div>;

  return <div hidden={!active} data-ads-connection-controls="openai" data-connection-status={connectionDisplayStatus} aria-busy={!refreshed || busy !== null} className={`${adsStyles.content} ${styles.openai}`}>
    <div className={adsStyles.controlRow}>
      <input readOnly aria-label={i18nT("compte_connecte_a_chatgpt_ads_77cca7cf")} title={connected ? `${status.accountId}${status.currency ? ` · ${status.currency}` : ""}` : i18nT("compte_annonceur_chatgpt_ads_776e8c41")} value={locked ? i18nT("ads_ui_18b7e71f65") : connected ? status.accountName || status.accountId : status.status === "needs_update" ? i18nT("connexion_a_actualiser_f1517d8c") : i18nT("ads_ui_92da5e6530")} />
    {connected ? <button type="button" data-ads-icon-action="disconnect" onClick={() => void disconnect()} disabled={busy !== null} title={i18nT("deconnexion_chatgpt_ads_1e7aba95")} aria-label={i18nT("deconnexion_chatgpt_ads_1e7aba95")}><AdsConnectionIcon name="disconnect" /></button> : null}
    </div>
    <form className={adsStyles.resourceControls} onSubmit={(event) => void connect(event)}>
      <input ref={keyInput} id="openai-ads-key" type="password" aria-label={connected ? i18nT("actualiser_la_cle_ads_manager_98578a59") : i18nT("cle_ads_manager_df43b6df")} title={i18nT("la_cle_openai_api_habituelle_ne_fb058d03")} autoComplete="off" spellCheck={false} placeholder={i18nT("cle_ads_manager_df43b6df")} maxLength={2048} required disabled={locked || busy !== null} />
      <button type="submit" disabled={locked || busy !== null} data-ads-icon-action="save" title={connected ? i18nT("actualiser_la_cle_184a3e20") : i18nT("connecter_le_compte_a88dc864")} aria-label={connected ? i18nT("actualiser_la_cle_ads_manager_98578a59") : i18nT("connecter_chatgpt_ads_5757bcce")}><AdsConnectionIcon name="save" /></button>
    </form>
    <div className={adsStyles.actionBar} role="group" aria-label={i18nT("actions_chatgpt_ads_52216936")}>
      {!locked ? <a className={adsStyles.actionItem} href={accountUrl} target="_blank" rel="noopener noreferrer" title={i18nT("ouvrir_ads_manager_0231af17")} aria-label={i18nT("ouvrir_ads_manager_0231af17")}><AdsConnectionIcon name="view" /></a> : null}

      <button type="button" className={adsStyles.actionItem} onClick={() => void refresh()} disabled={locked || busy !== null} title={i18nT("actualiser_la_connexion_f5c013b4")} aria-label={i18nT("actualiser_la_connexion_chatgpt_ads_a3411bd5")}><AdsConnectionIcon name="refresh" /></button>
      <details className={adsStyles.identityMenu}>
        <summary className={adsStyles.actionItem} title={i18nT("informations_du_compte_11c8586a")} aria-label={i18nT("informations_du_compte_11c8586a")}><AdsConnectionIcon name="info" /></summary>
        <div className={adsStyles.identityPopover}>
          <strong>{i18nT("cle_ads_manager_df43b6df")}</strong>
          <p className={adsStyles.detail}>{i18nT("la_cle_openai_api_habituelle_ne_fb058d03")}</p>
          <p className={adsStyles.detail}>{locked ? i18nT("la_configuration_chatgpt_ads_sera_disponible_2fdac54d") : connected ? liveDeliveryEnabled
            ? i18nT("compte_pret_vous_pourrez_choisir_active_b909de08")
            : pausedCreationEnabled ? i18nT("creation_de_campagnes_en_pause_disponible_dcc9c1a5", { value0: errorMessage(status.liveReadinessMessage || status.readinessMessage, "booster.ce_compte_n_est_pas_encore_c16c1342") })
              : errorMessage(status.readinessMessage, "booster.connexion_reconnue_la_creation_de_campagne_ffc5bb9a")
            : errorMessage(status.readinessMessage, "booster.creez_un_compte_annonceur_dans_ads_ad1f1319")}</p>
          {!locked ? <p className={adsStyles.detail}>{liveDeliveryEnabled ? <>{i18nT("le_statut_1cf7bf05")}{" "}<strong>{i18nT("active_a733b809")}</strong> {i18nT("ads_or")} <strong>{i18nT("en_pause_3a366de4")}</strong> {" "}{i18nT("est_choisi_a_la_validation_finale_9f231c4b")}</> : <>{i18nT("la_creation_df70dd4b")}{" "}<strong>{i18nT("en_pause_0ba2636a")}</strong> {" "}{i18nT("reste_disponible_sans_diffusion_ni_depense_e34a2c61")}</>}</p> : null}
        </div>
      </details>
    </div>
    {!locked && error ? <p className={adsStyles.inlineError} role="alert">{error} <button type="button" className={styles.retry} onClick={() => void refresh()}>{i18nT("reessayer_895d416b")}</button></p> : null}
  </div>;
}
