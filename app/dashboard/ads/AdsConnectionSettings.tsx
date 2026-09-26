"use client";

import { useEffect, useState } from "react";
import SettingsDrawer from "@/app/dashboard/SettingsDrawer";
import ChannelSettingsHeader from "@/app/dashboard/_components/ChannelSettingsHeader";
import ConnectionPill from "@/app/dashboard/_components/ConnectionPill";
import socialStyles from "@/app/dashboard/_components/SocialSettingsSteps.module.css";
import dashboardStyles from "@/app/dashboard/dashboard.module.css";
import { getChannelSettingsHeaderStyle } from "@/app/dashboard/channel-settings";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import { ADS_CHANNELS, type AdsAccount, type AdsProvider } from "@/lib/adsValidation";
import styles from "./AdsConnectionSettings.module.css";

type ConfigAction = "disconnect" | "save-account" | "clear-account" | "save-page" | "clear-page" | null;

type Props = {
  isOpen: boolean;
  provider: AdsProvider;
  onSelectProvider: (provider: AdsProvider) => void;
  onClose: () => void;
  connected: boolean;
  connectionStatus: ConnectionDisplayStatus;
  connectionAccount?: { displayName?: string; email?: string; id?: string };
  loading: boolean;
  configAction: ConfigAction;
  accounts: AdsAccount[];
  pages: { id: string; name: string; instagramUserId?: string }[];
  selectedAccountId: string;
  selectedPageId: string;
  configuredAccountId: string;
  configuredPageId: string;
  onSelectAccount: (id: string) => void;
  onSelectPage: (id: string) => void;
  onRefreshAccounts: () => void;
  onDisconnect: () => void;
  onSaveAccount: () => void;
  onClearAccount: () => void;
  onSavePage: () => void;
  onClearPage: () => void;
};

const LOGOS: Record<AdsProvider, string> = {
  meta: "/ads-logos/meta.svg",
  google: "/ads-logos/google-ads.svg",
};

function oauthLabel(provider: AdsProvider, action: "connect" | "reconnect") {
  if (provider === "meta") return `${action === "reconnect" ? "Reconnecter" : "Connecter"} Meta Ads via Facebook`;
  return `${action === "reconnect" ? "Reconnecter" : "Connecter"} Google Ads`;
}

function connectionAccountLabel(provider: AdsProvider, account?: { displayName?: string; email?: string; id?: string }) {
  const name = account?.displayName?.trim();
  const email = account?.email?.trim();
  const identity = [name, email].filter(Boolean).join(" · ");
  if (identity) return identity;
  return provider === "meta" ? "Compte Facebook" : "Compte Google";
}

export default function AdsConnectionSettings({
  isOpen,
  provider,
  onSelectProvider,
  onClose,
  connected,
  connectionStatus,
  connectionAccount,
  loading,
  configAction,
  accounts,
  pages,
  selectedAccountId,
  selectedPageId,
  configuredAccountId,
  configuredPageId,
  onSelectAccount,
  onSelectPage,
  onRefreshAccounts,
  onDisconnect,
  onSaveAccount,
  onClearAccount,
  onSavePage,
  onClearPage,
}: Props) {
  const [compactScreen, setCompactScreen] = useState(false);
  const [step, setStep] = useState(0);
  const stepCount = provider === "meta" ? 3 : 2;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 999px), (max-height: 659px)");
    const update = () => { setCompactScreen(media.matches); setStep(0); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { setStep(0); }, [provider]);

  const settingsChannels = ADS_CHANNELS.filter(
    (channel): channel is Extract<(typeof ADS_CHANNELS)[number], { id: AdsProvider }> =>
      channel.id === "meta" || channel.id === "google",
  );
  const index = Math.max(0, settingsChannels.findIndex((channel) => channel.id === provider));
  const current = settingsChannels[index]!;
  const previous = settingsChannels[(index - 1 + settingsChannels.length) % settingsChannels.length]!;
  const next = settingsChannels[(index + 1) % settingsChannels.length]!;
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const selectedPage = pages.find((page) => page.id === selectedPageId);
  const savedAccount = accounts.find((account) => account.id === configuredAccountId && account.currency === "EUR");
  const savedPage = pages.find((page) => page.id === configuredPageId);
  const accountConfigured = Boolean(savedAccount && savedAccount.id === selectedAccount?.id);
  const identityConfigured = Boolean(savedPage && savedPage.id === selectedPage?.id);
  const accountCandidateReady = connected && selectedAccount?.currency === "EUR";
  const identityReady = identityConfigured && Boolean(savedPage?.instagramUserId);
  const needsReconnect = connectionStatus === "needs_update";
  const connectedAccountLabel = connectionAccountLabel(provider, connectionAccount);
  const busy = loading || configAction !== null;

  return <SettingsDrawer
    title={`Configurer ${current.label}`}
    isOpen={isOpen}
    onClose={onClose}
    presentation="centered"
    headerContent={<ChannelSettingsHeader
      name={current.label}
      logoSrc={LOGOS[provider]}
      previous={{ name: previous.label, onSelect: () => onSelectProvider(previous.id) }}
      next={{ name: next.label, onSelect: () => onSelectProvider(next.id) }}
    />}
    headerLead={provider === "meta" ? "Votre espace publicitaire Facebook et Instagram." : "Vos annonces de recherche Google Ads."}
    headerStyle={getChannelSettingsHeaderStyle(provider === "meta" ? "facebook" : "gmb")}
    headerActions={<button type="button" className={dashboardStyles.channelSettingsAllChannelsButton} onClick={onClose} aria-label="Tous les canaux" title="Tous les canaux"><span className={dashboardStyles.channelSettingsAllChannelsIcon} aria-hidden="true">☷</span><span className={dashboardStyles.channelSettingsAllChannelsLabel}>Tous les canaux</span></button>}
  >
    <div className={`${styles.content} ${socialStyles.journey} ${provider === "meta" ? styles.meta : styles.google}`} data-compact={compactScreen || undefined}>
      <section hidden={compactScreen && step !== 0} className={`${socialStyles.stepCard} ${styles.step}`} aria-label="Étape 1 : Votre connexion">
        <div className={`${socialStyles.stepHeader} ${styles.stepHeader}`}>
          <span className={socialStyles.stepNumber} aria-hidden="true">01</span>
          <div className={`${socialStyles.stepCopy} ${styles.stepCopy}`}><div>Votre connexion</div><div>{provider === "meta" ? "Connectez-vous via Facebook avec les autorisations Ads. Cette connexion est indépendante des publications gratuites du dashboard." : "Une seule autorisation Google Ads donne accès à vos comptes publicitaires pour les annonces de recherche."}</div></div>
          <div className={socialStyles.stepStatus}><ConnectionPill connected={connected} status={connectionStatus} activity={loading ? "searching" : undefined} label={loading ? "Vérification…" : undefined} /></div>
        </div>
        <div className={`${socialStyles.stepBody} ${styles.stepBody}`}>
          <div className={styles.controlRow}>
            <input readOnly aria-label="Compte connecté à iNr’ADS" value={loading ? "Vérification de la connexion…" : needsReconnect ? `${connectedAccountLabel} doit être reconnecté` : connected ? `${provider === "meta" ? "Compte Facebook" : "Compte Google"} connecté : ${connectedAccountLabel}` : "Aucun compte connecté"} />
            {connected ? <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.disconnectBtn}`} disabled={busy} onClick={onDisconnect}>{configAction === "disconnect" ? "Déconnexion…" : "Déconnexion"}</button> : needsReconnect ? <>
              <a className={`${dashboardStyles.actionBtn} ${dashboardStyles.connectBtn}`} href={`/api/ads/oauth/${provider}/start`}>{oauthLabel(provider, "reconnect")} <span aria-hidden="true">→</span></a>
              <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.disconnectBtn}`} disabled={busy} onClick={onDisconnect}>Déconnexion</button>
            </> : <a className={`${dashboardStyles.actionBtn} ${dashboardStyles.connectBtn}`} href={`/api/ads/oauth/${provider}/start`}>{oauthLabel(provider, "connect")} <span aria-hidden="true">→</span></a>}
          </div>
        </div>
      </section>

      <section hidden={compactScreen && step !== 1} className={`${socialStyles.stepCard} ${styles.step}`} aria-label="Étape 2 : Compte annonceur">
        <div className={`${socialStyles.stepHeader} ${styles.stepHeader}`}>
          <span className={socialStyles.stepNumber} aria-hidden="true">02</span>
          <div className={`${socialStyles.stepCopy} ${styles.stepCopy}`}><div>Compte annonceur</div><div>Sélectionnez le compte en euros qui prendra en charge les frais publicitaires.</div></div>
          <div className={socialStyles.stepStatus}><ConnectionPill connected={accountConfigured} label={accountConfigured ? "Compte choisi" : accountCandidateReady ? "À confirmer" : undefined} /></div>
        </div>
        <div className={`${socialStyles.stepBody} ${styles.stepBody}`}>
          <div className={styles.resourceControls}>
            <label className={styles.field}>Compte publicitaire en euros
              <select value={selectedAccountId} disabled={!connected || busy} onChange={(event) => onSelectAccount(event.target.value)}>
                <option value="">Sélectionnez un compte</option>
                {accounts.map((account) => <option key={account.id} value={account.id} disabled={account.currency !== "EUR"}>{account.name} · {account.id} · {account.currency}{account.currency !== "EUR" ? " (non pris en charge)" : ""}</option>)}
              </select>
            </label>
            <div className={styles.resourceActions}>
              <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.secondaryBtn}`} disabled={!connected || busy} onClick={onRefreshAccounts}>{loading ? "Actualisation…" : "Charger mes comptes"}</button>
              {accountCandidateReady && !accountConfigured ? <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.connectBtn}`} disabled={busy} onClick={onSaveAccount}>{configAction === "save-account" ? "Enregistrement…" : savedAccount ? "Changer de compte" : "Utiliser ce compte"}</button> : null}
              {accountConfigured ? <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.disconnectBtn}`} disabled={busy} onClick={onClearAccount}>{configAction === "clear-account" ? "Dissociation…" : "Dissocier ce compte"}</button> : null}
            </div>
          </div>
          {selectedAccount ? <p className={styles.detail}>{accountConfigured ? `Compte sélectionné : ${selectedAccount.name}. Les frais sont gérés directement par ${current.label}.` : "Ce compte sera utilisé après confirmation."}</p> : null}
        </div>
      </section>

      {provider === "meta" && <section hidden={compactScreen && step !== 2} className={`${socialStyles.stepCard} ${styles.step}`} aria-label="Étape 3 : Identité de l’annonce">
        <div className={`${socialStyles.stepHeader} ${styles.stepHeader}`}>
          <span className={socialStyles.stepNumber} aria-hidden="true">03</span>
          <div className={`${socialStyles.stepCopy} ${styles.stepCopy}`}><div>Identité de l’annonce</div><div>Les Pages Facebook et leurs comptes Instagram professionnels liés sont récupérés depuis Meta.</div></div>
          <div className={socialStyles.stepStatus}><ConnectionPill connected={identityReady} label={identityReady ? "Facebook + Instagram" : selectedPage ? "À confirmer" : undefined} /></div>
        </div>
        <div className={`${socialStyles.stepBody} ${styles.stepBody}`}>
          <div className={styles.resourceControls}>
            <label className={styles.field}>Page Facebook + compte Instagram lié
              <select value={selectedPageId} disabled={!connected || busy} onChange={(event) => onSelectPage(event.target.value)}>
                <option value="">Sélectionnez une Page</option>
                {pages.map((page) => <option key={page.id} value={page.id}>{page.name} · {page.instagramUserId ? "Instagram lié" : "Instagram à associer"}</option>)}
              </select>
            </label>
            <div className={styles.resourceActions}>
              <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.secondaryBtn}`} disabled={!connected || busy} onClick={onRefreshAccounts}>{loading ? "Actualisation…" : "Charger mes identités"}</button>
              {selectedPage && !identityConfigured ? <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.connectBtn}`} disabled={busy} onClick={onSavePage}>{configAction === "save-page" ? "Enregistrement…" : savedPage ? "Changer l’identité" : "Utiliser cette identité"}</button> : null}
              {identityConfigured ? <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.disconnectBtn}`} disabled={busy} onClick={onClearPage}>{configAction === "clear-page" ? "Dissociation…" : "Dissocier l’identité"}</button> : null}
            </div>
          </div>
          {selectedPage ? <p className={styles.detail}>{identityConfigured && selectedPage.instagramUserId ? "Votre annonce utilisera cette Page Facebook et son compte Instagram déjà lié." : selectedPage.instagramUserId ? "Cette identité sera utilisée après confirmation." : "Associez un compte Instagram professionnel à cette Page dans Meta Business Suite, puis actualisez les identités."}</p> : null}
        </div>
      </section>}

      {compactScreen ? <div className={styles.footer}>
        <button type="button" className={styles.previous} disabled={step === 0} onClick={() => setStep((currentStep) => currentStep - 1)}>← Précédent</button>
        <span className={styles.progress}>Étape {step + 1} / {stepCount}</span>
        {step < stepCount - 1 ? <button type="button" className={styles.done} onClick={() => setStep((currentStep) => currentStep + 1)}>Suivant →</button> : <button type="button" className={styles.done} onClick={onClose}>Fermer</button>}
      </div> : null}
    </div>
  </SettingsDrawer>;
}
