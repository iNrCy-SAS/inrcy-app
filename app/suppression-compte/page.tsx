import type { Metadata } from "next";
import Link from "next/link";

import DeletionRequestForm from "./DeletionRequestForm";
import styles from "./suppression-compte.module.css";

export const metadata: Metadata = {
  title: "Suppression de compte | iNrCy",
  description: "Supprimez votre compte iNrCy, programmez sa suppression à la fin de votre accès ou effacez certaines données.",
  robots: { index: true, follow: true },
};

export default function SuppressionComptePage() {
  return (
    <main className={styles.page}>
      <div className={styles.glowA} aria-hidden="true" />
      <div className={styles.glowB} aria-hidden="true" />

      <section className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.headerIdentity}>
            <Link className={styles.brand} href="https://inrcy.com" aria-label="Accueil iNrCy">
              <span className={styles.brandMark} aria-hidden="true">iN</span>
              <span>iNrCy</span>
            </Link>
            <h1 className={styles.headerTitle}>Suppression du compte</h1>
          </div>
          <Link className={styles.closeButton} href="/dashboard">Fermer</Link>
        </header>

        <p className={styles.subtitle}>
          Gérez la suppression de votre compte ou de certaines données.
        </p>

        <div className={styles.content}>
          <DeletionRequestForm />
          <p className={styles.policyNote}>
            Certaines informations peuvent être conservées pendant la durée imposée par la loi.{" "}
            <Link href="/legal/confidentialite">Consulter la politique de confidentialité</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
