"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { currentSubscriptionOffer, annualSubscriptionSavingRate, type BillingCycle } from "@/lib/subscriptionOffers";
import { canStartSubscriptionCheckout } from "@/lib/subscriptionCheckoutPolicy";
import { currentSubscriptionBillingPlan } from "@/lib/subscriptionPlanChangePolicy";
import { startSubscriptionCheckout, type ClientBillingPlatform } from "@/lib/clientSubscriptionBilling";
import { SubscriptionPlanFeatures } from "./SubscriptionComparison";
import { SubscriptionDetails } from "./SubscriptionWorkspace";
import styles from "./settingsContentLayout.module.css";

type Subscription = (NonNullable<Parameters<typeof canStartSubscriptionCheckout>[0]> & {
  scheduled_plan?: string | null; billing_cycle?: string | null; trial_end_at?: string | null;
  cancel_requested_at?: string | null; end_date?: string | null;
}) | null;
type Quote = {
  targetPlan: string; targetPriceId: string; currentPriceId: string; billingCycle: BillingCycle;
  amountDue: number; prorationDate: number; trialChange?: boolean; trialEndUnix?: number; renewalAt: string;
  scheduled?: boolean;
};

export default function BasicSubscriptionCard({ subscription, platform, onRefresh, onManageBilling, onApplied, management }: {
  subscription: Subscription; platform: ClientBillingPlatform | null; onRefresh: () => void;
  onManageBilling: () => void;
  onApplied: (cycle: BillingCycle, priceId: string) => Promise<void>;
  management?: ReactNode;
}) {
  const t = useTranslations("settings"), locale = useLocale();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pending, setPending] = useState(false);
  const [renewal, setRenewal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const offer = currentSubscriptionOffer("Basic");
  const current = currentSubscriptionBillingPlan(subscription);
  const isCurrent = current === "Basic";
  const status = subscription?.status?.toLowerCase();
  const hasContract = Boolean(subscription?.stripe_subscription_id) && !subscription?.native_product_id &&
    (!subscription?.billing_provider || subscription.billing_provider === "stripe");
  const eligible = platform === "web" && hasContract && ["active", "trialing"].includes(status ?? "") && !subscription?.cancel_requested_at;
  const canSubscribe = platform === "web" && canStartSubscriptionCheckout(subscription, "Basic");
  const money = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(value));
  const price = `${money(cycle === "yearly" ? offer.yearlyPriceEur : offer.monthlyPriceEur)} ${t("standard_tax_exclusive_short")} / ${t(cycle === "yearly" ? "standard_per_year" : "standard_per_month")}`;

  useEffect(() => {
    if (isCurrent && subscription?.billing_cycle) setCycle(subscription.billing_cycle === "yearly" ? "yearly" : "monthly");
  }, [isCurrent, subscription?.billing_cycle]);
  useEffect(() => {
    if (!eligible || isCurrent || status === "trialing") return;
    let active = true;
    void fetch("/api/billing/change-plan?target=Basic", { cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (active && data.pendingDowngrade && data.targetPlan === "Basic") {
        setPending(true); setRenewal(data.renewalAt ?? null);
        setCycle(data.billingCycle === "yearly" ? "yearly" : "monthly");
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [eligible, isCurrent, status]);

  const request = async (method: "GET" | "POST" | "DELETE", body?: Record<string, unknown>) => {
    const response = await fetch(`/api/billing/change-plan${method === "GET" ? `?target=Basic&billingCycle=${cycle}` : ""}`, {
      method, cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || t("subscription_change_failed"));
    return data;
  };
  async function choose() {
    setBusy(true); setError(""); setNotice("");
    try {
      if (canSubscribe) {
        const result = await startSubscriptionCheckout({ plan: "Basic", billingCycle: cycle, fallbackError: t("subscription_change_failed"),
          confirmTrialExtension: value => window.confirm(t("subscription_trial_extension_confirm", { date: date(value) })) });
        if (result.platform !== "web" || !result.recoveredSubscription) return;
        if (result.nextAction === "reload") { onRefresh(); window.location.reload(); return; }
      }
      const data = await request("GET");
      if (data.changeType === "unchanged") { onRefresh(); return; }
      const candidate = data.changeType === "scheduled" ? { ...data, amountDue: 0, prorationDate: 0, scheduled: true } : data.quote;
      if (!candidate || candidate.targetPlan !== "Basic" || candidate.billingCycle !== cycle || !candidate.targetPriceId || !candidate.currentPriceId || !Number.isFinite(Date.parse(candidate.renewalAt)) || (!candidate.scheduled && !Number.isSafeInteger(candidate.amountDue))) throw new Error(t("premium_quote_unavailable"));
      setQuote(candidate);
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("subscription_change_failed")); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!quote || quote.billingCycle !== cycle) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request("POST", { targetPlan: "Basic", billingCycle: cycle,
        expectedTargetPriceId: quote.targetPriceId, expectedCurrentPriceId: quote.currentPriceId,
        prorationDate: quote.prorationDate, expectedAmountDue: quote.amountDue,
        ...(quote.trialChange ? { trialChange: true, expectedTrialEndUnix: quote.trialEndUnix } : {}) });
      if (data.pendingPayment) {
        setNotice(t("subscription_change_pending_payment"));
        if (data.paymentUrl) window.location.assign(data.paymentUrl);
      }
      else if (data.scheduled) { setPending(true); setRenewal(data.renewalAt); setQuote(null); }
      else if (data.applied) { setQuote(null); await onApplied(quote.billingCycle, quote.targetPriceId); }
      else throw new Error(t("subscription_change_unconfirmed"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("subscription_change_failed")); }
    finally { setBusy(false); }
  }
  async function undo() {
    setBusy(true); setError("");
    try { await request("DELETE"); setPending(false); setRenewal(null); setQuote(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t("subscription_change_failed")); }
    finally { setBusy(false); }
  }
  return <section className={`${styles.planCard} ${styles.basicCard}`} aria-label={`iNrCy ${t("subscription_basic_name")}`}>
    <header className={styles.planHeader}>
      <div><span className={styles.planEyebrow}>{t("subscription_basic_eyebrow")}</span><h2>iNrCy {t("subscription_basic_name")}</h2></div>
      {isCurrent ? <span className={styles.currentBadge}>{t(status === "trialing" ? "subscription_selected_plan" : "subscription_current_plan")}</span> : null}
    </header>
    <p className={styles.planDescription}><strong>{t("subscription_basic_benefit")}</strong><span>{t("subscription_basic_pitch")}</span></p>
    <SubscriptionPlanFeatures edition="basic" />
    <footer className={styles.planFooter}>
      {platform === "web" ? <>
        <div className={styles.priceBlock}>
          <div className={styles.planPrice}><span>{t("subscription_offer_price")}</span><strong>{price}</strong>
            {cycle === "yearly" ? <small>{t("subscription_monthly_equivalent", { amount: `${money(offer.yearlyPriceEur / 12)} ${t("standard_tax_exclusive_short")}` })}</small> : null}
          </div>
          <div className={styles.planCycleSelector} role="group" aria-label={t("subscription_basic_name")}>
            {(["monthly", "yearly"] as const).map(value => <button type="button" key={value} aria-pressed={cycle === value} disabled={busy} onClick={() => { setCycle(value); setQuote(null); }}>
              <span>{t(value === "yearly" ? "subscription_cycle_yearly" : "subscription_cycle_monthly")}</span>
              {value === "yearly" ? <small className={styles.savingsPill}>≈ −{new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(annualSubscriptionSavingRate(offer))}</small> : null}
            </button>)}
          </div>
        </div>
        {pending && renewal ? <><p role="status" className={styles.finePrint}>{t("subscription_basic_scheduled", { date: date(renewal) })}</p><button type="button" className={styles.quoteRefresh} disabled={busy} onClick={undo}>{t("premium_downgrade_cancel_button")}</button></>
        : quote ? <div className={styles.quoteConfirmation}>
          <p>{quote.scheduled ? t("subscription_basic_scheduled", { date: date(quote.renewalAt) }) : t("premium_quote_amount", { amount: money(quote.amountDue / 100) })}</p>
          {quote.trialChange ? <p>{t("subscription_trial_change_notice", { date: date(quote.renewalAt) })}</p> : null}
          <button type="button" className={styles.standardCta} disabled={busy} onClick={confirm}>{t("subscription_confirm_change")}</button>
          <button type="button" className={styles.quoteRefresh} disabled={busy} onClick={() => setQuote(null)}>{t("video_credit_close")}</button>
        </div> : canSubscribe || eligible && (!isCurrent || cycle !== subscription?.billing_cycle) ? <button type="button" className={styles.standardCta} disabled={busy} onClick={choose}>{busy ? t("premium_quote_loading") : canSubscribe ? t("standard_subscribe_price", { price }) : t("subscription_basic_change")} <span aria-hidden="true">→</span></button>
        : isCurrent && hasContract ? <button type="button" className={styles.quoteRefresh} onClick={onManageBilling}>{t("gerer_ma_facturation_dc5027ac")}</button> : null}
        {status === "trialing" ? <p className={styles.finePrint}>{t("subscription_trial_change_notice", { date: subscription?.trial_end_at ? date(subscription.trial_end_at) : "—" })}</p> : null}
      </> : platform ? <p className={styles.finePrint}>{t("subscription_basic_native_unavailable")}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status" className={styles.finePrint}>{notice}</p> : null}
      {management ? <SubscriptionDetails title={t("gerer_ma_facturation_dc5027ac")}>{management}</SubscriptionDetails> : null}
    </footer>
  </section>;
}
