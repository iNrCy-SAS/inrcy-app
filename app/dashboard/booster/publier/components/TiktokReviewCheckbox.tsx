import { useTranslations } from "next-intl";
import css from "./TiktokReviewCheckbox.module.css";

export default function TiktokReviewCheckbox({ checked, disabled = false, onReview }: {
  checked: boolean;
  disabled?: boolean;
  onReview: () => void;
}) {
  const t = useTranslations("booster");
  return <label className={css.review} data-ready={checked}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={onReview} />
    <img src="/icons/tiktok.png" alt="" />
    <span>{t("wizard_tiktok_validation")}</span>
  </label>;
}
