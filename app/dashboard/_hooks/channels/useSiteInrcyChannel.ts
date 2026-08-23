"use client";

import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";

import { useCallback, useEffect, useState } from "react";
import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { createClient } from "@/lib/supabaseClient";
import { isManagedInrcySite } from "@/lib/inrcySite";
import type { ActusDesign, ActusFont, ActusLayout, ActusTheme, GoogleProduct, Ownership } from "../../dashboard.types";
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

type UseSiteInrcyChannelOptions = {
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
      body: JSON.stringify({ source: "site_inrcy", product: "ga4" }),
    }).catch(() => null),
    fetch("/api/integrations/google-stats/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "site_inrcy", product: "gsc" }),
    }).catch(() => null),
  ]);
};

const syncSitePresenceState = async () => {
  try {
    await fetch("/api/integrations/site-presence/sync", { method: "POST" });
  } catch {}
};

export function useSiteInrcyChannel({
  normalizeSiteUrl,
  extractDomain,
  fetchWidgetToken,
  patchChannelConnectionLocally,
  triggerChannelRefresh,
}: UseSiteInrcyChannelOptions) {
  const [siteInrcyOwnership, setSiteInrcyOwnership] = useState<Ownership>("none");
  const [siteInrcyUrl, setSiteInrcyUrl] = useState<string>("");
  const [siteInrcySavedUrl, setSiteInrcySavedUrl] = useState<string>("");
  const [siteInrcyContactEmail, setSiteInrcyContactEmail] = useState<string>("");
  const [siteInrcySettingsText, setSiteInrcySettingsText] = useState<string>("{}");
  const [siteInrcySettingsError, setSiteInrcySettingsError] = useState<string | null>(null);
  const [siteInrcyTrackingBusy, setSiteInrcyTrackingBusy] = useState(false);
  const [siteInrcyGa4Notice, setSiteInrcyGa4Notice] = useState<string | null>(null);
  const [siteInrcyGscNotice, setSiteInrcyGscNotice] = useState<string | null>(null);
  const [siteInrcyUrlNotice, setSiteInrcyUrlNotice] = useState<string | null>(null);
  const [widgetTokenInrcySite, setWidgetTokenInrcySite] = useState<string>("");
  const [siteInrcyActusLayout, setSiteInrcyActusLayout] = useState<ActusLayout>("list");
  const [siteInrcyActusLimit, setSiteInrcyActusLimit] = useState<number>(5);
  const [siteInrcyActusDesign, setSiteInrcyActusDesign] = useState<ActusDesign>("contemporary");
  const [siteInrcyActusAccent, setSiteInrcyActusAccent] = useState<string>("");
  const [siteInrcyActusFont, setSiteInrcyActusFont] = useState<ActusFont>("site");
  const [siteInrcyActusTheme, setSiteInrcyActusTheme] = useState<ActusTheme>("nature");
  const [showSiteInrcyWidgetCode, setShowSiteInrcyWidgetCode] = useState(false);
  const [siteInrcyGa4Connected, setSiteInrcyGa4Connected] = useState(false);
  const [siteInrcyGscConnected, setSiteInrcyGscConnected] = useState(false);
  const [ga4MeasurementId, setGa4MeasurementId] = useState<string>("");
  const [ga4PropertyId, setGa4PropertyId] = useState<string>("");
  const [gscProperty, setGscProperty] = useState<string>("");

  useEffect(() => {
    const d = extractDomain(siteInrcyUrl);
    if (!d) {
      setWidgetTokenInrcySite("");
      return;
    }
    fetchWidgetToken(d, "inrcy_site")
      .then((t) => setWidgetTokenInrcySite(t))
      .catch(() => setWidgetTokenInrcySite(""));
  }, [siteInrcyUrl, extractDomain, fetchWidgetToken]);

  const updateSiteInrcySettings = useCallback(async (nextSettings: any) => {
    if (siteInrcyOwnership === "none") return false;

    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return false;

    const { error } = await supabase
      .from("inrcy_site_configs")
      .upsert({ user_id: resolveActiveBrowserUserId(user.id), settings: nextSettings ?? {} }, { onConflict: "user_id" });

    if (error) {
      setSiteInrcySettingsError(getSimpleFrenchErrorMessage(error));
      return false;
    }

    setSiteInrcySettingsError(null);
    try {
      setSiteInrcySettingsText(JSON.stringify(nextSettings ?? {}, null, 2));
    } catch {
      setSiteInrcySettingsText("{}");
    }
    return true;
  }, [siteInrcyOwnership]);

  const saveSiteInrcySettings = useCallback(async () => {
    if (siteInrcyOwnership === "none") return;

    let parsed: any;
    try {
      parsed = siteInrcySettingsText?.trim() ? JSON.parse(siteInrcySettingsText) : {};
    } catch {
      setSiteInrcySettingsError("JSON invalide. Vérifiez la syntaxe (guillemets, virgules, accolades…)." );
      return;
    }

    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    const { error } = await supabase.from("inrcy_site_configs").upsert({ user_id: resolveActiveBrowserUserId(user.id), settings: parsed }, { onConflict: "user_id" });

    if (error) {
      setSiteInrcySettingsError(getSimpleFrenchErrorMessage(error));
      return;
    }

    setSiteInrcySettingsError(null);
  }, [siteInrcyOwnership, siteInrcySettingsText]);

  const attachGoogleAnalytics = useCallback(async () => {
    const measurement = ga4MeasurementId.trim();
    const propertyIdRaw = ga4PropertyId.trim();
    if (!measurement) {
      setSiteInrcySettingsError("Renseigne un ID de mesure GA4 (ex: G-XXXXXXXXXX).");
      return;
    }

    if (!propertyIdRaw || !/^\d+$/.test(propertyIdRaw)) {
      setSiteInrcySettingsError("Renseigne un Property ID GA4 (numérique, ex: 123456789).");
      return;
    }

    let parsed: any;
    try {
      parsed = siteInrcySettingsText?.trim() ? JSON.parse(siteInrcySettingsText) : {};
    } catch {
      setSiteInrcySettingsError("JSON invalide. Corrige la configuration avant de rattacher Google Analytics.");
      return;
    }

    parsed.ga4 = { ...(parsed.ga4 ?? {}), measurement_id: measurement, property_id: propertyIdRaw };

    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    const { error } = await supabase.from("inrcy_site_configs").upsert({ user_id: resolveActiveBrowserUserId(user.id), settings: parsed }, { onConflict: "user_id" });

    if (error) {
      setSiteInrcySettingsError(getSimpleFrenchErrorMessage(error));
      return;
    }

    setSiteInrcySettingsText(JSON.stringify(parsed, null, 2));
    setSiteInrcyGa4Notice("✅ Enregistrement GA4 validé");
    window.setTimeout(() => setSiteInrcyGa4Notice(null), 2500);

    setSiteInrcySettingsError(null);
  }, [ga4MeasurementId, ga4PropertyId, siteInrcySettingsText]);

  const attachGoogleSearchConsole = useCallback(async () => {
    const property = gscProperty.trim();
    if (!property) {
      setSiteInrcySettingsError("Renseigne une propriété Search Console (ex: sc-domain:monsite.fr ou https://monsite.fr/).");
      return;
    }

    let parsed: any;
    try {
      parsed = siteInrcySettingsText?.trim() ? JSON.parse(siteInrcySettingsText) : {};
    } catch {
      setSiteInrcySettingsError("JSON invalide. Corrige la configuration avant de rattacher Search Console.");
      return;
    }

    parsed.gsc = { ...(parsed.gsc ?? {}), property };

    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    const { error } = await supabase.from("inrcy_site_configs").upsert({ user_id: resolveActiveBrowserUserId(user.id), settings: parsed }, { onConflict: "user_id" });

    if (error) {
      setSiteInrcySettingsError(getSimpleFrenchErrorMessage(error));
      return;
    }

    setSiteInrcySettingsText(JSON.stringify(parsed, null, 2));
    setSiteInrcyGscNotice("✅ Enregistrement Search Console validé");
    window.setTimeout(() => setSiteInrcyGscNotice(null), 2500);

    setSiteInrcySettingsError(null);
  }, [gscProperty, siteInrcySettingsText]);

  const connectSiteInrcyGa4 = useCallback(() => {
    if (siteInrcyOwnership === "none") {
      setSiteInrcySettingsError("Connexion Google Analytics indisponible : aucun site iNrCy.");
      return;
    }
    const siteUrl = (siteInrcyUrl || "").trim();
    if (!siteUrl) {
      setSiteInrcySettingsError("Renseigne le lien du site iNrCy avant de connecter Google Analytics.");
      return;
    }
    const qp = new URLSearchParams({
      source: "site_inrcy",
      product: "ga4",
      siteUrl,
    });
    window.location.href = `/api/integrations/google-stats/start?${qp.toString()}`;
  }, [siteInrcyOwnership, siteInrcyUrl]);

  const connectSiteInrcyGsc = useCallback(() => {
    if (siteInrcyOwnership === "none") {
      setSiteInrcySettingsError("Connexion Search Console indisponible : aucun site iNrCy.");
      return;
    }
    const siteUrl = (siteInrcyUrl || "").trim();
    if (!siteUrl) {
      setSiteInrcySettingsError("Renseigne le lien du site iNrCy avant de connecter Search Console.");
      return;
    }
    const qp = new URLSearchParams({
      source: "site_inrcy",
      product: "gsc",
      siteUrl,
    });
    window.location.href = `/api/integrations/google-stats/start?${qp.toString()}`;
  }, [siteInrcyOwnership, siteInrcyUrl]);

  const activateSiteInrcyTracking = useCallback(async () => {
    if (!isManagedInrcySite(siteInrcyOwnership)) {
      setSiteInrcySettingsError("Activation indisponible : cette action est réservée au mode rented.");
      return;
    }
    const siteUrl = (siteInrcyUrl || "").trim();
    if (!siteUrl) {
      setSiteInrcySettingsError("Renseigne le lien du site iNrCy avant d'activer le suivi.");
      return;
    }

    setSiteInrcySettingsError(null);
    setSiteInrcyTrackingBusy(true);

    const res = await fetch("/api/integrations/google-stats/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "site_inrcy", siteUrl }),
    }).catch(() => null);

    if (!res) {
      setSiteInrcyTrackingBusy(false);
      setSiteInrcySettingsError("Connexion au serveur impossible pour le moment. Merci de réessayer.");
      return;
    }

    const data = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      setSiteInrcyTrackingBusy(false);
      setSiteInrcySettingsError(getSimpleFrenchErrorMessage((data as any)?.error || String(res.status)));
      return;
    }

    setSiteInrcyTrackingBusy(false);
    setSiteInrcyGa4Connected(true);
    setSiteInrcyGscConnected(true);
    setSiteInrcyGa4Notice("✅ Suivi activé (GA4)");
    setSiteInrcyGscNotice("✅ Suivi activé (Search Console)");
    window.setTimeout(() => {
      setSiteInrcyGa4Notice(null);
      setSiteInrcyGscNotice(null);
    }, 2500);

    patchChannelConnectionLocally("site_inrcy", {
      connected: true,
      accountConnected: true,
      configured: true,
      statsConnected: true,
      connectionStatus: "connected",
      resourceId: siteUrl,
      resourceLabel: siteUrl,
      resourceUrl: siteUrl,
    });
    triggerChannelRefresh("site_inrcy");
  }, [patchChannelConnectionLocally, siteInrcyOwnership, siteInrcyUrl, triggerChannelRefresh]);

  const deactivateSiteInrcyTracking = useCallback(async () => {
    if (!isManagedInrcySite(siteInrcyOwnership)) {
      setSiteInrcySettingsError("Désactivation indisponible : cette action est réservée au mode rented.");
      return;
    }

    setSiteInrcySettingsError(null);
    setSiteInrcyTrackingBusy(true);

    const res = await fetch("/api/integrations/google-stats/deactivate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "site_inrcy" }),
    }).catch(() => null);

    if (!res) {
      setSiteInrcyTrackingBusy(false);
      setSiteInrcySettingsError("Connexion au serveur impossible pour le moment. Merci de réessayer.");
      return;
    }

    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      setSiteInrcyTrackingBusy(false);
      setSiteInrcySettingsError(getSimpleFrenchErrorMessage((data as any)?.error || String(res.status)));
      return;
    }

    setSiteInrcyGa4Connected(false);
    setSiteInrcyGscConnected(false);
    setSiteInrcyGa4Notice("Suivi désactivé (GA4). ");
    setSiteInrcyGscNotice("Suivi désactivé (Search Console). ");
    window.setTimeout(() => {
      setSiteInrcyGa4Notice(null);
      setSiteInrcyGscNotice(null);
    }, 2500);

    setSiteInrcyTrackingBusy(false);

    patchChannelConnectionLocally("site_inrcy", {
      connected: false,
      accountConnected: Boolean(siteInrcySavedUrl.trim()),
      configured: Boolean(siteInrcySavedUrl.trim()),
      statsConnected: false,
      connectionStatus: "disconnected",
      resourceId: siteInrcySavedUrl || null,
      resourceLabel: siteInrcySavedUrl || null,
      resourceUrl: siteInrcySavedUrl || null,
    }, { clearData: true });
    triggerChannelRefresh("site_inrcy");
  }, [patchChannelConnectionLocally, siteInrcyOwnership, siteInrcySavedUrl, triggerChannelRefresh]);

  const disconnectGoogleStats = useCallback(
    async (product: "ga4" | "gsc") => {
      const res = await fetch("/api/integrations/google-stats/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "site_inrcy", product }),
      }).catch(() => null);

      if (!res || !res.ok) {
        const msg = !res
          ? "Connexion au serveur impossible pour le moment. Merci de réessayer."
          : getSimpleFrenchErrorMessage(String(res.status));
        setSiteInrcySettingsError(getSimpleFrenchErrorMessage(msg));
        return;
      }

      let nextSettings: any = {};
      try {
        const parsed = siteInrcySettingsText?.trim() ? JSON.parse(siteInrcySettingsText) : {};
        nextSettings = removeGoogleProductFromSettings(parsed, product);
      } catch {
        nextSettings = removeGoogleProductFromSettings({}, product);
      }
      await updateSiteInrcySettings(nextSettings);
      setSiteInrcySettingsError(null);
      if (product === "ga4") {
        setGa4MeasurementId("");
        setGa4PropertyId("");
        setSiteInrcyGa4Connected(false);
        setSiteInrcyGa4Notice("Google Analytics déconnecté.");
      } else {
        setGscProperty("");
        setSiteInrcyGscConnected(false);
        setSiteInrcyGscNotice("Search Console déconnecté.");
      }

      const remainingStatsConnected = product === "ga4"
        ? Boolean(siteInrcyGscConnected)
        : Boolean(siteInrcyGa4Connected);
      patchChannelConnectionLocally("site_inrcy", {
        connected: remainingStatsConnected,
        accountConnected: Boolean(siteInrcySavedUrl.trim()),
        configured: Boolean(siteInrcySavedUrl.trim()),
        statsConnected: remainingStatsConnected,
        connectionStatus: remainingStatsConnected ? "connected" : "disconnected",
        resourceId: siteInrcySavedUrl || null,
        resourceLabel: siteInrcySavedUrl || null,
        resourceUrl: siteInrcySavedUrl || null,
      });

      void triggerChannelRefresh("site_inrcy");
    },
    [
      patchChannelConnectionLocally,
      siteInrcyGa4Connected,
      siteInrcyGscConnected,
      siteInrcySavedUrl,
      siteInrcySettingsText,
      triggerChannelRefresh,
      updateSiteInrcySettings,
    ]
  );

  const disconnectSiteInrcyGa4 = useCallback(() => {
    if (siteInrcyOwnership === "none") {
      setSiteInrcySettingsError("Déconnexion Google Analytics indisponible : aucun site iNrCy.");
      return;
    }
    void disconnectGoogleStats("ga4");
  }, [disconnectGoogleStats, siteInrcyOwnership]);

  const disconnectSiteInrcyGsc = useCallback(() => {
    if (siteInrcyOwnership === "none") {
      setSiteInrcySettingsError("Déconnexion Search Console indisponible : aucun site iNrCy.");
      return;
    }
    void disconnectGoogleStats("gsc");
  }, [disconnectGoogleStats, siteInrcyOwnership]);

  const disconnectAllSiteInrcyGoogleStats = useCallback(async () => {
    await resetGoogleStats();

    let nextSettings: any = {};
    try {
      const parsed = siteInrcySettingsText?.trim() ? JSON.parse(siteInrcySettingsText) : {};
      nextSettings = removeGoogleProductFromSettings(removeGoogleProductFromSettings(parsed, "ga4"), "gsc");
    } catch {
      nextSettings = {};
    }
    await updateSiteInrcySettings(nextSettings);
    setGa4MeasurementId("");
    setGa4PropertyId("");
    setGscProperty("");
    setSiteInrcyGa4Connected(false);
    setSiteInrcyGscConnected(false);
    setSiteInrcyGa4Notice("Google Analytics déconnecté automatiquement.");
    setSiteInrcyGscNotice("Search Console déconnecté automatiquement.");
    setSiteInrcySettingsError(null);
    window.setTimeout(() => {
      setSiteInrcyGa4Notice(null);
      setSiteInrcyGscNotice(null);
    }, 2500);
  }, [siteInrcySettingsText, updateSiteInrcySettings]);

  const saveSiteInrcyUrl = useCallback(async () => {
    if (siteInrcyOwnership === "none") return;
    if (siteInrcySavedUrl.trim()) return;

    const rawUrl = siteInrcyUrl.trim();
    const nextNormalized = rawUrl ? normalizeSiteUrl(rawUrl) : null;

    if (rawUrl && !nextNormalized) {
      setSiteInrcySettingsError("Renseigne un vrai lien de site (ex: https://monsite.fr) avant d'enregistrer.");
      return;
    }

    const valueToSave = nextNormalized?.normalizedUrl ?? "";

    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    const { error } = await supabase
      .from("inrcy_site_configs")
      .upsert({ user_id: resolveActiveBrowserUserId(user.id), site_url: valueToSave }, { onConflict: "user_id" });
    if (error) {
      setSiteInrcySettingsError(getSimpleFrenchErrorMessage(error));
      return;
    }

    setSiteInrcySettingsError(null);
    setSiteInrcyUrl(valueToSave);
    setSiteInrcySavedUrl(valueToSave);
    setSiteInrcyUrlNotice(valueToSave ? "✅ Lien du site enregistré" : null);
    const statsConnected = Boolean(valueToSave && (siteInrcyGa4Connected || siteInrcyGscConnected));
    patchChannelConnectionLocally("site_inrcy", {
      connected: statsConnected,
      accountConnected: Boolean(valueToSave),
      configured: Boolean(valueToSave),
      statsConnected,
      connectionStatus: statsConnected ? "connected" : "disconnected",
      resourceId: valueToSave || null,
      resourceLabel: valueToSave || null,
      resourceUrl: valueToSave || null,
    }, { clearData: !valueToSave });
    triggerChannelRefresh("site_inrcy");
    await syncSitePresenceState();
    if (valueToSave) {
      window.setTimeout(() => setSiteInrcyUrlNotice(null), 2500);
    }
  }, [normalizeSiteUrl, patchChannelConnectionLocally, siteInrcyGa4Connected, siteInrcyGscConnected, siteInrcyOwnership, siteInrcySavedUrl, siteInrcyUrl, triggerChannelRefresh]);

  const deleteSiteInrcyUrl = useCallback(async () => {
    if (siteInrcyOwnership === "none") return;
    if (!siteInrcySavedUrl.trim()) return;

    const ok = await confirmInrcy({
      title: "Supprimer le lien Site iNrCy ?",
      message: "Cette action déconnectera automatiquement Google Analytics et Google Search Console pour la bulle Site iNrCy.",
      confirmLabel: "Supprimer le lien",
      variant: "danger",
    });
    if (!ok) return;

    await disconnectAllSiteInrcyGoogleStats();

    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    const { error } = await supabase
      .from("inrcy_site_configs")
      .upsert({ user_id: resolveActiveBrowserUserId(user.id), site_url: "" }, { onConflict: "user_id" });
    if (error) {
      setSiteInrcySettingsError(getSimpleFrenchErrorMessage(error));
      return;
    }

    setSiteInrcySettingsError(null);
    setSiteInrcyUrl("");
    setSiteInrcySavedUrl("");
    setShowSiteInrcyWidgetCode(false);
    setSiteInrcyUrlNotice("✅ Lien du site supprimé. GA4 et Search Console ont été déconnectés.");
    patchChannelConnectionLocally("site_inrcy", {
      connected: false,
      accountConnected: false,
      configured: false,
      statsConnected: false,
      connectionStatus: "disconnected",
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    triggerChannelRefresh("site_inrcy");
    await syncSitePresenceState();
    window.setTimeout(() => setSiteInrcyUrlNotice(null), 2500);
  }, [disconnectAllSiteInrcyGoogleStats, patchChannelConnectionLocally, siteInrcyOwnership, siteInrcySavedUrl, triggerChannelRefresh]);

  const resetSiteInrcyAll = useCallback(async () => {
    const ok = await confirmInrcy({
      title: "Réinitialiser la configuration ?",
      message: "Cela supprimera le lien, GA4 et Search Console pour la bulle Site iNrCy.",
      confirmLabel: "Réinitialiser",
      variant: "danger",
    });
    if (!ok) return;
    if (siteInrcyOwnership === "none") return;

    await resetGoogleStats();
    await updateSiteInrcySettings({});

    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (user) {
      await supabase.from("inrcy_site_configs").upsert({ user_id: resolveActiveBrowserUserId(user.id), site_url: "" }, { onConflict: "user_id" });
    }

    setSiteInrcyUrl("");
    setSiteInrcySavedUrl("");
    setSiteInrcySettingsText("{}");
    setGa4MeasurementId("");
    setGa4PropertyId("");
    setGscProperty("");
    setSiteInrcyGa4Connected(false);
    setSiteInrcyGscConnected(false);
    patchChannelConnectionLocally("site_inrcy", {
      connected: false,
      accountConnected: false,
      configured: false,
      statsConnected: false,
      connectionStatus: "disconnected",
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    triggerChannelRefresh("site_inrcy");
  }, [patchChannelConnectionLocally, siteInrcyOwnership, triggerChannelRefresh, updateSiteInrcySettings]);

  const saveSiteInrcyActusWidgetSettings = useCallback(async () => {
    if (siteInrcyOwnership === "none") {
      setSiteInrcySettingsError("Widget indisponible : aucun site iNrCy.");
      return false;
    }
    if (!siteInrcySavedUrl.trim()) {
      setSiteInrcySettingsError("Enregistrez le lien du site iNrCy avant de générer le code du widget.");
      return false;
    }

    let parsed: any;
    try {
      parsed = siteInrcySettingsText?.trim() ? JSON.parse(siteInrcySettingsText) : {};
    } catch {
      setSiteInrcySettingsError("JSON invalide. Corrige la configuration avant de générer le widget.");
      return false;
    }

    parsed = parsed && typeof parsed === "object" ? { ...parsed } : {};
    parsed.actus_widget = {
      layout: siteInrcyActusLayout,
      limit: siteInrcyActusLimit,
      design: siteInrcyActusDesign,
      accent: siteInrcyActusAccent,
      theme: siteInrcyActusTheme,
      generated_at: new Date().toISOString(),
    };

    const ok = await updateSiteInrcySettings(parsed);
    if (!ok) return false;
    setSiteInrcyUrlNotice("✅ Widget enregistré. Code généré.");
    window.setTimeout(() => setSiteInrcyUrlNotice(null), 2500);
    return true;
  }, [siteInrcyActusAccent, siteInrcyActusDesign, siteInrcyActusLayout, siteInrcyActusLimit, siteInrcyActusTheme, siteInrcyOwnership, siteInrcySavedUrl, siteInrcySettingsText, updateSiteInrcySettings]);

  return {
    siteInrcyOwnership,
    setSiteInrcyOwnership,
    siteInrcyUrl,
    setSiteInrcyUrl,
    siteInrcySavedUrl,
    setSiteInrcySavedUrl,
    siteInrcyContactEmail,
    setSiteInrcyContactEmail,
    siteInrcySettingsText,
    setSiteInrcySettingsText,
    siteInrcySettingsError,
    setSiteInrcySettingsError,
    siteInrcyTrackingBusy,
    siteInrcyGa4Notice,
    setSiteInrcyGa4Notice,
    siteInrcyGscNotice,
    setSiteInrcyGscNotice,
    siteInrcyUrlNotice,
    widgetTokenInrcySite,
    siteInrcyActusLayout,
    setSiteInrcyActusLayout,
    siteInrcyActusLimit,
    setSiteInrcyActusLimit,
    siteInrcyActusDesign,
    setSiteInrcyActusDesign,
    siteInrcyActusAccent,
    setSiteInrcyActusAccent,
    siteInrcyActusFont,
    setSiteInrcyActusFont,
    siteInrcyActusTheme,
    setSiteInrcyActusTheme,
    showSiteInrcyWidgetCode,
    setShowSiteInrcyWidgetCode,
    siteInrcyGa4Connected,
    setSiteInrcyGa4Connected,
    siteInrcyGscConnected,
    setSiteInrcyGscConnected,
    ga4MeasurementId,
    setGa4MeasurementId,
    ga4PropertyId,
    setGa4PropertyId,
    gscProperty,
    setGscProperty,
    updateSiteInrcySettings,
    saveSiteInrcySettings,
    attachGoogleAnalytics,
    attachGoogleSearchConsole,
    connectSiteInrcyGa4,
    connectSiteInrcyGsc,
    activateSiteInrcyTracking,
    deactivateSiteInrcyTracking,
    disconnectSiteInrcyGa4,
    disconnectSiteInrcyGsc,
    saveSiteInrcyUrl,
    deleteSiteInrcyUrl,
    saveSiteInrcyActusWidgetSettings,
    resetSiteInrcyAll,
  };
}
