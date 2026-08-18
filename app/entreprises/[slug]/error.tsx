"use client";

import { useTranslations } from "next-intl";


import Image from "next/image";
import { useEffect } from "react";
import Link from "next/link";
import styles from "./inrSearchPublic.module.css";

export default function InrSearchError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const i18nT = useTranslations("public");
  useEffect(() => {
    console.error("[inr-search-public] render failed", error);
  }, [error]);

  return (
    <main className={`${styles.page} ${styles.statePage}`}>
      <section className={styles.stateCard}>
        <Image src="/icons/inr-search-bubble-128.png" alt="" width={74} height={74} />
        <span className={styles.stateKicker}>{i18nT("inr_apos_search_6cbfd855")}</span>
        <h1>{i18nT("la_page_n_a_pas_pu_acefa016")}</h1>
        <p>{i18nT("une_erreur_temporaire_est_survenue_vous_6525c243")}</p>
        <div className={styles.stateActions}>
          <button type="button" onClick={reset}>{i18nT("reessayer_895d416b")}</button>
          <Link href="/entreprises">{i18nT("retour_aux_entreprises_b3abc1ef")}</Link>
        </div>
      </section>
    </main>
  );
}
