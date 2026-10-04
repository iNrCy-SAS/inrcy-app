"use client";

import { useLocale, useTranslations } from "next-intl";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import { resolveDashboardEdition } from "@/lib/dashboardEdition";
import { canStartSubscriptionCheckout } from "@/lib/subscriptionCheckoutPolicy";
import {
  premiumSubscriptionOfferForAccountCreatedAt,
  standardSubscriptionOfferForAccountCreatedAt,
  type BillingCycle,
} from "@/lib/subscriptionOffers";
import {
  detectClientBillingPlatform,
  loadSubscriptionStorePrices,
  loadStandardSubscriptionStorePrices,
  startSubscriptionCheckout,
  type ClientBillingPlatform,
  type StandardSubscriptionStorePrices,
} from "@/lib/clientSubscriptionBilling";
import { openNativeSubscriptionManagement } from "@/lib/nativeBillingManagement";
import SubscriptionWorkspace from "./SubscriptionWorkspace";
import { SubscriptionPlanFeatures } from "./SubscriptionComparison";
import styles from "./settingsContentLayout.module.css";

type Props = {
  onOpenContact: () => void;
};

type SubscriptionData = {
  app_edition?: string | null;
  plan?: string | null;
  scheduled_plan?: string | null;
  status?: string | null;
  trial_end_at?: string | null;
  next_renewal_date?: string | null;
  cancel_requested_at?: string | null;
  end_date?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_price_id?: string | null;
  billing_cycle?: string | null;
  billing_provider?: "stripe" | "app_store" | "play_store" | string | null;
  native_product_id?: string | null;
  native_will_renew?: boolean | null;
};

type BillingChangeQuote = {
  amountDue: number;
  currency: string;
  prorationDate: number;
  targetPlan: "Standard" | "Premium";
  billingCycle: BillingCycle;
  targetPriceId: string;
  currentPriceId: string;
  billingCycleChanged: boolean;
  renewalAt?: number | string | null;
};

const SUBSCRIPTION_SELECT =
  "app_edition,plan,scheduled_plan,status,trial_end_at,next_renewal_date,cancel_requested_at,end_date,stripe_customer_id,stripe_subscription_id,stripe_price_id,billing_cycle,billing_provider,native_product_id,native_will_renew";



function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function formatDate(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatEur(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function statusPresentation(subscription: SubscriptionData | null, i18nT: (key: string) => string) {
  const status = normalizeStatus(subscription?.status);
  if (status === "trialing") return { label: i18nT("essai_21_jours_3095df3f"), color: "#8feaff" };
  if (status === "active") return { label: i18nT("actif_2eb75f84"), color: "#8ff7d0" };
  if (status === "past_due" || status === "unpaid") return { label: i18nT("a_regulariser_7046f900"), color: "#ffd38f" };
  if (status === "canceled" || status === "cancelled") return { label: i18nT("resilie_1ca48fe3"), color: "#ff9bbd" };
  if (status === "trial_expired") return { label: i18nT("essai_termine_be984f1c"), color: "#ffbd8f" };
  if (status === "paused") return { label: i18nT("suspendu_e9a8be4e"), color: "#ffbd8f" };
  return { label: i18nT("a_verifier_8f5f7255"), color: "#c8d3ef" };
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
}

export default function StandardSubscriptionContent({ onOpenContact }: Props) {
  const i18nT = useTranslations("settings");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const checkoutState = searchParams.get("checkout");
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [accountCreatedAt, setAccountCreatedAt] = useState<string | null>(null);
  const [billingCycles, setBillingCycles] = useState<Record<"Standard" | "Premium", BillingCycle>>({ Standard: "monthly", Premium: "monthly" });
  const billingCycleInitialized = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"checkout" | "portal" | "cancel" | "uncancel" | "quote" | "change-plan" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [clientBillingPlatform, setClientBillingPlatform] = useState<ClientBillingPlatform | null>(null);
  const [storePrices, setStorePrices] = useState<StandardSubscriptionStorePrices | null>(null);
  const [storePriceError, setStorePriceError] = useState("");
  const [premiumStorePrices, setPremiumStorePrices] = useState<StandardSubscriptionStorePrices | null>(null);
  const [premiumStorePriceError, setPremiumStorePriceError] = useState("");
  const [upgradeQuote, setUpgradeQuote] = useState<BillingChangeQuote | null>(null);
  const [downgradeScheduled, setDowngradeScheduled] = useState(false);
  const [scheduledDowngrade, setScheduledDowngrade] = useState<{ billingCycle: BillingCycle; renewalAt?: string | null } | null>(null);

  const loadSubscription = useCallback(async () => {
    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) return null;
    setAccountCreatedAt(authData.user.created_at ?? null);
    const { data, error: queryError } = await supabase
      .from("subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (queryError) throw queryError;
    if (!billingCycleInitialized.current && data) {
      const activePlan = resolveDashboardEdition({ edition: data.app_edition, plan: data.plan }) === "premium" ? "Premium" : "Standard";
      setBillingCycles((cycles) => ({ ...cycles, [activePlan]: data.billing_cycle === "yearly" ? "yearly" : "monthly" }));
      billingCycleInitialized.current = true;
    }
    setSubscription((data as SubscriptionData | null) ?? null);
    return (data as SubscriptionData | null) ?? null;
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadSubscription()
      .catch(() => {
        if (active) setError(i18nT("impossible_de_charger_votre_abonnement_01091210"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadSubscription]);

  useEffect(() => {
    let active = true;
    const platform = detectClientBillingPlatform();
    setClientBillingPlatform(platform);
    setStorePrices(null);
    setStorePriceError("");
    setPremiumStorePrices(null);
    setPremiumStorePriceError("");

    if (platform === "web") {
      return () => {
        active = false;
      };
    }

    void loadStandardSubscriptionStorePrices()
      .then((prices) => {
        if (!active) return;
        if (!prices || prices.platform !== platform) {
          throw new Error(i18nT("premium_store_prices_unavailable"));
        }
        setStorePrices(prices);
      })
      .catch((caught) => {
        if (!active) return;
        setStorePriceError(
          caught instanceof Error
            ? caught.message
            : i18nT("premium_store_prices_unavailable"),
        );
      });

    void loadSubscriptionStorePrices({ plan: "Premium" })
      .then((prices) => {
        if (!active) return;
        if (!prices || prices.platform !== platform) {
          throw new Error(i18nT("premium_store_prices_unavailable"));
        }
        setPremiumStorePrices(prices);
      })
      .catch((caught) => {
        if (!active) return;
        setPremiumStorePriceError(
          caught instanceof Error
            ? caught.message
            : i18nT("premium_store_prices_unavailable"),
        );
      });

    return () => {
      active = false;
    };
  }, [i18nT]);

  useEffect(() => {
    if (checkoutState !== "success") return;
    setMessage(i18nT("paiement_enregistre_la_synchronisation_de_votre_d53f480e"));
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void loadSubscription().then((row) => {
        if (!row || !row.stripe_subscription_id ||
            !["active", "trialing"].includes(normalizeStatus(row.status))) return;
        const edition = String(row.app_edition || "").toLowerCase();
        if (edition !== "standard" && edition !== "premium") return;
        window.clearInterval(timer);
        const url = new URL(window.location.href);
        url.searchParams.delete("checkout");
        url.searchParams.delete("billing");
        window.history.replaceState({}, "", url);
        window.location.reload();
      }).catch(() => null);
      if (attempts >= 8) window.clearInterval(timer);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [checkoutState, loadSubscription]);

  const view = useMemo(() => {
    const status = normalizeStatus(subscription?.status);
    const reusableStatuses = ["trial_expired", "canceled", "cancelled", "incomplete_expired", ""];
    const billingProvider = normalizeStatus(subscription?.billing_provider);
    const hasNativeSubscription =
      (billingProvider === "app_store" || billingProvider === "play_store") &&
      Boolean(subscription?.native_product_id);
    const hasStripeSubscription =
      (billingProvider === "stripe" || !billingProvider) &&
      Boolean(subscription?.stripe_subscription_id) &&
      !reusableStatuses.includes(status);
    const cancellationScheduled = Boolean(subscription?.cancel_requested_at && subscription?.end_date);
    const canStartCheckout = canStartSubscriptionCheckout(subscription, "Standard");
    const canStartPremiumCheckout = canStartSubscriptionCheckout(subscription, "Premium");
    const needsBillingRecovery = ["past_due", "unpaid", "incomplete"].includes(status);
    return {
      edition: resolveDashboardEdition({
        edition: subscription?.app_edition,
        plan: subscription?.plan,
      }) === "premium" ? "premium" : "standard",
      status,
      hasStripeSubscription,
      hasNativeSubscription,
      billingProvider,
      cancellationScheduled,
      canStartCheckout,
      canStartPremiumCheckout,
      needsBillingRecovery,
      trialEndLabel: formatDate(subscription?.trial_end_at, locale),
      renewalLabel: formatDate(subscription?.next_renewal_date, locale),
      endLabel: formatDate(subscription?.end_date, locale),
      billingCycle: subscription?.billing_cycle,
      presentation: statusPresentation(subscription, i18nT),
    };
  }, [subscription, locale, i18nT]);

  useEffect(() => {
    if (view.edition !== "premium" || !view.hasStripeSubscription || view.status !== "active") {
      setDowngradeScheduled(false);
      setScheduledDowngrade(null);
      return;
    }
    let active = true;
    void fetch("/api/billing/change-plan?target=Standard", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("downgrade_status_unavailable");
        return response.json() as Promise<{ pendingDowngrade?: boolean; billingCycle?: BillingCycle; renewalAt?: string }>;
      })
      .then((body) => {
        if (!active) return;
        setDowngradeScheduled(Boolean(body.pendingDowngrade));
        setScheduledDowngrade(body.pendingDowngrade && body.billingCycle
          ? { billingCycle: body.billingCycle, renewalAt: body.renewalAt } : null);
      })
      .catch(() => { if (active) { setDowngradeScheduled(false); setScheduledDowngrade(null); } });
    return () => { active = false; };
  }, [view.edition, view.hasStripeSubscription, view.status]);

  const standardOffer = useMemo(
    () => standardSubscriptionOfferForAccountCreatedAt(accountCreatedAt),
    [accountCreatedAt],
  );
  const premiumOffer = useMemo(
    () => premiumSubscriptionOfferForAccountCreatedAt(accountCreatedAt),
    [accountCreatedAt],
  );
  const standardTaxLabel = i18nT(
    standardOffer.taxBehavior === "exclusive"
      ? "standard_tax_exclusive_short"
      : "standard_tax_inclusive_short",
  );
  const premiumTaxLabel = i18nT(
    premiumOffer.taxBehavior === "exclusive"
      ? "standard_tax_exclusive_short"
      : "standard_tax_inclusive_short",
  );
  const isNativeBillingPlatform = clientBillingPlatform === "ios" || clientBillingPlatform === "android";
  const matchingStorePrices =
    isNativeBillingPlatform && storePrices?.platform === clientBillingPlatform ? storePrices : null;
  const storePricesReady =
    clientBillingPlatform === "web" || Boolean(matchingStorePrices);
  const matchingPremiumStorePrices =
    isNativeBillingPlatform && premiumStorePrices?.platform === clientBillingPlatform ? premiumStorePrices : null;
  const premiumStorePricesReady = clientBillingPlatform === "web" || Boolean(matchingPremiumStorePrices);
  const standardMonthlyLabel = clientBillingPlatform === "web"
    ? `${formatEur(standardOffer.monthlyPriceEur, locale)} € ${standardTaxLabel} / ${i18nT("standard_per_month")}`
    : matchingStorePrices
      ? `${matchingStorePrices.labels.monthly} / ${i18nT("standard_per_month")}`
      : "…";
  const standardYearlyLabel = clientBillingPlatform === "web"
    ? `${formatEur(standardOffer.yearlyPriceEur, locale)} € ${standardTaxLabel} / ${i18nT("standard_per_year")}`
    : matchingStorePrices
      ? `${matchingStorePrices.labels.yearly} / ${i18nT("standard_per_year")}`
      : "…";
  const premiumMonthlyLabel = clientBillingPlatform === "web"
    ? `${formatEur(premiumOffer.monthlyPriceEur, locale)} € ${premiumTaxLabel} / ${i18nT("standard_per_month")}`
    : matchingPremiumStorePrices
      ? `${matchingPremiumStorePrices.labels.monthly} / ${i18nT("standard_per_month")}`
      : "…";
  const premiumYearlyLabel = clientBillingPlatform === "web"
    ? `${formatEur(premiumOffer.yearlyPriceEur, locale)} € ${premiumTaxLabel} / ${i18nT("standard_per_year")}`
    : matchingPremiumStorePrices
      ? `${matchingPremiumStorePrices.labels.yearly} / ${i18nT("standard_per_year")}`
      : "…";

  async function openPortal() {
    setError("");
    setMessage("");
    setBusyAction("portal");
    try {
      if (view.hasNativeSubscription && (view.billingProvider === "app_store" || view.billingProvider === "play_store")) {
        await openNativeSubscriptionManagement(view.billingProvider);
        return;
      }
      const response = await fetch("/api/billing/portal", { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response, i18nT("l_operation_n_a_pas_pu_2eda8de6")));
      const body = (await response.json()) as { url?: string };
      if (!body.url) throw new Error("Le portail de facturation n’a pas pu être ouvert.");
      window.location.assign(body.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le portail de facturation est indisponible.");
    } finally {
      setBusyAction(null);
    }
  }

  async function startCheckout(plan: "Standard" | "Premium" = "Standard") {
    setError("");
    setMessage("");
    setBusyAction("checkout");
    try {
      const result = await startSubscriptionCheckout({
        plan,
        billingCycle: billingCycles[plan],
        fallbackError: i18nT("l_operation_n_a_pas_pu_2eda8de6"),
      });
      if (result.platform === "web" && result.recoveredSubscription) {
        await loadSubscription();
        if (result.nextAction === "change_plan") await previewPremiumUpgrade(plan);
        else window.location.reload();
        return;
      }
      if (result.platform !== "web") {
        setMessage(i18nT("native_purchase_confirmed"));
        await loadSubscription();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le paiement est momentanément indisponible.");
    } finally {
      setBusyAction(null);
    }
  }

  async function previewPremiumUpgrade(targetPlan: "Standard" | "Premium" = "Premium") {
    const billingCycle = billingCycles[targetPlan];
    setError("");
    setMessage("");
    setUpgradeQuote(null);
    setBusyAction("quote");
    try {
      const response = await fetch(`/api/billing/change-plan?target=${targetPlan}&billingCycle=${billingCycle}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, i18nT("premium_quote_unavailable")));
      const body = await response.json() as { quote?: BillingChangeQuote };
      if (!body.quote || body.quote.currency !== "eur" || body.quote.targetPlan !== targetPlan
        || body.quote.billingCycle !== billingCycle || !body.quote.targetPriceId || !body.quote.currentPriceId) {
        throw new Error(i18nT("premium_quote_unavailable"));
      }
      setUpgradeQuote(body.quote);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : i18nT("premium_plan_change_unavailable"));
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmPremiumUpgrade() {
    if (!upgradeQuote) return;
    if (upgradeQuote.billingCycle !== billingCycles[upgradeQuote.targetPlan]) {
      setUpgradeQuote(null);
      return;
    }
    setError("");
    setMessage("");
    setBusyAction("change-plan");
    try {
      const response = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlan: upgradeQuote.targetPlan, billingCycle: upgradeQuote.billingCycle,
          prorationDate: upgradeQuote.prorationDate, expectedAmountDue: upgradeQuote.amountDue,
          expectedTargetPriceId: upgradeQuote.targetPriceId, expectedCurrentPriceId: upgradeQuote.currentPriceId }),
      });
      if (!response.ok) throw new Error(await responseError(response, i18nT("subscription_change_failed")));
      const body = await response.json() as { applied?: boolean; pendingPayment?: boolean; paymentUrl?: string | null };
      setUpgradeQuote(null);
      if (body.pendingPayment) {
        setMessage(i18nT("subscription_change_pending_payment"));
        if (body.paymentUrl) window.location.assign(body.paymentUrl);
        return;
      }
      if (!body.applied) throw new Error(i18nT("subscription_change_unconfirmed"));
      setMessage(i18nT("subscription_change_activating"));
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const row = await loadSubscription();
        if (String(row?.app_edition || "").toLowerCase() === upgradeQuote.targetPlan.toLowerCase()
          && row?.billing_cycle === upgradeQuote.billingCycle) {
          window.location.reload();
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
      setMessage(i18nT("subscription_change_reload"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : i18nT("premium_plan_change_unavailable"));
    } finally {
      setBusyAction(null);
    }
  }

  async function changeDowngrade(action: "schedule" | "undo") {
    const billingCycle = billingCycles.Standard;
    if (action === "schedule" && !window.confirm(`${i18nT("premium_downgrade_confirm")} ${i18nT("subscription_downgrade_cycle_notice", {
      cycle: i18nT(billingCycle === "yearly" ? "subscription_yearly" : "subscription_monthly"),
      date: view.renewalLabel || i18nT("premium_next_renewal_placeholder"),
    })}`)) return;
    setError("");
    setMessage("");
    setBusyAction("change-plan");
    try {
      const response = await fetch("/api/billing/change-plan", {
        method: action === "schedule" ? "POST" : "DELETE",
        headers: action === "schedule" ? { "Content-Type": "application/json" } : undefined,
        body: action === "schedule" ? JSON.stringify({ targetPlan: "Standard", billingCycle }) : undefined,
      });
      if (!response.ok) throw new Error(await responseError(response, i18nT("premium_downgrade_failed")));
      const body = await response.json() as { renewalAt?: string | null };
      setDowngradeScheduled(action === "schedule");
      setScheduledDowngrade(action === "schedule" ? { billingCycle, renewalAt: body.renewalAt } : null);
      setMessage(action === "schedule"
        ? i18nT("premium_downgrade_scheduled_message", {
            date: view.renewalLabel || i18nT("premium_next_renewal_placeholder"),
          })
        : i18nT("premium_downgrade_canceled_message"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : i18nT("premium_plan_change_unavailable"));
    } finally {
      setBusyAction(null);
    }
  }

  async function updateCancellation(action: "cancel" | "uncancel") {
    if (view.hasNativeSubscription && (view.billingProvider === "app_store" || view.billingProvider === "play_store")) {
      setError("");
      setMessage(i18nT("native_subscription_management_message"));
      setBusyAction("portal");
      try {
        await openNativeSubscriptionManagement(view.billingProvider);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Le magasin d’applications est indisponible.");
      } finally {
        setBusyAction(null);
      }
      return;
    }
    setError("");
    setMessage("");
    setBusyAction(action);
    try {
      const response = await fetch(`/api/billing/${action}`, { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response, i18nT("l_operation_n_a_pas_pu_2eda8de6")));
      const body = (await response.json().catch(() => ({}))) as {
        cancellation_policy?: string;
      };
      await loadSubscription();
      setMessage(
        action === "cancel"
          ? body.cancellation_policy === "one_additional_monthly_renewal"
            ? "Votre résiliation est programmée : votre prochaine mensualité sera la dernière et financera votre mois de préavis."
            : body.cancellation_policy === "trial_end_without_charge"
              ? "Votre essai s'arrêtera à son échéance, sans prélèvement."
              : "Votre abonnement annuel s'arrêtera à son échéance, sans nouveau prélèvement annuel."
          : "Votre résiliation a été annulée.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "L’abonnement n’a pas pu être mis à jour.");
    } finally {
      setBusyAction(null);
    }
  }

  const primaryButton: React.CSSProperties = {
    minHeight: 44,
    border: "1px solid rgba(255,255,255,.18)",
    borderRadius: 14,
    color: "white",
    background: "linear-gradient(115deg, rgba(39, 154, 255, .9), rgba(133, 74, 239, .92), rgba(238, 72, 163, .82))",
    boxShadow: "0 12px 30px rgba(86, 65, 220, .22)",
    fontWeight: 900,
    cursor: busyAction ? "wait" : "pointer",
    padding: "10px 15px",
  };
  const secondaryButton: React.CSSProperties = {
    ...primaryButton,
    background: "rgba(255,255,255,.06)",
    boxShadow: "none",
  };

  if (loading) return <div style={{ opacity: 0.78 }}>{i18nT("chargement_de_votre_forfait_0440bffc")}</div>;

  const currentStandardWithoutBilling = view.edition === "standard" && view.status === "active" && !view.hasStripeSubscription && !view.hasNativeSubscription;
  const cycleOptions = (plan: "Standard" | "Premium") => {
    const offer = plan === "Standard" ? standardOffer : premiumOffer;
    const savings = Math.max(0, Math.round((offer.monthlyPriceEur * 12 - offer.yearlyPriceEur) * 100) / 100);
    const savingsAmount = `${formatEur(savings, locale)} € ${plan === "Standard" ? standardTaxLabel : premiumTaxLabel}`;
    return <div className={styles.planCycleSelector} role="group" aria-label={`iNrCy ${plan} · ${i18nT("choisissez_votre_rythme_de_facturation_aca0763d")}`}>
      {(["monthly", "yearly"] as const).map((cycle) => <button key={cycle} type="button" aria-pressed={billingCycles[plan] === cycle} onClick={() => {
        setBillingCycles((cycles) => ({ ...cycles, [plan]: cycle }));
        setUpgradeQuote((quote) => quote?.targetPlan === plan ? null : quote);
      }} disabled={busyAction !== null}>
        <span>{i18nT(cycle === "monthly" ? "subscription_cycle_monthly" : "subscription_cycle_yearly")}</span>
        {cycle === "yearly" && clientBillingPlatform === "web" && savings > 0 ? <small className={styles.savingsPill}>{i18nT("subscription_cycle_saving", { amount: savingsAmount })}</small> : null}
      </button>)}
    </div>;
  };
  const management = <section className={styles.managementCard}>
    <h2>{i18nT("mon_abonnement_d248414d")}</h2>
    <strong>iNrCy {view.edition === "premium" ? "Premium" : "Standard"}</strong>
    <p style={{ color: view.presentation.color }}>{view.presentation.label}</p>
    {view.trialEndLabel && view.status === "trialing" ? <p>{i18nT("fin_de_votre_essai_f1bae9e9")} <strong>{view.trialEndLabel}</strong></p> : null}
    {view.renewalLabel ? <p>{i18nT("premium_next_renewal_label", { date: view.renewalLabel })}</p> : null}
    {view.cancellationScheduled && view.endLabel ? <p>{i18nT("acces_maintenu_jusqu_au_4270c8d3")} <strong>{view.endLabel}</strong>.</p> : null}
    {view.cancellationScheduled && view.billingCycle === "monthly" && view.renewalLabel ? <p>{i18nT("derniere_mensualite_prevue_le_f3d69894")} <strong>{view.renewalLabel}</strong>.</p> : null}
    {(view.hasStripeSubscription || view.hasNativeSubscription) ? <button type="button" onClick={openPortal} style={secondaryButton} disabled={busyAction !== null}>{view.needsBillingRecovery ? i18nT("regulariser_mon_paiement_00ae072e") : i18nT("gerer_ma_facturation_dc5027ac")}</button> : null}
    {view.hasNativeSubscription ? <p className={styles.finePrint}>{i18nT("native_subscription_managed_by_store", { store: view.billingProvider === "app_store" ? "App Store" : "Google Play" })}</p> : null}
    {view.edition === "standard" && view.hasStripeSubscription && !view.needsBillingRecovery ? <>
      <button type="button" onClick={() => updateCancellation(view.cancellationScheduled ? "uncancel" : "cancel")} style={secondaryButton} disabled={busyAction !== null}>{view.cancellationScheduled ? i18nT("annuler_ma_resiliation_902e43a0") : i18nT("programmer_ma_resiliation_d074ca2d")}</button>
      {!view.cancellationScheduled ? <p className={styles.finePrint}>{i18nT("essai_arret_sans_prelevement_mensuel_actif_32634c83")}</p> : null}
    </> : null}
    {view.edition === "premium" ? <div className={styles.managementActions}>
      <h3>iNrCy Standard</h3>
      <p className={styles.finePrint}>{i18nT("premium_standard_description")}</p>
      {!downgradeScheduled && view.hasStripeSubscription && view.status === "active" && !view.cancellationScheduled ? <>
        {cycleOptions("Standard")}
        <p className={styles.finePrint}>{i18nT("subscription_downgrade_cycle_notice", {
          cycle: i18nT(billingCycles.Standard === "yearly" ? "subscription_yearly" : "subscription_monthly"),
          date: view.renewalLabel || i18nT("premium_next_renewal_placeholder"),
        })}</p>
      </> : null}
      {downgradeScheduled ? <>
        <p>{i18nT("premium_downgrade_scheduled_label", { date: view.renewalLabel || i18nT("premium_next_renewal_placeholder") })}</p>
        {scheduledDowngrade ? <p className={styles.finePrint}>{i18nT("subscription_downgrade_cycle_notice", {
          cycle: i18nT(scheduledDowngrade.billingCycle === "yearly" ? "subscription_yearly" : "subscription_monthly"),
          date: formatDate(scheduledDowngrade.renewalAt, locale) || view.renewalLabel || i18nT("premium_next_renewal_placeholder"),
        })}</p> : null}
        <button type="button" onClick={() => changeDowngrade("undo")} style={secondaryButton} disabled={busyAction !== null}>{i18nT("premium_downgrade_cancel_button")}</button>
      </> : view.hasStripeSubscription && view.status === "active" && !view.cancellationScheduled ? <button type="button" onClick={() => changeDowngrade("schedule")} style={secondaryButton} disabled={busyAction !== null}>{i18nT("premium_downgrade_button")}</button>
      : view.hasNativeSubscription ? <button type="button" onClick={openPortal} style={secondaryButton} disabled={busyAction !== null}>{i18nT("premium_native_change_button")}</button>
      : <button type="button" onClick={onOpenContact} style={secondaryButton}>{i18nT("premium_contact_change_button")}</button>}
    </div> : null}
  </section>;

  const renderPlanChange = (targetPlan: "Standard" | "Premium") => {
    const quote = upgradeQuote?.targetPlan === targetPlan ? upgradeQuote : null;
    const isCurrentPlan = targetPlan.toLowerCase() === view.edition;
    return <>
      {!quote ? <button type="button" className={targetPlan === "Premium" ? styles.premiumCta : styles.standardCta} onClick={() => previewPremiumUpgrade(targetPlan)} disabled={busyAction !== null}>
        {busyAction === "quote" ? i18nT("premium_quote_loading") : isCurrentPlan ? i18nT("subscription_change_cycle") : i18nT("subscription_upgrade")} <span aria-hidden="true">→</span>
      </button> : <div className={styles.quoteConfirmation}>
        <p>{i18nT("premium_quote_amount", { amount: new Intl.NumberFormat(locale, { style: "currency", currency: quote.currency }).format(quote.amountDue / 100) })}</p>
        <p>{i18nT(quote.billingCycleChanged ? "subscription_quote_cycle_changed" : "subscription_quote_cycle_preserved")}</p>
        {quote.renewalAt ? <p>{i18nT("premium_next_renewal_label", { date: formatDate(String(quote.renewalAt), locale) || "—" })}</p> : null}
        <button type="button" className={targetPlan === "Premium" ? styles.premiumCta : styles.standardCta} onClick={confirmPremiumUpgrade} disabled={busyAction !== null}>{busyAction === "change-plan" ? i18nT("premium_confirming") : i18nT("subscription_confirm_change")}</button>
        <button type="button" className={styles.quoteRefresh} onClick={() => previewPremiumUpgrade(targetPlan)} disabled={busyAction !== null}>{i18nT("premium_refresh_quote")}</button>
      </div>}
      <p className={styles.finePrint}>{i18nT("subscription_change_quote_notice")}</p>
    </>;
  };
  const priceDetails = (plan: "Standard" | "Premium") => {
    const displayCycle = billingCycles[plan];
    const offer = plan === "Standard" ? standardOffer : premiumOffer;
    const monthlyLabel = plan === "Standard" ? standardMonthlyLabel : premiumMonthlyLabel;
    const yearlyLabel = plan === "Standard" ? standardYearlyLabel : premiumYearlyLabel;
    return <div className={styles.priceBlock}>
      <div className={styles.planPrice}><span>{i18nT("subscription_offer_price")}</span><strong>{displayCycle === "yearly" ? yearlyLabel : monthlyLabel}</strong>
        {displayCycle === "yearly" && clientBillingPlatform === "web" ? <small>{i18nT("subscription_monthly_equivalent", { amount: `${formatEur(offer.yearlyPriceEur / 12, locale)} € ${plan === "Standard" ? standardTaxLabel : premiumTaxLabel}` })}</small> : null}
      </div>
      {cycleOptions(plan)}
    </div>;
  };
  const canChangePaidPlan = view.hasStripeSubscription && view.status === "active" && !view.cancellationScheduled;
  const selectedCycleDiffers = (plan: "Standard" | "Premium") => billingCycles[plan] !== (view.billingCycle === "yearly" ? "yearly" : "monthly");

  return <SubscriptionWorkspace management={management} notice={<div role="status" aria-live="polite">
    {checkoutState === "cancel" ? <p style={{ color: "#ffd38f", margin: "0 0 12px" }}>{i18nT("paiement_annule_aucun_changement_n_a_c603ca12")}</p> : null}
    {message ? <p style={{ color: "#8ff7d0", margin: "0 0 12px" }}>{message}</p> : null}
    {error ? <p style={{ color: "#ff9bbd", margin: "0 0 12px" }}>{error}</p> : null}
  </div>}>


    <div className={styles.plansGrid}>
      <section className={`${styles.planCard} ${styles.standardCard}`}>
        <header className={styles.planHeader}>
          <div><span className={styles.planEyebrow}>{i18nT("subscription_standard_eyebrow")}</span><h2>iNrCy Standard</h2></div>
          {view.edition === "standard" ? <span className={styles.currentBadge}>{i18nT("subscription_current_plan")}</span> : null}
        </header>
        <p className={styles.planDescription}><strong>{i18nT("subscription_standard_benefit")}</strong><span>{i18nT("subscription_standard_pitch")}</span></p>
        <SubscriptionPlanFeatures edition="standard" />
        <footer className={styles.planFooter}>
          {priceDetails("Standard")}
          {currentStandardWithoutBilling ? <p className={styles.accessNotice}>{i18nT("subscription_access_unchanged")}</p> : null}
          {view.canStartCheckout ? <>
            <button type="button" className={styles.standardCta} onClick={() => startCheckout("Standard")} disabled={busyAction !== null || !storePricesReady}>{busyAction === "checkout" ? i18nT("ouverture_du_paiement_147e6d80") : i18nT("standard_subscribe_price", { price: billingCycles.Standard === "yearly" ? standardYearlyLabel : standardMonthlyLabel })} <span aria-hidden="true">→</span></button>
            <p className={styles.finePrint}>{i18nT("pendant_l_essai_aucun_debit_avant_c17dea44")}</p>
          </> : view.edition === "standard" && canChangePaidPlan && selectedCycleDiffers("Standard") ? renderPlanChange("Standard")
          : view.needsBillingRecovery && view.edition === "standard" ? <button type="button" className={styles.standardCta} onClick={openPortal} disabled={busyAction !== null}>{i18nT("regulariser_mon_paiement_00ae072e")}</button>
          : view.edition === "standard" && view.hasNativeSubscription && selectedCycleDiffers("Standard") ? <button type="button" className={styles.standardCta} onClick={openPortal} disabled={busyAction !== null}>{i18nT("premium_native_change_button")}</button>
          : view.edition === "premium" ? <p className={styles.includedNotice}>{i18nT("subscription_included_premium")}</p> : null}
          {isNativeBillingPlatform && storePriceError ? <p className={styles.finePrint} style={{ color: "#ffe1e8" }}>{storePriceError}</p> : null}
        </footer>
      </section>

      <section className={`${styles.planCard} ${styles.premiumCard}`}>
        <header className={styles.planHeader}>
          <div><span className={styles.planEyebrow}>{i18nT("subscription_premium_eyebrow")}</span><h2>iNrCy Premium</h2></div>
          {view.edition === "premium" ? <span className={styles.currentBadge}>{i18nT("subscription_current_plan")}</span> : null}
        </header>
        <p className={styles.planDescription}><strong>{i18nT("subscription_premium_benefit")}</strong><span className={styles.standardIncluded}>{i18nT("subscription_standard_plus")}</span></p>
        <SubscriptionPlanFeatures edition="premium" />
        <footer className={styles.planFooter}>
          {priceDetails("Premium")}
          {view.canStartPremiumCheckout ? <>
            <button type="button" className={styles.premiumCta} onClick={() => startCheckout("Premium")} disabled={busyAction !== null || !premiumStorePricesReady}>{busyAction === "checkout" ? i18nT("ouverture_du_paiement_147e6d80") : i18nT("subscription_subscribe_premium")} <span aria-hidden="true">→</span></button>
            {isNativeBillingPlatform && premiumStorePriceError ? <p className={styles.finePrint} style={{ color: "#ffe1e8" }}>{premiumStorePriceError}</p> : null}
          </> : canChangePaidPlan && (view.edition !== "premium" || selectedCycleDiffers("Premium")) ? renderPlanChange("Premium")
          : view.hasNativeSubscription && (view.edition !== "premium" || selectedCycleDiffers("Premium")) ? <button type="button" className={styles.premiumCta} onClick={openPortal} disabled={busyAction !== null}>{i18nT("premium_native_change_button")}</button>
          : view.needsBillingRecovery && view.edition === "premium" ? <button type="button" className={styles.premiumCta} onClick={openPortal} disabled={busyAction !== null}>{i18nT("regulariser_mon_paiement_00ae072e")}</button>
          : view.edition === "premium" ? null
          : <button type="button" className={styles.quoteRefresh} onClick={onOpenContact}>{i18nT("premium_contact_change_button")}</button>}
        </footer>
      </section>
    </div>
    <p className={styles.quotaNote}>{i18nT("subscription_quota_note")}{clientBillingPlatform === "web" && premiumOffer.taxBehavior === "exclusive" ? ` ${i18nT("standard_taxes_checkout")}` : ""}</p>
  </SubscriptionWorkspace>;
}
