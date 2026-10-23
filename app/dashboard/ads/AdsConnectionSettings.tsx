"use client";

import AdsConnectionIcon from "./AdsConnectionIcon";
import { getAdsAdvertiserAccountUrl } from "@/lib/adsAccountLinks";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import { adsAssociationDisplayReady } from "@/lib/adsConnectionSnapshot";
import {
  adsAccountAssociationIssue,
  adsAccountCanBeAssociated,
  type AdsAccount,
  type AdsProvider,
} from "@/lib/adsValidation";
import styles from "./AdsConnectionSettings.module.css";

type ConfigAction = "disconnect" | "save-account" | "clear-account" | "save-page" | "clear-page" | null;

type Props = {
  active: boolean;
  provider: AdsProvider;
  locked?: boolean;
  connected: boolean;
  connectionStatus: ConnectionDisplayStatus;
  connectionAccount?: { displayName?: string; email?: string; id?: string };
  loading: boolean;
  error?: string;
  configAction: ConfigAction;
  accounts: AdsAccount[];
  pages: { id: string; name: string; instagramUserId?: string }[];
  selectedAccountId: string;
  selectedPageId: string;
  configuredAccountId: string;
  configuredAccountLabel: string;
  configuredPageId: string;
  configuredAccountAvailable?: boolean;
  configuredPageAvailable?: boolean;
  metaNeedsInstagramIdentity: boolean;
  onSelectAccount: (id: string) => void;
  onSelectPage: (id: string) => void;
  onRefreshAccounts: () => void;
  onDisconnect: () => void;
  onSaveAccount: () => void;
  onClearAccount: () => void;
  onSavePage: () => void;
  onClearPage: () => void;
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

/** Keep the provider label readable without repeating an ID already used as its name. */
function advertiserAccountLabel(account: AdsAccount) {
  const name = account.name.trim();
  const digitsInName = name.replace(/\D/g, "");
  const digitsInId = account.id.replace(/\D/g, "");
  const identity = name || `Compte ${account.id}`;
  const idIsAlreadyShown = Boolean(digitsInId) && digitsInName.includes(digitsInId);

  return `${identity}${idIsAlreadyShown ? "" : ` · ${account.id}`} · ${account.currency}`;
}

export default function AdsConnectionSettings({
  active,
  provider,
  locked = false,
  connected,
  connectionStatus,
  connectionAccount,
  loading,
  error,
  configAction,
  accounts,
  pages,
  selectedAccountId,
  selectedPageId,
  configuredAccountId,
  configuredAccountLabel,
  configuredPageId,
  configuredAccountAvailable,
  configuredPageAvailable,
  metaNeedsInstagramIdentity,
  onSelectAccount,
  onSelectPage,
  onRefreshAccounts,
  onDisconnect,
  onSaveAccount,
  onClearAccount,
  onSavePage,
  onClearPage,
}: Props) {
  const current = { label: provider === "meta" ? "Meta Ads" : "Google Ads" };
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const selectedPage = pages.find((page) => page.id === selectedPageId);
  const savedAccount = accounts.find(
    (account) => account.id === configuredAccountId && account.provider === provider && adsAccountCanBeAssociated(account),
  );
  const savedPage = pages.find((page) => page.id === configuredPageId);
  const accountConfigured = !locked && adsAssociationDisplayReady(connected, configuredAccountId, selectedAccountId, configuredAccountAvailable);
  const identityConfigured = !locked && adsAssociationDisplayReady(connected, configuredPageId, selectedPageId, configuredPageAvailable);
  const hasConfiguredAccount = Boolean(configuredAccountId);
  const hasConfiguredPage = Boolean(configuredPageId);
  const accountCandidateReady = !locked && connected && Boolean(selectedAccount && adsAccountCanBeAssociated(selectedAccount));
  const configuredAccountUrl = !locked && configuredAccountId
    ? getAdsAdvertiserAccountUrl(provider, configuredAccountId)
    : null;
  const identityReady = identityConfigured && (
    !metaNeedsInstagramIdentity || Boolean(savedPage?.instagramUserId)
  );
  const identityStatusLabel = identityReady
    ? metaNeedsInstagramIdentity
      ? "Facebook + Instagram"
      : savedPage?.instagramUserId
        ? "Page + Instagram"
        : "Page Facebook"
    : selectedPage && metaNeedsInstagramIdentity && !selectedPage.instagramUserId
      ? "Instagram requis"
      : selectedPage
        ? "À confirmer"
        : undefined;
  const needsReconnect = connectionStatus === "needs_update";
  const connectedAccountLabel = connectionAccountLabel(provider, connectionAccount);
  const busy = locked || loading || configAction !== null;

  if (!connected && !needsReconnect) return <div hidden={!active} data-ads-connection-controls={provider} className={`${styles.content} ${styles.connectionPrompt} ${styles[provider]}`}>
    {locked ? <button type="button" className={styles.initialConnect} disabled>Connecter</button> : <a className={styles.initialConnect} href={`/api/ads/oauth/${provider}/start`} aria-label={oauthLabel(provider, "connect")}>Connecter</a>}
    {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
  </div>;

  return <div hidden={!active} data-ads-connection-controls={provider} className={`${styles.content} ${styles[provider]}`}>
    <div className={styles.controlRow}>
      {locked ? <input readOnly aria-label="Connexion publicitaire" value="Connexion réservée à l’administration" />
        : connected ? <input readOnly aria-label="Compte connecté à iNr’ADS" title={connectedAccountLabel} value={connectedAccountLabel} />
          : <a className={styles.connectField} href={`/api/ads/oauth/${provider}/start`}>{oauthLabel(provider, needsReconnect ? "reconnect" : "connect")}</a>}
    {!locked && (connected || needsReconnect) ? <button type="button" data-ads-icon-action="disconnect" disabled={busy} onClick={onDisconnect} title={`Déconnexion ${current.label}`} aria-label={`Déconnexion ${current.label}`}><AdsConnectionIcon name="disconnect" /></button> : null}
    </div>
    <div className={styles.resourceControls}>
      <select aria-label={accountConfigured ? "Changer de compte" : "Choisir un compte"} title="Compte publicitaire en euros" value={locked ? "" : selectedAccountId} disabled={!connected || busy} onChange={(event) => onSelectAccount(event.target.value)}>
        <option value="">Choisir un compte publicitaire</option>
        {hasConfiguredAccount && !savedAccount ? <option value={configuredAccountId} disabled>{configuredAccountLabel || `Compte ${configuredAccountId}`}{configuredAccountAvailable === false ? " · accès à vérifier" : ""}</option> : null}
        {accounts.map((account) => {
          const issue = adsAccountAssociationIssue(account);
          return <option key={account.id} value={account.id} disabled={Boolean(issue)}>{advertiserAccountLabel(account)}{issue ? ` (${issue})` : ""}</option>;
        })}
      </select>
      {accountCandidateReady && !accountConfigured ? <button type="button" disabled={busy} onClick={onSaveAccount} data-ads-icon-action="save" title="Associer ce compte" aria-label="Associer ce compte"><AdsConnectionIcon name="save" /></button> : null}
      {!locked && hasConfiguredAccount ? <button type="button" disabled={busy} onClick={onClearAccount} data-ads-icon-action="unlink" title="Dissocier ce compte" aria-label="Dissocier ce compte"><AdsConnectionIcon name="unlink" /></button> : null}
    </div>
    <div className={styles.actionBar} role="group" aria-label={`Actions ${current.label}`}>
      {configuredAccountUrl ? <a className={styles.actionItem} href={configuredAccountUrl} target="_blank" rel="noreferrer" title="Voir le compte" aria-label={`Voir le compte ${(savedAccount?.name ?? configuredAccountLabel) || "publicitaire"} dans ${current.label}`}><AdsConnectionIcon name="view" /></a> : null}

      <button type="button" className={styles.actionItem} disabled={!connected || busy} onClick={onRefreshAccounts} title="Charger mes comptes" aria-label="Charger mes comptes"><AdsConnectionIcon name="refresh" /></button>
      {provider === "meta" && <details className={styles.identityMenu}>
        <summary className={styles.actionItem} title="Identité Facebook et Instagram" aria-label="Identité Facebook et Instagram"><AdsConnectionIcon name="instagram" /><i className={styles.identityState} data-ready={identityReady} aria-label={identityStatusLabel || (hasConfiguredPage ? "Accès à vérifier" : "Identité à associer")} /></summary>
        <div className={styles.identityPopover} role="group" aria-label="Identité Facebook et Instagram">
          <strong>Facebook / Instagram</strong>
          <div className={styles.resourceControls}>
            <select aria-label={identityConfigured ? "Changer l’identité" : "Choisir l’identité"} title={metaNeedsInstagramIdentity ? "Page Facebook + compte Instagram lié" : "Page Facebook"} value={locked ? "" : selectedPageId} disabled={!connected || busy} onChange={(event) => onSelectPage(event.target.value)}>
              <option value="">Choisir une Page Facebook</option>
              {hasConfiguredPage && !savedPage ? <option value={configuredPageId} disabled>Page {configuredPageId}{configuredPageAvailable === false ? " · accès à vérifier" : ""}</option> : null}
              {pages.map((page) => <option key={page.id} value={page.id}>{page.name} · {page.instagramUserId ? "Instagram lié" : metaNeedsInstagramIdentity ? "Instagram requis pour ces placements" : "Facebook uniquement"}</option>)}
            </select>
          </div>
          <div className={styles.resourceActions}>
            <button type="button" disabled={!connected || busy} onClick={onRefreshAccounts} data-ads-icon-action="refresh" title="Charger mes identités" aria-label="Charger mes identités"><AdsConnectionIcon name="refresh" /></button>
            {selectedPage && !identityConfigured ? <button type="button" disabled={busy} onClick={onSavePage} data-ads-icon-action="save" title="Associer cette identité" aria-label="Associer cette identité"><AdsConnectionIcon name="save" /></button> : null}
            {!locked && hasConfiguredPage ? <button type="button" disabled={busy} onClick={onClearPage} data-ads-icon-action="unlink" title="Dissocier l’identité" aria-label="Dissocier l’identité"><AdsConnectionIcon name="unlink" /></button> : null}
          </div>
          <p className={styles.detail}>{metaNeedsInstagramIdentity && !selectedPage?.instagramUserId ? "Associez un compte Instagram professionnel à votre Page Facebook, puis actualisez les identités." : "Cette Page Facebook suffit pour les placements actuellement sélectionnés."}</p>
        </div>
      </details>}
    </div>
    {error ? <p role="alert" className={styles.inlineError}>{error}</p> : null}
  </div>;
}
