"use client";

import styles from "../dashboard.module.css";
import cardStyles from "./DashboardStandardModulesCard.module.css";
import { DashboardPremiumLockIcon } from "./DashboardPremiumLockIcon";

function MailCampaignIcon() {
  return (
    <svg className={cardStyles.campaignArt} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M5.25 9.25A3.25 3.25 0 0 1 8.5 6h15A3.25 3.25 0 0 1 26.75 9.25v13.5A3.25 3.25 0 0 1 23.5 26h-15a3.25 3.25 0 0 1-3.25-3.25V9.25Z" />
      <path d="m6.7 9.2 8.14 6.38a1.86 1.86 0 0 0 2.32 0L25.3 9.2" />
      <path d="m6.7 24.1 6.84-6.2M25.3 24.1l-6.84-6.2" />
      <path className={cardStyles.campaignArtSpark} d="M25.8 3.4v3.3M24.15 5.05h3.3" />
    </svg>
  );
}

function AdsCampaignIcon() {
  return (
    <svg className={cardStyles.campaignArt} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="14.5" cy="17.5" r="8.3" />
      <circle cx="14.5" cy="17.5" r="3.2" />
      <path d="M20.35 11.65 27 5m-4.75 0H27v4.75" />
      <path d="M4 17.5h3.1M14.5 7V3.9M14.5 31v-3.1M4.92 25.45l2.2-2.2" />
      <path className={cardStyles.campaignArtSpark} d="M26.6 15.2v2.75m-1.38-1.37h2.76" />
    </svg>
  );
}

type DashboardCampaignChoicesProps = {
  mailTitle: string;
  mailDescription: string;
  adsTitle: string;
  adsDescription: string;
  actionLabel: string;
  premiumLabel: string;
  locked?: boolean;
  adsComingSoon?: boolean;
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
  adsComingSoon = false,
  mailBusy = false,
  adsBusy = false,
  onOpenMails,
  onOpenAds,
}: DashboardCampaignChoicesProps) {
  return (
    <div className={cardStyles.campaignChoicesRow} data-dashboard-campaign-choices="true">
      <section className={`${styles.blockCard} ${cardStyles.panel} ${cardStyles.campaignPanel} ${cardStyles.campaignChoice} ${cardStyles.campaignMailChoice}`}>
        <span className={cardStyles.campaignGlow} aria-hidden="true" />
        <span className={cardStyles.campaignIcon} aria-hidden="true"><MailCampaignIcon /></span>
        <div className={cardStyles.campaignCopy}>
          <h3>{mailTitle}</h3>
          <p><strong>{mailDescription}</strong></p>
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

      <section className={`${styles.blockCard} ${cardStyles.panel} ${cardStyles.campaignPanel} ${cardStyles.campaignChoice} ${cardStyles.campaignAdsChoice} ${adsComingSoon ? cardStyles.campaignComingSoonPanel : ""}`}>
        <span className={cardStyles.campaignGlow} aria-hidden="true" />
        <span className={cardStyles.campaignIcon} aria-hidden="true"><AdsCampaignIcon /></span>
        <div className={cardStyles.campaignCopy}>
          <h3>{adsTitle}</h3>
          <p><strong>{adsDescription}</strong></p>
        </div>
        <button
          type="button"
          className={`${cardStyles.campaignButton} ${adsComingSoon ? cardStyles.campaignComingSoon : ""}`}
          data-testid={adsComingSoon ? "campaign-ads-coming-soon" : locked ? "standard-campaign-ads" : "premium-campaign-ads"}
          onClick={adsComingSoon ? undefined : onOpenAds}
          disabled={adsBusy || adsComingSoon}
          aria-busy={adsBusy || undefined}
          aria-label={adsComingSoon ? `${adsTitle} — À venir` : locked ? `${adsTitle} — ${premiumLabel}` : adsTitle}
        >
          {adsComingSoon ? <>À venir</> : locked ? <><DashboardPremiumLockIcon />{premiumLabel}</> : <>{actionLabel} <span aria-hidden="true">→</span></>}
        </button>
      </section>
    </div>
  );
}
