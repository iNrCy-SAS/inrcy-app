"use client";

import { useCallback, useEffect, useState } from "react";
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

const PANEL_RETURN_QUERY_KEYS = ["linked", "ok", "error", "message", "warning", "toast", "activated", "skipped", "panelSource", "profileSection", "premium"];

export function useDashboardPanelRouting() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const rawPanel = searchParams.get("panel");
  const urlPanel = rawPanel === "trustpilot"
    ? "inr_search"
    : rawPanel === "activite"
      ? "profil"
      : rawPanel;
  // Le panneau visible doit changer dans le même rendu que l'action de
  // navigation. `window.history.replaceState` met bien l'URL à jour, mais
  // `useSearchParams` peut rester sur son ancien instantané jusqu'à une vraie
  // navigation Next (ou un rechargement). Cet état local est donc le miroir
  // immédiat de l'URL ; les navigations externes le resynchronisent ensuite.
  const [panel, setPanel] = useState<string | null>(urlPanel);

  useEffect(() => {
    setPanel(urlPanel);
  }, [urlPanel]);

  useEffect(() => {
    if (rawPanel !== "trustpilot" && rawPanel !== "activite") return;
    const params = new URLSearchParams(searchParams.toString());
    if (rawPanel === "trustpilot") {
      params.set("panel", "inr_search");
    } else {
      params.set("panel", "profil");
      params.set("profileSection", "activity");
      if (!params.has("panelSource")) params.set("panelSource", "activity");
      try {
        sessionStorage.setItem("inrcy_panel_explicit_open", "1");
        sessionStorage.setItem("inrcy_last_panel", "profil");
      } catch {}
    }
    router.replace(`/dashboard?${params.toString()}`, { scroll: false });
  }, [rawPanel, router, searchParams]);

  const markPanelAsExplicitlyOpened = useCallback((name: DashboardPanelName) => {
    // Marqueur : panneau ouvert volontairement par l'utilisateur.
    try {
      sessionStorage.setItem("inrcy_panel_explicit_open", "1");
      sessionStorage.setItem("inrcy_last_panel", name);
    } catch {}
  }, []);

  const openPanel = useCallback(
    (name: DashboardPanelName) => {
      void requestNavigation(() => {
        const normalizedName = name === "activite" ? "profil" : name;
        const params = new URLSearchParams(searchParams.toString());
        params.set("panel", normalizedName);
        if (name === "activite") {
          params.set("profileSection", "activity");
        } else if (normalizedName === "profil") {
          params.delete("profileSection");
        }
        markPanelAsExplicitlyOpened(normalizedName);
        setPanel(normalizedName);
        router.push(`/dashboard?${params.toString()}`, { scroll: false });
      });
    },
    [markPanelAsExplicitlyOpened, requestNavigation, router, searchParams]
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
    setPanel(null);
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

  const goToModule = useCallback(
    (path: string) => {
      void requestNavigation(() => {
        // IMPORTANT: en allant dans un module, on VEUT arriver en haut de page.
        // On ne désactive donc PAS le scroll automatique de Next ici.
        router.push(path);
      });
    },
    [requestNavigation, router]
  );

  return { panel, openPanel, closePanel, goToModule };
}
