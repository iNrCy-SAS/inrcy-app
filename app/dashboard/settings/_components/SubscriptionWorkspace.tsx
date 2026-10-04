"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import DrawerHeaderTabs from "../../DrawerHeaderTabs";
import SubscriptionInvoicesPanel from "./SubscriptionInvoicesPanel";
import styles from "./settingsContentLayout.module.css";

export default function SubscriptionWorkspace({ children, management, notice }: {
  children: ReactNode;
  management?: ReactNode;
  notice?: ReactNode;
}) {
  const t = useTranslations("settings");
  const id = useId();
  const [view, setView] = useState<"overview" | "invoices">("overview");
  return <div className={styles.workspace}>
    <DrawerHeaderTabs><nav className={styles.navigation} aria-label={t("mon_abonnement_d248414d")}>
      {(["overview", "invoices"] as const).map((item) => <button key={item} type="button" aria-pressed={view === item} aria-controls={`${id}-${item}`} onClick={() => setView(item)}>{t(`subscription_${item}`)}</button>)}
    </nav></DrawerHeaderTabs>
    {notice}
    <div id={`${id}-overview`} className={styles.view} hidden={view !== "overview"}>{children}</div>
    <div id={`${id}-invoices`} className={styles.view} hidden={view !== "invoices"}><div className={management ? styles.billingGrid : undefined}>{management}<SubscriptionInvoicesPanel /></div></div>
  </div>;
}
