"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./trials.module.css";

type TrialState = "followup" | "active" | "scheduled" | "expired";
type TrialFilter = "all" | "followup" | "active" | "scheduled" | "expired";

type AdminTrial = {
  user_id: string;
  full_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  registered_at: string | null;
  trial_end_at: string | null;
  days_remaining: number | null;
  state: TrialState;
  subscription_status: string | null;
  scheduled_plan: string | null;
  has_scheduled_subscription: boolean;
  last_customer_reminder_at: string | null;
  last_customer_reminder_marker: number | null;
};

type TrialsPayload = {
  trials?: AdminTrial[];
  total?: number;
  generated_at?: string;
  trial_days?: number;
  admin_reminder_offsets?: number[];
  error?: string;
  detail?: string;
};

const FILTERS: Array<{ value: TrialFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "followup", label: "À rappeler" },
  { value: "active", label: "En cours" },
  { value: "scheduled", label: "Abonnement prévu" },
  { value: "expired", label: "Terminés" },
];

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function displayName(trial: AdminTrial) {
  return trial.full_name || trial.company_name || trial.email || "Professionnel sans nom";
}

function priorityCopy(trial: AdminTrial) {
  if (trial.state === "scheduled") {
    return {
      title: "Abonnement prévu",
      detail: trial.scheduled_plan || "Paiement déjà programmé",
    };
  }
  if (trial.state === "expired") {
    const overdue = trial.days_remaining === null ? null : Math.abs(trial.days_remaining);
    return {
      title: "Essai terminé",
      detail: overdue === null ? "Échéance dépassée" : overdue === 0 ? "Aujourd’hui" : `Depuis ${overdue} j`,
    };
  }
  if (trial.days_remaining === null) return { title: "Date à vérifier", detail: "Échéance manquante" };
  if (trial.days_remaining === 0) return { title: "Dernier jour", detail: "Relance immédiate" };
  if (trial.days_remaining <= 3) return { title: `J-${trial.days_remaining}`, detail: "Relance prioritaire" };
  return { title: `J-${trial.days_remaining}`, detail: "Essai en cours" };
}

function customerReminderCopy(trial: AdminTrial) {
  const sentAt = formatDateTime(trial.last_customer_reminder_at);
  return sentAt ? `Rappel pro envoyé le ${sentAt}` : "Aucun rappel pro envoyé pour le moment";
}

export default function AdminTrialsClient() {
  const [trials, setTrials] = useState<AdminTrial[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TrialFilter>("all");
  const [query, setQuery] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/trials", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as TrialsPayload;
      if (!response.ok) throw new Error(payload.error || payload.detail || "Chargement impossible.");
      setTrials(Array.isArray(payload.trials) ? payload.trials : []);
      setGeneratedAt(payload.generated_at || new Date().toISOString());
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger les périodes d’essai.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setFocusedUserId(new URLSearchParams(window.location.search).get("focus"));
    void load();
  }, [load]);

  const metrics = useMemo(() => ({
    followup: trials.filter((trial) => trial.state === "followup").length,
    active: trials.filter((trial) => trial.state === "active" || trial.state === "followup").length,
    scheduled: trials.filter((trial) => trial.state === "scheduled").length,
    expired: trials.filter((trial) => trial.state === "expired").length,
  }), [trials]);

  const visibleTrials = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return trials.filter((trial) => {
      if (filter !== "all" && trial.state !== filter) return false;
      if (!normalizedQuery) return true;
      return [
        trial.full_name,
        trial.company_name,
        trial.email,
        trial.phone,
        trial.user_id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [filter, query, trials]);

  const lastRefresh = formatDateTime(generatedAt);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <span className={styles.icon} aria-hidden="true">⏳</span>
            <div>
              <span className={styles.kicker}>Administration iNrCy</span>
              <h1>Périodes d’essai</h1>
              <p>Suivi des essais de 21 jours · alertes Admin automatiques à J-3 et J-2.</p>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.refreshButton} onClick={() => void load(true)} disabled={refreshing} aria-label="Actualiser les périodes d’essai">
              <span aria-hidden="true">↻</span>
              <span>{refreshing ? "Actualisation…" : "Actualiser"}</span>
            </button>
            <Link href="/dashboard/admin" className={styles.closeButton} aria-label="Fermer">
              <span className={styles.closeIcon} aria-hidden="true">×</span>
              <span className={styles.closeLabel}>Fermer</span>
            </Link>
          </div>
        </header>

        <section className={styles.metrics} aria-label="Résumé des périodes d’essai">
          <button type="button" className={`${styles.metric} ${filter === "followup" ? styles.metricSelected : ""}`} onClick={() => setFilter("followup")}>
            <span>À rappeler</span><strong>{metrics.followup}</strong><small>Priorité J-3 à J-0</small>
          </button>
          <button type="button" className={`${styles.metric} ${filter === "active" ? styles.metricSelected : ""}`} onClick={() => setFilter("active")}>
            <span>Essais actifs</span><strong>{metrics.active}</strong><small>Abonnement non programmé</small>
          </button>
          <button type="button" className={`${styles.metric} ${filter === "scheduled" ? styles.metricSelected : ""}`} onClick={() => setFilter("scheduled")}>
            <span>Abonnements prévus</span><strong>{metrics.scheduled}</strong><small>Pas de relance requise</small>
          </button>
          <button type="button" className={`${styles.metric} ${filter === "expired" ? styles.metricSelected : ""}`} onClick={() => setFilter("expired")}>
            <span>Essais terminés</span><strong>{metrics.expired}</strong><small>À contrôler</small>
          </button>
        </section>

        <section className={styles.toolbar}>
          <div className={styles.filters} role="group" aria-label="Filtrer les périodes d’essai">
            {FILTERS.map((item) => (
              <button key={item.value} type="button" className={filter === item.value ? styles.filterActive : styles.filterButton} onClick={() => setFilter(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
          <label className={styles.search}>
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, société, téléphone ou e-mail…" />
          </label>
          <small className={styles.refreshInfo}>{lastRefresh ? `Mis à jour ${lastRefresh}` : "Données Supabase"}</small>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.tableCard} aria-label="Liste des périodes d’essai">
          <div className={styles.tableHeader} aria-hidden="true">
            <span>Professionnel</span>
            <span>Coordonnées</span>
            <span>Inscription</span>
            <span>Fin d’essai</span>
            <span>Priorité</span>
            <span>Actions</span>
          </div>
          <div className={styles.tableBody}>
            {loading ? <div className={styles.empty}>Chargement des périodes d’essai…</div> : null}
            {!loading && visibleTrials.length === 0 ? <div className={styles.empty}>Aucune période d’essai pour ce filtre.</div> : null}
            {!loading ? visibleTrials.map((trial) => {
              const priority = priorityCopy(trial);
              const accountQuery = encodeURIComponent(trial.email || trial.user_id);
              return (
                <article key={trial.user_id} id={`trial-${trial.user_id}`} className={`${styles.row} ${focusedUserId === trial.user_id ? styles.focusedRow : ""}`} data-state={trial.state}>
                  <div className={styles.proCell} data-label="Professionnel">
                    <span className={styles.avatar} aria-hidden="true">{displayName(trial).slice(0, 1).toUpperCase()}</span>
                    <div><strong>{displayName(trial)}</strong><small>{trial.company_name && trial.company_name !== displayName(trial) ? trial.company_name : "Compte iNrCy"}</small></div>
                  </div>
                  <div className={styles.contactCell} data-label="Coordonnées">
                    {trial.phone ? <a href={`tel:${trial.phone}`}>{trial.phone}</a> : <span>Téléphone non renseigné</span>}
                    {trial.email ? <a href={`mailto:${trial.email}`}>{trial.email}</a> : <span>E-mail non renseigné</span>}
                  </div>
                  <div className={styles.dateCell} data-label="Inscription"><strong>{formatDate(trial.registered_at)}</strong><small>Début de l’essai</small></div>
                  <div className={styles.dateCell} data-label="Fin d’essai"><strong>{formatDate(trial.trial_end_at)}</strong><small>{customerReminderCopy(trial)}</small></div>
                  <div className={styles.priorityCell} data-label="Priorité">
                    <span className={styles.stateBadge}>{priority.title}</span>
                    <small>{priority.detail}</small>
                  </div>
                  <div className={styles.actions} data-label="Actions">
                    {trial.phone ? <a className={styles.primaryAction} href={`tel:${trial.phone}`}>Appeler</a> : null}
                    {trial.email ? <a className={styles.secondaryAction} href={`mailto:${trial.email}?subject=${encodeURIComponent("Votre période d’essai iNrCy")}`}>E-mail</a> : null}
                    <Link className={styles.secondaryAction} href={`/dashboard/admin/users?q=${accountQuery}`}>Compte</Link>
                  </div>
                </article>
              );
            }) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
