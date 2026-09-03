"use client";

import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";

import { useCallback, useEffect, useState } from "react";
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

type NormalizeSiteUrl = (input: string) => { normalizedUrl: string; hostname: string } | null;
type ExtractDomain = (input: string) => string;
type FetchWidgetToken = (domain: string, source: "inrcy_site" | "site_web") => Promise<string>;

type UseSiteWebChannelOptions = {
  normalizeSiteUrl: NormalizeSiteUrl;
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
  normalizeSiteUrl,
  extractDomain,
  fetchWidgetToken,
  patchChannelConnectionLocally,
  triggerChannelRefresh,
}: UseSiteWebChannelOptions) {
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
  const [siteWebGa4Connected, setSiteWebGa4Connected] = useState(false);
  const [siteWebGscConnected, setSiteWebGscConnected] = useState(false);

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
    async (product: "ga4" | "gsc") => {
      const res = await fetch("/api/integrations/google-stats/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "site_web", product }),
      }).catch(() => null);

      if (!res || !res.ok) {
        const msg = !res
          ? "Connexion au serveur impossible pour le moment. Merci de réessayer."
          : getSimpleFrenchErrorMessage(String(res.status));
        setSiteWebSettingsError(getSimpleFrenchErrorMessage(msg));
        return;
      }

      let nextSettings: any = {};
      try {
        const parsed = siteWebSettingsText?.trim() ? JSON.parse(siteWebSettingsText) : {};
        nextSettings = removeGoogleProductFromSettings(parsed, product);
      } catch {
        nextSettings = removeGoogleProductFromSettings({}, product);
      }
      await updateSiteWebSettings(nextSettings);
      setSiteWebSettingsError(null);
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
        ? Boolean(siteWebGscConnected)
        : Boolean(siteWebGa4Connected);
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

      void triggerChannelRefresh("site_web");
    },
    [
      patchChannelConnectionLocally,
      siteWebGa4Connected,
      siteWebGscConnected,
      siteWebSavedUrl,
      siteWebSettingsText,
      triggerChannelRefresh,
      updateSiteWebSettings,
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
  }, [siteWebSettingsText, updateSiteWebSettings]);

  const saveSiteWebUrl = useCallback(async () => {
    if (siteWebSavedUrl.trim()) return;

    let parsed: any;
    try {
      parsed = siteWebSettingsText?.trim() ? JSON.parse(siteWebSettingsText) : {};
    } catch {
      setSiteWebSettingsError("JSON invalide. Vérifiez la syntaxe (guillemets, virgules, accolades…).");
      return;
    }

    const rawUrl = siteWebUrl.trim();
    const nextNormalized = rawUrl ? normalizeSiteUrl(rawUrl) : null;

    if (rawUrl && !nextNormalized) {
      setSiteWebSettingsError("Renseigne un vrai lien de site (ex: https://monsite.fr) avant d'enregistrer.");
      return;
    }

    const valueToSave = nextNormalized?.normalizedUrl ?? "";
    parsed.url = valueToSave;
    if (nextNormalized?.hostname) parsed.domain = nextNormalized.hostname;
    else delete parsed.domain;

    await updateSiteWebSettings(parsed);
    setSiteWebUrl(valueToSave);
    setSiteWebSavedUrl(valueToSave);
    const statsConnected = Boolean(valueToSave && (siteWebGa4Connected || siteWebGscConnected));
    patchChannelConnectionLocally("site_web", {
      connected: statsConnected,
      accountConnected: Boolean(valueToSave),
      configured: Boolean(valueToSave),
      statsConnected,
      connectionStatus: statsConnected ? "connected" : "disconnected",
      resourceId: valueToSave || null,
      resourceLabel: valueToSave || null,
      resourceUrl: valueToSave || null,
    }, { clearData: !valueToSave });
    triggerChannelRefresh("site_web");
    await syncSitePresenceState();
    setSiteWebUrlNotice(valueToSave ? "✅ Lien du site enregistré" : null);
    if (valueToSave) {
      window.setTimeout(() => setSiteWebUrlNotice(null), 2500);
    }
  }, [normalizeSiteUrl, patchChannelConnectionLocally, siteWebGa4Connected, siteWebGscConnected, siteWebSavedUrl, siteWebSettingsText, siteWebUrl, triggerChannelRefresh, updateSiteWebSettings]);

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
  }, [patchChannelConnectionLocally, updateSiteWebSettings, triggerChannelRefresh]);

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
    void disconnectGoogleStats("ga4");
  }, [disconnectGoogleStats]);

  const disconnectSiteWebGsc = useCallback(() => {
    void disconnectGoogleStats("gsc");
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
