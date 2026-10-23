"use client";

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
  if (!response.ok) throw new Error(result.error || "ChatGPT Ads est momentanément indisponible.");
  return result;
}

export default function OpenaiAdsConnectionSettings({ active, locked = false, onConnectionChange, initialConnection }: Props) {
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
      setError(cause instanceof Error ? cause.message : "Statut ChatGPT Ads indisponible.");
    } finally {
      setRefreshed(true);
    }
  }, []);

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
      setError(cause instanceof Error ? cause.message : "Connexion ChatGPT Ads impossible.");
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
      setError(cause instanceof Error ? cause.message : "Déconnexion ChatGPT Ads impossible.");
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
    <button type="button" className={adsStyles.initialConnect} disabled={locked} onClick={() => setKeyFormOpen(true)}>Connecter</button>
    {!locked && error ? <p className={adsStyles.inlineError} role="alert">{error} <button type="button" className={styles.retry} onClick={() => void refresh()}>Réessayer</button></p> : null}
  </div>;

  return <div hidden={!active} data-ads-connection-controls="openai" data-connection-status={connectionDisplayStatus} aria-busy={!refreshed || busy !== null} className={`${adsStyles.content} ${styles.openai}`}>
    <div className={adsStyles.controlRow}>
      <input readOnly aria-label="Compte connecté à ChatGPT Ads" title={connected ? `${status.accountId}${status.currency ? ` · ${status.currency}` : ""}` : "Compte annonceur ChatGPT Ads"} value={locked ? "Connexion réservée à l’administration" : connected ? status.accountName || status.accountId : status.status === "needs_update" ? "Connexion à actualiser" : "Aucun compte associé"} />
    {connected ? <button type="button" data-ads-icon-action="disconnect" onClick={() => void disconnect()} disabled={busy !== null} title="Déconnexion ChatGPT Ads" aria-label="Déconnexion ChatGPT Ads"><AdsConnectionIcon name="disconnect" /></button> : null}
    </div>
    <form className={adsStyles.resourceControls} onSubmit={(event) => void connect(event)}>
      <input ref={keyInput} id="openai-ads-key" type="password" aria-label={connected ? "Actualiser la clé Ads Manager" : "Clé Ads Manager"} title="La clé OpenAI API habituelle ne donne pas accès aux publicités." autoComplete="off" spellCheck={false} placeholder="Clé Ads Manager" maxLength={2048} required disabled={locked || busy !== null} />
      <button type="submit" disabled={locked || busy !== null} data-ads-icon-action="save" title={connected ? "Actualiser la clé" : "Connecter le compte"} aria-label={connected ? "Actualiser la clé Ads Manager" : "Connecter ChatGPT Ads"}><AdsConnectionIcon name="save" /></button>
    </form>
    <div className={adsStyles.actionBar} role="group" aria-label="Actions ChatGPT Ads">
      {!locked ? <a className={adsStyles.actionItem} href={accountUrl} target="_blank" rel="noopener noreferrer" title="Ouvrir Ads Manager" aria-label="Ouvrir Ads Manager"><AdsConnectionIcon name="view" /></a> : null}

      <button type="button" className={adsStyles.actionItem} onClick={() => void refresh()} disabled={locked || busy !== null} title="Actualiser la connexion" aria-label="Actualiser la connexion ChatGPT Ads"><AdsConnectionIcon name="refresh" /></button>
      <details className={adsStyles.identityMenu}>
        <summary className={adsStyles.actionItem} title="Informations du compte" aria-label="Informations du compte"><AdsConnectionIcon name="info" /></summary>
        <div className={adsStyles.identityPopover}>
          <strong>Clé Ads Manager</strong>
          <p className={adsStyles.detail}>La clé OpenAI API habituelle ne donne pas accès aux publicités.</p>
          <p className={adsStyles.detail}>{locked ? "La configuration ChatGPT Ads sera disponible après validation de ce canal." : connected ? liveDeliveryEnabled
            ? "Compte prêt : vous pourrez choisir Active ou En pause lors de la validation finale. Une campagne Active ne diffuse qu’après la revue de l’annonce par ChatGPT Ads."
            : pausedCreationEnabled ? `Création de campagnes en pause disponible. ${status.liveReadinessMessage || status.readinessMessage || "Le lancement Active n’est pas encore autorisé pour ce compte."}`
              : status.readinessMessage || "Connexion reconnue. La création de campagne n’est pas disponible pour le moment."
            : status.readinessMessage || "Créez un compte annonceur dans Ads Manager, puis collez sa clé publicitaire dans le champ prévu."}</p>
          {!locked ? <p className={adsStyles.detail}>{liveDeliveryEnabled ? <>Le statut <strong>Active</strong> ou <strong>En pause</strong> est choisi à la validation finale. En statut Active, une dépense peut démarrer uniquement après votre confirmation explicite et la revue de l’annonce par ChatGPT Ads.</> : <>La création <strong>en pause</strong> reste disponible sans diffusion ni dépense. Le statut Active sera proposé dès que le compte remplira toutes les conditions de lancement.</>}</p> : null}
        </div>
      </details>
    </div>
    {!locked && error ? <p className={adsStyles.inlineError} role="alert">{error} <button type="button" className={styles.retry} onClick={() => void refresh()}>Réessayer</button></p> : null}
  </div>;
}
