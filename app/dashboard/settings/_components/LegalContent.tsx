"use client";

import { useTranslations } from "next-intl";
import styles from "./LegalPrivacyContent.module.css";
import { useState } from "react";
import type { LegalDocKey } from "../../../legal/_components/legalDocs";
import LegalDocumentsModal from "./LegalDocumentsModal";

type Props = {
  mode?: "page" | "drawer";
};

function DocumentIcon({ kind }: { kind: "shield" | "identity" | "terms" }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === "shield" ? <><path d="m24 6 14 5v11c0 10-14 19-14 19S10 32 10 22V11l14-5Z" fill="currentColor" fillOpacity=".1" /><path d="m17 23 5 5 10-11M7 15H4m40 12h-3" /></> : null}
      {kind === "identity" ? <><rect x="8" y="10" width="32" height="28" rx="5" fill="currentColor" fillOpacity=".1" /><circle cx="19" cy="20" r="4" /><path d="M12 32v-1a7 7 0 0 1 14 0v1m4-14h5m-5 6h5m-5 6h3M15 5v3m18 32v3" /></> : null}
      {kind === "terms" ? <><path d="M27 6H13a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h22a4 4 0 0 0 4-4V18L27 6Z" fill="currentColor" fillOpacity=".1" /><path d="M27 6v12h12M16 25h16m-16 7h10" /><path d="m26 35 3 3 7-7" /></> : null}
    </svg>
  );
}

export default function LegalContent({ mode = "page" }: Props) {
  const i18nT = useTranslations("settings");
  const [openDoc, setOpenDoc] = useState<LegalDocKey | null>(null);

  const documents = [
    { key: "confidentialite", title: i18nT("politique_de_confidentialite_42b0e51e"), icon: "shield", tone: styles.blue },
    { key: "mentions-legales", title: i18nT("mentions_legales_414291e0"), icon: "identity", tone: styles.violet },
    { key: "cga", title: i18nT("cga_et_conditions_d_utilisation_353e0a8b"), icon: "terms", tone: styles.pink },
  ] as const;

  return (
    <div className={styles.surface} data-mode={mode}>
      <header className={styles.intro}>
        <span className={styles.introIcon}><DocumentIcon kind="shield" /></span>
        <div>
          <h2>{i18nT("informations_legales_4d326a77")}</h2>
          <p>{i18nT("retrouvez_ici_la_politique_de_confidentialite_631d7d46")}</p>
        </div>
      </header>

      <section className={styles.documents} aria-label={i18nT("documents_687c8286")}>
        <h3 className={styles.sectionLabel}>{i18nT("documents_687c8286")}</h3>
        <div className={styles.grid}>
          {documents.map((document) => (
            <button key={document.key} type="button" className={`${styles.card} ${styles.documentCard} ${document.tone}`} onClick={() => setOpenDoc(document.key)} aria-label={document.title} aria-haspopup="dialog">
              <span className={styles.iconTile}><DocumentIcon kind={document.icon} /></span>
              <span className={styles.documentTitle}>{document.title}</span>
              <span className={styles.documentAction}>{i18nT("ouvrir_7fd29c03")}</span>
            </button>
          ))}
        </div>
      </section>

      {openDoc ? <LegalDocumentsModal docKey={openDoc} onClose={() => setOpenDoc(null)} /> : null}
    </div>
  );
}
