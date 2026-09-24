"use client";

import { useTranslations } from "next-intl";


import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import styles from "../dashboard.module.css";
import bubbleStyles from "./DashboardChannelBubble.module.css";
import DashboardActionButton from "./DashboardActionButton";
import { DashboardPremiumLockIcon } from "./DashboardPremiumLockIcon";
import type { ModuleAction, ModuleStatus } from "../dashboard.types";
import { useDelayedPendingAction } from "@/hooks/useDelayedPendingAction";

export type DashboardConfigureDestination =
  | { kind: "panel"; value: string }
  | { kind: "path"; value: string };

export type DashboardFluxBubbleData = {
  key: string;
  name: string;
  description: string;
  accent: string;
  logoSrc: string;
  logoAlt: string;
  bubbleStatus: ModuleStatus;
  bubbleStatusText: string;
  helpKind?: "site_inrcy" | "site_web";
  onHelpSiteInrcy?: () => void;
  onHelpSiteWeb?: () => void;
  specialViewHref?: string;
  specialViewLabel?: string;
  canViewSpecial?: boolean;
  onSpecialView?: () => void;
  viewAction?: ModuleAction;
  createHref?: string | null;
  onCreate?: () => void;
  createLabel?: string;
  createDisabled?: boolean;
  onConfigure: () => void;
  configureDestination?: DashboardConfigureDestination;
  configureDisabled?: boolean;
  configureTitle?: string;
  configureLabel?: string;
  viewFallbackLabel?: string;
  emphasizeDisabledReason?: boolean;
  premiumLocked?: boolean;
  premiumLabel?: string;
};

type Props = {
  item: DashboardFluxBubbleData;
  itemKey?: string;
};

function WarningTriangle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 3.5 21 20H3L12 3.5Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 8.5v5.7" stroke="#241204" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1.15" fill="#241204" />
    </svg>
  );
}

export default function DashboardFluxBubble({ item, itemKey }: Props) {
  const i18nT = useTranslations("shell");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    pendingKey,
    beginAction,
    completeAction,
    isVisible,
  } = useDelayedPendingAction<string>();
  const isComingSoon = item.bubbleStatus === "coming";
  const isReconnect = item.bubbleStatus === "reconnect";
  const isAvailableToConnect = item.bubbleStatus === "available";
  const emphasizeDisabledReason = isComingSoon && item.emphasizeDisabledReason === true;
  const shouldHighlightConfigure = (isAvailableToConnect || isReconnect) && !item.configureDisabled;
  const configureActionKey = `configure:${item.key}`;
  const configurePending = pendingKey === configureActionKey;
  const configureLoadingVisible = isVisible(configureActionKey);
  const showCreateAction = isAvailableToConnect && Boolean(item.createHref || item.onCreate);

  useEffect(() => {
    if (!configurePending || !item.configureDestination) return;
    const destinationReached = item.configureDestination.kind === "panel"
      ? searchParams.get("panel") === item.configureDestination.value
      : pathname === item.configureDestination.value;

    if (destinationReached) completeAction(configureActionKey);
  }, [completeAction, configureActionKey, configurePending, item.configureDestination, pathname, searchParams]);

  return (
    <article
      key={itemKey ?? item.key}
      className={`${bubbleStyles.card} ${styles[`accent_${item.accent}`]} ${isComingSoon ? bubbleStyles.comingSoon : ""} ${isReconnect ? bubbleStyles.reconnectCard : ""}`}
      title={isComingSoon ? item.configureTitle || item.configureLabel || "Option désactivée" : undefined}
    >
      <div className={bubbleStyles.stack}>
        <div className={bubbleStyles.logo} aria-hidden>
          <img
            className={bubbleStyles.logoImage}
            src={item.logoSrc}
            alt={item.logoAlt}
            width={96}
            height={96}
            loading="eager"
            decoding="sync"
            fetchPriority="high"
          />
        </div>

        <div className={bubbleStyles.title}>{item.name}</div>

        <div className={`${bubbleStyles.status} ${isAvailableToConnect ? bubbleStyles.statusAvailable : ""} ${isReconnect ? bubbleStyles.statusReconnect : ""} ${emphasizeDisabledReason ? bubbleStyles.statusDisabledReason : ""}`}>
          {isReconnect ? (
            <WarningTriangle className={bubbleStyles.warningTriangle} />
          ) : (
            <span
              className={[
                bubbleStyles.dot,
                item.bubbleStatus === "connected"
                  ? bubbleStyles.connected
                  : item.bubbleStatus === "available"
                    ? bubbleStyles.available
                    : bubbleStyles.coming,
              ].join(" ")}
              aria-hidden
            />
          )}
          <span className={bubbleStyles.statusText}>{item.bubbleStatusText}</span>
        </div>

        <div className={bubbleStyles.tagline} title={item.description}>{item.description}</div>

        <div className={bubbleStyles.actions}>
          {item.premiumLocked ? (
            <button
              className={`${bubbleStyles.action} ${bubbleStyles.actionMain}`}
              type="button"
              onClick={() => {
                if (!beginAction(configureActionKey)) return;
                item.onConfigure();
              }}
              disabled={configureLoadingVisible}
              aria-busy={configureLoadingVisible || undefined}
              title={item.configureTitle}
              aria-label={`${item.name} — ${item.premiumLabel || "Premium"}`}
            >
              {configureLoadingVisible ? (
                i18nT("chargement_01cba1df")
              ) : (
                <>
                  <DashboardPremiumLockIcon className={bubbleStyles.actionPremiumLock} />
                  {item.premiumLabel || "Premium"}
                </>
              )}
            </button>
          ) : null}

          {!item.premiumLocked ? (
            <>
          {showCreateAction ? (
            item.createHref ? (
              <a
                href={item.createHref}
                className={bubbleStyles.action}
                target={/^https?:\/\//.test(item.createHref) ? "_blank" : undefined}
                rel={/^https?:\/\//.test(item.createHref) ? "noreferrer" : undefined}
                aria-disabled={item.createDisabled}
                onClick={(event) => {
                  if (item.createDisabled) event.preventDefault();
                }}
              >
                {item.createLabel || "Créer"}
              </a>
            ) : (
              <button
                type="button"
                className={bubbleStyles.action}
                onClick={item.createDisabled ? undefined : item.onCreate}
                disabled={item.createDisabled}
              >
                {item.createLabel || "Créer"}
              </button>
            )
          ) : item.onSpecialView && item.specialViewLabel ? (
            <button
              type="button"
              className={bubbleStyles.action}
              onClick={item.onSpecialView}
              disabled={!item.canViewSpecial}
              aria-disabled={!item.canViewSpecial}
              style={{ opacity: !item.canViewSpecial ? 0.5 : 1, pointerEvents: !item.canViewSpecial ? "none" : "auto" }}
            >
              {item.specialViewLabel}
            </button>
          ) : item.specialViewHref && item.specialViewLabel ? (
            <a
              href={item.canViewSpecial ? item.specialViewHref : "#"}
              className={bubbleStyles.action}
              target={item.canViewSpecial && /^https?:\/\//.test(item.specialViewHref) ? "_blank" : undefined}
              rel={item.canViewSpecial && /^https?:\/\//.test(item.specialViewHref) ? "noreferrer" : undefined}
              aria-disabled={!item.canViewSpecial}
              onClick={(event) => {
                if (!item.canViewSpecial) event.preventDefault();
              }}
              style={{ opacity: !item.canViewSpecial ? 0.5 : 1, pointerEvents: !item.canViewSpecial ? "none" : "auto" }}
            >
              {item.specialViewLabel}
            </a>
          ) : item.viewAction ? (
            <DashboardActionButton action={item.viewAction} className={bubbleStyles.action} />
          ) : (
            <button className={bubbleStyles.action} type="button" disabled>
              {item.viewFallbackLabel || i18nT("voir_8a754f1f")}
            </button>
          )}

          <button
            className={`${bubbleStyles.action} ${bubbleStyles.actionMain} ${shouldHighlightConfigure ? bubbleStyles.actionMainAvailable : ""} ${isReconnect ? bubbleStyles.actionMainReconnect : ""}`}
            type="button"
            data-dashboard-prefetch={item.configureDestination?.kind === "path" ? item.configureDestination.value : undefined}
            onClick={() => {
              if (!beginAction(configureActionKey)) return;
              item.onConfigure();
            }}
            disabled={item.configureDisabled || configureLoadingVisible}
            aria-busy={configureLoadingVisible || undefined}
            title={item.configureTitle}
          >
            {configureLoadingVisible ? i18nT("chargement_01cba1df") : item.configureLabel || i18nT("configurer_382efbe9")}
          </button>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}
