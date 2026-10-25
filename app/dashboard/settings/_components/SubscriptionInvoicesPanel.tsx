"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import styles from "./subscriptionWorkspace.module.css";

type StripeInvoice = {
  id: string;
  number: string | null;
  status: string;
  currency: string;
  total: number | null;
  amountPaid: number | null;
  created: number | null;
  periodStart: number | null;
  periodEnd: number | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

type InvoiceResponse = {
  invoices?: StripeInvoice[];
  error?: string;
};

function formatDate(timestamp: number | null, locale: string) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(timestamp * 1000));
}

function formatPeriod(start: number | null, end: number | null, locale: string) {
  if (!start && !end) return "—";
  return `${formatDate(start, locale)} → ${formatDate(end, locale)}`;
}

function formatAmount(amount: number | null, currency: string, locale: string) {
  if (amount === null) return "—";
  const safeCurrency = /^[a-z]{3}$/i.test(currency) ? currency.toUpperCase() : "EUR";
  return new Intl.NumberFormat(locale, { style: "currency", currency: safeCurrency }).format(amount / 100);
}

function statusLabel(status: string, i18nT: (key: string) => string) {
  switch (status.trim().toLowerCase()) {
    case "paid":
      return i18nT("facture_stripe_statut_payee_8fb3a12e");
    case "open":
      return i18nT("facture_stripe_statut_ouverte_4a2d7c90");
    case "draft":
      return i18nT("facture_stripe_statut_brouillon_6d1e9f42");
    case "void":
      return i18nT("facture_stripe_statut_annulee_3e7b5c18");
    case "uncollectible":
      return i18nT("facture_stripe_statut_irrecouvrable_1c9d4e70");
    default:
      return status;
  }
}

export default function SubscriptionInvoicesPanel() {
  const i18nT = useTranslations("settings");
  const locale = useLocale();
  const shellT = useTranslations("shell");
  const [invoices, setInvoices] = useState<StripeInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInvoices() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/billing/invoices", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as InvoiceResponse;
        if (!response.ok) {
          throw new Error(payload.error || i18nT("factures_stripe_erreur_7e2a5c11"));
        }
        setInvoices(Array.isArray(payload.invoices) ? payload.invoices : []);
      } catch (cause: unknown) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : i18nT("factures_stripe_erreur_7e2a5c11"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadInvoices();
    return () => controller.abort();
  }, [i18nT, reloadToken]);

  const pageSize = 5;
  const pageCount = Math.max(1, Math.ceil(invoices.length / pageSize));
  const activePage = Math.min(page, pageCount - 1);
  const visibleInvoices = invoices.slice(activePage * pageSize, (activePage + 1) * pageSize);

  return (
    <section aria-labelledby="subscription-invoices-title" className={styles.invoicesCard}>
      <header className={styles.invoicesHeader}>
        <span className={styles.invoiceMark} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 3h9l4 4v14H6V3Z" /><path d="M14 3v5h5M9 12h7m-7 4h7" /></svg></span>
        <div><h2 id="subscription-invoices-title">{i18nT("factures_stripe_abonnement_titre_2d6f8a10")}</h2>
          <p>{i18nT("factures_stripe_abonnement_description_5a1c9e32")}</p></div>
        {!loading && !error ? <span className={styles.invoiceCount}>{invoices.length.toLocaleString(locale)}</span> : null}
      </header>
      {loading ? <div className={styles.invoiceEmpty} role="status">{i18nT("factures_stripe_chargement_0f7b3c21")}</div>
      : error ? <div className={styles.invoiceEmpty} role="alert"><p>{error}</p><button type="button" onClick={() => setReloadToken((value) => value + 1)} className={styles.invoiceLink}>{i18nT("factures_stripe_reessayer_9c4e1a70")}</button></div>
      : invoices.length === 0 ? <div className={styles.invoiceEmpty}>{i18nT("factures_stripe_aucune_6b2d8f14")}</div>
      : <>
        <table className={styles.invoiceTable}>
          <thead><tr>
            <th>{i18nT("facture_stripe_numero_1f6a3c20")}</th>
            <th>{i18nT("facture_stripe_date_2c7a1e54")}</th>
            <th>{i18nT("facture_stripe_periode_4c8e2a61")}</th>
            <th>{i18nT("facture_stripe_statut_5d9b3c12")}</th>
            <th>{i18nT("facture_stripe_total_8a4e6d20")}</th>
            <th><span className={styles.visuallyHidden}>{i18nT("facture_stripe_voir_7a1d5c30")}</span></th>
          </tr></thead>
          <tbody>{visibleInvoices.map((invoice) => <tr key={invoice.id}>
            <td data-label={i18nT("facture_stripe_numero_1f6a3c20")}><strong>{invoice.number || invoice.id}</strong></td>
            <td data-label={i18nT("facture_stripe_date_2c7a1e54")}>{formatDate(invoice.created, locale)}</td>
            <td data-label={i18nT("facture_stripe_periode_4c8e2a61")}>{formatPeriod(invoice.periodStart, invoice.periodEnd, locale)}</td>
            <td data-label={i18nT("facture_stripe_statut_5d9b3c12")}><span className={styles.invoiceStatus} data-status={invoice.status}>{statusLabel(invoice.status, i18nT)}</span></td>
            <td data-label={i18nT("facture_stripe_total_8a4e6d20")} className={styles.invoiceAmount}>{formatAmount(invoice.total ?? invoice.amountPaid, invoice.currency, locale)}</td>
            <td><div className={styles.invoiceLinks}>
              {invoice.hostedInvoiceUrl ? <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer" className={styles.invoiceLink}>{i18nT("facture_stripe_voir_7a1d5c30")}</a> : null}
              {invoice.invoicePdf ? <a href={invoice.invoicePdf} target="_blank" rel="noreferrer" className={styles.invoiceLink}>{i18nT("facture_stripe_pdf_3e8b2a61")}</a> : null}
            </div></td>
          </tr>)}</tbody>
        </table>
        <nav className={styles.invoicePagination} aria-label={i18nT("factures_stripe_abonnement_titre_2d6f8a10")}>
          <span aria-live="polite">{(activePage * pageSize + 1).toLocaleString(locale)}–{Math.min((activePage + 1) * pageSize, invoices.length).toLocaleString(locale)} / {invoices.length.toLocaleString(locale)}</span>
          <div><button type="button" className={styles.invoiceLink} aria-label={shellT("element_precedent_358f9c1e")} disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>‹</button>
            <span>{activePage + 1} / {pageCount}</span>
            <button type="button" className={styles.invoiceLink} aria-label={shellT("element_suivant_9d61e569")} disabled={activePage + 1 >= pageCount} onClick={() => setPage(activePage + 1)}>›</button></div>
        </nav>
      </>}
    </section>
  );
}