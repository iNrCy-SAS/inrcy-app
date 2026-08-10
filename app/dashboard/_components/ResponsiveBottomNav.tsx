"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import styles from "./ResponsiveBottomNav.module.css";
import { useDashboardCompletionChecks } from "../_hooks/useDashboardCompletionChecks";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { useDashboardLanguage } from "../_hooks/useDashboardLanguage";
import { useDashboardNotifications } from "../_hooks/useDashboardNotifications";
import { createClient } from "@/lib/supabaseClient";
import { setActiveBrowserUserId } from "@/lib/browserAccountCache";
import { useDashboardUnsavedNavigation } from "./DashboardUnsavedNavigationProvider";
import NotificationMenu from "./NotificationMenu";
import EstablishmentMenu from "./EstablishmentMenu";
import RequiredSetupLock from "./RequiredSetupLock";
import {
  DEFAULT_MOBILE_SHORTCUTS,
  MOBILE_SHORTCUTS_EVENT,
  MOBILE_SHORTCUT_OPTIONS,
  getMobileShortcutLabel,
  getMobileShortcutOption,
  loadMobileShortcutsPreference,
  normalizeMobileShortcuts,
  type MobileShortcutId,
} from "@/lib/mobileShortcuts";
import { APP_LANGUAGE_OPTIONS, getAppLanguageOption, type AppLanguageCode } from "@/lib/appLanguage";
import { isDashboardRequiredSetupProtectedDestination } from "@/lib/dashboardRequiredSetupAccess";
import { requestDashboardToolWarmup } from "./DashboardToolWarmup";
import { useDelayedPendingAction } from "@/hooks/useDelayedPendingAction";
import { useInrAgentPendingCount } from "../_hooks/useInrAgentPendingCount";
import { useDashboardEdition } from "./DashboardEditionProvider";


type DashboardPanelName =
  | "contact"
  | "compte"
  | "profil"
  | "activite"
  | "preferences"
  | "ia"
  | "abonnement"
  | "inertie"
  | "boutique"
  | "parrainage"
  | "legal"
  | "rgpd"
  | "notifications";

const MOBILE_QUERY = "(max-width: 1100px)";
const STANDARD_MOBILE_SHORTCUTS: readonly MobileShortcutId[] = [
  "agent",
  "inrsend",
  "stats",
  "reputation",
];


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

function compactLabels(locale: string) {
  const lang = locale.toLowerCase().split("-")[0];
  if (lang === "en") return { home: "Home", publish: "Publish", shortcuts: "Shortcuts", general: "General", language: "Language", gps: "Usage GPS" };
  if (lang === "es") return { home: "Inicio", publish: "Publicar", shortcuts: "Accesos directos", general: "General", language: "Idioma", gps: "GPS de uso" };
  if (lang === "it") return { home: "Home", publish: "Pubblica", shortcuts: "Scorciatoie", general: "Generale", language: "Lingua", gps: "GPS utilizzo" };
  if (lang === "de") return { home: "Start", publish: "Veröff.", shortcuts: "Schnellzugriffe", general: "Allgemein", language: "Sprache", gps: "Nutzungs-GPS" };
  if (lang === "nl") return { home: "Home", publish: "Publiceren", shortcuts: "Snelkoppelingen", general: "Algemeen", language: "Taal", gps: "Gebruiks-GPS" };
  if (lang === "pt") return { home: "Início", publish: "Publicar", shortcuts: "Atalhos", general: "Geral", language: "Idioma", gps: "GPS de utilização" };
  return { home: "Accueil", publish: "Publier", shortcuts: "Raccourcis", general: "Général", language: "Langue", gps: "GPS d’utilisation" };
}

type MobileMenuActionButtonProps = {
  label: string;
  loading: boolean;
  onClick: () => void;
  warning?: boolean;
};

function MobileMenuActionButton({
  label,
  loading,
  onClick,
  warning = false,
}: MobileMenuActionButtonProps) {
  return (
    <button
      className={styles.menuItem}
      type="button"
      role="menuitem"
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={onClick}
    >
      <span className={styles.menuItemText}>
        {loading ? "Chargement…" : label}
      </span>
      {warning && !loading ? (
        <span className={styles.menuItemWarning} aria-hidden="true">
          ⚠️
        </span>
      ) : null}
    </button>
  );
}

function ResponsiveBottomNavMobile() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const dashboardEdition = useDashboardEdition();
  const standardMode = dashboardEdition === "standard";
  const t = useDashboardI18n();
  const { language, setLanguage } = useDashboardLanguage();
  const labels = useMemo(() => compactLabels(t.locale), [t.locale]);
  const {
    profileIncomplete,
    activityIncomplete,
    completionCheckReady,
    requiredSetupCompleted,
    requiredSetupIncomplete,
  } = useDashboardCompletionChecks();
  const requiredSetupAccessAllowed = !completionCheckReady || requiredSetupCompleted;
  const requiredSetupLocked = completionCheckReady && requiredSetupIncomplete;
  const requiredSetupLockMessage = t.modules.requiredSetupLocked;
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
  const pendingInrAgentCount = useInrAgentPendingCount(true);
  const [shortcuts, setShortcuts] = useState<MobileShortcutId[]>([...DEFAULT_MOBILE_SHORTCUTS]);
  const [isAdmin, setIsAdmin] = useState(false);
  const displayedShortcuts = useMemo(
    () => standardMode ? [...STANDARD_MOBILE_SHORTCUTS] : shortcuts,
    [shortcuts, standardMode],
  );
  const availableShortcutOptions = useMemo(
    () => standardMode
      ? MOBILE_SHORTCUT_OPTIONS.filter((option) => STANDARD_MOBILE_SHORTCUTS.includes(option.id))
      : MOBILE_SHORTCUT_OPTIONS,
    [standardMode],
  );

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

  const refreshShortcuts = useCallback(async () => {
    try {
      setShortcuts(await loadMobileShortcutsPreference());
    } catch {
      setShortcuts([...DEFAULT_MOBILE_SHORTCUTS]);
    }
  }, []);

  useEffect(() => {
    void refreshShortcuts();
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ shortcuts?: unknown }>).detail;
      if (detail?.shortcuts) setShortcuts(normalizeMobileShortcuts(detail.shortcuts));
      else void refreshShortcuts();
    };
    window.addEventListener(MOBILE_SHORTCUTS_EVENT, onUpdated);
    return () => window.removeEventListener(MOBILE_SHORTCUTS_EVENT, onUpdated);
  }, [refreshShortcuts]);

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
      hidden ? "0px" : "calc(50px + env(safe-area-inset-bottom, 0px))",
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
      let targetHref = href;

      if (
        isDashboardRequiredSetupProtectedDestination(href) &&
        !requiredSetupAccessAllowed
      ) {
        const panel = profileIncomplete
          ? "profil"
          : activityIncomplete
            ? "activite"
            : "profil";
        targetHref = `/dashboard?panel=${encodeURIComponent(panel)}`;
      }

      if (targetHref === "/dashboard?action=publish") {
        return { key: "modal:publish", kind: "publish", href: targetHref };
      }

      return { key: `route:${targetHref}`, kind: "href", href: targetHref };
    },
    [activityIncomplete, profileIncomplete, requiredSetupAccessAllowed],
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
      setActiveBrowserUserId(null);
      const { error } = await (supabase.auth.signOut as any)({ scope: "local" })
        .catch(() => ({ error: null as { message?: string } | null }));
      if (error) {
        console.error("Erreur déconnexion:", error.message);
        return;
      }
      window.location.replace("/login");
    });
  }, [requestNavigation]);

  const currentLanguage = getAppLanguageOption(language);
  const pendingLabel = pendingInrAgentCount > 99 ? "99+" : String(pendingInrAgentCount);
  const homeActive = pathname === "/dashboard" && !searchParams.get("action") && !searchParams.get("panel");
  const publishActive =
    publishModalOpen ||
    (pathname === "/dashboard" && searchParams.get("action") === "publish");
  const hasMenuWarning = profileIncomplete || activityIncomplete;
  const publishActionKey = resolveHrefDestination("/dashboard?action=publish").key;
  const mediaActionKey = resolveHrefDestination("/dashboard/mediatheque").key;
  const gpsActionKey = resolveHrefDestination("/dashboard/gps").key;
  const adminActionKey = resolveHrefDestination("/dashboard/admin").key;
  const publishLoadingVisible = isVisible(publishActionKey);

  return (
    <>
      <div className={styles.shortcutPreloader} aria-hidden="true">
        {availableShortcutOptions.map((option) => option.iconSrc).filter((src): src is string => Boolean(src)).map((src) => (
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
          <div className={styles.menuPanel} role="menu" aria-label={t.topbar.menu} data-disable-pull-refresh="true">
            <section className={styles.menuSection} aria-label={labels.shortcuts}>
              <div className={styles.menuSectionTitle}>{labels.shortcuts}</div>
              <div className={styles.shortcutGrid}>
                {displayedShortcuts.map((id) => {
                  const option = getMobileShortcutOption(id);
                  const label = getMobileShortcutLabel(id, t.locale);
                  const shortcutLocked = requiredSetupLocked && isDashboardRequiredSetupProtectedDestination(option.href);
                  const shortcutActionKey = resolveHrefDestination(option.href).key;
                  const shortcutLoadingVisible = isVisible(shortcutActionKey);
                  return (
                    <button
                      key={id}
                      className={`${styles.shortcutItem} ${shortcutLocked ? styles.shortcutItemLocked : ""}`}
                      type="button"
                      role="menuitem"
                      aria-busy={shortcutLoadingVisible || undefined}
                      aria-disabled={shortcutLoadingVisible || undefined}
                      onClick={() => navigate(option.href)}
                    >
                      <span className={styles.shortcutIconSlot} aria-hidden="true">
                        {option.iconSrc ? <img src={option.iconSrc} alt="" className={styles.shortcutIconImage} loading="eager" decoding="async" /> : <span className={styles.shortcutIconText}>{option.iconText}</span>}
                        {id === "agent" && pendingInrAgentCount > 0 ? <span className={styles.shortcutBadge}>{pendingLabel}</span> : null}
                      </span>
                      <span className={styles.shortcutLabel}>{shortcutLoadingVisible ? "Chargement…" : label}</span>
                      {shortcutLocked ? (
                        <RequiredSetupLock
                          message={requiredSetupLockMessage}
                          className={styles.requiredSetupLockShortcut}
                          compact
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>

            <div className={styles.menuDivider} />

            <section className={styles.menuSection} aria-label={labels.general}>
              <div className={styles.menuSectionTitle}>{labels.general}</div>
              <div className={styles.menuGrid}>
                <MobileMenuActionButton
                  label={t.topbar.contact}
                  loading={isVisible("panel:contact")}
                  onClick={() => openDashboardPanel("contact")}
                />
                <MobileMenuActionButton
                  label={t.userMenu.account}
                  loading={isVisible("panel:compte")}
                  onClick={() => openDashboardPanel("compte")}
                />
                <MobileMenuActionButton
                  label={t.userMenu.profile}
                  loading={isVisible("panel:profil")}
                  onClick={() => openDashboardPanel("profil")}
                  warning={profileIncomplete}
                />
                <MobileMenuActionButton
                  label={t.userMenu.activity}
                  loading={isVisible("panel:activite")}
                  onClick={() => openDashboardPanel("activite")}
                  warning={activityIncomplete}
                />
                <MobileMenuActionButton
                  label={t.userMenu.preferences}
                  loading={isVisible("panel:preferences")}
                  onClick={() => openDashboardPanel("preferences")}
                />
                <MobileMenuActionButton
                  label={t.userMenu.ai}
                  loading={isVisible("panel:ia")}
                  onClick={() => openDashboardPanel("ia")}
                />
                <MobileMenuActionButton
                  label={t.userMenu.media}
                  loading={isVisible(mediaActionKey)}
                  onClick={() => navigate("/dashboard/mediatheque")}
                />
                <MobileMenuActionButton
                  label={t.userMenu.subscription}
                  loading={isVisible("panel:abonnement")}
                  onClick={() => openDashboardPanel("abonnement")}
                />
                <MobileMenuActionButton
                  label={t.userMenu.inertia}
                  loading={isVisible("panel:inertie")}
                  onClick={() => openDashboardPanel("inertie")}
                />
                <MobileMenuActionButton
                  label={t.userMenu.shop}
                  loading={isVisible("panel:boutique")}
                  onClick={() => openDashboardPanel("boutique")}
                />
                <MobileMenuActionButton
                  label={t.userMenu.referral}
                  loading={isVisible("panel:parrainage")}
                  onClick={() => openDashboardPanel("parrainage")}
                />
                <MobileMenuActionButton
                  label={labels.gps}
                  loading={isVisible(gpsActionKey)}
                  onClick={() => navigate("/dashboard/gps")}
                />
                <button
                  className={styles.menuItem}
                  type="button"
                  role="menuitem"
                  aria-expanded={languageOpen}
                  onClick={() => setLanguageOpen((open) => !open)}
                >
                  <span className={styles.menuItemText}>{labels.language}</span>
                  <img
                    className={styles.menuLanguageFlag}
                    src={currentLanguage.flagSrc}
                    alt={currentLanguage.flag}
                  />
                </button>
                {isAdmin ? (
                  <MobileMenuActionButton
                    label={t.topbar.admin}
                    loading={isVisible(adminActionKey)}
                    onClick={() => navigate("/dashboard/admin")}
                  />
                ) : null}
                <MobileMenuActionButton
                  label={t.userMenu.legal}
                  loading={isVisible("panel:legal")}
                  onClick={() => openDashboardPanel("legal")}
                />
                <MobileMenuActionButton
                  label={t.userMenu.rgpd}
                  loading={isVisible("panel:rgpd")}
                  onClick={() => openDashboardPanel("rgpd")}
                />
              </div>

              {languageOpen ? (
                <div className={styles.languageGrid} role="group" aria-label={t.language.panelAria}>
                  {APP_LANGUAGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.languageChoice} ${option.value === language ? styles.languageChoiceActive : ""}`}
                      aria-pressed={option.value === language}
                      onClick={() => { void setLanguage(option.value as AppLanguageCode); setLanguageOpen(false); }}
                    >
                      <img src={option.flagSrc} alt={option.flag} />
                      <span>{option.shortLabel}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            <div className={styles.menuDivider} />
            <button className={styles.menuDanger} type="button" role="menuitem" onClick={() => void handleLogout()}>{t.userMenu.logout}</button>
          </div>
        </>
      ) : null}

      <nav className={`${styles.root} ${hidden ? styles.rootHidden : ""}`} aria-label="Navigation mobile iNrCy">
        <div className={styles.bar}>
          <button
            type="button"
            className={`${styles.item} ${homeActive ? styles.itemActive : ""}`}
            aria-label={labels.home}
            aria-current={homeActive ? "page" : undefined}
            onClick={() => navigate("/dashboard")}
          >
            <span className={styles.iconSlot}><HomeIcon /></span>
          </button>

          <EstablishmentMenu
            mobile
            locale={t.locale}
            buttonClassName={styles.item}
            panelClassName={styles.dockEstablishmentPanel}
            onContact={() => openDashboardPanel("contact")}
            onOpen={() => { setMenuOpen(false); setLanguageOpen(false); setNotificationMenuOpen(false); }}
            beforeAccountSwitch={(proceed) => requestNavigation(proceed)}
          />

          <button
            type="button"
            className={`${styles.publishItem} ${publishActive ? styles.publishItemActive : ""}`}
            aria-label={labels.publish}
            aria-current={publishActive ? "page" : undefined}
            aria-busy={publishLoadingVisible || undefined}
            aria-disabled={publishActive || publishLoadingVisible ? "true" : undefined}
            disabled={publishActive}
            onClick={() => {
              navigate("/dashboard?action=publish");
            }}
          >
            <span className={styles.publishButton}>{publishLoadingVisible ? "Chargement…" : labels.publish}</span>
            {requiredSetupLocked ? (
              <RequiredSetupLock
                message={requiredSetupLockMessage}
                className={styles.requiredSetupLockPublish}
                compact
              />
            ) : null}
          </button>

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
