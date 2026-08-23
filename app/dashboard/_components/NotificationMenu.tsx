"use client";

import styles from "../dashboard.module.css";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import type { NotificationItem } from "../dashboard.types";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { isDashboardDestinationAllowedForEdition } from "@/lib/dashboardEdition";
import { useDashboardEdition } from "./DashboardEditionProvider";

export default function NotificationMenu(props: {
  notificationMenuOpen: boolean;
  setNotificationMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  unreadNotificationsCount: number;
  badgeCount?: number;
  refreshNotifications: () => void | Promise<void>;
  notificationsLoading: boolean;
  notifications: NotificationItem[];
  notificationsError: string | null;
  openPanel: (panel?: "notifications") => void;
  markAllNotificationsRead: () => void | Promise<void>;
  markNotificationRead: (id: string) => void | Promise<void>;
  deleteNotification: (id: string) => void | Promise<void>;
  onNavigate: (ctaUrl: string) => void;
  mobile?: boolean;
  label?: string;
  buttonClassName?: string;
  panelClassName?: string;
  countClassName?: string;
  onOpen?: () => void;
}) {
  const t = useDashboardI18n();
  const dashboardEdition = useDashboardEdition();

  const {
    notificationMenuOpen,
    setNotificationMenuOpen,
    unreadNotificationsCount,
    badgeCount,
    refreshNotifications,
    notificationsLoading,
    notifications,
    notificationsError,
    openPanel,
    markAllNotificationsRead,
    markNotificationRead,
    deleteNotification,
    onNavigate,
    mobile = false,
    label,
    buttonClassName,
    panelClassName,
    countClassName,
    onOpen,
  } = props;

  const loadedUnreadCount = notifications.reduce((count, item) => count + (item.unread ? 1 : 0), 0);
  const displayedUnreadCount = Math.max(unreadNotificationsCount, loadedUnreadCount);
  const displayedBadgeCount = typeof badgeCount === "number" ? Math.max(0, badgeCount) : displayedUnreadCount;

  const confirmAndMarkAllRead = async () => {
    if (notifications.length === 0 || notificationsLoading) return;
    const confirmed = await confirmInrcy({
      eyebrow: t.notifications.aria,
      title: t.notifications.markAllReadConfirmTitle,
      message: t.notifications.markAllReadConfirmMessage,
      confirmLabel: t.notifications.markAllRead,
      cancelLabel: t.notifications.markAllReadConfirmCancel,
      variant: "warning",
    });
    if (!confirmed) return;
    await markAllNotificationsRead();
  };

  return (
    <>
      <button
        type="button"
        className={buttonClassName || `${styles.notificationBellBtn} ${label ? styles.notificationBellBtnWithLabel : ""} ${mobile ? styles.notificationBellBtnMobile : ""}`.trim()}
        aria-label={t.notifications.aria}
        aria-expanded={notificationMenuOpen}
        onClick={() => {
          setNotificationMenuOpen((v) => !v);
          if (!notificationMenuOpen) {
            onOpen?.();
            void refreshNotifications();
          }
        }}
      >
        <span className={styles.notificationBellIcon} aria-hidden>
          🔔
        </span>
        {label && <span className={styles.notificationBellLabel}>{label}</span>}
        {displayedBadgeCount > 0 && (
          <span className={countClassName || styles.notificationBellCount} aria-hidden>
            {displayedBadgeCount > 99 ? "99+" : displayedBadgeCount}
          </span>
        )}
      </button>

      {notificationMenuOpen && (
        <div
          className={`${styles.notificationPanel} ${mobile ? styles.notificationPanelMobile : ""} ${panelClassName || ""}`.trim()}
          role="dialog"
          aria-label={t.notifications.aria}
        >
          {mobile ? (
            <div className={`${styles.notificationPanelHeader} ${styles.notificationPanelHeaderMobile}`}>
              <div className={styles.notificationPanelTitle}>
                {t.notifications.title}
              </div>
              <button
                type="button"
                className={`${styles.notificationGhostBtn} ${styles.notificationHeaderButtonMobile}`}
                onClick={() => {
                  setNotificationMenuOpen(false);
                  openPanel();
                }}
              >
                {t.notifications.settings}
              </button>
              <div className={styles.notificationPanelSub}>
                {t.notifications.subtitle}
              </div>
              <button
                type="button"
                className={`${styles.notificationGhostBtn} ${styles.notificationHeaderButtonMobile}`}
                onClick={() => {
                  void confirmAndMarkAllRead();
                }}
              >
                {t.notifications.markAllRead}
              </button>
            </div>
          ) : (
            <div className={styles.notificationPanelHeader}>
              <div>
                <div className={styles.notificationPanelTitle}>
                  {t.notifications.title}
                </div>
                <div className={styles.notificationPanelSub}>
                  {t.notifications.subtitle}
                </div>
              </div>
              <div className={styles.notificationPanelHeaderActions}>
                <button
                  type="button"
                  className={styles.notificationGhostBtn}
                  onClick={() => {
                    setNotificationMenuOpen(false);
                    openPanel();
                  }}
                >
                  {t.notifications.settings}
                </button>
                <button
                  type="button"
                  className={styles.notificationGhostBtn}
                  onClick={() => {
                    void confirmAndMarkAllRead();
                  }}
                >
                  {t.notifications.markAllRead}
                </button>
              </div>
            </div>
          )}

          <div className={styles.notificationList}>
            {notificationsLoading && notifications.length === 0 ? (
              <div className={styles.notificationEmpty}>
                {t.notifications.loading}
              </div>
            ) : notificationsError ? (
              <div className={styles.notificationEmpty}>
                {notificationsError}
              </div>
            ) : notifications.length === 0 ? (
              <div className={styles.notificationEmpty}>
                {t.notifications.empty}
              </div>
            ) : (
              notifications.map((item) => {
                const premiumCtaLocked = Boolean(
                  item.cta_url &&
                  !isDashboardDestinationAllowedForEdition(item.cta_url, dashboardEdition),
                );

                return (
                <div key={item.id} className={styles.notificationCard}>
                  <div className={styles.notificationMetaRow}>
                    <span
                      className={`${styles.notificationCategory} ${styles[`notificationCategory_${item.category}`]}`}
                    >
                      {item.categoryLabel}
                    </span>
                    <span className={styles.notificationDate}>
                      {item.relativeDate}
                    </span>
                  </div>
                  <div className={styles.notificationTitleRow}>
                    <div className={styles.notificationTitle}>{item.title}</div>
                    <div className={styles.notificationTitleActions}>
                      {item.unread && (
                        <span
                          className={styles.notificationUnreadDot}
                          aria-hidden
                        />
                      )}
                      <button
                        type="button"
                        className={styles.notificationDeleteBtn}
                        aria-label={t.notifications.delete}
                        title={t.notifications.delete}
                        onClick={() => {
                          void deleteNotification(item.id);
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className={styles.notificationBody}>{item.body}</div>
                  <div className={styles.notificationActions}>
                    {item.cta_url && item.cta_label ? (
                      <button
                        type="button"
                        className={`${styles.notificationActionBtn} ${premiumCtaLocked ? styles.notificationActionBtnPremiumLocked : ""}`}
                        disabled={premiumCtaLocked}
                        aria-disabled={premiumCtaLocked || undefined}
                        aria-label={premiumCtaLocked ? `${item.cta_label}. ${t.status.premiumPlan}` : undefined}
                        title={premiumCtaLocked ? t.status.premiumPlan : undefined}
                        onClick={() => {
                          if (premiumCtaLocked) return;
                          void markNotificationRead(item.id);
                          setNotificationMenuOpen(false);
                          if (!item.cta_url) return;
                          onNavigate(item.cta_url);
                        }}
                      >
                        {item.cta_label}
                        {premiumCtaLocked ? <span className={styles.notificationPremiumLabel}>{t.status.premiumPlan}</span> : null}
                      </button>
                    ) : null}
                    {item.unread && (
                      <button
                        type="button"
                        className={styles.notificationGhostBtn}
                        onClick={() => {
                          void markNotificationRead(item.id);
                        }}
                      >
                        {t.notifications.markRead}
                      </button>
                    )}
                  </div>
                </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}
