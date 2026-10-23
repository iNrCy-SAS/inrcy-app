"use client";

import { useMemo } from "react";
import AdsConnectionIcon from "./AdsConnectionIcon";
import { getAdsAdvertiserAccountUrl } from "@/lib/adsAccountLinks";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import { adsAssociationDisplayReady } from "@/lib/adsConnectionSnapshot";
import { tikTokAdsAccountDisplay } from "@/lib/adsTikTokAccountDisplay";
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

type Props = {
  active: boolean;
  channel: ExternalAdsSettingsChannel;
  locked?: boolean;
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
  connectionCopy: string;
  accountLabel: string;
  requiresEuro: boolean;
}> = {
  linkedin: {
    label: "LinkedIn Ads",
    connectionCopy: "Autorisez la gestion des campagnes, le Sponsored Content et les statistiques Ads. Cette connexion reste indépendante de vos publications LinkedIn organiques.",
    accountLabel: "Compte publicitaire",
    requiresEuro: false,
  },
  tiktok: {
    label: "TikTok Ads",
    connectionCopy: "Connectez-vous à TikTok for Business avec les autorisations Ads. Cette connexion est indépendante de vos publications organiques.",
    accountLabel: "Compte publicitaire en euros",
    requiresEuro: true,
  },
  pinterest: {
    label: "Pinterest Ads",
    connectionCopy: "Connectez-vous à Pinterest avec les autorisations Ads. Cette connexion est indépendante des publications gratuites du dashboard.",
    accountLabel: "Compte publicitaire en euros",
    requiresEuro: true,
  },
  x: {
    label: "X Ads",
    connectionCopy: "Connectez-vous à X avec les autorisations publicitaires. Cette connexion est indépendante de vos publications organiques.",
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
  active,
  channel,
  locked = false,
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
  const current = CHANNEL_UI[channel];

  const needsReconnect = status.status === "needs_update" || status.status === "needs_reconnect";
  const linkedinManagementMissing = channel === "linkedin"
    && status.connected
    && Boolean(status.missingScopes?.length);
  const connectionDisplayStatus: ConnectionDisplayStatus = locked ? "disconnected" : needsReconnect || linkedinManagementMissing
    ? "needs_update"
    : status.connected ? "connected" : "disconnected";
  const connectionStatusLabel = locked ? "Verrouillé" : !status.configured
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
  const busy = locked || accountsLoading || action !== null || (status.load === "loading" && !status.connected);
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
  const accountConfigured = !locked && adsAssociationDisplayReady(status.connected, status.selectedAccountId, accountChoice,
    accountsLoaded ? configuredAccountEligible : undefined);
  const hasConfiguredAccount = Boolean(status.selectedAccountId);
  // A newly discovered X advertiser is intentionally tri-state: the user may
  // nominate it, but POST /accounts must verify it before it can be persisted.
  const accountCandidateReady = !locked && status.connected && selectedAccountCanBeVerified;
  const connectionValue = locked ? "Connexion réservée à l’administration" : !status.configured
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
  const configuredAccountUrl = locked ? null : getAdsAdvertiserAccountUrl(channel, status.selectedAccountId);
  const effectiveError = locked ? "" : error || (status.load === "error" && !status.connected ? status.error : "");
  const linkedinRefreshAccess = channel === "linkedin" ? "manage" : "read";
  const accountOptions = useMemo(() => accounts.map((account) => {
    const unsupportedCurrency = current.requiresEuro && Boolean(account.currency) && account.currency !== "EUR";
    const unavailable = account.eligibleToAssociate === false || unsupportedCurrency;
    const tiktokStatus = channel === "tiktok" ? tikTokAdsAccountDisplay(account) : null;
    const reason = tiktokStatus ? tiktokStatus.reason : account.eligibleToAssociate === false
      ? "accès insuffisant"
      : unsupportedCurrency ? "euros requis" : "";
    return { account, unavailable, reason, tiktokStatus };
  }), [accounts, channel, current.requiresEuro]);

  if (!status.connected && !needsReconnect) return <div hidden={!active} data-ads-connection-controls={channel} className={`${styles.content} ${styles.connectionPrompt} ${styles[channel]}`}>
    {locked || !status.configured || status.load === "loading" || status.load === "idle" ? <button type="button" className={styles.initialConnect} disabled>{!locked && status.configured ? "Vérification…" : "Connecter"}</button> : <a className={styles.initialConnect} href={oauthHref(channel)} aria-label={`Connecter ${current.label}`}>Connecter</a>}
    {effectiveError ? <p className={styles.inlineError} role="alert">{effectiveError} <button type="button" onClick={onRefreshStatus}>Réessayer</button></p> : null}
  </div>;

  return <div hidden={!active} data-ads-connection-controls={channel} data-connection-status={connectionDisplayStatus} className={`${styles.content} ${styles[channel]}`}>
    <div className={styles.controlRow}>
      {locked || !status.configured ? <input readOnly aria-label={`Connexion ${current.label}`} value={connectionValue} />
        : status.connected && !needsReconnect && !linkedinManagementMissing ? <input readOnly aria-label={`Compte connecté à ${current.label}`} title={connectionStatusLabel || current.connectionCopy} value="Compte autorisé" />
          : status.load === "error" && !needsReconnect ? <button type="button" className={styles.connectField} disabled={busy} onClick={onRefreshStatus}>Réessayer la connexion</button>
            : status.load === "loading" || status.load === "idle" ? <input readOnly aria-label={`Connexion ${current.label}`} value="Vérification de la connexion…" />
              : <a className={styles.connectField} href={oauthHref(channel, linkedinRefreshAccess)}>{linkedinManagementMissing ? "Compléter les autorisations Ads" : needsReconnect ? `Reconnecter ${current.label}` : `Connecter ${current.label}`}</a>}
    {!locked && status.configured && (status.connected || needsReconnect) ? <button type="button" data-ads-icon-action="disconnect" disabled={busy} onClick={onDisconnect} title={`Déconnexion ${current.label}`} aria-label={`Déconnexion ${current.label}`}><AdsConnectionIcon name="disconnect" /></button> : null}
    </div>
    <div className={styles.resourceControls}>
      <select aria-label={accountConfigured ? "Changer de compte" : "Choisir un compte"} title={`${current.accountLabel} · ${accountStatusLabel || "À associer"}`} value={locked ? "" : accountChoice} disabled={!status.connected || busy} onChange={(event) => onSelectAccount(event.target.value)}>
        <option value="">Choisir un compte publicitaire</option>
        {hasConfiguredAccount && !configuredAccount ? <option value={status.selectedAccountId}>{status.selectedAccountName || `Compte ${status.selectedAccountId}`}{accountsLoaded ? " · accès à vérifier" : ""}</option> : null}
        {accountOptions.map(({ account, unavailable, reason, tiktokStatus }) => <option key={account.id} value={account.id} disabled={unavailable}>{accountLabel(account)}{tiktokStatus ? ` · ${tiktokStatus.statusLabel}` : ""}{reason ? ` (${reason})` : ""}</option>)}
      </select>
      {accountCandidateReady && !accountConfigured ? <button type="button" disabled={action !== null} onClick={onAssociateAccount} data-ads-icon-action="save" title="Associer ce compte" aria-label="Associer ce compte"><AdsConnectionIcon name="save" /></button> : null}
    </div>
    <div className={styles.actionBar} role="group" aria-label={`Actions ${current.label}`}>
      {configuredAccountUrl ? <a className={styles.actionItem} href={configuredAccountUrl} target="_blank" rel="noreferrer" title="Voir le compte" aria-label={`Voir le compte ${status.selectedAccountName || status.selectedAccountId} dans ${current.label}`}><AdsConnectionIcon name="view" /></a> : null}

      <button type="button" className={styles.actionItem} disabled={!status.connected || action !== null || accountsLoading} onClick={onRefreshAccounts} title="Charger mes comptes" aria-label="Charger mes comptes"><AdsConnectionIcon name="refresh" /></button>
      <details className={styles.identityMenu}>
        <summary className={styles.actionItem} title="Informations du compte" aria-label="Informations du compte"><AdsConnectionIcon name="info" /></summary>
        <div className={styles.identityPopover}>
          <strong>{current.label}</strong>
          <p className={styles.detail}>{current.connectionCopy}</p>
          {!locked && status.connected && channel === "tiktok" ? accountOptions.filter(({ unavailable, tiktokStatus }) => unavailable && tiktokStatus?.help).map(({ account, tiktokStatus }) => <p key={account.id} className={styles.detail}>{account.name.trim() || `Compte ${account.id}`} : {tiktokStatus?.help}</p>) : null}
          {selectedAccount ? <p className={styles.detail}>{channel === "linkedin" ? `${accountLabel(selectedAccount)}. Rôle LinkedIn : ${selectedAccount.permissions?.[0] || "non vérifié"}. Gestion : ${selectedAccount.canManageCampaigns === true ? "autorisée" : "non autorisée avec cette connexion"}. Servabilité : ${selectedAccount.canServeCampaigns === true ? "RUNNABLE" : selectedAccount.servingStatuses?.includes("RUNNABLE") && selectedAccount.test !== true ? "RUNNABLE, accès de gestion requis" : "non vérifiée"}.` : accountConfigured ? `${accountLabel(selectedAccount)}. Les frais sont gérés directement par ${current.label}.` : "Ce compte sera utilisé après confirmation."}</p> : null}
          {!locked && channel !== "pinterest" ? <p className={styles.detail}>{channel === "linkedin" ? "Cette connexion permet de créer et gérer vos campagnes LinkedIn Ads et de consulter leurs statistiques, selon vos autorisations sur le compte publicitaire." : `La préparation et l’enregistrement des campagnes sont disponibles. La publication sur ${current.label} n’est pas encore activée : aucune annonce n’est diffusée depuis cet écran.`}</p> : null}
        </div>
      </details>
    </div>
    {accountsLoadFailed ? <p className={styles.inlineError} role="alert">Comptes indisponibles. Réessayez avec « Charger mes comptes ».</p> : effectiveError ? <p role="alert" className={styles.inlineError}>{effectiveError}</p> : null}
  </div>;
}
