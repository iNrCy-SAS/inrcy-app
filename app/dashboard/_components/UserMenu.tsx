"use client";

import type { DashboardPanelName } from "../_hooks/useDashboardPanelRouting";
import styles from "../dashboard.module.css";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { hasAccountingDashboardAccess } from "@/lib/dashboardEdition";
import { useDashboardEdition } from "./DashboardEditionProvider";

export default function UserMenu(props: {
  userEmail: string | null;
  userFirstLetter: string;
  profileIncomplete: boolean;
  activityIncomplete: boolean;
  userMenuOpen: boolean;
  setUserMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openPanel: (name: DashboardPanelName) => void;
  handleLogout: () => void | Promise<void>;
  onNavigate?: (href: string) => void;
}) {
  const t = useDashboardI18n();
  const dashboardEdition = useDashboardEdition();
  const accountingEnabled = hasAccountingDashboardAccess(dashboardEdition);

  const {
    userEmail,
    userMenuOpen,
    setUserMenuOpen,
    openPanel,
    handleLogout,
    onNavigate,
  } = props;

  const closeAndOpen = (panel: DashboardPanelName) => {
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
        aria-label={t.userMenu.label}
        aria-haspopup="menu"
        aria-expanded={userMenuOpen}
        onClick={() => setUserMenuOpen((v) => !v)}
        title={userEmail ?? t.userMenu.title}
      >
        <span className={styles.userBubble} aria-hidden>
          <span className={styles.userMenuHamburgerIcon} />
        </span>
        <span className={styles.userMenuLabel}>{t.userMenu.label}</span>
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
            onClick={() => closeAndOpen("abonnement")}
          >
            {t.userMenu.subscription}
          </button>
          <button
            type="button"
            className={styles.userMenuItem}
            role="menuitem"
            onClick={() => closeAndOpen("factures")}
          >
            {t.userMenu.invoices}
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
          {accountingEnabled ? (
            <button
              type="button"
              className={styles.userMenuItem}
              role="menuitem"
              onClick={() => closeAndNavigate("/dashboard?action=cash")}
            >
              {t.modules.cashTitle}
            </button>
          ) : null}
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
