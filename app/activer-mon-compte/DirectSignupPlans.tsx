"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { currentSubscriptionOffer, type CommercialPlan } from "@/lib/subscriptionOffers";
import { SubscriptionPlanFeatures } from "@/app/dashboard/settings/_components/SubscriptionComparison";
import offerStyles from "@/app/dashboard/settings/_components/settingsContentLayout.module.css";
import styles from "./activation.module.css";

const PLANS = ["Basic", "Standard", "Premium"] as const;
const PLAN_STYLES = { Basic: offerStyles.basicCard, Standard: offerStyles.standardCard, Premium: offerStyles.premiumCard };
type Phase = "checking" | "choosing" | "waiting" | "error";
type Props = { email: string; checkout: "success" | "cancel" | null };

/** A purchase choice never grants access. Only the authenticated status does. */
export default function DirectSignupPlans({ email, checkout }: Props) {
  const t = useTranslations("auth.directSignup");
  const s = useTranslations("settings");
  const locale = useLocale();
  const [plan, setPlan] = useState<CommercialPlan>("Basic");
  const [detailPlan, setDetailPlan] = useState<CommercialPlan | null>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkVersion, setCheckVersion] = useState(0);
  const [awaitingRecoveredPayment, setAwaitingRecoveredPayment] = useState(false);
  const awaitingPayment = checkout === "success" || awaitingRecoveredPayment;
  const submitting = useRef(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const featureButtons = useRef<Partial<Record<CommercialPlan, HTMLButtonElement | null>>>({});
  const planInputs = useRef<Partial<Record<CommercialPlan, HTMLInputElement | null>>>({});
  const returnFocus = useRef<{ plan: CommercialPlan; select: boolean } | null>(null);
  const money = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
  const name = (value: CommercialPlan) => value === "Basic" ? s("subscription_basic_name") : value;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);

  useEffect(() => {
    if (phase !== "choosing") return;
    if (detailPlan) {
      dialog.current?.scrollTo({ top: 0 });
      title.current?.focus({ preventScroll: true });
      return;
    }
    const target = returnFocus.current;
    if (target) {
      returnFocus.current = null;
      const element = target.select ? planInputs.current[target.plan] : featureButtons.current[target.plan];
      element?.focus();
    }
  }, [detailPlan, phase]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const deadline = Date.now() + 60_000;
    async function check() {
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch("/api/auth/direct-signup/status", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok || body?.directSignup !== true || typeof body?.paid !== "boolean") throw new Error("status_unavailable");
        if (body.paid === true) { window.location.replace("/dashboard"); return; }
        if (awaitingPayment && Date.now() < deadline) {
          setPhase("waiting");
          timer = setTimeout(() => { void check(); }, 2000);
        } else setPhase("choosing");
      } catch {
        if (!cancelled) { setError(t("checkFailed")); setPhase("error"); }
      } finally { window.clearTimeout(timeout); }
    }
    setError("");
    setPhase(awaitingPayment ? "waiting" : "checking");
    void check();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [awaitingPayment, checkVersion, t]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);

  async function subscribe() {
    if (submitting.current || phase !== "choosing" || detailPlan !== null) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, billingCycle: "monthly" }),
      });
      const body = await response.json();
      if (!mounted.current) return;
      if (!response.ok || body?.trialExtended) throw new Error("checkout_unavailable");
      if (body?.recoveredSubscription === true) {
        setPhase("waiting");
        setAwaitingRecoveredPayment(true);
        setCheckVersion(version => version + 1);
        return;
      }
      const url = new URL(body?.url);
      if (url.protocol !== "https:" || !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)) throw new Error("checkout_invalid");
      window.location.assign(url.toString());
    } catch {
      if (mounted.current) setError(t("paymentFailed"));
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) request.current = null;
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function returnToOffers(select = false) {
    if (!detailPlan) return;
    if (select) setPlan(detailPlan);
    returnFocus.current = { plan: detailPlan, select };
    setDetailPlan(null);
  }

  return <main className={styles.page}>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="direct-signup-title" aria-describedby={detailPlan ? undefined : "direct-signup-description"} onCancel={event => { event.preventDefault(); returnToOffers(); }}>
      <div className={styles.body}>
        {detailPlan ? <button type="button" className={styles.back} onClick={() => returnToOffers()}><span aria-hidden="true">←</span>{t("backToOffers")}</button> : null}
        <header className={`${styles.header}${detailPlan ? ` ${styles.detailHeader}` : ""}`}>
          {!detailPlan ? <p className={styles.brand}>iNrCy</p> : null}
          <h1 ref={title} id="direct-signup-title" tabIndex={-1}>{detailPlan ? t("detailsTitle", { plan: name(detailPlan) }) : t("title")}</h1>
          {!detailPlan ? <><p id="direct-signup-description">{t("body")}</p><p className={styles.email}>{email}</p></> : null}
        </header>
        {phase === "checking" || phase === "waiting" ? <div className={styles.status} role="status"><span className={styles.spinner} aria-hidden="true" />{t(phase === "waiting" ? "waiting" : "checking")}</div> : null}
        {checkout === "cancel" && !awaitingPayment && phase === "choosing" ? <p role="status" className={styles.notice}>{t("cancelled")}</p> : null}
        {awaitingPayment && phase === "choosing" ? <p role="status" className={styles.notice}>{t("pending")}</p> : null}
        {phase === "choosing" && detailPlan ? <div className={styles.detailView}>
          <section className={`${styles.detailCard} ${PLAN_STYLES[detailPlan]}`} aria-label={`iNrCy ${name(detailPlan)}`}>
            <header className={styles.detailHeading}>
              <div><h2>iNrCy {name(detailPlan)}</h2><p>{s(`subscription_${detailPlan.toLowerCase()}_benefit`)}</p></div>
              <p className={styles.price}>{money(currentSubscriptionOffer(detailPlan).monthlyPriceEur)} <small>{t("priceUnit")}</small></p>
            </header>
            {detailPlan === "Premium" ? <p className={offerStyles.standardIncluded}>{s("subscription_standard_plus")}</p> : null}
            <SubscriptionPlanFeatures edition={detailPlan.toLowerCase() as "basic" | "standard" | "premium"} />
            <button type="button" className={styles.choosePlan} onClick={() => returnToOffers(true)}>{t("choosePlan", { plan: name(detailPlan) })}<span aria-hidden="true">→</span></button>
          </section>
        </div> : null}
        {phase === "choosing" && detailPlan === null ? <>
          <fieldset className={styles.plans} disabled={busy}>
            <legend className={styles.legend}>{t("choice")}</legend>
            {PLANS.map(value => {
              const edition = value.toLowerCase() as "basic" | "standard" | "premium";
              return <section key={value} className={`${styles.card} ${PLAN_STYLES[value]}`} data-selected={value === plan}>
                <label className={styles.option}>
                  <span className={styles.optionHeading}><strong>iNrCy {name(value)}</strong><input ref={element => { planInputs.current[value] = element; }} type="radio" name="signup-plan" value={value} checked={value === plan} onChange={() => setPlan(value)} /></span>
                  <span className={styles.price}>{money(currentSubscriptionOffer(value).monthlyPriceEur)} <small>{t("priceUnit")}</small></span>
                  <span className={styles.benefit}>{s(`subscription_${edition}_benefit`)}</span>
                </label>
                <button ref={element => { featureButtons.current[value] = element; }} type="button" className={styles.featuresButton} aria-label={t("detailsFor", { plan: name(value) })} onClick={() => setDetailPlan(value)}>{t("details")}<span aria-hidden="true">↗</span></button>
              </section>;
            })}
          </fieldset>
          <footer className={styles.footer}>
            <button type="button" className={styles.primary} onClick={() => { void subscribe(); }} disabled={busy}>{busy ? t("opening") : t("continue", { plan: name(plan), amount: money(currentSubscriptionOffer(plan).monthlyPriceEur) })}</button>
            <details className={styles.paymentTerms}>
              <summary>{t("paymentTerms")}</summary>
              <div><p className={styles.cancellation}>{t("cancellationNotice")}</p><p>{t("paymentNotice")}</p><p>{s("standard_taxes_checkout")}</p><a href="https://inrcy.com/cga-conditions-generales-dabonnement/" target="_blank" rel="noopener noreferrer">{t("terms")}</a></div>
            </details>
          </footer>
        </> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {phase === "error" || awaitingPayment && phase === "choosing" ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => setCheckVersion(version => version + 1)}>{t("retry")}</button> : null}
        <div className={styles.links}><a href="https://inrcy.com/contact/" target="_blank" rel="noopener noreferrer">{t("help")}</a><form action="/api/auth/sign-out" method="post"><button type="submit">{t("signOut")}</button></form></div>
      </div>
    </dialog>
  </main>;
}
