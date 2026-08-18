
"use client";

import { useTranslations } from "next-intl";

import styles from "../legal.module.css";

export default function LegalPageShell(props: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const i18nT = useTranslations("public");

  function handleClose(){
    if (typeof window !== "undefined") {
      if (window.history.length > 1) window.history.back();
      else window.location.href = "/";
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.card}>

          <button onClick={handleClose} className={styles.closeBtn}>
            <span className={styles.closeText}>{i18nT("fermer_5ab4ec64")}</span>
            <span className={styles.closeX}>×</span>
          </button>

          <h1 className={styles.h1}>{props.title}</h1>
          {props.subtitle ? <p className={styles.subtitle}>{props.subtitle}</p> : null}

          <div style={{ marginTop: 14 }}>{props.children}</div>

          <p className={styles.small} style={{ marginTop: 18 }}>
            {i18nT("version_juridique_synchronisee_le_08_08_858fc0cc")}{" "}</p>

        </div>
      </div>
    </main>
  );
}
