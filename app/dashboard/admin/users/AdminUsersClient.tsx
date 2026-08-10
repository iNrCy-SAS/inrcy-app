"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import styles from "./users.module.css";

type RoleFilter = "all" | "user" | "admin" | "staff";
type StatusFilter =
  | "all"
  | "none"
  | "trialing"
  | "active"
  | "trial_expired"
  | "paused"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired";

type AdminUserRow = {
  user_id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  last_active_at: string | null;
  email_confirmed_at: string | null;
  role: string | null;
  is_hard_admin: boolean;
  profile: {
    admin_email?: string | null;
    contact_email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    company_legal_name?: string | null;
    phone?: string | null;
    role?: string | null;
    last_active_at?: string | null;
    updated_at?: string | null;
  } | null;
  subscription: {
    contact_email?: string | null;
    app_edition?: string | null;
    plan?: string | null;
    scheduled_plan?: string | null;
    status?: string | null;
    monthly_price_eur?: number | null;
    start_date?: string | null;
    trial_start_at?: string | null;
    trial_end_at?: string | null;
    next_renewal_date?: string | null;
    cancel_requested_at?: string | null;
    end_date?: string | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    stripe_price_id?: string | null;
    founder_offer_enabled?: boolean | null;
    updated_at?: string | null;
  } | null;
  multi_account: {
    multi_account_enabled: boolean;
    max_establishments: number;
    account_count: number;
    updated_at?: string | null;
  };
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "none", label: "Sans abonnement" },
  { value: "trialing", label: "Essai en cours" },
  { value: "active", label: "Actif" },
  { value: "trial_expired", label: "Essai terminé" },
  { value: "paused", label: "En pause" },
  { value: "past_due", label: "Paiement en retard" },
  { value: "unpaid", label: "Impayé" },
  { value: "canceled", label: "Résilié" },
  { value: "incomplete", label: "Activation en attente" },
  { value: "incomplete_expired", label: "Activation expirée" },
];

const EDITABLE_STATUS_OPTIONS = STATUS_OPTIONS.filter((option) => option.value !== "all" && option.value !== "none");

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("fr-FR");
}

function statusLabel(status?: string | null) {
  const match = STATUS_OPTIONS.find((option) => option.value === status);
  return match?.label || status || "Sans statut";
}

function editionLabel(edition?: string | null) {
  return String(edition || "").trim().toLowerCase() === "standard" ? "Standard" : "Premium";
}

function fullName(user: AdminUserRow) {
  const first = user.profile?.first_name?.trim() || "";
  const last = user.profile?.last_name?.trim() || "";
  return [first, last].filter(Boolean).join(" ") || "—";
}

function companyName(user: AdminUserRow) {
  return user.profile?.company_legal_name?.trim() || "Société non renseignée";
}

function daysUntil(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const delta = Math.ceil((date.getTime() - Date.now()) / (24 * 3600 * 1000));
  return delta;
}

export default function AdminUsersClient() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const load = useCallback(async (isRefresh = false) => {
    setError(null);
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("limit", "200");
      params.set("status", statusFilter);
      params.set("role", roleFilter);
      if (q.trim()) params.set("q", q.trim());

      const response = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Impossible de charger les comptes utilisateurs.");
      setUsers((json.users ?? []) as AdminUserRow[]);
    } catch (e: any) {
      setError(getClientUserFacingErrorMessage(e, "Impossible de charger les comptes utilisateurs."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [q, roleFilter, statusFilter]);

  useEffect(() => {
    load(false);
  }, [load]);

  const metrics = useMemo(() => {
    const active = users.filter((user) => user.subscription?.status === "active").length;
    const trialing = users.filter((user) => user.subscription?.status === "trialing").length;
    const blocked = users.filter((user) =>
      ["trial_expired", "paused", "past_due", "unpaid", "canceled", "cancelled", "incomplete", "incomplete_expired"].includes(
        String(user.subscription?.status || "")
      )
    ).length;
    const admins = users.filter((user) => user.role === "admin").length;

    return { total: users.length, active, trialing, blocked, admins };
  }, [users]);

  async function patchUser(userId: string, payload: Record<string, unknown>, successMessage: string) {
    setSavingId(userId);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, ...payload }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Mise à jour impossible.");
      setSuccess(successMessage);
      await load(true);
    } catch (e: any) {
      setError(getClientUserFacingErrorMessage(e, "Mise à jour impossible."));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <section className={styles.heroCard}>
          <div className={styles.heroContent}>
            <div className={styles.kicker}>Administration iNrCy</div>
            <h1 className={styles.title}>Comptes utilisateurs</h1>
            <p className={styles.subtitle}>
              Gestion des comptes, rôles, abonnements et droits multicompte.
            </p>
          </div>

          <div className={styles.headerActions}>
            <button type="button" className={`${styles.ghostButton} ${styles.refreshButton}`} onClick={() => load(true)} disabled={refreshing} aria-label="Rafraîchir">
              <span className={styles.actionIcon} aria-hidden="true">↻</span>
              <span className={styles.actionLabel}>{refreshing ? "Rafraîchissement…" : "Rafraîchir"}</span>
            </button>
            <Link href="/dashboard/admin" className={`${styles.closeButton} ${styles.closeIconButton}`} aria-label="Fermer">
              <span className={styles.actionIcon} aria-hidden="true">×</span>
              <span className={styles.actionLabel}>Fermer</span>
            </Link>
          </div>
        </section>

        <section className={styles.metricsGrid}>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Comptes affichés</span>
            <strong className={styles.metricValue}>{metrics.total}</strong>
            <small className={styles.metricSub}>Vue filtrée</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Abonnements actifs</span>
            <strong className={styles.metricValue}>{metrics.active}</strong>
            <small className={styles.metricSub}>Status active</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Essais en cours</span>
            <strong className={styles.metricValue}>{metrics.trialing}</strong>
            <small className={styles.metricSub}>Trialing</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Comptes bloqués</span>
            <strong className={styles.metricValue}>{metrics.blocked}</strong>
            <small className={styles.metricSub}>{metrics.admins} admin(s)</small>
          </article>
        </section>

        <section className={styles.filterCard}>
          <div className={styles.sectionTop}>
            <div>
              <h2>Filtres de comptes</h2>
              
            </div>
          </div>

          <div className={styles.filters}>
            <label className={styles.label}>
              <span>Statut abonnement</span>
              <select className={styles.select} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className={styles.label}>
              <span>Rôle</span>
              <select className={styles.select} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}>
                <option value="all">Tous</option>
                <option value="user">Utilisateur</option>
                <option value="admin">Admin</option>
                <option value="staff">Staff</option>
              </select>
            </label>

            <label className={styles.label}>
              <span>Recherche</span>
              <input
                className={styles.input}
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="email, société, user_id…"
              />
            </label>

            <button type="button" className={styles.primaryButton} onClick={() => load(true)}>
              Appliquer
            </button>
          </div>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}
        {success ? <div className={styles.success}>{success}</div> : null}

        <section className={styles.tableCard}>
          <div className={styles.sectionTop}>
            <div>
              <h2>Liste des comptes</h2>
              <p>{loading ? "Chargement…" : `${users.length} compte(s) affiché(s)`}</p>
            </div>
          </div>

          {loading ? (
            <div className={styles.loading}>Chargement des comptes utilisateurs…</div>
          ) : users.length === 0 ? (
            <div className={styles.empty}>Aucun compte pour ces filtres.</div>
          ) : (
            <div className={styles.usersList}>
              {users.map((user) => {
                const subscription = user.subscription;
                const trialRemaining = daysUntil(subscription?.trial_end_at);
                const isExpanded = expandedId === user.user_id;
                const isSaving = savingId === user.user_id;

                return (
                  <article key={user.user_id} className={styles.userCard}>
                    <div className={styles.userMain}>
                      <div className={styles.avatar} aria-hidden="true">
                        {(companyName(user)[0] || user.email?.[0] || "?").toUpperCase()}
                      </div>

                      <div className={styles.userIdentity}>
                        <div className={styles.userTitleRow}>
                          <strong>{companyName(user)}</strong>
                          {user.is_hard_admin ? <span className={styles.adminPill}>Admin principal</span> : null}
                          {user.multi_account?.multi_account_enabled ? (
                            <span className={styles.multiAccountPill}>Multicompte · {user.multi_account.account_count}/{user.multi_account.max_establishments}</span>
                          ) : null}
                        </div>
                        <span>{user.email || "Email non renseigné"}</span>
                        <small>{fullName(user)} · {user.profile?.phone || "Téléphone non renseigné"}</small>
                      </div>

                      <div className={styles.statusStack}>
                        <span className={`${styles.statusPill} ${styles[`status_${subscription?.status || "none"}`] || ""}`}>
                          {statusLabel(subscription?.status)}
                        </span>
                        <small>{editionLabel(subscription?.app_edition)} · {subscription?.plan || "Plan non renseigné"}</small>
                      </div>

                      <div className={styles.dateStack}>
                        <span>Créé le {formatDate(user.created_at)}</span>
                        <small>Dernière connexion : {formatDateTime(user.last_active_at)}</small>
                      </div>

                      <div className={styles.quickActions}>
                        <button type="button" className={styles.smallGhostButton} onClick={() => setExpandedId(isExpanded ? null : user.user_id)}>
                          {isExpanded ? "Réduire" : "Détails"}
                        </button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div className={styles.detailsPanel}>
                        <div className={styles.detailsGrid}>
                          <div className={styles.detailBox}>
                            <span>Rôle</span>
                            <select
                              className={styles.miniSelect}
                              value={user.role || "user"}
                              disabled={isSaving || user.is_hard_admin}
                              onChange={(event) => patchUser(user.user_id, { role: event.target.value }, "Rôle mis à jour.")}
                            >
                              <option value="user">user</option>
                              <option value="admin">admin</option>
                            </select>
                          </div>

                          <div className={styles.detailBox}>
                            <span>Édition iNrCy</span>
                            <select
                              className={styles.miniSelect}
                              value={String(subscription?.app_edition || "premium").toLowerCase()}
                              disabled={isSaving || !subscription}
                              onChange={(event) => patchUser(user.user_id, { app_edition: event.target.value }, "Édition iNrCy mise à jour.")}
                            >
                              <option value="standard">Standard</option>
                              <option value="premium">Premium</option>
                            </select>
                          </div>

                          <div className={styles.detailBox}>
                            <span>Statut abonnement</span>
                            <select
                              className={styles.miniSelect}
                              value={(subscription?.status as StatusFilter) || "trialing"}
                              disabled={isSaving || !subscription}
                              onChange={(event) => patchUser(user.user_id, { subscription_status: event.target.value }, "Statut abonnement mis à jour.")}
                            >
                              {EDITABLE_STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </div>

                          <div className={styles.detailBox}>
                            <span>Offre fondateur</span>
                            <button
                              type="button"
                              className={subscription?.founder_offer_enabled ? styles.smallButton : styles.smallGhostButton}
                              disabled={isSaving || !subscription}
                              onClick={() => patchUser(user.user_id, { founder_offer_enabled: !subscription?.founder_offer_enabled }, "Offre fondateur mise à jour.")}
                            >
                              {subscription?.founder_offer_enabled ? "Activée" : "Désactivée"}
                            </button>
                          </div>

                          <div className={styles.detailBox}>
                            <span>Mode multicompte</span>
                            <button
                              type="button"
                              className={user.multi_account?.multi_account_enabled ? styles.smallButton : styles.smallGhostButton}
                              disabled={isSaving}
                              onClick={() => patchUser(
                                user.user_id,
                                { multi_account_enabled: !user.multi_account?.multi_account_enabled },
                                "Mode multicompte mis à jour.",
                              )}
                            >
                              {user.multi_account?.multi_account_enabled ? "TRUE · Activé" : "FALSE · Désactivé"}
                            </button>
                            <small>{user.multi_account?.account_count || 1} établissement(s) existant(s)</small>
                          </div>

                          <div className={styles.detailBox}>
                            <span>Maximum établissements</span>
                            <input
                              key={`${user.user_id}:${user.multi_account?.max_establishments || 1}`}
                              className={styles.miniNumberInput}
                              type="number"
                              min={Math.max(1, user.multi_account?.account_count || 1)}
                              max={100}
                              defaultValue={Math.max(1, user.multi_account?.max_establishments || 1)}
                              disabled={isSaving}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              onBlur={(event) => {
                                const next = Number(event.currentTarget.value);
                                const current = Math.max(1, user.multi_account?.max_establishments || 1);
                                if (!Number.isInteger(next) || next === current) {
                                  event.currentTarget.value = String(current);
                                  return;
                                }
                                void patchUser(
                                  user.user_id,
                                  { max_establishments: next },
                                  "Nombre maximum d’établissements mis à jour.",
                                );
                              }}
                            />
                            <small>Minimum actuel : {Math.max(1, user.multi_account?.account_count || 1)}</small>
                          </div>

                          <div className={styles.detailBox}>
                            <span>Fin essai</span>
                            <strong>{formatDate(subscription?.trial_end_at)}</strong>
                            <small>
                              {trialRemaining === null ? "Aucune date" : trialRemaining >= 0 ? `${trialRemaining} jour(s) restant(s)` : `Dépassé de ${Math.abs(trialRemaining)} jour(s)`}
                            </small>
                          </div>

                          <div className={styles.detailBox}>
                            <span>Prochain renouvellement</span>
                            <strong>{formatDate(subscription?.next_renewal_date)}</strong>
                            <small>{subscription?.monthly_price_eur ? `${subscription.monthly_price_eur} € / mois` : "Montant non renseigné"}</small>
                          </div>

                          <div className={styles.detailBoxWide}>
                            <span>User ID</span>
                            <code>{user.user_id}</code>
                            <small>Stripe : {subscription?.stripe_subscription_id || subscription?.stripe_customer_id || "—"}</small>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
