"use client";

import styles from "../dashboard.module.css";
import cardStyles from "./DashboardStandardModulesCard.module.css";
import { DashboardPremiumLockIcon } from "./DashboardPremiumLockIcon";

type DashboardCampaignChoicesProps = {
  mailTitle: string;
  mailDescription: string;
  adsTitle: string;
  adsDescription: string;
  actionLabel: string;
  premiumLabel: string;
  locked?: boolean;
  mailBusy?: boolean;
  adsBusy?: boolean;
  onOpenMails: () => void;
  onOpenAds: () => void;
};

export default function DashboardCampaignChoices({
  mailTitle,
  mailDescription,
  adsTitle,
  adsDescription,
  actionLabel,
  premiumLabel,
  locked = false,
  mailBusy = false,
  adsBusy = false,
  onOpenMails,
  onOpenAds,
}: DashboardCampaignChoicesProps) {
  return (
    <div className={cardStyles.campaignChoicesRow} data-dashboard-campaign-choices="true">
      <section className={`${styles.blockCard} ${cardStyles.panel} ${cardStyles.campaignPanel} ${cardStyles.campaignChoice}`}>
        <span className={cardStyles.campaignGlow} aria-hidden="true" />
        <span className={cardStyles.campaignIcon} aria-hidden="true">✉</span>
        <div className={cardStyles.campaignCopy}>
          <h3>{mailTitle}</h3>
          <p>{mailDescription}</p>
        </div>
        <button
          type="button"
          className={cardStyles.campaignButton}
          data-testid={locked ? "standard-campaign-mails" : "premium-campaign-open"}
          onClick={onOpenMails}
          disabled={mailBusy}
          aria-busy={mailBusy || undefined}
          aria-label={locked ? `${mailTitle} — ${premiumLabel}` : mailTitle}
        >
          {locked ? <><DashboardPremiumLockIcon />{premiumLabel}</> : <>{actionLabel} <span aria-hidden="true">→</span></>}
        </button>
      </section>

      <section className={`${styles.blockCard} ${cardStyles.panel} ${cardStyles.campaignPanel} ${cardStyles.campaignChoice} ${cardStyles.campaignAdsChoice}`}>
        <span className={cardStyles.campaignGlow} aria-hidden="true" />
        <span className={cardStyles.campaignIcon} aria-hidden="true">◎</span>
        <div className={cardStyles.campaignCopy}>
          <h3>{adsTitle}</h3>
          <p>{adsDescription}</p>
        </div>
        <button
          type="button"
          className={cardStyles.campaignButton}
          data-testid={locked ? "standard-campaign-ads" : "premium-campaign-ads"}
          onClick={onOpenAds}
          disabled={adsBusy}
          aria-busy={adsBusy || undefined}
          aria-label={locked ? `${adsTitle} — ${premiumLabel}` : adsTitle}
        >
          {locked ? <><DashboardPremiumLockIcon />{premiumLabel}</> : <>{actionLabel} <span aria-hidden="true">→</span></>}
        </button>
      </section>
    </div>
  );
}
