"use client";

import { useTranslations } from "next-intl";
import { AI_MEDIA_MONTHLY_LIMITS, legacyAiMediaAmountToCredits, type AiMediaEdition } from "@/lib/aiMediaPlanLimits";
import { STANDARD_PUBLICATION_CHANNEL_KEYS } from "@/lib/dashboardEdition";
import { SubscriptionDetails } from "./SubscriptionWorkspace";
import styles from "./subscriptionWorkspace.module.css";

const monthlyCredits = (edition: AiMediaEdition) => legacyAiMediaAmountToCredits("image", AI_MEDIA_MONTHLY_LIMITS[edition].image) + legacyAiMediaAmountToCredits("video", AI_MEDIA_MONTHLY_LIMITS[edition].video);

export function SubscriptionPlanFeatures({ edition }: { edition: AiMediaEdition }) {
  const t = useTranslations("settings");
  const credits = monthlyCredits(edition);
  const standard = monthlyCredits("standard");
  const standardRows = [
    ["Booster", t("subscription_publication_channels", { count: STANDARD_PUBLICATION_CHANNEL_KEYS.length })],
    ["iNr’Agent", t("subscription_publications_statistics")],
    ["iNr’ADN · IA", t("subscription_business_profile")],
    ["iNr’Badge · iNr’Stats", `${t("subscription_reputation")} · ${t("subscription_statistics")}`],
    ["iNr’Send", t("subscription_history")],
  ];
  const premiumRows = [
    ["iNr’Agent", t("subscription_campaign_automation")],
    ["ADS", t("subscription_multichannel_ads")],
    ["iNr’CRM", t("subscription_customer_management")],
    ["iNr’Calendar", t("subscription_appointments")],
    ["Propulser · Fidéliser", `${t("subscription_email_campaigns")} · ${t("subscription_growth")}`],
  ];
  const rows = edition === "founder" ? [
    ...standardRows.map(([name, benefit]) => [name, name === "Booster" ? t("subscription_publications_statistics") : benefit]),
    ...premiumRows,
    ["Encaisser", t("subscription_quotes_invoices")],
  ] : edition === "standard" ? standardRows : premiumRows;
  const toolsLabel = t(edition === "founder" ? "subscription_founder_tools" : edition === "standard" ? "subscription_standard_tools" : "subscription_premium_tools");
  return <div className={styles.features}>
    <div className={styles.studioFeature}>
      <div><span className={styles.studioName}>iNr’Studio</span><small>{t("subscription_creation")}</small></div>
      <div className={styles.studioMetric}><strong>{credits}</strong><span>{t("subscription_media_month_label")}</span></div>
      {edition === "premium" ? <span className={styles.quotaGain}>+{credits - standard}</span> : null}
    </div>
    <div className={styles.featurePills}>{Array.from(new Set(rows.map(([name]) => name))).map((name) => <span key={name}><i aria-hidden="true">✓</i>{name}</span>)}</div>
    <SubscriptionDetails title={toolsLabel}>
    <table className={styles.planTools} aria-label={toolsLabel}><tbody>
    <tr className={styles.studioRow}>
      <th scope="row"><span className={styles.studioName}>iNr’Studio</span><small>{t("subscription_creation")}</small></th>
      <td><div className={styles.studioMetrics}>
        <div><strong>{credits}</strong><span>{t("subscription_media_month_label")}</span>
          {edition === "premium" ? <small>{t("subscription_studio_credit_gain", { count: credits - standard })}</small> : null}
          <small>{t("subscription_media_shared_hint")}</small>
        </div>
      </div></td>
    </tr>
    {rows.map(([name, benefit]) => <tr key={`${name}-${benefit}`}><th scope="row"><span className={styles.toolName}>{edition === "premium" ? <span className={styles.toolPlus} aria-hidden="true">+</span> : null}{name}</span></th><td>{benefit}</td></tr>)}
    </tbody></table>
    </SubscriptionDetails>
  </div>;
}

export function SubscriptionQuotaSummary({ edition }: { edition: AiMediaEdition }) {
  const t = useTranslations("settings");
  const credits = monthlyCredits(edition);
  const standard = monthlyCredits("standard");
  return <div className={styles.quotaSummary}>
    <div className={styles.quotaStat}>
      <div><strong>{credits}</strong>{edition === "premium" ? <span className={styles.quotaGain}>+{credits - standard}</span> : null}</div>
      <span>{t("subscription_media_month_label")}</span>
      <small>{t("subscription_media_shared_hint")}</small>
    </div>
  </div>;
}
