import { useTranslations } from "next-intl";
import { Suspense } from "react";

import DiagnosticClient from "./DiagnosticClient";
import styles from "./diagnostic.module.css";

export default function DiagnosticPage() {
  const i18nT = useTranslations("public");
  return (
    <Suspense
      fallback={
        <main className={styles.pageShell}>
          <div className={styles.card}>{i18nT("chargement_du_diagnostic_ffd51421")}</div>
        </main>
      }
    >
      <DiagnosticClient />
    </Suspense>
  );
}
