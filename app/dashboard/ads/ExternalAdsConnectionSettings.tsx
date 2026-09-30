"use client";

import { useEffect, useMemo, useState } from "react";
import SettingsDrawer from "@/app/dashboard/SettingsDrawer";
import ChannelSettingsHeader from "@/app/dashboard/_components/ChannelSettingsHeader";
import ConnectionPill from "@/app/dashboard/_components/ConnectionPill";
import socialStyles from "@/app/dashboard/_components/SocialSettingsSteps.module.css";
import dashboardStyles from "@/app/dashboard/dashboard.module.css";
import { getChannelSettingsHeaderStyle } from "@/app/dashboard/channel-settings";
import { getAdsAdvertiserAccountUrl } from "@/lib/adsAccountLinks";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import { adsAssociationDisplayReady } from "@/lib/adsConnectionSnapshot";
import styles from "./AdsConnectionSettings.module.css";

export type ExternalAdsSettingsChannel = "linkedin" | "tiktok" | "pinterest" | "x";

export type ExternalAdsSettingsStatus = {
  load: "idle" | "loading" | "ready" | "error";
  configured: boolean;
  connected: boolean;
  status: string;
  selectedAccountId: string;
  selectedAccountName: string;
  scopes?: string[];
  missingScopes?: string[];
  selectedAccountCanManage?: boolean;
  selectedAccountCanServe?: boolean;
  publicationEnabled?: boolean;
  error: string;
};

export type ExternalAdsSettingsAccount = {
  id: string;
  name: string;
  currency?: string | null;
  status?: string;
  eligibleToAssociate?: boolean | null;
  permissions?: string[];
  canManageCampaigns?: boolean;
  canServeCampaigns?: boolean;
  servingStatuses?: string[];
  test?: boolean;
};

type NavigationTarget = {
  name: string;
  onSelect: () => void;
};

type Props = {
  isOpen: boolean;
  channel: ExternalAdsSettingsChannel;
  previous: NavigationTarget;
  next: NavigationTarget;
  onClose: () => void;
  status: ExternalAdsSettingsStatus;
  accounts: ExternalAdsSettingsAccount[];
  accountChoice: string;
  accountsLoading: boolean;
  accountsLoaded: boolean;
  accountsLoadFailed: boolean;
  action: "associate" | "disconnect" | null;
  error: string;
  onSelectAccount: (accountId: string) => void;
  onRefreshStatus: () => void;
  onRefreshAccounts: () => void;
  onAssociateAccount: () => void;
  onDisconnect: () => void;
};

const CHANNEL_UI: Record<ExternalAdsSettingsChannel, {
  label: string;
  logo: string;
  lead: string;
  connectionCopy: string;
  accountCopy: string;
  accountLabel: string;
  requiresEuro: boolean;
}> = {
  linkedin: {
    label: "LinkedIn Ads",
    logo: "/ads-logos/linkedin.svg",
    lead: "Votre espace publicitaire LinkedIn.",
    connectionCopy: "Autorisez la gestion des campagnes, le Sponsored Content et les statistiques Ads. Cette connexion reste indépendante de vos publications LinkedIn organiques.",
    accountCopy: "Sélectionnez le compte annonceur qui prendra en charge vos campagnes LinkedIn.",
    accountLabel: "Compte publicitaire",
    requiresEuro: false,
  },
  tiktok: {
    label: "TikTok Ads",
    logo: "/ads-logos/tiktok.svg",
    lead: "Votre espace publicitaire TikTok.",
    connectionCopy: "Connectez-vous à TikTok for Business avec les autorisations Ads. Cette connexion est indépendante de vos publications organiques.",
    accountCopy: "Sélectionnez le compte en euros qui prendra en charge les frais publicitaires.",
    accountLabel: "Compte publicitaire en euros",
    requiresEuro: true,
  },
  pinterest: {
    label: "Pinterest Ads",
    logo: "/ads-logos/pinterest.svg",
    lead: "Votre espace publicitaire Pinterest.",
    connectionCopy: "Connectez-vous à Pinterest avec les autorisations Ads. Cette connexion est indépendante des publications gratuites du dashboard.",
    accountCopy: "Sélectionnez le compte en euros qui prendra en charge les frais publicitaires.",
    accountLabel: "Compte publicitaire en euros",
    requiresEuro: true,
  },
  x: {
    label: "X Ads",
    logo: "/ads-logos/x.svg",
    lead: "Votre espace publicitaire X.",
    connectionCopy: "Connectez-vous à X avec les autorisations publicitaires. Cette connexion est indépendante de vos publications organiques.",
    accountCopy: "Sélectionnez le compte en euros qui prendra en charge vos campagnes X.",
    accountLabel: "Compte publicitaire en euros",
    requiresEuro: true,
  },
};

function oauthHref(channel: ExternalAdsSettingsChannel, linkedinAccess: "read" | "manage" = "manage") {
  return `/api/ads/${channel}/start${channel === "linkedin" ? `?access=${linkedinAccess}` : ""}`;
}

function accountLabel(account: ExternalAdsSettingsAccount) {
  const identity = account.name.trim() || `Compte ${account.id}`;
  const idAlreadyShown = identity.replace(/\D/g, "").includes(account.id.replace(/\D/g, ""));
  return `${identity}${idAlreadyShown ? "" : ` · ${account.id}`}${account.currency ? ` · ${account.currency}` : ""}`;
}

export default function ExternalAdsConnectionSettings({
  isOpen,
  channel,
  previous,
  next,
  onClose,
  status,
  accounts,
  accountChoice,
  accountsLoading,
  accountsLoaded,
  accountsLoadFailed,
  action,
  error,
  onSelectAccount,
  onRefreshStatus,
  onRefreshAccounts,
  onAssociateAccount,
  onDisconnect,
}: Props) {
  const [step, setStep] = useState(0);
  const current = CHANNEL_UI[channel];

  useEffect(() => { setStep(0); }, [channel]);

  const needsReconnect = status.status === "needs_update" || status.status === "needs_reconnect";
  const linkedinManagementMissing = channel === "linkedin"
    && status.connected
    && Boolean(status.missingScopes?.length);
  const connectionDisplayStatus: ConnectionDisplayStatus = needsReconnect || linkedinManagementMissing
    ? "needs_update"
    : status.connected ? "connected" : "disconnected";
  const connectionStatusLabel = !status.configured
      ? "Indisponible"
      : linkedinManagementMissing
        ? "Autorisations à compléter"
      : status.connected
        ? undefined
        : status.load === "loading" || status.load === "idle"
          ? "Vérification…"
      : status.load === "error" && !status.connected
        ? "À vérifier"
        : undefined;
  const busy = accountsLoading || action !== null || (status.load === "loading" && !status.connected);
  const selectedAccount = accounts.find((account) => account.id === accountChoice);
  const configuredAccount = accounts.find((account) => account.id === status.selectedAccountId);
  const selectedAccountCanBeVerified = Boolean(selectedAccount
    && selectedAccount.eligibleToAssociate !== false
    && (!current.requiresEuro || !selectedAccount.currency || selectedAccount.currency === "EUR"));
  const configuredAccountEligibilityAccepted = channel === "x"
    ? configuredAccount?.eligibleToAssociate === true
    : configuredAccount?.eligibleToAssociate !== false;
  const configuredAccountEligible = Boolean(configuredAccount
    && configuredAccountEligibilityAccepted
    && (!current.requiresEuro || configuredAccount.currency === "EUR"));
  const accountConfigured = adsAssociationDisplayReady(status.connected, status.selectedAccountId, accountChoice,
    accountsLoaded ? configuredAccountEligible : undefined);
  const hasConfiguredAccount = Boolean(status.selectedAccountId);
  // A newly discovered X advertiser is intentionally tri-state: the user may
  // nominate it, but POST /accounts must verify it before it can be persisted.
  const accountCandidateReady = status.connected && selectedAccountCanBeVerified;
  const connectionValue = !status.configured
      ? `Connexion ${current.label} indisponible`
      : needsReconnect
        ? `La connexion ${current.label} doit être actualisée`
        : linkedinManagementMissing
          ? `${current.label} connecté · reconnexion requise pour la gestion complète`
        : status.connected
          ? `${current.label} connecté`
          : status.load === "loading" || status.load === "idle"
            ? `Vérification de la connexion ${current.label}…`
          : `Aucun compte ${current.label} connecté`;
  const accountStatusLabel = accountConfigured
    ? "Compte choisi"
    : hasConfiguredAccount
      ? "Accès à vérifier"
      : accountCandidateReady
        ? "À confirmer"
        : undefined;
  const configuredAccountUrl = getAdsAdvertiserAccountUrl(channel, status.selectedAccountId);
  const effectiveError = error || (status.load === "error" && !status.connected ? status.error : "");
  const linkedinRefreshAccess = channel === "linkedin" ? "manage" : "read";
  const accountOptions = useMemo(() => accounts.map((account) => {
    const unsupportedCurrency = current.requiresEuro && Boolean(account.currency) && account.currency !== "EUR";
    const unavailable = account.eligibleToAssociate === false || unsupportedCurrency;
    const reason = account.eligibleToAssociate === false
      ? "accès insuffisant"
      : unsupportedCurrency ? "euros requis" : "";
    return { account, unavailable, reason };
  }), [accounts, current.requiresEuro]);

  return <SettingsDrawer
    title={`Configurer ${current.label}`}
    isOpen={isOpen}
    onClose={onClose}
    presentation="centered"
    keepMounted
    headerContent={<ChannelSettingsHeader
      name={current.label}
      logoSrc={current.logo}
      previous={previous}
      next={next}
    />}
    headerLead={current.lead}
    headerStyle={getChannelSettingsHeaderStyle(channel)}
    headerActions={<button type="button" className={dashboardStyles.channelSettingsAllChannelsButton} onClick={onClose} aria-label="Tous les canaux" title="Tous les canaux"><span className={dashboardStyles.channelSettingsAllChannelsIcon} aria-hidden="true">☷</span><span className={dashboardStyles.channelSettingsAllChannelsLabel}>Tous les canaux</span></button>}
  >
    <div className={`${styles.content} ${socialStyles.journey} ${styles[channel]}`} data-step={step}>
      <section data-step-index="0" className={`${socialStyles.stepCard} ${styles.step}`} aria-label="Étape 1 : Votre connexion">
        <div className={`${socialStyles.stepHeader} ${styles.stepHeader}`}>
          <span className={socialStyles.stepNumber} aria-hidden="true">01</span>
          <div className={`${socialStyles.stepCopy} ${styles.stepCopy}`}><div>Votre connexion</div><div>{current.connectionCopy}</div></div>
          <div className={socialStyles.stepStatus}><ConnectionPill connected={status.connected} status={connectionDisplayStatus} label={connectionStatusLabel} /></div>
        </div>
        <div className={`${socialStyles.stepBody} ${styles.stepBody}`}>
          <div className={styles.controlRow}>
            <input readOnly aria-label={`Compte connecté à ${current.label}`} value={connectionValue} />
            {status.load === "error" ? <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.secondaryBtn}`} disabled={busy} onClick={onRefreshStatus}>Réessayer</button> : null}
            {status.configured && status.connected ? <>
              {linkedinManagementMissing ? <a className={`${dashboardStyles.actionBtn} ${dashboardStyles.connectBtn} ${styles.channelPrimary}`} href={oauthHref(channel, "manage")}>Compléter les autorisations Ads <span aria-hidden="true">→</span></a> : null}
              {needsReconnect && !linkedinManagementMissing ? <a className={`${dashboardStyles.actionBtn} ${dashboardStyles.connectBtn} ${styles.channelPrimary}`} href={oauthHref(channel, linkedinRefreshAccess)}>Actualiser la connexion <span aria-hidden="true">→</span></a> : null}
              <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.disconnectBtn}`} disabled={busy} onClick={onDisconnect}>{action === "disconnect" ? "Déconnexion…" : "Déconnexion"}</button>
            </> : status.configured && needsReconnect ? <>
              <a className={`${dashboardStyles.actionBtn} ${dashboardStyles.connectBtn} ${styles.channelPrimary}`} href={oauthHref(channel, linkedinRefreshAccess)}>Reconnecter {current.label} <span aria-hidden="true">→</span></a>
              <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.disconnectBtn}`} disabled={busy} onClick={onDisconnect}>{action === "disconnect" ? "Déconnexion…" : "Déconnexion"}</button>
            </> : status.configured && status.load !== "loading" && status.load !== "idle" ? <a className={`${dashboardStyles.actionBtn} ${dashboardStyles.connectBtn} ${styles.channelPrimary}`} href={oauthHref(channel)}>Connecter {current.label} <span aria-hidden="true">→</span></a> : <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.secondaryBtn}`} disabled>{status.configured ? "Vérification…" : "Connexion indisponible"}</button>}
          </div>
        </div>
      </section>

      <section data-step-index="1" className={`${socialStyles.stepCard} ${styles.step}`} aria-label="Étape 2 : Compte annonceur">
        <div className={`${socialStyles.stepHeader} ${styles.stepHeader}`}>
          <span className={socialStyles.stepNumber} aria-hidden="true">02</span>
          <div className={`${socialStyles.stepCopy} ${styles.stepCopy}`}><div>Compte annonceur</div><div>{current.accountCopy}</div></div>
          <div className={socialStyles.stepStatus}><ConnectionPill connected={accountConfigured} label={accountStatusLabel} /></div>
        </div>
        <div className={`${socialStyles.stepBody} ${styles.stepBody}`}>
          <div className={styles.resourceControls}>
            <label className={styles.field}>{current.accountLabel}
              <select aria-label={accountConfigured ? "Changer de compte" : "Choisir un compte"} value={accountChoice} disabled={!status.connected || busy} onChange={(event) => onSelectAccount(event.target.value)}>
                <option value="">Sélectionnez un compte</option>
                {hasConfiguredAccount && !configuredAccount ? <option value={status.selectedAccountId}>{status.selectedAccountName || `Compte ${status.selectedAccountId}`}{accountsLoaded ? " · accès à vérifier" : ""}</option> : null}
                {accountOptions.map(({ account, unavailable, reason }) => <option key={account.id} value={account.id} disabled={unavailable}>{accountLabel(account)}{reason ? ` (${reason})` : ""}</option>)}
              </select>
            </label>
            <div className={styles.resourceActions}>
              <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.secondaryBtn}`} disabled={!status.connected || action !== null || accountsLoading} onClick={onRefreshAccounts}>{accountsLoading ? "Actualisation…" : "Charger mes comptes"}</button>
              {accountCandidateReady && !accountConfigured ? <button type="button" className={`${dashboardStyles.actionBtn} ${dashboardStyles.connectBtn} ${styles.channelPrimary}`} disabled={action !== null} onClick={onAssociateAccount}>{action === "associate" ? "Association…" : "Associer ce compte"}</button> : null}
              {configuredAccountUrl ? <a className={`${dashboardStyles.actionBtn} ${styles.viewAccount}`} href={configuredAccountUrl} target="_blank" rel="noreferrer" aria-label={`Voir le compte ${status.selectedAccountName || status.selectedAccountId} dans ${current.label}`}>Voir le compte</a> : null}
            </div>
          </div>
          {selectedAccount ? <p className={styles.detail}>{channel === "linkedin"
            ? `${accountConfigured ? "Compte sélectionné" : "Compte à confirmer"} : ${accountLabel(selectedAccount)}. Rôle LinkedIn : ${selectedAccount.permissions?.[0] || "non vérifié"}. Gestion : ${selectedAccount.canManageCampaigns === true ? "autorisée" : "non autorisée avec cette connexion"}. Servabilité : ${selectedAccount.canServeCampaigns === true ? "RUNNABLE" : selectedAccount.servingStatuses?.includes("RUNNABLE") && selectedAccount.test !== true ? "RUNNABLE, accès de gestion requis" : "non vérifiée"}.`
            : accountConfigured ? `Compte sélectionné : ${accountLabel(selectedAccount)}. Les frais sont gérés directement par ${current.label}.` : "Ce compte sera utilisé après confirmation."}</p> : null}
          {accountsLoadFailed ? <p className={styles.inlineError}>La liste des comptes n’a pas pu être chargée. Réessayez avec « Charger mes comptes ».</p> : null}
        </div>
      </section>

      {effectiveError ? <p role="alert" className={styles.inlineError}>{effectiveError}</p> : null}
      {channel !== "pinterest" ? <p className={styles.footnote}>{channel === "linkedin" ? "Cette autorisation Ads permet de préparer la création, la modification, l’archivage et les statistiques. La diffusion LinkedIn reste désactivée tant que le compte Development et chaque ressource ne sont pas vérifiés." : `La préparation et l’enregistrement des campagnes sont disponibles. La publication sur ${current.label} n’est pas encore activée : aucune annonce n’est diffusée depuis cet écran.`}</p> : null}

      <div className={styles.footer}>
        <button type="button" className={styles.previous} disabled={step === 0} onClick={() => setStep(0)}>← Précédent</button>
        <span className={styles.progress}>Étape {step + 1} / 2</span>
        {step === 0 ? <button type="button" className={styles.done} onClick={() => setStep(1)}>Suivant →</button> : <button type="button" className={styles.done} onClick={onClose}>Fermer</button>}
      </div>
    </div>
  </SettingsDrawer>;
}
