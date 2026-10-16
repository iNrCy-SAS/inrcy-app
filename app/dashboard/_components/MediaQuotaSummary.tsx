"use client";

import { useLocale, useTranslations } from "next-intl";
import type { MediaGenerationQuotaCounter } from "../_hooks/useMediaGeneration";
import { MediaCreditRechargeButton } from "./VideoCreditRecharge";
import styles from "./MediaQuotaSummary.module.css";

type Props = {
  kind: "image" | "video";
  counter?: MediaGenerationQuotaCounter | null;
  unlimited?: boolean;
  creditsReady?: boolean;
  resetDate: string;
  locked: boolean;
  onRefresh: () => void;
};

/** One available balance belongs to every media engine and image/video operation. */
export default function MediaQuotaSummary({ kind, counter, unlimited, creditsReady, resetDate, locked, onRefresh }: Props) {
  const t = useTranslations("media");
  const locale = useLocale();
  const unit = counter?.unit === "credit" ? ` ${t("ai_generator_credits_unit")}` : kind === "video" ? " s" : "";
  const included = counter?.includedRemaining ?? counter?.remaining;
  const purchased = counter?.purchasedRemaining;
  const hasAdvance = !unlimited && creditsReady !== false && counter?.unit === "credit" && typeof counter.remaining === "number" && counter.remaining < 0;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const resetSubtitle = resetDate ? t("ai_generator_credit_reset_short", { date: resetDate }) : "";
  const subtitle = [creditsReady === false ? t("ai_generator_credits_unavailable_short") : "", hasAdvance ? t("ai_generator_credit_advance_short") : "", resetSubtitle].filter(Boolean).join(" · ");
  const balanceDetails = !unlimited && typeof included === "number" && typeof purchased === "number"
    ? t("ai_generator_credit_balance_breakdown", { included: number(included), purchased: number(purchased) }) : "";
  const subtitleDetails = [creditsReady === false ? t("ai_generator_credits_unavailable") : balanceDetails,
    hasAdvance ? t("ai_generator_credit_advance_help") : "",
    resetDate ? t("ai_generator_reset", { date: resetDate }) : ""].filter(Boolean).join(" · ");
  return <div className={styles.summary} data-kind={kind} data-media-credit-balance data-negative={hasAdvance || undefined}>
    <span className={styles.icon} aria-hidden="true">◴</span>
    <div className={styles.balances}>
        <div className={styles.headline}>
          <strong>{unlimited ? t("ai_generator_unlimited") : creditsReady === false ? "—" : typeof counter?.remaining === "number" ? `${number(counter.remaining)}${unit}` : "—"}</strong>
          <span>{t(hasAdvance ? "ai_generator_credit_balance_label" : "ai_generator_available_credits")}</span>
          {!unlimited ? <MediaCreditRechargeButton mediaKind={kind} disabled={locked || creditsReady === false} onRefresh={onRefresh} className={styles.recharge} /> : null}
        </div>
        {subtitle ? <small title={subtitleDetails} aria-label={subtitleDetails}>{subtitle}</small> : null}
    </div>
  </div>;
}
