import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { CYCLICOM_TERMS_VERSION, getCyclicomInstallments, getCyclicomOffer } from "@/lib/cyclicom/offer";
import styles from "./paiement.module.css";

export const metadata: Metadata = {
  title: "Paiement de votre site | Cyclicom",
  description: "Choisissez comment régler la création de votre site vitrine Cyclicom.",
  robots: { index: false, follow: false },
};

type PaymentPageProps = {
  params: Promise<{ pack: string }>;
  searchParams: Promise<{ paiement?: string | string[]; session_id?: string | string[] }>;
};

const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const timing = ["À la validation", "Un mois après", "Un mois plus tard"];
const publicSite = "https://cyclicom.fr";

const paymentNotices = {
  annule: "Le paiement a été interrompu. Vous pouvez reprendre en choisissant votre mode de règlement.",
  erreur: "Impossible d’ouvrir la page de paiement. Vérifiez votre choix et réessayez.",
  indisponible: "Le paiement est momentanément indisponible. Réessayez dans quelques instants ou contactez Cyclicom.",
};

export default async function CyclicomPaymentPage({ params, searchParams }: PaymentPageProps) {
  const [{ pack }, { paiement, session_id }] = await Promise.all([params, searchParams]);
  const offer = getCyclicomOffer(pack);
  if (!offer) notFound();

  const returnedFromStripe = paiement === "recu" && typeof session_id === "string" && /^cs_(test|live)_[a-zA-Z0-9]+$/.test(session_id);
  const notice = paiement === "annule" || paiement === "erreur" || paiement === "indisponible"
    ? paymentNotices[paiement]
    : null;
  const options = [1, 2, 3].flatMap((count) => {
    const installments = getCyclicomInstallments(offer, count);
    return installments ? [{ count, installments }] : [];
  });

  return (
    <div className={styles.page} lang="fr">
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <a className={styles.brand} href={publicSite}>
            <Image src="/cyclicom-logo.png" alt="Cyclicom, accueil" width={160} height={160} />
          </a>
          <a className={styles.backLink} href={`${publicSite}/sites-web.html`}>Voir les offres</a>
        </div>
      </header>

      <main className={styles.content}>
        <div className={styles.intro}>
          <p className={styles.service}>Création de site vitrine</p>
          <h1>{returnedFromStripe ? "Retour du paiement" : "Réglez votre pack"}</h1>
        </div>

        <div className={styles.layout}>
          <section className={styles.summary} aria-labelledby="cyclicom-order">
            <h2 id="cyclicom-order">{offer.label}</h2>
            <p className={styles.summaryTotal}>
              {euro.format(offer.totalCents / 100)} <span>HT</span>
            </p>
            <p className={styles.summaryDetail}>Total de votre commande. Stripe calcule les taxes applicables avant la validation.</p>
          </section>

          {returnedFromStripe ? (
            <section className={styles.panel} aria-labelledby="cyclicom-return">
              <h2 id="cyclicom-return">Vous êtes de retour de Stripe</h2>
              <p>Stripe vous enverra un e-mail de confirmation dès que le paiement sera confirmé. Pour toute question, <a href="mailto:contact@cyclicom.fr">contactez Cyclicom</a>.</p>
            </section>
          ) : (
            <form className={styles.panel} method="post" action="/api/public/cyclicom/checkout">
              {notice && <p className={styles.notice} role="status">{notice}</p>}
              <input type="hidden" name="pack" value={offer.slug} />
              <input type="hidden" name="tentative" value={randomUUID()} />
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Choisissez votre règlement</legend>
                <div className={styles.choices}>
                  {options.map(({ count, installments }) => (
                    <label className={styles.choice} key={count}>
                      <input className={styles.radio} type="radio" name="versements" value={count} defaultChecked={count === 1} required />
                      <span className={styles.choiceText}>
                        <strong>{count === 1 ? "En une fois" : `En ${count} fois`}</strong>
                        <span className={styles.installments}>
                          {installments.map((amount, index) => (
                            <span className={styles.installment} key={index}>
                              <span>{timing[index]}</span>
                              <span>{euro.format(amount / 100)} HT</span>
                            </span>
                          ))}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className={styles.consent} data-version={CYCLICOM_TERMS_VERSION}>
                <input type="checkbox" name="accord" value="oui" required />
                <span>
                  J’autorise Cyclicom à débiter le moyen de paiement validé sur Stripe selon les montants et les échéances de l’option sélectionnée, taxes applicables comprises.
                  {offer.maxInstallments > 1 && " En plusieurs fois, les versements suivants sont débités automatiquement sur le même moyen de paiement et les débits s’arrêtent après la dernière échéance."}
                </span>
              </label>

              <button className={styles.submit} type="submit">Continuer vers Stripe</button>
              <p className={styles.paymentNote}>Vous saisirez votre moyen de paiement sur la page sécurisée de Stripe.</p>
            </form>
          )}
        </div>
      </main>

      <footer className={styles.footer}>
        <a href={`${publicSite}/mentions-legales.html`}>Mentions légales</a>
        <a href={`${publicSite}/confidentialite.html`}>Confidentialité</a>
        <a href="mailto:contact@cyclicom.fr">Contacter Cyclicom</a>
      </footer>
    </div>
  );
}
