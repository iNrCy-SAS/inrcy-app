"use client";

import styles from "./adminOrders.module.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { boutiqueOrderTotals, boutiqueStoredTaxLabel, formatStoredBoutiqueAmounts } from "@/lib/boutique/orderAmounts";

type OrderStatus = "pending" | "processed";
type OrderMethod = "EUR" | "UI";

type BoutiqueOrderRow = {
  id: string;
  created_at: string;
  user_id: string;
  account_email: string | null;
  admin_email: string | null;
  product_key: string;
  product_name: string;
  method: OrderMethod;
  amount_eur: number | null;
  amount_eur_tax_behavior: "exclusive" | "inclusive" | null;
  amount_ui: number | null;
  status: OrderStatus;
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("fr-FR");
  } catch {
    return iso;
  }
}

function statusLabel(status: OrderStatus) {
  return status === "processed" ? "Traitée" : "En cours";
}

function csvCell(value: unknown) {
  const text = String(value ?? "").replaceAll('"', '""');
  return `"${text}"`;
}

function downloadCsv(rows: BoutiqueOrderRow[]) {
  const headers = ["Date", "Produit", "Clé produit", "Méthode", "Montant €", "Base montant €", "Montant UI", "Statut", "Compte", "Admin", "User ID"];
  const body = rows.map((row) =>
    [
      fmtDate(row.created_at),
      row.product_name,
      row.product_key,
      row.method,
      row.amount_eur ?? "",
      row.amount_eur === null ? "" : boutiqueStoredTaxLabel(row.amount_eur_tax_behavior),
      row.amount_ui ?? "",
      statusLabel(row.status),
      row.account_email ?? "",
      row.admin_email ?? "",
      row.user_id,
    ].map(csvCell).join(";")
  );
  const csv = [headers.map(csvCell).join(";"), ...body].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `commandes-inrcy-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdminOrdersClient() {
  const [rows, setRows] = useState<BoutiqueOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("pending");
  const [methodFilter, setMethodFilter] = useState<"all" | OrderMethod>("all");
  const [q, setQ] = useState("");

  const load = useCallback(
    async (isRefresh = false) => {
      setError(null);
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const params = new URLSearchParams();
        params.set("status", statusFilter);
        params.set("method", methodFilter);
        params.set("q", q.trim());
        params.set("limit", "300");

        const response = await fetch(`/api/admin/orders?${params.toString()}`, { cache: "no-store" });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json?.error || "Impossible de charger les commandes.");

        setRows((json.orders ?? []) as BoutiqueOrderRow[]);
      } catch (e: any) {
        setError(getClientUserFacingErrorMessage(e, "Impossible de charger les commandes."));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [methodFilter, q, statusFilter]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const updateStatus = useCallback(async (id: string, status: OrderStatus) => {
    setSavingId(id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Impossible de mettre à jour la commande.");

      const updated = json.order as BoutiqueOrderRow;
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setSuccess(status === "processed" ? "Commande marquée comme traitée." : "Commande remise en cours.");
    } catch (e: any) {
        setError(getClientUserFacingErrorMessage(e, "Impossible de mettre à jour la commande."));
    } finally {
      setSavingId(null);
    }
  }, []);

  const resetFilters = useCallback(() => {
    setStatusFilter("pending");
    setMethodFilter("all");
    setQ("");
  }, []);

  const metrics = useMemo(() => {
    const pending = rows.filter((r) => r.status === "pending").length;
    const processed = rows.filter((r) => r.status === "processed").length;
    return { pending, processed, total: rows.length, ...boutiqueOrderTotals(rows) };
  }, [rows]);

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <section className={styles.heroCard}>
          <div className={styles.heroContent}>
            <div className={styles.kicker}>Dashboard admin</div>
            <h1 className={styles.title}>Commandes Boutique</h1>
            <p className={styles.subtitle}>
              Suivi des commandes iNrCy.
            </p>
          </div>

          <div className={styles.headerActions}>
            <button type="button" onClick={() => load(true)} className={`${styles.ghostButton} ${styles.refreshButton}`} disabled={refreshing} aria-label="Rafraîchir">
              <span className={styles.actionIcon} aria-hidden="true">↻</span>
              <span className={styles.actionLabel}>{refreshing ? "Rafraîchissement…" : "Rafraîchir"}</span>
            </button>
            <Link className={`${styles.closeButton} ${styles.closeIconButton}`} href="/dashboard/admin" aria-label="Fermer">
              <span className={styles.actionIcon} aria-hidden="true">×</span>
              <span className={styles.actionLabel}>Fermer</span>
            </Link>
          </div>
        </section>

        <section className={styles.metricsGrid}>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>En cours</span>
            <strong className={styles.metricValue}>{metrics.pending}</strong>
            <small className={styles.metricSub}>Commandes à traiter</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Traitées</span>
            <strong className={styles.metricValue}>{metrics.processed}</strong>
            <small className={styles.metricSub}>Sur la vue affichée</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Montant HT</span>
            <strong className={styles.metricValue}>{metrics.eurHt.toLocaleString("fr-FR")} € HT</strong>
            <small className={styles.metricSub}>Euros seuls et offres euros + UI</small>
            {metrics.eurTtc > 0 ? <small className={styles.metricSub}>{metrics.eurTtc.toLocaleString("fr-FR")} € TTC, séparés du total HT</small> : null}
            {metrics.eurUnclassified > 0 ? <small className={styles.metricSub}>{metrics.eurUnclassified.toLocaleString("fr-FR")} € historiques, base non renseignée</small> : null}
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Montant UI</span>
            <strong className={styles.metricValue}>{metrics.ui.toFixed(0)} UI</strong>
            <small className={styles.metricSub}>{metrics.total} ligne(s) chargée(s)</small>
          </article>
        </section>

        <section className={styles.filterCard}>
          <div className={styles.sectionTopRow}>
            <div>
              <h2>Filtres de gestion</h2>
              
            </div>
            <div className={styles.sectionActions}>
              <button type="button" className={styles.ghostSmallButton} onClick={resetFilters}>
                Réinitialiser
              </button>
              <button type="button" className={styles.ghostSmallButton} onClick={() => downloadCsv(rows)} disabled={!rows.length}>
                Export CSV
              </button>
            </div>
          </div>

          <div className={styles.filters}>
            <label className={styles.label}>
              <span>Statut</span>
              <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
                <option value="pending">En cours</option>
                <option value="processed">Traitée</option>
                <option value="all">Toutes</option>
              </select>
            </label>

            <label className={styles.label}>
              <span>Méthode</span>
              <select className={styles.select} value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as any)}>
                <option value="all">Toutes</option>
                <option value="EUR">EUR</option>
                <option value="UI">UI</option>
              </select>
            </label>

            <label className={styles.label}>
              <span>Recherche</span>
              <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="email, user_id, produit…" />
            </label>

            <button type="button" className={styles.primaryButton} onClick={() => load(true)}>
              Appliquer
            </button>
          </div>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}
        {success ? <div className={styles.success}>{success}</div> : null}

        <section className={styles.tableCard}>
          <div className={styles.sectionTopRow}>
            <div>
              <h2>Liste des commandes</h2>
              <p>{loading ? "Chargement…" : `${rows.length} commande(s) affichée(s)`}</p>
            </div>
          </div>

          {loading ? (
            <div className={styles.loading}>Chargement des commandes…</div>
          ) : rows.length === 0 ? (
            <div className={styles.empty}>Aucune commande pour ce filtre.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Produit</th>
                    <th>Méthode</th>
                    <th>Montant</th>
                    <th>Statut</th>
                    <th>Compte</th>
                    <th>User ID</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const amount = formatStoredBoutiqueAmounts(row);
                    const processing = savingId === row.id;
                    return (
                      <tr key={row.id}>
                        <td className={styles.mono}>{fmtDate(row.created_at)}</td>
                        <td>
                          <div className={styles.productName}>{row.product_name}</div>
                          <div className={styles.productKey}>{row.product_key}</div>
                        </td>
                        <td>
                          <span className={row.method === "EUR" ? styles.badgeEur : styles.badgeUi}>{row.method}</span>
                        </td>
                        <td className={styles.mono}>{amount}</td>
                        <td>
                          <span className={row.status === "processed" ? styles.badgeOk : styles.badgePending}>
                            {statusLabel(row.status)}
                          </span>
                        </td>
                        <td>
                          <div className={styles.email}>{row.account_email || "—"}</div>
                          <div className={styles.emailSub}>Admin: {row.admin_email || "—"}</div>
                        </td>
                        <td className={styles.mono}>{row.user_id}</td>
                        <td className={styles.actions}>
                          {row.status === "pending" ? (
                            <button type="button" className={styles.process} onClick={() => updateStatus(row.id, "processed")} disabled={processing}>
                              {processing ? "Traitement…" : "Marquer traitée"}
                            </button>
                          ) : (
                            <button type="button" className={styles.secondaryAction} onClick={() => updateStatus(row.id, "pending")} disabled={processing}>
                              {processing ? "…" : "Remettre en cours"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
