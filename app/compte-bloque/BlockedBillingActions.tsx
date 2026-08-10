"use client";

import { useState } from "react";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import type { BillingCycle } from "@/lib/subscriptionOffers";
import styles from "./compte-bloque.module.css";

type Props = {
  status: string;
  edition: DashboardEdition;
  hasStripeCustomer: boolean;
  contactHref: string;
};

async function apiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || "L’opération n’a pas pu être réalisée.";
}

export default function BlockedBillingActions({ status, edition, hasStripeCustomer, contactHref }: Props) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const normalizedStatus = status.trim().toLowerCase();
  const canSubscribe =
    edition === "standard" &&
    ["trial_expired", "trial-expired", "canceled", "cancelled", "incomplete_expired"].includes(normalizedStatus);
  const canOpenPortal =
    hasStripeCustomer && ["past_due", "unpaid", "incomplete"].includes(normalizedStatus);

  async function startCheckout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "Standard", billingCycle: cycle }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      const body = (await response.json()) as { url?: string };
      if (!body.url) throw new Error("La page de paiement n’a pas pu être ouverte.");
      window.location.assign(body.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le paiement est indisponible.");
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      if (!response.ok) throw new Error(await apiError(response));
      const body = (await response.json()) as { url?: string };
      if (!body.url) throw new Error("Le portail de facturation n’a pas pu être ouvert.");
      window.location.assign(body.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le portail de facturation est indisponible.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.recoveryBlock}>
      {canSubscribe ? (
        <>
          <div className={styles.cyclePicker} aria-label="Périodicité de l’abonnement">
            <button
              type="button"
              className={cycle === "monthly" ? styles.cycleActive : styles.cycleButton}
              onClick={() => setCycle("monthly")}
              disabled={busy}
            >
              Mensuel · 69 € TTC
            </button>
            <button
              type="button"
              className={cycle === "yearly" ? styles.cycleActive : styles.cycleButton}
              onClick={() => setCycle("yearly")}
              disabled={busy}
            >
              Annuel · 730 € TTC · −12 %
            </button>
          </div>
          <button type="button" className={styles.primaryBtn} onClick={startCheckout} disabled={busy}>
            {busy ? "Ouverture…" : "Réactiver avec iNrCy Standard"}
          </button>
        </>
      ) : canOpenPortal ? (
        <button type="button" className={styles.primaryBtn} onClick={openPortal} disabled={busy}>
          {busy ? "Ouverture…" : "Régulariser mon paiement"}
        </button>
      ) : (
        <a href={contactHref} className={styles.primaryBtn}>Contacter iNrCy</a>
      )}
      {error ? <div className={styles.recoveryError}>{error}</div> : null}
    </div>
  );
}
