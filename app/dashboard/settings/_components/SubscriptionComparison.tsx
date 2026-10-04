"use client";

import { useTranslations } from "next-intl";
import { AI_MEDIA_MONTHLY_LIMITS, type AiMediaEdition } from "@/lib/aiMediaPlanLimits";
import { STANDARD_PUBLICATION_CHANNEL_KEYS } from "@/lib/dashboardEdition";
import styles from "./settingsContentLayout.module.css";

export function SubscriptionPlanFeatures({ edition }: { edition: "standard" | "premium" }) {
  const t = useTranslations("settings");
  const rows = edition === "standard" ? [
    ["Booster", t("subscription_publication_channels", { count: STANDARD_PUBLICATION_CHANNEL_KEYS.length })],
    ["iNr’Agent", t("subscription_publications_statistics")],
    ["iNr’Studio", t("subscription_creation")],
    ["iNr’ADN · IA", t("subscription_business_profile")],
    ["iNr’Badge · iNr’Stats", `${t("subscription_reputation")} · ${t("subscription_statistics")}`],
    ["iNr’Send", t("subscription_history")],
  ] : [
    ["iNr’Agent", t("subscription_campaign_automation")],
    ["iNr’Send", t("subscription_email_campaigns")],
    ["ADS", t("subscription_multichannel_ads")],
    ["iNr’CRM", t("subscription_customer_management")],
    ["iNr’Calendar", t("subscription_appointments")],
    ["Propulser · Fidéliser", t("subscription_growth")],
  ];
  return <table className={styles.planTools} aria-label={t(edition === "standard" ? "subscription_standard_tools" : "subscription_premium_tools")}><tbody>
    {rows.map(([name, benefit]) => <tr key={name}><th scope="row">{name}</th><td>{benefit}</td></tr>)}
  </tbody></table>;
}

export function SubscriptionQuotaSummary({ edition }: { edition: AiMediaEdition }) {
  const t = useTranslations("settings");
  const limits = AI_MEDIA_MONTHLY_LIMITS[edition];
  const standard = AI_MEDIA_MONTHLY_LIMITS.standard;
  return <div className={styles.quotaSummary}>
    <div className={styles.quotaStat}>
      <div><strong>{limits.image}</strong>{edition === "premium" ? <span className={styles.quotaGain}>+{limits.image - standard.image}</span> : null}</div>
      <span>{t("subscription_images_month_label")}</span>
      {edition === "premium" ? <small>{t("subscription_compared_standard", { count: standard.image })}</small> : null}
    </div>
    <div className={styles.quotaStat}>
      <div><strong>{limits.video}<small> s</small></strong>{edition === "premium" ? <span className={styles.quotaGain}>+{limits.video - standard.video} s</span> : null}</div>
      <span>{t("subscription_video_month_label")}</span>
      {edition === "premium" ? <small>{t("subscription_compared_standard_seconds", { count: standard.video })}</small> : null}
    </div>
  </div>;
}
