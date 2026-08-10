"use client";

import { getSimpleFrenchApiError, getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  PREMIUM_SUBSCRIPTION_OFFER,
  STANDARD_SUBSCRIPTION_OFFER,
} from "@/lib/subscriptionOffers";


type InrcyPlan = "Trial" | "Standard" | "Premium" | "Starter" | "Accel" | "Speed";
type BillingCycle = "monthly" | "yearly";

function normalizePlan(raw: unknown): InrcyPlan {
  const value = String(raw || "").trim();
  if (value === "Trial" || /^essai/i.test(value)) return "Trial";
  if (value === "Standard") return "Standard";
  if (value === "Premium") return "Premium";
  if (value === "Starter" || /^d[ée]marrage/i.test(value)) return "Starter";
  if (value === "Accel" || /^acc[ée]l[ée]ration/i.test(value)) return "Accel";
  if (value === "Speed" || /^pleine vitesse/i.test(value)) return "Speed";
  return "Trial";
}

function monthlyPriceTtcFromPlan(plan: unknown) {
  const normalized = normalizePlan(plan);
  if (normalized === "Standard") return STANDARD_SUBSCRIPTION_OFFER.monthlyPriceEur;
  if (normalized === "Premium") return PREMIUM_SUBSCRIPTION_OFFER.monthlyPriceEur;
  if (normalized === "Starter") return 69;
  if (normalized === "Accel") return 149;
  if (normalized === "Speed") return 359;
  return 0;
}

function planShortLabel(plan: unknown) {
  const normalized = normalizePlan(plan);
  if (normalized === "Standard") return "Standard";
  if (normalized === "Premium") return "Premium";
  if (normalized === "Starter") return "Partenaire Fondateur";
  if (normalized === "Accel") return "Accélération";
  if (normalized === "Speed") return "Pleine vitesse";
  return "Essai 21j";
}

type Props = {
  mode?: "page" | "drawer";
  onOpenContact?: () => void; // ✅ pour ouvrir la fenêtre contact depuis le drawer
};

type SubData = {
  plan: InrcyPlan;
  scheduled_plan?: InrcyPlan | null;
  status:
    | "incomplete"
    | "incomplete_expired"
    | "trialing"
    | "trial_expired"
    | "active"
    | "past_due"
    | "unpaid"
    | "canceled"
    | "paused"
    | string;
  monthly_price_eur: number | null;
  start_date: string; // YYYY-MM-DD
  trial_start_at?: string | null;
  trial_end_at?: string | null;
  next_renewal_date?: string | null;
  // cancellation (synced by Stripe webhooks)
  cancel_requested_at?: string | null;
  end_date?: string | null; // YYYY-MM-DD
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_price_id?: string | null;
  billing_cycle?: BillingCycle | null;
  founder_offer_enabled?: boolean | null;
};
const SUB_SELECT =
  "plan,scheduled_plan,status,monthly_price_eur,start_date,trial_start_at,trial_end_at,next_renewal_date,cancel_requested_at,end_date,stripe_customer_id,stripe_subscription_id,stripe_price_id,billing_cycle,founder_offer_enabled";


function frDate(d: Date) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function parseYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// ✅ dernière date d’anniversaire mensuelle (<= aujourd’hui)
function lastMonthlyAnniversary(start: Date, now: Date) {
  const day = start.getDate();
  const y = now.getFullYear();
  let m = now.getMonth();

  let cand = new Date(y, m, day);

  // si le jour n’existe pas (ex 31), JS décale : on prend le dernier jour du mois
  if (cand.getMonth() !== m) {
    cand = new Date(y, m + 1, 0);
  }

  if (cand > now) {
    m -= 1;
    cand = new Date(y, m, day);
    const normalizedMonth = ((m % 12) + 12) % 12;
    if (cand.getMonth() !== normalizedMonth) {
      cand = new Date(y, m + 1, 0);
    }
  }

  return cand;
}

// ✅ prochaine date d’anniversaire mensuelle ( > aujourd’hui )
function _nextMonthlyAnniversary(start: Date, now: Date) {
  const day = start.getDate();
  const y = now.getFullYear();
  const m = now.getMonth();

  let cand = new Date(y, m, day);

  // jour inexistant => dernier jour du mois
  if (cand.getMonth() !== m) cand = new Date(y, m + 1, 0);

  // si on est déjà passé (ou pile), on prend le mois suivant
  if (cand <= now) {
    cand = new Date(y, m + 1, day);
    const targetMonth = (m + 1) % 12;
    if (cand.getMonth() !== targetMonth) cand = new Date(y, m + 2, 0);
  }

  return cand;
}

function addMonthsSafe(date: Date, months: number) {
  const d = date.getDate();
  const res = new Date(date);
  res.setMonth(res.getMonth() + months);
  if (res.getDate() !== d) res.setDate(0);
  return res;
}

function addDays(date: Date, days: number) {
  const res = new Date(date);
  res.setDate(res.getDate() + days);
  return res;
}

function statusLabel(raw: string) {
  // Tolérance aux anciennes valeurs / fautes de frappe en base.
  if (raw === "trialing" || raw === "trailing" || raw === "essai") return "ESSAI";
  if (raw === "trial_expired" || raw === "trial-expired") return "ESSAI TERMINÉ";
  if (raw === "active") return "ACTIF";
  if (raw === "past_due" || raw === "unpaid") return "IMPAYÉ";
  if (raw === "paused") return "SUSPENDU";
  if (raw === "canceled" || raw === "cancelled") return "RÉSILIÉ";
  if (raw === "incomplete" || raw === "incomplete_expired") return "EN ATTENTE";
  return String(raw || "").toUpperCase() || "INCONNU";
}

function planLabel(plan: SubData["plan"]) {
  const normalized = normalizePlan(plan);
  if (normalized === "Starter") return "Offre Partenaire Fondateur";
  if (normalized === "Accel") return "Pack Accélération";
  if (normalized === "Speed") return "Pack Pleine vitesse";
  return "Essai 21j";
}

export default function AbonnementContent({ mode: _mode = "page", onOpenContact }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const checkoutState = searchParams.get("checkout"); // success | cancel | null
  const checkoutBilling = searchParams.get("billing"); // monthly | yearly | null
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<SubData | null>(null);
  const [err, setErr] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [billingMsg, setBillingMsg] = useState<string>("");

// ✅ Refresh abonnement après actions Stripe (merge pour éviter d'écraser des champs)
const fetchSubscription = async () => {
  try {
    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;
    if (!user) return;

    const { data } = await supabase
      .from("subscriptions")
      .select(SUB_SELECT)
      .eq("user_id", user.id)
      .maybeSingle();

    if (data) {
      setSub((prev) => ({ ...(prev ?? ({} as SubData)), ...(data as SubData) }));
    }
  } catch (e) {
    console.error("fetchSubscription error", e);
  }
};

useEffect(() => {
    const load = async () => {
      setErr("");
      setLoading(true);

      try {
        const supabase = createClient();
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user) {
          setSub(null);
          return;
        }

        const { data, error } = await supabase
          .from("subscriptions")
          .select(SUB_SELECT)
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw new Error(error.message);

        if (!data) {
          setSub(null);
          return;
        }

        setSub(data as SubData);
      } catch (e: unknown) {
        setErr(getSimpleFrenchErrorMessage(e, "Impossible de charger l’abonnement."));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  // ✅ Après un checkout Stripe, on repoll quelques secondes pour laisser le webhook mettre à jour la DB.
  useEffect(() => {
    if (checkoutState !== "success") return;
    let alive = true;
    const supabase = createClient();
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      if (!alive || tries > 8) {
        clearInterval(timer);
        return;
      }
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) return;
      const { data } = await supabase
        .from("subscriptions")
        .select(SUB_SELECT)
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) setSub((prev) => ({ ...(prev ?? ({} as SubData)), ...(data as SubData) }));
    }, 1500);

    return () => {
      alive = false;
      clearInterval(timer);
    };

  }, [checkoutState]);

  // ✅ Nettoie l'URL après un retour Stripe (évite de garder ?checkout=success et de repoll inutilement)
  useEffect(() => {
    if (!checkoutState) return;

    const t = window.setTimeout(() => {
      const current = new URLSearchParams(searchParams.toString());
      if (!current.has("checkout")) return;
      current.delete("checkout");
      current.delete("billing");

      const qs = current.toString();
      const nextUrl = qs ? `${pathname}?${qs}` : pathname;
      router.replace(nextUrl);
    }, 2500);

    return () => window.clearTimeout(t);
  }, [checkoutState, pathname, router, searchParams]);

  const computed = useMemo(() => {
    if (!sub) return null;

    // Normalise plan pour la logique UI (compat anciennes valeurs).
    const planNormalized = normalizePlan(sub.plan);

    const statusNorm = String(sub.status || "").toLowerCase();
    const isTrialPlan = planNormalized === "Trial" || statusNorm === "trialing" || statusNorm === "trailing" || statusNorm === "essai";

    const start = parseYMD(sub.start_date);
    const now = new Date();

    const lastAnniv = now < start ? start : lastMonthlyAnniversary(start, now);
    const renewal = sub.next_renewal_date ? parseYMD(sub.next_renewal_date) : addMonthsSafe(lastAnniv, 1);
    const endEst = addMonthsSafe(lastAnniv, 2);
    const trialEnd = sub.trial_end_at ? new Date(sub.trial_end_at) : addDays(start, 21);
    const trialEndsWithinStripeMinimum = trialEnd.getTime() <= now.getTime() + 2 * 24 * 60 * 60 * 1000;

    const cancelEnd = sub.end_date ? parseYMD(sub.end_date) : null;
    const cancellationScheduled = !!sub.cancel_requested_at && !!cancelEnd && cancelEnd.getTime() > now.getTime();
    const monthlyNoticeCancellation = Boolean(
      cancellationScheduled && cancelEnd && renewal && cancelEnd.getTime() > renewal.getTime(),
    );

    const hasStripeSub = !!sub.stripe_subscription_id;
    const annualPayment =
      sub.billing_cycle === "yearly" ||
      (!sub.billing_cycle && statusNorm === "active" && Number(sub.monthly_price_eur || 0) >= 600);

    // ✅ UX: au retour Stripe (?checkout=success), on considère l'abonnement comme "programmé" immédiatement,
    // même si le webhook n'a pas encore eu le temps d'écrire stripe_subscription_id en DB.
    const hasScheduledSubscription = hasStripeSub || checkoutState === "success";

    // Si l'utilisateur a déjà saisi ses moyens de paiement pendant l'essai,
    // on considère l'abonnement comme "programmé" (Stripe subscription existe mais statut = essai).
    const scheduledStart = trialEnd;

    const scheduledPlan = normalizePlan(sub.scheduled_plan || "Starter") as SubData["plan"];
    const storedPriceRaw = sub.monthly_price_eur == null ? null : Number(sub.monthly_price_eur);
    const storedPrice = storedPriceRaw != null && Number.isFinite(storedPriceRaw) && storedPriceRaw >= 0
      ? storedPriceRaw
      : null;

    // Source de vérité : subscriptions.monthly_price_eur.
    // Cela s'applique aussi aux abonnements déjà en cours et aux tarifs négociés saisis manuellement.
    // Le tarif du plan ne sert que de secours si la colonne DB est réellement absente/invalide.
    const monthlyPriceTtc = planNormalized === "Trial"
      ? 0
      : storedPrice ?? monthlyPriceTtcFromPlan(planNormalized);
    const displayedPriceTtc = annualPayment
      ? planNormalized === "Standard"
        ? STANDARD_SUBSCRIPTION_OFFER.yearlyPriceEur
        : planNormalized === "Premium"
          ? PREMIUM_SUBSCRIPTION_OFFER.yearlyPriceEur
          : monthlyPriceTtc
      : monthlyPriceTtc;

    return {
      startLabel: frDate(start),
      trialEndLabel: frDate(trialEnd),
      scheduledStartLabel: frDate(scheduledStart),
      renewalLabel: frDate(renewal),
      endEstLabel: frDate(endEst),
      cancelEndLabel: cancelEnd ? frDate(cancelEnd) : null,
      cancellationScheduled,
      monthlyNoticeCancellation,
      priceLabel: `${displayedPriceTtc} €`,
      annualPayment,
      statusText: isTrialPlan ? "ESSAI" : statusLabel(statusNorm),
      hasStripeSub: hasScheduledSubscription,
      scheduledPlanLabel: planShortLabel(scheduledPlan),
      planNormalized,
      trialEndsWithinStripeMinimum,
    };
  }, [sub, checkoutState]);

  const shell: React.CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background:
      "linear-gradient(135deg, rgba(255, 77, 166, 0.14), rgba(97, 87, 255, 0.10) 45%, rgba(0, 200, 255, 0.08))",
  };

  const card: React.CSSProperties = {
    padding: 16,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.045)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  };

  const badge: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background:
      "linear-gradient(135deg, rgba(255, 77, 166, 0.22), rgba(97, 87, 255, 0.16), rgba(0, 200, 255, 0.12))",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
  };

  const miniBox: React.CSSProperties = {
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
    minWidth: 0,
  };

  const primaryBtn: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.18)",
    background:
      "linear-gradient(135deg, rgba(255, 77, 166, 0.35), rgba(97, 87, 255, 0.28), rgba(0, 200, 255, 0.22))",
    color: "white",
    borderRadius: 14,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  };

  const ghostBtn: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "white",
    borderRadius: 14,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    opacity: billingBusy ? 0.7 : 1,
    pointerEvents: billingBusy ? "none" : "auto",
  };

  const dangerBtn: React.CSSProperties = {
    ...ghostBtn,
    border: "1px solid rgba(255, 120, 120, 0.35)",
    background: "rgba(255, 80, 80, 0.10)",
  };

  const openBillingPortal = async () => {
    try {
      setBillingMsg("");
      setPortalBusy(true);
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await getSimpleFrenchApiError(res, "Le portail de facturation n’a pas pu être ouvert pour le moment."));
      const json = await res.json().catch(() => ({}));
      if (!json?.url) throw new Error("Le portail de facturation n’a pas pu être ouvert pour le moment.");
      window.location.href = json.url;
    } catch (e: unknown) {
      setBillingMsg(getSimpleFrenchErrorMessage(e, "Le portail de facturation n’a pas pu être ouvert pour le moment."));
      setPortalBusy(false);
    }
  };

  const doCancel = async () => {
    const ok = await confirmInrcy({
      title: "Confirmer la résiliation ?",
      message: "Mensuel actif : votre prochaine mensualité sera la dernière et couvrira un mois complet de préavis. Annuel : arrêt à l'échéance sans nouveau prélèvement annuel. Essai : arrêt sans prélèvement.",
      confirmLabel: "Résilier",
      variant: "danger",
    });
    if (!ok) return;
    try {
      setBillingMsg("");
      setBillingBusy(true);
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await getSimpleFrenchApiError(res, "La résiliation n’a pas pu être enregistrée pour le moment."));
      const json = await res.json().catch(() => ({}));
      setBillingMsg(
        json?.warning ||
          (json?.cancellation_policy === "one_additional_monthly_renewal"
            ? "La résiliation est programmée. Votre prochaine mensualité sera la dernière et financera le mois de préavis."
            : json?.cancellation_policy === "trial_end_without_charge"
              ? "Votre essai s'arrêtera à son échéance, sans prélèvement."
              : "La résiliation est programmée à l'échéance annuelle, sans nouveau prélèvement annuel."),
      );
      await fetchSubscription();
      setBillingBusy(false);
    } catch (e: unknown) {
      setBillingMsg(getSimpleFrenchErrorMessage(e, "La résiliation n’a pas pu être enregistrée pour le moment."));
      setBillingBusy(false);
    }
  };

  const doUncancel = async () => {
    const ok = await confirmInrcy({
      title: "Annuler la résiliation ?",
      message: "Votre abonnement restera actif comme avant.",
      confirmLabel: "Annuler la résiliation",
      variant: "warning",
    });
    if (!ok) return;
    try {
      setBillingMsg("");
      setBillingBusy(true);
      const res = await fetch("/api/billing/uncancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await getSimpleFrenchApiError(res, "Impossible d’annuler la résiliation programmée pour le moment."));
      const json = await res.json().catch(() => ({}));
      setBillingMsg(json?.message || "La résiliation programmée a bien été annulée.");
      await fetchSubscription();
      setBillingBusy(false);
    } catch (e: unknown) {
      setBillingMsg(getSimpleFrenchErrorMessage(e, "Impossible d’annuler la résiliation programmée pour le moment."));
      setBillingBusy(false);
    }
  };

  if (loading) return <div style={{ opacity: 0.85 }}>Chargement…</div>;
  if (err) return <div style={{ opacity: 0.9 }}>⚠️ {err}</div>;

  if (!sub || !computed) {
    return (
      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Mon abonnement</h2>
        <p style={{ margin: "8px 0 0", opacity: 0.8 }}>
          Votre abonnement n’est pas encore renseigné. Contactez iNrCy si besoin.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <style>{`
        .datesGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }
        .billingPackGrid,
        .billingCycleGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        @media (max-width: 520px) {
          .datesGrid,
          .billingPackGrid,
          .billingCycleGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div style={{ ...card, ...shell, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ opacity: 0.85, fontSize: 12, fontWeight: 900, letterSpacing: 0.4 }}>PACK</div>
            <div style={{ fontSize: 22, fontWeight: 950, marginTop: 4, lineHeight: 1.15 }}>{planLabel(sub.plan)}</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <span style={badge}>SANS ENGAGEMENT</span>
              <span style={badge}>{computed.annualPayment ? "ANNUEL" : "MENSUEL"}</span>
              <span style={badge}>{computed.statusText}</span>
            </div>
          </div>

          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ opacity: 0.85, fontSize: 12, fontWeight: 900, letterSpacing: 0.4 }}>PRIX</div>
            <div style={{ fontSize: 26, fontWeight: 950, marginTop: 4, lineHeight: 1 }}>{computed.priceLabel}</div>
            <div style={{ opacity: 0.75, fontSize: 12, marginTop: 6 }}>{computed.annualPayment ? "TTC / an" : "TTC par mois"}</div>
          </div>
        </div>
      </div>

      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Dates</h2>

        <div
          className="datesGrid"
          style={computed?.planNormalized === "Trial" ? ({ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } as any) : undefined}
        >
          {computed?.planNormalized === "Trial" ? (
            <>
              <div style={miniBox}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>Inscription</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900 }}>{computed.startLabel}</div>
              </div>

              <div style={miniBox}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>Fin de période d’essai</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900 }}>{computed.trialEndLabel}</div>
              </div>
            </>
          ) : (
            <>
              <div style={miniBox}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>Actualisation</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900 }}>{computed.startLabel}</div>
              </div>

              <div style={miniBox}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>{computed.annualPayment ? "Renouvellement annuel" : "Renouvellement"}</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900 }}>{computed.renewalLabel}</div>
              </div>

              <div style={miniBox}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>{computed.annualPayment ? "Formule" : "Fin prévisionnelle"}</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900 }}>{computed.annualPayment && !computed.cancellationScheduled ? "Annuelle" : computed.cancellationScheduled && computed.cancelEndLabel ? computed.cancelEndLabel : computed.endEstLabel}</div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75, lineHeight: 1.3 }}>
                  {computed.cancellationScheduled ? "Résiliation programmée" : computed.annualPayment ? "Résiliable avant échéance" : "Préavis inclus (1 mois)"}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Modifier / Résilier</h2>

        {sub.stripe_customer_id ? (
          <div
            style={{
              marginTop: 10,
              marginBottom: 12,
              border: "1px solid rgba(0, 200, 255, 0.18)",
              background: "rgba(0, 200, 255, 0.07)",
              borderRadius: 14,
              padding: "12px",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 900 }}>Informations de facturation</div>
            <p style={{ margin: 0, opacity: 0.84, lineHeight: 1.45, fontSize: 13 }}>
              Mettez à jour votre adresse, votre TVA, vos factures et votre moyen de paiement depuis le portail sécurisé Stripe.
            </p>
            <button type="button" onClick={openBillingPortal} style={ghostBtn} disabled={portalBusy || billingBusy}>
              {portalBusy ? "Ouverture…" : "Mettre à jour mes informations de facturation"}
            </button>
          </div>
        ) : null}

        {checkoutState === "success" ? (
          <p style={{ margin: "8px 0 0", opacity: 0.9, lineHeight: 1.5 }}>
            {checkoutBilling === "yearly"
              ? "✅ Abonnement annuel confirmé. Votre renouvellement est prévu chaque année."
              : computed?.trialEndsWithinStripeMinimum
                ? "✅ Inscription confirmée. Votre abonnement démarre maintenant."
                : "✅ Inscription confirmée. Votre abonnement démarrera à la fin de votre période d'essai de 21 jours."}
          </p>
        ) : checkoutState === "cancel" ? (
          <p style={{ margin: "8px 0 0", opacity: 0.9, lineHeight: 1.5 }}>
            ℹ️ Paiement annulé.
          </p>
        ) : null}

        {computed?.planNormalized === "Trial" ? (
          <>
            <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5 }}>
              Vous êtes en période d’essai 21 jours.
            </p>

            {computed?.hasStripeSub ? (
              <>
                {checkoutState !== "success" ? (
                  <p style={{ margin: "8px 0 0", opacity: 0.9, lineHeight: 1.5 }}>
                    {checkoutBilling === "yearly"
                      ? "✅ Abonnement annuel confirmé. Votre renouvellement est prévu chaque année."
                      : computed?.trialEndsWithinStripeMinimum
                        ? "✅ Inscription confirmée. Votre abonnement démarre maintenant."
                        : "✅ Inscription confirmée. Votre abonnement démarrera à la fin de votre période d'essai de 21 jours."}
                  </p>
                ) : null}

                {computed?.cancellationScheduled && computed?.cancelEndLabel ? (
                  <div
                    style={{
                      marginTop: 10,
                      border: "1px solid rgba(251, 191, 36, 0.25)",
                      background: "rgba(251, 191, 36, 0.10)",
                      borderRadius: 12,
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>Résiliation programmée</div>
                    <div style={{ opacity: 0.95, lineHeight: 1.45 }}>
                      Votre accès restera actif jusqu'au <strong>{computed.cancelEndLabel}</strong>.
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                      Vous pouvez annuler la résiliation tant que la date n'est pas atteinte.
                    </div>
                    {computed.monthlyNoticeCancellation ? (
                      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                        La prochaine mensualité reste due et sera votre dernière mensualité.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {!computed?.cancellationScheduled ? (
                    <button type="button" onClick={doCancel} style={dangerBtn} disabled={billingBusy}>
                      {billingBusy ? "Traitement…" : "Programmer ma résiliation"}
                    </button>
                  ) : (
                    <button type="button" onClick={doUncancel} style={primaryBtn} disabled={billingBusy}>
                      {billingBusy ? "Traitement…" : "Annuler ma résiliation"}
                    </button>
                  )}
                  <a href="https://inrcy.com/nos-packs/" target="_blank" rel="noreferrer" style={ghostBtn}>
                    Voir nos packs
                  </a>
                  {onOpenContact ? (
                    <button type="button" onClick={onOpenContact} style={ghostBtn}>
                      Contactez-nous
                    </button>
                  ) : (
                    <a href="https://inrcy.com/contact/" target="_blank" rel="noreferrer" style={ghostBtn}>
                      Contactez-nous
                    </a>
                  )}
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5 }}>
                  Les forfaits Premium et Founder sont activés et réactivés avec l’équipe iNrCy après un échange de présentation.
                </p>
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {onOpenContact ? (
                    <button type="button" onClick={onOpenContact} style={primaryBtn}>
                      Contacter iNrCy
                    </button>
                  ) : (
                    <a href="https://inrcy.com/contact/" target="_blank" rel="noreferrer" style={primaryBtn}>
                      Contacter iNrCy
                    </a>
                  )}
                  <a href="https://inrcy.com/nos-packs/" target="_blank" rel="noreferrer" style={ghostBtn}>
                    Voir nos packs
                  </a>
                </div>
              </>
            )}
          </>
        ) : sub.status === "active" ? (
          <>
            {false && computed?.annualPayment ? (
              <>
                <p style={{ margin: "8px 0 0", opacity: 0.9, lineHeight: 1.5 }}>
                  Votre abonnement annuel est actif.
                </p>
                <div
                  style={{
                    marginTop: 10,
                    border: "1px solid rgba(0, 200, 255, 0.22)",
                    background: "rgba(0, 200, 255, 0.08)",
                    borderRadius: 12,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>Abonnement annuel</div>
                  <div style={{ opacity: 0.95, lineHeight: 1.45 }}>
                    Le renouvellement automatique annuel est programmé à la prochaine échéance.
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                    Vous pouvez résilier avant la prochaine échéance.
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <a href="https://inrcy.com/nos-packs/" target="_blank" rel="noreferrer" style={ghostBtn}>
                    Voir les packs
                  </a>
                  {onOpenContact ? (
                    <button type="button" onClick={onOpenContact} style={ghostBtn}>
                      Contacter iNrCy
                    </button>
                  ) : (
                    <a href="https://inrcy.com/contact/" target="_blank" rel="noreferrer" style={ghostBtn}>
                      Contacter iNrCy
                    </a>
                  )}
                </div>
              </>
            ) : computed?.cancellationScheduled && computed?.cancelEndLabel ? (
              <>
                <p style={{ margin: "8px 0 0", opacity: 0.9, lineHeight: 1.5 }}>
                  Votre résiliation est programmée. Votre accès restera actif jusqu’au <strong>{computed.cancelEndLabel}</strong>.
                </p>
                <div
                  style={{
                    marginTop: 10,
                    border: "1px solid rgba(251, 191, 36, 0.25)",
                    background: "rgba(251, 191, 36, 0.10)",
                    borderRadius: 12,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>Résiliation programmée</div>
                  <div style={{ opacity: 0.95, lineHeight: 1.45 }}>
                    La résiliation prendra effet le <strong>{computed.cancelEndLabel}</strong>.
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                    Vous pouvez l’annuler tant que la date n’est pas atteinte.
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <button type="button" onClick={doUncancel} style={primaryBtn} disabled={billingBusy}>
                    {billingBusy ? "Traitement…" : "Annuler ma résiliation"}
                  </button>
                  <a href="https://inrcy.com/nos-packs/" target="_blank" rel="noreferrer" style={ghostBtn}>
                    Voir les packs
                  </a>
                  {onOpenContact ? (
                    <button type="button" onClick={onOpenContact} style={ghostBtn}>
                      Contacter iNrCy
                    </button>
                  ) : (
                    <a href="https://inrcy.com/contact/" target="_blank" rel="noreferrer" style={ghostBtn}>
                      Contacter iNrCy
                    </a>
                  )}
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5 }}>
                  Les changements de pack se font uniquement sur demande auprès d’iNrCy.
                </p>
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <a href="https://inrcy.com/nos-packs/" target="_blank" rel="noreferrer" style={ghostBtn}>
                    Voir les packs
                  </a>
                  {onOpenContact ? (
                    <button type="button" onClick={onOpenContact} style={ghostBtn}>
                      Contacter iNrCy
                    </button>
                  ) : (
                    <a href="https://inrcy.com/contact/" target="_blank" rel="noreferrer" style={ghostBtn}>
                      Contacter iNrCy
                    </a>
                  )}
                  <button type="button" onClick={doCancel} style={dangerBtn} disabled={billingBusy}>
                    {billingBusy ? "Traitement…" : "Programmer ma résiliation"}
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5 }}>
            Votre abonnement est actuellement {computed.statusText.toLowerCase()}.
          </p>
        )}

        {billingMsg ? (
          <p style={{ margin: "10px 0 0", opacity: 0.9, lineHeight: 1.35 }}>⚠️ {billingMsg}</p>
        ) : null}
      </div>
    </div>
  );
}
