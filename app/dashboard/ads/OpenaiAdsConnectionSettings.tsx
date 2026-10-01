"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import SettingsDrawer from "@/app/dashboard/SettingsDrawer";
import ChannelSettingsHeader from "@/app/dashboard/_components/ChannelSettingsHeader";
import ConnectionPill from "@/app/dashboard/_components/ConnectionPill";
import socialStyles from "@/app/dashboard/_components/SocialSettingsSteps.module.css";
import dashboardStyles from "@/app/dashboard/dashboard.module.css";
import { getChannelSettingsHeaderStyle } from "@/app/dashboard/channel-settings";
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
  error?: string;
};

type Props = {
  isOpen: boolean;
  locked?: boolean;
  previous: { name: string; onSelect: () => void };
  next: { name: string; onSelect: () => void };
  onClose: () => void;
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

export default function OpenaiAdsConnectionSettings({ isOpen, locked = false, previous, next, onClose, onConnectionChange, initialConnection }: Props) {
  const [status, setStatus] = useState<Status>(() => fromSnapshot(initialConnection));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState("");
  const [refreshed, setRefreshed] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

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
    if (isOpen) {
      setStep(0);
      if (locked) {
        setStatus(fromSnapshot());
        setRefreshed(true);
      } else void refresh();
    }
  }, [isOpen, locked, refresh]);

  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      contentRef.current?.closest("[data-dashboard-settings-drawer]")
        ?.querySelector<HTMLButtonElement>("[data-dashboard-settings-drawer-header] > div:last-child > button:last-child")
        ?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      restoreFocus();
    };
  }, [isOpen]);

  function restoreFocus() {
    const panel = contentRef.current?.closest("[data-dashboard-settings-drawer]");
    if (!(document.activeElement instanceof HTMLElement) || !panel?.contains(document.activeElement)) return;
    if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
    else document.activeElement.blur();
  }

  function closePanel() {
    restoreFocus();
    onClose();
  }

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
  const connectionDisplayStatus = locked ? "disconnected" : status.status === "needs_update" ? "needs_update" : connected ? "connected" : "disconnected";
  const accountUrl = /^adacct_[A-Za-z0-9_-]+$/.test(status.accountId)
    ? `https://ads.openai.com/settings?act=${encodeURIComponent(status.accountId)}`
    : "https://ads.openai.com/";
  return <SettingsDrawer
    title="Configurer ChatGPT Ads"
    isOpen={isOpen}
    onClose={closePanel}
    presentation="centered"
    keepMounted
    headerContent={<ChannelSettingsHeader
      name="ChatGPT Ads"
      logoSrc="/ads-logos/chatgpt-ads.svg"
      previous={{ name: previous.name, onSelect: () => { restoreFocus(); previous.onSelect(); } }}
      next={{ name: next.name, onSelect: () => { restoreFocus(); next.onSelect(); } }}
    />}
    headerLead="Votre espace publicitaire ChatGPT."
    headerStyle={getChannelSettingsHeaderStyle("inr_search")}
    headerActions={<button type="button" className={dashboardStyles.channelSettingsAllChannelsButton} onClick={closePanel} aria-label="Tous les canaux" title="Tous les canaux"><span className={dashboardStyles.channelSettingsAllChannelsIcon} aria-hidden="true">☷</span><span className={dashboardStyles.channelSettingsAllChannelsLabel}>Tous les canaux</span></button>}
  >
    <div ref={contentRef} className={`${adsStyles.content} ${socialStyles.journey} ${styles.openai}`} data-step={step}>
      <section data-step-index="0" className={`${socialStyles.stepCard} ${adsStyles.step}`} aria-label="Étape 1 : Votre connexion">
        <div className={`${socialStyles.stepHeader} ${adsStyles.stepHeader}`}>
          <span className={socialStyles.stepNumber} aria-hidden="true">01</span>
          <div className={socialStyles.stepCopy}><div>Votre connexion</div><div>{locked ? "Canal en validation : connexion réservée à l’administration." : "La clé Ads Manager de chaque entreprise autorise l’accès à son compte publicitaire ChatGPT."}</div></div>
          <div className={socialStyles.stepStatus}>{locked ? <span className={adsStyles.lockedPill}>Verrouillé</span> : <ConnectionPill connected={connected} status={connectionDisplayStatus} label={busy === "connect" ? "Vérification…" : undefined} />}</div>
        </div>
        <div className={`${socialStyles.stepBody} ${adsStyles.stepBody}`}>
          <div className={adsStyles.controlRow}>
            <input readOnly aria-label="Compte connecté à ChatGPT Ads" value={locked ? "Connexion réservée à l’administration" : connected ? `Compte connecté : ${status.accountName || status.accountId}` : status.status === "needs_update" ? "Connexion à actualiser" : "Aucun compte connecté"} />
            {connected && <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.disconnectBtn}`} onClick={() => void disconnect()} disabled={busy !== null}>{busy === "disconnect" ? "Déconnexion…" : "Déconnexion"}</button>}
          </div>
          <form className={styles.keyForm} onSubmit={(event) => void connect(event)}>
            <label htmlFor="openai-ads-key">{connected ? "Actualiser la clé Ads Manager" : "Clé Ads Manager"}<small>La clé OpenAI API habituelle ne donne pas accès aux publicités.</small></label>
            <div className={`${adsStyles.controlRow} ${styles.keyRow}`}>
              <input ref={keyInput} id="openai-ads-key" type="password" autoComplete="off" spellCheck={false} placeholder="Collez la clé publicitaire" maxLength={2048} required disabled={locked} />
              <button type="submit" className={`${dashboardStyles.actionBtn} ${dashboardStyles.connectBtn} ${adsStyles.channelPrimary} ${locked ? adsStyles.lockedAction : ""}`} disabled={locked || busy !== null}>{busy === "connect" ? "Vérification…" : connected ? "Actualiser" : "Connecter"} <span aria-hidden="true">→</span></button>
            </div>
          </form>
          {!refreshed && !connected && <p className={adsStyles.detail} role="status">Vérification de la connexion…</p>}
        </div>
      </section>

      <section data-step-index="1" className={`${socialStyles.stepCard} ${adsStyles.step}`} aria-label="Étape 2 : Compte annonceur">
        <div className={`${socialStyles.stepHeader} ${adsStyles.stepHeader}`}>
          <span className={socialStyles.stepNumber} aria-hidden="true">02</span>
          <div className={socialStyles.stepCopy}><div>Compte annonceur</div><div>Vérifiez le compte et son droit de créer des campagnes dans Ads Manager.</div></div>
          <div className={socialStyles.stepStatus}>{locked ? <span className={adsStyles.lockedPill}>Verrouillé</span> : <ConnectionPill connected={connected && Boolean(status.accountId)} label={connected ? "Compte reconnu" : undefined} />}</div>
        </div>
        <div className={`${socialStyles.stepBody} ${adsStyles.stepBody}`}>
          <div className={adsStyles.resourceControls}>
            <div className={styles.accountIdentity}>
              <strong>{connected ? status.accountName || status.accountId : "Aucun compte associé"}</strong>
              {connected && <small>{status.accountId}{status.currency ? ` · ${status.currency}` : ""}</small>}
            </div>
            <div className={adsStyles.resourceActions}>{locked ? <button type="button" className={`${dashboardStyles.actionBtn} ${adsStyles.lockedAction}`} disabled>Ouvrir Ads Manager</button> : <a className={`${dashboardStyles.actionBtn} ${adsStyles.viewAccount}`} href={accountUrl} target="_blank" rel="noopener noreferrer">Ouvrir Ads Manager <span aria-hidden="true">↗</span></a>}</div>
          </div>
          <p className={adsStyles.detail}>{locked ? "La configuration ChatGPT Ads sera disponible après validation de ce canal." : connected
            ? status.readinessMessage || (status.publicationEnabled
              ? "Création de campagnes en pause disponible. La diffusion reste soumise à validation dans Ads Manager."
              : "Connexion reconnue. La création en pause n’est pas disponible pour le moment.")
            : status.status === "needs_update" && status.readinessMessage
              ? status.readinessMessage
              : "Créez d’abord un compte annonceur dans Ads Manager, puis collez sa clé publicitaire dans l’étape précédente."}</p>
        </div>
      </section>

      {!locked && error && <p className={adsStyles.inlineError} role="alert">{error} <button type="button" className={styles.retry} onClick={() => void refresh()}>Réessayer</button></p>}
      {!locked && <p className={adsStyles.footnote}>Les campagnes créées via iNr’ADS sont envoyées <strong>en pause</strong>. Aucune diffusion ni dépense ne démarre sans une activation ultérieure explicite.</p>}
      <div className={adsStyles.footer}>
        <button type="button" className={adsStyles.previous} disabled={step === 0} onClick={() => setStep(0)}>← Précédent</button>
        <span className={adsStyles.progress}>Étape {step + 1} / 2</span>
        {step === 0 ? <button type="button" className={adsStyles.done} onClick={() => setStep(1)}>Suivant →</button> : <button type="button" className={adsStyles.done} onClick={closePanel}>Fermer</button>}
      </div>
    </div>
  </SettingsDrawer>;
}
