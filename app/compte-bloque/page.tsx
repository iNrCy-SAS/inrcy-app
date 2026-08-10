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

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function copyForStatus(rawStatus: unknown): BlockedCopy {
  const status = normalizeStatus(rawStatus);

  if (status === "trial_expired" || status === "trial-expired") {
    return {
      eyebrow: "Période gratuite terminée",
      title: "Compte bloqué",
      badge: "Essai 21 jours terminé",
      message:
        "Votre période gratuite de 21 jours est terminée. Vos données sont conservées : vous pouvez activer iNrCy Standard pour reprendre immédiatement.",
      statusLabel: "Essai terminé",
      accessLabel: "Dashboard bloqué",
      dataLabel: "Données conservées",
    };
  }

  if (status === "paused") {
    return {
      eyebrow: "Suspension temporaire",
      title: "Compte en pause",
      badge: "Accès suspendu",
      message:
        "Votre générateur iNrCy est actuellement suspendu. Vos données restent conservées et l’accès pourra être réactivé par iNrCy.",
      statusLabel: "Suspendu",
      accessLabel: "Accès temporairement bloqué",
      dataLabel: "Données conservées",
    };
  }

  if (status === "past_due") {
    return {
      eyebrow: "Paiement en retard",
      title: "Régularisation nécessaire",
      badge: "Paiement en retard",
      message:
        "Votre abonnement présente un retard de paiement. Ouvrez votre espace de facturation sécurisé pour le régulariser et réactiver votre générateur.",
      statusLabel: "Paiement en retard",
      accessLabel: "Accès bloqué",
      dataLabel: "Données conservées",
    };
  }

  if (status === "unpaid") {
    return {
      eyebrow: "Paiement non réglé",
      title: "Compte bloqué",
      badge: "Paiement requis",
      message:
        "Le paiement de votre abonnement n’a pas pu être validé. Votre générateur est bloqué jusqu’à sa régularisation dans l’espace de facturation.",
      statusLabel: "Impayé",
      accessLabel: "Dashboard bloqué",
      dataLabel: "Données conservées",
    };
  }

  if (status === "canceled" || status === "cancelled") {
    return {
      eyebrow: "Abonnement résilié",
      title: "Compte résilié",
      badge: "Abonnement arrêté",
      message:
        "Votre abonnement iNrCy a été résilié. Contactez iNrCy si vous souhaitez réactiver votre générateur.",
      statusLabel: "Résilié",
      accessLabel: "Accès bloqué",
      dataLabel: "Données conservées",
    };
  }

  if (status === "incomplete_expired") {
    return {
      eyebrow: "Activation expirée",
      title: "Activation non finalisée",
      badge: "Activation expirée",
      message:
        "L’activation de votre abonnement n’a pas été finalisée dans les délais. Contactez iNrCy pour relancer votre générateur.",
      statusLabel: "Activation expirée",
      accessLabel: "Accès bloqué",
      dataLabel: "Données conservées",
    };
  }

  if (status === "incomplete") {
    return {
      eyebrow: "Activation en attente",
      title: "Activation non finalisée",
      badge: "Activation en attente",
      message:
        "Votre abonnement n’est pas encore totalement activé. Contactez iNrCy si le blocage persiste.",
      statusLabel: "En attente",
      accessLabel: "Accès bloqué",
      dataLabel: "Données conservées",
    };
  }

  return {
    eyebrow: "Accès suspendu",
    title: "Compte bloqué",
    badge: "Vérification nécessaire",
    message:
      "Votre générateur iNrCy est temporairement bloqué. Contactez iNrCy pour vérifier votre situation et réactiver l’accès.",
    statusLabel: "Bloqué",
    accessLabel: "Dashboard bloqué",
    dataLabel: "Données conservées",
  };
}

export default async function BlockedAccountPage() {
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

  const copy = copyForStatus(status);
  const edition = resolveDashboardEdition({
    edition: subscription?.app_edition,
    plan: subscription?.plan,
  });
  const importantDate = formatDate(subscription?.trial_end_at) || formatDate(subscription?.end_date);
  const contactHref = `mailto:contact@inrcy.com?subject=${encodeURIComponent("Réactivation de mon générateur iNrCy")}`;

  return (
    <main className={styles.page}>
      <div className={styles.bgGlow} />

      <section className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.header}>
            <Image src="/logo-inrcy.png" alt="iNrCy" width={56} height={56} priority className={styles.logo} />

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

              <p className={styles.reassurance}>Vos données ne sont pas supprimées.</p>

              <div className={styles.actions}>
                <BlockedBillingActions
                  status={status}
                  edition={edition}
                  hasStripeCustomer={Boolean(subscription?.stripe_customer_id)}
                  contactHref={contactHref}
                />

                <form action="/api/auth/sign-out" method="post">
                  <button type="submit" className={styles.secondaryBtn}>
                    Se déconnecter
                  </button>
                </form>
              </div>
            </div>

            <aside className={styles.infoCard}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Statut</span>
                <span className={styles.infoValue}>{copy.statusLabel}</span>
              </div>

              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Accès</span>
                <span className={styles.infoValue}>{copy.accessLabel}</span>
              </div>

              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Données</span>
                <span className={styles.infoValue}>{copy.dataLabel}</span>
              </div>

              {importantDate ? (
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Date concernée</span>
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
