"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

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
  const [invoices, setInvoices] = useState<StripeInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

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

  const linkStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,.18)",
    color: "white",
    background: "rgba(255,255,255,.06)",
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
  };

  return (
    <section
      aria-labelledby="subscription-invoices-title"
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 14,
        border: "1px solid rgba(61, 222, 255, 0.18)",
        background: "rgba(0, 200, 255, 0.045)",
        display: "grid",
        gap: 10,
      }}
    >
      <div>
        <h3 id="subscription-invoices-title" style={{ margin: 0, fontSize: 15 }}>
          {i18nT("factures_stripe_abonnement_titre_2d6f8a10")}
        </h3>
        <p style={{ margin: "6px 0 0", opacity: 0.78, lineHeight: 1.45, fontSize: 12 }}>
          {i18nT("factures_stripe_abonnement_description_5a1c9e32")}
        </p>
      </div>

      {loading ? (
        <div style={{ opacity: 0.78, fontSize: 13 }}>{i18nT("factures_stripe_chargement_0f7b3c21")}</div>
      ) : error ? (
        <div>
          <p style={{ margin: "0 0 10px", color: "#ffb4b4", fontSize: 13 }}>{error}</p>
          <button type="button" onClick={() => setReloadToken((value) => value + 1)} style={linkStyle}>
            {i18nT("factures_stripe_reessayer_9c4e1a70")}
          </button>
        </div>
      ) : invoices.length === 0 ? (
        <div style={{ opacity: 0.78, fontSize: 13 }}>{i18nT("factures_stripe_aucune_6b2d8f14")}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ opacity: 0.78, textAlign: "left" }}>
                <th style={{ padding: "8px 6px" }}>{i18nT("facture_stripe_numero_1f6a3c20")}</th>
                <th style={{ padding: "8px 6px" }}>{i18nT("facture_stripe_date_2c7a1e54")}</th>
                <th style={{ padding: "8px 6px" }}>{i18nT("facture_stripe_periode_4c8e2a61")}</th>
                <th style={{ padding: "8px 6px" }}>{i18nT("facture_stripe_statut_5d9b3c12")}</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>{i18nT("facture_stripe_total_8a4e6d20")}</th>
                <th style={{ padding: "8px 6px" }} />
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} style={{ borderTop: "1px solid rgba(255,255,255,.10)" }}>
                  <td style={{ padding: "10px 6px", fontWeight: 800 }}>{invoice.number || invoice.id}</td>
                  <td style={{ padding: "10px 6px" }}>{formatDate(invoice.created, locale)}</td>
                  <td style={{ padding: "10px 6px" }}>{formatPeriod(invoice.periodStart, invoice.periodEnd, locale)}</td>
                  <td style={{ padding: "10px 6px" }}>{statusLabel(invoice.status, i18nT)}</td>
                  <td style={{ padding: "10px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatAmount(invoice.total ?? invoice.amountPaid, invoice.currency, locale)}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "right" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
                      {invoice.hostedInvoiceUrl ? (
                        <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                          {i18nT("facture_stripe_voir_7a1d5c30")}
                        </a>
                      ) : null}
                      {invoice.invoicePdf ? (
                        <a href={invoice.invoicePdf} target="_blank" rel="noreferrer" style={linkStyle}>
                          {i18nT("facture_stripe_pdf_3e8b2a61")}
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
