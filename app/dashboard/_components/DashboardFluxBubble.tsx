"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import styles from "../dashboard.module.css";
import bubbleStyles from "./DashboardChannelBubble.module.css";
import ChannelParametersDialog from "./ChannelParametersDialog";
import { DashboardPremiumLockIcon } from "./DashboardPremiumLockIcon";
import type { ModuleAction, ModuleStatus } from "../dashboard.types";
import type { ChannelBubbleConnection } from "./channel-bubble.types";
import { useDashboardUnsavedNavigation } from "./DashboardUnsavedNavigationProvider";
import Image from "next/image";
import ChannelPublicationTypes from "./ChannelPublicationTypes";
import ChannelBoardCreator from "./ChannelBoardCreator";
import ChannelPublicLinkEditor from "./ChannelPublicLinkEditor";
import ChannelMailboxConnections from "./ChannelMailboxConnections";
import ChannelConnectionMenu from "./ChannelConnectionMenu";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";

export type DashboardConfigureDestination = { kind: "panel"; value: string } | { kind: "path"; value: string };
export type DashboardFluxBubbleData = {
  key: string; name: string; description: string; accent: string; logoSrc: string; logoAlt: string;
  bubbleStatus: ModuleStatus; bubbleStatusText: string;
  specialViewHref?: string; specialViewLabel?: string; canViewSpecial?: boolean; onSpecialView?: () => void;
  viewAction?: ModuleAction; createHref?: string | null; onCreate?: () => void; createLabel?: string; createDisabled?: boolean;
  onConfigure: () => void; configureDestination?: DashboardConfigureDestination;
  configureDisabled?: boolean; configureTitle?: string; configureLabel?: string; viewFallbackLabel?: string;
  emphasizeDisabledReason?: boolean; premiumLocked?: boolean; premiumLabel?: string;
  connection?: ChannelBubbleConnection;
};

export function ChannelBubbleIcon({ kind }: { kind: "eye" | "plug" | "disconnect" | "settings" | "create" | "widget" }) {
  if (kind === "disconnect") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (kind === "widget") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="3" /><path d="M2 8h20M9 12l-3 3 3 3m6-6 3 3-3 3" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "eye" ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></> : kind === "plug" ? <><path d="M7 3v5m6-5v5M5 8h10v4a5 5 0 0 1-10 0V8Zm5 9v5m7-8h6m-3-3v6" /></> : kind === "settings" ? <><path d="m9 3-.6 2.3-2 .9-2.1-.6-1.6 2.8 1.5 1.7-.2 2.2-1.5 1.6 1.6 2.8 2.2-.5 1.9 1 .6 2.3h3.2l.7-2.3 1.9-1 2.2.5 1.6-2.8-1.5-1.6.1-2.2 1.4-1.7-1.6-2.8-2.1.6-2-.9L13 3H9Z" /><circle cx="11" cy="11.5" r="3" /></> : <path d="M12 5v14M5 12h14" />}
  </svg>;
}

export default function DashboardFluxBubble({ item, itemKey }: { item: DashboardFluxBubbleData; itemKey?: string }) {
  const t = useTranslations("dashboard.channelBubble");
  const connection = item.connection;
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const [parametersOpen, setParametersOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const actionRef = useRef(false);
  const mounted = useRef(true);
  const loaded = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = pending || connection?.busy;
  const disabled = item.configureDisabled || item.bubbleStatus === "coming";
  const run = async (action?: () => unknown | Promise<unknown>) => {
    if (!action || actionRef.current || busy || disabled) return;
    actionRef.current = true;
    setPending(true); setError("");
    try { const result = await action(); if (result === false && mounted.current) setError(t("failed")); } catch (caught) { if (mounted.current) setError(getClientUserFacingErrorMessage(caught, t("failed"))); }
    finally { actionRef.current = false; if (mounted.current) setPending(false); }
  };
  const viewLabel = item.specialViewLabel || item.viewAction?.label || t("view");
  const viewHref = item.specialViewHref || item.viewAction?.href;
  const viewCallback = item.onSpecialView || item.viewAction?.onClick;
  const canView = item.canViewSpecial ?? Boolean(viewCallback || (viewHref && viewHref !== "#"));
  const connectLabel = item.bubbleStatus === "reconnect" || connection?.accountConnected ? t("reconnect") : t("connect");
  const selectionCaption = t(item.key === "gmb" ? "selected" : item.key === "facebook" ? "selectedPage" : item.key === "pinterest" ? "selectedBoard" : item.key === "mails" ? "selectedMailbox" : "selectedAccount");
  const chooseLabel = t(item.key === "pinterest" ? "chooseBoard" : item.key === "facebook" ? "choosePage" : item.key === "mails" ? "chooseMailbox" : item.key === "gmb" ? "choose" : "chooseAccount");
  const options = connection?.options ?? [];
  const value = connection?.value || "";
  const selectedMissing = Boolean(value && !options.some(option => option.value === value));
  const hasResource = Boolean(connection?.accountConnected || (connection?.resourceLabel && value));
  const canConnect = Boolean(connection?.onConnect || connection?.connectOptions?.length);
  const connectMenus = [...new Set(connection?.connectOptions?.flatMap(option => option.menu ? [option.menu] : []) ?? [])];
  const chooseConnection = (option: NonNullable<ChannelBubbleConnection["connectOptions"]>[number]) => void run(async () => {
    const result = await option.onConnect();
    if (result !== false) setConnectOpen(false);
    return result;
  });
  const disconnect = connection?.onDisconnectAccount || connection?.onDisconnect;
  const showDisconnect = Boolean(disconnect && (connection?.accountConnected ?? Boolean(value)) && !(item.bubbleStatus === "reconnect" && canConnect));
  const showConnect = canConnect && !showDisconnect;
  const hasParameters = Boolean(connection?.parameters);
  const showParameters = hasParameters && (!canConnect || hasResource);
  const parametersLabel = connection?.parametersLabel || t(item.key === "mails" ? "signatureShort" : item.key === "pinterest" ? "boardsShort" : "parameters");
  const loadResourceChoices = () => {
    if (loaded.current || !connection?.onLoad || busy || connection.loading || disabled) return;
    loaded.current = true;
    void Promise.resolve().then(connection.onLoad).catch(() => {
      loaded.current = false;
      if (mounted.current) setError(t("failed"));
    });
  };
  const feedback = error || connection?.error;
  const loadingInResource = Boolean(!item.premiumLocked && !connection?.mailboxes && !connection?.resourceContent && !showConnect && (
    connection?.onSelect ? !value && (busy || connection.loading) : !hasResource && !disabled && connection?.loading
  ));
  const statusText = loadingInResource ? "" : busy || (connection?.loading && !hasResource) ? t("loading") : connection?.notice || "";

  return <>
    <article key={itemKey ?? item.key} data-channel-bubble={item.key} aria-label={`${item.name} — ${item.bubbleStatusText}`} className={`${bubbleStyles.card} ${bubbleStyles.workspaceCard} ${styles[`accent_${item.accent}`]} ${item.bubbleStatus === "coming" ? bubbleStyles.comingSoon : ""} ${item.bubbleStatus === "reconnect" ? bubbleStyles.reconnectCard : ""}`}>
      <span className={bubbleStyles.centralConnectionDot} data-status={item.bubbleStatus} role="img" aria-label={item.bubbleStatusText} title={item.bubbleStatusText} />
      <div className={`${bubbleStyles.stack} ${bubbleStyles.workspaceStack} ${connection?.mailboxes ? bubbleStyles.mailboxStack : ""}`}>
        <div className={bubbleStyles.logo} aria-hidden="true"><Image className={bubbleStyles.logoImage} src={item.logoSrc} alt="" width={72} height={72} loading="eager" fetchPriority="high" unoptimized decoding="sync" /><span className={bubbleStyles.connectionDot} data-status={item.bubbleStatus} /></div>
        <div className={bubbleStyles.identity}><h3 className={bubbleStyles.title}>{item.name}</h3><p className={bubbleStyles.tagline}>{item.description}</p></div>
        {item.premiumLocked ? <button type="button" className={bubbleStyles.action} onClick={item.onConfigure}><DashboardPremiumLockIcon className={bubbleStyles.actionPremiumLock} />{item.premiumLabel || "Premium"}</button> : <>
          {connection?.accountConnected && connection.accountLabel ? <div className={bubbleStyles.resourceGroup}>
            <span className={bubbleStyles.accountValue} aria-label={t("connectedAccount")} title={connection.accountLabel}>{connection.accountLabel}</span>
          </div> : null}
          {connection?.mailboxes ? <ChannelMailboxConnections slots={connection.mailboxes} disabled={Boolean(busy || disabled)} onAction={action => void run(action)} /> : connection?.resourceContent ? connection.resourceContent : <div className={bubbleStyles.resourceGroup}>
            {showConnect ? <>
              {hasResource && connection?.resourceLabel ? <span className={bubbleStyles.accountValue} title={connection.resourceLabel}>{connection.resourceLabel}</span> : null}
              <button type="button" className={`${bubbleStyles.action} ${bubbleStyles.connectAction} ${item.bubbleStatus === "reconnect" ? bubbleStyles.actionMainReconnect : ""}`} aria-label={`${connectLabel} — ${item.name}`} disabled={Boolean(busy || disabled)} aria-busy={Boolean(busy)} onClick={() => connection?.connectOptions?.length ? setConnectOpen(true) : void run(connection?.onConnect)}><ChannelBubbleIcon kind="plug" /><span>{connectLabel}</span></button>
            </> : <div className={`${bubbleStyles.resourceLine} ${connection?.onCreateResource ? bubbleStyles.resourceLineWithCreate : ""}`}><div className={bubbleStyles.resourcePill}>
              {connection?.onSelect ? <>
                <select id={`channel-resource-${item.key}`} aria-label={`${selectionCaption} — ${item.name}`} value={value} disabled={Boolean(busy || disabled)} aria-busy={Boolean(connection.loading)} onFocus={loadResourceChoices} onPointerDown={loadResourceChoices} onBlur={() => { loaded.current = false; }} onChange={event => { const next = event.target.value; if (next) void run(() => connection.onSelect?.(next)); }}>
                  <option value="" disabled>{loadingInResource ? t("loading") : chooseLabel}</option>
                  {selectedMissing ? <option value={value}>{connection.resourceLabel || chooseLabel}</option> : null}
                  {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select><span className={bubbleStyles.resourceChevron} aria-hidden="true">⌄</span>
              </> : <span id={`channel-resource-${item.key}`} className={bubbleStyles.resourceValue} title={connection?.resourceLabel}>{hasResource ? connection?.resourceLabel || t("connectedAccount") : disabled ? item.bubbleStatusText : connection?.loading ? t("loading") : t("notConnected")}</span>}
            </div>{connection?.onCreateResource ? <ChannelBoardCreator onCreate={connection.onCreateResource} disabled={Boolean(busy || disabled || (connection.loading && !connection.accountConnected))} /> : null}</div>}
          </div>}
          <div className={bubbleStyles.iconActions}>
            {canView ? viewCallback ? <button type="button" className={bubbleStyles.iconAction} title={viewLabel} aria-label={viewLabel} onClick={viewCallback}><ChannelBubbleIcon kind="eye" /><span className={bubbleStyles.actionText} aria-hidden="true">{t("viewShort")}</span></button> : <a className={bubbleStyles.iconAction} href={viewHref} aria-label={viewLabel} title={viewLabel} target={/^https?:/.test(viewHref || "") ? "_blank" : undefined} rel="noreferrer"><ChannelBubbleIcon kind="eye" /><span className={bubbleStyles.actionText} aria-hidden="true">{t("viewShort")}</span></a> : null}
            {showDisconnect ? <button type="button" className={`${bubbleStyles.iconAction} ${bubbleStyles.disconnectIcon}`} aria-label={`${t("disconnect")} — ${connection?.accountLabel || connection?.resourceLabel || item.name}`} title={t("disconnect")} disabled={Boolean(busy || disabled)} aria-busy={Boolean(busy)} onClick={() => void run(disconnect)}><ChannelBubbleIcon kind="disconnect" /><span className={bubbleStyles.actionText} aria-hidden="true">{t("disconnect")}</span></button> : null}
            {connection?.publicationTypes && hasResource ? <ChannelPublicationTypes name={item.name} settings={connection.publicationTypes} disabled={Boolean(disabled || busy)} /> : null}
            {connection?.extraActions}
            {showParameters ? <button type="button" className={bubbleStyles.iconAction} title={parametersLabel} aria-label={`${parametersLabel} — ${item.name}`} disabled={disabled || pending} onClick={() => setParametersOpen(true)}><ChannelBubbleIcon kind={connection?.parametersIcon || "settings"} /><span className={bubbleStyles.actionText} aria-hidden="true">{connection?.parametersLabel || item.key === "mails" || item.key === "pinterest" ? parametersLabel : t("settingsShort")}</span></button> : null}
            {connection?.publicLinks && (connection.accountConnected || value) ? <ChannelPublicLinkEditor name={item.name} disabled={Boolean(busy || disabled)}>{connection.publicLinks}</ChannelPublicLinkEditor> : null}
            {item.bubbleStatus === "available" && !connection?.accountConnected && item.createHref && !item.createDisabled ? <a href={item.createHref} target="_blank" rel="noreferrer" className={bubbleStyles.iconAction} title={item.createLabel || t("create")} aria-label={`${item.createLabel || t("create")} — ${item.name}`}><ChannelBubbleIcon kind="create" /></a> : null}
          </div>
        </>}
      </div>
    </article>
    {feedback || statusText ? <div data-channel-feedback={feedback ? "error" : "notice"} className={`${bubbleStyles.channelFeedback} ${feedback ? bubbleStyles.channelFeedbackError : ""}`} role={feedback ? "alert" : "status"}>
      <svg className={bubbleStyles.channelFeedbackIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" />{feedback ? <path d="M12 7v6m0 3v1" /> : <path d="M12 11v6m0-10v.1" />}</svg>
      <p>{feedback || statusText}</p>
    </div> : null}
    {parametersOpen && hasParameters ? <ChannelParametersDialog name={item.name} title={`${parametersLabel} — ${item.name}`} contentOnly={connection?.parametersOwnHeading} fullScreen={connection?.parametersFullScreen} onClose={() => { void requestNavigation(() => setParametersOpen(false)); }}>{connection?.parameters}</ChannelParametersDialog> : null}
    {connectOpen ? <ChannelParametersDialog name={item.name} title={`${connectLabel} — ${item.name}`} onClose={() => setConnectOpen(false)}>
      <div className={bubbleStyles.connectChoices}>
        {connection?.connectOptions?.filter(option => !option.menu).map(option => <button key={option.label} type="button" className={`${styles.actionBtn} ${styles.connectBtn} ${option.primary ? bubbleStyles.connectPrimary : ""}`} disabled={Boolean(busy || disabled)} onClick={() => chooseConnection(option)}><ChannelBubbleIcon kind="plug" />{option.label}</button>)}
        {connectMenus.map(label => <ChannelConnectionMenu key={label} label={label} options={connection?.connectOptions?.filter(option => option.menu === label) ?? []} disabled={Boolean(busy || disabled)} onChoose={chooseConnection} icon={<ChannelBubbleIcon kind="plug" />} />)}
      </div>
      {feedback ? <p role="alert" className={bubbleStyles.channelFeedbackError}>{feedback}</p> : null}
    </ChannelParametersDialog> : null}
  </>;
}
