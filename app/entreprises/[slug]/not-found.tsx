import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import styles from "./inrSearchPublic.module.css";

export default function InrSearchNotFound() {
  const i18nT = useTranslations("public");
  return (
    <main className={`${styles.page} ${styles.statePage}`}>
      <section className={styles.stateCard}>
        <Image src="/icons/inr-search-bubble-128.png" alt="" width={74} height={74} />
        <span className={styles.stateKicker}>{i18nT("inr_apos_search_6cbfd855")}</span>
        <h1>{i18nT("cette_page_professionnelle_n_est_pas_33c81db1")}</h1>
        <p>{i18nT("elle_a_peut_etre_ete_desactivee_451669c8")}</p>
        <div className={styles.stateActions}>
          <Link href="/entreprises">{i18nT("voir_les_entreprises_30c6811f")}</Link>
          <Link href="/metiers">{i18nT("explorer_les_metiers_fbc043fb")}</Link>
        </div>
      </section>
    </main>
  );
}
