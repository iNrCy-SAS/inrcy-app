"use client";

import { useTranslations } from "next-intl";
import { AI_MEDIA_MONTHLY_LIMITS, type AiMediaEdition } from "@/lib/aiMediaPlanLimits";
import { STANDARD_PUBLICATION_CHANNEL_KEYS } from "@/lib/dashboardEdition";
import styles from "./settingsContentLayout.module.css";

export function SubscriptionPlanFeatures({ edition }: { edition: "standard" | "premium" }) {
  const t = useTranslations("settings");
  const limits = AI_MEDIA_MONTHLY_LIMITS[edition];
  const standard = AI_MEDIA_MONTHLY_LIMITS.standard;
  const rows = edition === "standard" ? [
    ["Booster", t("subscription_publication_channels", { count: STANDARD_PUBLICATION_CHANNEL_KEYS.length })],
    ["iNr’Agent", t("subscription_publications_statistics")],
    ["iNr’ADN · IA", t("subscription_business_profile")],
    ["iNr’Badge · iNr’Stats", `${t("subscription_reputation")} · ${t("subscription_statistics")}`],
    ["iNr’Send", t("subscription_history")],
  ] : [
    ["iNr’Agent", t("subscription_campaign_automation")],
    ["ADS", t("subscription_multichannel_ads")],
    ["iNr’CRM", t("subscription_customer_management")],
    ["iNr’Calendar", t("subscription_appointments")],
    ["Propulser · Fidéliser", `${t("subscription_email_campaigns")} · ${t("subscription_growth")}`],
  ];
  return <table className={styles.planTools} aria-label={t(edition === "standard" ? "subscription_standard_tools" : "subscription_premium_tools")}><tbody>
    <tr className={styles.studioRow}>
      <th scope="row"><span className={styles.studioName}>iNr’Studio</span><small>{t("subscription_creation")}</small></th>
      <td><div className={styles.studioMetrics}>
        <div><strong>{limits.image}</strong><span>{t("subscription_images_month_label")}</span>
          {edition === "premium" ? <small>{t("subscription_studio_image_gain", { count: limits.image - standard.image })}</small> : null}
        </div>
        <div><strong>{limits.video}<span> s</span></strong><span>{t("subscription_video_month_label")}</span>
          {edition === "premium" ? <small>{t("subscription_studio_video_gain", { count: limits.video - standard.video })}</small> : null}
        </div>
      </div></td>
    </tr>
    {rows.map(([name, benefit]) => <tr key={name}><th scope="row"><span className={styles.toolName}>{edition === "premium" ? <span className={styles.toolPlus} aria-hidden="true">+</span> : null}{name}</span></th><td>{benefit}</td></tr>)}
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
