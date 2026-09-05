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
  | "ai_memory"
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
    : rawPanel === "profil" || rawPanel === "activite" || rawPanel === "ai_memory" || rawPanel === "ia"
      ? null
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
    if (rawPanel === "profil" || rawPanel === "activite" || rawPanel === "ai_memory" || rawPanel === "ia") {
      router.replace(
        rawPanel === "profil"
          ? "/dashboard/mon-profil"
          : rawPanel === "activite"
            ? "/dashboard/mon-profil?section=activity"
            : rawPanel === "ia"
              ? "/dashboard/configuration-ia"
              : "/dashboard/adn-entreprise",
        { scroll: false },
      );
      return;
    }
    if (rawPanel !== "trustpilot") return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("panel", "inr_search");
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
        if (name === "profil" || name === "activite" || name === "ai_memory" || name === "ia") {
          markPanelAsExplicitlyOpened(name);
          setPanel(null);
          router.push(
            name === "profil"
              ? "/dashboard/mon-profil"
              : name === "activite"
                ? "/dashboard/mon-profil?section=activity"
                : name === "ia"
                  ? "/dashboard/configuration-ia"
                  : "/dashboard/adn-entreprise",
          );
          return;
        }
        const normalizedName = name;
        const params = new URLSearchParams(searchParams.toString());
        params.set("panel", normalizedName);
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

  // ✅ Sécurité UX: si l'URL arrive avec ?panel=compte sans action explicite
  // (cas observé: refresh/connexion + ancienne URL), on ferme automatiquement.
  // ⚠️ On ne touche PAS aux panels utilisés comme retours OAuth/Stripe (abonnement, mails, etc.).
  useEffect(() => {
    if (panel !== "compte") return;
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
