"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../../dashboard.module.css";
import localStyles from "./InrSearchSettingsContent.module.css";
import StatusMessage from "../../_components/StatusMessage";

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

const cardStyle = {
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.03)",
  borderRadius: 14,
  padding: 14,
  display: "grid",
  gap: 10,
  minWidth: 0,
  maxWidth: "100%",
  overflow: "hidden",
  boxSizing: "border-box",
} as const;

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
  initialConnected?: boolean | null;
  initialPublicUrl?: string;
  initialDirectoryEnabled?: boolean | null;
};

export default function InrSearchSettingsContent({
  initialConnected = null,
  initialPublicUrl = "",
  initialDirectoryEnabled = null,
}: InrSearchSettingsContentProps) {
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
      if (blocking) setLoading(true);
      setError(null);
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

        setSettings(next);
        setPublication(nextPublication);
        writePanelSnapshot(
          next.slug ? `${INR_SEARCH_PUBLIC_ORIGIN}/entreprises/${next.slug}` : "",
          { settings: next, publication: nextPublication },
        );
        emitDashboardUpdate(next, nextPublication.allowed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Chargement de la page iNr'Search impossible.");
      } finally {
        setLoading(false);
      }
    })();

    loadInFlightRef.current = request;
    void request.finally(() => {
      if (loadInFlightRef.current === request) loadInFlightRef.current = null;
    });
    return request;
  }, []);

  useEffect(() => {
    void load({ blocking: !initialSnapshot && initialConnected === null });
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
  }, [initialConnected, initialSnapshot, load]);

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
    <div className={localStyles.root} style={{ display: "grid", gap: 14 }}>
      {error && feedbackAction !== "directory" ? <StatusMessage variant="error">{error}</StatusMessage> : null}
      {success && feedbackAction !== "directory" ? <StatusMessage variant="success">{success}</StatusMessage> : null}

      <div className={localStyles.card} style={{ ...cardStyle, gap: 12 }}>
        <div className={localStyles.headerRow} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className={localStyles.headerCopy} style={{ display: "grid", gap: 5, flex: "1 1 280px" }}>
            <div className={styles.blockTitle}>Page publique iNr&apos;Search</div>
            <div className={`${styles.smallMuted} ${localStyles.muted}`}>
              iNrCy transforme les informations du professionnel en une présence publique claire, vivante et exploitable par les moteurs de recherche.
            </div>
          </div>
          <div className={localStyles.headerActions} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" aria-label="Comprendre iNr’Search" onClick={() => setHelperOpen(true)} style={{ width: 30, height: 30, borderRadius: 999, border: "1px solid rgba(167,139,250,.55)", background: "rgba(99,102,241,.18)", color: "#ddd6fe", fontWeight: 950, cursor: "pointer" }}>?</button>
            <span className={`${localStyles.statusPill}`} style={{ display: "inline-flex", alignItems: "center", gap: 7, minHeight: 30, padding: "0 11px", borderRadius: 999, border: `1px solid ${isPublished ? "rgba(34,197,94,.38)" : "rgba(148,163,184,.28)"}`, background: isPublished ? "rgba(34,197,94,.10)" : "rgba(148,163,184,.08)", color: isPublished ? "#86efac" : "rgba(226,232,240,.76)", fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: isPublished ? "#22c55e" : "#94a3b8" }} />
              {publicationLabel}
            </span>
          </div>
        </div>

        <div className={localStyles.actionRow} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button className={isPublished ? `${styles.actionBtn} ${styles.disconnectBtn}` : styles.primaryBtn} type="button" disabled={loading || actionLoading || !hasPage} onClick={() => { if (isPublished) setDisconnectConfirmOpen(true); else void performAction("connect"); }}>
            {actionLoading && feedbackAction !== "directory" ? "Mise à jour…" : isPublished ? "Déconnecter" : "Connecter"}
          </button>
          <span className={`${styles.smallMuted} ${localStyles.muted}`}>{isPublished ? "Votre page est publique et peut être référencée." : "Connectez la page pour activer sa visibilité SEO."}</span>
        </div>
      </div>

      <div className={localStyles.card} style={cardStyle}>
        <div className={localStyles.headerRow} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className={localStyles.headerCopy} style={{ display: "grid", gap: 5 }}>
            <div className={styles.blockTitle}>Annuaire public iNrCy</div>
            <div className={`${styles.smallMuted} ${localStyles.muted}`}>Choisissez si votre page publique doit aussi être proposée aux internautes dans l’annuaire iNrCy.</div>
          </div>
          <span style={{ color: settings.directoryEnabled && isPublished ? "#86efac" : "rgba(226,232,240,.68)", fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" }}>{settings.directoryEnabled && isPublished ? "Visible dans l’annuaire" : "Hors annuaire"}</span>
        </div>
        <button className={localStyles.directoryButton} type="button" disabled={!isPublished || actionLoading} aria-pressed={Boolean(settings.directoryEnabled && isPublished)} onClick={() => void performAction("directory", !settings.directoryEnabled)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${settings.directoryEnabled && isPublished ? "rgba(34,197,94,.42)" : "rgba(255,255,255,.12)"}`, background: settings.directoryEnabled && isPublished ? "rgba(34,197,94,.10)" : "rgba(15,23,42,.52)", color: "inherit", textAlign: "left", cursor: isPublished ? "pointer" : "not-allowed", opacity: isPublished ? 1 : .62 }}>
          <span className={localStyles.directoryCopy} style={{ display: "grid", gap: 3 }}>
            <strong>{settings.directoryEnabled && isPublished ? "Page ajoutée à l’annuaire iNrCy" : "Ajouter ma page à l’annuaire iNrCy"}</strong>
            <span className={`${styles.smallMuted} ${localStyles.muted}`}>{isPublished ? "Vous pouvez modifier ce choix à tout moment." : "Connectez d’abord votre page iNr’Search."}</span>
          </span>
         <span aria-hidden style={{ width: 38, height: 22, padding: 3, borderRadius: 999, background: settings.directoryEnabled && isPublished ? "#22c55e" : "rgba(148,163,184,.28)", flex: "0 0 auto" }}><span style={{ display: "block", width: 16, height: 16, borderRadius: 999, background: "#fff", transform: settings.directoryEnabled && isPublished ? "translateX(16px)" : "translateX(0)", transition: "transform .18s ease" }} /></span>
        </button>
        {feedbackAction === "directory" && actionLoading ? (
          <div role="status" aria-live="polite" className={`${styles.smallMuted} ${localStyles.muted}`} style={{ border: "1px solid rgba(167,139,250,.28)", borderRadius: 10, padding: "9px 11px", color: "#ddd6fe" }}>
            Mise à jour de votre présence dans l’annuaire iNrCy…
          </div>
        ) : null}
        {feedbackAction === "directory" && error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
        {feedbackAction === "directory" && success ? <StatusMessage variant="success">{success}</StatusMessage> : null}
      </div>

      <div className={localStyles.card} style={cardStyle}>
        <div className={styles.blockTitle}>État de publication</div>
        <div className={`${styles.smallMuted} ${localStyles.muted}`}>{loading ? "Création et synchronisation en cours…" : publicationMessage}</div>
      </div>

      {publicUrl ? (
        <div className={localStyles.card} style={cardStyle}>
          <div className={styles.blockTitle}>Adresse publique permanente</div>
          <div className={localStyles.publicUrl} style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(15,23,42,0.62)", borderRadius: 12, padding: "10px 12px", overflowWrap: "anywhere" }}>{publicUrl}</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <button className={styles.ghostBtn} type="button" onClick={() => void load()} disabled={loading || actionLoading}>{loading ? "Synchronisation…" : "Actualiser"}</button>
            {isPublished ? <a className={styles.primaryBtn} href={previewUrl} target="_blank" rel="noreferrer">Voir ma page</a> : null}
          </div>
        </div>
      ) : null}

      {helperOpen ? (
        <div role="dialog" aria-modal="true" aria-labelledby="inrsearch-helper-title" style={{ position: "fixed", inset: 0, zIndex: 10050, display: "grid", placeItems: "center", padding: 20, boxSizing: "border-box", overflowX: "hidden", overflowY: "auto", background: "rgba(2,6,23,.76)" }}>
          <div style={{ width: "min(680px, 100%)", margin: "auto", overflow: "hidden", border: "1px solid rgba(167,139,250,.35)", borderRadius: 18, padding: 20, background: "linear-gradient(145deg, #111827, #0b1020)", boxShadow: "0 30px 80px rgba(0,0,0,.45)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><div id="inrsearch-helper-title" className={styles.blockTitle}>À quoi sert iNr&apos;Search ?</div><button className={styles.ghostBtn} type="button" onClick={() => setHelperOpen(false)}>Fermer</button></div>
            <p className={`${styles.smallMuted} ${localStyles.muted}`} style={{ marginTop: 12 }}>iNr&apos;Search transforme automatiquement les informations déjà enregistrées dans iNrCy en une page professionnelle publique, conçue pour les internautes, Google, Bing et les moteurs de réponse IA.</p>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
              {[ ["Référencement", "Titre, description, adresse et données structurées."], ["Moteurs IA", "Synthèse factuelle et source publique dédiée."], ["Activité", "Métier, prestations, clientèle et zones d’intervention."], ["Preuves", "Logo, photos, réalisations et publications disponibles."], ["iNr’Guide", "Réponses générées à partir des informations confirmées."], ["Conversion", "Téléphone, email, site, réseaux et formulaire de contact."] ].map(([title, text]) => <div key={title} style={{ border: "1px solid rgba(255,255,255,.10)", borderRadius: 12, padding: 12, background: "rgba(15,23,42,.64)", display: "grid", gap: 4 }}><strong>{title}</strong><span className={`${styles.smallMuted} ${localStyles.muted}`}>{text}</span></div>)}
            </div>
            <p className={`${styles.smallMuted} ${localStyles.muted}`} style={{ marginBottom: 0, marginTop: 14 }}>Aucune rubrique n’est à recopier : la page évolue lorsque les informations du profil, de l’activité, des médias ou des publications évoluent.</p>
          </div>
        </div>
      ) : null}

      {disconnectConfirmOpen ? (
        <div role="dialog" aria-modal="true" aria-labelledby="inrsearch-disconnect-title" style={{ position: "fixed", inset: 0, zIndex: 10051, display: "grid", placeItems: "center", padding: 20, background: "rgba(2,6,23,.78)" }}>
          <div style={{ width: "min(520px, 100%)", border: "1px solid rgba(248,113,113,.38)", borderRadius: 18, padding: 20, background: "#11131b", boxShadow: "0 30px 80px rgba(0,0,0,.48)" }}>
            <div id="inrsearch-disconnect-title" className={styles.blockTitle}>Déconnecter votre page iNr&apos;Search ?</div>
            <p className={`${styles.smallMuted} ${localStyles.muted}`} style={{ lineHeight: 1.6 }}>Votre page sera retirée de l’annuaire public et sa désindexation sera demandée progressivement à Google, Bing et aux moteurs de recherche IA. Le référencement et les signaux de visibilité obtenus pourront être perdus. Une reconnexion ne garantit pas un retour immédiat dans les résultats.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}><button className={styles.ghostBtn} type="button" onClick={() => setDisconnectConfirmOpen(false)}>Annuler</button><button className={`${styles.actionBtn} ${styles.disconnectBtn}`} type="button" onClick={() => { setDisconnectConfirmOpen(false); void performAction("disconnect"); }}>Déconnecter quand même</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
