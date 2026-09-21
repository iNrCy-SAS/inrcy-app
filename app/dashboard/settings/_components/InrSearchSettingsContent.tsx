"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function slugFromPublicUrl(value: string) {
  const match = value.match(/\/entreprises\/([^/?#]+)/i);
  return match?.[1] || "";
}

function readPanelSnapshot(publicUrl: string, initialConnected: boolean | null, initialDirectoryEnabled: boolean | null) {
  if (typeof window === "undefined") return null;
  const slug = slugFromPublicUrl(publicUrl);
  if (!slug) return null;
  if (initialConnected === false) return null;

  try {
    const raw = window.sessionStorage.getItem(`${INR_SEARCH_PANEL_CACHE_PREFIX}${slug}`);
    if (raw) {
      const parsed = asRecord(JSON.parse(raw));
      const publicationValue = asRecord(parsed.publication);
      const reason = String(publicationValue.reason);
      const validReasons = [
        "published",
        "slug_missing",
        "config_missing",
        "page_disabled",
        "bubble_disabled",
        "subscription_inactive",
        "profile_missing",
        "data_unavailable",
      ];
      const cachedSettings = normalizeSettings(parsed.settings);
      if (typeof initialDirectoryEnabled === "boolean") {
        cachedSettings.directoryEnabled = initialDirectoryEnabled;
      }
      return {
        settings: cachedSettings,
        publication: {
          allowed: Boolean(publicationValue.allowed),
          reason: (validReasons.includes(reason) ? reason : "data_unavailable") as InrSearchPublicationState["reason"],
          subscriptionStatus: typeof publicationValue.subscriptionStatus === "string" ? publicationValue.subscriptionStatus : undefined,
        },
      } satisfies InrSearchPanelSnapshot;
    }
  } catch {
    // sessionStorage is only an optimization; the live request remains the source of truth.
  }

  if (initialConnected === true) {
    return {
      settings: {
        ...EMPTY_SETTINGS,
        enabled: true,
        directoryEnabled: initialDirectoryEnabled === true,
        slug,
        publishedSlug: slug,
        slugLocked: true,
      },
      publication: { allowed: true, reason: "published" },
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

function emitDashboardUpdate(settings: InrSearchSettings, publicationAllowed: boolean) {
  if (typeof window === "undefined") return;
  const pageUrl = settings.slug ? `${getRuntimeInrSearchOrigin()}/entreprises/${settings.slug}` : "";
  window.dispatchEvent(new CustomEvent("inrcy:inr-search-settings-updated", {
    detail: {
      connected: Boolean(settings.enabled && settings.slug && publicationAllowed),
      directoryEnabled: Boolean(settings.enabled && settings.directoryEnabled && publicationAllowed),
      profileUrl: pageUrl,
    },
  }));
}

type InrSearchSettingsContentProps = {
  active?: boolean;
  initialConnected?: boolean | null;
  initialPublicUrl?: string;
  initialDirectoryEnabled?: boolean | null;
};

export default function InrSearchSettingsContent({
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
  const [helperOpen, setHelperOpen] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const lastLoadStartedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const [initialLoadBlocking] = useState(() => !initialSnapshot && initialConnected === null);

  const publicUrl = useMemo(
    () => settings.slug ? `${INR_SEARCH_PUBLIC_ORIGIN}/entreprises/${settings.slug}` : "",
    [settings.slug],
  );
  const previewUrl = useMemo(
    () => settings.slug ? `/entreprises/${settings.slug}` : "",
    [settings.slug],
  );

  const load = useCallback(({ blocking = false }: { blocking?: boolean } = {}) => {
    if (loadInFlightRef.current) return loadInFlightRef.current;

    lastLoadStartedAtRef.current = Date.now();
    const request = (async () => {
      if (blocking && mountedRef.current) setLoading(true);
      if (mountedRef.current) setError(null);
      try {
        const response = await fetch("/api/inr-search/settings", { cache: "no-store", credentials: "include" });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Chargement impossible.");

        const next = normalizeSettings(payload.inrSearch);
        const publicationValue = asRecord(payload.publication);
        const nextPublication: InrSearchPublicationState = {
          allowed: Boolean(publicationValue.allowed),
          reason: [
            "published",
            "slug_missing",
            "config_missing",
            "page_disabled",
            "bubble_disabled",
            "subscription_inactive",
            "profile_missing",
            "data_unavailable",
          ].includes(String(publicationValue.reason))
            ? publicationValue.reason as InrSearchPublicationState["reason"]
            : "data_unavailable",
          subscriptionStatus: typeof publicationValue.subscriptionStatus === "string" ? publicationValue.subscriptionStatus : undefined,
        };

        if (!mountedRef.current) return;
        setSettings(next);
        setPublication(nextPublication);
        writePanelSnapshot(
          next.slug ? `${INR_SEARCH_PUBLIC_ORIGIN}/entreprises/${next.slug}` : "",
          { settings: next, publication: nextPublication },
        );
        emitDashboardUpdate(next, nextPublication.allowed);
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Chargement de la page iNr'Search impossible.");
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();

    loadInFlightRef.current = request;
    void request.finally(() => {
      if (loadInFlightRef.current === request) loadInFlightRef.current = null;
    });
    return request;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load({ blocking: initialLoadBlocking });
    return () => {
      mountedRef.current = false;
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
      await load();
      if (directoryWarning) setError(directoryWarning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mise à jour iNr’Search impossible.");
    } finally {
      setActionLoading(false);
    }
  }, [load]);

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

  return (
    <div className={localStyles.root}>
      <div className={localStyles.feedbackStack}>
        {error && feedbackAction !== "directory" ? <StatusMessage variant="error">{error}</StatusMessage> : null}
        {success && feedbackAction !== "directory" ? <StatusMessage variant="success">{success}</StatusMessage> : null}
      </div>

      <section className={`${localStyles.stepCard} ${localStyles.stepPublication}`} aria-labelledby="inrsearch-publication-title">
        <span className={localStyles.stepAccent} aria-hidden="true" />
        <header className={localStyles.stepHeader}>
          <div className={localStyles.stepIdentity}>
            <span className={localStyles.stepNumber} aria-hidden="true">1</span>
            <div className={localStyles.stepCopy}>
              <div className={localStyles.titleRow}>
                <h2 id="inrsearch-publication-title" className={localStyles.stepTitle}>{i18nT("page_publique_inr_apos_search_31dc348f")}</h2>
                <button className={localStyles.infoButton} type="button" aria-label={i18nT("comprendre_inr_search_a9cbbbdf")} onClick={() => setHelperOpen(true)}>?</button>
              </div>
              <p className={`${localStyles.stepDescription} ${localStyles.muted}`}>{i18nT("inrcy_transforme_les_informations_du_professionn_1428bd4f")}</p>
            </div>
          </div>
        </header>

        <div className={localStyles.actionPanel}>
          <p className={localStyles.actionHint}>{isPublished ? i18nT("votre_page_est_publique_et_peut_010782c6") : i18nT("connectez_la_page_pour_activer_sa_032f8d6b")}</p>
          <button
            className={isPublished ? `${styles.actionBtn} ${styles.disconnectBtn} ${localStyles.actionButton}` : `${styles.primaryBtn} ${localStyles.actionButton} ${localStyles.primaryAction}`}
            type="button"
            disabled={loading || actionLoading || !hasPage}
            onClick={() => { if (isPublished) setDisconnectConfirmOpen(true); else void performAction("connect"); }}
          >
            {actionLoading && feedbackAction !== "directory" ? i18nT("mise_a_jour_e75ccbf3") : isPublished ? i18nT("deconnecter_9c1ef392") : i18nT("connecter_ca28e250")}
          </button>
        </div>

        <div className={localStyles.statusSummary} data-active={isPublished ? "true" : "false"}>
          <span className={localStyles.statusOrb} aria-hidden="true" />
          <div className={localStyles.statusCopy}>
            <strong>{publicationLabel}</strong>
            <p>{loading ? i18nT("creation_et_synchronisation_en_cours_c4b272b0") : publicationMessage}</p>
          </div>
        </div>

        {publicUrl ? (
          <div className={localStyles.linkRow}>
            <div className={localStyles.publicUrl}>{publicUrl}</div>
            <div className={localStyles.addressActions}>
              <button className={`${styles.ghostBtn} ${localStyles.secondaryAction}`} type="button" onClick={() => void load()} disabled={loading || actionLoading}>{loading ? i18nT("synchronisation_cc8ad3ae") : i18nT("actualiser_9d3b2a7d")}</button>
              {isPublished ? <a className={`${styles.primaryBtn} ${localStyles.primaryAction}`} href={previewUrl} target="_blank" rel="noreferrer">{i18nT("voir_ma_page_60fa96b6")}</a> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className={`${localStyles.stepCard} ${localStyles.stepDirectory}`} aria-labelledby="inrsearch-directory-title">
        <span className={localStyles.stepAccent} aria-hidden="true" />
        <header className={localStyles.stepHeader}>
          <div className={localStyles.stepIdentity}>
            <span className={localStyles.stepNumber} aria-hidden="true">2</span>
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
      </section>

      {helperOpen ? (
        <div className={localStyles.dialogOverlay} role="dialog" aria-modal="true" aria-labelledby="inrsearch-helper-title">
          <div className={localStyles.helperDialog}>
            <div className={localStyles.dialogHeader}>
              <div id="inrsearch-helper-title" className={styles.blockTitle}>{i18nT("a_quoi_sert_inr_apos_search_c32318a6")}</div>
              <button className={`${styles.ghostBtn} ${localStyles.secondaryAction}`} type="button" onClick={() => setHelperOpen(false)}>{i18nT("fermer_5ab4ec64")}</button>
            </div>
            <p className={localStyles.dialogIntro}>{i18nT("inr_apos_search_transforme_automatiquement_les_99deb0af")}</p>
            <div className={localStyles.helperGrid}>
              {[["Référencement", "Titre, description, adresse et données structurées."], ["Moteurs IA", "Synthèse factuelle et source publique dédiée."], ["Activité", "Métier, prestations, clientèle et zones d’intervention."], ["Preuves", "Logo, photos, réalisations et publications disponibles."], ["iNr’Guide", "Réponses générées à partir des informations confirmées."], ["Conversion", "Téléphone, email, site, réseaux et formulaire de contact."]].map(([title, text]) => (
                <div className={localStyles.helperItem} key={title}><strong>{title}</strong><span>{text}</span></div>
              ))}
            </div>
            <p className={localStyles.dialogFooter}>{i18nT("aucune_rubrique_n_est_a_recopier_76e710d2")}</p>
          </div>
        </div>
      ) : null}

      {disconnectConfirmOpen ? (
        <div className={localStyles.dialogOverlay} role="dialog" aria-modal="true" aria-labelledby="inrsearch-disconnect-title">
          <div className={`${localStyles.confirmDialog} ${localStyles.dangerDialog}`}>
            <div id="inrsearch-disconnect-title" className={styles.blockTitle}>{i18nT("deconnecter_votre_page_inr_apos_search_c5a16ef8")}</div>
            <p className={localStyles.dialogIntro}>{i18nT("votre_page_sera_retiree_de_l_f8ed5e53")}</p>
            <div className={localStyles.confirmActions}>
              <button className={`${styles.ghostBtn} ${localStyles.secondaryAction}`} type="button" onClick={() => setDisconnectConfirmOpen(false)}>{i18nT("annuler_49ba3292")}</button>
              <button className={`${styles.actionBtn} ${styles.disconnectBtn} ${localStyles.actionButton}`} type="button" onClick={() => { setDisconnectConfirmOpen(false); void performAction("disconnect"); }}>{i18nT("deconnecter_quand_meme_dcf686d8")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
