"use client";

import { getActiveBrowserUserId, readAccountCacheValue, resolveActiveBrowserUserId, writeAccountCacheValue } from "@/lib/browserAccountCache";
import { DASHBOARD_CACHE_KEYS } from "@/lib/dashboardCacheKeys";

import { useCallback, useEffect, useRef, useState } from "react";
import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { createClient } from "@/lib/supabaseClient";
import type { ActusDesign, ActusFont, ActusLayout, ActusTheme, GoogleProduct } from "../../dashboard.types";
import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";

type PatchChannelConnectionLocally = (
  channel: DashboardChannelKey,
  patch: Partial<InrstatsChannelBlock["connection"]>,
  options?: { clearData?: boolean; clearError?: boolean },
) => void;

type TriggerChannelRefresh = (channel: DashboardChannelKey) => Promise<void>;

type ExtractDomain = (input: string) => string;
type FetchWidgetToken = (domain: string, source: "site_web") => Promise<string>;

type UseSiteWebChannelOptions = {
  extractDomain: ExtractDomain;
  fetchWidgetToken: FetchWidgetToken;
  patchChannelConnectionLocally: PatchChannelConnectionLocally;
  triggerChannelRefresh: TriggerChannelRefresh;
};

const removeGoogleProductFromSettings = (settingsObj: any, product: GoogleProduct) => {
  const next = settingsObj && typeof settingsObj === "object" ? { ...settingsObj } : {};
  delete next[product];
  return next;
};

function cacheGoogleDisconnect(product: "ga4" | "gsc", connections: { ga4: boolean; gsc: boolean }, accountId: string | null) {
  try {
    const raw = readAccountCacheValue(DASHBOARD_CACHE_KEYS.channelState, accountId);
    const stored = raw ? JSON.parse(raw) : {};
    const current = stored?.state ?? stored;
    const state = {
      ...current,
      siteWebGa4Connected: connections.ga4,
      siteWebGscConnected: connections.gsc,
      ...(product === "ga4" ? { siteWebGa4MeasurementId: "", siteWebGa4PropertyId: "" } : { siteWebGscProperty: "" }),
    };
    if (typeof state.siteWebSettingsText === "string") {
      state.siteWebSettingsText = JSON.stringify(removeGoogleProductFromSettings(JSON.parse(state.siteWebSettingsText || "{}"), product), null, 2);
    }
    writeAccountCacheValue(DASHBOARD_CACHE_KEYS.channelState, JSON.stringify({ cachedAt: Date.now(), state }), accountId);
  } catch {
    // Storage is optional; the route remains the connection authority.
  }
}

const resetGoogleStats = async () => {
  await Promise.all([
    fetch("/api/integrations/google-stats/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "site_web", product: "ga4" }),
    }).catch(() => null),
    fetch("/api/integrations/google-stats/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "site_web", product: "gsc" }),
    }).catch(() => null),
  ]);
};

const syncSitePresenceState = async () => {
  try {
    await fetch("/api/integrations/site-presence/sync", { method: "POST" });
  } catch {}
};

export function useSiteWebChannel({
  extractDomain,
  fetchWidgetToken,
  patchChannelConnectionLocally,
  triggerChannelRefresh,
}: UseSiteWebChannelOptions) {
  const googleDisconnectsRef = useRef(new Map<string, Promise<void>>());
  const googleDisconnectQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [siteWebUrl, setSiteWebUrl] = useState<string>("");
  const [siteWebSavedUrl, setSiteWebSavedUrl] = useState<string>("");
  const [siteWebSettingsText, setSiteWebSettingsText] = useState<string>("{}");
  const [siteWebSettingsError, setSiteWebSettingsError] = useState<string | null>(null);
  const [siteWebGa4MeasurementId, setSiteWebGa4MeasurementId] = useState<string>("");
  const [siteWebGa4PropertyId, setSiteWebGa4PropertyId] = useState<string>("");
  const [siteWebGscProperty, setSiteWebGscProperty] = useState<string>("");
  const [siteWebGa4Notice, setSiteWebGa4Notice] = useState<string | null>(null);
  const [siteWebGscNotice, setSiteWebGscNotice] = useState<string | null>(null);
  const [siteWebUrlNotice, setSiteWebUrlNotice] = useState<string | null>(null);
  const [widgetTokenSiteWeb, setWidgetTokenSiteWeb] = useState<string>("");
  const [siteWebActusLayout, setSiteWebActusLayout] = useState<ActusLayout>("list");
  const [siteWebActusLimit, setSiteWebActusLimit] = useState<number>(5);
  const [siteWebActusDesign, setSiteWebActusDesign] = useState<ActusDesign>("contemporary");
  const [siteWebActusAccent, setSiteWebActusAccent] = useState<string>("");
  const [siteWebActusFont, setSiteWebActusFont] = useState<ActusFont>("site");
  const [siteWebActusTheme, setSiteWebActusTheme] = useState<ActusTheme>("nature");
  const [showSiteWebWidgetCode, setShowSiteWebWidgetCode] = useState(false);
  const [siteWebGa4Connected, setSiteWebGa4ConnectedState] = useState(false);
  const [siteWebGscConnected, setSiteWebGscConnectedState] = useState(false);
  const googleConnectionStateRef = useRef({ ga4: false, gsc: false });
  const setSiteWebGa4Connected = useCallback((connected: boolean) => {
    googleConnectionStateRef.current.ga4 = connected;
    setSiteWebGa4ConnectedState(connected);
  }, []);
  const setSiteWebGscConnected = useCallback((connected: boolean) => {
    googleConnectionStateRef.current.gsc = connected;
    setSiteWebGscConnectedState(connected);
  }, []);

  const requestSiteWebWidgetToken = useCallback(async () => {
    const d = extractDomain(siteWebSavedUrl || siteWebUrl);
    if (!d) {
      setWidgetTokenSiteWeb("");
      return "";
    }

    const nextToken = await fetchWidgetToken(d, "site_web").catch(() => "");
    setWidgetTokenSiteWeb(nextToken);
    return nextToken;
  }, [extractDomain, fetchWidgetToken, siteWebSavedUrl, siteWebUrl]);

  useEffect(() => {
    void requestSiteWebWidgetToken();
  }, [requestSiteWebWidgetToken]);

  const updateSiteWebSettings = useCallback(
    async (nextSiteWeb: any) => {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) return false;

      const { data: row, error: readErr } = await supabase
        .from("pro_tools_configs")
        .select("settings")
        .eq("user_id", resolveActiveBrowserUserId(user.id))
        .maybeSingle();

      if (readErr) {
        setSiteWebSettingsError(getSimpleFrenchErrorMessage(readErr));
        return false;
      }

      const current = (row as any)?.settings ?? {};
      const merged = { ...(current ?? {}), site_web: nextSiteWeb ?? {} };

      const { error } = await supabase.from("pro_tools_configs").upsert({ user_id: resolveActiveBrowserUserId(user.id), settings: merged }, { onConflict: "user_id" });
      if (error) {
        setSiteWebSettingsError(getSimpleFrenchErrorMessage(error));
        return false;
      }

      setSiteWebSettingsError(null);
      try {
        setSiteWebSettingsText(JSON.stringify(nextSiteWeb ?? {}, null, 2));
      } catch {
        setSiteWebSettingsText("{}");
      }
      return true;
    },
    []
  );

  const disconnectGoogleStats = useCallback(
    (product: "ga4" | "gsc") => {
      const accountId = getActiveBrowserUserId();
      const key = `${accountId}:${product}`;
      const existing = googleDisconnectsRef.current.get(key);
      if (existing) return existing;
      const task = googleDisconnectQueueRef.current.catch(() => {}).then(async () => {
        if (getActiveBrowserUserId() !== accountId) return;
        const res = await fetch("/api/integrations/google-stats/disconnect", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "site_web", product }),
        }).catch(() => null);
        const payload = await res?.json().catch(() => null);
        if (getActiveBrowserUserId() !== accountId) return;

        if (!res || !res.ok || payload?.ok !== true) {
          const msg = !res
            ? "Connexion au serveur impossible pour le moment. Merci de réessayer."
            : getSimpleFrenchErrorMessage(String(res.status));
          setSiteWebSettingsError(getSimpleFrenchErrorMessage(msg));
          throw new Error(msg);
        }

        // The route already persists removal of this product. Rewriting the
        // whole settings object here is both slower and can restore stale data.
        setSiteWebSettingsText((currentText) => {
          try { return JSON.stringify(removeGoogleProductFromSettings(JSON.parse(currentText || "{}"), product), null, 2); }
          catch { return "{}"; }
        });
        setSiteWebSettingsError(null);
        googleConnectionStateRef.current[product] = false;
        cacheGoogleDisconnect(product, googleConnectionStateRef.current, accountId);
        if (product === "ga4") {
          setSiteWebGa4MeasurementId("");
          setSiteWebGa4PropertyId("");
          setSiteWebGa4Connected(false);
          setSiteWebGa4Notice("Google Analytics déconnecté.");
        } else {
          setSiteWebGscProperty("");
          setSiteWebGscConnected(false);
          setSiteWebGscNotice("Search Console déconnecté.");
        }

        const remainingStatsConnected = product === "ga4"
          ? googleConnectionStateRef.current.gsc
          : googleConnectionStateRef.current.ga4;
        patchChannelConnectionLocally("site_web", {
          connected: remainingStatsConnected,
          accountConnected: Boolean(siteWebSavedUrl.trim()),
          configured: Boolean(siteWebSavedUrl.trim()),
          statsConnected: remainingStatsConnected,
          connectionStatus: remainingStatsConnected ? "connected" : "disconnected",
          resourceId: siteWebSavedUrl || null,
          resourceLabel: siteWebSavedUrl || null,
          resourceUrl: siteWebSavedUrl || null,
        });

        void triggerChannelRefresh("site_web").catch(() => {});
      });
      googleDisconnectQueueRef.current = task;
      googleDisconnectsRef.current.set(key, task);
      void task.finally(() => {
        if (googleDisconnectsRef.current.get(key) === task) googleDisconnectsRef.current.delete(key);
      }).catch(() => {});
      return task;
    },
    [
      patchChannelConnectionLocally,
      siteWebSavedUrl,
      setSiteWebGa4Connected,
      setSiteWebGscConnected,
      triggerChannelRefresh,
    ]
  );

  const disconnectAllSiteWebGoogleStats = useCallback(async () => {
    await resetGoogleStats();

    let nextSettings: any = {};
    try {
      const parsed = siteWebSettingsText?.trim() ? JSON.parse(siteWebSettingsText) : {};
      nextSettings = removeGoogleProductFromSettings(removeGoogleProductFromSettings(parsed, "ga4"), "gsc");
    } catch {
      nextSettings = {};
    }
    await updateSiteWebSettings(nextSettings);
    setSiteWebGa4MeasurementId("");
    setSiteWebGa4PropertyId("");
    setSiteWebGscProperty("");
    setSiteWebGa4Connected(false);
    setSiteWebGscConnected(false);
    setSiteWebGa4Notice("Google Analytics déconnecté automatiquement.");
    setSiteWebGscNotice("Search Console déconnecté automatiquement.");
    setSiteWebSettingsError(null);
    window.setTimeout(() => {
      setSiteWebGa4Notice(null);
      setSiteWebGscNotice(null);
    }, 2500);
  }, [setSiteWebGa4Connected, setSiteWebGscConnected, siteWebSettingsText, updateSiteWebSettings]);

  const applySiteWebPublicUrlSaved = useCallback((url: string) => {
    setSiteWebUrl(url);
    setSiteWebSavedUrl(url);
    setSiteWebSettingsText((currentText) => {
      try {
        const current = currentText.trim() ? JSON.parse(currentText) : {};
        const next = current && typeof current === "object" ? { ...current } : {};
        next.url = url;
        next.domain = new URL(url).hostname;
        return JSON.stringify(next, null, 2);
      } catch {
        return currentText;
      }
    });

    const statsConnected = Boolean(url && (siteWebGa4Connected || siteWebGscConnected));
    patchChannelConnectionLocally("site_web", {
      connected: statsConnected,
      accountConnected: true,
      configured: true,
      statsConnected,
      connectionStatus: statsConnected ? "connected" : "disconnected",
      resourceId: url,
      resourceLabel: url,
      resourceUrl: url,
    });
    void triggerChannelRefresh("site_web");
    void syncSitePresenceState();
  }, [patchChannelConnectionLocally, siteWebGa4Connected, siteWebGscConnected, triggerChannelRefresh]);

  const saveSiteWebUrl = useCallback(async () => {
    if (siteWebSavedUrl.trim()) return;

    const rawUrl = siteWebUrl.trim();
    if (!rawUrl) {
      setSiteWebSettingsError("Renseigne un vrai lien de site (ex: https://monsite.fr) avant d'enregistrer.");
      return;
    }

    const response = await fetch("/api/integrations/channel-public-url", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "site_web", url: rawUrl }),
    }).catch(() => null);
    const payload = await response?.json().catch(() => ({}));
    if (!response?.ok || payload?.ok === false) {
      setSiteWebSettingsError(String(payload?.error || "Impossible d’enregistrer ce lien pour le moment."));
      return;
    }

    const savedUrl = String(payload?.url || rawUrl);
    setSiteWebSettingsError(null);
    applySiteWebPublicUrlSaved(savedUrl);
    setSiteWebUrlNotice("✅ Lien du site enregistré");
    window.setTimeout(() => setSiteWebUrlNotice(null), 2500);
  }, [applySiteWebPublicUrlSaved, siteWebSavedUrl, siteWebUrl]);

  const deleteSiteWebUrl = useCallback(async () => {
    if (!siteWebSavedUrl.trim()) return;

    const ok = await confirmInrcy({
      title: "Supprimer le lien Site web ?",
      message: "Cette action déconnectera automatiquement Google Analytics et Google Search Console pour la bulle Site web.",
      confirmLabel: "Supprimer le lien",
      variant: "danger",
    });
    if (!ok) return;

    await disconnectAllSiteWebGoogleStats();

    let parsed: any;
    try {
      parsed = siteWebSettingsText?.trim() ? JSON.parse(siteWebSettingsText) : {};
    } catch {
      parsed = {};
    }
    parsed = parsed && typeof parsed === "object" ? { ...parsed } : {};
    delete parsed.url;
    delete parsed.domain;
    delete parsed.ga4;
    delete parsed.gsc;

    await updateSiteWebSettings(parsed);
    setSiteWebUrl("");
    setSiteWebSavedUrl("");
    setShowSiteWebWidgetCode(false);
    patchChannelConnectionLocally("site_web", {
      connected: false,
      accountConnected: false,
      configured: false,
      statsConnected: false,
      connectionStatus: "disconnected",
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    triggerChannelRefresh("site_web");
    await syncSitePresenceState();
    setSiteWebUrlNotice("✅ Lien du site supprimé. GA4 et Search Console ont été déconnectés.");
    window.setTimeout(() => setSiteWebUrlNotice(null), 2500);
  }, [disconnectAllSiteWebGoogleStats, patchChannelConnectionLocally, siteWebSavedUrl, siteWebSettingsText, triggerChannelRefresh, updateSiteWebSettings]);

  const resetSiteWebAll = useCallback(async () => {
    const ok = await confirmInrcy({
      title: "Réinitialiser la configuration ?",
      message: "Cela supprimera le lien, GA4 et Search Console pour la bulle Site web.",
      confirmLabel: "Réinitialiser",
      variant: "danger",
    });
    if (!ok) return;

    await resetGoogleStats();
    await updateSiteWebSettings({});

    setSiteWebUrl("");
    setSiteWebSavedUrl("");
    setSiteWebSettingsText("{}");
    setSiteWebGa4MeasurementId("");
    setSiteWebGa4PropertyId("");
    setSiteWebGscProperty("");
    setSiteWebGa4Connected(false);
    setSiteWebGscConnected(false);
    patchChannelConnectionLocally("site_web", {
      connected: false,
      accountConnected: false,
      configured: false,
      statsConnected: false,
      connectionStatus: "disconnected",
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    triggerChannelRefresh("site_web");
  }, [patchChannelConnectionLocally, setSiteWebGa4Connected, setSiteWebGscConnected, updateSiteWebSettings, triggerChannelRefresh]);

  const saveSiteWebActusWidgetSettings = useCallback(async () => {
    if (!siteWebSavedUrl.trim()) {
      setSiteWebSettingsError("Enregistrez le lien du site avant de générer le code du widget.");
      return false;
    }

    let parsed: any;
    try {
      parsed = siteWebSettingsText?.trim() ? JSON.parse(siteWebSettingsText) : {};
    } catch {
      setSiteWebSettingsError("JSON invalide. Corrige la configuration avant de générer le widget.");
      return false;
    }

    parsed = parsed && typeof parsed === "object" ? { ...parsed } : {};
    parsed.url = siteWebSavedUrl.trim();
    parsed.actus_widget = {
      layout: siteWebActusLayout,
      limit: siteWebActusLimit,
      design: siteWebActusDesign,
      accent: siteWebActusAccent,
      theme: siteWebActusTheme,
      generated_at: new Date().toISOString(),
    };

    const ok = await updateSiteWebSettings(parsed);
    if (!ok) return false;
    setSiteWebUrlNotice("✅ Widget enregistré. Code généré.");
    window.setTimeout(() => setSiteWebUrlNotice(null), 2500);
    return true;
  }, [siteWebActusAccent, siteWebActusDesign, siteWebActusLayout, siteWebActusLimit, siteWebActusTheme, siteWebSavedUrl, siteWebSettingsText, updateSiteWebSettings]);

  const saveSiteWebSettings = useCallback(async () => {
    let parsed: any;
    try {
      parsed = siteWebSettingsText?.trim() ? JSON.parse(siteWebSettingsText) : {};
    } catch {
      setSiteWebSettingsError("JSON invalide. Vérifiez la syntaxe (guillemets, virgules, accolades…).");
      return;
    }

    parsed.url = siteWebUrl.trim();

    await updateSiteWebSettings(parsed);
    triggerChannelRefresh("site_web");
    setSiteWebGa4Notice("✅ Enregistrement GA4 validé");
    window.setTimeout(() => setSiteWebGa4Notice(null), 2500);

  }, [siteWebSettingsText, siteWebUrl, updateSiteWebSettings, triggerChannelRefresh]);

  const attachWebsiteGoogleAnalytics = useCallback(async () => {
    const measurement = siteWebGa4MeasurementId.trim();
    const propertyIdRaw = siteWebGa4PropertyId.trim();
    if (!measurement) {
      setSiteWebSettingsError("Renseigne un ID de mesure GA4 (ex: G-XXXXXXXXXX).");
      return;
    }

    if (!propertyIdRaw || !/^\d+$/.test(propertyIdRaw)) {
      setSiteWebSettingsError("Renseigne un Property ID GA4 (numérique, ex: 123456789).");
      return;
    }

    let parsed: any;
    try {
      parsed = siteWebSettingsText?.trim() ? JSON.parse(siteWebSettingsText) : {};
    } catch {
      setSiteWebSettingsError("JSON invalide. Corrige la configuration avant de rattacher Google Analytics.");
      return;
    }

    parsed.url = siteWebUrl.trim();
    parsed.ga4 = { ...(parsed.ga4 ?? {}), measurement_id: measurement, property_id: propertyIdRaw };

    await updateSiteWebSettings(parsed);
    await triggerChannelRefresh("site_web");
    setSiteWebGa4Notice("✅ Enregistrement GA4 validé");
    window.setTimeout(() => setSiteWebGa4Notice(null), 2500);

  }, [siteWebGa4MeasurementId, siteWebGa4PropertyId, siteWebSettingsText, siteWebUrl, triggerChannelRefresh, updateSiteWebSettings]);

  const attachWebsiteGoogleSearchConsole = useCallback(async () => {
    const property = siteWebGscProperty.trim();
    if (!property) {
      setSiteWebSettingsError("Renseigne une propriété Search Console (ex: sc-domain:monsite.fr ou https://monsite.fr/).");
      return;
    }

    let parsed: any;
    try {
      parsed = siteWebSettingsText?.trim() ? JSON.parse(siteWebSettingsText) : {};
    } catch {
      setSiteWebSettingsError("JSON invalide. Corrige la configuration avant de rattacher Search Console.");
      return;
    }

    parsed.url = siteWebUrl.trim();
    parsed.gsc = { ...(parsed.gsc ?? {}), property };

    await updateSiteWebSettings(parsed);
    triggerChannelRefresh("site_web");
  }, [siteWebGscProperty, siteWebSettingsText, siteWebUrl, updateSiteWebSettings, triggerChannelRefresh]);

  const connectSiteWebGa4 = useCallback(() => {
    const siteUrl = siteWebUrl.trim();
    if (!siteUrl) {
      setSiteWebSettingsError("Renseigne le lien du site avant de connecter Google Analytics.");
      return;
    }
    const qp = new URLSearchParams({
      source: "site_web",
      product: "ga4",
      siteUrl,
    });
    window.location.href = `/api/integrations/google-stats/start?${qp.toString()}`;
  }, [siteWebUrl]);

  const connectSiteWebGsc = useCallback(() => {
    const siteUrl = siteWebUrl.trim();
    if (!siteUrl) {
      setSiteWebSettingsError("Renseigne le lien du site avant de connecter Search Console.");
      return;
    }
    const qp = new URLSearchParams({
      source: "site_web",
      product: "gsc",
      siteUrl,
    });
    window.location.href = `/api/integrations/google-stats/start?${qp.toString()}`;
  }, [siteWebUrl]);

  const disconnectSiteWebGa4 = useCallback(() => {
    return disconnectGoogleStats("ga4");
  }, [disconnectGoogleStats]);

  const disconnectSiteWebGsc = useCallback(() => {
    return disconnectGoogleStats("gsc");
  }, [disconnectGoogleStats]);

  return {
    siteWebUrl,
    setSiteWebUrl,
    siteWebSavedUrl,
    setSiteWebSavedUrl,
    siteWebSettingsText,
    setSiteWebSettingsText,
    siteWebSettingsError,
    setSiteWebSettingsError,
    siteWebGa4MeasurementId,
    setSiteWebGa4MeasurementId,
    siteWebGa4PropertyId,
    setSiteWebGa4PropertyId,
    siteWebGscProperty,
    setSiteWebGscProperty,
    siteWebGa4Notice,
    setSiteWebGa4Notice,
    siteWebGscNotice,
    setSiteWebGscNotice,
    siteWebUrlNotice,
    widgetTokenSiteWeb,
    requestSiteWebWidgetToken,
    siteWebActusLayout,
    setSiteWebActusLayout,
    siteWebActusLimit,
    setSiteWebActusLimit,
    siteWebActusDesign,
    setSiteWebActusDesign,
    siteWebActusAccent,
    setSiteWebActusAccent,
    siteWebActusFont,
    setSiteWebActusFont,
    siteWebActusTheme,
    setSiteWebActusTheme,
    showSiteWebWidgetCode,
    setShowSiteWebWidgetCode,
    siteWebGa4Connected,
    setSiteWebGa4Connected,
    siteWebGscConnected,
    setSiteWebGscConnected,
    updateSiteWebSettings,
    applySiteWebPublicUrlSaved,
    saveSiteWebUrl,
    deleteSiteWebUrl,
    resetSiteWebAll,
    saveSiteWebActusWidgetSettings,
    saveSiteWebSettings,
    attachWebsiteGoogleAnalytics,
    attachWebsiteGoogleSearchConsole,
    connectSiteWebGa4,
    connectSiteWebGsc,
    disconnectSiteWebGa4,
    disconnectSiteWebGsc,
  };
}
