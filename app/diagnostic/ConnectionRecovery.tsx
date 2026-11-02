"use client";

import { useTranslations } from "next-intl";
import { connectionRecoverySteps, type ConnectionRecoveryCheck } from "@/lib/connectionRecovery";
import styles from "./diagnostic.module.css";

export default function ConnectionRecovery({ checks, running }: { checks: readonly ConnectionRecoveryCheck[]; running: boolean }) {
  const t = useTranslations("public");
  const steps = connectionRecoverySteps(checks, running);
  return <section className={styles.recoveryCard} aria-labelledby="connection-recovery-title" data-testid="connection-recovery">
    <h2 id="connection-recovery-title">{t("connection_recovery_title")}</h2>
    <ol>{steps.map(step => <li key={step}>{t(`connection_recovery_${step}`)}</li>)}</ol>
    {!steps.includes("wait") ? <a className={styles.backLink} href="/login">{t("retour_connexion_a1ee2d62")}</a> : null}
  </section>;
}
