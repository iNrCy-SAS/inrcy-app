import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import { redirect } from "next/navigation";
import Script from "next/script";

import styles from "./maintenance.module.css";
import { getMaintenanceState, isAdminUser } from "@/lib/maintenance";
import { createSupabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function formatUpdatedAt(value: string | null, locale: string, realtimeLabel: string): string {
  if (!value) return realtimeLabel;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return realtimeLabel;

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default async function MaintenancePage() {
  const i18nT = await getTranslations("public");
  const locale = await getLocale();
  const maintenance = await getMaintenanceState();

  if (!maintenance.enabled) {
    redirect("/dashboard");
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = await isAdminUser(user?.id);

  if (admin) {
    redirect("/dashboard");
  }

  return (
    <main className={styles.page}>
      <div className={styles.bgGlow} />

      <section className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.header}>
            <Image
              src="/logo-inrcy.png"
              alt={i18nT("inrcy_ef95fe0e")}
              width={52}
              height={52}
              priority
              className={styles.logo}
            />

            <div className={styles.brandBlock}>
              <div className={styles.brandSub}>{i18nT("plateforme_temporairement_indisponible_39c7467e")}</div>
            </div>
          </div>

          <div className={styles.badge}>
            <span className={styles.badgeDot} />
            {i18nT("intervention_technique_en_cours_1a968c70")}{" "}</div>

          <div className={styles.content}>
            <div className={styles.main}>
              <h1 className={styles.title}>
                {maintenance.title || i18nT("maintenance_en_cours_d46a98a7")}
              </h1>

              <p className={styles.text}>
                {maintenance.message ||
                  i18nT("nous_realisons_actuellement_une_intervention_tec_3b7713eb")}
              </p>

              <div className={styles.actions}>
                <a href="/dashboard" className={styles.primaryBtn}>
                  {i18nT("reessayer_895d416b")}{" "}</a>
                <a href="mailto:contact@inrcy.com" className={styles.secondaryBtn}>
                  {i18nT("contacter_inrcy_b0a48e55")}{" "}</a>
              </div>
            </div>

            <aside className={styles.infoCard}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>{i18nT("statut_659499f3")}</span>
                <span className={styles.infoValue}>{i18nT("maintenance_controlee_95655bce")}</span>
              </div>

              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>{i18nT("acces_6e47e630")}</span>
                <span className={styles.infoValue}>{i18nT("utilisateurs_en_pause_cb800b1b")}</span>
              </div>

              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>{i18nT("derniere_mise_a_jour_df82ab3d")}</span>
                <span className={styles.infoValue}>
                  {formatUpdatedAt(
                    maintenance.updatedAt,
                    locale,
                    i18nT("mise_a_jour_en_temps_reel_7542ca7d"),
                  )}
                </span>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <Script id="maintenance-auto-refresh" strategy="afterInteractive">
        {`
          setInterval(() => {
            window.location.reload();
          }, 60000);
        `}
      </Script>
    </main>
  );
}
