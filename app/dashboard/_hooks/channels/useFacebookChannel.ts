"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { getClientUserFacingApiError as getSimpleFrenchApiError, getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import {
  DEFAULT_FACEBOOK_PUBLICATION_PREFERENCES,
  normalizeFacebookPublicationPreferences,
  type FacebookPublicationPreferences,
} from "@/lib/facebookPublicationPreferences";
import type { ChannelResourcePhase } from "./channelResourcePhase";

type PatchChannelConnectionLocally = (
  channel: DashboardChannelKey,
  patch: Partial<InrstatsChannelBlock["connection"]>,
  options?: { clearData?: boolean; clearError?: boolean },
) => void;

type TriggerChannelRefresh = (channel: DashboardChannelKey) => Promise<void>;

type UpdateRootSettingsKey = (key: "gmb" | "facebook" | "instagram" | "linkedin", nextObj: any) => Promise<void>;

type UseFacebookChannelOptions = {
  initialState?: Record<string, any> | null;
  panel: string | null;
  searchParams: { get(name: string): string | null };
  patchChannelConnectionLocally: PatchChannelConnectionLocally;
  triggerChannelRefresh: TriggerChannelRefresh;
  updateRootSettingsKey: UpdateRootSettingsKey;
};

export function useFacebookChannel({
  initialState,
  panel,
  searchParams,
  patchChannelConnectionLocally,
  triggerChannelRefresh,
}: UseFacebookChannelOptions) {
  const initialConnected = initialState?.facebookPageConnected === true;
  const initialStatus = initialState?.facebookConnectionStatus;
  const [facebookUrl, setFacebookUrl] = useState<string>(() => typeof initialState?.facebookUrl === "string" ? initialState.facebookUrl : "");
  const [facebookAccountConnected, setFacebookAccountConnected] = useState<boolean>(initialState?.facebookAccountConnected === true);
  const [facebookPageConnected, setFacebookPageConnected] = useState<boolean>(initialConnected);
  const [facebookConnectionStatus, setFacebookConnectionStatus] = useState<"connected" | "disconnected" | "needs_update">(() => (
    initialStatus === "connected" || initialStatus === "needs_update" || initialStatus === "disconnected"
      ? initialStatus
      : initialConnected ? "connected" : "disconnected"
  ));
  const [facebookAccountEmail, setFacebookAccountEmail] = useState<string>(() => typeof initialState?.facebookAccountEmail === "string" ? initialState.facebookAccountEmail : "");
  const [facebookUrlNotice, setFacebookUrlNotice] = useState<string | null>(null);
  const [facebookUrlError, setFacebookUrlError] = useState<string | null>(null);
  const [facebookPublicationPreferences, setFacebookPublicationPreferences] =
    useState<FacebookPublicationPreferences>(() =>
      normalizeFacebookPublicationPreferences(
        initialState?.facebookPublicationPreferences ||
          DEFAULT_FACEBOOK_PUBLICATION_PREFERENCES,
      ),
    );
  const [facebookPublicationPreferencesLoading, setFacebookPublicationPreferencesLoading] =
    useState(false);
  const [facebookPublicationPreferencesSaving, setFacebookPublicationPreferencesSaving] =
    useState(false);
  const [facebookPublicationPreferencesNotice, setFacebookPublicationPreferencesNotice] =
    useState<string | null>(null);
  const [facebookPublicationPreferencesError, setFacebookPublicationPreferencesError] =
    useState<string | null>(null);

  const [fbPages, setFbPages] = useState<Array<{ id: string; name?: string }>>([]);
  const [fbPagesLoading, setFbPagesLoading] = useState(false);
  const [fbPagesPhase, setFbPagesPhase] = useState<ChannelResourcePhase>("idle");
  const [fbSelectedPageId, setFbSelectedPageId] = useState<string>(() => typeof initialState?.fbSelectedPageId === "string" ? initialState.fbSelectedPageId : "");
  const [fbSelectedPageName, setFbSelectedPageName] = useState<string>(() => typeof initialState?.fbSelectedPageName === "string" ? initialState.fbSelectedPageName : "");
  const [fbPagesError, setFbPagesError] = useState<string | null>(null);
  const fbPagesAutoLoadRef = useRef(false);

  const connectionRevisionRef = useRef(0);

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

  const loadFacebookPublicationPreferences = useCallback(async () => {
    setFacebookPublicationPreferencesLoading(true);
    setFacebookPublicationPreferencesError(null);
    try {
      const response = await fetch(
        "/api/integrations/facebook/publication-preferences",
        { cache: "no-store", credentials: "include" },
      );
      if (!response.ok) {
        throw new Error(
          await getSimpleFrenchApiError(
            response,
            "Impossible de charger les formats Facebook.",
          ),
        );
      }
      const payload = await response.json().catch(() => null);
      setFacebookPublicationPreferences(
        normalizeFacebookPublicationPreferences(payload?.preferences),
      );
    } catch (error) {
      setFacebookPublicationPreferencesError(
        getSimpleFrenchErrorMessage(
          error,
          "Impossible de charger les formats Facebook.",
        ),
      );
    } finally {
      setFacebookPublicationPreferencesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (panel !== "facebook") return;
    void loadFacebookPublicationPreferences();
  }, [panel, loadFacebookPublicationPreferences]);

  const updateFacebookPublicationPreferences = useCallback(
    (patch: Partial<FacebookPublicationPreferences>) => {
      setFacebookPublicationPreferences((current) =>
        normalizeFacebookPublicationPreferences({ ...current, ...patch }),
      );
      setFacebookPublicationPreferencesNotice(null);
      setFacebookPublicationPreferencesError(null);
    },
    [],
  );

  const saveFacebookPublicationPreferences = useCallback(async (patch?: Partial<FacebookPublicationPreferences>) => {
    if (facebookPublicationPreferencesSaving) return false;
    const previous = facebookPublicationPreferences;
    const nextPreferences = normalizeFacebookPublicationPreferences({ ...previous, ...patch });
    if (patch) setFacebookPublicationPreferences(nextPreferences);
    setFacebookPublicationPreferencesSaving(true);
    setFacebookPublicationPreferencesNotice(null);
    setFacebookPublicationPreferencesError(null);
    try {
      const response = await fetch(
        "/api/integrations/facebook/publication-preferences",
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextPreferences),
        },
      );
      if (!response.ok) {
        throw new Error(
          await getSimpleFrenchApiError(
            response,
            "Impossible d’enregistrer les formats Facebook.",
          ),
        );
      }
      const payload = await response.json().catch(() => null);
      setFacebookPublicationPreferences(
        normalizeFacebookPublicationPreferences(payload?.preferences),
      );
      setFacebookPublicationPreferencesNotice("Formats Facebook enregistrés.");
      return true;
    } catch (error) {
      if (patch) setFacebookPublicationPreferences(previous);
      setFacebookPublicationPreferencesError(
        getSimpleFrenchErrorMessage(
          error,
          "Impossible d’enregistrer les formats Facebook.",
        ),
      );
      return false;
    } finally {
      setFacebookPublicationPreferencesSaving(false);
    }
  }, [facebookPublicationPreferences, facebookPublicationPreferencesSaving]);

  const connectFacebookAccount = useCallback(async () => {
    const returnTo = encodeURIComponent("/dashboard?panel=facebook");
    window.location.href = `/api/integrations/facebook/start?returnTo=${returnTo}&mode=standard`;
  }, []);

  const connectFacebookBusinessAccount = useCallback(async () => {
    const returnTo = encodeURIComponent("/dashboard?panel=facebook");
    window.location.href = `/api/integrations/facebook/start?returnTo=${returnTo}&mode=business`;
  }, []);

  const disconnectFacebookAccount = useCallback(async () => {
    const accountScope = getActiveBrowserUserId();
    connectionRevisionRef.current += 1;
    setFbPagesLoading(false);
    setFbPagesPhase("idle");
    const response = await fetch("/api/integrations/facebook/disconnect-account", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (accountScope !== getActiveBrowserUserId()) return false;
    if (!response || !response.ok || payload?.ok !== true) {
      setPanelError(payload?.error, "Impossible de déconnecter le compte Facebook.");
      return false;
    }
    setFacebookAccountConnected(false);
    connectionRevisionRef.current += 1;
    setFacebookConnectionStatus("disconnected");
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
    void triggerChannelRefresh("facebook").catch(() => {});
    setFacebookUrl("");
    setFbPages([]);
    setFbSelectedPageId("");
    setFbSelectedPageName("");
    setFbPagesPhase("idle");
    setPanelSuccess("Compte Facebook déconnecté.");
    return true;
  }, [patchChannelConnectionLocally, triggerChannelRefresh, setPanelError, setPanelSuccess]);

  const disconnectFacebookPage = useCallback(async () => {
    const accountScope = getActiveBrowserUserId();
    connectionRevisionRef.current += 1;
    setFbPagesLoading(false);
    setFbPagesPhase("idle");
    const response = await fetch("/api/integrations/facebook/disconnect-page", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (accountScope !== getActiveBrowserUserId()) return false;
    if (!response || !response.ok || payload?.ok !== true) {
      setPanelError(payload?.error, "Impossible de déconnecter la page Facebook.");
      return false;
    }
    connectionRevisionRef.current += 1;
    setFacebookConnectionStatus("disconnected");
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
    void triggerChannelRefresh("facebook").catch(() => {});
    setFacebookUrl("");
    setFbSelectedPageId("");
    setFbSelectedPageName("");
    setFbPagesPhase("idle");
    setPanelSuccess("Page Facebook déconnectée.");
    return true;
  }, [patchChannelConnectionLocally, triggerChannelRefresh, setPanelError, setPanelSuccess]);

  const loadFacebookPages = useCallback(async (options?: { autoSelect?: boolean }) => {
    if (!facebookAccountConnected) return;
    setFbPagesLoading(true);
    setFbPagesPhase("searching");
    setFbPagesError(null);
    const revision = connectionRevisionRef.current;
    const accountScope = getActiveBrowserUserId();
    try {
      const r = await fetch("/api/integrations/facebook/pages", { cache: "no-store" });
      if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Impossible de charger vos pages Facebook."));
      const j = await r.json().catch(() => ({}));
      if (revision !== connectionRevisionRef.current || accountScope !== getActiveBrowserUserId()) return;
      const pages = Array.isArray(j.pages) ? j.pages : [];
      setFbPages(pages);
      if (options?.autoSelect === false) return;

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
          if (revision !== connectionRevisionRef.current || accountScope !== getActiveBrowserUserId()) return;
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
          void triggerChannelRefresh("facebook").catch(() => {});
          setPanelSuccess("Page Facebook enregistrée.");
          return true;
        }
      }
    } catch (e: any) {
      if (revision !== connectionRevisionRef.current || accountScope !== getActiveBrowserUserId()) return;
      setFbPagesError(getSimpleFrenchErrorMessage(e, "Impossible de charger vos pages Facebook."));
    } finally {
      if (revision === connectionRevisionRef.current && accountScope === getActiveBrowserUserId()) {
        setFbPagesLoading(false);
        setFbPagesPhase("idle");
      }
    }
  }, [facebookAccountConnected, fbSelectedPageId, facebookAccountEmail, patchChannelConnectionLocally, setPanelSuccess, triggerChannelRefresh]);

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

  const saveFacebookPage = useCallback(async (selectedPageId = fbSelectedPageId) => {
    const revision = connectionRevisionRef.current;
    const accountScope = getActiveBrowserUserId();
    const picked = fbPages.find((p) => p.id === selectedPageId);
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
    if (revision !== connectionRevisionRef.current || accountScope !== getActiveBrowserUserId()) return false;
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
      void triggerChannelRefresh("facebook").catch(() => {});
      setPanelSuccess("Page Facebook enregistrée.");
      setFbSelectedPageId(selectedPageId);
      return true;
    } else {
      setPanelError(j?.error, "Impossible d'enregistrer la page Facebook.");
      return false;
    }
  }, [fbPages, fbSelectedPageId, facebookAccountEmail, patchChannelConnectionLocally, triggerChannelRefresh, setPanelSuccess, setPanelError]);

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
    facebookPublicationPreferences,
    facebookPublicationPreferencesLoading,
    facebookPublicationPreferencesSaving,
    facebookPublicationPreferencesNotice,
    facebookPublicationPreferencesError,
    updateFacebookPublicationPreferences,
    saveFacebookPublicationPreferences,
    loadFacebookPublicationPreferences,
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
