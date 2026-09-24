"use client";

import { useEffect, useState } from "react";
import SettingsDrawer from "@/app/dashboard/SettingsDrawer";
import ChannelSettingsHeader from "@/app/dashboard/_components/ChannelSettingsHeader";
import ConnectionPill from "@/app/dashboard/_components/ConnectionPill";
import socialStyles from "@/app/dashboard/_components/SocialSettingsSteps.module.css";
import dashboardStyles from "@/app/dashboard/dashboard.module.css";
import { getChannelSettingsHeaderStyle } from "@/app/dashboard/channel-settings";
import { ADS_CHANNELS, type AdsAccount, type AdsProvider } from "@/lib/adsValidation";
import styles from "./AdsConnectionSettings.module.css";

type Props = {
  isOpen: boolean;
  provider: AdsProvider;
  onSelectProvider: (provider: AdsProvider) => void;
  onClose: () => void;
  onConnect: () => void;
  connected: boolean;
  loading: boolean;
  accounts: AdsAccount[];
  pages: { id: string; name: string; instagramUserId?: string }[];
  selectedAccountId: string;
  selectedPageId: string;
  onSelectAccount: (id: string) => void;
  onSelectPage: (id: string) => void;
  onRefreshAccounts: () => void;
};

const LOGOS: Record<AdsProvider, string> = {
  meta: "/ads-logos/meta.svg",
  google: "/ads-logos/google-ads.svg",
};

export default function AdsConnectionSettings({
  isOpen, provider, onSelectProvider, onClose, onConnect, connected, loading,
  accounts, pages, selectedAccountId, selectedPageId, onSelectAccount, onSelectPage, onRefreshAccounts,
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
  const accountReady = connected && selectedAccount?.currency === "EUR";
  const identityReady = connected && Boolean(selectedPage?.instagramUserId);
  const configurationReady = Boolean(accountReady && (provider === "google" || identityReady));

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
          <div className={socialStyles.stepStatus}><ConnectionPill connected={connected} activity={loading ? "searching" : undefined} label={loading ? "Vérification…" : undefined} /></div>
        </div>
        <div className={`${socialStyles.stepBody} ${styles.stepBody}`}>
          <div className={styles.controlRow}>
            <input readOnly aria-label="État de la connexion publicitaire" value={loading ? "Vérification de la connexion…" : connected ? `${current.label} connecté` : "Aucun compte publicitaire connecté"} />
            <a className={styles.action} href={`/api/ads/oauth/${provider}/start`}>{provider === "meta" ? `${connected ? "Reconnecter" : "Connecter"} Meta Ads via Facebook` : `${connected ? "Reconnecter" : "Connecter"} Google Ads`} <span aria-hidden="true">→</span></a>
          </div>
        </div>
      </section>

      <section hidden={compactScreen && step !== 1} className={`${socialStyles.stepCard} ${styles.step}`} aria-label="Étape 2 : Compte annonceur">
        <div className={`${socialStyles.stepHeader} ${styles.stepHeader}`}>
          <span className={socialStyles.stepNumber} aria-hidden="true">02</span>
          <div className={`${socialStyles.stepCopy} ${styles.stepCopy}`}><div>Compte annonceur</div><div>Sélectionnez le compte en euros qui prendra en charge les frais publicitaires.</div></div>
          <div className={socialStyles.stepStatus}><ConnectionPill connected={accountReady} label={accountReady ? "Compte choisi" : undefined} /></div>
        </div>
        <div className={`${socialStyles.stepBody} ${styles.stepBody}`}>
          <label className={styles.field}>Compte publicitaire en euros
            <select value={selectedAccountId} disabled={!connected || loading} onChange={(event) => onSelectAccount(event.target.value)}>
              <option value="">Sélectionnez un compte</option>
              {accounts.map((account) => <option key={account.id} value={account.id} disabled={account.currency !== "EUR"}>{account.name} · {account.id} · {account.currency}{account.currency !== "EUR" ? " (non pris en charge)" : ""}</option>)}
            </select>
          </label>
          {selectedAccount && <p className={styles.detail}>Compte choisi : {selectedAccount.name}. Les frais sont gérés directement par {current.label}.</p>}
        </div>
      </section>

      {provider === "meta" && <section hidden={compactScreen && step !== 2} className={`${socialStyles.stepCard} ${styles.step}`} aria-label="Étape 3 : Identité de l’annonce">
        <div className={`${socialStyles.stepHeader} ${styles.stepHeader}`}>
          <span className={socialStyles.stepNumber} aria-hidden="true">03</span>
          <div className={`${socialStyles.stepCopy} ${styles.stepCopy}`}><div>Identité de l’annonce</div><div>Les Pages Facebook et leurs comptes Instagram professionnels liés sont récupérés depuis Meta.</div></div>
          <div className={socialStyles.stepStatus}><ConnectionPill connected={identityReady} label={identityReady ? "Facebook + Instagram" : selectedPage ? "Instagram à associer" : undefined} /></div>
        </div>
        <div className={`${socialStyles.stepBody} ${styles.stepBody}`}>
          <div className={styles.controlRow}>
            <label className={styles.field}>Page Facebook + compte Instagram lié
              <select value={selectedPageId} disabled={!connected || loading} onChange={(event) => onSelectPage(event.target.value)}>
                <option value="">Sélectionnez une Page</option>
                {pages.map((page) => <option key={page.id} value={page.id}>{page.name} · {page.instagramUserId ? "Instagram lié" : "Instagram à associer"}</option>)}
              </select>
            </label>
            <button type="button" className={styles.refresh} disabled={!connected || loading} onClick={onRefreshAccounts}>{loading ? "Actualisation…" : "Actualiser les identités"}</button>
          </div>
          {selectedPage && <p className={styles.detail}>{selectedPage.instagramUserId ? "Votre annonce utilisera cette Page Facebook et son compte Instagram déjà lié." : "Associez un compte Instagram professionnel à cette Page dans Meta Business Suite, puis actualisez les identités."}</p>}
        </div>
      </section>}

      <div className={styles.footer}>
        {compactScreen ? <><button type="button" className={styles.previous} disabled={step === 0} onClick={() => setStep((currentStep) => currentStep - 1)}>← Précédent</button><span className={styles.progress}>Étape {step + 1} / {stepCount}</span>{step < stepCount - 1 ? <button type="button" className={styles.done} onClick={() => setStep((currentStep) => currentStep + 1)}>Suivant →</button> : <button type="button" className={styles.done} disabled={!configurationReady} onClick={onConnect}>Connecter</button>}</> : <button type="button" className={styles.done} disabled={!configurationReady} onClick={onConnect}>Connecter</button>}
      </div>
    </div>
  </SettingsDrawer>;
}
