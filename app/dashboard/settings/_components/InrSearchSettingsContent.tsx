"use client";
import type { ChannelBubbleRenderer } from "../../_components/channel-bubble.types";
import ChannelParametersDialog from "../../_components/ChannelParametersDialog";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import styles from "../../dashboard.module.css";
import localStyles from "./InrSearchSettingsContent.module.css";
import StatusMessage from "../../_components/StatusMessage";

const INR_SEARCH_PUBLIC_ORIGIN = ((process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com").replace(/\/$/, "") === "https://inrcy.com" ? "https://app.inrcy.com" : (process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com").replace(/\/$/, ""));
const INR_SEARCH_DIRECTORY_URL = "https://inrcy.com/annuaire/";

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
      directoryEnabled: Boolean(settings.enabled && settings.directoryEnabled && publicationAllowed),
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
  const [initialSnapshot] = useState(() => readPanelSnapshot(initialPublicUrl, initialConnected, initialDirectoryEnabled));
  const [settings, setSettings] = useState<InrSearchSettings>(() => initialSnapshot?.settings || EMPTY_SETTINGS);
  const [publication, setPublication] = useState<InrSearchPublicationState>(() => initialSnapshot?.publication || {
    allowed: initialConnected === true,
    reason: initialConnected === true ? "published" : "bubble_disabled",
  });
  const [loading, setLoading] = useState(() => !initialSnapshot && initialConnected === null);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackAction, setFeedbackAction] = useState<InrSearchAction | null>(null);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const requestSeqRef = useRef(0);
  const mutationRef = useRef<object | null>(null);
  const lastLoadStartedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const [initialLoadBlocking] = useState(() => !initialSnapshot && initialConnected === null);

  const publicUrl = useMemo(
    () => settings.slug ? `${INR_SEARCH_PUBLIC_ORIGIN}/entreprises/${settings.slug}` : "",
    [settings.slug],
  );

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
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Chargement impossible.");

        if (!isCurrent()) return;
        applySnapshot(payload, false);
      } catch (err) {
        if (isCurrent()) {
          setError(err instanceof Error ? err.message : "Chargement de la page iNr'Search impossible.");
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
  }, [applySnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    void load({ blocking: initialLoadBlocking });
    return () => {
      mountedRef.current = false;
      requestSeqRef.current++;
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
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Mise à jour impossible.");
      if (!isCurrent()) return;
      // POST returns the persisted state; reusing a GET started before this
      // action would restore the previous connection or directory setting.
      applySnapshot(payload, true);
      const directoryWarning = payload?.directoryCache?.ok === false
        ? String(payload.directoryCache.warning || "L’annuaire public n’a pas pu être actualisé immédiatement.")
        : "";
      setSuccess(
        action === "connect"
          ? "Votre page iNr’Search est maintenant connectée."
          : action === "disconnect"
            ? "Votre page iNr’Search est déconnectée."
            : enabled
              ? "Votre page est maintenant visible dans l’annuaire iNrCy."
              : "Votre page reste publique, mais elle n’est plus proposée dans l’annuaire.",
      );
      if (directoryWarning) setError(directoryWarning);
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : "Mise à jour iNr’Search impossible.");
    } finally {
      if (isCurrent()) {
        setActionLoading(false);
        setLoading(false);
      }
      if (mutationRef.current === mutation) mutationRef.current = null;
    }
  }, [applySnapshot]);

  const publicationLabel = loading
    ? "Synchronisation…"
    : isPublished
      ? "Page publiée"
      : hasPage && settings.enabled
        ? "Page en attente"
        : "Page déconnectée";
  const publicationMessage = !settings.enabled && hasPage
    ? "La page est déconnectée : elle n’est plus accessible publiquement ni proposée dans l’annuaire."
    : publication.reason === "subscription_inactive"
    ? "La page est temporairement retirée du web tant que l’abonnement iNrCy n’est pas actif."
    : publication.reason === "bubble_disabled"
      ? "La page est désactivée à distance par iNrCy."
      : publication.reason === "profile_missing"
        ? "La page attend la synchronisation du profil principal."
        : publication.reason === "slug_missing" || publication.reason === "config_missing"
          ? "La page est en cours de création automatique."
          : publication.reason === "data_unavailable"
            ? "La page est en cours de synchronisation. Actualisez dans quelques secondes."
            : isPublished
              ? "La page est publiée, mise à jour automatiquement et signalée aux moteurs lors des nouvelles publications."
              : "La page est en cours de synchronisation automatique.";

  const parameters = (
    <div className={localStyles.root}>
      <div className={localStyles.feedbackStack}>
        {error && feedbackAction !== "directory" ? <StatusMessage variant="error">{error}</StatusMessage> : null}
        {success && feedbackAction !== "directory" ? <StatusMessage variant="success">{success}</StatusMessage> : null}
      </div>

      <section data-channel-settings-step className={`${localStyles.stepCard} ${localStyles.stepDirectory}`} aria-labelledby="inrsearch-directory-title">
        <span className={localStyles.stepAccent} aria-hidden="true" />
        <header className={localStyles.stepHeader} data-channel-settings-header>
          <div className={localStyles.stepIdentity}>
            <div className={localStyles.stepCopy}>
              <h2 id="inrsearch-directory-title" className={localStyles.stepTitle}>{i18nT("annuaire_public_inrcy_8ec958c2")}</h2>
              <p className={`${localStyles.stepDescription} ${localStyles.muted}`}>{i18nT("choisissez_si_votre_page_publique_doit_d0eb00aa")}</p>
            </div>
          </div>
          <span className={localStyles.directoryState} data-active={settings.directoryEnabled && isPublished ? "true" : "false"}>
            {settings.directoryEnabled && isPublished ? i18nT("visible_dans_l_annuaire_855615a9") : i18nT("hors_annuaire_ca958aad")}
          </span>
        </header>

        <button
          className={localStyles.directoryButton}
          type="button"
          disabled={!isPublished || actionLoading}
          aria-pressed={Boolean(settings.directoryEnabled && isPublished)}
          onClick={() => void performAction("directory", !settings.directoryEnabled)}
        >
          <span className={localStyles.directoryCopy}>
            <strong>{settings.directoryEnabled && isPublished ? i18nT("page_ajoutee_a_l_annuaire_inrcy_923e3fdf") : i18nT("ajouter_ma_page_a_l_annuaire_73afcfce")}</strong>
            <span>{isPublished ? i18nT("vous_pouvez_modifier_ce_choix_a_0a54d038") : i18nT("connectez_d_abord_votre_page_inr_4855e41c")}</span>
          </span>
          <span className={localStyles.switchTrack} data-active={settings.directoryEnabled && isPublished ? "true" : "false"} aria-hidden="true">
            <span className={localStyles.switchThumb} />
          </span>
        </button>

        {feedbackAction === "directory" && actionLoading ? (
          <div role="status" aria-live="polite" className={localStyles.inlineFeedback}>{i18nT("mise_a_jour_de_votre_presence_75bb2ade")}</div>
        ) : null}
        {feedbackAction === "directory" && error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
        {feedbackAction === "directory" && success ? <StatusMessage variant="success">{success}</StatusMessage> : null}

        <div className={localStyles.directoryLinkRow}>
          <span>Annuaire public iNrCy</span>
          <a className={`${styles.ghostBtn} ${localStyles.secondaryAction}`} href={INR_SEARCH_DIRECTORY_URL} target="_blank" rel="noreferrer">Voir l’annuaire</a>
        </div>
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", color: "#c4d9ff" }}>{i18nT("a_quoi_sert_inr_apos_search_c32318a6")}</summary>
          <p>{publicationLabel} — {publicationMessage}</p>
          <p>{i18nT("inr_apos_search_transforme_automatiquement_les_99deb0af")}</p>
          <div className={localStyles.helperGrid}>
            {[["Référencement", "Titre, description, adresse et données structurées."], ["Moteurs IA", "Synthèse factuelle et source publique dédiée."], ["Activité", "Métier, prestations, clientèle et zones d’intervention."], ["Preuves", "Logo, photos, réalisations et publications disponibles."], ["iNr’Guide", "Réponses générées à partir des informations confirmées."], ["Conversion", "Téléphone, email, site, réseaux et formulaire de contact."]].map(([title, text]) => <div className={localStyles.helperItem} key={title}><strong>{title}</strong><span>{text}</span></div>)}
          </div>
          <p>{i18nT("aucune_rubrique_n_est_a_recopier_76e710d2")}</p>
          {publicUrl ? <p style={{ overflowWrap: "anywhere" }}>{publicUrl}</p> : null}
          <button className={`${styles.ghostBtn} ${localStyles.secondaryAction}`} type="button" onClick={() => void load()} disabled={loading || actionLoading}>{loading ? i18nT("synchronisation_cc8ad3ae") : i18nT("actualiser_9d3b2a7d")}</button>
        </details>
      </section>
    </div>
  );
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
    })}
    {disconnectConfirmOpen ? (
      <ChannelParametersDialog name="iNr’Search" onClose={() => setDisconnectConfirmOpen(false)}>
        <p>{i18nT("votre_page_sera_retiree_de_l_f8ed5e53")}</p>
        <button type="button" className={styles.actionBtn} onClick={() => {
          setDisconnectConfirmOpen(false);
          void performAction("disconnect");
        }}>{i18nT("deconnecter_quand_meme_dcf686d8")}</button>
      </ChannelParametersDialog>
    ) : null}
  </>;
}
