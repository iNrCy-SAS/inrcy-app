"use client";
import Image from "next/image";

import type { DashboardPanelName } from "../_hooks/useDashboardPanelRouting";
import { useTranslations } from "next-intl";


import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import styles from "./ResponsiveBottomNav.module.css";
import StudioIcon from "./StudioIcon";
import DashboardNavigationIcon from "./DashboardNavigationIcon";
import DashboardGeneratorOrb from "./DashboardGeneratorOrb";
import { useDashboardGeneratorState } from "./DashboardGeneratorStateProvider";
import { getDashboardMobileMenu, type DashboardMobileTool } from "./dashboardMobileMenuModel";
import { useDashboardCompletionChecks } from "../_hooks/useDashboardCompletionChecks";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { useDashboardLanguage } from "../_hooks/useDashboardLanguage";
import { useDashboardNotifications } from "../_hooks/useDashboardNotifications";
import { createClient } from "@/lib/supabaseClient";
import { beginBrowserSignOut, cancelBrowserSignOut } from "@/lib/browserSignOutState";
import { setActiveBrowserUserId } from "@/lib/browserAccountCache";
import { useDashboardUnsavedNavigation } from "./DashboardUnsavedNavigationProvider";
import NotificationMenu from "./NotificationMenu";
import EstablishmentMenu from "./EstablishmentMenu";
import { APP_LANGUAGE_OPTIONS, getAppLanguageOption, type AppLanguageCode } from "@/lib/appLanguage";
import { requestDashboardToolWarmup } from "./DashboardToolWarmup";
import { useDelayedPendingAction } from "@/hooks/useDelayedPendingAction";
import { useDashboardEdition } from "./DashboardEditionProvider";
import { useDashboardAssistant } from "./DashboardAssistantProvider";
import { DashboardAssistantBadge } from "./DashboardAssistantTrigger";


const MOBILE_QUERY = "(max-width: 1100px)";
type SearchParamsReader = {
  entries: () => IterableIterator<[string, string]>;
};

type MobileHrefDestination =
  | { key: string; kind: "href"; href: string }
  | { key: string; kind: "publish"; href: string };

type MobilePendingDestination =
  | MobileHrefDestination
  | { key: string; kind: "panel"; panel: DashboardPanelName };

function dashboardHrefIsActive(
  href: string,
  pathname: string,
  searchParams: SearchParamsReader,
) {
  const target = new URL(href, "https://inrcy.local");
  if (pathname !== target.pathname) return false;

  const targetEntries = [...target.searchParams.entries()].sort();
  const currentEntries = [...searchParams.entries()].sort();
  if (targetEntries.length !== currentEntries.length) return false;

  return targetEntries.every(([key, value], index) => {
    const current = currentEntries[index];
    return current?.[0] === key && current[1] === value;
  });
}

function HomeIcon() {
  return (
    <svg className={styles.homeIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 10.7 12 3.8l8.5 6.9" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 9.8v9.1h13V9.8M9.3 18.9v-5.6h5.4v5.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className={styles.menuIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type CompactLabels = {
  home: string;
  language: string;
};

function compactLabels(locale: string, i18nT: (key: string) => string): CompactLabels {
  const lang = locale.toLowerCase().split("-")[0];
  const keysByLanguage: Record<string, Record<keyof CompactLabels, string>> = {
    en: { home: "home_70f8bb9a", language: "language_89b86ab0" },
    es: { home: "inicio_4f70d8c3", language: "idioma_00943388" },
    it: { home: "home_70f8bb9a", language: "lingua_a1b8a94a" },
    de: { home: "start_952f3754", language: "sprache_3d9f5cb4" },
    nl: { home: "home_70f8bb9a", language: "taal_53eee21b" },
    pt: { home: "inicio_fc2c7400", language: "idioma_00943388" },
    fr: { home: "accueil_a8ff8fd2", language: "langue_6619264a" },
  };
  const keys = keysByLanguage[lang] || keysByLanguage.fr;
  return Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, i18nT(key)])) as CompactLabels;
}

type MobileMenuActionButtonProps = {
  label: string;
  loading: boolean;
  onClick: () => void;
  warning?: boolean;
  badge?: string;
  icon?: ReactNode;
  tone?: DashboardMobileTool["tone"];
};

function MobileMenuActionButton({
  label,
  loading,
  onClick,
  warning = false,
  badge,
  icon,
  tone = "blue",
}: MobileMenuActionButtonProps) {
  const i18nT = useTranslations("shell");
  return (
    <button
      className={styles.menuItem}
      type="button"
      role="menuitem"
      data-tone={tone}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={onClick}
    >
      {icon ? <span className={styles.menuActionIcon} aria-hidden="true">{icon}</span> : null}
      <span className={styles.menuItemText}>
        {loading ? i18nT("chargement_01cba1df") : label}
      </span>
      {badge && !loading ? <span className={styles.menuItemBadge}>{badge}</span> : null}
      {warning && !loading ? (
        <span className={styles.menuItemWarning} aria-hidden="true">
          ⚠️
        </span>
      ) : null}
    </button>
  );
}

function MobileToolIcon({ tool }: { tool: DashboardMobileTool }) {
  if (tool.iconSrc) return <img src={tool.iconSrc} alt="" className={styles.shortcutIconImage} loading="eager" decoding="async" />;
  if (tool.id === "studio") return <StudioIcon className={styles.shortcutIconImage} />;
  if (tool.id === "cash") return <DashboardNavigationIcon kind="cash" className={styles.shortcutIconImage} />;
  return <svg className={styles.shortcutIconImage} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tool.id === "publish" ? <><path d="M14 4c3-2 6-2 7-1 1 1 1 4-1 7l-6 6-6-6 6-6ZM8 10l-4 1-2 5 7-1m5 1-1 6 5-2 1-5M6 18l-3 3" /><circle cx="16" cy="8" r="2" /></> : null}
    {tool.id === "media" ? <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="m5 17 5-5 4 4 3-3 3 3M8 2h9" /><circle cx="15" cy="9" r="1.5" /></> : null}
    {tool.id === "ads" ? <><circle cx="11" cy="13" r="8" /><circle cx="11" cy="13" r="4" /><path d="m11 13 9-9m-1-2v4h4" /></> : null}
    {tool.id === "campaigns" ? <><rect x="3" y="6" width="18" height="14" rx="3" /><path d="m4 8 8 6 8-6m-16 11 6-6m10 6-6-6" /></> : null}
    {tool.id === "reputation" ? <><path d="M8 3h8v6c0 4-2 6-4 6s-4-2-4-6V3ZM8 5H4v3c0 3 3 4 5 4m7-7h4v3c0 3-3 4-5 4M12 15v5m-5 1h10" /></> : null}
  </svg>;
}

function ResponsiveBottomNavMobile() {
  const i18nT = useTranslations("shell");
  const helpT = useTranslations("dashboard.helpCenter");
  const menuT = useTranslations("dashboard.mobileMenu");
  const router = useRouter();
  const pathname = usePathname();
  const adsWorkspaceActive = pathname === "/dashboard/ads" || pathname.startsWith("/dashboard/ads/");
  const searchParams = useSearchParams();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const dashboardEdition = useDashboardEdition();
  const generatorState = useDashboardGeneratorState();
  const { toggleAssistant, assistantOpen, assistantLabel, assistantBadgeState, assistantPending } = useDashboardAssistant();
  const t = useDashboardI18n();
  const { language, setLanguage } = useDashboardLanguage();
  const labels = useMemo(() => compactLabels(t.locale, i18nT), [t.locale, i18nT]);
  const {
    profileIncomplete,
    activityIncomplete,
  } = useDashboardCompletionChecks();
  const notificationsApi = useDashboardNotifications();
  const {
    pendingKey,
    beginAction,
    completeAction,
    isVisible,
  } = useDelayedPendingAction<string>();
  const pendingDestinationRef = useRef<MobilePendingDestination | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [isLandscapeViewport, setIsLandscapeViewport] = useState(false);
  const [cameraCaptureOpen, setCameraCaptureOpen] = useState(false);
  const [explicitImmersiveModeOpen, setExplicitImmersiveModeOpen] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const menuGroups = useMemo(() => getDashboardMobileMenu(dashboardEdition), [dashboardEdition]);

  useEffect(() => {
    const syncViewport = () => setIsLandscapeViewport(window.innerWidth > window.innerHeight);
    syncViewport();
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
    };
  }, []);

  useEffect(() => {
    const syncPublishModalState = (event?: Event) => {
      const detail = (event as CustomEvent<{ open?: unknown }> | undefined)
        ?.detail;
      const openFromEvent = detail?.open;
      const open =
        typeof openFromEvent === "boolean"
          ? openFromEvent
          : document.documentElement.dataset.inrcyPublishOpen === "1";
      setPublishModalOpen(open);
    };

    syncPublishModalState();
    window.addEventListener(
      "inrcy:publish-modal-state",
      syncPublishModalState as EventListener,
    );
    return () =>
      window.removeEventListener(
        "inrcy:publish-modal-state",
        syncPublishModalState as EventListener,
      );
  }, []);

  useEffect(() => {
    const readCameraState = () => {
      setCameraCaptureOpen(document.documentElement.dataset.inrcyCameraCaptureActive === "true");
    };
    const readExplicitImmersiveState = () => {
      setExplicitImmersiveModeOpen(document.documentElement.dataset.inrcyImmersiveMode === "true");
    };
    const onCameraStateChange = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      if (typeof detail?.active === "boolean") setCameraCaptureOpen(detail.active);
      else readCameraState();
    };
    const onExplicitImmersiveStateChange = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      if (typeof detail?.active === "boolean") setExplicitImmersiveModeOpen(detail.active);
      else readExplicitImmersiveState();
    };

    readCameraState();
    readExplicitImmersiveState();
    window.addEventListener("inrcy-camera-capture-active", onCameraStateChange);
    window.addEventListener("inrcy-immersive-mode-change", onExplicitImmersiveStateChange);
    return () => {
      window.removeEventListener("inrcy-camera-capture-active", onCameraStateChange);
      window.removeEventListener("inrcy-immersive-mode-change", onExplicitImmersiveStateChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me/role", { credentials: "include", cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (!cancelled) setIsAdmin(Boolean(payload?.isAdmin)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setLanguageOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
    setLanguageOpen(false);
    setNotificationMenuOpen(false);
  }, [pathname]);

  const landscapeDocumentRoute = pathname.startsWith("/dashboard/factures") || pathname.startsWith("/dashboard/devis");
  const hidden = cameraCaptureOpen || explicitImmersiveModeOpen || (landscapeDocumentRoute && isLandscapeViewport);

  // Les modales rendues dans document.body ne reçoivent pas les variables du
  // shell. On expose donc la hauteur du dock au niveau racine, avec 0 lorsque
  // le dock est volontairement masqué (capture caméra / mode immersif).
  useEffect(() => {
    const root = document.documentElement;
    const property = "--inrcy-mobile-bottom-nav-total-height";
    const previousValue = root.style.getPropertyValue(property);
    root.style.setProperty(
      property,
      hidden ? "0px" : "calc(50px + var(--inrcy-safe-area-bottom))",
    );

    return () => {
      if (previousValue) root.style.setProperty(property, previousValue);
      else root.style.removeProperty(property);
    };
  }, [hidden]);

  useEffect(() => {
    if (!hidden) return;
    setMenuOpen(false);
    setLanguageOpen(false);
    setNotificationMenuOpen(false);
  }, [hidden]);

  const closeMobileOverlays = useCallback(() => {
    setMenuOpen(false);
    setLanguageOpen(false);
    setNotificationMenuOpen(false);
  }, []);

  const resolveHrefDestination = useCallback(
    (href: string): MobileHrefDestination => {
      if (href === "/dashboard?action=publish") {
        return { key: "modal:publish", kind: "publish", href };
      }

      return { key: `route:${href}`, kind: "href", href };
    },
    [],
  );

  const destinationIsReached = useCallback((destination: MobilePendingDestination) => {
    if (destination.kind === "panel") {
      return pathname === "/dashboard" && searchParams.get("panel") === destination.panel;
    }
    if (destination.kind === "publish") {
      return publishModalOpen;
    }
    if (/^https?:\/\//i.test(destination.href)) return false;
    return dashboardHrefIsActive(destination.href, pathname, searchParams);
  }, [pathname, publishModalOpen, searchParams]);

  useEffect(() => {
    const destination = pendingDestinationRef.current;
    if (!destination || pendingKey !== destination.key) return;
    if (!destinationIsReached(destination)) return;

    pendingDestinationRef.current = null;
    completeAction(destination.key);
    closeMobileOverlays();
  }, [closeMobileOverlays, completeAction, destinationIsReached, pendingKey]);

  useEffect(() => {
    if (pendingKey !== null) return;
    pendingDestinationRef.current = null;
  }, [pendingKey]);

  const runDelayedNavigation = useCallback(async (
    destination: MobilePendingDestination,
    action: () => void | Promise<void>,
  ) => {
    if (!beginAction(destination.key)) return false;
    pendingDestinationRef.current = destination;

    try {
      const allowed = await requestNavigation(action);
      if (!allowed) {
        pendingDestinationRef.current = null;
        completeAction(destination.key);
      }
      return allowed;
    } catch (error) {
      pendingDestinationRef.current = null;
      completeAction(destination.key);
      console.error("Erreur navigation mobile iNrCy:", error);
      return false;
    }
  }, [beginAction, completeAction, requestNavigation]);

  const navigate = useCallback((href: string) => {
    const destination = resolveHrefDestination(href);

    if (destinationIsReached(destination)) {
      closeMobileOverlays();
      return;
    }

    if (!/^https?:\/\//i.test(destination.href)) {
      requestDashboardToolWarmup(destination.href);
    }

    void runDelayedNavigation(destination, () => {
      if (destination.href !== href) {
        const panel = new URL(destination.href, "https://inrcy.local").searchParams.get("panel");
        if (panel) {
          try {
            sessionStorage.setItem("inrcy_panel_explicit_open", "1");
            sessionStorage.setItem("inrcy_last_panel", panel);
          } catch {}
        }
      }

      if (/^https?:\/\//i.test(destination.href)) window.location.assign(destination.href);
      else router.push(destination.href, { scroll: false });
    });
  }, [closeMobileOverlays, destinationIsReached, resolveHrefDestination, router, runDelayedNavigation]);

  const openDashboardPanel = useCallback((panel: DashboardPanelName) => {
    const destination: MobilePendingDestination = {
      key: `panel:${panel}`,
      kind: "panel",
      panel,
    };

    if (destinationIsReached(destination)) {
      closeMobileOverlays();
      return;
    }

    void runDelayedNavigation(destination, () => {
      try {
        sessionStorage.setItem("inrcy_panel_explicit_open", "1");
        sessionStorage.setItem("inrcy_last_panel", panel);
      } catch {}
      router.push(`/dashboard?panel=${encodeURIComponent(panel)}`, { scroll: false });
    });
  }, [closeMobileOverlays, destinationIsReached, router, runDelayedNavigation]);

  const handleLogout = useCallback(async () => {
    await requestNavigation(async () => {
      const supabase = createClient();
      beginBrowserSignOut();
      setActiveBrowserUserId(null);
      const { error } = await (supabase.auth.signOut as any)({ scope: "local" })
        .catch(() => ({ error: null as { message?: string } | null }));
      if (error) {
        cancelBrowserSignOut();
        console.error("Erreur déconnexion:", error.message);
        return;
      }
      window.location.replace("/login");
    });
  }, [requestNavigation]);

  const currentLanguage = getAppLanguageOption(language);
  const homeActive = pathname === "/dashboard" && !searchParams.get("action") && !searchParams.get("panel");
  const publishActive =
    publishModalOpen ||
    (pathname === "/dashboard" && searchParams.get("action") === "publish");
  const hasMenuWarning = profileIncomplete || activityIncomplete;
  const helpActionKey = resolveHrefDestination("/dashboard?help=1").key;
  const adminActionKey = resolveHrefDestination("/dashboard/admin").key;

  return (
    <>
      <div className={styles.shortcutPreloader} aria-hidden="true">
        {menuGroups.flatMap((group) => group.tools).map((option) => option.iconSrc).filter((src): src is string => Boolean(src)).map((src) => (
          <img key={src} src={src} alt="" loading="eager" decoding="async" />
        ))}
      </div>

      {menuOpen && !hidden ? (
        <>
          <button
            type="button"
            className={styles.menuBackdrop}
            aria-label={t.drawer.close}
            onClick={() => {
              if (pendingKey !== null) return;
              setMenuOpen(false);
              setLanguageOpen(false);
            }}
          />
          <div className={styles.menuPanel} role="menu" aria-label={t.topbar.menu} data-disable-pull-refresh="true" data-dashboard-mobile-nav-menu>
            {menuGroups.map((group) => <section key={group.id} className={styles.menuSection} aria-label={menuT(group.id)}>
              <h2 className={styles.menuSectionTitle}>{menuT(group.id)}</h2>
              <div className={styles.shortcutGrid}>
                {group.tools.map((option) => {
                  const label = menuT(option.id);
                  const shortcutActionKey = resolveHrefDestination(option.href).key;
                  const shortcutLoadingVisible = isVisible(shortcutActionKey);
                  const publicationUnavailable = option.id === "publish" && (publishActive || adsWorkspaceActive);
                  return <button key={option.id} className={styles.shortcutItem} type="button" role="menuitem"
                    data-mobile-tool={option.id} data-tone={option.tone}
                    aria-busy={shortcutLoadingVisible || undefined} aria-disabled={publicationUnavailable || shortcutLoadingVisible || undefined}
                    disabled={publicationUnavailable}
                    onClick={() => navigate(option.href)}>
                    <span className={styles.shortcutIconSlot} aria-hidden="true"><MobileToolIcon tool={option} /></span>
                    <span className={styles.shortcutLabel}>{shortcutLoadingVisible ? i18nT("chargement_01cba1df") : label}</span>
                    <span className={styles.menuArrow} aria-hidden="true">›</span>
                  </button>;
                })}
              </div>
            </section>)}
            <section className={styles.menuSection} aria-label={menuT("space")}>
              <h2 className={styles.menuSectionTitle}>{menuT("space")}</h2>
              <div className={styles.menuGrid}>
                <MobileMenuActionButton label={menuT("account")} icon={<DashboardNavigationIcon kind="account" />}
                  loading={isVisible("panel:compte")} onClick={() => openDashboardPanel("compte")} />
                <div className={styles.menuEstablishments}>
                  <EstablishmentMenu mobile locale={t.locale} mobileLabel={menuT("establishments")} mobileBackLabel={menuT("backToMenu")}
                    buttonClassName={styles.menuEstablishmentButton} panelClassName={styles.dockEstablishmentPanel}
                    onContact={() => openDashboardPanel("contact")}
                    onOpen={() => { setLanguageOpen(false); setNotificationMenuOpen(false); }}
                    beforeAccountSwitch={(proceed) => requestNavigation(proceed)} />
                </div>
                <MobileMenuActionButton label={t.userMenu.shop} icon={<DashboardNavigationIcon kind="shop" />} tone="violet"
                  loading={isVisible("panel:boutique")} onClick={() => openDashboardPanel("boutique")} />
                <MobileMenuActionButton label={t.topbar.contact} icon={<DashboardNavigationIcon kind="contact" />} tone="pink"
                  loading={isVisible("panel:contact")} onClick={() => openDashboardPanel("contact")} />
                <MobileMenuActionButton label={helpT("title")} icon={<DashboardNavigationIcon kind="help" />} tone="violet"
                  loading={isVisible(helpActionKey)} onClick={() => navigate("/dashboard?help=1")} />
                <button className={styles.menuItem} type="button" role="menuitem" data-tone="blue"
                  aria-expanded={languageOpen} aria-controls="dashboard-mobile-languages"
                  onClick={() => setLanguageOpen((open) => !open)}>
                  <span className={styles.menuActionIcon}><img className={styles.menuLanguageFlag} src={currentLanguage.flagSrc} alt="" /></span>
                  <span className={styles.menuItemText}>{labels.language}</span>
                  <span className={styles.menuArrow} aria-hidden="true">{languageOpen ? "−" : "+"}</span>
                </button>
                <button className={styles.menuDanger} type="button" role="menuitem" onClick={() => void handleLogout()}>
                  <span className={styles.menuActionIcon} aria-hidden="true"><DashboardNavigationIcon kind="logout" /></span>
                  <span>{t.userMenu.logout}</span>
                </button>
                {isAdmin ? <MobileMenuActionButton label={t.topbar.admin} icon={<DashboardNavigationIcon kind="admin" />} tone="violet"
                  loading={isVisible(adminActionKey)} onClick={() => navigate("/dashboard/admin")} /> : null}
              </div>
              {languageOpen ? <div id="dashboard-mobile-languages" className={styles.languageGrid} role="group" aria-label={t.language.panelAria}>
                {APP_LANGUAGE_OPTIONS.map((option) => <button key={option.value} type="button"
                  className={[styles.languageChoice, option.value === language ? styles.languageChoiceActive : ""].join(" ")}
                  aria-pressed={option.value === language}
                  onClick={() => { void setLanguage(option.value as AppLanguageCode); setLanguageOpen(false); }}>
                  <img src={option.flagSrc} alt={option.flag} /><span>{option.shortLabel}</span>
                </button>)}
              </div> : null}
            </section>
          </div>
        </>
      ) : null}

      <nav className={`${styles.root} ${hidden ? styles.rootHidden : ""}`} aria-label={i18nT("navigation_mobile_inrcy_3f17bb20")} data-dashboard-mobile-nav>
        <div className={styles.bar}>
          <button
            type="button"
            className={`${styles.item} ${homeActive ? styles.itemActive : ""}`}
            aria-label={labels.home}
            data-dashboard-mobile-home
            aria-current={homeActive ? "page" : undefined}
            onClick={() => navigate("/dashboard")}
          >
            <span className={styles.iconSlot}><HomeIcon /></span>
          </button>

          <button type="button" className={[styles.item, styles.assistPreview].join(" ")}
            aria-label={assistantLabel} title={assistantLabel} aria-haspopup="dialog" aria-expanded={assistantOpen}
            aria-busy={assistantPending || undefined} data-pending={assistantPending || undefined}
            onClick={() => { closeMobileOverlays(); toggleAssistant(); }}>
            <Image src="/agent/agent-assist-pink-v2.png" alt="" width={38} height={38} sizes="38px" draggable={false} />
            <DashboardAssistantBadge state={assistantBadgeState} />
          </button>

          <div
            className={styles.generatorItem}
            aria-hidden="true"
            data-testid="dashboard-mobile-generator"
          >
            <DashboardGeneratorOrb isActive={generatorState.isActive} className={styles.generatorOrb} bare />
          </div>

          <div className={styles.notificationDockWrap}>
            <NotificationMenu
              notificationMenuOpen={notificationMenuOpen}
              setNotificationMenuOpen={setNotificationMenuOpen}
              unreadNotificationsCount={notificationsApi.unreadNotificationsCount}
              badgeCount={notificationsApi.notificationsCount}
              refreshNotifications={notificationsApi.refreshNotifications}
              notificationsLoading={notificationsApi.notificationsLoading}
              notifications={notificationsApi.notifications}
              notificationsError={notificationsApi.notificationsError}
              openPanel={() => openDashboardPanel("notifications")}
              markAllNotificationsRead={notificationsApi.markAllNotificationsRead}
              markNotificationRead={notificationsApi.markNotificationRead}
              deleteNotification={notificationsApi.deleteNotification}
              onNavigate={navigate}
              mobile
              icon={<DashboardNavigationIcon kind="bell" className={styles.notificationDockIcon} />}
              buttonClassName={styles.item}
              panelClassName={styles.dockNotificationPanel}
              countClassName={styles.badge}
              onOpen={() => { setMenuOpen(false); setLanguageOpen(false); }}
            />
          </div>

          <button
            type="button"
            className={`${styles.item} ${menuOpen ? styles.itemActive : ""}`}
            aria-label={t.topbar.openMenu}
            aria-expanded={menuOpen}
            onClick={() => {
              setNotificationMenuOpen(false);
              setMenuOpen((value) => !value);
              setLanguageOpen(false);
            }}
          >
            <span className={styles.iconSlot}>
              <MenuIcon />
              {hasMenuWarning ? <span className={styles.warning} aria-hidden="true">⚠️</span> : null}
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}

export default function ResponsiveBottomNav() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  if (!isMobile) return null;
  return <ResponsiveBottomNavMobile />;
}
