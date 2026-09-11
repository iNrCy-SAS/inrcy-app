"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./subscribers.module.css";

type AdminSubscriber = {
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  amount_eur: number | null;
  billing_cycle: string | null;
  payment_status: string | null;
  payment_provider: string | null;
  last_followup_at: string | null;
  next_renewal_date: string | null;
};

type SubscribersPayload = {
  subscribers?: AdminSubscriber[];
  total?: number;
  active_count?: number;
  payment_issue_count?: number;
  monthly_revenue_eur?: number;
  error?: string;
  detail?: string;
};

type SubscriberSummary = {
  total: number;
  activeCount: number;
  paymentIssueCount: number;
  monthlyRevenueEur: number;
};

const EMPTY_SUMMARY: SubscriberSummary = {
  total: 0,
  activeCount: 0,
  paymentIssueCount: 0,
  monthlyRevenueEur: 0,
};

const ACTIVE_STATUSES = new Set(["active", "paid", "trialing"]);
const PAYMENT_ISSUE_STATUSES = new Set([
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "payment_failed",
]);

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  active: "À jour",
  paid: "Payé",
  trialing: "Essai en cours",
  past_due: "Paiement en retard",
  unpaid: "Impayé",
  incomplete: "Paiement incomplet",
  incomplete_expired: "Paiement expiré",
  payment_failed: "Paiement échoué",
  canceled: "Résilié",
  cancelled: "Résilié",
  paused: "En pause",
};

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizedStatus(value: string | null) {
  return value?.trim().toLowerCase() || "unknown";
}

function paymentStatusLabel(value: string | null) {
  const normalized = normalizedStatus(value);
  return PAYMENT_STATUS_LABELS[normalized] || value?.trim() || "À vérifier";
}

function paymentTone(value: string | null) {
  const normalized = normalizedStatus(value);
  if (ACTIVE_STATUSES.has(normalized)) return "positive";
  if (PAYMENT_ISSUE_STATUSES.has(normalized)) return "warning";
  if (["canceled", "cancelled", "paused"].includes(normalized)) return "neutral";
  return "unknown";
}

function providerLabel(value: string | null) {
  if (!value) return "Source non renseignée";
  const normalized = value.trim().toLowerCase();
  if (normalized === "stripe") return "Stripe";
  if (["revenuecat", "apple", "app_store"].includes(normalized)) return "App Store";
  if (["google", "play_store", "google_play"].includes(normalized)) return "Google Play";
  return value.trim();
}

function billingCycleLabel(value: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (["month", "monthly", "mois"].includes(normalized || "")) return "Facturation mensuelle";
  if (["year", "yearly", "annual", "annuel", "année"].includes(normalized || "")) return "Facturation annuelle";
  return value?.trim() || "Cycle non renseigné";
}

function formatCurrency(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatMonthlyAmount(value: number | null) {
  const amount = formatCurrency(value);
  return amount === "—" ? amount : `${amount} / mois`;
}

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

function displayName(subscriber: AdminSubscriber) {
  return subscriber.name?.trim() || subscriber.email?.trim() || "Abonné sans nom";
}

function countMatchingStatuses(subscribers: AdminSubscriber[], statuses: Set<string>) {
  return subscribers.filter((subscriber) => statuses.has(normalizedStatus(subscriber.payment_status))).length;
}

export default function AdminSubscribersClient() {
  const [subscribers, setSubscribers] = useState<AdminSubscriber[]>([]);
  const [summary, setSummary] = useState<SubscriberSummary>(EMPTY_SUMMARY);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSubscribers = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/subscribers", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as SubscribersPayload;
      if (!response.ok) {
        throw new Error(payload.error || payload.detail || "Impossible de charger les abonnés.");
      }

      const rows = Array.isArray(payload.subscribers) ? payload.subscribers : [];
      setSubscribers(rows);
      setSummary({
        total: finiteNumber(payload.total, rows.length),
        activeCount: finiteNumber(payload.active_count, countMatchingStatuses(rows, ACTIVE_STATUSES)),
        paymentIssueCount: finiteNumber(
          payload.payment_issue_count,
          countMatchingStatuses(rows, PAYMENT_ISSUE_STATUSES),
        ),
        monthlyRevenueEur: finiteNumber(payload.monthly_revenue_eur),
      });
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger les abonnés.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSubscribers();
  }, [loadSubscribers]);

  const visibleSubscribers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr-FR");
    if (!normalizedQuery) return subscribers;

    return subscribers.filter((subscriber) =>
      [
        subscriber.name,
        subscriber.email,
        subscriber.phone,
        subscriber.payment_status,
        paymentStatusLabel(subscriber.payment_status),
        subscriber.payment_provider,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("fr-FR")
        .includes(normalizedQuery),
    );
  }, [query, subscribers]);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <span className={styles.icon} aria-hidden="true">💳</span>
            <div>
              <span className={styles.kicker}>Administration iNrCy</span>
              <h1>Abonnés</h1>
              <p>Vue consolidée des abonnements et de leur état de paiement.</p>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void loadSubscribers(true)}
              disabled={loading || refreshing}
            >
              <span aria-hidden="true">↻</span>
              <span>{refreshing ? "Actualisation…" : "Actualiser"}</span>
            </button>
            <Link href="/dashboard/admin" className={styles.closeButton} aria-label="Fermer">
              <span className={styles.closeIcon} aria-hidden="true">×</span>
              <span className={styles.closeLabel}>Fermer</span>
            </Link>
          </div>
        </header>

        <section className={styles.metrics} aria-label="Résumé des abonnements">
          <article className={styles.metric}>
            <span>Abonnés</span>
            <strong>{summary.total}</strong>
            <small>abonnements suivis</small>
          </article>
          <article className={styles.metric}>
            <span>Actifs</span>
            <strong>{summary.activeCount}</strong>
            <small>abonnements actifs</small>
          </article>
          <article className={`${styles.metric} ${summary.paymentIssueCount > 0 ? styles.metricAlert : ""}`}>
            <span>À vérifier</span>
            <strong>{summary.paymentIssueCount}</strong>
            <small>problèmes de paiement</small>
          </article>
          <article className={styles.metric}>
            <span>Revenu mensuel</span>
            <strong>{formatCurrency(summary.monthlyRevenueEur)}</strong>
            <small>revenu récurrent estimé</small>
          </article>
        </section>

        <section className={styles.toolbar} aria-label="Recherche des abonnés">
          <label className={styles.search}>
            <span aria-hidden="true">⌕</span>
            <span className={styles.srOnly}>Rechercher un abonné</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nom, e-mail, téléphone ou statut…"
            />
          </label>
          <small className={styles.resultCount} aria-live="polite">
            {visibleSubscribers.length} sur {summary.total} abonné{summary.total > 1 ? "s" : ""}
          </small>
        </section>

        {error ? (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadSubscribers()}>Réessayer</button>
          </div>
        ) : null}

        <section className={styles.tableCard} aria-label="Liste des abonnés">
          <div className={styles.tableHeader} aria-hidden="true">
            <span>Nom</span>
            <span>E-mail</span>
            <span>Téléphone</span>
            <span>Montant</span>
            <span>Statut paiement</span>
            <span>Dernier suivi</span>
          </div>

          <div className={styles.tableBody}>
            {loading ? (
              <div className={styles.statePanel} role="status">
                <span className={styles.loader} aria-hidden="true" />
                <strong>Chargement des abonnés…</strong>
                <small>Récupération des données de facturation.</small>
              </div>
            ) : null}

            {!loading && !error && subscribers.length === 0 ? (
              <div className={styles.statePanel}>
                <span className={styles.stateIcon} aria-hidden="true">👥</span>
                <strong>Aucun abonné pour le moment</strong>
                <small>Les prochains abonnements apparaîtront automatiquement ici.</small>
              </div>
            ) : null}

            {!loading && !error && subscribers.length > 0 && visibleSubscribers.length === 0 ? (
              <div className={styles.statePanel}>
                <span className={styles.stateIcon} aria-hidden="true">⌕</span>
                <strong>Aucun résultat</strong>
                <small>Essayez un autre nom, e-mail, téléphone ou statut.</small>
              </div>
            ) : null}

            {!loading && !error ? visibleSubscribers.map((subscriber) => {
              const name = displayName(subscriber);
              const status = normalizedStatus(subscriber.payment_status);
              return (
                <article className={styles.row} key={subscriber.user_id} data-payment-tone={paymentTone(status)}>
                  <div className={styles.nameCell} data-label="Nom">
                    <span className={styles.avatar} aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase("fr-FR")}</span>
                    <div>
                      <strong title={name}>{name}</strong>
                      <small>Compte iNrCy</small>
                    </div>
                  </div>

                  <div className={styles.contactCell} data-label="E-mail">
                    {subscriber.email ? <a href={`mailto:${subscriber.email}`}>{subscriber.email}</a> : <span>Non renseigné</span>}
                  </div>

                  <div className={styles.contactCell} data-label="Téléphone">
                    {subscriber.phone ? <a href={`tel:${subscriber.phone}`}>{subscriber.phone}</a> : <span>Non renseigné</span>}
                  </div>

                  <div className={styles.amountCell} data-label="Montant">
                    <strong>{formatMonthlyAmount(subscriber.amount_eur)}</strong>
                    <small>{billingCycleLabel(subscriber.billing_cycle)}</small>
                  </div>

                  <div className={styles.statusCell} data-label="Statut paiement">
                    <span className={styles.statusBadge}>{paymentStatusLabel(subscriber.payment_status)}</span>
                    <small>{providerLabel(subscriber.payment_provider)}</small>
                  </div>

                  <div className={styles.followupCell} data-label="Dernier suivi">
                    <strong>{formatDate(subscriber.last_followup_at)}</strong>
                    <small>Renouvellement : {formatDate(subscriber.next_renewal_date)}</small>
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
