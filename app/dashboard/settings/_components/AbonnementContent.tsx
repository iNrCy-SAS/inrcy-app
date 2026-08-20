"use client";

import { useLocale, useTranslations } from "next-intl";


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

function planShortLabel(plan: unknown, i18nT: (key: string) => string) {
  const normalized = normalizePlan(plan);
  if (normalized === "Standard") return "Standard";
  if (normalized === "Premium") return "Premium";
  if (normalized === "Starter") return i18nT("partenaire_fondateur_7857c49b");
  if (normalized === "Accel") return i18nT("acceleration_2aa4f284");
  if (normalized === "Speed") return i18nT("pleine_vitesse_e2aad634");
  return i18nT("essai_21j_2cf2287d");
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
  billing_provider?: "stripe" | "app_store" | "play_store" | string | null;
  native_product_id?: string | null;
  native_will_renew?: boolean | null;
  founder_offer_enabled?: boolean | null;
};
const SUB_SELECT =
  "plan,scheduled_plan,status,monthly_price_eur,start_date,trial_start_at,trial_end_at,next_renewal_date,cancel_requested_at,end_date,stripe_customer_id,stripe_subscription_id,stripe_price_id,billing_cycle,billing_provider,native_product_id,native_will_renew,founder_offer_enabled";


function frDate(d: Date, locale: string) {
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
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

function statusLabel(raw: string, i18nT: (key: string) => string) {
  // Tolérance aux anciennes valeurs / fautes de frappe en base.
  if (raw === "trialing" || raw === "trailing" || raw === "essai") return i18nT("essai_21j_jours_3095df3f");
  if (raw === "trial_expired" || raw === "trial-expired") return i18nT("essai_termine_02c47ac3");
  if (raw === "active") return i18nT("actif_2eb75f84");
  if (raw === "past_due" || raw === "unpaid") return i18nT("impaye_a4556347");
  if (raw === "paused") return i18nT("suspendu_e9a8be4e");
  if (raw === "canceled" || raw === "cancelled") return i18nT("resilie_1ca48fe3");
  if (raw === "incomplete" || raw === "incomplete_expired") return i18nT("en_attente_a63fe859");
  return String(raw || "").toUpperCase() || "INCONNU";
}

function planLabel(plan: SubData["plan"], i18nT: (key: string) => string) {
  const normalized = normalizePlan(plan);
  if (normalized === "Starter") return i18nT("offre_partenaire_fondateur_82e34573");
  if (normalized === "Accel") return i18nT("pack_acceleration_9148e468");
  if (normalized === "Speed") return i18nT("pack_pleine_vitesse_a1aee34b");
  if (normalized === "Standard") return "Standard";
  if (normalized === "Premium") return "Premium";
  return i18nT("essai_21j_2cf2287d");
}

export default function AbonnementContent({ mode: _mode = "page", onOpenContact }: Props) {
  const i18nT = useTranslations("settings");
  const locale = useLocale();
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
      startLabel: frDate(start, locale),
      trialEndLabel: frDate(trialEnd, locale),
      scheduledStartLabel: frDate(scheduledStart, locale),
      renewalLabel: frDate(renewal, locale),
      endEstLabel: frDate(endEst, locale),
      cancelEndLabel: cancelEnd ? frDate(cancelEnd, locale) : null,
      cancellationScheduled,
      monthlyNoticeCancellation,
      priceLabel: `${displayedPriceTtc} €`,
      annualPayment,
      statusText: isTrialPlan ? i18nT("essai_21_jours_3095df3f") : statusLabel(statusNorm, i18nT),
      hasStripeSub: hasScheduledSubscription,
      scheduledPlanLabel: planShortLabel(scheduledPlan, i18nT),
      planNormalized,
      trialEndsWithinStripeMinimum,
    };
  }, [sub, checkoutState, locale, i18nT]);

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
      title: i18nT("confirmer_la_resiliation_893151df"),
      message: i18nT("mensuel_actif_votre_prochaine_mensualite_sera_1c6e70ed"),
      confirmLabel: i18nT("resilier_1b922dae"),
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
      title: i18nT("annuler_la_resiliation_dc5148d7"),
      message: i18nT("votre_abonnement_restera_actif_comme_avant_ec636334"),
      confirmLabel: i18nT("annuler_la_resiliation_a16defa8"),
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

  if (loading) return <div style={{ opacity: 0.85 }}>{i18nT("chargement_01cba1df")}</div>;
  if (err) return <div style={{ opacity: 0.9 }}>⚠️ {err}</div>;

  if (!sub || !computed) {
    return (
      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{i18nT("mon_abonnement_d248414d")}</h2>
        <p style={{ margin: "8px 0 0", opacity: 0.8 }}>
          {i18nT("votre_abonnement_n_est_pas_encore_e76722c5")}{" "}</p>
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
            <div style={{ fontSize: 22, fontWeight: 950, marginTop: 4, lineHeight: 1.15 }}>{planLabel(sub.plan, i18nT)}</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <span style={badge}>{i18nT("sans_engagement_b19d4f9b")}</span>
              <span style={badge}>{computed.annualPayment ? "ANNUEL" : "MENSUEL"}</span>
              <span style={badge}>{computed.statusText}</span>
            </div>
          </div>

          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ opacity: 0.85, fontSize: 12, fontWeight: 900, letterSpacing: 0.4 }}>PRIX</div>
            <div style={{ fontSize: 26, fontWeight: 950, marginTop: 4, lineHeight: 1 }}>{computed.priceLabel}</div>
            <div style={{ opacity: 0.75, fontSize: 12, marginTop: 6 }}>{computed.annualPayment ? i18nT("ttc_an_7615e4f3") : i18nT("ttc_par_mois_e7babfcd")}</div>
          </div>
        </div>
      </div>

      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{i18nT("dates_842b7b5d")}</h2>

        <div
          className="datesGrid"
          style={computed?.planNormalized === "Trial" ? ({ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } as any) : undefined}
        >
          {computed?.planNormalized === "Trial" ? (
            <>
              <div style={miniBox}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>{i18nT("inscription_9be51f96")}</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900 }}>{computed.startLabel}</div>
              </div>

              <div style={miniBox}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>{i18nT("fin_de_periode_d_essai_e49ad56a")}</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900 }}>{computed.trialEndLabel}</div>
              </div>
            </>
          ) : (
            <>
              <div style={miniBox}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>{i18nT("actualisation_d386fa8d")}</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900 }}>{computed.startLabel}</div>
              </div>

              <div style={miniBox}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>{computed.annualPayment ? i18nT("renouvellement_annuel_ffcc422c") : i18nT("renouvellement_5b961f3a")}</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900 }}>{computed.renewalLabel}</div>
              </div>

              <div style={miniBox}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>{computed.annualPayment ? i18nT("formule_1bb7d659") : i18nT("fin_previsionnelle_682cf200")}</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900 }}>{computed.annualPayment && !computed.cancellationScheduled ? i18nT("annuelle_0e25612c") : computed.cancellationScheduled && computed.cancelEndLabel ? computed.cancelEndLabel : computed.endEstLabel}</div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75, lineHeight: 1.3 }}>
                  {computed.cancellationScheduled ? i18nT("resiliation_programmee_09802990") : computed.annualPayment ? i18nT("resiliable_avant_echeance_7d2a6c32") : i18nT("preavis_inclus_1_mois_4e679006")}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{i18nT("modifier_resilier_36d44555")}</h2>

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
            <div style={{ fontWeight: 900 }}>{i18nT("informations_de_facturation_8a6fd636")}</div>
            <p style={{ margin: 0, opacity: 0.84, lineHeight: 1.45, fontSize: 13 }}>
              {i18nT("mettez_a_jour_votre_adresse_votre_1b61e677")}{" "}</p>
            <button type="button" onClick={openBillingPortal} style={ghostBtn} disabled={portalBusy || billingBusy}>
              {portalBusy ? i18nT("ouverture_3333ad14") : i18nT("mettre_a_jour_mes_informations_de_6e93cb1c")}
            </button>
          </div>
        ) : null}

        {checkoutState === "success" ? (
          <p style={{ margin: "8px 0 0", opacity: 0.9, lineHeight: 1.5 }}>
            {checkoutBilling === "yearly"
              ? i18nT("abonnement_annuel_confirme_votre_renouvellement__14c9e289")
              : computed?.trialEndsWithinStripeMinimum
                ? i18nT("inscription_confirmee_votre_abonnement_demarre_m_53bef1f6")
                : i18nT("inscription_confirmee_votre_abonnement_demarrera_07043609")}
          </p>
        ) : checkoutState === "cancel" ? (
          <p style={{ margin: "8px 0 0", opacity: 0.9, lineHeight: 1.5 }}>
            {i18nT("paiement_annule_4e50bdaa")}{" "}</p>
        ) : null}

        {computed?.planNormalized === "Trial" ? (
          <>
            <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5 }}>
              {i18nT("vous_etes_en_periode_d_essai_94b9a0f2")}{" "}</p>

            {computed?.hasStripeSub ? (
              <>
                {checkoutState !== "success" ? (
                  <p style={{ margin: "8px 0 0", opacity: 0.9, lineHeight: 1.5 }}>
                    {checkoutBilling === "yearly"
                      ? i18nT("abonnement_annuel_confirme_votre_renouvellement__14c9e289")
                      : computed?.trialEndsWithinStripeMinimum
                        ? i18nT("inscription_confirmee_votre_abonnement_demarre_m_53bef1f6")
                        : i18nT("inscription_confirmee_votre_abonnement_demarrera_07043609")}
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
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>{i18nT("resiliation_programmee_09802990")}</div>
                    <div style={{ opacity: 0.95, lineHeight: 1.45 }}>
                      {i18nT("votre_acces_restera_actif_jusqu_au_1da564dd")}{" "}<strong>{computed.cancelEndLabel}</strong>.
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                      {i18nT("vous_pouvez_annuler_la_resiliation_tant_b58e096f")}{" "}</div>
                    {computed.monthlyNoticeCancellation ? (
                      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                        {i18nT("la_prochaine_mensualite_reste_due_et_01f3e3f3")}{" "}</div>
                    ) : null}
                  </div>
                ) : null}

                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {!computed?.cancellationScheduled ? (
                    <button type="button" onClick={doCancel} style={dangerBtn} disabled={billingBusy}>
                      {billingBusy ? i18nT("traitement_2f66d9bc") : i18nT("programmer_ma_resiliation_d074ca2d")}
                    </button>
                  ) : (
                    <button type="button" onClick={doUncancel} style={primaryBtn} disabled={billingBusy}>
                      {billingBusy ? i18nT("traitement_2f66d9bc") : i18nT("annuler_ma_resiliation_902e43a0")}
                    </button>
                  )}
                  <a href="https://inrcy.com/nos-packs/" target="_blank" rel="noreferrer" style={ghostBtn}>
                    {i18nT("voir_nos_packs_973446e0")}{" "}</a>
                  {onOpenContact ? (
                    <button type="button" onClick={onOpenContact} style={ghostBtn}>
                      {i18nT("contactez_nous_ec4802ef")}{" "}</button>
                  ) : (
                    <a href="https://inrcy.com/contact/" target="_blank" rel="noreferrer" style={ghostBtn}>
                      {i18nT("contactez_nous_ec4802ef")}{" "}</a>
                  )}
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5 }}>
                  {i18nT("les_forfaits_premium_et_founder_sont_374bb1ec")}{" "}</p>
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {onOpenContact ? (
                    <button type="button" onClick={onOpenContact} style={primaryBtn}>
                      {i18nT("contacter_inrcy_b0a48e55")}{" "}</button>
                  ) : (
                    <a href="https://inrcy.com/contact/" target="_blank" rel="noreferrer" style={primaryBtn}>
                      {i18nT("contacter_inrcy_b0a48e55")}{" "}</a>
                  )}
                  <a href="https://inrcy.com/nos-packs/" target="_blank" rel="noreferrer" style={ghostBtn}>
                    {i18nT("voir_nos_packs_973446e0")}{" "}</a>
                </div>
              </>
            )}
          </>
        ) : sub.status === "active" ? (
          <>
            {false && computed?.annualPayment ? (
              <>
                <p style={{ margin: "8px 0 0", opacity: 0.9, lineHeight: 1.5 }}>
                  {i18nT("votre_abonnement_annuel_est_actif_563e5088")}{" "}</p>
                <div
                  style={{
                    marginTop: 10,
                    border: "1px solid rgba(0, 200, 255, 0.22)",
                    background: "rgba(0, 200, 255, 0.08)",
                    borderRadius: 12,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>{i18nT("abonnement_annuel_68b3aae6")}</div>
                  <div style={{ opacity: 0.95, lineHeight: 1.45 }}>
                    {i18nT("le_renouvellement_automatique_annuel_est_program_7ee5abc3")}{" "}</div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                    {i18nT("vous_pouvez_resilier_avant_la_prochaine_c9597f47")}{" "}</div>
                </div>
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <a href="https://inrcy.com/nos-packs/" target="_blank" rel="noreferrer" style={ghostBtn}>
                    {i18nT("voir_les_packs_ad21ffc7")}{" "}</a>
                  {onOpenContact ? (
                    <button type="button" onClick={onOpenContact} style={ghostBtn}>
                      {i18nT("contacter_inrcy_b0a48e55")}{" "}</button>
                  ) : (
                    <a href="https://inrcy.com/contact/" target="_blank" rel="noreferrer" style={ghostBtn}>
                      {i18nT("contacter_inrcy_b0a48e55")}{" "}</a>
                  )}
                </div>
              </>
            ) : computed?.cancellationScheduled && computed?.cancelEndLabel ? (
              <>
                <p style={{ margin: "8px 0 0", opacity: 0.9, lineHeight: 1.5 }}>
                  {i18nT("votre_resiliation_est_programmee_votre_acces_92d6055d")}{" "}<strong>{computed.cancelEndLabel}</strong>.
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
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>{i18nT("resiliation_programmee_09802990")}</div>
                  <div style={{ opacity: 0.95, lineHeight: 1.45 }}>
                    {i18nT("la_resiliation_prendra_effet_le_98fdf092")}{" "}<strong>{computed.cancelEndLabel}</strong>.
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                    {i18nT("vous_pouvez_l_annuler_tant_que_5d37578a")}{" "}</div>
                </div>
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <button type="button" onClick={doUncancel} style={primaryBtn} disabled={billingBusy}>
                    {billingBusy ? i18nT("traitement_2f66d9bc") : i18nT("annuler_ma_resiliation_902e43a0")}
                  </button>
                  <a href="https://inrcy.com/nos-packs/" target="_blank" rel="noreferrer" style={ghostBtn}>
                    {i18nT("voir_les_packs_ad21ffc7")}{" "}</a>
                  {onOpenContact ? (
                    <button type="button" onClick={onOpenContact} style={ghostBtn}>
                      {i18nT("contacter_inrcy_b0a48e55")}{" "}</button>
                  ) : (
                    <a href="https://inrcy.com/contact/" target="_blank" rel="noreferrer" style={ghostBtn}>
                      {i18nT("contacter_inrcy_b0a48e55")}{" "}</a>
                  )}
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5 }}>
                  {i18nT("les_changements_de_pack_se_font_8b7b8305")}{" "}</p>
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <a href="https://inrcy.com/nos-packs/" target="_blank" rel="noreferrer" style={ghostBtn}>
                    {i18nT("voir_les_packs_ad21ffc7")}{" "}</a>
                  {onOpenContact ? (
                    <button type="button" onClick={onOpenContact} style={ghostBtn}>
                      {i18nT("contacter_inrcy_b0a48e55")}{" "}</button>
                  ) : (
                    <a href="https://inrcy.com/contact/" target="_blank" rel="noreferrer" style={ghostBtn}>
                      {i18nT("contacter_inrcy_b0a48e55")}{" "}</a>
                  )}
                  <button type="button" onClick={doCancel} style={dangerBtn} disabled={billingBusy}>
                    {billingBusy ? i18nT("traitement_2f66d9bc") : i18nT("programmer_ma_resiliation_d074ca2d")}
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5 }}>
            {i18nT("votre_abonnement_est_actuellement_value_71a787c2", { value0: computed.statusText.toLowerCase() })}</p>
        )}

        {billingMsg ? (
          <p style={{ margin: "10px 0 0", opacity: 0.9, lineHeight: 1.35 }}>⚠️ {billingMsg}</p>
        ) : null}
      </div>
    </div>
  );
}
