"use client";

import { useLocale, useTranslations } from "next-intl";


import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import {
  STANDARD_SUBSCRIPTION_OFFER,
  type BillingCycle,
} from "@/lib/subscriptionOffers";
import { startStandardSubscriptionCheckout } from "@/lib/clientSubscriptionBilling";
import { openNativeSubscriptionManagement } from "@/lib/nativeBillingManagement";

type Props = {
  onOpenContact: () => void;
};

type SubscriptionData = {
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

const SUBSCRIPTION_SELECT =
  "plan,scheduled_plan,status,trial_end_at,next_renewal_date,cancel_requested_at,end_date,stripe_customer_id,stripe_subscription_id,stripe_price_id,billing_cycle,billing_provider,native_product_id,native_will_renew";

const premiumFeatures = [
  "iNr’Agent complet avec Propulser et Fidéliser",
  "iNr’Send complet et campagnes mails",
  "iNr’CRM et gestion commerciale",
  "Agenda et suivi des rendez-vous",
  "Propulser et Fidéliser",
];

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
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"checkout" | "portal" | "cancel" | "uncancel" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadSubscription = useCallback(async () => {
    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) return;
    const { data, error: queryError } = await supabase
      .from("subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (queryError) throw queryError;
    setSubscription((data as SubscriptionData | null) ?? null);
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
    if (checkoutState !== "success") return;
    setMessage(i18nT("paiement_enregistre_la_synchronisation_de_votre_d53f480e"));
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void loadSubscription().catch(() => null);
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
    const canStartCheckout =
      !hasNativeSubscription &&
      !hasStripeSubscription &&
      ["trialing", ...reusableStatuses].includes(status);
    const needsBillingRecovery = ["past_due", "unpaid", "incomplete"].includes(status);
    return {
      status,
      hasStripeSubscription,
      hasNativeSubscription,
      billingProvider,
      cancellationScheduled,
      canStartCheckout,
      needsBillingRecovery,
      trialEndLabel: formatDate(subscription?.trial_end_at, locale),
      renewalLabel: formatDate(subscription?.next_renewal_date, locale),
      endLabel: formatDate(subscription?.end_date, locale),
      billingCycle: subscription?.billing_cycle,
      presentation: statusPresentation(subscription, i18nT),
    };
  }, [subscription, locale, i18nT]);

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

  async function startCheckout() {
    setError("");
    setMessage("");
    setBusyAction("checkout");
    try {
      const result = await startStandardSubscriptionCheckout({
        billingCycle,
        fallbackError: i18nT("l_operation_n_a_pas_pu_2eda8de6"),
      });
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

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section style={{
        padding: 18,
        borderRadius: 18,
        border: "1px solid rgba(61, 222, 255, 0.28)",
        background: "linear-gradient(135deg, rgba(26, 127, 255, 0.16), rgba(61, 223, 255, 0.08))",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.72, textTransform: "uppercase", letterSpacing: ".08em" }}>
              {i18nT("votre_forfait_6d06f631")}{" "}</div>
            <h2 style={{ margin: "5px 0 0", fontSize: 24 }}>{i18nT("inrcy_standard_1dd18060")}</h2>
          </div>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "7px 11px",
            borderRadius: 999,
            border: `1px solid ${view.presentation.color}55`,
            background: "rgba(8, 18, 46, 0.36)",
            color: view.presentation.color,
            fontSize: 12,
            fontWeight: 900,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: view.presentation.color, boxShadow: `0 0 9px ${view.presentation.color}` }} />
            {view.presentation.label}
          </span>
        </div>

        <p style={{ margin: "14px 0 0", opacity: 0.78, lineHeight: 1.55 }}>
          {i18nT("booster_sur_10_canaux_inr_apos_38a43414")}{" "}</p>

        <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 13 }}>
          {view.status === "trialing" && view.trialEndLabel ? (
            <div>{i18nT("fin_de_votre_essai_f1bae9e9")}{" "}<strong>{view.trialEndLabel}</strong></div>
          ) : null}
          {view.status === "active" && view.renewalLabel ? (
            <div>{i18nT("prochaine_echeance_97d55f4d")}{" "}<strong>{view.renewalLabel}</strong></div>
          ) : null}
          {view.cancellationScheduled && view.endLabel ? (
            <div style={{ color: "#ffd38f" }}>{i18nT("acces_maintenu_jusqu_au_4270c8d3")}{" "}<strong>{view.endLabel}</strong>.</div>
          ) : null}
          {view.cancellationScheduled && view.billingCycle === "monthly" && view.renewalLabel ? (
            <div style={{ color: "#ffd38f" }}>{i18nT("derniere_mensualite_prevue_le_f3d69894")}{" "}<strong>{view.renewalLabel}</strong>.</div>
          ) : null}
        </div>

        {view.canStartCheckout ? (
          <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 900 }}>{i18nT("choisissez_votre_rythme_de_facturation_aca0763d")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
              <button
                type="button"
                onClick={() => setBillingCycle("monthly")}
                style={{
                  ...secondaryButton,
                  textAlign: "left",
                  borderColor: billingCycle === "monthly" ? "rgba(61,222,255,.72)" : "rgba(255,255,255,.14)",
                  background: billingCycle === "monthly" ? "rgba(24,145,220,.18)" : "rgba(255,255,255,.04)",
                }}
              >
                <strong>{i18nT("mensuel_69_ttc_6c947c24")}</strong><br />
                <span style={{ fontSize: 12, opacity: 0.72 }}>{i18nT("par_mois_5f10ecc3")}</span>
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle("yearly")}
                style={{
                  ...secondaryButton,
                  textAlign: "left",
                  borderColor: billingCycle === "yearly" ? "rgba(221,93,255,.72)" : "rgba(255,255,255,.14)",
                  background: billingCycle === "yearly" ? "rgba(150,72,220,.17)" : "rgba(255,255,255,.04)",
                }}
              >
                <strong>{i18nT("annuel_730_ttc_19db2ae7")}</strong><br />
                <span style={{ fontSize: 12, color: "#f3b0ff" }}>−{STANDARD_SUBSCRIPTION_OFFER.annualSavingPercent} %</span>
              </button>
            </div>
            <button type="button" onClick={startCheckout} style={primaryButton} disabled={busyAction !== null}>
              {busyAction === "checkout"
                ? i18nT("ouverture_du_paiement_147e6d80")
                : billingCycle === "yearly"
                  ? i18nT("s_abonner_730_ttc_an_32c8d758")
                  : i18nT("s_abonner_69_ttc_mois_095d3d9f")}
            </button>
            <div style={{ fontSize: 11, opacity: 0.62, textAlign: "center" }}>
              {i18nT("pendant_l_essai_aucun_debit_avant_c17dea44")}{" "}</div>
          </div>
        ) : null}

        {view.needsBillingRecovery ? (
          <button type="button" onClick={openPortal} style={{ ...primaryButton, width: "100%", marginTop: 16 }} disabled={busyAction !== null}>
            {busyAction === "portal" ? i18nT("ouverture_3333ad14") : i18nT("regulariser_mon_paiement_00ae072e")}
          </button>
        ) : null}

        {view.hasStripeSubscription && !view.needsBillingRecovery ? (
          <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
            <button type="button" onClick={openPortal} style={secondaryButton} disabled={busyAction !== null}>
              {busyAction === "portal" ? i18nT("ouverture_3333ad14") : i18nT("gerer_ma_facturation_dc5027ac")}
            </button>
            {view.cancellationScheduled ? (
              <button type="button" onClick={() => updateCancellation("uncancel")} style={primaryButton} disabled={busyAction !== null}>
                {busyAction === "uncancel" ? i18nT("traitement_2f66d9bc") : i18nT("annuler_ma_resiliation_902e43a0")}
              </button>
            ) : (
              <button type="button" onClick={() => updateCancellation("cancel")} style={secondaryButton} disabled={busyAction !== null}>
                {busyAction === "cancel" ? i18nT("traitement_2f66d9bc") : i18nT("programmer_ma_resiliation_d074ca2d")}
              </button>
            )}
            {!view.cancellationScheduled ? (
              <div style={{ fontSize: 11, opacity: 0.65, lineHeight: 1.45 }}>
                {i18nT("essai_arret_sans_prelevement_mensuel_actif_32634c83")}{" "}</div>
            ) : null}
          </div>
        ) : null}

        {view.hasNativeSubscription && !view.needsBillingRecovery ? (
          <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
            <button type="button" onClick={openPortal} style={secondaryButton} disabled={busyAction !== null}>
              {busyAction === "portal" ? i18nT("ouverture_3333ad14") : i18nT("gerer_ma_facturation_dc5027ac")}
            </button>
            <div style={{ fontSize: 11, opacity: 0.68, lineHeight: 1.45 }}>
              {i18nT("native_subscription_managed_by_store", {
                store: view.billingProvider === "app_store" ? "App Store" : "Google Play",
              })}
            </div>
          </div>
        ) : null}

        {checkoutState === "cancel" ? <p style={{ color: "#ffd38f" }}>{i18nT("paiement_annule_aucun_changement_n_a_c603ca12")}</p> : null}
        {message ? <p style={{ color: "#8ff7d0", marginBottom: 0 }}>{message}</p> : null}
        {error ? <p style={{ color: "#ff9bbd", marginBottom: 0 }}>{error}</p> : null}
      </section>

      <section style={{
        padding: 18,
        borderRadius: 18,
        border: "1px solid rgba(180, 99, 255, 0.25)",
        background: "linear-gradient(145deg, rgba(124, 55, 220, 0.13), rgba(255, 75, 172, 0.08))",
      }}>
        <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.68, textTransform: "uppercase", letterSpacing: ".08em" }}>
          {i18nT("autre_forfait_b5347942")}{" "}</div>
        <h2 style={{ margin: "5px 0 4px", fontSize: 24 }}>{i18nT("inrcy_premium_4c7d39c1")}</h2>
        <p style={{ margin: "0 0 14px", opacity: 0.75, lineHeight: 1.5 }}>
          {i18nT("passez_du_pilotage_de_votre_visibilite_37fbfe56")}{" "}</p>
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {premiumFeatures.map((feature) => (
            <div key={feature} style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 13, opacity: 0.86 }}>
              <span aria-hidden="true" style={{ color: "#8feaff", fontWeight: 950 }}>✓</span>
              {feature}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontSize: 12 }}>
          <span style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(255,255,255,.06)" }}>{i18nT("129_ttc_mois_8db9d0a4")}</span>
          <span style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(255,255,255,.06)" }}>{i18nT("1_390_ttc_an_10_d7b3747d")}</span>
        </div>
        <button type="button" onClick={onOpenContact} style={{ ...primaryButton, width: "100%" }}>
          {i18nT("nous_contacter_pour_premium_149750a6")}{" "}</button>
        <p style={{ margin: "10px 0 0", textAlign: "center", fontSize: 11, opacity: 0.58 }}>
          {i18nT("le_passage_a_premium_necessite_une_2e3ad843")}{" "}</p>
      </section>
    </div>
  );
}
