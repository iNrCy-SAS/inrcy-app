"use client";

import { useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboardUnsavedNavigation } from "../_components/DashboardUnsavedNavigationProvider";

export type DashboardPanelName =
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

const PANEL_RETURN_QUERY_KEYS = ["linked", "ok", "error", "message", "warning", "toast", "activated", "skipped", "panelSource", "premium"];

function rememberDashboardScroll() {
  try {
    sessionStorage.setItem("inrcy_dashboard_scrollY", String(window.scrollY ?? 0));
  } catch {}
}

export function useDashboardPanelRouting() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const rawPanel = searchParams.get("panel");
  const panel = rawPanel === "trustpilot" ? "inr_search" : rawPanel;

  useEffect(() => {
    if (rawPanel !== "trustpilot") return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("panel", "inr_search");
    router.replace(`/dashboard?${params.toString()}`, { scroll: false });
  }, [rawPanel, router, searchParams]);

  const markPanelAsExplicitlyOpened = useCallback((name: DashboardPanelName) => {
    // Marqueur: panneau ouvert volontairement par l'utilisateur ou par une
    // transition interne déjà validée (ex. sauvegarde d'une étape onboarding).
    try {
      sessionStorage.setItem("inrcy_panel_explicit_open", "1");
      sessionStorage.setItem("inrcy_last_panel", name);
    } catch {}
  }, []);

  const openPanel = useCallback(
    (name: DashboardPanelName) => {
      void requestNavigation(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("panel", name);
        markPanelAsExplicitlyOpened(name);
        // ✅ En mobile, on garde la position de scroll (pas de jump en haut)
        rememberDashboardScroll();
        router.push(`/dashboard?${params.toString()}`, { scroll: false });
      });
    },
    [markPanelAsExplicitlyOpened, requestNavigation, router, searchParams]
  );

  // Transition interne après une sauvegarde réussie. Elle ne passe pas par le
  // guard "modifications non enregistrées", car la sauvegarde a déjà remis le
  // formulaire à l'état propre. Le guard reste actif pour toute fermeture ou
  // navigation déclenchée manuellement par le professionnel.
  const replacePanelDirect = useCallback(
    (name: DashboardPanelName) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("panel", name);
      markPanelAsExplicitlyOpened(name);
      rememberDashboardScroll();
      router.replace(`/dashboard?${params.toString()}`, { scroll: false });
    },
    [markPanelAsExplicitlyOpened, router, searchParams],
  );

  const closePanel = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("panel");
    PANEL_RETURN_QUERY_KEYS.forEach((key) => {
      params.delete(key);
    });
    const qs = params.toString();
    // ✅ Quand on ferme, on remet le marqueur à zéro.
    // (Sinon un refresh pourrait relancer un panneau si une logique externe remet ?panel=...)
    try {
      sessionStorage.removeItem("inrcy_panel_explicit_open");
      sessionStorage.removeItem("inrcy_last_panel");
    } catch {}
    // ✅ En mobile, on garde la position de scroll (pas de jump en haut)
    rememberDashboardScroll();
    router.replace(qs ? `/dashboard?${qs}` : "/dashboard", { scroll: false });
  }, [router, searchParams]);

  // ✅ Sécurité UX: si l'URL arrive avec ?panel=profil (ou compte) sans action explicite
  // (cas observé: refresh/connexion + ancienne URL), on ferme automatiquement.
  // ⚠️ On ne touche PAS aux panels utilisés comme retours OAuth/Stripe (abonnement, mails, etc.).
  useEffect(() => {
    if (panel !== "profil" && panel !== "compte") return;
    const panelSource = searchParams.get("panelSource");
    if (panelSource === "gps" || panelSource === "settings") return;
    try {
      const explicit = sessionStorage.getItem("inrcy_panel_explicit_open");
      if (explicit) return;
    } catch {
      // si sessionStorage indisponible, on ne force rien
      return;
    }
    closePanel();
  }, [panel, closePanel, searchParams]);

  // Preserve dashboard scroll position when leaving the dashboard (vers un module)
  const goToModule = useCallback(
    (path: string) => {
      void requestNavigation(() => {
        rememberDashboardScroll();
        // IMPORTANT: en allant dans un module, on VEUT arriver en haut de page.
        // On ne désactive donc PAS le scroll automatique de Next ici.
        router.push(path);
      });
    },
    [requestNavigation, router]
  );

  useEffect(() => {
    try {
      const y = sessionStorage.getItem("inrcy_dashboard_scrollY");
      if (!y) return;
      const top = Math.max(0, parseInt(y, 10) || 0);
      // Let the page paint, then restore
      requestAnimationFrame(() => window.scrollTo(0, top));
      setTimeout(() => window.scrollTo(0, top), 60);
      sessionStorage.removeItem("inrcy_dashboard_scrollY");
    } catch {}
  }, [panel]);

  return { panel, openPanel, replacePanelDirect, closePanel, goToModule };
}
