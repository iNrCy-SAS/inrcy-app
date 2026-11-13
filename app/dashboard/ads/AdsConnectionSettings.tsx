"use client";

import { useTranslations } from "next-intl";


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
  const i18nT = useTranslations("booster");
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
        ? i18nT("ads_ui_3cf0cee799")
        : undefined;
  const needsReconnect = connectionStatus === "needs_update";
  const connectedAccountLabel = connectionAccountLabel(provider, connectionAccount);
  const busy = locked || loading || configAction !== null;

  if (!connected && !needsReconnect) return <div hidden={!active} data-ads-connection-controls={provider} className={`${styles.content} ${styles.connectionPrompt} ${styles[provider]}`}>
    {locked ? <button type="button" className={styles.initialConnect} disabled>{i18nT("connecter_ca28e250")}</button> : <a className={styles.initialConnect} href={`/api/ads/oauth/${provider}/start`} aria-label={oauthLabel(provider, "connect")}>{i18nT("connecter_ca28e250")}</a>}
    {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
  </div>;

  return <div hidden={!active} data-ads-connection-controls={provider} className={`${styles.content} ${styles[provider]}`}>
    <div className={styles.controlRow}>
      {locked ? <input readOnly aria-label={i18nT("connexion_publicitaire_34f5ea16")} value={i18nT("ads_ui_18b7e71f65")} />
        : connected ? <input readOnly aria-label={i18nT("compte_connecte_a_inr_ads_b5fe81ed")} title={connectedAccountLabel} value={connectedAccountLabel} />
          : <a className={styles.connectField} href={`/api/ads/oauth/${provider}/start`}>{oauthLabel(provider, needsReconnect ? "reconnect" : "connect")}</a>}
    {!locked && (connected || needsReconnect) ? <button type="button" data-ads-icon-action="disconnect" disabled={busy} onClick={onDisconnect} title={i18nT("deconnexion_value_3fdef0e3", { value0: current.label })} aria-label={i18nT("deconnexion_value_3fdef0e3", { value0: current.label })}><AdsConnectionIcon name="disconnect" /></button> : null}
    </div>
    <div className={styles.resourceControls}>
      <select aria-label={accountConfigured ? i18nT("changer_de_compte_6a10073f") : i18nT("choisir_un_compte_a1145e8a")} title={i18nT("compte_publicitaire_en_euros_b993447a")} value={locked ? "" : selectedAccountId} disabled={!connected || busy} onChange={(event) => onSelectAccount(event.target.value)}>
        <option value="">{i18nT("choisir_un_compte_publicitaire_4218219a")}</option>
        {hasConfiguredAccount && !savedAccount ? <option value={configuredAccountId} disabled>{configuredAccountLabel || i18nT("compte_value_ae8bd05d", { value0: configuredAccountId })}{configuredAccountAvailable === false ? i18nT("acces_a_verifier_b67826b0") : ""}</option> : null}
        {accounts.map((account) => {
          const issue = adsAccountAssociationIssue(account);
          return <option key={account.id} value={account.id} disabled={Boolean(issue)}>{advertiserAccountLabel(account)}{issue ? ` (${issue})` : ""}</option>;
        })}
      </select>
      {accountCandidateReady && !accountConfigured ? <button type="button" disabled={busy} onClick={onSaveAccount} data-ads-icon-action="save" title={i18nT("associer_ce_compte_d86b4870")} aria-label={i18nT("associer_ce_compte_d86b4870")}><AdsConnectionIcon name="save" /></button> : null}
      {!locked && hasConfiguredAccount ? <button type="button" disabled={busy} onClick={onClearAccount} data-ads-icon-action="unlink" title={i18nT("dissocier_ce_compte_3a5aeb2c")} aria-label={i18nT("dissocier_ce_compte_3a5aeb2c")}><AdsConnectionIcon name="unlink" /></button> : null}
    </div>
    <div className={styles.actionBar} role="group" aria-label={i18nT("actions_value_606f289c", { value0: current.label })}>
      {configuredAccountUrl ? <a className={styles.actionItem} href={configuredAccountUrl} target="_blank" rel="noreferrer" title={i18nT("voir_le_compte_1cbd7501")} aria-label={i18nT("voir_le_compte_value_dans_value_a5c7eee3", { value0: (savedAccount?.name ?? configuredAccountLabel) || "publicitaire", value1: current.label })}><AdsConnectionIcon name="view" /></a> : null}

      <button type="button" className={styles.actionItem} disabled={!connected || busy} onClick={onRefreshAccounts} title={i18nT("charger_mes_comptes_feac3a8e")} aria-label={i18nT("charger_mes_comptes_feac3a8e")}><AdsConnectionIcon name="refresh" /></button>
      {provider === "meta" && <details className={styles.identityMenu}>
        <summary className={styles.actionItem} title={i18nT("identite_facebook_et_instagram_f5ade33d")} aria-label={i18nT("identite_facebook_et_instagram_f5ade33d")}><AdsConnectionIcon name="instagram" /><i className={styles.identityState} data-ready={identityReady} aria-label={identityStatusLabel || (hasConfiguredPage ? i18nT("acces_a_verifier_0355ddb6") : i18nT("identite_a_associer_c528064c"))} /></summary>
        <div className={styles.identityPopover} role="group" aria-label={i18nT("identite_facebook_et_instagram_f5ade33d")}>
          <strong>{i18nT("facebook_instagram_07e302cc")}</strong>
          <div className={styles.resourceControls}>
            <select aria-label={identityConfigured ? i18nT("changer_l_identite_b2d85d9d") : i18nT("choisir_l_identite_5e0c5743")} title={metaNeedsInstagramIdentity ? i18nT("page_facebook_compte_instagram_lie_5b27eaca") : i18nT("page_facebook_5017637f")} value={locked ? "" : selectedPageId} disabled={!connected || busy} onChange={(event) => onSelectPage(event.target.value)}>
              <option value="">{i18nT("choisir_une_page_facebook_eb3b22c1")}</option>
              {hasConfiguredPage && !savedPage ? <option value={configuredPageId} disabled>{i18nT("page_fb06270f")}{" "}{configuredPageId}{configuredPageAvailable === false ? i18nT("acces_a_verifier_b67826b0") : ""}</option> : null}
              {pages.map((page) => <option key={page.id} value={page.id}>{page.name} · {page.instagramUserId ? i18nT("instagram_lie_d3668602") : metaNeedsInstagramIdentity ? i18nT("instagram_requis_pour_ces_placements_fda5b8cf") : i18nT("facebook_uniquement_547285ca")}</option>)}
            </select>
          </div>
          <div className={styles.resourceActions}>
            <button type="button" disabled={!connected || busy} onClick={onRefreshAccounts} data-ads-icon-action="refresh" title={i18nT("charger_mes_identites_0234733b")} aria-label={i18nT("charger_mes_identites_0234733b")}><AdsConnectionIcon name="refresh" /></button>
            {selectedPage && !identityConfigured ? <button type="button" disabled={busy} onClick={onSavePage} data-ads-icon-action="save" title={i18nT("associer_cette_identite_f76574ef")} aria-label={i18nT("associer_cette_identite_f76574ef")}><AdsConnectionIcon name="save" /></button> : null}
            {!locked && hasConfiguredPage ? <button type="button" disabled={busy} onClick={onClearPage} data-ads-icon-action="unlink" title={i18nT("dissocier_l_identite_aef50abf")} aria-label={i18nT("dissocier_l_identite_aef50abf")}><AdsConnectionIcon name="unlink" /></button> : null}
          </div>
          <p className={styles.detail}>{metaNeedsInstagramIdentity && !selectedPage?.instagramUserId ? i18nT("associez_un_compte_instagram_professionnel_a_100de28b") : i18nT("cette_page_facebook_suffit_pour_les_ce2335b3")}</p>
        </div>
      </details>}
    </div>
    {error ? <p role="alert" className={styles.inlineError}>{error}</p> : null}
  </div>;
}
