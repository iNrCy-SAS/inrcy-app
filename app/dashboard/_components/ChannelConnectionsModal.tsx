"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { DashboardFluxBubbleData } from "./DashboardFluxBubble";
import { DASHBOARD_CHANNEL_FORCE_BY_KEY } from "../dashboard.channel-setup";
import styles from "../dashboard.module.css";

type Props = {
  isOpen: boolean;
  items: readonly DashboardFluxBubbleData[];
  businessEssentialsReady: boolean;
  onClose: () => void;
};

export default function ChannelConnectionsModal({
  isOpen,
  items,
  businessEssentialsReady,
  onClose,
}: Props) {
  const titleId = useId();
  const powerInfoId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const powerInfoButtonRef = useRef<HTMLButtonElement>(null);
  const powerInfoContainerRef = useRef<HTMLDivElement>(null);
  const powerInfoOpenRef = useRef(false);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [powerInfoOpen, setPowerInfoOpen] = useState(false);
  const heroT = useTranslations("dashboard.hero");
  const drawerT = useTranslations("dashboard.drawer");

  useEffect(() => setPortalReady(true), []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    powerInfoOpenRef.current = powerInfoOpen;
  }, [powerInfoOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (powerInfoOpenRef.current) {
        powerInfoOpenRef.current = false;
        setPowerInfoOpen(false);
        powerInfoButtonRef.current?.focus();
        return;
      }
      onCloseRef.current();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
      previouslyFocusedElementRef.current?.focus();
      previouslyFocusedElementRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !powerInfoOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (powerInfoContainerRef.current?.contains(event.target as Node)) return;
      setPowerInfoOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, powerInfoOpen]);

  if (!isOpen || !portalReady) return null;

  return createPortal(
    <div className={styles.channelConnectionsBackdrop} onMouseDown={onClose}>
      <section
        className={styles.channelConnectionsModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.channelConnectionsHeader}>
          <div>
            <h2 id={titleId}>{heroT("channelOverviewTitle")}</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={drawerT("close")}>×</button>
        </header>

        <div className={`${styles.channelConnectionsRow} ${styles.channelConnectionsColumns}`}>
          <span>{heroT("channelColumn")}</span>
          <div ref={powerInfoContainerRef} className={styles.channelConnectionsPowerHeader}>
            <span>{heroT("powerColumn")}</span>
            <button
              ref={powerInfoButtonRef}
              type="button"
              className={styles.channelConnectionsInfoButton}
              aria-label={heroT("powerInfoAria")}
              aria-expanded={powerInfoOpen}
              aria-controls={powerInfoId}
              aria-describedby={powerInfoOpen ? powerInfoId : undefined}
              onClick={() => setPowerInfoOpen((current) => !current)}
            >
              i
            </button>
            {powerInfoOpen ? (
              <div id={powerInfoId} className={styles.channelConnectionsPowerPopover} role="tooltip">
                <strong>{heroT("powerInfoTitle")}</strong>
                <p>{heroT("powerInfoText")}</p>
              </div>
            ) : null}
          </div>
          <span>{heroT("statusColumn")}</span>
          <span>{heroT("configureColumn")}</span>
          <span>{heroT("stateColumn")}</span>
        </div>

        <div className={styles.channelConnectionsList}>
          {items.map((item) => {
            const connected = item.bubbleStatus === "connected";
            const force = DASHBOARD_CHANNEL_FORCE_BY_KEY[item.key as keyof typeof DASHBOARD_CHANNEL_FORCE_BY_KEY] ?? 0;
            // iNr'Badge needs the business essentials to be generated. iNr'Search
            // deliberately does not: it can be connected immediately and its
            // page is enriched progressively by the profile and iNr'ADN.
            const usesBusinessEssentials = item.key === "inrbadge";
            const isCreated = (usesBusinessEssentials && businessEssentialsReady) || Boolean(
              item.createHref && (connected || item.bubbleStatus === "reconnect"),
            );
            // La création de compte reste volontairement limitée aux réseaux
            // traditionnels ayant une URL officielle dans le registre. Les
            // outils iNrCy, Mails et les sites n'affichent jamais cette action.
            const canCreate = !usesBusinessEssentials &&
              item.bubbleStatus === "available" &&
              Boolean(item.createHref) &&
              /^https?:\/\//.test(item.createHref ?? "") &&
              !item.createDisabled;
            return (
              <div className={styles.channelConnectionsRow} key={item.key}>
                <div className={styles.channelConnectionsIdentity}>
                  <img src={item.logoSrc} alt="" aria-hidden="true" />
                  <span>{item.name}</span>
                </div>
                <div className={styles.channelConnectionsPowerCell}>
                  <span className={styles.channelConnectionsMobileLabel}>{heroT("powerColumn")}</span>
                  <strong className={styles.channelConnectionsForce}>{force > 0 ? `+${force}%` : "—"}</strong>
                </div>
                <div className={styles.channelConnectionsStatusCell}>
                  <span className={styles.channelConnectionsMobileLabel}>{heroT("statusColumn")}</span>
                  {canCreate && item.createHref ? (
                    <a
                      className={`${styles.channelConnectionsAction} ${styles.channelConnectionsCreate}`}
                      href={item.createHref}
                      target={/^https?:\/\//.test(item.createHref) ? "_blank" : undefined}
                      rel={/^https?:\/\//.test(item.createHref) ? "noreferrer" : undefined}
                    >
                      {heroT("createColumn")}
                    </a>
                  ) : (
                    <span
                      className={styles.channelConnectionsUnavailable}
                      aria-label={isCreated ? heroT("createdLabel") : undefined}
                    >
                      {isCreated ? heroT("createdLabel") : "—"}
                    </span>
                  )}
                </div>
                <div className={styles.channelConnectionsConfigureCell}>
                  <span className={styles.channelConnectionsMobileLabel}>{heroT("configureColumn")}</span>
                  <button
                    type="button"
                    className={styles.channelConnectionsAction}
                    onClick={() => {
                      onClose();
                      item.onConfigure();
                    }}
                    disabled={item.configureDisabled}
                  >
                    {heroT("configureStep")}
                  </button>
                </div>
                <div className={styles.channelConnectionsState}>
                  <span className={styles.channelConnectionsMobileLabel}>{heroT("stateColumn")}</span>
                  <small className={connected ? styles.channelConnected : styles.channelDisconnected}>
                    {item.bubbleStatusText}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>,
    document.body,
  );
}
