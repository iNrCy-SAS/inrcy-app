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
          <Link className={styles.brand} href="https://inrcy.com" aria-label="Accueil iNrCy">
            <span className={styles.brandMark} aria-hidden="true">iN</span>
            <span>iNrCy</span>
          </Link>
          <Link className={styles.loginLink} href="/login">Connexion</Link>
        </header>

        <div className={styles.intro}>
          <span className={styles.eyebrow}>Confidentialité iNrCy</span>
          <h1>Supprimer votre compte ou certaines données</h1>
          <p>
            Connectez-vous pour gérer la suppression vous-même. Votre abonnement et vos services restent
            actifs jusqu’à la date de fin si vous choisissez le parcours recommandé.
          </p>
        </div>

        <div className={styles.grid}>
          <DeletionRequestForm />

          <aside className={styles.infoCard}>
            <h2>Un parcours clair et autonome</h2>
            <ol>
              <li>Connecté : choisissez l’échéance, l’immédiat ou des catégories précises.</li>
              <li>À l’échéance : l’accès reste actif jusqu’au dernier jour prévu.</li>
              <li>Sans connexion : envoyez une demande vérifiée depuis cette page.</li>
            </ol>
            <p>
              Certaines informations peuvent être conservées pendant la durée imposée par la loi,
              notamment les pièces comptables et les éléments nécessaires à la défense de droits.
            </p>
            <Link href="/legal/confidentialite">Consulter la politique de confidentialité</Link>
          </aside>
        </div>
      </section>
    </main>
  );
}
