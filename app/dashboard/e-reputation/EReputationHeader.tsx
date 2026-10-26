"use client";

import Link from "next/link";
import DashboardToolHeading from "../_components/DashboardToolHeading";

import { useDashboardEdition } from "@/app/dashboard/_components/DashboardEditionProvider";

import styles from "./eReputation.module.css";

type Props = {
  title: string;
  tagline: string;
  sublineDesktop: string;
  sublineMobile: string;
  manageLabel: string;
  askReviewsLabel: string;
  closeLabel: string;
  askReviewsHref: string;
};

export default function EReputationHeader({
  title,
  tagline,
  manageLabel,
  askReviewsLabel,
  closeLabel,
  askReviewsHref,
}: Props) {
  const dashboardEdition = useDashboardEdition();
  const canAskForReviews = dashboardEdition !== "standard";

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.brandIconWrap} aria-hidden="true">
          <div className={styles.reputationBrandIcon}>
            <span className={[styles.reputationBrandStar, styles.reputationBrandStarCenter].join(" ")}>★</span>
            <span className={[styles.reputationBrandStar, styles.reputationBrandStarTopLeft].join(" ")}>★</span>
            <span className={[styles.reputationBrandStar, styles.reputationBrandStarTopRight].join(" ")}>★</span>
            <span className={[styles.reputationBrandStar, styles.reputationBrandStarBottomLeft].join(" ")}>★</span>
          </div>
        </div>
        <DashboardToolHeading subtitle={tagline}>
          <div className={styles.brandRow}>
            <h1>{title}</h1>
          </div>
        </DashboardToolHeading>
      </div>

      <div className={styles.actions}>
        <Link className={styles.btnPrimary} href="/dashboard?panel=gmb">{manageLabel}</Link>
        {canAskForReviews ? (
          <Link className={styles.btnGhost} href={askReviewsHref}>{askReviewsLabel}</Link>
        ) : null}
        <Link className={[styles.btnGhost, styles.headerCloseButton].join(" ")} href="/dashboard" aria-label={closeLabel}>
          <span className={styles.closeDesktopLabel}>{closeLabel}</span>
          <span className={styles.closeMobileLabel} aria-hidden="true">×</span>
        </Link>
      </div>
    </header>
  );
}
