import type { Metadata } from "next";
import Link from "next/link";

import DeletionRequestForm from "./DeletionRequestForm";
import styles from "./suppression-compte.module.css";

export const metadata: Metadata = {
  title: "Suppression de compte | iNrCy",
  description: "Demandez la suppression de votre compte iNrCy ou de certaines de vos données.",
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
            Ce formulaire est accessible sans connexion. Nous vérifierons votre identité avant toute
            suppression afin de protéger votre compte.
          </p>
        </div>

        <div className={styles.grid}>
          <DeletionRequestForm />

          <aside className={styles.infoCard}>
            <h2>Ce qui se passe ensuite</h2>
            <ol>
              <li>Nous accusons réception de votre demande.</li>
              <li>Nous vérifions que vous êtes bien titulaire du compte.</li>
              <li>Nous supprimons le compte entier ou uniquement les données indiquées.</li>
              <li>Nous vous confirmons la fin du traitement par e-mail.</li>
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
