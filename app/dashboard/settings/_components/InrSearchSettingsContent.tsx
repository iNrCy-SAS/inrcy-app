"use client";
import type { ChannelBubbleRenderer } from "../../_components/channel-bubble.types";
import ChannelParametersDialog from "../../_components/ChannelParametersDialog";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { getLocalizedErrorMessage, getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import styles from "../../dashboard.module.css";

const INR_SEARCH_PUBLIC_ORIGIN = ((process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com").replace(/\/$/, "") === "https://inrcy.com" ? "https://app.inrcy.com" : (process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com").replace(/\/$/, ""));

function getRuntimeInrSearchOrigin() {
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    return window.location.origin;
  }
  return INR_SEARCH_PUBLIC_ORIGIN;
}

type InrSearchPublicationState = {
  allowed: boolean;
  reason:
    | "published"
    | "slug_missing"
    | "config_missing"
    | "page_disabled"
    | "bubble_disabled"
    | "subscription_inactive"
    | "profile_missing"
    | "data_unavailable";
  subscriptionStatus?: string;
};

type InrSearchSettings = {
  enabled: boolean;
  directoryEnabled: boolean;
  slug: string;
  publishedSlug: string;
  slugLocked: boolean;
  publishedAt: string | null;
  pageTitle: string;
  pageDescription: string;
  updatedAt: string | null;
  systemManaged?: boolean;
};

type InrSearchPanelSnapshot = {
  settings: InrSearchSettings;
  publication: InrSearchPublicationState;
};

type InrSearchAction = "connect" | "disconnect" | "directory";

const EMPTY_SETTINGS: InrSearchSettings = {
  enabled: false,
  directoryEnabled: false,
  slug: "",
  publishedSlug: "",
  slugLocked: false,
  publishedAt: null,
  pageTitle: "",
  pageDescription: "",
  updatedAt: null,
  systemManaged: true,
};

const INR_SEARCH_PANEL_CACHE_PREFIX = "inrcy:inr-search-panel:";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeSettings(value: unknown): InrSearchSettings {
  const source = asRecord(value);
  return {
    enabled: Boolean(source.enabled),
    directoryEnabled: Boolean(source.directoryEnabled),
    slug: String(source.slug || ""),
    publishedSlug: String(source.publishedSlug || ""),
    slugLocked: Boolean(source.slugLocked || source.publishedSlug || (source.enabled && source.slug)),
    publishedAt: typeof source.publishedAt === "string" ? source.publishedAt : null,
    pageTitle: String(source.pageTitle || ""),
    pageDescription: String(source.pageDescription || ""),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
    systemManaged: source.systemManaged !== false,
  };
}

function normalizePublication(value: unknown): InrSearchPublicationState {
  const source = asRecord(value);
  const reason = String(source.reason);
  return {
    allowed: Boolean(source.allowed),
    reason: ["published", "slug_missing", "config_missing", "page_disabled", "bubble_disabled", "subscription_inactive", "profile_missing", "data_unavailable"].includes(reason)
      ? reason as InrSearchPublicationState["reason"]
      : "data_unavailable",
    subscriptionStatus: typeof source.subscriptionStatus === "string" ? source.subscriptionStatus : undefined,
  };
}

function slugFromPublicUrl(value: string) {
  const match = value.match(/\/entreprises\/([^/?#]+)/i);
  return match?.[1] || "";
}

function readPanelSnapshot(publicUrl: string, initialConnected: boolean | null, initialDirectoryEnabled: boolean | null) {
  if (typeof window === "undefined") return null;
  const slug = slugFromPublicUrl(publicUrl);
  if (!slug) return null;

  try {
    const raw = window.sessionStorage.getItem(`${INR_SEARCH_PANEL_CACHE_PREFIX}${slug}`);
    if (raw) {
      const parsed = asRecord(JSON.parse(raw));
      const cachedSettings = normalizeSettings(parsed.settings);
      const cachedPublication = normalizePublication(parsed.publication);
      // The dashboard's confirmed connection state takes precedence over an
      // older detail cache, including immediately after an OAuth/account return.
      if (typeof initialConnected === "boolean") {
        cachedSettings.enabled = initialConnected;
        cachedPublication.allowed = initialConnected;
        cachedPublication.reason = initialConnected ? "published" : "page_disabled";
      }
      if (typeof initialDirectoryEnabled === "boolean") {
        cachedSettings.directoryEnabled = initialDirectoryEnabled;
      }
      return {
        settings: cachedSettings,
        publication: cachedPublication,
      } satisfies InrSearchPanelSnapshot;
    }
  } catch {
    // sessionStorage is only an optimization; the live request remains the source of truth.
  }

  if (typeof initialConnected === "boolean") {
    return {
      settings: {
        ...EMPTY_SETTINGS,
        enabled: initialConnected,
        directoryEnabled: initialDirectoryEnabled === true,
        slug,
        publishedSlug: slug,
        slugLocked: true,
      },
      publication: { allowed: initialConnected, reason: initialConnected ? "published" : "page_disabled" },
    } satisfies InrSearchPanelSnapshot;
  }

  return null;
}

function writePanelSnapshot(publicUrl: string, snapshot: InrSearchPanelSnapshot) {
  if (typeof window === "undefined") return;
  const slug = slugFromPublicUrl(publicUrl);
  if (!slug) return;
  try {
    window.sessionStorage.setItem(`${INR_SEARCH_PANEL_CACHE_PREFIX}${slug}`, JSON.stringify(snapshot));
  } catch {
    // sessionStorage is only an optimization.
  }
}

function emitDashboardUpdate(settings: InrSearchSettings, publicationAllowed: boolean, refresh: boolean) {
  if (typeof window === "undefined") return;
  const pageUrl = settings.slug ? `${getRuntimeInrSearchOrigin()}/entreprises/${settings.slug}` : "";
  window.dispatchEvent(new CustomEvent("inrcy:inr-search-settings-updated", {
    detail: {
      connected: Boolean(settings.enabled && settings.slug && publicationAllowed),
      profileUrl: pageUrl,
      refresh,
    },
  }));
}

type InrSearchSettingsContentProps = {
  renderBubble: ChannelBubbleRenderer;
  active?: boolean;
  initialConnected?: boolean | null;
  initialPublicUrl?: string;
  initialDirectoryEnabled?: boolean | null;
};

export default function InrSearchSettingsContent({
  renderBubble,
  active = true,
  initialConnected = null,
  initialPublicUrl = "",
  initialDirectoryEnabled = null,
}: InrSearchSettingsContentProps) {
  const i18nT = useTranslations("settings");
  const locale = useLocale();
  const localizedError = useCallback((input: unknown, fallback: string) => {
    const translated = getLocalizedErrorMessage(input, locale.slice(0, 2), fallback);
    return !locale.startsWith("fr") && translated === getSimpleFrenchErrorMessage(input, fallback) ? fallback : translated;
  }, [locale]);
  const [initialSnapshot] = useState(() => readPanelSnapshot(initialPublicUrl, initialConnected, initialDirectoryEnabled));
  const [settings, setSettings] = useState<InrSearchSettings>(() => initialSnapshot?.settings || EMPTY_SETTINGS);
  const [publication, setPublication] = useState<InrSearchPublicationState>(() => initialSnapshot?.publication || {
    allowed: initialConnected === true,
    reason: initialConnected === true ? "published" : "bubble_disabled",
  });
  const [loading, setLoading] = useState(() => !initialSnapshot && initialConnected === null);
  const [actionLoading, setActionLoading] = useState(false);
  const [, setFeedbackAction] = useState<InrSearchAction | null>(null);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const requestSeqRef = useRef(0);
  const mutationRef = useRef<object | null>(null);
  const lastLoadStartedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const [initialLoadBlocking] = useState(() => !initialSnapshot && initialConnected === null);

  const applySnapshot = useCallback((payload: Record<string, unknown>, refresh: boolean) => {
    const next = normalizeSettings(payload.inrSearch);
    const nextPublication = normalizePublication(payload.publication);
    setSettings(next);
    setPublication(nextPublication);
    writePanelSnapshot(
      next.slug ? `${INR_SEARCH_PUBLIC_ORIGIN}/entreprises/${next.slug}` : "",
      { settings: next, publication: nextPublication },
    );
    emitDashboardUpdate(next, nextPublication.allowed, refresh);
  }, []);

  const load = useCallback(({ blocking = false }: { blocking?: boolean } = {}) => {
    if (mutationRef.current) return Promise.resolve();
    if (loadInFlightRef.current) return loadInFlightRef.current;

    const requestSeq = ++requestSeqRef.current;
    const accountId = getActiveBrowserUserId();
    const isCurrent = () => mountedRef.current && requestSeq === requestSeqRef.current && accountId === getActiveBrowserUserId();
    lastLoadStartedAtRef.current = Date.now();
    const request = (async () => {
      if (blocking && mountedRef.current) setLoading(true);
      if (mountedRef.current) setError(null);
      try {
        const response = await fetch("/api/inr-search/settings", { cache: "no-store", credentials: "include" });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || i18nT("search_load_failed"));

        if (!isCurrent()) return;
        applySnapshot(payload, false);
      } catch (err) {
        if (isCurrent()) {
          setError(localizedError(err, i18nT("search_page_load_failed")));
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();

    loadInFlightRef.current = request;
    void request.finally(() => {
      if (loadInFlightRef.current === request) loadInFlightRef.current = null;
    });
    return request;
  }, [applySnapshot, i18nT, localizedError]);

  useEffect(() => {
    const requestSequence = requestSeqRef;
    mountedRef.current = true;
    void load({ blocking: initialLoadBlocking });
    return () => {
      mountedRef.current = false;
      requestSequence.current++;
      loadInFlightRef.current = null;
      mutationRef.current = null;
    };
  }, [initialLoadBlocking, load]);

  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastLoadStartedAtRef.current >= 30_000
      ) {
        void load();
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, load]);

  const isPublished = Boolean(settings.enabled && settings.slug && publication.allowed);
  const hasPage = Boolean(settings.slug);

  const performAction = useCallback(async (action: InrSearchAction, enabled?: boolean) => {
    if (!mountedRef.current || mutationRef.current) return;
    const mutation = {};
    const accountId = getActiveBrowserUserId();
    mutationRef.current = mutation;
    requestSeqRef.current++;
    loadInFlightRef.current = null;
    const isCurrent = () => mountedRef.current && mutationRef.current === mutation && accountId === getActiveBrowserUserId();
    setActionLoading(true);
    setFeedbackAction(action);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/inr-search/settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "directory" ? { enabled } : {}) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || i18nT("search_update_failed"));
      if (!isCurrent()) return;
      // POST returns the persisted state; reusing a GET started before this
      // action would restore the previous connection or directory setting.
      applySnapshot(payload, true);
      const directoryWarning = payload?.directoryCache?.ok === false
        ? i18nT("search_directory_delayed")
        : "";
      setSuccess(
        action === "connect"
          ? i18nT("search_connected")
          : action === "disconnect"
            ? i18nT("search_disconnected")
            : enabled
              ? i18nT("search_directory_visible")
              : i18nT("search_directory_hidden"),
      );
      if (directoryWarning) setError(directoryWarning);
    } catch (err) {
      if (isCurrent()) setError(localizedError(err, i18nT("search_page_update_failed")));
    } finally {
      if (isCurrent()) {
        setActionLoading(false);
        setLoading(false);
      }
      if (mutationRef.current === mutation) mutationRef.current = null;
    }
  }, [applySnapshot, i18nT, localizedError]);

  const publicationLabel = loading
    ? i18nT("synchronisation_cc8ad3ae")
    : isPublished
      ? i18nT("search_published")
      : hasPage && settings.enabled
        ? i18nT("search_pending")
        : i18nT("search_disconnected_status");
  const publicationMessage = !settings.enabled && hasPage
    ? i18nT("search_not_public")
    : publication.reason === "subscription_inactive"
    ? i18nT("search_subscription_inactive")
    : publication.reason === "bubble_disabled"
      ? i18nT("search_disabled")
      : publication.reason === "profile_missing"
        ? i18nT("search_profile_pending")
        : publication.reason === "slug_missing" || publication.reason === "config_missing"
          ? i18nT("search_creating")
          : publication.reason === "data_unavailable"
            ? i18nT("search_sync_retry")
            : isPublished
              ? i18nT("search_live_explainer")
              : i18nT("search_auto_sync");

  const parameters = <section style={{ display: "grid", gap: 16, color: "#d4e0f5", lineHeight: 1.7 }}>
    <h2 style={{ margin: 0, color: "white", fontSize: 25 }}>{i18nT("a_quoi_sert_inr_apos_search_c32318a6")}</h2>
    <p style={{ margin: 0 }}><strong>{i18nT("search_intro")}</strong></p>
    <p style={{ margin: 0 }}>{i18nT("search_explainer")}</p>
    <p style={{ margin: 0 }}>{i18nT("search_evolves")}</p>
    <p style={{ margin: 0, fontSize: 13, color: "#aebed8" }}>{publicationLabel} — {publicationMessage}</p>
  </section>;
  return <>
    {renderBubble({
      accountConnected: isPublished,
      resourceLabel: settings.slug,
      onConnect: () => performAction("connect"),
      onDisconnect: () => setDisconnectConfirmOpen(true),
      loading,
      busy: actionLoading,
      error,
      notice: success,
      parameters,
      parametersOwnHeading: true,
      parametersLabel: i18nT("search_information"),
      parametersIcon: "info",
      parametersAlwaysVisible: true,
    })}
    {disconnectConfirmOpen ? (
      <ChannelParametersDialog name="iNr’Search" onClose={() => setDisconnectConfirmOpen(false)}>
        <p>{i18nT("search_disconnect_confirm")}</p>
        <button type="button" className={styles.actionBtn} onClick={() => {
          setDisconnectConfirmOpen(false);
          void performAction("disconnect");
        }}>{i18nT("deconnecter_quand_meme_dcf686d8")}</button>
      </ChannelParametersDialog>
    ) : null}
  </>;
}
