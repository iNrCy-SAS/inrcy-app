"use client";

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useRouter } from "next/navigation";

import styles from "../dashboard.module.css";
import NotificationMenu from "./NotificationMenu";
import UserMenu from "./UserMenu";
import LanguageSelector from "./LanguageSelector";
import EstablishmentMenu from "./EstablishmentMenu";
import RequiredSetupLock from "./RequiredSetupLock";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import type { NotificationItem } from "../dashboard.types";
import { useInrAgentPendingCount } from "../_hooks/useInrAgentPendingCount";

type DashboardPanelName =
  | "contact"
  | "profil"
  | "preferences"
  | "inrbadge"
  | "compte"
  | "activite"
  | "ia"
  | "abonnement"
  | "mails"
  | "agenda"
  | "site_inrcy"
  | "site_web"
  | "instagram"
  | "linkedin"
  | "gmb"
  | "inr_search"
  | "facebook"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest"
  | "legal"
  | "rgpd"
  | "inertie"
  | "boutique"
  | "notifications"
  | "parrainage"
  | "documents";


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
  "/icons/tiktok.png",
  "/icons/youtube-shorts.png",
  "/icons/mails-inrcy-dashboard-v2.png",
];

const preloadedInrAgentAssets = new Set<string>();

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 13.4c.1-.5.1-.9.1-1.4s0-.9-.1-1.4l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.4-1.4L14.3 2h-4.6l-.4 3.3c-.9.3-1.7.8-2.4 1.4l-2.4-1-2 3.4 2 1.5c-.1.5-.1.9-.1 1.4s0 .9.1 1.4l-2 1.5 2 3.4 2.4-1c.7.6 1.5 1 2.4 1.4l.4 3.3h4.6l.4-3.3c.9-.3 1.7-.8 2.4-1.4l2.4 1 2-3.4-2.1-1.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ContactIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d="M4 5.5h16c.8 0 1.5.7 1.5 1.5v10c0 .8-.7 1.5-1.5 1.5H4c-.8 0-1.5-.7-1.5-1.5V7c0-.8.7-1.5 1.5-1.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m4 7 8 6 8-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  requiredSetupLockVisible: boolean;
  isAdmin?: boolean;
  userEmail: string | null;
  userFirstLetter: string;
  profileIncomplete: boolean;
  activityIncomplete: boolean;
  userMenuOpen: boolean;
  setUserMenuOpen: Dispatch<SetStateAction<boolean>>;
  goToGps: () => void;
  handleLogout: () => void | Promise<void>;
};

export default function DashboardTopbar({
  desktopNotificationMenuRef,
  mobileNotificationMenuRef,
  userMenuRef,
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
  requiredSetupLockVisible,
  isAdmin = false,
  userEmail,
  userFirstLetter,
  profileIncomplete,
  activityIncomplete,
  userMenuOpen,
  setUserMenuOpen,
  goToGps,
  handleLogout,
}: DashboardTopbarProps) {
  const router = useRouter();
  const t = useDashboardI18n();
  const pendingInrAgentCount = useInrAgentPendingCount(showInrAgent && inrAgentEnabled);
  const inrAgentSetupLocked = inrAgentEnabled && requiredSetupLockVisible;

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

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <img
          className={styles.logoImg}
          src="/logo-inrcy.png"
          alt="iNrCy"
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

      <div className={styles.topbarActions}>
        {isAdmin && (
          <button
            type="button"
            className={`${styles.ghostBtn} ${styles.adminTopbarBtn}`}
            onClick={() => onNavigateCta("/dashboard/admin")}
            aria-label={t.topbar.adminTitle}
            title={t.topbar.adminTitle}
          >
            <span className={styles.adminTopbarIcon} aria-hidden="true"><GearIcon /></span>
            {t.topbar.admin}
          </button>
        )}

        <EstablishmentMenu
          locale={t.locale}
          onContact={() => openPanel("contact")}
          onOpen={() => {
            setUserMenuOpen(false);
            setNotificationMenuOpen(false);
          }}
        />

        <div
          className={styles.notificationWrap}
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
            label={t.topbar.notifications}
          />
        </div>

        {showInrAgent ? (
          <button
            type="button"
            className={`${styles.ghostBtn} ${styles.agentTopbarBtn} ${!inrAgentEnabled ? styles.agentTopbarBtnDisabled : ""}`}
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
            iNr'Agent
            {inrAgentSetupLocked ? (
              <RequiredSetupLock
                message={t.modules.requiredSetupLocked}
                className={styles.requiredSetupLockTopbar}
                compact
              />
            ) : null}
            {inrAgentEnabled && pendingInrAgentCount > 0 && (
              <span className={styles.agentTopbarBadge} aria-hidden="true">
                {pendingInrAgentLabel}
              </span>
            )}
          </button>
        ) : null}

        <button
          type="button"
          className={`${styles.ghostBtn} ${styles.gpsTopbarBtn}`}
          onClick={goToGps}
        >
          <span className={styles.gpsTopbarIcon} aria-hidden="true">🧭</span>
          {t.topbar.gps}
        </button>

        <button
          type="button"
          className={`${styles.ghostBtn} ${styles.contactTopbarBtn}`}
          onClick={() => openPanel("contact")}
          aria-label={t.topbar.contact}
          title={t.topbar.contact}
        >
          <span className={styles.contactTopbarIcon} aria-hidden="true"><ContactIcon /></span>
          {t.topbar.contact}
        </button>

        <div className={styles.userTopbarSlot} ref={userMenuRef}>
          <UserMenu
            userEmail={userEmail}
            userFirstLetter={userFirstLetter}
            profileIncomplete={profileIncomplete}
            activityIncomplete={activityIncomplete}
            userMenuOpen={userMenuOpen}
            setUserMenuOpen={setUserMenuOpen}
            openPanel={openPanel}
            handleLogout={handleLogout}
            onNavigate={onNavigateCta}
          />
        </div>

        <LanguageSelector
          onOpen={() => {
            setUserMenuOpen(false);
            setNotificationMenuOpen(false);
          }}
        />
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
            <span aria-hidden="true"><GearIcon /></span>
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
          aria-label={t.topbar.gpsAria}
          onClick={goToGps}
        >
          <span className={styles.mobileHeaderGpsIcon} aria-hidden>🧭</span>
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
