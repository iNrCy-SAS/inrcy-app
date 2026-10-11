"use client";

import { useTranslations } from "next-intl";
import type { MediaGenerationQuotaCounter } from "../_hooks/useMediaGeneration";
import { MediaCreditRechargeButton } from "./VideoCreditRecharge";
import styles from "./MediaQuotaSummary.module.css";

type Props = {
  kind: "image" | "video";
  counter?: MediaGenerationQuotaCounter | null;
  unlimited?: boolean;
  resetDate: string;
  locked: boolean;
  onRefresh: () => void;
};

/** Both Studio modes show included and purchased balances separately. */
export default function MediaQuotaSummary({ kind, counter, unlimited, resetDate, locked, onRefresh }: Props) {
  const t = useTranslations("media");
  const unit = kind === "video" ? " s" : "";
  const included = counter?.includedRemaining ?? counter?.remaining;
  const purchased = counter?.purchasedRemaining;
  return <div className={styles.summary} data-kind={kind}>
    <span className={styles.icon} aria-hidden="true">◴</span>
    <div className={styles.balances}>
      <div className={styles.balance}>
        <div className={styles.headline}>
          <span>{t("ai_generator_included_balance")}</span>
          <strong>{unlimited ? t("ai_generator_unlimited") : typeof included === "number" ? `${included}${unit}` : "—"}</strong>
        </div>
        <small>{t("ai_generator_included_report")}{resetDate ? ` · ${t("ai_generator_reset", { date: resetDate })}` : ""}</small>
      </div>
      {!unlimited ? <div className={styles.balance}>
        <div className={styles.headline}>
          <span>{t("ai_generator_purchased_balance")}</span>
          <strong>{typeof purchased === "number" ? `${purchased}${unit}` : "—"}</strong>
          <MediaCreditRechargeButton mediaKind={kind} disabled={locked} onRefresh={onRefresh} className={styles.recharge} />
        </div>
        <small>{t("ai_generator_purchased_keep")}</small>
      </div> : null}
    </div>
  </div>;
}
