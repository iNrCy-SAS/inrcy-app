"use client";

import { adsUiText, translateAdsUiChoices } from "./adsUiCopy";
import { useTranslations } from "next-intl";


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
const RAW_CHANNEL_UI = CHANNEL_UI;


function oauthHref(channel: ExternalAdsSettingsChannel, linkedinAccess: "read" | "manage" = "manage") {
  return `/api/ads/${channel}/start${channel === "linkedin" ? `?access=${linkedinAccess}` : ""}`;
}

function accountLabel(account: ExternalAdsSettingsAccount, fallback: string) {
  const identity = account.name.trim() || fallback;
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
  const i18nT = useTranslations("booster");
  const sharedT = useTranslations();
  const displayAccountLabel = (account: ExternalAdsSettingsAccount) => accountLabel(account, i18nT("compte_value_ae8bd05d", { value0: account.id }));
  const roleKeys: Record<string, string> = { VIEWER: "ads_role_viewer", CREATIVE_MANAGER: "ads_role_creative_manager", CAMPAIGN_MANAGER: "ads_role_campaign_manager", ACCOUNT_MANAGER: "ads_role_account_manager", ACCOUNT_BILLING_ADMIN: "ads_role_account_billing_admin" };
  const roleLabel = (role: string | undefined) => role && Object.hasOwn(roleKeys, role) ? i18nT(roleKeys[role]) : i18nT("ads_role_unverified");
  const { CHANNEL_UI } = useMemo(() => ({ CHANNEL_UI: translateAdsUiChoices(RAW_CHANNEL_UI, i18nT) }), [i18nT]);
  const current = CHANNEL_UI[channel];

  const needsReconnect = status.status === "needs_update" || status.status === "needs_reconnect";
  const linkedinManagementMissing = channel === "linkedin"
    && status.connected
    && Boolean(status.missingScopes?.length);
  const connectionDisplayStatus: ConnectionDisplayStatus = locked ? "disconnected" : needsReconnect || linkedinManagementMissing
    ? "needs_update"
    : status.connected ? "connected" : "disconnected";
  const connectionStatusLabel = locked ? i18nT("ads_ui_ecb0b9e7d5") : !status.configured
      ? i18nT("image_decision_unavailable")
      : linkedinManagementMissing
        ? i18nT("ads_ui_fdae391d6f")
      : status.connected
        ? undefined
        : status.load === "loading" || status.load === "idle"
          ? i18nT("verification_30a67937")
      : status.load === "error" && !status.connected
        ? i18nT("a_verifier_8f5f7255")
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
  const connectionValue = locked ? i18nT("ads_ui_18b7e71f65") : !status.configured
      ? i18nT("ads_connection_unavailable", { channel: current.label })
      : needsReconnect
        ? i18nT("ads_ui_88f51486c0", { value0: current.label })
        : linkedinManagementMissing
          ? i18nT("ads_ui_147a897558", { value0: current.label })
        : status.connected
          ? i18nT("ads_ui_35547d3274", { value0: current.label })
          : status.load === "loading" || status.load === "idle"
            ? i18nT("ads_ui_cdac820e83", { value0: current.label })
          : i18nT("ads_ui_6d10459fad", { value0: current.label });
  const accountStatusLabel = accountConfigured
    ? i18nT("ads_account_chosen")
    : hasConfiguredAccount
      ? i18nT("acces_a_verifier_0355ddb6")
      : accountCandidateReady
        ? i18nT("ads_ui_3cf0cee799")
        : undefined;
  const configuredAccountUrl = locked ? null : getAdsAdvertiserAccountUrl(channel, status.selectedAccountId);
  const effectiveError = locked ? "" : error || (status.load === "error" && !status.connected ? status.error : "");
  const linkedinRefreshAccess = channel === "linkedin" ? "manage" : "read";
  const accountOptions = useMemo(() => accounts.map((account) => {
    const unsupportedCurrency = current.requiresEuro && Boolean(account.currency) && account.currency !== "EUR";
    const unavailable = account.eligibleToAssociate === false || unsupportedCurrency;
    const nativeTikTokStatus = channel === "tiktok" ? tikTokAdsAccountDisplay(account) : null;
    const tiktokStatus = nativeTikTokStatus ? {
      statusLabel: nativeTikTokStatus.statusLabel === "Actif" ? sharedT("settings.actif_2eb75f84") : nativeTikTokStatus.statusLabel === "Non actif" ? i18nT("ads_tiktok_inactive") : i18nT("ads_tiktok_status_unconfirmed"),
      reason: adsUiText(i18nT, nativeTikTokStatus.reason),
      help: adsUiText(i18nT, nativeTikTokStatus.help),
    } : null;
    const reason = tiktokStatus ? tiktokStatus.reason : account.eligibleToAssociate === false
      ? i18nT("ads_ui_c0e7ba56be")
      : unsupportedCurrency ? adsUiText(i18nT, "euros requis") : "";
    return { account, unavailable, reason, tiktokStatus };
  }), [accounts, channel, current.requiresEuro, i18nT, sharedT]);

  if (!status.connected && !needsReconnect) return <div hidden={!active} data-ads-connection-controls={channel} className={`${styles.content} ${styles.connectionPrompt} ${styles[channel]}`}>
    {locked || !status.configured || status.load === "loading" || status.load === "idle" ? <button type="button" className={styles.initialConnect} disabled>{!locked && status.configured ? i18nT("verification_30a67937") : i18nT("connecter_ca28e250")}</button> : <a className={styles.initialConnect} href={oauthHref(channel)} aria-label={i18nT("connecter_value_57738aed", { value0: current.label })}>{i18nT("connecter_ca28e250")}</a>}
    {effectiveError ? <p className={styles.inlineError} role="alert">{effectiveError} <button type="button" onClick={onRefreshStatus}>{i18nT("reessayer_895d416b")}</button></p> : null}
  </div>;

  return <div hidden={!active} data-ads-connection-controls={channel} data-connection-status={connectionDisplayStatus} className={`${styles.content} ${styles[channel]}`}>
    <div className={styles.controlRow}>
      {locked || !status.configured ? <input readOnly aria-label={i18nT("connexion_value_b784d08c", { value0: current.label })} value={connectionValue} />
        : status.connected && !needsReconnect && !linkedinManagementMissing ? <input readOnly aria-label={i18nT("compte_connecte_a_value_b81c5568", { value0: current.label })} title={connectionStatusLabel || current.connectionCopy} value={i18nT("ads_ui_1886cfaa9d")} />
          : status.load === "error" && !needsReconnect ? <button type="button" className={styles.connectField} disabled={busy} onClick={onRefreshStatus}>{i18nT("reessayer_la_connexion_a1876271")}</button>
            : status.load === "loading" || status.load === "idle" ? <input readOnly aria-label={i18nT("connexion_value_b784d08c", { value0: current.label })} value={i18nT("ads_ui_f15043be6f")} />
              : <a className={styles.connectField} href={oauthHref(channel, linkedinRefreshAccess)}>{linkedinManagementMissing ? i18nT("completer_les_autorisations_ads_8c2230f5") : needsReconnect ? i18nT("reconnecter_value_d8079aa6", { value0: current.label }) : i18nT("connecter_value_57738aed", { value0: current.label })}</a>}
    {!locked && status.configured && (status.connected || needsReconnect) ? <button type="button" data-ads-icon-action="disconnect" disabled={busy} onClick={onDisconnect} title={i18nT("deconnexion_value_3fdef0e3", { value0: current.label })} aria-label={i18nT("deconnexion_value_3fdef0e3", { value0: current.label })}><AdsConnectionIcon name="disconnect" /></button> : null}
    </div>
    <div className={styles.resourceControls}>
      <select aria-label={accountConfigured ? i18nT("changer_de_compte_6a10073f") : i18nT("choisir_un_compte_a1145e8a")} title={`${current.accountLabel} · ${accountStatusLabel || i18nT("a_associer_98e1fb09")}`} value={locked ? "" : accountChoice} disabled={!status.connected || busy} onChange={(event) => onSelectAccount(event.target.value)}>
        <option value="">{i18nT("choisir_un_compte_publicitaire_4218219a")}</option>
        {hasConfiguredAccount && !configuredAccount ? <option value={status.selectedAccountId}>{status.selectedAccountName || i18nT("compte_value_ae8bd05d", { value0: status.selectedAccountId })}{accountsLoaded ? i18nT("acces_a_verifier_b67826b0") : ""}</option> : null}
        {accountOptions.map(({ account, unavailable, reason, tiktokStatus }) => <option key={account.id} value={account.id} disabled={unavailable}>{displayAccountLabel(account)}{tiktokStatus ? ` · ${tiktokStatus.statusLabel}` : ""}{reason ? ` (${reason})` : ""}</option>)}
      </select>
      {accountCandidateReady && !accountConfigured ? <button type="button" disabled={action !== null} onClick={onAssociateAccount} data-ads-icon-action="save" title={i18nT("associer_ce_compte_d86b4870")} aria-label={i18nT("associer_ce_compte_d86b4870")}><AdsConnectionIcon name="save" /></button> : null}
    </div>
    <div className={styles.actionBar} role="group" aria-label={i18nT("actions_value_606f289c", { value0: current.label })}>
      {configuredAccountUrl ? <a className={styles.actionItem} href={configuredAccountUrl} target="_blank" rel="noreferrer" title={i18nT("voir_le_compte_1cbd7501")} aria-label={i18nT("voir_le_compte_value_dans_value_a5c7eee3", { value0: status.selectedAccountName || status.selectedAccountId, value1: current.label })}><AdsConnectionIcon name="view" /></a> : null}

      <button type="button" className={styles.actionItem} disabled={!status.connected || action !== null || accountsLoading} onClick={onRefreshAccounts} title={i18nT("charger_mes_comptes_feac3a8e")} aria-label={i18nT("charger_mes_comptes_feac3a8e")}><AdsConnectionIcon name="refresh" /></button>
      <details className={styles.identityMenu}>
        <summary className={styles.actionItem} title={i18nT("informations_du_compte_11c8586a")} aria-label={i18nT("informations_du_compte_11c8586a")}><AdsConnectionIcon name="info" /></summary>
        <div className={styles.identityPopover}>
          <strong>{current.label}</strong>
          <p className={styles.detail}>{current.connectionCopy}</p>
          {!locked && status.connected && channel === "tiktok" ? accountOptions.filter(({ unavailable, tiktokStatus }) => unavailable && tiktokStatus?.help).map(({ account, tiktokStatus }) => <p key={account.id} className={styles.detail}>{account.name.trim() || i18nT("compte_value_ae8bd05d", { value0: account.id })} : {tiktokStatus?.help}</p>) : null}
          {selectedAccount ? <p className={styles.detail}>{channel === "linkedin" ? i18nT("value_role_linkedin_value_gestion_value_cb735852", { value0: displayAccountLabel(selectedAccount), value1: roleLabel(selectedAccount.permissions?.[0]), value2: selectedAccount.canManageCampaigns === true ? i18nT("autorisee_e2fde3bc") : i18nT("ads_management_not_authorised"), value3: selectedAccount.canServeCampaigns === true ? i18nT("autorisee_e2fde3bc") : selectedAccount.servingStatuses?.includes("RUNNABLE") && selectedAccount.test !== true ? i18nT("ads_serving_management_required") : i18nT("ads_serving_unverified") }) : accountConfigured ? i18nT("value_les_frais_sont_geres_directement_af954986", { value0: displayAccountLabel(selectedAccount), value1: current.label }) : i18nT("ce_compte_sera_utilise_apres_confirmation_55439234")}</p> : null}
          {!locked && channel !== "pinterest" ? <p className={styles.detail}>{channel === "linkedin" ? i18nT("cette_connexion_permet_de_creer_et_242607ca") : i18nT("la_preparation_et_l_enregistrement_des_3d2d3ec7", { value0: current.label })}</p> : null}
        </div>
      </details>
    </div>
    {accountsLoadFailed ? <p className={styles.inlineError} role="alert">{i18nT("comptes_indisponibles_reessayez_avec_charger_mes_669ef3d4")}</p> : effectiveError ? <p role="alert" className={styles.inlineError}>{effectiveError}</p> : null}
  </div>;
}
