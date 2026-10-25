"use client";

import type { DashboardPanelName } from "../_hooks/useDashboardPanelRouting";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useRouter } from "next/navigation";

import styles from "../dashboard.module.css";
import dockStyles from "./DashboardDesktopDock.module.css";
import NotificationMenu from "./NotificationMenu";
import DashboardNavigationIcon from "./DashboardNavigationIcon";
import LanguageSelector from "./LanguageSelector";
import EstablishmentMenu from "./EstablishmentMenu";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import type { NotificationItem } from "../dashboard.types";
import { useInrAgentPendingCount } from "../_hooks/useInrAgentPendingCount";
import { hasAccountingDashboardAccess } from "@/lib/dashboardEdition";
import { useDashboardEdition } from "./DashboardEditionProvider";

const INR_AGENT_ROUTE = "/dashboard/agent";
const INR_AGENT_PRELOAD_ASSETS = [
  "/agent/inr-agent-robot-cutout.webp",
  "/icons/inr-agent-header.png",
  "/icons/inrcy.png",
  "/icons/site-web.jpg",
  "/icons/google.jpg",
  "/icons/facebook.png",
  "/icons/instagram.jpg",
  "/icons/linkedin.png",
  "/icons/x.svg",
  "/icons/tiktok.png",
  "/icons/youtube-shorts.png",
  "/icons/mails-inrcy-dashboard-v2.png",
];

const preloadedInrAgentAssets = new Set<string>();

function preloadInrAgentImages() {
  if (typeof window === "undefined") return;

  for (const src of INR_AGENT_PRELOAD_ASSETS) {
    if (preloadedInrAgentAssets.has(src)) continue;

    const image = new window.Image();
    image.decoding = "async";
    image.loading = "eager";
    image.src = src;
    preloadedInrAgentAssets.add(src);
  }
}

type DashboardTopbarProps = {
  desktopLeftHost?: HTMLElement | null;
  desktopRightHost?: HTMLElement | null;
  desktopNotificationMenuRef: RefObject<HTMLDivElement | null>;
  mobileNotificationMenuRef: RefObject<HTMLDivElement | null>;
  userMenuRef: RefObject<HTMLDivElement | null>;
  notificationMenuOpen: boolean;
  setNotificationMenuOpen: Dispatch<SetStateAction<boolean>>;
  unreadNotificationsCount: number;
  refreshNotifications: () => void | Promise<void>;
  notificationsLoading: boolean;
  notifications: NotificationItem[];
  notificationsError: string | null;
  markAllNotificationsRead: () => void | Promise<void>;
  markNotificationRead: (id: string) => void | Promise<void>;
  deleteNotification: (id: string) => void | Promise<void>;
  onNavigateCta: (ctaUrl: string) => void;
  openPanel: (panel: DashboardPanelName) => void;
  inrAgentEnabled: boolean;
  showInrAgent?: boolean;
  isAdmin?: boolean;
  userEmail: string | null;
  userFirstLetter: string;
  profileIncomplete: boolean;
  activityIncomplete: boolean;
  userMenuOpen: boolean;
  setUserMenuOpen: Dispatch<SetStateAction<boolean>>;
  onOpenHelp: () => void;
  handleLogout: () => void | Promise<void>;
};

export default function DashboardTopbar({
  desktopLeftHost = null,
  desktopRightHost = null,
  desktopNotificationMenuRef,
  mobileNotificationMenuRef,
  notificationMenuOpen,
  setNotificationMenuOpen,
  unreadNotificationsCount,
  refreshNotifications,
  notificationsLoading,
  notifications,
  notificationsError,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotification,
  onNavigateCta,
  openPanel,
  inrAgentEnabled,
  showInrAgent = true,
  isAdmin = false,
  setUserMenuOpen,
  onOpenHelp,
  handleLogout,
}: DashboardTopbarProps) {
  const i18nT = useTranslations("shell");
  const topbarT = useTranslations("dashboard.topbar");
  const helpT = useTranslations("dashboard.helpCenter");
  const dashboardEdition = useDashboardEdition();
  const accountingEnabled = hasAccountingDashboardAccess(dashboardEdition);
  const router = useRouter();
  const t = useDashboardI18n();
  const pendingInrAgentCount = useInrAgentPendingCount(showInrAgent && inrAgentEnabled);
  const pendingInrAgentLabel = pendingInrAgentCount > 99 ? "99+" : String(pendingInrAgentCount);
  const agentTitle = inrAgentEnabled
    ? pendingInrAgentCount > 0
      ? `${t.topbar.inrAgentOpen} — ${pendingInrAgentLabel} ${pendingInrAgentCount > 1 ? t.topbar.inrAgentActions : t.topbar.inrAgentAction} ${t.topbar.inrAgentPending}`
      : t.topbar.inrAgentOpen
    : t.topbar.inrAgentDisabled;

  useEffect(() => {
    if (!showInrAgent || !inrAgentEnabled) return;

    router.prefetch(INR_AGENT_ROUTE);
    preloadInrAgentImages();
  }, [inrAgentEnabled, router, showInrAgent]);

  const warmInrAgent = () => {
    if (!showInrAgent || !inrAgentEnabled) return;

    router.prefetch(INR_AGENT_ROUTE);
    preloadInrAgentImages();
  };

  // Portals move the existing desktop controls while preserving their state,
  // refs and callbacks. Before the hosts mount, they stay in the header.
  const desktopLeftActions = (
    <div className={dockStyles.centralGroup} data-dashboard-desktop-dock="left">
      {showInrAgent ? (
        <button
          type="button"
          className={`${styles.ghostBtn} ${styles.agentTopbarBtn} ${dockStyles.iconButton} ${!inrAgentEnabled ? styles.agentTopbarBtnDisabled : ""}`}
          onPointerEnter={warmInrAgent}
          onFocus={warmInrAgent}
          onClick={() => {
            if (!inrAgentEnabled) return;
            warmInrAgent();
            onNavigateCta(INR_AGENT_ROUTE);
          }}
          aria-label={agentTitle}
          title={agentTitle}
          disabled={!inrAgentEnabled}
          aria-disabled={!inrAgentEnabled}
        >
          <span className={styles.agentTopbarIconSlot} aria-hidden>
            <img
              className={styles.agentTopbarIcon}
              src="/icons/inr-agent-header.png"
              alt=""
              width={29}
              height={29}
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              aria-hidden
            />
          </span>
          {i18nT("inr_agent_e5261e85")}
          {inrAgentEnabled && pendingInrAgentCount > 0 && (
            <span className={styles.agentTopbarBadge} aria-hidden="true">
              {pendingInrAgentLabel}
            </span>
          )}
        </button>
      ) : null}

      <button type="button" className={`${styles.ghostBtn} ${dockStyles.iconButton} ${dockStyles.assistPreview}`}
        aria-label={helpT("assistPreview")} title={helpT("assistPreview")} aria-disabled="true" data-testid="inr-assist-preview">
        <img src="/agent/agent-assist-pink.png" alt="" width={38} height={38} draggable={false} />
      </button>

      {!desktopLeftHost ? <button
        type="button"
        className={`${styles.ghostBtn} ${styles.gpsTopbarBtn} ${dockStyles.iconButton}`}
        onClick={onOpenHelp}
        aria-label={helpT("aria")}
        title={helpT("title")}
        aria-haspopup="dialog"
      >
        <span className={styles.gpsTopbarIcon} aria-hidden="true"><DashboardNavigationIcon kind="help" className={dockStyles.navigationIcon} /></span>
        {helpT("title")}
      </button> : null}
    </div>
  );
  const desktopRightActions = (
    <div className={dockStyles.centralGroup} data-dashboard-desktop-dock="right">
      <div
        className={`${styles.notificationWrap} ${dockStyles.menuAnchor}`}
        ref={desktopNotificationMenuRef}
      >
        <NotificationMenu
          notificationMenuOpen={notificationMenuOpen}
          setNotificationMenuOpen={setNotificationMenuOpen}
          unreadNotificationsCount={unreadNotificationsCount}
          refreshNotifications={refreshNotifications}
          notificationsLoading={notificationsLoading}
          notifications={notifications}
          notificationsError={notificationsError}
          openPanel={() => openPanel("notifications")}
          markAllNotificationsRead={markAllNotificationsRead}
          markNotificationRead={markNotificationRead}
          deleteNotification={deleteNotification}
          onNavigate={onNavigateCta}
          buttonClassName={`${styles.notificationBellBtn} ${styles.notificationBellBtnWithLabel} ${dockStyles.iconButton}`}
          panelClassName={dockStyles.notificationPanel}
          icon={<DashboardNavigationIcon kind="bell" className={dockStyles.navigationIcon} />}
        />
      </div>

      <button type="button" className={`${styles.ghostBtn} ${dockStyles.iconButton}`}
        aria-label={t.userMenu.shop} title={t.userMenu.shop} data-dashboard-panel="boutique"
        onClick={() => { setUserMenuOpen(false); openPanel("boutique"); }}>
        <span aria-hidden="true"><DashboardNavigationIcon kind="shop" className={dockStyles.navigationIcon} /></span>
      </button>
      <button
        type="button"
        className={`${styles.ghostBtn} ${styles.contactTopbarBtn} ${dockStyles.iconButton}`}
        onClick={() => openPanel("contact")}
        aria-label={t.topbar.contact}
        title={t.topbar.contact}
      >
        <span className={styles.contactTopbarIcon} aria-hidden="true"><DashboardNavigationIcon kind="contact" className={dockStyles.navigationIcon} /></span>
        {t.topbar.contact}
      </button>

      {accountingEnabled ? (
        <button type="button" className={`${styles.ghostBtn} ${dockStyles.iconButton}`}
          aria-label={t.modules.cashTitle} title={t.modules.cashTitle} data-dashboard-action="cash"
          onClick={() => { setUserMenuOpen(false); onNavigateCta("/dashboard?action=cash"); }}>
          <span aria-hidden="true"><DashboardNavigationIcon kind="cash" className={dockStyles.navigationIcon} /></span>
        </button>
      ) : null}
    </div>
  );
  return (
    <header className={`${styles.topbar} ${desktopLeftHost && desktopRightHost ? dockStyles.topbar : ""}`}>
      <div className={`${styles.brand} ${dockStyles.brand}`}>
        <img
          className={styles.logoImg}
          src="/logo-inrcy.png"
          alt={i18nT("inrcy_ef95fe0e")}
          width={112}
          height={42}
          loading="eager"
          decoding="sync"
          fetchPriority="high"
        />
        <div className={styles.brandText}>
          <div className={styles.brandTag}>{t.topbar.brandTag}</div>
        </div>
      </div>

      <div className={`${styles.topbarActions} ${dockStyles.headerActions}`}>
        <div className={dockStyles.establishmentSlot}>
          <EstablishmentMenu
            locale={t.locale}
            buttonClassName={`${styles.ghostBtn} ${styles.establishmentTopbarBtn} ${dockStyles.establishmentButton}`}
            panelClassName={dockStyles.establishmentPanel}
            onContact={() => openPanel("contact")}
            onOpen={() => {
              setUserMenuOpen(false);
              setNotificationMenuOpen(false);
            }}
          />
          {isAdmin && (
            <button
              type="button"
              className={`${styles.ghostBtn} ${styles.adminTopbarBtn} ${dockStyles.headerIconButton}`}
              onClick={() => onNavigateCta("/dashboard/admin")}
              aria-label={t.topbar.adminTitle}
              title={t.topbar.adminTitle}
            >
              <span className={styles.adminTopbarIcon} aria-hidden="true"><DashboardNavigationIcon kind="admin" className={dockStyles.navigationIcon} /></span>
              {t.topbar.admin}
            </button>
          )}
        </div>
        {desktopLeftHost ? createPortal(desktopLeftActions, desktopLeftHost) : desktopLeftActions}
        {desktopRightHost ? createPortal(desktopRightActions, desktopRightHost) : desktopRightActions}
        <div className={dockStyles.headerRightSlot}>
          <button type="button" className={`${styles.ghostBtn} ${dockStyles.headerButton}`}
            aria-label={topbarT("myAccount")} title={topbarT("myAccount")} data-dashboard-action="account"
            onClick={() => { setUserMenuOpen(false); openPanel("compte"); }}>
            <DashboardNavigationIcon kind="account" className={dockStyles.navigationIcon} /><span>{topbarT("myAccount")}</span>
          </button>
          <LanguageSelector
            onOpen={() => {
              setUserMenuOpen(false);
              setNotificationMenuOpen(false);
            }}
          />
          <button type="button" className={`${styles.ghostBtn} ${dockStyles.headerButton}`}
            aria-label={t.userMenu.logout} title={t.userMenu.logout} data-dashboard-action="logout"
            onClick={() => { setUserMenuOpen(false); void handleLogout(); }}>
            <DashboardNavigationIcon kind="logout" className={dockStyles.navigationIcon} /><span>{t.userMenu.logout}</span>
          </button>
        </div>
      </div>
      <div className={styles.mobileTopbarActions}>
        {isAdmin && (
          <button
            type="button"
            className={`${styles.mobileHeaderIconBtn} ${styles.mobileHeaderAdminBtn}`}
            aria-label={t.topbar.adminTitle}
            title={t.topbar.adminTitle}
            onClick={() => onNavigateCta("/dashboard/admin")}
          >
            <span aria-hidden="true"><DashboardNavigationIcon kind="admin" className={dockStyles.navigationIcon} /></span>
          </button>
        )}

        <EstablishmentMenu
          mobile
          locale={t.locale}
          onContact={() => openPanel("contact")}
          onOpen={() => {
            setUserMenuOpen(false);
            setNotificationMenuOpen(false);
          }}
        />

        <div className={styles.mobileBellWrap}>
          <div
            className={styles.notificationWrap}
            ref={mobileNotificationMenuRef}
          >
            <NotificationMenu
              notificationMenuOpen={notificationMenuOpen}
              setNotificationMenuOpen={setNotificationMenuOpen}
              unreadNotificationsCount={unreadNotificationsCount}
              refreshNotifications={refreshNotifications}
              notificationsLoading={notificationsLoading}
              notifications={notifications}
              notificationsError={notificationsError}
              openPanel={() => openPanel("notifications")}
              markAllNotificationsRead={markAllNotificationsRead}
              markNotificationRead={markNotificationRead}
              deleteNotification={deleteNotification}
              onNavigate={onNavigateCta}
              mobile
            />
          </div>
        </div>

        <button
          type="button"
          className={`${styles.mobileHeaderIconBtn} ${styles.mobileHeaderGpsBtn}`}
          aria-label={helpT("aria")}
          title={helpT("title")}
          aria-haspopup="dialog"
          onClick={onOpenHelp}
        >
          <span className={styles.mobileHeaderGpsIcon} aria-hidden><DashboardNavigationIcon kind="help" /></span>
        </button>

        <LanguageSelector
          mobile
          onOpen={() => {
            setNotificationMenuOpen(false);
          }}
        />
      </div>
    </header>
  );
}
