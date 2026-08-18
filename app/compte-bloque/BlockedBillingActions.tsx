"use client";

import { useTranslations } from "next-intl";


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

async function apiError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
}

export default function BlockedBillingActions({ status, edition, hasStripeCustomer, contactHref }: Props) {
  const i18nT = useTranslations("public");
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
      if (!response.ok) throw new Error(await apiError(response, i18nT("l_operation_n_a_pas_pu_2eda8de6")));
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
      if (!response.ok) throw new Error(await apiError(response, i18nT("l_operation_n_a_pas_pu_2eda8de6")));
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
          <div className={styles.cyclePicker} aria-label={i18nT("periodicite_de_l_abonnement_625a0573")}>
            <button
              type="button"
              className={cycle === "monthly" ? styles.cycleActive : styles.cycleButton}
              onClick={() => setCycle("monthly")}
              disabled={busy}
            >
              {i18nT("mensuel_69_ttc_6c947c24")}{" "}</button>
            <button
              type="button"
              className={cycle === "yearly" ? styles.cycleActive : styles.cycleButton}
              onClick={() => setCycle("yearly")}
              disabled={busy}
            >
              {i18nT("annuel_730_ttc_12_a1b5098f")}{" "}</button>
          </div>
          <button type="button" className={styles.primaryBtn} onClick={startCheckout} disabled={busy}>
            {busy ? i18nT("ouverture_3333ad14") : i18nT("reactiver_avec_inrcy_standard_fa0d9b86")}
          </button>
        </>
      ) : canOpenPortal ? (
        <button type="button" className={styles.primaryBtn} onClick={openPortal} disabled={busy}>
          {busy ? i18nT("ouverture_3333ad14") : i18nT("regulariser_mon_paiement_00ae072e")}
        </button>
      ) : (
        <a href={contactHref} className={styles.primaryBtn}>{i18nT("contacter_inrcy_b0a48e55")}</a>
      )}
      {error ? <div className={styles.recoveryError}>{error}</div> : null}
    </div>
  );
}
