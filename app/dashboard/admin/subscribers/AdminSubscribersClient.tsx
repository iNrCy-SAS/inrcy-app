"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./subscribers.module.css";

type AdminSubscriber = {
  user_id: string;
  name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  amount_eur: number | null;
  billing_cycle: string | null;
  payment_status: string | null;
  stored_payment_status: string | null;
  payment_status_source: "stripe_live" | "provider_database" | "unverified";
  payment_provider: string | null;
  last_followup_at: string | null;
  next_renewal_date: string | null;
  stripe_subscription_id: string | null;
  reconciliation_status:
    | "matched"
    | "unmatched"
    | "ambiguous"
    | "review_required"
    | "not_checked";
  reconciliation_method: string | null;
  reconciliation_candidate: {
    name: string | null;
    email: string | null;
    phone: string | null;
    amount_eur: number | null;
    payment_status: string | null;
    stripe_subscription_id: string;
  } | null;
};

type StripeReconciliation = {
  status: "fresh" | "degraded";
  matched_count: number;
  ambiguous_count: number;
  unmatched_stripe_count: number;
  review_required_count: number;
  subscriptions_scanned: number;
  stripe_pages: number;
  supabase_pages: number;
};

type SubscribersPayload = {
  subscribers?: AdminSubscriber[];
  total?: number;
  active_count?: number;
  payment_issue_count?: number;
  monthly_revenue_eur?: number;
  unpriced_active_count?: number;
  revenue_complete?: boolean;
  unverified_count?: number;
  reconciliation_anomaly_count?: number;
  review_required_count?: number;
  stripe_reconciliation?: Partial<StripeReconciliation>;
  error?: string;
  detail?: string;
};

type SubscriberSummary = {
  total: number;
  activeCount: number;
  paymentIssueCount: number;
  monthlyRevenueEur: number;
  unpricedActiveCount: number;
  revenueComplete: boolean;
};

const EMPTY_SUMMARY: SubscriberSummary = {
  total: 0,
  activeCount: 0,
  paymentIssueCount: 0,
  monthlyRevenueEur: 0,
  unpricedActiveCount: 0,
  revenueComplete: true,
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
  unverified: "Non vérifié",
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

function accountSourceLabel(subscriber: AdminSubscriber) {
  if (subscriber.user_id.startsWith("stripe:")) return "Stripe · à rapprocher";
  if (subscriber.reconciliation_status === "ambiguous") {
    return "Compte iNrCy · correspondance ambiguë";
  }
  if (subscriber.reconciliation_status === "review_required") {
    return "Compte iNrCy · confirmation requise";
  }
  return "Compte iNrCy";
}

function paymentSourceLabel(subscriber: AdminSubscriber) {
  if (subscriber.payment_status_source === "stripe_live") return "Stripe vérifié";
  if (subscriber.payment_status === "unverified") {
    const stored = paymentStatusLabel(subscriber.stored_payment_status);
    return subscriber.stored_payment_status
      ? `Supabase : ${stored} · non confirmé`
      : "Aucune source de paiement confirmée";
  }
  return providerLabel(subscriber.payment_provider);
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

function confirmationPrompt(subscriber: AdminSubscriber) {
  const candidate = subscriber.reconciliation_candidate;
  if (!candidate) return null;
  const value = (text: string | null) => text?.trim() || "—";

  return [
    "Confirmer ce rapprochement ?",
    "",
    "COMPTE INRCY",
    `Nom : ${displayName(subscriber)}`,
    `Société : ${value(subscriber.company_name)}`,
    `E-mail : ${value(subscriber.email)}`,
    `Téléphone : ${value(subscriber.phone)}`,
    "",
    "ABONNEMENT STRIPE",
    `Nom : ${value(candidate.name)}`,
    `E-mail : ${value(candidate.email)}`,
    `Téléphone : ${value(candidate.phone)}`,
    `Montant : ${formatMonthlyAmount(candidate.amount_eur)}`,
    `Statut : ${paymentStatusLabel(candidate.payment_status)}`,
    `Identifiant : ${candidate.stripe_subscription_id}`,
    "",
    "Le serveur revérifiera ces données avant de créer le lien.",
  ].join("\n");
}

function countMatchingStatuses(subscribers: AdminSubscriber[], statuses: Set<string>) {
  return subscribers.filter((subscriber) => statuses.has(normalizedStatus(subscriber.payment_status))).length;
}

function incompleteRevenueLabel(summary: SubscriberSummary, unverifiedCount: number) {
  const reasons: string[] = [];
  if (summary.unpricedActiveCount > 0) {
    reasons.push(
      `${summary.unpricedActiveCount} montant${summary.unpricedActiveCount > 1 ? "s" : ""} inconnu${summary.unpricedActiveCount > 1 ? "s" : ""}`,
    );
  }
  if (unverifiedCount > 0) {
    reasons.push(
      `${unverifiedCount} compte${unverifiedCount > 1 ? "s" : ""} non vérifié${unverifiedCount > 1 ? "s" : ""}`,
    );
  }
  return `estimation incomplète · ${reasons.join(" · ") || "rapprochements à contrôler"}`;
}

export default function AdminSubscribersClient() {
  const [subscribers, setSubscribers] = useState<AdminSubscriber[]>([]);
  const [summary, setSummary] = useState<SubscriberSummary>(EMPTY_SUMMARY);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverifiedCount, setUnverifiedCount] = useState(0);
  const [reconciliationAnomalyCount, setReconciliationAnomalyCount] = useState(0);
  const [stripeReconciliation, setStripeReconciliation] = useState<StripeReconciliation | null>(null);
  const [confirmingUserId, setConfirmingUserId] = useState<string | null>(null);
  const [confirmationNotice, setConfirmationNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

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
      const fallbackUnpricedActiveCount = rows.filter(
        (row) => normalizedStatus(row.payment_status) === "active" && row.amount_eur == null,
      ).length;
      const unpricedActiveCount = finiteNumber(
        payload.unpriced_active_count,
        fallbackUnpricedActiveCount,
      );
      setSubscribers(rows);
      setSummary({
        total: finiteNumber(payload.total, rows.length),
        activeCount: finiteNumber(payload.active_count, countMatchingStatuses(rows, ACTIVE_STATUSES)),
        paymentIssueCount: finiteNumber(
          payload.payment_issue_count,
          countMatchingStatuses(rows, PAYMENT_ISSUE_STATUSES),
        ),
        monthlyRevenueEur: finiteNumber(payload.monthly_revenue_eur),
        unpricedActiveCount,
        revenueComplete:
          typeof payload.revenue_complete === "boolean"
            ? payload.revenue_complete
            : unpricedActiveCount === 0,
      });
      setUnverifiedCount(finiteNumber(payload.unverified_count));
      setReconciliationAnomalyCount(finiteNumber(payload.reconciliation_anomaly_count));
      const stripeState = payload.stripe_reconciliation;
      setStripeReconciliation(stripeState ? {
        status: stripeState.status === "degraded" ? "degraded" : "fresh",
        matched_count: finiteNumber(stripeState.matched_count),
        ambiguous_count: finiteNumber(stripeState.ambiguous_count),
        unmatched_stripe_count: finiteNumber(stripeState.unmatched_stripe_count),
        review_required_count: finiteNumber(stripeState.review_required_count),
        subscriptions_scanned: finiteNumber(stripeState.subscriptions_scanned),
        stripe_pages: finiteNumber(stripeState.stripe_pages),
        supabase_pages: finiteNumber(stripeState.supabase_pages),
      } : null);
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

  const confirmReconciliation = useCallback(async (subscriber: AdminSubscriber) => {
    const stripeSubscriptionId = subscriber.stripe_subscription_id;
    const prompt = confirmationPrompt(subscriber);
    if (
      !stripeSubscriptionId ||
      !prompt ||
      subscriber.reconciliation_status !== "review_required" ||
      subscriber.reconciliation_candidate?.stripe_subscription_id !== stripeSubscriptionId
    ) return;
    const accepted = window.confirm(prompt);
    if (!accepted) return;

    setConfirmingUserId(subscriber.user_id);
    setConfirmationNotice(null);
    try {
      const response = await fetch("/api/admin/subscribers", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: subscriber.user_id,
          stripe_subscription_id: stripeSubscriptionId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as SubscribersPayload;
      if (!response.ok) {
        throw new Error(payload.error || payload.detail || "Impossible de confirmer ce rapprochement.");
      }

      await loadSubscribers(true);
      setConfirmationNotice({
        tone: "success",
        text: `${displayName(subscriber)} est maintenant rapproché de Stripe.`,
      });
    } catch (confirmationError: unknown) {
      setConfirmationNotice({
        tone: "error",
        text:
          confirmationError instanceof Error
            ? confirmationError.message
            : "Impossible de confirmer ce rapprochement.",
      });
    } finally {
      setConfirmingUserId(null);
    }
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
        subscriber.reconciliation_status,
        accountSourceLabel(subscriber),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("fr-FR")
        .includes(normalizedQuery),
    );
  }, [query, subscribers]);

  const liveBillingUnavailable = stripeReconciliation?.status === "degraded";
  const liveBillingPartial = !liveBillingUnavailable && unverifiedCount > 0;

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
          <article className={`${styles.metric} ${liveBillingUnavailable || liveBillingPartial ? styles.metricAlert : ""}`}>
            <span>Actifs</span>
            <strong>
              {liveBillingUnavailable ? "—" : liveBillingPartial ? `≥ ${summary.activeCount}` : summary.activeCount}
            </strong>
            <small>
              {liveBillingUnavailable
                ? "vérification Stripe indisponible"
                : liveBillingPartial
                  ? `${summary.activeCount} actif${summary.activeCount > 1 ? "s" : ""} confirmé${summary.activeCount > 1 ? "s" : ""} · ${unverifiedCount} non vérifié${unverifiedCount > 1 ? "s" : ""}`
                  : "abonnements actifs"}
            </small>
          </article>
          <article className={`${styles.metric} ${liveBillingUnavailable || liveBillingPartial || summary.paymentIssueCount > 0 ? styles.metricAlert : ""}`}>
            <span>À vérifier</span>
            <strong>
              {liveBillingUnavailable ? "—" : liveBillingPartial ? `≥ ${summary.paymentIssueCount}` : summary.paymentIssueCount}
            </strong>
            <small>
              {liveBillingUnavailable
                ? "vérification Stripe indisponible"
                : liveBillingPartial
                  ? `${summary.paymentIssueCount} incident${summary.paymentIssueCount > 1 ? "s" : ""} confirmé${summary.paymentIssueCount > 1 ? "s" : ""} · ${unverifiedCount} non vérifié${unverifiedCount > 1 ? "s" : ""}`
                  : "problèmes de paiement"}
            </small>
          </article>
          <article className={`${styles.metric} ${liveBillingUnavailable || !summary.revenueComplete ? styles.metricAlert : ""}`}>
            <span>Revenu mensuel</span>
            <strong>
              {liveBillingUnavailable
                ? "—"
                : liveBillingPartial
                  ? `≥ ${formatCurrency(summary.monthlyRevenueEur)}`
                  : formatCurrency(summary.monthlyRevenueEur)}
            </strong>
            <small>
              {liveBillingUnavailable
                ? "vérification Stripe indisponible"
                : summary.revenueComplete
                ? "revenu récurrent estimé"
                : incompleteRevenueLabel(summary, unverifiedCount)}
            </small>
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

        {confirmationNotice ? (
          <div
            className={confirmationNotice.tone === "success" ? styles.confirmationSuccess : styles.error}
            role={confirmationNotice.tone === "error" ? "alert" : "status"}
          >
            <span>{confirmationNotice.text}</span>
          </div>
        ) : null}

        {!loading && !error && stripeReconciliation?.status === "degraded" ? (
          <div className={styles.reconciliationWarning} role="status">
            <strong>Stripe est momentanément indisponible.</strong>
            <span>Les statuts non confirmés sont signalés comme tels, jamais comme « À jour ».</span>
          </div>
        ) : null}

        {!loading && !error && stripeReconciliation?.status === "fresh" && reconciliationAnomalyCount > 0 ? (
          <div className={styles.reconciliationWarning} role="status">
            <strong>{reconciliationAnomalyCount} rapprochement{reconciliationAnomalyCount > 1 ? "s" : ""} à contrôler.</strong>
            <span>
              {stripeReconciliation.unmatched_stripe_count} abonnement{stripeReconciliation.unmatched_stripe_count > 1 ? "s" : ""} Stripe à rapprocher
              {" · "}{stripeReconciliation.ambiguous_count} correspondance{stripeReconciliation.ambiguous_count > 1 ? "s" : ""} ambiguë{stripeReconciliation.ambiguous_count > 1 ? "s" : ""}
              {" · "}{stripeReconciliation.review_required_count} confirmation{stripeReconciliation.review_required_count > 1 ? "s" : ""} requise{stripeReconciliation.review_required_count > 1 ? "s" : ""}
              {" · "}{unverifiedCount} compte{unverifiedCount > 1 ? "s" : ""} non vérifié{unverifiedCount > 1 ? "s" : ""}
            </span>
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
                <article
                  className={styles.row}
                  key={subscriber.user_id}
                  data-payment-tone={paymentTone(status)}
                  data-reconciliation-tone={
                    subscriber.user_id.startsWith("stripe:") ||
                    subscriber.reconciliation_status === "ambiguous" ||
                    subscriber.reconciliation_status === "review_required" ||
                    subscriber.payment_status === "unverified"
                      ? "attention"
                      : "verified"
                  }
                >
                  <div className={styles.nameCell} data-label="Nom">
                    <span className={styles.avatar} aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase("fr-FR")}</span>
                    <div>
                      <strong title={name}>{name}</strong>
                      <small>{accountSourceLabel(subscriber)}</small>
                      {subscriber.reconciliation_status === "review_required" &&
                      subscriber.stripe_subscription_id &&
                      subscriber.reconciliation_candidate ? (
                        <button
                          type="button"
                          className={styles.confirmButton}
                          onClick={() => void confirmReconciliation(subscriber)}
                          disabled={confirmingUserId !== null}
                        >
                          {confirmingUserId === subscriber.user_id ? "Confirmation…" : "Confirmer le rapprochement"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className={styles.contactCell} data-label="E-mail">
                    {subscriber.email ? <a href={`mailto:${subscriber.email}`}>{subscriber.email}</a> : <span>Non renseigné</span>}
                  </div>

                  <div className={styles.contactCell} data-label="Téléphone">
                    {subscriber.phone ? <a href={`tel:${subscriber.phone}`}>{subscriber.phone}</a> : <span>Non renseigné</span>}
                  </div>

                  <div className={styles.amountCell} data-label="Montant">
                    <strong>
                      {subscriber.payment_status === "unverified"
                        ? "—"
                        : formatMonthlyAmount(subscriber.amount_eur)}
                    </strong>
                    <small>
                      {subscriber.payment_status === "unverified"
                        ? "Montant Supabase non confirmé"
                        : billingCycleLabel(subscriber.billing_cycle)}
                    </small>
                  </div>

                  <div className={styles.statusCell} data-label="Statut paiement">
                    <span className={styles.statusBadge}>{paymentStatusLabel(subscriber.payment_status)}</span>
                    <small>{paymentSourceLabel(subscriber)}</small>
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
