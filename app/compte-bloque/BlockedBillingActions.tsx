"use client";

import { useLocale, useTranslations } from "next-intl";


import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import {
  currentSubscriptionOffer,
  annualSubscriptionSavingRate,
  type BillingCycle,
} from "@/lib/subscriptionOffers";
import { startSubscriptionCheckout } from "@/lib/clientSubscriptionBilling";
import styles from "./compte-bloque.module.css";

type Props = {
  status: string;
  edition: DashboardEdition;
  hasStripeCustomer: boolean;
  contactHref: string;
  checkoutPending?: boolean;
};

async function apiError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
}

export default function BlockedBillingActions({ status, edition, hasStripeCustomer, contactHref, checkoutPending = false }: Props) {
  const i18nT = useTranslations("public");
  const settingsT = useTranslations("settings");
  const locale = useLocale();
  const router = useRouter();
  const [cycles, setCycles] = useState<Record<"Standard" | "Premium", BillingCycle>>({ Standard: "monthly", Premium: "monthly" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const normalizedStatus = status.trim().toLowerCase();
  const canSubscribe =
    (edition === "standard" || edition === "premium") &&
    ["trial_expired", "trial-expired", "canceled", "cancelled", "incomplete_expired"].includes(normalizedStatus);
  const canOpenPortal =
    hasStripeCustomer && ["past_due", "unpaid", "incomplete"].includes(normalizedStatus);
  const formatEur = (value: number) => new Intl.NumberFormat(locale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);

  useEffect(() => {
    if (!checkoutPending) return;
    let attempts = 0;
    // Refresh server data only: the server gate independently checks subscription access.
    const timer = window.setInterval(() => {
      router.refresh();
      if (++attempts >= 20) window.clearInterval(timer);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [checkoutPending, router]);

  async function startCheckout(plan: "Standard" | "Premium") {
    setBusy(true);
    setError("");
    try {
      await startSubscriptionCheckout({
        plan,
        billingCycle: cycles[plan],
        fallbackError: i18nT("l_operation_n_a_pas_pu_2eda8de6"),
      });
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
      {checkoutPending ? (
        <>
          <p role="status" aria-live="polite">{i18nT("activation_en_attente_c3d81a46")}</p>
          <button type="button" className={styles.primaryBtn} onClick={() => router.refresh()}>{settingsT("actualiser_9d3b2a7d")}</button>
          <a href={contactHref} className={styles.secondaryBtn}>{i18nT("contacter_inrcy_b0a48e55")}</a>
        </>
      ) : canSubscribe ? (
        <>
          <div className={styles.recoveryOffers}>
            {(["Standard", "Premium"] as const).map((plan) => {
              const offer = currentSubscriptionOffer(plan);
              const taxLabel = i18nT(offer.taxBehavior === "exclusive" ? "standard_tax_exclusive_short" : "standard_tax_inclusive_short");
              const savingPercent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(annualSubscriptionSavingRate(offer));
              return <article key={plan} aria-label={`iNrCy ${plan}`} className={`${styles.recoveryOffer} ${plan === "Premium" ? styles.recoveryOfferPremium : styles.recoveryOfferStandard}`}>
                <h2>iNrCy {plan}</h2>
                <div className={styles.cyclePicker} role="group" aria-label={`${plan} · ${i18nT("periodicite_de_l_abonnement_625a0573")}`}>
                  {(["monthly", "yearly"] as const).map((cycle) => <button
                    key={cycle}
                    type="button"
                    className={cycles[plan] === cycle ? styles.cycleActive : styles.cycleButton}
                    aria-pressed={cycles[plan] === cycle}
                    onClick={() => setCycles((current) => ({ ...current, [plan]: cycle }))}
                    disabled={busy}
                  >
                    <span>{formatEur(cycle === "yearly" ? offer.yearlyPriceEur : offer.monthlyPriceEur)} € {taxLabel} / {i18nT(cycle === "yearly" ? "standard_per_year" : "standard_per_month")}</span>
                    {cycle === "yearly" ? <small>≈ −{savingPercent}</small> : null}
                  </button>)}
                </div>
                <button type="button" className={styles.primaryBtn} onClick={() => startCheckout(plan)} disabled={busy}>
                  {busy ? i18nT("ouverture_3333ad14") : plan === "Premium" ? settingsT("subscription_subscribe_premium") : i18nT("reactiver_avec_inrcy_standard_fa0d9b86")}
                </button>
              </article>;
            })}
          </div>
          <div className={styles.recoveryHint}>{i18nT("standard_taxes_checkout")}</div>
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
