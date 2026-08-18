import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import { redirect } from "next/navigation";

import styles from "./compte-bloque.module.css";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { resolveDashboardEdition } from "@/lib/dashboardEdition";
import BlockedBillingActions from "./BlockedBillingActions";

export const dynamic = "force-dynamic";

type SubscriptionRow = {
  status?: string | null;
  plan?: string | null;
  trial_end_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  updated_at?: string | null;
  app_edition?: string | null;
  stripe_customer_id?: string | null;
};

type BlockedCopy = {
  eyebrow: string;
  title: string;
  badge: string;
  message: string;
  statusLabel: string;
  accessLabel: string;
  dataLabel: string;
};

const TRIAL_DURATION_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function parseDateMs(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function isTrialStillValid(subscription?: SubscriptionRow | null) {
  if (normalizeStatus(subscription?.status) !== "trialing") return false;

  const trialEndMs = parseDateMs(subscription?.trial_end_at);
  if (trialEndMs !== null) return trialEndMs > Date.now();

  const startMs = parseDateMs(subscription?.start_date);
  if (startMs !== null) return startMs + TRIAL_DURATION_DAYS * DAY_MS > Date.now();

  return false;
}

function hasDashboardAccess(subscription?: SubscriptionRow | null) {
  const status = normalizeStatus(subscription?.status);
  return status === "active" || isTrialStillValid(subscription);
}

function getEffectiveStatus(subscription?: SubscriptionRow | null) {
  const status = normalizeStatus(subscription?.status);
  if (status === "trialing" && !isTrialStillValid(subscription)) return "trial_expired";
  return status;
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function copyForStatus(rawStatus: unknown, i18nT: (key: string) => string): BlockedCopy {
  const status = normalizeStatus(rawStatus);

  if (status === "trial_expired" || status === "trial-expired") {
    return {
      eyebrow: i18nT("periode_gratuite_terminee_19489bfe"),
      title: i18nT("compte_bloque_cc393cd5"),
      badge: i18nT("essai_21_jours_termine_70103f82"),
      message: i18nT("votre_periode_gratuite_de_21_jours_733b8d78"),
      statusLabel: i18nT("essai_termine_be984f1c"),
      accessLabel: i18nT("dashboard_bloque_8fc74848"),
      dataLabel: i18nT("donnees_conservees_c1aaabb1"),
    };
  }

  if (status === "paused") {
    return {
      eyebrow: i18nT("suspension_temporaire_ea1d13e5"),
      title: i18nT("compte_en_pause_a1a56cd7"),
      badge: i18nT("acces_suspendu_d5df1a05"),
      message: i18nT("votre_generateur_inrcy_est_actuellement_suspendu_5ff9ff9b"),
      statusLabel: i18nT("suspendu_e9a8be4e"),
      accessLabel: i18nT("acces_temporairement_bloque_13cc9d9b"),
      dataLabel: i18nT("donnees_conservees_c1aaabb1"),
    };
  }

  if (status === "past_due") {
    return {
      eyebrow: i18nT("paiement_en_retard_178e0445"),
      title: i18nT("regularisation_necessaire_5b514f95"),
      badge: i18nT("paiement_en_retard_178e0445"),
      message: i18nT("votre_abonnement_presente_un_retard_de_79e830ea"),
      statusLabel: i18nT("paiement_en_retard_178e0445"),
      accessLabel: i18nT("acces_6e47e630"),
      dataLabel: i18nT("donnees_conservees_c1aaabb1"),
    };
  }

  if (status === "unpaid") {
    return {
      eyebrow: i18nT("paiement_non_regle_0bc4b42f"),
      title: i18nT("compte_bloque_cc393cd5"),
      badge: i18nT("paiement_requis_05da3d43"),
      message: i18nT("le_paiement_de_votre_abonnement_n_f20f2e6f"),
      statusLabel: i18nT("impaye_3f8d3329"),
      accessLabel: i18nT("dashboard_bloque_8fc74848"),
      dataLabel: i18nT("donnees_conservees_c1aaabb1"),
    };
  }

  if (status === "canceled" || status === "cancelled") {
    return {
      eyebrow: i18nT("abonnement_resilie_f5326fe8"),
      title: i18nT("compte_resilie_72c7336f"),
      badge: i18nT("abonnement_arrete_dfc9ba27"),
      message: i18nT("votre_abonnement_inrcy_a_ete_resilie_7c8e06c7"),
      statusLabel: i18nT("resilie_3578b2e9"),
      accessLabel: i18nT("acces_6e47e630"),
      dataLabel: i18nT("donnees_conservees_c1aaabb1"),
    };
  }

  if (status === "incomplete_expired") {
    return {
      eyebrow: i18nT("activation_expiree_78c92717"),
      title: i18nT("activation_non_finalisee_50b7c64c"),
      badge: i18nT("activation_expiree_78c92717"),
      message: i18nT("l_activation_de_votre_abonnement_n_31654080"),
      statusLabel: i18nT("activation_expiree_78c92717"),
      accessLabel: i18nT("acces_6e47e630"),
      dataLabel: i18nT("donnees_conservees_c1aaabb1"),
    };
  }

  if (status === "incomplete") {
    return {
      eyebrow: i18nT("activation_en_attente_c3d81a46"),
      title: i18nT("activation_non_finalisee_50b7c64c"),
      badge: i18nT("activation_en_attente_c3d81a46"),
      message: i18nT("votre_abonnement_n_est_pas_encore_b8d5f825"),
      statusLabel: i18nT("en_attente_5231158f"),
      accessLabel: i18nT("acces_6e47e630"),
      dataLabel: i18nT("donnees_conservees_c1aaabb1"),
    };
  }

  return {
    eyebrow: i18nT("acces_suspendu_d5df1a05"),
    title: i18nT("compte_bloque_cc393cd5"),
    badge: i18nT("verification_necessaire_b8a188c4"),
    message: i18nT("votre_generateur_inrcy_est_temporairement_bloque_6c80550e"),
    statusLabel: i18nT("bloque_70f90b1a"),
    accessLabel: i18nT("dashboard_bloque_8fc74848"),
    dataLabel: i18nT("donnees_conservees_c1aaabb1"),
  };
}

export default async function BlockedAccountPage() {
  const i18nT = await getTranslations("public");
  const locale = await getLocale();
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("status, plan, app_edition, trial_end_at, start_date, end_date, updated_at, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const subscription = data as SubscriptionRow | null;
  const status = getEffectiveStatus(subscription);

  if (hasDashboardAccess(subscription)) {
    redirect("/dashboard");
  }

  const copy = copyForStatus(status, i18nT);
  const edition = resolveDashboardEdition({
    edition: subscription?.app_edition,
    plan: subscription?.plan,
  });
  const importantDate = formatDate(subscription?.trial_end_at, locale) || formatDate(subscription?.end_date, locale);
  const contactHref = `mailto:contact@inrcy.com?subject=${encodeURIComponent("Réactivation de mon générateur iNrCy")}`;

  return (
    <main className={styles.page}>
      <div className={styles.bgGlow} />

      <section className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.header}>
            <Image src="/logo-inrcy.png" alt={i18nT("inrcy_ef95fe0e")} width={56} height={56} priority className={styles.logo} />

            <div className={styles.brandBlock}>
              <div className={styles.brandSub}>{copy.eyebrow}</div>
            </div>
          </div>

          <div className={styles.badge}>
            <span className={styles.badgeDot} />
            {copy.badge}
          </div>

          <div className={styles.content}>
            <div className={styles.main}>
              <h1 className={styles.title}>{copy.title}</h1>

              <p className={styles.text}>{copy.message}</p>

              <p className={styles.reassurance}>{i18nT("vos_donnees_ne_sont_pas_supprimees_2f584f47")}</p>

              <div className={styles.actions}>
                <BlockedBillingActions
                  status={status}
                  edition={edition}
                  hasStripeCustomer={Boolean(subscription?.stripe_customer_id)}
                  contactHref={contactHref}
                />

                <form action="/api/auth/sign-out" method="post">
                  <button type="submit" className={styles.secondaryBtn}>
                    {i18nT("se_deconnecter_ea36fa17")}{" "}</button>
                </form>
              </div>
            </div>

            <aside className={styles.infoCard}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>{i18nT("statut_659499f3")}</span>
                <span className={styles.infoValue}>{copy.statusLabel}</span>
              </div>

              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>{i18nT("acces_6e47e630")}</span>
                <span className={styles.infoValue}>{copy.accessLabel}</span>
              </div>

              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>{i18nT("donnees_e3e0c5ec")}</span>
                <span className={styles.infoValue}>{copy.dataLabel}</span>
              </div>

              {importantDate ? (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>{i18nT("date_concernee_78b24e3a")}</span>
                  <span className={styles.infoValue}>{importantDate}</span>
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
