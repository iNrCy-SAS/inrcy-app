"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getClientUserFacingApiError as getSimpleFrenchApiError, getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import type { ChannelResourcePhase } from "./channelResourcePhase";

type PatchChannelConnectionLocally = (
  channel: DashboardChannelKey,
  patch: Partial<InrstatsChannelBlock["connection"]>,
  options?: { clearData?: boolean; clearError?: boolean },
) => void;

type TriggerChannelRefresh = (channel: DashboardChannelKey) => Promise<void>;

type UpdateRootSettingsKey = (key: "gmb" | "facebook" | "instagram" | "linkedin", nextObj: any) => Promise<void>;

type UseFacebookChannelOptions = {
  panel: string | null;
  searchParams: { get(name: string): string | null };
  patchChannelConnectionLocally: PatchChannelConnectionLocally;
  triggerChannelRefresh: TriggerChannelRefresh;
  updateRootSettingsKey: UpdateRootSettingsKey;
};

export function useFacebookChannel({
  panel,
  searchParams,
  patchChannelConnectionLocally,
  triggerChannelRefresh,
  updateRootSettingsKey,
}: UseFacebookChannelOptions) {
  const [facebookUrl, setFacebookUrl] = useState<string>("");
  const [facebookAccountConnected, setFacebookAccountConnected] = useState<boolean>(false);
  const [facebookPageConnected, setFacebookPageConnected] = useState<boolean>(false);
  const [facebookConnectionStatus, setFacebookConnectionStatus] = useState<"connected" | "disconnected" | "needs_update">("disconnected");
  const [facebookAccountEmail, setFacebookAccountEmail] = useState<string>("");
  const [facebookUrlNotice, setFacebookUrlNotice] = useState<string | null>(null);
  const [facebookUrlError, setFacebookUrlError] = useState<string | null>(null);

  const [fbPages, setFbPages] = useState<Array<{ id: string; name?: string; access_token?: string }>>([]);
  const [fbPagesLoading, setFbPagesLoading] = useState(false);
  const [fbPagesPhase, setFbPagesPhase] = useState<ChannelResourcePhase>("idle");
  const [fbSelectedPageId, setFbSelectedPageId] = useState<string>("");
  const [fbSelectedPageName, setFbSelectedPageName] = useState<string>("");
  const [fbPagesError, setFbPagesError] = useState<string | null>(null);
  const fbPagesAutoLoadRef = useRef(false);

  const clearPanelNotices = useCallback(() => {
    setFacebookUrlNotice(null);
    setFacebookUrlError(null);
  }, []);

  const setPanelSuccess = useCallback((message: string, timeout = 2200) => {
    clearPanelNotices();
    const clean = message.trim();
    setFacebookUrlNotice(clean);
    window.setTimeout(clearPanelNotices, timeout);
  }, [clearPanelNotices]);

  const setPanelError = useCallback((input: unknown, fallback: string, timeout = 3200) => {
    clearPanelNotices();
    const clean = getSimpleFrenchErrorMessage(input, fallback);
    setFacebookUrlError(clean);
    window.setTimeout(clearPanelNotices, timeout);
  }, [clearPanelNotices]);

  const connectFacebookAccount = useCallback(async () => {
    const returnTo = encodeURIComponent("/dashboard?panel=facebook");
    window.location.href = `/api/integrations/facebook/start?returnTo=${returnTo}&mode=standard`;
  }, []);

  const connectFacebookBusinessAccount = useCallback(async () => {
    const returnTo = encodeURIComponent("/dashboard?panel=facebook");
    window.location.href = `/api/integrations/facebook/start?returnTo=${returnTo}&mode=business`;
  }, []);

  const disconnectFacebookAccount = useCallback(async () => {
    const response = await fetch("/api/integrations/facebook/disconnect-account", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok || payload?.ok === false) {
      setPanelError(payload?.error, "Impossible de déconnecter le compte Facebook.");
      return;
    }
    setFacebookAccountConnected(false);
    setFacebookPageConnected(false);
    patchChannelConnectionLocally("facebook", {
      connected: false,
      accountConnected: false,
      configured: false,
      expired: false,
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    setFacebookAccountEmail("");
    await updateRootSettingsKey("facebook", {
      accountConnected: false,
      pageConnected: false,
      userEmail: "",
      url: "",
      pageId: "",
      pageName: "",
    });
    await triggerChannelRefresh("facebook");
    setFacebookUrl("");
    setFbPages([]);
    setFbSelectedPageId("");
    setFbSelectedPageName("");
    setFbPagesPhase("idle");
    setPanelSuccess("Compte Facebook déconnecté.");
  }, [patchChannelConnectionLocally, updateRootSettingsKey, triggerChannelRefresh, setPanelError, setPanelSuccess]);

  const disconnectFacebookPage = useCallback(async () => {
    const response = await fetch("/api/integrations/facebook/disconnect-page", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok || payload?.ok === false) {
      setPanelError(payload?.error, "Impossible de déconnecter la page Facebook.");
      return;
    }
    setFacebookPageConnected(false);
    patchChannelConnectionLocally("facebook", {
      connected: false,
      accountConnected: true,
      configured: false,
      expired: false,
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    await updateRootSettingsKey("facebook", {
      accountConnected: true,
      pageConnected: false,
      url: "",
      pageId: "",
      pageName: "",
    });
    await triggerChannelRefresh("facebook");
    setFacebookUrl("");
    setFbSelectedPageId("");
    setFbSelectedPageName("");
    setFbPagesPhase("idle");
    setPanelSuccess("Page Facebook déconnectée.");
  }, [patchChannelConnectionLocally, updateRootSettingsKey, triggerChannelRefresh, setPanelError, setPanelSuccess]);

  const loadFacebookPages = useCallback(async () => {
    if (!facebookAccountConnected) return;
    setFbPagesLoading(true);
    setFbPagesPhase("searching");
    setFbPagesError(null);
    try {
      const r = await fetch("/api/integrations/facebook/pages", { cache: "no-store" });
      if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Impossible de charger vos pages Facebook."));
      const j = await r.json().catch(() => ({}));
      const pages = Array.isArray(j.pages) ? j.pages : [];
      setFbPages(pages);

      const matchedSelected = pages.find((p: { id: string; name?: string | null }) => p.id === fbSelectedPageId);
      if (matchedSelected?.name) setFbSelectedPageName(String(matchedSelected.name));

      if (!fbSelectedPageId && pages?.[0]?.id) {
        setFbSelectedPageId(pages[0].id);
        if (pages[0]?.name) setFbSelectedPageName(String(pages[0].name));
      }

      if (pages.length === 1) {
        const only = pages[0];
        if (only?.id) {
          setFbPagesPhase("connecting");
          const autoRes = await fetch("/api/integrations/facebook/select-page", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pageId: only.id,
              pageName: only.name || null,
            }),
          });
          const autoJson = await autoRes.json().catch(() => ({}));
          if (!autoRes.ok) throw new Error(autoJson?.error || "Impossible d’enregistrer la page Facebook.");
          const nextFacebookUrl = String(autoJson?.pageUrl || `https://www.facebook.com/${only.id}`);
          setFbSelectedPageId(only.id);
          setFbSelectedPageName(String(only.name || ""));
          setFacebookPageConnected(true);
          setFacebookUrl(nextFacebookUrl);
          patchChannelConnectionLocally("facebook", {
            connected: true,
            accountConnected: true,
            configured: true,
            resourceId: only.id,
            resourceLabel: only.name || null,
            resourceUrl: nextFacebookUrl,
          });
          await updateRootSettingsKey("facebook", {
            accountConnected: true,
            pageConnected: true,
            userEmail: facebookAccountEmail,
            url: nextFacebookUrl,
            pageId: only.id,
            pageName: String(only.name || ""),
          });
          await triggerChannelRefresh("facebook");
          setPanelSuccess("Page Facebook enregistrée.");
      return true;
        }
      }
    } catch (e: any) {
      setFbPagesError(getSimpleFrenchErrorMessage(e, "Impossible de charger vos pages Facebook."));
    } finally {
      setFbPagesLoading(false);
      setFbPagesPhase("idle");
    }
  }, [facebookAccountConnected, fbSelectedPageId, facebookAccountEmail, patchChannelConnectionLocally, setPanelSuccess, triggerChannelRefresh, updateRootSettingsKey]);

  useEffect(() => {
    const linked = searchParams.get("linked");
    const ok = searchParams.get("ok");
    const shouldAutoLoad = panel === "facebook" && linked === "facebook" && ok === "1";

    if (!shouldAutoLoad) {
      fbPagesAutoLoadRef.current = false;
      return;
    }

    if (!facebookAccountConnected || facebookPageConnected || fbPagesLoading || fbPagesAutoLoadRef.current) return;

    fbPagesAutoLoadRef.current = true;
    void loadFacebookPages();
  }, [
    panel,
    searchParams,
    facebookAccountConnected,
    facebookPageConnected,
    fbPagesLoading,
    loadFacebookPages,
  ]);

  const saveFacebookPage = useCallback(async () => {
    const picked = fbPages.find((p) => p.id === fbSelectedPageId);
    if (!picked?.id) return false;

    const r = await fetch("/api/integrations/facebook/select-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageId: picked.id,
        pageName: picked.name || null,
      }),
    });

    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const nextFacebookUrl = String(j?.pageUrl || `https://www.facebook.com/${picked.id}`);
      setFacebookUrl(nextFacebookUrl);
      setFacebookPageConnected(true);
      setFbSelectedPageName(picked.name || "");
      patchChannelConnectionLocally("facebook", {
        connected: true,
        accountConnected: true,
        configured: true,
        resourceId: picked.id,
        resourceLabel: picked.name || null,
        resourceUrl: nextFacebookUrl,
      });
      await updateRootSettingsKey("facebook", {
        accountConnected: true,
        pageConnected: true,
        userEmail: facebookAccountEmail,
        url: nextFacebookUrl,
        pageId: picked.id,
        pageName: String(picked.name || ""),
      });
      await triggerChannelRefresh("facebook");
      setPanelSuccess("Page Facebook enregistrée.");
      return true;
    } else {
      setPanelError(j?.error, "Impossible d'enregistrer la page Facebook.");
      return false;
    }
  }, [fbPages, fbSelectedPageId, facebookAccountEmail, patchChannelConnectionLocally, triggerChannelRefresh, updateRootSettingsKey, setPanelSuccess, setPanelError]);

  return {
    facebookUrl,
    setFacebookUrl,
    facebookAccountConnected,
    setFacebookAccountConnected,
    facebookPageConnected,
    setFacebookPageConnected,
    facebookConnectionStatus,
    setFacebookConnectionStatus,
    facebookAccountEmail,
    setFacebookAccountEmail,
    facebookUrlNotice,
    facebookUrlError,
    fbPages,
    setFbPages,
    fbPagesLoading,
    fbPagesPhase,
    fbSelectedPageId,
    setFbSelectedPageId,
    fbSelectedPageName,
    setFbSelectedPageName,
    fbPagesError,
    connectFacebookAccount,
    connectFacebookBusinessAccount,
    disconnectFacebookAccount,
    disconnectFacebookPage,
    loadFacebookPages,
    saveFacebookPage,
    clearPanelNotices,
    setPanelSuccess,
    setPanelError,
  };
}
