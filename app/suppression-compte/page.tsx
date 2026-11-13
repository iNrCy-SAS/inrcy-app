import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import DeletionRequestForm from "./DeletionRequestForm";
import styles from "./suppression-compte.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: t("public.deletion_metadata_title"),
    description: t("public.deletion_metadata_description"),
    robots: { index: true, follow: true },
  };
}

export default async function SuppressionComptePage() {
  const t = await getTranslations();
  return (
    <main className={styles.page}>
      <div className={styles.glowA} aria-hidden="true" />
      <div className={styles.glowB} aria-hidden="true" />

      <section className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.headerIdentity}>
            <Link className={styles.brand} href="https://inrcy.com" aria-label={t("public.deletion_home")}>
              <span className={styles.brandMark} aria-hidden="true">iN</span>
              <span>iNrCy</span>
            </Link>
            <h1 className={styles.headerTitle}>{t("settings.suppression_du_compte_11789c76")}</h1>
          </div>
          <Link className={styles.closeButton} href="/dashboard">{t("public.fermer_5ab4ec64")}</Link>
        </header>

        <p className={styles.subtitle}>
          {t("public.deletion_subtitle")}
        </p>

        <div className={styles.content}>
          <DeletionRequestForm />
          <p className={styles.policyNote}>{t("legal.suppression_meta_disconnect")}</p>
          <p className={styles.policyNote}>{t("legal.suppression_meta_request")}</p>
          <p className={styles.policyNote}>
            {t("public.deletion_legal_retention")}{" "}
            <Link href="/legal/confidentialite">{t("public.deletion_privacy_link")}</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
