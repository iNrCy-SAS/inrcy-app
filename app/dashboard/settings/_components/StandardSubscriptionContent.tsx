"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import {
  STANDARD_SUBSCRIPTION_OFFER,
  type BillingCycle,
} from "@/lib/subscriptionOffers";

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
};

const SUBSCRIPTION_SELECT =
  "plan,scheduled_plan,status,trial_end_at,next_renewal_date,cancel_requested_at,end_date,stripe_customer_id,stripe_subscription_id,stripe_price_id,billing_cycle";

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

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function statusPresentation(subscription: SubscriptionData | null) {
  const status = normalizeStatus(subscription?.status);
  if (status === "trialing") return { label: "Essai 21 jours", color: "#8feaff" };
  if (status === "active") return { label: "Actif", color: "#8ff7d0" };
  if (status === "past_due" || status === "unpaid") return { label: "À régulariser", color: "#ffd38f" };
  if (status === "canceled" || status === "cancelled") return { label: "Résilié", color: "#ff9bbd" };
  if (status === "trial_expired") return { label: "Essai terminé", color: "#ffbd8f" };
  if (status === "paused") return { label: "Suspendu", color: "#ffbd8f" };
  return { label: "À vérifier", color: "#c8d3ef" };
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || "L’opération n’a pas pu être réalisée.";
}

export default function StandardSubscriptionContent({ onOpenContact }: Props) {
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
        if (active) setError("Impossible de charger votre abonnement.");
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
    setMessage("Paiement enregistré. La synchronisation de votre abonnement est en cours.");
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
    const hasStripeSubscription =
      Boolean(subscription?.stripe_subscription_id) && !reusableStatuses.includes(status);
    const cancellationScheduled = Boolean(subscription?.cancel_requested_at && subscription?.end_date);
    const canStartCheckout =
      !hasStripeSubscription &&
      ["trialing", ...reusableStatuses].includes(status);
    const needsBillingRecovery = ["past_due", "unpaid", "incomplete"].includes(status);
    return {
      status,
      hasStripeSubscription,
      cancellationScheduled,
      canStartCheckout,
      needsBillingRecovery,
      trialEndLabel: formatDate(subscription?.trial_end_at),
      renewalLabel: formatDate(subscription?.next_renewal_date),
      endLabel: formatDate(subscription?.end_date),
      billingCycle: subscription?.billing_cycle,
      presentation: statusPresentation(subscription),
    };
  }, [subscription]);

  async function openPortal() {
    setError("");
    setMessage("");
    setBusyAction("portal");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response));
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
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "Standard", billingCycle }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as { url?: string };
      if (!body.url) throw new Error("La page de paiement n’a pas pu être ouverte.");
      window.location.assign(body.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le paiement est momentanément indisponible.");
    } finally {
      setBusyAction(null);
    }
  }

  async function updateCancellation(action: "cancel" | "uncancel") {
    setError("");
    setMessage("");
    setBusyAction(action);
    try {
      const response = await fetch(`/api/billing/${action}`, { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response));
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

  if (loading) return <div style={{ opacity: 0.78 }}>Chargement de votre forfait…</div>;

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
              Votre forfait
            </div>
            <h2 style={{ margin: "5px 0 0", fontSize: 24 }}>iNrCy Standard</h2>
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
          Booster sur 10 canaux, iNr&apos;Agent Publications + Statistiques,
          iNr&apos;Badge inclus, iNr&apos;Stats, historique iNr&apos;Send et Réputation.
        </p>

        <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 13 }}>
          {view.status === "trialing" && view.trialEndLabel ? (
            <div>Fin de votre essai : <strong>{view.trialEndLabel}</strong></div>
          ) : null}
          {view.status === "active" && view.renewalLabel ? (
            <div>Prochaine échéance : <strong>{view.renewalLabel}</strong></div>
          ) : null}
          {view.cancellationScheduled && view.endLabel ? (
            <div style={{ color: "#ffd38f" }}>Accès maintenu jusqu’au <strong>{view.endLabel}</strong>.</div>
          ) : null}
          {view.cancellationScheduled && view.billingCycle === "monthly" && view.renewalLabel ? (
            <div style={{ color: "#ffd38f" }}>Dernière mensualité prévue le <strong>{view.renewalLabel}</strong>.</div>
          ) : null}
        </div>

        {view.canStartCheckout ? (
          <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 900 }}>Choisissez votre rythme de facturation</div>
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
                <strong>Mensuel · 69 € TTC</strong><br />
                <span style={{ fontSize: 12, opacity: 0.72 }}>par mois</span>
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
                <strong>Annuel · 730 € TTC</strong><br />
                <span style={{ fontSize: 12, color: "#f3b0ff" }}>−{STANDARD_SUBSCRIPTION_OFFER.annualSavingPercent} %</span>
              </button>
            </div>
            <button type="button" onClick={startCheckout} style={primaryButton} disabled={busyAction !== null}>
              {busyAction === "checkout"
                ? "Ouverture du paiement…"
                : billingCycle === "yearly"
                  ? "S’abonner · 730 € TTC / an"
                  : "S’abonner · 69 € TTC / mois"}
            </button>
            <div style={{ fontSize: 11, opacity: 0.62, textAlign: "center" }}>
              Pendant l’essai, aucun débit avant sa date de fin. Après l’essai, l’abonnement démarre immédiatement.
            </div>
          </div>
        ) : null}

        {view.needsBillingRecovery ? (
          <button type="button" onClick={openPortal} style={{ ...primaryButton, width: "100%", marginTop: 16 }} disabled={busyAction !== null}>
            {busyAction === "portal" ? "Ouverture…" : "Régulariser mon paiement"}
          </button>
        ) : null}

        {view.hasStripeSubscription && !view.needsBillingRecovery ? (
          <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
            <button type="button" onClick={openPortal} style={secondaryButton} disabled={busyAction !== null}>
              {busyAction === "portal" ? "Ouverture…" : "Gérer ma facturation"}
            </button>
            {view.cancellationScheduled ? (
              <button type="button" onClick={() => updateCancellation("uncancel")} style={primaryButton} disabled={busyAction !== null}>
                {busyAction === "uncancel" ? "Traitement…" : "Annuler ma résiliation"}
              </button>
            ) : (
              <button type="button" onClick={() => updateCancellation("cancel")} style={secondaryButton} disabled={busyAction !== null}>
                {busyAction === "cancel" ? "Traitement…" : "Programmer ma résiliation"}
              </button>
            )}
            {!view.cancellationScheduled ? (
              <div style={{ fontSize: 11, opacity: 0.65, lineHeight: 1.45 }}>
                Essai : arrêt sans prélèvement. Mensuel actif : la prochaine mensualité sera la dernière et couvrira le mois de préavis. Annuel : arrêt à l'échéance sans renouvellement supplémentaire.
              </div>
            ) : null}
          </div>
        ) : null}

        {checkoutState === "cancel" ? <p style={{ color: "#ffd38f" }}>Paiement annulé : aucun changement n’a été appliqué.</p> : null}
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
          Autre forfait
        </div>
        <h2 style={{ margin: "5px 0 4px", fontSize: 24 }}>iNrCy Premium</h2>
        <p style={{ margin: "0 0 14px", opacity: 0.75, lineHeight: 1.5 }}>
          Passez du pilotage de votre visibilité au pilotage complet de votre activité.
        </p>
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {premiumFeatures.map((feature) => (
            <div key={feature} style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 13, opacity: 0.86 }}>
              <span aria-hidden="true" style={{ color: "#8feaff", fontWeight: 950 }}>✓</span>
              {feature}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontSize: 12 }}>
          <span style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(255,255,255,.06)" }}>129 € TTC / mois</span>
          <span style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(255,255,255,.06)" }}>1 390 € TTC / an · −10 %</span>
        </div>
        <button type="button" onClick={onOpenContact} style={{ ...primaryButton, width: "100%" }}>
          Nous contacter pour Premium
        </button>
        <p style={{ margin: "10px 0 0", textAlign: "center", fontSize: 11, opacity: 0.58 }}>
          Le passage à Premium nécessite une présentation avec l’équipe iNrCy.
        </p>
      </section>
    </div>
  );
}
