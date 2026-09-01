"use client";

import styles from "../dashboard.module.css";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";

type OpenPanelName =
  | "contact"
  | "profil"
  | "preferences"
  | "compte"
  | "ia"
  | "abonnement"
  | "mails"
  | "site_inrcy"
  | "site_web"
  | "instagram"
  | "linkedin"
  | "gmb"
  | "facebook"
  | "legal"
  | "rgpd"
  | "inertie"
  | "boutique"
  | "notifications"
  | "parrainage";

export default function UserMenu(props: {
  userEmail: string | null;
  userFirstLetter: string;
  profileIncomplete: boolean;
  activityIncomplete: boolean;
  userMenuOpen: boolean;
  setUserMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openPanel: (name: OpenPanelName) => void;
  handleLogout: () => void | Promise<void>;
  onNavigate?: (href: string) => void;
}) {
  const t = useDashboardI18n();

  const {
    userEmail,
    profileIncomplete,
    activityIncomplete,
    userMenuOpen,
    setUserMenuOpen,
    openPanel,
    handleLogout,
    onNavigate,
  } = props;

  const hasCompletionWarning = profileIncomplete || activityIncomplete;

  const closeAndOpen = (panel: OpenPanelName) => {
    setUserMenuOpen(false);
    openPanel(panel);
  };

  const closeAndNavigate = (href: string) => {
    setUserMenuOpen(false);
    if (onNavigate) onNavigate(href);
    else if (typeof window !== "undefined") window.location.href = href;
  };

  return (
    <div className={styles.userMenuWrap}>
      <button
        className={styles.userBubbleBtn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={userMenuOpen}
        onClick={() => setUserMenuOpen((v) => !v)}
        title={userEmail ?? t.userMenu.title}
      >
        <span className={styles.userBubble} aria-hidden>
          <span className={styles.userMenuHamburgerIcon} />
        </span>
        <span className={styles.userMenuLabel}>{t.userMenu.label}</span>
        {hasCompletionWarning && (
          <span
            className={styles.userMenuWarningTriangle}
            aria-hidden="true"
            title={t.userMenu.profileIncomplete}
          >
            ⚠️
          </span>
        )}
      </button>

      {userMenuOpen && (
        <div
          className={styles.userMenuPanel}
          role="menu"
          aria-label={t.userMenu.title}
        >
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("compte")}
          >
            {t.userMenu.account}
          </button>
          <button
            type="button"
            className={`${styles.userMenuItem} ${hasCompletionWarning ? styles.userMenuItemWithWarning : ""}`}
            role="menuitem"
            onClick={() => closeAndOpen("profil")}
          >
            <span>{t.userMenu.profile}</span>
            {hasCompletionWarning && (
              <span className={styles.menuWarningTriangle} aria-hidden="true">⚠️</span>
            )}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("preferences")}
          >
            {t.userMenu.preferences}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("ia")}
          >
            {t.userMenu.ai}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            data-dashboard-prefetch="/dashboard/generer-media"
            onClick={() => closeAndNavigate("/dashboard/generer-media")}
          >
            {t.userMenu.mediaGenerator}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndNavigate("/dashboard/mediatheque")}
          >
            {t.userMenu.media}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("notifications")}
          >
            {t.userMenu.notifications}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("abonnement")}
          >
            {t.userMenu.subscription}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("inertie")}
          >
            {t.userMenu.inertia}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("boutique")}
          >
            {t.userMenu.shop}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("parrainage")}
          >
            {t.userMenu.referral}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("legal")}
          >
            {t.userMenu.legal}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("rgpd")}
          >
            {t.userMenu.rgpd}
          </button>

          <div className={styles.userMenuDivider} />

          <button
            className={`${styles.userMenuItem} ${styles.userMenuDanger}`}
            type="button"
            role="menuitem"
            onClick={() => {
              setUserMenuOpen(false);
              void handleLogout();
            }}
          >
            {t.userMenu.logout}
          </button>
        </div>
      )}
    </div>
  );
}
